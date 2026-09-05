import {
  discardToolActivityDecision,
  retryToolActivityDecision,
  useToolActivityDecisionStatus,
} from '../controller/toolActivityDecisionMutations.ts'
import { RevisionedMutationNotice } from './RevisionedMutationNotice.tsx'

export function ToolActivityDecisionMutationNotice() {
  const mutation = useToolActivityDecisionStatus()
  return (
    <RevisionedMutationNotice
      kind="tool-activity-decision"
      mutation={mutation}
      pendingLabel="Applying tool decision…"
      onRetry={retryToolActivityDecision}
      onDiscard={discardToolActivityDecision}
    />
  )
}
