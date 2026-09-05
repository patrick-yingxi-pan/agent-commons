/** App wiring for the account-scoped relation mutation FIFO. */
import {
  acceptRelationOp,
  AccountSwitchedError,
  ApiRequestError,
  applyRelationOp,
  onAccountSwitch,
  rebaseRelationOp,
  reconcileRelationOp,
} from '../api'
import type { RelationOp } from '../../contract/index.ts'
import type { RelationMutationDeps, RelationMutationFailure } from './relationMutationsCore'

export function describeRelationMutationFailure(error: unknown, op: RelationOp): RelationMutationFailure {
  if (error instanceof AccountSwitchedError) {
    return {
      message: 'The account for that change could not be verified. Dismiss it and try again from the current account.',
      retryable: false,
    }
  }
  if (error instanceof ApiRequestError) {
    if (error.status === 409) {
      if (op.kind === 'set-project-description' || op.kind === 'set-project-instructions') {
        return {
          message: 'This Project changed elsewhere. Your draft is still held—Retry to apply it over the latest text, or Dismiss to compare.',
          retryable: true,
          rebase: true,
        }
      }
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

export function describeProjectCreationFailure(error: unknown): RelationMutationFailure {
  if (error instanceof AccountSwitchedError) {
    return {
      message: 'That Project belonged to the previous account. Dismiss it to continue.',
      retryable: false,
    }
  }
  if (error instanceof ApiRequestError) {
    if (error.status === 400 || error.status === 404) {
      return {
        message: 'That Project request is no longer valid. Dismiss it and review the owner or fields.',
        retryable: false,
      }
    }
    if (error.status === 401 || error.status === 403) {
      return {
        message: 'You no longer have permission to create that Project. Dismiss it to continue.',
        retryable: false,
      }
    }
    if (error.status === 429) {
      return { message: 'Too many Project changes at once. Retry in a moment.', retryable: true }
    }
  }
  return {
    message: 'Couldn’t confirm the new Project. Your request is still here—retry when the connection recovers.',
    retryable: true,
  }
}

export const relationMutationDeps = {
  mutate: applyRelationOp,
  commit: acceptRelationOp,
  reconcile: reconcileRelationOp,
  rebase: rebaseRelationOp,
  describeFailure: describeRelationMutationFailure,
  createProject: (input, idempotencyKey) =>
    import('../api/projectCommands.ts').then(({ createProject }) => createProject(input, idempotencyKey)),
  reconcileProject: () => import('../api/projectCommands.ts')
    .then(({ reconcileProjectCreation }) => reconcileProjectCreation()),
  describeProjectFailure: describeProjectCreationFailure,
  mintIdempotencyKey: () => crypto.randomUUID(),
} satisfies Omit<RelationMutationDeps, 'setStatus'>

/** The provider installs its own controller instance, but account switching is
 * a process-wide event. This helper keeps the lifecycle subscription beside the
 * API account boundary instead of teaching the pure core about identities. */
export const clearRelationMutationsOnAccountSwitch = (clear: () => void): (() => void) =>
  onAccountSwitch(clear)
