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

const ACTIVITY_LABELS: Record<AgentActivity, string> = {
  idle: 'idle',
  thinking: 'thinking...',
  writing: 'writing...',
  tool_use: 'using tool...',
  error: 'error',
}

interface AgentSidebarProps {
  agents: Record<string, AgentConfig>
  activities: Record<string, AgentActivity>
  master: string
}

export function AgentSidebar({ agents, activities, master }: AgentSidebarProps) {
  return (
    <Box flexDirection="column" width={22} borderStyle="single" borderLeft={true} borderTop={false} borderBottom={false} borderRight={false} paddingX={1}>
      <Text bold underline>Agents</Text>
      {Object.entries(agents).map(([name, agent]) => {
        const activity = activities[name] ?? 'idle'
        const isActive = activity !== 'idle'
        const colorHex = getHex(agent.color)
        const dot = isActive ? '●' : '○'
        const role = name === master ? ' ★' : ''

        return (
          <Box key={name} flexDirection="column">
            <Box>
              <Text color={colorHex}>{dot} </Text>
              <Text color={colorHex} bold>{agent.label}{role}</Text>
            </Box>
            {isActive && (
              <Text color="gray" dimColor>{'  '}{ACTIVITY_LABELS[activity]}</Text>
            )}
          </Box>
        )
      })}
    </Box>
  )
}
