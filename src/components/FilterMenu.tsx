import { Fragment, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Check, ChevronRight, SlidersHorizontal } from 'lucide-react'
import { useDismissable } from '../lib/useDismissable'
import { FlyoutPanel, useFlyout } from './RecentOverflowList'

/** ── A generic "Filter & sort" menu — the sliders button + its popover ────────
 *  The shell behind both the Recents (session) and Scheduled (run) filters: one
 *  popover of rows, each opening a submenu to the right. The popover and its
 *  submenus are portaled to <body> so the sidebar's scroll container can't clip
 *  them (same reason RecentOverflowList portals its flyout). Selecting an option
 *  keeps the menu open so several dimensions can be set in one pass; an outside
 *  click or Escape dismisses it.
 *
 *  Callers describe the menu declaratively via `rows` — what each dimension is
 *  called, its current value, and its options — so the menu itself stays free of
 *  any session/run specifics. The value reads accent-toned when that dimension is
 *  narrowing / changing the list and muted at its neutral default. */

export interface FilterOption {
  label: string
  selected?: boolean
  disabled?: boolean
  onSelect?: () => void
  /** Draw a divider above this option (e.g. before a trailing "All" / "None"). */
  dividerBefore?: boolean
}

export interface FilterRowSpec {
  key: string
  label: string
  /** The current value shown on the right of the row. */
  value: string
  /** Accent-tone the value when this dimension is non-neutral. */
  accent: boolean
  /** Submenu flyout width. */
  width: number
  /** Draw a divider above this row. */
  dividerBefore?: boolean
  options: FilterOption[]
}

const POPOVER_WIDTH = 244
// Approximate rendered height; used only to decide whether to open below or above.
const POPOVER_EST_HEIGHT = 220

export function FilterMenu({ ariaLabel, rows }: { ariaLabel: string; rows: FilterRowSpec[] }) {
  const [open, setOpen] = useState(false)
  // The popover panel + submenu flyouts are portaled and each stop their own
  // mousedown, so anchoring the dismiss ref to the trigger alone is enough: any
  // mousedown that isn't the trigger or those panels counts as "outside".
  const triggerRef = useDismissable<HTMLButtonElement>(open, () => setOpen(false))
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)

  // Anchor the popover to the sliders button: right edge aligned to the button
  // (so it opens leftward into the rail), and below it — but flipped above when
  // there isn't room below (a rail header can sit low), so the menu never runs
  // off the viewport bottom.
  useLayoutEffect(() => {
    if (!open || !triggerRef.current) return
    const r = triggerRef.current.getBoundingClientRect()
    const M = 8
    const left = Math.max(M, Math.min(r.right - POPOVER_WIDTH, window.innerWidth - POPOVER_WIDTH - M))
    const roomBelow = window.innerHeight - r.bottom
    const top =
      roomBelow >= POPOVER_EST_HEIGHT + M ? r.bottom + 6 : Math.max(M, r.top - POPOVER_EST_HEIGHT - 6)
    setPos({ left, top })
  }, [open])

  return (
    <>
      <button
        ref={triggerRef}
        onClick={() => setOpen((o) => !o)}
        title="Filter & sort"
        aria-label={ariaLabel}
        aria-haspopup="menu"
        aria-expanded={open}
        data-open={open}
        className="flex h-5 w-5 items-center justify-center rounded text-ink-faint transition hover:bg-surface/70 hover:text-ink-soft data-[open=true]:bg-surface data-[open=true]:text-ink"
      >
        <SlidersHorizontal size={14} />
      </button>

      {open &&
        pos &&
        createPortal(
          <div
            role="menu"
            aria-label={ariaLabel}
            onMouseDown={(e) => e.stopPropagation()}
            style={{ position: 'fixed', left: pos.left, top: pos.top, width: POPOVER_WIDTH }}
            className="z-[60] rounded-xl border border-line-strong bg-surface p-1 text-[13px] shadow-xl"
          >
            {rows.map((row) => (
              <Fragment key={row.key}>
                {row.dividerBefore && <Divider />}
                <FilterRow label={row.label} value={row.value} accent={row.accent} width={row.width}>
                  {row.options.map((o) => (
                    <Fragment key={o.label}>
                      {o.dividerBefore && <Divider />}
                      <Opt label={o.label} selected={o.selected} disabled={o.disabled} onSelect={o.onSelect} />
                    </Fragment>
                  ))}
                </FilterRow>
              </Fragment>
            ))}
          </div>,
          document.body,
        )}
    </>
  )
}

/** A top-level row: label, the current value (accent when non-neutral), and a
 *  chevron. Hovering opens its submenu flyout to the right (reusing the recents
 *  flyout's open/close-delay so the pointer can travel across the gap). */
function FilterRow({
  label,
  value,
  accent,
  width,
  children,
}: {
  label: string
  value: string
  accent: boolean
  width: number
  children: ReactNode
}) {
  const ref = useRef<HTMLButtonElement>(null)
  const { open, openNow, closeSoon } = useFlyout()
  return (
    <>
      <button
        ref={ref}
        type="button"
        role="menuitem"
        onMouseEnter={openNow}
        onMouseLeave={closeSoon}
        onFocus={openNow}
        onBlur={closeSoon}
        aria-haspopup="menu"
        aria-expanded={open}
        className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition hover:bg-panel-2 ${
          open ? 'bg-panel-2' : ''
        }`}
      >
        <span className="flex-1 text-ink">{label}</span>
        <span className={accent ? 'font-medium text-accent' : 'text-ink-faint'}>{value}</span>
        <ChevronRight size={14} className="shrink-0 text-ink-faint" />
      </button>
      {open && (
        <FlyoutPanel anchor={ref.current} width={width} onEnter={openNow} onLeave={closeSoon}>
          {children}
        </FlyoutPanel>
      )}
    </>
  )
}

/** A submenu option. `disabled` renders a muted, non-interactive stub (a
 *  dimension the prototype doesn't model yet). */
function Opt({
  label,
  selected,
  disabled,
  onSelect,
}: {
  label: string
  selected?: boolean
  disabled?: boolean
  onSelect?: () => void
}) {
  return (
    <button
      type="button"
      role="menuitemradio"
      aria-checked={!!selected}
      disabled={disabled}
      title={disabled ? 'Coming soon' : undefined}
      onClick={disabled ? undefined : onSelect}
      className={`flex w-full items-center justify-between gap-3 rounded-lg px-2 py-1.5 text-left transition ${
        disabled ? 'cursor-default text-ink-faint/60' : 'text-ink hover:bg-panel-2'
      }`}
    >
      <span>{label}</span>
      {selected && <Check size={14} className="shrink-0 text-accent" />}
    </button>
  )
}

function Divider() {
  return <div className="my-1 border-t border-line" />
}
