/** Durable identity for one logical Contribution declaration. Project and
 * tenant both participate so a retry key cannot alias work across either wall. */
import { createHash } from 'node:crypto'

export function contributionCreationId(
  tenantId: string,
  projectId: string,
  idempotencyKey: string,
): string {
  const digest = createHash('sha256')
    .update(`${tenantId}\0${projectId}\0${idempotencyKey}`)
    .digest('hex')
    .slice(0, 24)
  return `contrib-new-${digest}`
}
