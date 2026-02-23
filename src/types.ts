/** Configuration for a single agent in the swarm. */
export interface AgentConfig {
  url: string
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
}

/** A detected @mention in agent output. */
export interface MentionMatch {
  agent: string
  message: string
}

/** Events emitted by the orchestrator for the renderer to handle. */
export type OrchestratorEvent =
  | { type: 'connecting'; agent: string }
  | { type: 'connected'; agent: string }
  | { type: 'connect_error'; agent: string; error: string }
  | { type: 'thinking'; agent: string }
  | { type: 'delta'; agent: string; content: string }
  | { type: 'done'; agent: string; content: string }
  | { type: 'thread_start'; from: string; to: string; message: string }
  | { type: 'thread_message'; agent: string; content: string }
  | { type: 'thread_end'; from: string; to: string }
  | { type: 'synthesis_start'; agent: string }
  | { type: 'error'; agent: string; error: string }
  | { type: 'end' }
