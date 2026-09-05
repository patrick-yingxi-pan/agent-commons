/** Lazy transport and destructive FIFO behind Delegation revocation. */
import type { Delegation } from '../../contract/index.ts'
import {
  applyDelegationRevocation,
  reconcileDelegationRevocation,
} from '../api/delegationRevocationCommands.ts'
import { AccountSwitchedError, ApiRequestError } from '../api'
import { createRevisionedDeletionMutationController } from './revisionedDeletionCore.ts'
import { publishDelegationRevocationStatus } from './delegationRevocationMutations.ts'
import type { RevisionedMutationFailure } from './revisionedMutationCore.ts'

const target = (delegationId: string, projectId: string): string =>
  JSON.stringify([delegationId, projectId])
const ids = (resourceId: string): [string, string] =>
  JSON.parse(resourceId) as [string, string]

function describeFailure(error: unknown): RevisionedMutationFailure & { rebaseOnRetry: boolean } {
  if (error instanceof AccountSwitchedError) {
    return {
      message: 'That Delegation revocation belonged to the previous account. Dismiss it to continue.',
      retryable: false,
      rebaseOnRetry: false,
    }
  }
  if (error instanceof ApiRequestError) {
    if (error.status === 409) {
      return {
        message: 'That authority no longer matches the Delegation you revoked. Dismiss and review the current roster.',
        retryable: false,
        rebaseOnRetry: false,
      }
    }
    if ([400, 404].includes(error.status)) {
      return {
        message: 'That Delegation is no longer available. Dismiss the revocation to continue.',
        retryable: false,
        rebaseOnRetry: false,
      }
    }
    if ([401, 403].includes(error.status)) {
      return {
        message: 'You no longer have permission to revoke that Delegation. Dismiss it to continue.',
        retryable: false,
        rebaseOnRetry: false,
      }
    }
    if (error.status === 429) {
      return {
        message: 'Too many Delegation changes at once. Retry revocation in a moment.',
        retryable: true,
        rebaseOnRetry: false,
      }
    }
  }
  return {
    message: 'Couldn’t confirm revocation. The Delegation remains visible—Retry when the connection recovers or Dismiss.',
    retryable: true,
    rebaseOnRetry: false,
  }
}

const controller = createRevisionedDeletionMutationController<Delegation>({
  reconcile: async (resourceId) => {
    const [delegationId, projectId] = ids(resourceId)
    return reconcileDelegationRevocation(projectId, delegationId)
  },
  mutate: async (resourceId, expectedCreatedAt, idempotencyKey) => {
    const [delegationId, projectId] = ids(resourceId)
    return applyDelegationRevocation(projectId, delegationId, expectedCreatedAt, idempotencyKey)
  },
  revision: (delegation) => delegation.createdAt,
  describeFailure,
  setStatus: publishDelegationRevocationStatus,
  mintIdempotencyKey: () => crypto.randomUUID(),
})

export const enqueueDelegationRevocationRuntime = (
  delegationId: string,
  projectId: string,
  expectedCreatedAt: number,
) => controller.enqueue(target(delegationId, projectId), expectedCreatedAt)
export const retryDelegationRevocationRuntime = controller.retry
export const discardDelegationRevocationRuntime = controller.discard
export const clearDelegationRevocations = controller.clearAll
