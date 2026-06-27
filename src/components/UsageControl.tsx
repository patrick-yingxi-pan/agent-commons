import { useEffect, useId, useRef, useState } from 'react'
import { ArrowRight, ChevronRight } from 'lucide-react'
import { useUsage } from '../api'
import { withLiveMessages, type ContextSegment, type ContextTone, type UsageSnapshot } from '../../contract/index.ts'

/* Shown until the server's usage snapshot loads — a zeroed gauge rather than a
   flash of a missing icon. The real figures arrive from `GET /v1/usage`, after
   which the UI just caches them. */
const EMPTY_USAGE: UsageSnapshot = {
  context: { used: '—', total: '—', pct: 0, segments: [] },
  limits: [],
}

/* The context-breakdown swatch palette — Messages darkest, the config categories
   in descending blues, the deferred/free in greys. Matches the desktop app's
   stacked context bar. */
const TONE: Record<ContextTone, string> = {
  messages: '#2f6fed',
  skills: '#4f86cf',
  memory: '#5e97da',
  systemTools: '#79a8e6',
  systemPrompt: '#9cc1f0',
  agents: '#bcd7f7',
  mcp: '#cfd0d6',
  free: '#ececed',
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
 *  opens a usage popup with the per-window detail.
 *
 *  The plan rings (5-hour, weekly) are the server's real meter, keyed to the open
 *  session. The context disc + breakdown reflect the *live* open thread: when the
 *  composer passes `messageTokens` (the size of the messages currently loaded),
 *  the breakdown is recomputed immediately — so the Messages row + the disc fill
 *  as you chat — overriding the server's persisted-only figure. */
export function UsageControl({ sessionId, messageTokens }: { sessionId?: string; messageTokens?: number }) {
  const [open, setOpen] = useState(false)
  const [expanded, setExpanded] = useState(true)
  const wrapRef = useRef<HTMLDivElement>(null)
  // Server-owned: the UI just caches the snapshot. EMPTY_USAGE covers the first
  // paint before the fetch resolves. The live breakdown overrides the snapshot's.
  const snapshot = useUsage(sessionId).data ?? EMPTY_USAGE
  // The server owns the real category sizes (system tools, system prompt, …); the
  // composer overlays the live Messages count so the breakdown tracks the open
  // thread without re-sending those server-owned figures.
  const usage: UsageSnapshot =
    messageTokens === undefined ? snapshot : { ...snapshot, context: withLiveMessages(snapshot.context, messageTokens) }

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
    `Usage — context ${usage.context.pct}%, ` +
    `5-hour ${usage.limits[0]?.pct ?? 0}%, weekly ${usage.limits[1]?.pct ?? 0}%`

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
        <UsageGauge usage={usage} />
      </button>

      {open && (
        <div className="absolute bottom-full right-0 z-20 mb-2 w-[340px] rounded-xl border border-line-strong bg-surface p-3 shadow-xl">
          {/* Context window — a stacked breakdown of what's occupying it, toggled
              open by the chevron. Messages is live; the rest is workspace config. */}
          <button
            onClick={() => setExpanded((e) => !e)}
            aria-expanded={expanded}
            className="flex w-full items-center justify-between text-left"
          >
            <span className="text-[13px] font-medium text-ink">Context window</span>
            <span className="flex items-center gap-1 text-[12px] text-ink-soft">
              {usage.context.used} / {usage.context.total} ({usage.context.pct}%)
              <ChevronRight size={13} className={`text-ink-faint transition-transform ${expanded ? 'rotate-90' : ''}`} />
            </span>
          </button>
          <StackedBar segments={usage.context.segments} className="mt-1.5" />

          {expanded && usage.context.segments.length > 0 && (
            <div className="mt-2.5 space-y-1.5">
              {usage.context.segments.map((s) => (
                <SegmentRow key={s.id} seg={s} />
              ))}
            </div>
          )}

          <div className="my-2.5 border-t border-line" />

          <button className="flex w-full items-center justify-between text-left">
            <span className="text-[12px] text-ink-faint">Plan usage</span>
            <ArrowRight size={13} className="text-ink-faint" />
          </button>

          <div className="mt-2.5 space-y-2.5">
            {usage.limits.map((l, i) => (
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
            <UsageGauge usage={usage} />
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
function UsageGauge({ usage }: { usage: UsageSnapshot }) {
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
    { key: 'weekly', r: 9.5, w: 3.4, track: 'stroke-line-strong', pct: usage.limits[1]?.pct ?? 0 },
    { key: 'fivehour', r: 6.15, w: 3.3, track: 'stroke-line', pct: usage.limits[0]?.pct ?? 0 },
  ]

  // The context window stays a water-level disc, filled from the bottom. Its
  // grey track is the inner "strong" stripe of the alternating pattern.
  const discR = 4.5
  const ctxPct = usage.context.pct
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

/** The context window's stacked composition bar — one abutting block per loaded
 *  category (Messages + config), trailing into Free space. Deferred categories
 *  aren't counted against the window, so they're left out of the bar. */
function StackedBar({ segments, className = '' }: { segments: ContextSegment[]; className?: string }) {
  const bars = segments.filter((s) => !s.deferred)
  return (
    <div className={`flex h-2 w-full overflow-hidden rounded-full bg-line ${className}`}>
      {bars.map((s) => (
        <div key={s.id} style={{ width: `${s.pct ?? 0}%`, background: TONE[s.tone] }} title={`${s.label} · ${s.tokens}`} />
      ))}
    </div>
  )
}

/** One breakdown row: a swatch, the category (with its item count, if a
 *  collection), the token size, and the percent — or '—' for a deferred row,
 *  which lists its item count there instead. */
function SegmentRow({ seg }: { seg: ContextSegment }) {
  const muted = seg.deferred || seg.tone === 'free'
  return (
    <div className="flex items-center gap-2 text-[12px]">
      <span
        className="h-2.5 w-2.5 shrink-0 rounded-[3px]"
        style={{ background: TONE[seg.tone], opacity: seg.deferred ? 0.5 : 1 }}
      />
      <span className={`min-w-0 flex-1 truncate ${muted ? 'text-ink-faint' : 'text-ink'}`}>
        {seg.label}
        {seg.count !== undefined && !seg.deferred && <span className="text-ink-faint"> · {seg.count}</span>}
      </span>
      <span className="shrink-0 tabular-nums text-ink-faint">{seg.tokens}</span>
      <span className="w-12 shrink-0 text-right tabular-nums text-ink-soft">
        {seg.pct === undefined ? (seg.count !== undefined ? seg.count : '—') : `${seg.pct}%`}
      </span>
    </div>
  )
}
