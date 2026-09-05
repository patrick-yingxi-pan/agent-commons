import { createHash } from 'node:crypto'

/** Durable public receipt identity for one exact Agent-proposal comment. */
const AGENT_PROPOSAL_COMMENT_CREATION_ID = /^agent-proposal-comment-new-[a-f0-9]{24}$/

export function agentProposalCommentCreationId(
  tenantId: string,
  agentId: string,
  proposalId: string,
  idempotencyKey: string,
): string {
  const digest = createHash('sha256')
    .update(`${tenantId}\0${agentId}\0${proposalId}\0${idempotencyKey}`)
    .digest('hex')
    .slice(0, 24)
  return `agent-proposal-comment-new-${digest}`
}

export const isAgentProposalCommentCreationId = (id: string): boolean =>
  AGENT_PROPOSAL_COMMENT_CREATION_ID.test(id)
