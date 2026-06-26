import { Plus } from 'lucide-react'
import { INLINE_ACTION_CLASS } from '../lib/inlineAction'

/** The shared "+ Add ‹thing›" trigger — the in-place control that opens a picker
 *  to attach one more thing to the current surface (Add routine, Add context, Add
 *  tool, …). One component so these logically-parallel actions stay visually
 *  identical: same role ⇒ same look (form follows function). It's the Plus + dialog
 *  specialisation of the shared inline panel-foot action (lib/inlineAction). The
 *  popover each one opens is its own concern; this is just the button that opens
 *  it, so it stays presentational and carries the shared dialog aria. */
export function AddTrigger({
  label,
  open,
  onClick,
  title,
}: {
  label: string
  /** Drives aria-expanded — the trigger toggles a popover/dialog. */
  open: boolean
  onClick: () => void
  title?: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-haspopup="dialog"
      aria-expanded={open}
      className={INLINE_ACTION_CLASS}
    >
      <Plus size={13} />
      {label}
    </button>
  )
}
