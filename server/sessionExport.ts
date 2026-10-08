import { artifactExportFilename } from '../contract/artifactExport.ts'
import { MAX_CONVERSATION_EXPORT_BYTES, type ConversationExport } from '../contract/conversationExport.ts'
import type { Session, Message } from '../contract/entities.ts'

export type SessionMarkdownExportResult =
  | { ok: true; value: ConversationExport }
  | { ok: false; error: 'too_large'; maxBytes: typeof MAX_CONVERSATION_EXPORT_BYTES }

function safeHeading(title: string): string {
  const oneLine = title.replace(/[\r\n\u2028\u2029]+/gu, ' ').replace(/[\t\u0000-\u001f\u007f-\u009f]/gu, ' ')
  return [...oneLine].map((char) => '#\\`*_{}[]()<>!|'.includes(char) ? `\\${char}` : char).join('').trim() || 'Conversation'
}

/** Build a bounded Markdown projection from one already-authorized saved Session snapshot. */
export function sessionMarkdownExport(session: Session): SessionMarkdownExportResult {
  const archived = (session.compactedMessages ?? []).filter((message) => message.role === 'user' || message.role === 'assistant')
  const current = (session.messages ?? []).filter((message) => message.role === 'user' || message.role === 'assistant')
  const parts: string[] = []
  let totalBytes = 0
  const append = (part: string): boolean => {
    totalBytes += Buffer.byteLength(part, 'utf8')
    if (totalBytes > MAX_CONVERSATION_EXPORT_BYTES) return false
    parts.push(part)
    return true
  }
  const appendSection = (title: string, messages: readonly Message[], isCurrent: boolean, emptyText: string): boolean => {
    if (!append(`\n\n## ${title}\n\n`)) return false
    if (!messages.length) return append(`_${emptyText}_`)
    for (let index = 0; index < messages.length; index += 1) {
      const message = messages[index]
      if (index > 0 && !append('\n\n')) return false
      const label = isCurrent && message.compactedFrom != null ? 'Compaction summary' : message.role === 'user' ? 'User' : 'Assistant'
      // Speaker labels belong to the export, never to authored Markdown/HTML.
      // Bound the body before scanning or allocating its collision-free fence.
      if (Buffer.byteLength(message.content, 'utf8') > MAX_CONVERSATION_EXPORT_BYTES - totalBytes) return false
      let fenceLength = 3
      for (const run of message.content.matchAll(/`+/g)) fenceLength = Math.max(fenceLength, run[0].length + 1)
      if (fenceLength * 2 > MAX_CONVERSATION_EXPORT_BYTES - totalBytes) return false
      const fence = '`'.repeat(fenceLength)
      if (!append(`### ${label}\n\n${fence}text\n`) || !append(message.content) || !append(`\n${fence}`)) return false
    }
    return true
  }
  if (!append(`# ${safeHeading(session.title)}`) ||
    !appendSection('Archived messages', archived, false, 'No archived messages retained.') ||
    !appendSection('Current messages', current, true, 'No current messages.') ||
    !append('\n')) {
    return { ok: false, error: 'too_large', maxBytes: MAX_CONVERSATION_EXPORT_BYTES }
  }
  const content = parts.join('')
  return {
    ok: true,
    value: {
      sessionId: session.id,
      filename: artifactExportFilename(session.title, 'markdown'),
      mediaType: 'text/markdown;charset=utf-8',
      content,
      messageCount: archived.length + current.length,
      archivedMessageCount: archived.length,
    },
  }
}
