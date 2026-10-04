import { Component, lazy, Suspense, type ComponentProps } from 'react'
import { FileText, Image as ImageIcon } from 'lucide-react'
import type { AttachmentPanel } from './AttachmentPanel.tsx'
import { PanelShell } from './PanelShell.tsx'
import { InlineOperationStatus } from './InlineOperationStatus.tsx'

const Panel = lazy(() => import('./AttachmentPanel.tsx').then((module) => ({ default: module.AttachmentPanel })))
type Props = ComponentProps<typeof AttachmentPanel>

/** The complete preview and its Refresh command load together before any
 * mutation control is shown. The shell remains navigable if admission fails. */
export class DeferredAttachmentPanel extends Component<Props, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }

  fallback(failed: boolean) {
    const photos = this.props.kind === 'photo'
    return (
      <PanelShell title={photos ? 'Photos' : 'Files'} count={this.props.items.length}
        icon={photos ? <ImageIcon size={15} /> : <FileText size={15} />} onClose={this.props.onClose}>
        <div className="px-3 py-4" data-attachment-panel-load={failed ? 'error' : 'loading'}>
          <InlineOperationStatus
            tone={failed ? 'alert' : 'status'}
            message={failed
              ? 'Couldn’t load this preview. Your saved context is unchanged. Copy any unsent text before reloading.'
              : 'Loading attachment preview…'}
            action={failed ? { label: 'Reload preview', onClick: () => window.location.reload() } : undefined}
          />
        </div>
      </PanelShell>
    )
  }

  render() {
    if (this.state.failed) return this.fallback(true)
    return <Suspense fallback={this.fallback(false)}><Panel {...this.props} /></Suspense>
  }
}
