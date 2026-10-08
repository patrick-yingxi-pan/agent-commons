import { Component, lazy, Suspense, type ComponentProps } from 'react'
import type { ConnectorDetailBody, ConnectorPanel } from './ConnectorPanel'
import { PanelShell } from './PanelShell'
import { InlineOperationStatus } from './InlineOperationStatus'
import { connectorIconFor } from '../lib/connectors'

const Panel = lazy(() => import('./ConnectorPanel.tsx').then((module) => ({ default: module.ConnectorPanel })))
type Props = ComponentProps<typeof ConnectorPanel>
const DetailBody = lazy(() => import('./ConnectorPanel.tsx').then((module) => ({ default: module.ConnectorDetailBody })))
type DetailProps = ComponentProps<typeof ConnectorDetailBody>
const noop = () => {}

class DeferredConnectorDetail extends Component<DetailProps, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }

  fallback(failed: boolean) {
    return <InlineOperationStatus
      tone={failed ? 'alert' : 'status'}
      message={failed
        ? 'Couldn’t load connector details. No connection state changed. Copy unsent text before reloading.'
        : 'Loading connector details…'}
      action={failed ? { label: 'Reload details', onClick: () => window.location.reload() } : undefined}
    />
  }

  render() {
    if (this.state.failed) return this.fallback(true)
    return <Suspense fallback={this.fallback(false)}><DetailBody {...this.props} /></Suspense>
  }
}

/** Detail-page projection shares the same deferred implementation without
 * making the session shell load connector/MCP body code at boot. */
export function DeferredConnectorDetailBody(props: DetailProps) {
  return <DeferredConnectorDetail {...props} />
}

/** Keep the owning context shell usable while the connector-only runtime loads. */
export class DeferredConnectorContextPanel extends Component<Props, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }

  fallback(failed: boolean) {
    const Icon = connectorIconFor(this.props.connector.kind)
    return <PanelShell title={this.props.connector.label} icon={<Icon size={15} />} onClose={this.props.onClose ?? noop}>
      <div className="px-3 py-4" data-connector-panel-load={failed ? 'error' : 'loading'}>
        <InlineOperationStatus tone={failed ? 'alert' : 'status'}
          message={failed
            ? 'Couldn’t load this connector panel. No connection state changed. Copy unsent text before reloading.'
            : 'Loading connector details…'}
          action={failed ? { label: 'Reload preview', onClick: () => window.location.reload() } : undefined} />
      </div>
    </PanelShell>
  }

  render() {
    if (this.state.failed) return this.fallback(true)
    return <Suspense fallback={this.fallback(false)}><Panel {...this.props} /></Suspense>
  }
}
