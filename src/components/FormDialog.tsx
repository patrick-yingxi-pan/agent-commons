import { useEffect, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { BOUNDED_DIALOG_BODY_CLASS, BOUNDED_DIALOG_LAYER_CLASS, BOUNDED_DIALOG_PANEL_CLASS, DIALOG_SURFACE_CLASS, FORM_DIALOG_FIELDS_CLASS } from '../lib/dialog'
import { useBoundedDialog } from '../lib/useBoundedDialog.ts'
import { useFocusTrap } from '../lib/useFocusTrap'
import { SCRIM_CLASS } from '../lib/scrim'
import { SOFT_BUTTON_CLASS, SECONDARY_BUTTON_CLASS } from '../lib/button'

/** A labeled form field for the hub dialogs. */
export function FormField({ label, optional, controlId, children }: { label: string; optional?: boolean; controlId?: string; children: ReactNode }) {
  const caption = <span className="mb-1.5 block text-[12px] font-medium text-ink-soft">
    {label}
    {optional && <span className="font-normal text-ink-faint"> (optional)</span>}
  </span>
  // Explicit association keeps auxiliary copy and controlled textarea content
  // outside the field's name. Existing simple fields retain implicit labels.
  return controlId
    ? <div><label htmlFor={controlId} className="block">{caption}</label>{children}</div>
    : <label className="block">{caption}{children}</label>
}

/** The shared create / edit modal shell for resource forms — portal + focus trap, a
 *  titled header, a body of fields, an inline error slot, and a Cancel / submit footer.
 *  One primitive so every concept's dialog looks and behaves identically (form follows
 *  function); each dialog supplies only its own fields + submit handler. */
export function FormDialog({
  title,
  icon,
  kind,
  submitLabel,
  submitIcon,
  canSubmit,
  onSubmit,
  onClose,
  error,
  busy = false,
  fieldsDisabled = busy,
  cancelLabel = 'Cancel',
  children,
}: {
  title: string
  icon: ReactNode
  kind?: string
  submitLabel: string
  submitIcon?: ReactNode
  canSubmit: boolean
  onSubmit: () => void
  onClose: () => void
  error?: string | null
  busy?: boolean
  fieldsDisabled?: boolean
  cancelLabel?: string
  children: ReactNode
}) {
  const dialogRef = useRef<HTMLDivElement>(null)
  useBoundedDialog(dialogRef)
  const close = () => {
    if (!busy) onClose()
  }
  useFocusTrap(dialogRef, close)
  // Land focus on the first field, not the close button useFocusTrap would otherwise
  // pick (this mount effect runs after the trap's, so it wins).
  useEffect(() => {
    dialogRef.current?.querySelector<HTMLElement>('input, textarea, select')?.focus()
  }, [])
  return createPortal(
    <div
      data-form-dialog={kind}
      className={BOUNDED_DIALOG_LAYER_CLASS}
      onMouseDown={close}
      role="dialog"
      aria-modal="true"
      aria-label={title}
      aria-busy={busy}
    >
      <div className={`${SCRIM_CLASS} backdrop-blur-[1px]`} />
      <div
        ref={dialogRef}
        data-bounded-dialog="resource-form"
        onMouseDown={(e) => e.stopPropagation()}
        className={`w-[460px] ${BOUNDED_DIALOG_PANEL_CLASS} ${DIALOG_SURFACE_CLASS}`}
      >
        <div className="flex shrink-0 items-center justify-between border-b border-line px-5 py-3.5">
          <div className="flex items-center gap-2">
            {icon}
            <span className="text-[15px] font-semibold text-ink">{title}</span>
          </div>
          <button
            onClick={close}
            disabled={busy}
            title="Close"
            aria-label="Close"
            className="-mr-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-ink-faint transition hover:bg-panel-2 hover:text-ink"
          >
            <X size={16} />
          </button>
        </div>

        <div className={`space-y-4 p-5 ${BOUNDED_DIALOG_BODY_CLASS}`}>
          <fieldset disabled={fieldsDisabled} data-form-fields className={FORM_DIALOG_FIELDS_CLASS}>
            {children}
          </fieldset>
          {error && <p className="text-[12px] text-removed">{error}</p>}
        </div>

        <div className="flex shrink-0 items-center justify-end gap-2 border-t border-line bg-panel px-5 py-3">
          <button
            onClick={close}
            disabled={busy}
            className={`${SECONDARY_BUTTON_CLASS} px-3.5 py-1.5 text-[13px]`}
          >
            {cancelLabel}
          </button>
          <button
            onClick={onSubmit}
            disabled={!canSubmit || fieldsDisabled}
            className={`flex items-center gap-1.5 ${SOFT_BUTTON_CLASS} px-3.5 py-1.5 text-[13px] disabled:cursor-not-allowed disabled:opacity-50`}
          >
            {submitIcon}
            {submitLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
