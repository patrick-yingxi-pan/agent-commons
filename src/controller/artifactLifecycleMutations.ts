import type { ArtifactItem } from '../../contract/cowork.ts'
import type { ArtifactLifecycleState } from '../../contract/artifactLifecycle.ts'
import { onAccountSwitch } from '../api/account.ts'
import { AccountSwitchedError, ApiRequestError } from '../api/client.ts'
import { reconcileArtifactLifecycle, transitionArtifactLifecycle } from '../api/artifactLifecycle.ts'
import { createAcknowledgedActionMutationController } from './acknowledgedActionMutationCore.ts'
import { createMutationStatusStore } from './mutationStatusStore.ts'
import type { RevisionedMutationFailure, RevisionedMutationOutcome } from './revisionedMutationCore.ts'
import { isArtifactHistoryRestoreHeld, isArtifactPermanentDeletionHeld } from './artifactBodyOperationHolds.ts'

export interface ArtifactLifecycleIntent {
  readonly artifact: ArtifactItem
  readonly state: ArtifactLifecycleState
  readonly expectedRevision: number
  readonly sourceUserId: string | null
  readonly intentId: string
}

export interface HeldArtifactLifecycle extends ArtifactLifecycleIntent {
  readonly result: Promise<RevisionedMutationOutcome>
}

const statusStore = createMutationStatusStore()
const held = new Map<string, HeldArtifactLifecycle>()
let accountGeneration = 0

function describeFailure(error: unknown): RevisionedMutationFailure {
  if (error instanceof AccountSwitchedError) {
    return { message: 'The account changed. Review this artifact in the current account.', retryable: false }
  }
  if (error instanceof ApiRequestError) {
    if ([400, 404, 409].includes(error.status)) {
      return { message: 'Artifact state changed. Dismiss to review its saved state.', retryable: false }
    }
    if ([401, 403].includes(error.status)) {
      return { message: 'Artifact access changed. Check your account before continuing.', retryable: false }
    }
    if (error.status === 429) return { message: 'Too many artifact actions. Retry shortly.', retryable: true }
  }
  return { message: 'Couldn’t confirm the action. Retry, or Dismiss to check its saved state.', retryable: true }
}

const controller = createAcknowledgedActionMutationController<ArtifactLifecycleIntent, undefined>({
  resourceId: (intent) => intent.artifact.id,
  snapshot: () => undefined,
  mutate: async (intent, idempotencyKey) => {
    await transitionArtifactLifecycle(intent.artifact.id, {
      state: intent.state,
      expectedRevision: intent.expectedRevision,
    }, idempotencyKey, intent.sourceUserId)
  },
  reconcile: (intent) => reconcileArtifactLifecycle(
    intent.artifact.id,
    intent.state,
    intent.expectedRevision,
    intent.sourceUserId,
  ),
  // A failed authoritative read cannot release the frozen row from Dismiss.
  discardReconcileFailure: 'retain',
  describeFailure,
  setStatus: statusStore.publish,
  mintIdempotencyKey: (intent) => intent.intentId,
})

onAccountSwitch(() => {
  accountGeneration += 1
  held.clear()
  controller.clearAll()
})

export const heldArtifactLifecycle = (id: string): HeldArtifactLifecycle | undefined => held.get(id)
export const heldArtifactLifecycles = (): readonly HeldArtifactLifecycle[] => [...held.values()]
export const useArtifactLifecycleStatus = statusStore.useStatus
export const retryArtifactLifecycle = controller.retry
export const discardArtifactLifecycle = controller.discard

/** Preserve the reviewed row, target, revision and key until the authoritative
 * mutation action settles. Duplicate activation for that artifact coalesces. */
export function enqueueArtifactLifecycle(
  artifact: ArtifactItem,
  state: ArtifactLifecycleState,
  sourceUserId: string | null,
  expectedRevision = artifact.lifecycleRevision ?? 0,
): Promise<RevisionedMutationOutcome> {
  if (isArtifactHistoryRestoreHeld(artifact.id) || isArtifactPermanentDeletionHeld(artifact.id)) return Promise.resolve('discarded')
  const existing = held.get(artifact.id)
  if (existing) return existing.result

  const issuedGeneration = accountGeneration
  const intent: ArtifactLifecycleIntent = {
    artifact: structuredClone(artifact),
    state,
    expectedRevision,
    sourceUserId,
    intentId: crypto.randomUUID(),
  }
  const result = controller.enqueue(intent)
  const entry: HeldArtifactLifecycle = { ...intent, result }
  held.set(artifact.id, entry)
  statusStore.refresh()
  void result.then(() => {
    if (issuedGeneration !== accountGeneration || held.get(artifact.id) !== entry) return
    held.delete(artifact.id)
    statusStore.refresh()
  })
  return result
}
