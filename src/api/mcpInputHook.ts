import { useQuery } from './cache.ts'
import { useMe } from './hooks.ts'
import { keys } from './keys.ts'
import { readMcpInput } from './mcpInputCommands.ts'

export function useMcpInput(sessionId: string, activityId: string, decisionId: string) {
  const identity = useMe().data
  const enabled = !!decisionId && !!identity
  const key = identity
    ? keys.mcpInput(sessionId, activityId, decisionId, identity.tenant.id, identity.user.id)
    : `${keys.mcpInputPrefix(sessionId)}:unresolved`
  return useQuery(key, () => readMcpInput({ sessionId, activityId, decisionId,
    sourceUserId: identity?.via === 'session' ? identity.user.id : null }), enabled, true)
}
