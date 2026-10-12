import { lazy, Suspense } from 'react'
import { DeferredLoadBoundary } from './DeferredLoadBoundary.tsx'
import { InlineOperationStatus } from './InlineOperationStatus.tsx'

const Panel = lazy(() => import('./CommissionMcpApprovalPanel.tsx').then(module => ({ default: module.CommissionMcpApprovalPanel })))

export function DeferredCommissionMcpApprovalPanel(props: { commissionId: string; agentLabel: string }) {
  return <DeferredLoadBoundary fallback={<InlineOperationStatus tone="alert" message="Couldn’t load unattended approval controls. Reloading clears unsent form text and in-memory recovery; check saved permission before a new decision." action={{ label: 'Reload app', onClick: () => window.location.reload() }} />}><Suspense fallback={<p role="status" className="mt-3 text-[12px] text-ink-soft">Loading unattended approval controls…</p>}><Panel {...props} /></Suspense></DeferredLoadBoundary>
}
