import { Component, lazy, Suspense, type ComponentProps } from 'react'
import type { ToolActivityCard } from './ToolActivityCard.tsx'
import { SECONDARY_BUTTON_CLASS } from '../lib/button.ts'

const Card = lazy(() =>
  import('./ToolActivityCard.tsx').then((module) => ({ default: module.ToolActivityCard })),
)
const SHELL_CLASS = 'mt-2.5 rounded-xl border border-line bg-panel-2/30 p-3 text-[12px] text-ink-soft'

/** Tool history is conditional transcript content, not cold-workspace chrome.
 * Keep chunk failure local while retaining an honest, actionable consent face. */
export class DeferredToolActivityCard extends Component<
  ComponentProps<typeof ToolActivityCard>,
  { failed: boolean }
> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  render() {
    if (this.state.failed) return (
      <div role="alert" data-tool-activity-load-error
        className={`${SHELL_CLASS} leading-relaxed`}>
        <p>Couldn’t load tool activity. Reload to review its latest status.</p>
        <button type="button" className={`${SECONDARY_BUTTON_CLASS} mt-2 px-2.5 py-1 text-[12px]`}
          onClick={() => window.location.reload()}>Reload to review</button>
      </div>
    )
    return (
      <Suspense fallback={<div role="status" data-tool-activity-loading className={SHELL_CLASS}>
        Loading tool activity…
      </div>}>
        <Card {...this.props} />
      </Suspense>
    )
  }
}
