import React, { useState, useEffect, useCallback, useRef } from 'react'
import { Box, useApp } from 'ink'
import { StatusBar } from './StatusBar.js'
import { MessageList } from './MessageList.js'
import { AgentSidebar } from './AgentSidebar.js'
import { InputBox } from './InputBox.js'
import type { GroupChat } from '../groupchat.js'
import type { ChatMessage, AgentActivity, AgentConfig, GroupChatEvent } from '../types.js'

/** Strip [SWARM CONTEXT] blocks from displayed content. */
function stripSwarmContext(text: string): string {
  return text.replace(/\[SWARM CONTEXT\][\s\S]*?---\n?/g, '').trim()
}

interface AppProps {
  groupChat: GroupChat
  sessionId: string
}

export function App({ groupChat, sessionId }: AppProps) {
  const { exit } = useApp()
  const config = groupChat.getConfig()

  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [agents, setAgents] = useState<Record<string, AgentConfig>>({ ...config.agents })
  const [activities, setActivities] = useState<Record<string, AgentActivity>>({})

  // Accumulate deltas in a ref (no re-render per token), flush on a timer
  const deltaBuffers = useRef<Map<string, string>>(new Map())
  const flushTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Flush buffered deltas into React state every 150ms
  useEffect(() => {
    flushTimerRef.current = setInterval(() => {
      const buffers = deltaBuffers.current
      if (buffers.size === 0) return

      setMessages((prev) => {
        let updated = prev
        for (const [msgId, newContent] of buffers) {
          updated = updated.map((m) =>
            m.id === msgId ? { ...m, content: newContent } : m
          )
        }
        return updated
      })
      buffers.clear()
    }, 150)

    return () => {
      if (flushTimerRef.current) clearInterval(flushTimerRef.current)
    }
  }, [])

  useEffect(() => {
    const handler = (event: GroupChatEvent) => {
      switch (event.type) {
        case 'message_start':
          setMessages((prev) => [...prev, { ...event.message, content: '' }])
          break

        case 'message_delta': {
          // Buffer deltas — don't trigger a React render per token
          const buf = deltaBuffers.current
          const existing = buf.get(event.messageId) ?? ''
          buf.set(event.messageId, existing + event.content)
          break
        }

        case 'message_done':
          // Clear any pending delta buffer for this message
          deltaBuffers.current.delete(event.messageId)
          setMessages((prev) =>
            prev.map((m) =>
              m.id === event.messageId
                ? { ...m, content: stripSwarmContext(event.content), status: 'complete' as const }
                : m
            )
          )
          break

        case 'message_error':
          deltaBuffers.current.delete(event.messageId)
          setMessages((prev) =>
            prev.map((m) =>
              m.id === event.messageId
                ? { ...m, status: 'error' as const, content: m.content || event.error }
                : m
            )
          )
          break

        case 'agent_status':
          setActivities((prev) => ({ ...prev, [event.agent]: event.activity }))
          break

        case 'agent_spawned': {
          const newAgent: AgentConfig = {
            agentId: event.agent,
            label: event.label,
            color: event.color,
          }
          setAgents((prev) => ({ ...prev, [event.agent]: newAgent }))
          const sysMsg: ChatMessage = {
            id: `sys-${Date.now()}`,
            timestamp: Date.now(),
            from: 'system',
            content: `Spawned ${event.label} (@${event.agent})`,
            status: 'complete',
          }
          setMessages((prev) => [...prev, sysMsg])
          break
        }

        case 'system': {
          const sysMsg: ChatMessage = {
            id: `sys-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            timestamp: Date.now(),
            from: 'system',
            content: event.text,
            status: 'complete',
          }
          setMessages((prev) => [...prev, sysMsg])
          break
        }
      }
    }

    groupChat.on('event', handler)
    return () => { groupChat.removeListener('event', handler) }
  }, [groupChat])

  const handleSubmit = useCallback((text: string) => {
    if (text === '/clear') {
      setMessages([])
      return
    }
    if (text === '/status') {
      const status = groupChat.getConnectionStatus()
      const lines: string[] = []
      for (const [name, connected] of status) {
        const agent = agents[name]
        lines.push(`${agent?.label ?? name}: ${connected ? 'connected' : 'disconnected'}`)
      }
      const sysMsg: ChatMessage = {
        id: `sys-${Date.now()}`,
        timestamp: Date.now(),
        from: 'system',
        content: lines.join('\n'),
        status: 'complete',
      }
      setMessages((prev) => [...prev, sysMsg])
      return
    }

    groupChat.sendUserMessage(text).catch((err) => {
      const errorMsg: ChatMessage = {
        id: `err-${Date.now()}`,
        timestamp: Date.now(),
        from: 'system',
        content: `Error: ${err instanceof Error ? err.message : String(err)}`,
        status: 'error',
      }
      setMessages((prev) => [...prev, errorMsg])
    })
  }, [groupChat, agents])

  const handleQuit = useCallback(() => {
    groupChat.close()
    exit()
  }, [groupChat, exit])

  return (
    <Box flexDirection="column" height={process.stdout.rows || 24}>
      <StatusBar
        gatewayPort={config.gateway.port}
        agentCount={Object.keys(agents).length}
        sessionId={sessionId}
      />

      <Box flexGrow={1} flexDirection="row">
        <MessageList messages={messages} agents={agents} />
        <AgentSidebar agents={agents} activities={activities} master={config.master} />
      </Box>

      <InputBox onSubmit={handleSubmit} onQuit={handleQuit} />
    </Box>
  )
}
