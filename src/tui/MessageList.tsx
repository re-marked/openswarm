import React from 'react'
import { Box } from 'ink'
import { Message } from './Message.js'
import type { ChatMessage, AgentConfig } from '../types.js'

interface MessageListProps {
  messages: ChatMessage[]
  agents: Record<string, AgentConfig>
}

export function MessageList({ messages, agents }: MessageListProps) {
  return (
    <Box flexDirection="column" flexGrow={1}>
      {messages.map((msg) => (
        <Message key={msg.id} message={msg} agents={agents} />
      ))}
    </Box>
  )
}
