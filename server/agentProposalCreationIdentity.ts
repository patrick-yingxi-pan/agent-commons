/** Durable identity for one logical Agent change proposal. The proposing
 * tenant and published Agent both participate so a retry key cannot alias an
 * authored review request across either authority boundary. */
import { createHash } from 'node:crypto'

const AGENT_PROPOSAL_CREATION_ID = /^agent-proposal-new-[a-f0-9]{24}$/

export function agentProposalCreationId(
  tenantId: string,
  agentId: string,
  idempotencyKey: string,
): string {
  const digest = createHash('sha256')
    .update(`${tenantId}\0${agentId}\0${idempotencyKey}`)
    .digest('hex')
    .slice(0, 24)
  return `agent-proposal-new-${digest}`
}

export const isAgentProposalCreationId = (id: string): boolean =>
  AGENT_PROPOSAL_CREATION_ID.test(id)
