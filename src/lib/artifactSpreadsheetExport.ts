import { artifactExportFilename, XLSX_MEDIA_TYPE, type ArtifactSpreadsheetExport } from '../../contract/index.ts'
import type { DownloadBlobDescriptor } from './downloadText.ts'

const MAX_BYTES = 2 * 1024 * 1024
const MAX_BASE64 = Math.ceil(MAX_BYTES / 3) * 4

/** Validate and decode a server-owned XLSX descriptor before it reaches Blob. */
export function decodeArtifactSpreadsheetExport(file: unknown, artifactId: string): DownloadBlobDescriptor {
  if (!file || typeof file !== 'object') throw new Error('Unexpected spreadsheet descriptor')
  const candidate = file as Partial<ArtifactSpreadsheetExport>
  if (typeof candidate.artifactId !== 'string' || candidate.artifactId !== artifactId) throw new Error('Unexpected spreadsheet identity')
  if (candidate.mediaType !== XLSX_MEDIA_TYPE || candidate.encoding !== 'base64') throw new Error('Unexpected spreadsheet format')
  if (!Number.isSafeInteger(candidate.revision) || candidate.revision! < 0) throw new Error('Unexpected spreadsheet revision')
  if (typeof candidate.filename !== 'string' || artifactExportFilename(candidate.filename, 'xlsx') !== candidate.filename) throw new Error('Unsafe spreadsheet filename')
  if (typeof candidate.content !== 'string' || !candidate.content || candidate.content.length > MAX_BASE64 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(candidate.content)) {
    throw new Error('Invalid spreadsheet encoding')
  }
  let binary: string
  try { binary = atob(candidate.content) } catch { throw new Error('Invalid spreadsheet encoding') }
  if (btoa(binary) !== candidate.content) throw new Error('Invalid spreadsheet encoding')
  if (binary.length < 4 || binary.length > MAX_BYTES || binary.slice(0, 4) !== 'PK\u0003\u0004') throw new Error('Invalid spreadsheet ZIP')
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0))
  return { content: bytes, filename: candidate.filename, mediaType: candidate.mediaType }
}
