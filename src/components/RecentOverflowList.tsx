import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { ChevronRight, MoreHorizontal } from 'lucide-react'

/** ── Recent-list overflow, one shared mechanism for every Add-context type ────
 *  The recent / connected list never evicts (lib/recents.ts), so it can outgrow
 *  the space the picker has. The view folds the tail into ONE secondary list:
 *  a "More …" row that, on hover, opens a single flyout to the right holding all
 *  the remaining items — and that flyout *scrolls* when it can't show them at
 *  once. No recursive chaining (a cascade of sub-menus is hard to use); just one
 *  level, scrollable as a catch-all.
 *
 *  How many rows show inline is decided by the caller (`maxRows`), measured from
 *  the layout height — so the inline list is as long as the popover can show and
 *  only the genuine overflow goes to the flyout. */

/** A small open/close controller with a close delay, so the pointer can travel
 *  from the "More" row to the flyout without it snapping shut. */
export function useFlyout() {
  const [open, setOpen] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const openNow = () => {
    if (timer.current) clearTimeout(timer.current)
    setOpen(true)
  }
  const closeSoon = () => {
    timer.current = setTimeout(() => setOpen(false), 140)
  }
  return { open, openNow, closeSoon }
}

/** A hover flyout panel, portaled to <body> so the popover's `overflow-hidden`
 *  can't clip it. Anchored to the right of the trigger (flips left near the edge),
 *  height-capped to the viewport and scrollable when its content is taller. */
export function FlyoutPanel({
  anchor,
  width = 252,
  onEnter,
  onLeave,
  children,
}: {
  anchor: HTMLElement | null
  width?: number
  onEnter: () => void
  onLeave: () => void
  children: ReactNode
}) {
  const [pos, setPos] = useState<{ left: number; top: number; maxH: number } | null>(null)

  useLayoutEffect(() => {
    if (!anchor) return
    const r = anchor.getBoundingClientRect()
    const M = 8
    const GAP = 6
    let left = r.right + GAP
    if (left + width > window.innerWidth - M) left = Math.max(M, r.left - width - GAP)
    const top = Math.max(M, Math.min(r.top - 6, window.innerHeight - 140))
    const maxH = window.innerHeight - top - M
    setPos({ left, top, maxH })
  }, [anchor, width])

  if (!pos) return null
  return createPortal(
    <div
      role="menu"
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
      style={{ position: 'fixed', left: pos.left, top: pos.top, width, maxHeight: pos.maxH }}
      className="z-[70] overflow-y-auto overflow-x-hidden rounded-xl border border-line-strong bg-surface p-1 shadow-xl"
    >
      {children}
    </div>,
    document.body,
  )
}

export interface OverflowRow {
  key: string
  node: ReactNode
}

/** Renders `rows` as a recent list: the first `maxRows` inline, and — when there
 *  are more — the last inline slot becomes a "More …" row whose hover reveals the
 *  remainder in one scrollable flyout. */
export function RecentOverflowList({
  rows,
  maxRows,
  moreLabel = 'More recent',
}: {
  rows: OverflowRow[]
  maxRows: number
  moreLabel?: string
}) {
  const moreRef = useRef<HTMLButtonElement>(null)
  const { open, openNow, closeSoon } = useFlyout()

  const cap = Math.max(1, maxRows)
  const overflow = rows.length > cap
  const head = overflow ? rows.slice(0, cap - 1) : rows
  const tail = overflow ? rows.slice(cap - 1) : []

  return (
    <>
      {head.map((r) => (
        <div key={r.key}>{r.node}</div>
      ))}
      {overflow && (
        <>
          <button
            ref={moreRef}
            type="button"
            onMouseEnter={openNow}
            onMouseLeave={closeSoon}
            onFocus={openNow}
            onBlur={closeSoon}
            aria-haspopup="menu"
            aria-expanded={open}
            className="group mb-0.5 flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-ink-soft transition hover:bg-panel-2 hover:text-ink"
          >
            <span className="flex h-5 w-5 shrink-0 items-center justify-center text-ink-faint">
              <MoreHorizontal size={16} />
            </span>
            <span className="min-w-0 flex-1 text-[13px] font-medium">{moreLabel}</span>
            <span className="shrink-0 text-[11px] text-ink-faint">{tail.length} more</span>
            <ChevronRight size={15} className="shrink-0 text-ink-faint" />
          </button>
          {open && (
            <FlyoutPanel anchor={moreRef.current} onEnter={openNow} onLeave={closeSoon}>
              {tail.map((r) => (
                <div key={r.key}>{r.node}</div>
              ))}
            </FlyoutPanel>
          )}
        </>
      )}
    </>
  )
}
