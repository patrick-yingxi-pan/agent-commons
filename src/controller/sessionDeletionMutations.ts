/** App wiring for acknowledgement-gated conversation deletion. */
import { useSyncExternalStore } from 'react'
import {
  AccountSwitchedError,
  ApiRequestError,
  deleteSession,
  onAccountSwitch,
} from '../api'
import type {
  RevisionedMutationFailure,
  RevisionedMutationOutcome,
  RevisionedMutationStatus,
} from './revisionedMutationCore'
import {
  createSessionDeletionMutationController,
  describeSessionDeletionHttpFailure,
  IDLE_REVISIONED_MUTATION,
} from './sessionDeletionMutationsCore'
import { reconcileSession } from './sessionMutationState'

function describeFailure(error: unknown): RevisionedMutationFailure & { rebaseOnRetry: boolean } {
  if (error instanceof AccountSwitchedError) {
    return { message: 'That deletion belonged to the previous account. Dismiss it to continue.', retryable: false, rebaseOnRetry: false }
  }
  if (error instanceof ApiRequestError) {
    return describeSessionDeletionHttpFailure(error.status, error.message)
  }
  return describeSessionDeletionHttpFailure(0, '')
}

async function reconcilePresence(sessionId: string) {
  try {
    return await reconcileSession(sessionId)
  } catch (error) {
    if (error instanceof ApiRequestError && error.status === 404) return null
    throw error
  }
}

let status: RevisionedMutationStatus = IDLE_REVISIONED_MUTATION
const listeners = new Set<() => void>()
const publish = (next: RevisionedMutationStatus): void => {
  status = next
  for (const listener of listeners) listener()
}

const controller = createSessionDeletionMutationController({
  reconcile: reconcilePresence,
  mutate: deleteSession,
  describeFailure,
  setStatus: publish,
  mintIdempotencyKey: () => crypto.randomUUID(),
})

onAccountSwitch(() => controller.clearAll())

export const enqueueSessionDeletion = controller.enqueue
export const retrySessionDeletion = controller.retry
export const discardSessionDeletion = controller.discard

export function useSessionDeletionStatus(): RevisionedMutationStatus {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => status,
    () => IDLE_REVISIONED_MUTATION,
  )
}

export type { RevisionedMutationOutcome }
