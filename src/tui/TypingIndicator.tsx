import React from 'react'
import { Box, Text } from 'ink'
import type { AgentConfig, AgentActivity } from '../types.js'

interface TypingIndicatorProps {
  agents: Record<string, AgentConfig>
  activities: Record<string, AgentActivity>
}

export function TypingIndicator({ agents, activities }: TypingIndicatorProps) {
  const typingNames = Object.entries(activities)
    .filter(([, activity]) => activity !== 'idle')
    .map(([name]) => `@${agents[name]?.label ?? name}`)

  if (typingNames.length === 0) return null

  let text: string
  if (typingNames.length === 1) {
    text = `...${typingNames[0]} is typing.`
  } else if (typingNames.length === 2) {
    text = `...${typingNames[0]} and ${typingNames[1]} are typing.`
  } else {
    const last = typingNames.pop()!
    text = `...${typingNames.join(', ')}, and ${last} are typing.`
  }

  return (
    <Box paddingX={1}>
      <Text color="gray" dimColor>{text}</Text>
    </Box>
  )
}
