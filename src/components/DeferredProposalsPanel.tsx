import { lazy, Suspense, type ComponentProps } from 'react'
import type { ProposalsPanel } from './ProposalsPanel.tsx'
import { DeferredLoadBoundary } from './DeferredLoadBoundary.tsx'
import { InlineOperationStatus } from './InlineOperationStatus.tsx'

const Panel = lazy(() => import('./ProposalsPanel.tsx').then(module => ({ default: module.ProposalsPanel })))
type Props = ComponentProps<typeof ProposalsPanel>

function LoadState({ Section, failed = false }: Pick<Props, 'Section'> & { failed?: boolean }) {
  return <Section title="Improvements" summary={failed ? 'Couldn’t load improvements' : 'Loading improvements…'} heldOpen>
    <div data-proposals-load={failed ? 'error' : 'loading'}>
      <InlineOperationStatus tone={failed ? 'alert' : 'status'}
        message={failed ? 'Couldn’t load improvements. No change was offered or decision made. Copy unsent workspace text before reloading, then review saved history.' : 'Loading improvements…'}
        action={failed ? { label: 'Reload improvements', onClick: () => window.location.reload() } : undefined} />
    </div>
  </Section>
}

/** Keep proposal authoring and verdicts behind their resource-owned surface.
 * The existing page section remains visible when its optional module fails. */
export function DeferredProposalsPanel(props: Props) {
  return <DeferredLoadBoundary fallback={<LoadState Section={props.Section} failed />}>
    <Suspense fallback={<LoadState Section={props.Section} />}><Panel {...props} /></Suspense>
  </DeferredLoadBoundary>
}
