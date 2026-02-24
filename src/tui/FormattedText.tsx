import React from 'react'
import { Text, Box } from 'ink'

/**
 * Render markdown-formatted text as ink <Text> elements.
 * Supports: bold, italic, inline code, code blocks, headers, lists.
 * Works like Discord markdown rendering.
 */
export function FormattedText({ children: text }: { children: string }) {
  if (!text) return null

  const lines = text.split('\n')
  const elements: React.ReactNode[] = []
  let inCodeBlock = false
  let codeBlockLines: string[] = []
  let codeBlockLang = ''

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]

    // Code block fences
    if (line.trimStart().startsWith('```')) {
      if (!inCodeBlock) {
        inCodeBlock = true
        codeBlockLang = line.trimStart().slice(3).trim()
        codeBlockLines = []
      } else {
        // End code block — render it
        elements.push(
          <Box key={`cb-${i}`} flexDirection="column" marginY={0}>
            <Text color="gray" dimColor>{'  ┌─'}{codeBlockLang ? ` ${codeBlockLang} ` : ''}{'─'.repeat(Math.max(0, 40 - codeBlockLang.length))}</Text>
            {codeBlockLines.map((cl, j) => (
              <Text key={j}><Text color="gray" dimColor>{'  │ '}</Text><Text color="cyan">{cl}</Text></Text>
            ))}
            <Text color="gray" dimColor>{'  └'}{'─'.repeat(42)}</Text>
          </Box>
        )
        inCodeBlock = false
        codeBlockLang = ''
        codeBlockLines = []
      }
      continue
    }

    if (inCodeBlock) {
      codeBlockLines.push(line)
      continue
    }

    // Headers
    const h = line.match(/^(#{1,3})\s+(.+)/)
    if (h) {
      elements.push(<Text key={i} bold underline>{h[2]}</Text>)
      continue
    }

    // Empty line
    if (!line.trim()) {
      elements.push(<Text key={i}>{' '}</Text>)
      continue
    }

    // Regular line with inline formatting
    elements.push(<InlineLine key={i} text={line} />)
  }

  // Unclosed code block
  if (inCodeBlock && codeBlockLines.length > 0) {
    elements.push(
      <Box key="cb-unclosed" flexDirection="column">
        <Text color="gray" dimColor>{'  ┌─'}{codeBlockLang ? ` ${codeBlockLang} ` : ''}{'─'.repeat(Math.max(0, 40 - codeBlockLang.length))}</Text>
        {codeBlockLines.map((cl, j) => (
          <Text key={j}><Text color="gray" dimColor>{'  │ '}</Text><Text color="cyan">{cl}</Text></Text>
        ))}
      </Box>
    )
  }

  return <Box flexDirection="column">{elements}</Box>
}

/** Render a single line with inline markdown: bold, italic, code, lists. */
function InlineLine({ text }: { text: string }) {
  // List bullets
  const listMatch = text.match(/^(\s*)[*-]\s(.*)/)
  if (listMatch) {
    return <Text wrap="wrap">{listMatch[1]}• <InlineSegments text={listMatch[2]} /></Text>
  }

  return <Text wrap="wrap"><InlineSegments text={text} /></Text>
}

/**
 * Parse inline markdown and return styled <Text> segments.
 * Order: inline code → bold+italic → bold → italic
 */
function InlineSegments({ text }: { text: string }) {
  // Split on inline code first (backticks), then process remaining segments
  const parts: React.ReactNode[] = []
  let remaining = text
  let keyIdx = 0

  // Process inline code: `code`
  while (remaining.length > 0) {
    const codeMatch = remaining.match(/`([^`]+)`/)
    if (!codeMatch || codeMatch.index === undefined) {
      parts.push(<StyledSegments key={keyIdx++} text={remaining} />)
      break
    }

    // Text before code
    if (codeMatch.index > 0) {
      parts.push(<StyledSegments key={keyIdx++} text={remaining.slice(0, codeMatch.index)} />)
    }

    // Code segment
    parts.push(
      <Text key={keyIdx++} color="cyan" backgroundColor="#1a1a2e">{codeMatch[1]}</Text>
    )

    remaining = remaining.slice(codeMatch.index + codeMatch[0].length)
  }

  return <>{parts}</>
}

/** Process bold/italic markdown in a text segment (no code). */
function StyledSegments({ text }: { text: string }) {
  const parts: React.ReactNode[] = []
  let remaining = text
  let keyIdx = 0

  // Combined regex for bold+italic (***), bold (**), italic (*)
  const pattern = /(\*{3})((?:(?!\1).)+)\1|(\*{2})((?:(?!\3).)+)\3|(\*)((?:(?!\5).)+)\5/

  while (remaining.length > 0) {
    const match = remaining.match(pattern)
    if (!match || match.index === undefined) {
      parts.push(<Text key={keyIdx++}>{remaining}</Text>)
      break
    }

    // Text before match
    if (match.index > 0) {
      parts.push(<Text key={keyIdx++}>{remaining.slice(0, match.index)}</Text>)
    }

    if (match[1] === '***') {
      // Bold + italic
      parts.push(<Text key={keyIdx++} bold italic>{match[2]}</Text>)
    } else if (match[3] === '**') {
      // Bold
      parts.push(<Text key={keyIdx++} bold>{match[4]}</Text>)
    } else if (match[5] === '*') {
      // Italic
      parts.push(<Text key={keyIdx++} italic>{match[6]}</Text>)
    }

    remaining = remaining.slice(match.index + match[0].length)
  }

  return <>{parts}</>
}
