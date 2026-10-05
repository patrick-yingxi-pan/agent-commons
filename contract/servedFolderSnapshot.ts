import type { FolderSnapshotFile } from './localFolderSnapshot.mjs'
import { isFolderSnapshotFiles } from './localFolderSnapshot.mjs'
import { isServedCaptureTime, isServedPath, isServedSnapshotText, isServedSourceId, isSnapshotId } from './servedTextSnapshot.ts'

/** Immutable, explicit refresh result. It grants no authority to reread source paths. */
export interface ServedFolderSnapshot {
  version: 1
  snapshotId: string
  capturedAt: string
  sourceId: string
  path: string
  files: FolderSnapshotFile[]
}

export function isServedFolderSnapshot(value: unknown): value is ServedFolderSnapshot {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const item = value as Record<string, unknown>
  const fields = ['version', 'snapshotId', 'capturedAt', 'sourceId', 'path', 'files']
  if (Object.keys(item).length !== fields.length || !fields.every((key) => Object.hasOwn(item, key))) return false
  if (item.version !== 1 || !isSnapshotId(item.snapshotId)) return false
  if (!isServedSourceId(item.sourceId) || !isServedPath(item.path) || !isServedCaptureTime(item.capturedAt)) return false
  if (!isServedPath(item.path) || !isFolderSnapshotFiles(item.files)) return false
  return item.files.every((file) => isServedPath(`${item.path}/${file.name}`))
}
