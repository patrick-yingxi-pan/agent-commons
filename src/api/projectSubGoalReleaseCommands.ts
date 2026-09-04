/** Transport and authoritative desired-state reconciliation for claim release. */
import type { ProjectSubGoal, Reservation } from '../../contract/index.ts'
import { apiGet, apiPost } from './client.ts'
import { invalidate, mutate, peek, setData } from './cache.ts'
import { keys, paths } from './keys.ts'

export interface ProjectSubGoalReleaseIntent {
  readonly intentId: string
  readonly tenantId: string
  readonly projectId: string
  readonly reservationId: string
  readonly subGoal: string
}

function acceptReleased(intent: ProjectSubGoalReleaseIntent): void {
  if (peek<ProjectSubGoal[]>(keys.projectSubGoals(intent.projectId))) {
    mutate<ProjectSubGoal[]>(keys.projectSubGoals(intent.projectId), (current) =>
      (current ?? []).filter((claim) => claim.reservationId !== intent.reservationId),
    )
  }
  invalidate(keys.projectSubGoals(intent.projectId))
}

export async function applyProjectSubGoalRelease(
  intent: ProjectSubGoalReleaseIntent,
  idempotencyKey: string,
): Promise<void> {
  const released = await apiPost<Reservation>(
    paths.reservationRelease(intent.reservationId),
    undefined,
    { idempotencyKey },
  )
  if (released.id !== intent.reservationId || released.status !== 'released') {
    throw new Error('The release acknowledgement did not match the requested claim.')
  }
  acceptReleased(intent)
}

export async function reconcileProjectSubGoalRelease(
  intent: ProjectSubGoalReleaseIntent,
): Promise<boolean> {
  const incoming = await apiGet<ProjectSubGoal[]>(paths.projectSubGoals(intent.projectId))
  if (!peek<ProjectSubGoal[]>(keys.projectSubGoals(intent.projectId))) {
    setData(keys.projectSubGoals(intent.projectId), incoming)
  }
  if (incoming.some((claim) => claim.reservationId === intent.reservationId)) return false
  acceptReleased(intent)
  return true
}
