import { isGitSnapshotPath } from '../contract/localGitSnapshot.mjs'
import { MAX_GIT_BROWSE_ENTRIES, MAX_GIT_BROWSE_PATH_BYTES } from '../contract/localGitBrowse.mjs'
import { isLocalBrowseFileName } from '../contract/localFileBrowse.mjs'

const MAX_DIRECTORIES = 1024
const MAX_DEPTH = 64
const fail = () => { throw new Error('The untracked repository listing is unavailable or exceeds its read limits.') }

/** Internal discovery only. The caller owns the pinned index/ignore/directory
 * transaction and its final publication fence. No file contents are read here. */
export async function discoverUntrackedGitFiles({ list, directory, ignoredPaths }) {
  const indexed = new Set((await list(true)).map(entry => entry.name))
  const directories = ['']
  const files = []
  let visited = 0, pathBytes = 0, excludedCount = 0
  for (let position = 0; position < directories.length; position++) {
    const parent = directories[position]
    const scan = await directory(parent)
    visited += scan.visited
    if (visited > MAX_GIT_BROWSE_ENTRIES) fail()
    // The directory protocol admits only safe single names. The Git path rule
    // additionally rejects .git and its case/HFS aliases. Any such marker in a
    // child directory is a nested repository boundary, regardless of its type.
    if (parent && scan.entries.some(entry => !isGitSnapshotPath(entry.name))) continue
    const candidates = []
    for (const entry of scan.entries) {
      const name = parent ? `${parent}/${entry.name}` : entry.name
      if (!isGitSnapshotPath(name) || indexed.has(name)) continue
      // Never walk through a tracked file, conflict, sparse directory or
      // gitlink even if the current filesystem happens to contain a directory.
      const parts = name.split('/')
      if (parts.slice(0, -1).some((_, index) => indexed.has(parts.slice(0, index + 1).join('/')))) continue
      const bytes = Buffer.byteLength(name)
      pathBytes += bytes
      if (bytes > 4096 || pathBytes > MAX_GIT_BROWSE_PATH_BYTES) fail()
      candidates.push({ ...entry, name, mode: entry.kind === 'D' ? '040000' : entry.kind === 'F' ? '100644' : '120000' })
    }
    const ignored = candidates.length ? await ignoredPaths(candidates, MAX_GIT_BROWSE_ENTRIES,
      { isolated: true, readCandidateDirectoryIgnores: false }) : new Set()
    excludedCount += ignored.size
    for (const entry of candidates) {
      if (ignored.has(entry.name)) continue
      if (entry.kind === 'D') {
        if (entry.name.split('/').length > MAX_DEPTH || directories.length >= MAX_DIRECTORIES) fail()
        directories.push(entry.name)
      } else files.push({ path: entry.name, kind: entry.kind === 'F' && isLocalBrowseFileName(entry.name.split('/').at(-1)) ? 'file' : 'unsupported',
        sizeBytes: entry.sizeBytes, version: entry.version })
    }
  }
  files.sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0)
  return { files, excludedCount }
}
