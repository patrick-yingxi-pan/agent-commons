import { isBoundedFileSnapshots, MAX_FOLDER_SNAPSHOT_ENTRIES } from './localFolderSnapshot.mjs'

export const MAX_FOLDER_TREE_DEPTH = 16
export const MAX_FOLDER_TREE_DIRECTORIES = 64
export const MAX_FOLDER_TREE_PATH_BYTES = 4096
export const MAX_FOLDER_TREE_ENTRIES = 500

const encoder = new TextEncoder()

/** A visible, portable root-relative path for one captured regular file. */
export function isFolderTreePath(value) {
  // Unicode mode matches lone surrogates, not well-formed astral code points.
  if (typeof value !== 'string' || !value || /[\uD800-\uDFFF]/u.test(value)) return false
  if (value.startsWith('/') || /^[A-Za-z]:/.test(value) || /[\\\u0000-\u001f\u007f-\u009f]/u.test(value)) return false
  const bytes = encoder.encode(value).byteLength
  if (bytes > MAX_FOLDER_TREE_PATH_BYTES) return false
  const components = value.split('/')
  if (components.length - 1 > MAX_FOLDER_TREE_DEPTH || components.some((part) => !part || part === '.' || part === '..' || part.startsWith('.'))) return false
  return components.every((part) => encoder.encode(part).byteLength <= 255)
}

function hasWithinDirectoryBudget(files) {
  const directories = new Set()
  for (const file of files) {
    const parts = file.name.split('/')
    for (let depth = 1; depth < parts.length; depth += 1) {
      directories.add(parts.slice(0, depth).join('/'))
      if (directories.size > MAX_FOLDER_TREE_DIRECTORIES) return false
    }
  }
  return true
}

/** Validate a sorted, unique, budgeted recursive folder snapshot file list. */
export function isFolderTreeFiles(value) {
  // The shared validator already enforces entry count, sort order and uniqueness.
  return isBoundedFileSnapshots(value, 'name', isFolderTreePath) && hasWithinDirectoryBudget(value)
}

/** Build a deterministic, bounded snapshot from already enumerated tree files. */
export async function snapshotFolderTreeFiles(files, readBytes) {
  if (!Array.isArray(files) || files.length > Math.min(MAX_FOLDER_TREE_ENTRIES, MAX_FOLDER_SNAPSHOT_ENTRIES)) {
    throw new RangeError('folder tree entry cap exceeded')
  }
  const sorted = [...files].sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0)
  const seen = new Set()
  for (const file of sorted) {
    if (!isFolderTreePath(file?.name) || seen.has(file.name) || !Number.isSafeInteger(file.sizeBytes) || file.sizeBytes < 0) {
      throw new RangeError('invalid or duplicate folder tree entry')
    }
    seen.add(file.name)
  }
  if (!hasWithinDirectoryBudget(sorted)) throw new RangeError('folder tree directory cap exceeded')
  const { snapshotFolderEntries } = await import('./localFolderSnapshotBuilder.mjs')
  return snapshotFolderEntries(sorted, readBytes, { textName: (file) => file.name.slice(file.name.lastIndexOf('/') + 1) })
}
