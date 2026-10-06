import { Component, lazy, Suspense, type ComponentProps } from 'react'
import type { ContributionReviewPanel } from './ContributionReviewPanel.tsx'
import { InlineOperationStatus } from './InlineOperationStatus.tsx'
import { prepareContributionReviewRuntime } from '../controller/contributionReviewMutations.ts'

async function loadReviewPanel() {
  const [panel] = await Promise.all([
    import('./ContributionReviewPanel.tsx'),
    prepareContributionReviewRuntime(),
  ])
  return { default: panel.ContributionReviewPanel }
}

const Panel = lazy(loadReviewPanel)
type Props = ComponentProps<typeof ContributionReviewPanel>

export class DeferredContributionReviewPanel extends Component<Props, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  render() {
    if (this.state.failed) {
      return (
        <div data-contribution-review-load="error">
          <InlineOperationStatus
            tone="alert"
            message="Couldn’t load model review history or controls. Existing review state is unchanged. Copy any unsent text before reloading."
            action={{ label: 'Reload app', onClick: () => window.location.reload() }}
          />
        </div>
      )
    }
    return (
      <Suspense fallback={(
        <div data-contribution-review-load="loading">
          <InlineOperationStatus tone="status" message="Loading model review history and controls…" />
        </div>
      )}>
        <Panel {...this.props} />
      </Suspense>
    )
  }
}
