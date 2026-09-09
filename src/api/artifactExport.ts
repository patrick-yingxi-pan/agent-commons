import type { ArtifactDocumentExport, ArtifactExport, ArtifactExportFormat } from '../../contract/index.ts'
import { apiGet } from './client.ts'
import { paths } from './keys.ts'

/** Export is a fresh authorized read, never a download of retained query data. */
export function readArtifactDocumentExport(id: string, signal: AbortSignal): Promise<ArtifactDocumentExport> {
  return apiGet<ArtifactDocumentExport>(paths.artifactExport(id), { signal })
}

/** Every format is an explicit fresh authorized read; the default remains the
 * legacy Markdown endpoint for document consumers. */
export function readArtifactExport(id: string, format: ArtifactExportFormat, signal: AbortSignal): Promise<ArtifactExport> {
  return apiGet<ArtifactExport>(paths.artifactExport(id, format === 'xlsx' ? 'xlsx' : undefined), { signal })
}
