import { reviewArtifactDocumentImport } from './artifactDocumentImport.ts'
import { useArtifactFileImport } from './useArtifactFileImport.ts'

export function useArtifactDocumentImport(enabled: boolean) {
  return useArtifactFileImport(enabled ? 'document' : null, reviewArtifactDocumentImport)
}
