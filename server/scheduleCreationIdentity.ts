import { createHash } from 'node:crypto'

/** Derive one durable routine identity from its tenant and logical create key.
 * Neither raw value is exposed in the stored/public identifier. */
export function scheduleCreationId(tenantId: string, idempotencyKey: string): string {
  const digest = createHash('sha256')
    .update(`${tenantId}\0${idempotencyKey}`)
    .digest('hex')
    .slice(0, 24)
  return `s-new-${digest}`
}
