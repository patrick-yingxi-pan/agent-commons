/** Low-frequency manual routine execution transport. This module is reached
 * only through scheduleRunRuntime's lazy boundary, keeping its identity and
 * reconciliation machinery out of the initial application graph. */
import type { ScheduledRun, ScheduledTask } from '../../contract/index.ts'
import { apiGet, apiPost } from './client.ts'
import { keys, paths } from './keys.ts'
import { mutate, peek, setData } from './cache.ts'
import {
  mergeAcknowledgedScheduleRun,
  mergeScheduleRuntimeSnapshot,
} from './scheduleRunRevision.ts'
import { manualScheduleRunId } from './scheduleRunIdentity.ts'

/** Freeze the run ids visible when one Run-now intent enters its controller. */
export function scheduleRunBaseline(id: string): readonly string[] {
  return peek<ScheduledTask[]>(keys.schedules)
    ?.find((task) => task.id === id)?.runs.map((run) => run.id) ?? []
}

/** Begin one logical manual run. The returned queued row is acknowledged truth;
 * an ambient progress event may already be newer, so insertion never rewinds an
 * existing same-id run. */
export async function runScheduleNow(id: string, idempotencyKey: string): Promise<void> {
  const run = await apiPost<ScheduledRun>(paths.scheduleRun(id), undefined, { idempotencyKey })
  mutate<ScheduledTask[]>(keys.schedules, (tasks) =>
    (tasks ?? []).map((task) =>
      task.id === id ? mergeAcknowledgedScheduleRun(task, run) : task,
    ),
  )
}

/** Reconcile uncertain Run-now transport against authoritative schedule state.
 * Only the opaque run id derived from this logical key proves the requested
 * outcome, even if another scheduled fire arrived after the frozen baseline. */
export async function reconcileScheduleRun(
  id: string,
  baselineRunIds: readonly string[],
  idempotencyKey: string,
): Promise<boolean> {
  const expectedRunId = await manualScheduleRunId(idempotencyKey)
  const incoming = await apiGet<ScheduledTask[]>(paths.schedules)
  const current = peek<ScheduledTask[]>(keys.schedules) ?? []
  const currentById = new Map(current.map((task) => [task.id, task]))
  const merged = incoming.map((task) => {
    const prior = currentById.get(task.id)
    return prior ? mergeScheduleRuntimeSnapshot(prior, task) : task
  })
  setData(keys.schedules, merged)
  const baseline = new Set(baselineRunIds)
  return !baseline.has(expectedRunId) && (
    incoming.find((task) => task.id === id)?.runs.some((run) => run.id === expectedRunId) ?? false
  )
}
