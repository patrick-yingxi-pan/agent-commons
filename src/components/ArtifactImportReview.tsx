import { useEffect, useId, useRef, type ReactNode, type RefObject } from 'react'
import type { useArtifactFileImport } from '../lib/useArtifactFileImport.ts'
import { SECONDARY_BUTTON_CLASS } from '../lib/button.ts'
import { UiHostLoadNotice } from './UiHostLoadNotice.tsx'

const IMPORT_BUTTON_CLASS = `${SECONDARY_BUTTON_CLASS} px-3 py-1.5 text-[12px] disabled:cursor-not-allowed disabled:opacity-50`
type Controls = Pick<ReturnType<typeof useArtifactFileImport>, 'state' | 'picker' | 'reviewing' | 'pick' | 'discard'>

/** Same local-review ceremony for every artifact format; only the source
 * explanation and nature of the read-only preview vary. */
export function ArtifactImportReview({ intake, label, description, summary, adoptionCopy, useLabel, disabled, onUse, previewRef, children }: {
  intake: Controls
  label: string
  description: string
  summary: string
  adoptionCopy: string
  useLabel: string
  disabled: boolean
  onUse: () => void
  previewRef: RefObject<HTMLElement | null>
  children: ReactNode
}) {
  const helpId = useId()
  const importButtonRef = useRef<HTMLButtonElement>(null)
  const { state } = intake
  const previousStatus = useRef(state.status)
  useEffect(() => {
    if (previousStatus.current !== state.status && document.activeElement === document.body) {
      // Removed controls must not strand focus; asynchronous completion must
      // not steal the active caret from fields the person is still editing.
      if (state.status === 'ready') previewRef.current?.focus()
      else if (state.status === 'idle' || state.status === 'error') importButtonRef.current?.focus()
    }
    previousStatus.current = state.status
  }, [state.status, previewRef])
  return <section aria-label={label} className="min-w-0 space-y-2">
    <p id={helpId} className="text-[11px] leading-relaxed text-ink-soft">{description}</p>
    <UiHostLoadNotice state={intake.picker} label="file access" />
    {intake.picker.status === 'ready' && !intake.reviewing && <button ref={importButtonRef} type="button" className={IMPORT_BUTTON_CLASS} disabled={disabled} aria-describedby={helpId} onClick={intake.pick}>Import file</button>}
    {state.status === 'reading' && <div className="flex flex-wrap items-center gap-2">
      <p role="status" className="text-[12px] text-ink-soft">Reading selected file… Your draft is unchanged.</p>
      <button type="button" className={IMPORT_BUTTON_CLASS} onClick={intake.discard}>Cancel import</button>
    </div>}
    {state.status === 'error' && <p role="alert" className="text-[12px] text-danger-text">{state.message}</p>}
    {state.status === 'ready' && <div className="min-w-0 space-y-2">
      <p role="status" className="break-words text-[12px] text-ink-soft">{summary}</p>
      {children}
      <p className="text-[11px] text-ink-soft">{adoptionCopy} Your name is kept, or suggested from the file if blank. You can edit before creating.</p>
      <div className="flex flex-wrap gap-2">
        <button type="button" className={IMPORT_BUTTON_CLASS} disabled={disabled} onClick={onUse}>{useLabel}</button>
        <button type="button" className={IMPORT_BUTTON_CLASS} onClick={intake.discard}>Discard import</button>
      </div>
    </div>}
  </section>
}
