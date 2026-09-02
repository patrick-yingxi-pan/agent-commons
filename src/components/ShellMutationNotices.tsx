import { AgentMutationNotice } from './AgentMutationNotice'
import { ArtifactContentMutationNotice } from './ArtifactContentMutationNotice'
import { CommissionMutationNotice } from './CommissionMutationNotice'
import { DispatchMutationNotice } from './DispatchMutationNotice'
import { GrantMutationNotice } from './GrantMutationNotice'
import { ProposalVerdictMutationNotice } from './ProposalVerdictMutationNotice'
import { ProviderDefinitionMutationNotice } from './ProviderDefinitionMutationNotice'
import { ProviderCreationMutationNotice } from './ProviderCreationMutationNotice'
import { RelationMutationNotice } from './RelationMutationNotice'
import { ScheduleMutationNotice } from './ScheduleMutationNotice'
import { SessionMetadataMutationNotice } from './SessionMetadataMutationNotice'
import { SocialPostMutationNotice } from './SocialPostMutationNotice'
import { SessionDeletionNotice } from './SessionDeletionNotice'
import { SavedContextMutationNotice } from './SavedContextMutationNotice'
import { SavedContextDeletionNotice } from './SavedContextDeletionNotice'
import { SystemPromptDefinitionMutationNotice } from './SystemPromptDefinitionMutationNotice'

/** Durable mutation recovery is requested as one deferred shell cluster at
 * workspace boot. This keeps low-frequency command controllers out of the
 * critical bundle while preserving one always-mounted notice per queue. */
export function ShellMutationNotices() {
  return (
    <>
      <RelationMutationNotice />
      <SessionMetadataMutationNotice />
      <SessionDeletionNotice />
      <SavedContextMutationNotice />
      <SavedContextDeletionNotice />
      <ScheduleMutationNotice />
      <DispatchMutationNotice />
      <GrantMutationNotice />
      <SocialPostMutationNotice />
      <ArtifactContentMutationNotice />
      <ProposalVerdictMutationNotice />
      <AgentMutationNotice />
      <ProviderDefinitionMutationNotice />
      <ProviderCreationMutationNotice />
      <SystemPromptDefinitionMutationNotice />
      <CommissionMutationNotice />
    </>
  )
}
