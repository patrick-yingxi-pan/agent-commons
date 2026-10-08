import type { DispatchRun } from '../../contract/index.ts'
import { dispatchAvailable } from './automationAvailability.ts'

export function dispatchPresentation(capability: boolean | undefined) {
  return {
    available: dispatchAvailable(capability),
    state: capability === true ? 'available' : capability === false ? 'unavailable' : 'unknown',
    note: capability === true
      ? 'Run a task with your chosen Agent and model. Open its private conversation to follow progress, review proposed actions, or continue the work. External tool calls need your approval.'
      : capability === false
        ? 'Dispatch execution is unavailable on this backend. Existing history is still readable.'
        : 'Dispatch availability could not be confirmed. No task can be started.',
  } as const
}

export function dispatchStatusLabel(run: DispatchRun): string {
  if (!run.execution) return 'Simulation'
  switch (run.execution.state) {
    case 'running': return 'Running'
    case 'replied': return 'Reply ready'
    case 'failed': return 'Failed'
    case 'interrupted': return 'Interrupted'
    case 'cancelled': return 'Stopped'
  }
}
