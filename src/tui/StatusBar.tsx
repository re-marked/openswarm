import React from 'react'
import { Box, Text } from 'ink'

export function StatusBar() {
  return (
    <Box borderStyle="single" borderBottom={true} borderTop={false} borderLeft={false} borderRight={false} paddingX={1}>
      <Text bold color="cyan">OPENSWARM</Text>
      <Text color="gray"> — </Text>
      <Text color="cyan">THE DISCORD FOR YOUR OPENCLAW AI AGENTS</Text>
    </Box>
  )
}
