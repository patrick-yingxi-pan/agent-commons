import { createHash } from 'node:crypto'
import { withLocalGitBaseline } from './gitBaselineReader.mjs'
import { planGitReview, compareGitEntries } from './gitReviewPlan.mjs'
import { gitWorkingMode } from './gitWorkingMode.mjs'
import { decodeLocalTextPreview, isLocalTextFileName } from '../contract/localTextFile.mjs'
import { MAX_GIT_SNAPSHOT_FILE_BYTES, MAX_GIT_SNAPSHOT_TOTAL_BYTES, MAX_GIT_SNAPSHOT_READABLE_FILES } from '../contract/localGitSnapshot.mjs'

const regular = (entry) => entry && ['100644', '100755'].includes(entry.mode)
const omitted = (reason) => ({ kind: 'omitted', reason })
const missing = () => ({ kind: 'missing' })

/** Internal explicit local review, not a saved snapshot or model input.
 * Compare raw bytes and owner-executable mode, never run filters, attributes,
 * external diff drivers or source Git configuration. All reads belong to the
 * baseline transaction; no partial result escapes a changed source fence. */
export async function readLocalGitReview(root, options = {}) {
  return withLocalGitBaseline(root, { ...options, includeWorkingTree: true }, async ({
    objectFormat, head, headEntries, indexEntries, ignoredPaths, readWorkingFile, readBlob, probeBlob,
  }) => {
    const excluded = new Set(ignoredPaths)
    const plan = planGitReview(headEntries, indexEntries).filter(entry => !excluded.has(entry.path))
    const changes = entry => entry.sparse ? 'unavailable' : entry.conflicted ? 'unmerged' : compareGitEntries(entry.head, entry.index)
    // Give staged changes first access to the bounded working/read preview,
    // while keeping the final list in deterministic path order.
    const ordered = [...plan].sort((a, b) => Number(changes(a) === 'unchanged') - Number(changes(b) === 'unchanged') ||
      (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
    let workingBytes = 0
    let workingFiles = 0
    let displayBytes = 0
    let unchangedCount = 0
    const files = []
    const retain = (bytes, mode) => {
      const text = decodeLocalTextPreview(bytes)
      if (text === undefined) return omitted('unreadable')
      if (bytes.byteLength > MAX_GIT_SNAPSHOT_TOTAL_BYTES - displayBytes) return omitted('budget')
      displayBytes += bytes.byteLength
      return { kind: 'text', text, mode }
    }
    const baselineSide = async (entry, path) => {
      if (!entry) return missing()
      if (!regular(entry) || !isLocalTextFileName(path.split('/').at(-1))) return omitted('unsupported')
      const hint = await probeBlob(entry.oid)
      if (hint.sizeHintBytes > MAX_GIT_SNAPSHOT_FILE_BYTES) return omitted('too-large')
      if (hint.sizeHintBytes > MAX_GIT_SNAPSHOT_TOTAL_BYTES - displayBytes) return omitted('budget')
      // The probe is not evidence: only readBlob verifies the requested body.
      return retain(await readBlob(entry.oid), entry.mode)
    }
    for (const entry of ordered) {
      const staged = changes(entry)
      if (entry.sparse || entry.conflicted) {
        const reason = entry.sparse ? 'sparse' : 'unmerged'
        files.push({ path: entry.path, staged, unstaged: staged, head: omitted(reason), index: omitted(reason), working: omitted(reason) })
        continue
      }
      let working = null
      let workingBody
      let workingSide = missing()
      let unavailable = false
      if (entry.index) {
        if (!regular(entry.index)) {
          unavailable = true
          workingSide = omitted('unsupported')
        } else {
          const meta = await readWorkingFile(entry.path, null)
          if (meta.status === 'missing') workingSide = missing()
          else if (meta.status !== 'file') {
            unavailable = true
            workingSide = omitted(meta.status === 'unsupported' ? 'unsupported' : 'unreadable')
          } else if (!isLocalTextFileName(entry.path.split('/').at(-1))) {
            unavailable = true
            workingSide = omitted('unsupported')
          } else if (meta.sizeBytes > MAX_GIT_SNAPSHOT_FILE_BYTES) {
            unavailable = true
            workingSide = omitted('too-large')
          } else if (workingFiles >= MAX_GIT_SNAPSHOT_READABLE_FILES || meta.sizeBytes > MAX_GIT_SNAPSHOT_TOTAL_BYTES - workingBytes) {
            unavailable = true
            workingSide = omitted('budget')
          } else {
            const value = await readWorkingFile(entry.path)
            if (value.status !== 'file' || !(value.bytes instanceof Uint8Array) || value.bytes.byteLength !== meta.sizeBytes) {
              throw new Error('The Git working file changed during review.')
            }
            const mode = gitWorkingMode(value)
            workingBody = value.bytes
            workingBytes += workingBody.byteLength
            workingFiles += 1
            const oid = createHash(objectFormat).update(`blob ${workingBody.byteLength}\0`).update(workingBody).digest('hex')
            working = { mode, oid }
          }
        }
      }
      // HEAD-only paths were deleted from the index. Any current file at that
      // path is now untracked and must not become working-tree read authority.
      const unstaged = unavailable ? 'unavailable' : compareGitEntries(entry.index, working)
      if (staged === 'unchanged' && unstaged === 'unchanged') { unchangedCount += 1; continue }
      const headSide = staged === 'unchanged' ? omitted('not-needed') : await baselineSide(entry.head, entry.path)
      const indexSide = await baselineSide(entry.index, entry.path)
      if (workingBody) workingSide = unstaged === 'unchanged' ? omitted('not-needed') : retain(workingBody, working.mode)
      files.push({ path: entry.path, staged, unstaged, head: headSide, index: indexSide, working: workingSide })
    }
    files.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0)
    return { version: 1, comparison: 'raw', head: { ...head }, excludedCount: excluded.size, unchangedCount, files }
  })
}
