import React from 'react'
import { Box, Text } from 'ink'
import { FormattedText } from './FormattedText.js'
import type { ChatMessage, AgentConfig } from '../types.js'

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

function formatTime(ts: number): string {
  const d = new Date(ts)
  const h = d.getHours().toString().padStart(2, '0')
  const m = d.getMinutes().toString().padStart(2, '0')
  return `${h}:${m}`
}

interface MessageProps {
  message: ChatMessage
  agents: Record<string, AgentConfig>
}

export function Message({ message, agents }: MessageProps) {
  const isUser = message.from === 'user'
  const isSystem = message.from === 'system'
  const time = formatTime(message.timestamp)

  if (isSystem) {
    return (
      <Box paddingX={1}>
        <Text color="gray" dimColor>  ◆ {message.content}</Text>
      </Box>
    )
  }

  if (isUser) {
    return (
      <Box flexDirection="column" paddingX={1} marginTop={1}>
        <Box>
          <Text color="white" bold>● User</Text>
          <Text color="gray"> · {time}</Text>
        </Box>
        <Box paddingLeft={2}>
          <Text wrap="wrap" backgroundColor="gray">{message.content}</Text>
        </Box>
      </Box>
    )
  }

  // Agent message
  const agent = agents[message.from]
  const colorHex = agent ? getHex(agent.color) : '#ffffff'
  const label = agent?.label ?? message.from
  const isError = message.status === 'error'

  return (
    <Box flexDirection="column" paddingX={1} marginTop={1}>
      <Box>
        <Text color={colorHex} bold>● {label}</Text>
        <Text color="gray"> · {time}</Text>
        {isError && <Text color="red"> ✗</Text>}
      </Box>
      <Box paddingLeft={2}>
        <FormattedText>{message.content}</FormattedText>
      </Box>
    </Box>
  )
}
