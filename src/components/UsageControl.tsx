import { useEffect, useRef, useState } from 'react'
import { ArrowRight, ChevronRight } from 'lucide-react'

const USAGE = {
  context: { used: '352.0k', total: '1.0M', pct: 35 },
  limits: [
    { label: '5-hour limit', reset: 'Resets 6:39 PM', pct: 71 },
    { label: 'Weekly · all models', reset: 'Resets Jun 20', pct: 24 },
    { label: 'Sonnet only', reset: '', pct: 0 },
  ],
}

/** Usage button: a progress ring (the 5-hour limit) that opens a usage popup. */
export function UsageControl() {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div ref={wrapRef} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        title="Usage"
        aria-label="Usage"
        aria-haspopup="dialog"
        aria-expanded={open}
        className={`flex h-7 w-7 items-center justify-center rounded-lg transition ${
          open ? 'bg-panel-2' : 'hover:bg-panel-2'
        }`}
      >
        <Ring pct={USAGE.limits[0].pct} />
      </button>

      {open && (
        <div className="absolute bottom-full right-0 z-20 mb-2 w-[300px] rounded-xl border border-line-strong bg-surface p-3 shadow-xl">
          <button className="flex w-full items-center justify-between text-left">
            <span className="text-[12px] text-ink-faint">Context window</span>
            <span className="flex items-center gap-1 text-[12px] text-ink">
              {USAGE.context.used} / {USAGE.context.total} ({USAGE.context.pct}%)
              <ChevronRight size={13} className="text-ink-faint" />
            </span>
          </button>
          <Bar pct={USAGE.context.pct} className="mt-1.5" />

          <div className="my-2.5 border-t border-line" />

          <button className="flex w-full items-center justify-between text-left">
            <span className="text-[12px] text-ink-faint">Plan usage</span>
            <ArrowRight size={13} className="text-ink-faint" />
          </button>

          <div className="mt-2.5 space-y-2.5">
            {USAGE.limits.map((l, i) => (
              <div key={i}>
                <div className="flex items-center justify-between text-[12px]">
                  <span className="text-ink">{l.label}</span>
                  <span className="flex items-center gap-2">
                    {l.reset && <span className="text-ink-faint">{l.reset}</span>}
                    <span className="text-ink">{l.pct}%</span>
                  </span>
                </div>
                <Bar pct={l.pct} className="mt-1" />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function Ring({ pct }: { pct: number }) {
  const r = 7
  const c = 2 * Math.PI * r
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" className="-rotate-90">
      <circle cx="9" cy="9" r={r} fill="none" strokeWidth="2.5" className="stroke-line-strong" />
      <circle
        cx="9"
        cy="9"
        r={r}
        fill="none"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeDasharray={c}
        strokeDashoffset={c * (1 - pct / 100)}
        className="stroke-accent"
      />
    </svg>
  )
}

function Bar({ pct, className = '' }: { pct: number; className?: string }) {
  return (
    <div className={`h-1.5 w-full overflow-hidden rounded-full bg-line ${className}`}>
      <div className="h-full rounded-full bg-accent" style={{ width: `${pct}%` }} />
    </div>
  )
}
