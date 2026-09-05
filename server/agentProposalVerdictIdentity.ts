import { createHash } from 'node:crypto'

/** Durable public receipt identity for one owner Agent-proposal verdict. */
const AGENT_PROPOSAL_VERDICT_ID = /^agent-proposal-verdict-[a-f0-9]{24}$/

export function agentProposalVerdictId(
  tenantId: string,
  agentId: string,
  proposalId: string,
  idempotencyKey: string,
): string {
  const digest = createHash('sha256')
    .update(`${tenantId}\0${agentId}\0${proposalId}\0${idempotencyKey}`)
    .digest('hex')
    .slice(0, 24)
  return `agent-proposal-verdict-${digest}`
}

export const isAgentProposalVerdictId = (id: string): boolean =>
  AGENT_PROPOSAL_VERDICT_ID.test(id)
