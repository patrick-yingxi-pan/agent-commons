import { useState } from 'react'
import { useMyInvites } from '../api'
import {
  enqueueOrgInviteVerdict,
  heldOrgInviteVerdict,
  heldOrgInviteVerdictIntents,
  useOrgInviteVerdictStatus,
} from '../controller/orgInviteVerdictMutations'
import { INLINE_ACTION_CLASS } from '../lib/inlineAction'

/** Low-frequency invitation controls load only when the account menu opens;
 * held truth remains in the eager external controller across unmount/navigation. */
export function OrgInvitationMenuSection() {
  const fetchedInvites = useMyInvites().data ?? []
  const mutation = useOrgInviteVerdictStatus()
  const heldInvites = heldOrgInviteVerdictIntents().map((intent) => intent.invitation)
  // Keep an exact uncertain row visible even when an authoritative pending-list
  // refresh observes its early disappearance before receipt recovery settles.
  const invitations = [
    ...fetchedInvites,
    ...heldInvites.filter((held) => !fetchedInvites.some((invite) => invite.id === held.id)),
  ]
  const [error, setError] = useState('')
  const decide = async (invitation: (typeof invitations)[number], verdict: 'accept' | 'decline') => {
    setError('')
    try {
      await enqueueOrgInviteVerdict(invitation, verdict)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not prepare invitation recovery.')
    }
  }

  if (invitations.length === 0 && !error) return null
  return (
    <>
      <div className="px-2 py-1 text-[10px] font-medium uppercase tracking-wide text-ink-faint">
        Invitations
      </div>
      {invitations.map((invitation) => {
        const held = heldOrgInviteVerdict(invitation.id)
        const active = held && mutation.activeResourceId === `org-invite-verdict:${invitation.id}`
        const awaitingRetry = !!active && !!mutation.error
        return (
          <div
            key={invitation.id}
            data-testid="org-invite-row"
            data-org-invite-verdict={held ? (awaitingRetry ? 'failed' : 'pending') : undefined}
            aria-busy={held ? 'true' : undefined}
            className="flex items-center gap-2 rounded-md px-2 py-1.5 text-[12px] text-ink-soft"
          >
            <span className="min-w-0 flex-1 truncate">
              {invitation.orgName}
              <span className="ml-1 text-[10px] text-ink-faint">from {invitation.invitedBy}</span>
            </span>
            <button
              data-testid="org-invite-accept"
              onClick={() => void decide(invitation, 'accept')}
              disabled={!!held}
              className={`${INLINE_ACTION_CLASS} disabled:opacity-50`}
            >
              {held?.verdict === 'accept' ? (awaitingRetry ? 'Accept held' : 'Accepting…') : 'Accept'}
            </button>
            <button
              data-testid="org-invite-decline"
              onClick={() => void decide(invitation, 'decline')}
              disabled={!!held}
              className="text-ink-faint transition hover:text-ink disabled:opacity-50"
            >
              {held?.verdict === 'decline' ? (awaitingRetry ? 'Decline held' : 'Declining…') : 'Decline'}
            </button>
          </div>
        )
      })}
      {error && (
        <p data-testid="org-invite-error" className="px-2 py-1 text-[11px] text-removed">
          {error}
        </p>
      )}
    </>
  )
}
