import { lazy, Suspense } from 'react'
import { DeferredLoadBoundary } from './DeferredLoadBoundary.tsx'
import { InlineOperationStatus } from './InlineOperationStatus.tsx'

const Summary = lazy(() => import('./AgentRequestsSummaryRuntime.tsx').then(module => ({ default: module.AgentRequestsSummary })))

/** Keep history out of the navigation chunk and decision controls out of history. */
export function AgentRequestsSummary(props: { onOpenRequest: (id: string) => void }) {
  return <DeferredLoadBoundary fallback={<InlineOperationStatus tone="alert" message="Couldn’t load request history. Copy unsent workspace text before reloading." action={{ label: 'Reload app', onClick: () => window.location.reload() }} />}>
    <Suspense fallback={<p role="status" className="text-[13px] text-ink-soft">Loading requests…</p>}><Summary {...props} /></Suspense>
  </DeferredLoadBoundary>
}
