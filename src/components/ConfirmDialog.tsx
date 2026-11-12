import { useRef, type RefObject } from 'react'
import { SCRIM_CLASS } from '../lib/scrim'
import { BOUNDED_DIALOG_BODY_CLASS, BOUNDED_DIALOG_LAYER_CLASS, BOUNDED_DIALOG_PANEL_CLASS, DIALOG_SURFACE_CLASS, dialogReadRegionProps } from '../lib/dialog'
import { useBoundedDialog } from '../lib/useBoundedDialog'
import { WRAPPING_PROSE_CLASS } from '../lib/prose'
import { DANGER_BUTTON_CLASS, SECONDARY_BUTTON_CLASS } from '../lib/button'
import { useFocusTrap } from '../lib/useFocusTrap'
import { CheckboxRow } from './Checkbox'

/** ── The confirm dialog ───────────────────────────────────────────────────────
 *  "Are you sure?" as a modal, for an act that cannot be undone — the shape the
 *  owner asked for when a mis-aimed click retracted a seeded post and took the
 *  thread's opening question with it (owner directive 2026-08-11: *"space delete
 *  button a little far away to avoid being clicked by mistake. Also confirm
 *  deletion in a pop-up window for the same purpose"*).
 *
 *  It is a shared primitive rather than a fourth hand-rolled confirm because the
 *  repo already had three idioms for this one question and they had drifted:
 *  `RowMenu`'s in-flyout `ConfirmView`, SectionView's two-step inline
 *  `ConsoleConfirm`, and the bare `onClick` that deleted a post outright. Same
 *  role ⇒ same look (src/CLAUDE.md); the other two keep their form because a
 *  confirm INSIDE an open menu is a different surface from a modal, but nothing
 *  should ever again ask this question by inventing a fourth answer.
 *
 *  Three deliberate properties, each aimed at the mis-click rather than at
 *  looking official:
 *
 *  - **Focus lands on Cancel**, never on the destructive verb. The dialog exists
 *    because a pointer went somewhere it did not mean to; a keyboard that lands
 *    pre-armed on "Delete" and takes an idle Enter has reproduced the accident
 *    one layer up.
 *  - **Escape and an outside click cancel** (through `useFocusTrap`, which also
 *    keeps Tab inside and restores focus to the control you came from, WCAG
 *    2.4.3). Dismissal must be the cheap direction.
 *  - **The body names what is about to go**, and its consequences, in the
 *    caller's own words — a confirm that only says "Are you sure?" moves the
 *    click without adding the information that would change it.
 *
 *  Locked by `src/lib/confirm-dialog.test.ts`. */
export function ConfirmDialog({
  title,
  body,
  option,
  confirmLabel,
  onConfirm,
  onCancel,
  returnFocus,
}: {
  title: string
  /** What is being destroyed and what follows from it. Prose, not "Are you
   *  sure?" — see the header. */
  body: string
  /** One checkbox that WIDENS the act — today, "take the replies too". Typed as
   *  a single option rather than a `children` slot on purpose: a confirm that
   *  can grow arbitrary controls stops being a confirm, and a second question
   *  asked at the moment of an irreversible one is already the limit. It is
   *  unchecked on arrival and the caller re-words `confirmLabel` from it, so
   *  the button always states the wider act before it is pressed. */
  option?: { label: string; checked: boolean; onChange: (checked: boolean) => void }
  /** The destructive verb, matching the control that opened this ("Retract",
   *  "Delete") so the dialog reads as the same act rather than a second one. */
  confirmLabel: string
  onConfirm: () => void
  onCancel: () => void
  /** Explicit opener for callers that load a review before mounting this dialog. */
  returnFocus?: RefObject<HTMLElement | null>
}) {
  const dialogRef = useRef<HTMLDivElement>(null)
  const cancelRef = useRef<HTMLButtonElement>(null)
  useBoundedDialog(dialogRef)
  useFocusTrap(dialogRef, onCancel, { initialFocus: cancelRef, returnFocus })

  return (
    <div
      className={BOUNDED_DIALOG_LAYER_CLASS}
      onMouseDown={onCancel}
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div className={SCRIM_CLASS} />
      <div
        ref={dialogRef}
        data-bounded-dialog="confirm"
        onMouseDown={(e) => e.stopPropagation()}
        className={`w-[380px] p-4 ${BOUNDED_DIALOG_PANEL_CLASS} ${DIALOG_SURFACE_CLASS}`}
      >
        <p className="shrink-0 text-[15px] font-semibold text-ink">{title}</p>
        <div {...dialogReadRegionProps('Confirmation details')} className={BOUNDED_DIALOG_BODY_CLASS}>
          <p data-wrapping-prose className={`mt-1.5 text-[12px] leading-relaxed text-ink-soft ${WRAPPING_PROSE_CLASS}`}>{body}</p>
          {/* The shared checkbox keeps widening the action a familiar, explicit choice. */}
          {option && (
            <CheckboxRow
              checked={option.checked}
              onToggle={() => option.onChange(!option.checked)}
              className="mt-3 w-full rounded-md bg-panel-2/60 p-2 text-[12px] leading-snug text-ink-soft"
            >
              <span>{option.label}</span>
            </CheckboxRow>
          )}
        </div>
        <div className="mt-4 flex shrink-0 items-center justify-end gap-2">
          <button ref={cancelRef} type="button" onClick={onCancel} className={`${SECONDARY_BUTTON_CLASS} px-3 py-1.5 text-[12px]`}>
            Cancel
          </button>
          <button type="button" onClick={onConfirm} className={`${DANGER_BUTTON_CLASS} px-3 py-1.5 text-[12px]`}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
