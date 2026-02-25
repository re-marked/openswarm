import React, { useState, useCallback } from 'react'
import { Box, Text, useInput } from 'ink'

interface InputBoxProps {
  onSubmit: (text: string) => void
  onQuit: () => void
}

export function InputBox({ onSubmit, onQuit }: InputBoxProps) {
  const [input, setInput] = useState('')
  const [history, setHistory] = useState<string[]>([])
  const [historyIndex, setHistoryIndex] = useState(-1)

  useInput(useCallback((inputChar: string, key: { return?: boolean; backspace?: boolean; delete?: boolean; upArrow?: boolean; downArrow?: boolean; escape?: boolean; ctrl?: boolean }) => {
    if (key.return) {
      const text = input.trim()
      if (!text) return

      if (text === '/quit' || text === '/exit') {
        onQuit()
        return
      }

      setHistory((prev) => [...prev, text])
      setHistoryIndex(-1)
      setInput('')
      onSubmit(text)
      return
    }

    if (key.backspace || key.delete) {
      setInput((prev) => prev.slice(0, -1))
      return
    }

    if (key.upArrow) {
      setHistoryIndex((prev) => {
        const newIdx = prev === -1 ? history.length - 1 : Math.max(0, prev - 1)
        if (newIdx >= 0 && newIdx < history.length) {
          setInput(history[newIdx])
        }
        return newIdx
      })
      return
    }

    if (key.downArrow) {
      setHistoryIndex((prev) => {
        const newIdx = prev + 1
        if (newIdx >= history.length) {
          setInput('')
          return -1
        }
        setInput(history[newIdx])
        return newIdx
      })
      return
    }

    if (key.escape) {
      setInput('')
      setHistoryIndex(-1)
      return
    }

    // Ctrl+C
    if (key.ctrl && inputChar === 'c') {
      onQuit()
      return
    }

    // Regular character input
    if (inputChar && !key.ctrl) {
      setInput((prev) => prev + inputChar)
    }
  }, [input, history, historyIndex, onSubmit, onQuit]))

  return (
    <Box borderStyle="single" borderTop={true} borderBottom={false} borderLeft={false} borderRight={false} paddingX={1}>
      <Text color="gray">&gt; </Text>
      {input ? (
        <>
          <Text>{input}</Text>
          <Text color="cyan">█</Text>
        </>
      ) : (
        <Text color="gray" dimColor>send a message. @mention to tag an agent. esc to stop debate.</Text>
      )}
    </Box>
  )
}
