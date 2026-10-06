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
  return <ArtifactImportReview intake={intake} label="Import document text"
    description={`Start from one text, PDF, or Word (.docx) file. Text only: formatting, images, and page layout are not preserved. ${intake.imageTextAvailable ? 'Or extract text from one image on this Mac, with no image upload or provider charge.' : 'Image text extraction requires the macOS app.'} Nothing is saved until you create the document.`}
    alternatePick={intake.imageTextAvailable ? { label: 'Extract image text', onClick: intake.pickImage } : undefined}
    readingCopy={intake.selectionMode === 'image-text' ? 'Reading the image and recognizing text on this Mac… Your draft is unchanged.' : undefined}
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
