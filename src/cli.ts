#!/usr/bin/env node

import { createInterface } from 'node:readline'
import { parseArgs } from 'node:util'
import chalk from 'chalk'
import { loadConfig } from './config.js'
import { Orchestrator } from './orchestrator.js'
import { Renderer } from './renderer.js'
import type { OrchestratorEvent } from './types.js'

async function main() {
  // --- Parse args ---
  const { values } = parseArgs({
    options: {
      config: { type: 'string', short: 'c', default: 'swarm.config.json' },
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

  // Wire orchestrator events to renderer
  orchestrator.on('event', (event: OrchestratorEvent) => {
    renderer.handle(event)
  })

  // Welcome screen
  renderer.printWelcome(Object.keys(config.agents), config.master)

  // Connect to master
  try {
    await orchestrator.connectMaster()
    const masterLabel = config.agents[config.master].label
    console.log(chalk.green(`  Connected to ${masterLabel}`))
    console.log()
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error'
    console.error(chalk.red(`Failed to connect to master: ${msg}`))
    process.exit(1)
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
      orchestrator.close()
      rl.close()
      process.exit(0)
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

    if (input.startsWith('/')) {
      console.log(chalk.dim('  Unknown command. Available: /quit  /status  /clear'))
      rl.prompt()
      return
    }

    if (busy) {
      console.log(chalk.dim('  Still processing... please wait.'))
      return
    }

    // Send to orchestrator
    busy = true
    renderer.printAgentHeader(config.master)

    try {
      await orchestrator.chat(input)
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error'
      console.log(chalk.red(`\n  Error: ${msg}`))
    }

    busy = false
    console.log()
    rl.prompt()
  })

  rl.on('close', () => {
    orchestrator.close()
    process.exit(0)
  })

  // Graceful shutdown
  process.on('SIGINT', () => {
    console.log(chalk.dim('\n\n  Shutting down...'))
    orchestrator.close()
    rl.close()
    process.exit(0)
  })
}

main().catch((err) => {
  console.error(chalk.red(err.message ?? err))
  process.exit(1)
})
