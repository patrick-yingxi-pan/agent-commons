/** Extract the sole visible answer from a tool-free response. Recognized
 * provider reasoning is opaque, never answer text or execution authority.
 * Callers must meter usage and require a completed turn first, then apply
 * their task-specific bounded parser. Undefined means invalid content. */
export function toolFreeText(content: unknown): string | undefined {
  if (!Array.isArray(content)) return undefined
  let text: string | undefined
  for (const value of content) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
    const block = value as Record<string, unknown>
    if (block.type === 'text') {
      if (typeof block.text !== 'string' || text !== undefined) return undefined
      text = block.text
    } else if (block.type === 'thinking') {
      if (typeof block.thinking !== 'string' || typeof block.signature !== 'string') return undefined
    } else if (block.type === 'redacted_thinking') {
      if (typeof block.data !== 'string') return undefined
    } else return undefined
  }
  return text
}
