import { useSyncExternalStore } from 'react'
import { onAccountSwitch } from '../api/account.ts'
import { createArtifactEditDraftStore } from './artifactEditDraftsCore.ts'
import { updateArtifactBlock } from './artifactContentMutations.ts'
import { updateStructuredArtifactContent } from './structuredArtifactMutations.ts'
import { isArtifactHistoryRestoreHeld } from './artifactBodyOperationHolds.ts'

export const artifactEditDrafts = createArtifactEditDraftStore((id, draft) =>
  draft.kind === 'document'
    ? updateArtifactBlock(id, draft.block, draft.text)
    : updateStructuredArtifactContent(id, draft.content, draft.expectedRevision),
  (id) => !isArtifactHistoryRestoreHeld(id),
)

onAccountSwitch(artifactEditDrafts.clearAll)

export function useArtifactEditDraft(id: string) {
  return useSyncExternalStore(artifactEditDrafts.subscribe, () => artifactEditDrafts.get(id), () => undefined)
}
