import {
  discardWorkItemCommentCreation,
  retryWorkItemCommentCreation,
  useWorkItemCommentCreationStatus,
} from '../controller/workItemCommentCreationMutations.ts'
import { RevisionedMutationNotice } from './RevisionedMutationNotice.tsx'

export function WorkItemCommentCreationMutationNotice() {
  const mutation = useWorkItemCommentCreationStatus()
  return (
    <RevisionedMutationNotice
      kind="work-item-comment-create"
      mutation={mutation}
      pendingLabel="Posting comment…"
      onRetry={retryWorkItemCommentCreation}
      onDiscard={discardWorkItemCommentCreation}
    />
  )
}
