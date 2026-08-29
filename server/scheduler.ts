/** ── Durable routine scheduler ─────────────────────────────────────────────
 *  The scheduler owns *when* an enabled routine fires; the store owns the
 *  durable cursor and run rows. A pass is pure orchestration over a narrow port,
 *  which makes downtime policy and fire-time idempotency deterministic to test.
 *
 *  Desktop runs this in-process. A hosted job runner can drive the same port:
 *  `(task.id, task.nextFireAt)` remains the one effect identity either way. */
import type { ScheduledRun, ScheduledTask } from '../contract/index.ts'
import { nextCadenceFireAt, parseCadence } from '../contract/index.ts'
import { positiveNumberEnv } from './env.ts'

export interface SchedulerPort {
  listSchedules(): ScheduledTask[]
  runSchedule(id: string, options?: { scheduledFor?: number; startedAt?: number }): ScheduledRun | undefined
  recordSkippedScheduleFire(id: string, scheduledFor: number, at?: number): ScheduledRun | undefined
  setScheduleNextFire(id: string, nextFireAt: number, now?: number): ScheduledTask | undefined
  reapStaleRunners(ttlMs: number): void
}

export interface SchedulerPassOptions {
  now: number
  /** True only for the first pass after durable state has rehydrated. */
  booting?: boolean
}

export interface SchedulerPassResult {
  nextWakeAt?: number
}

function nextFor(task: ScheduledTask, after: number): number | undefined {
  const spec = parseCadence(task.cadence)
  if (!spec) return undefined
  return nextCadenceFireAt(spec, after, task.timezone ?? 'UTC')
}

/** Reconcile every enabled routine once. An old snapshot without a cursor is
 *  adopted from `now` (never mistaken for a missed fire). An overdue persisted
 *  cursor is either visibly skipped on boot or effected once. The store only
 *  advances after it can prove that exact fire-time was represented. */
export function runSchedulerPass(port: SchedulerPort, options: SchedulerPassOptions): SchedulerPassResult {
  const { now, booting = false } = options
  for (const task of port.listSchedules()) {
    if (!task.enabled) continue

    const cursor = task.nextFireAt
    if (!Number.isFinite(cursor)) {
      const initial = nextFor(task, now)
      if (initial !== undefined) port.setScheduleNextFire(task.id, initial, now)
      continue
    }
    if ((cursor as number) > now) continue

    if (booting && (task.missedFirePolicy ?? 'skip') === 'skip') {
      const skipped = port.recordSkippedScheduleFire(task.id, cursor as number, now)
      if (skipped?.scheduledFor !== cursor) continue
    } else {
      const run = port.runSchedule(task.id, { scheduledFor: cursor as number, startedAt: now })
      // A manual run may already be in flight. Do not silently consume the due
      // occurrence; leave the cursor overdue and try again after that run settles.
      if (run?.scheduledFor !== cursor) continue
    }

    const next = nextFor(task, now)
    if (next !== undefined) port.setScheduleNextFire(task.id, next, now)
  }

  const nextWakeAt = port.listSchedules()
    .filter((task) => task.enabled && Number.isFinite(task.nextFireAt))
    .reduce<number | undefined>((earliest, task) => (
      earliest === undefined || (task.nextFireAt as number) < earliest ? task.nextFireAt : earliest
    ), undefined)
  return { nextWakeAt }
}

export interface RoutineSchedulerOptions {
  now?: () => number
  maxPollMs?: number
  runnerTtlMs?: number
}

/** Recursive one-shot timing avoids `setInterval` overlap and sleeps until the
 *  earliest cursor (bounded by a health poll for runner liveness and blocked
 *  scheduled fires). */
export function startRoutineScheduler(port: SchedulerPort, options: RoutineSchedulerOptions = {}): () => void {
  const now = options.now ?? Date.now
  const maxPollMs = options.maxPollMs ?? 60_000
  const runnerTtlMs = options.runnerTtlMs ?? positiveNumberEnv(process.env.RUNNER_TTL_MS, 120_000)
  let stopped = false
  let booting = true
  let handle: ReturnType<typeof setTimeout> | undefined

  const tick = () => {
    if (stopped) return
    const at = now()
    port.reapStaleRunners(runnerTtlMs)
    const result = runSchedulerPass(port, { now: at, booting })
    booting = false
    const untilNext = result.nextWakeAt === undefined ? maxPollMs : Math.max(250, result.nextWakeAt - at)
    handle = setTimeout(tick, Math.min(maxPollMs, untilNext))
    handle.unref?.()
  }

  tick()
  return () => {
    stopped = true
    if (handle) clearTimeout(handle)
  }
}
