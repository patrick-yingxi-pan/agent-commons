import type { Attachment } from './entities.ts'

/** One input budget shared by the composer and both model transports. Files are
 * included whole or omitted; a preview must never masquerade as a full import. */
export const ATTACHMENT_TEXT_FILE_BYTES = 64 * 1024
export const ATTACHMENT_TEXT_TOTAL_BYTES = 128 * 1024
export const ATTACHMENT_INPUT_MAX_ITEMS = 24

export type AttachmentInputStatus = 'ready' | 'preview-only' | 'unavailable' | 'too-large' | 'total-limit' | 'item-limit'
export interface AttachmentInputItem {
  attachment: Attachment
  status: AttachmentInputStatus
  bytes?: number
}

/** HTTP/legacy persistence are runtime boundaries despite the TypeScript type. */
export function isAttachmentInput(value: unknown): value is Attachment {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const item = value as Record<string, unknown>
  if (typeof item.id !== 'string' || !item.id || typeof item.label !== 'string' || !item.label) return false
  if (item.kind !== 'file' && item.kind !== 'photo') return false
  if (item.previewText !== undefined && typeof item.previewText !== 'string') return false
  if (item.previewUrl !== undefined && typeof item.previewUrl !== 'string') return false
  if (item.source !== undefined) {
    if (!item.source || typeof item.source !== 'object' || Array.isArray(item.source)) return false
    const source = item.source as Record<string, unknown>
    if (!['ui-host', 'cloud', 'runner'].includes(source.kind as string)) return false
    if (typeof source.id !== 'string' || !source.id || typeof source.label !== 'string') return false
  }
  return true
}

/** Resolve supplied local text only. A source-relative id or preview URL never
 * authorizes a backend filesystem read, remote fetch, or binary import. */
export function planAttachmentInput(attachments: readonly Attachment[] = []): AttachmentInputItem[] {
  let usedBytes = 0
  return attachments.map((attachment, index) => {
    if (!isAttachmentInput(attachment)) return { attachment, status: 'unavailable' }
    if (index >= ATTACHMENT_INPUT_MAX_ITEMS) return { attachment, status: 'item-limit' }
    if (attachment.kind !== 'file' || attachment.source?.kind !== 'ui-host') return { attachment, status: 'preview-only' }
    if (typeof attachment.previewText !== 'string') return { attachment, status: 'unavailable' }
    // A JS string has at least as many UTF-8 bytes as UTF-16 code units. Avoid
    // allocating an encoded copy of an already-obviously oversized payload.
    if (attachment.previewText.length > ATTACHMENT_TEXT_FILE_BYTES) return { attachment, status: 'too-large' }
    const bytes = new TextEncoder().encode(attachment.previewText).byteLength
    if (bytes > ATTACHMENT_TEXT_FILE_BYTES) return { attachment, status: 'too-large', bytes }
    if (usedBytes + bytes > ATTACHMENT_TEXT_TOTAL_BYTES) return { attachment, status: 'total-limit', bytes }
    usedBytes += bytes
    return { attachment, status: 'ready', bytes }
  })
}

export function attachmentInputCopy(status: AttachmentInputStatus): string {
  switch (status) {
    case 'ready': return 'Send and retry use the currently attached text for the selected model.'
    case 'preview-only': return 'Preview only. This attachment is not sent to the model.'
    case 'unavailable': return 'Not sent to the model. Reattach a readable text file up to 64 KB.'
    case 'too-large': return 'Not sent to the model. Text files must be 64 KB or smaller.'
    case 'total-limit': return 'Not sent to the model. Attached text exceeds the 128 KB message limit.'
    case 'item-limit': return 'Not sent to the model. Remove attachments to stay within the 24-item limit.'
  }
}
