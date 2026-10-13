import { constants } from 'node:fs'
import { lstat, open, opendir, realpath, stat } from 'node:fs/promises'
import { basename, isAbsolute, join } from 'node:path'
import {
  MAX_FOLDER_SNAPSHOT_ENTRIES,
  MAX_FOLDER_SNAPSHOT_FILE_BYTES,
} from '../contract/localFolderSnapshot.mjs'
import { snapshotFolderFiles } from '../contract/localFolderSnapshotBuilder.mjs'
import { MAX_FOLDER_TREE_ENTRIES } from '../contract/localFolderTree.mjs'
import { MAX_LOCAL_FOLDER_BROWSE_FILE_BYTES, parseLocalFolderFileListing, parseLocalFolderFilePreview,
  isLocalFolderFileSelection } from '../contract/localFolderBrowse.mjs'
import { decodeLocalTextPreview, isLocalTextFileName } from '../contract/localTextFile.mjs'
import { listLocalFolderTree, readGitFile } from './gitFileRead.mjs'

const ROOT_ERROR = 'The selected folder is unavailable or has changed.'
const ABORT_ERROR = 'The folder capture was cancelled.'
const defaultFilesystem = { lstat, open, opendir, realpath, stat }

class ChangedDuringCapture extends Error {}
class AbortedCapture extends Error {}

function throwIfAborted(signal) {
  if (signal?.aborted) throw new AbortedCapture(ABORT_ERROR)
}

function sameIdentity(details, identity) {
  return details.dev.toString() === identity.dev && details.ino.toString() === identity.ino
}

function identityOf(details) {
  return { dev: details.dev.toString(), ino: details.ino.toString() }
}

function versionOf(details) {
  return [
    details.dev,
    details.ino,
    details.mode,
    details.size,
    details.mtimeNs,
    details.ctimeNs,
  ].map(String).join(':')
}

function isRegularFile(details) {
  return details.isFile() && !details.isSymbolicLink()
}

async function inspectPath(filesystem, selectedPath) {
  if (typeof selectedPath !== 'string' || !isAbsolute(selectedPath)) throw new Error(ROOT_ERROR)
  const selected = await filesystem.lstat(selectedPath, { bigint: true })
  if (!selected.isDirectory() || selected.isSymbolicLink()) throw new Error(ROOT_ERROR)
  const canonicalPath = await filesystem.realpath(selectedPath)
  const canonical = await filesystem.lstat(canonicalPath, { bigint: true })
  if (!canonical.isDirectory() || canonical.isSymbolicLink() || versionOf(selected) !== versionOf(canonical)) {
    throw new Error(ROOT_ERROR)
  }
  const resolved = await filesystem.stat(canonicalPath, { bigint: true })
  if (!resolved.isDirectory() || versionOf(canonical) !== versionOf(resolved)) throw new Error(ROOT_ERROR)
  return { path: canonicalPath, identity: identityOf(resolved) }
}

async function currentRoot(filesystem, root) {
  if (!root || typeof root !== 'object' || typeof root.path !== 'string' || !isAbsolute(root.path) ||
      !root.identity || typeof root.identity.dev !== 'string' || typeof root.identity.ino !== 'string') {
    throw new ChangedDuringCapture(ROOT_ERROR)
  }
  const current = await inspectPath(filesystem, root.path)
  if (current.path !== root.path || !sameIdentity({ dev: BigInt(current.identity.dev), ino: BigInt(current.identity.ino) }, root.identity)) {
    throw new ChangedDuringCapture(ROOT_ERROR)
  }
  const details = await filesystem.stat(root.path, { bigint: true })
  if (!details.isDirectory() || !sameIdentity(details, root.identity)) throw new ChangedDuringCapture(ROOT_ERROR)
  return { details, version: versionOf(details) }
}

async function assertRootStable(filesystem, root, expectedVersion, signal) {
  throwIfAborted(signal)
  const current = await currentRoot(filesystem, root)
  if (current.version !== expectedVersion) throw new ChangedDuringCapture(ROOT_ERROR)
}

async function listEntries(filesystem, root, expectedVersion, signal) {
  throwIfAborted(signal)
  const directory = await filesystem.opendir(root.path)
  const files = []
  let count = 0
  try {
    for await (const entry of directory) {
      throwIfAborted(signal)
      count++
      // Count raw entries before hiding dotfiles, skipping directories, or
      // considering which file names the shared text policy supports.
      if (count > MAX_FOLDER_SNAPSHOT_ENTRIES) throw new ChangedDuringCapture(ROOT_ERROR)
      // Hidden trees (notably .git) and non-regular entries are outside this
      // reader's scope; don't stat them or follow them.
      if (entry.name.startsWith('.') || entry.isSymbolicLink() || entry.isDirectory() || !entry.isFile()) continue

      const filePath = join(root.path, entry.name)
      const details = await filesystem.lstat(filePath, { bigint: true })
      if (!isRegularFile(details)) throw new ChangedDuringCapture(ROOT_ERROR)
      files.push({
        name: entry.name,
        sizeBytes: Number(details.size),
        version: versionOf(details),
      })
      await assertRootStable(filesystem, root, expectedVersion, signal)
    }
  } finally {
    await directory.close().catch(() => {})
  }
  await assertRootStable(filesystem, root, expectedVersion, signal)
  return files
}

async function readEntry(filesystem, root, expectedRootVersion, file, signal) {
  const filePath = join(root.path, file.name)
  let handle
  try {
    await assertRootStable(filesystem, root, expectedRootVersion, signal)
    const before = await filesystem.lstat(filePath, { bigint: true })
    if (!isRegularFile(before) || versionOf(before) !== file.version) throw new ChangedDuringCapture(ROOT_ERROR)
    throwIfAborted(signal)
    handle = await filesystem.open(filePath, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0))
    const opened = await handle.stat({ bigint: true })
    if (!isRegularFile(opened) || versionOf(opened) !== file.version) throw new ChangedDuringCapture(ROOT_ERROR)

    const buffer = Buffer.allocUnsafe(MAX_FOLDER_SNAPSHOT_FILE_BYTES + 1)
    let offset = 0
    while (offset < buffer.byteLength) {
      throwIfAborted(signal)
      const { bytesRead } = await handle.read(buffer, offset, buffer.byteLength - offset, offset)
      if (bytesRead === 0) break
      offset += bytesRead
    }

    const after = await handle.stat({ bigint: true })
    const pathAfter = await filesystem.lstat(filePath, { bigint: true })
    if (!isRegularFile(after) || !isRegularFile(pathAfter) ||
        versionOf(after) !== file.version || versionOf(pathAfter) !== file.version) {
      throw new ChangedDuringCapture(ROOT_ERROR)
    }
    await assertRootStable(filesystem, root, expectedRootVersion, signal)
    return buffer.subarray(0, offset)
  } catch (error) {
    if (error instanceof ChangedDuringCapture) throw error
    // A missing/replaced path or a no-follow refusal is a changed source, not
    // an ordinary unreadable-file omission.
    if (error?.code === 'ENOENT' || error?.code === 'ELOOP' || error?.code === 'ENOTDIR') {
      throw new ChangedDuringCapture(ROOT_ERROR)
    }
    throw error
  } finally {
    await handle?.close().catch(() => {})
  }
}

function createLocalFolderReader({ filesystem = defaultFilesystem, listTree = listLocalFolderTree, readFile = readGitFile } = {}) {
  return {
    /** Pin a user-selected real directory without returning its path to the renderer. */
    async inspectLocalFolderRoot(selectedPath) {
      try {
        return await inspectPath(filesystem, selectedPath)
      } catch {
        throw new Error(ROOT_ERROR)
      }
    },

    /** Capture only top-level regular files under the shared bounded text policy. */
    async readLocalFolderSnapshot(root, { signal } = {}) {
      try {
        throwIfAborted(signal)
        const initial = await currentRoot(filesystem, root)
        const files = await listEntries(filesystem, root, initial.version, signal)
        let changedDuringRead = false
        let abortedDuringRead = false
        const snapshots = await snapshotFolderFiles(files, async (file) => {
          try {
            throwIfAborted(signal)
            return await readEntry(filesystem, root, initial.version, file, signal)
          } catch (error) {
            if (error instanceof ChangedDuringCapture) changedDuringRead = true
            if (error instanceof AbortedCapture) abortedDuringRead = true
            throw error
          }
        })
        if (changedDuringRead) throw new ChangedDuringCapture(ROOT_ERROR)
        if (abortedDuringRead || signal?.aborted) throw new AbortedCapture(ABORT_ERROR)

        // Files omitted by the shared policy are still identity/version checked;
        // otherwise an oversized or unsupported entry could be swapped mid-capture.
        for (const file of files) {
          throwIfAborted(signal)
          const current = await filesystem.lstat(join(root.path, file.name), { bigint: true })
          if (!isRegularFile(current) || versionOf(current) !== file.version) {
            throw new ChangedDuringCapture(ROOT_ERROR)
          }
        }
        await assertRootStable(filesystem, root, initial.version, signal)
        throwIfAborted(signal)
        return { name: basename(root.path), files: snapshots }
      } catch (error) {
        if (error instanceof AbortedCapture || signal?.aborted) throw new Error(ABORT_ERROR)
        // Node filesystem errors include absolute paths. The reader is private to
        // main, but keep its failure surface generic in case it is later bridged.
        throw new Error(ROOT_ERROR)
      }
    },

    /** List bounded visible metadata only; root versions remain native-private. */
    async readLocalFolderFiles(root, { signal, executable } = {}) {
      const options = { signal, ...(executable ? { executable } : {}) }
      try {
        throwIfAborted(signal)
        const before = await listTree(root, options)
        const files = before.entries.filter((entry) => entry.kind !== 'D').map((entry) => ({
          path: entry.name,
          kind: entry.kind === 'F' && isLocalTextFileName(entry.name.slice(entry.name.lastIndexOf('/') + 1)) ? 'file' : 'unsupported',
        }))
        if (before.entries.length > MAX_FOLDER_TREE_ENTRIES) throw new ChangedDuringCapture(ROOT_ERROR)
        const result = parseLocalFolderFileListing({ version: 1, visited: before.visited,
          hiddenCount: before.visited - before.entries.length, directoryCount: before.directoryCount, files })
        if (!result) throw new ChangedDuringCapture(ROOT_ERROR)
        throwIfAborted(signal)
        const after = await listTree(root, options)
        if (JSON.stringify(before) !== JSON.stringify(after)) throw new ChangedDuringCapture(ROOT_ERROR)
        return result
      } catch (error) {
        if (error instanceof AbortedCapture || signal?.aborted) throw new Error(ABORT_ERROR)
        throw new Error(ROOT_ERROR)
      }
    },

    /** Re-admit one selected path against the current bounded tree before any body read. */
    async readLocalFolderFile(root, selection, { signal, executable } = {}) {
      if (!isLocalFolderFileSelection(selection)) throw new Error(ROOT_ERROR)
      const detached = { path: selection.path }
      const options = { signal, ...(executable ? { executable } : {}) }
      try {
        throwIfAborted(signal)
        const before = await listTree(root, options)
        const entry = before.entries.find((candidate) => candidate.name === detached.path)
        if (!entry) throw new ChangedDuringCapture(ROOT_ERROR)
        const supportedName = isLocalTextFileName(entry.name.slice(entry.name.lastIndexOf('/') + 1))
        let snapshot
        let sizeBytes = entry.sizeBytes
        if (entry.kind !== 'F' || !supportedName) {
          snapshot = { omitted: 'unsupported' }
        } else if (entry.sizeBytes > MAX_LOCAL_FOLDER_BROWSE_FILE_BYTES) {
          snapshot = { omitted: 'too-large' }
        } else {
          const read = await readFile(root, detached.path, { ...options, maxBytes: MAX_LOCAL_FOLDER_BROWSE_FILE_BYTES })
          if (read.status === 'file' && read.version === entry.version && read.sizeBytes === entry.sizeBytes) {
            const text = decodeLocalTextPreview(read.bytes)
            snapshot = text === undefined ? { omitted: 'unsupported' } : { text }
          } else if (read.status === 'unreadable') {
            snapshot = { omitted: 'unreadable' }
          } else {
            throw new ChangedDuringCapture(ROOT_ERROR)
          }
        }
        throwIfAborted(signal)
        const after = await listTree(root, options)
        if (JSON.stringify(before) !== JSON.stringify(after)) throw new ChangedDuringCapture(ROOT_ERROR)
        const result = parseLocalFolderFilePreview({ version: 1, path: detached.path, sizeBytes, snapshot })
        if (!result) throw new ChangedDuringCapture(ROOT_ERROR)
        return result
      } catch (error) {
        if (error instanceof AbortedCapture || signal?.aborted) throw new Error(ABORT_ERROR)
        throw new Error(ROOT_ERROR)
      }
    },
  }
}

const defaultReader = createLocalFolderReader()

export function inspectLocalFolderRoot(selectedPath) {
  return defaultReader.inspectLocalFolderRoot(selectedPath)
}

export function readLocalFolderSnapshot(root, options) {
  return defaultReader.readLocalFolderSnapshot(root, options)
}

export function readLocalFolderFiles(root, options) {
  return defaultReader.readLocalFolderFiles(root, options)
}

export function readLocalFolderFile(root, selection, options) {
  return defaultReader.readLocalFolderFile(root, selection, options)
}

/** Build an equivalent reader around a filesystem adapter, primarily for deterministic race tests. */
export { createLocalFolderReader }
