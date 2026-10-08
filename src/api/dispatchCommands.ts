/** Lazy transport for acknowledgement-gated one-off Dispatch creation. */
import type { CreateDispatchRequest, DispatchBinding, DispatchRun } from '../../contract/index.ts'
import { apiGet, apiPost } from './client.ts'
import { keys, paths } from './keys.ts'
import { invalidate, peek } from './cache.ts'
import { manualDispatchRunId } from './dispatchIdentity.ts'

export interface DispatchIntent {
  intentId: string
  tenantId: string
  title: string
  detail?: string
  execution: DispatchBinding
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
  await apiPost<DispatchRun>(
    paths.dispatch,
    { title: intent.title, detail: intent.detail, execution: intent.execution } satisfies CreateDispatchRequest,
    { idempotencyKey },
  )
  // A result conversation can be deleted on another device before the POST
  // arrives. Only generation-fenced query reads may project the current feed.
  invalidate(keys.dispatch)
  invalidate(keys.sessions)
}

export async function reconcileDispatch(
  _intent: DispatchIntent,
  baseline: DispatchBaseline,
  idempotencyKey: string,
): Promise<boolean> {
  const expectedId = await manualDispatchRunId(baseline.tenantId, idempotencyKey)
  const incoming = await apiGet<DispatchRun[]>(paths.dispatch)
  invalidate(keys.dispatch)
  invalidate(keys.sessions)
  return !baseline.runIds.includes(expectedId) && incoming.some((run) => run.id === expectedId)
}
