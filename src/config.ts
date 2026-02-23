import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import type { SwarmConfig } from './types.js'

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

  const agents = json.agents
  if (!agents || typeof agents !== 'object' || Array.isArray(agents)) {
    throw new Error('Config must have an "agents" object')
  }

  for (const [name, agent] of Object.entries(agents as Record<string, unknown>)) {
    if (!agent || typeof agent !== 'object') {
      throw new Error(`Agent "${name}" must be an object`)
    }
    const a = agent as Record<string, unknown>
    if (!a.url || typeof a.url !== 'string') {
      throw new Error(`Agent "${name}" must have a "url" string`)
    }
    if (!a.label || typeof a.label !== 'string') {
      throw new Error(`Agent "${name}" must have a "label" string`)
    }
    if (!a.color || typeof a.color !== 'string') {
      throw new Error(`Agent "${name}" must have a "color" string`)
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
    maxMentionDepth:
      typeof json.maxMentionDepth === 'number' ? json.maxMentionDepth : DEFAULTS.maxMentionDepth,
    sessionPrefix:
      typeof json.sessionPrefix === 'string' ? json.sessionPrefix : DEFAULTS.sessionPrefix,
    timeout: typeof json.timeout === 'number' ? json.timeout : DEFAULTS.timeout,
  }

  // Auto-inject system prompts if missing
  injectDefaultPrompts(config)

  return config
}

/**
 * Auto-generate system prompts for agents that don't have one.
 *
 * The master gets instructions about delegating via @mentions.
 * Non-master agents get instructions about their role and how to
 * collaborate with other agents via @mentions.
 */
function injectDefaultPrompts(config: SwarmConfig): void {
  const masterAgent = config.agents[config.master]
  const otherAgents = Object.entries(config.agents).filter(([name]) => name !== config.master)

  // Build team roster for prompts
  const teamList = otherAgents
    .map(([name, agent]) => `  - @${name} (${agent.label})`)
    .join('\n')

  // Master prompt: delegate via @mentions
  if (!masterAgent.systemPrompt && otherAgents.length > 0) {
    masterAgent.systemPrompt = [
      `You are ${masterAgent.label}, the coordinator of a team of AI agents.`,
      `Your job is to understand the user's request and delegate tasks to your team members using @mentions.`,
      ``,
      `Your team:`,
      teamList,
      ``,
      `How to delegate: Write @agent_name followed by the task description in your response.`,
      `Example: "@researcher Find the latest information about X"`,
      `Example: "@coder Write a Python script that does Y"`,
      ``,
      `Rules:`,
      `- ALWAYS delegate to at least one team member when the user asks for help.`,
      `- You can @mention multiple agents in one response for parallel tasks.`,
      `- After receiving their replies, synthesize the results for the user.`,
      `- Be concise in your delegation — state exactly what you need from each agent.`,
      `- Never refuse to @mention an agent. The @mention syntax is how you communicate with your team.`,
    ].join('\n')
  }

  // Non-master prompts: know they're specialists, can @mention others
  for (const [name, agent] of otherAgents) {
    if (agent.systemPrompt) continue

    const peers = Object.entries(config.agents)
      .filter(([n]) => n !== name)
      .map(([n, a]) => `@${n} (${a.label})`)
      .join(', ')

    agent.systemPrompt = [
      `You are ${agent.label}, a specialist AI agent in a team.`,
      `You receive tasks from the team coordinator and other agents.`,
      `Answer thoroughly and directly. Focus on your area of expertise.`,
      ``,
      `If you need help from another team member, @mention them: ${peers}`,
      `Only @mention others when you genuinely need their specific expertise.`,
    ].join('\n')
  }
}
