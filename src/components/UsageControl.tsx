import { lazy, Suspense, useState } from 'react'
import { invalidate, keys, useUsage } from '../api'
import { useDismissable } from '../lib/useDismissable'
import { POPOVER_SURFACE } from '../lib/popover'
import { usePopoverShift } from '../lib/usePopoverShift'
import type { UsageModelRef, UsageSnapshot } from '../../contract/usage.ts'
import { estimatedContextTokens, usagePresentation } from '../lib/usagePresentation.ts'
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

function UsageReadState({ failed, onRetry }: { failed: boolean; onRetry: () => void }) {
  const popRef = usePopoverShift(true)
  return (
    <div ref={popRef} role="dialog" aria-label="Usage details" className={`absolute bottom-full right-0 z-20 mb-2 w-[340px] p-3 ${POPOVER_SURFACE}`}>
      <p role={failed ? 'alert' : 'status'} className="text-[12px] text-ink-soft">
        {failed ? 'Couldn’t load usage. Your unsent message is safe.' : 'Loading usage…'}
      </p>
      {failed && <button type="button" onClick={onRetry} className="mt-2 rounded-md px-2 py-1 text-[12px] text-ink hover:bg-panel-2">Retry usage</button>}
    </div>
  )
}

/* Context-estimate fill colors. The hue signals proximity to catalog capacity:
   calm blue with
   headroom, gold as it fills, red when nearly exhausted.
   Thresholds: <50% blue · 50–80% gold · >80% red. */
const WATER = { blue: '#4f86cf', gold: '#d99a2b', red: '#d2452c' }
function waterColor(pct: number): string {
  if (pct > 80) return WATER.red
  if (pct >= 50) return WATER.gold
  return WATER.blue
}

/** A context-only estimate indicator. Local account limits and provider-quota
 * availability are disclosed separately; they never masquerade as model rings. */
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
  const [expanded, setExpanded] = useState(false)
  const wrapRef = useDismissable<HTMLDivElement>(open, () => setOpen(false))
  const query = useUsage(sessionId)
  const view = usagePresentation(query, messageTokens, model)
  const { usage, title } = view

  return (
    <div ref={wrapRef} className="relative" data-usage-read={view.phase}>
      <button
        onClick={() => {
          // Refresh elapsed local windows on explicit inspection, never by
          // polling a provider or replaying model work. Pending reads are reused.
          if (!open && query.status === 'success') invalidate(keys.usage(sessionId))
          setOpen((o) => !o)
        }}
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

      {open && !usage && <UsageReadState failed={view.phase === 'error'} onRetry={() => invalidate(keys.usage(sessionId))} />}
      {open && usage && (
        <DeferredLoadBoundary fallback={<UsageDetailsFallback failed onClose={() => setOpen(false)} />}>
          <Suspense fallback={<UsageDetailsFallback failed={false} onClose={() => setOpen(false)} />}>
            <UsageDetails usage={usage} expanded={expanded} updating={view.updating} onToggleExpanded={() => setExpanded((current) => !current)} />
          </Suspense>
        </DeferredLoadBoundary>
      )}
    </div>
  )
}

/** No reading is dashed, not an empty numeric reading. */
function UsageGauge({ usage }: { usage?: UsageSnapshot }) {
  const context = usage?.context
  const known = context?.windowTokens !== undefined
  const pct = context && context.windowTokens !== undefined
    ? Math.max(0, Math.min(100, estimatedContextTokens(context) / context.windowTokens * 100)) : 0
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="9" fill="none" strokeWidth="2" className="stroke-ink-faint" strokeDasharray={known ? undefined : '2 3'} />
      {known && pct > 0 && <circle cx="12" cy="12" r="9" fill="none" strokeWidth="3" pathLength="100" strokeDasharray={`${pct} 100`} stroke={waterColor(pct)} transform="rotate(-90 12 12)" />}
      <path d="M12 10v7M12 7v.1" fill="none" strokeWidth="1.8" strokeLinecap="round" className="stroke-ink-soft" />
    </svg>
  )
}
