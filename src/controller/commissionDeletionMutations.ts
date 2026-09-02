/** Eager held-state facade for acknowledgement-owned Contributor removal. */
import type { Commission } from '../../contract/index.ts'
import { onAccountSwitch } from '../api'
import type { RevisionedMutationOutcome } from './revisionedMutationCore.ts'
import { IDLE_REVISIONED_MUTATION } from './revisionedMutationCore.ts'
import { createMutationStatusStore } from './mutationStatusStore.ts'
import {
  acquireCommissionMutation,
  isCommissionDeletionHeld,
  releaseCommissionMutation,
} from './commissionMutationHolds.ts'

export const COMMISSION_DELETE_SCOPE =
  'This removes the Agent from this Project and releases any work items it holds. Previous contributions stay.'

const statusStore = createMutationStatusStore()
const heldSnapshots = new Map<string, Commission>()
let accountGeneration = 0
export const publishCommissionDeletionStatus = statusStore.publish

type Runtime = typeof import('./commissionDeletionMutationRuntime.ts')
let runtime: Runtime | null = null
let runtimePromise: Promise<Runtime> | null = null
const loadRuntime = (): Promise<Runtime> => {
  runtimePromise ??= import('./commissionDeletionMutationRuntime.ts').then((loaded) => {
    runtime = loaded
    return loaded
  })
  return runtimePromise
}

onAccountSwitch(() => {
  accountGeneration += 1
  heldSnapshots.clear()
  if (runtime) runtime.clearCommissionDeletions()
  else statusStore.publish(IDLE_REVISIONED_MUTATION)
})

export { isCommissionDeletionHeld }

/** Rows stay renderable even when an early SSE refresh observes committed
 * absence before the originating response/reconciliation settles. */
export const heldCommissionDeletions = (projectId: string): Commission[] =>
  [...heldSnapshots.values()].filter((commission) => commission.projectId === projectId)

export function enqueueCommissionDeletion(
  commission: Commission,
): Promise<RevisionedMutationOutcome> {
  const lease = acquireCommissionMutation('deletion', commission.id)
  if (!lease) return Promise.resolve('discarded')
  const issuedGeneration = accountGeneration
  heldSnapshots.set(commission.id, commission)
  statusStore.refresh()
  const outcome = loadRuntime().then((loaded) =>
    issuedGeneration === accountGeneration
      ? loaded.enqueueCommissionDeletionRuntime(
        commission.id,
        commission.projectId,
        commission.configurationRevision ?? 0,
      )
      : 'discarded' as const,
  )
  void outcome.finally(() => {
    releaseCommissionMutation(lease)
    if (issuedGeneration !== accountGeneration) return
    heldSnapshots.delete(commission.id)
    statusStore.refresh()
  })
  return outcome
}

export const retryCommissionDeletion = (): void => { runtime?.retryCommissionDeletionRuntime() }
export const discardCommissionDeletion = (): void => { runtime?.discardCommissionDeletionRuntime() }
export const useCommissionDeletionStatus = statusStore.useStatus
