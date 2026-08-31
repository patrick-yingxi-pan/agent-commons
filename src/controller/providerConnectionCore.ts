/** Transport-neutral provider connection sequence. The shell-specific device
 * vault and HTTP command are injected so ordering and failure recovery remain
 * executable without importing a renderer/network runtime into the lock. */
import type { ModelProvider, UpdateProviderConnectionRequest } from '../../contract/index.ts'

export interface ProviderConnectionDependencies {
  provision(secret: string): Promise<string>
  update(providerId: string, patch: UpdateProviderConnectionRequest): Promise<ModelProvider>
  bind(reference: string, providerId: string): Promise<void>
  discard(reference: string): Promise<void>
}

export async function replaceProviderConnectionCore(
  providerId: string,
  patch: UpdateProviderConnectionRequest,
  deviceSecret: string | undefined,
  dependencies: ProviderConnectionDependencies,
): Promise<ModelProvider> {
  let reference: string | undefined
  const request: UpdateProviderConnectionRequest = { ...patch }
  if (deviceSecret) {
    reference = await dependencies.provision(deviceSecret)
    request.apiKeyEnv = reference
  }

  let provider: ModelProvider
  try {
    provider = await dependencies.update(providerId, request)
  } catch (error) {
    if (reference) await dependencies.discard(reference).catch(() => {})
    throw error
  }

  // Provision already placed the key in the supervised backend environment.
  // Binding makes vault cleanup exact; if it is interrupted, startup
  // reconciliation repairs it from the acknowledged server reference.
  if (reference) await dependencies.bind(reference, providerId).catch(() => {})
  return provider
}
