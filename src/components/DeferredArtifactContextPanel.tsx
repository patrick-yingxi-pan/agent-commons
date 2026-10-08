import { Component, lazy, Suspense, type ComponentProps } from 'react'
import { FileText } from 'lucide-react'
import type { SessionArtifactContextPanel } from './SessionArtifactContextPanel'
import { PanelShell } from './PanelShell'
import { InlineOperationStatus } from './InlineOperationStatus'

const Panel = lazy(() => import('./SessionArtifactContextPanel').then((module) => ({ default: module.SessionArtifactContextPanel })))
type Props = ComponentProps<typeof SessionArtifactContextPanel>
const noop = () => {}

/** Admit preview and commands together. Chunk failure cannot break the shell
 * or expose an action whose recovery controller has not loaded. */
export class DeferredArtifactContextPanel extends Component<Props, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  fallback(failed: boolean) {
    return <PanelShell title={this.props.attachment.label} icon={<FileText size={15} />} onClose={this.props.onClose ?? noop}>
      <div className="px-3 py-4" data-artifact-panel-load={failed ? 'error' : 'loading'}>
        <InlineOperationStatus tone={failed ? 'alert' : 'status'}
          message={failed ? 'Couldn’t load this Artifact copy. Saved Artifact copy is unchanged. Copy any unsent text before reloading.' : 'Loading saved Artifact copy…'}
          action={failed ? { label: 'Reload preview', onClick: () => window.location.reload() } : undefined} />
      </div>
    </PanelShell>
  }
  render() {
    if (this.state.failed) return this.fallback(true)
    return <Suspense fallback={this.fallback(false)}><Panel {...this.props} /></Suspense>
  }
}
