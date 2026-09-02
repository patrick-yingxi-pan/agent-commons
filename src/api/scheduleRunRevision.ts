import type { ScheduledRun, ScheduledTask } from '../../contract/index.ts'
import { mergeScheduleDefinition } from './scheduleRevision.ts'

const terminalRun = (run: ScheduledRun): boolean => run.status !== 'running'
const runProgress = (run: ScheduledRun): readonly number[] => [
  terminalRun(run) ? 1 : 0,
  run.attempts ?? 0,
  run.reachedStep,
  run.nextAttemptAt ?? run.at,
]
const compareRunProgress = (left: ScheduledRun, right: ScheduledRun): number => {
  const a = runProgress(left)
  const b = runProgress(right)
  for (let i = 0; i < a.length; i += 1) {
    if (a[i]! !== b[i]!) return a[i]! > b[i]! ? 1 : -1
  }
  return 0
}

/** A Run-now response is only an acknowledgement of the queued run. Ambient
 * progress may already have settled that same id, so an older queued face can
 * insert a missing row but can never rewind an existing one. */
export function mergeAcknowledgedScheduleRun(
  current: ScheduledTask,
  incoming: ScheduledRun,
): ScheduledTask {
  const existing = current.runs.find((run) => run.id === incoming.id)
  if (existing) return current
  return {
    ...current,
    runs: [incoming, ...current.runs].sort((a, b) => b.at - a.at),
  }
}

/** Merge one authoritative schedule read without letting a crossed response
 * rewind a run that progressed after the read began. The server's bounded
 * history length remains the cap; a current-only row may survive this one read
 * long enough for its later ambient invalidation to settle ordering. */
export function mergeScheduleRuntimeSnapshot(
  current: ScheduledTask,
  incoming: ScheduledTask,
): ScheduledTask {
  const definition = mergeScheduleDefinition(current, incoming)
  const currentById = new Map(current.runs.map((run) => [run.id, run]))
  const incomingIds = new Set(incoming.runs.map((run) => run.id))
  let retainedNewerProgress = false
  const mergedIncoming = incoming.runs.map((run) => {
    const existing = currentById.get(run.id)
    if (!existing) return run
    const progress = compareRunProgress(existing, run)
    if (progress > 0) retainedNewerProgress = true
    return progress >= 0 ? existing : run
  })
  const preserved = current.runs.filter((run) => !incomingIds.has(run.id))
  const limit = Math.max(current.runs.length, incoming.runs.length)
  const runs = [...mergedIncoming, ...preserved]
    .sort((a, b) => b.at - a.at)
    .slice(0, limit)
  const unchanged = runs.length === current.runs.length && runs.every((run, index) => run === current.runs[index])
  const lastStatus = retainedNewerProgress ? current.lastStatus : incoming.lastStatus
  if (definition === current && unchanged && lastStatus === current.lastStatus) return current
  return { ...definition, lastStatus, runs }
}
