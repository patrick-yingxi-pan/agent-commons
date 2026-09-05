/** Transport and authoritative desired-state reconciliation for Project claims. */
import type { ProjectSubGoal, Reservation, ReserveSubGoalRequest } from '../../contract/index.ts'
import { apiGet, apiPost } from './client.ts'
import { invalidate, mutate, peek, setData } from './cache.ts'
import { keys, paths } from './keys.ts'

export interface ProjectSubGoalClaimIntent {
  readonly intentId: string
  readonly tenantId: string
  readonly projectId: string
  readonly holder: string
  readonly holderLabel: string
  readonly subGoal: string
}

function isExactClaim(claim: ProjectSubGoal, intent: ProjectSubGoalClaimIntent): boolean {
  return claim.subGoal === intent.subGoal &&
    claim.holder === intent.holder &&
    claim.canRelease === true &&
    claim.status !== 'released'
}

function acceptClaim(
  intent: ProjectSubGoalClaimIntent,
  claim: ProjectSubGoal,
  snapshot: ProjectSubGoal[],
): void {
  if (!peek<ProjectSubGoal[]>(keys.projectSubGoals(intent.projectId))) {
    setData(keys.projectSubGoals(intent.projectId), snapshot)
  } else {
    mutate<ProjectSubGoal[]>(keys.projectSubGoals(intent.projectId), (current) => {
      const rows = current ?? []
      const matches = (candidate: ProjectSubGoal) =>
        candidate.reservationId === claim.reservationId || isExactClaim(candidate, intent)
      return rows.some(matches)
        ? rows.map((candidate) => matches(candidate) ? claim : candidate)
        : [...rows, claim]
    })
  }
  // The row above makes success paint immediately; a bounded refresh heals any
  // unrelated claim that crossed the full reconciliation read.
  invalidate(keys.projectSubGoals(intent.projectId))
}

async function readExactClaim(
  intent: ProjectSubGoalClaimIntent,
  reservationId?: string,
): Promise<boolean> {
  const snapshot = await apiGet<ProjectSubGoal[]>(paths.projectSubGoals(intent.projectId))
  const claim = snapshot.find((candidate) =>
    isExactClaim(candidate, intent) &&
    (reservationId === undefined || candidate.reservationId === reservationId),
  )
  if (!claim) {
    if (!peek<ProjectSubGoal[]>(keys.projectSubGoals(intent.projectId))) {
      setData(keys.projectSubGoals(intent.projectId), snapshot)
    }
    return false
  }
  acceptClaim(intent, claim, snapshot)
  return true
}

export async function applyProjectSubGoalClaim(
  intent: ProjectSubGoalClaimIntent,
  _idempotencyKey: string,
): Promise<void> {
  const reservation = await apiPost<Reservation>(
    paths.projectSubGoals(intent.projectId),
    { holder: intent.holder, subGoal: intent.subGoal } satisfies ReserveSubGoalRequest,
  )
  if (reservation.holder !== intent.holder || reservation.status === 'released') {
    throw new Error('The claim acknowledgement did not match the requested holder.')
  }
  if (!await readExactClaim(intent, reservation.id)) {
    throw new Error('The acknowledged claim was not represented on this Project.')
  }
}

export async function reconcileProjectSubGoalClaim(
  intent: ProjectSubGoalClaimIntent,
): Promise<boolean> {
  return readExactClaim(intent)
}
