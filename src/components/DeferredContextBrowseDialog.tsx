import { Component, lazy, Suspense, type ComponentProps } from 'react'
import type { ContextBrowseDialog } from './ContextBrowseDialog.tsx'
import { InlineOperationStatus } from './InlineOperationStatus.tsx'

const Dialog = lazy(() => import('./ContextBrowseDialog.tsx').then((module) => ({ default: module.ContextBrowseDialog })))
type Props = ComponentProps<typeof ContextBrowseDialog>

/** The picker remains usable while its optional browser loads. Closing it
 * unmounts this boundary, so a late module cannot reopen it or attach anything. */
export class DeferredContextBrowseDialog extends Component<Props, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  render() {
    if (this.state.failed) {
      return (
        <div data-context-browse-load-error>
          <InlineOperationStatus
            tone="alert"
            message="Couldn’t load the context browser. Copy any unsent text before reloading."
            action={{ label: 'Cancel browsing', onClick: this.props.onCancel }}
            secondaryAction={{ label: 'Reload app', onClick: () => window.location.reload() }}
          />
        </div>
      )
    }
    return (
      <Suspense fallback={
        <div data-context-browse-loading>
          <InlineOperationStatus
            tone="status"
            message="Loading context browser…"
            action={{ label: 'Cancel browsing', onClick: this.props.onCancel }}
          />
        </div>
      }>
        <Dialog {...this.props} />
      </Suspense>
    )
  }
}
