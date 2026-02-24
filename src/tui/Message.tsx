import React from 'react'
import { Box, Text } from 'ink'
import type { ChatMessage, AgentConfig } from '../types.js'

/** Map color names from config to ink color values. */
const COLOR_MAP: Record<string, string> = {
  indigo: '#6366f1',
  green: '#22c55e',
  amber: '#f59e0b',
  cyan: '#06b6d4',
  purple: '#a855f7',
  red: '#ef4444',
  blue: '#3b82f6',
  pink: '#ec4899',
}

function getHex(colorName: string): string {
  return COLOR_MAP[colorName] ?? '#ffffff'
}

interface MessageProps {
  message: ChatMessage
  agents: Record<string, AgentConfig>
}

export function Message({ message, agents }: MessageProps) {
  const isUser = message.from === 'user'
  const isSystem = message.from === 'system'

  if (isSystem) {
    return (
      <Box paddingX={1}>
        <Text color="gray" dimColor>{'  '}◆ {message.content}</Text>
      </Box>
    )
  }

  if (isUser) {
    return (
      <Box flexDirection="column" paddingX={1}>
        <Box>
          <Text color="white" bold>● You</Text>
        </Box>
        <Box paddingLeft={2}>
          <Text>{message.content}</Text>
        </Box>
      </Box>
    )
  }

  // Agent message
  const agent = agents[message.from]
  const colorHex = agent ? getHex(agent.color) : '#ffffff'
  const label = agent?.label ?? message.from

  const statusIndicator = message.status === 'streaming'
    ? ' ▍'
    : message.status === 'error'
      ? ' ✗'
      : ''

  return (
    <Box flexDirection="column" paddingX={1}>
      <Box>
        <Text color={colorHex} bold>● {label}</Text>
        {message.status === 'streaming' && (
          <Text color="gray" dimColor>{statusIndicator}</Text>
        )}
        {message.status === 'error' && (
          <Text color="red">{statusIndicator}</Text>
        )}
      </Box>
      <Box paddingLeft={2}>
        <Text wrap="wrap">{message.content || (message.status === 'streaming' ? '...' : '')}</Text>
      </Box>
    </Box>
  )
}
