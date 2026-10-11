import type { FolderSnapshotFile } from './localFolderSnapshot.mjs'
import { isClosedRecord } from './closedRecord.mjs'
import { isFolderSnapshotFiles } from './localFolderSnapshot.mjs'
import { isServedCaptureTime, isServedPath, isServedSourceId, isSnapshotId } from './servedTextSnapshot.ts'

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
  const fields = ['version', 'snapshotId', 'capturedAt', 'sourceId', 'path', 'files']
  if (!isClosedRecord(value, fields)) return false
  const item = value as Record<string, unknown>
  if (item.version !== 1 || !isSnapshotId(item.snapshotId)) return false
  if (!isServedSourceId(item.sourceId) || !isServedPath(item.path) || !isServedCaptureTime(item.capturedAt)) return false
  if (!isFolderSnapshotFiles(item.files)) return false
  return item.files.every((file) => isServedPath(`${item.path}/${file.name}`))
}
