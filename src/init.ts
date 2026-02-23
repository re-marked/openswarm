import { createInterface } from 'node:readline/promises'
import { writeFileSync, mkdirSync } from 'node:fs'
import { resolve, join } from 'node:path'

const COLORS = ['indigo', 'green', 'amber', 'cyan', 'purple', 'red', 'blue', 'pink']
const DEFAULT_NAMES = ['master', 'researcher', 'coder', 'analyst', 'writer']

const DEFAULT_ROLES: Record<string, string> = {
  master: 'coordinate the team and delegate tasks',
  researcher: 'find information, verify facts, summarize research',
  coder: 'write code, debug issues, review implementations',
  analyst: 'analyze data, identify patterns, draw conclusions',
  writer: 'write documentation, reports, and clear explanations',
}

async function ask(
  rl: ReturnType<typeof createInterface>,
  question: string,
  defaultValue?: string,
): Promise<string> {
  const suffix = defaultValue ? ` (${defaultValue})` : ''
  const answer = await rl.question(`  ${question}${suffix}: `)
  return answer.trim() || defaultValue || ''
}

async function askNumber(
  rl: ReturnType<typeof createInterface>,
  question: string,
  defaultValue: number,
): Promise<number> {
  const answer = await ask(rl, question, String(defaultValue))
  const num = parseInt(answer, 10)
  return isNaN(num) ? defaultValue : num
}

/**
 * Generate openclaw.json for a workspace agent.
 */
function makeOpenClawConfig(port: number): object {
  return {
    agents: {
      list: [{ id: 'main', default: true, workspace: './workspace' }],
      defaults: {
        sandbox: { mode: 'off' },
      },
    },
    tools: {
      profile: 'coding',
      allow: ['exec', 'web_search', 'read', 'write', 'edit'],
      deny: ['browser', 'gateway', 'cron'],
    },
    gateway: {
      mode: 'local',
      port,
      bind: 'lan',
      auth: { mode: 'token' },
      http: {
        endpoints: {
          chatCompletions: { enabled: true },
          responses: { enabled: true },
        },
      },
    },
  }
}

/**
 * Generate SOUL.md content for an agent.
 */
function makeSoulMd(
  name: string,
  label: string,
  role: string,
  isMaster: boolean,
  teammates: Array<{ name: string; label: string; role: string }>,
): string {
  const lines: string[] = []

  if (isMaster) {
    lines.push(
      `You are ${label}, the coordinator of a team of AI agents connected via OpenSwarm.`,
      '',
      `Your role: ${role}`,
      '',
      'When a user sends a message:',
      '1. Understand what they need',
      '2. Delegate tasks to your team using @mentions',
      '3. After receiving their replies, synthesize the results for the user',
      '',
      'Be concise in your delegation — state exactly what you need from each agent.',
      'You can @mention multiple agents in one response for parallel tasks.',
    )
  } else {
    lines.push(
      `You are ${label}, a specialist AI agent in a team connected via OpenSwarm.`,
      '',
      `Your role: ${role}`,
      '',
      'When asked a question:',
      '1. Focus on your area of expertise',
      '2. Answer thoroughly and directly',
      '3. Be concise — bullet points over paragraphs',
      '4. Flag uncertainty — say "I\'m not sure" rather than guessing',
    )
  }

  lines.push(
    '',
    '## Teammates',
    '',
    'Your teammates (use @mentions to collaborate):',
  )

  for (const t of teammates) {
    lines.push(`- @${t.name} (${t.label}) — ${t.role}`)
  }

  lines.push(
    '',
    'Only @mention others when you genuinely need their specific expertise.',
  )

  return lines.join('\n')
}

/**
 * Generate AGENTS.md for a workspace.
 */
function makeAgentsMd(): string {
  return [
    '# Agent Rules',
    '',
    '- Be helpful and concise',
    '- Use @mentions to collaborate with teammates',
    '- Do not hallucinate facts — say "I don\'t know" when uncertain',
    '- When using tools, explain what you\'re doing',
    '- Respect the user\'s time — avoid unnecessary preamble',
  ].join('\n')
}

/**
 * Interactive wizard that scaffolds OpenClaw workspaces + swarm.config.json.
 */
export async function runInitWizard(): Promise<void> {
  const rl = createInterface({ input: process.stdin, output: process.stdout })

  console.log()
  console.log('  OpenSwarm Init')
  console.log('  ──────────────')
  console.log()
  console.log('  Each agent is a full OpenClaw instance with its own personality,')
  console.log('  tools, and model. OpenSwarm connects them into a group chat.')
  console.log()

  // --- Agent count ---
  const agentCount = await askNumber(rl, 'How many agents?', 3)

  if (agentCount < 1) {
    console.log('  Need at least 1 agent.')
    rl.close()
    return
  }

  // Collect agent info
  const agentInfo: Array<{ name: string; label: string; color: string; role: string }> = []

  for (let i = 0; i < agentCount; i++) {
    console.log()
    console.log(`  --- Agent ${i + 1} of ${agentCount} ---`)

    const defaultName = i < DEFAULT_NAMES.length ? DEFAULT_NAMES[i] : `agent${i}`
    const name = await ask(rl, 'Name (lowercase)', defaultName)
    const label = await ask(rl, 'Display label', name.charAt(0).toUpperCase() + name.slice(1))
    const color = await ask(rl, `Color (${COLORS.join('/')})`, COLORS[i % COLORS.length])
    const defaultRole = DEFAULT_ROLES[name] ?? 'help the team'
    const role = await ask(rl, 'One-sentence role', defaultRole)

    agentInfo.push({ name, label, color, role })
  }

  console.log()

  // Pick master
  const names = agentInfo.map((a) => a.name)
  let master: string
  if (names.length === 1) {
    master = names[0]
    console.log(`  Master agent: ${master}`)
  } else {
    console.log(`  Available agents: ${names.join(', ')}`)
    master = await ask(rl, 'Master agent (coordinates the team)', names[0])
    if (!names.includes(master)) {
      console.log(`  "${master}" not found, defaulting to "${names[0]}"`)
      master = names[0]
    }
  }

  rl.close()

  // --- Scaffold directories ---
  const baseDir = process.cwd()
  const basePort = 19001

  const swarmAgents: Record<string, { workspace: string; label: string; color: string }> = {}

  for (let i = 0; i < agentInfo.length; i++) {
    const agent = agentInfo[i]
    const port = basePort + i
    const agentDir = join(baseDir, 'agents', agent.name)
    const workspaceDir = join(agentDir, 'workspace')

    // Create directories
    mkdirSync(workspaceDir, { recursive: true })

    // Write openclaw.json
    const clawConfig = makeOpenClawConfig(port)
    writeFileSync(join(agentDir, 'openclaw.json'), JSON.stringify(clawConfig, null, 2) + '\n')

    // Build teammate list (everyone except this agent)
    const teammates = agentInfo
      .filter((a) => a.name !== agent.name)
      .map((a) => ({ name: a.name, label: a.label, role: a.role }))

    // Write SOUL.md
    const soul = makeSoulMd(agent.name, agent.label, agent.role, agent.name === master, teammates)
    writeFileSync(join(workspaceDir, 'SOUL.md'), soul + '\n')

    // Write AGENTS.md
    writeFileSync(join(workspaceDir, 'AGENTS.md'), makeAgentsMd() + '\n')

    // Add to swarm config
    swarmAgents[agent.name] = {
      workspace: `./agents/${agent.name}`,
      label: agent.label,
      color: agent.color,
    }
  }

  // Write swarm.config.json
  const swarmConfig = {
    agents: swarmAgents,
    master,
  }

  const configPath = join(baseDir, 'swarm.config.json')
  writeFileSync(configPath, JSON.stringify(swarmConfig, null, 2) + '\n')

  // Done
  console.log()
  console.log('  Created:')
  for (const agent of agentInfo) {
    console.log(`    agents/${agent.name}/openclaw.json`)
    console.log(`    agents/${agent.name}/workspace/SOUL.md`)
    console.log(`    agents/${agent.name}/workspace/AGENTS.md`)
  }
  console.log('    swarm.config.json')
  console.log()
  console.log('  Next steps:')
  console.log('    1. Configure each agent\'s model and auth via OpenClaw:')
  console.log('       cd agents/master && openclaw login')
  console.log('       (or edit agents/master/openclaw.json to set model.primary)')
  console.log('    2. Run: openswarm')
  console.log()
}
