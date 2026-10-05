import type { Attachment, SessionWorkspace } from './entities.ts'
import { isDocumentImportOutcome } from './documentImport.mjs'
import { isImageAssetRef } from './imageAssets.ts'
import { IMAGE_MAX_COUNT, IMAGE_TURN_MAX_BYTES } from './imageInput.ts'
import { isServedTextSnapshot } from './servedTextSnapshot.ts'
import { fsRecentKey } from './fs.ts'
import { workspaceArtifacts } from './workspaceFolders.ts'
import type { DocumentImportOutcome } from './documentImport.mjs'

/** One ordered input projection for the composer, previews and both transports.
 * Folder bodies are durable snapshots, never a request to read a path. Direct
 * attachments come first; all sources then share the same message budget. */
export function workspaceInputAttachments(workspace?: Pick<SessionWorkspace, 'attachments' | 'workspaces'>): Attachment[] {
  if (!workspace) return []
  const imported = (workspace.workspaces ?? []).flatMap((folder) =>
    (Array.isArray(folder?.artifacts) ? folder.artifacts : []).flatMap((artifact): Attachment[] => {
      if (!artifact?.localSnapshot || typeof artifact.source?.id !== 'string' ||
          !artifact.source.id.startsWith('ui-host::') || typeof artifact.source.label !== 'string' ||
          typeof artifact.name !== 'string') return []
      return [{
        id: artifact.id,
        label: `${artifact.source.label}${artifact.name}`,
        kind: 'file',
        source: { id: 'ui-host', kind: 'ui-host', label: 'This computer' },
        previewText: artifact.localSnapshot.text,
      }]
    }))
  const served = (workspace.workspaces ?? []).flatMap((folder) =>
    (!folder || typeof folder !== 'object' ? [] : workspaceArtifacts(folder)).flatMap((artifact): Attachment[] => {
      if (!artifact || typeof artifact !== 'object') return []
      const snapshot = artifact.savedFolderSnapshot
      const folderSnapshot = folder.folders?.find((item) => item.id === artifact.source?.id)?.snapshot
      if (!folderSnapshot || !snapshot || typeof artifact.name !== 'string') return []
      const path = `${folderSnapshot.path}/${artifact.name}`
      const attachment: Attachment = {
        id: fsRecentKey(folderSnapshot.sourceId, path), label: `${artifact.source?.label ?? ''}${artifact.name}`,
        kind: 'file', source: { id: folderSnapshot.sourceId, kind: folderSnapshot.sourceId === 'cloud' ? 'cloud' : 'runner', label: folderSnapshot.sourceId },
        ...(typeof snapshot.text === 'string' ? { textSnapshot: { version: 1 as const, snapshotId: folderSnapshot.snapshotId, capturedAt: folderSnapshot.capturedAt, sourceId: folderSnapshot.sourceId, path, text: snapshot.text } } : {}),
      }
      return [attachment]
    }))
  const localFolders = (workspace.workspaces ?? []).flatMap((folder) =>
    (!folder || typeof folder !== 'object' ? [] : workspaceArtifacts(folder)).flatMap((artifact): Attachment[] => {
      if (!artifact || typeof artifact !== 'object') return []
      const snapshot = artifact.savedFolderSnapshot
      const localSnapshot = folder.folders?.find((item) => item.id === artifact.source?.id)?.localSnapshot
      if (!localSnapshot || !snapshot || typeof artifact.name !== 'string') return []
      const path = `${localSnapshot.connectionId}/${artifact.name}`
      return [{
        id: fsRecentKey('ui-host', path), label: `${artifact.source?.label ?? ''}${artifact.name}`,
        kind: 'file', source: { id: 'ui-host', kind: 'ui-host', label: 'This computer' },
        ...(typeof snapshot.text === 'string' ? { previewText: snapshot.text } : {}),
      }]
    }))
  return [
    ...(workspace.attachments ?? []),
    // Metadata-only rows must not crowd readable folder text out of the cap.
    ...served.filter((item) => typeof item.textSnapshot?.text === 'string'),
    ...localFolders.filter((item) => typeof item.previewText === 'string'),
    ...imported.filter((item) => typeof item.previewText === 'string'),
    ...imported.filter((item) => typeof item.previewText !== 'string'),
    ...localFolders.filter((item) => typeof item.previewText !== 'string'),
    ...served.filter((item) => typeof item.textSnapshot?.text !== 'string'),
  ]
}

/** One input budget shared by the composer and both model transports. Files are
 * included whole or omitted; a preview must never masquerade as a full import. */
export const ATTACHMENT_TEXT_FILE_BYTES = 64 * 1024
export const ATTACHMENT_TEXT_TOTAL_BYTES = 128 * 1024
export const ATTACHMENT_INPUT_MAX_ITEMS = 24

export type AttachmentInputStatus = 'ready' | 'image-ready' | 'image-count-limit' | 'image-total-limit' | 'preview-only' | 'unavailable' | 'too-large' | 'total-limit' | 'item-limit'
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
  if (item.documentImport !== undefined && !isDocumentImportOutcome(item.documentImport)) return false
  if (item.image !== undefined && (item.kind !== 'photo' || !isImageAssetRef(item.image))) return false
  if (item.textSnapshot !== undefined) {
    if (!isServedTextSnapshot(item.textSnapshot) || item.kind !== 'file' ||
        item.previewText !== undefined || item.documentImport !== undefined || item.image !== undefined) return false
    const source = item.source as Record<string, unknown> | undefined
    const snapshot = item.textSnapshot
    if (!source || source.id !== snapshot.sourceId ||
        source.kind !== (snapshot.sourceId === 'cloud' ? 'cloud' : 'runner') ||
        item.id !== fsRecentKey(snapshot.sourceId, snapshot.path)) return false
  }
  if (item.source !== undefined) {
    if (!item.source || typeof item.source !== 'object' || Array.isArray(item.source)) return false
    const source = item.source as Record<string, unknown>
    if (!['ui-host', 'cloud', 'runner'].includes(source.kind as string)) return false
    if (typeof source.id !== 'string' || !source.id || typeof source.label !== 'string') return false
  }
  return true
}

/** Resolve supplied saved text only. A source-relative id or preview URL never
 * authorizes a backend filesystem read, remote fetch, or binary import. */
export function planAttachmentInput(attachments: readonly Attachment[] = []): AttachmentInputItem[] {
  let usedBytes = 0
  let imageBytes = 0
  let imageCount = 0
  return attachments.map((attachment, index) => {
    if (!isAttachmentInput(attachment)) return { attachment, status: 'unavailable' }
    if (index >= ATTACHMENT_INPUT_MAX_ITEMS) return { attachment, status: 'item-limit' }
    if (attachment.image) {
      if (imageCount >= IMAGE_MAX_COUNT) return { attachment, status: 'image-count-limit' }
      if (imageBytes + attachment.image.byteLength > IMAGE_TURN_MAX_BYTES) return { attachment, status: 'image-total-limit' }
      imageCount++
      imageBytes += attachment.image.byteLength
      return { attachment, status: 'image-ready', bytes: attachment.image.byteLength }
    }
    if (attachment.kind !== 'file' || (attachment.source?.kind !== 'ui-host' && !attachment.textSnapshot)) return { attachment, status: 'preview-only' }
    if (attachment.documentImport && attachment.documentImport.status !== 'ready') return { attachment, status: 'unavailable' }
    const text = attachmentText(attachment)
    if (typeof text !== 'string') return { attachment, status: 'unavailable' }
    // A JS string has at least as many UTF-8 bytes as UTF-16 code units. Avoid
    // allocating an encoded copy of an already-obviously oversized payload.
    if (text.length > ATTACHMENT_TEXT_FILE_BYTES) return { attachment, status: 'too-large' }
    const bytes = new TextEncoder().encode(text).byteLength
    if (bytes > ATTACHMENT_TEXT_FILE_BYTES) return { attachment, status: 'too-large', bytes }
    if (usedBytes + bytes > ATTACHMENT_TEXT_TOTAL_BYTES) return { attachment, status: 'total-limit', bytes }
    usedBytes += bytes
    return { attachment, status: 'ready', bytes }
  })
}

/** Callers still use the shared admission plan before sending any text. */
export function attachmentText(attachment: Attachment): string | undefined {
  return attachment.textSnapshot?.text ?? attachment.previewText
}

/** Resolve extraction provenance from its one authoritative saved location.
 * Served v2 snapshots carry it alongside their immutable text; local imports
 * retain the legacy attachment-level field. */
export function attachmentDocumentImport(attachment: Attachment): DocumentImportOutcome | undefined {
  return attachment.textSnapshot?.version === 2 ? attachment.textSnapshot.documentImport : attachment.documentImport
}

export function attachmentInputCopy(status: AttachmentInputStatus): string {
  switch (status) {
    case 'image-ready': return 'Saved image. Sent on your next turn when the selected model and connection support images.'
    case 'image-count-limit': return 'Preview only for this turn. Up to 8 attached images can be sent at once.'
    case 'image-total-limit': return 'Preview only for this turn. Attached images share an 8 MB input budget.'
    case 'ready': return 'Send and retry use the currently attached text for the selected model.'
    case 'preview-only': return 'Preview only. This attachment is not sent to the model.'
    case 'unavailable': return 'Not sent to the model. Reattach a readable text file up to 64 KB.'
    case 'too-large': return 'Not sent to the model. Text files must be 64 KB or smaller.'
    case 'total-limit': return 'Not sent to the model. Attached text exceeds the 128 KB message limit.'
    case 'item-limit': return 'Not sent to the model. Remove attachments to stay within the 24-item limit.'
  }
}
