/** Transport and exact authoritative recovery for notification triage. */
import type { AppNotification, MarkNotificationsReadRequest, NotificationReadState } from '../../contract/index.ts'
import { apiGet, apiPost } from './client.ts'
import { invalidate, mutate } from './cache.ts'
import { keys, paths } from './keys.ts'
import { mergeNotificationsRead, notificationsReadRealized } from './notificationReadRevision.ts'

export interface NotificationReadIntent {
  tenantId: string
  ids: string[]
  intentId: string
}

const normalizedIds = (ids: readonly string[]): string[] => [...new Set(ids)].sort()

export const notificationReadResourceId = (ids: readonly string[]): string =>
  `notification-read:${normalizedIds(ids).join(',')}`

function rememberRead(ids: readonly string[]): void {
  mutate<AppNotification[]>(keys.notifications, (current) =>
    current
      ? mergeNotificationsRead(current, ids)
      : current as unknown as AppNotification[],
  )
  // The acknowledgement owns only the frozen rows. Re-read the bounded inbox
  // for notifications that arrived or were evicted while the request crossed.
  invalidate(keys.notifications)
}

export async function applyNotificationRead(
  intent: NotificationReadIntent,
  idempotencyKey: string,
): Promise<void> {
  const inbox = await apiPost<AppNotification[]>(
    paths.notificationsRead,
    { ids: intent.ids } satisfies MarkNotificationsReadRequest,
    { idempotencyKey },
  )
  if (!notificationsReadRealized(inbox, intent.ids)) {
    throw new Error('The server did not acknowledge the requested notification state.')
  }
  rememberRead(intent.ids)
}

export async function reconcileNotificationRead(intent: NotificationReadIntent): Promise<boolean> {
  const state = await apiGet<NotificationReadState[]>(paths.notificationsReadState(...intent.ids))
  const realized = notificationsReadRealized(state, intent.ids)
  if (realized) rememberRead(intent.ids)
  else invalidate(keys.notifications)
  return realized
}
