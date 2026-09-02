/** Derive a stable opaque run id from one client-owned logical Run-now key.
 * The run row is persisted, so this identity survives an in-memory HTTP
 * idempotency-cache restart without exposing the raw header value. */
import { createHash } from 'node:crypto'

export function manualScheduleRunId(idempotencyKey: string): string {
  const digest = createHash('sha256').update(idempotencyKey).digest('hex').slice(0, 24)
  return `run-manual-${digest}`
}
