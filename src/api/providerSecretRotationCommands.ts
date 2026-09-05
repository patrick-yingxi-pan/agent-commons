/** Transport and exact authoritative recovery for Session-secret rotation. */
import type { CreatedProvider, ModelProvider, RotateProviderSecretRequest } from '../../contract/index.ts'
import { ApiRequestError, apiDelete, apiGet, apiPost } from './client.ts'
import { invalidate } from './cache.ts'
import { keys, paths } from './keys.ts'
import { providerSecretRotationId } from './providerSecretRotationIdentity.ts'

export interface ProviderSecretRotationIntent {
  identityKey: string
  tenantId: string
  providerId: string
  expectedRevision: number
  intentId: string
}

export interface ProviderSecretRotationResult {
  provider: ModelProvider
  secret: string
}

const requestFor = (intent: ProviderSecretRotationIntent): RotateProviderSecretRequest => ({
  expectedRevision: intent.expectedRevision,
})

async function exactResult(
  intent: ProviderSecretRotationIntent,
  idempotencyKey: string,
  provider: CreatedProvider,
): Promise<ProviderSecretRotationResult | null> {
  const expectedId = await providerSecretRotationId(intent.tenantId, intent.providerId, idempotencyKey)
  if (
    provider.id !== intent.providerId
    || provider.secretRotationReceipt?.id !== expectedId
    || provider.secretRotationReceipt.state !== 'applied'
    || !provider.secret
  ) return null
  const { secret, ...publicProvider } = provider
  invalidate(keys.providers)
  return { provider: publicProvider, secret }
}

export async function applyProviderSecretRotation(
  intent: ProviderSecretRotationIntent,
  idempotencyKey: string,
): Promise<ProviderSecretRotationResult> {
  const provider = await apiPost<CreatedProvider>(
    paths.providerRotate(intent.providerId),
    requestFor(intent),
    { idempotencyKey },
  )
  const result = await exactResult(intent, idempotencyKey, provider)
  if (!result) throw new Error('The provider returned a mismatched secret-rotation receipt.')
  return result
}

/** Read before repeating the same keyed POST. Only the exact current applied
 * receipt authorizes the server to reconstruct and return its active bearer. */
export async function recoverProviderSecretRotation(
  intent: ProviderSecretRotationIntent,
  idempotencyKey: string,
): Promise<ProviderSecretRotationResult | null> {
  const expectedId = await providerSecretRotationId(intent.tenantId, intent.providerId, idempotencyKey)
  const represented = await apiGet<ModelProvider>(paths.provider(intent.providerId))
  if (
    represented.secretRotationReceipt?.id !== expectedId
    || represented.secretRotationReceipt.state !== 'applied'
  ) return null
  const recovered = await apiPost<CreatedProvider>(
    paths.providerRotate(intent.providerId),
    requestFor(intent),
    { idempotencyKey },
  )
  return exactResult(intent, idempotencyKey, recovered)
}

/** Cancel is a durable revision-fenced write, not a local forget. */
export async function cancelProviderSecretRotation(
  intent: ProviderSecretRotationIntent,
  idempotencyKey: string,
): Promise<void> {
  const expectedId = await providerSecretRotationId(intent.tenantId, intent.providerId, idempotencyKey)
  let provider: ModelProvider
  try {
    provider = await apiDelete<ModelProvider>(
      paths.providerRotate(intent.providerId),
      requestFor(intent),
      { idempotencyKey },
    )
  } catch (error) {
    if (!(error instanceof ApiRequestError) || error.status !== 409) throw error
    const current = await apiGet<ModelProvider>(paths.provider(intent.providerId))
    if (
      current.secretRotationReceipt?.id === expectedId
      && current.secretRotationReceipt.state === 'applied'
    ) throw error
    // Any later connection revision already fences this request's frozen POST.
    // Treat that authoritative state as safe cancellation without overwriting the
    // newer operation's receipt merely to record an obsolete tombstone.
    if ((current.connectionRevision ?? 0) !== intent.expectedRevision) {
      invalidate(keys.providers)
      return
    }
    throw error
  }
  if (
    provider.id !== intent.providerId
    || provider.secretRotationReceipt?.id !== expectedId
    || provider.secretRotationReceipt.state !== 'cancelled'
  ) throw new Error('The provider returned a mismatched secret-rotation cancellation receipt.')
  invalidate(keys.providers)
}
