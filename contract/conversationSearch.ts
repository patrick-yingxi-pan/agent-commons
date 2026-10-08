import { literalSearchSnippet } from './literalSearch.ts'

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

function messageContainsQuery(message: ConversationSearchMessage, query: string): boolean {
  return (message.role === 'user' || message.role === 'assistant') &&
    typeof message.content === 'string' && message.content.toLowerCase().includes(query)
}

function projectConversationHit(message: ConversationSearchMessage, query: string): ConversationSearchHit | undefined {
  if (!messageContainsQuery(message, query)) return undefined
  const snippet = literalSearchSnippet(message.content, query, CONVERSATION_SEARCH_SNIPPET_CHARS)
  return snippet === undefined ? undefined : { messageId: message.id, role: message.role as 'user' | 'assistant', snippet }
}

/** Return the earliest eligible current-transcript match without scanning later messages. */
export function firstConversationMessageMatch(
  messages: Iterable<ConversationSearchMessage>,
  query: string,
): ConversationSearchHit | undefined {
  if (!query) return undefined
  for (const message of messages) {
    const hit = projectConversationHit(message, query)
    if (hit) return hit
  }
  return undefined
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
    if (!messageContainsQuery(message, query)) continue
    if (total >= offset && hits.length < CONVERSATION_SEARCH_PAGE_SIZE) {
      const hit = projectConversationHit(message, query)
      if (hit) hits.push(hit)
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
