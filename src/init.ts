import { createInterface } from 'node:readline/promises'
import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { AgentConfig, SwarmConfig } from './types.js'

const COLORS = ['indigo', 'green', 'amber', 'cyan', 'purple', 'red', 'blue', 'pink']

const DEFAULT_URL = 'https://generativelanguage.googleapis.com/v1beta/openai'
const DEFAULT_MODEL = 'gemini-2.5-flash'

async function ask(rl: ReturnType<typeof createInterface>, question: string, defaultValue?: string): Promise<string> {
  const suffix = defaultValue ? ` (${defaultValue})` : ''
  const answer = await rl.question(`  ${question}${suffix}: `)
  return answer.trim() || defaultValue || ''
}

async function askNumber(rl: ReturnType<typeof createInterface>, question: string, defaultValue: number): Promise<number> {
  const answer = await ask(rl, question, String(defaultValue))
  const num = parseInt(answer, 10)
  return isNaN(num) ? defaultValue : num
}

/**
 * Interactive wizard that scaffolds a swarm.config.json file.
 */
export async function runInitWizard(): Promise<void> {
  const rl = createInterface({ input: process.stdin, output: process.stdout })

  console.log()
  console.log('  OpenSwarm Config Wizard')
  console.log('  ─────────────────────────')
  console.log()

  const agentCount = await askNumber(rl, 'How many agents?', 3)

  if (agentCount < 1) {
    console.log('  Need at least 1 agent.')
    rl.close()
    return
  }

  const agents: Record<string, AgentConfig> = {}
  const names: string[] = []

  for (let i = 0; i < agentCount; i++) {
    console.log()
    console.log(`  --- Agent ${i + 1} of ${agentCount} ---`)

    const name = await ask(rl, 'Internal name (lowercase)', i === 0 ? 'master' : `agent${i}`)
    const label = await ask(rl, 'Display label', name.charAt(0).toUpperCase() + name.slice(1))
    const color = await ask(rl, `Color (${COLORS.join('/')})`, COLORS[i % COLORS.length])
    const url = await ask(rl, 'API URL', DEFAULT_URL)
    const model = await ask(rl, 'Model', DEFAULT_MODEL)
    const systemPrompt = await ask(rl, 'System prompt (optional)')

    const config: AgentConfig = { url, label, color }
    if (model) config.model = model
    if (systemPrompt) config.systemPrompt = systemPrompt

    agents[name] = config
    names.push(name)
  }

  console.log()

  // Pick master
  let master: string
  if (names.length === 1) {
    master = names[0]
    console.log(`  Master agent: ${master}`)
  } else {
    console.log(`  Available agents: ${names.join(', ')}`)
    master = await ask(rl, 'Master agent', names[0])
    if (!names.includes(master)) {
      console.log(`  "${master}" not found, defaulting to "${names[0]}"`)
      master = names[0]
    }
  }

  const config: SwarmConfig = {
    agents,
    master,
    maxMentionDepth: 3,
    sessionPrefix: 'openswarm',
    timeout: 120_000,
  }

  const filePath = resolve(process.cwd(), 'swarm.config.json')
  writeFileSync(filePath, JSON.stringify(config, null, 2) + '\n')

  console.log()
  console.log(`  Config written to: ${filePath}`)
  console.log()
  console.log('  Next steps:')
  console.log('    1. Create a .env file with GOOGLE_API_KEY=your_key')
  console.log('    2. Run: openswarm')
  console.log()

  rl.close()
}
