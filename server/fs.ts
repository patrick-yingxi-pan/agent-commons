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
 *  sends an absolute path, and `resolveSafe` rejects anything that escapes the root
 *  (the traversal guard), so a crafted `../` can't read outside the served tree. */
import { readdirSync, statSync, readFileSync, existsSync } from 'node:fs'
import { resolve, sep } from 'node:path'
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
const MAX_TEXT_BYTES = 256 * 1024

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

export interface FsReader {
  /** The absolute root this reader serves. */
  root: string
  /** Top-level files / photos / folders directly under the root (one level). */
  list(): { files: FsFileEntry[]; photos: FsPhotoEntry[]; folders: FsFolderEntry[] }
  /** Scan a sub-folder (root-relative path) into the artifacts it holds, or
   *  `undefined` when the path is missing / not a directory / escapes the root. */
  folderContents(relPath: string): FsFolderContents | undefined
  /** A file's textual content (the editable preview); image/binary files report
   *  their kind + content type instead of text. `undefined` when missing/escaping. */
  readText(relPath: string): FsFileContent | undefined
  /** A file's raw bytes + content type (for `<img>` / binary). `undefined` when
   *  missing/escaping/not a file. */
  readBytes(relPath: string): { bytes: Uint8Array; contentType: string } | undefined
}

/** A reader rooted at `root`. A missing root yields empty listings (a fresh
 *  deployment with nothing provisioned), never a throw. */
export function fsReader(root: string): FsReader {
  const rootAbs = resolve(root)

  /** Resolve a root-relative path to an absolute one inside the root, or
   *  `undefined` when it escapes (the traversal guard, same shape as the static
   *  server's in server/index.ts). */
  function resolveSafe(relPath: string): string | undefined {
    const abs = resolve(rootAbs, relPath)
    if (abs !== rootAbs && !abs.startsWith(rootAbs + sep)) return undefined
    return abs
  }

  /** Names directly under `abs`, skipping dotfiles (`.git`, `.DS_Store`, …). */
  function entries(abs: string): string[] {
    try {
      return readdirSync(abs).filter((n) => !n.startsWith('.'))
    } catch {
      return []
    }
  }

  function fileEntry(relPath: string, name: string): FsFileEntry {
    const ext = extOf(name)
    const st = statSync(resolveSafe(relPath)!)
    return { id: relPath, name, ext, size: st.size, mtime: st.mtimeMs, kind: kindForExt(ext) }
  }

  return {
    root: rootAbs,

    list() {
      const files: FsFileEntry[] = []
      const photos: FsPhotoEntry[] = []
      const folders: FsFolderEntry[] = []
      if (!existsSync(rootAbs)) return { files, photos, folders }
      for (const name of entries(rootAbs)) {
        const abs = resolveSafe(name)
        if (!abs) continue
        const st = statSync(abs)
        if (st.isDirectory()) {
          folders.push({
            id: name,
            name,
            path: name,
            fileCount: entries(abs).filter((c) => {
              const cs = resolveSafe(`${name}/${c}`)
              return cs ? statSync(cs).isFile() : false
            }).length,
            mtime: st.mtimeMs,
          })
        } else if (isImageExt(extOf(name))) {
          photos.push({ id: name, name, mtime: st.mtimeMs })
        } else {
          files.push(fileEntry(name, name))
        }
      }
      return { files, photos, folders }
    },

    folderContents(relPath) {
      const abs = resolveSafe(relPath)
      if (!abs || !existsSync(abs) || !statSync(abs).isDirectory()) return undefined
      const names = entries(abs)
      const artifacts: Artifact[] = []
      for (const name of names) {
        const childRel = `${relPath}/${name}`
        const childAbs = resolveSafe(childRel)
        if (!childAbs) continue
        const st = statSync(childAbs)
        if (!st.isFile()) continue // one level of artifacts; nested dirs aren't artifacts
        const ext = extOf(name)
        artifacts.push({
          id: childRel,
          name,
          kind: kindForExt(ext),
          meta: `${ext ? ext.toUpperCase() + ' · ' : ''}${humanSize(st.size)}`,
        })
      }
      const fileCount = artifacts.length
      return {
        id: relPath,
        label: `${relPath.split('/').pop() ?? relPath}/`,
        meta: `${fileCount} file${fileCount === 1 ? '' : 's'}`,
        artifacts,
      }
    },

    readText(relPath) {
      const abs = resolveSafe(relPath)
      if (!abs || !existsSync(abs)) return undefined
      const st = statSync(abs)
      if (!st.isFile()) return undefined
      const name = relPath.split('/').pop() ?? relPath
      const ext = extOf(name)
      if (isImageExt(ext)) {
        return { id: relPath, name, kind: 'image', contentType: contentTypeForExt(ext) }
      }
      if (st.size > MAX_TEXT_BYTES) {
        return { id: relPath, name, kind: 'text', text: `… ${name} is ${humanSize(st.size)} — too large to preview.` }
      }
      try {
        return { id: relPath, name, kind: 'text', text: readFileSync(abs, 'utf8') }
      } catch {
        return { id: relPath, name, kind: 'binary', contentType: contentTypeForExt(ext) }
      }
    },

    readBytes(relPath) {
      const abs = resolveSafe(relPath)
      if (!abs || !existsSync(abs) || !statSync(abs).isFile()) return undefined
      const ext = extOf(relPath.split('/').pop() ?? relPath)
      try {
        return { bytes: readFileSync(abs), contentType: contentTypeForExt(ext) }
      } catch {
        return undefined
      }
    },
  }
}
