import {
  isGitSnapshotPath,
  MAX_GIT_SNAPSHOT_ENTRIES,
  MAX_GIT_SNAPSHOT_FILE_BYTES,
  MAX_GIT_SNAPSHOT_TOTAL_BYTES,
} from './localGitSnapshot.mjs'
import { decodeLocalTextPreview } from './localTextFile.mjs'

const CHANGES = new Set(['unchanged', 'added', 'deleted', 'modified', 'mode-changed', 'type-changed', 'unavailable', 'unmerged'])
const OMISSIONS = new Set(['unsupported', 'too-large', 'budget', 'unreadable', 'sparse', 'unmerged', 'not-needed'])
const OID = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/
const TEXT_ENCODER = new TextEncoder()

function ownRecord(value, keys) {
  try {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
    const prototype = Object.getPrototypeOf(value)
    if (prototype !== Object.prototype && prototype !== null) return undefined
    const ownKeys = Reflect.ownKeys(value)
    if (ownKeys.length !== keys.length || ownKeys.some(key => typeof key !== 'string' || !keys.includes(key))) return undefined
    for (const key in value) if (!Object.hasOwn(value, key)) return undefined
    const result = Object.create(null)
    for (const key of keys) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key)
      if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value') ||
        Object.hasOwn(descriptor, 'get') || Object.hasOwn(descriptor, 'set')) return undefined
      result[key] = descriptor.value
    }
    return result
  } catch {
    return undefined
  }
}

function ownArray(value, maximum) {
  try {
    if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length > maximum) return undefined
    const length = Object.getOwnPropertyDescriptor(value, 'length')
    if (!length || !Object.hasOwn(length, 'value') || length.value !== value.length) return undefined
    const keys = Reflect.ownKeys(value)
    if (keys.length !== value.length + 1 || !keys.includes('length')) return undefined
    for (const key in value) if (!Object.hasOwn(value, key)) return undefined
    const result = []
    for (let index = 0; index < value.length; index += 1) {
      const key = String(index)
      const descriptor = Object.getOwnPropertyDescriptor(value, key)
      if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value') ||
        Object.hasOwn(descriptor, 'get') || Object.hasOwn(descriptor, 'set')) return undefined
      result.push(descriptor.value)
    }
    return result
  } catch {
    return undefined
  }
}

function validRef(value) {
  if (typeof value !== 'string' || !value.startsWith('refs/heads/') ||
    !isGitSnapshotPath(value) || value.endsWith('/') || value.includes('//') || value.includes('..') ||
    value.includes('@{') || /[\x00-\x20\x7f ~^:?*[\\]/.test(value)) return false
  const components = value.split('/')
  return components.length >= 3 && components.every(component => component && component !== '@' &&
    !component.startsWith('.') && !component.endsWith('.') && !component.endsWith('.lock'))
}

export function parseLocalGitReviewHead(value) {
  const head = ownRecord(value, ['oid', 'ref'])
  if (!head) return undefined
  if (head.oid !== null && (typeof head.oid !== 'string' || !OID.test(head.oid) || /^0+$/.test(head.oid))) return undefined
  if (head.ref !== null && !validRef(head.ref)) return undefined
  // The reader reports unborn symbolic branches as {oid:null, ref}, and a
  // detached HEAD as {oid, ref:null}; null/null has no Git meaning.
  if (head.oid === null && head.ref === null) return undefined
  return { oid: head.oid, ref: head.ref }
}

export function isGitReviewChange(value) {
  return typeof value === 'string' && CHANGES.has(value)
}

function validText(value) {
  if (typeof value !== 'string' || value.length > MAX_GIT_SNAPSHOT_FILE_BYTES) return undefined
  const bytes = TEXT_ENCODER.encode(value)
  if (bytes.byteLength > MAX_GIT_SNAPSHOT_FILE_BYTES) return undefined
  try {
    if (decodeLocalTextPreview(bytes) !== value) return undefined
  } catch {
    return undefined
  }
  return bytes.byteLength
}

function validSide(value) {
  try {
    const kind = value && typeof value === 'object' && !Array.isArray(value)
      ? Object.getOwnPropertyDescriptor(value, 'kind') : undefined
    if (!kind || !Object.hasOwn(kind, 'value')) return undefined
    if (kind.value === 'missing') {
      const side = ownRecord(value, ['kind'])
      return side ? { kind: 'missing' } : undefined
    }
    if (kind.value === 'text') {
      const side = ownRecord(value, ['kind', 'text', 'mode'])
      if (!side || !['100644', '100755'].includes(side.mode)) return undefined
      const byteLength = validText(side.text)
      if (byteLength === undefined) return undefined
      return { value: { kind: 'text', text: side.text, mode: side.mode }, byteLength }
    }
    if (kind.value === 'omitted') {
      const side = ownRecord(value, ['kind', 'reason'])
      if (!side || typeof side.reason !== 'string' || !OMISSIONS.has(side.reason)) return undefined
      return { kind: 'omitted', reason: side.reason }
    }
    return undefined
  } catch {
    return undefined
  }
}

/** Validate and detach one shared Git-review side without applying a review's aggregate budget. */
export function parseLocalGitReviewSide(value) {
  const side = validSide(value)
  return side ? side.value ?? side : undefined
}

/** Parse and detach the internal, raw-byte local Git review projection. */
export function parseLocalGitReview(value) {
  try {
    const review = ownRecord(value, ['version', 'comparison', 'head', 'excludedCount', 'unchangedCount', 'files'])
    if (!review || review.version !== 1 || review.comparison !== 'raw') return undefined
    const head = parseLocalGitReviewHead(review.head)
    const files = ownArray(review.files, MAX_GIT_SNAPSHOT_ENTRIES)
    if (!head || !files || !Number.isSafeInteger(review.excludedCount) || review.excludedCount < 0 ||
      !Number.isSafeInteger(review.unchangedCount) || review.unchangedCount < 0) return undefined

    const detachedFiles = []
    let previous = ''
    let displayBytes = 0
    for (const item of files) {
      const file = ownRecord(item, ['path', 'staged', 'unstaged', 'head', 'index', 'working'])
      if (!file || !isGitSnapshotPath(file.path) || (previous && file.path <= previous) ||
        !isGitReviewChange(file.staged) || !isGitReviewChange(file.unstaged)) return undefined
      previous = file.path
      const sides = []
      for (const key of ['head', 'index', 'working']) {
        const side = validSide(file[key])
        if (!side) return undefined
        if (side.byteLength !== undefined) displayBytes += side.byteLength
        sides.push(side.value ?? side)
      }
      if (displayBytes > MAX_GIT_SNAPSHOT_TOTAL_BYTES) return undefined
      detachedFiles.push({ path: file.path, staged: file.staged, unstaged: file.unstaged,
        head: sides[0], index: sides[1], working: sides[2] })
    }
    if (review.excludedCount + review.unchangedCount + files.length > MAX_GIT_SNAPSHOT_ENTRIES) return undefined
    return {
      version: 1,
      comparison: 'raw',
      head,
      excludedCount: review.excludedCount,
      unchangedCount: review.unchangedCount,
      files: detachedFiles,
    }
  } catch {
    return undefined
  }
}
