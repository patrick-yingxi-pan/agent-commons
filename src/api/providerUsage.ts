import type { ProviderUsageSnapshot } from '../../contract/providerUsage.ts'
import { apiGet } from './client.ts'
import { invalidate, useQuery, type QueryState } from './cache.ts'
import { keys, paths } from './keys.ts'

/** Inspection reads only local observations; reopening revalidates without
 * contacting any provider. Only Check balance performs a provider read. */
export function useProviderUsage(providerId: string, modelId?: string): QueryState<ProviderUsageSnapshot> {
  return useQuery(keys.providerUsage(providerId, modelId),
    () => apiGet<ProviderUsageSnapshot>(paths.providerUsage(providerId, modelId)), true, true)
}

export async function refreshProviderBalance(providerId: string, modelId?: string): Promise<void> {
  // Let the authoritative GET settle the cache. A direct setData here could
  // overwrite a newer connection read after an intervening provider change.
  await apiGet<ProviderUsageSnapshot>(paths.providerUsageBalance(providerId, modelId))
  invalidate(keys.providerUsage(providerId, modelId))
}
