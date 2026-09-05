/** Durable identity for one logical Session-provider secret rotation. The tenant
 * and provider are both part of the digest, so a key cannot alias across either
 * account scope or credential boundary. */
import { createHash } from 'node:crypto'

export function providerSecretRotationId(
  tenantId: string,
  providerId: string,
  idempotencyKey: string,
): string {
  const digest = createHash('sha256')
    .update(`${tenantId}\0${providerId}\0${idempotencyKey}`)
    .digest('hex')
    .slice(0, 24)
  return `provider-secret-rotation-${digest}`
}
