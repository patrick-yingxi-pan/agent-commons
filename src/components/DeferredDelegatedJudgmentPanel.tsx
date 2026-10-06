import { Component, lazy, Suspense, type ComponentProps } from 'react'
import type { DelegatedJudgmentPanel } from './DelegatedJudgmentPanel.tsx'
import { prepareDelegatedJudgmentRuntime } from '../controller/delegatedJudgmentMutations.ts'
import { InlineOperationStatus } from './InlineOperationStatus.tsx'

async function loadJudgmentPanel() {
  const [panel] = await Promise.all([
    import('./DelegatedJudgmentPanel.tsx'),
    prepareDelegatedJudgmentRuntime(),
  ])
  return { default: panel.DelegatedJudgmentPanel }
}

const Panel = lazy(loadJudgmentPanel)
type Props = ComponentProps<typeof DelegatedJudgmentPanel>

export class DeferredDelegatedJudgmentPanel extends Component<Props, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  render() {
    if (this.state.failed) {
      return (
        <section aria-label="Delegated judgments" data-delegated-judgment-load="error">
          <InlineOperationStatus
            tone="alert"
            message="Couldn’t load delegated judgment history or controls. Loading this panel never sends a request; any earlier held attempt remains in workspace recovery. Reloading clears this unsent selection, so check current run history before starting anything else."
            action={{ label: 'Reload app', onClick: () => window.location.reload() }}
          />
        </section>
      )
    }
    return (
      <Suspense fallback={(
        <section aria-label="Delegated judgments" data-delegated-judgment-load="loading">
          <InlineOperationStatus tone="status" message="Loading delegated judgment history and controls…" />
        </section>
      )}>
        <Panel {...this.props} />
      </Suspense>
    )
  }
}
