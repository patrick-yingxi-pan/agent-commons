/** App wiring for revision-checked artifact body edits. */
import { useSyncExternalStore } from 'react'
import type { ArtifactContent, ArtifactContentPatch } from '../../contract/index.ts'
import {
  AccountSwitchedError,
  ApiRequestError,
  onAccountSwitch,
  patchArtifactContent,
  peekArtifactContent,
  reconcileArtifactContent,
} from '../api'
import {
  createRevisionedMutationController,
  IDLE_REVISIONED_MUTATION,
  type RevisionedMutationFailure,
  type RevisionedMutationOutcome,
  type RevisionedMutationStatus,
} from './revisionedMutationCore'

function describeFailure(error: unknown): RevisionedMutationFailure {
  if (error instanceof AccountSwitchedError) {
    return { message: 'That document edit belonged to the previous account. Dismiss it to continue.', retryable: false }
  }
  if (error instanceof ApiRequestError) {
    if (error.status === 409) {
      return {
        message: 'This document changed elsewhere. The latest version is loaded behind your held draft—retry to apply it, or dismiss to compare.',
        retryable: true,
      }
    }
    if (error.status === 400) {
      return { message: `${error.message} Dismiss the change to review your draft.`, retryable: false }
    }
    if (error.status === 404) {
      return { message: 'That document edit is no longer valid. Dismiss it and review the latest version.', retryable: false }
    }
    if (error.status === 401 || error.status === 403) {
      return { message: 'You no longer have permission to edit that document. Dismiss the change to continue.', retryable: false }
    }
    if (error.status === 429) {
      return { message: 'Too many document edits at once. Retry in a moment.', retryable: true }
    }
  }
  return { message: 'Couldn’t confirm the document edit. Your draft is still here—retry when the connection recovers.', retryable: true }
}

let status: RevisionedMutationStatus = IDLE_REVISIONED_MUTATION
const listeners = new Set<() => void>()
const publish = (next: RevisionedMutationStatus): void => {
  status = next
  for (const listener of listeners) listener()
}

const reconcile = async (artifactId: string): Promise<ArtifactContent> => {
  const body = await reconcileArtifactContent(artifactId)
  if (!body) throw new ApiRequestError('not_found', 'That document no longer exists.', 404)
  return body
}

const controller = createRevisionedMutationController<ArtifactContent, ArtifactContentPatch>({
  snapshot: peekArtifactContent,
  reconcile,
  revision: (body) => body.revision ?? 0,
  mutate: patchArtifactContent,
  describeFailure,
  setStatus: publish,
  mintIdempotencyKey: () => crypto.randomUUID(),
})

onAccountSwitch(() => controller.clearAll())

export function updateArtifactBlock(
  artifactId: string,
  block: number,
  text: string,
): Promise<RevisionedMutationOutcome> {
  return controller.enqueue(artifactId, { block, text })
}

export const retryArtifactContentMutation = controller.retry
export const discardArtifactContentMutation = controller.discard

export function useArtifactContentMutationStatus(): RevisionedMutationStatus {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => status,
    () => IDLE_REVISIONED_MUTATION,
  )
}
