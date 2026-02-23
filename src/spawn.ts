import { spawn, type ChildProcess } from 'node:child_process'
import { readFileSync, writeFileSync, mkdirSync, existsSync, unlinkSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { homedir } from 'node:os'
import type { AgentConfig } from './types.js'

const PIDS_DIR = join(homedir(), '.openswarm')
const PIDS_FILE = join(PIDS_DIR, 'pids.json')
const HEALTH_TIMEOUT = 120_000 // 2 minutes — OpenClaw gateway can take 50s+
const HEALTH_INTERVAL = 2_000
const KILL_GRACE = 5_000

interface PidEntry {
  name: string
  pid: number
  port: number
}

/**
 * Manages OpenClaw gateway processes for workspace agents.
 *
 * Spawns `npx openclaw gateway` for each workspace agent,
 * waits for them to become healthy, and cleans up on exit.
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

    const child = spawn('npx', [
      'openclaw', 'gateway',
      '--bind', 'lan',
      '--port', String(port),
      '--allow-unconfigured',
    ], {
      cwd: absPath,
      env: {
        ...process.env,
        OPENCLAW_STATE_DIR: absPath,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: true,
    })

    this.processes.set(name, child)
    this.ports.set(name, port)

    // Log stderr for debugging (but don't spam the terminal)
    child.stderr?.on('data', () => {
      // Silently consume — stderr includes startup noise
    })

    child.on('exit', (code) => {
      this.processes.delete(name)
      if (!this.cleanedUp) {
        // Unexpected exit
        process.stderr.write(`\n  [spawn] ${name} exited with code ${code}\n`)
      }
    })

    return child
  }

  /**
   * Wait for a gateway to become ready by polling its health endpoint.
   */
  async waitForReady(port: number, timeout = HEALTH_TIMEOUT): Promise<boolean> {
    const url = `http://localhost:${port}/v1/chat/completions`
    const start = Date.now()

    while (Date.now() - start < timeout) {
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
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
        this.waitForReady(agent.port).then((ready) => {
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
