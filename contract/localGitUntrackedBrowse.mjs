import {
  isLocalGitFileSelection,
  parseLocalGitFileListing,
  parseLocalGitFilePreview,
} from './localGitBrowse.mjs'

function record(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) return undefined
  const own = Reflect.ownKeys(value)
  if (own.length !== keys.length || own.some(key => typeof key !== 'string' || !keys.includes(key))) return undefined
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) return undefined
  }
  const result = Object.create(null)
  for (const key of keys) result[key] = Object.getOwnPropertyDescriptor(value, key).value
  return result
}

export function parseLocalGitUntrackedFilesRequest(value) {
  try {
    const request = record(value, ['scope', 'operationId'])
    return request?.scope === 'untracked' && validOperationId(request.operationId)
      ? { scope: 'untracked', operationId: request.operationId } : undefined
  } catch { return undefined }
}

export function parseLocalGitUntrackedFileRequest(value) {
  try {
    const request = record(value, ['scope', 'path', 'operationId'])
    const selection = request && { path: request.path }
    return request?.scope === 'untracked' && isLocalGitFileSelection(selection)
      && validOperationId(request.operationId)
      ? { scope: 'untracked', path: selection.path, operationId: request.operationId } : undefined
  } catch { return undefined }
}

function validOperationId(value) {
  return typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
}

export function parseLocalGitUntrackedFileListing(value) {
  try {
    const listing = record(value, ['scope', 'version', 'files', 'excludedCount'])
    if (listing?.scope !== 'untracked') return undefined
    const parsed = parseLocalGitFileListing({ version: listing.version, files: listing.files, excludedCount: listing.excludedCount })
    return parsed && parsed.files.every(file => file.kind === 'file' || file.kind === 'unsupported')
      ? { scope: 'untracked', ...parsed } : undefined
  } catch { return undefined }
}

export function parseLocalGitUntrackedFilePreview(value) {
  try {
    const preview = record(value, ['scope', 'version', 'path', 'sizeBytes', 'snapshot'])
    if (preview?.scope !== 'untracked') return undefined
    const parsed = parseLocalGitFilePreview({ version: preview.version, path: preview.path,
      sizeBytes: preview.sizeBytes, snapshot: preview.snapshot })
    return parsed ? { scope: 'untracked', ...parsed } : undefined
  } catch { return undefined }
}
