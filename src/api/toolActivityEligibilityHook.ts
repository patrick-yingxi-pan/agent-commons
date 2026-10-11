/** Conditional consent reads load with the deferred tool card, not the shell. */
import { useQuery, type QueryState } from './cache.ts'
import { useMe } from './hooks.ts'
import { keys } from './keys.ts'
import { readToolActivityEligibility, type ToolActivityEligibility } from './toolActivityEligibility.ts'

/** Fresh actor-specific controls; unresolved or failed truth grants nothing. */
export function useToolActivityEligibility(sessionId: string): QueryState<ToolActivityEligibility> {
  const identity = useMe().data
  const enabled = !!sessionId && identity !== undefined
  const key = enabled
    ? keys.toolActivityEligibility(sessionId, identity!.tenant.id, identity!.user.id)
    : `tool-activity-eligibility:unresolved:${sessionId}`
  return useQuery(key, () => readToolActivityEligibility(sessionId, identity?.via === 'session' ? identity.user.id : null), enabled, true)
}
