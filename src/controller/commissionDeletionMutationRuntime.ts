/** Lazy transport and destructive FIFO behind Contributor removal. */
import type { Commission } from '../../contract/index.ts'
import {
  AccountSwitchedError,
  ApiRequestError,
  deleteCommission,
  reconcileCommissionConfiguration,
} from '../api'
import { createRevisionedDeletionMutationController } from './revisionedDeletionCore.ts'
import { publishCommissionDeletionStatus } from './commissionDeletionMutations.ts'
import type { RevisionedMutationFailure } from './revisionedMutationCore.ts'

const target = (commissionId: string, projectId: string): string =>
  JSON.stringify([commissionId, projectId])
const ids = (resourceId: string): [string, string] =>
  JSON.parse(resourceId) as [string, string]

function describeFailure(error: unknown): RevisionedMutationFailure & { rebaseOnRetry: boolean } {
  if (error instanceof AccountSwitchedError) {
    return {
      message: 'That Contributor removal belonged to the previous account. Dismiss it to continue.',
      retryable: false,
      rebaseOnRetry: false,
    }
  }
  if (error instanceof ApiRequestError) {
    if (error.status === 409) {
      return {
        message: 'This Contributor changed elsewhere. The latest configuration is loaded—review it, then retry removal or dismiss.',
        retryable: true,
        rebaseOnRetry: true,
      }
    }
    if ([400, 404].includes(error.status)) {
      return {
        message: 'That Contributor is no longer available. Dismiss the removal to continue.',
        retryable: false,
        rebaseOnRetry: false,
      }
    }
    if ([401, 403].includes(error.status)) {
      return {
        message: 'You no longer have permission to remove that Contributor. Dismiss it to continue.',
        retryable: false,
        rebaseOnRetry: false,
      }
    }
    if (error.status === 429) {
      return {
        message: 'Too many Contributor changes at once. Retry removal in a moment.',
        retryable: true,
        rebaseOnRetry: false,
      }
    }
  }
  return {
    message: 'Couldn’t confirm removal. The Contributor remains visible—Retry when the connection recovers or Dismiss.',
    retryable: true,
    rebaseOnRetry: false,
  }
}

const controller = createRevisionedDeletionMutationController<Commission>({
  reconcile: async (resourceId) => {
    const [commissionId, projectId] = ids(resourceId)
    return (await reconcileCommissionConfiguration(commissionId, projectId)) ?? null
  },
  mutate: async (resourceId, expectedRevision, idempotencyKey) => {
    const [commissionId, projectId] = ids(resourceId)
    return deleteCommission(commissionId, projectId, expectedRevision, idempotencyKey)
  },
  revision: (commission) => commission.configurationRevision ?? 0,
  describeFailure,
  setStatus: publishCommissionDeletionStatus,
  mintIdempotencyKey: () => crypto.randomUUID(),
})

export const enqueueCommissionDeletionRuntime = (
  commissionId: string,
  projectId: string,
  expectedRevision: number,
) => controller.enqueue(target(commissionId, projectId), expectedRevision)
export const retryCommissionDeletionRuntime = controller.retry
export const discardCommissionDeletionRuntime = controller.discard
export const clearCommissionDeletions = controller.clearAll
