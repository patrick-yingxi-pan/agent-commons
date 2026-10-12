import type { FolderSnapshotFile } from './localFolderSnapshot.mjs'
import { isClosedRecord } from './closedRecord.mjs'
import { isFolderSnapshotFiles } from './localFolderSnapshot.mjs'
import { isFolderTreeFiles } from './localFolderTree.mjs'
import { isServedCaptureTime, isServedPath, isServedSourceId, isSnapshotId } from './servedTextSnapshot.ts'

/** Immutable, explicit refresh result. It grants no authority to reread source paths. */
interface ServedFolderSnapshotBase {
  snapshotId: string
  capturedAt: string
  sourceId: string
  path: string
  files: FolderSnapshotFile[]
}

/** Absence remains the original flat scope; recursion is never inferred from names. */
export type ServedFolderSnapshot = ServedFolderSnapshotBase & (
  | { version: 1 }
  | { version: 2; scope: 'recursive' }
)
export type ServedFolderScope = 'flat' | 'recursive'

export function isServedFolderSnapshot(value: unknown): value is ServedFolderSnapshot {
  if (!value || typeof value !== 'object') return false
  const item = value as Record<string, unknown>
  const recursive = item.version === 2
  const fields = ['version', 'snapshotId', 'capturedAt', 'sourceId', 'path', 'files', ...(recursive ? ['scope'] : [])]
  if (!isClosedRecord(item, fields) || (recursive ? item.scope !== 'recursive' : item.version !== 1)) return false
  if (!isSnapshotId(item.snapshotId)) return false
  if (!isServedSourceId(item.sourceId) || !isServedPath(item.path) || !isServedCaptureTime(item.capturedAt)) return false
  const files = item.files
  const validateFiles = recursive ? isFolderTreeFiles : isFolderSnapshotFiles
  if (!validateFiles(files)) return false
  return files.every((file) => isServedPath(`${item.path}/${file.name}`))
}
