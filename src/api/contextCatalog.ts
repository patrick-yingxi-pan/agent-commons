import type { ContextCatalog } from '../../contract/contexts.ts'
import { invalidate, useQuery } from './cache.ts'
import { apiGet } from './client.ts'
import { keys, paths } from './keys.ts'

const readContextCatalog = () => apiGet<ContextCatalog>(paths.contextCatalog, {
  signal: AbortSignal.timeout(30_000),
})

/** Candidate availability is backend truth, not a bundled demo fallback.
 * Account/epoch resets use the ordinary shared cache generation fence. */
export function useContextCatalog(enabled = true) {
  const query = useQuery(keys.contextCatalog, readContextCatalog, enabled)
  return { ...query, data: query.status === 'success' ? query.data : undefined }
}

export const retryContextCatalog = () => invalidate(keys.contextCatalog)
