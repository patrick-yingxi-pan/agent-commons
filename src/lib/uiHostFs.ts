/** ── UI-host filesystem access (client-side) ─────────────────────────────────
 *  The "This computer" source reads the machine the UI runs on — which a web
 *  backend can't reach, so this is the ONE filesystem source that lives in the
 *  client (the documented exception to "one door to the backend"; see
 *  contract/fs.ts). It uses the browser's own file APIs (`<input type=file>` +
 *  drag-drop; an Electron build could swap in native fs behind the same calls).
 *  Bytes stay in the browser as a preview (object URL for an image, the text body
 *  for a text file) and only reach the backend if an effect uploads them. */
import type { Artifact, ArtifactKind } from '../types'

/** A file picked from the UI host, with its content held client-side for preview. */
export interface UiHostFile {
  /** A stable-ish id for this pick (the file name; good enough for a session). */
  id: string
  name: string
  kind: 'file' | 'photo'
  /** Text body for a text file (the editable preview). */
  text?: string
  /** Object URL for an image (used directly as an `<img src>`). */
  url?: string
}

const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'bmp', 'ico'])
const SHEET_EXTS = new Set(['csv', 'tsv', 'xlsx', 'xls'])
const SLIDE_EXTS = new Set(['key', 'ppt', 'pptx'])
const TEXT_EXTS = new Set(['md', 'txt', 'csv', 'tsv', 'json', 'yaml', 'yml', 'html', 'xml', 'log', 'svg'])

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

/** Read one browser `File` into a `UiHostFile` — an object URL for an image, the
 *  text body for a text file (capped so a stray huge file can't hang the preview). */
async function toUiHostFile(file: File): Promise<UiHostFile> {
  const name = file.name
  if (isImage(name)) {
    return { id: name, name, kind: 'photo', url: URL.createObjectURL(file) }
  }
  let text: string | undefined
  if (TEXT_EXTS.has(extOf(name)) && file.size <= 256 * 1024) {
    try {
      text = await file.text()
    } catch {
      /* unreadable — leave undefined, the preview falls back */
    }
  }
  return { id: name, name, kind: 'file', text }
}

/** Whether the richer File System Access API is available (vs. the `<input>` fallback). */
export function uiHostSupportsPicker(): boolean {
  return typeof window !== 'undefined' && 'showOpenFilePicker' in window
}

/** Open the OS file picker and read the chosen files. `accept` narrows to images
 *  for the Photos type. Uses a transient `<input type=file>` (works everywhere);
 *  an Electron build could route this through native fs without changing callers. */
export async function pickUiHostFiles(accept: 'image' | 'any' = 'any'): Promise<UiHostFile[]> {
  const files = await openInput({ multiple: true, accept: accept === 'image' ? 'image/*' : undefined })
  return Promise.all(files.map(toUiHostFile))
}

/** Read files dropped onto a drop zone. */
export async function readDroppedFiles(list: FileList): Promise<UiHostFile[]> {
  return Promise.all(Array.from(list).map(toUiHostFile))
}

/** Open the OS folder picker and turn its top-level files into workspace artifacts.
 *  Listing only (real names + kinds from disk); per-artifact content preview for a
 *  UI-host folder isn't wired (the bytes would have to be threaded through attach),
 *  so those fall back to the scaffold. Returns null when the user cancels. */
export async function pickUiHostFolder(): Promise<{ name: string; artifacts: Artifact[] } | null> {
  const files = await openInput({ multiple: true, directory: true })
  if (files.length === 0) return null
  // The folder name is the first segment of the relative path the browser reports.
  const rel = (f: File): string => (f as File & { webkitRelativePath?: string }).webkitRelativePath ?? f.name
  const folderName = rel(files[0]).split('/')[0] || 'folder'
  // Keep only the folder's *top-level* files as artifacts (skip nested dirs).
  const top = files.filter((f) => rel(f).split('/').length === 2)
  const seen = new Set<string>()
  const artifacts: Artifact[] = []
  for (const f of top.length ? top : files) {
    if (seen.has(f.name)) continue
    seen.add(f.name)
    artifacts.push({ id: `ui-host:${folderName}/${f.name}`, name: f.name, kind: uiHostKind(f.name), meta: humanSize(f.size) })
  }
  return { name: folderName, artifacts }
}

function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/** Promise-wrap a transient `<input type=file>` click. Resolves with the chosen
 *  files (empty when cancelled — `change` may not fire, so this can stay pending;
 *  callers treat no-pick as no-op). */
function openInput(opts: { multiple?: boolean; accept?: string; directory?: boolean }): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    if (opts.multiple) input.multiple = true
    if (opts.accept) input.accept = opts.accept
    if (opts.directory) (input as HTMLInputElement & { webkitdirectory: boolean }).webkitdirectory = true
    input.onchange = () => resolve(input.files ? Array.from(input.files) : [])
    input.click()
  })
}
