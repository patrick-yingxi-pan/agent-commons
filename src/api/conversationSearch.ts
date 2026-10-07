/** Optional transcript reads stay behind the conversation Find boundary. */
import type { ConversationSearchResponse } from '../../contract/conversationSearch.ts'
import { apiGet } from './client.ts'
import { invalidate, useQuery } from './cache.ts'
import { keys, paths } from './keys.ts'

export function useConversationSearch(id: string, query: string, offset: number) {
  return useQuery(
    keys.conversationSearch(id, query, offset),
    () => apiGet<ConversationSearchResponse>(paths.conversationSearch(id, query, offset)),
    query.length > 0,
    true,
  )
}

export function retryConversationSearch(id: string, query: string, offset: number): void {
  invalidate(keys.conversationSearch(id, query, offset))
}
