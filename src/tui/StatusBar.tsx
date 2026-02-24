import React from 'react'
import { Box, Text } from 'ink'

interface StatusBarProps {
  gatewayPort: number
  agentCount: number
  sessionId: string
}

export function StatusBar({ gatewayPort, agentCount, sessionId }: StatusBarProps) {
  return (
    <Box borderStyle="single" borderBottom={true} borderTop={false} borderLeft={false} borderRight={false} paddingX={1}>
      <Text bold color="cyan">OpenSwarm</Text>
      <Text color="gray"> · </Text>
      <Text color="gray">gateway :{gatewayPort}</Text>
      <Text color="gray"> · </Text>
      <Text color="gray">{agentCount} agent{agentCount !== 1 ? 's' : ''}</Text>
      <Text color="gray"> · </Text>
      <Text color="gray">session {sessionId}</Text>
    </Box>
  )
}
