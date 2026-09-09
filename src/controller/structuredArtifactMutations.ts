import type { ArtifactContent, StructuredArtifactBody, StructuredArtifactContentPatch } from '../../contract/index.ts'
import { AccountSwitchedError, ApiRequestError, onAccountSwitch, patchStructuredArtifactContent, peekArtifactContent, reconcileArtifactContent } from '../api'
import { createRevisionedMutationController, type RevisionedMutationFailure, type RevisionedMutationOutcome } from './revisionedMutationCore.ts'
import { createMutationStatusStore } from './mutationStatusStore.ts'

/** Whole-body replacement is explicit in recovery copy: Retry is a reviewed
 * replacement, not a cell-level merge or a claim that no remote edit happened. */
function describeFailure(error: unknown): RevisionedMutationFailure {
  if (error instanceof AccountSwitchedError) return { message: 'That content edit belonged to the previous account. Dismiss it to continue.', retryable: false }
  if (error instanceof ApiRequestError) {
    if (error.status === 409) return { message: 'This artifact changed elsewhere. Compare the latest saved content below. Retry replaces the entire saved sheet or deck with your held draft; Dismiss keeps the draft editable.', retryable: true }
    if (error.status === 400) return { message: `${error.message} Dismiss the change to review your draft.`, retryable: false }
    if (error.status === 404) return { message: 'That sheet or slide edit is no longer valid or available. Dismiss it to review your draft.', retryable: false }
    if (error.status === 401 || error.status === 403) return { message: 'You no longer have permission to edit this artifact. Dismiss the change to continue.', retryable: false }
  }
  return { message: 'Couldn’t confirm the content edit. Your draft is held—retry when the connection recovers, or dismiss to compare.', retryable: true }
}

const statusStore = createMutationStatusStore()
const holds = new Map<string, number>()
let generation = 0
const controller = createRevisionedMutationController<ArtifactContent, StructuredArtifactContentPatch>({
  snapshot: peekArtifactContent,
  reconcile: async (id) => {
    const body = await reconcileArtifactContent(id)
    if (!body) throw new ApiRequestError('not_found', 'That artifact is no longer available.', 404)
    return body
  },
  revision: (body) => body.revision ?? 0,
  mutate: patchStructuredArtifactContent,
  describeFailure,
  setStatus: statusStore.publish,
  mintIdempotencyKey: () => crypto.randomUUID(),
})
onAccountSwitch(() => { generation += 1; holds.clear(); controller.clearAll() })

export const isStructuredArtifactMutationHeld = (id: string): boolean => (holds.get(id) ?? 0) > 0
export function updateStructuredArtifactContent(id: string, content: StructuredArtifactBody, expectedRevision: number): Promise<RevisionedMutationOutcome> {
  const issued = generation
  holds.set(id, (holds.get(id) ?? 0) + 1)
  const outcome = controller.enqueue(id, { content: structuredClone(content) }, expectedRevision)
  void outcome.finally(() => {
    if (issued !== generation) return
    const remaining = (holds.get(id) ?? 1) - 1
    if (remaining) holds.set(id, remaining)
    else holds.delete(id)
    statusStore.refresh()
  })
  return outcome
}
export const retryStructuredArtifactMutation = controller.retry
export const discardStructuredArtifactMutation = controller.discard
export const useStructuredArtifactMutationStatus = statusStore.useStatus
