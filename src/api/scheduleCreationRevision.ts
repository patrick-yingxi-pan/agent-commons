import type { ScheduledTask } from '../../contract/index.ts'
import { mergeScheduleRuntimeSnapshot } from './scheduleRunRevision.ts'

/** Insert acknowledged creation truth without replacing a newer ambient face. */
export function mergeAcknowledgedScheduleCreation(
  current: ScheduledTask[] | undefined,
  incoming: ScheduledTask,
): ScheduledTask[] {
  const rows = current ?? []
  const existing = rows.find((task) => task.id === incoming.id)
  if (!existing) return [incoming, ...rows]
  const accepted = mergeScheduleRuntimeSnapshot(existing, incoming)
  if (accepted === existing) return rows
  return rows.map((task) => task.id === incoming.id ? accepted : task)
}

/** Accept a creation-reconciliation read without resurrecting baseline rows
 * deleted by another client or dropping rows that arrived after this intent. */
export function mergeScheduleCreationSnapshot(
  current: ScheduledTask[] | undefined,
  incoming: ScheduledTask[],
  baselineIds: readonly string[],
): ScheduledTask[] {
  const rows = current ?? []
  const currentById = new Map(rows.map((task) => [task.id, task]))
  const incomingIds = new Set(incoming.map((task) => task.id))
  const baseline = new Set(baselineIds)
  const merged = incoming.map((task) => {
    const existing = currentById.get(task.id)
    return existing ? mergeScheduleRuntimeSnapshot(existing, task) : task
  })
  for (const task of rows) {
    if (!incomingIds.has(task.id) && !baseline.has(task.id)) merged.push(task)
  }
  return merged
}
