import {
  discardAccountTransition,
  heldAccountTransition,
  retryAccountTransition,
  useAccountTransitionStatus,
} from '../controller/accountTransitionMutations.ts'
import { RevisionedMutationNotice } from './RevisionedMutationNotice.tsx'

/** Shared recovery surface mounted in whichever top-level world is visible. */
export function AccountTransitionMutationNotice() {
  const mutation = useAccountTransitionStatus()
  const held = heldAccountTransition()
  return (
    <RevisionedMutationNotice
      kind="account-transition"
      mutation={mutation}
      pendingLabel="Confirming account…"
      onRetry={retryAccountTransition}
      onDiscard={held?.kind === 'credential-sign-up' ? undefined : discardAccountTransition}
    />
  )
}
