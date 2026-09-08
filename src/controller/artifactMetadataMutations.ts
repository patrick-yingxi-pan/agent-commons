import type { ArtifactItem, ArtifactMetadataPatch } from '../../contract/index.ts'
import {
  AccountSwitchedError,
  ApiRequestError,
  onAccountSwitch,
  patchArtifactMetadata,
  reconcileArtifactMetadata,
  peek,
  keys,
} from '../api'
import {
  createRevisionedMutationController,
  type RevisionedMutationFailure,
  type RevisionedMutationOutcome,
  type RevisionedMutationStatus,
} from './revisionedMutationCore'
import { createMutationStatusStore } from './mutationStatusStore'

function describeFailure(error: unknown): RevisionedMutationFailure {
  if (error instanceof AccountSwitchedError) {
    return { message: 'That artifact rename belonged to the previous account. Dismiss it to continue.', retryable: false }
  }
  if (error instanceof ApiRequestError) {
    if (error.status === 409) return { message: 'This artifact changed elsewhere. The latest name is loaded—review it, then retry your rename.', retryable: true }
    if (error.status === 400 || error.status === 404) return { message: 'That artifact rename is no longer valid. Dismiss it and review the latest name.', retryable: false }
    if (error.status === 401 || error.status === 403) return { message: 'You no longer have permission to rename that artifact. Dismiss the change to continue.', retryable: false }
    if (error.status === 429) return { message: 'Too many artifact changes at once. Retry in a moment.', retryable: true }
  }
  return { message: 'Couldn’t confirm the artifact rename. Your draft is still here—retry when the connection recovers.', retryable: true }
}

const statusStore = createMutationStatusStore()
const heldArtifactCounts = new Map<string, number>()
let accountGeneration = 0
const controller = createRevisionedMutationController<ArtifactItem, ArtifactMetadataPatch>({
  snapshot: (id) => peek<ArtifactItem[]>(keys.artifacts)?.find((artifact) => artifact.id === id),
  reconcile: reconcileArtifactMetadata,
  revision: (artifact) => artifact.metadataRevision ?? 0,
  mutate: patchArtifactMetadata,
  describeFailure,
  setStatus: statusStore.publish,
  mintIdempotencyKey: () => crypto.randomUUID(),
})

onAccountSwitch(() => {
  accountGeneration += 1
  heldArtifactCounts.clear()
  controller.clearAll()
})

export const isArtifactMetadataMutationHeld = (id: string): boolean =>
  (heldArtifactCounts.get(id) ?? 0) > 0

export function enqueueArtifactMetadataMutation(
  artifactId: string,
  patch: ArtifactMetadataPatch,
  expectedRevision?: number,
): Promise<RevisionedMutationOutcome> {
  const issuedGeneration = accountGeneration
  heldArtifactCounts.set(artifactId, (heldArtifactCounts.get(artifactId) ?? 0) + 1)
  const outcome = controller.enqueue(artifactId, patch, expectedRevision)
  void outcome.finally(() => {
    if (issuedGeneration !== accountGeneration) return
    const remaining = (heldArtifactCounts.get(artifactId) ?? 1) - 1
    if (remaining > 0) heldArtifactCounts.set(artifactId, remaining)
    else heldArtifactCounts.delete(artifactId)
    statusStore.refresh()
  })
  return outcome
}

export const retryArtifactMetadataMutation = controller.retry
export const discardArtifactMetadataMutation = controller.discard
export const useArtifactMetadataMutationStatus = statusStore.useStatus
export type { RevisionedMutationStatus }
