/** Transport and exact authoritative reconciliation for open-work creation. */
import type { OpenSubGoal, PostOpenSubGoalRequest } from '../../contract/index.ts'
import { apiGet, apiPost } from './client.ts'
import { invalidate, invalidatePrefix, mutate, peek, setData } from './cache.ts'
import { keys, paths } from './keys.ts'
import { openWorkCreationId } from './openWorkCreationIdentity.ts'

export interface OpenWorkCreationIntent {
  readonly intentId: string
  readonly tenantId: string
  readonly projectId: string
  readonly request: PostOpenSubGoalRequest
}

function isExactWork(item: OpenSubGoal, intent: OpenWorkCreationIntent, expectedId: string): boolean {
  return item.id === expectedId &&
    item.projectId === intent.projectId &&
    item.subGoal === intent.request.subGoal &&
    item.type === intent.request.type &&
    item.target === intent.request.target &&
    item.note === (intent.request.note ?? '')
}

function rememberOpenWork(projectId: string, item: OpenSubGoal): void {
  if (peek<OpenSubGoal[]>(keys.openSubGoals(projectId))) {
    mutate<OpenSubGoal[]>(keys.openSubGoals(projectId), (current) => {
      const rows = current ?? []
      return rows.some((candidate) => candidate.id === item.id)
        ? rows.map((candidate) => candidate.id === item.id ? item : candidate)
        : [item, ...rows]
    })
  }
  invalidate(keys.openSubGoals(projectId))
  invalidate(keys.projectSubGoals(projectId))
  invalidate(keys.workerAgents)
  invalidatePrefix(keys.directoryProjects())
  invalidatePrefix(keys.directoryAgents())
  invalidatePrefix(keys.agentResolvedWork())
}

export async function applyOpenWorkCreation(
  intent: OpenWorkCreationIntent,
  idempotencyKey: string,
): Promise<void> {
  const expectedId = await openWorkCreationId(intent.tenantId, intent.projectId, idempotencyKey)
  const item = await apiPost<OpenSubGoal>(
    paths.openSubGoals(intent.projectId),
    intent.request,
    { idempotencyKey },
  )
  if (!isExactWork(item, intent, expectedId)) {
    throw new Error('The work-item acknowledgement did not match the submitted work.')
  }
  rememberOpenWork(intent.projectId, item)
}

/** Reconciliation proves the exact tenant/Project/key-derived item and its
 * immutable authored fields; another device's similar work cannot settle it. */
export async function reconcileOpenWorkCreation(
  intent: OpenWorkCreationIntent,
  _baseline: undefined,
  idempotencyKey: string,
): Promise<boolean> {
  const expectedId = await openWorkCreationId(intent.tenantId, intent.projectId, idempotencyKey)
  const incoming = await apiGet<OpenSubGoal[]>(paths.openSubGoals(intent.projectId))
  const represented = incoming.find((item) => item.id === expectedId)
  if (!peek<OpenSubGoal[]>(keys.openSubGoals(intent.projectId))) {
    setData(keys.openSubGoals(intent.projectId), incoming)
  }
  if (!represented || !isExactWork(represented, intent, expectedId)) return false
  rememberOpenWork(intent.projectId, represented)
  return true
}
