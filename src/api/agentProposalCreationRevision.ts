import type { ProposeAgentChangeRequest } from '../../contract/index.ts'

/** One submitted Agent-improvement form owns one immutable authored request. */
export interface AgentProposalCreationIntent {
  readonly tenantId: string
  readonly agentId: string
  readonly intentId: string
  readonly request: ProposeAgentChangeRequest
}

export const agentProposalCreationAnchorId = (agentId: string): string =>
  `agent-proposal-create:${agentId}`

export const agentProposalCreationResourceId = (intent: AgentProposalCreationIntent): string =>
  `${agentProposalCreationAnchorId(intent.agentId)}:${intent.intentId}`
