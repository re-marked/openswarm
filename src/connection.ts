import { EventEmitter } from 'node:events'
import type { AgentConfig } from './types.js'

/**
 * Connection to an LLM via OpenAI-compatible chat completions API.
 *
 * Works with:
 * - Google Gemini (via OpenAI compatibility layer)
 * - OpenAI directly
 * - OpenClaw HTTP endpoints (when available)
 * - Any OpenAI-compatible API
 *
 * Maintains conversation history client-side for multi-turn support.
 */
export class OpenClawConnection extends EventEmitter {
  private _connected = false
  readonly name: string
  readonly config: AgentConfig
  private history: Array<{ role: string; content: string }> = []
  private baseUrl: string

  constructor(name: string, config: AgentConfig, _sessionKey: string) {
    super()
    this.name = name
    this.config = config
    this.baseUrl = config.url

    // Prepend system prompt to history if configured
    if (config.systemPrompt) {
      this.history.push({ role: 'system', content: config.systemPrompt })
    }
  }

  get isConnected(): boolean {
    return this._connected
  }

  /** Verify the agent is reachable with a quick non-streaming request. */
  async connect(): Promise<void> {
    if (this._connected) return

    const url = `${this.baseUrl}/chat/completions`
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: this.buildHeaders(),
        body: JSON.stringify({
          model: this.config.model ?? 'default',
          messages: [{ role: 'user', content: 'Reply with OK' }],
          stream: false,
          max_tokens: 3,
        }),
        signal: AbortSignal.timeout(30_000),
      })
      if (!res.ok) {
        const text = await res.text().catch(() => '')
        throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`)
      }
      this._connected = true
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error'
      throw new Error(`Connection check failed for ${this.name}: ${msg}`)
    }
  }

  /**
   * Send a message and stream back the response.
   *
   * Emits 'delta' events as text arrives.
   * Returns the full response text, or null on error.
   */
  async sendMessage(message: string): Promise<string | null> {
    this.history.push({ role: 'user', content: message })

    const url = `${this.baseUrl}/chat/completions`
    let res: Response
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: this.buildHeaders(),
        body: JSON.stringify({
          model: this.config.model ?? 'default',
          messages: this.history,
          stream: true,
        }),
        signal: AbortSignal.timeout(120_000),
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error'
      this.emit('error', msg)
      return null
    }

    if (!res.ok || !res.body) {
      const text = await res.text().catch(() => '')
      this.emit('error', `HTTP ${res.status}: ${text.slice(0, 200)}`)
      return null
    }

    // Parse SSE stream
    let fullText = ''
    const activeToolCalls = new Map<string, { name: string; args: string }>()
    try {
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })

        // Process complete SSE lines
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? '' // keep incomplete line in buffer

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          const data = line.slice(6).trim()
          if (data === '[DONE]') continue

          try {
            const chunk = JSON.parse(data)
            const choice = chunk.choices?.[0]

            // Track tool calls
            const toolCalls = choice?.delta?.tool_calls
            if (toolCalls && Array.isArray(toolCalls)) {
              for (const tc of toolCalls) {
                const id = tc.id
                const fnName = tc.function?.name
                if (id && fnName && !activeToolCalls.has(id)) {
                  activeToolCalls.set(id, { name: fnName, args: '' })
                  this.emit('tool_start', { name: fnName, id })
                }
                // Accumulate arguments
                if (tc.id && tc.function?.arguments) {
                  const existing = activeToolCalls.get(tc.id)
                  if (existing) {
                    existing.args += tc.function.arguments
                  }
                } else if (tc.index !== undefined && tc.function?.arguments) {
                  // Some APIs use index-based tool call streaming
                  for (const [, entry] of activeToolCalls) {
                    entry.args += tc.function.arguments
                    break
                  }
                }
              }
            }

            // Content delta — if we had active tools and content resumes, tools ended
            const delta = choice?.delta?.content
            if (delta && activeToolCalls.size > 0) {
              for (const [id, { name }] of activeToolCalls) {
                this.emit('tool_end', { name, id })
              }
              activeToolCalls.clear()
            }

            if (delta) {
              fullText += delta
              this.emit('delta', delta)
            }

            // finish_reason signals end — close any remaining tools
            if (choice?.finish_reason && activeToolCalls.size > 0) {
              for (const [id, { name }] of activeToolCalls) {
                this.emit('tool_end', { name, id })
              }
              activeToolCalls.clear()
            }
          } catch {
            // Skip unparseable chunks
          }
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Stream error'
      this.emit('error', msg)
      if (!fullText) return null
    }

    // End any tool calls still active when stream ends
    for (const [id, { name }] of activeToolCalls) {
      this.emit('tool_end', { name, id })
    }
    activeToolCalls.clear()

    // Add assistant response to history for multi-turn
    if (fullText) {
      this.history.push({ role: 'assistant', content: fullText })
    }

    return fullText || null
  }

  /** Get the conversation history (for session persistence). */
  getHistory(): Array<{ role: string; content: string }> {
    return [...this.history]
  }

  /** Replace conversation history (for session restore). */
  setHistory(history: Array<{ role: string; content: string }>): void {
    this.history = [...history]
  }

  private buildHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    }
    if (this.config.token) {
      headers['Authorization'] = `Bearer ${this.config.token}`
    }
    return headers
  }

  /** Close the connection (clears history). */
  close(): void {
    this._connected = false
    this.history = []
  }
}
