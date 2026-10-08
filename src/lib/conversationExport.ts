import { artifactExportFilename } from '../../contract/artifactExport.ts'
import { MAX_CONVERSATION_EXPORT_BYTES, type ConversationExport } from '../../contract/conversationExport.ts'
import type { DownloadBlobDescriptor } from './downloadText.ts'

/** Validate the fresh descriptor before handing any bytes to the save flow. */
export function decodeConversationExport(file: unknown, sessionId: string): DownloadBlobDescriptor {
  if (!file || typeof file !== 'object' || Array.isArray(file)) throw new Error('Unexpected conversation descriptor')
  const candidate = file as Partial<ConversationExport>
  if (candidate.sessionId !== sessionId) throw new Error('Unexpected conversation identity')
  if (candidate.mediaType !== 'text/markdown;charset=utf-8') throw new Error('Unexpected conversation format')
  if (typeof candidate.filename !== 'string' || candidate.filename.length > 244
    || artifactExportFilename(candidate.filename, 'markdown') !== candidate.filename) throw new Error('Unsafe conversation filename')
  if (!Number.isSafeInteger(candidate.messageCount) || candidate.messageCount! < 0
    || !Number.isSafeInteger(candidate.archivedMessageCount) || candidate.archivedMessageCount! < 0
    || candidate.archivedMessageCount! > candidate.messageCount!) throw new Error('Unexpected conversation counts')
  if (typeof candidate.content !== 'string' || candidate.content.length > MAX_CONVERSATION_EXPORT_BYTES
    || new TextEncoder().encode(candidate.content).byteLength > MAX_CONVERSATION_EXPORT_BYTES) throw new Error('Conversation export is too large')
  return { filename: candidate.filename, mediaType: candidate.mediaType, content: candidate.content }
}
