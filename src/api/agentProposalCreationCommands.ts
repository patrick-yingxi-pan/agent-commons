/** Transport and exact cache reconciliation for Agent proposal creation. */
import type { AgentChangeProposal } from '../../contract/index.ts'
import { apiGet, apiPost } from './client.ts'
import { invalidate, mutate, peek, setData } from './cache.ts'
import { agentProposalCreationId } from './agentProposalCreationIdentity.ts'
import type { AgentProposalCreationIntent } from './agentProposalCreationRevision.ts'
import { keys, paths } from './keys.ts'

function remember(agentId: string, proposal: AgentChangeProposal): void {
  if (peek<AgentChangeProposal[]>(keys.agentProposals(agentId))) {
    mutate<AgentChangeProposal[]>(keys.agentProposals(agentId), (current) => {
      const rows = current ?? []
      return rows.some((candidate) => candidate.id === proposal.id)
        ? rows.map((candidate) => candidate.id === proposal.id ? proposal : candidate)
        : [proposal, ...rows]
    })
  }
  invalidate(keys.agentProposals(agentId))
}

export async function applyAgentProposalCreation(
  intent: AgentProposalCreationIntent,
  idempotencyKey: string,
): Promise<void> {
  const proposal = await apiPost<AgentChangeProposal>(
    paths.agentProposals(intent.agentId),
    intent.request,
    { idempotencyKey },
  )
  remember(intent.agentId, proposal)
}

/** Prove only the proposal derived from this author, Agent, and logical form. */
export async function reconcileAgentProposalCreation(
  intent: AgentProposalCreationIntent,
  idempotencyKey: string,
): Promise<boolean> {
  const expectedId = await agentProposalCreationId(
    intent.tenantId,
    intent.agentId,
    idempotencyKey,
  )
  const incoming = await apiGet<AgentChangeProposal[]>(paths.agentProposals(intent.agentId))
  const represented = incoming.find((proposal) => proposal.id === expectedId)
  if (!peek<AgentChangeProposal[]>(keys.agentProposals(intent.agentId))) {
    setData(keys.agentProposals(intent.agentId), incoming)
  } else if (represented) {
    remember(intent.agentId, represented)
  }
  if (!represented) return false
  return true
}
