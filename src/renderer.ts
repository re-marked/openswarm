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
        // Print agent name header before the spinner
        this.printChatHeader(event.agent)
        this.currentAgent = event.agent
        const agentColor = this.agents[event.agent]?.color ?? 'yellow'
        this.spinner = ora({
          text: 'thinking...',
          color: getOraColor(agentColor) as any,
          indent: 2,
        }).start()
        break
      }

      case 'delta':
        this.stopSpinner()
        this.streamBuffer += event.content
        const newlines = (event.content.match(/\n/g) || []).length
        this.streamLineCount += newlines
        process.stdout.write(event.content)
        break

      case 'done': {
        // Clear raw streamed text, reprint with markdown
        const raw = this.streamBuffer
        if (raw) {
          const lineCount = this.streamLineCount + 1
          process.stdout.write(`\x1b[${lineCount}A\x1b[0J`)
          console.log(renderMarkdown(raw))
        }
        this.streamBuffer = ''
        this.streamLineCount = 0
        this.currentAgent = ''
        break
      }

      case 'thread_start':
        // Flat style — no thread decoration, just let the sub-agent
        // print its own chat header via the 'thinking' event
        break

      case 'thread_message':
        // Not used in streaming mode — deltas handle this
        break

      case 'thread_end':
        // No decoration needed in flat style
        break

      case 'synthesis_start': {
        this.stopSpinner()
        this.printChatHeader(event.agent)
        this.currentAgent = event.agent
        const agentColor = this.agents[event.agent]?.color ?? 'magenta'
        this.spinner = ora({
          text: 'synthesizing...',
          color: getOraColor(agentColor) as any,
          indent: 2,
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

  /** Print a chat-style agent name header: ● Agent Name */
  private printChatHeader(agentName: string): void {
    const agent = this.agents[agentName]
    if (!agent) return
    const color = getColor(agent.color)
    console.log()
    console.log(`  ${color('●')} ${color.bold(agent.label)}`)
  }

  /** Print the agent header bar before the first master response. */
  printAgentHeader(_agentName: string): void {
    // No-op — headers are now printed per-message via 'thinking' event
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
