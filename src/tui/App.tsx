import React, { useState, useEffect, useCallback, useRef } from 'react'
import { Box, Static, useApp } from 'ink'
import { StatusBar } from './StatusBar.js'
import { Message } from './Message.js'
import { AgentSidebar } from './AgentSidebar.js'
import { InputBox } from './InputBox.js'
import { TypingIndicator } from './TypingIndicator.js'
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
  const [agents, setAgents] = useState<Record<string, AgentConfig>>({ ...config.agents })
  const [activities, setActivities] = useState<Record<string, AgentActivity>>({})

  // Track pending agent messages (not displayed) so we can recover metadata on done
  const pendingMessages = useRef<Map<string, ChatMessage>>(new Map())

  useEffect(() => {
    const handler = (event: GroupChatEvent) => {
      switch (event.type) {
        case 'message_start': {
          if (event.message.from === 'user' || event.message.from === 'system') {
            setCompletedMessages((prev) => [...prev, { ...event.message }])
          } else {
            pendingMessages.current.set(event.message.id, { ...event.message, content: '' })
          }
          break
        }

        case 'message_delta':
          break

        case 'message_done': {
          const pending = pendingMessages.current.get(event.messageId)
          pendingMessages.current.delete(event.messageId)
          if (pending) {
            const content = stripSwarmContext(event.content)
            // Filter out gateway heartbeat responses
            if (/^HEARTBEAT[_\s]?OK$/i.test(content.trim())) break
            setCompletedMessages((prev) => [...prev, {
              ...pending,
              content,
              status: 'complete',
            }])
          }
          break
        }

        case 'message_error': {
          const pendingErr = pendingMessages.current.get(event.messageId)
          pendingMessages.current.delete(event.messageId)
          if (pendingErr) {
            setCompletedMessages((prev) => [...prev, {
              ...pendingErr,
              content: pendingErr.content || event.error,
              status: 'error',
            }])
          }
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
      {/* Messages scroll up naturally in terminal via Static */}
      <Static items={visibleCompleted}>
        {(msg) => (
          <Message key={msg.id} message={msg} agents={agents} />
        )}
      </Static>

      {/* Pinned bottom bar — always visible */}
      <Box flexDirection="row">
        <Box flexDirection="column" flexGrow={1}>
          <StatusBar />
          <TypingIndicator agents={agents} activities={activities} />
          <InputBox onSubmit={handleSubmit} onQuit={handleQuit} />
        </Box>
        <AgentSidebar agents={agents} activities={activities} master={config.master} />
      </Box>
    </Box>
  )
}
