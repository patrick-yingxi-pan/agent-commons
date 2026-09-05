import { AgentMutationNotice } from './AgentMutationNotice'
import { AgentCreationMutationNotice } from './AgentCreationMutationNotice'
import { AgentForkMutationNotice } from './AgentForkMutationNotice'
import { AgentImportMutationNotice } from './AgentImportMutationNotice'
import { AgentProposalCreationMutationNotice } from './AgentProposalCreationMutationNotice'
import { AgentProposalCommentCreationMutationNotice } from './AgentProposalCommentCreationMutationNotice'
import { AgentProposalVerdictMutationNotice } from './AgentProposalVerdictMutationNotice'
import { ArtifactContentMutationNotice } from './ArtifactContentMutationNotice'
import { CommissionMutationNotice } from './CommissionMutationNotice'
import { CommissionCreationMutationNotice } from './CommissionCreationMutationNotice'
import { DispatchMutationNotice } from './DispatchMutationNotice'
import { DelegationCreationMutationNotice } from './DelegationCreationMutationNotice'
import { DelegationRevocationMutationNotice } from './DelegationRevocationMutationNotice'
import { ContributionCreationMutationNotice } from './ContributionCreationMutationNotice'
import { ContributionLandingMutationNotice } from './ContributionLandingMutationNotice'
import { ContributionEffectExecutionMutationNotice } from './ContributionEffectExecutionMutationNotice'
import { ContributionCrystallizationMutationNotice } from './ContributionCrystallizationMutationNotice'
import { ContributionEnvelopeApprovalMutationNotice } from './ContributionEnvelopeApprovalMutationNotice'
import { ContributionEnvelopeProposalMutationNotice } from './ContributionEnvelopeProposalMutationNotice'
import { ContributionCommentCreationMutationNotice } from './ContributionCommentCreationMutationNotice'
import { ContributionReviewMutationNotice } from './ContributionReviewMutationNotice'
import { ContributionReviewRequirementMutationNotice } from './ContributionReviewRequirementMutationNotice'
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
import { DiscussionPostDeletionMutationNotice } from './DiscussionPostDeletionMutationNotice'
import { SessionForkMutationNotice } from './SessionForkMutationNotice'
import { ToolActivityDecisionMutationNotice } from './ToolActivityDecisionMutationNotice'
import { RelationActionDecisionMutationNotice } from './RelationActionDecisionMutationNotice'
import { ApiTokenRevocationMutationNotice } from './ApiTokenRevocationMutationNotice'
import { ApiTokenMintMutationNotice } from './ApiTokenMintMutationNotice'
import { OrgCreationMutationNotice } from './OrgCreationMutationNotice'
import { OrgInviteOwnerMutationNotice } from './OrgInviteOwnerMutationNotice'
import { OrgInviteVerdictMutationNotice } from './OrgInviteVerdictMutationNotice'

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
      <DiscussionPostDeletionMutationNotice />
      <SessionForkMutationNotice />
      <ToolActivityDecisionMutationNotice />
      <RelationActionDecisionMutationNotice />
      <ApiTokenMintMutationNotice />
      <ApiTokenRevocationMutationNotice />
      <OrgCreationMutationNotice />
      <OrgInviteOwnerMutationNotice />
      <OrgInviteVerdictMutationNotice />
      <SavedContextMutationNotice />
      <SavedContextDeletionNotice />
      <ScheduleMutationNotice />
      <DispatchMutationNotice />
      <DelegationCreationMutationNotice />
      <DelegationRevocationMutationNotice />
      <ContributionCreationMutationNotice />
      <ContributionLandingMutationNotice />
      <ContributionEffectExecutionMutationNotice />
      <ContributionCrystallizationMutationNotice />
      <ContributionEnvelopeApprovalMutationNotice />
      <ContributionEnvelopeProposalMutationNotice />
      <ContributionCommentCreationMutationNotice />
      <ContributionReviewMutationNotice />
      <ContributionReviewRequirementMutationNotice />
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
      <AgentProposalCreationMutationNotice />
      <AgentProposalCommentCreationMutationNotice />
      <AgentProposalVerdictMutationNotice />
      <ProviderDefinitionMutationNotice />
      <ProviderCreationMutationNotice />
      <SystemPromptDefinitionMutationNotice />
      <SystemPromptCreationMutationNotice />
      <CommissionMutationNotice />
      <CommissionCreationMutationNotice />
    </>
  )
}
