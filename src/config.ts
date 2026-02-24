import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { getGlobalToken, discoverOpenClaw } from './discover.js'
import type { AgentConfig, GatewayConfig, SwarmConfig } from './types.js'

const DEFAULTS: Pick<SwarmConfig, 'maxMentionDepth' | 'sessionPrefix' | 'timeout'> = {
  maxMentionDepth: 3,
  sessionPrefix: 'openswarm',
  timeout: 120_000,
}

/** Load and validate a swarm config file. */
export async function loadConfig(path: string): Promise<SwarmConfig> {
  const absPath = resolve(path)
  let raw: string
  try {
    raw = await readFile(absPath, 'utf-8')
  } catch {
    throw new Error(`Config file not found: ${absPath}`)
  }

  let json: Record<string, unknown>
  try {
    json = JSON.parse(raw)
  } catch {
    throw new Error(`Invalid JSON in config file: ${absPath}`)
  }

  // --- Parse gateway config ---
  let gateway: GatewayConfig
  const gw = json.gateway as Record<string, unknown> | undefined
  if (gw && typeof gw === 'object') {
    const port = typeof gw.port === 'number' ? gw.port : 18789
    let token = ''
    if (gw.token === 'auto' || !gw.token) {
      token = (await getGlobalToken()) ?? ''
    } else if (typeof gw.token === 'string') {
      token = gw.token
    }
    gateway = { port, token }
  } else {
    // Auto-discover gateway from openclaw.json
    const discovery = await discoverOpenClaw()
    if (discovery) {
      gateway = { port: discovery.port, token: discovery.token ?? '' }
    } else {
      gateway = { port: 18789, token: (await getGlobalToken()) ?? '' }
    }
  }

  // --- Parse agents ---
  const agents = json.agents
  if (!agents || typeof agents !== 'object' || Array.isArray(agents)) {
    throw new Error('Config must have an "agents" object')
  }

  for (const [name, agent] of Object.entries(agents as Record<string, unknown>)) {
    if (!agent || typeof agent !== 'object') {
      throw new Error(`Agent "${name}" must be an object`)
    }
    const a = agent as Record<string, unknown>

    if (!a.label || typeof a.label !== 'string') {
      throw new Error(`Agent "${name}" must have a "label" string`)
    }
    if (!a.color || typeof a.color !== 'string') {
      throw new Error(`Agent "${name}" must have a "color" string`)
    }

    // New format: agentId is required (defaults to agent name)
    if (!a.agentId) {
      a.agentId = name
    }
  }

  const master = json.master as string | undefined
  if (!master || typeof master !== 'string') {
    throw new Error('Config must have a "master" string')
  }
  if (!(master in (agents as Record<string, unknown>))) {
    throw new Error(`Master agent "${master}" not found in agents`)
  }

  const config: SwarmConfig = {
    gateway,
    agents: agents as SwarmConfig['agents'],
    master,
    configPath: absPath,
    maxMentionDepth:
      typeof json.maxMentionDepth === 'number' ? json.maxMentionDepth : DEFAULTS.maxMentionDepth,
    sessionPrefix:
      typeof json.sessionPrefix === 'string' ? json.sessionPrefix : DEFAULTS.sessionPrefix,
    timeout: typeof json.timeout === 'number' ? json.timeout : DEFAULTS.timeout,
  }

  // Build rich self-consciousness system prompts for all agents
  injectSwarmIdentityPrompts(config)

  return config
}

/** Save the swarm config back to disk (for persisting dynamically spawned agents). */
export async function saveConfig(config: SwarmConfig): Promise<void> {
  if (!config.configPath) return

  const out: Record<string, unknown> = {
    gateway: {
      port: config.gateway.port,
      token: 'auto',
    },
    agents: {} as Record<string, Record<string, unknown>>,
    master: config.master,
  }
  if (config.maxMentionDepth !== 3) (out as Record<string, unknown>).maxMentionDepth = config.maxMentionDepth
  if (config.timeout !== 120_000) (out as Record<string, unknown>).timeout = config.timeout
  if (config.sessionPrefix !== 'openswarm') (out as Record<string, unknown>).sessionPrefix = config.sessionPrefix

  for (const [name, agent] of Object.entries(config.agents)) {
    const entry: Record<string, unknown> = {
      agentId: agent.agentId,
      label: agent.label,
      color: agent.color,
    }
    if (agent.model) entry.model = agent.model
    ;(out.agents as Record<string, unknown>)[name] = entry
  }

  await writeFile(config.configPath, JSON.stringify(out, null, 2) + '\n')
}

/** Build a swarm identity system prompt for a single agent. */
export function buildAgentSystemPrompt(name: string, config: SwarmConfig): string {
  const agent = config.agents[name]
  if (!agent) return ''

  const model = agent.model ?? 'unknown'
  const isMaster = name === config.master
  const allAgents = Object.entries(config.agents)

  const teamLines = allAgents.map(([n, a]) => {
    const m = a.model ?? 'unknown'
    const role = n === config.master ? 'coordinator' : 'specialist'
    const marker = n === name ? ' — YOU' : ` — ${role} — ${m}`
    return `  @${n} (${a.label})${marker}`
  })

  const mentionableTeammates = allAgents
    .filter(([n]) => n !== name)
    .map(([n]) => `@${n}`)
    .join(', ')

  const lines: string[] = [
    `You are ${agent.label} (${name}), an AI agent in an OpenSwarm group chat.`,
    ``,
    `Gateway: localhost:${config.gateway.port}`,
    `Your agent ID: ${agent.agentId}`,
    `Your model: ${model}`,
    ``,
    `Your swarm team:`,
    ...teamLines,
    ``,
    `This is a group chat. You see all messages from the user and other agents.`,
    `You can @mention teammates to involve them: ${mentionableTeammates}`,
  ]

  if (isMaster) {
    lines.push(
      ``,
      `As coordinator, your job is to understand the user's request and delegate tasks`,
      `to your team using @mentions. You see all responses in the group chat.`,
      `You can @mention ANY name to create a new specialist agent on-the-fly.`,
      `For example, @philosopher will spawn a new "Philosopher" agent if one doesn't exist.`,
      `You can @mention multiple agents in one response for parallel tasks.`,
    )
  } else {
    lines.push(
      ``,
      `Focus on your area of expertise. Answer thoroughly and directly.`,
      `Only @mention others when you genuinely need their specific expertise.`,
    )
  }

  return lines.join('\n')
}

/**
 * Build and inject swarm identity system prompts for all agents without one.
 */
function injectSwarmIdentityPrompts(config: SwarmConfig): void {
  for (const [name, agent] of Object.entries(config.agents)) {
    if (agent.systemPrompt) continue
    agent.systemPrompt = buildAgentSystemPrompt(name, config)
  }
}
