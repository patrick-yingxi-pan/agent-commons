import {
  discardStandingRelationship,
  retryStandingRelationship,
  useStandingRelationshipStatus,
} from '../controller/standingRelationshipMutations.ts'
import { RevisionedMutationNotice } from './RevisionedMutationNotice.tsx'

/** One shell recovery surface for the sibling Follow and Watch relationships. */
export function StandingRelationshipMutationNotice() {
  const mutation = useStandingRelationshipStatus()
  return (
    <RevisionedMutationNotice
      kind="standing-relationship"
      mutation={mutation}
      pendingLabel="Saving Follow or Watch…"
      onRetry={retryStandingRelationship}
      onDiscard={discardStandingRelationship}
    />
  )
}
