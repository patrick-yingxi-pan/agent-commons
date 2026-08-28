/** App wiring for revision-checked conversation metadata edits. */
import { useSyncExternalStore } from 'react'
import type { Session, SessionMetadataPatch } from '../../contract/index.ts'
import {
  AccountSwitchedError,
  ApiRequestError,
  acceptSessionMetadata,
  keys,
  loadSession,
  onAccountSwitch,
  patchSession,
  peek,
} from '../api'
import {
  createSessionMetadataMutationController,
  IDLE_SESSION_METADATA_MUTATION,
  type SessionMetadataMutationFailure,
  type SessionMetadataMutationOutcome,
  type SessionMetadataMutationStatus,
} from './sessionMetadataMutationsCore'

function describeFailure(error: unknown): SessionMetadataMutationFailure {
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

let status: SessionMetadataMutationStatus = IDLE_SESSION_METADATA_MUTATION
const listeners = new Set<() => void>()
const publish = (next: SessionMetadataMutationStatus): void => {
  status = next
  for (const listener of listeners) listener()
}

const cachedSession = (sessionId: string): Session | undefined => {
  const detail = peek<Session>(keys.session(sessionId))
  const row = peek<Session[]>(keys.sessions)?.find((candidate) => candidate.id === sessionId)
  if (!detail) return row
  if (!row) return detail
  return (detail.metadataRevision ?? 0) >= (row.metadataRevision ?? 0) ? detail : row
}

const reconcile = async (sessionId: string): Promise<Session> => {
  const session = await loadSession(sessionId)
  acceptSessionMetadata(session)
  return session
}

const controller = createSessionMetadataMutationController({
  snapshot: cachedSession,
  reconcile,
  mutate: patchSession,
  describeFailure,
  setStatus: publish,
  mintIdempotencyKey: () => crypto.randomUUID(),
})

onAccountSwitch(() => controller.clearAll())

export function enqueueSessionMetadataMutation(
  sessionId: string,
  patch: SessionMetadataPatch,
): Promise<SessionMetadataMutationOutcome> {
  return controller.enqueue(sessionId, patch)
}

export const retrySessionMetadataMutation = controller.retry
export const discardSessionMetadataMutation = controller.discard

export function useSessionMetadataMutationStatus(): SessionMetadataMutationStatus {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => status,
    () => IDLE_SESSION_METADATA_MUTATION,
  )
}
