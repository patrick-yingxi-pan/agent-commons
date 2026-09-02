/** Conversation-specific copy and revision adapter for the shared deletion FIFO. */
import type { Session } from '../../contract/index.ts'
import {
  IDLE_REVISIONED_MUTATION,
  type RevisionedMutationFailure,
} from './revisionedMutationCore.ts'
import {
  createRevisionedDeletionMutationController,
  type RevisionedDeletionMutationDeps,
} from './revisionedDeletionCore.ts'

export type SessionDeletionMutationDeps = Omit<RevisionedDeletionMutationDeps<Session>, 'revision'>

/** Translate the HTTP face without importing the browser API client into the
 * pure queue. Busy conflicts preserve the server's actionable explanation and
 * do not expand the revision the person confirmed; stale conflicts alone may
 * rebase a later explicit Retry after reconciliation. */
export function describeSessionDeletionHttpFailure(
  status: number,
  message: string,
): RevisionedMutationFailure & { rebaseOnRetry: boolean } {
  if (status === 409) {
    if (/current reply|current summary/i.test(message)) {
      return { message, retryable: true, rebaseOnRetry: false }
    }
    return {
      message: 'This conversation changed elsewhere. The latest version is loaded—review it, then retry deletion.',
      retryable: true,
      rebaseOnRetry: true,
    }
  }
  if (status === 400 || status === 404) {
    return { message: 'That conversation is no longer available. Dismiss the deletion to continue.', retryable: false, rebaseOnRetry: false }
  }
  if (status === 401 || status === 403) {
    return { message: 'You no longer have permission to delete that conversation. Dismiss it to continue.', retryable: false, rebaseOnRetry: false }
  }
  if (status === 429) {
    return { message: 'Too many changes at once. Retry deletion in a moment.', retryable: true, rebaseOnRetry: false }
  }
  return {
    message: 'Couldn’t confirm deletion. The conversation remains open—retry when the connection recovers.',
    retryable: true,
    rebaseOnRetry: false,
  }
}

export function createSessionDeletionMutationController(deps: SessionDeletionMutationDeps) {
  return createRevisionedDeletionMutationController<Session>({
    ...deps,
    revision: (session) => session.metadataRevision ?? 0,
  })
}

export { IDLE_REVISIONED_MUTATION }
