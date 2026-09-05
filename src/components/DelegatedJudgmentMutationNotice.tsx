import {
  discardDelegatedJudgment,
  retryDelegatedJudgment,
  useDelegatedJudgmentStatus,
} from '../controller/delegatedJudgmentMutations.ts'
import { RevisionedMutationNotice } from './RevisionedMutationNotice.tsx'

export function DelegatedJudgmentMutationNotice() {
  const mutation = useDelegatedJudgmentStatus()
  return (
    <RevisionedMutationNotice
      kind="delegated-judgment"
      mutation={mutation}
      pendingLabel="Asking delegate…"
      onRetry={retryDelegatedJudgment}
      onDiscard={discardDelegatedJudgment}
    />
  )
}
