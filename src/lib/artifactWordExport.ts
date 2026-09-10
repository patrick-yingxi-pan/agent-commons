import { decodeArtifactOfficeExport } from './artifactOfficeExport.ts'
import type { DownloadBlobDescriptor } from './downloadText.ts'

/** DOCX uses the same bounded, identity- and filename-fenced Office decoder. */
export function decodeArtifactWordExport(file: unknown, artifactId: string): DownloadBlobDescriptor {
  return decodeArtifactOfficeExport(file, artifactId, 'docx')
}
