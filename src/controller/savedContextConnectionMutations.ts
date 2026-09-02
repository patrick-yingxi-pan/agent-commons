/** App wiring for conflict-safe saved Context connect/disconnect intent. */
import { useSyncExternalStore } from 'react'
import type { ContextStatus, SavedContext, SavedContextsSnapshot } from '../../contract/index.ts'
import {
  AccountSwitchedError,
  ApiRequestError,
  keys,
  onAccountSwitch,
  patchSavedContextConnection,
  peek,
  reconcileSavedContextConnection,
} from '../api'
import {
  createRevisionedMutationController,
  IDLE_REVISIONED_MUTATION,
  type RevisionedMutationFailure,
  type RevisionedMutationOutcome,
  type RevisionedMutationStatus,
} from './revisionedMutationCore'

function describeFailure(error: unknown): RevisionedMutationFailure {
  if (error instanceof AccountSwitchedError) {
    return { message: 'That context change belonged to the previous account. Dismiss it to continue.', retryable: false }
  }
  if (error instanceof ApiRequestError) {
    if (error.status === 409) {
      return {
        message: 'This context connection changed elsewhere. The latest status is loaded—review it, then retry or dismiss.',
        retryable: true,
      }
    }
    if (error.status === 400 || error.status === 404) {
      return { message: 'That context connection is no longer available. Dismiss this change and review the latest setup.', retryable: false }
    }
    if (error.status === 401 || error.status === 403) {
      return { message: 'You no longer have permission to change that context. Dismiss it to continue.', retryable: false }
    }
    if (error.status === 429) {
      return { message: 'Too many context changes at once. Retry in a moment.', retryable: true }
    }
  }
  return { message: 'Couldn’t confirm the context change. Your request is still here—retry when the connection recovers.', retryable: true }
}

let status: RevisionedMutationStatus = IDLE_REVISIONED_MUTATION
const listeners = new Set<() => void>()
const heldResourceIds = new Set<string>()
const publish = (next: RevisionedMutationStatus): void => {
  status = next
  for (const listener of listeners) listener()
}

const cachedContext = (id: string): SavedContext | undefined =>
  peek<SavedContextsSnapshot>(keys.savedContexts)?.contexts.find((context) => context.id === id)

const reconcile = async (id: string): Promise<SavedContext> => {
  const context = await reconcileSavedContextConnection(id)
  if (!context) throw new ApiRequestError('not_found', 'That context no longer exists.', 404)
  return context
}

const controller = createRevisionedMutationController<SavedContext, ContextStatus>({
  snapshot: cachedContext,
  reconcile,
  revision: (context) => context.connectionRevision ?? 0,
  mutate: patchSavedContextConnection,
  describeFailure,
  setStatus: publish,
  mintIdempotencyKey: () => crypto.randomUUID(),
})

onAccountSwitch(() => {
  heldResourceIds.clear()
  controller.clearAll()
})

export const isSavedContextConnectionHeld = (id: string): boolean => heldResourceIds.has(id)

export function updateSavedContextConnection(
  id: string,
  next: ContextStatus,
): Promise<RevisionedMutationOutcome> {
  heldResourceIds.add(id)
  const outcome = controller.enqueue(id, next)
  void outcome.finally(() => {
    heldResourceIds.delete(id)
    publish(status)
  })
  return outcome
}

export const retrySavedContextConnectionMutation = controller.retry
export const discardSavedContextConnectionMutation = controller.discard

export function useSavedContextConnectionMutationStatus(): RevisionedMutationStatus {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => status,
    () => IDLE_REVISIONED_MUTATION,
  )
}
