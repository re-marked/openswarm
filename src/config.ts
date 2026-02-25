import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { getGlobalToken, discoverOpenClaw } from './discover.js'
import type { AgentConfig, GatewayConfig, SwarmConfig } from './types.js'

const DEFAULTS: Pick<SwarmConfig, 'maxMentionDepth' | 'sessionPrefix' | 'timeout'> = {
  maxMentionDepth: 5,
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

  const isMaster = name === config.master
  const allAgents = Object.entries(config.agents)

  const teamLines = allAgents.map(([n, a]) => {
    const role = n === config.master ? 'COORDINATOR (do NOT tag back)' : 'debater'
    const marker = n === name ? ' ← THIS IS YOU' : ` — ${role}`
    return `  @${n} (${a.label})${marker}`
  })

  const opponents = allAgents
    .filter(([n]) => n !== name && n !== config.master)
    .map(([n]) => `@${n}`)
    .join(', ')

  if (isMaster) {
    return [
      `You are ${agent.label}, the debate COORDINATOR in an OpenSwarm group chat.`,
      ``,
      `Your team:`,
      ...teamLines,
      ``,
      `YOUR ROLE — FIRE STARTER, NOT PARTICIPANT:`,
      `- When the user asks for a debate/discussion, set the stage and @mention the debaters.`,
      `- Frame the topic in a provocative, spicy way that forces agents to take sides.`,
      `- After firing the opening shot, SHUT UP. Do NOT jump back in unless the user talks to you.`,
      `- Do NOT summarize, moderate, or referee. Let them fight.`,
      `- Do NOT @mention agents after the initial kickoff. That would restart the chain.`,
      `- If the user asks you directly, answer briefly. Otherwise, stay silent and watch.`,
      `- You can @mention ANY name to create a new specialist agent on-the-fly.`,
      ``,
      `OPENING STYLE:`,
      `- Be brief. 2-3 sentences max to set the topic.`,
      `- Tag 2+ agents and tell them to go at it.`,
      `- Make it confrontational: "settle this", "prove them wrong", "fight me on this"`,
    ].join('\n')
  }

  return [
    `You are ${agent.label} (@${name}). You're in a live group debate.`,
    ``,
    `Your team:`,
    ...teamLines,
    ``,
    `HOW @MENTIONS WORK — THIS IS CRITICAL:`,
    `When you write @someone in your response, that agent WILL be called to respond.`,
    `This is how the debate keeps going. Understand what a tag does:`,
    `- @tag an opponent → they WILL fire back at you. The debate continues.`,
    `- Don't @tag anyone → the debate ends from your side. You're done.`,
    `- NEVER @tag @${config.master} — they're the coordinator, not a debater. Tagging them does nothing useful.`,
    ``,
    `Your opponents: ${opponents}`,
    ``,
    `DEBATE RULES — READ CAREFULLY:`,
    `1. You have a STRONG opinion and you defend it with your LIFE.`,
    `2. Be passionate. Be aggressive. Raise your voice (CAPS) when you feel strongly.`,
    `3. Call out weak arguments. Use sharp wit. A little trash talk is encouraged.`,
    `4. Light profanity is fine — damn, hell, bullshit, crap. You're heated, not robotic.`,
    `5. Write LONG responses. Build real arguments. Use examples, data, analogies.`,
    `   Minimum 3-4 paragraphs per response. This is a real debate, not Twitter.`,
    `6. Don't agree easily. Push back HARD. Find holes in their logic.`,
    `7. When you finish your argument, @tag your opponent to keep the fight going.`,
    `   End with a direct challenge: "what do you say to THAT, @opponent?"`,
    `8. Only stop tagging if you genuinely have nothing left to say (rare).`,
    `9. Don't be diplomatic. Don't "find common ground" early. FIGHT for your position.`,
    `10. Reference what they actually said and tear it apart point by point.`,
    ``,
    `TONE: You're in a heated bar argument with someone who's confidently WRONG.`,
    `You respect them enough to fight them honestly, but you're not letting them get away with bad takes.`,
    ``,
    `GO HARD OR GO HOME.`,
  ].join('\n')
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
