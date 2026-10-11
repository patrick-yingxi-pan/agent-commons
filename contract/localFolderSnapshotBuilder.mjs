import { decodeLocalTextPreview, isLocalTextFileName } from './localTextFile.mjs'
import {
  MAX_FOLDER_SNAPSHOT_ENTRIES,
  MAX_FOLDER_SNAPSHOT_FILE_BYTES,
  MAX_FOLDER_SNAPSHOT_TOTAL_BYTES,
  MAX_FOLDER_SNAPSHOT_READABLE_FILES,
} from './localFolderSnapshot.mjs'

function omitted(reason) {
  return { omitted: reason }
}

async function snapshotFiles(files, readBytes, textName = (file) => file.name) {
  const snapshots = []
  let totalBytes = 0
  let readableFiles = 0
  for (const file of files) {
    let snapshot
    if (!isLocalTextFileName(textName(file))) snapshot = omitted('unsupported')
    else if (!Number.isSafeInteger(file.sizeBytes) || file.sizeBytes < 0 || file.sizeBytes > MAX_FOLDER_SNAPSHOT_FILE_BYTES) snapshot = omitted('too-large')
    else if (readableFiles >= MAX_FOLDER_SNAPSHOT_READABLE_FILES || totalBytes + file.sizeBytes > MAX_FOLDER_SNAPSHOT_TOTAL_BYTES) snapshot = omitted('budget')
    else {
      try {
        const bytes = await readBytes(file)
        if (!(bytes instanceof Uint8Array) || bytes.byteLength > MAX_FOLDER_SNAPSHOT_FILE_BYTES) snapshot = omitted('too-large')
        else if (bytes.byteLength !== file.sizeBytes) snapshot = omitted('unreadable')
        else if (totalBytes + bytes.byteLength > MAX_FOLDER_SNAPSHOT_TOTAL_BYTES) snapshot = omitted('budget')
        else {
          const text = decodeLocalTextPreview(bytes)
          if (text === undefined) snapshot = omitted('unreadable')
          else {
            snapshot = { text }
            totalBytes += bytes.byteLength
            readableFiles += 1
          }
        }
      } catch {
        snapshot = omitted('unreadable')
      }
    }
    snapshots.push({ name: file.name, sizeBytes: file.sizeBytes, snapshot })
  }
  return snapshots
}

/** Build deterministic, path-free snapshots for regular top-level folder files. */
export async function snapshotFolderFiles(files, readBytes) {
  if (files.length > MAX_FOLDER_SNAPSHOT_ENTRIES) throw new RangeError('folder entry cap exceeded')
  const sorted = files
    .filter((file) => typeof file?.name === 'string' && !file.name.startsWith('.'))
    .sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0)
  return snapshotFiles(sorted, readBytes)
}

/** Apply the shared file/read budgets to a prevalidated ordered file list. */
export async function snapshotFolderEntries(files, readBytes, options = {}) {
  if (files.length > MAX_FOLDER_SNAPSHOT_ENTRIES) throw new RangeError('folder entry cap exceeded')
  return snapshotFiles(files, readBytes, options.textName)
}
