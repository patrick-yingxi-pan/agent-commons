import { Component, lazy, Suspense, type ComponentProps } from 'react'
import type { McpInputReviewPanel } from './McpInputReviewPanel.tsx'
import { SECONDARY_BUTTON_CLASS } from '../lib/button.ts'
import { MCP_INPUT_READ_DISCLOSURE } from '../lib/mcpInputCopy.ts'

const Panel = lazy(() => import('./McpInputReviewPanel.tsx').then((module) => ({ default: module.McpInputReviewPanel })))
export class DeferredMcpInputReview extends Component<ComponentProps<typeof McpInputReviewPanel>, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  render() {
    if (this.state.failed) return <div role="alert" data-mcp-input-load="error" className="mt-2 text-[12px] text-ink-soft">
      <p>Couldn’t load private review. {MCP_INPUT_READ_DISCLOSURE} Copy unsent text before reloading; memory-only answers and recovery details will be lost.</p>
      <button type="button" className={`${SECONDARY_BUTTON_CLASS} mt-2 px-2 py-1 text-[12px]`} onClick={() => window.location.reload()}>Reload to review</button>
    </div>
    return <Suspense fallback={<p role="status" data-mcp-input-load="loading" className="mt-2 text-[12px] text-ink-soft">Loading private review…</p>}>
      <Panel {...this.props} />
    </Suspense>
  }
}
