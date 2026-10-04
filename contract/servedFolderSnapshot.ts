import type { FolderSnapshotFile } from './localFolderSnapshot.mjs'
import { MAX_FOLDER_SNAPSHOT_ENTRIES, MAX_FOLDER_SNAPSHOT_FILE_BYTES, MAX_FOLDER_SNAPSHOT_READABLE_FILES, MAX_FOLDER_SNAPSHOT_TOTAL_BYTES } from './localFolderSnapshot.mjs'
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

const OMITTALS = new Set(['unsupported', 'too-large', 'budget', 'unreadable'])

export function isServedFolderSnapshot(value: unknown): value is ServedFolderSnapshot {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const item = value as Record<string, unknown>
  const fields = ['version', 'snapshotId', 'capturedAt', 'sourceId', 'path', 'files']
  if (Object.keys(item).length !== fields.length || !fields.every((key) => Object.hasOwn(item, key))) return false
  if (item.version !== 1 || !isSnapshotId(item.snapshotId)) return false
  if (!isServedSourceId(item.sourceId) || !isServedPath(item.path) || !isServedCaptureTime(item.capturedAt)) return false
  if (!Array.isArray(item.files) || item.files.length > MAX_FOLDER_SNAPSHOT_ENTRIES) return false
  let readable = 0
  let total = 0
  let previous = ''
  for (const raw of item.files) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return false
    const file = raw as Record<string, unknown>
    if (Object.keys(file).length !== 3 || !['name', 'sizeBytes', 'snapshot'].every((key) => Object.hasOwn(file, key))) return false
    if (typeof file.name !== 'string' || !file.name || file.name.includes('/') || !isServedPath(`${item.path}/${file.name}`)) return false
    if (previous && file.name <= previous) return false
    previous = file.name
    if (!Number.isSafeInteger(file.sizeBytes) || (file.sizeBytes as number) < 0) return false
    if (!file.snapshot || typeof file.snapshot !== 'object' || Array.isArray(file.snapshot)) return false
    const snapshot = file.snapshot as Record<string, unknown>
    if (Object.keys(snapshot).length !== 1) return false
    if (Object.hasOwn(snapshot, 'text')) {
      if (!isServedSnapshotText(snapshot.text, MAX_FOLDER_SNAPSHOT_FILE_BYTES)) return false
      const bytes = new TextEncoder().encode(snapshot.text).byteLength
      if (bytes > MAX_FOLDER_SNAPSHOT_FILE_BYTES || bytes !== file.sizeBytes) return false
      readable++
      total += bytes
      if (readable > MAX_FOLDER_SNAPSHOT_READABLE_FILES || total > MAX_FOLDER_SNAPSHOT_TOTAL_BYTES) return false
    } else if (Object.hasOwn(snapshot, 'omitted')) {
      if (typeof snapshot.omitted !== 'string' || !OMITTALS.has(snapshot.omitted)) return false
    } else return false
  }
  return true
}
