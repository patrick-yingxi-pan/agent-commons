import {
  discardNotificationRead,
  retryNotificationRead,
  useNotificationReadStatus,
} from '../controller/notificationReadMutations.ts'
import { RevisionedMutationNotice } from './RevisionedMutationNotice.tsx'

/** One shell recovery surface for inbox read-state uncertainty. */
export function NotificationReadMutationNotice() {
  const mutation = useNotificationReadStatus()
  return (
    <RevisionedMutationNotice
      kind="notification-read"
      mutation={mutation}
      pendingLabel="Marking notifications read…"
      onRetry={retryNotificationRead}
      onDiscard={discardNotificationRead}
    />
  )
}
