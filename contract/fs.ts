/** ── Contract: served filesystem sources (files / photos / folders) ──────────
 *  The Add-context types *Files*, *Photos*, and *Folder* are served from a REAL
 *  filesystem — not compile-time fixtures. There are three sources the user can
 *  attach from, and these wire types are how the UI browses and reads each one:
 *
 *   • `ui-host`  — the machine the UI runs on. Read CLIENT-side (browser File
 *     System Access API / `<input type=file>` / drag-drop; Electron local fs on
 *     desktop). The server never sees these bytes unless an effect uploads them,
 *     so the server-backed catalog/content endpoints below do NOT serve it.
 *   • `runner`   — a connected native runner's host, reached through the broker
 *     (`fs.list` / `fs.read`, with a broker bytes route proxying the runner).
 *   • `cloud`    — the web backend's own storage, served from a root on its disk.
 *
 *  Framework- and Node-free (imported verbatim by both the UI and the server);
 *  see docs/capability-broker-architecture.md for the source model. */
import type { Artifact, ArtifactKind } from './entities.ts'

/** Which of the three filesystem sources an entry / attachment came from. */
export type FsSourceKind = 'ui-host' | 'runner' | 'cloud'

/** A filesystem source the picker can browse. `id` is the addressing handle the
 *  catalog/content endpoints take (`?source=<id>`): `'ui-host'`, `'cloud'`, or
 *  `'runner:<runnerId>'`. `runnerId` is set only for `kind: 'runner'`. */
export interface FsSource {
  id: string
  kind: FsSourceKind
  /** Human label for the source switcher ("This computer", "Cloud storage",
   *  the runner's label). */
  label: string
  /** The runner this source maps to (present iff `kind === 'runner'`). */
  runnerId?: string
}

/** A file in a source's catalog. `id` is the source-relative path (url-safe), the
 *  handle the content endpoints take; `kind` drives the row icon + preview. */
export interface FsFileEntry {
  id: string
  name: string
  /** Lower-case extension without the dot (`md`, `csv`, `svg`, …); `''` if none. */
  ext: string
  /** Size in bytes. */
  size: number
  /** Last-modified epoch ms. */
  mtime: number
  kind: ArtifactKind
}

/** An image in a source's catalog (rendered via the bytes content endpoint). */
export interface FsPhotoEntry {
  id: string
  name: string
  mtime: number
}

/** A folder in a source's catalog. `path` is the source-relative path; scanning it
 *  (`/fs/folder`) yields its `Artifact[]`. */
export interface FsFolderEntry {
  id: string
  name: string
  path: string
  fileCount: number
  mtime: number
}

/** What `GET /fs/catalog?source=<id>` returns — a source's top-level files,
 *  photos, and folders. (`ui-host` is client-side, so it never appears here.) */
export interface FsCatalog {
  source: FsSource
  files: FsFileEntry[]
  photos: FsPhotoEntry[]
  folders: FsFolderEntry[]
}

/** What scanning a folder (`GET /fs/folder?source=&path=`) returns — its artifacts,
 *  the same shape the live workspace panels render (mirrors the old `scanFolder`). */
export interface FsFolderContents {
  id: string
  label: string
  meta: string
  artifacts: Artifact[]
}

/** What `GET /fs/text?source=&path=` returns — a file's textual content (the
 *  editable preview). `kind` says whether the file is text (served here), an image
 *  (use the bytes content endpoint instead), or other binary. */
export interface FsFileContent {
  id: string
  name: string
  kind: 'text' | 'image' | 'binary'
  /** Present for `kind: 'text'`. */
  text?: string
  /** The image/binary MIME type (for `kind: 'image' | 'binary'`). */
  contentType?: string
}

/** Recents for the fs context types (files / photos / folder) are **source-qualified**
 *  so reopening one resolves the right source: `${sourceId}::${entryId}`. The single
 *  encoding, shared by the server (seed) and the client (read), so the two can't drift.
 *  `ui-host` entries are client-side and session-only, so they don't get persisted here.
 *
 *  Invariant: a source id never contains `::`. The fixed sources (`cloud`, `ui-host`)
 *  don't, and a `runner:<id>` source id is `::`-free because runner ids are validated
 *  to a safe slug at registration (server `POST /runners`). That lets `parseFsRecentKey`
 *  split on the *first* `::` and keep any `::` in the entry path intact. */
export function fsRecentKey(sourceId: string, entryId: string): string {
  return `${sourceId}::${entryId}`
}

/** Inverse of `fsRecentKey` — splits a recents id at the first `::` (the source id is
 *  `::`-free by the invariant above, so this can't mis-split an entry path), or returns
 *  `null` when the key isn't source-qualified (a legacy / non-fs id). */
export function parseFsRecentKey(key: string): { sourceId: string; entryId: string } | null {
  const i = key.indexOf('::')
  return i < 0 ? null : { sourceId: key.slice(0, i), entryId: key.slice(i + 2) }
}
