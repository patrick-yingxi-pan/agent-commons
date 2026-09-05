import {
  discardDiscussionPostDeletion,
  retryDiscussionPostDeletion,
  useDiscussionPostDeletionStatus,
} from '../controller/discussionPostDeletionMutations.ts'
import { RevisionedMutationNotice } from './RevisionedMutationNotice.tsx'

export function DiscussionPostDeletionMutationNotice() {
  const mutation = useDiscussionPostDeletionStatus()
  return (
    <RevisionedMutationNotice
      kind="discussion-post-delete"
      mutation={mutation}
      pendingLabel="Deleting reviewed posts…"
      onRetry={retryDiscussionPostDeletion}
      onDiscard={discardDiscussionPostDeletion}
    />
  )
}
