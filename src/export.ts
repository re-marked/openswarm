import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { SessionData } from './types.js'

/**
 * Export a session to a Markdown file.
 *
 * Format:
 * - # OpenSwarm Conversation header with metadata
 * - ## You sections for user messages
 * - ## AgentLabel sections for agent responses (from `done` events)
 * - Thread starts as blockquotes: > Thread: Agent A → Agent B
 * - Tool uses as italic: > *[tool_name]*
 * - Skips delta/thinking/connecting events
 */
export function exportToMarkdown(
  data: SessionData,
  agentLabels: Record<string, string>
): string {
  const lines: string[] = []

  // Header
  lines.push('# OpenSwarm Conversation')
  lines.push('')
  lines.push(`**Session**: ${data.meta.id}`)
  lines.push(`**Date**: ${new Date(data.meta.createdAt).toLocaleString()}`)
  lines.push(`**Agents**: ${data.config.agents.join(', ')}`)
  lines.push(`**Master**: ${data.config.master}`)
  lines.push('')
  lines.push('---')
  lines.push('')

  for (const { event } of data.events) {
    switch (event.type) {
      case 'user_message':
        lines.push(`## You`)
        lines.push('')
        lines.push(event.content)
        lines.push('')
        break

      case 'done': {
        const label = agentLabels[event.agent] ?? event.agent
        lines.push(`## ${label}`)
        lines.push('')
        lines.push(event.content)
        lines.push('')
        break
      }

      case 'thread_start': {
        const fromLabel = agentLabels[event.from] ?? event.from
        const toLabel = agentLabels[event.to] ?? event.to
        lines.push(`> Thread: ${fromLabel} → ${toLabel}`)
        lines.push('')
        break
      }

      case 'tool_start':
        lines.push(`> *[${event.toolName}]*`)
        lines.push('')
        break

      // Skip all other event types
      default:
        break
    }
  }

  return lines.join('\n')
}

/**
 * Write a session as markdown to a file in the current working directory.
 * Returns the absolute path of the written file.
 */
export function writeExport(
  data: SessionData,
  agentLabels: Record<string, string>
): string {
  const markdown = exportToMarkdown(data, agentLabels)
  const filename = `openswarm-${data.meta.id}.md`
  const filePath = resolve(process.cwd(), filename)
  writeFileSync(filePath, markdown, 'utf-8')
  return filePath
}
