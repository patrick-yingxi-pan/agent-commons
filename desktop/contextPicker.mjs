import { constants } from 'node:fs'
import { open, opendir, stat } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'
import { LOCAL_TEXT_PREVIEW_BYTES, decodeLocalTextPreview, isLocalTextFileName } from '../contract/localTextFile.mjs'
import { snapshotFolderFiles, MAX_FOLDER_SNAPSHOT_FILE_BYTES } from '../contract/localFolderSnapshot.mjs'
import { isPdfFileName, MAX_PDF_FILE_BYTES, MAX_PDF_SELECTION_BYTES } from '../contract/pdfImport.mjs'
import { isDocxFileName, MAX_DOCX_FILE_BYTES, MAX_DOCX_SELECTION_BYTES } from '../contract/docxImport.mjs'

export const MAX_PICKED_FILES = 24
export const MAX_FOLDER_ENTRIES = 500
export const MAX_TEXT_PREVIEW_BYTES = LOCAL_TEXT_PREVIEW_BYTES
export const MAX_IMAGE_PREVIEW_BYTES = 8 * 1024 * 1024
export const MAX_IMAGE_SELECTION_BYTES = 24 * 1024 * 1024
const MAX_DOCUMENT_SELECTION_BYTES = Math.min(MAX_PDF_SELECTION_BYTES, MAX_DOCX_SELECTION_BYTES)

const IMAGE_MIME = new Map([
  ['.bmp', 'image/bmp'],
  ['.gif', 'image/gif'],
  ['.ico', 'image/x-icon'],
  ['.jpeg', 'image/jpeg'],
  ['.jpg', 'image/jpeg'],
  ['.png', 'image/png'],
  ['.svg', 'image/svg+xml'],
  ['.webp', 'image/webp'],
])

const rejected = (reason) => ({ status: 'rejected', reason })

function fileExtension(filePath) {
  return extname(filePath).toLowerCase()
}

function imageMime(filePath) {
  return IMAGE_MIME.get(fileExtension(filePath))
}

async function safeFileDetails(filePath, inspect) {
  const details = await inspect(filePath)
  if (!details.isFile() || !Number.isSafeInteger(details.size) || details.size < 0) {
    throw new Error('not a regular file')
  }
  return details
}

/** Read at most one byte beyond the accepted payload so a file changed between
 * stat and read cannot turn a selected preview into an unbounded IPC message. */
async function readBounded(filePath, maxBytes) {
  const handle = await open(filePath, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
  try {
    const details = await handle.stat()
    if (!details.isFile() || !Number.isSafeInteger(details.size) || details.size < 0 || details.size > maxBytes + 1) {
      throw new Error('file changed or is not regular')
    }
    const buffer = Buffer.allocUnsafe(maxBytes + 1)
    let offset = 0
    while (offset < buffer.byteLength) {
      const { bytesRead } = await handle.read(buffer, offset, buffer.byteLength - offset, offset)
      if (bytesRead === 0) break
      offset += bytesRead
    }
    return buffer.subarray(0, offset)
  } finally {
    await handle.close()
  }
}

/** Stream instead of `readdir`: a selected directory with millions of entries
 * must not be materialized in main merely so we can reject item 501. */
export async function listTopLevelEntriesBounded(folderPath, openDirectory = opendir) {
  const directory = await openDirectory(folderPath)
  const entries = []
  try {
    for await (const entry of directory) {
      entries.push(entry)
      if (entries.length > MAX_FOLDER_ENTRIES) break
    }
  } finally {
    await directory.close().catch(() => {})
  }
  return entries
}

/** User-mediated, bounded native filesystem access. The renderer receives no
 * path or reusable handle: only display metadata and the small preview payloads
 * it already receives from browser File objects. */
export function createNativeContextPicker({
  showOpenDialog,
  readBytes = readBounded,
  listDirectory = listTopLevelEntriesBounded,
  inspect = stat,
} = {}) {
  if (typeof showOpenDialog !== 'function') throw new Error('A native dialog adapter is required.')

  return {
    async pickFiles(owner, accept = 'any') {
      if (accept !== 'any' && accept !== 'image') return rejected('invalid-request')
      try {
        const result = await showOpenDialog(owner, {
          title: accept === 'image' ? 'Add photos' : 'Add files',
          properties: ['openFile', 'multiSelections'],
          ...(accept === 'image'
            ? { filters: [{ name: 'Images', extensions: [...IMAGE_MIME.keys()].map((extension) => extension.slice(1)) }] }
            : {}),
        })
        if (result.canceled || result.filePaths.length === 0) return { status: 'cancelled' }
        if (result.filePaths.length > MAX_PICKED_FILES) return rejected('too-many-files')

        const selected = []
        let imageBytes = 0
        let documentBytes = 0
        for (const filePath of result.filePaths) {
          const details = await safeFileDetails(filePath, inspect)
          const mimeType = imageMime(filePath)
          if (accept === 'image' && !mimeType) return rejected('unsupported-image')
          if (mimeType && details.size > MAX_IMAGE_PREVIEW_BYTES) return rejected('image-too-large')
          if (mimeType && imageBytes + details.size > MAX_IMAGE_SELECTION_BYTES) return rejected('selection-too-large')

          const file = {
            name: basename(filePath),
            kind: mimeType ? 'photo' : 'file',
            sizeBytes: details.size,
          }
          if (mimeType) {
            const bytes = await readBytes(filePath, MAX_IMAGE_PREVIEW_BYTES)
            if (bytes.byteLength > MAX_IMAGE_PREVIEW_BYTES) return rejected('image-too-large')
            if (bytes.byteLength !== details.size) return rejected('unreadable')
            if (imageBytes + bytes.byteLength > MAX_IMAGE_SELECTION_BYTES) return rejected('selection-too-large')
            imageBytes += bytes.byteLength
            file.previewDataUrl = `data:${mimeType};base64,${bytes.toString('base64')}`
          } else if (isPdfFileName(file.name)) {
            if (details.size > MAX_PDF_FILE_BYTES) file.pdfFailure = 'file-too-large'
            else if (documentBytes + details.size > MAX_DOCUMENT_SELECTION_BYTES) file.pdfFailure = 'selection-limit'
            else {
              const bytes = await readBytes(filePath, MAX_PDF_FILE_BYTES)
              if (bytes.byteLength > MAX_PDF_FILE_BYTES) file.pdfFailure = 'file-too-large'
              else if (bytes.byteLength !== details.size) file.pdfFailure = 'invalid'
              else if (documentBytes + bytes.byteLength > MAX_DOCUMENT_SELECTION_BYTES) file.pdfFailure = 'selection-limit'
              else {
                documentBytes += bytes.byteLength
                file.pdfBytes = new Uint8Array(bytes)
              }
            }
          } else if (isDocxFileName(file.name)) {
            if (details.size > MAX_DOCX_FILE_BYTES) file.docxFailure = 'file-too-large'
            else if (documentBytes + details.size > MAX_DOCUMENT_SELECTION_BYTES) file.docxFailure = 'selection-limit'
            else {
              const bytes = await readBytes(filePath, MAX_DOCX_FILE_BYTES)
              if (bytes.byteLength > MAX_DOCX_FILE_BYTES) file.docxFailure = 'file-too-large'
              else if (bytes.byteLength !== details.size) file.docxFailure = 'invalid'
              else if (documentBytes + bytes.byteLength > MAX_DOCUMENT_SELECTION_BYTES) file.docxFailure = 'selection-limit'
              else {
                documentBytes += bytes.byteLength
                file.docxBytes = new Uint8Array(bytes)
              }
            }
          } else if (isLocalTextFileName(file.name) && details.size <= MAX_TEXT_PREVIEW_BYTES) {
            const bytes = await readBytes(filePath, MAX_TEXT_PREVIEW_BYTES)
            if (bytes.byteLength === details.size) {
              const text = decodeLocalTextPreview(bytes)
              if (text !== undefined) file.text = text
            }
          }
          selected.push(file)
        }
        return { status: 'selected', files: selected }
      } catch {
        return rejected('unreadable')
      }
    },

    async pickFolder(owner) {
      try {
        const result = await showOpenDialog(owner, {
          title: 'Add folder',
          properties: ['openDirectory'],
        })
        if (result.canceled || result.filePaths.length === 0) return { status: 'cancelled' }
        const folderPath = result.filePaths[0]
        const entries = await listDirectory(folderPath)
        if (entries.length > MAX_FOLDER_ENTRIES) return rejected('too-many-folder-entries')
        const files = entries.filter((entry) => entry.isFile() && !entry.name.startsWith('.'))

        const metadata = []
        for (const entry of files) {
          const details = await safeFileDetails(join(folderPath, entry.name), inspect)
          metadata.push({ name: entry.name, sizeBytes: details.size })
        }
        const snapshots = await snapshotFolderFiles(metadata, async (file) => readBytes(join(folderPath, file.name), MAX_FOLDER_SNAPSHOT_FILE_BYTES))
        return {
          status: 'selected',
          folder: {
            name: basename(folderPath) || 'folder',
            files: snapshots,
          },
        }
      } catch {
        return rejected('unreadable')
      }
    },
  }
}
