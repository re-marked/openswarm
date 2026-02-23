import chalk from 'chalk'

/**
 * Render a complete markdown text block to terminal-formatted string.
 * Handles: headers, bold, italic, inline code, code blocks, lists.
 */
export function renderMarkdown(text: string): string {
  const lines = text.split('\n')
  const result: string[] = []
  let inCodeBlock = false
  let codeBlockLang = ''

  for (const line of lines) {
    // Code block fences
    if (line.trimStart().startsWith('```')) {
      if (!inCodeBlock) {
        inCodeBlock = true
        codeBlockLang = line.trimStart().slice(3).trim()
        result.push(chalk.dim(`  ┌─${ codeBlockLang ? ` ${codeBlockLang} ` : ''}${'─'.repeat(Math.max(0, 40 - codeBlockLang.length))}`))
      } else {
        inCodeBlock = false
        codeBlockLang = ''
        result.push(chalk.dim('  └' + '─'.repeat(42)))
      }
      continue
    }

    // Inside code block — dim, indented
    if (inCodeBlock) {
      result.push(chalk.dim('  │ ') + chalk.cyan(line))
      continue
    }

    // Headers
    const h3 = line.match(/^###\s+(.+)/)
    if (h3) {
      result.push(chalk.bold.underline(h3[1]))
      continue
    }
    const h2 = line.match(/^##\s+(.+)/)
    if (h2) {
      result.push(chalk.bold.underline(h2[1]))
      continue
    }
    const h1 = line.match(/^#\s+(.+)/)
    if (h1) {
      result.push(chalk.bold.underline(h1[1]))
      continue
    }

    // Regular line — apply inline formatting
    result.push(renderInline(line))
  }

  return result.join('\n')
}

/** Apply inline markdown formatting: bold, italic, inline code. */
function renderInline(text: string): string {
  // Inline code (must be first to prevent bold/italic inside code)
  text = text.replace(/`([^`]+)`/g, (_, code) => chalk.cyan(code))

  // Bold + italic (***text*** or ___text___)
  text = text.replace(/\*{3}([^*]+)\*{3}/g, (_, t) => chalk.bold.italic(t))
  text = text.replace(/_{3}([^_]+)_{3}/g, (_, t) => chalk.bold.italic(t))

  // Bold (**text** or __text__)
  text = text.replace(/\*{2}([^*]+)\*{2}/g, (_, t) => chalk.bold(t))
  text = text.replace(/_{2}([^_]+)_{2}/g, (_, t) => chalk.bold(t))

  // Italic (*text* or _text_) — careful not to match inside words
  text = text.replace(/(?<!\w)\*([^*]+)\*(?!\w)/g, (_, t) => chalk.italic(t))
  text = text.replace(/(?<!\w)_([^_]+)_(?!\w)/g, (_, t) => chalk.italic(t))

  // List bullets
  text = text.replace(/^(\s*)\*\s/, '$1• ')
  text = text.replace(/^(\s*)-\s/, '$1• ')

  return text
}
