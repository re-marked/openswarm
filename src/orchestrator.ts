import { EventEmitter } from 'node:events'
import { ResponseBuffer } from './buffer.js'
import { OpenClawConnection } from './connection.js'
import type { AgentConfig, MentionMatch, OrchestratorEvent, SwarmConfig } from './types.js'
import { generateId } from './utils.js'

/** Maximum total mentions processed per user message (safety valve). */
const MAX_TOTAL_MENTIONS = 20

/**
 * Orchestrates multi-agent @mention conversations with deep nesting.
 *
 * - Sends user messages to the master agent
 * - Detects @mentions in any agent's response
 * - Routes mentions to other agents (in parallel, recursively)
 * - Agents can @mention each other at any depth
 * - Sends thread results back to the originating agent for synthesis
 * - Per-branch visited set prevents cycles; global counter prevents explosion
 */
export class Orchestrator extends EventEmitter {
  private config: SwarmConfig
  private connections: Map<string, OpenClawConnection> = new Map()
  private connectingPromises: Map<string, Promise<OpenClawConnection | null>> = new Map()
  private allAgentNames: string[]
  private mentionRegex: RegExp

  constructor(config: SwarmConfig) {
    super()
    this.config = config
    // ALL agents are mentionable (any agent can mention any other)
    this.allAgentNames = Object.keys(config.agents)
    this.mentionRegex = new RegExp(`@(${this.allAgentNames.join('|')})\\b`, 'g')
  }

  /**
   * Build a [SWARM CONTEXT] block to prepend to every delegated message.
   * Gives each receiving agent full situational awareness.
   */
  private buildSwarmContext(fromName: string, toName: string, depth: number): string {
    const from = this.config.agents[fromName]
    const to = this.config.agents[toName]

    const fromEndpoint = from?.url ?? (from?.port ? `http://localhost:${from.port}/v1` : 'unknown')
    const toEndpoint = to?.url ?? (to?.port ? `http://localhost:${to.port}/v1` : 'unknown')

    const teamRoster = Object.entries(this.config.agents)
      .map(([n, a]) => {
        const role = n === this.config.master ? 'coordinator' : 'specialist'
        const marker = n === toName ? '(you)' : role
        return `@${n} (${marker})`
      })
      .join(' | ')

    return [
      '[SWARM CONTEXT]',
      `timestamp: ${new Date().toISOString()}`,
      `from: ${fromName} (${from?.label ?? fromName}) · ${fromName === this.config.master ? 'AI coordinator' : 'AI specialist'} · model: ${from?.model ?? 'unknown'} · ${fromEndpoint}`,
      `to: ${toName} (${to?.label ?? toName}) · YOU · model: ${to?.model ?? 'unknown'} · ${toEndpoint}`,
      `team: ${teamRoster}`,
      `depth: ${depth} / ${this.config.maxMentionDepth}`,
      '---',
    ].join('\n')
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

    // Wire up delta + tool streaming from master
    const masterDeltaHandler = (delta: string) => {
      this.fire({ type: 'delta', agent: this.config.master, content: delta })
    }
    const masterToolStartHandler = (info: { name: string; id: string }) => {
      this.fire({ type: 'tool_start', agent: this.config.master, toolName: info.name, toolCallId: info.id })
    }
    const masterToolEndHandler = (info: { name: string; id: string }) => {
      this.fire({ type: 'tool_end', agent: this.config.master, toolName: info.name, toolCallId: info.id })
    }
    masterConn.on('delta', masterDeltaHandler)
    masterConn.on('tool_start', masterToolStartHandler)
    masterConn.on('tool_end', masterToolEndHandler)

    this.fire({ type: 'thinking', agent: this.config.master })

    let lastText = await masterConn.sendMessage(userMessage)
    masterConn.removeListener('delta', masterDeltaHandler)
    masterConn.removeListener('tool_start', masterToolStartHandler)
    masterConn.removeListener('tool_end', masterToolEndHandler)

    if (lastText !== null) {
      this.fire({ type: 'done', agent: this.config.master, content: lastText, depth: 0 })
    }

    // --- Multi-turn @mention loop (depth 0 = master level) ---
    // Global mention counter shared across all recursive branches
    const globalMentionCount = { value: 0 }

    let mentionRound = 0
    while (lastText) {
      // Extract mentions, excluding self-mentions
      const mentions = this.extractMentions(lastText, this.config.master)

      if (mentions.length === 0 || mentionRound >= this.config.maxMentionDepth) {
        break
      }

      mentionRound++

      // Check global safety valve
      if (globalMentionCount.value + mentions.length > MAX_TOTAL_MENTIONS) {
        break
      }
      globalMentionCount.value += mentions.length

      // Process mentions in parallel with recursive nesting
      const buffer = new ResponseBuffer()
      const agentNames = mentions.map((m) => m.agent)
      for (const m of mentions) buffer.create(m.agent)

      this.fire({ type: 'parallel_start', agents: agentNames })

      const threadResults = await Promise.all(
        mentions.map((mention) =>
          this.processMentionRecursive(
            mention,
            this.config.master,
            1, // depth starts at 1 for first-level mentions
            new Set([this.config.master]), // visited: master already in the chain
            buffer,
            globalMentionCount
          )
        )
      )

      this.fire({
        type: 'parallel_end',
        results: mentions.map((m, i) => ({
          agent: m.agent,
          content: threadResults[i],
          error: buffer.get(m.agent)?.error,
        })),
      })

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
      masterConn.on('tool_start', masterToolStartHandler)
      masterConn.on('tool_end', masterToolEndHandler)
      lastText = await masterConn.sendMessage(followUpMessage)
      masterConn.removeListener('delta', masterDeltaHandler)
      masterConn.removeListener('tool_start', masterToolStartHandler)
      masterConn.removeListener('tool_end', masterToolEndHandler)

      if (lastText !== null) {
        this.fire({ type: 'done', agent: this.config.master, content: lastText, depth: 0 })
      }
    }

    this.fire({ type: 'end' })
  }

  /**
   * Process a single @mention recursively.
   *
   * After the agent responds, scans for further @mentions (excluding self
   * and agents already in this branch's visited set). Child mentions are
   * processed in parallel, results synthesized, and sent back to THIS agent.
   */
  private async processMentionRecursive(
    mention: MentionMatch,
    parentAgent: string,
    depth: number,
    visited: Set<string>,
    buffer: ResponseBuffer,
    globalMentionCount: { value: number }
  ): Promise<string | null> {
    this.fire({
      type: 'thread_start',
      from: parentAgent,
      to: mention.agent,
      message: mention.message,
      depth,
    })

    const conn = await this.ensureConnection(mention.agent)
    if (!conn) {
      buffer.fail(mention.agent, `Failed to connect to ${mention.agent}`)
      this.fire({ type: 'parallel_progress', agent: mention.agent, status: 'error' })
      this.fire({ type: 'thread_end', from: parentAgent, to: mention.agent, depth })
      return null
    }

    // Buffer deltas instead of emitting them live
    const deltaHandler = (delta: string) => {
      buffer.appendDelta(mention.agent, delta)
      this.fire({ type: 'parallel_progress', agent: mention.agent, status: 'streaming' })
    }
    const toolStartHandler = (info: { name: string; id: string }) => {
      buffer.addToolUse(mention.agent, info.name)
      this.fire({ type: 'parallel_progress', agent: mention.agent, status: 'tool_use', toolName: info.name })
    }
    const toolEndHandler = (_info: { name: string; id: string }) => {
      buffer.clearToolUse(mention.agent)
      this.fire({ type: 'parallel_progress', agent: mention.agent, status: 'streaming' })
    }

    conn.on('delta', deltaHandler)
    conn.on('tool_start', toolStartHandler)
    conn.on('tool_end', toolEndHandler)

    this.fire({ type: 'parallel_progress', agent: mention.agent, status: 'thinking' })

    const contextBlock = this.buildSwarmContext(parentAgent, mention.agent, depth)
    const messageWithContext = `${contextBlock}\n${mention.message}`

    let result = await conn.sendMessage(messageWithContext)
    conn.removeListener('delta', deltaHandler)
    conn.removeListener('tool_start', toolStartHandler)
    conn.removeListener('tool_end', toolEndHandler)

    if (result === null) {
      buffer.fail(mention.agent, 'No response')
      this.fire({ type: 'parallel_progress', agent: mention.agent, status: 'error' })
      this.fire({ type: 'thread_end', from: parentAgent, to: mention.agent, depth })
      return null
    }

    // --- Recursive: check for child @mentions ---
    const branchVisited = new Set(visited)
    branchVisited.add(mention.agent)

    const childMentions = this.extractMentions(result, mention.agent)
      .filter((m) => !branchVisited.has(m.agent))

    if (
      childMentions.length > 0 &&
      depth < this.config.maxMentionDepth &&
      globalMentionCount.value + childMentions.length <= MAX_TOTAL_MENTIONS
    ) {
      globalMentionCount.value += childMentions.length

      // Process child mentions in parallel
      const childBuffer = new ResponseBuffer()
      for (const cm of childMentions) childBuffer.create(cm.agent)

      const childResults = await Promise.all(
        childMentions.map((cm) =>
          this.processMentionRecursive(
            cm,
            mention.agent,
            depth + 1,
            branchVisited,
            childBuffer,
            globalMentionCount
          )
        )
      )

      // Build synthesis message for THIS agent (not master)
      const childReplies: string[] = []
      for (let i = 0; i < childMentions.length; i++) {
        const cr = childResults[i]
        if (cr) {
          childReplies.push(`@${childMentions[i].agent} replied: ${cr}`)
        }
      }

      if (childReplies.length > 0) {
        // Send follow-up to THIS agent for synthesis
        const followUp = `[Thread] ${childReplies.join('\n\n[Thread] ')}`

        // Re-buffer for synthesis response
        buffer.create(mention.agent) // reset buffer
        conn.on('delta', deltaHandler)
        conn.on('tool_start', toolStartHandler)
        conn.on('tool_end', toolEndHandler)

        this.fire({ type: 'parallel_progress', agent: mention.agent, status: 'thinking' })

        const synthesized = await conn.sendMessage(followUp)
        conn.removeListener('delta', deltaHandler)
        conn.removeListener('tool_start', toolStartHandler)
        conn.removeListener('tool_end', toolEndHandler)

        if (synthesized) {
          result = synthesized
        }
      }
    }

    buffer.complete(mention.agent, result)
    this.fire({ type: 'parallel_progress', agent: mention.agent, status: 'done' })
    this.fire({ type: 'thread_end', from: parentAgent, to: mention.agent, depth })
    return result
  }

  /** Ensure an agent connection exists; connect lazily if not. Deduplicates concurrent connect attempts. */
  private async ensureConnection(name: string): Promise<OpenClawConnection | null> {
    const existing = this.connections.get(name)
    if (existing?.isConnected) return existing

    // Dedup: if another call is already connecting this agent, wait for it
    const pending = this.connectingPromises.get(name)
    if (pending) return pending

    const agentConfig = this.config.agents[name]
    if (!agentConfig) return null

    const connectPromise = (async (): Promise<OpenClawConnection | null> => {
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
      } finally {
        this.connectingPromises.delete(name)
      }
    })()

    this.connectingPromises.set(name, connectPromise)
    return connectPromise
  }

  /**
   * Extract @mentions from text, excluding self-mentions.
   * Each agent is only extracted once (first occurrence wins).
   */
  private extractMentions(text: string, excludeAgent: string): MentionMatch[] {
    const mentions: MentionMatch[] = []
    const matches = [...text.matchAll(this.mentionRegex)]
    const seen = new Set<string>()

    for (let i = 0; i < matches.length; i++) {
      const match = matches[i]
      const agent = match[1]
      if (agent === excludeAgent || seen.has(agent)) continue
      seen.add(agent)

      const start = match.index! + match[0].length
      const end = i + 1 < matches.length ? matches[i + 1].index! : text.length
      const message = text.slice(start, end).trim()
      if (message) {
        mentions.push({ agent, message })
      }
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

  /** Restore conversation histories from a saved session. */
  async restoreHistories(
    histories: Record<string, Array<{ role: string; content: string }>>
  ): Promise<void> {
    for (const [name, history] of Object.entries(histories)) {
      if (!this.config.agents[name]) continue
      const conn = await this.ensureConnection(name)
      if (conn) {
        conn.setHistory(history)
      }
    }
  }

  /** Close all connections. */
  close(): void {
    for (const conn of this.connections.values()) {
      conn.close()
    }
    this.connections.clear()
  }
}
