import { RotateCcw, X } from 'lucide-react'
import type { RevisionedMutationStatus } from '../controller/revisionedMutationCore'
import { InlineOperationStatus } from './InlineOperationStatus'
import { Spinner } from './Spinner'

/** One visual/accessibility funnel for an acknowledgement-gated entity queue. */
export function RevisionedMutationNotice({
  kind,
  mutation,
  pendingLabel,
  onRetry,
  onDiscard,
}: {
  kind: 'conversation' | 'routine' | 'artifact' | 'proposal' | 'agent'
  mutation: RevisionedMutationStatus
  pendingLabel: string
  onRetry: () => void
  onDiscard: () => void
}) {
  if (!mutation.busy && !mutation.error) return null
  const phase = mutation.error ? 'failed' : 'pending'
  return (
    <div
      data-revisioned-mutation={kind}
      data-mutation-status={phase}
      data-session-metadata-mutation={kind === 'conversation' ? phase : undefined}
      data-schedule-mutation={kind === 'routine' ? phase : undefined}
      data-artifact-content-mutation={kind === 'artifact' ? phase : undefined}
      data-proposal-verdict-mutation={kind === 'proposal' ? phase : undefined}
      data-agent-mutation={kind === 'agent' ? phase : undefined}
      className="relative z-[60] shrink-0 border-b border-line bg-panel-2/95 px-2 pt-2"
    >
      {mutation.busy ? (
        <InlineOperationStatus
          tone="status"
          message={mutation.pendingCount > 1 ? `${pendingLabel} ${mutation.pendingCount - 1} more queued` : pendingLabel}
          leading={<Spinner size={12} />}
        />
      ) : (
        <InlineOperationStatus
          tone="alert"
          message={mutation.error!}
          action={
            mutation.retryable
              ? { label: 'Retry', icon: <RotateCcw size={12} />, onClick: onRetry }
              : { label: 'Dismiss', icon: <X size={12} />, onClick: onDiscard }
          }
          secondaryAction={
            mutation.retryable
              ? { label: 'Dismiss', icon: <X size={12} />, onClick: onDiscard }
              : undefined
          }
        />
      )}
    </div>
  )
}
