import { isFolderTreePath, MAX_FOLDER_TREE_DEPTH, MAX_FOLDER_TREE_DIRECTORIES,
  MAX_FOLDER_TREE_ENTRIES, MAX_FOLDER_TREE_PATH_BYTES } from './localFolderTree.mjs'
import { isLocalBrowseFileName, MAX_LOCAL_BROWSE_TEXT_BYTES, parseLocalBrowseFileSnapshot } from './localFileBrowse.mjs'

export const MAX_LOCAL_FOLDER_BROWSE_FILE_BYTES = MAX_LOCAL_BROWSE_TEXT_BYTES
export const MAX_LOCAL_FOLDER_BROWSE_PATH_BYTES = MAX_FOLDER_TREE_ENTRIES * MAX_FOLDER_TREE_PATH_BYTES

const encoder = new TextEncoder()

function record(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) return undefined
  const own = Reflect.ownKeys(value)
  if (own.length !== keys.length || own.some(key => typeof key !== 'string' || !keys.includes(key))) return undefined
  const result = Object.create(null)
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) return undefined
    result[key] = descriptor.value
  }
  return result
}

function denseArray(value, maximum) {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) return undefined
  const length = Object.getOwnPropertyDescriptor(value, 'length')?.value
  if (!Number.isSafeInteger(length) || length < 0 || length > maximum || Reflect.ownKeys(value).length !== length + 1) return undefined
  const result = []
  for (let index = 0; index < length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index))
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) return undefined
    result.push(descriptor.value)
  }
  return result
}

function pathBytes(value) {
  if (!isFolderTreePath(value)) return undefined
  const bytes = encoder.encode(value)
  return bytes.byteLength <= MAX_FOLDER_TREE_PATH_BYTES && new TextDecoder('utf-8', { fatal: true }).decode(bytes) === value
    ? bytes.byteLength : undefined
}

export function isLocalFolderFileSelection(value) {
  try {
    const selection = record(value, ['path'])
    return !!selection && pathBytes(selection.path) !== undefined
  } catch { return false }
}

/** Complete bounded metadata, not a prefix presented as the whole folder. */
export function parseLocalFolderFileListing(value) {
  try {
    const listing = record(value, ['version', 'visited', 'hiddenCount', 'directoryCount', 'files'])
    if (!listing || listing.version !== 1 ||
      !Number.isSafeInteger(listing.visited) || listing.visited < 0 || listing.visited > MAX_FOLDER_TREE_ENTRIES ||
      !Number.isSafeInteger(listing.hiddenCount) || listing.hiddenCount < 0 ||
      !Number.isSafeInteger(listing.directoryCount) || listing.directoryCount < 0 || listing.directoryCount > MAX_FOLDER_TREE_DIRECTORIES) return undefined
    const files = denseArray(listing.files, MAX_FOLDER_TREE_ENTRIES)
    if (!files || listing.hiddenCount + listing.directoryCount + files.length !== listing.visited) return undefined
    let previous = ''
    let totalBytes = 0
    const detached = []
    for (const item of files) {
      const file = record(item, ['path', 'kind'])
      const bytes = file && pathBytes(file.path)
      if (bytes === undefined || (previous && file.path <= previous) || !['file', 'unsupported'].includes(file.kind) ||
        (file.kind === 'file' && !isLocalBrowseFileName(file.path.slice(file.path.lastIndexOf('/') + 1)))) return undefined
      totalBytes += bytes
      if (totalBytes > MAX_LOCAL_FOLDER_BROWSE_PATH_BYTES) return undefined
      previous = file.path
      detached.push({ path: file.path, kind: file.kind })
    }
    return { version: 1, visited: listing.visited, hiddenCount: listing.hiddenCount,
      directoryCount: listing.directoryCount, files: detached }
  } catch { return undefined }
}

/** One whole visible working-file copy; absent, binary, and oversized are never empty. */
export function parseLocalFolderFilePreview(value) {
  try {
    const preview = record(value, ['version', 'path', 'sizeBytes', 'snapshot'])
    if (!preview || preview.version !== 1 || pathBytes(preview.path) === undefined ||
      !Number.isSafeInteger(preview.sizeBytes) || preview.sizeBytes < 0) return undefined
    const snapshot = parseLocalBrowseFileSnapshot(preview.path, preview.sizeBytes, preview.snapshot)
    return snapshot ? { version: 1, path: preview.path, sizeBytes: preview.sizeBytes, snapshot } : undefined
  } catch { return undefined }
}
