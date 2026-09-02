/** Lazy transport for acknowledgement-gated routine creation. */
import type { CreateScheduleRequest, ScheduledTask } from '../../contract/index.ts'
import { apiGet, apiPost } from './client.ts'
import { keys, paths } from './keys.ts'
import { mutate, peek, setData } from './cache.ts'
import { scheduleCreationId } from './scheduleCreationIdentity.ts'
import {
  mergeAcknowledgedScheduleCreation,
  mergeScheduleCreationSnapshot,
} from './scheduleCreationRevision.ts'

export interface ScheduleCreationIntent {
  intentId: string
  tenantId: string
  seed: Omit<ScheduledTask, 'id'>
}

export interface ScheduleCreationBaseline {
  tenantId: string
  scheduleIds: readonly string[]
}

export function scheduleCreationBaseline(intent: ScheduleCreationIntent): ScheduleCreationBaseline {
  return {
    tenantId: intent.tenantId,
    scheduleIds: peek<ScheduledTask[]>(keys.schedules)?.map((task) => task.id) ?? [],
  }
}

export async function createSchedule(intent: ScheduleCreationIntent, idempotencyKey: string): Promise<void> {
  const task = await apiPost<ScheduledTask>(
    paths.schedules,
    { seed: intent.seed } satisfies CreateScheduleRequest,
    { idempotencyKey },
  )
  mutate<ScheduledTask[]>(keys.schedules, (current) =>
    mergeAcknowledgedScheduleCreation(current, task))
}

export async function reconcileScheduleCreation(
  _intent: ScheduleCreationIntent,
  baseline: ScheduleCreationBaseline,
  idempotencyKey: string,
): Promise<boolean> {
  const expectedId = await scheduleCreationId(baseline.tenantId, idempotencyKey)
  const incoming = await apiGet<ScheduledTask[]>(paths.schedules)
  setData(
    keys.schedules,
    mergeScheduleCreationSnapshot(peek<ScheduledTask[]>(keys.schedules), incoming, baseline.scheduleIds),
  )
  return !baseline.scheduleIds.includes(expectedId) && incoming.some((task) => task.id === expectedId)
}
