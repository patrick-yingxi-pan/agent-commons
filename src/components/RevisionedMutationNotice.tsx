import { RotateCcw, X } from 'lucide-react'
import type { RevisionedMutationStatus } from '../controller/revisionedMutationCore'
import { InlineOperationStatus } from './InlineOperationStatus'
import { Spinner } from './Spinner'

/** One visual/accessibility funnel for an acknowledgement-gated entity queue. */
export function RevisionedMutationNotice({
  kind,
  mutation,
  pendingLabel,
  discardLabel = 'Dismiss',
  onRetry,
  onDiscard,
}: {
  kind: 'conversation' | 'conversation-delete' | 'session-compaction' | 'discussion-session-launch' | 'discussion-post-delete' | 'discussion-state' | 'session-fork' | 'tool-activity-decision' | 'relation-action-decision' | 'api-token-mint' | 'api-token-revoke' | 'org-create' | 'org-invite-owner' | 'org-invite-verdict' | 'routine' | 'routine-create' | 'routine-run' | 'routine-delete' | 'dispatch-create' | 'artifact' | 'proposal' | 'agent' | 'agent-create' | 'agent-fork' | 'agent-import' | 'agent-delete' | 'agent-proposal-create' | 'agent-proposal-comment-create' | 'agent-proposal-verdict' | 'provider' | 'provider-create' | 'provider-delete' | 'provider-secret-rotation' | 'system-prompt' | 'system-prompt-create' | 'system-prompt-delete' | 'commission' | 'commission-create' | 'commission-delete' | 'delegation-create' | 'delegation-revoke' | 'delegated-judgment' | 'contribution-create' | 'contribution-land' | 'contribution-effect' | 'contribution-crystallization' | 'contribution-envelope-approval' | 'contribution-envelope-proposal' | 'contribution-comment-create' | 'contribution-review' | 'contribution-require-review' | 'open-work-create' | 'work-item-comment-create' | 'work-item-retract' | 'subgoal-claim' | 'subgoal-release' | 'social-proposal-create' | 'saved-context' | 'saved-context-create' | 'saved-context-delete' | 'standing-relationship' | 'grant' | 'social-post'
  mutation: RevisionedMutationStatus
  pendingLabel: string
  discardLabel?: string
  onRetry: () => void
  onDiscard: () => void
}) {
  if (!mutation.busy && !mutation.error) return null
  const phase = mutation.error ? 'failed' : 'pending'
  const dismissAction = { label: 'Dismiss', icon: <X size={12} />, onClick: onDiscard }
  const discardAction = discardLabel === 'Dismiss'
    ? dismissAction
    : { ...dismissAction, label: discardLabel }
  return (
    <div
      data-revisioned-mutation={kind}
      data-mutation-status={phase}
      data-session-metadata-mutation={kind === 'conversation' ? phase : undefined}
      data-session-deletion-mutation={kind === 'conversation-delete' ? phase : undefined}
      data-session-compaction={kind === 'session-compaction' ? phase : undefined}
      data-discussion-session-launch={kind === 'discussion-session-launch' ? phase : undefined}
      data-discussion-post-deletion-notice={kind === 'discussion-post-delete' ? phase : undefined}
      data-discussion-state-mutation={kind === 'discussion-state' ? phase : undefined}
      data-session-fork={kind === 'session-fork' ? phase : undefined}
      data-tool-activity-decision={kind === 'tool-activity-decision' ? phase : undefined}
      data-relation-action-decision={kind === 'relation-action-decision' ? phase : undefined}
      data-api-token-mint={kind === 'api-token-mint' ? phase : undefined}
      data-api-token-revocation={kind === 'api-token-revoke' ? phase : undefined}
      data-org-creation={kind === 'org-create' ? phase : undefined}
      data-org-invite-owner-notice={kind === 'org-invite-owner' ? phase : undefined}
      data-org-invite-verdict-notice={kind === 'org-invite-verdict' ? phase : undefined}
      data-schedule-mutation={kind === 'routine' ? phase : undefined}
      data-schedule-creation={kind === 'routine-create' ? phase : undefined}
      data-artifact-content-mutation={kind === 'artifact' ? phase : undefined}
      data-proposal-verdict-mutation={kind === 'proposal' ? phase : undefined}
      data-agent-mutation={kind === 'agent' ? phase : undefined}
      data-agent-creation={kind === 'agent-create' ? phase : undefined}
      data-agent-fork={kind === 'agent-fork' ? phase : undefined}
      data-agent-import={kind === 'agent-import' ? phase : undefined}
      data-agent-deletion={kind === 'agent-delete' ? phase : undefined}
      data-agent-proposal-creation={kind === 'agent-proposal-create' ? phase : undefined}
      data-agent-proposal-comment-creation={kind === 'agent-proposal-comment-create' ? phase : undefined}
      data-agent-proposal-verdict={kind === 'agent-proposal-verdict' ? phase : undefined}
      data-provider-definition-mutation={kind === 'provider' ? phase : undefined}
      data-provider-creation={kind === 'provider-create' ? phase : undefined}
      data-provider-deletion={kind === 'provider-delete' ? phase : undefined}
      data-provider-secret-rotation={kind === 'provider-secret-rotation' ? phase : undefined}
      data-system-prompt-definition-mutation={kind === 'system-prompt' ? phase : undefined}
      data-system-prompt-creation={kind === 'system-prompt-create' ? phase : undefined}
      data-system-prompt-deletion={kind === 'system-prompt-delete' ? phase : undefined}
      data-commission-mutation={kind === 'commission' ? phase : undefined}
      data-commission-creation={kind === 'commission-create' ? phase : undefined}
      data-commission-deletion={kind === 'commission-delete' ? phase : undefined}
      data-delegation-creation={kind === 'delegation-create' ? phase : undefined}
      data-delegation-revocation={kind === 'delegation-revoke' ? phase : undefined}
      data-delegated-judgment={kind === 'delegated-judgment' ? phase : undefined}
      data-contribution-creation={kind === 'contribution-create' ? phase : undefined}
      data-contribution-landing={kind === 'contribution-land' ? phase : undefined}
      data-contribution-effect={kind === 'contribution-effect' ? phase : undefined}
      data-contribution-crystallization={kind === 'contribution-crystallization' ? phase : undefined}
      data-contribution-envelope-approval={kind === 'contribution-envelope-approval' ? phase : undefined}
      data-contribution-envelope-proposal={kind === 'contribution-envelope-proposal' ? phase : undefined}
      data-contribution-comment-creation={kind === 'contribution-comment-create' ? phase : undefined}
      data-contribution-review={kind === 'contribution-review' ? phase : undefined}
      data-contribution-require-review={kind === 'contribution-require-review' ? phase : undefined}
      data-open-work-creation={kind === 'open-work-create' ? phase : undefined}
      data-work-item-comment-creation={kind === 'work-item-comment-create' ? phase : undefined}
      data-work-item-retraction={kind === 'work-item-retract' ? phase : undefined}
      data-subgoal-claim={kind === 'subgoal-claim' ? phase : undefined}
      data-subgoal-release={kind === 'subgoal-release' ? phase : undefined}
      data-social-proposal-creation={kind === 'social-proposal-create' ? phase : undefined}
      data-saved-context-mutation={kind === 'saved-context' ? phase : undefined}
      data-saved-context-creation={kind === 'saved-context-create' ? phase : undefined}
      data-saved-context-deletion={kind === 'saved-context-delete' ? phase : undefined}
      data-standing-relationship={kind === 'standing-relationship' ? phase : undefined}
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
              : discardAction
          }
          secondaryAction={
            mutation.retryable
              ? discardAction
              : undefined
          }
        />
      )}
    </div>
  )
}
