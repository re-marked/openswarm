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

/** Map color names to ora spinner colors. */
const ORA_COLOR_MAP: Record<string, string> = {
  indigo: 'magenta',
  green: 'green',
  amber: 'yellow',
  cyan: 'cyan',
  purple: 'magenta',
  red: 'red',
  blue: 'blue',
  pink: 'magenta',
}

function getColor(colorName: string): ChalkInstance {
  return COLOR_MAP[colorName] ?? chalk.white
}

function getOraColor(colorName: string): string {
  return ORA_COLOR_MAP[colorName] ?? 'white'
}

/**
 * Flat group-chat style renderer.
 *
 * Each agent message gets a colored name header (like Discord),
 * all at the same level — no threading or nesting.
 */
export class Renderer {
  private agents: Record<string, AgentConfig>
  private spinner: Ora | null = null
  private streamBuffer = ''
  private streamLineCount = 0
  private currentAgent = ''
  private needsPrefix = false

  constructor(agents: Record<string, AgentConfig>) {
    this.agents = agents
  }

  /** Handle an orchestrator event. */
  handle(event: OrchestratorEvent): void {
    switch (event.type) {
      case 'connecting': {
        this.stopSpinner()
        const agentColor = this.agents[event.agent]?.color ?? 'cyan'
        this.spinner = ora({
          text: `Connecting to ${this.label(event.agent)}...`,
          color: getOraColor(agentColor) as any,
        }).start()
        break
      }

      case 'connected':
        this.stopSpinner()
        break

      case 'connect_error':
        this.stopSpinner()
        console.log(chalk.red(`  Connection failed: ${event.agent} — ${event.error}`))
        break

      case 'thinking': {
        this.stopSpinner()
        this.currentAgent = event.agent
        this.needsPrefix = true
        const agent = this.agents[event.agent]
        if (!agent) break
        const color = getColor(agent.color)
        console.log() // blank line before agent message
        this.spinner = ora({
          text: `${color('●')} ${color.bold(agent.label)}: thinking...`,
          color: getOraColor(agent.color) as any,
        }).start()
        break
      }

      case 'delta':
        this.stopSpinner()
        if (this.needsPrefix) {
          const agent = this.agents[this.currentAgent]
          if (agent) {
            const color = getColor(agent.color)
            process.stdout.write(`${color('●')} ${color.bold(agent.label)}: `)
          }
          this.needsPrefix = false
        }
        this.streamBuffer += event.content
        const newlines = (event.content.match(/\n/g) || []).length
        this.streamLineCount += newlines
        process.stdout.write(event.content)
        break

      case 'done': {
        const raw = this.streamBuffer
        if (raw) {
          // Move cursor back to the start of the prefix line
          if (this.streamLineCount > 0) {
            process.stdout.write(`\x1b[${this.streamLineCount}A`)
          }
          process.stdout.write(`\r\x1b[0J`)

          // Reprint with agent prefix + markdown
          const agent = this.agents[this.currentAgent]
          if (agent) {
            const color = getColor(agent.color)
            process.stdout.write(`${color('●')} ${color.bold(agent.label)}: `)
          }
          console.log(renderMarkdown(raw))
        }
        this.streamBuffer = ''
        this.streamLineCount = 0
        this.currentAgent = ''
        this.needsPrefix = false
        break
      }

      case 'thread_start':
      case 'thread_message':
      case 'thread_end':
        break

      case 'synthesis_start': {
        this.stopSpinner()
        this.currentAgent = event.agent
        this.needsPrefix = true
        const agent = this.agents[event.agent]
        if (!agent) break
        const color = getColor(agent.color)
        console.log() // blank line before agent message
        this.spinner = ora({
          text: `${color('●')} ${color.bold(agent.label)}: synthesizing...`,
          color: getOraColor(agent.color) as any,
        }).start()
        break
      }

      case 'error':
        this.stopSpinner()
        console.log(chalk.red(`  Error (${event.agent}): ${event.error}`))
        break

      case 'end':
        this.stopSpinner()
        break
    }
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
