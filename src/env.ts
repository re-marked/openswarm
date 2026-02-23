import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * Load a .env file from the current working directory into process.env.
 * Skips comments, strips quotes, handles `export KEY=val`.
 * Does NOT override existing env vars.
 */
export function loadEnvFile(dir: string = process.cwd()): void {
  let content: string
  try {
    content = readFileSync(resolve(dir, '.env'), 'utf-8')
  } catch {
    return // No .env file — silently skip
  }

  for (const line of content.split('\n')) {
    const trimmed = line.trim()

    // Skip empty lines and comments
    if (!trimmed || trimmed.startsWith('#')) continue

    // Strip wrapping quotes from the entire line (Windows echo artifact)
    let unwrapped = trimmed
    if (
      (unwrapped.startsWith("'") && unwrapped.endsWith("'")) ||
      (unwrapped.startsWith('"') && unwrapped.endsWith('"'))
    ) {
      unwrapped = unwrapped.slice(1, -1)
    }

    // Strip optional `export ` prefix
    const stripped = unwrapped.startsWith('export ')
      ? unwrapped.slice(7)
      : unwrapped

    const eqIndex = stripped.indexOf('=')
    if (eqIndex === -1) continue

    const key = stripped.slice(0, eqIndex).trim()
    let value = stripped.slice(eqIndex + 1).trim()

    // Strip surrounding quotes (single or double)
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }

    // Don't override existing env vars
    if (process.env[key] === undefined) {
      process.env[key] = value
    }
  }
}
