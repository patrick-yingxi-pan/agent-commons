import { isGitSnapshotPath } from './localGitSnapshot.mjs'
import { decodeLocalTextPreview, isLocalTextFileName } from './localTextFile.mjs'

export const MAX_GIT_BROWSE_ENTRIES = 10_000
export const MAX_GIT_BROWSE_FILE_BYTES = 64 * 1024
export const MAX_GIT_BROWSE_PATH_BYTES = 1024 * 1024
const encoder = new TextEncoder()
const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true })

// IPC input is data, not executable property access. Detach only closed plain
// records and dense arrays; an accessor cannot smuggle a different selection.
function record(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) return undefined
  const own = Reflect.ownKeys(value)
  if (own.length !== keys.length || own.some(key => typeof key !== 'string' || !keys.includes(key))) return undefined
  for (const key in value) if (!Object.hasOwn(value, key)) return undefined
  const result = Object.create(null)
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) return undefined
    result[key] = descriptor.value
  }
  return result
}

function array(value) {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) return undefined
  const length = Object.getOwnPropertyDescriptor(value, 'length')?.value
  if (!Number.isSafeInteger(length) || length < 0 || length > MAX_GIT_BROWSE_ENTRIES ||
    Reflect.ownKeys(value).length !== length + 1) return undefined
  for (const key in value) if (!Object.hasOwn(value, key)) return undefined
  const result = []
  for (let i = 0; i < length; i++) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(i))
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) return undefined
    result.push(descriptor.value)
  }
  return result
}

function pathBytes(value) {
  if (!isGitSnapshotPath(value)) return undefined
  const bytes = encoder.encode(value)
  return bytes.byteLength <= 4096 && decoder.decode(bytes) === value ? bytes.byteLength : undefined
}

export function isLocalGitFileSelection(value) {
  try {
    const selection = record(value, ['path'])
    return !!selection && pathBytes(selection.path) !== undefined
  } catch { return false }
}

/** Complete bounded metadata, not a prefix presented as the whole repository. */
export function parseLocalGitFileListing(value) {
  try {
    const listing = record(value, ['version', 'files', 'excludedCount'])
    if (!listing || listing.version !== 1 || !Number.isSafeInteger(listing.excludedCount) || listing.excludedCount < 0) return undefined
    const files = array(listing.files)
    if (!files || files.length + listing.excludedCount > MAX_GIT_BROWSE_ENTRIES) return undefined
    let previous = ''
    let total = 0
    const detached = []
    for (const item of files) {
      const file = record(item, ['path', 'kind'])
      const bytes = file && pathBytes(file.path)
      if (bytes === undefined || (previous && file.path <= previous) ||
        !['file', 'conflict', 'sparse', 'unsupported'].includes(file.kind)) return undefined
      if (file.kind === 'file' && !isLocalTextFileName(file.path.split('/').at(-1))) return undefined
      total += bytes
      if (total > MAX_GIT_BROWSE_PATH_BYTES) return undefined
      previous = file.path
      detached.push({ path: file.path, kind: file.kind })
    }
    return { version: 1, files: detached, excludedCount: listing.excludedCount }
  } catch { return undefined }
}

/** One whole working-file copy; absent, binary and oversized are never empty. */
export function parseLocalGitFilePreview(value) {
  try {
    const preview = record(value, ['version', 'path', 'sizeBytes', 'snapshot'])
    if (!preview || preview.version !== 1 || pathBytes(preview.path) === undefined ||
      !Number.isSafeInteger(preview.sizeBytes) || preview.sizeBytes < 0) return undefined
    const text = record(preview.snapshot, ['text'])
    if (text) {
      if (!isLocalTextFileName(preview.path.split('/').at(-1)) || typeof text.text !== 'string' ||
        text.text.length > MAX_GIT_BROWSE_FILE_BYTES) return undefined
      const bytes = encoder.encode(text.text)
      if (bytes.byteLength !== preview.sizeBytes || bytes.byteLength > MAX_GIT_BROWSE_FILE_BYTES ||
        decodeLocalTextPreview(bytes) !== text.text) return undefined
      return { version: 1, path: preview.path, sizeBytes: preview.sizeBytes, snapshot: { text: text.text } }
    }
    const omission = record(preview.snapshot, ['omitted'])
    if (!omission || !['unsupported', 'too-large', 'unreadable'].includes(omission.omitted) ||
      (omission.omitted === 'too-large' && preview.sizeBytes <= MAX_GIT_BROWSE_FILE_BYTES)) return undefined
    return { version: 1, path: preview.path, sizeBytes: preview.sizeBytes, snapshot: { omitted: omission.omitted } }
  } catch { return undefined }
}
