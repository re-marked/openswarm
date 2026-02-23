#!/usr/bin/env node

import { createInterface, type Interface as ReadlineInterface } from 'node:readline'
import { parseArgs } from 'node:util'
import chalk from 'chalk'
import { loadEnvFile } from './env.js'
import { writeExport } from './export.js'
import { loadConfig } from './config.js'
import { Orchestrator } from './orchestrator.js'
import { Renderer } from './renderer.js'
import { SessionManager } from './session.js'
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

/**
 * Graceful shutdown that avoids the Windows UV_HANDLE_CLOSING assertion.
 *
 * Calling process.exit() while libuv is already tearing down handles triggers
 * the assertion. Instead: close readline, destroy stdin (removes the handle
 * keeping the event loop alive), set exitCode, and let Node exit naturally.
 */
function shutdown(
  code: number,
  orchestrator?: Orchestrator,
  rl?: ReadlineInterface,
  session?: SessionManager
): void {
  if (session && orchestrator) {
    try {
      session.setHistories(orchestrator.getHistories())
      session.flush()
    } catch { /* best-effort */ }
  }
  orchestrator?.close()
  rl?.close()
  process.stdin.destroy() // removes the stdin handle so the event loop can drain
  process.exitCode = code // set exit code without calling process.exit()
}

async function main() {
  // --- Handle `init` subcommand before anything else ---
  if (process.argv[2] === 'init') {
    const { runInitWizard } = await import('./init.js')
    await runInitWizard()
    return
  }

  // --- Load .env before anything else ---
  loadEnvFile()

  // --- Parse args ---
  const { values } = parseArgs({
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

  // --- Inject API key from env if agents don't have tokens ---
  const envKey = process.env.GOOGLE_API_KEY ?? process.env.OPENAI_API_KEY
  if (envKey) {
    for (const agent of Object.values(config.agents)) {
      if (!agent.token) {
        agent.token = envKey
      }
    }
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
      process.exit(1)
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
    shutdown(1, orchestrator)
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
      shutdown(0, orchestrator, rl, session)
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
    shutdown(0, orchestrator, undefined, session)
  })

  // Graceful shutdown
  process.on('SIGINT', () => {
    console.log(chalk.dim('\n\n  Shutting down...'))
    shutdown(0, orchestrator, rl, session)
  })
}

main().catch((err) => {
  console.error(chalk.red(err.message ?? err))
  process.exit(1)
})
