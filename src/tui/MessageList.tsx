import React from 'react'
import { Box } from 'ink'
import { Message } from './Message.js'
import type { ChatMessage, AgentConfig } from '../types.js'

interface MessageListProps {
  messages: ChatMessage[]
  agents: Record<string, AgentConfig>
}

export function MessageList({ messages, agents }: MessageListProps) {
  // Filter out system messages that are just noise (connecting/connected)
  // Keep spawn messages and errors
  const visible = messages.filter((m) => {
    if (m.from !== 'system') return true
    if (m.content.startsWith('Spawned ')) return true
    if (m.content.startsWith('Error')) return true
    return false
  })

  // Track which index is the first non-system message to skip divider
  let firstNonSystem = true

  return (
    <Box flexDirection="column" flexGrow={1}>
      {visible.map((msg) => {
        const isFirst = msg.from !== 'system' && firstNonSystem
        if (msg.from !== 'system') firstNonSystem = false
        return <Message key={msg.id} message={msg} agents={agents} isFirst={isFirst} />
      })}
    </Box>
  )
}
