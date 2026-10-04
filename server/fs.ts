/** ── The served-filesystem reader ───────────────────────────────────────────
 *  Real `fs` access rooted at one directory, shared by every server-backed
 *  filesystem source (the web backend's cloud storage and each runner's host —
 *  see contract/fs.ts). It is the one place the prototype actually touches disk to
 *  serve the Files / Photos / Folder context types: scan a root one level into its
 *  files / photos / folders, scan a sub-folder into artifacts, and read a file's
 *  text or raw bytes. Fulfilment is real; the roots are deterministic in-repo
 *  sample trees by default (reviewable, identical in every clone), overridable to a
 *  real path via env.
 *
 *  Addressing: every entry's `id` is its **root-relative path** (forward slashes),
 *  which is also the `?path=` handle the content endpoints take. The client never
 *  sends an absolute path. Descendant symlinks, path aliases and special files
 *  are refused. Configured roots are operator-owned, not an OS sandbox against
 *  a hostile process concurrently renaming directories or mounting filesystems. */
import { closeSync, constants, fstatSync, lstatSync, opendirSync, openSync, readSync, readdirSync, realpathSync } from 'node:fs'
import type { Stats } from 'node:fs'
import { join, resolve } from 'node:path'
import { decodeLocalTextPreview, isLocalTextFileName } from '../contract/localTextFile.mjs'
import { MAX_FOLDER_SNAPSHOT_ENTRIES, MAX_FOLDER_SNAPSHOT_FILE_BYTES, snapshotFolderFiles } from '../contract/localFolderSnapshot.mjs'
import type { FolderSnapshotFile } from '../contract/localFolderSnapshot.mjs'
import type {
  Artifact,
  ArtifactKind,
  FsFileContent,
  FsFileEntry,
  FsFolderContents,
  FsFolderEntry,
  FsPhotoEntry,
} from '../contract/index.ts'

/** Largest text file we serve inline (keeps a stray huge file from blowing up a
 *  preview). Past this the preview shows a truncation note. */
export const MAX_TEXT_BYTES = 256 * 1024
/** Whole text snapshots are smaller than previews so model context intake has a
 *  predictable per-file ceiling and never returns a lossy prefix. */
export const MAX_SNAPSHOT_BYTES = MAX_FOLDER_SNAPSHOT_FILE_BYTES
/** Raw previews/downloads must not allocate an arbitrary source file in memory. */
export const MAX_CONTENT_BYTES = 32 * 1024 * 1024

/** Lower-case extension without the dot (`md`, `svg`, …); `''` when there is none. */
function extOf(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : ''
}

const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'bmp', 'ico'])
const SHEET_EXTS = new Set(['csv', 'tsv', 'xlsx', 'xls'])
const SLIDE_EXTS = new Set(['key', 'ppt', 'pptx'])

/** Map a file extension to the artifact kind that drives its icon + preview. */
export function kindForExt(ext: string): ArtifactKind {
  if (IMAGE_EXTS.has(ext)) return 'image'
  if (SHEET_EXTS.has(ext)) return 'sheet'
  if (SLIDE_EXTS.has(ext)) return 'slide'
  if (ext === 'eml') return 'email'
  return 'doc'
}

export function isImageExt(ext: string): boolean {
  return IMAGE_EXTS.has(ext)
}

const CONTENT_TYPES: Record<string, string> = {
  svg: 'image/svg+xml',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
  ico: 'image/x-icon',
  md: 'text/markdown; charset=utf-8',
  txt: 'text/plain; charset=utf-8',
  csv: 'text/csv; charset=utf-8',
  json: 'application/json; charset=utf-8',
  yaml: 'text/yaml; charset=utf-8',
  yml: 'text/yaml; charset=utf-8',
  html: 'text/html; charset=utf-8',
}

export function contentTypeForExt(ext: string): string {
  return CONTENT_TYPES[ext] ?? 'application/octet-stream'
}

/** Human size like the catalog metas ("3.1 KB", "1.2 MB"). */
function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/** Internal narrowing only: names require list permission, bodies require read
 * permission too. The runner facade always supplies its own grant predicates. */
export interface FolderSnapshotAccess {
  canList(path: string): boolean
  canRead(path: string): boolean
}

/** Recheck captured names and bodies at each async publication boundary. This
 * tests current authority over trusted capture output, not its wire schema. */
export function folderSnapshotPermitted(path: string, files: readonly FolderSnapshotFile[], access: FolderSnapshotAccess): boolean {
  return files.every((file) => access.canList(`${path}/${file.name}`) &&
    (typeof file.snapshot.text !== 'string' || access.canRead(`${path}/${file.name}`)))
}

export interface FsReader {
  /** The absolute root this reader serves. */
  root: string
  /** Top-level files / photos / folders, or undefined when the tree cannot be
   * scanned. Only a successful scan may report an empty catalog or file count. */
  list(): { files: FsFileEntry[]; photos: FsPhotoEntry[]; folders: FsFolderEntry[] } | undefined
  /** Scan a sub-folder (root-relative path) into the artifacts it holds, or
   *  `undefined` when the path is missing / not a directory / escapes the root. */
  folderContents(relPath: string): FsFolderContents | undefined
  /** Internal capture foundation, not yet an attachment/Refresh route. Captures
   * bounded, visible regular top-level files using the shared omission policy.
   * Enumeration/change failure is unavailable, distinct from an empty batch. */
  folderSnapshot(relPath: string, access?: FolderSnapshotAccess): Promise<FolderSnapshotFile[] | undefined>
  /** A file's textual content (the editable preview); image/binary files report
   *  their kind + content type instead of text. `undefined` when missing/escaping. */
  readText(relPath: string): FsFileContent | undefined
  /** A complete, strictly decoded supported text file within the snapshot
   *  budget. Unsupported, binary, oversized, unsafe, or changed files omit. */
  readSnapshot(relPath: string): { name: string; text: string } | undefined
  /** A file's raw bytes + content type (for `<img>` / binary). `undefined` when
   *  missing/unsafe/not a regular file/over 32 MiB/changed during the read. */
  readBytes(relPath: string): { bytes: Uint8Array; contentType: string } | undefined
}

/** A reader rooted at `root`. Missing or unreadable trees remain unavailable,
 * never a successful empty listing or a filesystem exception. */
export function fsReader(root: string): FsReader {
  const rootAbs = resolve(root)
  // Resolve operator-configured aliases once (including macOS /var → /private/var).
  // A replaced or initially missing root needs a new reader; never adopt a new tree.
  const anchor = (() => {
    try {
      const abs = realpathSync(rootAbs)
      const st = lstatSync(abs)
      return st.isDirectory() && !st.isSymbolicLink() ? { abs, st } : undefined
    } catch { return undefined }
  })()

  function sameFile(a: Stats, b: Stats): boolean {
    return a.dev === b.dev && a.ino === b.ino && a.mode === b.mode
  }

  function sameVersion(a: Stats, b: Stats): boolean {
    return sameFile(a, b) && a.size === b.size && a.mtimeMs === b.mtimeMs && a.ctimeMs === b.ctimeMs
  }

  type Entry = { abs: string; st: Stats }

  /** Exact forward-slash handles only. Check every component, not just the leaf:
   * O_NOFOLLOW alone does not reject a symlink in a parent directory. */
  function inspect(relPath: string, allowRoot = false): Entry | undefined {
    if (!anchor || typeof relPath !== 'string' || relPath.length > 4096 || /[\\\x00-\x1f\x7f]/.test(relPath)) return undefined
    const parts = relPath === '' && allowRoot ? [] : relPath.split('/')
    if (parts.length > 64 || parts.some((part) => !part || part.startsWith('.') || /^[a-z]:/i.test(part))) return undefined
    try {
      let abs = anchor.abs
      let st = lstatSync(abs)
      if (!sameFile(anchor.st, st) || !st.isDirectory() || st.isSymbolicLink() || realpathSync(abs) !== abs) return undefined
      for (const part of parts) {
        if (!st.isDirectory()) return undefined
        abs = join(abs, part)
        st = lstatSync(abs)
        if (st.isSymbolicLink() || (!st.isDirectory() && !st.isFile())) return undefined
      }
      if (realpathSync(abs) !== abs) return undefined
      return { abs, st }
    } catch { return undefined }
  }

  /** Keep failed enumeration distinct from an acknowledged empty directory. */
  function entries(relPath: string): string[] | undefined {
    const before = inspect(relPath, true)
    if (!before?.st.isDirectory()) return undefined
    try {
      const names = readdirSync(before.abs).filter((name) => !name.startsWith('.'))
      const after = inspect(relPath, true)
      return after && sameFile(before.st, after.st) ? names : undefined
    } catch { return undefined }
  }

  /** Open once, validate that descriptor, and read only the admitted size + one
   * byte. Refuse replacement/growth instead of returning a partial preview. */
  function readBounded(relPath: string, entry: Entry, limit: number): Uint8Array | undefined {
    if (!entry.st.isFile() || !Number.isSafeInteger(entry.st.size) || entry.st.size < 0 || entry.st.size > limit) return undefined
    let fd: number | undefined
    try {
      fd = openSync(entry.abs, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0))
      const opened = fstatSync(fd)
      const current = inspect(relPath)
      if (!opened.isFile() || !sameVersion(entry.st, opened) || !current || !sameVersion(opened, current.st)) return undefined
      const bytes = Buffer.alloc(opened.size + 1)
      let offset = 0
      while (offset < bytes.length) {
        const count = readSync(fd, bytes, offset, bytes.length - offset, offset)
        if (count === 0) break
        offset += count
      }
      const after = inspect(relPath)
      if (offset !== opened.size || !sameVersion(opened, fstatSync(fd)) || !after || !sameVersion(opened, after.st)) return undefined
      return bytes.subarray(0, offset)
    } catch { return undefined }
    finally { if (fd !== undefined) closeSync(fd) }
  }

  function fileEntry(relPath: string, name: string, st: Stats): FsFileEntry {
    const ext = extOf(name)
    return { id: relPath, name, ext, size: st.size, mtime: st.mtimeMs, kind: kindForExt(ext) }
  }

  return {
    root: rootAbs,

    list() {
      const names = entries('')
      if (!names) return undefined
      const files: FsFileEntry[] = []
      const photos: FsPhotoEntry[] = []
      const folders: FsFolderEntry[] = []
      for (const name of names) {
        const entry = inspect(name)
        if (!entry) continue
        const { st } = entry
        if (st.isDirectory()) {
          const children = entries(name)
          if (!children) return undefined
          folders.push({
            id: name,
            name,
            path: name,
            fileCount: children.filter((c) => inspect(`${name}/${c}`)?.st.isFile()).length,
            mtime: st.mtimeMs,
          })
        } else if (isImageExt(extOf(name))) {
          photos.push({ id: name, name, mtime: st.mtimeMs })
        } else {
          files.push(fileEntry(name, name, st))
        }
      }
      // Child inspection can outlive the root enumeration. A lost/replaced
      // anchor must not turn skipped entries into a partial or empty success.
      return inspect('', true) ? { files, photos, folders } : undefined
    },

    folderContents(relPath) {
      const entry = inspect(relPath)
      if (!entry?.st.isDirectory()) return undefined
      const names = entries(relPath)
      if (!names) return undefined
      const artifacts: Artifact[] = []
      for (const name of names) {
        const childRel = `${relPath}/${name}`
        const child = inspect(childRel)
        if (!child) continue
        const { st } = child
        if (!st.isFile()) continue // one level of artifacts; nested dirs aren't artifacts
        const ext = extOf(name)
        artifacts.push({
          id: childRel,
          name,
          kind: kindForExt(ext),
          meta: `${ext ? ext.toUpperCase() + ' · ' : ''}${humanSize(st.size)}`,
        })
      }
      const after = inspect(relPath)
      if (!after || !sameFile(entry.st, after.st)) return undefined
      const fileCount = artifacts.length
      return {
        id: relPath,
        label: `${relPath.split('/').pop() ?? relPath}/`,
        meta: `${fileCount} file${fileCount === 1 ? '' : 's'}`,
        artifacts,
      }
    },

    async folderSnapshot(relPath, access) {
      try {
        const folder = inspect(relPath)
        if (!folder?.st.isDirectory()) return undefined
        const canList = (path: string) => access?.canList(path) ?? true
        const canRead = (path: string) => access?.canRead(path) ?? true
        const candidates: Array<{ name: string; sizeBytes: number }> = []
        const admitted = new Map<string, Entry>()
        // Stream and cap before any filtering or body read. Hidden files,
        // directories and unlisted entries still consume enumeration capacity.
        const directory = opendirSync(folder.abs)
        try {
          let count = 0
          for (let item = directory.readSync(); item; item = directory.readSync()) {
            if (++count > MAX_FOLDER_SNAPSHOT_ENTRIES) return undefined
            if (item.name.startsWith('.') || !item.isFile()) continue
            const path = `${relPath}/${item.name}`
            if (!canList(path)) continue
            const child = inspect(path)
            // A known regular entry that became inaccessible or unsafe cannot
            // silently disappear from a supposedly complete captured manifest.
            if (!child?.st.isFile()) return undefined
            admitted.set(item.name, child)
            candidates.push({ name: item.name, sizeBytes: child.st.size })
          }
        } finally { directory.closeSync() }
        const enumerated = inspect(relPath)
        if (!enumerated || !sameVersion(folder.st, enumerated.st)) return undefined
        const snapshots = await snapshotFolderFiles(candidates, (file) => {
          const path = `${relPath}/${file.name}`
          if (!canList(path) || !canRead(path)) throw new Error('folder body unavailable')
          const bytes = readBounded(path, admitted.get(file.name)!, MAX_SNAPSHOT_BYTES)
          if (!bytes) throw new Error('folder body unavailable')
          return bytes
        })
        // The shared async policy may yield between files. Do not publish after
        // folder replacement/membership changes or a grant predicate narrowing.
        const after = inspect(relPath)
        if (!after || !sameVersion(folder.st, after.st)) return undefined
        if (access && !folderSnapshotPermitted(relPath, snapshots, access)) return undefined
        return snapshots
      } catch { return undefined }
    },

    readText(relPath) {
      const entry = inspect(relPath)
      if (!entry?.st.isFile()) return undefined
      const { st } = entry
      const name = relPath.split('/').pop() ?? relPath
      const ext = extOf(name)
      if (isImageExt(ext)) {
        return { id: relPath, name, kind: 'image', contentType: contentTypeForExt(ext) }
      }
      if (st.size > MAX_TEXT_BYTES) {
        return { id: relPath, name, kind: 'text', text: `… ${name} is ${humanSize(st.size)} — too large to preview.` }
      }
      const bytes = readBounded(relPath, entry, MAX_TEXT_BYTES)
      return bytes ? { id: relPath, name, kind: 'text', text: new TextDecoder('utf-8', { ignoreBOM: true }).decode(bytes) } : undefined
    },

    readSnapshot(relPath) {
      const entry = inspect(relPath)
      if (!entry?.st.isFile() || entry.st.size > MAX_SNAPSHOT_BYTES) return undefined
      const name = relPath.split('/').pop() ?? relPath
      if (!isLocalTextFileName(name)) return undefined
      const bytes = readBounded(relPath, entry, MAX_SNAPSHOT_BYTES)
      if (!bytes) return undefined
      const text = decodeLocalTextPreview(bytes)
      return text === undefined ? undefined : { name, text }
    },

    readBytes(relPath) {
      const entry = inspect(relPath)
      if (!entry) return undefined
      const ext = extOf(relPath.split('/').pop() ?? relPath)
      const bytes = readBounded(relPath, entry, MAX_CONTENT_BYTES)
      return bytes ? { bytes, contentType: contentTypeForExt(ext) } : undefined
    },
  }
}
