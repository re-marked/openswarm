import chalk, { type ChalkInstance } from 'chalk'
import ora, { type Ora } from 'ora'
import { renderMarkdown } from './markdown.js'
import type { AgentConfig, OrchestratorEvent } from './types.js'

/** Map color names from config to chalk functions. */
const COLOR_MAP: Record<string, ChalkInstance> = {
  indigo: chalk.rgb(99, 102, 241),
  green: chalk.rgb(34, 197, 94),
  amber: chalk.rgb(245, 158, 11),
  cyan: chalk.rgb(6, 182, 212),
  purple: chalk.rgb(168, 85, 247),
  red: chalk.rgb(239, 68, 68),
  blue: chalk.rgb(59, 130, 246),
  pink: chalk.rgb(236, 72, 153),
}

function getColor(colorName: string): ChalkInstance {
  return COLOR_MAP[colorName] ?? chalk.white
}

/**
 * Renders orchestrator events to the terminal with color and formatting.
 */
export class Renderer {
  private agents: Record<string, AgentConfig>
  private spinner: Ora | null = null
  private streamBuffer = ''
  private streamLineCount = 0

  constructor(agents: Record<string, AgentConfig>) {
    this.agents = agents
  }

  /** Handle an orchestrator event. */
  handle(event: OrchestratorEvent): void {
    switch (event.type) {
      case 'connecting':
        this.stopSpinner()
        this.spinner = ora({
          text: `Connecting to ${this.label(event.agent)}...`,
          color: 'cyan',
        }).start()
        break

      case 'connected':
        this.stopSpinner()
        break

      case 'connect_error':
        this.stopSpinner()
        console.log(chalk.red(`  Connection failed: ${event.agent} — ${event.error}`))
        break

      case 'thinking':
        this.stopSpinner()
        this.spinner = ora({
          text: `${this.label(event.agent)} is thinking...`,
          color: 'yellow',
        }).start()
        break

      case 'delta':
        this.stopSpinner()
        // Stream raw text for live feel, buffer for markdown reprint on done
        this.streamBuffer += event.content
        // Count newlines for clearing
        const newlines = (event.content.match(/\n/g) || []).length
        this.streamLineCount += newlines
        process.stdout.write(event.content)
        break

      case 'done': {
        // Clear the raw streamed text and reprint with markdown formatting
        const raw = this.streamBuffer
        if (raw) {
          // Move cursor up to overwrite raw streamed output
          const lineCount = this.streamLineCount + 1
          process.stdout.write(`\x1b[${lineCount}A\x1b[0J`)
          // Print markdown-formatted version
          console.log(renderMarkdown(raw))
        }
        this.streamBuffer = ''
        this.streamLineCount = 0
        break
      }

      case 'thread_start': {
        this.stopSpinner()
        const fromColor = getColor(this.agents[event.from]?.color ?? 'white')
        const toColor = getColor(this.agents[event.to]?.color ?? 'white')
        const fromLabel = this.label(event.from)
        const toLabel = this.label(event.to)
        console.log()
        console.log(
          toColor('  ┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'),
        )
        console.log(
          toColor('  ┃ ') +
            chalk.bold(`Thread: ${fromLabel} → @${toLabel}`),
        )
        console.log(toColor('  ┃'))
        break
      }

      case 'thread_message': {
        const agentColor = getColor(this.agents[event.agent]?.color ?? 'white')
        const label = this.label(event.agent)
        console.log(agentColor('  ┃ ') + agentColor.bold(label))
        // Print message lines with border
        for (const line of event.content.split('\n')) {
          console.log(agentColor('  ┃ ') + line)
        }
        break
      }

      case 'thread_end': {
        const toColor = getColor(this.agents[event.to]?.color ?? 'white')
        console.log(toColor('  ┃'))
        console.log(
          toColor('  ┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'),
        )
        console.log()
        break
      }

      case 'synthesis_start':
        this.stopSpinner()
        this.spinner = ora({
          text: `${this.label(event.agent)} is synthesizing...`,
          color: 'magenta',
        }).start()
        break

      case 'error':
        this.stopSpinner()
        console.log(chalk.red(`\n  Error (${event.agent}): ${event.error}`))
        break

      case 'end':
        this.stopSpinner()
        break
    }
  }

  /** Print the agent header bar before a response. */
  printAgentHeader(agentName: string): void {
    const agent = this.agents[agentName]
    if (!agent) return
    const color = getColor(agent.color)
    const label = agent.label
    const bar = '━'.repeat(Math.max(0, 50 - label.length))
    console.log()
    console.log(color.bold(`${label} ${bar}`))
    console.log()
  }

  /** Print the welcome screen. */
  printWelcome(agentNames: string[], masterName: string): void {
    const logo = `
  ███████╗██╗    ██╗ █████╗ ██████╗ ███╗   ███╗
  ██╔════╝██║    ██║██╔══██╗██╔══██╗████╗ ████║
  ███████╗██║ █╗ ██║███████║██████╔╝██╔████╔██║
  ╚════██║██║███╗██║██╔══██║██╔══██╗██║╚██╔╝██║
  ███████║╚███╔███╔╝██║  ██║██║  ██║██║ ╚═╝ ██║
  ╚══════╝ ╚══╝╚══╝ ╚═╝  ╚═╝╚═╝  ╚═╝╚═╝     ╚═╝`

    console.log(chalk.bold(logo))
    console.log(chalk.dim('  Multi-Agent @mention Orchestrator'))
    console.log()

    for (const name of agentNames) {
      const agent = this.agents[name]
      if (!agent) continue
      const color = getColor(agent.color)
      const role = name === masterName ? ' (master)' : ''
      const dot = color('●')
      const model = agent.model ? chalk.dim(` [${agent.model}]`) : ''
      console.log(`  ${dot} ${color.bold(agent.label)}${chalk.dim(role)}${model}`)
    }

    console.log()
    console.log(chalk.dim('  Commands: /quit  /status  /clear'))
    console.log(chalk.dim('  Type a message to start...'))
    console.log()
  }

  /** Print connection status table. */
  printStatus(connections: Map<string, boolean>): void {
    console.log()
    for (const [name, connected] of connections) {
      const agent = this.agents[name]
      if (!agent) continue
      const color = getColor(agent.color)
      const status = connected
        ? chalk.green('connected')
        : chalk.dim('not connected')
      console.log(`  ${color('●')} ${color.bold(agent.label)} — ${status}`)
    }
    console.log()
  }

  private label(agentName: string): string {
    return this.agents[agentName]?.label ?? agentName
  }

  private stopSpinner(): void {
    if (this.spinner) {
      this.spinner.stop()
      this.spinner = null
    }
  }
}
