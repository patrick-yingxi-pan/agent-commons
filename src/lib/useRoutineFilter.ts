import { useSyncExternalStore } from 'react'
import { subscribeLayout } from './uiPrefs'
import {
  routineFilterSnapshot,
  saveRoutineFilter,
  type RoutineFilter,
} from './routineFilter'

/** The one live Scheduled filter shared by the rail tree and its main page. */
export function useRoutineFilter(): readonly [RoutineFilter, (next: RoutineFilter) => void] {
  const value = useSyncExternalStore(subscribeLayout, routineFilterSnapshot, routineFilterSnapshot)
  return [value, saveRoutineFilter] as const
}
