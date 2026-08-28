import { RotateCcw } from 'lucide-react'
import type { ContextMutationStatus } from '../controller/conversationCore'
import { Spinner } from './Spinner'
import { InlineOperationStatus } from './InlineOperationStatus'

/** Honest delivery state for authorization-affecting context changes. */
export function ContextMutationNotice({
  state,
  onRetry,
  floating = false,
}: {
  state: ContextMutationStatus
  onRetry: () => void
  /** Panel hosts need the same notice over a body that already owns h-full. */
  floating?: boolean
}) {
  let notice
  if (state.busy) {
    notice = (
      <InlineOperationStatus
        tone="status"
        message="Updating context…"
        leading={<Spinner size={12} />}
      />
    )
  } else if (state.error) {
    notice = (
      <InlineOperationStatus
        tone="alert"
        message={state.error}
        action={state.retryable ? { label: 'Retry', icon: <RotateCcw size={12} />, onClick: onRetry } : undefined}
      />
    )
  }
  if (!notice) return null
  if (!floating) return notice
  return (
    <div className="pointer-events-none absolute inset-x-3 bottom-2 z-40">
      <div className="pointer-events-auto rounded-lg border border-line bg-surface px-2 pt-2">
        {notice}
      </div>
    </div>
  )
}
