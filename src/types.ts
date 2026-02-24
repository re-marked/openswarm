/** Gateway connection configuration. */
export interface GatewayConfig {
  port: number
  token: string
}

/** Configuration for a single agent in the swarm. */
export interface AgentConfig {
  /** OpenClaw agent ID used in x-openclaw-agent-id header. */
  agentId: string
  label: string
  color: string
  model?: string
  systemPrompt?: string
  /** @deprecated — use gateway.port instead. Kept for backward compat. */
  port?: number
  /** @deprecated — use gateway config instead. */
  url?: string
  token?: string
}

/** Top-level swarm configuration (loaded from swarm.config.json). */
export interface SwarmConfig {
  gateway: GatewayConfig
  agents: Record<string, AgentConfig>
  master: string
  maxMentionDepth: number
  sessionPrefix: string
  timeout: number
  /** Path to the config file on disk (for saving dynamic agents). */
  configPath?: string
}

/** A chat message in the group chat. */
export interface ChatMessage {
  id: string
  timestamp: number
  from: string          // 'user' | agent name
  to?: string           // optional target (null = broadcast to chat)
  content: string
  status: 'sending' | 'streaming' | 'complete' | 'error'
}

/** Agent activity status for the sidebar. */
export type AgentActivity = 'idle' | 'thinking' | 'writing' | 'tool_use' | 'error'

/** Events emitted by GroupChat for the TUI. */
export type GroupChatEvent =
  | { type: 'message_start'; message: ChatMessage }
  | { type: 'message_delta'; messageId: string; content: string }
  | { type: 'message_done'; messageId: string; content: string }
  | { type: 'message_error'; messageId: string; error: string }
  | { type: 'agent_status'; agent: string; activity: AgentActivity; toolName?: string }
  | { type: 'agent_spawned'; agent: string; label: string; color: string }
  | { type: 'system'; text: string }

/** A detected @mention in agent output. */
export interface MentionMatch {
  agent: string
  message: string
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
  messages: ChatMessage[]
  histories: Record<string, Array<{ role: string; content: string }>>
}

/** Legacy orchestrator events — kept for reference only. */
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

/** User message event — legacy. */
export interface UserMessageEvent {
  type: 'user_message'
  content: string
}

/** A timestamped session event — legacy. */
export interface SessionEvent {
  timestamp: number
  event: OrchestratorEvent | UserMessageEvent
}
