import { Component, lazy, Suspense, type ComponentProps } from 'react'
import type { ConversationSearch } from './ConversationSearch.tsx'
import { InlineOperationStatus } from './InlineOperationStatus.tsx'

const Search = lazy(() => import('./ConversationSearch.tsx').then((module) => ({ default: module.ConversationSearch })))
type Props = ComponentProps<typeof ConversationSearch>

/** Keep the transcript and its opener usable until the optional dialog is ready. */
export class DeferredConversationSearch extends Component<Props, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }

  render() {
    if (this.state.failed) return <div data-conversation-search-load-error>
      <InlineOperationStatus tone="alert"
        message="Couldn’t load conversation search. Copy any unsent text before reloading."
        action={{ label: 'Close search', onClick: this.props.onClose }}
        secondaryAction={{ label: 'Reload app', onClick: () => window.location.reload() }} />
    </div>
    return <Suspense fallback={<div data-conversation-search-loading>
      <InlineOperationStatus tone="status" message="Loading conversation search…"
        action={{ label: 'Close search', onClick: this.props.onClose }} />
    </div>}><Search {...this.props} /></Suspense>
  }
}
