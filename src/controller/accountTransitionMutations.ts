/** Tiny eager, single-hold facade for browser account transitions. The hold is
 * account-spanning: the transition itself changes that scope and must survive it. */
import {
  accountTransitionResourceId,
  type AccountTransitionIntent,
  type AccountTransitionTarget,
} from '../api/accountTransitionRevision.ts'
import { createMutationStatusStore } from './mutationStatusStore.ts'
import {
  IDLE_REVISIONED_MUTATION,
  type RevisionedMutationOutcome,
} from './revisionedMutationCore.ts'

interface AccountTransitionRuntime {
  enqueue: (intent: AccountTransitionIntent) => Promise<RevisionedMutationOutcome>
  retry: () => void
  discard: () => void
}

interface HeldAccountTransition {
  intent: AccountTransitionIntent
  result: Promise<RevisionedMutationOutcome>
  settle: (outcome: RevisionedMutationOutcome) => void
}

const statusStore = createMutationStatusStore()
let held: HeldAccountTransition | null = null
let runtime: AccountTransitionRuntime | null = null
let runtimePromise: Promise<AccountTransitionRuntime> | null = null
let runtimeLoadFailed = false
export const publishAccountTransitionStatus = statusStore.publish

function loadRuntime(): Promise<AccountTransitionRuntime> {
  runtimePromise ??= import('./accountTransitionMutationRuntime.ts')
    .then(({ createAccountTransitionMutationRuntime }) => {
      runtime = createAccountTransitionMutationRuntime(publishAccountTransitionStatus)
      return runtime
    })
    .catch((error) => {
      runtimePromise = null
      throw error
    })
  return runtimePromise
}

function release(entry: HeldAccountTransition, outcome: RevisionedMutationOutcome): void {
  if (held !== entry) return
  held = null
  runtimeLoadFailed = false
  entry.settle(outcome)
  statusStore.publish(IDLE_REVISIONED_MUTATION)
}

function start(entry: HeldAccountTransition): void {
  runtimeLoadFailed = false
  statusStore.publish({
    ...IDLE_REVISIONED_MUTATION,
    busy: true,
    activeResourceId: accountTransitionResourceId(entry.intent),
    pendingCount: 1,
  })
  void loadRuntime().then(
    (loaded) => {
      if (held !== entry) return
      void loaded.enqueue(entry.intent).then((outcome) => release(entry, outcome))
    },
    () => {
      if (held !== entry) return
      runtimeLoadFailed = true
      statusStore.publish({
        ...IDLE_REVISIONED_MUTATION,
        error: 'Couldn’t load account-change recovery. Retry or Dismiss.',
        retryable: true,
        activeResourceId: accountTransitionResourceId(entry.intent),
        pendingCount: 1,
      })
    },
  )
}

export function enqueueAccountTransition(input: AccountTransitionTarget): Promise<RevisionedMutationOutcome> {
  if (held) return held.result
  const intent: AccountTransitionIntent = { ...input, intentId: crypto.randomUUID() }
  let settle!: (outcome: RevisionedMutationOutcome) => void
  const result = new Promise<RevisionedMutationOutcome>((resolve) => { settle = resolve })
  const entry = { intent, result, settle }
  held = entry
  start(entry)
  return result
}

export const heldAccountTransition = (): AccountTransitionIntent | null => held?.intent ?? null
export const isAccountTransitionHeld = (): boolean => held !== null
export const retryAccountTransition = (): void => {
  if (runtimeLoadFailed && held) start(held)
  else runtime?.retry()
}
export const discardAccountTransition = (): void => {
  if (runtimeLoadFailed && held) release(held, 'discarded')
  else runtime?.discard()
}
export const useAccountTransitionStatus = statusStore.useStatus
export { accountTransitionResourceId }
export type { AccountTransitionTarget }
