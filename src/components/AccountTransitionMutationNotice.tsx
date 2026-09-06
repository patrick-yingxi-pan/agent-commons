import {
  discardAccountTransition,
  retryAccountTransition,
  useAccountTransitionStatus,
} from '../controller/accountTransitionMutations.ts'
import { RevisionedMutationNotice } from './RevisionedMutationNotice.tsx'

/** Shared recovery surface mounted in whichever top-level world is visible. */
export function AccountTransitionMutationNotice() {
  const mutation = useAccountTransitionStatus()
  return (
    <RevisionedMutationNotice
      kind="account-transition"
      mutation={mutation}
      pendingLabel="Confirming account…"
      onRetry={retryAccountTransition}
      onDiscard={discardAccountTransition}
    />
  )
}
