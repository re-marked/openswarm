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

  return (
    <Box flexDirection="column" flexGrow={1}>
      {visible.map((msg) => (
        <Message key={msg.id} message={msg} agents={agents} />
      ))}
    </Box>
  )
}
