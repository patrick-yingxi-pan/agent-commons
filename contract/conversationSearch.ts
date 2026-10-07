/** Bounded text search over the current readable transcript of one conversation. */
export const MAX_CONVERSATION_SEARCH_QUERY_CHARS = 256
export const CONVERSATION_SEARCH_PAGE_SIZE = 20
export const CONVERSATION_SEARCH_SNIPPET_CHARS = 320

export interface ConversationSearchHit {
  messageId: string
  role: 'user' | 'assistant'
  snippet: string
}

export interface ConversationSearchResponse {
  /** Trimmed, lowercased query echoed from the request. */
  query: string
  offset: number
  total: number
  hits: ConversationSearchHit[]
}

export interface ConversationSearchMessage {
  id: string
  role: string
  content: string
}

export function parseConversationSearchQuery(q: string | undefined, offset: string | undefined): { query: string; offset: number } | null {
  if (q === undefined) return null
  const trimmed = q.trim()
  if (trimmed.length > MAX_CONVERSATION_SEARCH_QUERY_CHARS) return null
  const query = trimmed.toLowerCase()
  if (offset === undefined) return { query, offset: 0 }
  if (!/^(0|[1-9]\d*)$/.test(offset)) return null
  const parsed = Number(offset)
  if (!Number.isSafeInteger(parsed)) return null
  return { query, offset: parsed }
}

function sourceSpanForLowerRange(content: string, lowerStart: number, lowerEnd: number): { start: number; end: number } {
  let lowerAt = 0
  let sourceAt = 0
  let sourceStart: number | undefined
  for (const character of content) {
    // Lowercasing a full string can change values contextually (Greek final
    // sigma), but its UTF-16 width remains the sum of per-codepoint widths.
    const lowerWidth = character.toLowerCase().length
    const nextLowerAt = lowerAt + lowerWidth
    if (sourceStart === undefined && lowerAt < lowerEnd && nextLowerAt > lowerStart) sourceStart = sourceAt
    if (sourceStart !== undefined && nextLowerAt >= lowerEnd) return { start: sourceStart, end: sourceAt + character.length }
    lowerAt += lowerWidth
    sourceAt += character.length
  }
  return { start: sourceAt, end: sourceAt }
}

function snippetFor(content: string, matchAt: number, matchEnd: number): string {
  const max = CONVERSATION_SEARCH_SNIPPET_CHARS
  if (content.length <= max) return content
  // Reserve space for both possible ellipses. Usually the full match fits;
  // Unicode expansion can exceed the original query width, so a longer source
  // match retains its beginning instead of moving the snippet past it.
  const window = max - 2
  const matchLength = matchEnd - matchAt
  const before = Math.max(0, Math.min(80, Math.floor((window - matchLength) / 2)))
  const left = Math.max(0, Math.min(matchAt - before, content.length - window))
  const right = Math.min(content.length, left + window)
  return `${left > 0 ? '…' : ''}${content.slice(left, right)}${right < content.length ? '…' : ''}`
}

/** Search only current user/assistant content, preserving transcript order. */
export function searchConversationMessages(
  messages: readonly ConversationSearchMessage[],
  query: string,
  offset: number,
): ConversationSearchResponse {
  if (!query) return { query, offset, total: 0, hits: [] }
  const hits: ConversationSearchHit[] = []
  let total = 0
  for (const message of messages) {
    if ((message.role !== 'user' && message.role !== 'assistant') || typeof message.content !== 'string') continue
    const lowerAt = message.content.toLowerCase().indexOf(query)
    if (lowerAt < 0) continue
    if (total >= offset && hits.length < CONVERSATION_SEARCH_PAGE_SIZE) {
      const span = sourceSpanForLowerRange(message.content, lowerAt, lowerAt + query.length)
      hits.push({
        messageId: message.id,
        role: message.role,
        snippet: snippetFor(message.content, span.start, span.end),
      })
    }
    total += 1
  }
  return {
    query,
    offset,
    total,
    hits,
  }
}
