/** Transport and monotonic reconciliation for owner Agent-proposal verdicts. */
import type { AgentChangeProposal } from '../../contract/index.ts'
import { apiGet, apiPost } from './client.ts'
import { invalidate, invalidatePrefix, mutate, peek, setData } from './cache.ts'
import { agentProposalVerdictId } from './agentProposalVerdictIdentity.ts'
import { keys, paths } from './keys.ts'

export type AgentProposalVerdict = 'merge' | 'decline'

export interface AgentProposalVerdictIntent {
  readonly intentId: string
  readonly tenantId: string
  readonly agentId: string
  readonly proposalId: string
  readonly action: AgentProposalVerdict
  readonly note: string
}

const exactVerdict = (
  proposal: AgentChangeProposal,
  intent: AgentProposalVerdictIntent,
  expectedId: string,
): boolean => proposal.verdictId === expectedId &&
  proposal.status === (intent.action === 'merge' ? 'merged' : 'declined') &&
  (proposal.responseNote ?? '') === (intent.action === 'decline' ? intent.note : '')

/** Merge only terminal lifecycle proof. A delayed response must not replace a
 * newer comment thread, computed check, or later Agent-derived projection. */
function rememberVerdict(
  intent: AgentProposalVerdictIntent,
  proposal: AgentChangeProposal,
  expectedId: string,
): void {
  if (exactVerdict(proposal, intent, expectedId) && peek<AgentChangeProposal[]>(keys.agentProposals(intent.agentId))) {
    mutate<AgentChangeProposal[]>(keys.agentProposals(intent.agentId), (current) =>
      (current ?? []).map((candidate) => candidate.id === proposal.id
        ? {
            ...candidate,
            status: proposal.status,
            verdictId: proposal.verdictId,
            resolvedAt: proposal.resolvedAt,
            responseNote: proposal.responseNote,
          }
        : candidate),
    )
  }
  invalidate(keys.agentProposals(intent.agentId))
  invalidate(keys.workerAgents)
  invalidatePrefix(keys.directoryAgents())
}

export async function applyAgentProposalVerdict(
  intent: AgentProposalVerdictIntent,
  idempotencyKey: string,
): Promise<void> {
  const expectedId = await agentProposalVerdictId(
    intent.tenantId,
    intent.agentId,
    intent.proposalId,
    idempotencyKey,
  )
  const proposal = await apiPost<AgentChangeProposal>(
    intent.action === 'merge'
      ? paths.agentProposalMerge(intent.agentId, intent.proposalId)
      : paths.agentProposalDecline(intent.agentId, intent.proposalId),
    intent.action === 'decline' && intent.note ? { note: intent.note } : {},
    { idempotencyKey },
  )
  if (!exactVerdict(proposal, intent, expectedId)) {
    throw new Error('The Agent proposal verdict acknowledgement did not match the exact decision.')
  }
  rememberVerdict(intent, proposal, expectedId)
}

export async function reconcileAgentProposalVerdict(
  intent: AgentProposalVerdictIntent,
  _baseline: undefined,
  idempotencyKey: string,
): Promise<boolean> {
  const expectedId = await agentProposalVerdictId(
    intent.tenantId,
    intent.agentId,
    intent.proposalId,
    idempotencyKey,
  )
  const incoming = await apiGet<AgentChangeProposal[]>(paths.agentProposals(intent.agentId))
  const proposal = incoming.find((candidate) => candidate.id === intent.proposalId)
  const represented = proposal ? exactVerdict(proposal, intent, expectedId) : false
  if (!peek<AgentChangeProposal[]>(keys.agentProposals(intent.agentId))) {
    setData(keys.agentProposals(intent.agentId), incoming)
  }
  if (proposal && represented) {
    rememberVerdict(intent, proposal, expectedId)
  }
  return represented
}
