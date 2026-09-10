import { useEffect, useId, useRef } from 'react'
import type { useArtifactDocumentImport } from '../lib/useArtifactDocumentImport.ts'
import { SECONDARY_BUTTON_CLASS } from '../lib/button.ts'
import { FORM_INPUT_CLASS } from '../lib/formInput.ts'
import { UiHostLoadNotice } from './UiHostLoadNotice.tsx'

const IMPORT_BUTTON_CLASS = `${SECONDARY_BUTTON_CLASS} px-3 py-1.5 text-[12px] disabled:cursor-not-allowed disabled:opacity-50`

export function ArtifactDocumentImport({ intake, hasContent, disabled, onUse }: {
  intake: ReturnType<typeof useArtifactDocumentImport>
  hasContent: boolean
  disabled: boolean
  onUse: () => void
}) {
  const helpId = useId()
  const previewId = useId()
  const previewRef = useRef<HTMLTextAreaElement>(null)
  const importButtonRef = useRef<HTMLButtonElement>(null)
  const { state } = intake
  const previousStatus = useRef(state.status)
  useEffect(() => {
    if (previousStatus.current !== state.status && document.activeElement === document.body) {
      // A removed review/cancel control must not strand keyboard focus, but a
      // file finishing while the user types must never steal their caret.
      if (state.status === 'ready') previewRef.current?.focus()
      else if (state.status === 'idle' || state.status === 'error') importButtonRef.current?.focus()
    }
    previousStatus.current = state.status
  }, [state.status])
  return <section aria-label="Import document text" className="min-w-0 space-y-2">
    <p id={helpId} className="text-[11px] leading-relaxed text-ink-soft">
      Start from one text, PDF, or Word (.docx) file. Text only: formatting, images, and page layout are not preserved; scanned pages need OCR elsewhere. Nothing is saved until you create the document.
    </p>
    <UiHostLoadNotice state={intake.picker} label="file access" />
    {intake.picker.status === 'ready' && !intake.reviewing && <button ref={importButtonRef} type="button" className={IMPORT_BUTTON_CLASS} disabled={disabled} aria-describedby={helpId} onClick={intake.pick}>Import file</button>}
    {state.status === 'reading' && <div className="flex flex-wrap items-center gap-2">
      <p role="status" className="text-[12px] text-ink-soft">Reading selected file… Your draft is unchanged.</p>
      <button type="button" className={IMPORT_BUTTON_CLASS} onClick={intake.discard}>Cancel import</button>
    </div>}
    {state.status === 'error' && <p role="alert" className="text-[12px] text-danger-text">{state.message}</p>}
    {state.status === 'ready' && <div className="min-w-0 space-y-2">
      <p role="status" className="break-words text-[12px] text-ink-soft">Review imported text. {state.text.length.toLocaleString()} characters; your draft is unchanged.</p>
      {state.disclosure && <p className="text-[11px] leading-relaxed text-ink-soft">{state.disclosure}</p>}
      <label htmlFor={previewId} className="block text-[12px] text-ink-soft">Imported text</label>
      <textarea id={previewId} ref={previewRef} readOnly value={state.text} rows={5} className={`${FORM_INPUT_CLASS} resize-y leading-relaxed`} />
      <p className="text-[11px] text-ink-soft">{hasContent ? 'Using this text replaces the current content.' : 'Using this text fills the document content.'} Your name is kept, or suggested from the file if blank. You can edit before creating.</p>
      <div className="flex flex-wrap gap-2">
        <button type="button" className={IMPORT_BUTTON_CLASS} disabled={disabled} onClick={onUse}>{hasContent ? 'Replace content with imported text' : 'Use imported text'}</button>
        <button type="button" className={IMPORT_BUTTON_CLASS} onClick={intake.discard}>Discard import</button>
      </div>
    </div>}
  </section>
}
