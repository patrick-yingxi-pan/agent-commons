/** App wiring for revision-checked conversation metadata edits. */
import { useSyncExternalStore } from 'react'
import type { Session, SessionMetadataPatch } from '../../contract/index.ts'
import {
  AccountSwitchedError,
  ApiRequestError,
  onAccountSwitch,
  patchSession,
} from '../api'
import {
  createRevisionedMutationController,
  IDLE_REVISIONED_MUTATION,
  type RevisionedMutationFailure,
  type RevisionedMutationOutcome,
  type RevisionedMutationStatus,
} from './revisionedMutationCore'
import { cachedSession, reconcileSession } from './sessionMutationState'
import { isConversationBindingPatch } from '../lib/conversationBinding'

function describeFailure(error: unknown): RevisionedMutationFailure {
  if (error instanceof AccountSwitchedError) {
    return { message: 'That conversation change belonged to the previous account. Dismiss it to continue.', retryable: false }
  }
  if (error instanceof ApiRequestError) {
    if (error.status === 409) {
      return {
        message: 'This conversation changed elsewhere. The latest version is loaded—review it, then retry your change.',
        retryable: true,
      }
    }
    if (error.status === 400 || error.status === 404) {
      return { message: 'That conversation change is no longer valid. Dismiss it and review the latest version.', retryable: false }
    }
    if (error.status === 401 || error.status === 403) {
      return { message: 'You no longer have permission to change that conversation. Dismiss it to continue.', retryable: false }
    }
    if (error.status === 429) {
      return { message: 'Too many changes at once. Retry in a moment.', retryable: true }
    }
  }
  return { message: 'Couldn’t confirm the conversation change. Your request is still here—retry when the connection recovers.', retryable: true }
}

let status: RevisionedMutationStatus = IDLE_REVISIONED_MUTATION
const listeners = new Set<() => void>()
const publish = (next: RevisionedMutationStatus): void => {
  status = next
  for (const listener of listeners) listener()
}

const controller = createRevisionedMutationController<Session, SessionMetadataPatch>({
  snapshot: cachedSession,
  reconcile: reconcileSession,
  revision: (session) => session.metadataRevision ?? 0,
  mutate: patchSession,
  describeFailure,
  retainOnDismissReadFailure: (patch, error) => isConversationBindingPatch(patch) &&
    !(error instanceof ApiRequestError && error.status === 404),
  setStatus: publish,
  mintIdempotencyKey: () => crypto.randomUUID(),
})

onAccountSwitch(() => controller.clearAll())

export function enqueueSessionMetadataMutation(
  sessionId: string,
  patch: SessionMetadataPatch,
): Promise<RevisionedMutationOutcome> {
  return controller.enqueue(sessionId, patch)
}

export const retrySessionMetadataMutation = controller.retry
export const discardSessionMetadataMutation = controller.discard

export const isSessionBindingHeld = (sessionId: string): boolean =>
  controller.isPending(sessionId, isConversationBindingPatch)

export function useSessionMetadataMutationStatus(): RevisionedMutationStatus {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => status,
    () => IDLE_REVISIONED_MUTATION,
  )
}
