import type { FolderSnapshotFile } from './localFolderSnapshot.mjs'
import { isClosedRecord } from './closedRecord.mjs'
import { isFolderSnapshotFiles } from './localFolderSnapshot.mjs'
import { isFolderTreeFiles } from './localFolderTree.mjs'
import { isServedCaptureTime, isSnapshotId } from './servedTextSnapshot.ts'

/** Opaque correlation identity only; it is never a server-side filesystem key. */
export type LocalFolderConnectionId = `LOCAL_${string}`

/** The original detached top-level-only local folder wire shape. */
export interface LocalFolderCaptureV1 {
  version: 1
  snapshotId: string
  capturedAt: string
  connectionId: LocalFolderConnectionId
  files: FolderSnapshotFile[]
}

/** An explicitly recursive detached copy; names are visible root-relative paths. */
export interface LocalFolderCaptureV2 {
  version: 2
  scope: 'recursive'
  snapshotId: string
  capturedAt: string
  connectionId: LocalFolderConnectionId
  files: FolderSnapshotFile[]
}

export type LocalFolderCapture = LocalFolderCaptureV1 | LocalFolderCaptureV2

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
  snapshotTree?(id: LocalFolderConnectionId, source: LocalFolderAccountSource): Promise<{ name: string; files: FolderSnapshotFile[] }>
  disconnect(id: LocalFolderConnectionId, source: LocalFolderAccountSource): Promise<void>
}

export function isLocalConnectionId(value: unknown): value is LocalFolderConnectionId {
  return typeof value === 'string' && /^LOCAL_[A-F0-9]{32}$/.test(value)
}

export function isLocalFolderCaptureV1(value: unknown): value is LocalFolderCaptureV1 {
  return isLocalFolderCapture(value) && value.version === 1
}

export function isLocalFolderCaptureV2(value: unknown): value is LocalFolderCaptureV2 {
  return isLocalFolderCapture(value) && value.version === 2
}

export function isLocalFolderCapture(value: unknown): value is LocalFolderCapture {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const item = value as Record<string, unknown>
  const recursive = item.version === 2
  if (recursive ? item.scope !== 'recursive' : item.version !== 1) return false
  const fields = ['version', 'snapshotId', 'capturedAt', 'connectionId', 'files', ...(recursive ? ['scope'] : [])]
  return isClosedRecord(item, fields) &&
    isSnapshotId(item.snapshotId) && isServedCaptureTime(item.capturedAt) && isLocalConnectionId(item.connectionId) &&
    (recursive ? isFolderTreeFiles(item.files) : isFolderSnapshotFiles(item.files))
}

export function isLocalFolderRefreshRequest(value: unknown): value is LocalFolderRefreshRequest {
  if (!isClosedRecord(value, ['expectedSnapshotId', 'requestId', 'snapshot'])) return false
  const item = value as Record<string, unknown>
  return (item.expectedSnapshotId === null || isSnapshotId(item.expectedSnapshotId)) &&
    isSnapshotId(item.requestId) && item.requestId !== item.expectedSnapshotId &&
    isLocalFolderCapture(item.snapshot) && item.snapshot.snapshotId === item.requestId
}
