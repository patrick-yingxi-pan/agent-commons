import type { RoutineMcpDecisionRequest, RoutineMcpDecisionResponse, RoutineMcpReview } from '../../contract/routineMcpApi.ts'
import { AccountSwitchedError, apiGet, apiPost, type ApiMutationOptions } from './client.ts'
import type { Identity } from '../../contract/identity.ts'
import { peek, setData } from './cache.ts'
import { keys, paths } from './keys.ts'
import { accountGeneration, activeAccount } from './account.ts'

export function getRoutineMcpReview(
  routineId: string,
  expectedSessionUserId?: string | null,
  signal?: AbortSignal,
  expectedScope?: { tenantId: string; userId: string; accountGeneration: number },
): Promise<RoutineMcpReview> {
  return apiGet<RoutineMcpReview>(paths.scheduleMcpPermission(routineId), { expectedSessionUserId, signal }).then((review) => {
    const identity = peek<Identity>(keys.me)
    const account = activeAccount()
    if (expectedScope && (accountGeneration() !== expectedScope.accountGeneration ||
        identity?.tenant.id !== expectedScope.tenantId || identity.user.id !== expectedScope.userId ||
        (account && (account.tenantId !== expectedScope.tenantId || account.userId !== expectedScope.userId)))) {
      throw new AccountSwitchedError('Routine MCP review identity changed')
    }
    if (review.routineId !== routineId) throw new Error('The MCP review addressed a different routine.')
    return review
  })
}

export async function decideRoutineMcp(
  routineId: string,
  request: RoutineMcpDecisionRequest,
  options: ApiMutationOptions = {},
): Promise<RoutineMcpDecisionResponse> {
  const issuedGeneration = accountGeneration()
  const response = await apiPost<RoutineMcpDecisionResponse>(
    paths.scheduleMcpPermission(routineId),
    request,
    { ...options, idempotencyKey: request.requestId },
  )
  if (response.routineId !== routineId || response.review.routineId !== routineId ||
      response.requestId !== request.requestId || typeof response.decisionId !== 'string' || !response.decisionId) {
    throw new Error('The MCP approval response addressed a different routine.')
  }
  // A transition may run after the transport's final check but before this
  // continuation. Fence the synchronous cache write itself, including an
  // away-and-back switch to the same identity.
  if (accountGeneration() !== issuedGeneration) throw new AccountSwitchedError('Routine MCP decision identity changed')
  setData(keys.scheduleMcpPermission(routineId), response.review)
  return response
}
