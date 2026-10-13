/** Exact-run stop transport, loaded only by the routine mutation runtime. */
import type { ScheduledRun, ScheduledTask } from '../../contract/index.ts'
import { AccountSwitchedError, apiGet, apiPost } from './client.ts'
import { keys, paths } from './keys.ts'
import { invalidate, invalidatePrefix, mutate, peek, setData } from './cache.ts'
import { mergeScheduleRuntimeSnapshot } from './scheduleRunRevision.ts'
import { accountGeneration } from './account.ts'
import { runSessionId } from '../../contract/ids.ts'
import { refreshOpenSession } from './sessionRefresh.ts'

export interface ScheduleRunStopIntent {
  scheduleId: string
  runId: string
}

export function scheduleRunStopSettled(
  tasks: readonly ScheduledTask[],
  intent: ScheduleRunStopIntent,
): boolean {
  return tasks.find((task) => task.id === intent.scheduleId)?.runs
    .some((run) => run.id === intent.runId && run.status !== 'running') ?? false
}

export function scheduleRunStopBaseline(intent: ScheduleRunStopIntent): string | null {
  return peek<ScheduledTask[]>(keys.schedules)
    ?.find((task) => task.id === intent.scheduleId)?.runs
    .find((run) => run.id === intent.runId)?.status ?? null
}

function invalidateRunSideViews(intent: ScheduleRunStopIntent): void {
  invalidate(keys.scheduleMcpPermission(intent.scheduleId))
  const sessionId = runSessionId(intent.scheduleId, intent.runId)
  invalidate(keys.sessions)
  invalidate(keys.session(sessionId))
  refreshOpenSession(sessionId)
  invalidatePrefix(keys.mcpInputPrefix(sessionId))
}

export async function stopScheduleRun(
  intent: ScheduleRunStopIntent,
  idempotencyKey: string,
): Promise<void> {
  const issuedGeneration = accountGeneration()
  const run = await apiPost<ScheduledRun>(
    paths.scheduleRunStop(intent.scheduleId, intent.runId),
    undefined,
    { idempotencyKey },
  )
  if (run.id !== intent.runId) throw new Error('Stop response did not match the selected run')
  if (accountGeneration() !== issuedGeneration) throw new AccountSwitchedError('Routine Stop account changed')
  mutate<ScheduledTask[]>(keys.schedules, (tasks) => (tasks ?? []).map((task) => {
    if (task.id !== intent.scheduleId) return task
    let changed = false
    const runs = task.runs.map((existing) => {
      if (existing.id !== run.id || existing.status !== 'running') return existing
      changed = true
      return run
    })
    return changed ? { ...task, runs } : task
  }))
  invalidateRunSideViews(intent)

  // Stop can also pause/revoke an uncertain Routine. Refresh the complete
  // authoritative schedule row instead of guessing those secondary changes.
  try {
    const incoming = await apiGet<ScheduledTask[]>(paths.schedules)
    if (accountGeneration() !== issuedGeneration) throw new AccountSwitchedError('Routine Stop account changed')
    const current = peek<ScheduledTask[]>(keys.schedules) ?? []
    const currentById = new Map(current.map((task) => [task.id, task]))
    setData(keys.schedules, incoming.map((task) => {
      const prior = currentById.get(task.id)
      return prior ? mergeScheduleRuntimeSnapshot(prior, task) : task
    }))
  } catch (error) {
    if (error instanceof AccountSwitchedError) throw error
    invalidate(keys.schedules)
  }
}

/** Reconcile only the frozen run target. A newer run never proves this stop. */
export async function reconcileScheduleRunStop(
  intent: ScheduleRunStopIntent,
): Promise<boolean> {
  const issuedGeneration = accountGeneration()
  const incoming = await apiGet<ScheduledTask[]>(paths.schedules)
  if (accountGeneration() !== issuedGeneration) throw new AccountSwitchedError('Routine Stop recovery account changed')
  const current = peek<ScheduledTask[]>(keys.schedules) ?? []
  const currentById = new Map(current.map((task) => [task.id, task]))
  const merged = incoming.map((task) => {
    const prior = currentById.get(task.id)
    return prior ? mergeScheduleRuntimeSnapshot(prior, task) : task
  })
  setData(keys.schedules, merged)
  invalidateRunSideViews(intent)
  return scheduleRunStopSettled(incoming, intent)
}
