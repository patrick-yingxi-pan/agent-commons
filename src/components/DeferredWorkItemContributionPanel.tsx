import { lazy, Suspense, type ComponentProps } from 'react'
import { DeferredLoadBoundary } from './DeferredLoadBoundary.tsx'
import { InlineOperationStatus } from './InlineOperationStatus.tsx'
import { Spinner } from './Spinner.tsx'
import type { WorkItemContributionPanel } from './WorkItemContributionPanel.tsx'

const Panel = lazy(() => import('./WorkItemContributionPanel.tsx').then((module) => ({ default: module.WorkItemContributionPanel })))
type Props = ComponentProps<typeof WorkItemContributionPanel>

export function DeferredWorkItemContributionPanel(props: Props) {
  return (
    <DeferredLoadBoundary fallback={
      <section aria-label="Contributions" data-work-item-contribution-load="failed" className="mt-4 rounded-lg border border-line bg-surface p-4">
        <InlineOperationStatus
          tone="alert"
          message="Couldn’t load linked Contributions. Reloading clears unsent form text and in-memory recovery; copy any draft and check the Changes ledger first."
          action={{ label: 'Reload app', onClick: () => window.location.reload() }}
        />
      </section>
    }>
      <Suspense fallback={
        <section aria-label="Contributions" data-work-item-contribution-load="loading" className="mt-4 rounded-lg border border-line bg-surface p-4">
          <p role="status" className="flex items-center gap-2 text-[12px] text-ink-faint"><Spinner size={13} /> Loading linked Contributions…</p>
        </section>
      }>
        <Panel {...props} />
      </Suspense>
    </DeferredLoadBoundary>
  )
}
