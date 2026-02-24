import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { homedir } from 'node:os'

const OPENCLAW_HOME = join(homedir(), '.openclaw')
const OPENCLAW_CONFIG = join(OPENCLAW_HOME, 'openclaw.json')

export interface GatewayInfo {
  port: number
  token: string | undefined
  model: string | undefined
  alive: boolean
}

/** Agent info discovered from openclaw.json */
export interface DiscoveredAgent {
  id: string
  name: string
  model?: string
  subagents?: string[]
}

/** Full discovery result from openclaw.json */
export interface OpenClawDiscovery {
  port: number
  token: string | undefined
  model: string | undefined
  agents: DiscoveredAgent[]
}

/** Read the gateway token from ~/.openclaw/openclaw.json */
export async function getGlobalToken(): Promise<string | undefined> {
  try {
    const raw = await readFile(OPENCLAW_CONFIG, 'utf-8')
    const json = JSON.parse(raw)
    const token = json?.gateway?.auth?.token
    return typeof token === 'string' ? token : undefined
  } catch {
    return undefined
  }
}

/**
 * Read full OpenClaw configuration including agents list.
 * Returns gateway info + discovered agents.
 */
export async function discoverOpenClaw(): Promise<OpenClawDiscovery | null> {
  try {
    const raw = await readFile(OPENCLAW_CONFIG, 'utf-8')
    const json = JSON.parse(raw)

    const port = json?.gateway?.port
    if (typeof port !== 'number') return null

    const token = json?.gateway?.auth?.token
    const model = json?.model?.primary ?? json?.agents?.defaults?.model?.primary

    // Discover agents from agents.list[]
    const agents: DiscoveredAgent[] = []
    const agentList = json?.agents?.list
    if (Array.isArray(agentList)) {
      for (const entry of agentList) {
        if (entry && typeof entry === 'object' && typeof entry.id === 'string') {
          agents.push({
            id: entry.id,
            name: entry.name ?? entry.id,
            model: entry.model?.primary ?? model,
            subagents: entry.subagents?.allowAgents,
          })
        }
      }
    }

    // If no agents list, add a default "main" agent
    if (agents.length === 0) {
      agents.push({ id: 'main', name: 'Main', model: typeof model === 'string' ? model : undefined })
    }

    return {
      port,
      token: typeof token === 'string' ? token : undefined,
      model: typeof model === 'string' ? model : undefined,
      agents,
    }
  } catch {
    return null
  }
}

/**
 * Health-check a single port by sending a lightweight POST.
 * Returns true if the server responds with any non-network error.
 */
export async function probePort(port: number, token?: string): Promise<boolean> {
  const url = `http://localhost:${port}/v1/chat/completions`
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (token) headers['Authorization'] = `Bearer ${token}`

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
    return res.ok || res.status < 500
  } catch {
    return false
  }
}

/** Return the path of today's openclaw log file. */
function getTodayLogPath(): string {
  const today = new Date().toISOString().slice(0, 10)
  const tmpBase = process.platform === 'win32' ? 'C:/tmp/openclaw' : '/tmp/openclaw'
  return join(tmpBase, `openclaw-${today}.log`)
}

/**
 * Parse port numbers from log lines like:
 *   [gateway] listening on ws://127.0.0.1:18789 (PID 1234)
 */
function parseLogPorts(content: string): number[] {
  const ports: number[] = []
  const regex = /\[gateway\] listening on ws:\/\/[^:]+:(\d+)/g
  for (const match of content.matchAll(regex)) {
    const port = parseInt(match[1], 10)
    if (!isNaN(port) && !ports.includes(port)) {
      ports.push(port)
    }
  }
  return ports
}

/**
 * Parse the model associated with a port from log lines.
 */
function parseLogModelForPort(content: string, port: number): string | undefined {
  const lines = content.split('\n')
  let foundPort = false
  for (const line of lines) {
    if (line.includes('[gateway] listening on') && line.includes(`:${port}`)) {
      foundPort = true
    }
    if (foundPort && line.includes('[gateway] agent model:')) {
      const match = line.match(/\[gateway\] agent model:\s*(.+)/)
      if (match) return match[1].trim()
    }
  }
  return undefined
}

/**
 * Discover running OpenClaw gateways (legacy multi-port discovery).
 */
export async function discoverGateways(): Promise<GatewayInfo[]> {
  const token = await getGlobalToken()
  const candidatePorts = new Set<number>()

  let primaryPort: number | undefined
  let primaryModel: string | undefined
  try {
    const raw = await readFile(OPENCLAW_CONFIG, 'utf-8')
    const json = JSON.parse(raw)
    const port = json?.gateway?.port
    if (typeof port === 'number') {
      primaryPort = port
      candidatePorts.add(port)
    }
    const model =
      json?.model?.primary ??
      json?.agents?.defaults?.model?.primary
    if (typeof model === 'string') primaryModel = model
  } catch {
    // No global config
  }

  let logContent = ''
  try {
    logContent = await readFile(getTodayLogPath(), 'utf-8')
    for (const port of parseLogPorts(logContent)) {
      candidatePorts.add(port)
    }
  } catch {
    // No log file
  }

  if (candidatePorts.size === 0) return []

  const results: GatewayInfo[] = []

  await Promise.all(
    [...candidatePorts].map(async (port) => {
      const alive = await probePort(port, token)
      const model =
        parseLogModelForPort(logContent, port) ??
        (port === primaryPort ? primaryModel : undefined)
      results.push({ port, token, model, alive })
    })
  )

  results.sort((a, b) => a.port - b.port)
  return results
}
