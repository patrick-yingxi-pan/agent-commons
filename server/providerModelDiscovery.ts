/** Pre-save discovery validates an explicit private connection, but never mints
 * a provider, probes generation, binds a credential or records model usage. */
import { isEndpointProtocol } from '../contract/providers.ts'
import type { DiscoverProviderModelsRequest, DiscoverProviderModelsResult } from '../contract/providerDiscovery.ts'
import { ValidationError } from './conflict.ts'
import { validApiKeyEnv } from './data/providers.ts'
import { fetchUnregisteredProviderModels } from './generate.ts'

export class ProviderModelDiscoveryError extends Error {
  constructor() {
    super('The endpoint did not provide a complete model list. Check its URL, protocol and credential, or enter a model ID manually.')
    this.name = 'ProviderModelDiscoveryError'
  }
}

export function providerModelDiscoveryRequest(value: unknown): DiscoverProviderModelsRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ValidationError('A discovery request is required.')
  const input = value as Record<string, unknown>
  if (Object.keys(input).some(field => !['protocol', 'baseURL', 'apiKeyEnv'].includes(field))) {
    throw new ValidationError('The discovery request contains unsupported fields.')
  }
  if (!isEndpointProtocol(input.protocol)) throw new ValidationError('Discovery requires an explicit supported protocol.')
  if (typeof input.baseURL !== 'string' || !input.baseURL.trim() || input.baseURL.trim().length > 2_048) {
    throw new ValidationError('Discovery requires an endpoint URL of at most 2048 characters.')
  }
  const baseURL = input.baseURL.trim()
  let url: URL
  try { url = new URL(baseURL) } catch { throw new ValidationError('Discovery requires a valid HTTP or HTTPS endpoint URL.') }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new ValidationError('Discovery requires an HTTP or HTTPS endpoint URL without credentials, query or fragment.')
  }
  let apiKeyEnv: string | undefined
  if (Object.hasOwn(input, 'apiKeyEnv')) {
    if (typeof input.apiKeyEnv !== 'string' || !input.apiKeyEnv.trim() || input.apiKeyEnv.trim().length > 128 ||
      !validApiKeyEnv(input.apiKeyEnv.trim())) {
      throw new ValidationError('A discovery credential must reference a PROVIDER_* environment variable of at most 128 characters.')
    }
    apiKeyEnv = input.apiKeyEnv.trim()
  }
  return { protocol: input.protocol, baseURL, ...(apiKeyEnv ? { apiKeyEnv } : {}) }
}

export async function discoverProviderModels(value: unknown): Promise<DiscoverProviderModelsResult> {
  const request = providerModelDiscoveryRequest(value)
  const models = await fetchUnregisteredProviderModels(request)
  if (!models) throw new ProviderModelDiscoveryError()
  return { models }
}
