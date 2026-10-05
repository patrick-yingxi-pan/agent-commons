import { Component, lazy, Suspense, type ComponentProps } from 'react'
import type { RepoPicker } from './RepoContextPicker.tsx'
import { InlineOperationStatus } from './InlineOperationStatus.tsx'

const Picker = lazy(() => import('./RepoContextPicker.tsx').then(module => ({ default: module.RepoPicker })))
type Props = ComponentProps<typeof RepoPicker>

/** Repository-specific browsing and prompts cost nothing before selection.
 * A failed optional module grants no context and keeps an explicit exit. */
export class DeferredRepoContextPicker extends Component<Props, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  notice(failed: boolean) {
    return <div data-context-repo-load={failed ? 'error' : 'loading'}>
      <InlineOperationStatus tone={failed ? 'alert' : 'status'}
        message={failed ? 'Couldn’t load repository options. Copy unsent text before reloading.' : 'Loading repository options…'}
        action={{ label: 'Done', onClick: this.props.onClose }}
        secondaryAction={failed ? { label: 'Reload app', onClick: () => window.location.reload() } : undefined} />
    </div>
  }
  render() {
    return this.state.failed ? this.notice(true) : <Suspense fallback={this.notice(false)}><Picker {...this.props} /></Suspense>
  }
}
