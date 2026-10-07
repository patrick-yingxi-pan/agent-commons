import { Component, lazy, Suspense, type ComponentProps } from 'react'
import type { StructuredArtifactEditor as EditorView } from './StructuredArtifactEditor.tsx'
import { INLINE_ACTION_CLASS } from '../lib/inlineAction.ts'

const Editor = lazy(() => import('./StructuredArtifactEditor.tsx').then(module => ({ default: module.StructuredArtifactEditor })))
type Props = ComponentProps<typeof EditorView>

function LoadState({ failed = false, onCancel, saving }: Pick<Props, 'onCancel' | 'saving'> & { failed?: boolean }) {
  return <div role={failed ? 'alert' : 'status'} data-structured-editor-load={failed ? 'error' : 'loading'} className="space-y-2 text-[12px] text-ink-soft">
    <p>{failed ? 'Couldn’t load artifact editor. Your draft is still held. Copy any unsaved workspace text before reloading.' : 'Loading artifact editor…'}</p>
    <div className="flex flex-wrap gap-2">
      {failed && <button type="button" className={INLINE_ACTION_CLASS} disabled={saving} onClick={() => window.location.reload()}>Reload editor</button>}
      <button type="button" className={INLINE_ACTION_CLASS} disabled={saving} onClick={onCancel}>Cancel</button>
    </div>
  </div>
}

/** The shared draft outlives lazy admission; loading and failure never save or
 * clear it. Cancellation remains available without waiting for the module. */
export class StructuredArtifactEditor extends Component<Props, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  render() {
    if (this.state.failed) return <LoadState failed onCancel={this.props.onCancel} saving={this.props.saving} />
    return <Suspense fallback={<LoadState onCancel={this.props.onCancel} saving={this.props.saving} />}>
      <Editor {...this.props} />
    </Suspense>
  }
}
