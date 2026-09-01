/** Lazy archive reads live outside the broad hooks barrel so ordinary first-load
 * conversations do not pay for the compaction recovery path. */
import type { Message, Page } from '../../contract/index.ts'
import { invalidate, useQuery, type QueryState } from './cache.ts'
import { apiGet } from './client.ts'
import { keys, paths } from './keys.ts'
import { COMPACTED_MESSAGE_PAGE_SIZE } from './sessionPaging.ts'

export function useCompactedMessages(
  id: string,
  cursor: string | undefined,
  enabled: boolean,
): QueryState<Page<Message>> {
  return useQuery(
    keys.sessionCompactedMessages(id, cursor),
    () => apiGet<Page<Message>>(paths.sessionCompactedMessages(id, { limit: COMPACTED_MESSAGE_PAGE_SIZE, cursor })),
    enabled && !!id,
  )
}

export function retryCompactedMessages(id: string, cursor?: string): void {
  invalidate(keys.sessionCompactedMessages(id, cursor))
}
