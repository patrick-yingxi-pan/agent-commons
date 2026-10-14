import { createHash } from 'node:crypto'
import { parseLocalGitFileComparisonSelection, parseLocalGitFileComparison } from '../contract/localGitFileComparison.mjs'
import { MAX_GIT_SNAPSHOT_FILE_BYTES } from '../contract/localGitSnapshot.mjs'
import { decodeLocalTextPreview, isLocalTextFileName } from '../contract/localTextFile.mjs'
import { withLocalGitFileBaseline } from './gitBaselineReader.mjs'
import { compareGitEntries } from './gitReviewPlan.mjs'
import { gitWorkingMode } from './gitWorkingMode.mjs'

const regular = entry => entry && ['100644', '100755'].includes(entry.mode)
const missing = () => ({ kind: 'missing' })
const omitted = reason => ({ kind: 'omitted', reason })

async function readBlobSide(entry, path, { probeBlob, readBlob }) {
  if (!entry) return missing()
  if (!regular(entry) || !isLocalTextFileName(path.split('/').at(-1))) return omitted('unsupported')
  const hint = await probeBlob(entry.oid)
  if (hint.sizeHintBytes > MAX_GIT_SNAPSHOT_FILE_BYTES) return omitted('too-large')
  try {
    const bytes = await readBlob(entry.oid, MAX_GIT_SNAPSHOT_FILE_BYTES)
    if (!(bytes instanceof Uint8Array) || bytes.byteLength > MAX_GIT_SNAPSHOT_FILE_BYTES) return omitted('too-large')
    const text = decodeLocalTextPreview(bytes)
    return text === undefined ? omitted('unreadable') : { kind: 'text', text, mode: entry.mode }
  } catch {
    return omitted('unreadable')
  }
}

async function readWorkingSide(path, index, { readWorkingFile }) {
  if (!regular(index)) return { change: 'unavailable', side: omitted('unsupported') }
  if (!isLocalTextFileName(path.split('/').at(-1))) return { change: 'unavailable', side: omitted('unsupported') }
  let metadata
  try { metadata = await readWorkingFile(path, null) }
  catch { return { change: 'unavailable', side: omitted('unreadable') } }
  if (metadata.status === 'missing') return { change: 'deleted', side: missing(), entry: null }
  if (metadata.status === 'too-large') return { change: 'unavailable', side: omitted('too-large') }
  if (metadata.status === 'unsupported') return { change: 'unavailable', side: omitted('unsupported') }
  if (metadata.status !== 'file') return { change: 'unavailable', side: omitted('unreadable') }
  if (metadata.sizeBytes > MAX_GIT_SNAPSHOT_FILE_BYTES) return { change: 'unavailable', side: omitted('too-large') }
  let value
  try { value = await readWorkingFile(path, MAX_GIT_SNAPSHOT_FILE_BYTES) }
  catch { return { change: 'unavailable', side: omitted('unreadable') } }
  if (value.status !== 'file' || !(value.bytes instanceof Uint8Array) ||
    value.bytes.byteLength !== metadata.sizeBytes || value.version !== metadata.version) {
    throw new Error('The Git working file changed during comparison.')
  }
  const mode = gitWorkingMode(value)
  const text = decodeLocalTextPreview(value.bytes)
  if (text === undefined) return { change: 'unavailable', side: omitted('unreadable') }
  return { change: 'unavailable', side: { kind: 'text', text, mode }, entry: { mode }, bytes: value.bytes }
}

function unavailable(selection, head, reason) {
  return { version: 1, scope: 'file-comparison', path: selection.path, comparison: selection.comparison,
    head, status: 'unavailable', reason }
}

/** Read exactly one selected staged or unstaged comparison through the fenced native baseline. */
export async function readLocalGitFileComparison(root, input, options = {}) {
  const selection = parseLocalGitFileComparisonSelection(input)
  if (!selection) throw new Error('The selected Git comparison is invalid.')
  const candidate = await withLocalGitFileBaseline(root, selection.path, {
    ...options, includeWorkingTree: selection.comparison === 'unstaged',
  }, async ({
    objectFormat, head, selection: baselineSelection, headEntries, indexEntries, ignoredPaths, readBlob, probeBlob, readWorkingFile,
  }) => {
    const headIdentity = { ...head }
    const base = { version: 1, scope: 'file-comparison', path: selection.path,
      comparison: selection.comparison, head: headIdentity }
    if (ignoredPaths.includes(selection.path)) return unavailable(selection, headIdentity, 'ignored')
    if (baselineSelection.sparse) return unavailable(selection, headIdentity, 'sparse')
    if (indexEntries.some(entry => entry.stage !== 0)) return unavailable(selection, headIdentity, 'unmerged')

    const headEntry = headEntries.find(entry => entry.name === selection.path) ?? null
    const indexEntry = indexEntries.find(entry => entry.name === selection.path && entry.stage === 0) ?? null
    if (!headEntry && !indexEntry) return unavailable(selection, headIdentity,
      selection.comparison === 'unstaged' ? 'not-in-index' : 'not-tracked')
    if (selection.comparison === 'unstaged' && !indexEntry) {
      return unavailable(selection, headIdentity, 'not-in-index')
    }

    let afterEntry
    let before
    let after
    let change
    if (selection.comparison === 'staged') {
      change = compareGitEntries(headEntry, indexEntry)
      before = await readBlobSide(headEntry, selection.path, { probeBlob, readBlob })
      after = await readBlobSide(indexEntry, selection.path, { probeBlob, readBlob })
    } else {
      before = await readBlobSide(indexEntry, selection.path, { probeBlob, readBlob })
      const working = await readWorkingSide(selection.path, indexEntry, { readWorkingFile })
      after = working.side
      if (working.entry === null) afterEntry = null
      else if (working.entry) {
        const oid = createHash(objectFormat).update(`blob ${working.bytes.byteLength}\0`).update(working.bytes).digest('hex')
        afterEntry = { ...working.entry, oid }
      }
      change = working.change === 'deleted' ? compareGitEntries(indexEntry, null)
        : working.entry ? compareGitEntries(indexEntry, afterEntry) : 'unavailable'
    }
    const result = { ...base, status: 'ready', change, before, after }
    return result
  })
  const parsed = parseLocalGitFileComparison(candidate)
  if (!parsed) throw new Error('The selected Git comparison could not be validated.')
  return parsed
}
