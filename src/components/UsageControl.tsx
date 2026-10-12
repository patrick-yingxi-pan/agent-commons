import { lazy, Suspense, useId, useState } from 'react'
import { useUsage } from '../api'
import { useDismissable } from '../lib/useDismissable'
import { POPOVER_SURFACE } from '../lib/popover'
import { usePopoverShift } from '../lib/usePopoverShift'
import { withLiveMessages, type UsageModelRef, type UsageSnapshot } from '../../contract/usage.ts'
import { DeferredLoadBoundary } from './DeferredLoadBoundary.tsx'

const UsageDetails = lazy(() => import('./UsageDetails').then((module) => ({ default: module.UsageDetails })))

function UsageDetailsFallback({ failed, onClose }: { failed: boolean; onClose: () => void }) {
  const popRef = usePopoverShift(true)
  return (
    <div ref={popRef} role="dialog" aria-label="Usage details" data-usage-details-load={failed ? 'error' : 'loading'} className={`absolute bottom-full right-0 z-20 mb-2 w-[340px] p-3 ${POPOVER_SURFACE}`}>
      <div role={failed ? 'alert' : 'status'} className="text-[11px] text-ink-soft">
      {failed ? (
        <>
          <p>Couldn’t display usage details. Copy unsent text before reloading.</p>
          <div className="mt-2 flex justify-end gap-2">
            <button type="button" className="rounded-md px-2 py-1 text-ink hover:bg-panel-2" onClick={onClose}>Close</button>
            <button type="button" className="rounded-md px-2 py-1 text-ink hover:bg-panel-2" onClick={() => window.location.reload()}>Reload usage details</button>
          </div>
        </>
      ) : <span>Loading usage details…</span>}
      </div>
    </div>
  )
}
/* Shown until the server's usage snapshot loads — a zeroed gauge rather than a
   flash of a missing icon. The real figures arrive from `GET /v1/usage`, after
   which the UI just caches them. */
const EMPTY_USAGE: UsageSnapshot = {
  context: { used: '—', total: '—', pct: 0, segments: [] },
  limits: [],
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
 *  The limit rings (5-hour, weekly) are the server's local per-tenant meter.
 *  The context disc + breakdown estimate the *live* open thread: when the
 *  composer passes `messageTokens` (the estimated conversation text size),
 *  the breakdown is recomputed immediately — so the Messages row + the disc fill
 *  as you chat — overriding the server's persisted-only figure.
 *
 *  The context capacity is PROVIDER-SOURCED: the snapshot's `windowTokens` comes
 *  from the session's resolved provider+model catalog, and may be absent — a
 *  provider that doesn't expose its window (a Session provider, an OpenAI-class
 *  list) renders the honest **unknown-capacity** state (raw tokens, no percent,
 *  hollow disc) instead of a fabricated 100%-scale. `model` is the draft's
 *  overlay: before a server row exists, the composer resolves the picked model
 *  against the live registry and passes its identity + window here. */
export function UsageControl({
  sessionId,
  messageTokens,
  model,
}: {
  sessionId?: string
  messageTokens?: number
  model?: UsageModelRef & { windowTokens?: number }
}) {
  const [open, setOpen] = useState(false)
  const [expanded, setExpanded] = useState(true)
  const wrapRef = useDismissable<HTMLDivElement>(open, () => setOpen(false))
  // Server-owned: the UI just caches the snapshot. EMPTY_USAGE covers the first
  // paint before the fetch resolves. The live breakdown overrides the snapshot's.
  const snapshot = useUsage(sessionId).data ?? EMPTY_USAGE
  // The server owns the base-tool/prompt estimates; the
  // composer overlays the live Messages count so the breakdown tracks the open
  // thread without re-sending those server-owned figures — and, on a draft, the
  // picked model's window (the server can't know a pick that has no row yet).
  const liveTokens =
    messageTokens ?? snapshot.context.segments.find((s) => s.id === 'messages')?.rawTokens ?? 0
  const usage: UsageSnapshot =
    messageTokens === undefined && !model
      ? snapshot
      : {
          ...snapshot,
          context: withLiveMessages(snapshot.context, liveTokens, model ? { window: model.windowTokens } : undefined),
          ...(model ? { model } : {}),
        }
  const windowKnown = usage.context.windowTokens !== undefined

  const title = windowKnown
    ? `Usage — estimated context ${usage.context.pct}%, ` +
      `5-hour ${usage.limits[0]?.pct ?? 0}%, weekly ${usage.limits[1]?.pct ?? 0}%`
    : `Usage — estimated context ${usage.context.used} used (window unknown), ` +
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
        <DeferredLoadBoundary fallback={<UsageDetailsFallback failed onClose={() => setOpen(false)} />}>
          <Suspense fallback={<UsageDetailsFallback failed={false} onClose={() => setOpen(false)} />}>
            <UsageDetails usage={usage} expanded={expanded} gauge={<UsageGauge usage={usage} />} onToggleExpanded={() => setExpanded((current) => !current)} />
          </Suspense>
        </DeferredLoadBoundary>
      )}
    </div>
  )
}

/** Concentric usage gauge. The two outer rings fill clockwise like a dial
 *  (middle = 5-hour limit, outer = weekly limit); the inner solid disc is a
 *  water-level tank for the context window. Hue follows the usage threshold.
 *  An unknown context window (the provider doesn't expose it) renders the disc
 *  as a faded track — visibly "no reading", distinct from "empty". */
function UsageGauge({ usage }: { usage: UsageSnapshot }) {
  const windowKnown = usage.context.windowTokens !== undefined
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

      <g mask={`url(#${uid}-disc)`} opacity={windowKnown ? 1 : 0.35}>
        <rect x="0" y="0" width="24" height="24" className="fill-line-strong" />
        {windowKnown && f > 0 && (
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
