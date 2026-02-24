import React, { useState, useEffect, useCallback, useRef } from 'react'
import { Box, Static, useApp } from 'ink'
import { StatusBar } from './StatusBar.js'
import { Message } from './Message.js'
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

  const [completedMessages, setCompletedMessages] = useState<ChatMessage[]>([])
  const [streamingMessages, setStreamingMessages] = useState<ChatMessage[]>([])
  const [agents, setAgents] = useState<Record<string, AgentConfig>>({ ...config.agents })
  const [activities, setActivities] = useState<Record<string, AgentActivity>>({})

  const deltaBuffers = useRef<Map<string, string>>(new Map())

  useEffect(() => {
    const timer = setInterval(() => {
      const buffers = deltaBuffers.current
      if (buffers.size === 0) return
      setStreamingMessages((prev) => {
        let updated = prev
        for (const [msgId, newContent] of buffers) {
          updated = updated.map((m) =>
            m.id === msgId ? { ...m, content: newContent } : m
          )
        }
        return updated
      })
      buffers.clear()
    }, 200)
    return () => clearInterval(timer)
  }, [])

  useEffect(() => {
    const handler = (event: GroupChatEvent) => {
      switch (event.type) {
        case 'message_start': {
          const msg = { ...event.message, content: '' }
          if (msg.from === 'user' || msg.from === 'system') {
            setCompletedMessages((prev) => [...prev, { ...event.message }])
          } else {
            setStreamingMessages((prev) => [...prev, msg])
          }
          break
        }

        case 'message_delta': {
          const buf = deltaBuffers.current
          const existing = buf.get(event.messageId) ?? ''
          buf.set(event.messageId, existing + event.content)
          break
        }

        case 'message_done': {
          deltaBuffers.current.delete(event.messageId)
          setStreamingMessages((prev) => {
            const msg = prev.find((m) => m.id === event.messageId)
            if (msg) {
              setCompletedMessages((cp) => [...cp, {
                ...msg,
                content: stripSwarmContext(event.content),
                status: 'complete',
              }])
            }
            return prev.filter((m) => m.id !== event.messageId)
          })
          break
        }

        case 'message_error': {
          deltaBuffers.current.delete(event.messageId)
          setStreamingMessages((prev) => {
            const msg = prev.find((m) => m.id === event.messageId)
            if (msg) {
              setCompletedMessages((cp) => [...cp, {
                ...msg,
                status: 'error',
                content: msg.content || event.error,
              }])
            }
            return prev.filter((m) => m.id !== event.messageId)
          })
          break
        }

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
          setCompletedMessages((prev) => [...prev, {
            id: `sys-${Date.now()}`,
            timestamp: Date.now(),
            from: 'system',
            content: `Spawned ${event.label} (@${event.agent})`,
            status: 'complete' as const,
          }])
          break
        }

        case 'system':
          break
      }
    }

    groupChat.on('event', handler)
    return () => { groupChat.removeListener('event', handler) }
  }, [groupChat])

  const handleSubmit = useCallback((text: string) => {
    if (text === '/clear') {
      setCompletedMessages([])
      setStreamingMessages([])
      return
    }
    if (text === '/status') {
      const status = groupChat.getConnectionStatus()
      const lines: string[] = []
      for (const [name, connected] of status) {
        const agent = agents[name]
        lines.push(`${agent?.label ?? name}: ${connected ? 'connected' : 'disconnected'}`)
      }
      setCompletedMessages((prev) => [...prev, {
        id: `sys-${Date.now()}`,
        timestamp: Date.now(),
        from: 'system',
        content: lines.join('\n'),
        status: 'complete' as const,
      }])
      return
    }

    groupChat.sendUserMessage(text).catch((err) => {
      setCompletedMessages((prev) => [...prev, {
        id: `err-${Date.now()}`,
        timestamp: Date.now(),
        from: 'system',
        content: `Error: ${err instanceof Error ? err.message : String(err)}`,
        status: 'error' as const,
      }])
    })
  }, [groupChat, agents])

  const handleQuit = useCallback(() => {
    groupChat.close()
    exit()
  }, [groupChat, exit])

  const visibleCompleted = completedMessages.filter((m) => {
    if (m.from !== 'system') return true
    if (m.content.startsWith('Spawned ')) return true
    if (m.content.startsWith('Error')) return true
    return false
  })

  return (
    <Box flexDirection="column">
      {/* Completed messages — scroll up naturally in terminal */}
      <Static items={visibleCompleted}>
        {(msg, index) => (
          <Message key={msg.id} message={msg} agents={agents} isFirst={index === 0} />
        )}
      </Static>

      {/* Dynamic area: streaming messages + input + sidebar */}
      {streamingMessages.map((msg, index) => (
        <Message
          key={msg.id}
          message={msg}
          agents={agents}
          isFirst={visibleCompleted.length === 0 && index === 0}
        />
      ))}

      <Box>
        <Box flexGrow={1} flexDirection="column">
          <StatusBar
            gatewayPort={config.gateway.port}
            agentCount={Object.keys(agents).length}
            sessionId={sessionId}
          />
          <InputBox onSubmit={handleSubmit} onQuit={handleQuit} />
        </Box>
        <AgentSidebar agents={agents} activities={activities} master={config.master} />
      </Box>
    </Box>
  )
}
