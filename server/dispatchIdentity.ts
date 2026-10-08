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

/** The private conversation has a disjoint creation/retirement namespace. */
export function dispatchSessionId(runId: string): string {
  if (!/^d-new-[a-f0-9]{24}$/.test(runId)) throw new Error('Invalid real Dispatch identity')
  return `sess-dispatch-${runId.slice('d-new-'.length)}`
}

export const isDispatchSessionId = (id: string): boolean => /^sess-dispatch-[a-f0-9]{24}$/.test(id)
