/** Transport and authoritative desired-state reconciliation for work-item retraction. */
import type { OpenSubGoal } from '../../contract/index.ts'
import { apiGet, apiPost } from './client.ts'
import { invalidate, invalidatePrefix, mutate, peek, setData } from './cache.ts'
import { keys, paths } from './keys.ts'

export interface WorkItemRetractionIntent {
  readonly intentId: string
  readonly tenantId: string
  readonly projectId: string
  readonly itemId: string
}

const represented = (item: OpenSubGoal, intent: WorkItemRetractionIntent): boolean =>
  item.id === intent.itemId && item.projectId === intent.projectId && item.status === 'retracted'

function refreshRetractionFaces(projectId: string, item?: OpenSubGoal): void {
  if (item && peek<OpenSubGoal[]>(keys.openSubGoals(projectId))) {
    mutate<OpenSubGoal[]>(keys.openSubGoals(projectId), (current) =>
      (current ?? []).map((candidate) => candidate.id === item.id ? item : candidate),
    )
  }
  invalidate(keys.openSubGoals(projectId))
  invalidatePrefix(keys.directoryProjects())
  invalidatePrefix(keys.ownerProfile())
  invalidatePrefix(keys.search())
}

export async function applyWorkItemRetraction(
  intent: WorkItemRetractionIntent,
  idempotencyKey: string,
): Promise<void> {
  const item = await apiPost<OpenSubGoal>(
    paths.openSubGoalRetract(intent.projectId, intent.itemId),
    {},
    { idempotencyKey },
  )
  if (!represented(item, intent)) {
    throw new Error('The retraction acknowledgement did not match the requested work item.')
  }
  refreshRetractionFaces(intent.projectId, item)
}

export async function reconcileWorkItemRetraction(
  intent: WorkItemRetractionIntent,
): Promise<boolean> {
  const incoming = await apiGet<OpenSubGoal[]>(paths.openSubGoals(intent.projectId))
  const item = incoming.find((candidate) => represented(candidate, intent))
  if (!peek<OpenSubGoal[]>(keys.openSubGoals(intent.projectId))) {
    setData(keys.openSubGoals(intent.projectId), incoming)
  }
  if (!item) return false
  refreshRetractionFaces(intent.projectId, item)
  return true
}
