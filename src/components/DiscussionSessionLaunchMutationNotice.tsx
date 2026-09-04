import {
  discardDiscussionSessionLaunch,
  retryDiscussionSessionLaunch,
  useDiscussionSessionLaunchStatus,
} from '../controller/discussionSessionLaunchMutations.ts'
import { RevisionedMutationNotice } from './RevisionedMutationNotice.tsx'

export function DiscussionSessionLaunchMutationNotice() {
  const mutation = useDiscussionSessionLaunchStatus()
  return (
    <RevisionedMutationNotice
      kind="discussion-session-launch"
      mutation={mutation}
      pendingLabel="Starting conversation…"
      onRetry={retryDiscussionSessionLaunch}
      onDiscard={discardDiscussionSessionLaunch}
    />
  )
}
