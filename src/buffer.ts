/** Status of a single agent's buffered response. */
export type BufferStatus = 'thinking' | 'tool_use' | 'streaming' | 'done' | 'error'

export interface AgentBuffer {
  agent: string
  status: BufferStatus
  text: string
  toolName?: string
  error?: string
}

/**
 * Buffers per-agent responses during parallel mention processing.
 *
 * Each agent writes to its own buffer. Output is rendered sequentially
 * after all agents complete, avoiding interleaved terminal output.
 */
export class ResponseBuffer {
  private buffers: Map<string, AgentBuffer> = new Map()
  private order: string[] = []

  /** Create a buffer for an agent (in insertion order). */
  create(agent: string): void {
    if (!this.buffers.has(agent)) {
      this.order.push(agent)
    }
    this.buffers.set(agent, { agent, status: 'thinking', text: '' })
  }

  /** Append a text delta to an agent's buffer. */
  appendDelta(agent: string, text: string): void {
    const buf = this.buffers.get(agent)
    if (buf) {
      buf.text += text
      buf.status = 'streaming'
    }
  }

  /** Mark an agent's response as complete. */
  complete(agent: string, fullText: string): void {
    const buf = this.buffers.get(agent)
    if (buf) {
      buf.text = fullText
      buf.status = 'done'
    }
  }

  /** Mark an agent as errored. */
  fail(agent: string, error: string): void {
    const buf = this.buffers.get(agent)
    if (buf) {
      buf.error = error
      buf.status = 'error'
    }
  }

  /** Track a tool use for an agent. */
  addToolUse(agent: string, toolName: string): void {
    const buf = this.buffers.get(agent)
    if (buf) {
      buf.toolName = toolName
      buf.status = 'tool_use'
    }
  }

  /** Clear tool use status (tool ended). */
  clearToolUse(agent: string): void {
    const buf = this.buffers.get(agent)
    if (buf && buf.status === 'tool_use') {
      buf.status = buf.text ? 'streaming' : 'thinking'
      buf.toolName = undefined
    }
  }

  /** Get all buffers in insertion order. */
  getAll(): AgentBuffer[] {
    return this.order.map((name) => this.buffers.get(name)!).filter(Boolean)
  }

  /** Check if all agents are done or errored. */
  allDone(): boolean {
    return this.getAll().every((b) => b.status === 'done' || b.status === 'error')
  }

  /** Get a single buffer by agent name. */
  get(agent: string): AgentBuffer | undefined {
    return this.buffers.get(agent)
  }
}
