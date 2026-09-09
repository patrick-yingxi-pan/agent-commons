import { AccountSwitchedError, ApiRequestError } from '../api'
import { applyArtifactCreation, reconcileArtifactCreation, type ArtifactCreationIntent } from '../api/artifactCreationCommands.ts'
import { createAcknowledgedActionMutationController } from './acknowledgedActionMutationCore.ts'
import { publishArtifactCreationStatus } from './artifactCreationMutations.ts'
import type { RevisionedMutationFailure } from './revisionedMutationCore.ts'

function describeFailure(error: unknown): RevisionedMutationFailure {
  if (error instanceof AccountSwitchedError) return { message: 'The active account changed. Reload to continue with the current account.', retryable: false }
  if (error instanceof ApiRequestError) {
    if ([400, 404, 409].includes(error.status)) return { message: error.message, retryable: false }
    if ([401, 403].includes(error.status)) return { message: 'You no longer have permission to create this artifact. Dismiss to review your draft.', retryable: false }
    if (error.status === 429) return { message: 'Artifact creation is temporarily rate-limited. Retry shortly.', retryable: true }
  }
  return { message: 'Couldn’t confirm whether this artifact was created. Retry safely or Dismiss to review your draft.', retryable: true }
}

const controller = createAcknowledgedActionMutationController<ArtifactCreationIntent, undefined>({
  resourceId: (intent) => `artifact-create:${intent.intentId}`,
  snapshot: () => undefined,
  mutate: applyArtifactCreation,
  reconcile: (intent, _baseline, key) => reconcileArtifactCreation(intent, key),
  // Never forget an uncertain create while the exact truth read is unavailable.
  discardReconcileFailure: 'retain',
  describeFailure,
  setStatus: publishArtifactCreationStatus,
  mintIdempotencyKey: (intent) => intent.intentId,
})

export const enqueueArtifactCreationRuntime = controller.enqueue
export const retryArtifactCreationRuntime = controller.retry
export const discardArtifactCreationRuntime = controller.discard
export const clearArtifactCreations = controller.clearAll
