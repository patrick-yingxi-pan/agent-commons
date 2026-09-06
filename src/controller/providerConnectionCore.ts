/** Transport-neutral provider connection sequence. The shell-specific device
 * vault and HTTP command are injected so ordering and failure recovery remain
 * executable without importing a renderer/network runtime into the lock. */
import type {
  ModelProvider,
  ProviderConnectionPatch,
  UpdateProviderConnectionRequest,
} from '../../contract/index.ts'

/** One submitted intent owns one logical replacement. Mutable acknowledgement
 * state lets shell Retry reuse the exact idempotency key and provisioned
 * credential reference after the originating dialog leaves. */
export interface ProviderConnectionAttempt {
  readonly patch: ProviderConnectionPatch
  readonly expectedRevision: number
  readonly idempotencyKey: string
  deviceSecret?: string
  reference?: string
  uncertain: boolean
}

export function createProviderConnectionAttempt(
  patch: ProviderConnectionPatch,
  expectedRevision: number,
  deviceSecret: string | undefined,
  idempotencyKey: string,
): ProviderConnectionAttempt {
  return { patch: { ...patch }, expectedRevision, idempotencyKey, deviceSecret, uncertain: false }
}

export interface ProviderConnectionDependencies {
  provision(secret: string): Promise<string>
  update(
    providerId: string,
    patch: UpdateProviderConnectionRequest,
    idempotencyKey: string,
  ): Promise<ModelProvider>
  bind(reference: string, providerId: string): Promise<void>
  discard(reference: string): Promise<void>
  /** True only when the response proves the server did not apply the request. */
  definitiveFailure(error: unknown): boolean
}

export async function replaceProviderConnectionCore(
  providerId: string,
  attempt: ProviderConnectionAttempt,
  dependencies: ProviderConnectionDependencies,
): Promise<ModelProvider> {
  if (!attempt.reference && attempt.deviceSecret) {
    attempt.reference = await dependencies.provision(attempt.deviceSecret)
    // The vault reference is sufficient for every later retry. Do not retain
    // another in-memory copy of the raw key beyond successful provisioning.
    attempt.deviceSecret = undefined
  }
  const request: UpdateProviderConnectionRequest = {
    ...attempt.patch,
    expectedRevision: attempt.expectedRevision,
    ...(attempt.reference ? { apiKeyEnv: attempt.reference } : {}),
  }

  let provider: ModelProvider
  try {
    provider = await dependencies.update(providerId, request, attempt.idempotencyKey)
  } catch (error) {
    const definitive = dependencies.definitiveFailure(error)
    attempt.uncertain = !definitive
    if (definitive && attempt.reference) {
      await dependencies.discard(attempt.reference).catch(() => {})
      attempt.reference = undefined
    }
    throw error
  }

  // Provision already placed the key in the supervised backend environment.
  // Binding makes vault cleanup exact; if it is interrupted, startup
  // reconciliation repairs it from the acknowledged server reference.
  attempt.uncertain = false
  if (attempt.reference) await dependencies.bind(attempt.reference, providerId).catch(() => {})
  return provider
}
