import { Component, lazy, Suspense, type ComponentProps } from 'react'
import type { DiscussionContextPicker } from './DiscussionContextPicker.tsx'
import { InlineOperationStatus } from './InlineOperationStatus.tsx'

const Picker = lazy(() => import('./DiscussionContextPicker.tsx').then((module) => ({ default: module.DiscussionContextPicker })))
type Props = ComponentProps<typeof DiscussionContextPicker>

/** Keep the discussion-only module out of the common add-context path until
 *  the user chooses Discussion; a failed optional chunk grants no context. */
export class DeferredDiscussionContextPicker extends Component<Props, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  render() {
    if (this.state.failed) {
      return <InlineOperationStatus tone="alert" message="Couldn’t load discussion options. Nothing was added." action={{ label: 'Done', onClick: this.props.onClose }} secondaryAction={{ label: 'Reload app', onClick: () => window.location.reload() }} />
    }
    return (
      <Suspense fallback={<InlineOperationStatus tone="status" message="Loading discussion options…" action={{ label: 'Done', onClick: this.props.onClose }} />}>
        <Picker {...this.props} />
      </Suspense>
    )
  }
}
