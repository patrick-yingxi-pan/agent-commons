/** App wiring for acknowledgement-gated saved Context removal. */
import { useSyncExternalStore } from 'react'
import type { SavedContext } from '../../contract/index.ts'
import {
  AccountSwitchedError,
  ApiRequestError,
  deleteSavedContext,
  onAccountSwitch,
  reconcileSavedContextConnection,
} from '../api'
import { createRevisionedDeletionMutationController } from './revisionedDeletionCore'
import {
  IDLE_REVISIONED_MUTATION,
  type RevisionedMutationFailure,
  type RevisionedMutationOutcome,
  type RevisionedMutationStatus,
} from './revisionedMutationCore'

function describeFailure(error: unknown): RevisionedMutationFailure & { rebaseOnRetry: boolean } {
  if (error instanceof AccountSwitchedError) {
    return {
      message: 'That removal belonged to the previous account. Dismiss it to continue.',
      retryable: false,
      rebaseOnRetry: false,
    }
  }
  if (error instanceof ApiRequestError) {
    if (error.status === 409) {
      return {
        message: 'This context changed elsewhere. The latest setup is loaded—review it, then retry removal or dismiss.',
        retryable: true,
        rebaseOnRetry: true,
      }
    }
    if (error.status === 400 || error.status === 404) {
      return {
        message: 'That context is no longer available. Dismiss the removal to continue.',
        retryable: false,
        rebaseOnRetry: false,
      }
    }
    if (error.status === 401 || error.status === 403) {
      return {
        message: 'You no longer have permission to remove that context. Dismiss it to continue.',
        retryable: false,
        rebaseOnRetry: false,
      }
    }
    if (error.status === 429) {
      return {
        message: 'Too many context changes at once. Retry removal in a moment.',
        retryable: true,
        rebaseOnRetry: false,
      }
    }
  }
  return {
    message: 'Couldn’t confirm removal. The context remains available—retry when the connection recovers.',
    retryable: true,
    rebaseOnRetry: false,
  }
}

const reconcile = async (id: string): Promise<SavedContext | null> =>
  (await reconcileSavedContextConnection(id)) ?? null

let status: RevisionedMutationStatus = IDLE_REVISIONED_MUTATION
const listeners = new Set<() => void>()
const heldResourceIds = new Set<string>()
const publish = (next: RevisionedMutationStatus): void => {
  status = next
  for (const listener of listeners) listener()
}

const controller = createRevisionedDeletionMutationController<SavedContext>({
  reconcile,
  mutate: deleteSavedContext,
  revision: (context) => context.connectionRevision ?? 0,
  describeFailure,
  setStatus: publish,
  mintIdempotencyKey: () => crypto.randomUUID(),
})

onAccountSwitch(() => {
  heldResourceIds.clear()
  controller.clearAll()
})

export const isSavedContextDeletionHeld = (id: string): boolean => heldResourceIds.has(id)

export function enqueueSavedContextDeletion(
  id: string,
  expectedRevision: number,
): Promise<RevisionedMutationOutcome> {
  heldResourceIds.add(id)
  const outcome = controller.enqueue(id, expectedRevision)
  void outcome.finally(() => {
    heldResourceIds.delete(id)
    publish(status)
  })
  return outcome
}

export const retrySavedContextDeletion = controller.retry
export const discardSavedContextDeletion = controller.discard

export function useSavedContextDeletionStatus(): RevisionedMutationStatus {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => status,
    () => IDLE_REVISIONED_MUTATION,
  )
}
