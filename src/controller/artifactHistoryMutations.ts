import type { ArtifactContent, ArtifactHistoryVersionResult } from '../../contract/index.ts'
import { AccountSwitchedError, ApiRequestError } from '../api/client.ts'
import { onAccountSwitch } from '../api/account.ts'
import { readArtifactHistory, restoreArtifactHistoryVersion } from '../api/artifactHistory.ts'
import { acceptArtifactContent, reconcileArtifactContent } from '../api/commands.ts'
import { artifactEditDrafts } from './artifactEditDrafts.ts'
import { heldArtifactLifecycle } from './artifactLifecycleMutations.ts'
import { isStructuredArtifactMutationHeld } from './structuredArtifactMutations.ts'
import { holdArtifactHistoryRestore, isArtifactPermanentDeletionHeld, releaseArtifactHistoryRestore, clearArtifactHistoryRestoreHolds } from './artifactBodyOperationHolds.ts'
import { createAcknowledgedActionMutationController } from './acknowledgedActionMutationCore.ts'
import { createMutationStatusStore } from './mutationStatusStore.ts'
import type { RevisionedMutationFailure, RevisionedMutationOutcome } from './revisionedMutationCore.ts'

export interface ArtifactHistoryRestoreIntent {
  readonly artifactId: string
  readonly targetRevision: number
  readonly expectedRevision: number
  readonly sourceUserId: string | null
  readonly intentId: string
}

export interface HeldArtifactHistoryRestore extends ArtifactHistoryRestoreIntent {
  readonly result: Promise<RevisionedMutationOutcome>
}

const statusStore = createMutationStatusStore()
const held = new Map<string, HeldArtifactHistoryRestore>()
const failureByArtifact = new Map<string, string>()
const dismissedFailureByArtifact = new Map<string, string>()
let generation = 0

function describeFailure(error: unknown, intent?: ArtifactHistoryRestoreIntent): RevisionedMutationFailure {
  let failure: RevisionedMutationFailure
  if (error instanceof AccountSwitchedError) failure = { message: 'This restore belonged to the previous account. Dismiss it to review history in the current account.', retryable: false }
  if (error instanceof ApiRequestError) {
    if (error.status === 409) failure = { message: 'This artifact changed before the restore. Dismiss this reviewed action, reload history, and review the version again.', retryable: false }
    else if (error.status === 400 || error.status === 404) failure = { message: 'The reviewed version is no longer available. Dismiss to reload its saved state.', retryable: false }
    else if (error.status === 401 || error.status === 403) failure = { message: 'You no longer have permission to restore this artifact. Dismiss to continue.', retryable: false }
    else if (error.status === 429) failure = { message: 'Too many artifact actions. Retry this exact restore shortly.', retryable: true }
  }
  failure ??= { message: 'Couldn’t confirm the restore. The reviewed version is held—Retry replays the same action; Dismiss stops retrying and checks saved state.', retryable: true }
  if (intent) failureByArtifact.set(intent.artifactId, failure.message)
  return failure
}

async function adoptCurrent(result: ArtifactHistoryVersionResult): Promise<void> {
  if (result.currentRevision === result.version.revision) {
    acceptArtifactContent(result.artifactId, {
      ...structuredClone(result.version.body),
      revision: result.version.revision,
    } as ArtifactContent)
    return
  }
  // A replay receipt can name a restore that landed before a later edit. Its
  // historical body must never replace the current cache in that case.
  const latest = await reconcileArtifactContent(result.artifactId)
  if (!latest) throw new ApiRequestError('not_found', 'This artifact is no longer available.', 404)
}

async function reconcile(intent: ArtifactHistoryRestoreIntent): Promise<boolean> {
  // Read-only reconciliation: Dismiss never sends a restore and no metadata
  // resemblance is treated as the exact idempotent receipt. The page read is
  // authoritative in Trash too; current body may be unavailable there.
  await readArtifactHistory(intent.artifactId)
  try {
    await reconcileArtifactContent(intent.artifactId)
  } catch (error) {
    if (!(error instanceof ApiRequestError && error.status === 404)) throw error
  }
  return false
}

const controller = createAcknowledgedActionMutationController<ArtifactHistoryRestoreIntent, undefined>({
  resourceId: (intent) => intent.artifactId,
  snapshot: () => undefined,
  mutate: async (intent, key) => {
    const result = await restoreArtifactHistoryVersion(
      intent.artifactId,
      intent.targetRevision,
      { expectedRevision: intent.expectedRevision },
      key,
      intent.sourceUserId,
    )
    await adoptCurrent(result)
  },
  reconcile: async (intent) => reconcile(intent),
  discardReconcileFailure: 'retain',
  describeFailure,
  setStatus: statusStore.publish,
  mintIdempotencyKey: (intent) => intent.intentId,
})

onAccountSwitch(() => {
  generation += 1
  held.clear()
  failureByArtifact.clear()
  dismissedFailureByArtifact.clear()
  clearArtifactHistoryRestoreHolds()
  controller.clearAll()
})

export const heldArtifactHistoryRestore = (id: string): HeldArtifactHistoryRestore | undefined => held.get(id)
export const heldArtifactHistoryRestores = (): readonly HeldArtifactHistoryRestore[] => [...held.values()]
export const useArtifactHistoryRestoreStatus = statusStore.useStatus
export const retryArtifactHistoryRestore = controller.retry
export function dismissArtifactHistoryRestore(): void {
  const active = held.values().next().value as HeldArtifactHistoryRestore | undefined
  if (active) dismissedFailureByArtifact.set(active.artifactId, failureByArtifact.get(active.artifactId) ?? '')
  controller.discard()
}
export const takeDismissedArtifactHistoryRestoreFailure = (id: string): string => {
  const message = dismissedFailureByArtifact.get(id) ?? ''
  dismissedFailureByArtifact.delete(id)
  failureByArtifact.delete(id)
  return message
}

/** Freeze the reviewed target, expected current revision, principal and key at
 * confirmation time. Any overlapping body/lifecycle operation rejects the act. */
export function enqueueArtifactHistoryRestore(
  artifactId: string,
  targetRevision: number,
  expectedRevision: number,
  sourceUserId: string | null,
): Promise<RevisionedMutationOutcome> {
  if (artifactEditDrafts.get(artifactId) || isStructuredArtifactMutationHeld(artifactId) ||
    heldArtifactLifecycle(artifactId) || isArtifactPermanentDeletionHeld(artifactId) || held.size > 0) return Promise.resolve('discarded')
  const issuedGeneration = generation
  const intent: ArtifactHistoryRestoreIntent = {
    artifactId,
    targetRevision,
    expectedRevision,
    sourceUserId,
    intentId: crypto.randomUUID(),
  }
  if (!holdArtifactHistoryRestore(artifactId)) return Promise.resolve('discarded')
  const result = controller.enqueue(intent)
  const entry: HeldArtifactHistoryRestore = { ...intent, result }
  held.set(artifactId, entry)
  statusStore.refresh()
  void result.then(() => {
    if (issuedGeneration !== generation || held.get(artifactId) !== entry) return
    held.delete(artifactId)
    releaseArtifactHistoryRestore(artifactId)
    failureByArtifact.delete(artifactId)
    statusStore.refresh()
  })
  return result
}
