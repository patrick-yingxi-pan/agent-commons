import { RotateCcw, X } from 'lucide-react'
import { useRelations } from '../controller/useRelations'
import { Spinner } from './Spinner'
import { InlineOperationStatus } from './InlineOperationStatus'

/** One shell-level truth surface for relation edits launched from cards, menus,
 * and entity editors. Cached content stays usable while the FIFO waits. */
export function RelationMutationNotice() {
  const { mutation, retryMutation, discardMutation } = useRelations()
  if (!mutation.busy && !mutation.error) return null
  const queued = mutation.pendingKeys.length
  const pendingLabel = mutation.activeKey?.startsWith('direct-project:')
    ? 'Creating Project…'
    : 'Applying change…'
  return (
    <div
      data-relation-mutation={mutation.error ? 'failed' : 'pending'}
      className="relative z-[60] shrink-0 border-b border-line bg-panel-2/95 px-2 pt-2"
    >
      {mutation.busy ? (
        <InlineOperationStatus
          tone="status"
          message={queued > 1 ? `${pendingLabel} ${queued - 1} more queued` : pendingLabel}
          leading={<Spinner size={12} />}
        />
      ) : (
        <InlineOperationStatus
          tone="alert"
          message={mutation.error!}
          action={
            mutation.retryable
              ? { label: 'Retry', icon: <RotateCcw size={12} />, onClick: retryMutation }
              : { label: 'Dismiss', icon: <X size={12} />, onClick: discardMutation }
          }
          secondaryAction={
            mutation.retryable
              ? { label: 'Dismiss', icon: <X size={12} />, onClick: discardMutation }
              : undefined
          }
        />
      )}
    </div>
  )
}
