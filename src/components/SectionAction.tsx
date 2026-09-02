import type { ReactNode } from 'react'
import { SECTION_ACTION_CLASS } from '../lib/sectionAction'

/** The one section-header action button — every verb in a section header's
 *  hover-revealed cluster (edit, add, post, commission…) renders through this,
 *  so the cue can't drift between copy-pasted copies (form follows function;
 *  locked by src/lib/sectionAction.test.ts). Icon-only: the destination stays
 *  NAMED via title + aria-label, like the page back arrow. */
export function SectionAction({
  label,
  icon,
  onClick,
  open,
  expanded,
  disabled,
  disabledReason,
}: {
  /** The verb, spelled out — becomes the tooltip and the accessible name. */
  label: string
  icon: ReactNode
  onClick: () => void
  /** For popover triggers: the popover's open state. Stamps `data-open` (keeps
   *  the cluster revealed + the button active) and the dialog aria pair.
   *  Omit for plain one-shot actions. */
  open?: boolean
  /** For inline-disclosure toggles (a form the verb shows/hides IN the section):
   *  stamps `aria-expanded` + `data-open` WITHOUT `aria-haspopup` — the disclosed
   *  content is section content, not a dialog. Omit for one-shot actions. */
  expanded?: boolean
  /** Preserve native one-shot action semantics while work is in flight. */
  disabled?: boolean
  /** Explain a held action without changing its stable accessible name. */
  disabledReason?: string
}) {
  const state = open ?? expanded
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={disabled && disabledReason ? `${label} — ${disabledReason}` : label}
      aria-label={label}
      {...(open !== undefined ? { 'aria-haspopup': 'dialog' as const } : {})}
      {...(state !== undefined ? { 'aria-expanded': state } : {})}
      data-open={state || undefined}
      className={`${SECTION_ACTION_CLASS} disabled:pointer-events-none disabled:opacity-50`}
    >
      {icon}
    </button>
  )
}
