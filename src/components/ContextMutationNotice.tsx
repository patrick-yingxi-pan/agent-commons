import { RotateCcw } from 'lucide-react'
import type { ContextMutationStatus } from '../controller/conversationCore'
import { Spinner } from './Spinner'
import { InlineOperationStatus } from './InlineOperationStatus'

/** Honest delivery state for authorization-affecting context changes. */
export function ContextMutationNotice({
  state,
  onRetry,
  onDismiss,
  panel = false,
}: {
  state: ContextMutationStatus
  onRetry: () => void
  onDismiss?: () => void
  /** Panel hosts put status in a bounded footer, outside the saved-content body. */
  panel?: boolean
}) {
  let notice
  if (state.busy) {
    notice = (
      <InlineOperationStatus
        tone="status"
        message={state.reconciling ? 'Checking saved context…' : 'Updating context…'}
        leading={<Spinner size={12} />}
      />
    )
  } else if (state.error) {
    notice = (
      <InlineOperationStatus
        tone="alert"
        message={state.error}
        action={state.retryable ? { label: 'Retry', icon: <RotateCcw size={12} />, onClick: onRetry } : undefined}
        secondaryAction={state.dismissible && onDismiss ? { label: 'Use saved state', onClick: onDismiss } : undefined}
      />
    )
  }
  if (!notice) return null
  if (!panel) return notice
  return (
    <div
      data-context-panel-status
      className="max-h-[35%] min-w-0 shrink-0 overflow-y-auto border-t border-line bg-panel px-2 pt-2"
    >
      <div className="rounded-lg border border-line bg-surface px-2 pt-2">
        {notice}
      </div>
    </div>
  )
}
