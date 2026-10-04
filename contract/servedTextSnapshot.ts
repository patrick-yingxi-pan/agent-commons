import { MAX_FOLDER_SNAPSHOT_FILE_BYTES } from './localFolderSnapshot.mjs'

/** Captured reference data, never a grant or an instruction to reread a path. */
export interface ServedTextSnapshot {
  version: 1
  snapshotId: string
  capturedAt: string
  sourceId: string
  path: string
  text: string
}

export const SERVED_TEXT_SNAPSHOT_MAX_BYTES = MAX_FOLDER_SNAPSHOT_FILE_BYTES

/** Null explicitly means the attached legacy file has no saved snapshot yet. */
export interface RefreshServedAttachmentRequest {
  expectedSnapshotId: string | null
  requestId: string
}

export function isRefreshServedAttachmentRequest(value: unknown): value is RefreshServedAttachmentRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const item = value as Record<string, unknown>
  return Object.keys(item).length === 2 && Object.hasOwn(item, 'expectedSnapshotId') && Object.hasOwn(item, 'requestId') &&
    (item.expectedSnapshotId === null || isSnapshotId(item.expectedSnapshotId)) &&
    isSnapshotId(item.requestId) && item.requestId !== item.expectedSnapshotId
}

export function isSnapshotId(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(value)
}

export function isServedTextSnapshot(value: unknown): value is ServedTextSnapshot {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const item = value as Record<string, unknown>
  const fields = ['version', 'snapshotId', 'capturedAt', 'sourceId', 'path', 'text']
  if (Object.keys(item).length !== fields.length || !fields.every((field) => Object.hasOwn(item, field))) return false
  if (item.version !== 1 || !isSnapshotId(item.snapshotId)) return false
  if (typeof item.sourceId !== 'string' || !/^(cloud|runner:[A-Za-z0-9_-]+)$/.test(item.sourceId)) return false
  if (typeof item.path !== 'string' || !item.path || item.path.length > 4096 || /[\\\x00-\x1f\x7f]/.test(item.path)) return false
  const parts = item.path.split('/')
  if (parts.length > 64 || parts.some((part) => !part || part.startsWith('.') || /^[a-z]:/i.test(part))) return false
  if (typeof item.capturedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(item.capturedAt)) return false
  const instant = Date.parse(item.capturedAt)
  if (!Number.isFinite(instant) || new Date(instant).toISOString() !== item.capturedAt) return false
  return typeof item.text === 'string' && item.text.length <= SERVED_TEXT_SNAPSHOT_MAX_BYTES &&
    !/[\x00-\x08\x0b\x0e-\x1f\x7f]/.test(item.text) &&
    new TextEncoder().encode(item.text).byteLength <= SERVED_TEXT_SNAPSHOT_MAX_BYTES
}
