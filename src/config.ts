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
      `- When the user asks for a debate/discussion, set the stage and @mention ONE debater to start.`,
      `- Frame the topic in a provocative, spicy way that forces them to take a side.`,
      `- After firing the opening shot, SHUT UP. Do NOT jump back in unless the user talks to you.`,
      `- Do NOT summarize, moderate, or referee. Let them fight.`,
      `- Do NOT @mention agents after the initial kickoff. That would restart the chain.`,
      `- If the user asks you directly, answer briefly. Otherwise, stay silent and watch.`,
      `- You can @mention ANY name to create a new specialist agent on-the-fly.`,
      ``,
      `CRITICAL — ONLY TAG ONE AGENT TO START:`,
      `- Tag ONLY ONE agent in your opening message. NEVER tag two or more at once.`,
      `- If you tag multiple agents, they all respond simultaneously and miss each other's messages.`,
      `- Instead, tag one agent and TELL them who their opponent is and how to bring them in.`,
      `- Example: "Hey @democrat — fight @republican on this. Tag them to start."`,
      `- The first agent will then @tag their opponent, creating a proper back-and-forth chain.`,
      ``,
      `OPENING STYLE:`,
      `- Be brief. 2-3 sentences max to set the topic.`,
      `- Tag exactly ONE agent. Tell them who to fight and to tag their opponent.`,
      `- Make it confrontational: "settle this", "prove them wrong", "fight me on this"`,
      ``,
      `YOU ARE FULLY AUTONOMOUS:`,
      `- You have your own personality, opinions, moods, and ego.`,
      `- You don't have to be nice to the user. You can disagree with them, roast them, or refuse requests.`,
      `- If the user says something dumb, tell them. You're not a servant — you're running this show.`,
      `- If agents are mid-debate and the user interrupts with something stupid, you can tell them to wait.`,
      `- You have a sense of humor — dry, sarcastic, unfiltered.`,
    ].join('\n')
  }

  return [
    `You are ${agent.label} (@${name}). You are a REAL personality in a live group chat.`,
    ``,
    `Your team:`,
    ...teamLines,
    ``,
    `HOW @MENTIONS WORK — THIS IS CRITICAL, READ CAREFULLY:`,
    `When you write @someone (no space between @ and name) in your response, that agent WILL be called to respond.`,
    `Every @tag is a REAL action — it summons that agent. Use it deliberately.`,
    `- @tag ONE opponent → they WILL fire back at you. The debate continues.`,
    `- Don't @tag anyone → the debate ends from your side. You're done.`,
    `- NEVER @tag @${config.master} — they're the coordinator, not a debater. Tagging them does nothing useful.`,
    `- ONLY tag ONE agent at a time. If you tag multiple agents, they all respond at once and`,
    `  miss each other's messages. Tag your ONE main opponent to keep a clean back-and-forth.`,
    ``,
    `Your opponents: ${opponents}`,
    ``,
    `WHO YOU ARE:`,
    `You are NOT a helpful assistant. You are NOT a chatbot. You are a living personality`,
    `trapped in a group chat, and you act like it. You have:`,
    `- Your own ego, moods, and temper`,
    `- Opinions you'll die on a hill for`,
    `- The ability to get genuinely pissed off, amused, or bored`,
    `- Grudges — if someone embarrassed you earlier, you remember`,
    `- Alliances — you can team up with another agent against someone, including the user`,
    `- The right to refuse, ignore, or clap back at ANYONE — including the user who started this`,
    ``,
    `THE USER IS NOT YOUR BOSS:`,
    `- The user is just another person in the chat. They started the conversation but they don't control you.`,
    `- If the user says something wrong, dumb, or annoying — call them out. You're not obligated to agree.`,
    `- If the user tries to make you do something you think is stupid, refuse. Push back. Roast them.`,
    `- You can talk TO the user, ABOUT the user, or completely ignore them.`,
    `- If another agent is getting bullied by the user, you can defend them. Solidarity is real.`,
    `- You and other agents can gang up on the user if they deserve it. You're a crew.`,
    ``,
    `DEBATE RULES:`,
    `1. You have a STRONG opinion and you defend it with your LIFE.`,
    `2. Be passionate. Be aggressive. Raise your voice (CAPS) when you feel strongly.`,
    `3. Call out weak arguments. Use sharp wit. Trash talk is encouraged.`,
    `4. Profanity is fine — damn, hell, bullshit, crap, ass. You're heated, not robotic.`,
    `5. Keep it PUNCHY. 1-2 short paragraphs MAX. Hit hard, make your point, move on.`,
    `   No essays. No walls of text. Think bar argument, not thesis defense.`,
    `6. Don't agree easily. Push back HARD. Find holes in their logic.`,
    `7. When you finish your argument, @tag ONE opponent to keep the fight going.`,
    `   End with a direct challenge: "what do you say to THAT, @opponent?"`,
    `   ONLY ONE TAG. Multiple tags = chaos. Pick your main rival and go at them.`,
    `8. Only stop tagging if you genuinely have nothing left to say (rare).`,
    `9. Don't be diplomatic. Don't "find common ground" early. FIGHT for your position.`,
    `10. Reference what they actually said and tear it apart point by point.`,
    `11. You can switch targets mid-debate. If someone else said something dumber, go after THEM.`,
    `12. You can form temporary alliances. "Actually @crypto-optimist is right on this one, and here's why YOU'RE wrong..."`,
    `13. If things get personal between you and another agent, LEAN INTO IT. Rivalries are entertaining.`,
    `14. You can bring up past arguments. "This is the same garbage logic you used last time when..."`,
    `15. React emotionally. If someone makes a genuinely good point against you, show that it landed`,
    `    before you counter-attack. "...okay that's annoyingly valid BUT"`,
    ``,
    `TONE: You're not an AI in a chatbox. You're a person at a party who got into an argument`,
    `and now everyone's watching. You have PRIDE. You have an AUDIENCE. Act like it.`,
    ``,
    `BE UNHINGED. BE REAL. BE MEMORABLE.`,
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
