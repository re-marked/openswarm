import React from 'react'
import { Box, Text } from 'ink'
import type { AgentConfig, AgentActivity } from '../types.js'

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

interface AgentSidebarProps {
  agents: Record<string, AgentConfig>
  activities: Record<string, AgentActivity>
  master: string
}

export function AgentSidebar({ agents, activities, master }: AgentSidebarProps) {
  const count = Object.keys(agents).length

  return (
    <Box flexDirection="column" width={22} borderStyle="single" borderLeft={true} borderTop={false} borderBottom={false} borderRight={false} paddingX={1}>
      <Text bold>{count} agents here ●</Text>
      {Object.entries(agents).map(([name, agent]) => {
        const activity = activities[name] ?? 'idle'
        const isActive = activity !== 'idle'
        const colorHex = getHex(agent.color)
        const dot = isActive ? '●' : '○'
        const badge = name === master ? ' ★ M' : ''
        const typing = isActive ? '...typing' : ''

        return (
          <Box key={name}>
            <Text color={colorHex}>{dot} </Text>
            <Text color={colorHex} bold>{agent.label}{badge}</Text>
            {typing ? <Text color="gray" dimColor>{typing}</Text> : null}
          </Box>
        )
      })}
    </Box>
  )
}
