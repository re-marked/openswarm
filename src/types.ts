/** Configuration for a single agent in the swarm. */
export interface AgentConfig {
  /** OpenAI-compatible endpoint (required for direct API mode). */
  url?: string
  /** Path to an OpenClaw workspace directory (alternative to url). */
  workspace?: string
  /** Auto-assigned port for spawned workspace agents. */
  port?: number
  token?: string
  label: string
  color: string
  model?: string
  systemPrompt?: string
}

/** Top-level swarm configuration (loaded from swarm.config.json). */
export interface SwarmConfig {
  agents: Record<string, AgentConfig>
  master: string
  maxMentionDepth: number
  sessionPrefix: string
  timeout: number
  /** Path to the config file on disk (for saving dynamic agents). */
  configPath?: string
}

/** A detected @mention in agent output. */
export interface MentionMatch {
  agent: string
  message: string
}

/** User message event for session recording. */
export interface UserMessageEvent {
  type: 'user_message'
  content: string
}

/** A timestamped session event. */
export interface SessionEvent {
  timestamp: number
  event: OrchestratorEvent | UserMessageEvent
}

/** Session metadata for listing. */
export interface SessionMeta {
  id: string
  createdAt: number
  updatedAt: number
  preview: string
}

/** Full session data stored on disk. */
export interface SessionData {
  meta: SessionMeta
  config: { master: string; agents: string[] }
  events: SessionEvent[]
  histories: Record<string, Array<{ role: string; content: string }>>
}

/** Events emitted by the orchestrator for the renderer to handle. */
export type OrchestratorEvent =
  | { type: 'connecting'; agent: string }
  | { type: 'connected'; agent: string }
  | { type: 'connect_error'; agent: string; error: string }
  | { type: 'thinking'; agent: string }
  | { type: 'delta'; agent: string; content: string }
  | { type: 'done'; agent: string; content: string; depth?: number }
  | { type: 'tool_start'; agent: string; toolName: string; toolCallId: string }
  | { type: 'tool_end'; agent: string; toolName: string; toolCallId: string }
  | { type: 'thread_start'; from: string; to: string; message: string; depth?: number }
  | { type: 'thread_message'; agent: string; content: string }
  | { type: 'thread_end'; from: string; to: string; depth?: number }
  | { type: 'synthesis_start'; agent: string }
  | { type: 'parallel_start'; agents: string[] }
  | { type: 'parallel_progress'; agent: string; status: string; toolName?: string }
  | { type: 'parallel_end'; results: Array<{ agent: string; content: string | null; error?: string }> }
  | { type: 'agent_spawned'; agent: string; label: string; color: string }
  | { type: 'error'; agent: string; error: string }
  | { type: 'end' }
