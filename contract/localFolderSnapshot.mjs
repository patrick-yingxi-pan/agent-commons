export const MAX_FOLDER_SNAPSHOT_ENTRIES = 500
export const MAX_FOLDER_SNAPSHOT_FILE_BYTES = 64 * 1024
export const MAX_FOLDER_SNAPSHOT_TOTAL_BYTES = 128 * 1024
export const MAX_FOLDER_SNAPSHOT_READABLE_FILES = 24

const omissionReasons = new Set(['unsupported', 'too-large', 'budget', 'unreadable'])

/** Validate a bounded ordered saved-file array for a caller-owned path key. */
export function isBoundedFileSnapshots(value, pathKey, isValidPath) {
  if (!Array.isArray(value) || value.length > MAX_FOLDER_SNAPSHOT_ENTRIES) return false
  let readable = 0
  let total = 0
  let previous = ''
  for (const raw of value) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return false
    if (Object.keys(raw).length !== 3 || ![pathKey, 'sizeBytes', 'snapshot'].every((key) => Object.hasOwn(raw, key))) return false
    const path = raw[pathKey]
    if (!isValidPath(path) || (previous && path <= previous)) return false
    previous = path
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
const isFolderSnapshotPath = (name) => typeof name === 'string' && !!name && name.length <= 255 &&
  !name.startsWith('.') && !/[\\/\x00-\x1f\x7f]/.test(name)

/** Validate the shared detached folder-file representation at every ingress. */
export function isFolderSnapshotFiles(value) {
  return isBoundedFileSnapshots(value, 'name', isFolderSnapshotPath)
}
