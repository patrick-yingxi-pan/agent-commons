import type { ArtifactItem } from '../../contract/cowork.ts'
import type { ArtifactDeletionPreview, ArtifactDeletionRequest } from '../../contract/artifactDeletion.ts'
import { AccountSwitchedError, ApiRequestError } from '../api/client.ts'
import { onAccountSwitch } from '../api/account.ts'
import { deleteArtifactPermanently, reconcileArtifactPermanentDeletion } from '../api/artifactDeletion.ts'
import { heldArtifactLifecycle } from './artifactLifecycleMutations.ts'
import {
  clearArtifactPermanentDeletionHolds,
  holdArtifactPermanentDeletion,
  isArtifactHistoryRestoreHeld,
  releaseArtifactPermanentDeletion,
} from './artifactBodyOperationHolds.ts'
import { createAcknowledgedActionMutationController } from './acknowledgedActionMutationCore.ts'
import { createMutationStatusStore } from './mutationStatusStore.ts'
import {
  clearArtifactPermanentDeletionRows,
  holdArtifactPermanentDeletionRow,
  releaseArtifactPermanentDeletionRow,
} from './artifactPermanentDeletionProjection.ts'
import type { RevisionedMutationFailure, RevisionedMutationOutcome } from './revisionedMutationCore.ts'

export interface ArtifactPermanentDeletionIntent {
  readonly artifact: ArtifactItem
  readonly preview: ArtifactDeletionPreview
  readonly sourceUserId: string | null
  readonly intentId: string
}

export interface HeldArtifactPermanentDeletion extends ArtifactPermanentDeletionIntent {
  readonly result: Promise<RevisionedMutationOutcome>
}

const statusStore = createMutationStatusStore()
const held = new Map<string, HeldArtifactPermanentDeletion>()
let accountGeneration = 0

function describeFailure(error: unknown): RevisionedMutationFailure {
  if (error instanceof AccountSwitchedError) {
    return { message: 'This deletion belonged to the previous account. Review the artifact in the current account.', retryable: false }
  }
  if (error instanceof ApiRequestError) {
    if (error.status === 409) return { message: 'The reviewed artifact changed. Dismiss to check its saved state, then load a new deletion preview.', retryable: false }
    if (error.status === 400) return { message: 'This deletion review is no longer valid. Dismiss and load a new preview.', retryable: false }
    if (error.status === 401 || error.status === 403) return { message: 'Artifact access changed. Check your account before continuing.', retryable: false }
    if (error.status === 429) return { message: 'Too many artifact changes. Retry this exact deletion shortly.', retryable: true }
  }
  return { message: 'Couldn’t confirm permanent deletion. Retry the same reviewed action or Dismiss to check saved state.', retryable: true }
}

const controller = createAcknowledgedActionMutationController<ArtifactPermanentDeletionIntent, undefined>({
  resourceId: (intent) => intent.artifact.id,
  snapshot: () => undefined,
  mutate: async (intent, idempotencyKey) => {
    const request: ArtifactDeletionRequest = {
      expectedLifecycleRevision: intent.preview.lifecycleRevision,
      reviewToken: intent.preview.reviewToken,
    }
    await deleteArtifactPermanently(intent.artifact.id, request, idempotencyKey, intent.sourceUserId)
  },
  reconcile: (intent) => reconcileArtifactPermanentDeletion(intent.artifact.id, intent.sourceUserId),
  // A failed authoritative read cannot release the reviewed destructive act.
  discardReconcileFailure: 'retain',
  describeFailure,
  setStatus: statusStore.publish,
  mintIdempotencyKey: (intent) => intent.intentId,
})

onAccountSwitch(() => {
  accountGeneration += 1
  const artifactIds = [...held.keys()]
  held.clear()
  for (const artifactId of artifactIds) releaseArtifactPermanentDeletion(artifactId)
  clearArtifactPermanentDeletionRows()
  clearArtifactPermanentDeletionHolds()
  controller.clearAll()
})

export const heldArtifactPermanentDeletion = (id: string): HeldArtifactPermanentDeletion | undefined => held.get(id)
export const heldArtifactPermanentDeletions = (): readonly HeldArtifactPermanentDeletion[] => [...held.values()]
export const useArtifactPermanentDeletionStatus = statusStore.useStatus
export const retryArtifactPermanentDeletion = controller.retry
export const dismissArtifactPermanentDeletion = controller.discard

/** Keep the full reviewed Trash row and one idempotency identity until the
 *  server acknowledges deletion or authoritative absence settles the action. */
export function enqueueArtifactPermanentDeletion(
  artifact: ArtifactItem,
  reviewedPreview: ArtifactDeletionPreview,
  sourceUserId: string | null,
): Promise<RevisionedMutationOutcome> {
  const existing = held.get(artifact.id)
  if (existing) return existing.result
  if (artifact.own === false || (artifact.lifecycleRevision ?? 0) !== reviewedPreview.lifecycleRevision ||
    reviewedPreview.artifactId !== artifact.id || reviewedPreview.lifecycleRevision % 2 !== 1 ||
    isArtifactHistoryRestoreHeld(artifact.id) || heldArtifactLifecycle(artifact.id) ||
    !holdArtifactPermanentDeletion(artifact.id)) return Promise.resolve('discarded')

  const frozenPreview = Object.freeze({
    ...structuredClone(reviewedPreview),
    counts: Object.freeze(structuredClone(reviewedPreview.counts)),
  })
  const intent: ArtifactPermanentDeletionIntent = Object.freeze({
    artifact: Object.freeze(structuredClone(artifact)),
    preview: frozenPreview,
    sourceUserId,
    intentId: crypto.randomUUID(),
  })
  const issuedGeneration = accountGeneration
  const result = controller.enqueue(intent)
  const entry: HeldArtifactPermanentDeletion = { ...intent, result }
  held.set(artifact.id, entry)
  holdArtifactPermanentDeletionRow(intent.artifact)
  statusStore.refresh()
  void result.then(() => {
    if (issuedGeneration !== accountGeneration || held.get(artifact.id) !== entry) return
    held.delete(artifact.id)
    releaseArtifactPermanentDeletionRow(artifact.id)
    releaseArtifactPermanentDeletion(artifact.id)
    statusStore.refresh()
  })
  return result
}
