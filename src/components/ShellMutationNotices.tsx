import { AgentMutationNotice } from './AgentMutationNotice'
import { AgentCreationMutationNotice } from './AgentCreationMutationNotice'
import { AgentForkMutationNotice } from './AgentForkMutationNotice'
import { AgentImportMutationNotice } from './AgentImportMutationNotice'
import { ArtifactContentMutationNotice } from './ArtifactContentMutationNotice'
import { CommissionMutationNotice } from './CommissionMutationNotice'
import { CommissionCreationMutationNotice } from './CommissionCreationMutationNotice'
import { DispatchMutationNotice } from './DispatchMutationNotice'
import { DelegationCreationMutationNotice } from './DelegationCreationMutationNotice'
import { ContributionCreationMutationNotice } from './ContributionCreationMutationNotice'
import { ContributionLandingMutationNotice } from './ContributionLandingMutationNotice'
import { OpenWorkCreationMutationNotice } from './OpenWorkCreationMutationNotice'
import { WorkItemCommentCreationMutationNotice } from './WorkItemCommentCreationMutationNotice'
import { WorkItemRetractionMutationNotice } from './WorkItemRetractionMutationNotice'
import { ProjectSubGoalReleaseMutationNotice } from './ProjectSubGoalReleaseMutationNotice'
import { SocialProposalCreationMutationNotice } from './SocialProposalCreationMutationNotice'
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
import { SystemPromptCreationMutationNotice } from './SystemPromptCreationMutationNotice'
import { DiscussionSessionLaunchMutationNotice } from './DiscussionSessionLaunchMutationNotice'
import { SessionForkMutationNotice } from './SessionForkMutationNotice'

/** Durable mutation recovery is requested as one deferred shell cluster at
 * workspace boot. This keeps low-frequency command controllers out of the
 * critical bundle while preserving one always-mounted notice per queue. */
export function ShellMutationNotices() {
  return (
    <>
      <RelationMutationNotice />
      <SessionMetadataMutationNotice />
      <SessionDeletionNotice />
      <DiscussionSessionLaunchMutationNotice />
      <SessionForkMutationNotice />
      <SavedContextMutationNotice />
      <SavedContextDeletionNotice />
      <ScheduleMutationNotice />
      <DispatchMutationNotice />
      <DelegationCreationMutationNotice />
      <ContributionCreationMutationNotice />
      <ContributionLandingMutationNotice />
      <OpenWorkCreationMutationNotice />
      <WorkItemCommentCreationMutationNotice />
      <WorkItemRetractionMutationNotice />
      <ProjectSubGoalReleaseMutationNotice />
      <SocialProposalCreationMutationNotice />
      <GrantMutationNotice />
      <SocialPostMutationNotice />
      <ArtifactContentMutationNotice />
      <ProposalVerdictMutationNotice />
      <AgentMutationNotice />
      <AgentCreationMutationNotice />
      <AgentForkMutationNotice />
      <AgentImportMutationNotice />
      <ProviderDefinitionMutationNotice />
      <ProviderCreationMutationNotice />
      <SystemPromptDefinitionMutationNotice />
      <SystemPromptCreationMutationNotice />
      <CommissionMutationNotice />
      <CommissionCreationMutationNotice />
    </>
  )
}
