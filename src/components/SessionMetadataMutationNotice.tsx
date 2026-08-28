import { RotateCcw, X } from 'lucide-react'
import {
  discardSessionMetadataMutation,
  retrySessionMetadataMutation,
  useSessionMetadataMutationStatus,
} from '../controller/sessionMetadataMutations'
import { InlineOperationStatus } from './InlineOperationStatus'
import { Spinner } from './Spinner'

/** One shell-level acknowledgement/recovery surface for conversation row
 * edits launched from the rail or a pane's model selector. */
export function SessionMetadataMutationNotice() {
  const mutation = useSessionMetadataMutationStatus()
  if (!mutation.busy && !mutation.error) return null
  return (
    <div
      data-session-metadata-mutation={mutation.error ? 'failed' : 'pending'}
      className="relative z-[60] shrink-0 border-b border-line bg-panel-2/95 px-2 pt-2"
    >
      {mutation.busy ? (
        <InlineOperationStatus
          tone="status"
          message={mutation.pendingCount > 1 ? `Updating conversation… ${mutation.pendingCount - 1} more queued` : 'Updating conversation…'}
          leading={<Spinner size={12} />}
        />
      ) : (
        <InlineOperationStatus
          tone="alert"
          message={mutation.error!}
          action={
            mutation.retryable
              ? { label: 'Retry', icon: <RotateCcw size={12} />, onClick: retrySessionMetadataMutation }
              : { label: 'Dismiss', icon: <X size={12} />, onClick: discardSessionMetadataMutation }
          }
          secondaryAction={
            mutation.retryable
              ? { label: 'Dismiss', icon: <X size={12} />, onClick: discardSessionMetadataMutation }
              : undefined
          }
        />
      )}
    </div>
  )
}
