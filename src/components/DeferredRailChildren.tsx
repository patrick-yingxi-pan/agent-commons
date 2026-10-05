import { Component, Suspense, type ReactNode } from 'react'
import { InlineOperationStatus } from './InlineOperationStatus.tsx'
import { NoRowsRow } from './SectionTreeChildren.tsx'

export function RailChildrenState({ label, failed }: { label: string; failed: boolean }) {
  return (
    <div data-rail-children-load-error={failed || undefined} data-rail-children-loading={!failed || undefined}>
      <NoRowsRow>
        <InlineOperationStatus
          tone={failed ? 'alert' : 'status'}
          message={failed
            ? `Couldn’t load ${label} rows. No source was opened. Copy any unsent workspace text before reloading.`
            : `Loading ${label}…`}
          action={failed ? { label: `Reload ${label}`, onClick: () => window.location.reload() } : undefined}
        />
      </NoRowsRow>
    </div>
  )
}

export class DeferredRailChildrenBoundary extends Component<{ label: string; children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  render() {
    if (this.state.failed) return <RailChildrenState label={this.props.label} failed />
    return <Suspense fallback={<RailChildrenState label={this.props.label} failed={false} />}>{this.props.children}</Suspense>
  }
}
