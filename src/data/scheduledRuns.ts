/** The run-session synthesis now lives in the contract (shared with the backend,
 *  which owns the live runs). This module keeps the client's existing surface —
 *  computed over the seed for now; it's swapped for the server's live `/runs/recent`
 *  feed when the sidebar/controller wire up to it. */
import { SCHEDULED_TASKS } from './cowork'
import { buildRunSession, entryById, recentEntries, type RunSessionEntry } from '../../contract/runs.ts'

export type { RunSessionEntry }
export { buildRunSession }

/** The left rail's recent runs (newest-first, capped) — over the seed. */
export const RECENT_RUNS: RunSessionEntry[] = recentEntries(SCHEDULED_TASKS)

/** The run session for an id the rail linked to (or undefined for a normal id). */
export function runSessionById(id: string) {
  return entryById(SCHEDULED_TASKS, id)?.session
}

/** The full run entry (task + run + session) for a session id. */
export function runEntryById(id: string): RunSessionEntry | undefined {
  return entryById(SCHEDULED_TASKS, id)
}
