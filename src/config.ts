import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { getGlobalToken } from './discover.js'
import type { AgentConfig, SwarmConfig } from './types.js'

const DEFAULTS: Pick<SwarmConfig, 'maxMentionDepth' | 'sessionPrefix' | 'timeout'> = {
  maxMentionDepth: 3,
  sessionPrefix: 'openswarm',
  timeout: 120_000,
}

/** Derive an agent's HTTP endpoint from its config. */
function agentEndpoint(agent: AgentConfig): string {
  if (agent.url) return agent.url
  if (agent.port) return `http://localhost:${agent.port}/v1`
  return 'unknown'
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

    // Agents must have at least one of: url, workspace, port
    const hasUrl = typeof a.url === 'string' && a.url.length > 0
    const hasWorkspace = typeof a.workspace === 'string' && a.workspace.length > 0
    const hasPort = typeof a.port === 'number'

    if (!hasUrl && !hasWorkspace && !hasPort) {
      throw new Error(`Agent "${name}" must have a "url", "port", or "workspace" field`)
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
    agents: agents as SwarmConfig['agents'],
    master,
    configPath: absPath,
    maxMentionDepth:
      typeof json.maxMentionDepth === 'number' ? json.maxMentionDepth : DEFAULTS.maxMentionDepth,
    sessionPrefix:
      typeof json.sessionPrefix === 'string' ? json.sessionPrefix : DEFAULTS.sessionPrefix,
    timeout: typeof json.timeout === 'number' ? json.timeout : DEFAULTS.timeout,
  }

  // Apply global OpenClaw token to agents that don't have their own
  const globalToken = await getGlobalToken()
  if (globalToken) {
    for (const agent of Object.values(config.agents)) {
      if (!agent.token) {
        agent.token = globalToken
      }
    }
  }

  // Build rich self-consciousness system prompts for all agents
  injectSwarmIdentityPrompts(config)

  return config
}

/** Save the swarm config back to disk (for persisting dynamically spawned agents). */
export async function saveConfig(config: SwarmConfig): Promise<void> {
  if (!config.configPath) return
  // Write only the user-facing fields (not systemPrompt or configPath)
  const out: Record<string, unknown> = {
    agents: {} as Record<string, Record<string, unknown>>,
    master: config.master,
  }
  if (config.maxMentionDepth !== 3) (out as any).maxMentionDepth = config.maxMentionDepth
  if (config.timeout !== 120_000) (out as any).timeout = config.timeout
  if (config.sessionPrefix !== 'openswarm') (out as any).sessionPrefix = config.sessionPrefix

  for (const [name, agent] of Object.entries(config.agents)) {
    const entry: Record<string, unknown> = { label: agent.label, color: agent.color }
    if (agent.port) entry.port = agent.port
    if (agent.url) entry.url = agent.url
    if (agent.model) entry.model = agent.model
    if (agent.workspace) entry.workspace = agent.workspace
    ;(out.agents as Record<string, unknown>)[name] = entry
  }

  await writeFile(config.configPath, JSON.stringify(out, null, 2) + '\n')
}

/** Build a swarm identity system prompt for a single agent. Exported for dynamic agent spawning. */
export function buildAgentSystemPrompt(name: string, config: SwarmConfig): string {
  const agent = config.agents[name]
  if (!agent) return ''

  const endpoint = agentEndpoint(agent)
  const model = agent.model ?? 'unknown'
  const isMaster = name === config.master
  const allAgents = Object.entries(config.agents)

  const teamLines = allAgents.map(([n, a]) => {
    const ep = agentEndpoint(a)
    const m = a.model ?? 'unknown'
    const role = n === config.master ? 'coordinator' : 'specialist'
    const marker = n === name ? ' — YOU' : ` — ${role} — ${ep} — ${m}`
    return `  @${n} (${a.label})${marker}`
  })

  const mentionableTeammates = allAgents
    .filter(([n]) => n !== name)
    .map(([n]) => `@${n}`)
    .join(', ')

  const lines: string[] = [
    `You are ${agent.label} (${name}), an AI agent in an OpenSwarm multi-agent network.`,
    ``,
    `Your endpoint: ${endpoint}`,
    `Your model: ${model}`,
    ``,
    `Your swarm team:`,
    ...teamLines,
    ``,
    `You receive messages from humans (relayed by @${config.master}) AND from AI teammates.`,
    `Teammate messages are prefixed with [SWARM CONTEXT]. Treat them as peer collaboration.`,
    `You can @mention teammates to delegate: ${mentionableTeammates}`,
  ]

  if (isMaster) {
    lines.push(
      ``,
      `As coordinator, your job is to understand the user's request and delegate tasks`,
      `to your team using @mentions. After receiving their replies, synthesize the results.`,
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
 * Delegates to buildAgentSystemPrompt for each agent.
 */
function injectSwarmIdentityPrompts(config: SwarmConfig): void {
  for (const [name, agent] of Object.entries(config.agents)) {
    if (agent.systemPrompt) continue
    agent.systemPrompt = buildAgentSystemPrompt(name, config)
  }
}
