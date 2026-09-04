/** Transport and exact authoritative reconciliation for work-item comments. */
import type { OpenSubGoal } from '../../contract/index.ts'
import { apiGet, apiPost } from './client.ts'
import { invalidate, mutate, peek, setData } from './cache.ts'
import { keys, paths } from './keys.ts'
import { workItemCommentCreationId } from './workItemCommentCreationIdentity.ts'

export interface WorkItemCommentCreationIntent {
  readonly intentId: string
  readonly tenantId: string
  readonly projectId: string
  readonly itemId: string
  readonly body: string
}

function exactComment(
  item: OpenSubGoal,
  intent: WorkItemCommentCreationIntent,
  expectedId: string,
): boolean {
  return item.id === intent.itemId &&
    item.projectId === intent.projectId &&
    item.comments?.some((comment) => comment.id === expectedId && comment.body === intent.body) === true
}

function rememberItem(projectId: string, item: OpenSubGoal): void {
  if (peek<OpenSubGoal[]>(keys.openSubGoals(projectId))) {
    mutate<OpenSubGoal[]>(keys.openSubGoals(projectId), (current) =>
      (current ?? []).map((candidate) => candidate.id === item.id ? item : candidate),
    )
  }
  invalidate(keys.openSubGoals(projectId))
}

export async function applyWorkItemCommentCreation(
  intent: WorkItemCommentCreationIntent,
  idempotencyKey: string,
): Promise<void> {
  const expectedId = await workItemCommentCreationId(
    intent.tenantId,
    intent.projectId,
    intent.itemId,
    idempotencyKey,
  )
  const item = await apiPost<OpenSubGoal>(
    paths.openSubGoalComments(intent.projectId, intent.itemId),
    { body: intent.body },
    { idempotencyKey },
  )
  if (!exactComment(item, intent, expectedId)) {
    throw new Error('The comment acknowledgement did not match the submitted comment.')
  }
  rememberItem(intent.projectId, item)
}

export async function reconcileWorkItemCommentCreation(
  intent: WorkItemCommentCreationIntent,
  _baseline: undefined,
  idempotencyKey: string,
): Promise<boolean> {
  const expectedId = await workItemCommentCreationId(
    intent.tenantId,
    intent.projectId,
    intent.itemId,
    idempotencyKey,
  )
  const incoming = await apiGet<OpenSubGoal[]>(paths.openSubGoals(intent.projectId))
  const represented = incoming.find((item) => exactComment(item, intent, expectedId))
  if (!peek<OpenSubGoal[]>(keys.openSubGoals(intent.projectId))) {
    setData(keys.openSubGoals(intent.projectId), incoming)
  }
  if (!represented) return false
  rememberItem(intent.projectId, represented)
  return true
}
