import { useState, type ReactNode } from 'react'
import { useDismissable } from '../lib/useDismissable'

/** ── The ambient-gauge popover shell ─────────────────────────────────────────
 *  The composer-footer "account fabric" gauges — Hosts and Model providers — are the
 *  same control: a compact `icon + count` button that toggles a small,
 *  bottom-anchored popover. This is that one styled primitive, so the parallel gauges
 *  can't drift (form follows function — same role ⇒ same look, like lib/foldHeader +
 *  AddTrigger). Each gauge supplies only its icon, count, title, and popover body;
 *  the button chrome, the popover container, and the dismiss-on-outside-click + Escape
 *  behaviour (via the shared `useDismissable` hook) live here once.
 *
 *  Locked by tests/gaugePopover.test.ts, which fails if Hosts/Providers re-hardcode
 *  the gauge button or popover shell instead of going through this component. */
export function GaugePopover({
  icon,
  count,
  title,
  children,
}: {
  /** The gauge's lucide icon (already sized/coloured by the caller). */
  icon: ReactNode
  /** The number shown beside the icon (online hosts, registered providers, …). */
  count: number
  /** The button's accessible name + tooltip (e.g. "Hosts — 1 connected"). */
  title: string
  /** The popover body — the gauge's own header, rows, and footer caption. */
  children: ReactNode
}) {
  const [open, setOpen] = useState(false)
  const wrapRef = useDismissable<HTMLDivElement>(open, () => setOpen(false))

  return (
    <div ref={wrapRef} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        title={title}
        aria-label={title}
        aria-haspopup="dialog"
        aria-expanded={open}
        className={`flex h-7 items-center gap-1 rounded-lg px-1.5 transition ${
          open ? 'bg-panel-2' : 'hover:bg-panel-2'
        }`}
      >
        {icon}
        <span className="text-[12px] tabular-nums text-ink-faint">{count}</span>
      </button>

      {open && (
        <div className="absolute bottom-full right-0 z-20 mb-2 w-[300px] rounded-xl border border-line-strong bg-surface p-3 shadow-xl">
          {children}
        </div>
      )}
    </div>
  )
}
