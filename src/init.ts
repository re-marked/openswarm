import { createInterface } from 'node:readline/promises'
import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { AgentConfig, SwarmConfig } from './types.js'

const COLORS = ['indigo', 'green', 'amber', 'cyan', 'purple', 'red', 'blue', 'pink']

const PROVIDERS: Record<string, { url: string; model: string; envVar: string }> = {
  gemini:   { url: 'https://generativelanguage.googleapis.com/v1beta/openai', model: 'gemini-2.5-flash', envVar: 'GOOGLE_API_KEY' },
  openai:   { url: 'https://api.openai.com/v1', model: 'gpt-4o', envVar: 'OPENAI_API_KEY' },
  ollama:   { url: 'http://localhost:11434/v1', model: 'llama3', envVar: '' },
  groq:     { url: 'https://api.groq.com/openai/v1', model: 'llama-3.3-70b-versatile', envVar: 'GROQ_API_KEY' },
  openclaw: { url: 'http://localhost:18789/v1', model: '', envVar: 'OPENCLAW_GATEWAY_TOKEN' },
  custom:   { url: '', model: '', envVar: '' },
}

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

  // --- Pick provider ---
  const providerNames = Object.keys(PROVIDERS)
  console.log('  Providers:')
  for (let i = 0; i < providerNames.length; i++) {
    const name = providerNames[i]
    const p = PROVIDERS[name]
    const detail = p.url ? p.url : 'enter your own URL'
    console.log(`    ${i + 1}. ${name}${name === 'gemini' ? ' (free)' : ''}  —  ${detail}`)
  }
  console.log()

  const providerChoice = await ask(rl, 'Provider', 'gemini')
  const provider = PROVIDERS[providerChoice] ?? PROVIDERS['gemini']
  const providerKey = providerChoice in PROVIDERS ? providerChoice : 'gemini'

  // For custom provider, ask URL and model
  let defaultUrl = provider.url
  let defaultModel = provider.model

  if (providerKey === 'custom') {
    defaultUrl = await ask(rl, 'API base URL (e.g. https://your-api.com/v1)')
    defaultModel = await ask(rl, 'Model name')
  }

  console.log()

  // --- Agent count ---
  const agentCount = await askNumber(rl, 'How many agents?', 3)

  if (agentCount < 1) {
    console.log('  Need at least 1 agent.')
    rl.close()
    return
  }

  const agents: Record<string, AgentConfig> = {}
  const names: string[] = []

  const defaultNames = ['master', 'researcher', 'coder', 'analyst', 'writer']

  for (let i = 0; i < agentCount; i++) {
    console.log()
    console.log(`  --- Agent ${i + 1} of ${agentCount} ---`)

    const defaultName = i < defaultNames.length ? defaultNames[i] : `agent${i}`
    const name = await ask(rl, 'Internal name (lowercase)', defaultName)
    const label = await ask(rl, 'Display label', name.charAt(0).toUpperCase() + name.slice(1))
    const color = await ask(rl, `Color (${COLORS.join('/')})`, COLORS[i % COLORS.length])
    const url = await ask(rl, 'API URL', defaultUrl)
    const model = await ask(rl, 'Model', defaultModel)
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
  if (provider.envVar) {
    console.log(`    1. Create a .env file with ${provider.envVar}=your_key`)
    console.log('    2. Run: openswarm')
  } else {
    console.log('    1. Run: openswarm')
  }
  console.log()

  rl.close()
}
