/**
 * @deprecated OpenSwarm no longer manages OpenClaw processes.
 * Users run their own OpenClaw gateways; OpenSwarm discovers and connects them.
 * This file is retained for reference but is not used by cli.ts.
 */
import { spawn, type ChildProcess } from 'node:child_process'
import { readFileSync, writeFileSync, copyFileSync, mkdirSync, existsSync, unlinkSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { homedir } from 'node:os'
import type { AgentConfig } from './types.js'

const PIDS_DIR = join(homedir(), '.openswarm')
const PIDS_FILE = join(PIDS_DIR, 'pids.json')
const OPENCLAW_HOME = join(homedir(), '.openclaw')
const HEALTH_TIMEOUT = 120_000 // 2 minutes — OpenClaw gateway can take 50s+
const HEALTH_INTERVAL = 2_000
const KILL_GRACE = 5_000

interface PidEntry {
  name: string
  pid: number
  port: number
}

/**
 * Find the user's global OpenClaw auth-profiles.json.
 * OpenClaw stores auth per agent; we look in the "main" agent first,
 * then fall back to any other agent that has credentials.
 */
function findGlobalAuthProfiles(): string | null {
  // Primary: ~/.openclaw/agents/main/agent/auth-profiles.json
  const mainAuth = join(OPENCLAW_HOME, 'agents', 'main', 'agent', 'auth-profiles.json')
  if (existsSync(mainAuth)) return mainAuth

  // Fallback: any agent dir
  const agentsDir = join(OPENCLAW_HOME, 'agents')
  if (!existsSync(agentsDir)) return null

  try {
    for (const entry of readdirSync(agentsDir)) {
      const candidate = join(agentsDir, entry, 'agent', 'auth-profiles.json')
      if (existsSync(candidate)) return candidate
    }
  } catch { /* ok */ }

  return null
}

/**
 * Copy the global OpenClaw auth-profiles.json into a workspace agent's
 * expected location so the gateway can find provider credentials.
 *
 * OpenClaw looks for auth at: {stateDir}/agents/{agentId}/agent/auth-profiles.json
 * The agent ID from our openclaw.json is "main" by default.
 */
function provisionAuth(workspacePath: string): void {
  const globalAuth = findGlobalAuthProfiles()
  if (!globalAuth) return

  // Read the openclaw.json to find the agent ID(s)
  const clawConfigPath = join(workspacePath, 'openclaw.json')
  let agentIds = ['main']
  try {
    const raw = readFileSync(clawConfigPath, 'utf-8')
    const config = JSON.parse(raw)
    const list = config?.agents?.list
    if (Array.isArray(list)) {
      agentIds = list.map((a: { id?: string }) => a.id ?? 'main')
    }
  } catch { /* use default */ }

  for (const agentId of agentIds) {
    const targetDir = join(workspacePath, 'agents', agentId, 'agent')
    const targetPath = join(targetDir, 'auth-profiles.json')

    // Don't overwrite if the user has already set up auth for this agent
    if (existsSync(targetPath)) continue

    try {
      mkdirSync(targetDir, { recursive: true })
      copyFileSync(globalAuth, targetPath)
    } catch { /* best effort */ }
  }
}

/**
 * Manages OpenClaw gateway processes for workspace agents.
 *
 * - Automatically provisions auth from the user's global OpenClaw install
 * - Spawns `openclaw gateway run` per agent with isolated state dirs
 * - Polls health endpoints until ready
 * - Cleans up on exit
 */
export class SpawnManager {
  private processes: Map<string, ChildProcess> = new Map()
  private ports: Map<string, number> = new Map()
  private cleanedUp = false

  /**
   * Start a single OpenClaw gateway for a workspace agent.
   * Returns once the process is spawned (not yet ready).
   */
  startAgent(name: string, workspacePath: string, port: number): ChildProcess {
    const absPath = resolve(workspacePath)

    // Auto-provision auth from global OpenClaw install
    provisionAuth(absPath)

    // Use `gateway run` (foreground) not `gateway` (service mode).
    // --force bypasses stale port locks.
    // Single command string avoids Node v24 DEP0190 warning.
    const cmd = `npx openclaw gateway run --bind lan --port ${port} --allow-unconfigured --force`

    const child = spawn(cmd, {
      cwd: absPath,
      env: {
        ...process.env,
        // Isolate each agent's state dir so gateway locks don't conflict
        OPENCLAW_STATE_DIR: absPath,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: true,
    })

    this.processes.set(name, child)
    this.ports.set(name, port)

    // Collect stderr for error reporting
    let stderrBuf = ''
    child.stderr?.on('data', (chunk: Buffer) => {
      stderrBuf += chunk.toString()
    })

    child.on('exit', (code) => {
      this.processes.delete(name)
      if (!this.cleanedUp) {
        // Unexpected exit — show last few lines of stderr
        process.stderr.write(`\n  [spawn] ${name} exited with code ${code}\n`)
        if (stderrBuf.trim()) {
          const lines = stderrBuf.trim().split('\n').slice(-5)
          for (const line of lines) {
            process.stderr.write(`  [spawn] ${name}: ${line}\n`)
          }
        }
      }
    })

    return child
  }

  /**
   * Wait for a gateway to become ready by polling its health endpoint.
   */
  async waitForReady(port: number, token?: string, timeout = HEALTH_TIMEOUT): Promise<boolean> {
    const url = `http://localhost:${port}/v1/chat/completions`
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (token) headers['Authorization'] = `Bearer ${token}`

    const start = Date.now()

    while (Date.now() - start < timeout) {
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            model: 'default',
            messages: [{ role: 'user', content: 'ping' }],
            stream: false,
            max_tokens: 1,
          }),
          signal: AbortSignal.timeout(5_000),
        })
        // Any non-network response means the server is listening
        if (res.ok || res.status < 500) return true
      } catch {
        // Not ready yet
      }
      await new Promise((r) => setTimeout(r, HEALTH_INTERVAL))
    }
    return false
  }

  /**
   * Start all workspace agents in parallel.
   * Returns a map of agent name → ready status.
   */
  async startAll(
    agents: Record<string, AgentConfig>,
    onProgress?: (name: string, status: 'starting' | 'ready' | 'failed') => void,
  ): Promise<Map<string, boolean>> {
    const results = new Map<string, boolean>()
    const startPromises: Promise<void>[] = []

    for (const [name, agent] of Object.entries(agents)) {
      if (!agent.workspace || !agent.port) continue

      onProgress?.(name, 'starting')
      this.startAgent(name, agent.workspace, agent.port)

      startPromises.push(
        this.waitForReady(agent.port, agent.token).then((ready) => {
          results.set(name, ready)
          onProgress?.(name, ready ? 'ready' : 'failed')
        })
      )
    }

    await Promise.all(startPromises)
    this.savePids()
    return results
  }

  /** Stop all spawned processes. Sends SIGTERM, then SIGKILL after grace period. */
  async stopAll(): Promise<void> {
    this.cleanedUp = true

    const killPromises: Promise<void>[] = []

    for (const [name, child] of this.processes) {
      killPromises.push(new Promise((resolve) => {
        const timer = setTimeout(() => {
          try { child.kill('SIGKILL') } catch { /* already dead */ }
          resolve()
        }, KILL_GRACE)

        child.on('exit', () => {
          clearTimeout(timer)
          resolve()
        })

        try {
          child.kill('SIGTERM')
        } catch {
          clearTimeout(timer)
          resolve()
        }
      }))
    }

    await Promise.all(killPromises)
    this.processes.clear()
    this.removePids()
  }

  /** Stop agents from a saved pids.json (for `openswarm down`). */
  static stopFromPids(): boolean {
    const entries = SpawnManager.loadPids()
    if (entries.length === 0) return false

    for (const entry of entries) {
      try {
        process.kill(entry.pid, 'SIGTERM')
      } catch {
        // Already dead
      }
    }

    // Clean up
    try { unlinkSync(PIDS_FILE) } catch { /* ok */ }
    return true
  }

  /** Check if any agents are running from pids.json. */
  static hasRunning(): boolean {
    const entries = SpawnManager.loadPids()
    for (const entry of entries) {
      try {
        process.kill(entry.pid, 0) // signal 0 = check if alive
        return true
      } catch {
        // Dead
      }
    }
    return false
  }

  private savePids(): void {
    const entries: PidEntry[] = []
    for (const [name, child] of this.processes) {
      if (child.pid) {
        entries.push({ name, pid: child.pid, port: this.ports.get(name) ?? 0 })
      }
    }
    if (entries.length === 0) return
    mkdirSync(PIDS_DIR, { recursive: true })
    writeFileSync(PIDS_FILE, JSON.stringify(entries, null, 2))
  }

  private removePids(): void {
    try { unlinkSync(PIDS_FILE) } catch { /* ok */ }
  }

  private static loadPids(): PidEntry[] {
    try {
      const raw = readFileSync(PIDS_FILE, 'utf-8')
      return JSON.parse(raw) as PidEntry[]
    } catch {
      return []
    }
  }
}
