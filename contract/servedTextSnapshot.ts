import { MAX_FOLDER_SNAPSHOT_FILE_BYTES } from './localFolderSnapshot.mjs'
import { isDocumentImportOutcome, type DocumentImportOutcome } from './documentImport.mjs'

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
}

export function isRefreshServedAttachmentRequest(value: unknown): value is RefreshServedAttachmentRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const item = value as Record<string, unknown>
  const keys = Reflect.ownKeys(item)
  const commonValid = (item.expectedSnapshotId === null || isSnapshotId(item.expectedSnapshotId)) &&
    isSnapshotId(item.requestId) && item.requestId !== item.expectedSnapshotId
  if (!commonValid || !Object.hasOwn(item, 'expectedSnapshotId') || !Object.hasOwn(item, 'requestId')) return false
  if (keys.length === 2 && keys.every((key) => key === 'expectedSnapshotId' || key === 'requestId')) return true
  if (keys.length !== 3 || !keys.every((key) => key === 'expectedSnapshotId' || key === 'requestId' || key === 'snapshot') ||
      !Object.hasOwn(item, 'snapshot') || !isServedTextSnapshot(item.snapshot) || item.snapshot.version !== 2) return false
  return item.requestId === item.snapshot.snapshotId && item.requestId !== item.expectedSnapshotId
}

export function isSnapshotId(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(value)
}

export function isServedSourceId(value: unknown): value is string {
  return typeof value === 'string' && /^(cloud|runner:[A-Za-z0-9_-]+)$/.test(value)
}

export function isServedPath(value: unknown): value is string {
  if (typeof value !== 'string' || !value || value.length > 4096 || /[\\\x00-\x1f\x7f]/.test(value)) return false
  const parts = value.split('/')
  return parts.length <= 64 && parts.every((part) => !!part && !part.startsWith('.') && !/^[a-z]:/i.test(part))
}

export function isServedCaptureTime(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return false
  const instant = Date.parse(value)
  return Number.isFinite(instant) && new Date(instant).toISOString() === value
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
  const keys = Reflect.ownKeys(item)
  if (keys.length !== fields.length || !fields.every((field) => Object.hasOwn(item, field)) ||
      !keys.every((key) => typeof key === 'string' && fields.includes(key))) return false
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
  const keys = Reflect.ownKeys(item)
  if (keys.length !== fields.length || !fields.every((field) => Object.hasOwn(item, field)) ||
      !keys.every((key) => typeof key === 'string' && fields.includes(key))) return false
  return documentFormatForName(path) === item.format
}
