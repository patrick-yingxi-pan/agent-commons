import { reviewArtifactPresentationImport } from './artifactPresentationImport.ts'
import { useArtifactFileImport, type ArtifactFileImportSeed } from './useArtifactFileImport.ts'

export function useArtifactPresentationImport(enabled: boolean, initial?: ArtifactFileImportSeed) {
  return useArtifactFileImport(enabled ? 'slides' : null, reviewArtifactPresentationImport, initial)
}
