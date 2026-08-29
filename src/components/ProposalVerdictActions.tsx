import type { SocialEntityRef, SocialProposal } from '../../contract/index.ts'
import { decideProposal, useProposalVerdictMutationStatus } from '../controller/proposalVerdictMutations'
import { INLINE_ACTION_CLASS } from '../lib/inlineAction'

/** The one owner consent control for a social proposal, shared by the generic
 * Improvements panel and a project's merged Changes ledger. */
export function ProposalVerdictActions({
  proposal,
  subject,
  own,
}: {
  proposal: SocialProposal
  subject: SocialEntityRef
  own: boolean
}) {
  const mutation = useProposalVerdictMutationStatus()
  if (!own || proposal.state !== 'offered') return null

  const pending = mutation.pendingProposalIds.includes(proposal.id)
  const active = mutation.activeResourceId === proposal.id && mutation.busy
  const landing = active && mutation.activeVerdict === 'land'
  const declining = active && mutation.activeVerdict === 'decline'

  return (
    <span
      className="inline-flex shrink-0 items-center gap-1.5"
      data-proposal-verdict={pending ? 'pending' : proposal.stale ? 'stale' : 'ready'}
      aria-busy={pending || undefined}
    >
      {proposal.stale ? (
        <span
          className="text-[11px] font-medium text-warning"
          title="The target changed after this proposal was offered. Review the current version and ask for a new proposal."
        >
          Needs revision
        </span>
      ) : (
        <button
          onClick={() => void decideProposal(proposal.id, subject, 'land')}
          disabled={pending}
          className={`${INLINE_ACTION_CLASS} disabled:pointer-events-none disabled:opacity-45`}
        >
          {landing ? 'Landing…' : 'Land'}
        </button>
      )}
      <button
        onClick={() => void decideProposal(proposal.id, subject, 'decline')}
        disabled={pending}
        className={`${INLINE_ACTION_CLASS} disabled:pointer-events-none disabled:opacity-45`}
      >
        {declining ? 'Declining…' : 'Decline'}
      </button>
    </span>
  )
}
