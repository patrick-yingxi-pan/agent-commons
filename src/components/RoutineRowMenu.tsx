import { Play, Square } from 'lucide-react'
import type { ScheduledTask } from '../types'
import {
  enqueueScheduleRun,
  isScheduleRunHeld,
  useScheduleRunStatus,
} from '../controller/scheduleRunMutations'
import { enqueueScheduleRunStop, isScheduleRunStopHeldForTask, useScheduleRunStopStatus } from '../controller/scheduleRunStopMutations'
import { RowMenu, type RowMenuItem } from './RowMenu'
import { canStopScheduleRun, SCHEDULE_RUN_STOP_LABEL, SCHEDULE_RUN_STOP_SCOPE } from '../lib/scheduleRunStopPresentation'

/** Run state is needed only when a routine row exists in an expanded rail. */
export function RoutineRowMenu({
  task,
  items,
  mutationHeld,
}: {
  task: ScheduledTask
  items: RowMenuItem[]
  mutationHeld: boolean
}) {
  useScheduleRunStatus()
  useScheduleRunStopStatus()
  const requestHeld = isScheduleRunHeld(task.id)
  const activeRun = task.runs.find((run) => run.status === 'running')
  const running = Boolean(activeRun)
  const run = () => {
    if (mutationHeld || requestHeld || running) return
    void enqueueScheduleRun(task.id)
  }
  const menuItems: RowMenuItem[] = [
    ...(activeRun && canStopScheduleRun(task.own) ? [{
      kind: 'action' as const,
      key: 'stop-run',
      label: SCHEDULE_RUN_STOP_LABEL,
      title: SCHEDULE_RUN_STOP_SCOPE,
      icon: <Square size={15} />,
      onSelect: () => { void enqueueScheduleRunStop({ scheduleId: task.id, runId: activeRun.id }) },
    }] : []),
    ...(!activeRun ? [{
      kind: 'action',
      key: 'run',
      label: 'Run now',
      icon: <Play size={15} />,
      disabled: isScheduleRunStopHeldForTask(task.id),
      onSelect: run,
    } as const] : []),
    ...items,
  ]
  return <RowMenu ariaLabel={`Actions for ${task.name}`} items={menuItems} disabled={mutationHeld || requestHeld || isScheduleRunStopHeldForTask(task.id)} />
}
