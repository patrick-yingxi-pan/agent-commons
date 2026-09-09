import { decodeArtifactOfficeExport } from './artifactOfficeExport.ts'
import type { DownloadBlobDescriptor } from './downloadText.ts'

/** Validate and decode a server-owned XLSX descriptor before it reaches Blob. */
export function decodeArtifactSpreadsheetExport(file: unknown, artifactId: string): DownloadBlobDescriptor {
  return decodeArtifactOfficeExport(file, artifactId, 'xlsx')
}
