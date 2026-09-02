/** App wiring for conflict-safe contributor configuration edits. */
import type { Commission, CommissionConfigurationPatch } from '../../contract/index.ts'
import {
  AccountSwitchedError,
  ApiRequestError,
  keys,
  newestCommissionConfiguration,
  onAccountSwitch,
  patchCommissionConfiguration,
  peek,
  reconcileCommissionConfiguration,
} from '../api'
import {
  createRevisionedMutationController,
  type RevisionedMutationFailure,
  type RevisionedMutationOutcome,
} from './revisionedMutationCore'
import { createMutationStatusStore } from './mutationStatusStore.ts'
import {
  acquireCommissionMutation,
  isCommissionConfigurationHeld,
  releaseCommissionMutation,
} from './commissionMutationHolds.ts'

function describeFailure(error: unknown): RevisionedMutationFailure {
  if (error instanceof AccountSwitchedError) {
    return { message: 'That contributor change belonged to the previous account. Dismiss it to continue.', retryable: false }
  }
  if (error instanceof ApiRequestError) {
    if (error.status === 409) {
      return {
        message: 'This contributor changed elsewhere. The latest version is loaded behind your held edits—review it, then retry or dismiss.',
        retryable: true,
      }
    }
    if (error.status === 400 || error.status === 404) {
      return { message: 'That contributor change is no longer valid. Dismiss it and review the latest version.', retryable: false }
    }
    if (error.status === 401 || error.status === 403) {
      return { message: 'You no longer have permission to change that contributor. Dismiss it to continue.', retryable: false }
    }
    if (error.status === 429) return { message: 'Too many contributor changes at once. Retry in a moment.', retryable: true }
  }
  return { message: 'Couldn’t confirm the contributor change. Your edits are still here—retry when the connection recovers.', retryable: true }
}

const target = (commissionId: string, projectId: string): string => JSON.stringify([commissionId, projectId])
const ids = (resourceId: string): [string, string] => JSON.parse(resourceId) as [string, string]

const statusStore = createMutationStatusStore()

const cachedCommission = (resourceId: string): Commission | undefined => {
  const [commissionId, projectId] = ids(resourceId)
  return newestCommissionConfiguration(
    peek<Commission[]>(keys.commissions(projectId))?.find((row) => row.id === commissionId),
    peek<Commission[]>(keys.commissions())?.find((row) => row.id === commissionId),
  )
}

const reconcile = async (resourceId: string): Promise<Commission> => {
  const [commissionId, projectId] = ids(resourceId)
  const commission = await reconcileCommissionConfiguration(commissionId, projectId)
  if (!commission) throw new ApiRequestError('not_found', 'That contributor no longer exists.', 404)
  return commission
}

const controller = createRevisionedMutationController<Commission, CommissionConfigurationPatch>({
  snapshot: cachedCommission,
  reconcile,
  revision: (commission) => commission.configurationRevision ?? 0,
  mutate: async (resourceId, patch, expectedRevision, idempotencyKey) => {
    const [commissionId, projectId] = ids(resourceId)
    return patchCommissionConfiguration(commissionId, projectId, patch, expectedRevision, idempotencyKey)
  },
  describeFailure,
  setStatus: statusStore.publish,
  mintIdempotencyKey: () => crypto.randomUUID(),
})

onAccountSwitch(() => controller.clearAll())

export function updateCommissionConfiguration(
  commissionId: string,
  projectId: string,
  patch: CommissionConfigurationPatch,
): Promise<RevisionedMutationOutcome> {
  const lease = acquireCommissionMutation('configuration', commissionId)
  if (!lease) return Promise.resolve('discarded')
  statusStore.refresh()
  const outcome = controller.enqueue(target(commissionId, projectId), patch)
  void outcome.finally(() => {
    releaseCommissionMutation(lease)
    statusStore.refresh()
  })
  return outcome
}

export const retryCommissionMutation = controller.retry
export const discardCommissionMutation = controller.discard

export { isCommissionConfigurationHeld as isCommissionMutationHeld }
export const useCommissionMutationStatus = statusStore.useStatus
