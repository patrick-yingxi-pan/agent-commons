import { Component, lazy, Suspense, type ComponentProps } from 'react'
import { GitBranch, PanelsTopLeft } from 'lucide-react'
import type { WorkspacePanel } from './WorkspacePanel'
import { PanelShell } from './PanelShell'
import { InlineOperationStatus } from './InlineOperationStatus'

const Panel = lazy(() => import('./WorkspacePanel.tsx').then((module) => ({ default: module.WorkspacePanel })))
type Props = ComponentProps<typeof WorkspacePanel>

/** Keep workspace/repository panel chrome available while its body loads. */
export class DeferredWorkspacePanel extends Component<Props, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }

  fallback(failed: boolean) {
    const title = this.props.mode === 'repo' ? 'Repository' : 'Workspace'
    const subject = title.toLowerCase()
    const Icon = this.props.mode === 'repo' ? GitBranch : PanelsTopLeft
    return <PanelShell title={title} icon={<Icon size={15} />} onClose={this.props.onClose}>
      <div className="px-3 py-4" data-workspace-panel-load={failed ? 'error' : 'loading'}>
        <InlineOperationStatus tone={failed ? 'alert' : 'status'}
          message={failed
            ? `Couldn’t load this ${subject} panel. Saved context is unchanged. Copy unsent text before reloading.`
            : `Loading ${subject} panel…`}
          action={failed ? { label: 'Reload preview', onClick: () => window.location.reload() } : undefined} />
      </div>
    </PanelShell>
  }

  render() {
    if (this.state.failed) return this.fallback(true)
    return <Suspense fallback={this.fallback(false)}><Panel {...this.props} /></Suspense>
  }
}
