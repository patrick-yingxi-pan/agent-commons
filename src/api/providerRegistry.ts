/** Account-fenced reads of the provider registry.
 *
 * The query cache may re-run this fetcher after an SSE or post-ack invalidation,
 * so the source must be captured inside the fetch, never in a hook closure.
 */
import type { ModelProvider } from '../../contract/index.ts'
import { apiGet } from './client.ts'
import { paths } from './keys.ts'
import { assertProviderCreationSource, captureProviderCreationSource } from './providerCreationRevision.ts'

export async function fetchProviderRegistry(): Promise<ModelProvider[]> {
  const identity = captureProviderCreationSource()
  const providers = await apiGet<ModelProvider[]>(paths.providers, {
    expectedSessionUserId: identity.sourceUserId,
  })
  assertProviderCreationSource(identity)
  return providers
}
