import { Component, lazy, Suspense, type ComponentProps } from 'react'
import type { StructuredArtifactView as BodyView } from './StructuredArtifactView.tsx'
import { SECONDARY_BUTTON_CLASS } from '../lib/button.ts'

const Body = lazy(() => import('./StructuredArtifactView.tsx').then(module => ({ default: module.StructuredArtifactView })))

/** Structured content is conditional, not cold-workspace chrome. Chunk failure
 * is never mistaken for an empty saved body or an acknowledged operation. */
export class StructuredArtifactView extends Component<ComponentProps<typeof BodyView>, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  render() {
    if (this.state.failed) return <div role="alert" data-structured-body-load-error className="space-y-2 text-[12px] text-ink-soft">
      <p>Couldn’t load artifact content. Reload to review it; unsaved workspace text will be lost.</p>
      <button type="button" className={`${SECONDARY_BUTTON_CLASS} px-2.5 py-1 text-[12px]`} onClick={() => window.location.reload()}>Reload content</button>
    </div>
    return <Suspense fallback={<div role="status" data-structured-body-loading className="text-[12px] text-ink-soft">Loading artifact content…</div>}>
      <Body {...this.props} />
    </Suspense>
  }
}
