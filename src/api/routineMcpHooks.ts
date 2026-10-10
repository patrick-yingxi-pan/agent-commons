import { invalidate, useQuery, type QueryState } from './cache.ts'
import { getRoutineMcpReview } from './routineMcpReview.ts'
import { keys } from './keys.ts'
import type { RoutineMcpReview } from '../../contract/routineMcpApi.ts'

export function useRoutineMcpReview(routineId: string, enabled = true): QueryState<RoutineMcpReview> {
  return useQuery(keys.scheduleMcpPermission(routineId), () => getRoutineMcpReview(routineId), enabled)
}

export function refreshRoutineMcpReview(routineId: string): void {
  invalidate(keys.scheduleMcpPermission(routineId))
}
