import type { CommissionMcpDecisionRequest, CommissionMcpDecisionResponse, CommissionMcpReview } from '../../contract/commissionMcpApi.ts'
import { AccountSwitchedError, apiGet, apiPost, type ApiMutationOptions } from './client.ts'
import type { Identity } from '../../contract/identity.ts'
import { peek, setData } from './cache.ts'
import { keys, paths } from './keys.ts'
import { accountGeneration, activeAccount } from './account.ts'

export interface CommissionMcpSelection { providerId: string; modelId: string }
export interface CommissionMcpExpectedScope { tenantId: string; userId: string; accountGeneration: number }

export function getCommissionMcpReview(
  commissionId: string,
  selection?: CommissionMcpSelection,
  expectedSessionUserId?: string | null,
  signal?: AbortSignal,
  expectedScope?: CommissionMcpExpectedScope,
): Promise<CommissionMcpReview> {
  return apiGet<CommissionMcpReview>(paths.commissionMcpPermission(commissionId, selection), {
    expectedSessionUserId, signal: signal ?? AbortSignal.timeout(30_000),
  }).then((review) => {
    const identity = peek<Identity>(keys.me)
    const account = activeAccount()
    if (expectedScope && (accountGeneration() !== expectedScope.accountGeneration ||
        identity?.tenant.id !== expectedScope.tenantId || identity.user.id !== expectedScope.userId ||
        (account && (account.tenantId !== expectedScope.tenantId || account.userId !== expectedScope.userId)))) {
      throw new AccountSwitchedError('Commission MCP review identity changed')
    }
    if (review.commissionId !== commissionId) throw new Error('The MCP review addressed a different Commission.')
    return review
  })
}

export async function decideCommissionMcp(
  commissionId: string,
  request: CommissionMcpDecisionRequest,
  options: ApiMutationOptions = {},
): Promise<CommissionMcpDecisionResponse> {
  const issuedGeneration = accountGeneration()
  const response = await apiPost<CommissionMcpDecisionResponse>(
    paths.commissionMcpPermission(commissionId), request,
    { ...options, idempotencyKey: request.requestId },
  )
  if (response.commissionId !== commissionId || response.review.commissionId !== commissionId ||
      response.requestId !== request.requestId || typeof response.decisionId !== 'string' || !response.decisionId) {
    throw new Error('The Commission MCP acknowledgement did not identify this decision.')
  }
  if (accountGeneration() !== issuedGeneration) throw new AccountSwitchedError('Commission MCP decision identity changed')
  const selection = request.action === 'approve'
    ? { providerId: request.approval.execution.providerId, modelId: request.approval.execution.modelId }
    : undefined
  setData(keys.commissionMcpPermission(commissionId, selection), response.review)
  return response
}
