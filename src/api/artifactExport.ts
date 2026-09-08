import type { ArtifactDocumentExport } from '../../contract/index.ts'
import { apiGet } from './client.ts'
import { paths } from './keys.ts'

/** Export is a fresh authorized read, never a download of retained query data. */
export function readArtifactDocumentExport(id: string, signal: AbortSignal): Promise<ArtifactDocumentExport> {
  return apiGet<ArtifactDocumentExport>(paths.artifactExport(id), { signal })
}
