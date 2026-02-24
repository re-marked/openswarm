import { createInterface } from 'node:readline/promises'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { discoverOpenClaw, probePort } from './discover.js'

const COLORS = ['indigo', 'green', 'amber', 'cyan', 'purple', 'red', 'blue', 'pink']

async function ask(
  rl: ReturnType<typeof createInterface>,
  question: string,
  defaultValue?: string,
): Promise<string> {
  const suffix = defaultValue ? ` (${defaultValue})` : ''
  const answer = await rl.question(`  ${question}${suffix}: `)
  return answer.trim() || defaultValue || ''
}

/** Present a numbered selection menu; returns the selected item. */
async function select<T>(
  rl: ReturnType<typeof createInterface>,
  prompt: string,
  items: T[],
  renderItem: (item: T, index: number) => string,
  defaultIndex = 0,
): Promise<T> {
  console.log(`  ${prompt}`)
  for (let i = 0; i < items.length; i++) {
    const marker = i === defaultIndex ? '>' : ' '
    console.log(`  ${marker} [${i + 1}] ${renderItem(items[i], i)}`)
  }
  const answer = await ask(rl, 'Select', String(defaultIndex + 1))
  const idx = parseInt(answer, 10) - 1
  return items[Math.max(0, Math.min(items.length - 1, isNaN(idx) ? defaultIndex : idx))]
}

/**
 * Discovery-based init wizard.
 *
 * Reads OpenClaw config, discovers agents, lets user assign names/colors,
 * and writes swarm.config.json with single-gateway format.
 */
export async function runInitWizard(): Promise<void> {
  const rl = createInterface({ input: process.stdin, output: process.stdout })

  console.log()
  console.log('  OpenSwarm Init')
  console.log('  ──────────────')
  console.log()
  console.log('  Reading OpenClaw configuration...')
  console.log()

  const discovery = await discoverOpenClaw()

  if (!discovery) {
    console.log('  Could not read ~/.openclaw/openclaw.json')
    console.log()
    console.log('  Make sure OpenClaw is installed and configured.')
    console.log('  Then re-run: openswarm init')
    console.log()
    rl.close()
    return
  }

  // Health check the gateway
  const alive = await probePort(discovery.port, discovery.token)

  if (!alive) {
    console.log(`  Gateway on port ${discovery.port} is not responding.`)
    console.log()
    console.log('  Start it with:')
    console.log('    openclaw gateway run')
    console.log()
    console.log('  Then re-run: openswarm init')
    console.log()
    rl.close()
    return
  }

  console.log(`  Gateway: port ${discovery.port} (alive)`)
  if (discovery.model) {
    console.log(`  Default model: ${discovery.model}`)
  }
  console.log()

  // Show discovered agents
  if (discovery.agents.length > 0) {
    console.log(`  Discovered ${discovery.agents.length} agent${discovery.agents.length > 1 ? 's' : ''}:`)
    for (const agent of discovery.agents) {
      const modelStr = agent.model ? ` — ${agent.model}` : ''
      const subsStr = agent.subagents?.length ? ` (subagents: ${agent.subagents.join(', ')})` : ''
      console.log(`    ${agent.id} (${agent.name})${modelStr}${subsStr}`)
    }
    console.log()
  }

  // Let user select which agents to include
  const answer = await ask(rl, 'How many agents to configure?', String(discovery.agents.length))
  const agentCount = Math.max(1, Math.min(parseInt(answer, 10) || discovery.agents.length, 20))

  const agentEntries: Array<{ name: string; agentId: string; label: string; color: string; model?: string }> = []

  for (let i = 0; i < agentCount; i++) {
    console.log()
    console.log(`  --- Agent ${i + 1} of ${agentCount} ---`)

    // If we have discovered agents, let them pick
    let agentId: string
    let defaultName: string
    let defaultModel: string | undefined

    if (i < discovery.agents.length) {
      const disc = discovery.agents[i]
      agentId = disc.id
      defaultName = disc.id
      defaultModel = disc.model
      console.log(`  OpenClaw agent ID: ${disc.id}`)
    } else {
      agentId = await ask(rl, 'OpenClaw agent ID', `agent${i}`)
      defaultName = agentId
      defaultModel = discovery.model
    }

    const name = await ask(rl, 'Swarm name (lowercase, no spaces)', defaultName)
    const label = await ask(rl, 'Display label', name.charAt(0).toUpperCase() + name.slice(1))
    const color = await ask(rl, `Color (${COLORS.join('/')})`, COLORS[i % COLORS.length])

    agentEntries.push({ name, agentId, label, color, model: defaultModel })
  }

  if (agentEntries.length === 0) {
    console.log('  No agents configured.')
    rl.close()
    return
  }

  console.log()

  // Pick master
  const names = agentEntries.map((a) => a.name)
  let master: string

  if (names.length === 1) {
    master = names[0]
    console.log(`  Master agent: ${master}`)
  } else {
    master = await select(
      rl,
      'Which agent is the coordinator (master)?',
      agentEntries,
      (a) => `${a.name} (${a.label}) — agentId: ${a.agentId}`,
      0,
    ).then((a) => a.name)
  }

  rl.close()

  // Build swarm.config.json
  const swarmAgents: Record<string, {
    agentId: string
    label: string
    color: string
    model?: string
  }> = {}

  for (const entry of agentEntries) {
    swarmAgents[entry.name] = {
      agentId: entry.agentId,
      label: entry.label,
      color: entry.color,
      ...(entry.model ? { model: entry.model } : {}),
    }
  }

  const swarmConfig = {
    gateway: {
      port: discovery.port,
      token: 'auto',
    },
    agents: swarmAgents,
    master,
  }

  const configPath = join(process.cwd(), 'swarm.config.json')
  writeFileSync(configPath, JSON.stringify(swarmConfig, null, 2) + '\n')

  console.log()
  console.log('  Created: swarm.config.json')
  console.log()
  console.log('  Gateway:')
  console.log(`    port ${discovery.port}`)
  console.log()
  console.log('  Agents:')
  for (const entry of agentEntries) {
    const role = entry.name === master ? 'coordinator' : 'specialist'
    const modelStr = entry.model ? ` · ${entry.model}` : ''
    console.log(`    ${entry.name} (${entry.label}) — agentId: ${entry.agentId}${modelStr} — ${role}`)
  }
  console.log()
  console.log('  Run your swarm:')
  console.log('    openswarm')
  console.log()
}
