import {
  discardWorkItemRetraction,
  retryWorkItemRetraction,
  useWorkItemRetractionStatus,
} from '../controller/workItemRetractionMutations.ts'
import { RevisionedMutationNotice } from './RevisionedMutationNotice.tsx'

export function WorkItemRetractionMutationNotice() {
  const mutation = useWorkItemRetractionStatus()
  return (
    <RevisionedMutationNotice
      kind="work-item-retract"
      mutation={mutation}
      pendingLabel="Retracting work item…"
      onRetry={retryWorkItemRetraction}
      onDiscard={discardWorkItemRetraction}
    />
  )
}
