/** Generate a short random ID for request correlation. */
export function generateId(): string {
  return Math.random().toString(36).slice(2, 10)
}

/** Sleep for the given number of milliseconds. */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
