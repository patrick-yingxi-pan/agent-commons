/** ── UI-host filesystem access (client-side) ─────────────────────────────────
 *  The "This computer" source reads the machine the UI runs on — which a web
 *  backend can't reach, so this is the ONE filesystem source that lives in the
 *  client (the documented exception to "one door to the backend"; see
 *  contract/fs.ts). It uses the browser's own file APIs (`<input type=file>` +
 *  drag-drop; an Electron build could swap in native fs behind the same calls).
 *  Preview fields persist with the conversation workspace; bounded local text
 *  can be sent to the selected model. Image object URLs remain browser-local
 *  references, not portable content or model input. */
import type { Artifact, ArtifactKind } from '../types'
import type { DesktopBridgeScope, DesktopContextPickerRejection } from '../api/desktopCredentials'
import { LOCAL_TEXT_PREVIEW_BYTES, decodeLocalTextPreview, isLocalTextFileName } from '../../contract/localTextFile.mjs'
import { snapshotFolderFiles } from '../../contract/localFolderSnapshot.mjs'

/** A file picked from the UI host, with its content held client-side for preview. */
export interface UiHostFile {
  /** Opaque identity for this selected snapshot, retained across attach/retry.
   * Names cannot identify files from different folders or later selections. */
  id: string
  name: string
  kind: 'file' | 'photo'
  /** Whole UTF-8 body for a supported text file (the read-only preview). */
  text?: string
  /** Object URL for an image (used directly as an `<img src>`). */
  url?: string
}

const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'bmp', 'ico'])
const SHEET_EXTS = new Set(['csv', 'tsv', 'xlsx', 'xls'])
const SLIDE_EXTS = new Set(['key', 'ppt', 'pptx'])

function extOf(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : ''
}

/** The artifact kind for a file name (mirrors server/fs.ts `kindForExt`). */
export function uiHostKind(name: string): ArtifactKind {
  const ext = extOf(name)
  if (IMAGE_EXTS.has(ext)) return 'image'
  if (SHEET_EXTS.has(ext)) return 'sheet'
  if (SLIDE_EXTS.has(ext)) return 'slide'
  if (ext === 'eml') return 'email'
  return 'doc'
}

const isImage = (name: string) => IMAGE_EXTS.has(extOf(name))

/** Mint once at intake, not during projection or mutation retry. No path or
 * guessed file identity is needed to keep equal-named selections independent. */
function selectedFile(file: Omit<UiHostFile, 'id'>): UiHostFile {
  return { id: crypto.randomUUID(), ...file }
}

const PICKER_FAILURE: Record<DesktopContextPickerRejection, string> = {
  'image-too-large': 'Choose images up to 8 MB each.',
  'invalid-request': 'That selection is not supported.',
  'selection-too-large': 'Choose up to 24 MB of images at a time.',
  'too-many-files': 'Choose no more than 24 files at a time.',
  'too-many-folder-entries': 'Choose a folder with no more than 500 top-level items.',
  unreadable: 'The selected items could not be read. Check their permissions and try again.',
  'unsupported-image': 'Choose a PNG, JPEG, GIF, SVG, WebP, BMP, or ICO image.',
}

export class UiHostPickerError extends Error {
  constructor(reason: DesktopContextPickerRejection) {
    super(PICKER_FAILURE[reason])
    this.name = 'UiHostPickerError'
  }
}

/** Read one browser `File` into a `UiHostFile` — an object URL for an image, the
 *  text body for a text file (capped so a stray huge file can't hang the preview). */
async function toUiHostFile(file: File): Promise<UiHostFile> {
  const name = file.name
  if (isImage(name)) {
    return selectedFile({ name, kind: 'photo', url: URL.createObjectURL(file) })
  }
  let text: string | undefined
  if (isLocalTextFileName(name) && file.size <= LOCAL_TEXT_PREVIEW_BYTES) {
    try {
      const bytes = new Uint8Array(await file.slice(0, LOCAL_TEXT_PREVIEW_BYTES + 1).arrayBuffer())
      text = decodeLocalTextPreview(bytes)
    } catch {
      /* unreadable — leave undefined, the preview falls back */
    }
  }
  return selectedFile({ name, kind: 'file', text })
}

/** Whether the richer File System Access API is available (vs. the `<input>` fallback). */
export function uiHostSupportsPicker(scope?: DesktopBridgeScope): boolean {
  const target = scope ?? (typeof window === 'undefined' ? {} : window)
  return target.agentCommonsDesktop?.context !== undefined || (typeof window !== 'undefined' && 'showOpenFilePicker' in window)
}

/** Open the OS file picker and read the chosen files. `accept` narrows to images
 *  for the Photos type. Electron routes through its bounded native bridge; web
 *  uses a transient `<input type=file>` without changing callers. */
export async function pickUiHostFiles(
  accept: 'image' | 'any' = 'any',
  scope: DesktopBridgeScope = window,
): Promise<UiHostFile[]> {
  const native = scope.agentCommonsDesktop?.context
  if (native) {
    const result = await native.pickFiles(accept)
    if (result.status === 'cancelled') return []
    if (result.status === 'rejected') throw new UiHostPickerError(result.reason)
    return result.files.map((file) => selectedFile({
      name: file.name,
      kind: file.kind,
      text: file.text,
      url: file.previewDataUrl,
    }))
  }
  const files = await openInput({ multiple: true, accept: accept === 'image' ? 'image/*' : undefined })
  return Promise.all(files.map(toUiHostFile))
}

/** Read files dropped onto a drop zone. */
export async function readDroppedFiles(list: FileList): Promise<UiHostFile[]> {
  return Promise.all(Array.from(list).map(toUiHostFile))
}

/** Open the OS folder picker and turn its top-level files into workspace artifacts
 *  with bounded local snapshots. Returns null when the user cancels. */
export async function pickUiHostFolder(
  scope: DesktopBridgeScope = window,
): Promise<{ id: string; name: string; artifacts: Artifact[] } | null> {
  const native = scope.agentCommonsDesktop?.context
  if (native) {
    const result = await native.pickFolder()
    if (result.status === 'cancelled') return null
    if (result.status === 'rejected') throw new UiHostPickerError(result.reason)
    return {
      id: crypto.randomUUID(),
      name: result.folder.name,
      artifacts: result.folder.files.map((file) => ({
        id: crypto.randomUUID(),
        name: file.name,
        kind: uiHostKind(file.name),
        meta: humanSize(file.sizeBytes),
        localSnapshot: file.snapshot ?? { omitted: 'unreadable' },
      })),
    }
  }
  const files = await openInput({ multiple: true, directory: true })
  if (files.length === 0) return null
  if (files.length > 500) throw new UiHostPickerError('too-many-folder-entries')
  // The folder name is the first segment of the relative path the browser reports.
  const rel = (f: File): string => (f as File & { webkitRelativePath?: string }).webkitRelativePath ?? f.name
  const folderName = rel(files[0]).split('/')[0] || 'folder'
  // Keep only the folder's *top-level* non-hidden files. Never fall back to
  // nested files: a folder selection must not silently widen its scope.
  const top = files
    .filter((f) => rel(f).split('/').length === 2)
    .filter((f) => !rel(f).split('/').some((part) => part.startsWith('.')))
  const metadata = top.map((f) => ({ name: f.name, sizeBytes: f.size }))
  const byName = new Map(top.map((f) => [f.name, f]))
  const snapshots = await snapshotFolderFiles(metadata, async (file) => {
    const input = byName.get(file.name)
    if (!input) throw new Error('folder file disappeared')
    return new Uint8Array(await input.arrayBuffer())
  })
  const artifacts: Artifact[] = snapshots.map((entry) => ({
    id: crypto.randomUUID(),
    name: entry.name,
    kind: uiHostKind(entry.name),
    meta: humanSize(entry.sizeBytes),
    localSnapshot: entry.snapshot,
  }))
  return { id: crypto.randomUUID(), name: folderName, artifacts }
}

function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/** Promise-wrap a transient `<input type=file>` click. Modern Chromium emits
 *  `cancel`; `change` remains the cross-browser selection path. */
function openInput(opts: { multiple?: boolean; accept?: string; directory?: boolean }): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    if (opts.multiple) input.multiple = true
    if (opts.accept) input.accept = opts.accept
    if (opts.directory) (input as HTMLInputElement & { webkitdirectory: boolean }).webkitdirectory = true
    let settled = false
    const finish = (files: File[]) => {
      if (settled) return
      settled = true
      resolve(files)
    }
    input.onchange = () => finish(input.files ? Array.from(input.files) : [])
    input.addEventListener('cancel', () => finish([]), { once: true })
    input.click()
  })
}
