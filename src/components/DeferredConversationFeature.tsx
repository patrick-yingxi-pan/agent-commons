import { Component, Suspense, type ReactNode } from 'react'
import { InlineOperationStatus } from './InlineOperationStatus.tsx'

/** Optional conversation tools share one dismissible chunk-recovery boundary. */
export class DeferredConversationFeature extends Component<{
  feature: 'search' | 'download'; onClose: () => void; children: ReactNode
}, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  render() {
    const { feature, onClose, children } = this.props
    const close = { label: `Close ${feature}`, onClick: onClose }
    if (this.state.failed) return <InlineOperationStatus tone="alert"
      message={`Couldn’t load conversation ${feature}. Copy any unsent text before reloading.`}
      action={close} secondaryAction={{ label: 'Reload app', onClick: () => window.location.reload() }} />
    return <Suspense fallback={<InlineOperationStatus tone="status"
      message={`Loading conversation ${feature}…`} action={close} />}>{children}</Suspense>
  }
}
