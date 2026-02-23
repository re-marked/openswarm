import { EventEmitter } from 'node:events'
import { OpenClawConnection } from './connection.js'
import type { AgentConfig, MentionMatch, OrchestratorEvent, SwarmConfig } from './types.js'
import { generateId } from './utils.js'

/**
 * Orchestrates multi-agent @mention conversations.
 *
 * - Sends user messages to the master agent
 * - Detects @mentions in the master's response
 * - Routes mentions to specialist agents (in parallel)
 * - Sends thread results back to master for synthesis
 * - Repeats up to maxMentionDepth rounds
 */
export class Orchestrator extends EventEmitter {
  private config: SwarmConfig
  private connections: Map<string, OpenClawConnection> = new Map()
  private agentNames: string[]
  private mentionRegex: RegExp

  constructor(config: SwarmConfig) {
    super()
    this.config = config
    // All agent names except master are mentionable
    this.agentNames = Object.keys(config.agents).filter((n) => n !== config.master)
    this.mentionRegex = new RegExp(`@(${this.agentNames.join('|')})\\b`, 'g')
  }

  /** Emit a typed event for the renderer. */
  private fire(event: OrchestratorEvent): void {
    this.emit('event', event)
  }

  /** Connect to the master agent at startup. */
  async connectMaster(): Promise<void> {
    const conn = await this.ensureConnection(this.config.master)
    if (!conn) {
      throw new Error(`Failed to connect to master agent`)
    }
  }

  /** Get connection status for all agents. */
  getConnectionStatus(): Map<string, boolean> {
    const status = new Map<string, boolean>()
    for (const name of Object.keys(this.config.agents)) {
      const conn = this.connections.get(name)
      status.set(name, conn?.isConnected ?? false)
    }
    return status
  }

  /** Send a user message and orchestrate the full @mention conversation. */
  async chat(userMessage: string): Promise<void> {
    const masterConn = await this.ensureConnection(this.config.master)
    if (!masterConn) {
      this.fire({ type: 'error', agent: this.config.master, error: 'Failed to connect to master' })
      this.fire({ type: 'end' })
      return
    }

    // Wire up delta streaming from master
    const masterDeltaHandler = (delta: string) => {
      this.fire({ type: 'delta', agent: this.config.master, content: delta })
    }
    masterConn.on('delta', masterDeltaHandler)

    this.fire({ type: 'thinking', agent: this.config.master })

    let lastText = await masterConn.sendMessage(userMessage)
    masterConn.removeListener('delta', masterDeltaHandler)

    if (lastText !== null) {
      this.fire({ type: 'done', agent: this.config.master, content: lastText })
    }

    // --- Multi-turn @mention loop ---
    let mentionDepth = 0
    const mentionedAgents = new Set<string>()

    while (lastText) {
      // Extract NEW mentions only (dedup within and across rounds)
      const seen = new Set(mentionedAgents)
      const mentions = this.extractMentions(lastText).filter((m) => {
        if (seen.has(m.agent)) return false
        seen.add(m.agent)
        return true
      })

      if (mentions.length === 0 || mentionDepth >= this.config.maxMentionDepth) {
        break
      }

      mentionDepth++
      for (const m of mentions) mentionedAgents.add(m.agent)

      // Process mentions in PARALLEL (unlike SSE gateway which does sequential)
      const threadResults = await Promise.all(
        mentions.map((mention) => this.processMention(mention)),
      )

      // Build synthesis message from thread results
      const threadReplies: string[] = []
      for (let i = 0; i < mentions.length; i++) {
        const result = threadResults[i]
        if (result) {
          threadReplies.push(`@${mentions[i].agent} replied: ${result}`)
        }
      }

      if (threadReplies.length === 0) break

      // Send follow-up to master for synthesis
      this.fire({ type: 'synthesis_start', agent: this.config.master })

      const followUpMessage = `[Thread] ${threadReplies.join('\n\n[Thread] ')}`

      masterConn.on('delta', masterDeltaHandler)
      lastText = await masterConn.sendMessage(followUpMessage)
      masterConn.removeListener('delta', masterDeltaHandler)

      if (lastText !== null) {
        this.fire({ type: 'done', agent: this.config.master, content: lastText })
      }
    }

    this.fire({ type: 'end' })
  }

  /**
   * Process a single @mention: connect to the agent, send the message,
   * stream the response, emit thread events.
   */
  private async processMention(mention: MentionMatch): Promise<string | null> {
    this.fire({
      type: 'thread_start',
      from: this.config.master,
      to: mention.agent,
      message: mention.message,
    })

    const conn = await this.ensureConnection(mention.agent)
    if (!conn) {
      this.fire({
        type: 'error',
        agent: mention.agent,
        error: `Failed to connect to ${mention.agent}`,
      })
      this.fire({ type: 'thread_end', from: this.config.master, to: mention.agent })
      return null
    }

    // Wire up delta streaming inside the thread
    const deltaHandler = (delta: string) => {
      this.fire({ type: 'delta', agent: mention.agent, content: delta })
    }
    conn.on('delta', deltaHandler)

    this.fire({ type: 'thinking', agent: mention.agent })

    const result = await conn.sendMessage(mention.message)
    conn.removeListener('delta', deltaHandler)

    if (result !== null) {
      this.fire({ type: 'done', agent: mention.agent, content: result })
    } else {
      this.fire({ type: 'error', agent: mention.agent, error: 'No response' })
    }

    this.fire({ type: 'thread_end', from: this.config.master, to: mention.agent })
    return result
  }

  /** Ensure an agent connection exists; connect lazily if not. */
  private async ensureConnection(name: string): Promise<OpenClawConnection | null> {
    const existing = this.connections.get(name)
    if (existing?.isConnected) return existing

    const agentConfig = this.config.agents[name]
    if (!agentConfig) return null

    const sessionKey = `${this.config.sessionPrefix}-${name}-${Date.now()}`
    const conn = new OpenClawConnection(name, agentConfig, sessionKey)

    this.fire({ type: 'connecting', agent: name })

    try {
      await conn.connect()
      this.connections.set(name, conn)
      this.fire({ type: 'connected', agent: name })
      return conn
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error'
      this.fire({ type: 'connect_error', agent: name, error: message })
      return null
    }
  }

  /** Extract @mentions and the text directed at each agent. */
  private extractMentions(text: string): MentionMatch[] {
    const mentions: MentionMatch[] = []
    const matches = [...text.matchAll(this.mentionRegex)]

    for (let i = 0; i < matches.length; i++) {
      const match = matches[i]
      const agent = match[1]
      const start = match.index! + match[0].length
      const end = i + 1 < matches.length ? matches[i + 1].index! : text.length
      const message = text.slice(start, end).trim()
      if (message) {
        mentions.push({ agent, message })
      }
    }

    return mentions
  }

  /** Close all connections. */
  close(): void {
    for (const conn of this.connections.values()) {
      conn.close()
    }
    this.connections.clear()
  }
}
