import { lazy, Suspense } from 'react'
import type { NavLocation } from '../lib/nav.ts'
import { DeferredLoadBoundary } from './DeferredLoadBoundary.tsx'
import { InlineOperationStatus } from './InlineOperationStatus.tsx'

export { AgentRequestsSummary } from './AgentRequestsSummary.tsx'
const Page = lazy(() => import('./AgentRequestsPageRuntime.tsx').then(module => ({ default: module.AgentRequestsPage })))

export function AgentRequestsPage(props: { requestId?: string | null; onOpenRequest: (id: string) => void; onBack: () => void; backTo: NavLocation | null }) {
  return <DeferredLoadBoundary fallback={<InlineOperationStatus tone="alert" message="Couldn’t load request controls. Reloading clears unsent form text; check saved status before making a new decision." action={{ label: 'Reload app', onClick: () => window.location.reload() }} />}>
    <Suspense fallback={<p role="status" className="p-4 text-[13px] text-ink-soft">Loading request controls…</p>}><Page {...props} /></Suspense>
  </DeferredLoadBoundary>
}
