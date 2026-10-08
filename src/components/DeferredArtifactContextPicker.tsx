import { Component, lazy, Suspense, type ComponentProps } from 'react'
import type { ArtifactContextPicker } from './ArtifactContextPicker.tsx'
import { InlineOperationStatus } from './InlineOperationStatus.tsx'

const Picker = lazy(() => import('./ArtifactContextPicker.tsx').then((module) => ({ default: module.ArtifactContextPicker })))
type Props = ComponentProps<typeof ArtifactContextPicker>

/** Keep the artifact-only module out of the common add-context path until
 *  the user chooses Artifact; a failed optional chunk grants no context. */
export class DeferredArtifactContextPicker extends Component<Props, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  render() {
    if (this.state.failed) {
      return <InlineOperationStatus tone="alert" message="Couldn’t load artifact options. Nothing was added." action={{ label: 'Done', onClick: this.props.onClose }} secondaryAction={{ label: 'Reload app', onClick: () => window.location.reload() }} />
    }
    return (
      <Suspense fallback={<InlineOperationStatus tone="status" message="Loading artifact options…" action={{ label: 'Done', onClick: this.props.onClose }} />}>
        <Picker {...this.props} />
      </Suspense>
    )
  }
}
