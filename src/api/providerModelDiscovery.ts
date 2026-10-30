import type { DiscoverProviderModelsRequest, DiscoverProviderModelsResult } from '../../contract/providerDiscovery.ts'
import { apiPost } from './client.ts'
import { paths } from './keys.ts'
import { assertProviderCreationSource, type ProviderCreationSource } from './providerCreationRevision.ts'

/** A transient catalog read, never a registry refresh or connection probe. */
export async function discoverProviderModels(
  request: DiscoverProviderModelsRequest,
  source: ProviderCreationSource,
  signal: AbortSignal,
): Promise<DiscoverProviderModelsResult> {
  assertProviderCreationSource(source)
  const result = await apiPost<DiscoverProviderModelsResult>(paths.providerModelsDiscover, request, {
    signal, expectedSessionUserId: source.sourceUserId,
  })
  assertProviderCreationSource(source)
  return result
}
