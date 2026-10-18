/** The always-available rail needs only private request summaries. Keep detail
 * reads and decision commands behind the existing on-demand request surface. */
import type { AgentRequestSummary } from '../../contract/agentRequests.ts'
import type { Identity } from '../../contract/identity.ts'
import { apiGet, type ApiMutationOptions } from './client.ts'
import { peek, useQuery } from './cache.ts'
import { keys, paths } from './keys.ts'

/** Shared source and deadline for both summary reads and private decisions. */
export function privateOptions(options: ApiMutationOptions = {}): ApiMutationOptions {
  const identity = peek<Identity>(keys.me)
  if (!identity) throw new Error('Wait for the current account before opening private requests.')
  return { expectedSessionUserId: identity.via === 'session' ? identity.user.id : null,
    signal: AbortSignal.timeout(30_000), ...options }
}

export function useAgentRequests(enabled = true) {
  return useQuery<AgentRequestSummary[]>(keys.agentRequests, () => apiGet(paths.agentRequests, privateOptions()), enabled, true)
}
