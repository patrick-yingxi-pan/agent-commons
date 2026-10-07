import type { ConversationSearchResponse } from '../../contract/conversationSearch.ts'

/** A cached/debounced answer is actionable only for the exact visible request. */
export function conversationSearchMatches(
  data: ConversationSearchResponse | undefined,
  query: string,
  offset: number,
): data is ConversationSearchResponse {
  return data !== undefined && data.query === query.trim().toLowerCase() && data.offset === offset
}

/** One focus outcome for all conversation hosts, including a disappeared turn. */
export function conversationFocusState(
  target: string | undefined,
  messages: ReadonlyArray<{ id: string }>,
  history?: { olderCursor?: string | null; loading: boolean; error: string | null },
): 'none' | 'ready' | 'loading' | 'error' | 'missing' {
  if (!target) return 'none'
  if (messages.some((message) => message.id === target)) return 'ready'
  if (history?.error) return 'error'
  if (history?.loading || history?.olderCursor) return 'loading'
  return 'missing'
}
