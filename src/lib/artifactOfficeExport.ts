import {
  artifactExportFilename,
  PPTX_MEDIA_TYPE,
  XLSX_MEDIA_TYPE,
  type ArtifactPresentationExport,
  type ArtifactSpreadsheetExport,
} from '../../contract/index.ts'
import type { DownloadBlobDescriptor } from './downloadText.ts'

const MAX_BYTES = { xlsx: 2 * 1024 * 1024, pptx: 8 * 1024 * 1024 } as const

type OfficeExport = ArtifactSpreadsheetExport | ArtifactPresentationExport

/** Validate and decode a server-owned Office descriptor before Blob. */
export function decodeArtifactOfficeExport(file: unknown, artifactId: string, format: 'xlsx' | 'pptx'): DownloadBlobDescriptor {
  if (!file || typeof file !== 'object') throw new Error('Unexpected office descriptor')
  const candidate = file as Partial<OfficeExport>
  const mediaType = format === 'xlsx' ? XLSX_MEDIA_TYPE : PPTX_MEDIA_TYPE
  const maxBytes = MAX_BYTES[format]
  if (typeof candidate.artifactId !== 'string' || candidate.artifactId !== artifactId) throw new Error('Unexpected office identity')
  if (candidate.mediaType !== mediaType || candidate.encoding !== 'base64') throw new Error('Unexpected office format')
  if (!Number.isSafeInteger(candidate.revision) || candidate.revision! < 0) throw new Error('Unexpected office revision')
  if (typeof candidate.filename !== 'string' || artifactExportFilename(candidate.filename, format) !== candidate.filename) throw new Error('Unsafe office filename')
  // Bound the encoded string before atob/btoa can allocate additional copies.
  if (typeof candidate.content !== 'string' || !candidate.content || candidate.content.length > Math.ceil(maxBytes / 3) * 4) throw new Error('Invalid office encoding')
  let binary: string
  try { binary = atob(candidate.content) } catch { throw new Error('Invalid office encoding') }
  if (btoa(binary) !== candidate.content) throw new Error('Invalid office encoding')
  if (binary.length < 4 || binary.length > maxBytes || binary.slice(0, 4) !== 'PK\u0003\u0004') throw new Error('Invalid office ZIP')
  return {
    content: Uint8Array.from(binary, (char) => char.charCodeAt(0)),
    filename: candidate.filename,
    mediaType: candidate.mediaType,
  }
}
