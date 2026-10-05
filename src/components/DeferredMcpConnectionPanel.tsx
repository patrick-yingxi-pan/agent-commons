import { Component, lazy, Suspense, type ComponentProps, type ReactNode } from 'react'
import type * as McpViews from './McpConnectionPanel.tsx'
import type { NavLocation } from '../lib/nav.ts'
import { InlineOperationStatus } from './InlineOperationStatus.tsx'
import { AtomicResourcePage } from './ResourcePage.tsx'
import { BackButton } from './BackButton.tsx'
import { PAGE_HEADER_CLASS, PAGE_TITLE_CLASS } from '../lib/pageHeader.ts'

const Detail = lazy(() => import('./McpConnectionPanel.tsx').then((module) => ({ default: module.McpConnectionDetail })))
type DetailProps = ComponentProps<typeof McpViews.McpConnectionDetail>

class Boundary extends Component<{ children: ReactNode; fallback: (failed: boolean) => ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  render() {
    return this.state.failed
      ? this.props.fallback(true)
      : <Suspense fallback={this.props.fallback(false)}>{this.props.children}</Suspense>
  }
}


function DetailFallback({ failed, backTo, onBack }: { failed: boolean; backTo: NavLocation | null; onBack: () => void }) {
  return (
    <AtomicResourcePage data-mcp-detail-load={failed ? 'error' : 'loading'}>
      <header className={PAGE_HEADER_CLASS}>
        <div className="flex min-w-0 items-start gap-2"><BackButton to={backTo} onBack={onBack} />
          <div><h1 className={PAGE_TITLE_CLASS}>MCP server</h1><p className="mt-1 text-[13px] text-ink-soft">External connection</p></div>
        </div>
      </header>
      <InlineOperationStatus tone={failed ? 'alert' : 'status'} message={failed
        ? 'Couldn’t load MCP server details. No connection state was changed. Copy any unsent workspace text before reloading.'
        : 'Loading MCP server…'}
        action={failed ? { label: 'Reload details', onClick: () => window.location.reload() } : undefined} />
    </AtomicResourcePage>
  )
}

export function DeferredMcpConnectionDetail(props: DetailProps) {
  return <Boundary fallback={(failed) => <DetailFallback failed={failed} backTo={props.backTo} onBack={props.onBack} />}><Detail {...props} /></Boundary>
}
