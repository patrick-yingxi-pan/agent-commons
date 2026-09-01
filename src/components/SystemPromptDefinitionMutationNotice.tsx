import {
  discardSystemPromptDefinitionMutation,
  retrySystemPromptDefinitionMutation,
  useSystemPromptDefinitionMutationStatus,
} from '../controller/systemPromptDefinitionMutations'
import { RevisionedMutationNotice } from './RevisionedMutationNotice'

/** Shell-level acknowledgement and recovery for system-prompt definition edits. */
export function SystemPromptDefinitionMutationNotice() {
  const mutation = useSystemPromptDefinitionMutationStatus()
  return (
    <RevisionedMutationNotice
      kind="system-prompt"
      mutation={mutation}
      pendingLabel="Updating prompt…"
      onRetry={retrySystemPromptDefinitionMutation}
      onDiscard={discardSystemPromptDefinitionMutation}
    />
  )
}
