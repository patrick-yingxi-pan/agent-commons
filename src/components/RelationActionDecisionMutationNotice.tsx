import {
  discardRelationActionDecision,
  retryRelationActionDecision,
  useRelationActionDecisionStatus,
} from '../controller/relationActionDecisionMutations.ts'
import { RevisionedMutationNotice } from './RevisionedMutationNotice.tsx'

export function RelationActionDecisionMutationNotice() {
  const mutation = useRelationActionDecisionStatus()
  return (
    <RevisionedMutationNotice
      kind="relation-action-decision"
      mutation={mutation}
      pendingLabel="Settling proposed change…"
      onRetry={retryRelationActionDecision}
      onDiscard={discardRelationActionDecision}
    />
  )
}
