/** Durable identity for one logical change offer. The active tenant participates
 * so the retained transport key cannot alias another account's proposal. */
import { createHash } from 'node:crypto'

export function socialProposalCreationId(tenantId: string, idempotencyKey: string): string {
  const digest = createHash('sha256')
    .update(`${tenantId}\0${idempotencyKey}`)
    .digest('hex')
    .slice(0, 24)
  return `sprop-new-${digest}`
}
