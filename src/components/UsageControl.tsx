import { useEffect, useId, useRef, useState } from 'react'
import { ArrowRight, ChevronRight } from 'lucide-react'

const USAGE = {
  context: { used: '352.0k', total: '1.0M', pct: 35 },
  limits: [
    { label: '5-hour limit', reset: 'Resets 6:39 PM', pct: 71 },
    { label: 'Weekly · all models', reset: 'Resets Jun 20', pct: 24 },
    { label: 'Sonnet only', reset: '', pct: 0 },
  ],
}

/* Status fill colors, shared by the gauge arcs and the water-level disc.
   The hue signals how close a window is to its ceiling: calm blue with
   headroom, gold as it fills, red when nearly exhausted.
   Thresholds: <50% blue · 50–80% gold · >80% red. */
const WATER = { blue: '#4f86cf', gold: '#d99a2b', red: '#d2452c' }
function waterColor(pct: number): string {
  if (pct > 80) return WATER.red
  if (pct >= 50) return WATER.gold
  return WATER.blue
}

/** Usage button: a three-ring water gauge (context · 5-hour · weekly) that
 *  opens a usage popup with the per-window detail. */
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

  const title =
    `Usage — context ${USAGE.context.pct}%, ` +
    `5-hour ${USAGE.limits[0].pct}%, weekly ${USAGE.limits[1].pct}%`

  return (
    <div ref={wrapRef} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        title={title}
        aria-label={title}
        aria-haspopup="dialog"
        aria-expanded={open}
        className={`flex h-7 w-7 items-center justify-center rounded-lg transition ${
          open ? 'bg-panel-2' : 'hover:bg-panel-2'
        }`}
      >
        <UsageGauge />
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

          {/* Key: connect the cryptic gauge back to the windows it stacks. */}
          <div className="mt-3 flex items-center gap-2 border-t border-line pt-2.5">
            <UsageGauge />
            <span className="text-[11px] leading-tight text-ink-faint">
              inner = context · middle = 5-hour · outer = weekly
            </span>
          </div>
        </div>
      )}
    </div>
  )
}

/** Concentric usage gauge. The two outer rings fill clockwise like a dial
 *  (middle = 5-hour limit, outer = weekly limit); the inner solid disc is a
 *  water-level tank for the context window. Hue follows the usage threshold. */
function UsageGauge() {
  const uid = useId().replace(/:/g, '')
  const cx = 12
  const cy = 12

  // The two outer windows render as clockwise arc gauges, drawn from 12 o'clock
  // (the -90° rotation) over a full-circle track. The bands now abut with zero
  // gap so each reads as large as possible; the tracks alternate shade
  // (strong / light / strong) so the concentric rings stay legible where they're
  // unfilled and would otherwise merge into one grey block:
  //   weekly band [7.8–11.2] · 5-hour band [4.5–7.8] · disc r4.5.
  const arcs = [
    { key: 'weekly', r: 9.5, w: 3.4, track: 'stroke-line-strong', pct: USAGE.limits[1].pct },
    { key: 'fivehour', r: 6.15, w: 3.3, track: 'stroke-line', pct: USAGE.limits[0].pct },
  ]

  // The context window stays a water-level disc, filled from the bottom. Its
  // grey track is the inner "strong" stripe of the alternating pattern.
  const discR = 4.5
  const ctxPct = USAGE.context.pct
  const f = Math.max(0, Math.min(1, ctxPct / 100))
  const discBottom = cy + discR
  const surface = discBottom - 2 * discR * f

  return (
    <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true">
      <defs>
        <mask id={`${uid}-disc`} maskUnits="userSpaceOnUse" x="0" y="0" width="24" height="24">
          <circle cx={cx} cy={cy} r={discR} fill="#fff" />
        </mask>
      </defs>

      {arcs.map((a) => {
        const p = Math.max(0, Math.min(100, a.pct))
        const c = 2 * Math.PI * a.r
        return (
          <g key={a.key}>
            <circle
              cx={cx}
              cy={cy}
              r={a.r}
              fill="none"
              strokeWidth={a.w}
              className={a.track}
            />
            <circle
              cx={cx}
              cy={cy}
              r={a.r}
              fill="none"
              strokeWidth={a.w}
              strokeLinecap="round"
              strokeDasharray={c}
              strokeDashoffset={c * (1 - p / 100)}
              stroke={waterColor(p)}
              transform={`rotate(-90 ${cx} ${cy})`}
            />
          </g>
        )
      })}

      <g mask={`url(#${uid}-disc)`}>
        <rect x="0" y="0" width="24" height="24" className="fill-line-strong" />
        {f > 0 && (
          <rect
            x="0"
            y={surface}
            width="24"
            height={discBottom - surface}
            fill={waterColor(ctxPct)}
          />
        )}
      </g>
    </svg>
  )
}

function Bar({ pct, className = '' }: { pct: number; className?: string }) {
  return (
    <div className={`h-1.5 w-full overflow-hidden rounded-full bg-line ${className}`}>
      <div
        className="h-full rounded-full"
        style={{ width: `${pct}%`, background: waterColor(pct) }}
      />
    </div>
  )
}
