import { Component, lazy, Suspense, type ComponentProps } from 'react'
import type { ServedFileIntake } from './ServedFileIntake.tsx'
import { InlineOperationStatus } from './InlineOperationStatus.tsx'

const Intake = lazy(() => import('./ServedFileIntake.tsx').then((module) => ({ default: module.ServedFileIntake })))
type Props = ComponentProps<typeof ServedFileIntake> & { onClose: () => void }

/** Served catalogs and capture/parser/upload code are optional picker work. */
export class DeferredServedFileIntake extends Component<Props, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  fallback(failed: boolean) {
    return (
      <div data-served-file-intake={failed ? 'error' : 'loading'}>
        <InlineOperationStatus
          tone={failed ? 'alert' : 'status'}
          message={failed
            ? 'Couldn’t load saved-file intake. Nothing was attached. Copy any unsent text before reloading.'
            : 'Loading saved-file intake…'}
          action={{ label: failed ? 'Close picker' : 'Cancel intake', onClick: this.props.onClose }}
          secondaryAction={failed ? { label: 'Reload app', onClick: () => window.location.reload() } : undefined}
        />
      </div>
    )
  }

  render() {
    const { onClose, ...props } = this.props
    if (this.state.failed) return this.fallback(true)
    return <Suspense fallback={this.fallback(false)}><Intake {...props} /></Suspense>
  }
}
