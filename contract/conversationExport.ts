/** Maximum complete UTF-8 Markdown conversation export size. */
export const MAX_CONVERSATION_EXPORT_BYTES = 8 * 1024 * 1024

export interface ConversationExport {
  sessionId: string
  filename: string
  mediaType: 'text/markdown;charset=utf-8'
  content: string
  messageCount: number
  archivedMessageCount: number
}
