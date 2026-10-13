import type { ScheduledRun } from '../../contract/index.ts'

export const SCHEDULE_RUN_STOP_LABEL = 'Stop this run'
export const SCHEDULE_RUN_STOP_PENDING_LABEL = 'Stopping this run…'
export const SCHEDULE_RUN_STOP_SCOPE =
  'Stops only this run. Completed effects can’t be undone. Future cadence continues unless uncertainty pauses the routine for review.'

/** Optional viewer-relative ownership is not proof of authority. */
export function canStopScheduleRun(own: boolean | undefined): boolean {
  return own === true
}

export function scheduleRunStatusLabel(status: ScheduledRun['status']): string {
  return status === 'cancelled' ? 'Stopped' : status
}
