import { decodeLocalTextPreview, isLocalTextFileName } from './localTextFile.mjs'

export const MAX_FOLDER_SNAPSHOT_ENTRIES = 500
export const MAX_FOLDER_SNAPSHOT_FILE_BYTES = 64 * 1024
export const MAX_FOLDER_SNAPSHOT_TOTAL_BYTES = 128 * 1024
export const MAX_FOLDER_SNAPSHOT_READABLE_FILES = 24

function omitted(reason) {
  return { omitted: reason }
}

const omissionReasons = new Set(['unsupported', 'too-large', 'budget', 'unreadable'])

/** Validate the shared detached folder-file representation at every ingress. */
export function isFolderSnapshotFiles(value) {
  if (!Array.isArray(value) || value.length > MAX_FOLDER_SNAPSHOT_ENTRIES) return false
  let readable = 0
  let total = 0
  let previous = ''
  for (const raw of value) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return false
    if (Object.keys(raw).length !== 3 || !['name', 'sizeBytes', 'snapshot'].every((key) => Object.hasOwn(raw, key))) return false
    if (typeof raw.name !== 'string' || !raw.name || raw.name.length > 255 || raw.name.startsWith('.') || /[\\/\x00-\x1f\x7f]/.test(raw.name)) return false
    if (previous && raw.name <= previous) return false
    previous = raw.name
    if (!Number.isSafeInteger(raw.sizeBytes) || raw.sizeBytes < 0) return false
    const snapshot = raw.snapshot
    if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot) || Object.keys(snapshot).length !== 1) return false
    if (Object.hasOwn(snapshot, 'text')) {
      const text = snapshot.text
      if (typeof text !== 'string' || /[\x00-\x08\x0b\x0e-\x1f\x7f]/.test(text)) return false
      const bytes = new TextEncoder().encode(text).byteLength
      if (bytes > MAX_FOLDER_SNAPSHOT_FILE_BYTES || bytes !== raw.sizeBytes) return false
      readable += 1
      total += bytes
      if (readable > MAX_FOLDER_SNAPSHOT_READABLE_FILES || total > MAX_FOLDER_SNAPSHOT_TOTAL_BYTES) return false
    } else if (Object.hasOwn(snapshot, 'omitted')) {
      if (typeof snapshot.omitted !== 'string' || !omissionReasons.has(snapshot.omitted)) return false
    } else return false
  }
  return true
}

/** Build deterministic, path-free snapshots for regular top-level folder files. */
export async function snapshotFolderFiles(files, readBytes) {
  if (files.length > MAX_FOLDER_SNAPSHOT_ENTRIES) throw new RangeError('folder entry cap exceeded')
  const sorted = files
    .filter((file) => typeof file?.name === 'string' && !file.name.startsWith('.'))
    .sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0)
  const snapshots = []
  let totalBytes = 0
  let readableFiles = 0
  for (const file of sorted) {
    let snapshot
    if (!isLocalTextFileName(file.name)) snapshot = omitted('unsupported')
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
