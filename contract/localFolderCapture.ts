import type { FolderSnapshotFile } from './localFolderSnapshot.mjs'
import { isFolderSnapshotFiles } from './localFolderSnapshot.mjs'
import { isServedCaptureTime, isSnapshotId } from './servedTextSnapshot.ts'

/** Opaque correlation identity only; it is never a server-side filesystem key. */
export type LocalFolderConnectionId = `LOCAL_${string}`

/** A detached, bounded copy of visible top-level files from one native folder. */
export interface LocalFolderCapture {
  version: 1
  snapshotId: string
  capturedAt: string
  connectionId: LocalFolderConnectionId
  files: FolderSnapshotFile[]
}

/** Exact bytes and receipt identity submitted for a local-folder Refresh. */
export interface LocalFolderRefreshRequest {
  expectedSnapshotId: string | null
  requestId: string
  snapshot: LocalFolderCapture
}

export interface LocalFolderAccountSource {
  userId: string
  namespace: string
}

/** Renderer-safe native bridge projections: no filesystem path crosses IPC. */
export interface LocalFolderConnection {
  id: LocalFolderConnectionId
  name: string
  remembered: boolean
}

export interface NativeLocalFolderBridge {
  list(source: LocalFolderAccountSource): Promise<LocalFolderConnection[]>
  connect(
    input: { remember: boolean },
    source: LocalFolderAccountSource,
  ): Promise<{ status: 'cancelled' } | { status: 'connected'; connection: LocalFolderConnection }>
  snapshot(id: LocalFolderConnectionId, source: LocalFolderAccountSource): Promise<{ name: string; files: FolderSnapshotFile[] }>
  disconnect(id: LocalFolderConnectionId, source: LocalFolderAccountSource): Promise<void>
}

export function isLocalConnectionId(value: unknown): value is LocalFolderConnectionId {
  return typeof value === 'string' && /^LOCAL_[A-F0-9]{32}$/.test(value)
}

export function isLocalFolderCapture(value: unknown): value is LocalFolderCapture {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const item = value as Record<string, unknown>
  const fields = ['version', 'snapshotId', 'capturedAt', 'connectionId', 'files']
  return Object.keys(item).length === fields.length && fields.every((key) => Object.hasOwn(item, key)) &&
    item.version === 1 && isSnapshotId(item.snapshotId) && isServedCaptureTime(item.capturedAt) &&
    isLocalConnectionId(item.connectionId) && isFolderSnapshotFiles(item.files)
}

export function isLocalFolderRefreshRequest(value: unknown): value is LocalFolderRefreshRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const item = value as Record<string, unknown>
  return Object.keys(item).length === 3 && ['expectedSnapshotId', 'requestId', 'snapshot'].every((key) => Object.hasOwn(item, key)) &&
    (item.expectedSnapshotId === null || isSnapshotId(item.expectedSnapshotId)) &&
    isSnapshotId(item.requestId) && item.requestId !== item.expectedSnapshotId &&
    isLocalFolderCapture(item.snapshot) && item.snapshot.snapshotId === item.requestId
}
