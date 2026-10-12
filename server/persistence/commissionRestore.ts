/** Trust boundary applied only when an operator explicitly restores a backup.
 * Ordinary load/restart keeps its existing recovery semantics. */
import type { PersistedState } from './format.ts'
import { CommissionMcpRegistry, emptyCommissionMcpRegistry } from '../commissionMcpRegistry.ts'
import { commissionMcpClaimId } from '../commissionMcpClaim.ts'
import { parseUsageReservations } from '../usageRegistry.ts'

export function prepareCommissionRestoreState(state: PersistedState, now = Date.now()): PersistedState {
  const workIds = (state.openSubGoals ?? [])
    .filter(item => item.status === 'open' && item.type === 'mcp.mutate')
    .map(item => commissionMcpClaimId(item.projectId, item.id))
  if (state.commissionMcp !== undefined || workIds.length) {
    const registry = new CommissionMcpRegistry(state.commissionMcp ?? emptyCommissionMcpRegistry())
    registry.restoreBoundary(workIds, now)
    state.commissionMcp = registry.snapshot()
  }
  if (state.usageReservations !== undefined) {
    state.usageReservations = parseUsageReservations(state.usageReservations).map(row =>
      row.status === 'active' ? { ...row, status: 'uncertain' as const } : row)
  }
  return state
}
