import { createInterface } from 'node:readline/promises'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { discoverGateways, type GatewayInfo } from './discover.js'

const COLORS = ['indigo', 'green', 'amber', 'cyan', 'purple', 'red', 'blue', 'pink']
const DEFAULT_NAMES = ['master', 'researcher', 'coder', 'analyst', 'writer']

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
    const marker = i === defaultIndex ? '❯' : ' '
    console.log(`  ${marker} [${i + 1}] ${renderItem(items[i], i)}`)
  }
  const answer = await ask(rl, 'Select', String(defaultIndex + 1))
  const idx = parseInt(answer, 10) - 1
  return items[Math.max(0, Math.min(items.length - 1, isNaN(idx) ? defaultIndex : idx))]
}

/**
 * Discovery-based init wizard.
 *
 * Finds running OpenClaw gateways, lets the user assign each a role,
 * and writes swarm.config.json. No scaffolding of workspaces or
 * openclaw.json files — users manage their own OpenClaw instances.
 */
export async function runInitWizard(): Promise<void> {
  const rl = createInterface({ input: process.stdin, output: process.stdout })

  console.log()
  console.log('  OpenSwarm Init')
  console.log('  ──────────────')
  console.log()
  console.log('  Discovering running OpenClaw gateways...')
  console.log()

  const gateways = await discoverGateways()
  const alive = gateways.filter((g) => g.alive)

  if (alive.length === 0) {
    console.log('  No running OpenClaw gateways found.')
    console.log()
    console.log('  Start one with:')
    console.log('    openclaw gateway run')
    console.log()
    console.log('  Then re-run: openswarm init')
    console.log()
    rl.close()
    return
  }

  console.log(`  Found ${alive.length} running gateway${alive.length > 1 ? 's' : ''}:`)
  for (const g of alive) {
    const modelStr = g.model ? ` — ${g.model}` : ''
    console.log(`    port ${g.port}${modelStr}`)
  }
  console.log()

  // Ask how many agents to configure
  const answer = await ask(rl, `How many agents to configure?`, String(alive.length))
  const agentCount = Math.min(parseInt(answer, 10) || alive.length, alive.length)

  if (agentCount < 1) {
    console.log('  Need at least 1 agent.')
    rl.close()
    return
  }

  // Collect agent configurations
  const agentEntries: Array<{ name: string; label: string; color: string; gateway: GatewayInfo }> = []
  const usedPorts = new Set<number>()

  for (let i = 0; i < agentCount; i++) {
    console.log()
    console.log(`  --- Agent ${i + 1} of ${agentCount} ---`)

    // Pick a gateway
    const availableGateways = alive.filter((g) => !usedPorts.has(g.port))
    if (availableGateways.length === 0) {
      console.log('  No more gateways available.')
      break
    }

    const renderGateway = (g: GatewayInfo) => {
      const modelStr = g.model ? ` — ${g.model}` : ''
      return `port ${g.port}${modelStr}`
    }

    const gateway = await select(
      rl,
      'Which gateway?',
      availableGateways,
      renderGateway,
      0,
    )
    usedPorts.add(gateway.port)

    const defaultName = i < DEFAULT_NAMES.length ? DEFAULT_NAMES[i] : `agent${i}`
    const name = await ask(rl, 'Agent name (lowercase, no spaces)', defaultName)
    const label = await ask(rl, 'Display label', name.charAt(0).toUpperCase() + name.slice(1))
    const color = await ask(rl, `Color (${COLORS.join('/')})`, COLORS[i % COLORS.length])

    agentEntries.push({ name, label, color, gateway })
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
      (a) => `${a.name} (${a.label}) — port ${a.gateway.port}`,
      0,
    ).then((a) => a.name)
  }

  rl.close()

  // Build swarm.config.json
  const swarmAgents: Record<string, {
    port: number
    label: string
    color: string
    model?: string
  }> = {}

  for (const entry of agentEntries) {
    swarmAgents[entry.name] = {
      port: entry.gateway.port,
      label: entry.label,
      color: entry.color,
      ...(entry.gateway.model ? { model: entry.gateway.model } : {}),
    }
  }

  const swarmConfig = { agents: swarmAgents, master }

  const configPath = join(process.cwd(), 'swarm.config.json')
  writeFileSync(configPath, JSON.stringify(swarmConfig, null, 2) + '\n')

  console.log()
  console.log('  Created: swarm.config.json')
  console.log()
  console.log('  Agents:')
  for (const entry of agentEntries) {
    const role = entry.name === master ? 'coordinator' : 'specialist'
    const modelStr = entry.gateway.model ? ` · ${entry.gateway.model}` : ''
    console.log(`    ${entry.name} (${entry.label}) — port ${entry.gateway.port}${modelStr} — ${role}`)
  }
  console.log()
  console.log('  Run your swarm:')
  console.log('    openswarm')
  console.log()
}
