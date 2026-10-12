import { invalidate, useQuery, type QueryState } from './cache.ts'
import { getCommissionMcpReview, type CommissionMcpSelection } from './commissionMcpReview.ts'
import { keys } from './keys.ts'
import type { CommissionMcpReview } from '../../contract/commissionMcpApi.ts'

export function useCommissionMcpReview(
  commissionId: string,
  selection?: CommissionMcpSelection,
  enabled = true,
): QueryState<CommissionMcpReview> {
  return useQuery(keys.commissionMcpPermission(commissionId, selection),
    () => getCommissionMcpReview(commissionId, selection), enabled)
}

export function refreshCommissionMcpReview(commissionId: string, selection?: CommissionMcpSelection): void {
  invalidate(keys.commissionMcpPermission(commissionId, selection))
}
