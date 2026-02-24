#!/usr/bin/env node

import { parseArgs } from 'node:util'
import chalk from 'chalk'
import { loadEnvFile } from './env.js'
import { loadConfig } from './config.js'
import { GroupChat } from './groupchat.js'
import { SessionManager } from './session.js'
import type { ChatMessage, GroupChatEvent } from './types.js'

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

  // --- Setup ---
  const groupChat = new GroupChat(config)

  // --- Session management ---
  let session: SessionManager
  if (values.session) {
    try {
      session = SessionManager.restore(values.session)
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error'
      console.error(chalk.red(`Failed to restore session: ${msg}`))
      groupChat.close()
      process.exit(1)
    }
  } else {
    session = new SessionManager(config.master, Object.keys(config.agents))
  }

  // Wire GroupChat events to session persistence
  groupChat.on('event', (event: GroupChatEvent) => {
    if (event.type === 'message_start') {
      session.appendMessage(event.message)
    } else if (event.type === 'message_done') {
      session.updateMessage(event.messageId, { content: event.content, status: 'complete' })
    } else if (event.type === 'message_error') {
      session.updateMessage(event.messageId, { status: 'error' })
    }
  })

  // Connect to master
  try {
    await groupChat.connectMaster()
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error'
    console.error(chalk.red(`Failed to connect to master: ${msg}`))
    console.log()
    console.log(chalk.dim(`  Make sure the OpenClaw gateway is running on port ${config.gateway.port}.`))
    console.log(chalk.dim(`  Start it with: openclaw gateway run`))
    console.log()
    groupChat.close()
    process.exit(1)
  }

  // --- Launch ink TUI ---
  const { render } = await import('ink')
  const React = await import('react')
  const { App } = await import('./tui/App.js')

  const { waitUntilExit } = render(
    React.createElement(App, { groupChat, sessionId: session.id })
  )

  await waitUntilExit()

  // Save session on exit
  try {
    session.setHistories(groupChat.getHistories())
    session.flush()
  } catch { /* best-effort */ }

  groupChat.close()
  process.exitCode = 0
}

main().catch((err) => {
  console.error(chalk.red(err.message ?? err))
  process.exit(1)
})
