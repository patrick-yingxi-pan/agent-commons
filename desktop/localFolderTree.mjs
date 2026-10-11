import { basename } from 'node:path'
import { MAX_FOLDER_SNAPSHOT_FILE_BYTES } from '../contract/localFolderSnapshot.mjs'
import { isFolderTreeFiles, snapshotFolderTreeFiles } from '../contract/localFolderTree.mjs'
import { listLocalFolderTree, readGitFile } from './gitFileRead.mjs'

const CAPTURE_TIMEOUT_MS = 30_000
const SOURCE_ERROR = 'The selected folder is unavailable, has changed, or exceeds recursive capture limits.'

/** Explicit capture only. Enumeration and file reads use the same bundled
 * descriptor-relative helper, while the portable builder owns all text budgets.
 * Neither metadata enumeration nor unsupported files can grant a body read. */
export async function readLocalFolderTree(root, {
  signal, executable, listTree = listLocalFolderTree, readFile = readGitFile,
} = {}) {
  const deadline = AbortSignal.timeout(CAPTURE_TIMEOUT_MS)
  const captureSignal = signal ? AbortSignal.any([signal, deadline]) : deadline
  const options = { signal: captureSignal, ...(executable ? { executable } : {}) }
  let changed = false
  try {
    captureSignal.throwIfAborted()
    const before = await listTree(root, options)
    const files = before.entries.filter((entry) => entry.kind === 'F')
    const captured = await snapshotFolderTreeFiles(files, async (file) => {
      captureSignal.throwIfAborted()
      let result
      try {
        result = await readFile(root, file.name, { ...options, maxBytes: MAX_FOLDER_SNAPSHOT_FILE_BYTES })
      } catch {
        // Helper failures cannot be confused with a validated unreadable leaf.
        changed = true
        throw new Error(SOURCE_ERROR)
      }
      if (result.status === 'unreadable') throw new Error('The selected file is unreadable.')
      if (result.status !== 'file' || result.version !== file.version || result.sizeBytes !== file.sizeBytes) {
        changed = true
        throw new Error(SOURCE_ERROR)
      }
      return result.bytes
    })
    captureSignal.throwIfAborted()
    if (changed) throw new Error(SOURCE_ERROR)
    const after = await listTree(root, options)
    captureSignal.throwIfAborted()
    if (JSON.stringify(before) !== JSON.stringify(after) || !isFolderTreeFiles(captured)) throw new Error(SOURCE_ERROR)
    return { name: basename(root.path), files: captured }
  } catch {
    if (signal?.aborted) throw new Error('The folder capture was cancelled.')
    if (deadline.aborted) throw new Error('The folder capture exceeded its time limit.')
    throw new Error(SOURCE_ERROR)
  }
}
