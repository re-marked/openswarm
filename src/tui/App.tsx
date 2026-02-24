import React, { useState, useEffect, useCallback } from 'react'
import { Box, useApp } from 'ink'
import { StatusBar } from './StatusBar.js'
import { MessageList } from './MessageList.js'
import { AgentSidebar } from './AgentSidebar.js'
import { InputBox } from './InputBox.js'
import type { GroupChat } from '../groupchat.js'
import type { ChatMessage, AgentActivity, AgentConfig, GroupChatEvent } from '../types.js'

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

  useEffect(() => {
    const handler = (event: GroupChatEvent) => {
      switch (event.type) {
        case 'message_start':
          setMessages((prev) => [...prev, event.message])
          break

        case 'message_delta':
          setMessages((prev) =>
            prev.map((m) =>
              m.id === event.messageId
                ? { ...m, content: m.content + event.content }
                : m
            )
          )
          break

        case 'message_done':
          setMessages((prev) =>
            prev.map((m) =>
              m.id === event.messageId
                ? { ...m, content: event.content, status: 'complete' as const }
                : m
            )
          )
          break

        case 'message_error':
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
          // Add system message
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

    // Send async — don't block the UI
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
