import { lazy, Suspense, type ComponentProps } from 'react'
import { Spinner } from './Spinner.tsx'
import { InlineOperationStatus } from './InlineOperationStatus.tsx'
import { DeferredLoadBoundary } from './DeferredLoadBoundary.tsx'
import type { ProjectWorkDraftPanel } from './ProjectWorkDraftPanel.tsx'

const Panel = lazy(() => import('./ProjectWorkDraftPanel.tsx').then((module) => ({ default: module.ProjectWorkDraftPanel })))
type Props = ComponentProps<typeof ProjectWorkDraftPanel>

export function DeferredProjectWorkDraftPanel(props: Props) {
  return <DeferredLoadBoundary fallback={<section aria-label="Draft response controls" data-project-work-draft-load="failed"><InlineOperationStatus tone="alert" message="Couldn’t load response draft controls. Reloading clears unsent form text and in-memory recovery; copy any draft and check Dispatch history first." action={{ label: 'Reload app', onClick: () => window.location.reload() }} /></section>}><Suspense fallback={<p role="status" data-project-work-draft-load="loading" className="flex items-center gap-2 text-[12px] text-ink-faint"><Spinner size={13} /> Loading response draft…</p>}><Panel {...props} /></Suspense></DeferredLoadBoundary>
}
