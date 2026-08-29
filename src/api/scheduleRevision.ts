import type { ScheduledTask } from '../../contract/index.ts'
import { shouldAcceptEntityRevision } from './entityRevision.ts'

/** Merge only a routine's editable definition from an acknowledgement. Run
 * state has an independent lifecycle and stays on the cache's newer projection. */
export function mergeScheduleDefinition(
  current: ScheduledTask,
  incoming: ScheduledTask,
): ScheduledTask {
  if (!shouldAcceptEntityRevision(current.revision, incoming.revision)) return current
  return {
    ...current,
    enabled: incoming.enabled,
    name: incoming.name,
    prompt: incoming.prompt,
    cadence: incoming.cadence,
    trigger: incoming.trigger,
    next: incoming.next,
    nextFireAt: incoming.nextFireAt,
    timezone: incoming.timezone,
    missedFirePolicy: incoming.missedFirePolicy,
    model: incoming.model,
    notifyOnFailure: incoming.notifyOnFailure,
    delivery: incoming.delivery,
    steps: incoming.steps,
    revision: incoming.revision,
  }
}
