import {
  discardSystemPromptCreation,
  retrySystemPromptCreation,
  useSystemPromptCreationStatus,
} from '../controller/systemPromptCreationMutations.ts'
import { RevisionedMutationNotice } from './RevisionedMutationNotice.tsx'

export function SystemPromptCreationMutationNotice() {
  const mutation = useSystemPromptCreationStatus()
  return (
    <RevisionedMutationNotice
      kind="system-prompt-create"
      mutation={mutation}
      pendingLabel="Creating prompt…"
      onRetry={retrySystemPromptCreation}
      onDiscard={discardSystemPromptCreation}
    />
  )
}
