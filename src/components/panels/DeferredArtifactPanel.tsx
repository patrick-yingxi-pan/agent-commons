import { Component, lazy, Suspense, type ComponentProps } from 'react'
import type { ArtifactPanel } from './ArtifactPanel'
import { SECONDARY_BUTTON_CLASS } from '../../lib/button'

const Panel = lazy(() => import('./ArtifactPanel').then((module) => ({ default: module.ArtifactPanel })))

/** Rich artifact rendering belongs to an opened workspace, not the cold app
 * graph. Keep a failed chunk local to this panel so the conversation survives. */
export class DeferredArtifactPanel extends Component<ComponentProps<typeof ArtifactPanel>, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  render() {
    if (this.state.failed) return (
      <div role="alert" className="p-4 text-[13px] leading-relaxed text-ink-soft" data-workspace-load-failed>
        <p>The workspace preview could not load. Your attached snapshots have not been removed.</p>
        <p className="mt-2 text-[11px] text-ink-faint">Reload to try again. Unsaved draft text may be lost.</p>
        <button type="button" className={`${SECONDARY_BUTTON_CLASS} mt-3 px-3 py-1.5 text-[13px]`} onClick={() => window.location.reload()}>Reload app</button>
      </div>
    )
    return (
      <Suspense fallback={<p role="status" className="p-4 text-[13px] text-ink-faint">Loading workspace preview…</p>}>
        <Panel {...this.props} />
      </Suspense>
    )
  }
}
