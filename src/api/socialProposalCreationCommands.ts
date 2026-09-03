/** Transport and exact authoritative reconciliation for change-offer creation. */
import type { SocialProposal } from '../../contract/index.ts'
import { apiGet, apiPost } from './client.ts'
import { invalidate, mutate, peek, setData } from './cache.ts'
import { socialProposalCreationId } from './socialProposalCreationIdentity.ts'
import type { SocialProposalCreationIntent } from './socialProposalCreationRevision.ts'
import { keys, paths } from './keys.ts'

function remember(intent: SocialProposalCreationIntent, proposal: SocialProposal): void {
  const { kind, id } = intent.request.subject
  setData(keys.socialProposal(proposal.id), proposal)
  if (peek<SocialProposal[]>(keys.socialProposals(kind, id))) {
    mutate<SocialProposal[]>(keys.socialProposals(kind, id), (current) => {
      const rows = current ?? []
      return rows.some((candidate) => candidate.id === proposal.id)
        ? rows.map((candidate) => candidate.id === proposal.id ? proposal : candidate)
        : [proposal, ...rows]
    })
  }
  // The ledger may move independently while acknowledgement is in flight.
  invalidate(keys.socialProposals(kind, id))
}

export async function applySocialProposalCreation(
  intent: SocialProposalCreationIntent,
  idempotencyKey: string,
): Promise<void> {
  const proposal = await apiPost<SocialProposal>(
    paths.socialProposalOpen(),
    intent.request,
    { idempotencyKey },
  )
  remember(intent, proposal)
}

/** Prove only the row derived from this tenant and exact form submission. */
export async function reconcileSocialProposalCreation(
  intent: SocialProposalCreationIntent,
  idempotencyKey: string,
): Promise<boolean> {
  const expectedId = await socialProposalCreationId(intent.tenantId, idempotencyKey)
  const represented = await apiGet<SocialProposal>(paths.socialProposal(expectedId))
  if (represented.id !== expectedId) return false
  remember(intent, represented)
  return true
}
