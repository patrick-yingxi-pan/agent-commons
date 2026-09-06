import {
  discardDiscussionRead,
  retryDiscussionRead,
  useDiscussionReadStatus,
} from '../controller/discussionReadMutations.ts'
import { RevisionedMutationNotice } from './RevisionedMutationNotice.tsx'

/** One low-frequency shell recovery surface for private read-position drift. */
export function DiscussionReadMutationNotice() {
  const mutation = useDiscussionReadStatus()
  return (
    <RevisionedMutationNotice
      kind="discussion-read"
      mutation={mutation}
      pendingLabel="Syncing read position…"
      onRetry={retryDiscussionRead}
      onDiscard={discardDiscussionRead}
    />
  )
}
