import { readFile, access, stat } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import type { SwarmConfig } from './types.js'

const DEFAULTS: Pick<SwarmConfig, 'maxMentionDepth' | 'sessionPrefix' | 'timeout'> = {
  maxMentionDepth: 3,
  sessionPrefix: 'openswarm',
  timeout: 120_000,
}

/** Starting port for auto-assigned workspace agents. */
const BASE_PORT = 19001

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

  let nextPort = BASE_PORT

  for (const [name, agent] of Object.entries(agents as Record<string, unknown>)) {
    if (!agent || typeof agent !== 'object') {
      throw new Error(`Agent "${name}" must be an object`)
    }
    const a = agent as Record<string, unknown>

    // Must have url OR workspace (not both, not neither)
    const hasUrl = typeof a.url === 'string' && a.url.length > 0
    const hasWorkspace = typeof a.workspace === 'string' && a.workspace.length > 0

    if (!hasUrl && !hasWorkspace) {
      throw new Error(`Agent "${name}" must have a "url" or "workspace" field`)
    }

    if (!a.label || typeof a.label !== 'string') {
      throw new Error(`Agent "${name}" must have a "label" string`)
    }
    if (!a.color || typeof a.color !== 'string') {
      throw new Error(`Agent "${name}" must have a "color" string`)
    }

    // Validate workspace if specified
    if (hasWorkspace) {
      const wsPath = resolve(a.workspace as string)
      try {
        const s = await stat(wsPath)
        if (!s.isDirectory()) {
          throw new Error(`Agent "${name}" workspace is not a directory: ${wsPath}`)
        }
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
          throw new Error(`Agent "${name}" workspace not found: ${wsPath}`)
        }
        throw err
      }

      // Check for openclaw.json in the workspace
      const clawConfig = join(wsPath, 'openclaw.json')
      try {
        await access(clawConfig)
      } catch {
        throw new Error(`Agent "${name}" workspace missing openclaw.json: ${clawConfig}`)
      }

      // Auto-assign port
      a.port = nextPort++
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

  // Auto-inject system prompts only for url-mode agents
  injectDefaultPrompts(config)

  // For workspace agents, inject teamwork @mention instructions into SOUL.md context
  await injectWorkspaceTeamwork(config)

  return config
}

/**
 * Auto-generate system prompts for url-mode agents that don't have one.
 *
 * The master gets instructions about delegating via @mentions.
 * Non-master agents get instructions about their role and how to
 * collaborate with other agents via @mentions.
 *
 * Workspace agents are skipped — they use SOUL.md instead.
 */
function injectDefaultPrompts(config: SwarmConfig): void {
  const masterAgent = config.agents[config.master]
  const otherAgents = Object.entries(config.agents).filter(([name]) => name !== config.master)

  // Build team roster for prompts
  const teamList = otherAgents
    .map(([name, agent]) => `  - @${name} (${agent.label})`)
    .join('\n')

  // Master prompt: delegate via @mentions (only for url-mode agents)
  if (!masterAgent.systemPrompt && !masterAgent.workspace && otherAgents.length > 0) {
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

  // Non-master prompts: know they're specialists, can @mention others (url-mode only)
  for (const [name, agent] of otherAgents) {
    if (agent.systemPrompt || agent.workspace) continue

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

/**
 * For workspace agents, read SOUL.md and store as systemPrompt for display context.
 * This doesn't modify SOUL.md on disk — the OpenClaw gateway reads it directly.
 */
async function injectWorkspaceTeamwork(config: SwarmConfig): Promise<void> {
  for (const [name, agent] of Object.entries(config.agents)) {
    if (!agent.workspace) continue

    // Read SOUL.md for display context
    const soulPath = join(resolve(agent.workspace), 'workspace', 'SOUL.md')
    try {
      const soul = await readFile(soulPath, 'utf-8')
      // Store first paragraph as display context (don't use as systemPrompt for API)
      const firstPara = soul.split('\n\n')[0]?.trim()
      if (firstPara && !agent.systemPrompt) {
        agent.systemPrompt = firstPara
      }
    } catch {
      // No SOUL.md — that's fine
    }

    // Read gateway token from openclaw.json
    if (!agent.token) {
      try {
        const clawConfigPath = join(resolve(agent.workspace), 'openclaw.json')
        const clawRaw = await readFile(clawConfigPath, 'utf-8')
        const clawJson = JSON.parse(clawRaw)
        const token = clawJson?.gateway?.auth?.token
        if (typeof token === 'string') {
          agent.token = token
        }
      } catch {
        // No token configured — gateway might not require auth
      }
    }
  }
}
