import type { DispatchRun } from '../../contract/index.ts'

const settled = (run: DispatchRun): boolean => run.status !== 'running'

/** Insert acknowledged creation truth without rewinding an ambient same-id row. */
export function mergeAcknowledgedDispatchRun(
  current: DispatchRun[] | undefined,
  incoming: DispatchRun,
): DispatchRun[] {
  const rows = current ?? []
  if (rows.some((run) => run.id === incoming.id)) return rows
  return [incoming, ...rows].sort((a, b) => b.startedAt - a.startedAt)
}

/** Accept an authoritative feed read while preserving a newer terminal face or
 * a row that landed after the read began. Dispatch is append-only. */
export function mergeDispatchSnapshot(
  current: DispatchRun[] | undefined,
  incoming: DispatchRun[],
): DispatchRun[] {
  const rows = current ?? []
  const currentById = new Map(rows.map((run) => [run.id, run]))
  const incomingIds = new Set(incoming.map((run) => run.id))
  const merged = incoming.map((run) => {
    const existing = currentById.get(run.id)
    if (!existing) return run
    if (settled(existing) && !settled(run)) return existing
    if (existing.status === run.status) return existing
    return run
  })
  for (const run of rows) {
    if (!incomingIds.has(run.id)) merged.push(run)
  }
  return merged.sort((a, b) => b.startedAt - a.startedAt)
}
