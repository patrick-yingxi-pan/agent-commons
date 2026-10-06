import { isAbsolute } from 'node:path'
import { isGitSnapshotPath } from '../contract/localGitSnapshot.mjs'

const MAX_HEAD_BYTES = 4096
const MAX_PACKED_REFS_BYTES = 16 * 1024 * 1024
const MAX_SYMREF_HOPS = 8
const FAILURE = 'The Git baseline is unavailable or unsupported.'
const fail = () => { throw new Error(FAILURE) }

function oidPattern(objectFormat) {
  if (objectFormat === 'sha1') return /^(?!0{40}$)[a-f0-9]{40}$/
  if (objectFormat === 'sha256') return /^(?!0{64}$)[a-f0-9]{64}$/
  fail()
}

function validGitRefName(ref) {
  if (!isGitSnapshotPath(ref) || !ref.startsWith('refs/') || ref.endsWith('/') || ref.includes('//') ||
    ref.includes('..') || ref.includes('@{') || /[\x00-\x20\x7f ~^:?*[\\]/.test(ref)) return false
  const components = ref.split('/')
  return components.length >= 2 && components.every((component) => component && component !== '@' &&
    !component.startsWith('.') && !component.endsWith('.') && !component.endsWith('.lock'))
}

function validHeadRef(ref) {
  return typeof ref === 'string' && ref.startsWith('refs/heads/') && validGitRefName(ref)
}

function decodeText(value, maximum) {
  if (!value || value.status !== 'file' || !(value.bytes instanceof Uint8Array) ||
    value.bytes.byteLength > maximum || value.sizeBytes !== value.bytes.byteLength) fail()
  try { return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(value.bytes) } catch { fail() }
}

function parseDirectOrSymbolic(text, oidPatternForFormat) {
  const line = text.endsWith('\r\n') ? text.slice(0, -2) : text.endsWith('\n') ? text.slice(0, -1) : text
  if (!line || /[\r\n]/.test(line)) fail()
  if (oidPatternForFormat.test(line)) return { oid: line, ref: null }
  if (!line.startsWith('ref: ')) fail()
  const ref = line.slice(5)
  if (!validHeadRef(ref)) fail()
  return { oid: null, ref }
}

function parsePackedRefs(text, oidPatternForFormat) {
  if (!text) fail()
  if (!text.endsWith('\n')) fail()
  const refs = new Map()
  let previousRef = null
  let previousWasPeeled = false
  for (const line of text.slice(0, -1).split('\n')) {
    if (line.startsWith('#')) {
      if (/[\x00-\x1f\x7f]/.test(line)) fail()
      if (previousRef !== null) { previousRef = null; previousWasPeeled = false }
      continue
    }
    if (line.startsWith('^')) {
      if (previousRef === null || previousWasPeeled || !oidPatternForFormat.test(line.slice(1))) fail()
      previousWasPeeled = true
      continue
    }
    const separator = line.indexOf(' ')
    if (separator < 1 || line.indexOf(' ', separator + 1) !== -1) fail()
    const oid = line.slice(0, separator)
    const ref = line.slice(separator + 1)
    if (!oidPatternForFormat.test(oid) || !validGitRefName(ref) || refs.has(ref)) fail()
    refs.set(ref, oid)
    previousRef = ref
    previousWasPeeled = false
  }
  return refs
}

function validateRoot(root) {
  if (!root || typeof root.path !== 'string' || !isAbsolute(root.path) || !root.identity ||
    typeof root.identity.dev !== 'string' || !/^(0|[1-9]\d*)$/.test(root.identity.dev) ||
    typeof root.identity.ino !== 'string' || !/^(0|[1-9]\d*)$/.test(root.identity.ino)) fail()
}

/** Resolve the captured repository's HEAD without executing Git against its source paths. */
export async function resolveGitHead({ git, common, objectFormat = 'sha1', load } = {}) {
  try {
    validateRoot(git)
    validateRoot(common)
    if (typeof load !== 'function') fail()
    const oidPatternForFormat = oidPattern(objectFormat)

    const reftable = await load(common, 'reftable/tables.list', null)
    if (reftable?.status === 'file' || reftable?.status === 'too-large') fail()
    if (reftable?.status !== 'missing') fail()

    const headValue = await load(git, 'HEAD', MAX_HEAD_BYTES)
    const head = parseDirectOrSymbolic(decodeText(headValue, MAX_HEAD_BYTES), oidPatternForFormat)
    if (head.oid) return head

    let ref = head.ref
    const seen = new Set()
    let packedRefs
    for (let hop = 0; hop <= MAX_SYMREF_HOPS; hop += 1) {
      if (!validHeadRef(ref) || seen.has(ref)) fail()
      seen.add(ref)
      const loose = await load(common, ref, MAX_HEAD_BYTES)
      if (loose?.status === 'file') {
        const parsed = parseDirectOrSymbolic(decodeText(loose, MAX_HEAD_BYTES), oidPatternForFormat)
        if (parsed.oid) return { oid: parsed.oid, ref }
        ref = parsed.ref
        continue
      }
      if (loose?.status !== 'missing') fail()
      if (!packedRefs) {
        const packed = await load(common, 'packed-refs', MAX_PACKED_REFS_BYTES)
        if (packed?.status === 'missing') packedRefs = new Map()
        else packedRefs = parsePackedRefs(decodeText(packed, MAX_PACKED_REFS_BYTES), oidPatternForFormat)
      }
      return { oid: packedRefs.get(ref) ?? null, ref }
    }
    fail()
  } catch {
    fail()
  }
}
