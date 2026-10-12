import { lazy, Suspense, type ComponentProps } from 'react'
import { DeferredLoadBoundary } from './DeferredLoadBoundary.tsx'
import { InlineOperationStatus } from './InlineOperationStatus.tsx'
import { Spinner } from './Spinner.tsx'
import type { ChangesPanel } from './ChangesPanel.tsx'

const Panel = lazy(() => import('./ChangesPanel.tsx').then((module) => ({ default: module.ChangesPanel })))
type Props = ComponentProps<typeof ChangesPanel>

export function DeferredChangesPanel(props: Props) {
  return <DeferredLoadBoundary fallback={<section aria-label="Changes" data-changes-load="failed"><InlineOperationStatus tone="alert" message="Couldn’t load Changes. Reloading clears unsent form text and in-memory recovery; copy any draft and check the Changes ledger first." action={{ label: 'Reload app', onClick: () => window.location.reload() }} /></section>}><Suspense fallback={<p role="status" data-changes-load="loading" className="flex items-center gap-2 text-[12px] text-ink-faint"><Spinner size={13} /> Loading Changes…</p>}><Panel {...props} /></Suspense></DeferredLoadBoundary>
}
