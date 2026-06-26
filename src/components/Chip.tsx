import { ChevronDown } from 'lucide-react'
import type { ReactNode } from 'react'
import { CHIP_TONES, type ChipTone } from '../lib/capabilities'

/** The attached-context pill — a small rounded chip tinted by its context type.
 *  Shared verbatim by the composer (a session's attached context) and the
 *  Projects page (a project's scoped context) so both read the same. A plain
 *  chip opens its target; an `expandable` one shows a count + chevron and acts as
 *  a popup trigger. The per-type palette is the one source of truth in
 *  lib/capabilities. */
export function Chip({
  icon,
  tone,
  active,
  count,
  expandable,
  open,
  hint,
  onClick,
  children,
}: {
  icon: ReactNode
  tone: ChipTone
  active: boolean
  count?: number
  expandable?: boolean
  open?: boolean
  /** Overrides the default hover tooltip — used to clarify what a bare count
   *  means (e.g. the workspace chip counts folders, not items). */
  hint?: string
  onClick: () => void
  children: ReactNode
}) {
  const { tint, color } = CHIP_TONES[tone]
  const toneClass = `${tint} ${color}`
  return (
    <button
      onClick={onClick}
      title={hint ?? (expandable ? `${children} (${count})` : 'Open in sidebar')}
      aria-haspopup={expandable ? 'menu' : undefined}
      aria-expanded={expandable ? open : undefined}
      className={`inline-flex max-w-[220px] items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium transition ${toneClass} ${
        active ? 'ring-1 ring-accent' : 'ring-1 ring-transparent hover:ring-line-strong'
      }`}
    >
      {icon}
      <span className="truncate">{children}</span>
      {count != null && <span className="tabular-nums opacity-60">· {count}</span>}
      {expandable && (
        <ChevronDown size={11} className={`opacity-70 transition ${open ? 'rotate-180' : ''}`} />
      )}
    </button>
  )
}
