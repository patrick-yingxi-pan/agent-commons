/** Provider catalog refresh shares the connection exclusion domain so it cannot
 * race endpoint replacement, Session-secret rotation, or Provider removal. */
import type { ModelProvider } from '../../contract/index.ts'
import { refreshProviderModels } from '../api'
import {
  acquireProviderMutation,
  isProviderConnectionHeld,
  releaseProviderMutation,
} from './providerMutationHolds.ts'

async function withConnectionHold<T>(providerId: string, work: () => Promise<T>): Promise<T> {
  const lease = acquireProviderMutation('connection', providerId)
  if (!lease) throw new Error('Wait for the current provider change to settle before changing its connection.')
  try {
    return await work()
  } finally {
    releaseProviderMutation(lease)
  }
}

export function refreshProviderCatalog(providerId: string): Promise<ModelProvider> {
  return withConnectionHold(providerId, () => refreshProviderModels(providerId))
}

export { isProviderConnectionHeld }
