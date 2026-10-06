import { Component, lazy, Suspense, type ComponentProps } from 'react'
import type { WorkflowBody } from './ContextPickerWorkflow.tsx'
import { InlineOperationStatus } from './InlineOperationStatus.tsx'

const Workflow = lazy(() => import('./ContextPickerWorkflow.tsx').then((module) => ({ default: module.WorkflowBody })))
type Props = ComponentProps<typeof WorkflowBody>

/** The type menu stays eager; the larger type-specific picker workflow is
 * admitted only after the user chooses a context category. */
export class DeferredContextPickerWorkflow extends Component<Props, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  render() {
    if (this.state.failed) {
      return <InlineOperationStatus tone="alert" message="Couldn’t load context options. Nothing was added. Copy unsent text and any saved Retry context before reloading." action={{ label: 'Done', onClick: this.props.onClose }} secondaryAction={{ label: 'Reload app', onClick: () => window.location.reload() }} />
    }
    return (
      <Suspense fallback={<InlineOperationStatus tone="status" message="Loading context options…" action={{ label: 'Done', onClick: this.props.onClose }} />}>
        <Workflow {...this.props} />
      </Suspense>
    )
  }
}
