import { useRef } from 'react'
import { SCRIM_CLASS } from '../lib/scrim'
import { DIALOG_SURFACE_CLASS } from '../lib/dialog'
import { DANGER_BUTTON_CLASS, SECONDARY_BUTTON_CLASS } from '../lib/button'
import { useFocusTrap } from '../lib/useFocusTrap'

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
 *  Locked by `tests/confirm-dialog.test.ts`. */
export function ConfirmDialog({
  title,
  body,
  confirmLabel,
  onConfirm,
  onCancel,
}: {
  title: string
  /** What is being destroyed and what follows from it. Prose, not "Are you
   *  sure?" — see the header. */
  body: string
  /** The destructive verb, matching the control that opened this ("Retract",
   *  "Delete") so the dialog reads as the same act rather than a second one. */
  confirmLabel: string
  onConfirm: () => void
  onCancel: () => void
}) {
  const dialogRef = useRef<HTMLDivElement>(null)
  const cancelRef = useRef<HTMLButtonElement>(null)
  useFocusTrap(dialogRef, onCancel, { initialFocus: cancelRef })

  return (
    <div
      className="fixed inset-0 z-50 flex justify-center px-4 pt-[18dvh] short:pt-[8dvh]"
      onMouseDown={onCancel}
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div className={SCRIM_CLASS} />
      <div
        ref={dialogRef}
        onMouseDown={(e) => e.stopPropagation()}
        className={`relative h-fit w-[380px] max-w-full p-4 ${DIALOG_SURFACE_CLASS}`}
      >
        <p className="text-[14px] font-semibold text-ink">{title}</p>
        <p className="mt-1.5 text-[12px] leading-relaxed text-ink-soft">{body}</p>
        <div className="mt-4 flex items-center justify-end gap-2">
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
