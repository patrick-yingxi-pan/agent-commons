import { Component, lazy, Suspense, type ComponentProps, type ReactNode } from 'react'
import type { ContributionMcpDraftHelper } from './ContributionMcpDraftHelper.tsx'

const Helper = lazy(() => import('./ContributionMcpDraftHelper.tsx').then((module) => ({ default: module.ContributionMcpDraftHelper })))
type Props = ComponentProps<typeof ContributionMcpDraftHelper>

class ContributionMcpDraftLoadBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  render() {
    if (!this.state.failed) return this.props.children
    return <section role="alert" data-contribution-mcp-draft-load="failed" className="mt-2 rounded-md border border-danger/30 bg-danger-tint/40 px-2.5 py-2">
      <p className="text-[11px] leading-relaxed text-danger-text">Couldn’t load the argument-draft helper. Reloading clears unsent choices and in-memory Dispatch recovery; check Dispatch history first.</p>
      <button type="button" onClick={() => window.location.reload()} className="mt-2 rounded-md border border-danger/30 px-2 py-1 text-[11px] font-medium text-danger-text">Reload app</button>
    </section>
  }
}

export function DeferredContributionMcpDraftHelper(props: Props) {
  return <ContributionMcpDraftLoadBoundary>
    <Suspense fallback={<p role="status" data-contribution-mcp-draft-load="loading" className="text-[11px] text-ink-faint">Loading argument-draft controls…</p>}>
      <Helper {...props} />
    </Suspense>
  </ContributionMcpDraftLoadBoundary>
}
