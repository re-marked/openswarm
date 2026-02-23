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
          model: this.config.model ?? 'gemini-2.5-flash',
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
          model: this.config.model ?? 'gemini-2.5-flash',
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
            const delta = chunk.choices?.[0]?.delta?.content
            if (delta) {
              fullText += delta
              this.emit('delta', delta)
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

    // Add assistant response to history for multi-turn
    if (fullText) {
      this.history.push({ role: 'assistant', content: fullText })
    }

    return fullText || null
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
