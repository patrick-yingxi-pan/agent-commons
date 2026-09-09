import { decodeArtifactOfficeExport } from './artifactOfficeExport.ts'
import type { DownloadBlobDescriptor } from './downloadText.ts'

/** PPTX uses the same bounded, identity- and filename-fenced Office decoder. */
export function decodeArtifactPresentationExport(file: unknown, artifactId: string): DownloadBlobDescriptor {
  return decodeArtifactOfficeExport(file, artifactId, 'pptx')
}
