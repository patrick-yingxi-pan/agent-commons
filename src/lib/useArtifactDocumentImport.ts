import { reviewArtifactDocumentImport } from './artifactDocumentImport.ts'
import { useArtifactFileImport } from './useArtifactFileImport.ts'
import { desktopImageOcrAvailable } from '../api/desktopImageOcr.ts'
import { reviewArtifactImageImport } from './artifactImageImport.ts'

export function useArtifactDocumentImport(enabled: boolean) {
  const imageTextAvailable = desktopImageOcrAvailable()
  const intake = useArtifactFileImport(enabled ? 'document' : null, (files, signal, mode) =>
    mode === 'image-text' ? reviewArtifactImageImport(files, signal) : reviewArtifactDocumentImport(files))
  const pickImage = () => { if (imageTextAvailable) intake.pickAs('image-text') }
  return { ...intake, imageTextAvailable, pickImage }
}
