/** ── UI-host filesystem access (client-side) ─────────────────────────────────
 *  The "This computer" source reads the machine the UI runs on — which a web
 *  backend can't reach, so this is the ONE filesystem source that lives in the
 *  client (the documented exception to "one door to the backend"; see
 *  contract/fs.ts). It uses the browser's own file APIs (`<input type=file>` +
 *  drag-drop; an Electron build could swap in native fs behind the same calls).
 *  Text previews persist with the workspace. Images are normalized locally and
 *  uploaded separately before only their durable references enter context. */
import type { Artifact, ArtifactKind } from '../types'
import type { DesktopBridgeScope, DesktopContextPickerRejection } from '../api/desktopCredentials'
import { LOCAL_TEXT_PREVIEW_BYTES, decodeLocalTextPreview, isLocalTextFileName } from '../../contract/localTextFile.mjs'
import { snapshotFolderFiles } from '../../contract/localFolderSnapshot.mjs'
import { isPdfFileName, MAX_PDF_FILE_BYTES, MAX_PDF_SELECTION_BYTES, pdfImportFailure } from '../../contract/pdfImport.mjs'
import { isDocxFileName, MAX_DOCX_FILE_BYTES, MAX_DOCX_SELECTION_BYTES, docxImportFailure } from '../../contract/docxImport.mjs'
import { isXlsxFileName, MAX_XLSX_FILE_BYTES, MAX_XLSX_SELECTION_BYTES, xlsxImportFailure } from '../../contract/xlsxImport.mjs'
import type { DocumentImportOutcome } from '../../contract/documentImport.mjs'
import { importPdf } from './pdfImport.ts'
import { importDocx } from './docxImport.ts'
import { importXlsx } from './xlsxImport.ts'
import { importImage, ImageImportError } from './imageImport.ts'
import type { ImageSnapshot } from '../../contract/imageInput.ts'
import type { ImageAssetRef } from '../../contract/imageAssets.ts'
import { IMAGE_MAX_CONTAINER_BYTES } from '../../contract/imageInput.ts'

/** Local intake: bounded text or a transient normalized image, later replaced
 * by its server-owned reference before entering conversation context. */
export interface UiHostFile {
  /** Opaque identity for this selected snapshot, retained across attach/retry.
   * Names cannot identify files from different folders or later selections. */
  id: string
  name: string
  kind: 'file' | 'photo'
  /** Whole UTF-8 body for a supported text file (the read-only preview). */
  text?: string
  documentImport?: DocumentImportOutcome
  imageInput?: ImageSnapshot
  image?: ImageAssetRef
}

const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'bmp', 'ico'])
const IMPORTABLE_IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp'])
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
const isImportableImage = (name: string) => IMPORTABLE_IMAGE_EXTS.has(extOf(name))

function previewBytes(url: string): Uint8Array {
  if (typeof url !== 'string' || url.length > Math.ceil(8 * 1024 * 1024 / 3) * 4 + 32 ||
      !/^data:image\/(png|jpeg|gif|webp);base64,/.test(url)) throw new ImageImportError('invalid')
  const encoded = url.slice(url.indexOf(',') + 1)
  let binary: string
  try { binary = atob(encoded) } catch { throw new ImageImportError('invalid') }
  if (binary.length > 8 * 1024 * 1024 || btoa(binary) !== encoded) throw new ImageImportError('invalid')
  return Uint8Array.from(binary, (char) => char.charCodeAt(0))
}

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
  'unsupported-image': 'Choose a PNG, JPEG, GIF, or WebP image.',
}

export class UiHostPickerError extends Error {
  constructor(reason: DesktopContextPickerRejection) {
    super(PICKER_FAILURE[reason])
    this.name = 'UiHostPickerError'
  }
}

/** Read one browser File into a bounded normalized image or whole-text snapshot. */
const MAX_DOCUMENT_SELECTION_BYTES = Math.min(MAX_PDF_SELECTION_BYTES, MAX_DOCX_SELECTION_BYTES, MAX_XLSX_SELECTION_BYTES)

async function toUiHostFile(file: File, documentBudget: { used: number }, imageBudget: { used: number }, signal?: AbortSignal): Promise<UiHostFile> {
  const name = file.name
  if (isImage(name)) {
    if (!isImportableImage(name)) throw new UiHostPickerError('unsupported-image')
    if (file.size > IMAGE_MAX_CONTAINER_BYTES || imageBudget.used + file.size > 24 * 1024 * 1024) throw new UiHostPickerError('selection-too-large')
    imageBudget.used += file.size
    try {
      const bytes = new Uint8Array(await file.slice(0, 8 * 1024 * 1024 + 1).arrayBuffer())
      if (bytes.byteLength !== file.size) throw new ImageImportError('invalid')
      return selectedFile({ name, kind: 'photo', imageInput: await importImage(bytes, signal) })
    } catch (error) {
      if (error instanceof UiHostPickerError || error instanceof ImageImportError) throw error
      throw new UiHostPickerError('unreadable')
    }
  }
  if (isPdfFileName(name)) {
    if (file.size > MAX_PDF_FILE_BYTES) return selectedFile({ name, kind: 'file', ...pdfImportFailure('file-too-large') })
    if (documentBudget.used + file.size > MAX_DOCUMENT_SELECTION_BYTES) return selectedFile({ name, kind: 'file', ...pdfImportFailure('selection-limit') })
    documentBudget.used += file.size
    try {
      const bytes = new Uint8Array(await file.slice(0, MAX_PDF_FILE_BYTES + 1).arrayBuffer())
      if (bytes.byteLength !== file.size) return selectedFile({ name, kind: 'file', ...pdfImportFailure('invalid') })
      return selectedFile({ name, kind: 'file', ...await importPdf(bytes, signal) })
    } catch {
      return selectedFile({ name, kind: 'file', ...pdfImportFailure('invalid') })
    }
  }
  if (isDocxFileName(name)) {
    if (file.size > MAX_DOCX_FILE_BYTES) return selectedFile({ name, kind: 'file', ...docxImportFailure('file-too-large') })
    if (documentBudget.used + file.size > MAX_DOCUMENT_SELECTION_BYTES) return selectedFile({ name, kind: 'file', ...docxImportFailure('selection-limit') })
    documentBudget.used += file.size
    try {
      const bytes = new Uint8Array(await file.slice(0, MAX_DOCX_FILE_BYTES + 1).arrayBuffer())
      if (bytes.byteLength !== file.size) return selectedFile({ name, kind: 'file', ...docxImportFailure('invalid') })
      return selectedFile({ name, kind: 'file', ...await importDocx(bytes, signal) })
    } catch {
      return selectedFile({ name, kind: 'file', ...docxImportFailure('invalid') })
    }
  }
  if (isXlsxFileName(name)) {
    if (file.size > MAX_XLSX_FILE_BYTES) return selectedFile({ name, kind: 'file', ...xlsxImportFailure('file-too-large') })
    if (documentBudget.used + file.size > MAX_DOCUMENT_SELECTION_BYTES) return selectedFile({ name, kind: 'file', ...xlsxImportFailure('selection-limit') })
    documentBudget.used += file.size
    try {
      const bytes = new Uint8Array(await file.slice(0, MAX_XLSX_FILE_BYTES + 1).arrayBuffer())
      if (bytes.byteLength !== file.size) return selectedFile({ name, kind: 'file', ...xlsxImportFailure('invalid') })
      return selectedFile({ name, kind: 'file', ...await importXlsx(bytes, signal) })
    } catch {
      return selectedFile({ name, kind: 'file', ...xlsxImportFailure('invalid') })
    }
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
  signal?: AbortSignal,
): Promise<UiHostFile[]> {
  const native = scope.agentCommonsDesktop?.context
  if (native) {
    const result = await native.pickFiles(accept)
    if (result.status === 'cancelled') return []
    if (result.status === 'rejected') throw new UiHostPickerError(result.reason)
    if (result.files.length > 24) throw new UiHostPickerError('too-many-files')
    const nativeImages = new Map<(typeof result.files)[number], Uint8Array>()
    let nativeImageBytes = 0
    for (const file of result.files) {
      if (accept === 'image' && file.kind !== 'photo') throw new UiHostPickerError('unsupported-image')
      if (file.kind !== 'photo') continue
      if (!isImportableImage(file.name)) throw new UiHostPickerError('unsupported-image')
      if (!file.previewDataUrl) throw new ImageImportError('invalid')
      // Bound aggregate encoded work before retaining a decoded copy.
      if (file.previewDataUrl.length > Math.ceil((24 * 1024 * 1024 - nativeImageBytes) / 3) * 4 + 32) throw new UiHostPickerError('selection-too-large')
      const bytes = previewBytes(file.previewDataUrl)
      nativeImageBytes += bytes.byteLength
      if (nativeImageBytes > 24 * 1024 * 1024) throw new UiHostPickerError('selection-too-large')
      nativeImages.set(file, bytes)
    }
    const files: UiHostFile[] = []
    for (const file of result.files) {
      if (signal?.aborted) return []
      const extracted = isPdfFileName(file.name)
        ? file.pdfFailure ? pdfImportFailure(file.pdfFailure)
          : file.pdfBytes ? await importPdf(file.pdfBytes, signal) : pdfImportFailure('unavailable')
        : isDocxFileName(file.name)
          ? file.docxFailure ? docxImportFailure(file.docxFailure)
            : file.docxBytes ? await importDocx(file.docxBytes, signal) : docxImportFailure('unavailable')
        : isXlsxFileName(file.name)
          ? file.xlsxFailure ? xlsxImportFailure(file.xlsxFailure)
            : file.xlsxBytes ? await importXlsx(file.xlsxBytes, signal) : xlsxImportFailure('unavailable')
        : file.kind === 'photo'
          ? { imageInput: await importImage(nativeImages.get(file)!, signal) }
          : { text: file.text }
      files.push(selectedFile({ name: file.name, kind: file.kind, ...extracted }))
    }
    return signal?.aborted ? [] : files
  }
  const files = await openInput({ multiple: true, accept: accept === 'image' ? 'image/*' : undefined })
  return readSelectedFiles(files, accept, signal)
}

/** Read files dropped onto a drop zone. */
export async function readDroppedFiles(list: FileList, accept: 'image' | 'any' = 'any', signal?: AbortSignal): Promise<UiHostFile[]> {
  return readSelectedFiles(Array.from(list), accept, signal)
}

async function readSelectedFiles(files: File[], accept: 'image' | 'any', signal?: AbortSignal): Promise<UiHostFile[]> {
  if (files.length > 24) throw new UiHostPickerError('too-many-files')
  const images = files.filter((file) => isImage(file.name))
  if (accept === 'image' && files.some((file) => !isImportableImage(file.name))) throw new UiHostPickerError('unsupported-image')
  if (images.some((file) => !isImportableImage(file.name))) throw new UiHostPickerError('unsupported-image')
  if (images.some((file) => file.size > IMAGE_MAX_CONTAINER_BYTES)) throw new UiHostPickerError('image-too-large')
  if (images.reduce((sum, file) => sum + file.size, 0) > 24 * 1024 * 1024) throw new UiHostPickerError('selection-too-large')
  const selected: UiHostFile[] = []
  const documentBudget = { used: 0 }
  const imageBudget = { used: 0 }
  for (const file of files) {
    if (signal?.aborted) break
    selected.push(await toUiHostFile(file, documentBudget, imageBudget, signal))
  }
  return signal?.aborted ? [] : selected
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
