import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { SessionData } from './types.js'

/**
 * Export a session to a Markdown file.
 *
 * Format: flat chat log with ## headers per speaker.
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

  for (const message of data.messages) {
    if (message.from === 'system') {
      lines.push(`> *${message.content}*`)
      lines.push('')
      continue
    }

    if (message.from === 'user') {
      lines.push('## You')
    } else {
      const label = agentLabels[message.from] ?? message.from
      lines.push(`## ${label}`)
    }
    lines.push('')
    lines.push(message.content)
    lines.push('')
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
