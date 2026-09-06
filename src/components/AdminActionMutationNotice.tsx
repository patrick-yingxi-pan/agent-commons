import {
  discardAdminAction,
  retryAdminAction,
  useAdminActionStatus,
} from '../controller/adminActionMutations.ts'
import { RevisionedMutationNotice } from './RevisionedMutationNotice.tsx'

/** One shell recovery surface for the maintainer console's security actions. */
export function AdminActionMutationNotice() {
  const mutation = useAdminActionStatus()
  return (
    <RevisionedMutationNotice
      kind="admin-action"
      mutation={mutation}
      pendingLabel="Applying maintainer action…"
      onRetry={retryAdminAction}
      onDiscard={discardAdminAction}
    />
  )
}
