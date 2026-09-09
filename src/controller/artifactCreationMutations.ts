import type { CreateArtifactRequest } from '../../contract/index.ts'
import { onAccountSwitch } from '../api'
import type { ArtifactCreationIntent } from '../api/artifactCreationCommands.ts'
import { artifactCreationId } from '../api/artifactCreationIdentity.ts'
import { createMutationStatusStore } from './mutationStatusStore.ts'
import { IDLE_REVISIONED_MUTATION, type RevisionedMutationOutcome } from './revisionedMutationCore.ts'
import { createRetryableRuntimeLoader } from './retryableRuntimeLoader.ts'

export interface ArtifactCreationResult { outcome: RevisionedMutationOutcome; artifactId: string }
interface HeldCreation { intent: ArtifactCreationIntent; result: Promise<ArtifactCreationResult> }
const statusStore = createMutationStatusStore()
let held: HeldCreation | null = null
let accountGeneration = 0
export const publishArtifactCreationStatus = statusStore.publish

type Runtime = typeof import('./artifactCreationMutationRuntime.ts')
let runtime: Runtime | null = null
const loadRuntime = createRetryableRuntimeLoader<Runtime>(
  () => import('./artifactCreationMutationRuntime.ts'),
  (loaded) => { runtime = loaded },
)

onAccountSwitch(() => {
  accountGeneration += 1
  held = null
  if (runtime) runtime.clearArtifactCreations()
  else statusStore.publish(IDLE_REVISIONED_MUTATION)
})

export const heldArtifactCreation = (): HeldCreation | null => held
export const useArtifactCreationStatus = statusStore.useStatus
export const retryArtifactCreation = (): void => { runtime?.retryArtifactCreationRuntime() }
export const discardArtifactCreation = (): void => { runtime?.discardArtifactCreationRuntime() }

/** One account-wide creation hold lets every pane reconstruct the submitted
 * form. Repeated activation coalesces; account changes discard late outcomes. */
export function enqueueArtifactCreation(input: { tenantId: string; sourceUserId: string | null; request: CreateArtifactRequest }): Promise<ArtifactCreationResult> {
  if (held) return held.result
  const issuedGeneration = accountGeneration
  const intent: ArtifactCreationIntent = { ...input, request: structuredClone(input.request), intentId: crypto.randomUUID() }
  const outcome = loadRuntime().then((loaded) => issuedGeneration === accountGeneration
    ? loaded.enqueueArtifactCreationRuntime(intent) : 'discarded' as const)
  const result = Promise.all([outcome, artifactCreationId(intent.tenantId, intent.intentId)])
    .then(([settled, artifactId]) => ({ outcome: issuedGeneration === accountGeneration ? settled : 'discarded' as const, artifactId }))
  held = { intent, result }
  statusStore.refresh()
  const release = (): void => {
    if (issuedGeneration !== accountGeneration || held?.result !== result) return
    held = null
    statusStore.refresh()
  }
  void result.then(release, release)
  return result
}
