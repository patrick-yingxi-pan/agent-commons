import type { ConversationExport } from '../../contract/conversationExport.ts'
import { apiGet } from './client.ts'
import { paths } from './keys.ts'

/** Downloads always recheck access; no query cache can authorize an export. */
export function readConversationExport(id: string, signal: AbortSignal): Promise<ConversationExport> {
  return apiGet<ConversationExport>(paths.sessionExport(id), { signal })
}
