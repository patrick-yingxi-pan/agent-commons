import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

/** A bubble that appears after a short hover delay — for icon-only controls whose
 *  purpose isn't obvious at a glance (e.g. the connect/disconnect plug). Rendered
 *  in a body portal with fixed positioning so it can't be clipped by an ancestor's
 *  `overflow-hidden` (the rounded list crops the top row's upward bubble). */
export function Tooltip({
  label,
  children,
  delay = 400,
}: {
  label: string
  children: ReactNode
  delay?: number
}) {
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null)
  const ref = useRef<HTMLSpanElement>(null)
  const timer = useRef<number | undefined>(undefined)

  /** Two triggers share one timer slot, so this MUST clear before it sets.
   *
   *  Hover and focus both open, and a click fires both: `mouseenter` starts one
   *  timer, `mousedown`'s focus starts another over the top of the handle, and
   *  `cancel` can then only clear the second. The first survives its own
   *  cancellation and fires afterwards — a bubble that appears with the pointer
   *  somewhere else entirely and stays until the button loses focus, which for a
   *  control you clicked and walked away from is indefinitely.
   *
   *  Latent in every `<Tooltip>` in the app (any hover-then-click within the
   *  delay reaches it) and invisible until 2026-08-12, because it needs a
   *  tooltipped control that OUTLIVES its own click — the per-post unfold-all
   *  used to unmount as it was pressed, taking the stuck bubble with it. Found
   *  by an unrelated assertion two acts later reading the wrong tooltip. */
  const openSoon = () => {
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => {
      const el = ref.current
      if (!el) return
      const r = el.getBoundingClientRect()
      setPos({ x: r.left + r.width / 2, y: r.top })
    }, delay)
  }
  const cancel = () => {
    window.clearTimeout(timer.current)
    setPos(null)
  }
  useEffect(() => () => window.clearTimeout(timer.current), [])

  return (
    <span
      ref={ref}
      className="relative inline-flex"
      onMouseEnter={openSoon}
      onMouseLeave={cancel}
      onFocus={openSoon}
      onBlur={cancel}
    >
      {children}
      {pos &&
        createPortal(
          <span
            role="tooltip"
            style={{ left: pos.x, top: pos.y }}
            className="pointer-events-none fixed z-50 -translate-x-1/2 -translate-y-[calc(100%_+_6px)] whitespace-nowrap rounded-md bg-ink px-2 py-1 text-[11px] font-medium text-canvas shadow-md"
          >
            {label}
            <span className="absolute left-1/2 top-full h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rotate-45 bg-ink" />
          </span>,
          document.body,
        )}
    </span>
  )
}
