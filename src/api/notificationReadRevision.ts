/** Addressed cache merge for acknowledgement-owned notification triage. */
import type { AppNotification, NotificationReadState } from '../../contract/index.ts'

/** A read acknowledgement owns only the rows frozen in its request. Preserve
 * notifications that arrived later and every unrelated row field. */
export function mergeNotificationsRead(
  current: AppNotification[],
  ids: readonly string[],
): AppNotification[] {
  const addressed = new Set(ids)
  let changed = false
  const next = current.map((row) => {
    if (!addressed.has(row.id) || row.read) return row
    changed = true
    return { ...row, read: true }
  })
  return changed ? next : current
}

/** Read is monotonic. An addressed row is settled when it is read or no longer
 * present in the bounded pointer inbox; absence cannot be resurrected by Retry. */
export function notificationsReadRealized(
  state: NotificationReadState[],
  ids: readonly string[],
): boolean {
  const byId = new Map(state.map((row) => [row.id, row]))
  return ids.every((id) => byId.get(id)?.read !== false)
}
