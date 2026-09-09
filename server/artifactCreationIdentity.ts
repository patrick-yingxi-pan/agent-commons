import { createHash } from 'node:crypto'
import { ARTIFACT_CREATION_ID_PREFIX } from '../contract/artifactCreation.ts'

/** One logical direct creation maps to one opaque durable Artifact identity.
 * Tenant scope prevents the same caller key from aliasing another account. */
export function artifactCreationId(tenantId: string, idempotencyKey: string): string {
  const digest = createHash('sha256')
    .update(`${tenantId}\0${idempotencyKey}`)
    .digest('hex')
    .slice(0, 24)
  return `${ARTIFACT_CREATION_ID_PREFIX}${digest}`
}
