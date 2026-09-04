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
  kind: 'conversation' | 'conversation-delete' | 'discussion-session-launch' | 'session-fork' | 'routine' | 'routine-create' | 'routine-run' | 'routine-delete' | 'dispatch-create' | 'artifact' | 'proposal' | 'agent' | 'agent-create' | 'agent-fork' | 'agent-import' | 'agent-delete' | 'provider' | 'provider-create' | 'provider-delete' | 'system-prompt' | 'system-prompt-create' | 'system-prompt-delete' | 'commission' | 'commission-create' | 'commission-delete' | 'delegation-create' | 'contribution-create' | 'open-work-create' | 'social-proposal-create' | 'saved-context' | 'saved-context-delete' | 'grant' | 'social-post'
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
      data-session-deletion-mutation={kind === 'conversation-delete' ? phase : undefined}
      data-discussion-session-launch={kind === 'discussion-session-launch' ? phase : undefined}
      data-session-fork={kind === 'session-fork' ? phase : undefined}
      data-schedule-mutation={kind === 'routine' ? phase : undefined}
      data-schedule-creation={kind === 'routine-create' ? phase : undefined}
      data-artifact-content-mutation={kind === 'artifact' ? phase : undefined}
      data-proposal-verdict-mutation={kind === 'proposal' ? phase : undefined}
      data-agent-mutation={kind === 'agent' ? phase : undefined}
      data-agent-creation={kind === 'agent-create' ? phase : undefined}
      data-agent-fork={kind === 'agent-fork' ? phase : undefined}
      data-agent-import={kind === 'agent-import' ? phase : undefined}
      data-agent-deletion={kind === 'agent-delete' ? phase : undefined}
      data-provider-definition-mutation={kind === 'provider' ? phase : undefined}
      data-provider-creation={kind === 'provider-create' ? phase : undefined}
      data-provider-deletion={kind === 'provider-delete' ? phase : undefined}
      data-system-prompt-definition-mutation={kind === 'system-prompt' ? phase : undefined}
      data-system-prompt-creation={kind === 'system-prompt-create' ? phase : undefined}
      data-system-prompt-deletion={kind === 'system-prompt-delete' ? phase : undefined}
      data-commission-mutation={kind === 'commission' ? phase : undefined}
      data-commission-creation={kind === 'commission-create' ? phase : undefined}
      data-commission-deletion={kind === 'commission-delete' ? phase : undefined}
      data-delegation-creation={kind === 'delegation-create' ? phase : undefined}
      data-contribution-creation={kind === 'contribution-create' ? phase : undefined}
      data-open-work-creation={kind === 'open-work-create' ? phase : undefined}
      data-social-proposal-creation={kind === 'social-proposal-create' ? phase : undefined}
      data-saved-context-mutation={kind === 'saved-context' ? phase : undefined}
      data-saved-context-deletion={kind === 'saved-context-delete' ? phase : undefined}
      data-schedule-run={kind === 'routine-run' ? phase : undefined}
      data-schedule-deletion={kind === 'routine-delete' ? phase : undefined}
      data-dispatch-creation={kind === 'dispatch-create' ? phase : undefined}
      data-grant-mutation={kind === 'grant' ? phase : undefined}
      data-social-post-mutation={kind === 'social-post' ? phase : undefined}
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
