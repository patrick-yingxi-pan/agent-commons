import { reviewArtifactPresentationImport } from './artifactPresentationImport.ts'
import { useArtifactFileImport } from './useArtifactFileImport.ts'

export function useArtifactPresentationImport(enabled: boolean) {
  return useArtifactFileImport(enabled ? 'slides' : null, reviewArtifactPresentationImport)
}
