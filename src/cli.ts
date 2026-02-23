#!/usr/bin/env node

import { createInterface, type Interface as ReadlineInterface } from 'node:readline'
import { parseArgs } from 'node:util'
import chalk from 'chalk'
import ora from 'ora'
import { loadEnvFile } from './env.js'
import { writeExport } from './export.js'
import { loadConfig } from './config.js'
import { Orchestrator } from './orchestrator.js'
import { Renderer } from './renderer.js'
import { SessionManager } from './session.js'
import { SpawnManager } from './spawn.js'
import type { OrchestratorEvent } from './types.js'

/** Format a relative timestamp like "2m ago", "3h ago", "yesterday". */
function relativeTime(ts: number): string {
  const diff = Date.now() - ts
  const seconds = Math.floor(diff / 1000)
  if (seconds < 60) return 'just now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days === 1) return 'yesterday'
  return `${days}d ago`
}

/** Check if any agents in the config use workspace mode. */
function hasWorkspaceAgents(agents: Record<string, { workspace?: string }>): boolean {
  return Object.values(agents).some((a) => !!a.workspace)
}

/**
 * Graceful shutdown that avoids the Windows UV_HANDLE_CLOSING assertion.
 *
 * Calling process.exit() while libuv is already tearing down handles triggers
 * the assertion. Instead: close readline, destroy stdin (removes the handle
 * keeping the event loop alive), set exitCode, and let Node exit naturally.
 */
async function shutdown(
  code: number,
  orchestrator?: Orchestrator,
  rl?: ReadlineInterface,
  session?: SessionManager,
  spawnManager?: SpawnManager,
): Promise<void> {
  if (session && orchestrator) {
    try {
      session.setHistories(orchestrator.getHistories())
      session.flush()
    } catch { /* best-effort */ }
  }
  orchestrator?.close()

  if (spawnManager) {
    const spinner = ora({ text: 'Stopping agents...', color: 'yellow' }).start()
    await spawnManager.stopAll()
    spinner.stop()
  }

  rl?.close()
  process.stdin.destroy() // removes the stdin handle so the event loop can drain
  process.exitCode = code // set exit code without calling process.exit()
}

async function main() {
  const subcommand = process.argv[2]

  // --- Handle `init` subcommand before anything else ---
  if (subcommand === 'init') {
    const { runInitWizard } = await import('./init.js')
    await runInitWizard()
    return
  }

  // --- Handle `up` subcommand — spawn agents and exit ---
  if (subcommand === 'up') {
    loadEnvFile()
    const configPath = process.argv[3] ?? 'swarm.config.json'
    const config = await loadConfig(configPath)

    if (!hasWorkspaceAgents(config.agents)) {
      console.log(chalk.dim('  No workspace agents to start.'))
      return
    }

    const manager = new SpawnManager()
    console.log()
    const results = await manager.startAll(config.agents, (name, status) => {
      const agent = config.agents[name]
      if (!agent) return
      if (status === 'starting') console.log(chalk.dim(`  Starting ${agent.label}...`))
      else if (status === 'ready') console.log(chalk.green(`  ${agent.label} ready (port ${agent.port})`))
      else console.log(chalk.red(`  ${agent.label} failed to start`))
    })

    const allReady = [...results.values()].every(Boolean)
    if (allReady) {
      console.log(chalk.green('\n  All agents running. Use `openswarm down` to stop.\n'))
    } else {
      console.log(chalk.yellow('\n  Some agents failed to start.\n'))
    }
    return
  }

  // --- Handle `down` subcommand — kill agents from pids.json ---
  if (subcommand === 'down') {
    const stopped = SpawnManager.stopFromPids()
    if (stopped) {
      console.log(chalk.green('  Agents stopped.'))
    } else {
      console.log(chalk.dim('  No running agents found.'))
    }
    return
  }

  // --- Load .env before anything else ---
  loadEnvFile()

  // --- Parse args ---
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      config: { type: 'string', short: 'c', default: 'swarm.config.json' },
      session: { type: 'string', short: 's' },
      verbose: { type: 'boolean', short: 'v', default: false },
    },
    strict: true,
  })

  const configPath = values.config!

  // --- Load config ---
  let config
  try {
    config = await loadConfig(configPath)
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error'
    console.error(chalk.red(`Failed to load config: ${msg}`))
    process.exit(1)
  }

  // --- Inject API key from env for url-mode agents ---
  const envKey =
    process.env.GOOGLE_API_KEY ??
    process.env.OPENAI_API_KEY ??
    process.env.GROQ_API_KEY ??
    process.env.ANTHROPIC_API_KEY ??
    process.env.TOGETHER_API_KEY ??
    process.env.FIREWORKS_API_KEY ??
    process.env.DEEPSEEK_API_KEY ??
    process.env.MISTRAL_API_KEY ??
    process.env.OPENCLAW_GATEWAY_TOKEN
  if (envKey) {
    for (const agent of Object.values(config.agents)) {
      if (!agent.token && !agent.workspace) {
        agent.token = envKey
      }
    }
  }

  // --- Spawn workspace agents ---
  let spawnManager: SpawnManager | undefined

  if (hasWorkspaceAgents(config.agents)) {
    spawnManager = new SpawnManager()
    console.log()

    const statusMap = new Map<string, string>()

    const results = await spawnManager.startAll(config.agents, (name, status) => {
      const agent = config.agents[name]
      if (!agent) return
      if (status === 'starting') {
        statusMap.set(name, 'starting...')
        console.log(chalk.dim(`  Starting ${agent.label}...`))
      } else if (status === 'ready') {
        statusMap.set(name, 'ready')
        console.log(chalk.green(`  ${agent.label} ready (port ${agent.port})`))
      } else {
        statusMap.set(name, 'failed')
        console.log(chalk.red(`  ${agent.label} failed to start`))
      }
    })

    // Check if any failed
    const failed = [...results.entries()].filter(([, ready]) => !ready)
    if (failed.length > 0) {
      console.error(chalk.red(`\n  ${failed.length} agent(s) failed to start. Check OpenClaw config.\n`))
      await spawnManager.stopAll()
      process.exit(1)
    }

    console.log()
  }

  // --- Setup ---
  const renderer = new Renderer(config.agents)
  const orchestrator = new Orchestrator(config)

  // --- Session management ---
  let session: SessionManager
  if (values.session) {
    try {
      session = SessionManager.restore(values.session)
      console.log(chalk.dim(`  Restored session: ${values.session}`))
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error'
      console.error(chalk.red(`Failed to restore session: ${msg}`))
      await shutdown(1, orchestrator, undefined, undefined, spawnManager)
      return
    }
  } else {
    session = new SessionManager(config.master, Object.keys(config.agents))
  }

  // Wire orchestrator events to renderer AND session
  orchestrator.on('event', (event: OrchestratorEvent) => {
    renderer.handle(event)
    session.append(event)
  })

  // Welcome screen
  renderer.printWelcome(Object.keys(config.agents), config.master)

  // Connect to master
  try {
    await orchestrator.connectMaster()
    const masterLabel = config.agents[config.master].label
    console.log(chalk.green(`  Connected to ${masterLabel}`))
    console.log(chalk.dim(`  Session: ${session.id}`))
    console.log()
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error'
    console.error(chalk.red(`Failed to connect to master: ${msg}`))
    await shutdown(1, orchestrator, undefined, undefined, spawnManager)
    return
  }

  // Restore agent histories if resuming a session
  if (values.session) {
    const data = session.getData()
    if (Object.keys(data.histories).length > 0) {
      await orchestrator.restoreHistories(data.histories)
      console.log(chalk.dim('  Restored conversation histories'))
      console.log()
    }
  }

  // --- REPL ---
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: chalk.dim('you > '),
  })

  let busy = false

  rl.prompt()

  rl.on('line', async (line) => {
    const input = line.trim()
    if (!input) {
      rl.prompt()
      return
    }

    // Slash commands
    if (input === '/quit' || input === '/exit') {
      console.log(chalk.dim('\n  Goodbye!'))
      await shutdown(0, orchestrator, rl, session, spawnManager)
      return
    }

    if (input === '/status') {
      renderer.printStatus(orchestrator.getConnectionStatus())
      rl.prompt()
      return
    }

    if (input === '/clear') {
      console.clear()
      rl.prompt()
      return
    }

    if (input === '/sessions') {
      const sessions = SessionManager.list()
      if (sessions.length === 0) {
        console.log(chalk.dim('\n  No saved sessions.\n'))
      } else {
        console.log()
        for (const meta of sessions.slice(0, 20)) {
          const active = meta.id === session.id ? chalk.green(' (current)') : ''
          const preview = meta.preview ? chalk.dim(` — ${meta.preview.slice(0, 60)}`) : ''
          console.log(`  ${chalk.bold(meta.id)}${active}  ${chalk.dim(relativeTime(meta.updatedAt))}${preview}`)
        }
        console.log()
      }
      rl.prompt()
      return
    }

    if (input === '/export') {
      try {
        session.setHistories(orchestrator.getHistories())
        const agentLabels: Record<string, string> = {}
        for (const [name, agent] of Object.entries(config.agents)) {
          agentLabels[name] = agent.label
        }
        const filePath = writeExport(session.getData(), agentLabels)
        console.log(chalk.green(`\n  Exported to: ${filePath}\n`))
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unknown error'
        console.log(chalk.red(`\n  Export failed: ${msg}\n`))
      }
      rl.prompt()
      return
    }

    if (input.startsWith('/')) {
      console.log(chalk.dim('  Unknown command. Available: /quit  /status  /clear  /sessions  /export'))
      rl.prompt()
      return
    }

    if (busy) {
      console.log(chalk.dim('  Still processing... please wait.'))
      return
    }

    // Record user message in session
    session.append({ type: 'user_message', content: input })

    // Send to orchestrator
    busy = true

    try {
      await orchestrator.chat(input)
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error'
      console.log(chalk.red(`\n  Error: ${msg}`))
    }

    // Save histories after each exchange
    session.setHistories(orchestrator.getHistories())

    busy = false
    console.log()
    rl.prompt()
  })

  rl.on('close', () => {
    shutdown(0, orchestrator, undefined, session, spawnManager)
  })

  // Graceful shutdown
  process.on('SIGINT', () => {
    console.log(chalk.dim('\n\n  Shutting down...'))
    shutdown(0, orchestrator, rl, session, spawnManager)
  })
}

main().catch((err) => {
  console.error(chalk.red(err.message ?? err))
  process.exit(1)
})
