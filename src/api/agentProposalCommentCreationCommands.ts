/** Transport and monotonic reconciliation for Agent proposal comments. */
import type { AgentChangeProposal, WorkItemComment } from '../../contract/index.ts'
import { apiGet, apiPost } from './client.ts'
import { invalidate, mutate, peek, setData } from './cache.ts'
import { agentProposalCommentCreationId } from './agentProposalCommentCreationIdentity.ts'
import { keys, paths } from './keys.ts'

export interface AgentProposalCommentCreationIntent {
  readonly intentId: string
  readonly tenantId: string
  readonly agentId: string
  readonly proposalId: string
  readonly body: string
}

const exactComment = (
  proposal: AgentChangeProposal,
  intent: AgentProposalCommentCreationIntent,
  expectedId: string,
): WorkItemComment | undefined => proposal.comments?.find((comment) =>
  comment.id === expectedId && comment.body === intent.body)

/** Append only the exact receipt. A delayed acknowledgement must not replace a
 * later verdict, computed check, or any newer discussion history. */
function rememberComment(
  intent: AgentProposalCommentCreationIntent,
  proposal: AgentChangeProposal,
  expectedId: string,
): void {
  const receipt = exactComment(proposal, intent, expectedId)
  if (receipt && peek<AgentChangeProposal[]>(keys.agentProposals(intent.agentId))) {
    mutate<AgentChangeProposal[]>(keys.agentProposals(intent.agentId), (current) =>
      (current ?? []).map((candidate) => {
        if (candidate.id !== proposal.id) return candidate
        if (candidate.comments?.some((comment) => comment.id === receipt.id)) return candidate
        return {
          ...candidate,
          comments: [...(candidate.comments ?? []), receipt].sort((a, b) => a.at - b.at),
        }
      }),
    )
  }
  invalidate(keys.agentProposals(intent.agentId))
}

export async function applyAgentProposalCommentCreation(
  intent: AgentProposalCommentCreationIntent,
  idempotencyKey: string,
): Promise<void> {
  const expectedId = await agentProposalCommentCreationId(
    intent.tenantId,
    intent.agentId,
    intent.proposalId,
    idempotencyKey,
  )
  const proposal = await apiPost<AgentChangeProposal>(
    paths.agentProposalComments(intent.agentId, intent.proposalId),
    { body: intent.body },
    { idempotencyKey },
  )
  if (!exactComment(proposal, intent, expectedId)) {
    throw new Error('The Agent proposal comment acknowledgement did not match the exact submitted comment.')
  }
  rememberComment(intent, proposal, expectedId)
}

export async function reconcileAgentProposalCommentCreation(
  intent: AgentProposalCommentCreationIntent,
  _baseline: undefined,
  idempotencyKey: string,
): Promise<boolean> {
  const expectedId = await agentProposalCommentCreationId(
    intent.tenantId,
    intent.agentId,
    intent.proposalId,
    idempotencyKey,
  )
  const incoming = await apiGet<AgentChangeProposal[]>(paths.agentProposals(intent.agentId))
  const proposal = incoming.find((candidate) => candidate.id === intent.proposalId)
  const receipt = proposal ? exactComment(proposal, intent, expectedId) : undefined
  if (!peek<AgentChangeProposal[]>(keys.agentProposals(intent.agentId))) {
    setData(keys.agentProposals(intent.agentId), incoming)
  } else if (proposal && receipt) {
    rememberComment(intent, proposal, expectedId)
  }
  return receipt !== undefined
}
