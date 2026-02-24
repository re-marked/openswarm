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

/** Human-readable tool label map. */
const TOOL_LABELS: Record<string, string> = {
  web_search: 'searching the web',
  google_search: 'searching the web',
  search: 'searching',
  exec: 'running command',
  execute: 'running command',
  shell: 'running command',
  read: 'reading file',
  read_file: 'reading file',
  write: 'writing file',
  write_file: 'writing file',
  edit: 'editing file',
  browse: 'browsing',
  fetch: 'fetching URL',
  code_interpreter: 'running code',
  python: 'running Python',
}

function toolLabel(name: string): string {
  return TOOL_LABELS[name] ?? name.replace(/_/g, ' ')
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
  private currentAgent = ''
  private needsPrefix = false
  private activeTools: Map<string, string> = new Map() // toolCallId → toolName
  private parallelStatus: Map<string, string> = new Map() // agent → status text

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
        // Buffer silently — the spinner gives live feedback, and we render
        // the full markdown-formatted result on 'done'. This avoids
        // cursor-rewrite issues on Windows/MSYS terminals.
        this.streamBuffer += event.content
        break

      case 'tool_start': {
        this.stopSpinner()
        this.activeTools.set(event.toolCallId, event.toolName)
        const agent = this.agents[event.agent]
        if (!agent) break
        const color = getColor(agent.color)
        this.spinner = ora({
          text: `${color('●')} ${color.bold(agent.label)}: ${chalk.dim(`[${event.toolName}]`)} ${toolLabel(event.toolName)}...`,
          color: getOraColor(agent.color) as any,
        }).start()
        break
      }

      case 'tool_end': {
        this.stopSpinner()
        this.activeTools.delete(event.toolCallId)
        break
      }

      case 'done': {
        this.stopSpinner()
        const raw = this.streamBuffer
        if (raw) {
          const agent = this.agents[this.currentAgent]
          if (agent) {
            const color = getColor(agent.color)
            process.stdout.write(`${color('●')} ${color.bold(agent.label)}: `)
          }
          console.log(renderMarkdown(raw))
        }
        this.streamBuffer = ''
        this.currentAgent = ''
        this.needsPrefix = false
        break
      }

      case 'thread_start': {
        const depth = event.depth ?? 0
        if (depth > 0) {
          const indent = '  '.repeat(depth)
          const fromAgent = this.agents[event.from]
          const toAgent = this.agents[event.to]
          if (fromAgent && toAgent) {
            const fromColor = getColor(fromAgent.color)
            const toColor = getColor(toAgent.color)
            console.log(chalk.dim(`${indent}${fromColor(fromAgent.label)} → ${toColor(toAgent.label)}`))
          }
        }
        break
      }

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

      case 'parallel_start': {
        this.stopSpinner()
        this.parallelStatus.clear()
        for (const name of event.agents) {
          this.parallelStatus.set(name, 'thinking...')
        }
        this.renderParallelStatus()
        break
      }

      case 'parallel_progress': {
        const agent = this.agents[event.agent]
        if (!agent) break
        let statusText: string
        switch (event.status) {
          case 'thinking':
            statusText = 'thinking...'
            break
          case 'tool_use':
            statusText = event.toolName
              ? `[${event.toolName}] ${toolLabel(event.toolName)}...`
              : 'using tool...'
            break
          case 'streaming':
            statusText = 'writing...'
            break
          case 'done':
            statusText = 'done'
            break
          case 'error':
            statusText = 'error'
            break
          default:
            statusText = event.status
        }
        this.parallelStatus.set(event.agent, statusText)
        this.renderParallelStatus()
        break
      }

      case 'parallel_end': {
        // Clear the status line
        process.stdout.write('\r\x1b[K')
        this.parallelStatus.clear()
        // Render each agent's full response sequentially
        for (const result of event.results) {
          const agent = this.agents[result.agent]
          if (!agent) continue
          const color = getColor(agent.color)
          if (result.content) {
            console.log()
            process.stdout.write(`${color('●')} ${color.bold(agent.label)}: `)
            console.log(renderMarkdown(result.content))
          } else if (result.error) {
            console.log(chalk.red(`  Error (${result.agent}): ${result.error}`))
          }
        }
        break
      }

      case 'agent_spawned': {
        this.stopSpinner()
        // Register the new agent so subsequent events render correctly
        this.agents[event.agent] = { label: event.label, color: event.color } as AgentConfig
        const spawnColor = getColor(event.color)
        console.log()
        console.log(`  ${spawnColor('◆')} ${chalk.bold('Spawned')} ${spawnColor.bold(event.label)} ${chalk.dim(`(@${event.agent})`)}`)
        break
      }

      case 'error':
        this.stopSpinner()
        console.log(chalk.red(`  Error (${event.agent}): ${event.error}`))
        break

      case 'end':
        this.stopSpinner()
        this.parallelStatus.clear()
        break
    }
  }

  /** Print the welcome screen. */
  printWelcome(agentNames: string[], masterName: string): void {
    const logo = `
    
   ██████╗ ██████╗ ███████╗███╗   ██╗███████╗██╗    ██╗ █████╗ ██████╗ ███╗   ███╗
  ██╔═══██╗██╔══██╗██╔════╝████╗  ██║██╔════╝██║    ██║██╔══██╗██╔══██╗████╗ ████║
  ██║   ██║██████╔╝█████╗  ██╔██╗ ██║███████╗██║ █╗ ██║███████║██████╔╝██╔████╔██║
  ██║   ██║██╔═══╝ ██╔══╝  ██║╚██╗██║╚════██║██║███╗██║██╔══██║██╔══██╗██║╚██╔╝██║
  ╚██████╔╝██║     ███████╗██║ ╚████║███████║╚███╔███╔╝██║  ██║██║  ██║██║ ╚═╝ ██║
   ╚═════╝ ╚═╝     ╚══════╝╚═╝  ╚═══╝╚══════╝ ╚══╝╚══╝ ╚═╝  ╚═╝╚═╝  ╚═╝╚═╝     ╚═╝`

    console.log(chalk.bold(logo))
    console.log(chalk.dim('  Multi-Agent @mention Orchestrator'))
    console.log()

    for (const name of agentNames) {
      const agent = this.agents[name]
      if (!agent) continue
      const color = getColor(agent.color)
      const role = name === masterName ? ' (master)' : ''
      const dot = color('●')
      const detail = agent.workspace
        ? chalk.dim(' [OpenClaw]')
        : agent.model ? chalk.dim(` [${agent.model}]`) : ''
      console.log(`  ${dot} ${color.bold(agent.label)}${chalk.dim(role)}${detail}`)
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

  /** Render the parallel agent status line (single line, overwritten in-place). */
  private renderParallelStatus(): void {
    this.stopSpinner()
    const parts: string[] = []
    for (const [name, status] of this.parallelStatus) {
      const agent = this.agents[name]
      if (!agent) continue
      const color = getColor(agent.color)
      const isDone = status === 'done'
      const isError = status === 'error'
      const statusText = isError
        ? chalk.red(status)
        : isDone
          ? chalk.green(status)
          : chalk.dim(status)
      parts.push(`${color('●')} ${color.bold(agent.label)}: ${statusText}`)
    }
    process.stdout.write(`\r\x1b[K  ${parts.join('  ')}`)
  }

  private stopSpinner(): void {
    if (this.spinner) {
      this.spinner.stop()
      this.spinner = null
    }
  }
}
