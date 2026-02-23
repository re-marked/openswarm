import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { OrchestratorEvent, SessionData, SessionEvent, SessionMeta, UserMessageEvent } from './types.js'
import { generateId } from './utils.js'

const SESSIONS_DIR = join(homedir(), '.openswarm', 'sessions')

/**
 * Manages session persistence — save, load, list conversations.
 *
 * Writes on milestone events (user_message, done, end), NOT on every delta.
 */
export class SessionManager {
  private data: SessionData
  private dirty = false
  private filePath: string

  constructor(master: string, agents: string[]) {
    const now = Date.now()
    const dateStr = new Date(now).toISOString().slice(0, 10).replace(/-/g, '')
    const id = `${dateStr}-${generateId()}`

    this.data = {
      meta: { id, createdAt: now, updatedAt: now, preview: '' },
      config: { master, agents },
      events: [],
      histories: {},
    }

    mkdirSync(SESSIONS_DIR, { recursive: true })
    this.filePath = join(SESSIONS_DIR, `${id}.json`)
  }

  get id(): string {
    return this.data.meta.id
  }

  /** Append an event and auto-save on milestones. */
  append(event: OrchestratorEvent | UserMessageEvent): void {
    const sessionEvent: SessionEvent = { timestamp: Date.now(), event }
    this.data.events.push(sessionEvent)
    this.data.meta.updatedAt = Date.now()

    // Update preview from first user message
    if (event.type === 'user_message' && !this.data.meta.preview) {
      this.data.meta.preview = event.content.slice(0, 120)
    }

    // Write on milestone events only
    const milestones = ['user_message', 'done', 'end']
    if (milestones.includes(event.type)) {
      this.dirty = true
      this.flush()
    }
  }

  /** Update stored histories (call before saving). */
  setHistories(histories: Record<string, Array<{ role: string; content: string }>>): void {
    this.data.histories = histories
    this.dirty = true
  }

  /** Write to disk atomically (temp file + rename). */
  flush(): void {
    if (!this.dirty) return
    const tmpPath = this.filePath + '.tmp'
    writeFileSync(tmpPath, JSON.stringify(this.data, null, 2))
    renameSync(tmpPath, this.filePath)
    this.dirty = false
  }

  /** Get the full session data. */
  getData(): SessionData {
    return this.data
  }

  /** Load a session from disk by ID. */
  static load(id: string): SessionData {
    const filePath = join(SESSIONS_DIR, `${id}.json`)
    if (!existsSync(filePath)) {
      throw new Error(`Session not found: ${id}`)
    }
    return JSON.parse(readFileSync(filePath, 'utf-8'))
  }

  /** Restore a session into a SessionManager instance. */
  static restore(id: string): SessionManager {
    const data = SessionManager.load(id)
    const mgr = new SessionManager(data.config.master, data.config.agents)
    mgr.data = data
    mgr.filePath = join(SESSIONS_DIR, `${id}.json`)
    return mgr
  }

  /** List all saved sessions, most recent first. */
  static list(): SessionMeta[] {
    if (!existsSync(SESSIONS_DIR)) return []

    const files = readdirSync(SESSIONS_DIR).filter((f) => f.endsWith('.json'))
    const metas: SessionMeta[] = []

    for (const file of files) {
      try {
        const raw = readFileSync(join(SESSIONS_DIR, file), 'utf-8')
        const data: SessionData = JSON.parse(raw)
        metas.push(data.meta)
      } catch {
        // Skip corrupt files
      }
    }

    return metas.sort((a, b) => b.updatedAt - a.updatedAt)
  }
}
