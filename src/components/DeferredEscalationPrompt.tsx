import { Component, lazy, Suspense, type ComponentProps } from 'react'
import type { EscalationPrompt } from './EscalationPrompt.tsx'
import { InlineOperationStatus } from './InlineOperationStatus.tsx'

const Prompt = lazy(() =>
  import('./EscalationPrompt.tsx').then((module) => ({ default: module.EscalationPrompt })),
)
type Props = ComponentProps<typeof EscalationPrompt>

function ApprovalLoading() {
  return (
    <div data-escalation-loading>
      <InlineOperationStatus tone="status" message="Loading approval…" />
    </div>
  )
}

export class DeferredEscalationPrompt extends Component<Props, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  render() {
    if (this.state.failed) {
      return (
        <div data-escalation-load-error>
          <InlineOperationStatus
            tone="alert"
            message="Couldn’t load approval controls. Reload to review the latest state. Copy any unsent text before reloading."
            action={{ label: 'Reload to review', onClick: () => window.location.reload() }}
          />
        </div>
      )
    }
    return (
      <Suspense fallback={<ApprovalLoading />}>
        <Prompt {...this.props} />
      </Suspense>
    )
  }
}
