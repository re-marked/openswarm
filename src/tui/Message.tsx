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

interface MessageProps {
  message: ChatMessage
  agents: Record<string, AgentConfig>
  isFirst: boolean
}

export function Message({ message, agents, isFirst }: MessageProps) {
  const isUser = message.from === 'user'
  const isSystem = message.from === 'system'

  if (isSystem) {
    return (
      <Box paddingX={1}>
        <Text color="gray" dimColor>  ◆ {message.content}</Text>
      </Box>
    )
  }

  const isStreaming = message.status === 'streaming'
  const isError = message.status === 'error'

  // Divider between messages
  const divider = !isFirst ? (
    <Box paddingX={1} marginTop={1}>
      <Text color="gray" dimColor>{'─'.repeat(60)}</Text>
    </Box>
  ) : null

  if (isUser) {
    return (
      <>
        {divider}
        <Box flexDirection="column" paddingX={1} marginBottom={1}>
          <Box>
            <Text wrap="truncate-end" color="white" bold>▶ You</Text>
          </Box>
          <Box paddingLeft={2} marginTop={0}>
            <Text wrap="wrap">{message.content}</Text>
          </Box>
        </Box>
      </>
    )
  }

  // Agent message
  const agent = agents[message.from]
  const colorHex = agent ? getHex(agent.color) : '#ffffff'
  const label = agent?.label ?? message.from

  let displayContent = message.content
  if (isStreaming && !displayContent) {
    displayContent = '...'
  }

  return (
    <>
      {divider}
      <Box flexDirection="column" paddingX={1} marginBottom={1}>
        <Box>
          <Text wrap="truncate-end" color={colorHex} bold>● {label}</Text>
          {isStreaming && <Text color="yellow"> ▍</Text>}
          {isError && <Text color="red"> ✗</Text>}
        </Box>
        <Box paddingLeft={2} marginTop={0}>
          {isStreaming ? (
            <Text wrap="wrap">{displayContent}</Text>
          ) : (
            <FormattedText>{displayContent}</FormattedText>
          )}
        </Box>
      </Box>
    </>
  )
}
