import {
  discardProviderCatalogRefresh,
  retryProviderCatalogRefresh,
  useProviderCatalogRefreshStatus,
} from '../controller/providerCatalogRefreshMutations.ts'
import { RevisionedMutationNotice } from './RevisionedMutationNotice.tsx'

/** One shell recovery surface for endpoint-owned model-catalog refresh. */
export function ProviderCatalogRefreshMutationNotice() {
  const mutation = useProviderCatalogRefreshStatus()
  return (
    <RevisionedMutationNotice
      kind="provider-catalog-refresh"
      mutation={mutation}
      pendingLabel="Refreshing model catalog…"
      onRetry={retryProviderCatalogRefresh}
      onDiscard={discardProviderCatalogRefresh}
    />
  )
}
