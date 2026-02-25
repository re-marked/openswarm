import { EventEmitter } from 'node:events'
import { buildAgentSystemPrompt, saveConfig } from './config.js'
import { OpenClawConnection } from './connection.js'
import type { AgentConfig, ChatMessage, GroupChatEvent, MentionMatch, SwarmConfig } from './types.js'
import { generateId } from './utils.js'

/** Maximum total mentions processed per user message (no hard limit — agents end debates by not tagging). */
const MAX_TOTAL_MENTIONS = Infinity

/** Colors to cycle through when spawning dynamic agents. */
const SPAWN_COLORS = ['green', 'amber', 'cyan', 'purple', 'red', 'blue', 'pink']

/** Regex that matches ANY @word pattern. */
const MENTION_REGEX = /@([a-z][a-z0-9_-]*)\b/gi

/**
 * Async Group Chat engine.
 *
 * Replaces the synchronous Orchestrator with a true async message bus.
 * - All messages flow through the bus and are visible to all participants
 * - Agents can @mention each other → auto-routed
 * - Unknown @mentions auto-spawn new agents
 * - User can send messages while agents are still responding
 * - Each agent maintains its own conversation context
 */
export class GroupChat extends EventEmitter {
  private config: SwarmConfig
  private connections: Map<string, OpenClawConnection> = new Map()
  private connectingPromises: Map<string, Promise<OpenClawConnection | null>> = new Map()
  private spawnColorIndex = 0
  private messages: ChatMessage[] = []
  private activeTasks = 0
  private globalMentionCount = 0

  constructor(config: SwarmConfig) {
    super()
    this.config = config
  }

  /** Emit a typed event for the TUI. */
  private fire(event: GroupChatEvent): void {
    this.emit('event', event)
  }

  /** Get all messages. */
  getMessages(): ChatMessage[] {
    return [...this.messages]
  }

  /** Get the config. */
  getConfig(): SwarmConfig {
    return this.config
  }

  /** Connect to the master agent at startup. */
  async connectMaster(): Promise<void> {
    const conn = await this.ensureConnection(this.config.master)
    if (!conn) {
      throw new Error('Failed to connect to master agent')
    }
    this.fire({ type: 'system', text: `Connected to ${this.config.agents[this.config.master].label}` })
  }

  /** Connect to all configured agents. */
  async connectAll(): Promise<void> {
    await Promise.all(
      Object.keys(this.config.agents).map((name) => this.ensureConnection(name))
    )
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

  /**
   * Send a user message into the group chat.
   * Routes to master by default, or to specific @mentioned agents.
   */
  async sendUserMessage(text: string): Promise<void> {
    // Create user message
    const userMsg: ChatMessage = {
      id: generateId(),
      timestamp: Date.now(),
      from: 'user',
      content: text,
      status: 'complete',
    }
    this.messages.push(userMsg)
    this.fire({ type: 'message_start', message: userMsg })
    this.fire({ type: 'message_done', messageId: userMsg.id, content: text })

    // Reset mention counter per user message
    this.globalMentionCount = 0

    // Check if user directly @mentions specific agents
    const directMentions = this.extractMentions(text, 'user')

    if (directMentions.length > 0) {
      // Auto-spawn unknown agents
      for (const m of directMentions) {
        if (!this.config.agents[m.agent]) {
          await this.spawnDynamicAgent(m.agent)
        }
      }
      // Route to each mentioned agent in parallel
      await Promise.all(
        directMentions.map((m) => this.routeToAgent(m.agent, text, 'user', 0))
      )
    } else {
      // Default: send to master
      await this.routeToAgent(this.config.master, text, 'user', 0)
    }
  }

  /**
   * Route a message to a specific agent, stream the response into chat,
   * and recursively handle any @mentions in the response.
   */
  private async routeToAgent(
    agentName: string,
    message: string,
    fromName: string,
    depth: number,
  ): Promise<void> {
    this.activeTasks++

    const conn = await this.ensureConnection(agentName)
    if (!conn) {
      const errorMsg: ChatMessage = {
        id: generateId(),
        timestamp: Date.now(),
        from: agentName,
        content: `Failed to connect to ${agentName}`,
        status: 'error',
      }
      this.messages.push(errorMsg)
      this.fire({ type: 'message_start', message: errorMsg })
      this.fire({ type: 'message_error', messageId: errorMsg.id, error: errorMsg.content })
      this.activeTasks--
      return
    }

    // Create the agent's response message (streaming)
    const msgId = generateId()
    const agentMsg: ChatMessage = {
      id: msgId,
      timestamp: Date.now(),
      from: agentName,
      content: '',
      status: 'streaming',
    }
    this.messages.push(agentMsg)
    this.fire({ type: 'message_start', message: agentMsg })
    this.fire({ type: 'agent_status', agent: agentName, activity: 'thinking' })

    // Wire up streaming handlers
    const deltaHandler = (delta: string) => {
      agentMsg.content += delta
      this.fire({ type: 'message_delta', messageId: msgId, content: delta })
      this.fire({ type: 'agent_status', agent: agentName, activity: 'writing' })
    }
    const toolStartHandler = (info: { name: string; id: string }) => {
      this.fire({ type: 'agent_status', agent: agentName, activity: 'tool_use', toolName: info.name })
    }
    const toolEndHandler = () => {
      this.fire({ type: 'agent_status', agent: agentName, activity: 'writing' })
    }
    const errorHandler = (err: string) => {
      this.fire({ type: 'message_error', messageId: msgId, error: err })
    }

    conn.on('delta', deltaHandler)
    conn.on('tool_start', toolStartHandler)
    conn.on('tool_end', toolEndHandler)
    conn.on('error', errorHandler)

    // Prepend context for inter-agent messages
    let messageToSend = message
    if (fromName !== 'user') {
      messageToSend = this.buildSwarmContext(fromName, agentName, depth) + '\n' + message
    }

    const result = await conn.sendMessage(messageToSend)

    conn.removeListener('delta', deltaHandler)
    conn.removeListener('tool_start', toolStartHandler)
    conn.removeListener('tool_end', toolEndHandler)
    conn.removeListener('error', errorHandler)

    if (result) {
      agentMsg.content = result
      agentMsg.status = 'complete'
      this.fire({ type: 'message_done', messageId: msgId, content: result })
    } else {
      agentMsg.status = 'error'
      this.fire({ type: 'message_error', messageId: msgId, error: 'No response' })
    }

    this.fire({ type: 'agent_status', agent: agentName, activity: 'idle' })
    this.activeTasks--

    // Handle @mentions in the response (recursive — no depth limit, debate ends when agents stop tagging)
    if (result) {
      const mentions = this.extractMentions(result, agentName)
      if (mentions.length > 0) {
        this.globalMentionCount += mentions.length

        // Auto-spawn unknown agents
        for (const m of mentions) {
          if (!this.config.agents[m.agent]) {
            await this.spawnDynamicAgent(m.agent)
          }
        }

        // Route to mentioned agents in parallel
        // Pass the agent's response as the message — the swarm context block
        // (prepended by routeToAgent) already identifies who said what
        await Promise.all(
          mentions.map((m) =>
            this.routeToAgent(m.agent, result, agentName, depth + 1)
          )
        )
      }
    }
  }

  /** Build a [SWARM CONTEXT] block for inter-agent messages. */
  private buildSwarmContext(fromName: string, toName: string, depth: number): string {
    const from = this.config.agents[fromName]
    const to = this.config.agents[toName]

    const teamRoster = Object.entries(this.config.agents)
      .map(([n, a]) => {
        const role = n === this.config.master ? 'coordinator' : 'specialist'
        const marker = n === toName ? '(you)' : role
        return `@${n} (${marker})`
      })
      .join(' | ')

    return [
      '[SWARM CONTEXT]',
      `from: ${fromName} (${from?.label ?? fromName})`,
      `to: ${toName} (${to?.label ?? toName}) — YOU`,
      `team: ${teamRoster}`,
      `round: ${depth}`,
      ``,
      `${fromName} just said something to you. Fire back.`,
      `@tag your opponent to keep the debate going. No tag = you're done talking.`,
      `DO NOT tag @${this.config.master} — the coordinator is watching, not debating.`,
      '---',
    ].join('\n')
  }

  /** Ensure an agent connection exists; connect lazily if not. */
  private async ensureConnection(name: string): Promise<OpenClawConnection | null> {
    const existing = this.connections.get(name)
    if (existing?.isConnected) return existing

    const pending = this.connectingPromises.get(name)
    if (pending) return pending

    const agentConfig = this.config.agents[name]
    if (!agentConfig) return null

    const connectPromise = (async (): Promise<OpenClawConnection | null> => {
      const sessionKey = `${this.config.sessionPrefix}-${name}-${Date.now()}`
      const conn = new OpenClawConnection(name, agentConfig, this.config.gateway, sessionKey)

      try {
        await conn.connect()
        this.connections.set(name, conn)
        return conn
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error'
        this.fire({ type: 'system', text: `Failed to connect to ${agentConfig.label}: ${message}` })
        return null
      } finally {
        this.connectingPromises.delete(name)
      }
    })()

    this.connectingPromises.set(name, connectPromise)
    return connectPromise
  }

  /** Dynamically spawn a new agent. */
  private async spawnDynamicAgent(name: string): Promise<void> {
    const label = name.charAt(0).toUpperCase() + name.slice(1)
    const color = SPAWN_COLORS[this.spawnColorIndex % SPAWN_COLORS.length]
    this.spawnColorIndex++

    const masterAgent = this.config.agents[this.config.master]

    const newAgent: AgentConfig = {
      agentId: name,
      token: masterAgent?.token,
      model: masterAgent?.model,
      label,
      color,
    }

    this.config.agents[name] = newAgent
    newAgent.systemPrompt = buildAgentSystemPrompt(name, this.config)

    this.fire({ type: 'agent_spawned', agent: name, label, color })

    try {
      await saveConfig(this.config)
    } catch { /* non-fatal */ }
  }

  /**
   * Extract @mentions from text, excluding self-mentions.
   * All mentioned agents receive the FULL message text — not just the
   * slice after their @mention. This ensures "@democrat @republican go"
   * sends the full text to both agents.
   */
  private extractMentions(text: string, excludeAgent: string): MentionMatch[] {
    const mentions: MentionMatch[] = []
    const matches = [...text.matchAll(MENTION_REGEX)]
    const seen = new Set<string>()

    // Collect unique mentioned agents
    for (const match of matches) {
      const agent = match[1].toLowerCase()
      if (agent === excludeAgent || seen.has(agent)) continue
      seen.add(agent)
      mentions.push({ agent, message: text })
    }

    return mentions
  }

  /** Get conversation histories for all connected agents. */
  getHistories(): Record<string, Array<{ role: string; content: string }>> {
    const result: Record<string, Array<{ role: string; content: string }>> = {}
    for (const [name, conn] of this.connections) {
      result[name] = conn.getHistory()
    }
    return result
  }

  /** Check if any agents are currently processing. */
  isBusy(): boolean {
    return this.activeTasks > 0
  }

  /** Close all connections. */
  close(): void {
    for (const conn of this.connections.values()) {
      conn.close()
    }
    this.connections.clear()
  }
}
