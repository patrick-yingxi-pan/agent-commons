import { isGitSnapshotPath, MAX_GIT_SNAPSHOT_FILE_BYTES, MAX_GIT_SNAPSHOT_TOTAL_BYTES } from './localGitSnapshot.mjs'
import { isGitReviewChange, parseLocalGitReviewHead, parseLocalGitReviewSide } from './localGitReview.mjs'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const COMPARISONS = new Set(['staged', 'unstaged'])
const UNAVAILABLE = new Set(['ignored', 'not-tracked', 'not-in-index', 'sparse', 'unmerged'])
const SIDE_OMISSIONS = new Set(['unsupported', 'too-large', 'unreadable'])
const encoder = new TextEncoder()
const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true })

function record(value, keys) {
  try {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
    const prototype = Object.getPrototypeOf(value)
    if (prototype !== Object.prototype && prototype !== null) return undefined
    const own = Reflect.ownKeys(value)
    if (own.length !== keys.length || own.some(key => typeof key !== 'string' || !keys.includes(key))) return undefined
    for (const key in value) if (!Object.hasOwn(value, key)) return undefined
    const result = Object.create(null)
    for (const key of keys) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key)
      if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value') ||
        Object.hasOwn(descriptor, 'get') || Object.hasOwn(descriptor, 'set')) return undefined
      result[key] = descriptor.value
    }
    return result
  } catch { return undefined }
}

function validPath(path) {
  if (!isGitSnapshotPath(path) || path.split('/').length > 64) return false
  try {
    const bytes = encoder.encode(path)
    return bytes.byteLength <= 4096 && decoder.decode(bytes) === path
  } catch { return false }
}

function validComparison(value) {
  return typeof value === 'string' && COMPARISONS.has(value)
}

function validOperationId(value) {
  return typeof value === 'string' && UUID.test(value)
}

export function parseLocalGitFileComparisonSelection(value) {
  const selection = record(value, ['path', 'comparison'])
  if (!selection || !validPath(selection.path) || !validComparison(selection.comparison)) return undefined
  return { path: selection.path, comparison: selection.comparison }
}

export function parseLocalGitFileComparisonRequest(value) {
  const request = record(value, ['scope', 'operationId', 'path', 'comparison'])
  if (!request || request.scope !== 'file-comparison' || !validOperationId(request.operationId)) return undefined
  const selection = parseLocalGitFileComparisonSelection({ path: request.path, comparison: request.comparison })
  return selection ? { scope: 'file-comparison', operationId: request.operationId, ...selection } : undefined
}

export function parseLocalGitFileComparisonCancel(value) {
  const request = record(value, ['scope', 'operationId'])
  if (!request || request.scope !== 'file-comparison' || !validOperationId(request.operationId)) return undefined
  return { scope: 'file-comparison', operationId: request.operationId }
}

function detachedSide(value) {
  const side = parseLocalGitReviewSide(value)
  if (!side || (side.kind === 'omitted' && !SIDE_OMISSIONS.has(side.reason))) return undefined
  return side
}

function coherentReadySides(comparison, change, before, after) {
  if (change === 'unmerged' || (comparison === 'staged' && change === 'unavailable')) return false
  if (before.kind === 'missing') return comparison === 'staged' && after.kind !== 'missing' && change === 'added'
  if (after.kind === 'missing') return change === 'deleted'
  if (before.kind === 'text' && after.kind === 'text') {
    const sameText = before.text === after.text
    const expected = sameText
      ? (before.mode === after.mode ? 'unchanged' : 'mode-changed')
      : 'modified'
    return change === expected
  }
  if (change === 'added' || change === 'deleted') return false
  return true
}

/** Validate and detach the one selected Git comparison; it is never a repository snapshot. */
export function parseLocalGitFileComparison(value) {
  const outer = record(value, ['version', 'scope', 'path', 'comparison', 'head', 'status', 'change', 'before', 'after'])
  if (outer) {
    if (outer.version !== 1 || outer.scope !== 'file-comparison' || !validPath(outer.path) ||
      !validComparison(outer.comparison) || outer.status !== 'ready' || !isGitReviewChange(outer.change)) return undefined
    const head = parseLocalGitReviewHead(outer.head)
    const before = detachedSide(outer.before)
    const after = detachedSide(outer.after)
    if (!head || !before || !after || !coherentReadySides(outer.comparison, outer.change, before, after)) return undefined
    const size = (side) => side.kind === 'text' ? encoder.encode(side.text).byteLength : 0
    if (size(before) > MAX_GIT_SNAPSHOT_FILE_BYTES || size(after) > MAX_GIT_SNAPSHOT_FILE_BYTES ||
      size(before) + size(after) > MAX_GIT_SNAPSHOT_TOTAL_BYTES) return undefined
    return { version: 1, scope: 'file-comparison', path: outer.path, comparison: outer.comparison,
      head, status: 'ready', change: outer.change, before, after }
  }
  const unavailable = record(value, ['version', 'scope', 'path', 'comparison', 'head', 'status', 'reason'])
  if (!unavailable || unavailable.version !== 1 || unavailable.scope !== 'file-comparison' ||
    !validPath(unavailable.path) || !validComparison(unavailable.comparison) || unavailable.status !== 'unavailable' ||
    typeof unavailable.reason !== 'string' || !UNAVAILABLE.has(unavailable.reason) ||
    (unavailable.reason === 'not-tracked' && unavailable.comparison !== 'staged') ||
    (unavailable.reason === 'not-in-index' && unavailable.comparison !== 'unstaged')) return undefined
  const head = parseLocalGitReviewHead(unavailable.head)
  return head ? { version: 1, scope: 'file-comparison', path: unavailable.path,
    comparison: unavailable.comparison, head, status: 'unavailable', reason: unavailable.reason } : undefined
}
