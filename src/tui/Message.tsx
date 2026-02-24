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
      <Box paddingX={1} marginTop={0}>
        <Text color="gray" dimColor>  ◆ {message.content}</Text>
      </Box>
    )
  }

  if (isUser) {
    return (
      <Box flexDirection="column" paddingX={1} marginTop={1}>
        <Text color="white" bold>● You</Text>
        <Box paddingLeft={2}>
          <Text wrap="wrap">{message.content}</Text>
        </Box>
      </Box>
    )
  }

  // Agent message
  const agent = agents[message.from]
  const colorHex = agent ? getHex(agent.color) : '#ffffff'
  const label = agent?.label ?? message.from

  const isStreaming = message.status === 'streaming'
  const isError = message.status === 'error'

  // Show content — for streaming, show what we have so far
  let displayContent = message.content
  if (isStreaming && !displayContent) {
    displayContent = 'thinking...'
  }

  return (
    <Box flexDirection="column" paddingX={1} marginTop={1}>
      <Box>
        <Text color={colorHex} bold>● {label}</Text>
        {isStreaming && <Text color="gray"> ▍</Text>}
        {isError && <Text color="red"> ✗</Text>}
      </Box>
      <Box paddingLeft={2}>
        <Text wrap="wrap">{displayContent}</Text>
      </Box>
    </Box>
  )
}
