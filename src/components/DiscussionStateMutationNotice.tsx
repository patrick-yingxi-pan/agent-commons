import {
  discardDiscussionState,
  retryDiscussionState,
  useDiscussionStateStatus,
} from '../controller/discussionStateMutations.ts'
import { RevisionedMutationNotice } from './RevisionedMutationNotice.tsx'

export function DiscussionStateMutationNotice() {
  const mutation = useDiscussionStateStatus()
  return (
    <RevisionedMutationNotice
      kind="discussion-state"
      mutation={mutation}
      pendingLabel="Updating discussion state…"
      onRetry={retryDiscussionState}
      onDiscard={discardDiscussionState}
    />
  )
}
