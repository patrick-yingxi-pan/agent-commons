import type { ArtifactItem, ScheduledTask, Session } from '../../contract/index.ts'
import { runSessionId } from '../../contract/ids.ts'

/** Resolve the conversation behind an artifact without treating display labels
 * as authority. New rows carry an explicit session or owned routine-run id;
 * title lookup remains only for legacy rows and must be unambiguous. */
export function artifactSourceSessionId(
  artifact: Pick<ArtifactItem, 'source' | 'sourceSessionId'>,
  sessions: Pick<Session, 'id' | 'title'>[],
  schedules: Pick<ScheduledTask, 'id' | 'own' | 'runs'>[],
): string | undefined {
  if (artifact.sourceSessionId !== undefined) {
    if (sessions.some((session) => session.id === artifact.sourceSessionId)) return artifact.sourceSessionId
    for (const schedule of schedules) {
      if (schedule.own !== true) continue
      if (schedule.runs.some((run) => runSessionId(schedule.id, run.id) === artifact.sourceSessionId)) {
        return artifact.sourceSessionId
      }
    }
    return undefined
  }

  const matches = sessions.filter((session) => session.title === artifact.source)
  return matches.length === 1 ? matches[0].id : undefined
}
