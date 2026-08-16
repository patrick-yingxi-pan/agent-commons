import { useSyncExternalStore } from 'react'
import {
  saveSessionFilter,
  sessionFilterSnapshot,
  subscribeSessionFilter,
  type SessionFilter,
} from './sessionFilter'

/** One live preference shared by the Sessions rail branch and main page. */
export function useSessionFilter(): [SessionFilter, (next: SessionFilter) => void] {
  const filter = useSyncExternalStore(
    subscribeSessionFilter,
    sessionFilterSnapshot,
    sessionFilterSnapshot,
  )
  return [filter, saveSessionFilter]
}
