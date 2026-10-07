import { useId, useRef } from 'react'
import type { useArtifactDocumentImport } from '../lib/useArtifactDocumentImport.ts'
import { FORM_INPUT_CLASS } from '../lib/formInput.ts'
import { ArtifactImportReview } from './ArtifactImportReview.tsx'

export function ArtifactDocumentImport({ intake, hasContent, disabled, onUse }: {
  intake: ReturnType<typeof useArtifactDocumentImport>
  hasContent: boolean
  disabled: boolean
  onUse: () => void
}) {
  const previewId = useId()
  const previewRef = useRef<HTMLTextAreaElement>(null)
  const { state } = intake
  const alternatives = [
    ...(intake.imageTextAvailable ? [{ label: 'Extract image text', onClick: intake.pickImage }] : []),
    ...(intake.pdfTextAvailable ? [{ label: 'Extract PDF text', onClick: intake.pickPdf }] : []),
  ]
  return <ArtifactImportReview intake={intake} label="Import document text"
    description={`Start from one text, PDF, or Word (.docx) file. Text only: formatting, images, and page layout are not preserved. ${intake.imageTextAvailable ? 'Or extract text from one image on this Mac, with no image upload or provider charge.' : 'Image text extraction requires the macOS app.'} ${intake.pdfTextAvailable ? 'Extract PDF text also recognizes scanned pages: up to 8 MB and 100 pages, with no upload or provider call.' : ''} Nothing is saved until you create the document.`}
    alternatePicks={alternatives}
    readingCopy={intake.selectionMode === 'image-text' ? 'Reading the image and recognizing text on this Mac… Your draft is unchanged.' : intake.selectionMode === 'pdf-text' ? 'Reading the PDF and recognizing text on this Mac… Your draft is unchanged.' : undefined}
    summary={state.status === 'ready' ? `Review imported text. ${state.text.length.toLocaleString()} characters; your draft is unchanged.` : ''}
    adoptionCopy={hasContent ? 'Using this text replaces the current content.' : 'Using this text fills the document content.'}
    useLabel={hasContent ? 'Replace content with imported text' : 'Use imported text'}
    disabled={disabled} onUse={onUse} previewRef={previewRef}>
    {state.status === 'ready' && <>
      {state.disclosure && <p className="text-[11px] leading-relaxed text-ink-soft">{state.disclosure}</p>}
      <label htmlFor={previewId} className="block text-[12px] text-ink-soft">Imported text</label>
      <textarea id={previewId} ref={previewRef} readOnly value={state.text} rows={5} className={`${FORM_INPUT_CLASS} resize-y leading-relaxed`} />
    </>}
  </ArtifactImportReview>
}
