import { Play } from 'lucide-react'
import type { ScheduledTask } from '../types'
import {
  enqueueScheduleRun,
  isScheduleRunHeld,
  useScheduleRunStatus,
} from '../controller/scheduleRunMutations'
import { RowMenu, type RowMenuItem } from './RowMenu'

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
  const requestHeld = isScheduleRunHeld(task.id)
  const running = task.runs.some((run) => run.status === 'running')
  const run = () => {
    if (mutationHeld || requestHeld || running) return
    void enqueueScheduleRun(task.id)
  }
  const menuItems: RowMenuItem[] = [
    {
      kind: 'action',
      key: 'run',
      label: running ? 'Run in progress' : 'Run now',
      icon: <Play size={15} />,
      disabled: running,
      onSelect: run,
    },
    ...items,
  ]
  return <RowMenu ariaLabel={`Actions for ${task.name}`} items={menuItems} disabled={mutationHeld || requestHeld} />
}
