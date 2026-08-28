import {
  discardSessionMetadataMutation,
  retrySessionMetadataMutation,
  useSessionMetadataMutationStatus,
} from '../controller/sessionMetadataMutations'
import { RevisionedMutationNotice } from './RevisionedMutationNotice'

/** One shell-level acknowledgement/recovery surface for conversation row
 * edits launched from the rail or a pane's model selector. */
export function SessionMetadataMutationNotice() {
  const mutation = useSessionMetadataMutationStatus()
  return (
    <RevisionedMutationNotice
      kind="conversation"
      mutation={mutation}
      pendingLabel="Updating conversation…"
      onRetry={retrySessionMetadataMutation}
      onDiscard={discardSessionMetadataMutation}
    />
  )
}
