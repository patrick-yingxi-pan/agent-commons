/** Lazy transport for acknowledgement-gated one-off Dispatch creation. */
import type { CreateDispatchRequest, DispatchRun } from '../../contract/index.ts'
import { apiGet, apiPost } from './client.ts'
import { keys, paths } from './keys.ts'
import { mutate, peek, setData } from './cache.ts'
import { manualDispatchRunId } from './dispatchIdentity.ts'
import { mergeAcknowledgedDispatchRun, mergeDispatchSnapshot } from './dispatchRevision.ts'

export interface DispatchIntent {
  intentId: string
  tenantId: string
  title: string
  detail?: string
}

export interface DispatchBaseline {
  tenantId: string
  runIds: readonly string[]
}

export function dispatchBaseline(intent: DispatchIntent): DispatchBaseline {
  return {
    tenantId: intent.tenantId,
    runIds: peek<DispatchRun[]>(keys.dispatch)?.map((run) => run.id) ?? [],
  }
}

export async function createDispatch(intent: DispatchIntent, idempotencyKey: string): Promise<void> {
  const run = await apiPost<DispatchRun>(
    paths.dispatch,
    { title: intent.title, detail: intent.detail } satisfies CreateDispatchRequest,
    { idempotencyKey },
  )
  mutate<DispatchRun[]>(keys.dispatch, (current) => mergeAcknowledgedDispatchRun(current, run))
}

export async function reconcileDispatch(
  _intent: DispatchIntent,
  baseline: DispatchBaseline,
  idempotencyKey: string,
): Promise<boolean> {
  const expectedId = await manualDispatchRunId(baseline.tenantId, idempotencyKey)
  const incoming = await apiGet<DispatchRun[]>(paths.dispatch)
  setData(keys.dispatch, mergeDispatchSnapshot(peek<DispatchRun[]>(keys.dispatch), incoming))
  return !baseline.runIds.includes(expectedId) && incoming.some((run) => run.id === expectedId)
}
