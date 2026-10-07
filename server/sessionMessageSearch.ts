import {
  parseConversationSearchQuery,
  searchConversationMessages,
  type ConversationSearchResponse,
} from '../contract/conversationSearch.ts'
import type { Session } from '../contract/entities.ts'

export { parseConversationSearchQuery }

/** Search only the live transcript field; compacted history and tool metadata are excluded. */
export function searchSessionMessages(
  session: Pick<Session, 'messages'>,
  query: string,
  offset: number,
): ConversationSearchResponse {
  return searchConversationMessages(session.messages ?? [], query, offset)
}
