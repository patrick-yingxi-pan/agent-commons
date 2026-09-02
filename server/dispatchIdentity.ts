import { createHash } from 'node:crypto'

/** Derive the durable row identity for one tenant-owned logical Dispatch act.
 * Neither the raw tenant nor the retained transport key crosses into the feed. */
export function manualDispatchRunId(tenantId: string, idempotencyKey: string): string {
  const digest = createHash('sha256')
    .update(`${tenantId}\0${idempotencyKey}`)
    .digest('hex')
    .slice(0, 24)
  return `d-new-${digest}`
}
