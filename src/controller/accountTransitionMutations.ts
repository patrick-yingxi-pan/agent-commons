/** Tiny eager, single-hold facade for browser account transitions. The hold is
 * account-spanning: the transition itself changes that scope and must survive it. */
import {
  accountTransitionResourceId,
  type AccountTransitionIntent,
  type AccountTransitionTarget,
  type CredentialAccountTransitionRequest,
  type VisibleAccountTransition,
  visibleAccountTransition,
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
  credentialError?: string
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
      runtime = createAccountTransitionMutationRuntime(publishAccountTransitionStatus, (intentId, message) => {
        if (held?.intent.intentId === intentId) held.credentialError = message
      })
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
        error: entry.intent.kind === 'credential-sign-up'
          ? 'Couldn’t load account-creation recovery. Retry.'
          : 'Couldn’t load account-change recovery. Retry or Dismiss.',
        retryable: true,
        activeResourceId: accountTransitionResourceId(entry.intent),
        pendingCount: 1,
      })
    },
  )
}

function enqueueHeldAccountTransition(input: AccountTransitionTarget): HeldAccountTransition {
  if (held) return held
  const intent: AccountTransitionIntent = { ...input, intentId: crypto.randomUUID() }
  let settle!: (outcome: RevisionedMutationOutcome) => void
  const result = new Promise<RevisionedMutationOutcome>((resolve) => { settle = resolve })
  const entry = { intent, result, settle }
  held = entry
  start(entry)
  return entry
}

export function enqueueAccountTransition(input: AccountTransitionTarget): Promise<RevisionedMutationOutcome> {
  return enqueueHeldAccountTransition(input).result
}

export async function enqueueCredentialAccountTransition(
  input: CredentialAccountTransitionRequest,
): Promise<{ ok: true } | { ok: false; message?: string }> {
  if (held) return { ok: false, message: 'Finish the current account change before trying again.' }
  let sourceUserId: string | null
  try {
    const { readAccountTransitionSource } = await import('../api/accountTransitionCommands.ts')
    sourceUserId = await readAccountTransitionSource()
  } catch {
    return { ok: false, message: 'Couldn’t read the current account. Try again.' }
  }
  if (held) return { ok: false, message: 'Finish the current account change before trying again.' }
  const entry = enqueueHeldAccountTransition({ ...input, sourceUserId })
  const outcome = await entry.result
  if (entry.credentialError) return { ok: false, message: entry.credentialError }
  return outcome === 'applied' ? { ok: true } : { ok: false }
}

export const heldAccountTransition = (): VisibleAccountTransition | null =>
  held ? visibleAccountTransition(held.intent) : null
export const isAccountTransitionHeld = (): boolean => held !== null
export const retryAccountTransition = (): void => {
  if (runtimeLoadFailed && held) start(held)
  else runtime?.retry()
}
export const discardAccountTransition = (): void => {
  if (held?.intent.kind === 'credential-sign-up') return
  if (runtimeLoadFailed && held) release(held, 'discarded')
  else runtime?.discard()
}
export const useAccountTransitionStatus = statusStore.useStatus
export { accountTransitionResourceId }
export type { AccountTransitionTarget, CredentialAccountTransitionRequest }
