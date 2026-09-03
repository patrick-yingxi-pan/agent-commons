import {
  discardSystemPromptDefinitionMutation,
  retrySystemPromptDefinitionMutation,
  useSystemPromptDefinitionMutationStatus,
} from '../controller/systemPromptDefinitionMutations'
import {
  discardSystemPromptDeletion,
  retrySystemPromptDeletion,
  useSystemPromptDeletionStatus,
} from '../controller/systemPromptDeletionMutations.ts'
import { RevisionedMutationNotice } from './RevisionedMutationNotice'

/** Shell-level acknowledgement and recovery for System Prompt definition/removal. */
export function SystemPromptDefinitionMutationNotice() {
  const mutation = useSystemPromptDefinitionMutationStatus()
  const deletion = useSystemPromptDeletionStatus()
  return (
    <>
      <RevisionedMutationNotice
        kind="system-prompt"
        mutation={mutation}
        pendingLabel="Updating prompt…"
        onRetry={retrySystemPromptDefinitionMutation}
        onDiscard={discardSystemPromptDefinitionMutation}
      />
      <RevisionedMutationNotice
        kind="system-prompt-delete"
        mutation={deletion}
        pendingLabel="Removing prompt…"
        onRetry={retrySystemPromptDeletion}
        onDiscard={discardSystemPromptDeletion}
      />
    </>
  )
}
