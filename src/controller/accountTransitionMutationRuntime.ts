/** Exact recovery runtime for the browser's identity-changing commands. */
import { refreshAccount } from '../api/account.ts'
import { invalidate, resetAll } from '../api/cache.ts'
import { ApiRequestError } from '../api/client.ts'
import { keys } from '../api/keys.ts'
import {
  accountTransitionResourceId,
  type AccountTransitionIntent,
  type AccountTransitionTerminal,
} from '../api/accountTransitionRevision.ts'
import { createAcknowledgedActionMutationController } from './acknowledgedActionMutationCore.ts'
import type { RevisionedMutationFailure, RevisionedMutationStatus } from './revisionedMutationCore.ts'
import { closeAuthScreen, openAuthScreen } from './useAuthScreen.ts'

type AccountTransitionCommands = typeof import('../api/accountTransitionCommands.ts')
let commandsPromise: Promise<AccountTransitionCommands> | null = null

function loadCommands(): Promise<AccountTransitionCommands> {
  commandsPromise ??= import('../api/accountTransitionCommands.ts').catch((error) => {
    commandsPromise = null
    throw error
  })
  return commandsPromise
}

function finalize(terminal: AccountTransitionTerminal): void {
  if (terminal.kind === 'forgotten') {
    invalidate(keys.authAccounts)
    return
  }
  const identity = terminal.identity
  refreshAccount(identity?.via === 'session'
    ? { userId: identity.user.id, tenantId: identity.tenant.id }
    : null)
  resetAll()
  if (identity?.via === 'session') closeAuthScreen()
  else openAuthScreen({ kind: 'picker' })
}

function describeFailure(error: unknown, intent: AccountTransitionIntent): RevisionedMutationFailure {
  if (intent.kind === 'credential-sign-up') {
    return { message: 'Couldn’t confirm whether the account was created. Retry safely.', retryable: true }
  }
  if (error instanceof ApiRequestError) {
    if (error.status === 429) {
      return { message: 'Account changes are temporarily rate-limited. Retry shortly.', retryable: true }
    }
    if ([400, 401, 403, 404].includes(error.status)) {
      return { message: `${error.message} Dismiss to confirm the current account.`, retryable: false }
    }
  }
  return {
    message: 'Couldn’t confirm the current account. Retry safely or Dismiss to check again.',
    retryable: true,
  }
}

export function createAccountTransitionMutationRuntime(
  setStatus: (status: RevisionedMutationStatus) => void,
  onCredentialRejected: (intentId: string, message: string) => void,
) {
  return createAcknowledgedActionMutationController<AccountTransitionIntent, undefined>({
    resourceId: accountTransitionResourceId,
    snapshot: () => undefined,
    mutate: async (intent) => {
      const { applyAccountTransition } = await loadCommands()
      finalize(await applyAccountTransition(intent))
    },
    reconcile: async (intent) => {
      const { reconcileAccountTransition } = await loadCommands()
      const terminal = await reconcileAccountTransition(intent)
      if (!terminal) return false
      finalize(terminal)
      return true
    },
    discardReconcileFailure: 'retain',
    settleRejected: (error, intent) => {
      if (
        (intent.kind === 'credential-sign-in' || intent.kind === 'credential-sign-up') &&
        error instanceof ApiRequestError && [400, 401, 409].includes(error.status)
      ) {
        onCredentialRejected(intent.intentId, error.message)
        return 'discarded'
      }
      return undefined
    },
    describeFailure,
    setStatus,
    // Deliberately not transported as Idempotency-Key: cached Set-Cookie replays
    // could restore an obsolete identity. It is only the local logical intent id.
    mintIdempotencyKey: (intent) => intent.intentId,
  })
}
