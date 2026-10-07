import { reviewArtifactDocumentImport } from './artifactDocumentImport.ts'
import { useArtifactFileImport } from './useArtifactFileImport.ts'
import { desktopImageOcrAvailable } from '../api/desktopImageOcr.ts'
import { reviewArtifactImageImport } from './artifactImageImport.ts'
import { desktopPdfOcrAvailable } from '../api/desktopPdfOcr.ts'
import { reviewArtifactPdfOcrImport } from './artifactPdfOcrImport.ts'

export function useArtifactDocumentImport(enabled: boolean) {
  const imageTextAvailable = desktopImageOcrAvailable()
  const pdfTextAvailable = desktopPdfOcrAvailable()
  const intake = useArtifactFileImport(enabled ? 'document' : null, (files, signal, mode) =>
    mode === 'image-text' ? reviewArtifactImageImport(files, signal)
      : mode === 'pdf-text' ? reviewArtifactPdfOcrImport(files, signal)
        : reviewArtifactDocumentImport(files))
  const pickImage = () => { if (imageTextAvailable) intake.pickAs('image-text') }
  const pickPdf = () => { if (pdfTextAvailable) intake.pickAs('pdf-text') }
  return { ...intake, imageTextAvailable, pdfTextAvailable, pickImage, pickPdf }
}
