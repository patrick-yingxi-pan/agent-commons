import { decodeLocalTextPreview, isLocalTextFileName } from './localTextFile.mjs'
import { isBoundedFileSnapshots } from './localFolderSnapshot.mjs'
import {
  MAX_FOLDER_SNAPSHOT_ENTRIES,
  MAX_FOLDER_SNAPSHOT_FILE_BYTES,
  MAX_FOLDER_SNAPSHOT_TOTAL_BYTES,
  MAX_FOLDER_SNAPSHOT_READABLE_FILES,
} from './localFolderSnapshot.mjs'

export const MAX_GIT_SNAPSHOT_PATH_LENGTH = 4096
export const MAX_GIT_SNAPSHOT_ENTRIES = MAX_FOLDER_SNAPSHOT_ENTRIES
export const MAX_GIT_SNAPSHOT_FILE_BYTES = MAX_FOLDER_SNAPSHOT_FILE_BYTES
export const MAX_GIT_SNAPSHOT_TOTAL_BYTES = MAX_FOLDER_SNAPSHOT_TOTAL_BYTES
export const MAX_GIT_SNAPSHOT_READABLE_FILES = MAX_FOLDER_SNAPSHOT_READABLE_FILES

export function isGitSnapshotPath(path) {
  if (typeof path !== 'string' || !path || path.length > MAX_GIT_SNAPSHOT_PATH_LENGTH || path.startsWith('/') || /[\\\x00-\x1f\x7f]/.test(path)) return false
  const parts = path.split('/')
  return parts.every((part) => {
    // Match Git's HFS metadata protection even on a case-sensitive host:
    // these ignored code points must not disguise .git or dot traversal.
    const key = part.replace(/[\u200c-\u200f\u202a-\u202e\u206a-\u206f\ufeff]/g, '').toLowerCase()
    return !['', '.', '..', '.git'].includes(key) && part.length <= 255
  })
}

/** Validate bounded, sorted recursively relative Git path records. */
export function isGitSnapshotFiles(value) {
  return isBoundedFileSnapshots(value, 'path', isGitSnapshotPath)
}

/** Build a deterministic saved projection from recursively enumerated tracked paths. */
export async function snapshotGitFiles(files, readBytes) {
  if (files.length > MAX_FOLDER_SNAPSHOT_ENTRIES) throw new RangeError('git entry cap exceeded')
  const sorted = [...files].sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0)
  const snapshots = []
  let totalBytes = 0
  let readableFiles = 0
  for (const file of sorted) {
    if (!isGitSnapshotPath(file.path) || !Number.isSafeInteger(file.sizeBytes) || file.sizeBytes < 0) throw new TypeError('invalid tracked Git file')
    let snapshot
    const name = file.path.slice(file.path.lastIndexOf('/') + 1)
    if (!isLocalTextFileName(name)) snapshot = { omitted: 'unsupported' }
    else if (file.sizeBytes > MAX_FOLDER_SNAPSHOT_FILE_BYTES) snapshot = { omitted: 'too-large' }
    else if (readableFiles >= MAX_FOLDER_SNAPSHOT_READABLE_FILES || totalBytes + file.sizeBytes > MAX_FOLDER_SNAPSHOT_TOTAL_BYTES) snapshot = { omitted: 'budget' }
    else {
      try {
        const bytes = await readBytes(file)
        if (!(bytes instanceof Uint8Array) || bytes.byteLength > MAX_FOLDER_SNAPSHOT_FILE_BYTES) snapshot = { omitted: 'too-large' }
        else if (bytes.byteLength !== file.sizeBytes) snapshot = { omitted: 'unreadable' }
        else if (totalBytes + bytes.byteLength > MAX_FOLDER_SNAPSHOT_TOTAL_BYTES) snapshot = { omitted: 'budget' }
        else {
          const text = decodeLocalTextPreview(bytes)
          if (text === undefined) snapshot = { omitted: 'unreadable' }
          else {
            snapshot = { text }
            totalBytes += bytes.byteLength
            readableFiles += 1
          }
        }
      } catch {
        snapshot = { omitted: 'unreadable' }
      }
    }
    snapshots.push({ path: file.path, sizeBytes: file.sizeBytes, snapshot })
  }
  return snapshots
}
