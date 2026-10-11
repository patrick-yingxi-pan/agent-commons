import { MAX_FOLDER_SNAPSHOT_FILE_BYTES } from './localFolderSnapshot.mjs'
import { isClosedRecord } from './closedRecord.mjs'
import { isDocumentImportOutcome, type DocumentImportOutcome } from './documentImport.mjs'
import type { ServedImageSnapshot } from './servedImageSnapshot.ts'
import { isServedImageSnapshot } from './servedImageSnapshot.ts'
import { isServedCaptureTime, isServedPath, isServedSourceId, isSnapshotId } from './servedSnapshotIdentity.ts'

export { isServedCaptureTime, isServedPath, isServedSourceId, isSnapshotId } from './servedSnapshotIdentity.ts'

/** Captured reference data, never a grant or an instruction to reread a path. */
export interface ServedTextSnapshotV1 {
  version: 1
  snapshotId: string
  capturedAt: string
  sourceId: string
  path: string
  text: string
}

/** Complete saved text plus path-free extraction provenance for a supported
 * document. Raw source bytes are never part of this durable snapshot. */
export interface ServedTextSnapshotV2 {
  version: 2
  snapshotId: string
  capturedAt: string
  sourceId: string
  path: string
  text: string
  documentImport: DocumentImportOutcome & { status: 'ready' }
}

export type ServedDocumentSnapshot = ServedTextSnapshotV2
export type ServedTextSnapshot = ServedTextSnapshotV1 | ServedTextSnapshotV2

export const SERVED_TEXT_SNAPSHOT_MAX_BYTES = MAX_FOLDER_SNAPSHOT_FILE_BYTES

/** Null explicitly means the attached legacy file has no saved snapshot yet. */
export type RefreshServedAttachmentRequest = {
  expectedSnapshotId: string | null
  requestId: string
} | {
  expectedSnapshotId: string | null
  requestId: string
  snapshot: ServedTextSnapshotV2
} | {
  expectedSnapshotId: string | null
  requestId: string
  imageSnapshot: ServedImageSnapshot
}

export function isRefreshServedAttachmentRequest(value: unknown): value is RefreshServedAttachmentRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const item = value as Record<string, unknown>
  const keys = Reflect.ownKeys(item)
  const commonValid = (item.expectedSnapshotId === null || isSnapshotId(item.expectedSnapshotId)) &&
    isSnapshotId(item.requestId) && item.requestId !== item.expectedSnapshotId
  if (!commonValid || !Object.hasOwn(item, 'expectedSnapshotId') || !Object.hasOwn(item, 'requestId')) return false
  if (keys.length === 2 && keys.every((key) => key === 'expectedSnapshotId' || key === 'requestId')) return true
  if (keys.length !== 3 || !keys.every((key) => key === 'expectedSnapshotId' || key === 'requestId' || key === 'snapshot' || key === 'imageSnapshot')) return false
  if (Object.hasOwn(item, 'snapshot') && !Object.hasOwn(item, 'imageSnapshot') &&
      isServedTextSnapshot(item.snapshot) && item.snapshot.version === 2) {
    return item.requestId === item.snapshot.snapshotId && item.requestId !== item.expectedSnapshotId
  }
  if (Object.hasOwn(item, 'imageSnapshot') && !Object.hasOwn(item, 'snapshot') && isServedImageSnapshot(item.imageSnapshot)) {
    return item.requestId === item.imageSnapshot.snapshotId && item.requestId !== item.expectedSnapshotId
  }
  return false
}

export function isServedSnapshotText(value: unknown, maxBytes = SERVED_TEXT_SNAPSHOT_MAX_BYTES): value is string {
  return typeof value === 'string' && value.length <= maxBytes && !/[\x00-\x08\x0b\x0e-\x1f\x7f]/.test(value) &&
    new TextEncoder().encode(value).byteLength <= maxBytes
}

/** Recognize only formats that have a shared text-import contract. This is a
 * filename hint; it does not inspect or validate file content. */
export function documentFormatForName(name: unknown): DocumentImportOutcome['format'] | undefined {
  if (typeof name !== 'string') return undefined
  if (/\.pdf$/i.test(name)) return 'pdf'
  if (/\.docx$/i.test(name)) return 'docx'
  if (/\.xlsx$/i.test(name)) return 'xlsx'
  if (/\.pptx$/i.test(name)) return 'pptx'
  return undefined
}

export function isServedTextSnapshot(value: unknown): value is ServedTextSnapshot {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const item = value as Record<string, unknown>
  const fields = item.version === 1
    ? ['version', 'snapshotId', 'capturedAt', 'sourceId', 'path', 'text']
    : item.version === 2
      ? ['version', 'snapshotId', 'capturedAt', 'sourceId', 'path', 'text', 'documentImport']
      : []
  if (!isClosedRecord(item, fields, 'all')) return false
  if (!isSnapshotId(item.snapshotId)) return false
  const commonValid = isServedSourceId(item.sourceId) && isServedPath(item.path) && isServedCaptureTime(item.capturedAt) &&
    isServedSnapshotText(item.text)
  if (!commonValid) return false
  if (item.version === 1) return true
  return item.version === 2 && isServedSnapshotText(item.text, SERVED_TEXT_SNAPSHOT_MAX_BYTES) && item.text.trim().length > 0 &&
    isReadyDocumentImportForPath(item.documentImport, item.path)
}

function isReadyDocumentImportForPath(value: unknown, path: unknown): value is DocumentImportOutcome & { status: 'ready' } {
  if (!isDocumentImportOutcome(value) || value.status !== 'ready' || typeof path !== 'string') return false
  const item = value as DocumentImportOutcome & Record<string, unknown>
  const fields = item.format === 'pdf' ? ['format', 'status', 'pages', 'textPages'] : ['format', 'status']
  if (!isClosedRecord(item, fields, 'all')) return false
  return documentFormatForName(path) === item.format
}
