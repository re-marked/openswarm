#!/usr/bin/env node

import { createInterface } from 'node:readline/promises'
import { createReadStream } from 'node:fs'
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
function flushAndClose(
  code: number,
  orchestrator?: Orchestrator,
  session?: SessionManager,
): void {
  if (session && orchestrator) {
    try {
      session.setHistories(orchestrator.getHistories())
      session.flush()
    } catch { /* best-effort */ }
  }
  orchestrator?.close()
  process.exitCode = code
}

async function main() {
  const subcommand = process.argv[2]

  // --- Handle `init` subcommand before anything else ---
  if (subcommand === 'init') {
    const { runInitWizard } = await import('./init.js')
    await runInitWizard()
    return
  }

  // --- Deprecated subcommands ---
  if (subcommand === 'up' || subcommand === 'down') {
    console.log(chalk.yellow(`  \`openswarm ${subcommand}\` is deprecated.`))
    console.log(chalk.dim('  OpenSwarm no longer manages OpenClaw processes.'))
    console.log(chalk.dim('  Start your own OpenClaw gateways, then run: openswarm'))
    console.log()
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

  // --- Inject API key from env for agents that don't have a token yet ---
  const envKey =
    process.env.OPENCLAW_GATEWAY_TOKEN ??
    process.env.GOOGLE_API_KEY ??
    process.env.OPENAI_API_KEY ??
    process.env.GROQ_API_KEY ??
    process.env.ANTHROPIC_API_KEY ??
    process.env.TOGETHER_API_KEY ??
    process.env.FIREWORKS_API_KEY ??
    process.env.DEEPSEEK_API_KEY ??
    process.env.MISTRAL_API_KEY
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
      flushAndClose(1, orchestrator)
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

  // Connect to master — if it fails, print a helpful hint and exit gracefully
  try {
    await orchestrator.connectMaster()
    const masterLabel = config.agents[config.master].label
    console.log(chalk.green(`  Connected to ${masterLabel}`))
    console.log(chalk.dim(`  Session: ${session.id}`))
    console.log()
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error'
    console.error(chalk.red(`Failed to connect to master: ${msg}`))
    console.log()
    const masterAgent = config.agents[config.master]
    const port = masterAgent?.port
    if (port) {
      console.log(chalk.dim(`  Make sure the OpenClaw gateway is running on port ${port}.`))
      console.log(chalk.dim(`  Start it with: openclaw gateway run`))
    }
    console.log()
    flushAndClose(1, orchestrator, session)
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

  // --- REPL (explicit async loop — more reliable than event-emitter readline in MSYS) ---
  //
  // In MSYS/Git Bash, process.stdin.isTTY is false because Node.js sees a Windows
  // pipe rather than a real TTY. Readline treats a non-TTY stream as finite and
  // closes after one line. Opening /dev/tty directly bypasses this — MSYS maps
  // /dev/tty to the actual console and it stays open for the lifetime of the session.
  let inputStream: NodeJS.ReadableStream = process.stdin
  if (!process.stdin.isTTY) {
    try {
      inputStream = createReadStream('/dev/tty')
    } catch {
      // /dev/tty unavailable — fall back to stdin (may exit after one line on MSYS)
    }
  }

  const rl = createInterface({ input: inputStream, output: process.stdout })

  let exiting = false

  process.on('SIGINT', () => {
    console.log(chalk.dim('\n\n  Shutting down...'))
    exiting = true
    rl.close()
  })

  while (!exiting) {
    let input: string
    try {
      input = (await rl.question(chalk.dim('you > '))).trim()
    } catch {
      // readline closed (Ctrl+D / SIGINT)
      break
    }

    if (!input) continue

    // Slash commands
    if (input === '/quit' || input === '/exit') {
      console.log(chalk.dim('\n  Goodbye!'))
      break
    }

    if (input === '/status') {
      renderer.printStatus(orchestrator.getConnectionStatus())
      continue
    }

    if (input === '/clear') {
      console.clear()
      continue
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
      continue
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
      continue
    }

    if (input.startsWith('/')) {
      console.log(chalk.dim('  Unknown command. Available: /quit  /status  /clear  /sessions  /export'))
      continue
    }

    // Record user message in session
    session.append({ type: 'user_message', content: input })

    try {
      await orchestrator.chat(input)
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error'
      console.log(chalk.red(`\n  Error: ${msg}`))
    }

    session.setHistories(orchestrator.getHistories())
    console.log()
  }

  rl.close()
  flushAndClose(0, orchestrator, session)
  process.stdin.destroy()
}

main().catch((err) => {
  console.error(chalk.red(err.message ?? err))
  process.exit(1)
})
