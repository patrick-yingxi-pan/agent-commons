import { Component, lazy, Suspense, type ComponentProps } from 'react'
import { MessageSquare } from 'lucide-react'
import type { SessionDiscussionContextPanel } from './SessionDiscussionContextPanel'
import { PanelShell } from './PanelShell'
import { InlineOperationStatus } from './InlineOperationStatus'

const Panel = lazy(() => import('./SessionDiscussionContextPanel').then((module) => ({ default: module.SessionDiscussionContextPanel })))
type Props = ComponentProps<typeof SessionDiscussionContextPanel>
const noop = () => {}

/** Admit preview and commands together. Chunk failure cannot break the shell
 * or expose an action whose recovery controller has not loaded. */
export class DeferredDiscussionContextPanel extends Component<Props, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  fallback(failed: boolean) {
    return <PanelShell title={this.props.attachment.label} icon={<MessageSquare size={15} />} onClose={this.props.onClose ?? noop}>
      <div className="px-3 py-4" data-discussion-panel-load={failed ? 'error' : 'loading'}>
        <InlineOperationStatus tone={failed ? 'alert' : 'status'}
          message={failed ? 'Couldn’t load this discussion copy. Saved context is unchanged. Copy any unsent text before reloading.' : 'Loading saved discussion copy…'}
          action={failed ? { label: 'Reload preview', onClick: () => window.location.reload() } : undefined} />
      </div>
    </PanelShell>
  }
  render() {
    if (this.state.failed) return this.fallback(true)
    return <Suspense fallback={this.fallback(false)}><Panel {...this.props} /></Suspense>
  }
}
