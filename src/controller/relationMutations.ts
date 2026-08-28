/** App wiring for the account-scoped relation mutation FIFO. */
import {
  acceptRelationOp,
  AccountSwitchedError,
  ApiRequestError,
  applyRelationOp,
  onAccountSwitch,
  reconcileRelationOp,
  resolveMessageRelation,
} from '../api'
import type { RelationMutationFailure } from './relationMutationsCore'

export function describeRelationMutationFailure(error: unknown): RelationMutationFailure {
  if (error instanceof AccountSwitchedError) {
    return {
      message: 'The account for that change could not be verified. Dismiss it and try again from the current account.',
      retryable: false,
    }
  }
  if (error instanceof ApiRequestError) {
    if (error.status === 409) {
      return {
        message: 'That change conflicts with newer information. Dismiss it, review the latest state, and try again.',
        retryable: false,
      }
    }
    if (error.status === 400 || error.status === 404) {
      return {
        message: 'That change is no longer valid. Dismiss it and review the latest state.',
        retryable: false,
      }
    }
    if (error.status === 403) {
      return {
        message: 'You no longer have permission to make that change. Dismiss it to continue.',
        retryable: false,
      }
    }
    if (error.status === 401) {
      return {
        message: 'Your sign-in is no longer valid. Dismiss this change, then sign in again.',
        retryable: false,
      }
    }
    if (error.status === 429) {
      return { message: 'Too many changes at once. Retry in a moment.', retryable: true }
    }
  }
  return {
    message: 'Couldn’t confirm the change. Your request is still here—retry when the connection recovers.',
    retryable: true,
  }
}

export const relationMutationDeps = {
  mutate: applyRelationOp,
  commit: acceptRelationOp,
  reconcile: reconcileRelationOp,
  describeFailure: describeRelationMutationFailure,
  mintIdempotencyKey: () => crypto.randomUUID(),
}

/** The provider installs its own controller instance, but account switching is
 * a process-wide event. This helper keeps the lifecycle subscription beside the
 * API account boundary instead of teaching the pure core about identities. */
export const clearRelationMutationsOnAccountSwitch = (clear: () => void): (() => void) =>
  onAccountSwitch(clear)

/** Persist the historical verdict only after its effect is acknowledged. Kept
 * in the controller layer so the card never becomes a second API door. */
export const recordRelationVerdict = resolveMessageRelation
