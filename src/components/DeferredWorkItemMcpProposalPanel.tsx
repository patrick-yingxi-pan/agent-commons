import { Component, lazy, Suspense, type ComponentProps, type ReactNode } from 'react'
import { Spinner } from './Spinner.tsx'
import type { WorkItemMcpProposalPanel } from './WorkItemMcpProposalPanel.tsx'

const Panel = lazy(() => import('./WorkItemMcpProposalPanel.tsx').then((module) => ({ default: module.WorkItemMcpProposalPanel })))
type Props = ComponentProps<typeof WorkItemMcpProposalPanel>

class WorkItemMcpProposalLoadBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  render() {
    if (!this.state.failed) return this.props.children
    return <section role="alert" aria-label="Work this item now" data-work-item-mcp-proposal-load="failed" className="rounded-md border border-danger/30 bg-danger-tint/40 px-2.5 py-2">
      <p className="text-[11px] leading-relaxed text-danger-text">Couldn’t load these MCP contribution controls. Reloading clears unsent choices and in-memory recovery; copy the reviewed arguments and check the Changes ledger first.</p>
      <button type="button" onClick={() => window.location.reload()} className="mt-2 rounded-md border border-danger/30 px-2 py-1 text-[11px] font-medium text-danger-text">Reload app</button>
    </section>
  }
}

export function DeferredWorkItemMcpProposalPanel(props: Props) {
  return <WorkItemMcpProposalLoadBoundary>
    <Suspense fallback={<p role="status" data-work-item-mcp-proposal-load="loading" className="flex items-center gap-2 text-[12px] text-ink-faint"><Spinner size={13} /> Loading MCP contribution controls…</p>}>
      <Panel {...props} />
    </Suspense>
  </WorkItemMcpProposalLoadBoundary>
}
