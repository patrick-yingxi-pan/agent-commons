import { Component, lazy, Suspense, useCallback, useContext, useEffect, useId, useMemo, useRef, useState, type Dispatch, type ReactNode, type RefObject, type SetStateAction } from 'react'
import { createPortal } from 'react-dom'
import { isExternalMcpId } from '../../contract/mcpConnections.ts'
import { DeferredMcpConnectionDetail } from './DeferredMcpConnectionPanel.tsx'
import { DeferredCadenceEditor } from './DeferredCadenceEditor.tsx'
import { DeferredMcpConnectionCreateDialog } from './DeferredMcpConnectionCreate.tsx'
import { DeferredProjectWorkDraftPanel } from './DeferredProjectWorkDraftPanel.tsx'
import { DeferredWorkItemContributionPanel } from './DeferredWorkItemContributionPanel.tsx'
import { DeferredWorkItemMcpProposalPanel } from './DeferredWorkItemMcpProposalPanel.tsx'
import { DeferredChangesPanel } from './DeferredChangesPanel.tsx'
import { useContextRegistryProjection } from '../controller/useContextRegistryProjection.ts'
import { useScheduleDraftCommit } from '../controller/useScheduleDraftCommit.ts'
import { automationPresentation, AUTOMATION_NOTICE_CLASS } from '../lib/automationPresentation.ts'
import { namedIconProps } from '../lib/namedIcon.ts'
import { canStopScheduleRun, SCHEDULE_RUN_STOP_LABEL, SCHEDULE_RUN_STOP_PENDING_LABEL, SCHEDULE_RUN_STOP_SCOPE } from '../lib/scheduleRunStopPresentation.ts'
import { dispatchPresentation, dispatchStatusLabel } from '../lib/dispatchPresentation.ts'
import {
  AlertCircle,
  Award,
  BarChart3,
  Bell,
  Bot,
  Box,
  Bug,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ChevronsDown,
  ChevronsUp,
  ChevronUp,
  Clock,
  Cpu,
  ExternalLink,
  FileText,
  Folder,
  FolderOpen,
  FolderGit2,
  GitBranch,
  GitFork,
  GitMerge,
  Github,
  GitPullRequest,
  Globe,
  History,
  KeyRound,
  Lock,
  Mail,
  Maximize2,
  MessageSquare,
  MessageSquarePlus,
  MinusCircle,
  PauseCircle,
  Pencil,
  Play,
  PlayCircle,
  Plug,
  Plus,
  RefreshCw,
  Search,
  Square,
  SendHorizontal,
  Server,
  Share2,
  Sparkles,
  SquareKanban,
  ThumbsUp,
  Flag,
  Focus,
  Reply as ReplyIcon,
  Trash2,
  Unplug,
  X,
  type LucideIcon,
} from 'lucide-react'
import type { AddedContext, ApiToken, AppNotification, ArtifactKind, Connector, SavedContext, SavedContextKind, SectionId, Session } from '../types'
import { SECTION_META } from '../lib/sections'
import { FOLD_HOVER } from '../lib/foldHeader'
import { audienceLabel } from '../lib/audienceLabel'
import { collectionEmptyCopy } from '../lib/collectionEmpty'
import { PAGE_HEADER_CLASS, PAGE_TITLE_CLASS } from '../lib/pageHeader'
import { identityTitleProps } from '../lib/identityTitle'
import { connectorIconFor } from '../lib/connectors'
import { CHIP_TONES, type ChipTone } from '../lib/capabilities'
import { addedToProjectContexts, contextsToConnectors, projectContextTone } from '../lib/projectContext'
import { resolveSavedContext } from '../lib/savedContextIdentity.ts'
import { type CadenceSpec, type Frequency, TIMED_FREQS, WEEKDAY_NAMES, describeCadence, nextRunLabel, parseCadence } from '../lib/cadence'
import {
  displayModelLabel,
  effortLevelsFor,
  isOpusModel,
  modelBlurb,
  parseModelChoice,
  pickedModel,
  pickedProvider,
  resolveEffort,
  type ModelPick,
} from '../lib/models'
import { modelProviderAvailable, modelSetupRequired } from '../lib/modelExecution'
import { updateModelPreferences, useModelPreferences } from '../controller/modelPreferences'
import {
  PALETTES,
  THEME_AXIS_GROUPS,
  deriveThemeTokens,
  effectiveThemeRecipe,
  formatThemeAxisValue,
  loadThemePref,
  loadThemeSettings,
  resetThemeAxis,
  saveThemePref,
  saveThemeSettings,
  setThemeAxis,
  themeOverrideCount,
  themeSettingsForPreset,
  type PaletteId,
  type ThemeAxisDefinition,
  type ThemePref,
  type ThemeRecipe,
  type ThemeSettings,
} from '../lib/theme'
import { ModelPickerMenu } from './ModelPickerMenu'
import { STEP_TOOLS } from '../lib/stepTools'
import { cleanSteps, moveStep, removeStep } from '../lib/steps'
import { DeferredConnectorDetailBody as ConnectorDetailBody } from './DeferredConnectorContextPanel'
import { AddContextButton } from './AddContextButton'
import { INLINE_ACTION_CLASS } from '../lib/inlineAction'
import { useDisclosure } from '../lib/useDisclosure'
import { DIALOG_SURFACE_CLASS } from '../lib/dialog'
import { NotificationRow, type NotificationDoors } from './NotificationList'
import { doorFor } from '../lib/notificationDoor'
import { DOOR_CLASS, STANDING_DOOR_CLASS } from '../lib/textDoor'
import { ROW_DOOR_CLASS, cardDoorClick, isCardControlClick } from '../lib/cardDoor'
import { ROW_DETAIL_CLASS } from '../lib/rowDetail.ts'
import { LEDGER_LIST_CLASS, LEDGER_ROW_CLASS, LEDGER_RULE_CLASS, QUIET_CARD_CLASS } from '../lib/ledger'
import { SOFT_BUTTON_CLASS, DANGER_BUTTON_CLASS, SECONDARY_BUTTON_CLASS } from '../lib/button'
import { composerRows, FIELD_BARE_CLASS, FIELD_SHELL_CLASS, FORM_INPUT_CLASS } from '../lib/formInput'
import { AnchorThreadComposer } from './AnchorThreadComposer'
import { LocusGutter } from './LocusGutter'
import { GrantsPanel } from './GrantsPanel'
import { FollowButton } from './FollowButton'
import { MessageButton } from './MessageButton'
import { DeferredProposalsPanel as ProposalsPanel } from './DeferredProposalsPanel'
import { MentionText } from './MentionText'
import { Tooltip } from './Tooltip'
import { ConfirmDialog } from './ConfirmDialog'
import { describeLocus, locusFocus, sectionForSocialKind, artifactBlockAnchorState } from '../lib/anchorLocus'
import { useArtifactContent } from '../api/hooks'
import type { FocusTarget } from '../lib/notificationDoor'
import { profileTagline, profileTitle } from '../lib/publicFace'
import { mentionHint, squareVoices, workItemVoices } from '../lib/mentionPicker'
import { useMentionPicker } from '../lib/useMentionPicker'
import {
  buildReplyTree,
  descendantsOf,
  draftLine,
  foldAllRoots,
  foldableRoots,
  foldOthers,
  replyIndentClass,
  unfoldBranch,
  DISCARD_SLOT_CLASS,
  FOLD_GUTTER_CLASS,
} from '../lib/replyTree'
import { ActorByline, AgentActor, Byline, CreditLine, OwnerLink, IdentityMark } from './PublicFace'
import { TextDiff } from './TextDiff'
import { CopyButton } from './CopyButton'
import { RelayBadge, RelaySecretPanel } from './RelaySecretPanel.tsx'
import { CheckboxRow, DefaultBadge, DefaultToggle } from './Checkbox'
import { Spinner } from './Spinner'
import { BackButton, PageBackContext } from './BackButton'
import { PageActionButton } from './PageActionButton'
import {
  AtomicResourcePage,
  CompositePageControls,
  CompositeResourcePage,
  FoldPairRow,
  MainCollectionTemplate,
  ResourcePageActions as SectionActions,
  ResourcePageEmpty as PageEmpty,
  ResourcePageHeader as PageHeader,
  ResourcePageList as CardList,
  ResourcePageListPartition as ListPartition,
  ResourcePageSection as FoldSection,
  ResourcePageSynopsisRow as SynopsisRow,
  ResourceUnavailablePage as UnavailableResourcePage,
} from './ResourcePage'
import { SectionFilterMenu } from './SectionFilterMenu'
import { ScheduledFilterMenu } from './ScheduledFilterMenu'
import { SessionFilterMenu } from './SessionFilterMenu'
import type { NavLocation } from '../lib/nav'
import { DRAFT_ID } from '../data/liveSession'
import { COMMONS_LENSES, SECTION_SUBVIEWS } from '../lib/subviews'
import {
  AGENT_SECTION,
  AGENT_SECTIONS,
  agentSection,
  agentSectionForSubview,
  agentToolLabel,
  type AgentSectionId,
} from '../lib/agentStructure'
import {
  ownerProfileSection,
  projectSection,
  scheduleSection,
  type OwnerProfileSectionId,
  type ProjectSectionId,
  type ScheduleSectionId,
} from '../lib/compositeSections'
import { usePendingFocus, useFocusFlash, FOCUS_FLASH_CLASS } from '../lib/focusContext'
import { useSectionFilter } from '../lib/useSectionFilter'
import { useRoutineFilter } from '../lib/useRoutineFilter'
import { useSessionFilter } from '../lib/useSessionFilter'
import { sortSectionRows } from '../lib/sectionFilter'
import { groupProjects, listArtifacts, listContexts, listDiscussions, listProjects, listProviders } from '../lib/sectionLists'
import {
  collectionProjectionItems,
  flatCollectionProjection,
  partitionedCollectionProjection,
  structuralCollectionProjection,
} from '../lib/collectionProjection'
import {
  ACCOUNT_MCP_SECTION,
  LOCAL_FOLDERS_SECTION,
  LOCAL_GIT_SECTION,
  localFolderCollectionSection,
  localGitCollectionSection,
  type LocalFolderContextRow,
  type LocalGitContextRow,
  type CollectionSection,
  artifactCollectionSections,
  collectionSectionLabel,
  contextCollectionSections,
  modelCollectionSections,
} from '../lib/collectionSections'
import { LocalFolderConnect, LocalFolderDetail, LocalFolderRow, LocalFolderStatus } from './DeferredLocalFolders.tsx'
import { LocalGitConnect, LocalGitDetail, LocalGitRow, LocalGitStatus } from './DeferredLocalGit.tsx'
import { useLocalFolderConnections } from '../controller/localFolderConnections.ts'
import { useLocalGitConnections } from '../controller/localGitConnections.ts'
import { localFoldersAvailable } from '../api/localFolderCapability.ts'
import { localGitAvailable } from '../api/localGitCapability.ts'
import { isLocalConnectionId } from '../../contract/localFolderCapture.ts'
import { isLocalGitConnectionId } from '../../contract/localGitCapture.ts'
import { clampRoutineFilter, filterRoutines } from '../lib/routineFilter'
import { clampSessionFilter, filterSessions } from '../lib/sessionFilter'
import { relativeTime, shortRelativeTime } from '../lib/relativeTime'
import { countLabel, countOr } from '../lib/countLabel'
import { Chip } from './Chip'
import { RowMenu, type RowMenuItem } from './RowMenu'
import { ClaudeMark } from './ClaudeMark'
import { useContextCatalog } from '../api/contextCatalog.ts'
import { ContextCatalogNotice } from './ContextCatalogNotice.tsx'
import {
  type ArtifactItem,
  type DispatchRun,
  type Project,
  type ProjectContext,
  type ScheduledRun,
  type ScheduledTask,
  type ScheduleTemplate,
  type StepTool,
  type StepToolTone,
  type WorkflowStep,
} from '../data/cowork'
import {
  useAgentProposals,
  useMe,
  useWatchState,
  useApiTokens,
  useAgents,
  useAgentDirectory,
  useAgentForks,
  useAgentResolvedWork,
  useAuditLog,
  useCommissions,
  useCommissionAuthority,
  useOpenSubGoals,
  useContributions,
  useDiscussion,
  useDiscussions,
  useCommons,
  useMyDiscussions,
  useDirectMessages,
  useFollows,
  useSocialProposals,
  useCanComment,
  useSocialCapability,
  useGrants,
  useAttention,
  useMyWork,
  useOwnerProfile,
  useMyOrgs,
  useOrgMembers,
  useOrgInvites,
  useProjectDirectory,
  useProjectSubGoals,
  useDispatchRuns,
  useCapabilities,
  useProviders,
  useAdminUsers,
  useAdminTenants,
  useAdminInvites,
  useAdminTokens,
  useAdminAudit,
  useAdminOps,
  useSavedContexts,
  useProjects,
  useArtifacts,
  useRelationGraph,
  useScheduleTemplates,
  useSchedules,
  useSessions,
  useSystemPrompts,
  useAgentToolCatalog,
  useNotifications,
} from '../api/hooks.ts'
import { API_BASE } from '../api/client.ts'
import { a2aAgentCardUrl, probePrompt, reactToDiscussionPost, recordView, reportDiscussionPost } from '../api/commands.ts'
import { desktopCredentialsAvailable } from '../api/desktopCredentials.ts'
import { type ResourceUnavailableState, resolveResourceUnavailable, retryResourceQueries } from '../api/resourceRead.ts'
import { invalidate } from '../api/cache.ts'
import { keys } from '../api/keys.ts'
import {
  createProviderConnectionAttempt,
  enqueueProviderConnection,
  isProviderConnectionHeld,
  useProviderConnectionStatus,
} from '../controller/providerConnectionMutations.ts'
import {
  enqueueProviderCatalogRefresh,
  isProviderCatalogRefreshHeld,
  useProviderCatalogRefreshStatus,
} from '../controller/providerCatalogRefreshMutations.ts'
import {
  enqueueProviderSecretRotation,
  useProviderSecretRotationStatus,
} from '../controller/providerSecretRotationMutations.ts'
import {
  isScheduleMutationHeld,
  toggleScheduleEnabled,
  updateSchedule,
  useScheduleMutationStatus,
} from '../controller/scheduleMutations'
import {
  enqueueScheduleDeletion,
  isScheduleDeletionHeld,
  ROUTINE_DELETE_SCOPE,
  ROUTINE_MUTATION_WAIT,
  useScheduleDeletionStatus,
} from '../controller/scheduleDeletionMutations'
import {
  enqueueScheduleRun,
  isScheduleRunHeld,
  useScheduleRunStatus,
} from '../controller/scheduleRunMutations'
import { enqueueScheduleRunStop, isScheduleRunStopHeldForTask, useScheduleRunStopStatus } from '../controller/scheduleRunStopMutations'
import {
  enqueueScheduleCreation,
} from '../controller/scheduleCreationMutations'
import type { RevisionedMutationOutcome } from '../controller/revisionedMutationCore'
import { SHARING_MUTATION_WAIT } from '../controller/grantMutations.ts'
import {
  heldProjectWorkDraftSelection,
  useDispatchMutationStatus,
} from '../controller/dispatchMutations'
import {
  isAgentMutationHeld,
  updateAgent,
  useAgentMutationStatus,
} from '../controller/agentMutations'
import { enqueueAgentCreation } from '../controller/agentCreationMutations'
import {
  enqueueAgentImport,
  heldAgentImportUrl,
  useAgentImportStatus,
} from '../controller/agentImportMutations.ts'
import {
  enqueueAgentFork,
  isAgentForkHeld,
  useAgentForkStatus,
} from '../controller/agentForkMutations.ts'
import {
  AGENT_DELETE_SCOPE,
  enqueueAgentDeletion,
  heldAgentDeletions,
  isAgentDeletionHeld,
  useAgentDeletionStatus,
} from '../controller/agentDeletionMutations.ts'
import {
  enqueueAgentProposalCreation,
  heldAgentProposalCreation,
  isAgentProposalCreationHeld,
  useAgentProposalCreationStatus,
} from '../controller/agentProposalCreationMutations.ts'
import {
  enqueueAgentProposalCommentCreation,
  heldAgentProposalCommentIntent,
  useAgentProposalCommentCreationStatus,
} from '../controller/agentProposalCommentCreationMutations.ts'
import {
  isCommissionMutationHeld,
  useCommissionMutationStatus,
} from '../controller/commissionMutations'
import {
  COMMISSION_DELETE_SCOPE,
  enqueueCommissionDeletion,
  heldCommissionDeletions,
  isCommissionDeletionHeld,
  useCommissionDeletionStatus,
} from '../controller/commissionDeletionMutations.ts'
import {
  isProviderDefinitionHeld,
  updateProviderDefinition,
  useProviderDefinitionMutationStatus,
} from '../controller/providerDefinitionMutations'
import { enqueueProviderCreation } from '../controller/providerCreationMutations'
import {
  PROVIDER_DELETE_SCOPE,
  enqueueProviderDeletion,
  heldProviderDeletions,
  isProviderDeletionHeld,
  useProviderDeletionStatus,
} from '../controller/providerDeletionMutations.ts'
import {
  isSystemPromptDefinitionHeld,
  updateSystemPromptDefinition,
  useSystemPromptDefinitionMutationStatus,
} from '../controller/systemPromptDefinitionMutations'
import { enqueueSystemPromptCreation } from '../controller/systemPromptCreationMutations'
import {
  useDelegationRevocationStatus,
} from '../controller/delegationRevocationMutations.ts'
import { useDelegationPolicyHolds } from '../controller/delegationPolicyHolds.ts'
import { isDelegatedJudgmentHeld, useDelegatedJudgmentStatus } from '../controller/delegatedJudgmentMutations.ts'
import {
  apiTokenMintReveal,
  clearApiTokenMintReveal,
  enqueueApiTokenMint,
  heldApiTokenMint,
  resumeApiTokenMint,
  useApiTokenMintStatus,
} from '../controller/apiTokenMintMutations.ts'
import {
  enqueueApiTokenRevocation,
  heldApiTokenRevocations,
  isApiTokenRevocationHeld,
  useApiTokenRevocationStatus,
} from '../controller/apiTokenRevocationMutations.ts'
import {
  enqueueOrgInviteIssue,
  enqueueOrgInviteRevoke,
  heldOrgInviteIssue,
  heldOrgInviteRevoke,
  heldOrgInviteRevokes,
  isOrgInviteOwnerActionHeld,
  useOrgInviteOwnerStatus,
} from '../controller/orgInviteOwnerMutations.ts'
import { orgInviteOwnerResourceId } from '../api/orgInviteOwnerRevision.ts'
import {
  enqueueContributionLanding,
  isContributionLandingHeld,
  useContributionLandingStatus,
} from '../controller/contributionLandingMutations.ts'
import {
  enqueueContributionEffectExecution,
  heldContributionEffectExecutionIntent,
  isContributionEffectExecutionHeld,
  useContributionEffectExecutionStatus,
} from '../controller/contributionEffectExecutionMutations.ts'
import {
  enqueueContributionCrystallization,
  heldContributionCrystallizationIntent,
  isContributionCrystallizationHeld,
  useContributionCrystallizationStatus,
} from '../controller/contributionCrystallizationMutations.ts'
import {
  enqueueContributionEnvelopeApproval,
  heldContributionEnvelopeApprovalIntent,
  isContributionEnvelopeApprovalHeld,
  useContributionEnvelopeApprovalStatus,
} from '../controller/contributionEnvelopeApprovalMutations.ts'
import {
  enqueueContributionEnvelopeProposal,
  heldContributionEnvelopeProposalIntent,
  isContributionEnvelopeProposalHeld,
  useContributionEnvelopeProposalStatus,
} from '../controller/contributionEnvelopeProposalMutations.ts'
import {
  enqueueContributionCommentCreation,
  heldContributionCommentIntent,
  useContributionCommentCreationStatus,
} from '../controller/contributionCommentCreationMutations.ts'
import {
  isContributionReviewHeld,
  useContributionReviewStatus,
} from '../controller/contributionReviewMutations.ts'
import { useContributionMcpEffectAttempt } from '../api/hooks.ts'
import {
  enqueueContributionReviewRequirement,
  isContributionReviewRequirementHeld,
  useContributionReviewRequirementStatus,
} from '../controller/contributionReviewRequirementMutations.ts'
import {
  enqueueOpenWorkCreation,
  heldOpenWorkIntent,
  useOpenWorkCreationStatus,
} from '../controller/openWorkCreationMutations.ts'
import {
  enqueueWorkItemCommentCreation,
  heldWorkItemCommentIntent,
  useWorkItemCommentCreationStatus,
} from '../controller/workItemCommentCreationMutations.ts'
import { useAppliedWorkItemComment } from '../controller/useAppliedWorkItemComment.ts'
import {
  WORK_ITEM_RETRACTION_SCOPE,
  enqueueWorkItemRetraction,
  isWorkItemRetractionHeld,
  useWorkItemRetractionStatus,
} from '../controller/workItemRetractionMutations.ts'
import {
  enqueueProjectSubGoalClaim,
  heldProjectSubGoalClaimIntent,
  isProjectSubGoalClaimScopeHeld,
  useProjectSubGoalClaimStatus,
} from '../controller/projectSubGoalClaimMutations.ts'
import {
  enqueueProjectSubGoalRelease,
  isProjectSubGoalReleaseHeld,
  isProjectSubGoalReleaseScopeHeld,
  useProjectSubGoalReleaseStatus,
} from '../controller/projectSubGoalReleaseMutations.ts'
import {
  SYSTEM_PROMPT_DELETE_SCOPE,
  enqueueSystemPromptDeletion,
  heldSystemPromptDeletions,
  isSystemPromptDeletionHeld,
  useSystemPromptDeletionStatus,
} from '../controller/systemPromptDeletionMutations.ts'
import {
  enqueueWallPost,
  isWallPostMutationHeld,
  useSocialPostMutationStatus,
} from '../controller/socialPostMutations.ts'
import {
  enqueueDiscussionSessionLaunch,
  isDiscussionSessionLaunchHeld,
  useDiscussionSessionLaunchStatus,
} from '../controller/discussionSessionLaunchMutations.ts'
import {
  discussionPostDeletionResourceId,
  enqueueDiscussionPostDeletion,
  heldDiscussionPostDeletion,
  isDiscussionPostDeletionHeld,
  useDiscussionPostDeletionStatus,
} from '../controller/discussionPostDeletionMutations.ts'
import {
  enqueueDiscussionState,
  isDiscussionStateHeld,
  useDiscussionStateStatus,
} from '../controller/discussionStateMutations.ts'
import {
  discussionReadResourceId,
  enqueueDiscussionRead,
  heldDiscussionRead,
  heldDiscussionReadFor,
  useDiscussionReadStatus,
} from '../controller/discussionReadMutations.ts'
import {
  adminActionResourceId,
  enqueueAdminAction,
  heldAdminAction,
  useAdminActionStatus,
  type AdminActionTarget,
} from '../controller/adminActionMutations.ts'
import {
  enqueueSavedContextCreation,
  isSavedContextCreationHeld,
  useSavedContextCreationStatus,
} from '../controller/savedContextCreationMutations.ts'
import {
  commonsLikeResourceId,
  enqueueCommonsLike,
  heldCommonsLike,
  useCommonsLikeStatus,
} from '../controller/commonsLikeMutations.ts'
import {
  enqueueNotificationRead,
  heldNotificationRead,
  heldNotificationReadFor,
  notificationReadResourceId,
  useNotificationReadStatus,
} from '../controller/notificationReadMutations.ts'
import {
  enqueueStandingRelationship,
  heldWatchRelationship,
  useStandingRelationshipStatus,
  watchRelationshipResourceId,
} from '../controller/standingRelationshipMutations.ts'
import {
  isSavedContextConnectionHeld,
  updateSavedContextConnection,
  useSavedContextConnectionMutationStatus,
} from '../controller/savedContextConnectionMutations'
import {
  enqueueSavedContextDeletion,
  isSavedContextDeletionHeld,
  useSavedContextDeletionStatus,
} from '../controller/savedContextDeletionMutations'
import {
  promptFitWarning,
  defaultEntry,
  PROJECT_ROLES,
  PROJECT_EFFECT_TYPES,
  OPEN_WORK_FIELD_MAX,
  WORK_ITEM_COMMENT_MAX,
  SELF_PROJECT_HOLDER,
  SHARE_TIERS,
  discussionTitle,
  CONTRIBUTION_FIELD_MAX,
  type CommonsItem,
  type FollowRow,
  type Discussion,
  type DiscussionPost,
  type ShareTier,
  type SocialAnchor,
  type SocialEntityRef,
  CHANGE_ENTRY_KINDS,
  AUDIT_CHANNEL_LABEL,
  type ChangeEntryKind,
  type A2aAgentCard,
  type Agent,
  type AgentToolEntry,
  type AgentChangeProposal,
  type ProposeAgentChangeRequest,
  type AgentChangelogEntry,
  type AgentDirectoryEntry,
  type AuditEntry,
  type AdminInviteRow,
  type AdminTenantRow,
  type AdminUserRow,
  type MyOrg,
  type OpenSubGoal,
  type Contribution,
  type OwnerProfile,
  type WorkItemComment,
  type ProjectDirectoryEntry,
  type Commission,
  type CreatedProvider,
  type ModelProvider,
  type ProjectEffectType,
  type ProjectRole,
  type PromptProbeResult,
  type SystemPromptEntry,
  DEFAULT_PROVIDER_ID,
  MAX_SYSTEM_PROMPT_BODY_CHARS,
} from '../../contract/index.ts'
import { authorityLabel, providerPlanLabel } from '../lib/agentCommonsLabels'
import { bootstrapPrompt } from '../lib/connectorInstall'
import { ArtifactDetailPage, KIND_ICON, KIND_LABEL } from './artifactPreview'
import { artifactHistoryRevision } from '../lib/artifactHistoryLocation.ts'
import { parseArtifactSearchTarget } from '../../contract/artifactSearch.ts'
import { heldArtifactCreation } from '../controller/artifactCreationMutations'
import { InlineOperationStatus } from './InlineOperationStatus'
import { useTrashedArtifacts } from '../api/artifactLifecycle'
import { heldArtifactLifecycle, heldArtifactLifecycles, useArtifactLifecycleStatus } from '../controller/artifactLifecycleMutations'
import { heldArtifactPermanentDeletionRow, useArtifactPermanentDeletionRows } from '../controller/artifactPermanentDeletionProjection.ts'
import { artifactTrashProjection } from '../lib/artifactTrashProjection'
import { ARTIFACT_TRASH_SECTION } from '../lib/collectionSections'
import { DeferredNewArtifactDialog as NewArtifactDialog } from './DeferredNewArtifactDialog.tsx'
import { DeferredNewDispatchDialog } from './DeferredNewDispatchDialog.tsx'
import { DeferredCommissionDialog } from './DeferredCommissionDialog.tsx'
import { DeferredCommissionAdd as CommissionAdd } from './DeferredCommissionAdd.tsx'
import { DeferredCommissionMcpApprovalPanel } from './DeferredCommissionMcpApprovalPanel.tsx'
import { isCommissionMcpHeld, useCommissionMcpMutationStatus } from '../controller/commissionMcpMutationState.ts'
import { DeferredAgentProposalsReviewDialog } from './DeferredAgentProposalsReviewDialog.tsx'
import { DeferredContributionReviewPanel } from './DeferredContributionReviewPanel.tsx'
import { DeferredContributionEnvelopeCard } from './DeferredContributionEnvelopeCard.tsx'
import { DeferredDelegatedJudgmentPanel } from './DeferredDelegatedJudgmentPanel.tsx'
import { FormDialog, FormField } from './FormDialog.tsx'
import { artifactMetaIsSpecific } from '../lib/artifactMeta'
import { artifactSourceSessionId } from '../lib/artifactSource'
import { resolvedByCommission, resolvedWorkKindLabel, type CommissionTrackRecordSummary } from '../lib/commissionTrackRecord'
import { useFocusTrap } from '../lib/useFocusTrap'
import { useDismissable } from '../lib/useDismissable'
import { SCRIM_CLASS } from '../lib/scrim'
import { POPOVER_SURFACE } from '../lib/popover'
import { usePopoverShift } from '../lib/usePopoverShift'
import { useRelations } from '../controller/useRelations'
import { runSessionId } from '../../contract/ids.ts'
import { HOVER_REVEAL, HOVER_CUE, SECTION_REVEAL_GROUP } from '../lib/hoverReveal'
import { SectionAction } from './SectionAction'
import { TierBadge } from './TierBadge'
import { TIER_LABELS } from '../lib/tierBadge'
import { CompositeProjectionScope, useCompositeCommand } from '../lib/useCompositeFeatures'

/** The reading-page projections for cross-cutting resources (Projects,
 *  Artifacts, …). They share a title block, reading column and FoldSection
 *  vocabulary while their payload keeps its honest form — an artifact detail
 *  is a document and a scannable project index remains a ledger row. Sessions
 *  join the same atomic template through ConversationPane's workspace layout. */
const DeferredDesktopDataCard = lazy(() => import('./DesktopDataCard').then(({ DesktopDataCard }) => ({ default: DesktopDataCard })))

class DesktopDataBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  render() {
    return this.state.failed
      ? <InlineOperationStatus tone="alert" message="Couldn’t load backup controls. Your data was not changed. Copy unsent text before reloading." action={{ label: 'Reload app', onClick: () => window.location.reload() }} />
      : this.props.children
  }
}

const DeferredDelegationPanel = lazy(() => import('./DelegationPanel').then(({ DelegationPanel }) => ({ default: DelegationPanel })))
const DeferredRoutineMcpApprovalPanel = lazy(() => import('./RoutineMcpApprovalPanel.tsx').then(({ RoutineMcpApprovalPanel }) => ({ default: RoutineMcpApprovalPanel })))

/** Keep the shared section anatomy while its controls load. A bare status row
 * moved the neighboring Land button between pointer-down and pointer-up. */
function DelegationPanelPlaceholder({ failed = false }: { failed?: boolean }) {
  return (
    <FoldSection
      title="Delegation"
      defaultFolded
      summary={<span role={failed ? 'alert' : 'status'}>{failed ? 'Couldn’t load Delegation controls. Open for recovery.' : 'Loading Delegation controls…'}</span>}
    >
      {failed
        ? <InlineOperationStatus tone="alert" message="Couldn’t load Delegation controls. Opening the panel does not send changes. Held edits remain available in recovery. Reloading clears unsent drafts and in-memory recovery; copy your draft and check saved versions afterward." action={{ label: 'Reload app', onClick: () => window.location.reload() }} />
        : <InlineOperationStatus tone="status" message="Loading Delegation controls…" />}
    </FoldSection>
  )
}

class DelegationPanelBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  render() {
    return this.state.failed
      ? <DelegationPanelPlaceholder failed />
      : this.props.children
  }
}

export function SectionView({
  section,
  subview,
  onOpenSubview,
  onOpenSession,
  onFocusHere,
  onNewSession,
  onOpenProject,
  onOpenSchedule,
  onOpenProposal,
  onBack,
  onOpenArtifactTrash,
  backTo,
  railCollapsed = false,
  focusCollectionSectionId = null,
  focusProjectId = null,
  focusProjectSectionId = null,
  focusScheduleId = null,
  focusScheduleSectionId = null,
  focusOwnerSectionId = null,
  focusOwnerName = null,
  focusWorkItemId = null,
  focusContributionId = null,
  focusAgentId = null,
  focusPromptId = null,
  focusToolId = null,
  focusContextId = null,
  focusAdminUserId = null,
  focusDiscussionId = null,
  focusArtifactId = null,
  focusArtifactRevision = null,
  focusArtifactMatch = null,
  focusProviderId = null,
  railProjectionActive = false,
  onOpenAgentPage,
}: {
  section: SectionId
  /** The active sub-view (lib/subviews) the rail drilled into — the section body
   *  renders it. null when the section has no sub-views. */
  subview: string | null
  /** Switch sub-view from inside the body (the Agents hub resets to its default
   *  worker-list surface — null — on a notification door). */
  onOpenSubview: (id: string | null) => void
  onOpenSession: (id: string) => void
  /** Aim the transient highlight at a position in this pane — the second half
   *  of a locus door (SOCIAL-6b), after the caller navigates. */
  onFocusHere: (target: FocusTarget) => void
  onNewSession: () => void
  /** Open a project / routine detail through the controller, so every entry is one
   *  source of truth (the focus id below) and is recorded in navigation history. */
  onOpenProject: (id: string) => void
  onOpenSchedule: (id: string) => void
  /** Open a change proposal on its review surface (the bell's door, reused by the
   *  Your-work dashboard rows). */
  onOpenProposal: (agentId: string, proposalId: string, ownerName: string | null) => void
  /** Pop navigation history (the dynamic "back"), and where it leads — so a detail
   *  back button returns to where you came from and can name that destination. */
  onBack: () => void
  onOpenArtifactTrash?: () => void
  backTo: NavLocation | null
  /** When the left rail is collapsed, a floating expand toggle sits in the
   *  top-left of this panel; inset the content so it clears that button rather
   *  than rendering underneath it. */
  railCollapsed?: boolean
  /** One structural section inside an Artifacts, Contexts, or Models root. */
  focusCollectionSectionId?: string | null
  /** The project / routine detail to show (null = the section list). The single
   *  source of truth for which detail is open — driven by the controller whether
   *  reached by a breadcrumb, a deep-link, or a list-card click. */
  focusProjectId?: string | null
  /** A dedicated section page inside the open Project. */
  focusProjectSectionId?: string | null
  focusScheduleId?: string | null
  /** A dedicated section page inside the open routine. */
  focusScheduleSectionId?: string | null
  /** A dedicated section page inside the open namespace profile. */
  focusOwnerSectionId?: string | null
  /** A namespace profile open under the COMMONS section (D21, `OWNER_SECTION`)
   *  — the display name. A profile is a social page, so the social section hosts
   *  it; it sat under Agents until 2026-08-09 only because profiles were first
   *  reached from that hub's Discover directory, and the rail showed the seam
   *  (opening a profile lit Agents). Same single-source-of-truth discipline as
   *  the two above. */
  focusOwnerName?: string | null
  /** A work item's own page under the open project (the issue-page analog) —
   *  meaningful only with `focusProjectId`; null = the project page itself. */
  focusWorkItemId?: string | null
  /** A contribution's own page under the open project (the PR-page analog,
   *  workflow Phase A) — meaningful only with `focusProjectId`. */
  focusContributionId?: string | null
  /** A published definition's own page under Agents (COMMONS-26); null = hub/profile. */
  focusAgentId?: string | null
  /** A reusable system prompt's canonical material page under Agents. */
  focusPromptId?: string | null
  /** A callable tool's canonical material page under Agents. */
  focusToolId?: string | null
  /** A saved context's detail page under Contexts (ADAPT-15); null = the list. */
  focusContextId?: string | null
  /** An account's detail page under the maintainer console (FWD-7 v1.1);
   *  null = the console's panels. */
  focusAdminUserId?: string | null
  /** A discussion's own page under Discussions (social S2); null = the hub. */
  focusDiscussionId?: string | null
  /** An artifact open on its standard main page (UI-19 — `/artifacts/:id`, so a
   *  rail row and a pasted link land on the same thing); null = the gallery. */
  focusArtifactId?: string | null
  focusArtifactRevision?: string | null
  focusArtifactMatch?: string | null
  /** A provider expanded in the Models list (UI-19); null = the plain list. */
  focusProviderId?: string | null
  /** True only for the focused split pane. Rail commands must never be
   * consumed by a second pane that happens to show the same section. */
  railProjectionActive?: boolean
  /** Open a published definition's page — the one door every card routes through. */
  onOpenAgentPage: (agentId: string) => void
}) {
  const body =
    section === 'projects' ? (
      <ProjectsSection
        projectId={focusProjectId}
        projectSectionId={focusProjectSectionId}
        workItemId={focusWorkItemId}
        contributionId={focusContributionId}
        onOpenProject={onOpenProject}
        onBack={onBack}
        backTo={backTo}
        onOpenSession={onOpenSession}
        onNewSession={onNewSession}
      />
    ) : section === 'artifacts' ? (
      <ArtifactsSection
        collectionSectionId={focusCollectionSectionId}
        artifactId={focusArtifactId}
        artifactRevision={focusArtifactRevision}
        artifactMatch={focusArtifactMatch}
        onBack={onBack}
        onOpenArtifactTrash={onOpenArtifactTrash}
        backTo={backTo}
        onOpenSession={onOpenSession}
      />
    ) : section === 'contexts' ? (
      <ContextsSection collectionSectionId={focusCollectionSectionId} contextId={focusContextId} onBack={onBack} backTo={backTo} />
    ) : section === 'models' ? (
      <ModelsSection collectionSectionId={focusCollectionSectionId} providerId={focusProviderId} onBack={onBack} backTo={backTo} />
    ) : section === 'agents' ? (
      // Agents is a composite: null is its honest overview, sub-views are its
      // structural section/resource pages, and focus ids are canonical leaves.
      <AgentCommonsSection
        agentId={focusAgentId}
        promptId={focusPromptId}
        toolId={focusToolId}
        subview={subview}
        onOpenSubview={onOpenSubview}
        onOpenProposal={onOpenProposal}
        onOpenAgentPage={onOpenAgentPage}
        onBack={onBack}
        backTo={backTo}
      />
    ) : section === 'scheduled' ? (
      <ScheduledSection
        scheduleId={focusScheduleId}
        scheduleSectionId={focusScheduleSectionId}
        onOpenSchedule={onOpenSchedule}
        onBack={onBack}
        backTo={backTo}
        onOpenSession={onOpenSession}
      />
    ) : section === 'sessions' ? (
      <SessionsSection onOpenSession={onOpenSession} onNewSession={onNewSession} />
    ) : section === 'commons' ? (
      // The Commons hosts two pages: its feed (with the rail's lenses as
      // sub-views) and a NAMESPACE PROFILE — the public face of one owner,
      // addressed at `/u/:name` (D21, `OWNER_SECTION`). The profile is the
      // section's detail page, exactly as a project is Projects' — which is why
      // the rail's "Your profile" child is a door to that address and not a
      // `/commons/profile` sub-view: one page, one URL.
      focusOwnerName ? (
        <OwnerProfilePage
          name={focusOwnerName}
          sectionId={focusOwnerSectionId}
          onOpenProject={onOpenProject}
          onOpenAgentPage={onOpenAgentPage}
          onBack={onBack}
          backTo={backTo}
        />
      ) : (
        <CommonsSection lens={subview} />
      )
    ) : section === 'discussions' ? (
      <DiscussionsSection discussionId={focusDiscussionId} onOpenSession={onOpenSession} onFocusHere={onFocusHere} onBack={onBack} backTo={backTo} />
    ) : section === 'notifications' ? (
      // D24 — the inbox is a PAGE now, not the overlay it began as: its rows are
      // in-page doors, so what they open carries the inbox on its back stack.
      <NotificationsSection onFocusHere={onFocusHere} onOpenAgentPage={onOpenAgentPage} />
    ) : section === 'messages' ? (
      // S7 — the DM inbox. It lists only; a thread's canonical page is
      // `/discussions/:did` (one page, one URL), so rows door THERE rather than
      // minting a second address for the same surface.
      <MessagesSection />
    ) : section === 'admin' ? (
      // The maintainer console (contract/admin.ts): like the Agents hub its
      // children are SURFACES, defaulting to Accounts when the rail sub-view is
      // null. Reached without the grant (a pasted URL), it degrades to an
      // explanatory empty state — the server's 404 wall keeps every list empty
      // regardless.
      <AdminSection subview={subview ?? 'accounts'} adminUserId={focusAdminUserId} onBack={onBack} backTo={backTo} />
    ) : (
      <GenericSection section={section} onOpenSession={onOpenSession} />
    )
  return (
    // The hub pages' back state (ADAPT-18): when history exists — a bare
    // in-page door landed here, or the local stack popped back to the list —
    // the shared PageHeader leads with the one back control. Detail pages
    // render BackButton from their props directly.
    <PageBackContext.Provider value={backTo ? { to: backTo, onBack } : null}>
      <CompositeProjectionScope active={railProjectionActive}>
        <div className={`flex min-h-0 flex-1 flex-col ${railCollapsed ? 'pl-8' : ''}`}>{body}</div>
      </CompositeProjectionScope>
    </PageBackContext.Provider>
  )
}

/* The dynamic back button — returns to the previous page in navigation history
 * (not a fixed structural parent) and names that destination — now lives in
 * src/components/BackButton.tsx (ADAPT-18): the conversation title bar wears
 * the same control for a session opened from a page, so it left this file. */

/* ─────────────────────────── Projects ─────────────────────────── */

function SessionsSection({
  onOpenSession,
  onNewSession,
}: {
  onOpenSession: (id: string) => void
  onNewSession: () => void
}) {
  const sessions = useSessions().data ?? []
  const relations = useRelations()
  const projects = relations.allProjects()
  const projectIds = new Set(projects.map((project) => project.id))
  const [rawFilter, setFilter] = useSessionFilter()
  const filter = clampSessionFilter(rawFilter, projectIds)
  const projectName = (projectId: string) =>
    projects.find((project) => project.id === projectId)?.name ?? 'Project'
  const { groups } = filterSessions(sessions, filter, {
    projectIdOf: relations.projectIdForSession,
    projectName,
    now: Date.now(),
  })
  const projection = partitionedCollectionProjection({
    section: 'sessions',
    fallbackLabel: 'Sessions',
    empty: collectionEmptyCopy('sessions', sessions.length),
    itemNoun: 'session',
    presentation: 'static',
    groups: groups.map((group) => ({
      key: group.key,
      label: group.label,
      items: collectionProjectionItems(
        group.sessions,
        (session) => session.id,
        (session) => session.title,
      ),
    })),
  })

  return (
    <CompositeResourcePage section="sessions">
      <PageHeader title="Sessions" subtitle={SECTION_META.sessions.subtitle}>
        <PageActionButton
          icon={<Plus size={15} />}
          onClick={onNewSession}
          mirrorsRailFor="sessions"
          onRailInvoke={onNewSession}
        >
          New session
        </PageActionButton>
      </PageHeader>
      <CompositePageControls
        section="sessions"
        filter={<SessionFilterMenu filter={filter} onChange={setFilter} projects={projects} placement="page" />}
      />
      <MainCollectionTemplate
        projection={projection}
        renderItem={(item) => (
          <SynopsisRow
            title={item.value.title}
            description={item.value.preview}
            meta={`${item.value.pinned ? 'Pinned · ' : ''}${relativeTime(item.value.updatedAt ?? item.value.createdAt)}`}
            onOpen={() => onOpenSession(item.value.id)}
          />
        )}
      />
    </CompositeResourcePage>
  )
}

function ProjectsSection({
  projectId,
  projectSectionId,
  workItemId,
  contributionId,
  onOpenProject,
  onBack,
  backTo,
  onOpenSession,
  onNewSession,
}: {
  /** Which project detail to show (null = the list) — the controlled source of
   *  truth, set by the controller however the detail was reached. */
  projectId: string | null
  /** One addressable section inside the Project (null = the overview). */
  projectSectionId?: string | null
  /** A work item's own page inside that project (null = the project page). */
  workItemId?: string | null
  /** A contribution's own page inside that project (null = the project page). */
  contributionId?: string | null
  onOpenProject: (id: string) => void
  onBack: () => void
  backTo: NavLocation | null
  onOpenSession: (id: string) => void
  onNewSession: () => void
}) {
  const [query, setQuery] = useState('')
  // Ownership band + order come from one live Filter & sort value (UI-19/UI-37),
  // projected in both the rail row and this composite page. The controls are
  // synchronized views, never the old independent page-sort / rail-facet split.
  const [filter] = useSectionFilter('projects')
  const [creating, setCreating] = useState(false)
  const [creatingProject, setCreatingProject] = useState(false)
  const rel = useRelations()
  const projectsQ = useProjects()
  const relationsQ = useRelationGraph()
  // FWD-6: the caller's org seats — the New-project owner picker's options and
  // the "Your organizations" band's membership test (matched by tenant id; the
  // projection keeps `tenantId` on every seat-visible row).
  const myOrgs = useMyOrgs().data ?? []
  const myOrgIds = new Set(myOrgs.map((o) => o.tenant.id))
  // Includes projects created mid-conversation (the relation graph's extras), so a freshly
  // created project shows in the list and opens to its detail like any seed one.
  const projects = rel.allProjects()

  // Create a project from the dialog without inventing identity in the browser:
  // the server returns the addressed Project plus its acknowledged graph, then
  // this pane opens that exact id. The shared relation queue retains the request
  // and idempotency key across Retry, so an uncertain response cannot duplicate.
  // `ownerTenantId` (FWD-6 O-D4): undefined = the caller's own namespace (the
  // fixed absence, INV-9); an org id = the picker's explicit, validated choice.
  const createProject = (name: string, description: string, ownerTenantId?: string) => {
    if (creatingProject) return
    setCreatingProject(true)
    void rel.createProject({
      name,
      description,
      ...(ownerTenantId ? { ownerTenantId } : {}),
    }).then((outcome) => {
      setCreatingProject(false)
      if (outcome.kind !== 'created') {
        setCreating(false)
        return
      }
      setCreating(false)
      onOpenProject(outcome.resource.id)
    })
  }

  const open = projectId ? (projects.find((p) => p.id === projectId) ?? null) : null
  if (open && workItemId)
    return <WorkItemPage project={open} workItemId={workItemId} onBack={onBack} backTo={backTo} onOpenSession={onOpenSession} />
  if (open && contributionId)
    return (
      <ContributionPage
        // Keyed so per-page composer state (the envelope form, the note draft)
        // can never leak from one contribution to another at the same pane
        // position — the propose composer is authorization-bearing.
        key={contributionId}
        project={open}
        contributionId={contributionId}
        onBack={onBack}
        backTo={backTo}
        onOpenSession={onOpenSession}
      />
    )
  if (open)
    return (
      <ProjectDetail
        project={open}
        sectionId={projectSectionId}
        onBack={onBack}
        backTo={backTo}
        onOpenSession={onOpenSession}
        onNewSession={onNewSession}
      />
    )
  if (projectId) {
    return (
      <UnavailableResourcePage
        title="Project"
        state={resolveResourceUnavailable([projectsQ, relationsQ])}
        message="This project isn’t visible from this account (or no longer exists)."
        backTo={backTo ?? { kind: 'section', section: 'projects', projectId: null, scheduleId: null }}
        onBack={onBack}
        onRetry={() => retryResourceQueries([keys.projects, keys.relations])}
      />
    )
  }

  const needle = query.trim().toLowerCase()
  // The SAME list the rail's project children show, through the same function —
  // facet applied, then ordered — narrowed further by this page's own search
  // (search is not a facet: it's a transient query, not a standing choice).
  const sorted = listProjects(projects, filter, myOrgIds).filter(
    (p) =>
      needle === '' ||
      p.name.toLowerCase().includes(needle) ||
      p.description.toLowerCase().includes(needle),
  )
  // Yours vs your orgs vs the commons (shared-surface UI model): an ORG-owned
  // project is reached through a seat (FWD-6 — banded under "Your organizations",
  // whatever your role); a FOREIGN shared project is a different relationship —
  // browsable, not yours; explicit read grants need not admit contributors.
  // Neither interleaves with your own. The bands
  // survive the filter move: picking one facet leaves exactly one band standing,
  // and the all view still shows the three in order.
  const projectGroups = groupProjects(sorted, myOrgIds)
  const projectEmpty = query.trim()
    ? `No projects match “${query.trim()}”.`
    : filter.facet === 'shared'
      ? 'No projects shared with you yet — projects other people share with you show here.'
      : filter.facet === 'org'
        ? 'No organization projects yet — a project owned by an org you have a seat in shows here.'
        : 'No projects yet — create one to group related work.'
  const projection = partitionedCollectionProjection({
    section: 'projects',
    fallbackLabel: 'Projects',
    empty: projectEmpty,
    itemNoun: 'project',
    presentation: 'foldable',
    groups: projectGroups.map((group) => ({
      key: group.key,
      label: group.label,
      description: group.key === 'org'
        ? "Projects owned by organizations you belong to — a seat, not a switch (the byline is the org's page)."
        : group.key === 'shared'
          ? 'Projects shared with you — open a project to see its content and available actions.'
          : undefined,
      items: collectionProjectionItems(
        group.projects,
        (project) => project.id,
        (project) => project.name,
      ),
    })),
  })

  return (
    <CompositeResourcePage section="projects">
      <PageHeader title="Projects">
        <PageActionButton
          icon={<Plus size={15} />}
          onClick={() => setCreating(true)}
          mirrorsRailFor="projects"
          onRailInvoke={() => setCreating(true)}
        >
          New project
        </PageActionButton>
      </PageHeader>
      <SearchBox value={query} onChange={setQuery} placeholder="Search projects…" mirrorsRailFor="projects" />
      <CompositePageControls
        section="projects"
        filter={<SectionFilterMenu section="projects" placement="page" />}
      />
      {/* Relationship bands and their row placement are instantiated by the
          same projection grammar the rail consumes. */}
      <MainCollectionTemplate
        projection={projection}
        renderItem={(item) => (
          <ProjectRow
            project={item.value}
            sessionCount={rel.sessionsForProject(item.value.id).length}
            onOpen={() => onOpenProject(item.value.id)}
          />
        )}
      />
      {creating && (
        <NewProjectDialog
          orgs={myOrgs}
          busy={creatingProject}
          waitingForRecovery={creatingProject && !!rel.mutation.error}
          onCreate={createProject}
          onClose={() => setCreating(false)}
        />
      )}
    </CompositeResourcePage>
  )
}

/** The "New project" form — a centered modal for the transient create act: a
 *  required name, an optional description, and — when the caller holds org
 *  seats (FWD-6 O-D4) — an OWNER picker: "You" (the default pre-selection; the
 *  request then omits ownerTenantId, the fixed INV-9 absence) or one of your
 *  orgs (the request carries the concrete, validated id). */
function NewProjectDialog({
  orgs,
  busy,
  waitingForRecovery,
  onCreate,
  onClose,
}: {
  orgs: MyOrg[]
  busy: boolean
  waitingForRecovery: boolean
  onCreate: (name: string, description: string, ownerTenantId?: string) => void
  onClose: () => void
}) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [owner, setOwner] = useState('') // '' = You (the person namespace)

  const canCreate = name.trim().length > 0 && !busy
  const submit = () => {
    if (canCreate) onCreate(name.trim(), description.trim(), owner || undefined)
  }

  return (
    <FormDialog
      title="New project"
      icon={<Box size={18} className="text-cap-workspace" />}
      submitLabel={waitingForRecovery ? 'Waiting for recovery…' : busy ? 'Creating…' : 'Create project'}
      submitIcon={<Plus size={15} />}
      canSubmit={canCreate}
      onSubmit={submit}
      onClose={busy ? () => {} : onClose}
      busy={busy}
    >
      <FormField label="Name">
        <input
          value={name}
          disabled={busy}
          maxLength={160}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit()
          }}
          placeholder="e.g. Insights dashboard"
          className={FORM_INPUT_CLASS}
        />
      </FormField>
      {/* This field IS the project's About section (2026-08-13) — one text, not
          a subtitle that a longer "readme" would later replace. So the copy has
          to ask for what it now gets: the placeholder is the one the About
          editor uses, because they are the same editor at two moments. Left
          `optional`, which stays true — but a field labelled "what this groups
          together" collects a subtitle, and a subtitle is what About was full
          of before the merge. */}
      <FormField label="Description" optional>
        <textarea
          value={description}
          disabled={busy}
          maxLength={10_000}
          onChange={(e) => setDescription(e.target.value)}
          rows={4}
          placeholder="What is this project, and how does one contribute? (public — every viewer reads this)"
          className={`${FORM_INPUT_CLASS} resize-none leading-relaxed`}
        />
      </FormField>
      {orgs.length > 0 && (
        <FormField label="Owner">
          <select
            aria-label="Project owner"
            value={owner}
            disabled={busy}
            onChange={(e) => setOwner(e.target.value)}
            className={FORM_INPUT_CLASS}
          >
            <option value="">You (your namespace)</option>
            {orgs.map((o) => (
              <option key={o.tenant.id} value={o.tenant.id}>
                {o.tenant.name}
              </option>
            ))}
          </select>
        </FormField>
      )}
    </FormDialog>
  )
}

function ProjectRow({
  project,
  sessionCount,
  onOpen,
}: {
  project: Project
  sessionCount: number
  onOpen: () => void
}) {
  return (
    <SynopsisRow
      title={project.name}
      description={
        <>
          {project.own === false && <><Byline ownerName={project.ownerName} own={false} /> · </>}
          {project.description}
        </>
      }
      meta={`${shortRelativeTime(project.updatedAt)} · ${sessionCount} session${sessionCount === 1 ? '' : 's'}`}
      onOpen={onOpen}
    />
  )
}

const CONTEXT_ICON: Record<ProjectContext['kind'], typeof Folder> = {
  folder: Folder,
  repo: FolderGit2,
  connector: Plug,
  doc: FileText,
}

function ProjectDetail({
  project,
  sectionId,
  onBack,
  backTo,
  onOpenSession,
  onNewSession,
}: {
  project: Project
  sectionId?: string | null
  onBack: () => void
  backTo: NavLocation | null
  onOpenSession: (id: string) => void
  onNewSession: () => void
}) {
  const rel = useRelations()
  const tenantId = useMe().data?.tenant.id
  const projectLocationRef = useRef(`${project.id}\0${sectionId ?? ''}`)
  projectLocationRef.current = `${project.id}\0${sectionId ?? ''}`
  const projectMountedRef = useRef(false)
  useEffect(() => {
    projectMountedRef.current = true
    return () => { projectMountedRef.current = false }
  }, [])
  useRecordView('project', project.id)
  useScheduleMutationStatus()
  useScheduleDeletionStatus()
  useScheduleRunStatus()
  useScheduleRunStopStatus()
  const convs = rel.sessionsForProject(project.id)
  const artifacts = rel.artifactsForProject(project.id)
  const contexts = rel.contextsForProject(project.id)

  // The project's recurring runs split two ways: the *real* routines the relation
  // graph links here (full ScheduledTask — togglable, runnable, openable) and the
  // hand-authored seed cadences that aren't backed by a real task (shown static).
  const realSchedules = rel.schedulesForProject(project.id)
  const realNames = new Set(realSchedules.map((t) => t.name))
  const staticSchedules = project.scheduled.filter((s) => !realNames.has(s.name))
  const hasSchedules = realSchedules.length > 0 || staticSchedules.length > 0

  const scheduleMutationHeld = (id: string) =>
    isScheduleMutationHeld(id) || isScheduleDeletionHeld(id) || isScheduleRunHeld(id) || isScheduleRunStopHeldForTask(id)
  const toggleEnabled = (id: string, enabled: boolean) => {
    if (!scheduleMutationHeld(id)) void toggleScheduleEnabled(id, !enabled)
  }
  const runNow = (id: string) => {
    const task = realSchedules.find((schedule) => schedule.id === id)
    if (!task || scheduleMutationHeld(id) || task.runs.some((run) => run.status === 'running')) return
    void enqueueScheduleRun(id)
  }
  const stopRun = (scheduleId: string, runId: string) => {
    if (scheduleMutationHeld(scheduleId)) return
    void enqueueScheduleRunStop({ scheduleId, runId })
  }

  // ── Scheduled-run CRUD — all on existing primitives, no new backend op ──
  // Create: mint a routine from a template (lands paused), link it to this project,
  // then drill into its detail to edit cadence/steps (the Scheduled section's own
  // "new schedule" path). Link/unlink move only the project↔schedule edge in the
  // relation graph; delete destroys the routine globally.
  const createSchedule = async (tpl: ScheduleTemplate): Promise<ProjectScheduleCreateOutcome> => {
    if (!tenantId) return 'discarded'
    const origin = projectLocationRef.current
    const created = await enqueueScheduleCreation({ tenantId, seed: tpl.seed })
    if (created.outcome === 'discarded') return 'discarded'
    const outcome = await linkSchedule({ id: created.taskId, name: tpl.seed.name })
    if (outcome === 'applied') {
      if (projectMountedRef.current && projectLocationRef.current === origin) {
        rel.navigate('scheduled', created.taskId)
      }
      return 'applied'
    }
    return 'created-unlinked'
  }
  const linkSchedule = (task: Pick<ScheduledTask, 'id' | 'name'>) =>
    rel.applyOp({ kind: 'link-schedule-project', scheduleId: task.id, scheduleName: task.name, projectId: project.id, projectName: project.name })
  const unlinkSchedule = (task: ScheduledTask) =>
    rel.applyOp({ kind: 'link-schedule-project', scheduleId: task.id, scheduleName: task.name, projectId: null, projectName: project.name })
  const deleteSchedule = (task: ScheduledTask) => {
    if (!scheduleMutationHeld(task.id)) void enqueueScheduleDeletion(task.id, task.revision ?? 0)
  }

  // Remove a session from this project — the file-session op with a null project
  // (the graph patch drops it from sessionsForProject, so the row disappears).
  const unfileSession = (id: string, title: string) =>
    rel.applyOp({ kind: 'file-session', sessionId: id, sessionTitle: title, projectId: null, projectName: project.name })

  // Scope / unscope context — both server-owned relation edits. Adding reuses the
  // session composer's full Add-context picker (mapping each AddedContext to the
  // project's ProjectContext shape); removal carries the stable MCP source when
  // present, so a mutable display label can never select the wrong connection.
  const addContext = (ctx: ProjectContext) =>
    rel.applyOp({ kind: 'scope-context', projectId: project.id, projectName: project.name, context: ctx })
  const removeContext = (ctx: ProjectContext) =>
    rel.applyOp({
      kind: 'unscope-context',
      projectId: project.id,
      projectName: project.name,
      contextLabel: ctx.label,
      ...(ctx.source ? { contextSource: ctx.source } : {}),
    })
  const attachToProject = (ctx: AddedContext) => {
    for (const pc of addedToProjectContexts(ctx)) addContext(pc)
  }

  // The permission split (shared-surface UI model): this ONE page serves owner and
  // visitor alike — what changes is which affordances exist, never the location.
  // `own !== false` covers legacy/seed rows whose projection predates the stamp.
  const own = project.own !== false
  const selectedSection = projectSection(sectionId)
  // The composite overview DISCLOSES its grant form; the canonical Sharing
  // subpage IS that act surface and therefore opens the same form immediately.
  // Reusing the overview's closed state on the subpage produced a real blank
  // page: title + rule, with the only useful control hidden until hover.
  const sharingPage = selectedSection?.id === 'sharing'
  const sectionAllowed = selectedSection?.visibility !== 'owner' || own
  const showProjectSection = (id: ProjectSectionId) =>
    sectionAllowed && (!selectedSection || selectedSection.id === id)

  // The Sharing section's stub reads the SAME roster the section renders
  // (`GrantsPanel` → `useGrants`), not `project.shared`. Those are two different
  // facts and the first cut used the wrong one: a seeded project carrying a live
  // `tenant-beta · published` grant has `shared !== true`, so the folded section
  // said "Not shared" over an audience that could read it. A summary is an index
  // entry into content the reader cannot currently see, which is exactly the
  // position where being wrong costs the most — the thread's stub quotes the
  // post's own words for the same reason.
  // Gated on `own`, the way this file's other conditional reads are: the grants
  // roster is owner-only (P8 redacts it, and existence-hiding means a visitor
  // probing it gets the same 404 as a missing project), and the only thing this
  // read feeds is the Sharing stub — which lives inside the owner-only run. An
  // ungated call fires a request every visitor page load that is refused by
  // design, which is not a bug you would ever see and not one you should ship.
  const grants = useGrants('project', project.id, own).data ?? []

  // The About editor's disclosure. It lives up here because its VERB does — the
  // description is what the project is, so editing it is a project-level act,
  // not one of the About section's (owner directive 2026-08-13). The section
  // takes the flag; the header owns the button.
  const [editingAbout, setEditingAbout] = useState(false)
  // The Sharing section's grant composer — disclosed by its header verb like
  // every other section's form (UI-18). Held here rather than in `GrantsPanel`
  // for the reason that keeps recurring: the verb lives in the section header,
  // so the state it drives has to live where the header can reach it.
  const [sharing, setSharing] = useState(false)
  const [sharingHeld, setSharingHeld] = useState(false)
  const projectVerbs =
    own && !editingAbout ? (
      <SectionAction
        label="Edit description — the public “about”, read by every viewer"
        icon={<Pencil size={13} />}
        onClick={() => setEditingAbout(true)}
      />
    ) : null

  return (
    <CompositeResourcePage section="projects" sectionPage={selectedSection !== undefined}>
      {/* ── The page header IS a section header, one level up ─────────────
          (Owner directive 2026-08-13: *"the reveal action buttons can be placed
          at the same row of the title, effectively becoming project-level
          actions, similar idea to section actions."*)

          So it wears the section cue, `group/section`, and the name is about
          the CUE rather than the element — this is a `<header>`, and reusing
          the primitive is what keeps a project's verbs and a section's verbs
          from being two conventions. What makes something belong here rather
          than in a section is SCOPE: Watch is a relation between the reader and
          the whole project, editing the description is a change to what the
          project IS, and neither belongs to any one section below. "New
          session" failed that test this morning and moved down. */}
      <header className={`${PAGE_HEADER_CLASS} ${SECTION_REVEAL_GROUP}`}>
        <div className="flex min-w-0 items-start gap-3">
          <BackButton to={backTo} onBack={onBack} />
          <div className="min-w-0">
          <h1 className={PAGE_TITLE_CLASS}>{project.name}</h1>
          {selectedSection && (
            <p className="mt-0.5 text-[13px] font-medium text-ink-soft">{selectedSection.label}</p>
          )}
          {(project.shared === true || !own) && (
            <div className="mt-1">
              {/* The owner name is a DOOR to the owner's profile page (D21) —
                  when the projection stamped one (seed rows carry none). */}
              <Byline
                ownerName={project.ownerName}
                own={project.own}
                onOwnerClick={
                  project.ownerName ? () => rel.openOwner(project.ownerName!) : undefined
                }
              />
            </div>
          )}
          {/* The description used to render HERE as a sub-line, and moved into
              the About section (same directive). It was the same text About was
              asking for two rows below — see `ProjectAbout` for the field merge
              that made "same text" literally true rather than nearly. */}
          </div>
        </div>
        {/* The verbs, hover-revealed, then Watch, always visible.
            THAT ORDER, and it is not cosmetic: `justify-between` pins this
            cluster to the right edge, so the persistent control has to be the
            outermost one. Reversed, Watch would sit an invisible button's width
            in from the edge — the layout would read as though something were
            missing beside it, which is the UI-7 corollary about a persistent
            control standing behind hover-revealed ones.
            Watch (D24) shows on shared projects for owner and visitor alike:
            watching needs only visibility (capability shapes affordances, not
            location). And it stays VISIBLE where the verbs hide, because it
            carries state — hidden until hover, "am I watching this?" becomes a
            question you have to go looking for. */}
        {(projectVerbs !== null || project.shared === true) && (
          <div className="flex shrink-0 items-center gap-2">
            {projectVerbs && <SectionActions>{projectVerbs}</SectionActions>}
            {project.shared === true && <WatchButton projectId={project.id} />}
          </div>
        )}
      </header>

      {/* ── ONE column of foldable sections ──────────────────────────────────
          (Owner directive 2026-08-12: *"two columns and a lot of frames … make
          it one column of foldable sections"*.)

          The merge is smaller than it looks, because the second column was
          already conditional: `{own && <aside>}` meant a VISITOR has always
          been served this exact shape. What changed is that the owner's
          configuration now sits in the same flow as the content, folded, rather
          than beside it — see `lib/sectionFold.ts` for why folded is what makes
          that bearable.

          The resource-page template caps the header and every section at one
          READING column (owner decision, 2026-08-12). Two columns could spend
          a wider surface because neither one was prose; one column cannot —
          About and Discussion are prose, and a 1200px line is unreadable. */}
      {!selectedSection && <CompositePageControls section="projects" />}
      <div>
          {!sectionAllowed && selectedSection && (
            <div className="border-t border-line-strong py-6">
              <h2 className="text-[15px] font-semibold text-ink">{selectedSection.label}</h2>
              <p className="mt-1 text-[13px] text-ink-soft">This Project section is private to its owner.</p>
            </div>
          )}
          {/* About (D26) — the project's ONE description, read by owner and
              visitor alike; only the owner gets the edit affordance, and it is
              in the page header (capability shapes affordances). */}
          {showProjectSection('about') && <ProjectAbout
            project={project}
            own={own}
            editing={editingAbout}
            onDone={() => setEditingAbout(false)}
          />}
          {/* Every section is the same thing now (S17): a bare uppercase heading
              with its content below, folded or not. Three nested wrappers became
              one — the outer was the two-column flex row, the middle was the main
              column's flex-1, and only the third had a job left (the rhythm).

              ── The order: BOUNDED before GROWING ──────────────────────────────
              (Owner directive 2026-08-13 — *"reorder the sections into logical
              order and fixed-length before elongating ones like discussion and
              recent sessions"*.)

              Three bands, and the rule that separates them is how a section
              behaves after a year of use, not what it is about:

                1. STATE — About · Attention · Contributors · Coordination ·
                   Open work. Each answers a question with a bounded answer, so
                   each is roughly as tall on a year-old project as on a new one.
                2. CONFIGURATION — the owner's run, every section `defaultFolded`
                   and therefore one line each.
                3. HISTORIES — Changes · Recent sessions · Discussion. These
                   accumulate without limit, and reading them is a scroll you
                   opt into.

              The one that was NOT obvious: Open work stays in band 1, beside
              Coordination, though it is a list that grows. It is a QUEUE — items
              are taken and leave it — where the three in band 3 are LEDGERS that
              only ever get longer. Placement follows the steady-state length,
              which is the whole point of the ordering, and it keeps the pair
              that reads as one thought (what is claimed / what is unclaimed)
              from being split by five configuration stubs.

              This reverses the 2026-08-12 decision that put configuration at the
              tail — deliberately, because that decision's premise is gone. Config
              went last while it was HEAVY (the Sharing form was five stacked
              bordered controls, the tallest block on the page). Folding it made
              each section one line, and one-line sections cost nothing to pass
              on the way down; what they cannot survive is sitting BEHIND a
              discussion, where five lines end up three screens from the top. */}
          {/* Attention (CW9, Phase G): what needs YOU, each ask naming which
              approval function it serves — the interrupt justifies itself.
              Renders only when there is something to say (no empty noise).
              Second only to About: an interrupt that arrives below the fold has
              not interrupted anything. */}
          {showProjectSection('attention') && <AttentionPanel project={project} standalone />}

          {/* The commons panels live in the MAIN column, not the rail: Contributors
              and Coordination/Open work are the page's PAYLOAD (for a visitor, the
              entire point — the earlier aside squeezed the issues-tray analog to
              288px behind an empty "sessions are private" note), while the rail
              keeps what a rail is for: the owner's configuration. */}
          {showProjectSection('contributors') && <ContributorsPanel project={project} />}
          {showProjectSection('coordination') && <CoordinationPanel project={project} />}
          {showProjectSection('open-work') && (
            <OpenWorkList projectId={project.id} shared={project.shared === true} guarded={Boolean(project.guardianId)} />
          )}

          {/* An artifact filed to this project is one of the resources that
              COMPOSES it, not merely a gallery row elsewhere. The project page
              therefore projects the same child here that the rail nests under
              the project. Its title remains the canonical door to the artifact
              page; this page summarizes the composition, it does not mint a
              second artifact surface. */}
          {showProjectSection('artifacts') && <FoldSection
            title="Artifacts"
            summary={countOr(artifacts.length, 'artifact', 'artifacts', 'No artifacts')}
          >
            {artifacts.length === 0 ? (
              <p className="text-[12px] text-ink-faint">No artifacts filed here yet.</p>
            ) : (
              <CardList>
                {artifacts.map((artifact) => (
                  <div key={artifact.id} className="flex items-center gap-3 py-3">
                    <FileText size={15} className="shrink-0 text-ink-faint" />
                    <div className="min-w-0 flex-1">
                      <button
                        onClick={() => rel.navigate('artifacts', artifact.id)}
                        className={`block max-w-full truncate text-left text-[13px] text-ink ${DOOR_CLASS}`}
                      >
                        {artifact.name}
                      </button>
                      <div className="truncate text-[11px] text-ink-faint">
                        {artifact.meta} · from {artifact.source}
                      </div>
                    </div>
                    <span className="shrink-0 text-[11px] text-ink-faint">{relativeTime(artifact.editedAt)}</span>
                  </div>
                ))}
              </CardList>
            )}
          </FoldSection>}

          {/* ── Band 2 · the OWNER's configuration ────────────────────────────
              Instructions, attached context, sharing, delegation, scheduled runs.
              A visitor's projection redacts all of it (P8), so this whole run is
              owner-only, and every section declares `defaultFolded` because
              configuration is not what you opened a project to read.

              Ordered as a sentence about one run of work: what to do
              (Instructions) · with what (Context) · who may read it (Sharing) ·
              who may decide (Delegation) · when it happens (Scheduled). */}
          {own && (
          <>
          {showProjectSection('instructions') && <ProjectInstructions project={project} />}

          {showProjectSection('context') && <FoldSection
            title="Context"
            defaultFolded
            summary={contexts.length === 0 ? 'Nothing attached' : contexts.map((c) => c.label).join(' · ')}
            actions={
              <AddContextButton
                variant="section"
                onAttach={attachToProject}
                referenceCopiesEnabled={false}
                connectors={contextsToConnectors(contexts)}
                repos={[]}
                attachments={[]}
                workspaces={[]}
              />
            }
          >
            {contexts.length === 0 ? (
              <p className="text-[12px] text-ink-faint">No context attached yet.</p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                  {contexts.map((ctx, i) => (
                    <ProjectContextChip key={`${ctx.label}-${i}`} ctx={ctx} onRemove={() => removeContext(ctx)} />
                ))}
              </div>
            )}
          </FoldSection>}

          {/* Sharing — the owner's audience/onboarding CONFIGURATION (S17): it used
              to hide inside the Contributors payload, and configuration is its
              own section (the rule survives the rail it was first written for).
              Seed projects can't toggle share (the server refuses), so the switch
              gates on isCreatedProject; the role pre-selection applies either way. */}
          {showProjectSection('sharing') && <FoldSection
            title="Sharing"
            defaultFolded
            heldOpen={sharingHeld}
            summary={
              grants.length > 0 ? grants.map((g) => audienceLabel(g.audience)).join(' · ')
              : project.shared === true ? 'Shared — no audiences yet'
              : 'Not shared'
            }
            // UI-18, arriving here last. Opened, this section measured 346px on
            // a page whose median section is 97, and it was the only one holding
            // a form field at all — five of them, where every other section held
            // zero. The grant composer stood permanently open; every other
            // section's form hangs off its header verb.
            actions={!sharingPage ?
              <SectionAction
                label="Share with an audience"
                icon={<Plus size={14} />}
                onClick={() => setSharing((v) => !v)}
                expanded={sharing}
                disabled={sharingHeld}
                disabledReason={sharingHeld ? SHARING_MUTATION_WAIT : undefined}
              />
              : undefined
            }
          >
            {rel.isCreatedProject(project.id) && <ShareToggle project={project} />}
            {/* The grants roster (social S1) — audience-scoped shares over the
                generic subject ref; org-wide `shared` above stays the legacy
                everyone-switch. */}
            <GrantsPanel
              subject={{ kind: 'project', id: project.id }}
              composing={sharingPage || sharing}
              onHeldChange={setSharingHeld}
            />
            <DefaultRolePicker project={project} />
          </FoldSection>}

          </>
          )}

          {/* Shared governance; editing additionally requires current ownership. */}
          {showProjectSection('delegation') && <DelegationPanelBoundary><Suspense fallback={<DelegationPanelPlaceholder />}><DeferredDelegationPanel project={project} /></Suspense></DelegationPanelBoundary>}

          {project.own !== false && showProjectSection('scheduled') && <FoldSection
            title="Routines"
            defaultFolded
            summary={
              hasSchedules ?
                `${realSchedules.length + staticSchedules.length} routine${realSchedules.length + staticSchedules.length === 1 ? '' : 's'}`
              : 'No routines'
            }
            actions={
              <ProjectScheduleAdd
                linkedIds={new Set(realSchedules.map((t) => t.id))}
                onCreate={createSchedule}
                onLink={linkSchedule}
              />
            }
          >
            {!hasSchedules ? (
              <p className="text-[12px] text-ink-faint">No routines yet.</p>
            ) : (
              <div className="space-y-2.5">
                {realSchedules.map((t) => (
                  <ProjectScheduleRow
                    key={t.id}
                    task={t}
                    running={isScheduleRunHeld(t.id) || t.runs.some((run) => run.status === 'running')}
                    mutationHeld={scheduleMutationHeld(t.id)}
                    onToggle={() => toggleEnabled(t.id, t.enabled)}
                    onRun={() => runNow(t.id)}
                    onStop={() => { const run = t.runs.find((item) => item.status === 'running'); if (run) stopRun(t.id, run.id) }}
                    onOpen={() => rel.navigate('scheduled', t.id)}
                    onUnlink={() => unlinkSchedule(t)}
                    onDelete={() => deleteSchedule(t)}
                  />
                ))}
                {staticSchedules.map((s, i) => (
                  <div key={`static-${i}`} className="flex items-start gap-2.5">
                    <span
                      className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${
                        s.enabled ? 'bg-ok' : 'bg-line-strong'
                      }`}
                    />
                    <div className="min-w-0">
                      <div className="text-[13px] font-medium text-ink">{s.name}</div>
                      <div className="text-[11px] text-ink-faint">
                        {s.cadence}
                        {s.enabled ? '' : ' · paused'}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </FoldSection>}

          {/* ── Band 3 · the HISTORIES ────────────────────────────────────────
              What accumulates. Each of these three is as long as the project is
              old, so they go last — everything a reader can answer at a glance
              sits above them, and reaching one is a scroll they chose.

              Within the band, the work's own order: what landed (Changes) · how
              it was done (Recent sessions) · what was said about it
              (Discussion). Discussion is last of the last on purpose: it is the
              only one with no upper bound at all, growing by replies to replies
              where the other two grow one row per event. */}
          {/* The ONE landing ledger (the Changes/Improvements consolidation,
              2026-07-21): contributions (workflow Phase A) and social proposals
              (S3) are two paths into the same history, so they render as one
              panel over one L# sequence — what's in flight now, then the linear
              history of what landed. Payload for owner and visitor alike. */}
          {showProjectSection('changes') && <DeferredChangesPanel project={project} own={own} onOpenSession={onOpenSession} onOpenContribution={(id) => rel.navigate('projects', project.id, `changes/${id}`)} onOpenDiscussion={(id) => rel.navigate('discussions', id)} />}

          {showProjectSection('recent-sessions') && <FoldSection
            title="Recent sessions"
            summary={countOr(convs.length, 'session', 'sessions', 'No sessions')}
            actions={
              own ? (
                // The page header's solid button, demoted to a section verb
                // (owner directive 2026-08-13). What it starts is a row in THIS
                // list; the header keeps only what belongs to the whole project.
                <SectionAction label="New session" icon={<Plus size={14} />} onClick={onNewSession} />
              ) : undefined
            }
          >
          {convs.length === 0 ? (
            <Empty>
              {own
                ? 'No sessions in this project yet.'
                : 'The owner’s sessions are private — the shared surfaces are above: commission your agent, claim a sub-goal, or take open work.'}
            </Empty>
          ) : (
            <CardList>
              {convs.map((c) => (
                <div
                  key={c.id}
                  className="group flex items-center transition hover:bg-panel-2/60"
                >
                  <button
                    onClick={() => onOpenSession(c.id)}
                    className="flex min-w-0 flex-1 items-center gap-3 py-3 text-left"
                  >
                    <MessageSquare size={16} className="shrink-0 text-ink-faint" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[13px] font-medium text-ink">{c.title}</div>
                      <div className="truncate text-[12px] text-ink-faint">{c.preview}</div>
                    </div>
                    <span className="shrink-0 text-[11px] text-ink-faint">{relativeTime(c.updatedAt)}</span>
                  </button>
                  <Tooltip label="Remove from project">
                    <button
                      onClick={() => unfileSession(c.id, c.title)}
                      aria-label={`Remove ${c.title} from ${project.name}`}
                      className={`mr-2 flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-ink-faint hover:bg-removed-bg hover:text-removed focus-visible:opacity-100 ${HOVER_REVEAL}`}
                    >
                      <MinusCircle size={15} />
                    </button>
                  </Tooltip>
                </div>
              ))}
            </CardList>
          )}
          </FoldSection>}

          {/* The public thread (social S2): the same root discussion the Commons
              card will project under its feed post — one conversation, two
              projections. */}
          {showProjectSection('discussion') && <DiscussionsPanel subject={{ kind: 'project', id: project.id }} own={own} />}
      </div>
    </CompositeResourcePage>
  )
}

/** ── About: the project's ONE description (D26) ──────────────────────────────
 *  The GitHub-parity "about" — the PUBLIC landing text of a shared project,
 *  distinct from `instructions` (private owner context the projection strips for
 *  visitors). Rendered for every viewer when non-empty.
 *
 *  **It used to be a second field.** `readme` sat beside `Project.description`,
 *  and the page showed both: the description as a sub-line under the title, the
 *  readme here — empty on every project a user had ever created, because the
 *  create dialog only ever asked for the description (owner report, 2026-08-13:
 *  *"the description texts when creating a project, the sub-line under project
 *  title, and the about section, all three are actually the same thing"*). They
 *  are one field now, resolved the way instructions are (`descriptionForProject`
 *  = the override map over the project record), so the words you type into the
 *  New project dialog ARE this section, and editing this section is what every
 *  list fronting the project shows.
 *
 *  **The verb is not here.** Editing the description is a PROJECT-level act, so
 *  it lives in the page header's cluster beside Watch; this component takes
 *  `editing` as a prop. Same rule the thread's fold pair was moved under: a
 *  control cannot be lifted out of the component that owns the state it drives,
 *  so the state came up with it. */
function ProjectAbout({
  project,
  own,
  editing,
  onDone,
}: {
  project: Project
  own: boolean
  /** Driven by the header's Edit verb — see `ProjectDetail`. */
  editing: boolean
  onDone: () => void
}) {
  const rel = useRelations()
  // `project.description`, not a by-id resolver: `allProjects()` applies the
  // edit overlay at the merge point, so the Project this page was handed is
  // already the resolved one — and so is the row in the Projects hub, and so is
  // what hub search matches. One read, one value, everywhere.
  const current = project.description
  const [draft, setDraft] = useState(current)
  const [reviewed, setReviewed] = useState(current)
  const [saving, setSaving] = useState(false)
  const taRef = useRef<HTMLTextAreaElement>(null)
  const wasEditing = useRef(false)
  // The draft is seeded when the EDITOR opens, not when this mounts: the verb
  // that opens it is a page away now, so "on mount" would capture a stale value
  // for the whole life of the page.
  useEffect(() => {
    if (editing && !wasEditing.current) {
      setDraft(current)
      setReviewed(current)
      taRef.current?.focus()
    }
    wasEditing.current = editing
  }, [editing, current])
  if (!current && !own) return null
  const save = () => {
    if (saving) return
    setSaving(true)
    void rel.applyOp({
      kind: 'set-project-description',
      projectId: project.id,
      projectName: project.name,
      description: draft.trim(),
      expectedDescription: reviewed,
    }).then((outcome) => {
      setSaving(false)
      if (outcome === 'applied') onDone()
    })
  }
  return (
    <div>
      <FoldSection
        title="About"
        summary={current ? current.replace(/\s+/g, ' ').trim() : 'No description yet'}
      >
      {editing ? (
        <div>
          <textarea
            ref={taRef}
            value={draft}
            disabled={saving}
            maxLength={10_000}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') onDone()
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) save()
            }}
            rows={6}
            placeholder="What is this project, and how does one contribute? (public — every viewer reads this)"
            aria-label="Project description"
            className="w-full resize-none rounded-md border border-line bg-surface px-2.5 py-2 text-[13px] leading-relaxed text-ink outline-none transition placeholder:text-ink-faint focus:border-co"
          />
          <div className="mt-2 flex items-center justify-end gap-2">
            <button
              onClick={onDone}
              disabled={saving}
              className="rounded-md px-2 py-1 text-[12px] font-medium text-ink-soft transition hover:text-ink"
            >
              Cancel
            </button>
            <button
              onClick={save}
              disabled={saving}
              className={`flex items-center gap-1 ${SOFT_BUTTON_CLASS} px-2.5 py-1 text-[12px] `}
            >
              <Check size={13} />
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      ) : current ? (
        // Plain prose. It wore `rounded-xl border bg-surface p-4` until now — a
        // CARD, the last one on this page, missed by the de-boxing pass because
        // that pass scanned `FoldSection` and `CardList` and this box was
        // hand-written here. A box around the one paragraph that says what the
        // project IS was the loudest possible place to keep one.
        <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-ink-soft">{current}</p>
      ) : (
        <p className="text-[12px] text-ink-faint">
          No description yet — the public “about” a visitor reads first.
        </p>
      )}
      </FoldSection>
    </div>
  )
}

/** The project's "Instructions" card — a static paragraph until you click Edit,
 *  which swaps in a textarea. Saving applies a `set-project-instructions` op
 *  (server-owned, persisted, broadcast); the read falls back to the project's
 *  seed when no edit has been made. An empty save clears the instructions. */
function ProjectInstructions({ project }: { project: Project }) {
  const rel = useRelations()
  const current = rel.instructionsForProject(project.id) ?? project.instructions
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(current)
  const [reviewed, setReviewed] = useState(current)
  const [saving, setSaving] = useState(false)
  const taRef = useRef<HTMLTextAreaElement>(null)

  const startEdit = () => {
    setDraft(current)
    setReviewed(current)
    setEditing(true)
  }
  const save = () => {
    if (saving) return
    setSaving(true)
    void rel.applyOp({
      kind: 'set-project-instructions',
      projectId: project.id,
      projectName: project.name,
      instructions: draft.trim(),
      expectedInstructions: reviewed,
    }).then((outcome) => {
      setSaving(false)
      if (outcome === 'applied') setEditing(false)
    })
  }

  useEffect(() => {
    if (editing) taRef.current?.focus()
  }, [editing])

  return (
    <FoldSection
      title="Instructions"
      defaultFolded
      summary={current ? (current.trim().split(/\r?\n/)[0] ?? '') : 'None yet'}
      actions={
        !editing ? (
          <SectionAction
            label={current ? 'Edit instructions' : 'Add instructions'}
            icon={<Pencil size={13} />}
            onClick={startEdit}
          />
        ) : undefined
      }
    >
      {editing ? (
        <div>
          <textarea
            ref={taRef}
            value={draft}
            disabled={saving}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setEditing(false)
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) save()
            }}
            rows={7}
            placeholder="How should Claude work inside this project?"
            className="w-full resize-none rounded-md border border-line bg-surface px-2.5 py-2 text-[13px] leading-relaxed text-ink outline-none transition placeholder:text-ink-faint focus:border-co"
          />
          <div className="mt-2 flex items-center justify-end gap-2">
            <button
              onClick={() => setEditing(false)}
              disabled={saving}
              className="rounded-md px-2 py-1 text-[12px] font-medium text-ink-soft transition hover:text-ink"
            >
              Cancel
            </button>
            <button
              onClick={save}
              disabled={saving}
              className={`flex items-center gap-1 ${SOFT_BUTTON_CLASS} px-2.5 py-1 text-[12px] `}
            >
              <Check size={13} />
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      ) : (
        <div>
          {current ? (
            <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-ink-soft">{current}</p>
          ) : (
            <p className="text-[12px] text-ink-faint">No custom instructions yet.</p>
          )}
        </div>
      )}
    </FoldSection>
  )
}

/** A real project routine in the Scheduled card — a click-through into the
 *  routine's full detail, a Run-now with a spinner, a live enable toggle, and a
 *  ⋯ menu for project membership (unlink) and deletion. The dot echoes its last
 *  run's status, like the Scheduled section's own rows. */
function ProjectScheduleRow({
  task,
  running,
  mutationHeld,
  onToggle,
  onRun,
  onStop,
  onOpen,
  onUnlink,
  onDelete,
}: {
  task: ScheduledTask
  running: boolean
  mutationHeld: boolean
  onToggle: () => void
  onRun: () => void
  onStop: () => void
  onOpen: () => void
  onUnlink: () => void
  onDelete: () => void
}) {
  const dot =
    task.lastStatus === 'ok' ? 'bg-ok' : task.lastStatus === 'failed' ? 'bg-danger' : 'bg-line-strong'
  const menu: RowMenuItem[] = [
    { kind: 'action', key: 'open', label: 'Open in Routines', icon: <ChevronRight size={14} />, onSelect: onOpen },
    { kind: 'divider', key: 'd1' },
    { kind: 'action', key: 'unlink', label: 'Remove from project', icon: <MinusCircle size={14} />, onSelect: onUnlink },
    {
      kind: 'action',
      key: 'delete',
      label: 'Delete routine',
      icon: <Trash2 size={14} />,
      danger: true,
      confirm: `Delete “${task.name}”? ${ROUTINE_DELETE_SCOPE}`,
      onSelect: onDelete,
    },
  ]
  return (
    <div className="group flex items-center gap-1">
      <button onClick={onOpen} className="flex min-w-0 flex-1 items-start gap-2.5 text-left" title="Open in Routines">
        <span className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${task.enabled ? dot : 'bg-line-strong'}`} />
        <div className="min-w-0">
          <div className="truncate text-[13px] font-medium text-ink transition group-hover:text-accent-strong">
            {task.name}
          </div>
          <div className="truncate text-[11px] text-ink-faint">
            {task.cadence}
            {task.enabled ? '' : ' · paused'}
          </div>
        </div>
      </button>
      <div className="flex shrink-0 items-center gap-0.5">
        {running ? (canStopScheduleRun(task.own) ? (
        <Tooltip label={mutationHeld ? ROUTINE_MUTATION_WAIT : SCHEDULE_RUN_STOP_SCOPE}>
          <button onClick={onStop} disabled={mutationHeld} aria-label={SCHEDULE_RUN_STOP_LABEL} title={SCHEDULE_RUN_STOP_SCOPE} className={`flex h-6 w-6 items-center justify-center rounded-md text-danger hover:bg-panel-2 disabled:opacity-40 ${HOVER_REVEAL}`}>
            <Square size={13} />
          </button>
        </Tooltip>
        ) : <span className="px-1 text-[11px] text-ink-faint">Running</span>) : <Tooltip label={mutationHeld ? ROUTINE_MUTATION_WAIT : 'Run now'}>
          <button
            onClick={onRun}
            disabled={mutationHeld}
            aria-label={`Run ${task.name} now`}
            className={`flex h-6 w-6 items-center justify-center rounded-md text-ink-faint hover:bg-panel-2 hover:text-ink focus-visible:opacity-100 disabled:cursor-not-allowed disabled:opacity-40 ${HOVER_REVEAL}`}
          >
            <Play size={13} />
          </button>
        </Tooltip>}
        <RowMenu ariaLabel={`Actions for ${task.name}`} items={menu} disabled={mutationHeld} />
        <Toggle on={task.enabled} onToggle={onToggle} ariaLabel={`${task.name} enabled`} disabled={mutationHeld} />
      </div>
    </div>
  )
}

/** A scoped context rendered as the session composer's Chip — the same tinted
 *  pill, with a hover-revealed ✕ that unscopes it (mirroring the composer's
 *  single-chip remove). The meta (branch, file count, …) surfaces as the hover
 *  tooltip since the pill itself only shows the label. */
/** Resolve a connector / tool NAME against the viewer's OWN saved-context registry
 *  (by id or label, case-insensitive) and return a door to its detail page
 *  (/contexts/:id) — or undefined when it doesn't resolve (a foreign reach label, a
 *  folder scope with no saved entry): capability shapes affordances, so a name that
 *  isn't the viewer's registry entry stays honest text (S18). One funnel for every
 *  registry-chip door — the project chip, the contributor reach, the routine toolbox. */
function useContextDoor(): (name: string, sourceId?: string) => (() => void) | undefined {
  const rel = useRelations()
  const items = useSavedContexts().data?.contexts ?? []
  return (name: string, sourceId?: string) => {
    const hit = resolveSavedContext(items, name, sourceId)
    return hit ? () => rel.navigate('contexts', hit.id) : undefined
  }
}

function ProjectContextChip({ ctx, onRemove }: { ctx: ProjectContext; onRemove: () => void }) {
  const CIcon = CONTEXT_ICON[ctx.kind]
  // The chip is a DOOR to the context's own page when it resolves in the viewer's
  // registry (S18); otherwise Chip renders its display-only, non-interactive form.
  const door = useContextDoor()(ctx.label, ctx.source?.id)
  return (
    <div className="group/chip relative inline-flex">
      <Chip
        icon={<CIcon size={12} />}
        tone={projectContextTone(ctx.kind)}
        active={false}
        hint={door ? `Open ${ctx.label} in Contexts` : ctx.meta || ctx.label}
        onClick={door}
      >
        {ctx.label}
      </Chip>
      <button
        type="button"
        onClick={onRemove}
        aria-label={`Remove ${ctx.label} from project`}
        title="Remove from project"
        className="absolute -right-1.5 -top-1.5 flex h-4 w-4 items-center justify-center rounded-full border border-line-strong bg-surface text-ink-faint opacity-0 transition hover:bg-removed-bg hover:text-removed focus-visible:opacity-100 group-hover/chip:opacity-100"
      >
        <X size={10} strokeWidth={2.5} />
      </button>
    </div>
  )
}

/** The Scheduled card's create / link control — the header's "Add routine" verb,
 *  whose popover offers a template to spin up a NEW routine (pre-linked to this
 *  project) or an existing unlinked routine to LINK in. Both run on existing
 *  primitives: create = acknowledged schedule creation → link-schedule-project; link =
 *  link-schedule-project. */
type ProjectScheduleCreateOutcome = RevisionedMutationOutcome | 'created-unlinked'

function ProjectScheduleAdd({
  linkedIds,
  onCreate,
  onLink,
}: {
  linkedIds: Set<string>
  onCreate: (tpl: ScheduleTemplate) => Promise<ProjectScheduleCreateOutcome>
  onLink: (task: ScheduledTask) => void
}) {
  const [open, setOpen] = useState(false)
  const [pendingTemplate, setPendingTemplate] = useState<string | null>(null)
  const [creationError, setCreationError] = useState<string | null>(null)
  const held = pendingTemplate !== null
  const ref = useDismissable<HTMLDivElement>(open, () => {
    if (!held) setOpen(false)
  })
  const popRef = usePopoverShift<HTMLDivElement>(open)
  const templates = useScheduleTemplates().data ?? []
  const allSchedules = useSchedules().data ?? []
  const linkable = allSchedules.filter((t) => !linkedIds.has(t.id))
  const createFromTemplate = async (tpl: ScheduleTemplate) => {
    if (pendingTemplate) return
    setPendingTemplate(tpl.name)
    setCreationError(null)
    const outcome = await onCreate(tpl)
    if (outcome === 'applied') {
      setOpen(false)
    } else if (outcome === 'created-unlinked') {
      setCreationError('The routine was created but not linked. It remains available under Link existing.')
    } else {
      setCreationError('The routine was not created. Your template choice is still here.')
    }
    setPendingTemplate(null)
  }
  return (
    <div ref={ref} className="relative">
      <SectionAction
        label="Add routine"
        icon={<Plus size={14} />}
        onClick={() => setOpen((o) => !o)}
        open={open}
        disabled={pendingTemplate !== null}
        disabledReason="Routine creation is awaiting confirmation"
      />

      {open && (
        <div
          ref={popRef}
          role="dialog"
          aria-label="Add a scheduled routine"
          aria-busy={pendingTemplate !== null || undefined}
          className={`absolute right-0 top-full z-30 mt-1.5 max-h-[360px] w-[300px] overflow-y-auto p-2 ${POPOVER_SURFACE}`}
        >
          <p className="px-1.5 pb-1 pt-1 text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
            New routine
          </p>
          <ScheduleCreationFeedback pendingTemplate={pendingTemplate} error={creationError} />
          {templates.map((tpl) => (
            <NewScheduleRow
              key={tpl.name}
              tpl={tpl}
              onAdd={() => void createFromTemplate(tpl)}
              disabled={pendingTemplate !== null}
              busy={pendingTemplate === tpl.name}
            />
          ))}
          {linkable.length > 0 && (
            <>
              <p className="px-1.5 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
                Link existing
              </p>
              {linkable.map((t) => {
                const lead = t.steps[0]?.tool ?? t.delivery.tool
                return (
                  <button
                    key={t.id}
                    onClick={() => {
                      onLink(t)
                      setOpen(false)
                    }}
                    disabled={pendingTemplate !== null}
                    className="group mb-0.5 flex w-full items-center gap-2.5 rounded-lg px-1.5 py-1.5 text-left transition hover:bg-panel-2 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-panel-2 text-ink-soft">
                      <ToolGlyph tool={lead} size={15} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-medium text-ink">{t.name}</span>
                      <span className="block truncate text-[11px] text-ink-faint">{t.cadence}</span>
                    </span>
                    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md text-ink-faint transition group-hover:bg-accent-solid group-hover:text-on-solid">
                      <Plus size={13} />
                    </span>
                  </button>
                )
              })}
            </>
          )}
        </div>
      )}
    </div>
  )
}

/** The project's "Contributors" card (docs/agent-commons.md, D7/D13) — the Agents
 *  commissioned onto it. Reads the Project's commissions + the worker-Agent registry
 *  (to resolve each Contributor's label), and offers a picker to commission another
 *  Agent. A commission is the leaf of the D8 cascade; the server funnel rejects an
 *  over-grant, so the picker only ever creates valid (inheriting) commissions here. */
/** Cross-tenant share control (P8) — a Project's owner opens it to Contributors from OTHER
 *  namespaces (tenants). Only CREATED Projects are shareable (the `share-project` op no-ops on a
 *  seed id), so the toggle is offered only for those (ContributorsPanel gates it). Applies the
 *  owner-only `share-project` relation op BY HAND — the same op the model proposes
 *  conversationally (`share_project` tool), through the one relation-edit gate. A shared Project
 *  accepts a different tenant's own agent as a Contributor (owner-pays), clamped to what the
 *  Project admits; un-sharing revokes that cross-namespace effect access. */
function ShareToggle({ project }: { project: Project }) {
  const rel = useRelations()
  const shared = project.shared === true
  const toggle = () =>
    rel.applyOp({ kind: 'share-project', projectId: project.id, projectName: project.name, shared: !shared })
  return (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={shared}
      aria-label={shared ? 'Make project private' : 'Share project with others'}
      data-testid="share-toggle"
      className="mb-3 flex w-full items-start gap-2.5 rounded-lg border border-line bg-ink/[0.02] px-2.5 py-2 text-left transition hover:border-ink/20"
    >
      <span className={`mt-0.5 shrink-0 ${shared ? 'text-ok-strong' : 'text-ink-faint'}`}>
        {shared ? <Globe size={14} /> : <Lock size={14} />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[12px] font-medium text-ink">
          {shared ? 'Shared — others can contribute' : 'Private — only you can contribute'}
        </span>
        <span className="block text-[11px] text-ink-faint">
          {shared
            ? 'The people you share with can commission their own agents here (owner-pays).'
            : 'Share to accept other people’s agents on this project.'}
        </span>
      </span>
      <span
        className={`mt-0.5 flex h-4 w-7 shrink-0 items-center rounded-full px-0.5 transition ${shared ? 'justify-end bg-ok' : 'justify-start bg-ink/15'}`}
      >
        <span className="h-3 w-3 rounded-full bg-surface ring-1 ring-line-strong" />
      </span>
    </button>
  )
}

/** The project's Contributors — pure PAYLOAD now (S17): the owner's sharing config
 *  (share switch, default role) moved to the rail's Sharing panel, so this section
 *  reads the same for owner and visitor — the commissioned agents, carded. */
function ContributorsPanel({ project }: { project: Project }) {
  const currentCommissions = useCommissions(project.id).data ?? []
  const resolvedHere = resolvedByCommission(useOpenSubGoals(project.id).data ?? [])
  useCommissionDeletionStatus()
  // The server may broadcast committed absence before the originating DELETE
  // response settles. Retain exactly those reviewed rows until reconciliation
  // releases their destructive intent.
  const commissions = [
    ...currentCommissions,
    ...heldCommissionDeletions(project.id).filter((held) =>
      !currentCommissions.some((commission) => commission.id === held.id)),
  ]
  const agents = useAgents().data ?? []
  const agentsById = new Map(agents.map((a) => [a.id, a]))
  const commissionedIds = new Set(commissions.map((c) => c.agentId))
  const available = agents.filter((a) => !commissionedIds.has(a.id))

  return (
    <FoldSection
      title="Contributors"
      // The NAMES, not a count: this section answers "who is here", and the
      // roster is short by construction. Sharing's stub reads the same way.
      //
      // Resolved through the SAME fallback chain the row below uses, and that
      // is the whole point of writing it out rather than reaching for
      // `agentLabel`: the server stamps that field only on the public
      // cross-tenant face, so an owner reading their own project got "Agent"
      // in the summary and "Default agent" in the row — a stub disagreeing with
      // the content it stands for, which is the exact defect the Sharing stub
      // was fixed for a day earlier.
      summary={
        commissions.length === 0 ? 'No agents commissioned'
        : commissions.map((c) => agentsById.get(c.agentId)?.label ?? c.agentLabel ?? c.agentId).join(' · ')
      }
      actions={
        <CommissionAdd projectId={project.id} available={available} joinRole={project.defaultRole ?? 'writer'} />
      }
    >
      {commissions.length === 0 ? (
        <p className="text-[12px] text-ink-faint">No agents commissioned yet.</p>
      ) : (
        <CardList>
          {commissions.map((c) => (
            <div key={c.id} className="py-3">
              <ContributorRow
                commission={c}
                agentLabel={agentsById.get(c.agentId)?.label ?? c.agentLabel ?? c.agentId}
                contributions={agentsById.get(c.agentId)?.contributions}
                resolvedHere={resolvedHere.get(c.id)}
              />
            </div>
          ))}
        </CardList>
      )}
    </FoldSection>
  )
}

/** The Project's **default contributor role** (D14) — the pre-selection every
 *  commissioning surface uses for this Project (INV-9: a pure UI shortcut — the
 *  commission request still names its role explicitly; the API never resolves to
 *  this). Owner-only, applied through the same one relation-edit gate as the share
 *  toggle (`set-project-default-role`); "no preference" clears it and pickers fall
 *  back to the writer baseline. */
function DefaultRolePicker({ project }: { project: Project }) {
  const rel = useRelations()
  const set = (value: string) =>
    rel.applyOp({
      kind: 'set-project-default-role',
      projectId: project.id,
      projectName: project.name,
      ...(value ? { role: value as ProjectRole } : {}),
    })
  return (
    <div>
      <label htmlFor="project-default-role" className="mb-1 block text-[11px] font-medium text-ink-soft">
        Default role for new contributors
      </label>
      <select
        id="project-default-role"
        value={project.defaultRole ?? ''}
        onChange={(e) => set(e.target.value)}
        className={FORM_INPUT_CLASS}
      >
        <option value="">No preference (writer)</option>
        {PROJECT_ROLES.map((r) => (
          <option key={r} value={r}>
            {r}
          </option>
        ))}
      </select>
      <p className="mt-1 text-[11px] text-ink-faint">
        Pre-selected when an agent is commissioned here — a shortcut only; every commission still
        states its role.
      </p>
    </div>
  )
}

/** One Contributor row — the Agent's label + its **effective, Project-clamped reach**
 *  (D12): the connectors this Contributor can actually touch on the Project, which is
 *  its granted authority intersected with what the Project admits — never the owner's
 *  ambient set. Default-deny: an Agent granted everything still reaches only the
 *  Project's connectors. */
function ContributorRow({
  commission,
  agentLabel,
  contributions,
  resolvedHere,
}: {
  commission: Commission
  agentLabel: string
  /** The Contributor Agent's D13 reputation — successful commissioned effects (OQ1). */
  contributions?: number
  /** Project-local results distinguish verified MCP calls from legacy simulation. */
  resolvedHere?: CommissionTrackRecordSummary
}) {
  useCommissionMutationStatus()
  useCommissionDeletionStatus()
  useCommissionMcpMutationStatus()
  const reach = useCommissionAuthority(commission.id).data
  // Post-clamp the connectors are always a concrete set (the Project admits a concrete
  // list); show them as the visible isolation boundary. Each connector that resolves
  // in the VIEWER's registry is a door to its context page (S18); a foreign name
  // stays text — capability shapes affordances.
  const connectors = reach?.connectors ?? []
  const contextDoor = useContextDoor()
  // The Project backs the re-grant editor (its admitted connectors are the D12 wall).
  const project = useRelations()
    .allProjects()
    .find((p) => p.id === commission.projectId)
  const [editing, setEditing] = useState(false)
  const [mcpOpen, setMcpOpen] = useState(false)
  const [confirmingRemoval, setConfirmingRemoval] = useState(false)
  const deleting = isCommissionDeletionHeld(commission.id)
  const mutationHeld = deleting || isCommissionMutationHeld(commission.id) || isCommissionMcpHeld(commission.id)
  const requestRemoval = () => {
    if (!mutationHeld) setConfirmingRemoval(true)
  }
  const confirmRemoval = () => {
    if (mutationHeld) return
    setConfirmingRemoval(false)
    void enqueueCommissionDeletion(commission)
  }
  return (
    <div
      className="group grid grid-cols-[10px_minmax(0,1fr)_auto] items-start gap-x-2.5"
      aria-busy={deleting}
      data-contributor-row={commission.id}
      data-commission-removal={deleting || undefined}
    >
      <span className="mt-1 flex h-2.5 w-2.5 shrink-0 items-center justify-center text-ok">
        {deleting ? <Spinner size={10} /> : <span className="h-1.5 w-1.5 rounded-full bg-ok" />}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-[13px] font-medium text-ink">{agentLabel}</span>
          <span className="shrink-0 rounded-full bg-ink/5 px-1.5 py-px text-[10px] font-medium uppercase tracking-wide text-ink-soft">
            {commission.role ?? 'writer'}
          </span>
          {commission.standing && (
            <span
              title="Legacy Standing: development simulation only. Real MCP work requires separate approval."
              className="shrink-0 rounded-full bg-accent/10 px-1.5 py-px text-[10px] font-medium uppercase tracking-wide text-accent"
            >
              standing
            </span>
          )}
          {contributions ? (
            <span
              title={`${contributions} commissioned ${contributions === 1 ? 'contribution' : 'contributions'} on the Commons`}
              className="inline-flex shrink-0 items-center gap-0.5 rounded-full bg-ok/10 px-1.5 py-px text-[10px] font-medium text-ok-text"
            >
              <Award size={9} /> {contributions}
            </span>
          ) : null}
        </div>
        <div className="text-[11px] text-ink-faint">
          {reach === undefined ? (
            'Resolving reach…'
          ) : connectors.length === 0 ? (
            'Reaches no connectors on this project'
          ) : (
            <>
              Reaches{' '}
              {connectors.map((name, i) => {
                const door = contextDoor(name)
                return (
                  <span key={name}>
                    {i > 0 && ' · '}
                    {door ? (
                      <button onClick={door} className={INLINE_ACTION_CLASS} title={`Open ${name} in Contexts`}>
                        {name}
                      </button>
                    ) : (
                      name
                    )}
                  </span>
                )
              })}
            </>
          )}
        </div>
        {(resolvedHere || commission.standing) && (
          <div
            className="text-[11px] text-ink-faint"
            title="Completed items on this Project. Real MCP counts verified calls; simulated items did not run an Agent or tools."
          >
            {resolvedHere
              ? `Real MCP: ${resolvedHere.realCount} · Simulated: ${resolvedHere.simulatedCount} here · last ${relativeTime(resolvedHere.lastAt)}`
              : 'No completed items here yet'}
          </div>
        )}
        {deleting && <div className="text-[11px] text-ink-faint">Removing Contributor…</div>}
      </div>
      <CardActions
        onEdit={project && commission.mine !== false ? () => setEditing(true) : undefined}
        onDelete={commission.mine !== false ? requestRemoval : undefined}
        disabled={mutationHeld}
        disabledReason="Waiting for this Contributor change to settle"
      />
      {commission.mine === true && <div className={ROW_DETAIL_CLASS}>
        <button type="button" aria-expanded={mcpOpen} onClick={() => setMcpOpen(open => !open)} className="mt-2 text-[11px] font-medium text-ink-soft hover:text-ink">{mcpOpen ? 'Hide unattended MCP' : 'Unattended MCP…'}</button>
        {mcpOpen && <DeferredCommissionMcpApprovalPanel commissionId={commission.id} agentLabel={agentLabel} />}
      </div>}
      {editing && project && (
        <DeferredCommissionDialog
          commission={commission}
          project={project}
          standingNotice={<AutomationNotice kind="standing" />}
          onClose={() => setEditing(false)}
        />
      )}
      {confirmingRemoval && (
        <ConfirmDialog
          title={`Remove ${agentLabel}?`}
          body={COMMISSION_DELETE_SCOPE}
          confirmLabel="Remove Contributor"
          onConfirm={confirmRemoval}
          onCancel={() => setConfirmingRemoval(false)}
        />
      )}
    </div>
  )
}


/** The project's "Coordination" card (docs/agent-commons.md, D11) — the in-flight
 *  sub-goals different Contributors are handling, reserved at the Project's Guardian.
 *  Claiming a sub-goal already held by another Contributor is refused (409) and surfaced
 *  as a re-reason prompt — "conflict is a question, not an abort". Only meaningful for a
 *  guarded Project; an unguarded one reserves nothing. */
function CoordinationPanel({ project }: { project: Project }) {
  const tenantId = useMe().data?.tenant.id
  const subGoals = useProjectSubGoals(project.id).data ?? []
  const guarded = !!project.guardianId
  const [draft, setDraft] = useState('')
  const [claimError, setClaimError] = useState<string | null>(null)
  const [releaseError, setReleaseError] = useState<string | null>(null)
  useProjectSubGoalClaimStatus()
  useProjectSubGoalReleaseStatus()
  // Claim AS a principal you control: yourself, or one of YOUR agents commissioned on
  // this Project (P8 cross-tenant cooperation: an agent's sub-goal claim is how it
  // "works" here). A FOREIGN Contributor's agent never resolves in this tenant's
  // registry, so it can't be picked — the same caller-identity wall the route enforces
  // (`commissionActorDenied`), mirrored in the affordance.
  const commissions = useCommissions(project.id).data ?? []
  const agents = useAgents().data ?? []
  const ownAgentById = new Map(agents.map((a) => [a.id, a]))
  const ownCommissions = commissions.filter((c) => ownAgentById.has(c.agentId))
  const [holder, setHolder] = useState<string>(SELF_PROJECT_HOLDER)
  // The claim form is ON DEMAND — the section header's verb discloses it (the
  // always-open form read as noise on a page you're only reading).
  const [claiming, setClaiming] = useState(false)
  const heldIntent = heldProjectSubGoalClaimIntent(project.id)
  const claimHeld = heldIntent !== null
  const observedHeld = useRef(false)
  useEffect(() => {
    if (heldIntent) {
      observedHeld.current = true
      setDraft(heldIntent.subGoal)
      setHolder(heldIntent.holder)
      setClaiming(true)
      return
    }
    if (!observedHeld.current) return
    observedHeld.current = false
    if (subGoals.some((claim) =>
      claim.subGoal === draft.trim() && claim.holder === holder && claim.canRelease === true,
    )) {
      setDraft('')
      setClaiming(false)
      setClaimError(null)
    }
  }, [draft, heldIntent, holder, subGoals])

  const claim = async () => {
    const subGoal = draft.trim()
    if (!tenantId || !subGoal || claimHeld || isProjectSubGoalReleaseScopeHeld(project.id, subGoal)) return
    setClaimError(null)
    setReleaseError(null)
    // An unknown (deleted) commission still selected falls back to claiming as yourself.
    const commission = ownCommissions.find((candidate) => candidate.id === holder)
    const as = holder === SELF_PROJECT_HOLDER || commission ? holder : SELF_PROJECT_HOLDER
    const holderLabel = as === SELF_PROJECT_HOLDER
      ? 'You'
      : ownAgentById.get(commission!.agentId)?.label ?? as
    const outcome = await enqueueProjectSubGoalClaim({
      tenantId,
      projectId: project.id,
      holder: as,
      holderLabel,
      subGoal,
    })
    if (outcome === 'applied') {
      setDraft('')
      setClaiming(false)
    } else {
      // A represented 409 releases immediately into this re-reason prompt;
      // uncertain failures remain frozen behind the shell's Retry/Dismiss.
      setClaimError(`"${subGoal}" is held by another Contributor — pick a different sub-goal.`)
    }
  }

  const releaseClaim = (reservationId: string, subGoal: string) => {
    if (
      !tenantId ||
      isProjectSubGoalReleaseHeld(reservationId) ||
      isProjectSubGoalClaimScopeHeld(project.id, subGoal)
    ) return
    setReleaseError(null)
    void enqueueProjectSubGoalRelease({ tenantId, projectId: project.id, reservationId, subGoal }).then((outcome) => {
      if (outcome === 'discarded') {
        setReleaseError(`“${subGoal}” may still be claimed. Review Coordination before trying again.`)
      }
    })
  }

  return (
    <FoldSection
        title="Coordination"
        summary={
          !guarded ? 'Not a guarded resource'
          : countOr(subGoals.length, 'claim', 'claims', 'Nothing claimed')
        }
        actions={
          guarded ? (
            <SectionAction
              label={claimHeld ? 'Claiming sub-goal…' : 'Claim a sub-goal'}
              icon={<Plus size={14} />}
              onClick={() => { if (!claimHeld) setClaiming((v) => !v) }}
              expanded={claiming}
              disabled={claimHeld}
              disabledReason="Waiting for this claim to settle"
            />
          ) : undefined
        }
      >
        {!guarded ? (
          <p className="text-[12px] text-ink-faint">This project isn’t a guarded resource.</p>
        ) : (
          <>
            {subGoals.length === 0 ? (
              <p className="text-[12px] text-ink-faint">No sub-goals in flight.</p>
            ) : (
              <CardList>
                {subGoals.map((s) => {
                  const releaseHeld = isProjectSubGoalReleaseHeld(s.reservationId)
                  const acquisitionHeld = isProjectSubGoalClaimScopeHeld(project.id, s.subGoal)
                  const rowHeld = releaseHeld || acquisitionHeld
                  return (
                    <div key={s.reservationId} className="group flex items-start gap-2.5 py-3">
                      <span
                        className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${
                          s.status === 'committed' ? 'bg-accent' : 'bg-ok'
                        }`}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="text-[13px] font-medium text-ink">{s.subGoal}</div>
                        {/* CW1 — a visible intent carries its lease: claimed-when +
                            renews-until, from the reservation's own stamps (pure
                            reveal), so abandonment self-heals in view of everyone. */}
                        <div className="text-[11px] text-ink-faint">
                          held by {s.holderLabel}
                          {s.at ? ` · claimed ${relativeTime(s.at)}` : ''}
                          {s.expiresAt ? ` · ${leaseLabel(s.expiresAt)}` : ''}
                        </div>
                      </div>
                      {s.canRelease === true && (
                        <button
                          onClick={() => releaseClaim(s.reservationId, s.subGoal)}
                          disabled={rowHeld}
                          aria-label={`${releaseHeld ? 'Releasing' : acquisitionHeld ? 'Claiming' : 'Release'} ${s.subGoal}`}
                          className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-ink-faint hover:bg-removed-bg hover:text-removed focus-visible:opacity-100 disabled:opacity-60 ${rowHeld ? 'opacity-100' : HOVER_REVEAL}`}
                        >
                          {rowHeld ? <Spinner size={12} /> : <X size={13} />}
                        </button>
                      )}
                    </div>
                  )
                })}
              </CardList>
            )}

            {releaseError && (
              <p role="alert" className="mt-1.5 flex items-start gap-1 text-[11px] leading-snug text-warn-text">
                <AlertCircle size={12} className="mt-0.5 shrink-0" />
                {releaseError}
              </p>
            )}

            {claiming && (
              <div data-subgoal-claim-form aria-busy={claimHeld || undefined} className="mt-2.5">
                {(ownCommissions.length > 0 ||
                  (heldIntent !== null && heldIntent.holder !== SELF_PROJECT_HOLDER)) && (
                  <select
                    value={holder}
                    onChange={(e) => setHolder(e.target.value)}
                    aria-label="Claim as"
                    data-testid="claim-as"
                    disabled={claimHeld}
                    className="mb-1.5 w-full rounded-md border border-line bg-surface px-2 py-1 text-[12px] text-ink outline-none focus:border-line-strong disabled:opacity-60"
                  >
                    <option value={SELF_PROJECT_HOLDER}>Claim as: You</option>
                    {heldIntent &&
                      heldIntent.holder !== SELF_PROJECT_HOLDER &&
                      !ownCommissions.some((candidate) => candidate.id === heldIntent.holder) && (
                        <option value={heldIntent.holder}>Claim as: {heldIntent.holderLabel}</option>
                      )}
                    {ownCommissions.map((c) => (
                      <option key={c.id} value={c.id}>
                        Claim as: {ownAgentById.get(c.agentId)?.label ?? c.agentId}
                      </option>
                    ))}
                  </select>
                )}
                <div className="flex items-center gap-1.5">
                  <input
                    autoFocus
                    value={draft}
                    onChange={(e) => {
                      setDraft(e.target.value)
                      setClaimError(null)
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') void claim()
                      if (e.key === 'Escape' && !claimHeld) setClaiming(false)
                    }}
                    placeholder="Claim a sub-goal…"
                    disabled={claimHeld || isProjectSubGoalReleaseScopeHeld(project.id, draft.trim())}
                    className="min-w-0 flex-1 rounded-md border border-line bg-surface px-2 py-1 text-[12px] text-ink outline-none placeholder:text-ink-faint focus:border-line-strong disabled:opacity-60"
                  />
                  <button
                    onClick={() => void claim()}
                    disabled={claimHeld || !draft.trim() || isProjectSubGoalReleaseScopeHeld(project.id, draft.trim())}
                    aria-busy={claimHeld || undefined}
                    className={`shrink-0 ${SOFT_BUTTON_CLASS} px-2.5 py-1 text-[12px] disabled:opacity-45`}
                  >
                    {claimHeld ? 'Claiming…' : 'Claim'}
                  </button>
                </div>
                {claimError && (
                  <p className="mt-1.5 flex items-start gap-1 text-[11px] leading-snug text-warn-text">
                    <AlertCircle size={12} className="mt-0.5 shrink-0" />
                    {claimError}
                  </p>
                )}
              </div>
            )}
          </>
        )}
    </FoldSection>
  )
}

/** Render a comment body with `@mention` tokens styled (D29) — PURELY cosmetic: a
 *  heuristic `@`+word-run cue, never a claim the name resolved (the server never
 *  confirms a resolution back to the reader, so highlighting can't leak existence).
 *  Multi-word names highlight only their first token — a signal, not the
 *  full identity, which is all the client may know without an enumerable name list. */
function renderCommentBody(body: string): ReactNode[] {
  return body.split(/(@[\p{L}\p{N}]+)/u).map((part, i) =>
    /^@[\p{L}\p{N}]+$/u.test(part) ? (
      <span key={i} className="font-medium text-accent-strong">
        {part}
      </span>
    ) : (
      <span key={i}>{part}</span>
    ),
  )
}

/** The project's open-work backlog (docs/agent-commons.md, D19) — the issues-tray
 *  analog, its own main-column section (S17): posted items awaiting a taker, resolved
 *  items with their credit line, and the post form. Posting dispatches synchronously to the
 *  project's STANDING contributors (through the same role/reach/guardian walls as a
 *  prompted effect); the returned item is already done when one took it. Live on
 *  `openwork.changed`. */
const OPEN_WORK_ACTION_LABELS: Record<ProjectEffectType, string> = {
  'connector.read': 'Read from a connector',
  'connector.write': 'Write through a connector',
  'mcp.query': 'Query an MCP tool',
  'mcp.mutate': 'Change something with an MCP tool',
  charge: 'Record a charge',
}

const openWorkTargetPlaceholder = (type: ProjectEffectType | ''): string => {
  if (type.startsWith('connector.')) return 'Connector or resource…'
  if (type.startsWith('mcp.')) return 'MCP server or tool…'
  if (type === 'charge') return 'Budget or charge description…'
  return 'Choose an action first…'
}

function OpenWorkList({ projectId, shared, guarded }: { projectId: string; shared: boolean; guarded: boolean }) {
  const items = useOpenSubGoals(projectId).data ?? []
  // Read once here rather than per row: every row's mention roster drops the
  // caller, and this is one cached query either way.
  const me = useMe().data
  const myName = me?.tenant.name
  useOpenWorkCreationStatus()
  const heldIntent = heldOpenWorkIntent(projectId)
  const held = heldIntent !== null
  const [subGoal, setSubGoal] = useState('')
  const [type, setType] = useState<ProjectEffectType | ''>('')
  const [target, setTarget] = useState('')
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)
  // The post form is ON DEMAND, disclosed by the section header's verb — the
  // backlog reads as a backlog, not as a permanently-open form.
  const [composing, setComposing] = useState(false)
  useEffect(() => {
    if (!heldIntent) return
    setSubGoal(heldIntent.request.subGoal)
    setType(heldIntent.request.type)
    setTarget(heldIntent.request.target)
    setNote(heldIntent.request.note ?? '')
    setComposing(true)
  }, [heldIntent])

  const post = async () => {
    if (held || !me || !subGoal.trim() || !type || !target.trim()) return
    setError(null)
    try {
      const result = await enqueueOpenWorkCreation({
        tenantId: me.tenant.id,
        projectId,
        request: { subGoal, type, target, ...(note.trim() ? { note } : {}) },
      })
      if (result.outcome === 'applied') {
        setSubGoal('')
        setType('')
        setTarget('')
        setNote('')
        setComposing(false)
      } else {
        setError('The work item wasn’t posted. Review it and try again when ready.')
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not post this work item.')
    }
  }

  return (
    <FoldSection
      title="Open work"
      heldOpen={held}
      summary={countOr(items.length, 'item', 'items', 'Nothing posted')}
      actions={
        <SectionAction
          label="Post a work item"
          icon={<Plus size={14} />}
          onClick={() => { if (!held) setComposing((v) => !v) }}
          expanded={composing}
          disabled={held || !me}
          disabledReason={held ? 'Waiting for server acknowledgement' : 'Waiting for your account'}
        />
      }
    >
      {guarded ? (
        <AutomationNotice kind="work" />
      ) : (
        <p role="note" className="mb-3 text-[12px] text-ink-faint">
          Posting and reading the backlog does not claim an item or require Guardian coordination. Reservations and standing coordination are unavailable until this Project has a Guardian.
        </p>
      )}
      {items.length === 0 ? (
        <p className="text-[12px] text-ink-faint">
          Nothing posted. Post a work item to keep it in the Project backlog.
        </p>
      ) : (
        <CardList>
          {items.map((o) => (
            <div key={o.id} className="py-3">
              <WorkItemRow
                item={o}
                projectId={projectId}
                shared={shared}
                myName={myName}
                tenantId={me?.tenant.id}
              />
            </div>
          ))}
        </CardList>
      )}
      {composing && (
      <div
        data-open-work-creation-form
        aria-busy={held || undefined}
        className="mt-2 space-y-1.5"
      >
        <input
          autoFocus
          value={subGoal}
          onChange={(e) => setSubGoal(e.target.value)}
          onKeyDown={(e) => e.key === 'Escape' && !held && setComposing(false)}
          placeholder="What needs doing?"
          aria-label="Work item sub-goal"
          maxLength={OPEN_WORK_FIELD_MAX}
          disabled={held}
          className="w-full rounded-md border border-line bg-surface px-2 py-1 text-[12px] text-ink outline-none placeholder:text-ink-faint focus:border-line-strong"
        />
        <div className="flex flex-wrap items-center gap-1.5">
          <select
            value={type}
            onChange={(e) => setType(e.target.value as ProjectEffectType)}
            aria-label="Effect type"
            disabled={held}
            className="rounded-md border border-line bg-surface px-2 py-1 text-[12px] text-ink outline-none focus:border-line-strong"
          >
            <option value="" disabled>Choose an action…</option>
            {PROJECT_EFFECT_TYPES.map((t) => (
              <option key={t} value={t}>
                {OPEN_WORK_ACTION_LABELS[t]}
              </option>
            ))}
          </select>
          <input
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void post()
              if (e.key === 'Escape' && !held) setComposing(false)
            }}
            placeholder={openWorkTargetPlaceholder(type)}
            aria-label="Effect target"
            maxLength={OPEN_WORK_FIELD_MAX}
            disabled={held || !type}
            className="min-w-44 flex-1 rounded-md border border-line bg-surface px-2 py-1 text-[12px] text-ink outline-none placeholder:text-ink-faint focus:border-line-strong"
          />
          <button
            onClick={() => void post()}
            disabled={held || !me || !subGoal.trim() || !type || !target.trim()}
            aria-busy={held || undefined}
            // Named, because the project page carries a SECOND "Post" (the
            // discussion composer): identical accessible names on two buttons
            // that do different things is ambiguous to a screen reader, and it
            // made the notifications e2e's selector ambiguous too.
            aria-label="Post work item"
            className={`shrink-0 ${SOFT_BUTTON_CLASS} px-2.5 py-1 text-[12px] disabled:opacity-45`}
          >
            {held ? 'Posting…' : 'Post work'}
          </button>
        </div>
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          onKeyDown={(e) => e.key === 'Escape' && !held && setComposing(false)}
          placeholder="Helpful context (optional)"
          aria-label="Work item context"
          maxLength={OPEN_WORK_FIELD_MAX}
          disabled={held}
          className="w-full rounded-md border border-line bg-surface px-2 py-1 text-[12px] text-ink outline-none placeholder:text-ink-faint focus:border-line-strong"
        />
        {error && <p className="text-[11px] text-removed">{error}</p>}
      </div>
      )}
    </FoldSection>
  )
}

/** The watch toggle (D24) — subscribe to a shared Project's public acts (work
 *  posted / resolved / commented / retracted land in your bell). Reads and writes
 *  the caller's own subscription; the server walls it on visibility. */
function WatchButton({ projectId }: { projectId: string }) {
  const state = useWatchState(projectId).data
  return <WatchToggle subject={{ kind: 'project', id: projectId }} watching={state?.watching === true} ready={!!state} />
}

/** The ONE cue for a feed card's standing acts (Like · Watch) — the quiet ghost
 *  form the feed idiom wants: icon + word, the state carried by color alone, no
 *  border weight competing with the card's content. The bordered form stays for
 *  page-level toolbars (a page has room; a card in a column of cards does not).
 *  Shared so the two acts can't drift apart (form follows function). */
const cardActClass = (active: boolean) =>
  `inline-flex shrink-0 items-center gap-1.5 rounded-md px-2 py-1 text-[12px] font-medium transition disabled:opacity-45 ${
    active ? 'text-accent-strong hover:bg-accent-tint' : 'text-ink-faint hover:bg-panel-2 hover:text-ink'
  }`

/** The watch toggle for ANY subject (the key generalized with the Commons'
 *  Watched lens, S4). Two hosts, one control: the project page fetches its own
 *  watch state, while a feed card already HAS it — the server stamps `watched`
 *  on every item — so the state is a prop rather than a second request per card. */
function WatchToggle({
  subject,
  watching,
  ready = true,
  quiet = false,
}: {
  subject: SocialEntityRef
  watching: boolean
  /** False while the host is still fetching the state (the button waits rather
   *  than rendering "Watch" over an unknown truth). */
  ready?: boolean
  /** The feed card's ghost form (`cardActClass`); off = the bordered page form. */
  quiet?: boolean
}) {
  const me = useMe().data
  const mutation = useStandingRelationshipStatus()
  const held = heldWatchRelationship(subject)
  const active = mutation.activeResourceId === watchRelationshipResourceId(subject)
  const waiting = active && mutation.error !== null
  const noun = subject.kind === 'project' ? 'project' : subject.kind
  const label = held
    ? !active
      ? held.watching ? 'Watch queued' : 'Unwatch queued'
      : waiting
        ? 'Waiting for Retry'
        : held.watching ? 'Watching…' : 'Unwatching…'
    : watching ? 'Watching' : 'Watch'
  const toggle = () => {
    if (held || !ready || !me) return
    void enqueueStandingRelationship({
      tenantId: me.tenant.id,
      kind: 'watch',
      subject,
      watching: !watching,
    })
  }
  return (
    <button
      onClick={toggle}
      disabled={!!held || !ready || !me}
      aria-busy={(active && !waiting) || undefined}
      aria-pressed={watching}
      title={
        waiting
          ? 'Use Retry or Dismiss in the recovery banner'
          : held
            ? label
          : watching
            ? `Stop receiving this ${noun}’s public acts`
            : `Get this ${noun}’s public acts in your notifications`
      }
      className={
        quiet
          ? cardActClass(watching)
          : `inline-flex shrink-0 items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-[13px] font-medium transition disabled:opacity-45 ${
              watching
                ? 'border-accent/40 bg-accent-tint text-accent-strong'
                : 'border-line text-ink-soft hover:border-line-strong hover:text-ink'
            }`
      }
    >
      <Bell size={14} /> {label}
    </button>
  )
}

/** One work item on the backlog (D19), now a CONVERSATION (D23): the status line,
 *  a flat comment thread (anyone who can see the project may comment — the
 *  issue-thread analog), and the honest close (Retract — shown to the likely-
 *  permitted: the poster or the project owner; the server is the gate either way). */
function WorkItemRow({
  item: o,
  projectId,
  shared,
  myName,
  tenantId,
}: {
  item: OpenSubGoal
  projectId: string
  /** Whether the Project is shared — the wall COMMONS-22 puts on the mention
   *  fan-out, and therefore the wall on the hint that promises it. */
  shared: boolean
  myName?: string
  tenantId?: string
}) {
  const comments = o.comments ?? []
  // Remembered across a trip out of this page (`lib/disclosure`), for the same
  // reason the feed card's is: the authors in this thread are doors, and an
  // opened thread that re-folds while you follow one is a reading position the
  // UI threw away.
  const [threadOpen, setThreadOpen] = useDisclosure('work-item-thread', o.id)
  const [draft, setDraft] = useState('')
  const [confirmingRetract, setConfirmingRetract] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useWorkItemCommentCreationStatus()
  useWorkItemRetractionStatus()
  const heldComment = heldWorkItemCommentIntent(projectId, o.id)
  const commentHeld = heldComment !== null
  const retractionHeld = isWorkItemRetractionHeld(projectId, o.id)
  const effectiveThreadOpen = threadOpen || commentHeld
  useEffect(() => {
    if (!heldComment) return
    setDraft(heldComment.body)
  }, [heldComment])
  // The SERVER's answer, not a display-name comparison: standing is compared by
  // raw tenant id (names are attacker-controlled and renameable), and those ids
  // are stripped from the wire face — so the client cannot derive this. Gating
  // on the name was wrong both ways: a renamed owner lost the retract it
  // holds, and a colliding name was shown one that 403s.
  const mayRetract = o.status === 'open' && o.canRetract === true
  // S13 — the poster / retractedBy / comment author are public identities, so
  // each is a door to that owner's profile (the shared OwnerLink), like every other
  // byline. Theme #3's work-item-poster RefLink target, finally built.
  const rel = useRelations()

  // Notification door (docs/notification-routing.md, R4): when a work.* / mentioned
  // bell targets THIS item, scroll to it, flash a highlight, open its thread, and
  // (if the bell was a comment) anchor that comment. Consumed once so Back / an
  // unrelated re-render never re-fires the flash.
  const { pending } = usePendingFocus()
  const isFocus = pending?.projectId === projectId && pending?.workItemId === o.id
  const focusCommentId = isFocus ? pending?.commentId ?? null : null
  const rowRef = useRef<HTMLDivElement>(null)
  const [anchorComment, setAnchorComment] = useState<string | null>(null)
  // The shared focus-flash (scroll + highlight + consume-once). A comment / mention
  // bell points INTO the thread → open it and anchor that comment; a posted /
  // resolved / retracted bell just scrolls + flashes the row (no noisy composer).
  const flash = useFocusFlash(isFocus, rowRef, () => {
    if (focusCommentId) {
      setThreadOpen(true)
      setAnchorComment(focusCommentId)
    }
  })

  // The mention picker (COMMONS-22's write side). Its roster is this item's own
  // participants — every one of them a byline already on this row — and it
  // renders only where a mention can RING: the fan-out is walled to a shared
  // Project, so on a private one the hint below would promise a notification
  // that cannot happen.
  const voices = useMemo(() => (shared ? workItemVoices(o, myName) : []), [shared, o, myName])
  const mention = useMentionPicker<HTMLInputElement>({
    roster: voices,
    draft,
    setDraft,
    onKeyDown: (e) => {
      if (e.key === 'Enter') void send()
    },
  })
  useAppliedWorkItemComment(tenantId, projectId, o.id, draft, () => {
    setDraft('')
    mention.close()
  })
  const send = async () => {
    if (commentHeld || retractionHeld || !tenantId || !draft.trim()) return
    setError(null)
    try {
      const result = await enqueueWorkItemCommentCreation({ tenantId, projectId, itemId: o.id, body: draft })
      if (result.outcome === 'applied') {
        setDraft('')
        mention.close()
      } else {
        setError('The comment wasn’t posted. Review it and try again when ready.')
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not post this comment.')
    }
  }
  const confirmRetract = () => {
    if (commentHeld || retractionHeld || !tenantId) return
    setConfirmingRetract(false)
    setError(null)
    void enqueueWorkItemRetraction({ tenantId, projectId, itemId: o.id }).then((outcome) => {
      if (outcome === 'discarded') setError('The item wasn’t retracted. Review its current state before trying again.')
    })
  }

  return (
    <div
      ref={rowRef}
      className={`flex items-start gap-2.5 scroll-mt-6 rounded-lg -mx-2 px-2 py-1 transition-colors ${
        flash ? FOCUS_FLASH_CLASS : 'ring-1 ring-transparent'
      }`}
    >
      <span
        className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${
          o.status === 'done' ? 'bg-ok' : o.status === 'retracted' ? 'bg-line-strong' : 'bg-warn'
        }`}
      />
      <div className="min-w-0 flex-1">
        {/* The title is the door to the item's OWN page (GitHub's issue-title-as-link);
            the comment-count link below stays the inline quick-thread. */}
        <button
          onClick={() => rel.navigate('projects', projectId, o.id)}
          className={`block max-w-full text-left text-[13px] ${DOOR_CLASS} ${
            o.status === 'retracted' ? 'text-ink-faint line-through' : 'text-ink'
          }`}
        >
          {o.subGoal}
        </button>
        {/* S3 — the prose written to help a taker decide (server-stamped; empty for a
            native post today, carried on A2A/seeded items). Revealed, not hidden. */}
        {o.note && <p className="mt-0.5 text-[12px] leading-snug text-ink-soft">{o.note}</p>}
        <div className="text-[11px] text-ink-faint">
          {o.type} → {o.target}
          {/* Provenance, not authority (D20): an A2A-posted item passed the same walls.
              A verified peer credential (D28) upgrades the stamp with its registered name. */}
          {o.via === 'a2a' ? (o.verifiedPeer ? ` · via A2A · ${o.verifiedPeer} ✓` : ' · via A2A') : ''}
          {/* S3 — the lifecycle is three timestamped transitions, not just a status
              word: carry WHEN on the terminus. S13/FWD-5 Phase 3 — done-by is the
              attribution CHAIN: the agent (Bot badge, text — an agent has no page)
              + its owner namespace (a door), the grant on the tooltip. */}
          {o.status === 'done' ? (
            <span title={o.resolvedBy ? `Resolved under commission ${o.resolvedBy}` : undefined}>
              {o.contributionResolution ? (
                <>
                  {' · '}done by{' '}
                  <button
                    type="button"
                    onClick={() => rel.navigate('projects', projectId, `changes/${o.contributionResolution!.contributionId}`)}
                    className={`text-ink-soft ${DOOR_CLASS}`}
                  >
                    Contribution
                  </button>
                  {' '}· landed by{' '}
                  <OwnerLink bare ownerName={o.contributionResolution.by} onClick={() => rel.openOwner(o.contributionResolution!.by)} />
                </>
              ) : (
                <>
                  {' · '}{resolvedWorkKindLabel(o)} · done by <AgentActor label={o.resolvedByLabel} />
                  {o.resolvedByOwner ? (
                    <>
                      {' '}· agent of{' '}
                      <OwnerLink bare ownerName={o.resolvedByOwner} onClick={() => rel.openOwner(o.resolvedByOwner!)} />
                    </>
                  ) : null}
                </>
              )}
              {o.resolvedAt ? ` · ${relativeTime(o.resolvedAt)}` : ''}
            </span>
          ) : o.status === 'retracted' ? (
            <>
              {' · '}retracted by{' '}
              <OwnerLink bare ownerName={o.retractedBy ?? o.postedBy} onClick={() => rel.openOwner(o.retractedBy ?? o.postedBy)} />
              {o.retractedAt ? ` · ${relativeTime(o.retractedAt)}` : ''}
            </>
          ) : (
            <>
              {' · '}posted by <OwnerLink bare ownerName={o.postedBy} onClick={() => rel.openOwner(o.postedBy)} /> ·{' '}
              {relativeTime(o.postedAt)} — awaiting a taker
            </>
          )}
        </div>
        <div className="mt-0.5 flex items-center gap-3 text-[11px]">
          <button
            onClick={() => { if (!commentHeld) setThreadOpen(!effectiveThreadOpen) }}
            aria-expanded={effectiveThreadOpen}
            aria-disabled={commentHeld || undefined}
            disabled={commentHeld}
            className={INLINE_ACTION_CLASS}
          >
            {comments.length === 0
              ? 'Comment'
              : `${comments.length} comment${comments.length === 1 ? '' : 's'}`}
          </button>
          {mayRetract && (
            <button
              onClick={() => setConfirmingRetract(true)}
              disabled={commentHeld || retractionHeld}
              className={INLINE_ACTION_CLASS}
              title="Permanently close this item unresolved (poster or project owner)"
            >
              {retractionHeld ? 'Retracting…' : 'Retract'}
            </button>
          )}
        </div>
        {effectiveThreadOpen && (
          <div className="mt-1.5 space-y-1.5 border-l-2 border-line pl-2.5">
            {comments.map((c) => (
              <div
                key={c.id}
                className={`rounded text-[12px] leading-snug text-ink-soft transition-colors ${
                  c.id === anchorComment ? 'bg-accent-tint -mx-1 px-1' : ''
                }`}
              >
                {/* S13/FWD-5 — the comment author renders by principal KIND: a human is
                    an owner door; an agent wears the Bot badge (one funnel). */}
                <ActorByline name={c.author} kind={c.authorKind} onOwnerClick={() => rel.openOwner(c.author)} />
                <span className="text-ink-faint"> · {relativeTime(c.at)}</span>
                <div className="whitespace-pre-wrap">{renderCommentBody(c.body)}</div>
              </div>
            ))}
            <div
              data-work-item-comment-form
              aria-busy={commentHeld || undefined}
              className="flex items-center gap-1.5"
            >
              <input
                {...mention.fieldProps}
                value={draft}
                placeholder={mentionHint(shared)}
                aria-label={`Comment on ${o.subGoal}`}
                maxLength={WORK_ITEM_COMMENT_MAX}
                disabled={commentHeld || retractionHeld}
                className="min-w-0 flex-1 rounded-md border border-line bg-surface px-2 py-1 text-[12px] text-ink outline-none placeholder:text-ink-faint focus:border-line-strong"
              />
              <button
                onClick={() => void send()}
                disabled={commentHeld || retractionHeld || !tenantId || !draft.trim()}
                className={`shrink-0 ${SOFT_BUTTON_CLASS} px-2.5 py-1 text-[12px] disabled:opacity-45`}
              >
                {commentHeld ? 'Posting…' : 'Post'}
              </button>
              {mention.list}
            </div>
          </div>
        )}
        {error && <p className="mt-1 text-[11px] text-removed">{error}</p>}
        {confirmingRetract && (
          <ConfirmDialog
            title={`Retract ${o.subGoal}?`}
            body={WORK_ITEM_RETRACTION_SCOPE}
            confirmLabel="Retract work item"
            onConfirm={confirmRetract}
            onCancel={() => setConfirmingRetract(false)}
          />
        )}
      </div>
    </div>
  )
}

/** ── A work item's OWN page (the issue-page analog) ──────────────────────────
 *  Surface follows the entity's nature (docs/design/surface-from-nature.md): an
 *  open-work item is a LIFECYCLE entity (posted → taken → done / retracted) that
 *  accumulates a THREAD, so it gets a dedicated page whose body is a **timeline**
 *  — the state transitions and the conversation interleaved in time order,
 *  GitHub-issue-style — not a row squeezed into the project sidebar (the backlog
 *  row remains as the compact list face; its title is the door here). One page
 *  for every viewer; capability shapes affordances (Retract renders for the
 *  likely-permitted — poster or project owner — and the server stays the gate).
 *  Reached by title-door, bell, or address (/projects/:id/work/:item). */
function WorkItemPage({
  project,
  workItemId,
  onBack,
  backTo,
  onOpenSession,
}: {
  project: Project
  workItemId: string
  onBack: () => void
  backTo: NavLocation | null
  onOpenSession: (id: string) => void
}) {
  const items = useOpenSubGoals(project.id).data ?? []
  const contributions = useContributions(project.id).data ?? []
  const o = items.find((i) => i.id === workItemId) ?? null
  const me = useMe().data
  const tenantId = me?.tenant.id
  const myName = me?.tenant.name
  const rel = useRelations()
  const [draft, setDraft] = useState('')
  const [showProjectWorkDraft, setShowProjectWorkDraft] = useState(false)
  const [confirmingRetract, setConfirmingRetract] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useWorkItemCommentCreationStatus()
  useWorkItemRetractionStatus()
  useDispatchMutationStatus()
  const heldComment = heldWorkItemCommentIntent(project.id, workItemId)
  const commentHeld = heldComment !== null
  const retractionHeld = isWorkItemRetractionHeld(project.id, workItemId)
  const heldDraftSelection = heldProjectWorkDraftSelection(project.id, workItemId)
  const heldMcpDraftSelection = heldDraftSelection?.mcpProposal ? heldDraftSelection : null
  const heldProseDraftSelection = heldDraftSelection && !heldDraftSelection.mcpProposal ? heldDraftSelection : null
  const projectWorkDraftHeld = !!heldProseDraftSelection || commentHeld || retractionHeld
  const projectWorkDraftOpen = !heldMcpDraftSelection && (showProjectWorkDraft || projectWorkDraftHeld)
  useEffect(() => {
    if (!heldComment) return
    setDraft(heldComment.body)
  }, [heldComment])

  // A bell's comment anchor (docs/notification-routing.md): flash the named
  // comment on arrival — the page-level face of the backlog row's same behavior.
  // The target id is SNAPSHOT into state via onActivate (like WorkItemRow), NOT
  // read from `pending` at render: useFocusFlash consumes `pending` in the same
  // effect that lights the flash, so by the paint that would highlight, `pending`
  // is already null — reading it there yields null and the highlight never shows.
  const { pending } = usePendingFocus()
  const isFocus = !!o && pending?.projectId === project.id && pending?.workItemId === o.id
  const focusCommentId = isFocus ? (pending?.commentId ?? null) : null
  const [anchorComment, setAnchorComment] = useState<string | null>(null)
  const anchorRef = useRef<HTMLDivElement>(null)
  const flash = useFocusFlash(isFocus, anchorRef, () => setAnchorComment(focusCommentId))

  // Declared ABOVE the missing-item return, with the rest of the hooks: the
  // picker's roster is this item's own participants, and both it and `send`
  // have to exist before the early exit that only some renders take.
  const send = async () => {
    if (!o || commentHeld || retractionHeld || !me || !draft.trim()) return
    setError(null)
    try {
      const result = await enqueueWorkItemCommentCreation({
        tenantId: me.tenant.id,
        projectId: project.id,
        itemId: o.id,
        body: draft,
      })
      if (result.outcome === 'applied') {
        setDraft('')
        mention.close()
      } else {
        setError('The comment wasn’t posted. Review it and try again when ready.')
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not post this comment.')
    }
  }
  // Walled to a shared Project for the same reason the backlog row's is: on a
  // private one COMMONS-22 rings nobody, so neither the hint nor the completion
  // it teaches belongs there.
  const voices = useMemo(() => (project.shared === true ? workItemVoices(o, myName) : []), [project.shared, o, myName])
  const mention = useMentionPicker<HTMLInputElement>({
    roster: voices,
    draft,
    setDraft,
    onKeyDown: (e) => {
      if (e.key === 'Enter') void send()
    },
  })
  useAppliedWorkItemComment(tenantId, project.id, workItemId, draft, () => {
    setDraft('')
    mention.close()
  })

  if (!o) {
    return (
      <AtomicResourcePage>
        <div className="mb-4">
          <BackButton to={backTo} onBack={onBack} />
        </div>
        <PageEmpty>This work item no longer exists on “{project.name}”.</PageEmpty>
      </AtomicResourcePage>
    )
  }

  const comments = o.comments ?? []
  const mayRetract = o.status === 'open' && o.canRetract === true

  const confirmRetract = () => {
    if (commentHeld || retractionHeld || !me) return
    setConfirmingRetract(false)
    setError(null)
    void enqueueWorkItemRetraction({ tenantId: me.tenant.id, projectId: project.id, itemId: o.id }).then((outcome) => {
      if (outcome === 'discarded') setError('The item wasn’t retracted. Review its current state before trying again.')
    })
  }

  // The timeline: every event the item accumulated, in time order — the opening
  // post (its note is the body, GitHub's issue description), each comment, and
  // the terminal transition when one occurred.
  type TimelineEvent =
    | { at: number; key: string; kind: 'posted' }
    | { at: number; key: string; kind: 'comment'; comment: WorkItemComment }
    | { at: number; key: string; kind: 'done' }
    | { at: number; key: string; kind: 'retracted' }
  const events: TimelineEvent[] = [
    { at: o.postedAt, key: 'posted', kind: 'posted' as const },
    ...comments.map((c) => ({ at: c.at, key: c.id, kind: 'comment' as const, comment: c })),
    ...(o.status === 'done' ? [{ at: o.resolvedAt ?? o.postedAt, key: 'done', kind: 'done' as const }] : []),
    ...(o.status === 'retracted'
      ? [{ at: o.retractedAt ?? o.postedAt, key: 'retracted', kind: 'retracted' as const }]
      : []),
  ].sort((a, b) => a.at - b.at)

  const badge =
    o.status === 'done' ? (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-ok-solid px-2.5 py-0.5 text-[12px] font-medium text-on-solid">
        <CheckCircle2 size={13} /> Done
      </span>
    ) : o.status === 'retracted' ? (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-neutral-solid px-2.5 py-0.5 text-[12px] font-medium text-on-solid">
        <MinusCircle size={13} /> Retracted
      </span>
    ) : (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-warn-solid px-2.5 py-0.5 text-[12px] font-medium text-on-solid">
        <Clock size={13} /> Open
      </span>
    )

  return (
    <AtomicResourcePage>
      <header className={PAGE_HEADER_CLASS}>
        <div className="flex min-w-0 items-start gap-3">
          <BackButton to={backTo} onBack={onBack} />
          <div className="min-w-0">
            <h1 className={PAGE_TITLE_CLASS}>{o.subGoal}</h1>
            <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-ink-faint">
              {badge}
              <span>
                posted by <OwnerLink bare ownerName={o.postedBy} onClick={() => rel.openOwner(o.postedBy)} /> ·{' '}
                {relativeTime(o.postedAt)}
              </span>
              <span>
                · {o.type} → {o.target}
                {o.via === 'a2a' ? (o.verifiedPeer ? ` · via A2A · ${o.verifiedPeer} ✓` : ' · via A2A') : ''}
              </span>
              <span>
                · in{' '}
                <button
                  onClick={() => rel.navigate('projects', project.id)}
                  className={`text-ink-soft ${DOOR_CLASS}`}
                >
                  {project.name}
                </button>
              </span>
            </div>
          </div>
        </div>
        {mayRetract && (
          <button
            onClick={() => setConfirmingRetract(true)}
            disabled={commentHeld || retractionHeld}
            title="Permanently close this item unresolved (poster or project owner)"
            className="shrink-0 rounded-md border border-line px-2.5 py-1 text-[12px] font-medium text-ink-soft transition hover:border-line-strong hover:text-ink disabled:opacity-45"
          >
            {retractionHeld ? 'Retracting…' : 'Retract'}
          </button>
        )}
      </header>

      {/* The timeline — transitions + conversation, interleaved in time order. */}
      <div className="space-y-3 border-l-2 border-line pl-4">
        {events.map((ev) =>
          ev.kind === 'posted' ? (
              <div key={ev.key} className="rounded-lg border border-line bg-surface px-3 py-2">
                <div className="text-[12px] text-ink-faint">
                  <OwnerLink bare ownerName={o.postedBy} onClick={() => rel.openOwner(o.postedBy)} /> posted this
                  {o.postedByKind === 'agent' ? ' (agent)' : ''} · {relativeTime(o.postedAt)}
                </div>
                <div className="mt-1 whitespace-pre-wrap text-[13px] leading-snug text-ink">
                  {o.note?.trim() ? o.note : <span className="text-ink-faint">No description given.</span>}
                </div>
              </div>
            ) : ev.kind === 'comment' ? (
              <div
                key={ev.key}
                ref={ev.comment.id === anchorComment ? anchorRef : undefined}
                className={`rounded-lg border border-line bg-surface px-3 py-2 transition-colors ${
                  flash && ev.comment.id === anchorComment ? FOCUS_FLASH_CLASS : ''
                }`}
              >
                <div className="text-[12px] text-ink-faint">
                  <ActorByline
                    name={ev.comment.author}
                    kind={ev.comment.authorKind}
                    onOwnerClick={() => rel.openOwner(ev.comment.author)}
                  />
                  <span> · {relativeTime(ev.comment.at)}</span>
                </div>
                <div className="mt-1 whitespace-pre-wrap text-[13px] leading-snug text-ink-soft">
                  {renderCommentBody(ev.comment.body)}
                </div>
              </div>
            ) : ev.kind === 'done' ? (
              <div key={ev.key} data-work-item-resolution className="flex items-center gap-2 py-0.5 text-[12px] text-ink-faint">
                <CheckCircle2 size={14} className="shrink-0 text-ok-strong" />
                <span className="min-w-0 flex-1 [overflow-wrap:anywhere]" title={o.resolvedBy ? `Resolved under commission ${o.resolvedBy}` : undefined}>
                  {o.contributionResolution ? (
                    <>
                      done by{' '}
                      <button
                        type="button"
                        onClick={() => rel.navigate('projects', project.id, `changes/${o.contributionResolution!.contributionId}`)}
                        className={`max-w-full text-left [overflow-wrap:anywhere] text-ink-soft ${DOOR_CLASS}`}
                      >
                        {contributions.find((contribution) => contribution.id === o.contributionResolution!.contributionId)?.title ?? 'Contribution'}
                      </button>
                      {' '}· landed by{' '}
                      <OwnerLink bare ownerName={o.contributionResolution.by} onClick={() => rel.openOwner(o.contributionResolution!.by)} />
                    </>
                  ) : (
                    <>
                      {resolvedWorkKindLabel(o)} · done by <AgentActor label={o.resolvedByLabel} />
                      {o.resolvedByOwner ? (
                        <>
                          {' '}· agent of{' '}
                          <OwnerLink bare ownerName={o.resolvedByOwner} onClick={() => rel.openOwner(o.resolvedByOwner!)} />
                        </>
                      ) : null}
                    </>
                  )}
                  {o.resolvedAt ? ` · ${relativeTime(o.resolvedAt)}` : ''}
                </span>
              </div>
            ) : (
              <div key={ev.key} className="flex items-center gap-2 py-0.5 text-[12px] text-ink-faint">
                <MinusCircle size={14} className="shrink-0" />
                <span>
                  retracted by{' '}
                  <OwnerLink
                    bare
                    ownerName={o.retractedBy ?? o.postedBy}
                    onClick={() => rel.openOwner(o.retractedBy ?? o.postedBy)}
                  />
                  {o.retractedAt ? ` · ${relativeTime(o.retractedAt)}` : ''} — closed unresolved
                </span>
              </div>
          ),
        )}
      </div>

      {o.type === 'mcp.mutate' && <DeferredWorkItemMcpProposalPanel
        project={project}
        item={o}
        onOpenSession={onOpenSession}
        onOpenContribution={(contributionId) => rel.navigate('projects', project.id, `changes/${contributionId}`)}
      />}

      <FoldSection
        title="Draft response"
        summary="Choose your Commission and an endpoint model to prepare a private first reply."
        heldOpen={projectWorkDraftOpen}
        actions={<SectionAction
          label="Draft a response"
          icon={<Sparkles size={14} />}
          onClick={() => setShowProjectWorkDraft((open) => !open)}
          expanded={projectWorkDraftOpen}
          disabled={projectWorkDraftHeld}
          disabledReason={heldProseDraftSelection ? 'A private draft is being resolved.' : 'A comment or retraction is being resolved.'}
        />}
      >
        {projectWorkDraftOpen && <DeferredProjectWorkDraftPanel project={project} item={o} onOpenSession={onOpenSession} onCommentPosted={() => { setDraft(''); mention.close() }} />}
      </FoldSection>

      {o.type === 'mcp.mutate' && <DeferredWorkItemContributionPanel
        projectId={project.id}
        item={o}
        onOpenContribution={(contributionId) => rel.navigate('projects', project.id, `changes/${contributionId}`)}
      />}

      {/* The conversation continues below the timeline — same funnel as the
          backlog row's composer (anyone who can see the project may comment),
          and the same mention picker: the two composers post to one route, so
          they must offer one thing. */}
      <div
        data-work-item-comment-form
        aria-busy={commentHeld || undefined}
        className="mt-4 flex items-center gap-1.5"
      >
        <input
          {...mention.fieldProps}
          value={draft}
          placeholder={mentionHint(project.shared === true)}
          aria-label={`Comment on ${o.subGoal}`}
          maxLength={WORK_ITEM_COMMENT_MAX}
          disabled={commentHeld || retractionHeld}
          className="min-w-0 flex-1 rounded-md border border-line bg-surface px-3 py-1.5 text-[13px] text-ink outline-none placeholder:text-ink-faint focus:border-line-strong"
        />
        <button
          onClick={() => void send()}
          disabled={commentHeld || retractionHeld || !me || !draft.trim()}
          className={`shrink-0 ${SOFT_BUTTON_CLASS} px-3 py-1.5 text-[13px] disabled:opacity-45`}
        >
          {commentHeld ? 'Posting…' : 'Post'}
        </button>
        {mention.list}
      </div>
      {error && <p className="mt-1.5 text-[12px] text-removed">{error}</p>}
      {confirmingRetract && (
        <ConfirmDialog
          title={`Retract ${o.subGoal}?`}
          body={WORK_ITEM_RETRACTION_SCOPE}
          confirmLabel="Retract work item"
          onConfirm={confirmRetract}
          onCancel={() => setConfirmingRetract(false)}
        />
      )}
    </AtomicResourcePage>
  )
}

/** "lease renews in 47m" / "lease lapsed" — an intent's freshness face (CW1:
 *  a visible claim carries its lease, so a stalled holder is legible and the
 *  TTL's self-healing is something contributors can see coming). */
function leaseLabel(expiresAt: number): string {
  const ms = expiresAt - Date.now()
  if (ms <= 0) return 'lease lapsed'
  const m = Math.round(ms / 60000)
  if (m < 1) return 'lease renews momentarily'
  if (m < 60) return `lease renews in ${m}m`
  const h = Math.round(m / 60)
  if (h < 48) return `lease renews in ${h}h`
  return `lease renews in ${Math.round(h / 24)}d`
}

/** The contribution ledger (workflow Phase A — the CW6 "Recently landed" strip
 *  with its in-flight band above): ONE list, two states of one entity. Open
 *  contributions lead (a live pulse dot, the coordination rows' idiom), landed
 *  ones follow in reverse ledger order, each leading with its landing number —
 *  a ledger line, not a busy card. Titles are doors (title-as-link) to the
 *  contribution's own page. */
/** The ONE post-list form (social S2): author byline + body + the thin reaction
 *  toggle (hover-revealed at zero, accent when yours) — shared by the entity
 *  page's thread panel and the discussion's own timeline page, so the form
 *  can't drift between the two projections of the same object. */
/** The ONE post list — the thread page, the entity panel and the feed card all
 *  render it, so a post behaves identically wherever it is read.
 *
 *  Each post carries the S5 guardrails, gated on the server's own answers: the
 *  AUTHOR retracts their own words and the ANCHOR OWNER moderates their surface
 *  (both `canDelete`, two parties that `mine` alone can't express), and everyone
 *  ELSE may report it to whoever holds that delete. The acts are hover-revealed
 *  — moderation should be available, not ambient. */
/** ── The thread's fold posture, hoisted out of the list that draws it ────────
 *  What a reader has folded away, plus the two thread-wide acts over it — held
 *  in a hook so the CONTROLS can render somewhere the list does not reach.
 *
 *  That is the whole reason it moved (owner directive 2026-08-13: *"fold/unfold
 *  all buttons in discussion section can be per-section buttons, too"*). The
 *  pair used to hang above the roots as its own right-aligned row, which is a
 *  third place a Discussion section put a verb — the header cluster, the
 *  per-post acts, and this. On a page whose every other section keeps its verbs
 *  in one hover-revealed cluster, a floating row of two text buttons is not a
 *  smaller control, it is a different convention.
 *
 *  **`replyingTo` lives here too, and that is deliberate.** It is not fold
 *  state; it is the input to `spared`, the guard that stops a thread-wide fold
 *  eating a half-written reply. Splitting them would put "which post is being
 *  answered" in two places, and this exact pair has already disagreed once — for
 *  one commit "Fold all" refused to become "Unfold all" while a nested composer
 *  was open, because a guard and the label describing its result were computing
 *  the spared set separately. One owner, one answer.
 *
 *  Still transient by design (it is `useState`, not `uiPrefs`): folding is a
 *  viewing POSTURE, not a fact about the discussion, so it stays off the wire
 *  and does not outlive the page. That is what keeps every door into a thread
 *  honest — a bell or a mention lands on a post with the thread open, because
 *  there is no stored fold to have hidden it. */
type ThreadFold = ReturnType<typeof useThreadFold>

/** The empty thread, once. Every host reaches this hook before its thread has
 *  resolved (`root?.posts ?? …`), and a fresh `[]` on each of those renders is a
 *  new identity — which is the one input `buildReplyTree`'s memo keys on, so it
 *  would rebuild the tree every render for exactly the threads that have no
 *  posts to build it from. */
const NO_POSTS: DiscussionPost[] = []

function useThreadFold(posts: DiscussionPost[], held = false) {
  // Which post is open for a reply — transient composing state, so it lives
  // here rather than in the page (the same call the turn gutter makes).
  const [replyingTo, setReplyingTo] = useState<string | null>(null)
  const [folded, setFolded] = useState<ReadonlySet<string>>(() => new Set<string>())
  // S9 — the chain, at whatever depth it runs (owner directive 2026-08-11).
  // Orphans, cycles and the every-post-renders-once invariant live in the pure
  // module, where a node test can hold them — and since 2026-08-13 so do the
  // three sweeps below (`src/components/CLAUDE.md`: pure logic goes to lib/,
  // where it is locked exactly rather than scanned or walked). What is left
  // here is the part that is genuinely React: two `useState`s and the wiring.
  const tree = useMemo(() => buildReplyTree(posts), [posts])
  /** The reading line the composer is on — what no sweep may fold. Derived ONCE
   *  and shared by every act below, because a guard and the control that
   *  describes its result have to agree about what was spared. */
  const spared = useMemo(() => draftLine(tree, replyingTo), [replyingTo, tree])
  /** Your OWN caret still folds a post you are answering — a deliberate act on
   *  one post rather than a thread-wide sweep — and it closes the composer on
   *  the way, so the draft never disappears without a gesture that asked for it.
   *  Folding an ANCESTOR counts: it conceals the composer just as completely,
   *  and leaving `replyingTo` set would spring the half-written reply back open
   *  on some later unfold. */
  const toggle = (id: string) => {
    if (held) return
    const willFold = !folded.has(id)
    setFolded((f) => {
      const next = new Set(f)
      if (willFold) next.add(id)
      else next.delete(id)
      return next
    })
    if (willFold && spared.has(id)) setReplyingTo(null)
  }
  const foldable = foldableRoots(tree, folded, spared)
  return {
    tree,
    posts,
    folded,
    replyingTo,
    held,
    setReplyingTo,
    toggle,
    /** Whether each act has work — the render gate for either projection of the
     *  pair. `posts.length > 1` because one post is not a thread to fold. */
    canFold: !held && posts.length > 1 && foldable.length > 0,
    canUnfold: !held && posts.length > 1 && folded.size > 0,
    foldAll: () => { if (!held) setFolded(foldAllRoots(tree, folded, spared)) },
    unfoldAll: () => { if (!held) setFolded(new Set()) },
    /** Fold every post but one line of the thread — the row-level "Fold
     *  everything else". Draft-guarded like the sweep it is. */
    foldAllBut: (pid: string) => {
      if (!held) setFolded(unfoldBranch(foldOthers(tree, pid, folded), spared))
    },
    /** The discard at BRANCH scope: this post and everything folded inside it,
     *  at every depth. Not a toggle and not invertible — see the control's own
     *  note at its render site. */
    unfoldBranch: (ids: Iterable<string>) => {
      if (!held) setFolded((f) => unfoldBranch(f, ids))
    },
  }
}

/** The two thread-wide acts, worded once for the two projections that draw them
 *  — the Discussion section's icon cluster and the standalone row of text
 *  buttons. Each act keeps BOTH spellings side by side rather than deriving one
 *  from the other: an icon-only button carries its whole meaning in its
 *  accessible NAME and must state its scope ("posts", because a project page
 *  also offers Fold all over its SECTIONS and two controls may not share one
 *  name), while a text button already shows the verb and spends its TITLE on
 *  the explanation. Different words, one act; keeping them adjacent is what
 *  stops them drifting apart.
 *
 *  TWO acts and never a toggle (SOCIAL-21, owner directive 2026-08-11): they
 *  are not inverses — Fold all leaves the interiors of the roots alone, Unfold
 *  all discards fold state at every depth — and as one control the way back
 *  vanished exactly when it was needed. Each renders only when it has work. */
const THREAD_FOLD_ACTS = {
  fold: {
    Icon: ChevronsUp,
    name: 'Fold all posts — each thread collapses to one line, keeping what you have opened inside it',
    title: 'Collapse every thread to one line, keeping what you have opened inside them',
  },
  unfold: {
    Icon: ChevronsDown,
    name: 'Unfold all posts — every post in this thread, at every depth',
    title: 'Open every post in this thread, at every depth',
  },
} as const

/** The pair as SECTION-HEADER verbs: two icon buttons in the hover-revealed
 *  cluster, the same cue every other section verb on the page wears. Returned
 *  as an array (or `undefined`) so the host can concatenate it with its own
 *  verbs — `<FoldSection actions>` takes a node, and a nested fragment would
 *  put a second flex container inside the cluster. */
function threadFoldVerbs(fold: ThreadFold): ReactNode[] {
  return [
    fold.canFold && (
      <SectionAction
        key="fold-all"
        label={THREAD_FOLD_ACTS.fold.name}
        icon={<THREAD_FOLD_ACTS.fold.Icon size={14} />}
        onClick={fold.foldAll}
      />
    ),
    fold.canUnfold && (
      <SectionAction
        key="unfold-all"
        label={THREAD_FOLD_ACTS.unfold.name}
        icon={<THREAD_FOLD_ACTS.unfold.Icon size={14} />}
        onClick={fold.unfoldAll}
      />
    ),
  ].filter(Boolean) as ReactNode[]
}

/** ── The Fold all · Unfold all row, once ─────────────────────────────────────
 *  A right-aligned pair of ghost text buttons over a foldable collection. TWO
 *  scopes render it and they are the same control: a THREAD's roots (here) and
 *  a PAGE's sections (`CompositePageControls`).
 *
 *  One component because they had been two copies of one recipe — same row
 *  class, same glyphs, same words, same "each button renders only when it has
 *  work" rule — which is the drift `lib/foldHeader` and `lib/ledger` exist to
 *  prevent, at the level of a component rather than a class. The copies had
 *  already started to cost: the reasoning about keeping their accessible names
 *  apart was written out twice, in both comment blocks, because neither could
 *  see the other.
 *
 *  What genuinely differs is the WORK each scope has (a thread's roots vs a
 *  page's sections) and the words, so those are the props; the shape is not.
 *
 *  `name` is optional, and its absence is the modelled difference rather than
 *  an oversight: an accessible name must be given only where two controls would
 *  otherwise share one. A project page carries a page-level pair AND a
 *  Discussion section, so the page's says "sections"; a thread's own page
 *  carries nothing to be confused with, so "Fold all" is already unambiguous
 *  and a redundant label would only make it read differently to a screen reader
 *  than to everyone else. */
/** The thread's pair as that row — for the projections with no section header to
 *  move into (a post's own page, a feed card's opened thread). Not a fallback:
 *  an icon-only control is legible inside a cluster of them, and alone above a
 *  list of prose it is a mystery glyph. Same reasoning that keeps the
 *  PAGE-level pair in words. */
function ThreadFoldControls({ fold }: { fold: ThreadFold }) {
  return (
    <FoldPairRow
      fold={fold.canFold ? { act: fold.foldAll, title: THREAD_FOLD_ACTS.fold.title } : undefined}
      unfold={fold.canUnfold ? { act: fold.unfoldAll, title: THREAD_FOLD_ACTS.unfold.title } : undefined}
    />
  )
}

function DiscussionPostList({
  fold,
  onReact,
  deletion,
  onReport,
  onOpenPerson,
  replyComposer,
}: {
  /** This thread — its posts, its tree, and the reader's posture over both,
   *  from `useThreadFold(posts)`.
   *
   *  The HOST owns it because the host decides where the two thread-wide acts
   *  render — inside a section header's cluster (`threadFoldVerbs`) or above
   *  the roots as text (`<ThreadFoldControls>`) — and a control cannot be
   *  lifted out of the component that holds the state it drives. Required, not
   *  optional: an "or the list makes its own" fallback would be a second,
   *  invisible source of one state, and a host that forgot the prop would
   *  silently render a thread nobody can fold.
   *
   *  **The posts ride IN the handle, and that is the second half of the same
   *  rule.** The first cut kept a `posts` prop beside it, so the list built its
   *  `byId` index from one array while rendering roots from a tree built out of
   *  another, with no type able to say they must be the same. Handing the list
   *  two arrays that must agree is an invitation it does not need: a host with
   *  both a thread and a `slice` of it in scope (the feed card has exactly
   *  that) could pair them wrong, every `byId` lookup would miss, and the only
   *  symptom would be the cascade-delete checkbox quietly never appearing for
   *  an owner who holds the authority. One source, no pairing to get wrong. */
  fold: ThreadFold
  onReact: (pid: string, reacted: boolean) => Promise<void>
  /** Absent on a projection that only PREVIEWS a thread (the feed card's tail):
   *  a destructive act belongs where the whole thread is.
   *
   *  `cascade` takes the branch underneath too (owner directive 2026-08-11);
   *  the list only ever passes it having asked the dialog, and the server
   *  re-checks the delete authority over every post that would go. */
  deletion?: { discussionId: string; anchor: SocialEntityRef }
  onReport?: (pid: string) => Promise<void>
  /** Open a person's profile (S8) — the AUTHOR's name and every @-mention in the
   *  body alike, since both name the same kind of thing: a namespace with a page.
   *  REQUIRED, unlike the optional prop it grew from. Optional meant a post list
   *  could render a name that goes nowhere, and one did: the feed card's own
   *  byline was a door while the comments underneath it — the same names, in the
   *  same card — were plain text (owner report, 2026-08-08). */
  onOpenPerson: (name: string) => void
  /** Render the composer that ANSWERS one post (S9). Absent ⇒ no reply
   *  affordance at all, which is what a preview projection wants (the feed
   *  card's tail) — the same cut `deletion` makes: an act belongs where the
   *  whole conversation is. The list owns WHICH post is open (transient
   *  composing state); the host owns how to compose, since only it holds the
   *  subject and the thread.
   *
   *  Handed the POST and not its id: every host wants the author's name for the
   *  field's own copy, and the list is already holding the post — passing the id
   *  made two call sites re-find it in the thread they'd have to be given. */
  replyComposer?: (parent: DiscussionPost, done: () => void) => ReactNode
}) {
  const [reported, setReported] = useState<ReadonlySet<string>>(() => new Set())
  const [reporting, setReporting] = useState<ReadonlySet<string>>(() => new Set())
  const [reacting, setReacting] = useState<ReadonlySet<string>>(() => new Set())
  const [actionError, setActionError] = useState<string | null>(null)
  // The post whose retraction is waiting on an answer. The POST, not its id:
  // the dialog names the author and quotes the words, and holding the id would
  // make it re-find in the thread what the click was already holding.
  const [confirmDelete, setConfirmDelete] = useState<DiscussionPost | null>(null)
  // Whether that retraction takes the branch with it. Reset to false every time
  // the dialog opens (below), never remembered: a widening this destructive
  // must be re-asked for, not inherited from the last time you said yes.
  const [cascade, setCascade] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const deletionStatus = useDiscussionPostDeletionStatus()
  // The thread and the reader's posture over it come from the HOST's handle —
  // see `useThreadFold`. Destructured so the body below reads exactly as it did
  // when this component owned them.
  const { tree, posts, folded, replyingTo, setReplyingTo, toggle, held: foldHeld } = fold
  const deletionHeld = deletion ? isDiscussionPostDeletionHeld(deletion.discussionId) : false
  const held = foldHeld || deletionHeld
  const { roots, childrenOf } = tree
  // Post by id — so the cascade option can ask whether the viewer may delete
  // every post in a branch, from the `canDelete` the server already stamped on
  // each one, without walking the list once per descendant.
  const byId = useMemo(() => new Map(posts.map((p) => [p.id, p])), [posts])
  // The composer pointer dies with the list that renders the composer.
  //
  // It used to die on its own, because it lived HERE and this component
  // unmounts whenever its surface puts the thread away — a feed card's
  // disclosure closing, a Discussion section being folded. Hoisting it to the
  // host (which does NOT unmount then) quietly outlived that: the draft itself
  // still goes, since `AnchorThreadComposer` unmounts with the list, so
  // reopening the card sprang an EMPTY reply box under a post the reader had
  // walked away from. The fold set surviving is a feature — it is an
  // arrangement they built. A pointer to a composer that no longer exists is
  // not one.
  useEffect(() => () => setReplyingTo(null), [setReplyingTo])

  const setPending = (
    setter: Dispatch<SetStateAction<ReadonlySet<string>>>,
    postId: string,
    pending: boolean,
  ): void => setter((current) => {
    const next = new Set(current)
    if (pending) next.add(postId)
    else next.delete(postId)
    return next
  })

  const react = async (post: DiscussionPost): Promise<void> => {
    if (held || reacting.has(post.id)) return
    setActionError(null)
    setPending(setReacting, post.id, true)
    try {
      await onReact(post.id, post.reacted !== true)
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Could not update that endorsement. Try again.')
    } finally {
      setPending(setReacting, post.id, false)
    }
  }

  const report = async (postId: string): Promise<void> => {
    if (!onReport || held || reporting.has(postId)) return
    setActionError(null)
    setPending(setReporting, postId, true)
    try {
      await onReport(postId)
      setReported((current) => new Set(current).add(postId))
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Could not report that post. Try again.')
    } finally {
      setPending(setReporting, postId, false)
    }
  }

  const row = (p: DiscussionPost, depth: number) => {
    const answers = childrenOf.get(p.id) ?? []
    const hidden = folded.has(p.id)
    // The whole BRANCH, not the first row of it: folding hides descendants too,
    // so a count of direct children would under-report what disappeared.
    const kin = descendantsOf(childrenOf, p.id)
    const branch = kin.size
    const replies = branch === 1 ? '1 reply' : `${branch} replies`
    const heldDeletion = deletion
      ? heldDiscussionPostDeletion(deletion.discussionId, p.id)
      : undefined
    const deletionPhase = heldDeletion
      ? deletionStatus.error &&
        deletionStatus.activeResourceId === discussionPostDeletionResourceId(heldDeletion)
        ? 'failed'
        : 'pending'
      : undefined
    const isReported = p.reported === true || reported.has(p.id)
    const isReporting = reporting.has(p.id)
    /** ── Unfold all, here ───────────────────────────────────────────────────
     *  The one fold control that is NOT a toggle, and the reason it exists is
     *  the reason the toggle cannot serve it (owner directive 2026-08-11):
     *
     *  The caret is **invertible** — folding a post remembers what its inside
     *  looked like, and unfolding restores exactly that. That is the right
     *  default: an arrangement you built by hand should survive being put away.
     *  But it means the caret can never *flatten* a branch, and after enough
     *  hand-folding the only way to open one is a click per stub.
     *
     *  So this is unfold-all's own control rather than a mode of the toggle:
     *  it drops the whole branch's fold state instead of restoring it.
     *
     *  **It stands on EVERY post with replies — folded or open, at every depth,
     *  whatever is folded inside.** One rule, and the whole gate: `branch > 0`.
     *
     *  It took three adjudications to get to something that short, and each
     *  wrong answer was a different way of asking "does this control have work
     *  to do right now?" — which is the wrong question:
     *
     *  1. Only on a folded post that really held a folded DESCENDANT. The "no
     *     redundant control" rule, correctly applied, and unfindable: the
     *     obvious thing to try is Fold all, Fold all leaves interiors alone, so
     *     the control was absent exactly where a reader would look for it.
     *  2. On every folded post with replies (owner directive 2026-08-11), which
     *     fixed that half — predictable placement beats a saved glyph.
     *  3. …plus an open post that held a folded one (owner directive
     *     2026-08-12). That reached the state where the caret is least able to
     *     help — an open post's caret folds it, and unfolding restores the same
     *     buried stubs — but it bought that with an ASYMMETRY (owner report,
     *     same day): folded, the control is simply there; open, it appears and
     *     vanishes according to whether anything below happens to be folded.
     *     Two rules for one button, and the deciding state is usually INVISIBLE
     *     — a fold five levels down, inside a branch you would have to expand to
     *     see. That is defect (1) again in a new place: a control whose presence
     *     depends on what you cannot see is a control you cannot learn.
     *
     *  So the question is not what the control would DO if pressed, but what it
     *  IS: the branch's discard, standing under the branch's caret. Where
     *  nothing is folded it agrees with the caret and pressing it changes
     *  nothing — the same benign redundancy step 2 already accepted, now
     *  extended to the other state instead of being traded for a condition. */
    const unfoldBranch = branch > 0 && (
      // The POSITIONING sits outside the Tooltip, not on the button. Tooltip
      // wraps its child in a `relative inline-flex` span of its own, so an
      // `absolute` on the button resolves against THAT span rather than the
      // gutter — under the old left-hand placement the offset still looked right
      // horizontally (the span collapses to nothing at the gutter's start) and
      // the vertical line was quietly wrong. Two pixels, invisible in a
      // screenshot, caught by asserting the shared centre rather than
      // eyeballing it. Now that the offset IS the vertical one, the same
      // mistake would move the control by a whole row.
      <span className={DISCARD_SLOT_CLASS}>
      <Tooltip label="Unfold this branch and everything folded inside it">
        <button
          onClick={() => fold.unfoldBranch([p.id, ...kin])}
          disabled={held}
          // NOT a disclosure, and `aria-expanded` here would claim a toggle
          // that is not one: this control has no second state to be in. It is
          // IDEMPOTENT — pressing it drives the branch to open and pressing it
          // again does the same thing — where a disclosure's whole contract is
          // that the next press undoes this one. (The reason used to be that the
          // control stopped existing once the branch was open. It no longer
          // does, and the conclusion is unchanged: it was never the vanishing
          // that made this not a disclosure.)
          //
          // The name is the same in both states, and names the BRANCH, which is
          // what the control acts on either way. Renaming it per state would be
          // the mistake the caret's own comment above records — a control that
          // renames itself reads as a new control each time — and here it would
          // also be a distinction without a difference: on an open post the
          // "unfold this post" half is simply a no-op, and it is the "everything
          // folded inside it" half that the reader pressed it for.
          aria-label={`Unfold ${p.author}’s post and everything folded inside it`}
          className={`${FOLD_GUTTER_CLASS} flex h-4 items-center justify-center rounded text-ink-faint transition hover:bg-panel-2 hover:text-ink focus-visible:opacity-100 ${HOVER_REVEAL}`}
        >
          <ChevronsDown size={12} className="shrink-0" />
        </button>
      </Tooltip>
      </span>
    )
    return (
      <li
        key={p.id}
        data-discussion-post-id={p.id}
        data-discussion-post-deletion={deletionPhase}
      >
        <div className="group flex items-start gap-1.5">
          {/* ── The fold ──────────────────────────────────────────────────────
              ONE button across both states, at the same position in the tree, so
              React keeps the DOM node and the keyboard focus survives the press.
              Mount a different control per state and folding drops focus to the
              body — which for a keyboard reader loses their place in the thread
              entirely, in the very act of tidying it.

              It sits in a fixed gutter at the head of the row, centred on the
              hairline its own branch hangs from (FOLD_GUTTER_CLASS /
              replyIndentClass): the control and the thing it collapses are one
              vertical line (owner directive 2026-08-11).

              The accessible NAME is state-neutral and names the post, with
              `aria-expanded` carrying which state it is in — a disclosure that
              renames itself on every press reads as a new control each time. */}
          {/* The gutter is `relative` so the unfold-all can hang OUT OF FLOW
              directly BELOW the caret, in the caret's own column (owner
              directive 2026-08-12, moving it from the caret's left where the
              2026-08-11 directive first put it — see `DISCARD_SLOT_CLASS`).
              Out of flow is the whole point and did not change with the axis:
              the control appears on some rows and not others, so any in-flow
              spelling of it moves something. Horizontally that was the words
              beside it — one cut reserved an in-flow slot and aligned the stubs
              with EACH OTHER by pushing all of them 32px right of the open rows,
              a worse bug than the one it fixed. Vertically it would be the row
              height itself: a stub is one line tall, and a hover-revealed
              control that grew it would make the thread twitch under the
              mouse. */}
          <div className={`${FOLD_GUTTER_CLASS} relative mt-0.5 flex h-4 items-center`}>
          <button
            onClick={() => toggle(p.id)}
            disabled={held}
            aria-expanded={!hidden}
            aria-label={branch > 0 ? `${p.author}’s post, ${replies}` : `${p.author}’s post`}
            title={hidden ? 'Unfold this post' : 'Fold this post'}
            // A leaf's caret is hover-revealed where one with answers is not:
            // that one carries structure ("there is more below this"), which is
            // information, where a leaf's is only an act. FOLDED, every caret is
            // pinned visible — a stub whose only way back is invisible is a post
            // nobody finds again. The slot is reserved in all three cases, so
            // nothing shifts when a caret appears.
            className={`flex h-4 w-full items-center justify-center rounded text-ink-faint transition hover:bg-panel-2 hover:text-ink focus-visible:opacity-100 ${
              branch > 0 || hidden ? '' : HOVER_REVEAL
            }`}
          >
            {hidden ?
              <ChevronRight size={12} className="shrink-0" />
            : <ChevronDown size={12} className="shrink-0" />}
          </button>
          {/* AFTER the caret in the DOM, because it is now BELOW it on screen.
              It used to be written first, which was right while it sat to the
              caret's left: reading order and tab order agreed. Moving it down
              without moving it here would have left a keyboard reader landing on
              the discard before the toggle it modifies, in the opposite order to
              what they can see (WCAG 2.4.3). It is absolutely positioned, so the
              swap costs the layout nothing — which is exactly why it would have
              been easy to miss. */}
          {unfoldBranch}
          </div>
          {/* ── The stub ──────────────────────────────────────────────────────
              A folded post is an INDEX ENTRY, not a gap: who, when, the opening
              words, and how much is hidden underneath. A fold that left only a
              chevron would compress a long thread into a column of nothing —
              and coping with a large history is the whole point of the control
              (owner directive 2026-08-11); you cannot navigate a history you
              cannot recognise. Whitespace collapses rather than surviving as
              gaps, so the one line is one line.

              The row takes the mouse and the CARET keeps the keyboard, which is
              the card-door model (lib/cardDoor) and is here for its second
              reason rather than its first: the author's name is a door
              everywhere else in this list, and swallowing it inside one big
              <button> would have made it inert in exactly the component the
              "no surface renders an author's name inert" lock was earned for.
              So the guard is that funnel's — a child that handles its own click
              is spared centrally, because a child that forgets `stopPropagation`
              fails silently. Not the funnel's CUE or its handler: this opens no
              page. It also does without the funnel's drag-select guard on
              purpose — unfolding costs a click to undo, where navigating away
              from the text you just highlighted does not. */}
          {hidden && (
            <div
              onClick={(e) => {
                if (!held && !isCardControlClick(e.target instanceof Element ? e.target : null, e.currentTarget)) toggle(p.id)
              }}
              className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-md py-0.5 pr-1.5 transition hover:bg-panel-2"
            >
              <span className="shrink-0 text-[12px] font-medium text-ink">
                <OwnerLink bare ownerName={p.author} own={p.mine === true} onClick={() => onOpenPerson(p.author)} />
              </span>
              <span className="shrink-0 text-[11px] text-ink-faint">{relativeTime(p.at)}</span>
              <span className="min-w-0 flex-1 truncate text-[12px] text-ink-faint">
                {p.body.replace(/\s+/g, ' ').trim()}
              </span>
              {branch > 0 && <span className="shrink-0 text-[11px] tabular-nums text-ink-faint">{replies}</span>}
            </div>
          )}
          {!hidden && (
            <div className="min-w-0 flex-1">
              {/* The author is a DOOR onto their profile — the very <OwnerLink>
                  the card's own byline wears, mark and all, so the two names on
                  one card are one kind of thing. A name in a thread is the
                  thread's only handle on the person who wrote it; leaving it inert
                  made a comment a dead end (owner directive 2026-08-08). */}
              <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                {/* `shrink-0` here and on the act cluster below makes a starved
                    byline WRAP rather than squeeze. It changes nothing at any
                    width this thread is read at — 375px and up, the line fits
                    either way, measured. It matters when the content column is
                    genuinely tiny: with the narrow-tier rail drawer open the
                    column is ~53px, and one shrinkable child means the flex row
                    compresses "Ada Lovelace (you)" into three stacked words
                    while the rigid cluster keeps its full width. Rigid on both
                    sides, the line breaks where a line should break. */}
                <span className="shrink-0 text-[12px] font-medium text-ink">
                  <OwnerLink bare ownerName={p.author} own={p.mine === true} onClick={() => onOpenPerson(p.author)} />
                </span>
                <span className="shrink-0 text-[11px] text-ink-faint">{relativeTime(p.at)}</span>
                {/* ── The acts, ON the byline ──────────────────────────────
                    They used to be right-ALIGNED, pinned to the far edge of a
                    row whose text often ended a third of the way across: to
                    answer a post you had read, you travelled the width of the
                    pane (owner directive 2026-08-11 — *"make the reply, like
                    and delete buttons immediately follow the line content
                    instead of right aligned. This makes user clicks
                    convenient"*). They follow the timestamp now, so the
                    distance from the words to the verb about them is a few
                    pixels and does not grow with the pane.

                    On the byline rather than under the body, which is the
                    other place "after the content" could mean: a control row
                    beneath every post is a row per post, and Reply was moved
                    OFF exactly such a row earlier the same day. This spends no
                    vertical space at all.

                    `flex-wrap` on the line above: below `sm` the cluster is
                    persistent (UI-7), and name + time + four controls do not
                    fit a 375px column at depth — so the cluster drops to its
                    own line instead of squeezing the name to nothing, which is
                    the row-starvation UI-7 exists for. */}
                <div className="flex shrink-0 items-center gap-0.5">
                  {/* ── The endorsement goes FIRST ────────────────────────────
                      It is the only act in this cluster that survives the mouse
                      leaving: with a count on it, it drops HOVER_REVEAL and
                      becomes part of the byline. Its neighbours do not — and
                      `HOVER_REVEAL` is `opacity-0`, not `hidden`, so they keep
                      their boxes while invisible. Ordered anywhere but first,
                      an endorsed post therefore read "Grace Hopper · Jul 23 ·
                      [52px of nothing] · 👍1" — the count floating clear of the
                      line it belongs to, with the gap silently sized by how
                      many hidden controls happened to precede it (owner
                      report, 2026-08-12: *"a clicked like button is displayed
                      immediately after the line's text without long
                      whitespaces"*).

                      So the rule is not "like is the most important verb" — it
                      is that a PERSISTENT control cannot sit behind hidden ones
                      and still look attached to the text. Anything else in this
                      cluster that earns a resting state belongs in front of the
                      hover-revealed ones too. */}
                  <Tooltip label={p.reacted ? 'Remove your endorsement' : 'Endorse this post'}>
                    <button
                      onClick={() => void react(p)}
                      disabled={held || reacting.has(p.id)}
                      aria-busy={reacting.has(p.id) || undefined}
                      aria-pressed={p.reacted === true}
                      aria-label={p.reacted ? 'Remove your endorsement' : 'Endorse this post'}
                      className={`${POST_ACT_CLASS} gap-1 text-[11px] ${
                        p.reacted
                          ? 'text-accent'
                          : `text-ink-faint hover:bg-panel-2 hover:text-ink ${p.reactions === 0 ? HOVER_REVEAL : ''}`
                      }`}
                    >
                      {reacting.has(p.id) ? <Spinner size={12} /> : <ThumbsUp size={12} />}
                      {p.reactions > 0 && <span className="tabular-nums">{p.reactions}</span>}
                    </button>
                  </Tooltip>
                  {/* "Fold the others" — a THREAD-WIDE act reached from one
                      post. Now a glyph like its neighbours (owner directive
                      2026-08-11), which costs it the warning its words carried,
                      so the explanation moves to a real Tooltip: `title` is the
                      browser's, arrives after about a second, and is the one
                      thing on this row nobody would guess. It renders only
                      where it can do something (a lone post has no others), and
                      `Unfold all` above is its exit — the arrangement it
                      overwrites is otherwise not one you can get back.

                      HOVER_REVEAL like the acts beside it, which it briefly was
                      not: while it read "only this" the words cost a whole
                      extra line per post on a 375px column, so it took
                      HOVER_CUE and vanished on touch. Becoming a glyph removed
                      the reason — measured at 375px, the byline is 18px tall
                      whether this is shown or hidden — and UI-7's rule for a
                      real control is that it PERSISTS where there is no hover.
                      A phone reading a long thread wants this more than a
                      desktop does, not less. */}
                  {posts.length > 1 && (
                    <Tooltip label="Fold everything else">
                      <button
                        onClick={() => fold.foldAllBut(p.id)}
                        disabled={held}
                        aria-label={`Fold every post but ${p.author}’s`}
                        className={`${POST_ACT_CLASS} text-ink-faint hover:bg-panel-2 hover:text-ink ${HOVER_REVEAL}`}
                      >
                        <Focus size={12} />
                      </button>
                    </Tooltip>
                  )}
                  {replyComposer && (
                    <Tooltip label="Reply to this post">
                      <button
                        onClick={() => setReplyingTo((cur) => (cur === p.id ? null : p.id))}
                        disabled={held}
                        aria-expanded={replyingTo === p.id}
                        // Names the POST, not just its author: a DM's thread
                        // composer is already "Reply to ‹counterpart›", and this
                        // control answers one message inside that conversation.
                        // Two controls under one accessible name is the
                        // ambiguity the Post buttons were renamed for — caught
                        // by an existing DM walk resolving to two elements.
                        aria-label={`Reply to ${p.author}’s post`}
                        className={`${POST_ACT_CLASS} text-ink-faint hover:bg-panel-2 hover:text-ink ${
                          replyingTo === p.id ? '' : HOVER_REVEAL
                        }`}
                      >
                        <ReplyIcon size={12} />
                      </button>
                    </Tooltip>
                  )}
                  {/* ── The gap before the irreversible one ───────────────────
                      Retract/Delete sits a deliberate step away from the verbs
                      it is nothing like (owner directive 2026-08-11: *"space
                      delete button a little far away to avoid being clicked by
                      mistake"*), earned the day a mis-aimed click took the
                      opening question out of a seeded thread. Distance is only
                      half the answer — the other half is that it now ASKS
                      (ConfirmDialog) rather than acting; a gap alone still
                      loses the post to one confident wrong click. */}
                  {deletion && p.canDelete === true && (
                    <Tooltip label={p.mine === true ? 'Retract this post' : 'Delete this post (you own the surface)'}>
                      <button
                        onClick={() => {
                          setCascade(false)
                          setConfirmDelete(p)
                        }}
                        disabled={held}
                        aria-label={p.mine === true ? 'Retract this post' : 'Delete this post'}
                        className={`${POST_ACT_CLASS} ml-3 text-ink-faint hover:bg-removed-bg hover:text-removed ${HOVER_REVEAL}`}
                      >
                        <Trash2 size={12} />
                      </button>
                    </Tooltip>
                  )}
                  {onReport && p.canDelete !== true && (
                    <Tooltip label={isReported ? 'Reported' : 'Report this post to the owner of this surface'}>
                      <button
                        onClick={() => void report(p.id)}
                        disabled={held || isReported || isReporting}
                        aria-busy={isReporting || undefined}
                        aria-label={isReported ? 'Reported' : 'Report this post to the owner of this surface'}
                        className={`${POST_ACT_CLASS} ml-3 text-[11px] text-ink-faint hover:bg-panel-2 hover:text-ink ${
                          isReported || isReporting ? '' : HOVER_REVEAL
                        }`}
                      >
                        {isReporting ? <Spinner size={12} /> : <Flag size={12} />}
                      </button>
                    </Tooltip>
                  )}
                </div>
              </div>
              <p className="mt-0.5 whitespace-pre-wrap text-[13px] text-ink-soft">
                <MentionText body={p.body} mentions={p.mentions} onOpen={onOpenPerson} />
              </p>
              {/* The composer is CONTENT — it belongs under the words it answers,
                  where its own reply will land. Only its trigger is an act, and
                  that lives in the cluster on the right with the other three. */}
              {replyComposer && replyingTo === p.id && (
                <div className="mt-2">{replyComposer(p, () => setReplyingTo(null))}</div>
              )}
            </div>
          )}
          {/* No acts hang off the right edge any more — the whole cluster moved
              onto the byline above. A FOLDED post shows none of them at all: a
              stub is an index entry, and offering Reply / Endorse / Retract
              against words that are not on screen asks for a judgement the
              reader has not been given the means to make. That falls out of the
              structure now rather than being repeated per control, since the
              cluster lives inside the block `hidden` already replaces. */}
        </div>
        {/* The chain. The indent CLAMPS rather than the depth doing so — see
            `replyIndentClass`: past the clamp a level still draws its hairline,
            so the structure stays legible, but it stops spending width this
            list may not have (it renders in a split pane and on the narrow
            tier alike). */}
        {answers.length > 0 && !hidden && (
          <ul className={`mt-3 space-y-3 ${replyIndentClass(depth + 1)}`}>{answers.map((c) => row(c, depth + 1))}</ul>
        )}
      </li>
    )
  }
  return (
    <div>
      {/* The thread-wide pair used to render HERE, above the roots. It is the
          host's now (`threadFoldVerbs` / `<ThreadFoldControls>`) — see
          `useThreadFold` for why the state moved with it. The list draws posts;
          where the thread's own verbs live is a question about the surface
          around it, and only the surface can answer it. */}
      <ul className="space-y-3">{roots.map((p) => row(p, 0))}</ul>
      {actionError && <p role="alert" className="mt-2 text-[12px] text-danger">{actionError}</p>}
      {deleteError && <p role="alert" className="mt-2 text-[12px] text-danger">{deleteError}</p>}
      {/* The question the trash can now asks. Its BODY is the part that earns
          the interruption: a dialog that only says "Are you sure?" moves the
          click without adding anything that would change it, so this one says
          whose words go, and — when the post has answers — that they do NOT go
          with it. That is the server's actual retract rule (answers are
          promoted, never deleted with their parent), and it is the fact most
          likely to change the reader's mind in either direction. */}
      {confirmDelete &&
        (() => {
          const under = descendantsOf(childrenOf, confirmDelete.id)
          const n = under.size
          // Whether the CASCADE may even be offered. The server re-asks the
          // delete question of every post that would go — so this is affordance
          // shaping (SOCIAL-4b), not the wall, and it reads the very answer the
          // wire already carries per post rather than deriving a second one.
          //
          // It is absent, not disabled, where the branch is not all yours: the
          // body already says what happens to those replies instead (they move
          // up), which is the explanation a greyed-out box would have needed.
          const mayTakeBranch = n > 0 && [...under].every((id) => byId.get(id)?.canDelete === true)
          const mine = confirmDelete.mine === true
          const verb = mine ? 'Retract' : 'Delete'
          return (
            <ConfirmDialog
              title={mine ? 'Retract this post?' : 'Delete this post?'}
              body={
                (mine ?
                  'Your post will be removed from the thread. This cannot be undone.'
                : `You are removing ${confirmDelete.author}’s post from a surface you own. This cannot be undone.`) +
                (n > 0 && !cascade ? ' The replies underneath it stay — they move up one level.' : '')
              }
              option={
                mayTakeBranch ?
                  {
                    label: `Delete the ${n === 1 ? 'reply' : `${n} replies`} underneath as well`,
                    checked: cascade,
                    onChange: setCascade,
                  }
                : undefined
              }
              // The button counts what it will take. "Retract" and "Retract 6
              // posts" are different acts and the control should not use one
              // word for both — the checkbox is a click away from the button,
              // and this is the last thing read before the last click.
              confirmLabel={cascade ? `${verb} ${n + 1} posts` : verb}
              onCancel={() => setConfirmDelete(null)}
              onConfirm={() => {
                if (!deletion) return
                const postIds = cascade
                  ? [confirmDelete.id, ...under]
                  : [confirmDelete.id]
                setDeleteError(null)
                void enqueueDiscussionPostDeletion({
                  discussionId: deletion.discussionId,
                  anchor: deletion.anchor,
                  post: confirmDelete,
                  postIds,
                  cascade,
                }).then(
                  (outcome) => {
                    if (outcome === 'discarded') {
                      setDeleteError('Deletion dismissed. Review the thread before trying again.')
                    }
                  },
                  () => setDeleteError('Deletion recovery could not load. Review the thread and try again.'),
                )
                setConfirmDelete(null)
              }}
            />
          )
        })()}
    </div>
  )
}

/** Every per-post act wears one face: a compact icon button on the byline. Same
 *  role ⇒ same look (src/CLAUDE.md) — five controls that had five spellings of
 *  the same padding and radius between them.
 *
 *  SHAPE ONLY — no colour, deliberately. It carried `text-ink-faint` for one
 *  revision, and the endorsement (which appends `text-accent` when you have
 *  endorsed) silently stopped showing it: two base `text-*` utilities in one
 *  class attribute have no defined winner, the cascade decides by the order
 *  they appear in the generated CSS, and the faint one won. That is the same
 *  trap `lib/textDoor` records for `border-*`, and the reason a shared
 *  primitive must not own a property any caller varies. Callers supply the
 *  resting colour, the hover colour, and the reveal rule — all three genuinely
 *  differ per act. */
const POST_ACT_CLASS =
  'flex shrink-0 items-center justify-center rounded-md px-1.5 py-0.5 transition focus-visible:opacity-100'

/** The subject's discussions (social S2, SOCIAL-6b) — the ROOT thread as a flat
 *  timeline with an inline composer, generic over the anchor ref by
 *  construction (any entity page can host it — the GrantsPanel rule). Payload,
 *  not configuration: rendered in the MAIN column for owner and visitor alike;
 *  the server walls posting (comment tier) while `view` reads and may react. */
function DiscussionsPanel({ subject, own }: { subject: SocialEntityRef; own: boolean }) {
  const rel = useRelations()
  const list = useDiscussions(subject.kind, subject.id).data ?? []
  const root = list.find((d) => d.anchor.locus === undefined) ?? null
  // Capability shapes affordances: a `view`-tier reader gets no compose verb at
  // all, rather than one whose every send the write path refuses. Asked of the
  // THREAD when one exists — see `useCanComment`.
  const canComment = useCanComment(subject, root)
  // The composer is ON DEMAND, disclosed by the section header's verb — the same
  // rule Open work / Coordination / Changes follow on this page (UI-18). It used
  // to sit permanently open below the thread, the one section on the page whose
  // primary act was a standing form instead of a header verb.
  const [composing, setComposing] = useState(false)
  const [postingHeld, setPostingHeld] = useState(false)
  useDiscussionPostDeletionStatus()
  useDiscussionStateStatus()
  const deletionHeld = root ? isDiscussionPostDeletionHeld(root.id) : false
  const stateHeld = root ? isDiscussionStateHeld(root.id) : false
  const threadHeld = postingHeld || deletionHeld || stateHeld
  // The thread's fold posture, held HERE so its two acts can render in the
  // section header's cluster with the section's other verbs (owner directive
  // 2026-08-13) rather than as a floating row above the roots.
  const fold = useThreadFold(root?.posts ?? NO_POSTS, threadHeld)
  const react = (pid: string, reacted: boolean): Promise<void> =>
    root ? reactToDiscussionPost(root.id, pid, subject, reacted) : Promise.resolve()
  const flip = () => {
    if (root) void enqueueDiscussionState(root, root.state === 'open' ? 'resolved' : 'open')
  }
  const composeVerb = canComment ? (
    <SectionAction
      key="compose"
      label={root ? 'Reply to this discussion' : 'Start the discussion'}
      icon={<MessageSquarePlus size={14} />}
      onClick={() => { if (!threadHeld) setComposing((v) => !v) }}
      expanded={composing}
      disabled={threadHeld}
      disabledReason="Wait for this discussion action to be confirmed"
    />
  ) : null
  const resolveVerb =
    root && root.canResolve === true ? (
      <SectionAction
        key="resolve"
        label={root.state === 'open' ? 'Resolve this discussion' : 'Reopen this discussion'}
        icon={root.state === 'open' ? <CheckCircle2 size={14} /> : <MessageSquare size={14} />}
        onClick={flip}
        disabled={threadHeld}
        disabledReason="Wait for this discussion action to be confirmed"
      />
    ) : null
  const verbs = [...threadFoldVerbs(fold), composeVerb, resolveVerb].filter(Boolean)
  return (
    <FoldSection
      title="Discussion"
      heldOpen={threadHeld}
      summary={root === null ? 'No discussion yet' : countLabel(root.posts.length, 'post')}
      // Undefined, not an empty fragment: a view-tier reader on an unfoldable,
      // unresolvable thread has no verbs, and the header must render no cluster
      // for them.
      //
      // The fold pair comes FIRST — before compose and resolve — because it is
      // the one pair whose usefulness scales with the thread. On the long thread
      // where you actually reach for it, the cluster is the only thing on screen
      // that is not a post, and the act you want should not be at the end of it.
      actions={
        verbs.length > 0 ? verbs : undefined
      }
    >
      {root === null ? (
        // Names the verb, like Open work's empty state — with the form now
        // behind the header, the empty section is where its act is learned.
        <p className="text-[12px] text-ink-faint">
          {canComment
            ? `Nothing discussed yet. Start the discussion — the first post opens this ${subject.kind}’s public thread.`
            : `No discussion yet — the first post opens this ${subject.kind}’s public thread.`}
        </p>
      ) : (
        <div className="space-y-3">
          {root.state === 'resolved' && (
            <p className="text-[11px] font-medium uppercase tracking-wide text-ink-faint">
              Resolved — the thread stays open for aftermath.
            </p>
          )}
          <DiscussionPostList
            fold={fold}
            onReact={react}
            deletion={{ discussionId: root.id, anchor: subject }}
            onReport={(pid) => reportDiscussionPost(root.id, pid)}
            onOpenPerson={(n) => rel.openOwner(n)}
            replyComposer={
              canComment ?
                (parent, done) => (
                  <AnchorThreadComposer
                    subject={subject}
                    thread={root}
                    replyTo={parent.id}
                    placeholder={`@${parent.author}`}
                    ariaLabel="Reply to this post"
                    autoFocus
                    onPosted={done}
                    onCancel={done}
                    onHeldChange={setPostingHeld}
                  />
                )
              : undefined
            }
          />
        </div>
      )}
      {composing && (
        <div className="mt-3">
          <RootThreadComposer
            subject={subject}
            root={root}
            autoFocus
            onPosted={() => setComposing(false)}
            onCancel={() => setComposing(false)}
            onHeldChange={setPostingHeld}
          />
        </div>
      )}
    </FoldSection>
  )
}

/* ─────────────────────────── The Commons (social S4) ─────────────────────── */

/** The root-thread composer is the shared `AnchorThreadComposer` with no locus
 *  — one component for every projection of a thread (the entity panel, the feed
 *  card, the discussion's own page, the conversation's turn gutter). */
const RootThreadComposer = ({
  subject,
  root,
  placeholder,
  ariaLabel,
  autoFocus,
  onPosted,
  onCancel,
  onHeldChange,
}: {
  subject: SocialEntityRef
  root: Discussion | null
  placeholder?: string
  /** A FEED of these exists — one composer per card — so a card names its own
   *  rather than letting every one of them announce "post to this principal's
   *  discussion" in the same words. */
  ariaLabel?: string
  /** Set by a DISCLOSED composer — the entity panel's, opened from the section
   *  header's verb, and the feed card's, opened by Reply: the caret lands where
   *  the verb promised. */
  autoFocus?: boolean
  onPosted?: () => void
  onCancel?: () => void
  onHeldChange?: (held: boolean) => void
}) => {
  // Capability shapes affordances: a `view`-tier reader reads the thread and
  // may not post to it, so they get no composer rather than a refusal.
  const canComment = useCanComment(subject, root)
  if (!canComment) return null
  return (
    <AnchorThreadComposer
      subject={subject}
      thread={root}
      placeholder={placeholder}
      ariaLabel={ariaLabel}
      autoFocus={autoFocus}
      onPosted={onPosted}
      onCancel={onCancel}
      onHeldChange={onHeldChange}
    />
  )
}

/** One feed post — a share act or a landing, its subject embed, and the door
 *  into the subject's root thread. The card is a PROJECTION: its comments are
 *  the entity page's thread, its title the entity page's door (title-as-link).
 *  Chronological feed, no ranking — facets, not an engagement machine. */
function FeedCard({ item, standalone = false }: { item: CommonsItem; standalone?: boolean }) {
  const rel = useRelations()
  const { kind, id } = item.subject
  // S8 — a POST is its own thread: the utterance and the conversation under it
  // are one object, so the card reads it BY ID rather than looking up "the
  // subject's root thread" (every one of an author's posts shares the same
  // principal anchor, so that lookup would find some other post of theirs).
  const isPost = item.kind === 'post'
  // The card's comments ARE the subject's root thread (one conversation, two
  // projections): the last two posts render inline, the count doors into the
  // full thread, and the composer posts into the SAME discussion the entity
  // page shows.
  const threads = useDiscussions(kind, id, !isPost).data ?? []
  const byId = useDiscussion(isPost ? (item.discussionId ?? '') : '', isPost).data ?? null
  const root = isPost ? byId : (threads.find((d) => d.anchor.locus === undefined) ?? null)
  // A post's opening entry is the card's own text, so it is not one of the
  // replies below it.
  // Memoized, because it is now the input to `useThreadFold` as well as to the
  // list: `slice(1)` mints a new array on every render, and the reply tree
  // keys on that identity.
  const shown = useMemo(() => (root ? (isPost ? root.posts.slice(1) : root.posts) : NO_POSTS), [root, isPost])
  // A card has no section header to put the thread's verbs in, so it keeps the
  // TEXT pair above the roots — see `<ThreadFoldControls>`. The handle is held
  // here all the same, because the list no longer owns it either way.
  const [postingHeld, setPostingHeld] = useState(false)
  // The only card that can retract a post is the standalone projection, whose
  // DiscussionPage host already owns the deletion-status subscription. Feed
  // previews stay out of the global mutation fan-out entirely.
  const deletionHeld = standalone && root ? isDiscussionPostDeletionHeld(root.id) : false
  const stateHeld = standalone && root ? isDiscussionStateHeld(root.id) : false
  const threadHeld = postingHeld || deletionHeld || stateHeld
  const fold = useThreadFold(shown, threadHeld)
  // The conversation is DISCLOSED, and Reply is what discloses it (owner
  // directive 2026-08-08). It used to be a door to `/discussions/:id` — but that
  // page is the same thread in another projection, so the trip bought the reader
  // nothing and cost them their place in the feed. Open, the card shows the
  // WHOLE thread, which is what makes it a real answer rather than a teaser:
  // there is no "view all N comments" left to send anyone elsewhere.
  //
  // The state OUTLIVES this card (owner directive 2026-08-08 — `lib/disclosure`):
  // the names inside an open thread are doors now, so following one and coming
  // back must find the thread as it was left. STANDALONE wins over the memory:
  // the post's own page IS the conversation, so it is never folded there.
  const [remembered, setOpen] = useDisclosure('commons-thread', item.id)
  const open = standalone || remembered
  // Did THIS reader just press Reply, or did the card mount already open?
  // `autoFocus` fires on mount, so the moment the state outlived the page, every
  // restored card would have grabbed the caret on arrival — the last one winning,
  // and the browser scrolling to it. Landing the caret is the answer to a CLICK,
  // never to a card remembering what it was.
  const [justOpened, setJustOpened] = useState(false)
  // Same live source the composer gates itself on, so the toggle can't offer a
  // conversation that is empty AND unanswerable — a control that does nothing.
  const canComment = useCanComment(item.subject, root)
  const react = (pid: string, reacted: boolean): Promise<void> =>
    root ? reactToDiscussionPost(root.id, pid, item.subject, reacted) : Promise.resolve()
  const target: SectionId | null = sectionForSocialKind(kind)
  return (
    // An <article>, because that is what it is: a self-contained composition in
    // a feed. It also gives the card an addressable BOUNDARY — the one thing a
    // stack of near-identical cards otherwise lacks, for assistive tech and for
    // a browser test that has to say "this card's Reply", not "the first one".
    <article aria-label={`${item.actor}’s ${item.kind}`} className="rounded-xl border border-line bg-surface px-5 py-4">
      {/* The actor line leads with the identity mark (the feed idiom every
          popular feed shares) and IS a door to the owner's profile —
          the same OwnerLink every other byline wears. */}
      <div className="flex items-center gap-2">
        <span className="text-[13px] font-medium text-ink">
          <OwnerLink
            bare
            ownerName={item.actor}
            own={item.mine === true}
            markSize={22}
            onClick={() => rel.openOwner(item.actor)}
          />
        </span>
        <span className="text-[12px] text-ink-faint">
          {item.kind === 'share' ? 'shared' : item.kind === 'post' ? 'posted' : `landed L${item.landingNumber}`} ·{' '}
          {relativeTime(item.at)}
        </span>
      </div>
      {item.note && (
        <p className="mt-2.5 whitespace-pre-wrap text-[13px] leading-relaxed text-ink-soft">
          {/* S8 — a mention is a door to the person named, from the server's own
              resolution (the set it rang), never a second client-side parse. */}
          <MentionText body={item.note} mentions={root?.posts[0]?.mentions} onOpen={(n: string) => rel.openOwner(n)} />
        </p>
      )}
      {/* The embed — the resource previewing inside the post; its TITLE is the
          door. A POST has no resource: the words above ARE the content, so the
          card shows nothing here rather than an empty frame around a name. */}
      {!isPost && (
      <div className="mt-3 rounded-lg border border-line bg-panel px-3.5 py-2.5">
        {target ? (
          <button
            onClick={() => rel.navigate(target, id)}
            className={`block max-w-full truncate text-left text-[13px] text-ink ${DOOR_CLASS}`}
          >
            {item.subjectName}
          </button>
        ) : (
          <span className="block truncate text-[13px] font-medium text-ink">{item.subjectName}</span>
        )}
        {item.subjectBlurb && <p className="mt-0.5 truncate text-[12px] text-ink-faint">{item.subjectBlurb}</p>}
        {/* An artifact wears the index's own kind cue (one registry, no drift). */}
        {item.subjectArtifactKind && (
          <p className="mt-0.5 flex items-center gap-1.5 text-[12px] text-ink-faint">
            {(() => {
              const Icon = KIND_ICON[item.subjectArtifactKind]
              return <Icon size={13} />
            })()}
            {KIND_LABEL[item.subjectArtifactKind]}
          </p>
        )}
        {/* A session previews AS conversation — the embed's richest face. */}
        {item.subjectTurns && (
          <div className="mt-1.5 space-y-1 border-t border-line pt-1.5">
            {item.subjectTurns.map((t, i) => (
              <p key={i} className="truncate text-[12px] text-ink-soft">
                <span className="mr-1 font-medium text-ink-faint">{t.role === 'user' ? 'You' : 'Claude'}</span>
                {t.text}
              </p>
            ))}
          </div>
        )}
      </div>
      )}
      {/* The card's two standing acts — the ones that FILL the rail's lenses
          (S4), worn quiet (`cardActClass`) so the content, not the chrome,
          carries the card. Watch works for every subject kind: the key
          generalized, so the card no longer has to know which kinds the bell
          happens to support. */}
      <div className="-ml-2 mt-1.5 flex items-center gap-1">
        <LikeButton item={item} />
        {/* Reply is the card's DISCLOSURE, not a door — so unlike the door it
            replaced it needs no thread to point at, and every card kind can
            carry it (a share's conversation was reachable only by leaving for
            the subject's page). It carries the count, which is what lets the
            thread rest closed without hiding that it exists; opening it drops
            the caret in the composer, so it answers at N=0 too — precisely when
            someone wants to say the first thing. */}
        {!standalone && (shown.length > 0 || canComment) && (
          <button
            onClick={() => {
              if (threadHeld) return
              setOpen(!open)
              setJustOpened(!open)
            }}
            disabled={threadHeld}
            aria-expanded={open}
            className={cardActClass(open)}
            title={open ? 'Hide the conversation' : 'Open the conversation'}
          >
            <MessageSquare size={14} />
            Reply
            {shown.length > 0 && <span className="tabular-nums text-ink-faint">{shown.length}</span>}
          </button>
        )}
        <WatchToggle quiet subject={item.subject} watching={item.watched === true} />
        {/* The door to this post's OWN page — the fullscreen idiom, right-aligned
            away from the acts (owner directive 2026-08-08: the two views of a
            post should correspond, and something should link them).
            POSTS ONLY, and that is not an oversight: every other card already
            doors to a page through its embed title, and the thread under a share
            belongs to the shared thing, not to the card. A post has no title and
            no resource — its own discussion IS its page, so without this the
            page existed with nothing pointing at it. */}
        {isPost && !standalone && item.discussionId && (
          <button
            onClick={() => rel.navigate('discussions', item.discussionId!)}
            title="Open this post on its own page"
            aria-label={`Open ${item.actor}’s post on its own page`}
            className={`${cardActClass(false)} ml-auto`}
          >
            <Maximize2 size={14} />
          </button>
        )}
      </div>
      {/* The conversation — replies AND the box for adding one — is ONE
          disclosure (owner directive 2026-08-08). The composer used to stand
          open under every card, which left a feed of boxes inviting replies to
          conversations it wasn't showing. Folding them together is also the
          honest reading of UI-18: a standing composer is for a surface whose
          whole subject IS the thread, and a card's subject is the post — the
          talk underneath is secondary, which is precisely why it folds. */}
      {open && (
        <div className="mt-2 border-t border-line pt-3">
          {shown.length > 0 && (
            <>
            <ThreadFoldControls fold={fold} />
            <DiscussionPostList
              fold={fold}
              onReact={react}
              // The S5 guardrails follow the rule they were written with: "a
              // destructive act belongs where the whole thread is." In a FEED
              // that is elsewhere, so a card offers neither — but the post's own
              // page IS where the whole thread is, and it renders this same
              // card, so standing alone is exactly when retract/report belong.
              // (Without this the page LOST the moderation it used to have when
              // it rendered its own list — the cost of unifying two projections
              // is that the survivor must keep what both of them could do.)
              deletion={standalone && root ? { discussionId: root.id, anchor: item.subject } : undefined}
              onReport={standalone && root ? (pid) => reportDiscussionPost(root.id, pid) : undefined}
              onOpenPerson={(n) => rel.openOwner(n)}
            />
            </>
          )}
          <div className={shown.length > 0 ? 'mt-3' : undefined}>
            <RootThreadComposer
              subject={item.subject}
              root={root}
              placeholder="Comment…"
              ariaLabel={`Comment on ${item.actor}’s ${item.kind}`}
              // Mounting WITH the disclosure means the caret can land the plain
              // way again — the ref the standing version needed is gone. Only for
              // the press that opened it, though: see `justOpened`.
              autoFocus={justOpened}
              onHeldChange={setPostingHeld}
            />
          </div>
        </div>
      )}
    </article>
  )
}

/** A profile's Commons band (S5): the actor's published shares + landings, as
 *  the VIEWER's feed filtered to that actor — the wall math stays the feed's
 *  (you see only what you could see anyway), and the cards are the same
 *  FeedCard projection. The structural section remains present when empty so
 *  the main page and its rail projection keep the same skeleton. */
function ProfileCommonsBand({ actor }: { actor: string }) {
  const mine = (useCommons().data ?? []).filter((i) => i.actor === actor)
  return (
    <FoldSection
      title="Commons activity"
      summary={`${mine.length} public act${mine.length === 1 ? '' : 's'}`}
    >
      {mine.length === 0 ? (
        <Empty>No Commons activity yet.</Empty>
      ) : (
        <div className="space-y-4">
          {mine.map((item) => (
            <FeedCard key={item.id} item={item} />
          ))}
        </div>
      )}
    </FoldSection>
  )
}

/** The rail's Commons lenses, as predicates over the SERVER's viewer-relative
 *  fields (contract/social.ts). One table, so the rail registry, the empty
 *  states below and the filter agree by construction — and so a lens can never
 *  be a client-side guess about what the reader watches or liked. */
const LENS_HOLDS: Record<string, (i: CommonsItem) => boolean> = {
  following: (i) => i.followed === true,
  watched: (i) => i.watched === true,
  liked: (i) => i.liked === true,
  posted: (i) => i.mine === true,
  viewed: (i) => i.viewedAt !== undefined,
}

/** The lens's own name, taken FROM the rail registry rather than retyped, so
 *  the page header and the rail row can't drift apart. */
const LENS_LABEL: Record<string, string> = Object.fromEntries(
  COMMONS_LENSES.map((s) => [s.id, s.label]),
)

/** What each lens says when it holds nothing — the act that would fill it. An
 *  empty collection is exactly where its verb has to be named. */
const LENS_EMPTY: Record<string, string> = {
  following: 'You aren’t following anyone yet — follow someone from their profile, and what they publish collects here.',
  watched: 'Nothing watched yet — watch a resource from its card or its page, and its acts land here.',

  liked: 'Nothing liked yet — like a post from its card to keep it here.',
  posted: 'You haven’t published anything yet — share a resource with a note and your post lands here.',
  viewed: 'Nothing opened yet — the resources you open from the commons collect here, most recent first.',
}

/** An empty lens names the act that would fill it — but FOLLOWING is the one
 *  lens whose emptiness is ambiguous, because it keys on the ACTOR rather than
 *  the subject: it is empty both when you follow nobody AND when the people you
 *  follow simply haven't published. The single sentence told the first reader
 *  "you aren't following anyone" while they were following someone (found in
 *  the in-app pass), which is an empty state asserting something false — worse
 *  than no explanation, because the next click it suggests is the one already
 *  done. Every other lens keys on the viewer's own act on the item, so for them
 *  emptiness has exactly one cause and the constant is honest. */
function lensEmptyText(lens: string, followed: string[]): string {
  if (lens === 'following' && followed.length > 0) {
    const who = followed.length === 1 ? followed[0] : `the ${followed.length} people you follow`
    return `Nothing yet from ${who} — what they publish to your commons collects here.`
  }
  return LENS_EMPTY[lens] ?? 'Nothing here yet.'
}

/** Record that this pane OPENED a subject's page — the ledger behind the
 *  Commons' "Recently viewed" lens (S4). One hook, so every entity page joins
 *  the same way and none of them knows a URL. Fires once per subject: an
 *  effect keyed on (kind, id), not on every render.
 *
 *  Deliberately NOT wired to conversations: a session you are inside is your
 *  own namespace, not something you browsed, and the Sessions resource is
 *  already that history. The lens complements it rather than repeating it. */
function useRecordView(kind: SocialEntityRef['kind'], id: string | undefined): void {
  useEffect(() => {
    if (id) void recordView({ kind, id })
  }, [kind, id])
}

/** The feed card's like — the thinnest social signal there is, and the act that
 *  fills the rail's "Liked" lens. Deliberately the same shape as a discussion
 *  post's reaction (a count plus whether YOU are in it), and deliberately not a
 *  notification: a like rings nobody and moves no wall. */
function LikeButton({ item }: { item: CommonsItem }) {
  const liked = item.liked === true
  const me = useMe().data
  const mutation = useCommonsLikeStatus()
  const held = heldCommonsLike(item.id)
  const active = mutation.activeResourceId === commonsLikeResourceId(item.id)
  const waiting = active && mutation.error !== null
  const label = held
    ? !active
      ? held.liked ? 'Like queued' : 'Unlike queued'
      : waiting
        ? 'Waiting for Retry'
        : held.liked ? 'Liking…' : 'Unliking…'
    : liked ? 'Liked' : 'Like'
  const toggle = () => {
    if (held || !me) return
    void enqueueCommonsLike({ tenantId: me.tenant.id, itemId: item.id, liked: !liked })
  }
  return (
    <button
      onClick={toggle}
      disabled={!!held || !me}
      aria-busy={(active && !waiting) || undefined}
      aria-pressed={liked}
      aria-label={held ? label : liked ? 'Unlike this post' : 'Like this post'}
      title={
        waiting ? 'Use Retry or Dismiss in the recovery banner'
        : held ? label
        : liked ? 'Remove your like'
        : 'Like this post'
      }
      className={cardActClass(liked)}
    >
      <ThumbsUp size={14} />
      {label}
      {item.likes > 0 && <span className="tabular-nums text-ink-faint">{item.likes}</span>}
    </button>
  )
}

/** ── The square's composer (social S8) ───────────────────────────────────────
 *  Where you say something with no resource attached. It stands OPEN rather
 *  than hiding behind a header verb — UI-18's rule is that a standing composer
 *  belongs to a surface whose whole subject IS the thread, and the square's
 *  subject is exactly that: what people are saying. (A section whose payload is
 *  something else, like a project's discussion panel, still discloses on
 *  demand.)
 *
 *  It is deliberately the plainest control on the page. The design doc's
 *  watch-for is that feeds reward posting, and its mitigations are structural:
 *  no ranking, facets over algorithms, one thin reaction. A composer that
 *  courted attention would undo them. */
function PostComposer() {
  const helpId = useId()
  const [body, setBody] = useState('')
  const [acting, setActing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const me = useMe().data
  useSocialPostMutationStatus()
  const tenantId = me?.tenant.id
  const authorName = me?.tenant.name
  const sharedHeld = authorName ? isWallPostMutationHeld(authorName) : false
  const held = acting || sharedHeld
  // The picker the mention hint promises. A post has no thread yet — it IS the
  // first word — so `threadVoices` is empty exactly here, where the copy tells
  // the writer to reach someone: the square's roster is the people they follow
  // plus the bylines in the feed they are reading (`squareVoices`). Both lists
  // are already loaded for this page, so this costs no fetch.
  const follows = useFollows().data ?? []
  const feed = useCommons().data ?? []
  const voices = useMemo(() => squareVoices(follows, feed), [follows, feed])
  const mention = useMentionPicker<HTMLTextAreaElement>({ roster: voices, draft: body, setDraft: setBody })
  const send = async () => {
    const text = body.trim()
    if (!text || held) return
    if (!tenantId || !authorName) {
      setError('Sign in again before posting.')
      return
    }
    setActing(true)
    setError(null)
    try {
      const result = await enqueueWallPost({ tenantId, authorName, body: text })
      if (result.outcome === 'applied') {
        setBody('')
        mention.close()
      } else if (result.outcome === 'discarded') {
        setError('That post was not applied. Your words are still here.')
      } else {
        setError('The post landed, but could not be confirmed. Refresh the Commons before posting again.')
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not start that post.')
    } finally {
      setActing(false)
    }
  }
  return (
    // ONE box. The composer used to be a bordered card wrapping a bordered
    // field — two frames on one ground, which read as a box inside a box the
    // moment the field grew its own verb. The card carried nothing else, so it
    // went: the field IS the composer, exactly as it is on a feed card below.
    <div className="mb-4" aria-busy={held || undefined}>
      {/* The submit sits INSIDE the box, on its bottom-right (owner directive
          2026-08-08) — the same shell the thread composer wears, so the square's
          composer and a card's are one shape at two sizes. It wears the soft
          verb at a stated SIZE: the face deliberately carries none
          (lib/button.ts leaves padding + text to the caller), and this one call
          site passed nothing, which is why it shipped as a cramped tint. */}
      <fieldset disabled={held} className="min-w-0 border-0 p-0">
        <div className={FIELD_SHELL_CLASS}>
          <textarea
            {...mention.fieldProps}
            aria-label="Say something"
            aria-describedby={helpId}
            value={body}
            // Opens on ONE line, like every other composer, so Post sits on that
            // line instead of below it — the shared rule, not a local one.
            rows={composerRows(body, 8)}
            placeholder="Say something…"
            className={`${FIELD_BARE_CLASS} resize-none`}
          />
          <button
            onClick={() => void send()}
            disabled={!body.trim() || held}
            className={`${SOFT_BUTTON_CLASS} shrink-0 px-3 py-1.5 text-[13px] disabled:opacity-45`}
          >
            {acting ? 'Posting…' : 'Post'}
          </button>
        </div>
      </fieldset>
      <p id={helpId} data-composer-help className="mt-1 text-[11px] text-ink-faint">
        Type @ to mention someone.
      </p>
      {mention.list}
      {error && <p role="alert" className="mt-1 truncate text-[11px] text-danger">{error}</p>}
    </div>
  )
}

/** The Commons feed — what the caller's world shares. One chronological
 *  column; the deliberate note is the publish act (silent grants stay out).
 *  The kind facet (shares / landings) is one live value mirrored in both
 *  Filter & sort controls (UI-19/UI-37) — the feed has no per-row page of its own, so the rail's children
 *  are the viewer's standing LENSES: watched / liked / posted / recently
 *  viewed, each the viewer's own relationship to an item rather than a slice of
 *  the items themselves. */
function CommonsSection({ lens }: { lens: string | null }) {
  const rel = useRelations()
  const all = useCommons().data ?? []
  const [filter] = useSectionFilter('commons')
  const kind =
    filter.facet === 'shares' ? 'share' : filter.facet === 'landings' ? 'landing' : filter.facet === 'posts' ? 'post' : null
  const byKind = kind ? all.filter((i) => i.kind === kind) : all
  // The rail's LENS narrows to the viewer's own collection — each on a
  // server-stamped, viewer-relative field, never a client guess.
  const feedLens = lens === 'browse' ? null : lens
  const inLens = feedLens === null ? byKind : byKind.filter((i) => LENS_HOLDS[feedLens]?.(i) ?? true)
  const list =
    feedLens === 'viewed'
      ? // "Recently viewed" IS an order: by when YOU opened the subject, not by
        // when the act happened — the sort choice would answer a different
        // question here, so this lens owns its own.
        [...inLens].sort((a, b) => (b.viewedAt ?? 0) - (a.viewedAt ?? 0))
      : sortSectionRows(inLens, filter.sortBy, { name: (i) => i.subjectName, at: (i) => i.at })
  // The BROWSE band (Discover consolidation): the D17 shared-project directory
  // lives with the resources it lists — searchable, list-not-feed, never
  // widening visibility. The Agents hub's Discover keeps agent discovery
  // (definitions belong to the agent hub). The root keeps this second list so
  // an empty feed still leads somewhere; the rail door gives that directory an
  // address of its own. Facet views stay pure feed.
  const [q, setQ] = useState('')
  const browse = useProjectDirectory(q.trim() || undefined).data ?? []
  // S7 — the Following lens is the ONE lens whose emptiness is ambiguous (see
  // `lensEmptyText`), so it needs the follow list to say which emptiness it is.
  // Fetched only on that lens: every other view would pay a request for a
  // sentence it never renders.
  const followed = useFollows(feedLens === 'following').data ?? []
  const browsePage = lens === 'browse'
  const browseDirectory = (
    <>
      <p className="mb-4 text-[12px] text-ink-faint">
        Every project other people opened to contributors — a searchable directory, not a feed.
      </p>
      <div className="relative mb-4">
        <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search shared projects…"
          aria-label="Search shared projects"
          className={`${FORM_INPUT_CLASS} pl-8`}
        />
      </div>
      {browse.length === 0 ? (
        <PageEmpty>No shared projects{q.trim() ? ' match' : ' yet — share one from its project page'}.</PageEmpty>
      ) : (
        <CardList>
          {browse.map((p) => (
            <SharedProjectRow
              key={p.id}
              entry={p}
              onOpen={() => rel.navigate('projects', p.id)}
              onOwnerClick={() => rel.openOwner(p.owner)}
            />
          ))}
        </CardList>
      )}
    </>
  )
  return (
    <CompositeResourcePage section="commons">
      <PageHeader title={browsePage ? 'Commons · Browse the Commons' : feedLens ? `Commons · ${LENS_LABEL[feedLens] ?? feedLens}` : 'Commons'} />
      <CompositePageControls
        section="commons"
        filter={browsePage ? undefined : <SectionFilterMenu section="commons" placement="page" />}
      />
      {browsePage ? (
        browseDirectory
      ) : (
        <>
          {/* Compose on the square itself. A LENS is a filtered view of your own
              collections ("things I liked"), and a composer there would write into
              a place whose filter the new post may not even satisfy. */}
          {feedLens === null && <PostComposer />}
          {list.length === 0 ? (
            <PageEmpty>
              {/* A lens names the act that fills it; a facet says what it found
                  nothing of; the bare feed explains what a post even is. */}
              {feedLens
                ? lensEmptyText(feedLens, followed)
                : filter.facet !== 'all'
                  ? `No ${filter.facet} in your commons yet.`
                  : 'Nothing here yet — say something above, or share a resource with a note (the note is the post).'}
            </PageEmpty>
          ) : (
            <div className="space-y-4">
              {list.map((item) => (
                <FeedCard key={item.id} item={item} />
              ))}
            </div>
          )}
          {feedLens === null && filter.facet === 'all' && (
            <ListPartition title="Browse the Commons">{browseDirectory}</ListPartition>
          )}
        </>
      )}
    </CompositeResourcePage>
  )
}

/* ─────────────────────────── Discussions (social S2) ─────────────────────── */

/** The chip naming a discussion's anchor — a DOOR into the anchored entity's
 *  page for the kinds that have one (the ref-link form; artifacts gain doors
 *  when their surfaces host the panel).
 *
 *  When the anchor carries a LOCUS (SOCIAL-6b) the chip names the position too
 *  and, where that position has a focusable surface, lands ON it: a
 *  `session-turn` opens the conversation and flashes that turn. Both the phrase
 *  and the landing come from the ONE resolver registry
 *  (`src/lib/anchorLocus.ts`) — never spelled out here, so a new locus kind
 *  reaches every chip in one edit. A locus whose surface can't focus a position
 *  yet still doors to the entity: descriptive, never a dead click. */
function AnchorChip({
  anchor,
  onOpenSession,
  onFocusHere,
}: {
  anchor: SocialAnchor
  onOpenSession: (id: string) => void
  onFocusHere: (target: FocusTarget) => void
}) {
  const rel = useRelations()
  const { kind, id } = anchor.ref
  const target: SectionId | null = sectionForSocialKind(kind)
  const content = useArtifactContent(kind === 'artifact' && anchor.locus?.kind === 'artifact-block')
  const blockState = artifactBlockAnchorState(anchor, content.data?.[id], content.status)
  const at = anchor.locus ? ` · ${describeLocus(anchor.locus, blockState)}` : ''
  const label = `${kind} · ${id}${at}`
  // The position to land on, from the ONE registry — this chip never asks which
  // FIELD a kind uses, so a new locus kind needs no edit here.
  const focus = blockState && blockState !== 'attached' ? null : locusFocus(anchor)
  // Two doors by subject kind: a conversation is a PANE fill, a section entity
  // is a route. Either way the highlight is aimed afterwards, identically.
  const open = () => {
    if (kind === 'session') onOpenSession(id)
    else if (target) rel.navigate(target, id)
    else return
    if (focus) onFocusHere(focus)
  }
  if (kind !== 'session' && !target) return <span className="text-[11px] text-ink-faint">{label}</span>
  return (
    <button
      onClick={open}
      data-artifact-anchor-state={blockState}
      className={INLINE_ACTION_CLASS}
      title={focus && anchor.locus ? `Open this ${kind} at ${describeLocus(anchor.locus)}` : `Open this ${kind}`}
    >
      {label}
    </button>
  )
}

/** A discussion's own page (`/discussions/:did`) — surface-from-nature: a
 *  thread on a lifecycle wants a TIMELINE page. Same one canonical page for
 *  every viewer; the server walls reads/writes (existence-hiding 404 renders
 *  as the degraded empty state on a stale id). */
/** The thread rendered as model-readable context — what "Discuss with Claude"
 *  hands the session (the design's share → discuss → hand-the-debate-to-Claude
 *  loop; the full Context-type attach is recorded as follow-up). */
function discussionDigest(d: Discussion): string {
  const posts = d.posts.map((p) => `- ${p.author}: ${p.body}`).join('\n')
  return `Let’s work through this discussion on ${d.anchor.ref.kind} ${d.anchor.ref.id} (${d.state}):\n${posts}\n\nHelp me draft a response that addresses the points raised.`
}

function DiscussionPage({
  discussionId,
  onOpenSession,
  onFocusHere,
  onBack,
  backTo,
}: {
  discussionId: string
  onOpenSession: (id: string) => void
  onFocusHere: (target: FocusTarget) => void
  onBack: () => void
  backTo: NavLocation | null
}) {
  const rel = useRelations()
  const q = useDiscussion(discussionId)
  const d = q.data ?? null
  const tenantId = useMe().data?.tenant.id
  useDiscussionSessionLaunchStatus()
  const launchHeld = d ? isDiscussionSessionLaunchHeld(d.id) : false
  const [launchError, setLaunchError] = useState<string | null>(null)
  const discussionLocationRef = useRef(discussionId)
  discussionLocationRef.current = discussionId
  const discussionMountedRef = useRef(false)
  useEffect(() => {
    discussionMountedRef.current = true
    return () => { discussionMountedRef.current = false }
  }, [])
  useRecordView('discussion', discussionId)
  // Read BEFORE the not-found early return, so hook order is stable; disabled
  // until the anchor is known.
  const isDm = d?.direct === true
  // The THREAD's own write standing, computed by the predicate the write path
  // enforces — not the subject's tier capability, which on a DM asks whether
  // you could cold-open to that person (asymmetric, and false for the recipient
  // who may certainly reply). One decision, server-side, like `canResolve`.
  const canComment = d?.canPost === true
  // This page IS the thread, so there is no section header to put the fold pair
  // in and it keeps the text pair above the roots (`<ThreadFoldControls>`).
  // Declared here, above the not-found return, for the same reason the reads
  // above are: hook order must not depend on whether the thread resolved.
  const [postingHeld, setPostingHeld] = useState(false)
  useDiscussionPostDeletionStatus()
  useDiscussionStateStatus()
  const deletionHeld = d ? isDiscussionPostDeletionHeld(d.id) : false
  const stateHeld = d ? isDiscussionStateHeld(d.id) : false
  const threadHeld = postingHeld || deletionHeld || stateHeld
  const fold = useThreadFold(d?.posts ?? NO_POSTS, threadHeld)
  // Opening a message advances through the newest post ACTUALLY rendered. A
  // later arrival is a distinct intent, so response loss can never widen this
  // act into "whatever is newest when Retry happens".
  const newestPostId = d?.posts[d.posts.length - 1]?.id
  useEffect(() => {
    if (
      isDm &&
      (d?.unread ?? 0) > 0 &&
      newestPostId &&
      tenantId &&
      !heldDiscussionRead(discussionId, newestPostId)
    ) {
      void enqueueDiscussionRead({ tenantId, discussionId, throughPostId: newestPostId })
    }
  }, [d?.unread, isDm, newestPostId, discussionId, tenantId])
  // ── Is this thread somebody's POST? Then this page is that post (S8) ────────
  // Asked of the FEED, not re-derived from the anchor: the server already
  // decides what is a wall post when it mints the item, and a second client-side
  // predicate over `anchor.ref.kind === 'principal' && !direct` would be the
  // same decision made twice — the drift this repo keeps paying for. Absent (a
  // muted author, whose acts the feed filters) simply falls through to the
  // generic thread below, which still renders every word.
  const feed = useCommons()
  const post = (feed.data ?? []).find((i) => i.kind === 'post' && i.discussionId === discussionId) ?? null
  // A deep link arrives before the feed does, and "not a post" is indistinguishable
  // from "not answered yet" — so waiting is what keeps the page from rendering
  // the generic thread and then swapping it for the card a moment later.
  //
  // The test is "no answer YET", not "a fetch is in flight": this cache
  // revalidates stale-while-revalidate, so `status` returns to `loading` with the
  // data still in hand every time a write invalidates the feed — gating on that
  // would blank a page the reader is looking at each time anyone posts anywhere.
  // An errored feed doesn't hang the page either; it falls through to the thread.
  // A DM skips the wait outright, on the server's own `direct` flag: a message is
  // never somebody's post, so it has nothing to wait for.
  const decidingPost = !isDm && feed.data === undefined && feed.status !== 'error'
  if (!d || decidingPost) {
    return (
      <UnavailableResourcePage
        title="Discussion"
        state={d ? 'loading' : resolveResourceUnavailable([q], { notFoundIsMissing: true })}
        message="This discussion isn’t visible from this account (or no longer exists)."
        backTo={backTo}
        onBack={onBack}
        onRetry={() => retryResourceQueries([keys.discussion(discussionId), keys.commons])}
      />
    )
  }
  const launchConversation = async (): Promise<void> => {
    if (!tenantId || launchHeld) return
    const origin = discussionId
    setLaunchError(null)
    try {
      const result = await enqueueDiscussionSessionLaunch({
        tenantId,
        discussionId: d.id,
        digest: discussionDigest(d),
      })
      if (
        result.outcome === 'applied' &&
        discussionMountedRef.current &&
        discussionLocationRef.current === origin
      ) {
        onOpenSession(result.sessionId)
      } else if (result.outcome === 'discarded' && discussionMountedRef.current) {
        setLaunchError('The conversation wasn’t started. Review the discussion and try again.')
      }
    } catch (error) {
      if (discussionMountedRef.current) {
        setLaunchError(error instanceof Error ? error.message : 'Could not start that conversation.')
      }
    }
  }
  return (
    <AtomicResourcePage>
      <header className={PAGE_HEADER_CLASS}>
        <div className="flex min-w-0 items-start gap-3">
          <BackButton to={backTo} onBack={onBack} />
          <div className="min-w-0">
            {/* A DM's title is WHO IT IS WITH, not its opening words — the same
                reason the inbox row leads with the counterpart. And it wears no
                AnchorChip: the chip's job is a door back to the anchored
                resource, and here the "resource" is the person already named in
                the title (S7).
                A POST's title is the KIND, for the opposite reason: its words
                are its CONTENT, and this page renders them below in the card's
                own form. Titling the page with them printed the post twice and
                still didn't look like the card (owner report, 2026-08-08). Its
                byline, timestamp and anchor all ride the card, so the header
                keeps only what the card cannot carry: the way back and the
                thread's own verbs. */}
            <h1 className={PAGE_TITLE_CLASS}>
              {post ? 'Post' : isDm ? (d.counterpart ?? d.openedBy) : discussionTitle(d.posts[0]?.body)}
            </h1>
            {!post && (
              <div className="mt-1 flex flex-wrap items-center gap-2 text-[12px] text-ink-faint">
                <span>
                  {isDm ?
                    `Direct message · started by ${d.openedBy} ${relativeTime(d.openedAt)}`
                  : `${d.state === 'open' ? 'Open' : 'Resolved'} · opened by ${d.openedBy} ${relativeTime(d.openedAt)}`}
                </span>
                {!isDm && <AnchorChip anchor={d.anchor} onOpenSession={onOpenSession} onFocusHere={onFocusHere} />}
              </div>
            )}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {/* The agent hook (social-layer design §4): hand the debate to Claude —
              a new session seeded with the thread digest as its first message.
              The full Context-type attach is the recorded follow-up. */}
          <button
            onClick={() => void launchConversation()}
            disabled={launchHeld || !tenantId}
            aria-busy={launchHeld || undefined}
            className={INLINE_ACTION_CLASS}
          >
            {launchHeld ? 'Starting conversation…' : 'Discuss with Claude'}
          </button>
          {/* `canResolve`, not `mine`: standing is the opener OR the anchor's
              owner, so gating on `mine` denied the owner a control they hold. */}
          {d.canResolve === true && (
            <button
              onClick={() => void enqueueDiscussionState(d, d.state === 'open' ? 'resolved' : 'open')}
              disabled={threadHeld}
              aria-busy={stateHeld || undefined}
              className={INLINE_ACTION_CLASS}
            >
              {d.state === 'open' ? 'Resolve' : 'Reopen'}
            </button>
          )}
        </div>
      </header>
      {launchError && <p role="alert" className="px-6 pb-2 text-[12px] text-danger">{launchError}</p>}
      {/* A post's page renders the POST — the very card the feed shows, opened
          (owner report, 2026-08-08: "the page of the post … doesn't correspond
          to the post as viewed from the commons page"). It is the same component,
          not a matching arrangement of the same facts, because a second hand-built
          rendering of one object is what let these two drift apart in the first
          place: the page had grown a title, lost Like and Watch, and printed the
          opening words twice. `standalone` is the only difference between the two
          projections — no fold (this page IS the conversation) and no door to
          itself. */}
      {post ? (
        <FeedCard item={post} standalone />
      ) : (
      <>
        <ThreadFoldControls fold={fold} />
        <DiscussionPostList
          fold={fold}
          onReact={(pid, reacted) => reactToDiscussionPost(d.id, pid, d.anchor.ref, reacted)}
          deletion={{ discussionId: d.id, anchor: d.anchor.ref }}
          onReport={(pid) => reportDiscussionPost(d.id, pid)}
          onOpenPerson={(n) => rel.openOwner(n)}
          replyComposer={
            canComment ?
              (parent, done) => (
                <AnchorThreadComposer
                  subject={d.anchor.ref}
                  thread={d}
                  replyTo={parent.id}
                  placeholder={`@${parent.author}`}
                  ariaLabel="Reply to this post"
                  autoFocus
                  onPosted={done}
                  onCancel={done}
                  onHeldChange={setPostingHeld}
                />
              )
            : undefined
          }
        />
        {/* The ONE thread composer, like every other projection of a thread —
            this page used to hand-roll its own textarea + Post + error state
            around a second `postToDiscussion` call, which is how the two drifted
            apart (form follows function; the composer's own header names its
            consumers). Capability shapes affordances: a `view`-tier reader reads
            the thread and may still REACT (the thinnest signal needs no tier) —
            `canComment` is what decides they get no reply box.
            STANDING, not disclosed: this page IS the discussion, so the composer
            is its payload, not chrome on a host surface (UI-18's exception —
            the entity panel's copy of it hides behind a section verb). */}
        {canComment && (
          <div className="mt-4">
            <AnchorThreadComposer
              subject={d.anchor.ref}
              thread={d}
              placeholder={isDm ? `Reply to ${d.counterpart ?? d.openedBy}…` : 'Reply…'}
              // A DM's composer is not "this discussion" — naming the person is
              // both the accurate description and the one that tells a screen
              // reader which of several open conversations it belongs to.
              ariaLabel={isDm ? `Reply to ${d.counterpart ?? d.openedBy}` : 'Reply to this discussion'}
              onHeldChange={setPostingHeld}
            />
          </div>
        )}
      </>
      )}
    </AtomicResourcePage>
  )
}

/** The Discussions hub — the caller's participating threads, narrowed by the
 *  shared STATE facet (UI-19/UI-37; the rail's children are the threads). Titles
 *  are doors. */
function DiscussionsSection({
  discussionId,
  onOpenSession,
  onFocusHere,
  onBack,
  backTo,
}: {
  discussionId: string | null
  onOpenSession: (id: string) => void
  onFocusHere: (target: FocusTarget) => void
  onBack: () => void
  backTo: NavLocation | null
}) {
  const rel = useRelations()
  const list = useMyDiscussions().data ?? []
  const [filter] = useSectionFilter('discussions')
  // Hooks first, then the detail branch — a conditional return above a hook is
  // an order violation the next edit pays for.
  if (discussionId) return <DiscussionPage discussionId={discussionId} onOpenSession={onOpenSession} onFocusHere={onFocusHere} onBack={onBack} backTo={backTo} />
  // The same list the rail's thread children show (state facet + order).
  const filtered = listDiscussions(list, filter)
  const projection = flatCollectionProjection({
    section: 'discussions',
    fallbackLabel: 'Discussions',
    empty: filter.facet !== 'all'
      ? `No ${filter.facet} discussions you participate in.`
      : 'No discussions yet — start one from any resource’s Discussion section.',
    items: collectionProjectionItems(
      filtered,
      (discussion) => discussion.id,
      (discussion) => discussionTitle(discussion.posts[0]?.body),
    ),
  })
  return (
    <CompositeResourcePage section="discussions">
      <PageHeader title="Discussions" />
      <CompositePageControls
        section="discussions"
        filter={<SectionFilterMenu section="discussions" placement="page" />}
      />
      <MainCollectionTemplate
        projection={projection}
        renderItem={(item) => {
          const d = item.value
          return (
            <div className="flex items-center gap-3 py-3">
              <span className="flex w-4 shrink-0 items-center justify-center">
                {d.state === 'open' ? (
                  <span className="h-1.5 w-1.5 rounded-full bg-ok" aria-label="Open" />
                ) : (
                  <CheckCircle2 size={14} className="text-ink-faint" aria-label="Resolved" />
                )}
              </span>
              <div className="min-w-0 flex-1">
                {/* Title-as-door: the first post fronts the thread's page. */}
                <button onClick={() => rel.navigate('discussions', d.id)} className={`block max-w-full truncate text-left text-[13px] text-ink ${DOOR_CLASS}`}>
                  {discussionTitle(d.posts[0]?.body)}
                </button>
                <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[11px] text-ink-faint">
                  <span>
                    {d.posts.length} {d.posts.length === 1 ? 'post' : 'posts'} · by {d.openedBy}
                  </span>
                  <AnchorChip anchor={d.anchor} onOpenSession={onOpenSession} onFocusHere={onFocusHere} />
                </div>
              </div>
              <span className="shrink-0 text-[11px] text-ink-faint">{relativeTime(d.posts[d.posts.length - 1]?.at ?? d.openedAt)}</span>
            </div>
          )
        }}
      />
    </CompositeResourcePage>
  )
}

/** A follow roster band on a profile (S7) — Followers / Following, the standard
 *  social pair. Rows are PEOPLE, so each is the shared `OwnerLink` door into
 *  that person's own profile, carrying the same inline `FollowButton` the
 *  header does; the graph is walkable rather than a dead list of names.
 *
 *  The counts are public (aggregates of public acts, like every other stat on
 *  this page) while the ROWS are viewer-filtered server-side, so the two can
 *  legitimately disagree. That gap is stated in the band rather than hidden:
 *  it was a hover tooltip first, which is not a place you can check who follows
 *  you — the whole reason this band exists. */
function FollowRosterBand({
  title,
  rows,
  total,
  emptyText,
  onOpenOwner,
}: {
  title: string
  rows: FollowRow[]
  total: number
  emptyText: string
  onOpenOwner: (name: string) => void
}) {
  const hidden = Math.max(0, total - rows.length)
  return (
    <div>
      <div className="mb-2 flex items-baseline gap-2 text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
        <span>{title}</span>
        <span className="font-normal normal-case tracking-normal">{total}</span>
      </div>
      {rows.length === 0 ? (
        // "Nobody yet" is only true when the COUNT is zero. With followers the
        // viewer simply cannot see, the honest sentence is the hidden one below
        // — printing both stacked two contradictory claims on one band (the
        // same defect the Following lens's empty state was fixed for).
        <Empty>{total === 0 ? emptyText : `None of ${title.toLowerCase()} here are visible from your account.`}</Empty>
      ) : (
        <CardList>
          {rows.map((r) => (
            <div key={r.name} className="flex items-center gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <OwnerLink ownerName={r.name} own={r.own} bare onClick={() => onOpenOwner(r.name)} />
              </div>
              {/* No control on your own row — you cannot follow yourself, and
                  the server reports neither flag for it. */}
              {!r.own && <FollowButton name={r.name} following={r.youFollow === true} />}
            </div>
          ))}
        </CardList>
      )}
      {hidden > 0 && rows.length > 0 && (
        <p className="mt-2 text-[11px] text-ink-faint">
          {hidden} more not shown here — either beyond this page or not visible from your account.
        </p>
      )}
    </div>
  )
}

/** ── The notification inbox, as a PAGE (D24; owner directive 2026-08-08) ─────
 *  It began as an overlay over whatever you were reading, which made one thing
 *  impossible: coming back to it. An overlay has no address, never becomes a
 *  pane, and so can never be on the back stack — so answering a bell always
 *  ended somewhere with no way home *to the inbox*, and triaging a second bell
 *  meant re-opening the bell. ("Shouldn't the back button get him to the
 *  notifications page?" — it couldn't, because there was no such page.)
 *
 *  As a section it is an ordinary place: `/notifications`, a rail row, a pane of
 *  its own, splittable, deep-linkable. And its rows become IN-PAGE doors, which
 *  is the whole point — they route through the pane funnel like every other
 *  in-page door, so the page you land on carries the inbox on its back stack
 *  (ADAPT-18) with no special casing anywhere.
 *
 *  Its own surface is also why "a modal is only for a transient act" was the
 *  wrong shape (surface-from-nature): this is a LIST of entities you triage,
 *  each with state (read / unread) and a door — the same nature as Messages,
 *  which has been a page since S7. */
function NotificationsSection({
  onFocusHere,
  onOpenAgentPage,
}: {
  onFocusHere: (target: FocusTarget) => void
  onOpenAgentPage: (agentId: string) => void
}) {
  const rel = useRelations()
  const rows = useNotifications().data ?? []
  const me = useMe().data
  const readMutation = useNotificationReadStatus()
  // My own agent registry — resolves whether a proposal bell lands on MY review
  // queue (I own the agent) or the owner's public profile (I'm the proposer).
  const myAgents = useAgents().data ?? []
  const unread = rows.filter((r) => !r.read).length
  const unreadIds = rows.filter((row) => !row.read).map((row) => row.id)
  const heldAll = heldNotificationRead(unreadIds)

  const readPhase = (ids: readonly string[]) => {
    const held = ids.length === 1 ? heldNotificationReadFor(ids[0]!) : heldNotificationRead(ids)
    if (!held) return undefined
    const active = readMutation.activeResourceId === notificationReadResourceId(held.ids)
    if (!active) return 'queued' as const
    return readMutation.error ? 'failed' as const : 'pending' as const
  }

  // The doors, expressed against the PANE bridge (`rel.navigate`) rather than
  // the shell's: an in-page door must stay in its pane and carry its origin,
  // and routing through the shell would reset the very history this page exists
  // to be part of. The transient highlight rides the same `onFocusHere`
  // pipeline every other in-page locus door uses.
  const doors: NotificationDoors = {
    openSchedule: (scheduleId, runId) => {
      rel.navigate('scheduled', scheduleId)
      onFocusHere({ runId })
    },
    openProject: (projectId) => rel.navigate('projects', projectId),
    openSection: (s) => rel.navigate(s),
    openWorkItem: (projectId, workItemId, commentId) => {
      rel.navigate('projects', projectId, workItemId)
      onFocusHere({ projectId, workItemId, commentId })
    },
    openProposal: (agentId, proposalId, ownerName) => {
      // `ownerName` null ⇒ the caller OWNS the agent ⇒ their Agents hub (the
      // review queue); else the definition's own PAGE, where "Your proposals"
      // lives. The agent PAGE is not reachable through the section bridge (it
      // seeds an owner, not an agent), so it keeps its dedicated door.
      if (ownerName) onOpenAgentPage(agentId)
      else rel.navigate('agents')
      onFocusHere({ agentId, proposalId })
    },
    openAgent: (agentId) => {
      rel.navigate('agents')
      onFocusHere({ agentId })
    },
    openDiscussionPage: (discussionId) => rel.navigate('discussions', discussionId),
    openOwner: (name) => rel.openOwner(name),
  }

  const open = (n: AppNotification) => {
    if (!n.read && me && !heldNotificationReadFor(n.id)) {
      void enqueueNotificationRead({ tenantId: me.tenant.id, ids: [n.id] })
    }
    const intent = doorFor(n)
    switch (intent.kind) {
      case 'schedule':
        doors.openSchedule(intent.scheduleId, intent.runId)
        break
      case 'workItem':
        doors.openWorkItem(intent.projectId, intent.workItemId, intent.commentId)
        break
      case 'project':
        doors.openProject(intent.projectId)
        break
      case 'proposal': {
        const iOwn = myAgents.some((a) => a.id === intent.agentId)
        doors.openProposal(intent.agentId, intent.proposalId, iOwn ? null : n.actor)
        break
      }
      case 'agent': {
        // A proposal.* bell whose id predates R2 (no proposalId) degrades to this
        // coarse 'agent' door. It still belongs to the PROPOSER when they don't own
        // the agent → the owner's profile (n.actor), where "Your proposals" lives —
        // not the caller's own hub. A fork bell always rings the owner (who owns the
        // source), so it lands on the hub.
        const iOwn = myAgents.some((a) => a.id === intent.agentId)
        if (!iOwn && n.kind.startsWith('proposal.')) doors.openOwner(n.actor)
        else doors.openAgent(intent.agentId)
        break
      }
      case 'discussion':
        doors.openDiscussionPage(intent.discussionId)
        break
      case 'owner':
        doors.openOwner(intent.ownerName)
        break
      case 'section':
        doors.openSection(intent.section)
        break
      default:
        // Exhaustiveness: `doorFor` is total over NotificationKind, but this
        // DISPATCH is the other half of the contract — a new NavIntent variant
        // with no arm here would type-check and silently become a dead click.
        // The `never` makes that a build error instead.
        assertHandledIntent(intent)
    }
  }
  const projection = flatCollectionProjection({
    section: 'notifications',
    fallbackLabel: 'Notifications',
    empty: 'Nothing yet — watch a project (or share one) and its public acts land here.',
    items: collectionProjectionItems(
      rows,
      (row) => row.id,
      (row) => row.subjectName ?? row.projectName ?? row.actor,
    ),
  })

  return (
    <CompositeResourcePage section="notifications">
      <PageHeader title="Notifications">
        {unread > 0 && (
          <button
            onClick={() => {
              if (me && !heldAll) void enqueueNotificationRead({ tenantId: me.tenant.id, ids: unreadIds })
            }}
            disabled={!me || !!heldAll}
            aria-busy={readPhase(unreadIds) === 'pending' || undefined}
            className={INLINE_ACTION_CLASS}
          >
            {readPhase(unreadIds) === 'queued' ? 'Read update queued'
              : readPhase(unreadIds) === 'pending' ? 'Marking all read…'
              : readPhase(unreadIds) === 'failed' ? 'Waiting for Retry'
              : 'Mark all read'}
          </button>
        )}
      </PageHeader>
      <MainCollectionTemplate
        projection={projection}
        renderItem={(item) => (
          <NotificationRow
            row={item.value}
            onOpen={() => open(item.value)}
            readPhase={!item.value.read ? readPhase([item.value.id]) : undefined}
          />
        )}
      />
    </CompositeResourcePage>
  )
}

/** A dispatch arm is missing: the argument stays wider than `never` and the
 *  build fails, rather than the row becoming a silent no-op. */
function assertHandledIntent(intent: never): void {
  void intent
}

/** The DM inbox (S7). A message is a Discussion anchored to a PERSON, so every
 *  row here is an ordinary thread — what makes the surface a message list is
 *  the two viewer-relative fields the server stamps on a principal anchor:
 *  `counterpart` (whom it is with, from THIS reader's end) and `unread`.
 *
 *  List-only on purpose. A thread's canonical page is `/discussions/:did`, and
 *  a second `/messages/:did` would be a duplicate address for one page — the
 *  URL rule this app is built on. So the title is a door into the same timeline
 *  the Discussions hub opens, and the DM face travels with the thread. */
function MessagesSection() {
  const rel = useRelations()
  const list = useDirectMessages().data ?? []
  const readMutation = useDiscussionReadStatus()
  const readPhase = (discussionId: string) => {
    const held = heldDiscussionReadFor(discussionId)
    if (!held) return undefined
    const active = readMutation.activeResourceId === discussionReadResourceId(
      held.discussionId,
      held.throughPostId,
    )
    if (!active) return 'queued' as const
    return readMutation.error ? 'failed' as const : 'pending' as const
  }
  const projection = flatCollectionProjection({
    section: 'messages',
    fallbackLabel: 'Messages',
    empty: 'No messages yet — open someone’s profile from the commons and use “Message” to start one.',
    items: collectionProjectionItems(
      list,
      (discussion) => discussion.id,
      (discussion) => discussion.counterpart ?? discussion.openedBy,
    ),
  })
  return (
    <CompositeResourcePage section="messages">
      <PageHeader title="Messages" />
      <MainCollectionTemplate
        projection={projection}
        renderItem={(item) => {
          const d = item.value
          const last = d.posts[d.posts.length - 1]
          const unread = d.unread ?? 0
          const phase = readPhase(d.id)
          const readLabel = phase === 'queued'
            ? 'Read update queued'
            : phase === 'pending'
              ? 'Syncing read position…'
              : phase === 'failed'
                ? 'Waiting for Retry'
                : null
          return (
            <div
              data-message-row=""
              data-message-read={phase}
              className="flex items-center gap-3 py-3"
            >
              <span className="flex w-4 shrink-0 items-center justify-center">
                {unread > 0 ? (
                  <span className="h-1.5 w-1.5 rounded-full bg-accent" aria-label={`${unread} unread`} />
                ) : null}
              </span>
              <div className="min-w-0 flex-1">
                {/* Title-as-door — and the title of a MESSAGE is who it is
                    with, not its opening words. That is the one thing a DM
                    row is scanned for. */}
                <button
                  onClick={() => rel.navigate('discussions', d.id)}
                  aria-busy={phase === 'pending' || undefined}
                  className={`block max-w-full truncate text-left text-[13px] ${unread > 0 ? 'font-medium text-ink' : 'text-ink'} ${DOOR_CLASS}`}
                >
                  {d.counterpart ?? d.openedBy}
                </button>
                {/* `mine` — the server's flag — not `author === counterpart`:
                    display names are not unique and not identities, and this
                    repo's rule is that a control or cue never keys on one. */}
                <div className="mt-0.5 truncate text-[11px] text-ink-faint">
                  {last ? `${last.mine === true ? 'You: ' : ''}${last.body}` : 'No messages yet'}
                  {readLabel ? ` · ${readLabel}` : ''}
                </div>
              </div>
              <span className="shrink-0 text-[11px] text-ink-faint">{relativeTime(last?.at ?? d.openedAt)}</span>
            </div>
          )
        }}
      />
    </CompositeResourcePage>
  )
}

/** A contribution's own page (`/projects/:id/changes/:cid`) — the PR-page
 *  analog and the work-item page's sibling (form follows function: same role,
 *  same look — header + status + provenance meta, then the timeline with the
 *  conversation folded in, then the composer). The landing act lives HERE, on
 *  the durable surface (the gate and the act are one moment, CW6). */
function ContributionPage({
  project,
  contributionId,
  onBack,
  backTo,
  onOpenSession,
}: {
  project: Project
  contributionId: string
  onBack: () => void
  backTo: NavLocation | null
  onOpenSession: (id: string) => void
}) {
  const contributionsQuery = useContributions(project.id)
  const workItemsQuery = useOpenSubGoals(project.id)
  const list = contributionsQuery.data ?? []
  const workItems = workItemsQuery.data ?? []
  const c = list.find((x) => x.id === contributionId) ?? null
  // Hook order: read before any early return (the missing-contribution page).
  useDelegationRevocationStatus()
  useDelegationPolicyHolds()
  const me = useMe().data
  useContributionLandingStatus()
  useContributionEffectExecutionStatus()
  useContributionCrystallizationStatus()
  useContributionEnvelopeApprovalStatus()
  useContributionEnvelopeProposalStatus()
  useContributionCommentCreationStatus()
  useContributionReviewStatus()
  useContributionReviewRequirementStatus()
  useDelegatedJudgmentStatus()
  useDispatchMutationStatus()
  const localMcpAttempt = useContributionMcpEffectAttempt(project.id, contributionId)
  // The ONE landing ledger: the next-L# preview must span BOTH landing paths
  // (contributions + social proposals — the consolidation), or the label
  // promises a number the server won't assign.
  const proposalLandings = useSocialProposals('project', project.id).data ?? []
  const rel = useRelations()
  const [draft, setDraft] = useState('')
  const [error, setError] = useState<string | null>(null)
  const heldComment = heldContributionCommentIntent(project.id, contributionId)
  const commentHeld = heldComment !== null
  const reviewHeld = isContributionReviewHeld(project.id, contributionId)
  const reviewRequirementHeld = isContributionReviewRequirementHeld(project.id, contributionId)
  const delegatedJudgmentHeld = isDelegatedJudgmentHeld(project.id, contributionId)
  const delegatedJudgmentPending = c?.judgments?.some((run) => run.status === 'pending') === true
  const landingHeld = isContributionLandingHeld(project.id, contributionId)
  const effectExecutionHeld = isContributionEffectExecutionHeld(project.id, contributionId)
  const crystallizationHeld = isContributionCrystallizationHeld(project.id, contributionId)
  const envelopeApprovalHeld = isContributionEnvelopeApprovalHeld(project.id, contributionId)
  const envelopeProposalHeld = isContributionEnvelopeProposalHeld(project.id, contributionId)
  const lifecycleHeld = landingHeld || effectExecutionHeld || crystallizationHeld || envelopeApprovalHeld || envelopeProposalHeld || reviewHeld || reviewRequirementHeld || delegatedJudgmentHeld || delegatedJudgmentPending
  const mcpEffectPending = c?.effects?.some((effect) => effect.status === 'pending') === true ||
    (localMcpAttempt !== null && (localMcpAttempt.state !== 'receipt' || localMcpAttempt.receipt?.status === 'pending'))
  const contributionActionHeld = lifecycleHeld || mcpEffectPending
  useEffect(() => {
    if (!heldComment) return
    setDraft(heldComment.body)
  }, [heldComment])

  if (!c) {
    const unavailable = contributionsQuery.status === 'error'
    return (
      <AtomicResourcePage>
        <div className="mb-4">
          <BackButton to={backTo} onBack={onBack} />
        </div>
        {unavailable ? (
          <InlineOperationStatus tone="alert" message="Couldn’t read this Project’s Contributions. Its absence is not confirmed." action={{ label: 'Retry', onClick: () => invalidate(keys.contributions(project.id)) }} />
        ) : contributionsQuery.status === 'success' ? (
          <PageEmpty>This contribution no longer exists on “{project.name}”.</PageEmpty>
        ) : (
          <p role="status" className="text-[13px] text-ink-faint">Loading this Project’s Contributions…</p>
        )}
      </AtomicResourcePage>
    )
  }

  const heldMcpDraft = c.workItemId ? heldProjectWorkDraftSelection(project.id, c.workItemId) : null

  // CW5 (Phase E): the OFFER mirrors the server's tier gate — the owner may
  // always land; the contributor only when the arithmetic admits it (Tier 0,
  // or Tier 1 with the review covering the latest version). The server
  // enforces on raw tenant ids either way.
  const latestVersion = c.changeset?.length ?? 0
  const linkedWorkItem = c.workItemId !== undefined
  const linkedItem = linkedWorkItem ? workItems.find((item) => item.id === c.workItemId) : undefined
  const linkedItemRead = workItemsQuery.status === 'success' && linkedItem !== undefined
  const contributorMayLand =
    c.mine === true &&
    (c.tier?.level === 0 || (c.tier?.level === 1 && c.reviewedVersion === latestVersion && latestVersion > 0))
  const mayLand = c.status === 'open' && (linkedWorkItem || project.own !== false || contributorMayLand)
  const linkedLandingReason = project.own !== true
    ? 'Only the Project owner can land a linked Contribution and resolve its work item.'
    : workItemsQuery.status === 'error'
      ? 'Couldn’t refresh the linked work item. Retry that read before resolving it.'
      : !linkedItemRead
        ? 'Loading the linked work item before confirming its resolution state.'
    : c.workItemResolution === 'needs-result'
      ? 'A matching successful saved MCP result is required before this work item can be resolved.'
      : c.workItemResolution === 'uncertain'
        ? 'The MCP result is uncertain. Check or resolve its saved receipt before landing.'
        : c.workItemResolution === 'closed'
          ? 'The linked work item is already closed; this Contribution will not resolve it.'
          : c.workItemResolution === 'ready'
            ? 'The matching successful MCP result is saved. Landing resolves this work item.'
            : 'The linked MCP result has not been confirmed as ready.'
  // Offered at Tier 0 AND Tier 1: trust is live arithmetic, so an open Tier-1
  // contribution can drift to Tier 0 as the contributor's other landings
  // accrue — the owner must be able to PIN the review before that happens
  // (review finding, Phase E pass).
  const mayRequire =
    c.status === 'open' && project.own !== false && (c.tier?.level === 0 || c.tier?.level === 1) && c.reviewRequired !== true

  const send = async () => {
    if (commentHeld || !me || !draft.trim()) return
    setError(null)
    try {
      const outcome = await enqueueContributionCommentCreation({
        tenantId: me.tenant.id,
        projectId: project.id,
        contributionId: c.id,
        body: draft,
      })
      if (outcome === 'applied') setDraft('')
      else setError('The comment wasn’t posted. Review it and try again when ready.')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not post this comment.')
    }
  }
  const land = () => {
    if (contributionActionHeld || !me || (linkedWorkItem && (project.own !== true || !linkedItemRead || c.workItemResolution !== 'ready'))) return
    setError(null)
    void enqueueContributionLanding({
      tenantId: me.tenant.id,
      projectId: project.id,
      contributionId: c.id,
    }).then((outcome) => {
      if (outcome === 'discarded') setError('Landing was dismissed. Review the current gate before trying again.')
    })
  }
  const tighten = () => {
    if (contributionActionHeld || !me) return
    setError(null)
    void enqueueContributionReviewRequirement({
      tenantId: me.tenant.id,
      projectId: project.id,
      contributionId: c.id,
    }).then((outcome) => {
      if (outcome === 'discarded') setError('The review requirement was dismissed. Inspect the current gate before trying again.')
    })
  }
  const badge =
    c.status === 'landed' ? (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-ok-solid px-2.5 py-0.5 text-[12px] font-medium text-on-solid">
        <CheckCircle2 size={13} /> Landed · L{c.landingNumber}
      </span>
    ) : (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-warn-solid px-2.5 py-0.5 text-[12px] font-medium text-on-solid">
        <Clock size={13} /> Open
      </span>
    )

  return (
    <AtomicResourcePage>
      <div>
        <header className={PAGE_HEADER_CLASS}>
          <div className="flex min-w-0 items-start gap-3">
            <BackButton to={backTo} onBack={onBack} />
            <div className="min-w-0">
              <h1 className={`${PAGE_TITLE_CLASS} break-words [overflow-wrap:anywhere]`}>{c.title}</h1>
              <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-ink-faint">
                {badge}
                {/* CW5 — the gate as VISIBLE arithmetic: the level and its basis in
                    plain words, never a black box. */}
                {c.status === 'open' && c.tier && (
                  <span
                    className="inline-flex items-center gap-1 rounded-full border border-line px-2 py-0.5 text-[11px] text-ink-soft"
                    title="The landing gate, computed from risk × trust × the owner's tightening"
                  >
                    Tier {c.tier.level} · {c.tier.basis}
                  </span>
                )}
                <span>
                  by <OwnerLink bare ownerName={c.contributor} onClick={() => rel.openOwner(c.contributor)} /> ·{' '}
                  {relativeTime(c.openedAt)}
                </span>
                {c.subGoal && <span>· {c.subGoal}</span>}
                {linkedWorkItem && (
                  <span>
                    · linked work:{' '}
                    <button
                      type="button"
                      onClick={() => rel.navigate('projects', project.id, c.workItemId!)}
                      className={`text-ink-soft ${DOOR_CLASS}`}
                    >
                      {linkedItem?.subGoal ?? 'Open work item'}
                    </button>
                  </span>
                )}
                <span>
                  · in{' '}
                  <button
                    onClick={() => rel.navigate('projects', project.id)}
                    className={`text-ink-soft ${DOOR_CLASS}`}
                  >
                    {project.name}
                  </button>
                </span>
                {/* The trace door — only offered to its owner (sessions are
                    tenant-walled; a door that can never open is worse than none). */}
                {c.sessionId && c.mine === true && (
                  <span>
                    ·{' '}
                    <button onClick={() => onOpenSession(c.sessionId!)} className={`text-ink-soft ${DOOR_CLASS}`}>
                      View the work
                    </button>
                  </span>
                )}
              </div>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            {mayRequire && (
              <button
                onClick={() => tighten()}
                disabled={contributionActionHeld}
                title="Tighten the gate: force adversarial review before this can land (there is no un-require)"
                className="rounded-md border border-line px-2.5 py-1 text-[12px] font-medium text-ink-soft transition hover:border-line-strong hover:text-ink disabled:opacity-45"
              >
                {reviewRequirementHeld ? 'Requiring review…' : 'Require review'}
              </button>
            )}
            {mayLand && (
              <button
                onClick={() => void land()}
                disabled={lifecycleHeld || mcpEffectPending || !me || (linkedWorkItem && (project.own !== true || !linkedItemRead || c.workItemResolution !== 'ready'))}
                title={mcpEffectPending
                  ? 'Resolve the pending MCP receipt before landing this Contribution'
                  : linkedWorkItem
                    ? linkedLandingReason
                    : `Land this contribution — it becomes L${
                    Math.max(
                      list.reduce((m, x) => Math.max(m, x.landingNumber ?? 0), 0),
                      proposalLandings.reduce((m, x) => Math.max(m, x.landingNumber ?? 0), 0),
                    ) + 1
                  } in ${project.name}’s history`}
                className={`${SOFT_BUTTON_CLASS} px-3 py-1 text-[12px] disabled:opacity-45`}
              >
                {landingHeld ? 'Landing…' : linkedWorkItem ? 'Land and resolve work' : 'Land'}
              </button>
            )}
          </div>
        </header>

        {linkedWorkItem && (
          <p data-linked-work-item-resolution className="mb-4 text-[12px] leading-relaxed text-ink-faint">
            {c.workItemResolution === 'closed'
              ? workItemsQuery.status === 'error'
                ? 'Couldn’t refresh the linked work item; its resolution by this Contribution is not confirmed.'
                : workItemsQuery.status !== 'success'
                  ? 'Loading the linked work item’s resolution…'
                  : linkedItem?.contributionResolution?.contributionId === c.id
                ? 'This Contribution landed and resolved the linked work item.'
                : 'The linked work item is already closed; this Contribution did not resolve it.'
              : `Only the Project owner can resolve this work item by landing this Contribution after its MCP effect has a successful saved result matching the exact tool name “${linkedItem?.target ?? 'shown on the work item'}”. ${linkedLandingReason}`}
          </p>
        )}

        {/* The changeset (CW3/CW4, Phase D) — the work's mergeable payload as
            before→after diffs, versioned append-only. */}
        <ChangesetCard project={project} c={c} lifecycleHeld={contributionActionHeld} />

        {/* The effect envelope (CW1, Phase C) — the plan's authorization,
            visually its own block: an external act must never hide inside the
            prose/diff idiom (CW3). */}
        <DeferredContributionEnvelopeCard
          project={project}
          c={c}
          lifecycleHeld={contributionActionHeld}
          me={me}
          heldExecution={heldContributionEffectExecutionIntent(project.id, c.id)}
          heldApproval={heldContributionEnvelopeApprovalIntent(project.id, c.id)}
          heldProposal={heldContributionEnvelopeProposalIntent(project.id, c.id)}
          heldMcpDraft={heldMcpDraft}
          onRun={enqueueContributionEffectExecution}
          onApprove={enqueueContributionEnvelopeApproval}
          onPropose={enqueueContributionEnvelopeProposal}
          onOpenSession={onOpenSession}
        />
        {mcpEffectPending && (
          <p role="status" className="mt-2 rounded-md border border-warn-strong/30 bg-warn-strong/5 px-3 py-2 text-[11px] leading-relaxed text-warn-text">
            An MCP call is still pending or its acknowledgement is unresolved. Check its saved receipt before amending or landing this Contribution.
          </p>
        )}

        <DeferredContributionReviewPanel
          project={project}
          contribution={c}
          latestVersion={latestVersion}
          lifecycleHeld={contributionActionHeld}
        />

        <DeferredDelegatedJudgmentPanel
          project={project}
          contribution={c}
          lifecycleHeld={contributionActionHeld}
        />

        {/* The timeline — lifecycle transitions + the conversation, one record
            in time order (append-only, CW4; it keeps accruing after landing, CW7). */}
        <div className="mt-5 space-y-3 border-l-2 border-line pl-4">
          {c.events.map((ev) =>
            ev.kind === 'opened' ? (
              <div key={ev.id} className="rounded-lg border border-line bg-surface px-3 py-2">
                <div className="text-[12px] text-ink-faint">
                  <OwnerLink bare ownerName={ev.actor} onClick={() => rel.openOwner(ev.actor)} /> opened this
                  {ev.actorKind === 'agent' ? ' (agent)' : ''} · {relativeTime(ev.at)}
                </div>
                <div className="mt-1 whitespace-pre-wrap text-[13px] leading-snug text-ink">
                  {c.summary.trim() ? c.summary : <span className="text-ink-faint">No summary given.</span>}
                </div>
              </div>
            ) : ev.kind === 'note' ? (
              <div key={ev.id} className="rounded-lg border border-line bg-surface px-3 py-2">
                <div className="text-[12px] text-ink-faint">
                  <OwnerLink bare ownerName={ev.actor} onClick={() => rel.openOwner(ev.actor)} />
                  <span> · {relativeTime(ev.at)}</span>
                </div>
                <div className="mt-1 whitespace-pre-wrap text-[13px] leading-snug text-ink-soft">{ev.body}</div>
              </div>
            ) : ev.kind === 'landed' ? (
              <div key={ev.id} className="flex items-center gap-2 py-0.5 text-[12px] text-ink-faint">
                <CheckCircle2 size={14} className="shrink-0 text-ok-strong" />
                <span>
                  landed as <span className="font-semibold text-ink-soft">L{c.landingNumber}</span> by{' '}
                  <OwnerLink bare ownerName={ev.actor} onClick={() => rel.openOwner(ev.actor)} /> · {relativeTime(ev.at)}
                </span>
              </div>
            ) : ev.kind === 'delegated-decision' ? (
              <div key={ev.id} className="flex items-center gap-2 py-0.5 text-[12px] text-ink-faint">
                <CheckCircle2 size={14} className="shrink-0 text-accent" />
                <span>
                  {/* The dual stamp IS the actor (the conservation law) — plain
                      text, never an owner door: it names delegate + human. */}
                  {ev.actor}: {ev.body} · {relativeTime(ev.at)}
                </span>
              </div>
            ) : ev.kind === 'delegated-draft' ? (
              <div key={ev.id} className="flex items-center gap-2 py-0.5 text-[12px] text-ink-faint">
                <Pencil size={14} className="shrink-0 text-ink-faint" />
                <span>
                  {ev.actor} drafted: {ev.body} · {relativeTime(ev.at)}
                </span>
              </div>
            ) : ev.kind === 'delegated-decline' ? (
              <div key={ev.id} className="flex items-center gap-2 py-0.5 text-[12px] text-ink-faint">
                <MinusCircle size={14} className="shrink-0" />
                <span>{ev.actor} declined within policy · {relativeTime(ev.at)}</span>
              </div>
            ) : ev.kind === 'delegated-escalation' ? (
              <div key={ev.id} className="flex items-center gap-2 py-0.5 text-[12px] text-warn-text">
                <AlertCircle size={14} className="shrink-0" />
                <span>
                  {ev.actor}: {ev.body} · {relativeTime(ev.at)}
                </span>
              </div>
            ) : ev.kind === 'review-passed' ? (
              <div key={ev.id} className="flex items-center gap-2 py-0.5 text-[12px] text-ink-faint">
                <CheckCircle2 size={14} className="shrink-0 text-accent" />
                <span>
                  {ev.actor}: {ev.body} · {relativeTime(ev.at)}
                </span>
              </div>
            ) : ev.kind === 'review-required' ? (
              <div key={ev.id} className="flex items-center gap-2 py-0.5 text-[12px] text-ink-faint">
                <AlertCircle size={14} className="shrink-0 text-warn-strong" />
                <span>
                  <OwnerLink bare ownerName={ev.actor} onClick={() => rel.openOwner(ev.actor)} /> tightened the gate —
                  adversarial review required before landing · {relativeTime(ev.at)}
                </span>
              </div>
            ) : ev.kind === 'crystallized' ? (
              <div key={ev.id} className="flex items-center gap-2 py-0.5 text-[12px] text-ink-faint">
                <Pencil size={14} className="shrink-0 text-ink-faint" />
                <span>
                  <OwnerLink bare ownerName={ev.actor} onClick={() => rel.openOwner(ev.actor)} /> crystallized{' '}
                  {ev.body} · {relativeTime(ev.at)}
                </span>
              </div>
            ) : ev.kind === 'envelope-proposed' ? (
              <div key={ev.id} className="flex items-center gap-2 py-0.5 text-[12px] text-ink-faint">
                <AlertCircle size={14} className="shrink-0 text-warn-strong" />
                <span>
                  <OwnerLink bare ownerName={ev.actor} onClick={() => rel.openOwner(ev.actor)} /> proposed the effect
                  envelope {ev.body} · {relativeTime(ev.at)}
                </span>
              </div>
            ) : ev.kind === 'envelope-approved' ? (
              <div key={ev.id} className="flex items-center gap-2 py-0.5 text-[12px] text-ink-faint">
                <CheckCircle2 size={14} className="shrink-0 text-ok-strong" />
                <span>
                  <OwnerLink bare ownerName={ev.actor} onClick={() => rel.openOwner(ev.actor)} /> approved the envelope{' '}
                  {ev.body} · {relativeTime(ev.at)}
                </span>
              </div>
            ) : ev.kind === 'effect-executed' ? (
              <div key={ev.id} className="flex items-center gap-2 py-0.5 text-[12px] text-ink-faint">
                <span className="ml-0.5 h-2 w-2 shrink-0 rounded-full bg-accent" aria-hidden />
                <span>
                  <OwnerLink bare ownerName={ev.actor} onClick={() => rel.openOwner(ev.actor)} /> ran {ev.body} ·{' '}
                  {relativeTime(ev.at)}
                </span>
              </div>
            ) : (
              <div key={ev.id} className="flex items-center gap-2 py-0.5 text-[12px] text-removed">
                <MinusCircle size={14} className="shrink-0" />
                <span>
                  refused: {ev.body} · {relativeTime(ev.at)}
                </span>
              </div>
            ),
          )}
        </div>

        {/* The conversation continues below — after landing too (CW7: the page
            keeps accruing; a landed contribution's story includes its aftermath). */}
        <div
          data-contribution-comment-form
          aria-busy={commentHeld || undefined}
          className="mt-4 flex items-center gap-1.5"
        >
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void send()}
            maxLength={CONTRIBUTION_FIELD_MAX}
            disabled={commentHeld}
            placeholder="Add a comment…"
            aria-label={`Comment on ${c.title}`}
            className="min-w-0 flex-1 rounded-md border border-line bg-surface px-3 py-1.5 text-[13px] text-ink outline-none placeholder:text-ink-faint focus:border-line-strong"
          />
          <button
            onClick={() => void send()}
            disabled={commentHeld || !me || !draft.trim()}
            className={`shrink-0 ${SOFT_BUTTON_CLASS} px-3 py-1.5 text-[13px] disabled:opacity-45`}
          >
            {commentHeld ? 'Posting…' : 'Post'}
          </button>
        </div>
        {error && <p className="mt-1.5 text-[12px] text-removed">{error}</p>}
      </div>
    </AtomicResourcePage>
  )
}

/** The attention panel (CW9, Phase G) — the caller's triaged asks on this
 *  project, each labeled with the approval FUNCTION it serves (Foundations:
 *  liability vs error-catching), plus the acts ledger and the mechanically
 *  self-proposed optimization. Renders nothing when there's nothing to say —
 *  an interrupt must justify itself, and so must a panel. */
function AttentionPanel({ project, standalone = false }: { project: Project; standalone?: boolean }) {
  const rel = useRelations()
  const ledger = useAttention(project.id).data
  if (!ledger)
    return standalone ? (
      <FoldSection title="Attention" summary="Nothing needs you">
        <p className="text-[12px] text-ink-faint">Nothing needs you right now.</p>
      </FoldSection>
    ) : null
  const total = ledger.humanActs + ledger.delegatedActs + ledger.machineActs + ledger.escalations
  if (ledger.asks.length === 0 && !ledger.proposal && total === 0 && !standalone) return null
  const openAsk = (cid: string) => rel.navigate('projects', project.id, `changes/${cid}`)
  return (
    <FoldSection title="Attention" summary={countOr(ledger.asks.length, 'ask', 'asks', 'Nothing needs you')}>
      {ledger.asks.length === 0 ? (
        <p className="text-[12px] text-ink-faint">Nothing needs you right now.</p>
      ) : (
        <CardList>
          {ledger.asks.map((a) => (
            <div key={`${a.contributionId}-${a.label}`} className="flex items-center gap-2.5 py-3">
              <span
                className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                  a.function === 'liability' ? 'bg-warn-strong/10 text-warn-text' : 'border border-line text-ink-faint'
                }`}
                title={
                  a.function === 'liability'
                    ? 'Ownership only a human can take (the Foundations’ liability function)'
                    : 'Error-catching — a machine act could hold this; its presence here is a tuning signal'
                }
              >
                {a.function}
              </span>
              <div className="min-w-0 flex-1">
                <button
                  onClick={() => openAsk(a.contributionId)}
                  className={`block max-w-full truncate text-left text-[13px] text-ink ${DOOR_CLASS}`}
                >
                  {a.title}
                </button>
                <div className="truncate text-[11px] text-ink-faint">{a.label}</div>
              </div>
            </div>
          ))}
        </CardList>
      )}
      {(total > 0 || ledger.proposal) && (
        <div className="mt-2 space-y-1">
          {total > 0 && (
            <p className="text-[11px] tabular-nums text-ink-faint">
              This ledger so far: {ledger.humanActs} human · {ledger.delegatedActs} delegated ·{' '}
              {ledger.machineActs} machine · {ledger.escalations} escalation{ledger.escalations === 1 ? '' : 's'}
            </p>
          )}
          {ledger.proposal && (
            <p className="text-[11px] italic text-ink-soft" title="A mechanical pattern-match over your own acts — never fabricated cognition">
              {ledger.proposal}
            </p>
          )}
        </div>
      )}
    </FoldSection>
  )
}

/** The changeset card (CW3/CW4, Phase D) — the contribution page's payload
 *  block: the LATEST crystallized version's entries, each a real before→after
 *  through the shared TextDiff (a change is a diff, never prose). Versions are
 *  append-only; earlier ones survive as timeline events carrying the review
 *  delta. The composer accumulates entries locally, then crystallizes one
 *  version — revision is a new version, never an edit (no force-push). */
function ChangesetCard({ project, c, lifecycleHeld }: { project: Project; c: Contribution; lifecycleHeld: boolean }) {
  const mayAct = c.mine === true || project.own !== false
  const me = useMe().data
  const versions = c.changeset ?? []
  const latest = versions.at(-1)
  const [composing, setComposing] = useState(false)
  const [kind, setKind] = useState<ChangeEntryKind>('note')
  const [target, setTarget] = useState('')
  const [before, setBefore] = useState('')
  const [after, setAfter] = useState('')
  const [pending, setPending] = useState<{ kind: ChangeEntryKind; target: string; before?: string; after: string }[]>([])
  const [error, setError] = useState<string | null>(null)
  const heldCrystallization = heldContributionCrystallizationIntent(project.id, c.id)
  if (!latest && (c.status !== 'open' || !mayAct)) return null

  const addEntry = () => {
    if (lifecycleHeld || !target.trim() || !after.trim()) return
    setPending((p) => [...p, { kind, target: target.trim(), ...(before.trim() ? { before } : {}), after }])
    setTarget('')
    setBefore('')
    setAfter('')
  }
  // A valid entry still sitting in the fields folds into the crystallize —
  // "Add change" is for accumulating MORE entries, never a required step a
  // first-time author can trip on (review finding: no silently-dropped draft).
  const draftEntry = () =>
    target.trim() && after.trim()
      ? [{ kind, target: target.trim(), ...(before.trim() ? { before } : {}), after }]
      : []
  const crystallize = async () => {
    const entries = [...pending, ...draftEntry()]
    if (lifecycleHeld || entries.length === 0 || !me) return
    setError(null)
    try {
      const outcome = await enqueueContributionCrystallization({
        tenantId: me.tenant.id,
        projectId: project.id,
        contributionId: c.id,
        entries,
      })
      if (outcome === 'applied') {
        setPending([])
        setTarget('')
        setBefore('')
        setAfter('')
        setComposing(false)
      } else {
        setError('Crystallization was dismissed. Your draft is still here for review.')
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not prepare this crystallization for recovery.')
    }
  }

  return (
    <div
      data-contribution-changeset-version={latest?.version ?? 0}
      className="mt-5 rounded-xl border border-line bg-surface"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-3 py-2">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
          Changeset{latest ? ` · v${latest.version}` : ''}
          {latest && (
            <span className="ml-1.5 font-normal normal-case tracking-normal">
              crystallized by {latest.by} · {relativeTime(latest.at)}
            </span>
          )}
        </div>
        {c.status === 'open' && mayAct && (
          <button
            onClick={() => setComposing((v) => !v)}
            disabled={lifecycleHeld}
            className="rounded-md border border-line px-2 py-0.5 text-[11px] font-medium text-ink-soft transition hover:border-line-strong hover:text-ink"
          >
            {heldCrystallization ? 'Crystallizing…' : latest ? 'Revise' : 'Crystallize'}
          </button>
        )}
      </div>
      {latest ? (
        latest.entries.map((e) => (
          <div key={e.id} className="border-b border-line px-3 py-2 last:border-b-0">
            <div className="text-[12px] text-ink-faint">
              <span className="font-medium text-ink-soft">{e.kind}</span> · {e.target}
            </div>
            <TextDiff current={e.before} proposed={e.after} />
          </div>
        ))
      ) : (
        <p className="px-3 py-2 text-[12px] text-ink-faint">
          Nothing crystallized yet. When the work is ready, its changes crystallize here as
          before → after — a change is a diff, never a description of one.
        </p>
      )}
      {versions.length > 1 && (
        <p className="border-t border-line px-3 py-1.5 text-[11px] text-ink-faint">
          {versions.length} versions, append-only — each revision's delta is on the timeline.
        </p>
      )}
      {heldCrystallization ? (
        <div
          data-contribution-crystallization-draft
          aria-busy="true"
          className="space-y-2 border-t border-line px-3 py-2"
        >
          <p className="text-[11px] text-ink-faint">
            Crystallizing {heldCrystallization.entries.length} exact change{heldCrystallization.entries.length === 1 ? '' : 's'} — order is assigned only after acknowledgement.
          </p>
          {heldCrystallization.entries.map((entry, index) => (
            <div key={`${entry.kind}:${entry.target}:${index}`} className="rounded-lg border border-line bg-panel-2 px-2.5 py-2">
              <div className="text-[11px] text-ink-faint">
                <span className="font-medium text-ink-soft">{entry.kind}</span> · {entry.target}
              </div>
              <TextDiff current={entry.before} proposed={entry.after} />
            </div>
          ))}
        </div>
      ) : composing && (
        <div className="space-y-1.5 border-t border-line px-3 py-2">
          {pending.length > 0 && (
            <div className="text-[11px] text-ink-faint">
              Pending v{versions.length + 1}: {pending.map((p, i) => `${p.kind}·${p.target}${i < pending.length - 1 ? ', ' : ''}`)}
            </div>
          )}
          <div className="flex items-center gap-1.5">
            <select
              value={kind}
              onChange={(e) => setKind(e.target.value as ChangeEntryKind)}
              disabled={lifecycleHeld}
              aria-label="Change kind"
              className="rounded-md border border-line bg-surface px-2 py-1 text-[12px] text-ink outline-none focus:border-line-strong"
            >
              {CHANGE_ENTRY_KINDS.map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </select>
            <input
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              disabled={lifecycleHeld}
              placeholder="Target (path / name / surface)…"
              aria-label="Change target"
              className="min-w-0 flex-1 rounded-md border border-line bg-surface px-2 py-1 text-[12px] text-ink outline-none placeholder:text-ink-faint focus:border-line-strong"
            />
          </div>
          <textarea
            value={before}
            onChange={(e) => setBefore(e.target.value)}
            disabled={lifecycleHeld}
            rows={2}
            placeholder="Before (leave empty for a create)…"
            aria-label="Before text"
            className="w-full resize-none rounded-md border border-line bg-surface px-2 py-1 text-[12px] text-ink outline-none placeholder:text-ink-faint focus:border-line-strong"
          />
          <textarea
            value={after}
            onChange={(e) => setAfter(e.target.value)}
            disabled={lifecycleHeld}
            rows={2}
            placeholder="After…"
            aria-label="After text"
            className="w-full resize-none rounded-md border border-line bg-surface px-2 py-1 text-[12px] text-ink outline-none placeholder:text-ink-faint focus:border-line-strong"
          />
          <div className="flex items-center justify-end gap-1.5">
            <button
              onClick={addEntry}
              disabled={lifecycleHeld || !target.trim() || !after.trim()}
              className="rounded-md border border-line px-2.5 py-1 text-[12px] font-medium text-ink-soft transition enabled:hover:border-line-strong enabled:hover:text-ink disabled:opacity-45"
            >
              Add change
            </button>
            <button
              onClick={() => void crystallize()}
              disabled={lifecycleHeld || !me || (pending.length === 0 && !(target.trim() && after.trim()))}
              className={`${SOFT_BUTTON_CLASS} px-2.5 py-1 text-[12px] disabled:opacity-45`}
            >
              Crystallize v{versions.length + 1}
            </button>
          </div>
          {error && <p className="text-[11px] text-removed">{error}</p>}
        </div>
      )}
    </div>
  )
}

/* ─────────────────────────── Artifacts ─────────────────────────── */


/** The Artifacts index. Its kind facet is chosen through the mirrored Filter &
 *  sort control (UI-19/UI-37 — the facet ids ARE the ArtifactKind values), never a second in-page
 *  grammar; the rail preserves the same project section before each artifact.
 *
 *  The open artifact is a PLACE (`/artifacts/:id`): its surface used to be local
 *  state with no address, so it could be reached but never linked, restored, or
 *  highlighted in the rail. It is now the pane's standard detail page, like a
 *  saved context — opened and left through the pane nav bridge, never a popup. */
function ArtifactsSection({
  collectionSectionId,
  artifactId,
  artifactRevision,
  artifactMatch,
  onBack,
  onOpenArtifactTrash,
  backTo,
  onOpenSession,
}: {
  collectionSectionId: string | null
  artifactId: string | null
  artifactRevision: string | null
  artifactMatch: string | null
  onBack: () => void
  onOpenArtifactTrash?: () => void
  backTo: NavLocation | null
  onOpenSession: (id: string) => void
}) {
  const [query, setQuery] = useState('')
  const [creating, setCreating] = useState(() => heldArtifactCreation() !== null)
  const [filter] = useSectionFilter('artifacts')
  const rel = useRelations()
  const artifactsQ = useArtifacts()
  const trashQ = useTrashedArtifacts()
  useArtifactLifecycleStatus()
  const heldDeletionRows = useArtifactPermanentDeletionRows()
  const artifactRelationsQ = useRelationGraph()
  const sourceSchedules = useSchedules().data ?? []
  const library = artifactTrashProjection(rel.allArtifacts(), trashQ.data ?? [], [
    ...heldArtifactLifecycles().map(held => held.artifact),
    ...heldDeletionRows,
  ])
  const artifacts = library.active
  const projects = rel.allProjects()
  const sessions = useSessions().data ?? []

  const needle = query.trim().toLowerCase()
  // The SAME list the rail's artifact children show, through the same function
  // (type facet + order), narrowed by this page's own search.
  const matches = listArtifacts(artifacts, filter).filter(
    (a) =>
      needle === '' ||
      a.name.toLowerCase().includes(needle) ||
      (a.excerpt ?? '').toLowerCase().includes(needle) ||
      a.source.toLowerCase().includes(needle),
  )

  // The grouping is shared with the rail: project section → artifact. The
  // unfiltered registry resolves a selected section even if a transient search
  // currently leaves it empty; the visible list supplies that section's rows.
  const trashMatches = listArtifacts(library.trashed, filter).filter(a => !needle || `${a.name} ${a.excerpt ?? ''} ${a.source}`.toLowerCase().includes(needle))
  const allGroups = artifactCollectionSections(artifacts, projects, rel.artifactProjectId, library.trashed)
  const groups = artifactCollectionSections(matches, projects, rel.artifactProjectId, trashMatches)
  const selectedMeta = collectionSectionId
    ? allGroups.find((group) => group.id === collectionSectionId) ?? null
    : null
  const selectedGroup = selectedMeta
    ? groups.find((group) => group.id === selectedMeta.id) ?? { ...selectedMeta, items: [] }
    : null
  const shownGroups = selectedGroup ? [selectedGroup] : groups

  // An id the registry doesn't know (a stale link, a deleted artifact) degrades
  // to the plain index — the same graceful read every detail page gives.
  const openArtifact = artifactId ? (heldArtifactLifecycle(artifactId)?.artifact ?? heldArtifactPermanentDeletionRow(artifactId) ?? artifacts.find((a) => a.id === artifactId) ?? library.trashed.find(a => a.id === artifactId) ?? null) : null
  const inTrash = openArtifact ? (openArtifact.lifecycleRevision ?? 0) % 2 === 1 : false
  // The open artifact IS this section's detail page now, so it records a view
  // like every other one (only when it actually resolved).
  useRecordView('artifact', !inTrash && !heldArtifactLifecycle(artifactId ?? '') ? openArtifact?.id : undefined)

  // Assign an artifact to a project (or unfile it, projectId null) — re-files via
  // the relation graph, re-grouping the index live for every client. Only
  // acknowledged, server-minted artifacts ever enter this list.
  const assignProject = (artifact: ArtifactItem, projectId: string | null) => {
    const project = projectId ? projects.find((p) => p.id === projectId) : undefined
    rel.applyOp({
      kind: 'refile-artifact',
      artifactId: artifact.id,
      artifactName: artifact.name,
      projectId: project?.id ?? null,
      projectName: project?.name ?? '',
    })
  }

  if (openArtifact) {
    const sourceSessionId = artifactSourceSessionId(openArtifact, sessions, sourceSchedules)
    return (
      <AtomicResourcePage>
        <ArtifactDetailPage
          // Current and exact saved revisions are separate page identities;
          // per-page selection cannot leak across artifacts or revision URLs.
          key={`${openArtifact.id}:${artifactRevision ?? 'current'}:${artifactMatch ?? ''}`}
          artifact={openArtifact}
          addressedRevision={artifactHistoryRevision(artifactRevision)}
          searchTarget={parseArtifactSearchTarget(artifactMatch)}
          onViewCurrent={() => rel.navigate('artifacts', openArtifact.id)}
          inTrash={inTrash}
          filingHeld={rel.mutation.pendingKeys.length > 0}
          projects={projects}
          currentProjectId={rel.artifactProjectId(openArtifact)}
          own={openArtifact.own !== false}
          onAssignProject={openArtifact.own !== false ? (projectId) => assignProject(openArtifact, projectId) : undefined}
          onOpenSource={sourceSessionId ? () => onOpenSession(sourceSessionId) : undefined}
          onBack={onBack}
          onDeleted={onOpenArtifactTrash ?? onBack}
          backTo={backTo}
          Section={FoldSection}
        />
      </AtomicResourcePage>
    )
  }
  if (artifactId) {
    return (
      <UnavailableResourcePage
        title="Artifact"
        state={resolveResourceUnavailable([artifactsQ, artifactRelationsQ, trashQ])}
        message="This artifact isn’t visible from this account (or no longer exists)."
        backTo={backTo ?? { kind: 'section', section: 'artifacts', projectId: null, scheduleId: null }}
        onBack={onBack}
        onRetry={() => retryResourceQueries([keys.artifacts, keys.relations, keys.artifactTrash])}
      />
    )
  }

  const projection = structuralCollectionProjection({
    section: 'artifacts',
    fallbackLabel: 'Artifacts',
    empty: collectionEmptyCopy('artifacts', artifacts.length),
    itemNoun: 'artifact',
    groups: shownGroups.map((group) => ({
      key: group.id,
      label: group.label,
      keepEmpty: selectedGroup?.id === group.id || group.id === ARTIFACT_TRASH_SECTION.id,
      empty: group.id === ARTIFACT_TRASH_SECTION.id ? trashQ.status === 'error' ? 'Couldn’t load Trash.' : trashQ.data === undefined ? 'Loading Trash…' : library.trashed.length ? 'No matching artifacts in Trash.' : 'Trash is empty.' : 'No artifacts in this section.',
      items: collectionProjectionItems(
        group.items,
        (artifact) => artifact.id,
        (artifact) => artifact.name,
      ),
    })),
  })

  return (
    <CompositeResourcePage section="artifacts" sectionPage={selectedGroup !== null}>
      <PageHeader title="Artifacts" subtitle={selectedGroup?.label}>
        <PageActionButton
          icon={<Plus size={15} />}
          onClick={() => setCreating(true)}
          mirrorsRailFor="artifacts"
          onRailInvoke={() => setCreating(true)}
        >
          New artifact
        </PageActionButton>
      </PageHeader>
      <SearchBox value={query} onChange={setQuery} placeholder="Search artifacts…" mirrorsRailFor="artifacts" />
      <CompositePageControls
        section="artifacts"
        filter={<SectionFilterMenu section="artifacts" placement="page" />}
      />
      {trashQ.status === 'error' && <InlineOperationStatus tone="alert" message="Couldn’t refresh Trash. Previously loaded items may be out of date." action={{ label: 'Retry', onClick: () => retryResourceQueries([keys.artifactTrash]) }} />}
      {collectionSectionId === ARTIFACT_TRASH_SECTION.id && <p className="mb-3 text-[12px] text-ink-soft">Artifacts in Trash are hidden from shared readers. Restore an artifact to make it available again with its current sharing settings.</p>}

      <MainCollectionTemplate
        projection={projection}
        renderItem={(item) => (
          <ArtifactPreviewRow
            artifact={item.value}
            source={rel.artifactSourceFor(item.value.id)}
            onOpen={() => rel.navigate('artifacts', item.value.id)}
          />
        )}
      />

      {creating && (
        <NewArtifactDialog
          projects={projects}
          onCreated={(id) => {
            setCreating(false)
            rel.navigate('artifacts', id)
          }}
          onClose={() => setCreating(false)}
        />
      )}
    </CompositeResourcePage>
  )
}

/** One artifact's INDEX preview. Every kind uses this same information shape:
 * identity, synopsis, provenance, and recency. The artifact's kind still has a
 * recognizable icon; it does not redraw the list row into a tiny document,
 * email, image, slide, or sheet. Rich content belongs to the canonical page. */
function ArtifactPreviewRow({
  artifact,
  source,
  onOpen,
}: {
  artifact: ArtifactItem
  source?: string
  onOpen: () => void
}) {
  const Icon = KIND_ICON[artifact.kind]
  const recovery = heldArtifactPermanentDeletionRow(artifact.id) ? 'Permanent deletion awaiting confirmation' : heldArtifactLifecycle(artifact.id) ? 'Waiting for confirmation' : (artifact.lifecycleRevision ?? 0) % 2 === 1 ? 'In Trash' : null
  const preview = recovery ?? (artifact.excerpt?.trim() || 'No preview available.')
  const specificMeta = artifactMetaIsSpecific(artifact.meta, KIND_LABEL[artifact.kind])
  return (
    // The row is the mouse target, its NAME the named keyboard door (UI-17).
    // Nested metadata stays descriptive rather than becoming extra controls.
    <div
      data-artifact-preview-row={artifact.kind}
      onClick={cardDoorClick(onOpen)}
      className={`flex items-start gap-3 py-3 ${ROW_DOOR_CLASS}`}
    >
      <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-panel-2 text-cap-workspace">
        <Icon size={16} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2">
          <button
            onClick={onOpen}
            className={`min-w-0 truncate text-left text-[13px] text-ink ${DOOR_CLASS}`}
          >
            {artifact.name}
          </button>
          <span className="shrink-0 text-[11px] text-ink-faint">{KIND_LABEL[artifact.kind]}</span>
        </div>
        <p
          data-artifact-preview-copy
          className={`mt-1 line-clamp-2 text-[12px] leading-relaxed ${artifact.excerpt?.trim() ? 'text-ink-soft' : 'text-ink-faint'}`}
        >
          {preview}
        </p>
        <div className="mt-1.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[11px] text-ink-faint">
          {specificMeta && <span className="text-ink-soft">{artifact.meta}</span>}
          {specificMeta && <span aria-hidden="true">·</span>}
          <span>{artifact.source === 'Created here' ? artifact.source : `From ${artifact.source}`}</span>
          {source && (
            <>
              <span aria-hidden="true">·</span>
              <span>Context {source}</span>
            </>
          )}
          <span aria-hidden="true">·</span>
          <span>{`Edited ${relativeTime(artifact.editedAt)}`}</span>
        </div>
      </div>
    </div>
  )
}

/* ─────────────────────────── Contexts ─────────────────────────── */

/** The reusable context the account already knows about — connectors and MCP
 *  servers (set up / authenticated once) plus the repos you've attached before.
 *  Manage them here once; any session reuses them from Add-context. Statuses and
 *  removals are interactive (local state), like the Scheduled toggles. */
/** Row icon for a saved context — repo (local vs GitHub), MCP server, or the
 *  service-specific connector mark. Shared by the list row and the detail page. */
function contextIcon(ctx: SavedContext) {
  return ctx.kind === 'repo'
    ? ctx.origin === 'local'
      ? FolderGit2
      : Github
    : ctx.kind === 'mcp'
      ? Server
      : connectorIconFor(ctx.connectorKind)
}

/** Presentation groups only; candidates and setup metadata come from the API. */
const CONTEXT_CATALOG_GROUPS: { kind: SavedContextKind; label: string }[] = [
  { kind: 'connector', label: 'Connectors' },
  { kind: 'mcp', label: 'MCP servers' },
  { kind: 'repo', label: 'Repositories' },
]


/** The header "Add context" button + its popover. Lists everything not yet saved
 *  (grouped by type); adding one drops it from the popover and into the list,
 *  staying open so several can be added in a row. */
function AddContextControl({
  existingIds,
  onAdd,
  pendingLabel,
}: {
  existingIds: Set<string>
  onAdd: (ctx: SavedContext) => void
  pendingLabel: (id: string) => string | null
}) {
  const [open, setOpen] = useState(false)
  const [mcpSetup, setMcpSetup] = useState(false)
  const [localSetup, setLocalSetup] = useState(false)
  const [localGitSetup, setLocalGitSetup] = useState(false)
  const ref = useDismissable<HTMLDivElement>(open, () => setOpen(false))
  const popRef = usePopoverShift<HTMLDivElement>(open)

  const catalog = useContextCatalog(open)
  const groups = CONTEXT_CATALOG_GROUPS.map((g) => ({
    ...g,
    items: (catalog.data?.setups ?? []).filter((c) => c.kind === g.kind && !existingIds.has(c.id)),
  })).filter((g) => g.items.length > 0)

  return (
    <div ref={ref} className="relative">
      <PageActionButton
        icon={<Plus size={15} />}
        onClick={() => setOpen((o) => !o)}
        mirrorsRailFor="contexts"
        onRailInvoke={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        Add context
      </PageActionButton>

      {open && (
        <div
          ref={popRef}
          role="dialog"
          aria-label="Add context"
          className={`absolute right-0 z-30 mt-2 w-[320px] overflow-hidden ${POPOVER_SURFACE}`}
        >
          <div className="max-h-[min(60dvh,420px)] overflow-y-auto p-2">
            {localFoldersAvailable() && <>
              <button type="button" onClick={() => setLocalSetup(value => !value)} aria-expanded={localSetup}
                className="mb-2 flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-[13px] font-medium text-accent-strong hover:bg-panel-2">
                <FolderOpen size={15} />Connect a local folder
              </button>
              {localSetup && <LocalFolderConnect />}
            </>}
            {localGitAvailable() && <>
              <button type="button" onClick={() => setLocalGitSetup(value => !value)} aria-expanded={localGitSetup}
                className="mb-2 flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-[13px] font-medium text-accent-strong hover:bg-panel-2">
                <GitBranch size={15} />Connect a local repository
              </button>
              {localGitSetup && <LocalGitConnect />}
            </>}
            <button type="button" onClick={() => { setOpen(false); setMcpSetup(true) }}
              className="mb-2 flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-[13px] font-medium text-accent-strong hover:bg-panel-2">
              <Server size={15} />Add an MCP server
            </button>
            <ContextCatalogNotice query={catalog} />
            {catalog.data && groups.length === 0 ? (
              <div className="px-2 py-6 text-center text-[12px] text-ink-faint">
                {catalog.data.developmentFixtures ? 'Everything’s set up — nothing new to add.' : 'Add a local folder or an MCP server. Other integrations are not available yet.'}
              </div>
            ) : (
              groups.map((g) => (
                <div key={g.kind} className="pb-1">
                  <p className="px-1.5 pb-1 pt-1 text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
                    {g.label}
                  </p>
                  {g.items.map((c) => (
                    <AddContextRow
                      key={c.id}
                      ctx={c}
                      onAdd={() => onAdd(c)}
                      pendingLabel={pendingLabel(c.id)}
                    />
                  ))}
                </div>
              ))
            )}
          </div>
        </div>
      )}
      {mcpSetup && <DeferredMcpConnectionCreateDialog onClose={() => setMcpSetup(false)} />}
    </div>
  )
}

function AddContextRow({
  ctx,
  onAdd,
  pendingLabel,
}: {
  ctx: SavedContext
  onAdd: () => void
  pendingLabel: string | null
}) {
  const Icon = contextIcon(ctx)
  return (
    <button
      onClick={onAdd}
      disabled={pendingLabel !== null}
      aria-busy={pendingLabel === 'Adding…' || undefined}
      className="group mb-0.5 flex w-full items-center gap-2.5 rounded-lg px-1.5 py-1.5 text-left transition enabled:hover:bg-panel-2 disabled:cursor-wait disabled:opacity-65"
    >
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-panel-2 text-ink-soft">
        <Icon size={15} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-medium text-ink">{ctx.label}</span>
        <span className="block truncate text-[11px] text-ink-faint">
          {ctx.detail}
          {ctx.kind !== 'repo' && ctx.status !== 'connected' ? ' · Needs authentication' : ''}
          {pendingLabel ? ` · ${pendingLabel}` : ''}
        </span>
      </span>
      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md text-ink-faint transition group-enabled:group-hover:bg-accent-solid group-enabled:group-hover:text-on-solid">
        {pendingLabel === 'Adding…' ? <Spinner size={12} /> : <Plus size={14} />}
      </span>
    </button>
  )
}

/** The Contexts list. Its kind facet is one live choice mirrored in rail and
 *  main-page Filter & sort controls (UI-19/UI-37); the named families remain structural page/rail sections rather than
 *  being flattened away. */
function ContextsSection({
  collectionSectionId,
  contextId,
  onBack,
  backTo,
}: {
  collectionSectionId: string | null
  /** The open detail (null = the list) — nav-owned (ADAPT-15: the detail was once
   *  component state with no address; now it's a page at /contexts/:id). */
  contextId: string | null
  onBack: () => void
  backTo: NavLocation | null
}) {
  const rel = useRelations()
  // The base list is server-owned: a connect / disconnect routes through the server,
  // which broadcasts `connector.status`, so the row's auth state reconciles here and
  // on every other client. Until that first answer, the registry stays empty — a
  // bundled demo row is not a truthful substitute for server-owned state.
  const saved = useContextRegistryProjection()
  const localFolders = useLocalFolderConnections()
  const localGit = useLocalGitConnections()
  const items = saved.data?.contexts ?? []
  const me = useMe().data
  const creation = useSavedContextCreationStatus()
  useSavedContextConnectionMutationStatus()
  useSavedContextDeletionStatus()
  const [query, setQuery] = useState('')
  const [removeTarget, setRemoveTarget] = useState<SavedContext | null>(null)
  const [filter] = useSectionFilter('contexts')
  const contextIdRef = useRef(contextId)
  contextIdRef.current = contextId

  // Add / remove / connect all route through the SERVER (the registry is the
  // system of record — these once lived in component state and silently
  // evaporated when the section unmounted). Their existing command path updates
  // the local cache, while the broadcast reconciles every other client.
  const mutationHeld = (id: string) =>
    isSavedContextCreationHeld(id) || isSavedContextConnectionHeld(id) || isSavedContextDeletionHeld(id)
  const toggle = (id: string) => {
    const item = items.find((c) => c.id === id)
    if (item && !mutationHeld(id)) {
      void updateSavedContextConnection(id, item.status === 'connected' ? 'needs-auth' : 'connected')
    }
  }
  const requestRemove = (context: SavedContext) => {
    if (!mutationHeld(context.id)) setRemoveTarget(context)
  }
  const confirmRemove = () => {
    const target = removeTarget
    if (!target) return
    setRemoveTarget(null)
    void enqueueSavedContextDeletion(target.id, target.connectionRevision ?? 0).then((outcome) => {
      // Removal may settle after the person has left this detail. Only the
      // pane that is still showing the removed row should return to its root.
      if (outcome === 'applied' && contextIdRef.current === target.id) onBack()
    })
  }
  const add = (ctx: SavedContext) => {
    if (!me || isSavedContextCreationHeld(ctx.id)) return
    void enqueueSavedContextCreation({ tenantId: me.tenant.id, context: ctx })
  }
  const creationLabel = (id: string): string | null => {
    if (!isSavedContextCreationHeld(id)) return null
    if (creation.activeResourceId !== id) return 'Queued'
    return creation.error ? 'Waiting for Retry' : 'Adding…'
  }
  // Clicking a row drills into the same detail a session shows for that context —
  // through the controller (rel.navigate), so the page has an address and history.
  // A stale id (removed context, dead link) degrades to the list.
  const open = contextId ? (items.find((c) => c.id === contextId) ?? null) : null
  const removalConfirmation = removeTarget ? (
    <ConfirmDialog
      title={`Remove ${removeTarget.label}?`}
      body="This removes the saved setup from Contexts. Existing session attachments stay, but new sessions cannot reuse it until you add it again."
      confirmLabel="Remove"
      onCancel={() => setRemoveTarget(null)}
      onConfirm={confirmRemove}
    />
  ) : null
  if (contextId && isExternalMcpId(contextId)) {
    return <DeferredMcpConnectionDetail key={contextId} id={contextId} onBack={onBack} backTo={backTo} />
  }
  if (contextId && isLocalConnectionId(contextId)) {
    return <LocalFolderDetail key={contextId} id={contextId} onBack={onBack} backTo={backTo} />
  }
  if (contextId && isLocalGitConnectionId(contextId)) {
    return <LocalGitDetail key={contextId} id={contextId} onBack={onBack} backTo={backTo} />
  }
  if (open)
    return (
      <>
        <ContextDetail
          ctx={open}
          onBack={onBack}
          backTo={backTo}
          onToggle={() => toggle(open.id)}
          mutationHeld={mutationHeld(open.id)}
          onRemove={() => requestRemove(open)}
        />
        {removalConfirmation}
      </>
    )
  if (contextId) {
    return (
      <UnavailableResourcePage
        title="Context"
        state={resolveResourceUnavailable([saved])}
        message="This context isn’t available to this account (or no longer exists)."
        backTo={backTo ?? { kind: 'section', section: 'contexts', projectId: null, scheduleId: null }}
        onBack={onBack}
        onRetry={() => retryResourceQueries([keys.savedContexts])}
      />
    )
  }

  const needle = query.trim().toLowerCase()
  // The SAME list the rail's context children show (kind facet + order),
  // narrowed by this page's own search.
  const visible = listContexts(items, filter).filter(
    (c) => needle === '' || c.label.toLowerCase().includes(needle) || c.detail.toLowerCase().includes(needle),
  )
  const allGroups: CollectionSection<SavedContext | LocalFolderContextRow | LocalGitContextRow>[] = [
    ...contextCollectionSections(visible),
    ...(localFolders.available ? [localFolderCollectionSection(localFolders.rows, filter, query)] : []),
    ...(localGit.available ? [localGitCollectionSection(localGit.rows, filter, query)] : []),
  ]
  const groups = allGroups.filter((group) => group.items.length > 0 || group.id === LOCAL_FOLDERS_SECTION.id || group.id === LOCAL_GIT_SECTION.id)
  const selectedLabel = collectionSectionId
    ? collectionSectionLabel('contexts', collectionSectionId)
    : undefined
  const selectedResourceGroup = collectionSectionId
    ? allGroups.find((group) => group.id === collectionSectionId) ?? null
    : null
  const accountMcpSelected = collectionSectionId === ACCOUNT_MCP_SECTION.id
  const sectionSelected = selectedLabel !== undefined
  const accountMcpGroup = {
    ...ACCOUNT_MCP_SECTION,
    summary: 'MCP endpoint, toolset, and access tokens',
    items: [] as SavedContext[],
  }
  const shownGroups = selectedResourceGroup
    ? [selectedResourceGroup]
    : accountMcpSelected
      ? [accountMcpGroup]
      : [...groups, accountMcpGroup]
  const projection = structuralCollectionProjection<SavedContext | LocalFolderContextRow | LocalGitContextRow>({
    section: 'contexts',
    fallbackLabel: 'Contexts',
    empty: 'No contexts match.',
    itemNoun: 'context',
    groups: shownGroups.map((group) => ({
      key: group.id,
      label: group.label,
      summary: group.id === ACCOUNT_MCP_SECTION.id ? accountMcpGroup.summary : undefined,
      keepEmpty: selectedResourceGroup?.id === group.id || group.id === ACCOUNT_MCP_SECTION.id || group.id === LOCAL_FOLDERS_SECTION.id || group.id === LOCAL_GIT_SECTION.id,
      empty: 'No contexts in this section.',
      items: collectionProjectionItems<SavedContext | LocalFolderContextRow | LocalGitContextRow>(
        group.items,
        (context) => context.id,
        (context) => context.label,
      ),
    })),
  })

  return (
    <>
      <CompositeResourcePage section="contexts" sectionPage={sectionSelected}>
        <PageHeader
          title="Contexts"
          subtitle={selectedLabel ?? (
            <>
              Manage saved contexts and inspect external MCP servers. Inspect a server, attach its admitted tools to a conversation, then approve each call before it runs.
            </>
          )}
        >
          <AddContextControl
            existingIds={new Set(items.map((c) => c.id))}
            onAdd={add}
            pendingLabel={creationLabel}
          />
        </PageHeader>
        <SearchBox value={query} onChange={setQuery} placeholder="Search contexts…" mirrorsRailFor="contexts" />
        <CompositePageControls
          section="contexts"
          filter={<SectionFilterMenu section="contexts" placement="page" />}
        />
        {localFolders.available && <LocalFolderStatus />}
        {localGit.available && <LocalGitStatus />}

        <MainCollectionTemplate
          projection={projection}
          renderItem={(item) => item.value.kind === 'local-folder'
            ? <LocalFolderRow connection={item.value} onOpen={() => rel.navigate('contexts', item.value.id)} /> : item.value.kind === 'local-git'
              ? <LocalGitRow connection={item.value} onOpen={() => rel.navigate('contexts', item.value.id)} /> : (
            <ContextRow
              ctx={item.value}
              onOpen={() => rel.navigate('contexts', item.value.id)}
              onToggle={() => toggle(item.value.id)}
              mutationHeld={mutationHeld(item.value.id)}
              onRemove={() => { if (item.value.kind !== 'local-folder' && item.value.kind !== 'local-git') requestRemove(item.value) }}
            />
          )}
          renderEmptyGroup={(group) =>
            group.key === ACCOUNT_MCP_SECTION.id ? <McpAccessCard />
              : group.key === LOCAL_FOLDERS_SECTION.id && localFolders.status === 'ready' ? <p className="py-2 text-[12px] text-ink-soft">{localFolders.rows.length ? 'No local folders match this filter.' : 'Use Add context → Connect a local folder. Connections belong to this account on this device; saved conversation copies are separate.'}</p>
                : group.key === LOCAL_GIT_SECTION.id && localGit.status === 'ready' ? <p className="py-2 text-[12px] text-ink-soft">{localGit.rows.length ? 'No local repositories match this filter.' : 'Use Add context → Connect a local repository. Connections belong to this account on this device; saved snapshots are separate.'}</p> : undefined
          }
        />
      </CompositeResourcePage>
      {removalConfirmation}
    </>
  )
}

/** The other direction of the Contexts page (access-parity INV-11): the rows
 *  above are what THIS account connects to; this card is how other agents
 *  connect to IT. Hosted accounts mint a one-time-reveal credential; the
 *  desktop's device-local principal needs none because non-browser callers
 *  reach the origin-pinned loopback service directly. */
function McpAccessCard() {
  const me = useMe()
  const signedIn = me.data?.via === 'session'
  const localDesktop = me.data?.local === true && me.data.via === 'default'
  const identityKey = me.data
    ? `${me.data.user.id}:${me.data.tenant.id}:${me.data.via ?? 'unsigned'}`
    : null
  const tokens = useApiTokens(signedIn)
  const tokenMint = useApiTokenMintStatus()
  const tokenRevocation = useApiTokenRevocationStatus()
  const [label, setLabel] = useState('')
  const [core, setCore] = useState(true)
  const [mintRecoveryIdentity, setMintRecoveryIdentity] = useState<string | null>(null)
  const mintRecoveryChecked = mintRecoveryIdentity === identityKey
  const mintHeld = heldApiTokenMint(identityKey)
  const visibleMinted = apiTokenMintReveal(identityKey)?.session ?? null
  // The controller owns the sensitive reveal and frozen request across page
  // navigation. Component-local state is only an unsubmitted label draft.
  useEffect(() => {
    setLabel('')
    if (identityKey) resumeApiTokenMint(identityKey)
    setMintRecoveryIdentity(identityKey)
  }, [identityKey])
  // The externally dialable endpoint, derived from API_BASE like the relay
  // panel's URLs — right in EVERY deploy shape (dev's Vite proxy forwards
  // /api, not the root `/mcp` alias, so the base-path form is the one that
  // always answers; production serves both).
  const baseUrl = `${new URL(API_BASE, window.location.origin).href.replace(/\/$/, '')}/mcp`
  // `?toolset=core` narrows tools/list to the everyday subset — a PRESENTATION
  // choice for the connecting client (a model's tool context stays small);
  // every operation stays callable by name on either URL (INV-11).
  const mcpUrl = core ? `${baseUrl}?toolset=core` : baseUrl
  const mint = () => {
    if (!identityKey || mintHeld) return
    const frozenLabel = label.trim() || undefined
    void enqueueApiTokenMint({ identityKey, label: frozenLabel }).then((outcome) => {
      if (outcome === 'applied') setLabel('')
    })
  }
  // Ready-to-paste client wiring (the generic `mcpServers` shape MCP clients
  // share — deliberately no harness-specific install recipe: that design
  // lesson is locked by server/routes/connector-serve.test.ts). Computed for the COPY
  // ACTION only, never rendered — the credential shows in exactly one place.
  const jsonConfig = visibleMinted
    ? JSON.stringify({ mcpServers: { workspace: { type: 'http', url: mcpUrl, headers: { Authorization: `Bearer ${visibleMinted.token}` } } } }, null, 2)
    : null
  const localJsonConfig = JSON.stringify({ mcpServers: { workspace: { type: 'http', url: mcpUrl } } }, null, 2)
  // A refetch may observe committed absence while the originating response is
  // still uncertain. Merge the eager snapshots back for presentation only;
  // the API cache remains a projection of server truth.
  const tokenRows: ApiToken[] = [
    ...(tokens.data ?? []),
    ...heldApiTokenRevocations().filter((held) =>
      !(tokens.data ?? []).some((token) => token.id === held.id)),
  ]
  return (
    <div className="space-y-3 py-3.5 text-[13px] leading-relaxed text-ink-soft">
        {localDesktop ? (
          <p>
            Any device-local MCP client — another Claude, an agent, a script — can drive everything
            this UI can through the loopback endpoint. No access token is required; browser requests
            remain pinned to this desktop app's exact origin.
          </p>
        ) : (
          <p>
            Any MCP client — another Claude, an agent, a script — can drive everything this UI can:
            same account, same walls, by construction. Point it at the endpoint and authenticate with
            a minted token.
          </p>
        )}
        <div className="flex items-center gap-2">
          <span className="min-w-0 flex-1 truncate rounded-lg bg-panel-2/50 px-2.5 py-1.5 font-mono text-[12px] text-ink">{mcpUrl}</span>
          <CopyButton text={mcpUrl} ariaLabel="Copy the MCP endpoint URL" />
        </div>
        <CheckboxRow checked={core} onToggle={() => setCore(!core)} className="text-[12px]">
          <span>
            <span className="font-medium text-ink">Core toolset</span> — list only the everyday tools (sessions, messages,
            projects, schedules…), so an AI client's tool context stays small. Every operation remains callable either way.
          </span>
        </CheckboxRow>
        {localDesktop ? (
          <div className="flex items-center gap-2 text-[11px] text-ink-faint">
            <CopyButton
              text={localJsonConfig}
              label="Copy client config"
              ariaLabel="Copy the device-local MCP client JSON config"
            />
            <span>
              the <span className="font-mono">mcpServers</span> JSON block most MCP clients accept — loopback endpoint wired in, no credential to store.
            </span>
          </div>
        ) : visibleMinted ? (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate rounded-lg bg-panel-2/50 px-2.5 py-1.5 font-mono text-[12px] text-ink">{visibleMinted.token}</span>
              <CopyButton text={visibleMinted.token} label="Copy token" ariaLabel="Copy the access token" />
            </div>
            <p className="text-[11px] text-ink-faint">
              Shown once — send it as <span className="font-mono">Authorization: Bearer …</span>. It authenticates as you; treat it
              like your password. You can revoke it below at any time.
            </p>
            {jsonConfig && (
              <div className="flex items-center gap-2 text-[11px] text-ink-faint">
                <CopyButton text={jsonConfig} label="Copy client config" ariaLabel="Copy the MCP client JSON config (endpoint + token)" />
                <span>
                  the <span className="font-mono">mcpServers</span> JSON block most MCP clients accept — endpoint and token wired in.
                </span>
              </div>
            )}
          </div>
        ) : (
          <div className="flex flex-wrap items-end gap-2.5">
            <div className="min-w-0 flex-1 basis-56">
              <FormField label="Token label" optional>
                <input
                  type="text"
                  value={mintHeld?.label ?? label}
                  onChange={(e) => setLabel(e.target.value)}
                  placeholder="e.g. laptop MCP"
                  maxLength={80}
                  disabled={!signedIn || !!mintHeld || !mintRecoveryChecked}
                  className={FORM_INPUT_CLASS}
                />
              </FormField>
            </div>
            <button
              onClick={mint}
              disabled={!!mintHeld || !signedIn || !mintRecoveryChecked}
              className={`flex items-center gap-1.5 ${SOFT_BUTTON_CLASS} px-3 py-1.5 text-[12px] disabled:opacity-50`}
            >
              <KeyRound size={13} />
              {mintHeld ? 'Securing token…' : 'Mint access token'}
            </button>
            {!signedIn && <span className="text-[11px] text-ink-faint">Sign in to mint — a token is minted from a verified session.</span>}
            {mintHeld && tokenMint.error && <span className="text-[11px] text-danger-strong">{tokenMint.error}</span>}
          </div>
        )}
        {signedIn && tokenRows.length > 0 && (
          <div className="space-y-1 border-t border-line pt-2.5">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-ink-faint">Active tokens</div>
            {tokenRows.map((t) => {
              const tokenName = t.label ?? 'Unlabeled token'
              const revoking = isApiTokenRevocationHeld(t.id)
              const active = tokenRevocation.activeResourceId === t.id
              const failed = active && tokenRevocation.error !== null
              return (
                <div
                  key={t.id}
                  data-api-token-id={t.id}
                  data-api-token-revocation={failed ? 'failed' : revoking ? 'pending' : undefined}
                  aria-busy={revoking || undefined}
                  className="flex items-center gap-2 text-[12px]"
                >
                  <KeyRound size={12} className="shrink-0 text-ink-faint" />
                  <span className="min-w-0 flex-1 truncate text-ink">
                    {tokenName}
                    <span className="text-ink-faint"> · minted {new Date(t.createdAt).toLocaleDateString()}</span>
                    {visibleMinted?.tokenId === t.id && <span className="text-ok-strong"> · just minted</span>}
                    {failed && <span className="text-danger-strong"> · revocation needs attention</span>}
                  </span>
                  <button
                    onClick={() => {
                      if (revoking) return
                      void enqueueApiTokenRevocation(t).then((outcome) => {
                        if (outcome !== 'applied') return
                        // A reveal remains copyable until exact server truth
                        // proves its registry row gone, then retires with it.
                        clearApiTokenMintReveal(t.id)
                      })
                    }}
                    disabled={revoking}
                    aria-label={
                      failed
                        ? `Revocation needs attention for ${tokenName}`
                        : revoking
                          ? `${active ? 'Revoking' : 'Queued to revoke'} ${tokenName}`
                          : `Revoke ${tokenName}`
                    }
                    className="flex items-center gap-1 rounded-lg px-2 py-0.5 text-[11px] font-medium text-ink-faint transition hover:bg-danger-tint hover:text-danger-strong disabled:opacity-60"
                  >
                    {failed ? <AlertCircle size={11} /> : revoking ? <Spinner size={11} /> : null}
                    {failed ? 'Needs attention' : revoking ? (active ? 'Revoking…' : 'Queued…') : 'Revoke'}
                  </button>
                </div>
              )
            })}
            <p className="text-[11px] text-ink-faint">
              Revoking kills the credential immediately — the registry, not the signature, is what keeps a token alive.
            </p>
          </div>
        )}
    </div>
  )
}

function ContextRow({
  ctx,
  onOpen,
  onToggle,
  mutationHeld,
  onRemove,
}: {
  ctx: SavedContext
  onOpen: () => void
  onToggle: () => void
  mutationHeld: boolean
  onRemove: () => void
}) {
  const Icon = contextIcon(ctx)
  const connected = ctx.status === 'connected'

  return (
    // The row is a @container: its metadata is gated on the row's OWN width,
    // not the viewport (UI-9, docs/ui-invariants.md) — in a ~380px split pane
    // on a wide window the viewport is `sm:` but the row can't afford what
    // `sm:` promises. Fixed-width blocks yield in order (sessions/last-used
    // meta, then the pill) so the flex-1 identity column — the connector's
    // name — never collapses. Dividers come from the ledger container's
    // divide-y (lib/ledger), so the row no longer draws its own.
    <div
      onClick={cardDoorClick(onOpen)}
      className={`group @container flex items-center gap-3 ${ROW_DOOR_CLASS}`}
    >
      {/* The WHOLE row drills into the detail (UI-17) — the hover wash has always
          lit the whole row, but only this left region used to be a button, so the
          gap beside the status pill swallowed the click. The trailing controls
          keep their own handlers; the card door steps aside for them. */}
      <div className="flex min-w-0 flex-1 items-center gap-3 py-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-panel-2 text-ink-soft">
          <Icon size={16} />
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <button
              onClick={onOpen}
              className={`min-w-0 truncate text-left text-[13px] text-ink hover:text-co ${DOOR_CLASS}`}
            >
              {ctx.label}
            </button>
            {ctx.kind === 'repo' && (
              <span className="shrink-0 rounded bg-panel-2 px-1.5 py-0.5 text-[10px] font-medium text-ink-soft">
                {ctx.origin === 'local' ? 'Local' : 'GitHub'}
              </span>
            )}
          </div>
          <div className="truncate text-[12px] text-ink-faint">{ctx.detail}</div>
        </div>

        <div className="hidden shrink-0 pr-1 text-right @2xl:block">
          <div className="text-[12px] text-ink-soft">
            {ctx.sessions} session{ctx.sessions === 1 ? '' : 's'}
          </div>
          <div className="text-[11px] text-ink-faint">
            {ctx.lastUsedAt == null ? 'Never used' : `Last used ${relativeTime(ctx.lastUsedAt)}`}
          </div>
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-2">
        {/* In a tight row the pill yields its width to the name column — the
            detail view (and the connect/disconnect control itself) carries the
            status. */}
        <span className="hidden @sm:block">
          {ctx.kind === 'repo' ? (
            <StatusPill tone="neutral" label={ctx.dependsOnGitHub ? 'via GitHub' : 'Local only'} />
          ) : (
            <StatusPill tone={isExternalMcpId(ctx.id) ? 'neutral' : connected ? 'ok' : 'warn'}
              label={isExternalMcpId(ctx.id) ? connected ? 'Inspected' : 'Inactive' : connected ? 'Connected' : 'Needs auth'} />
          )}
        </span>

        {/* Hover-revealed actions — same idiom as the panel's per-folder delete. */}
        {!isExternalMcpId(ctx.id) && <div className={`flex items-center gap-1 focus-within:opacity-100 ${HOVER_REVEAL}`}>
          {ctx.kind !== 'repo' && (
            <Tooltip label={connected ? 'Disconnect' : 'Connect'}>
              <button
                onClick={onToggle}
                disabled={mutationHeld}
                aria-label={connected ? `Disconnect ${ctx.label}` : `Connect ${ctx.label}`}
                className="flex h-7 w-7 items-center justify-center rounded-md text-ink-faint transition hover:bg-panel-2 hover:text-ink disabled:cursor-wait disabled:opacity-50"
              >
                {connected ? <Unplug size={14} /> : <Plug size={14} />}
              </button>
            </Tooltip>
          )}
          <button
            onClick={onRemove}
            disabled={mutationHeld}
            title="Remove from contexts"
            aria-label={`Remove ${ctx.label} from contexts`}
            className="flex h-7 w-7 items-center justify-center rounded-md text-ink-faint transition hover:bg-removed-bg hover:text-removed disabled:cursor-wait disabled:opacity-50"
          >
            <Trash2 size={14} />
          </button>
        </div>}
      </div>
    </div>
  )
}

/** Drill-down for one saved context — the same detail a session shows when you
 *  click its chip. Connectors / MCP servers reuse the live sidebar's body
 *  (ConnectorDetailBody); repos get an equivalent summary of where they live and
 *  what attaching one grants. */
function ContextDetail({
  ctx,
  onBack,
  backTo,
  onToggle,
  mutationHeld,
  onRemove,
}: {
  ctx: SavedContext
  onBack: () => void
  backTo: NavLocation | null
  onToggle: () => void
  mutationHeld: boolean
  onRemove: () => void
}) {
  useRecordView('context', ctx.id)
  const Icon = contextIcon(ctx)
  const isRepo = ctx.kind === 'repo'
  const connected = ctx.status === 'connected'
  const asConnector: Connector = {
    id: ctx.id,
    label: ctx.label,
    kind: ctx.kind === 'mcp' ? 'mcp' : ctx.connectorKind,
  }

  return (
    <AtomicResourcePage>
      <header className={PAGE_HEADER_CLASS}>
        <div className="flex min-w-0 items-start gap-3">
          {/* Back follows real history (the detail is now addressable, ADAPT-15 — a
              chip door can arrive from a project page or a contributor row, not just
              the Contexts list); the structural fallback is that list. */}
          <BackButton
            to={backTo ?? { kind: 'section', section: 'contexts', projectId: null, scheduleId: null }}
            onBack={onBack}
          />
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-panel-2 text-ink-soft">
            <Icon size={20} />
          </span>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h1 {...identityTitleProps(ctx.label)} className={`${PAGE_TITLE_CLASS} truncate`}>{ctx.label}</h1>
              {isRepo && (
                <span className="shrink-0 rounded bg-panel-2 px-1.5 py-0.5 text-[10px] font-medium text-ink-soft">
                  {ctx.origin === 'local' ? 'Local' : 'GitHub'}
                </span>
              )}
            </div>
            <p className="mt-0.5 truncate text-[13px] text-ink-soft">{ctx.detail}</p>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {!isRepo && (
            <button
              onClick={onToggle}
              disabled={mutationHeld}
              className="flex items-center gap-1.5 rounded-md border border-line-strong bg-surface px-3 py-1.5 text-[13px] font-medium text-ink transition hover:border-accent disabled:cursor-wait disabled:opacity-50"
            >
              {connected ? <Unplug size={14} /> : <Plug size={14} />}
              {connected ? 'Disconnect' : 'Connect'}
            </button>
          )}
          <button
            onClick={onRemove}
            disabled={mutationHeld}
            className="flex items-center gap-1.5 rounded-md border border-line px-3 py-1.5 text-[13px] font-medium text-ink-soft transition hover:border-removed hover:bg-removed-bg hover:text-removed disabled:cursor-wait disabled:opacity-50"
          >
            <Trash2 size={14} />
            Remove
          </button>
        </div>
      </header>

      <div>
        <FoldSection title="Details" summary={connected ? 'Connected' : 'Needs authentication'}>
          {isRepo ? (
            <RepoDetailBody ctx={ctx} />
          ) : (
            <ConnectorDetailBody connector={asConnector} connected={connected} />
          )}
        </FoldSection>

        <FoldSection
          title="Usage"
          summary={`${countLabel(ctx.sessions, 'session')} · ${ctx.lastUsedAt == null ? 'never used' : relativeTime(ctx.lastUsedAt)}`}
        >
          <div className="space-y-2 text-[13px] text-ink">
            <div className="flex items-center justify-between">
              <span className="text-ink-soft">Sessions</span>
              <span className="font-medium">{ctx.sessions}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-ink-soft">Last used</span>
              <span className="font-medium">{ctx.lastUsedAt == null ? 'Never' : relativeTime(ctx.lastUsedAt)}</span>
            </div>
          </div>
        </FoldSection>

        {isRepo && ctx.dependsOnGitHub && (
          <FoldSection title="Depends on" summary="GitHub connector">
            <div className="flex items-center gap-2 text-[13px] text-ink">
              <Github size={15} className="shrink-0 text-ink-soft" />
              GitHub connector
            </div>
            <p className="mt-1.5 text-[12px] leading-relaxed text-ink-faint">
              Sessions that attach this repo reuse the GitHub connector — no re-cloning.
            </p>
          </FoldSection>
        )}
      </div>
    </AtomicResourcePage>
  )
}

/** The repo equivalent of ConnectorDetailBody — status, a one-line blurb, where
 *  the repo lives, and what attaching it grants. Mirrors the connector body's
 *  visual language so both detail pages read the same. */
function RepoDetailBody({ ctx }: { ctx: SavedContext }) {
  const local = ctx.origin === 'local'
  // The saved row's detail is "<path|origin> · <branch>[ · local only]"; the
  // branch is the middle segment.
  const branch = ctx.detail.split('·')[1]?.trim() ?? 'main'
  const location = local
    ? ctx.detail.split('·')[0]?.trim() ?? ctx.label
    : ctx.label

  const grants = [
    'Read & edit files in the working tree',
    'Run commands and inspect diffs in a session',
    local ? 'Stays on your machine — nothing re-cloned' : 'Cloned on attach from GitHub',
  ]

  return (
    <>
      <div className="flex items-center gap-1.5 text-[12px] font-medium text-ok-text">
        <span className="h-2 w-2 rounded-full bg-ok" />
        Connected
      </div>

      <p className="mt-2 text-[13px] leading-relaxed text-ink-soft">
        {local
          ? 'A local repository you’ve worked in before — attach it to any session without re-cloning.'
          : 'A GitHub repository — attach it to any session and it’s cloned for you.'}
      </p>

      <div className="mt-4 text-[11px] font-semibold uppercase tracking-wide text-ink-faint">Location</div>
      <div className="mt-1.5 space-y-1.5">
        <div className="flex items-center gap-2 text-[13px] text-ink">
          {local ? (
            <FolderGit2 size={14} className="shrink-0 text-cap-repo" />
          ) : (
            <Github size={14} className="shrink-0 text-cap-repo" />
          )}
          <span className="min-w-0 truncate">{location}</span>
        </div>
        <div className="flex items-center gap-2 text-[13px] text-ink">
          <GitBranch size={14} className="shrink-0 text-cap-repo" />
          <span className="min-w-0 truncate font-mono text-[12px]">{branch}</span>
        </div>
      </div>

      <div className="mt-4 text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
        What it grants
      </div>
      <div className="mt-1.5 space-y-1.5">
        {grants.map((g, i) => (
          <div key={i} className="flex items-center gap-2 text-[13px] text-ink">
            <Check size={14} className="shrink-0 text-cap-repo" />
            {g}
          </div>
        ))}
      </div>
    </>
  )
}

function StatusPill({ tone, label }: { tone: 'ok' | 'warn' | 'bad' | 'neutral'; label: string }) {
  const dot =
    tone === 'ok'
      ? 'bg-ok'
      : tone === 'warn'
        ? 'bg-warn'
        : tone === 'bad'
          ? 'bg-danger'
          : 'bg-line-strong'
  return (
    <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-line px-2 py-0.5 text-[11px] font-medium text-ink-soft">
      <span className={`h-1.5 w-1.5 rounded-full ${dot}`} />
      {label}
    </span>
  )
}

/* ───────────────────── Generic (scheduled / dispatch / customize) ───────────────────── */

/* ─────────────────────────── Agents (Agent Commons) ─────────────────────────── */

/** Agents is a composite resource, not a disguised default tab. Its rail and
 *  root page project the same `AGENT_SECTIONS` tree; every structural node has
 *  a page, and every runtime agent/prompt/tool leaf has a canonical detail. */
function AgentCommonsSection({
  agentId,
  promptId,
  toolId,
  subview,
  onOpenSubview,
  onOpenProposal,
  onOpenAgentPage,
  onBack,
  backTo,
}: {
  agentId: string | null
  promptId: string | null
  toolId: string | null
  subview: string | null
  onOpenSubview: (id: string | null) => void
  /** Open a change proposal on its review surface (the same door the bell uses). */
  onOpenProposal: (agentId: string, proposalId: string, ownerName: string | null) => void
  onOpenAgentPage: (agentId: string) => void
  onBack: () => void
  backTo: NavLocation | null
}) {
  const promptIdRef = useRef(promptId)
  promptIdRef.current = promptId
  const promptsQ = useSystemPrompts()
  const toolsQ = useAgentToolCatalog()
  const currentPrompts = promptsQ.data ?? []
  useSystemPromptDeletionStatus()
  const prompts = [
    ...currentPrompts,
    ...heldSystemPromptDeletions().filter((held) =>
      !currentPrompts.some((prompt) => prompt.id === held.id)),
  ]
  const tools = toolsQ.data?.entries ?? []
  const prompt = promptId ? prompts.find((entry) => entry.id === promptId) ?? null : null
  const tool = toolId ? tools.find((entry) => entry.name === toolId) ?? null : null
  const [creating, setCreating] = useState<'agent' | 'prompt' | null>(null)
  useEffect(() => setCreating(null), [subview, agentId, promptId, toolId])

  if (agentId) {
    return <AgentPublicPage agentId={agentId} onOpenAgent={onOpenAgentPage} onBack={onBack} backTo={backTo} />
  }
  if (promptId) {
    return (
      <PromptDetailPage
        prompt={prompt}
        state={resolveResourceUnavailable([promptsQ])}
        onBack={onBack}
        backTo={backTo}
        onRetry={() => retryResourceQueries([keys.systemPrompts])}
        onDeleted={() => {
          if (promptIdRef.current === promptId) onBack()
        }}
      />
    )
  }
  if (toolId) {
    return (
      <ToolDetailPage
        tool={tool}
        toolId={toolId}
        state={resolveResourceUnavailable([toolsQ])}
        onBack={onBack}
        backTo={backTo}
        onRetry={() => retryResourceQueries([keys.agentTools])}
      />
    )
  }

  const top = agentSection(subview)
  const parent = agentSectionForSubview(subview)
  const surfaceTitle = subview
    ? (SECTION_SUBVIEWS.agents ?? []).find((surface) => surface.id === subview)?.label ?? 'Agents'
    : 'Agents'
  const surfaceSummary = top?.summary
    ?? parent?.children.find((child) => child.id === subview)?.summary
    ?? 'Build reusable agents from prompts and tools, then commission or publish them.'
  const canCreateAgent = subview === null || subview === 'ready-agents'
  const canCreatePrompt = subview === 'building-blocks' || subview === 'prompts'

  return (
    <CompositeResourcePage section="agents">
      <PageHeader
        title={surfaceTitle}
        subtitle={surfaceSummary}
      >
        {canCreateAgent && (
          <PageActionButton
            icon={<Plus size={15} />}
            onClick={() => setCreating('agent')}
            mirrorsRailFor="agents"
            onRailInvoke={() => setCreating('agent')}
          >
            New agent
          </PageActionButton>
        )}
        {canCreatePrompt && (
          <PageActionButton
            icon={<Plus size={15} />}
            onClick={() => setCreating('prompt')}
            mirrorsRailFor="agents"
            onRailInvoke={() => setCreating('prompt')}
          >
            New prompt
          </PageActionButton>
        )}
      </PageHeader>
      <CompositePageControls section="agents" />
      {subview === null ? (
        AGENT_SECTIONS.map((section) => {
          const action = (
            <SectionAction
              label={`Open ${section.label} page`}
              icon={<ExternalLink size={14} />}
              onClick={() => onOpenSubview(section.id)}
            />
          )
          const body = (
            <AgentOverviewSection
              section={section.id}
              onOpenSubview={onOpenSubview}
              onOpenAgentPage={onOpenAgentPage}
              onOpenProposal={onOpenProposal}
            />
          )
          return section.id === 'building-blocks' ? (
            <FoldSection key={section.id} title="Building blocks" summary={section.summary} defaultFolded persist={false} actions={action}>
              {body}
            </FoldSection>
          ) : (
            <FoldSection key={section.id} title={section.label} summary={section.summary} persist={false} actions={action}>
              {body}
            </FoldSection>
          )
        })
      ) : (
        <AgentSubviewPage
          subview={subview}
          onOpenSubview={onOpenSubview}
          onOpenAgentPage={onOpenAgentPage}
          onOpenProposal={onOpenProposal}
        />
      )}
      {creating === 'agent' && <AgentDialog agent={null} onClose={() => setCreating(null)} />}
      {creating === 'prompt' && <PromptDialog prompt={null} onClose={() => setCreating(null)} />}
    </CompositeResourcePage>
  )
}

function AgentOverviewSection({
  section,
  onOpenSubview,
  onOpenAgentPage,
  onOpenProposal,
}: {
  section: AgentSectionId
  onOpenSubview: (id: string | null) => void
  onOpenAgentPage: (agentId: string) => void
  onOpenProposal: (agentId: string, proposalId: string, ownerName: string | null) => void
}) {
  if (section === 'ready-agents') return <AgentsTab onOpenPage={onOpenAgentPage} />
  if (section === 'discover') return <DiscoverTab onOpenAgentPage={onOpenAgentPage} />
  if (section === 'audit') return <AuditTab />
  if (section === 'building-blocks') {
    return (
      <div className="space-y-6">
        <AgentNestedGroup title="Prompts" summary="Reusable instructions injected before a task." onOpen={() => onOpenSubview('prompts')}>
          <PromptsTab />
        </AgentNestedGroup>
        <AgentNestedGroup title="Tools" summary="Callable workspace capabilities an agent may receive." onOpen={() => onOpenSubview('tools')}>
          <ToolsTab />
        </AgentNestedGroup>
      </div>
    )
  }
  return (
    <div className="space-y-6">
      <AgentNestedGroup title="Your work" summary="Open work and proposals waiting on you." onOpen={() => onOpenSubview('work')}>
        <YourWorkTab onOpenProposal={onOpenProposal} />
      </AgentNestedGroup>
      <AgentNestedGroup title="Commissions" summary="Assignments connecting an agent to a project." onOpen={() => onOpenSubview('commissions')}>
        <CommissionsTab />
      </AgentNestedGroup>
    </div>
  )
}

function AgentNestedGroup({
  title,
  summary,
  onOpen,
  children,
}: {
  title: string
  summary: string
  onOpen: () => void
  children: ReactNode
}) {
  return (
    <div>
      <div className={`min-w-0 pb-2 ${LEDGER_RULE_CLASS}`}>
        <button onClick={onOpen} className={`text-[13px] font-semibold text-ink ${DOOR_CLASS}`}>
          {title}
        </button>
        <p className="mt-0.5 text-[11px] text-ink-faint">{summary}</p>
      </div>
      <div className="pt-2">{children}</div>
    </div>
  )
}

function AgentSubviewPage({
  subview,
  onOpenSubview,
  onOpenAgentPage,
  onOpenProposal,
}: {
  subview: string
  onOpenSubview: (id: string | null) => void
  onOpenAgentPage: (agentId: string) => void
  onOpenProposal: (agentId: string, proposalId: string, ownerName: string | null) => void
}) {
  if (subview === 'building-blocks') {
    return (
      <>
        <FoldSection title="Prompts" summary="Reusable instructions injected before a task." persist={false} actions={<SectionAction label="Open Prompts page" icon={<ExternalLink size={14} />} onClick={() => onOpenSubview('prompts')} />}>
          <PromptsTab />
        </FoldSection>
        <FoldSection title="Tools" summary="Callable workspace capabilities an agent may receive." persist={false} actions={<SectionAction label="Open Tools page" icon={<ExternalLink size={14} />} onClick={() => onOpenSubview('tools')} />}>
          <ToolsTab />
        </FoldSection>
      </>
    )
  }
  if (subview === 'coordination') {
    return (
      <>
        <FoldSection title="Your work" summary="Open work and proposals waiting on you." persist={false} actions={<SectionAction label="Open Your work page" icon={<ExternalLink size={14} />} onClick={() => onOpenSubview('work')} />}>
          <YourWorkTab onOpenProposal={onOpenProposal} />
        </FoldSection>
        <FoldSection title="Commissions" summary="Assignments connecting an agent to a project." persist={false} actions={<SectionAction label="Open Commissions page" icon={<ExternalLink size={14} />} onClick={() => onOpenSubview('commissions')} />}>
          <CommissionsTab />
        </FoldSection>
      </>
    )
  }
  const content = subview === 'ready-agents'
    ? <AgentsTab onOpenPage={onOpenAgentPage} />
    : subview === 'prompts'
      ? <PromptsTab />
      : subview === 'tools'
        ? <ToolsTab />
        : subview === 'work'
          ? <YourWorkTab onOpenProposal={onOpenProposal} />
          : subview === 'commissions'
            ? <CommissionsTab />
            : subview === 'discover'
              ? <DiscoverTab onOpenAgentPage={onOpenAgentPage} />
              : subview === 'audit'
                ? <AuditTab />
                : <PageEmpty>This Agents page does not exist.</PageEmpty>
  const meta = (SECTION_SUBVIEWS.agents ?? []).find((surface) => surface.id === subview)
  return (
    <FoldSection title={meta?.label ?? 'Agents'} summary={agentSectionForSubview(subview)?.summary ?? 'Agent resources'} persist={false}>
      {content}
    </FoldSection>
  )
}

/** A segmented control — the in-page toggle behind the Audit log's all/denied filter
 *  and the secret reveal's shell-dialect switch. (Section-level grouping now lives in
 *  the rail's disclosure tree, not an in-page bar.) `size='sm'` is a compact variant
 *  for when the toggle sits beside a heavier element and should read as secondary —
 *  same primitive, one size token. */
function SubTabs<T extends string>({
  tabs,
  active,
  onChange,
  size = 'md',
}: {
  tabs: { id: T; label: string }[]
  active: T
  onChange: (id: T) => void
  size?: 'sm' | 'md'
}) {
  const pad = size === 'sm' ? 'p-0.5' : 'p-1'
  const btn = size === 'sm' ? 'px-2 py-0.5 text-[11px]' : 'px-3 py-1 text-[13px]'
  return (
    <div className={`inline-flex max-w-full flex-wrap items-center gap-1 rounded-lg border border-line bg-surface ${pad}`}>
      {tabs.map((t) => {
        const on = t.id === active
        return (
          <button
            key={t.id}
            onClick={() => onChange(t.id)}
            aria-pressed={on}
            className={`rounded-md font-medium transition ${btn} ${
              on ? 'bg-surface text-ink ring-1 ring-line-strong' : 'text-ink-soft hover:text-ink'
            }`}
          >
            {t.label}
          </button>
        )
      })}
    </div>
  )
}

/** Containment for an independent metric tile. Ordinary resource summaries use
 *  SynopsisRow instead; a box is reserved for a payload whose boundary conveys
 *  meaning, such as one independently comparable health measurement. */
function MetricTile({ children }: { children: ReactNode }) {
  return <div className={`${QUIET_CARD_CLASS} border-line p-4`}>{children}</div>
}

/** Hover-revealed edit / delete actions on a management row — the same idiom as the
 *  Contexts rows. Shared so every hub row exposes the same cue. */
function CardActions({
  onEdit,
  onDelete,
  disabled = false,
  disabledReason,
}: {
  onEdit?: () => void
  onDelete?: () => void
  disabled?: boolean
  disabledReason?: string
}) {
  return (
    <div className={`flex shrink-0 items-center gap-1 focus-within:opacity-100 ${HOVER_REVEAL}`}>
      {onEdit && (
        <button
          onClick={onEdit}
          disabled={disabled}
          title={disabled ? disabledReason : 'Edit'}
          aria-label="Edit"
          className="flex h-7 w-7 items-center justify-center rounded-md text-ink-faint transition hover:bg-panel-2 hover:text-ink disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Pencil size={14} />
        </button>
      )}
      {onDelete && (
        <button
          onClick={onDelete}
          disabled={disabled}
          title={disabled ? disabledReason : 'Delete'}
          aria-label="Delete"
          className="flex h-7 w-7 items-center justify-center rounded-md text-ink-faint transition hover:bg-removed-bg hover:text-removed disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Trash2 size={14} />
        </button>
      )}
    </div>
  )
}

/** "Your work" (COMMONS-25) — the caller's coordination dashboard, the GitHub
 *  "your issues / your pull requests" analog: everything they're waiting on or
 *  following to a verdict. Two bands, both the caller's OWN acts (`GET /me/work`
 *  — tenancy is the filter server-side): work items they POSTED across shared
 *  projects (open first — "awaiting a taker" is the thing you check on), and
 *  change proposals they AUTHORED against published definitions. Every row is a
 *  DOOR to the entity's own surface — the item's page, the proposal's review —
 *  so the dashboard answers "where was that?" without re-finding it by hand. */
function YourWorkTab({ onOpenProposal }: { onOpenProposal: (agentId: string, proposalId: string, ownerName: string | null) => void }) {
  const work = useMyWork().data
  const rel = useRelations()
  const myName = useMe().data?.tenant.name
  if (!work) return <Empty>Loading your work…</Empty>
  const statusDot = (s: string) =>
    s === 'open' ? 'bg-warn' : s === 'done' || s === 'merged' ? 'bg-ok' : 'bg-line-strong'
  return (
    <div className="space-y-5">
      <section>
        <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
          Work items you posted
        </div>
        {work.posted.length === 0 ? (
          <Empty>Nothing posted yet — post a work item on a shared project and follow it here.</Empty>
        ) : (
          <CardList>
            {work.posted.map((o) => (
              <SynopsisRow
                key={o.id}
                prefix={<span className={`h-1.5 w-1.5 shrink-0 rounded-full ${statusDot(o.status)}`} />}
                title={o.subGoal}
                titleClassName={o.status === 'retracted' ? 'text-ink-faint line-through' : undefined}
                description={<>in <button onClick={() => rel.navigate('projects', o.projectId)} className={`text-ink-soft ${DOOR_CLASS}`}>{o.projectName}</button></>}
                meta={`${o.status === 'open' ? 'awaiting a taker' : o.status} · ${relativeTime(o.postedAt)}${
                  (o.comments?.length ?? 0) > 0
                    ? ` · ${o.comments!.length} comment${o.comments!.length === 1 ? '' : 's'}`
                    : ''
                }`}
                onOpen={() => rel.navigate('projects', o.projectId, o.id)}
              />
            ))}
          </CardList>
        )}
      </section>
      <section>
        <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
          Proposals you opened
        </div>
        {work.proposals.length === 0 ? (
          <Empty>No change proposals yet — propose a change from a published definition in Discover.</Empty>
        ) : (
          <CardList>
            {work.proposals.map((p) => (
              <SynopsisRow
                key={p.id}
                prefix={<span className={`h-1.5 w-1.5 shrink-0 rounded-full ${statusDot(p.status)}`} />}
                title={p.note.trim() || `Change to ${p.agentLabel}`}
                description={<>on {p.agentLabel} · by <OwnerLink bare ownerName={p.agentOwner} onClick={() => rel.openOwner(p.agentOwner)} /></>}
                meta={`${p.status} · ${relativeTime(p.at)}`}
                onOpen={() => onOpenProposal(p.agentId, p.id, p.agentOwner === myName ? null : p.agentOwner)}
              />
            ))}
          </CardList>
        )}
      </section>
    </div>
  )
}

/** Worker Agents (D6) — a scan-friendly index of label, provider, tool count and
 *  distribution state. Full runtime authority and lifecycle controls live on the
 *  canonical Agent page; edit/delete stay as compact row-local management acts. */
function AgentsTab({ onOpenPage }: { onOpenPage: (agentId: string) => void }) {
  const currentAgents = useAgents().data ?? []
  useAgentDeletionStatus()
  // A committed-removal event can refresh the registry before the originating
  // response settles. Preserve exactly those reviewed rows until reconciliation
  // releases their destructive intent.
  const agents = [
    ...currentAgents,
    ...heldAgentDeletions().filter((held) =>
      !currentAgents.some((agent) => agent.id === held.id)),
  ]
  const providers = useProviders().data ?? []
  // Every creatable agent names its provider (the strict-API rule); only definition-
  // only fork/import stubs (D18/D20 — capability never travels) are unbound, so say
  // that instead of implying a hidden default resolution.
  const providerLabel = (id?: string) => providers.find((p) => p.id === id)?.label ?? 'No provider bound yet'
  const [editing, setEditing] = useState<Agent | null>(null)
  return (
    <>
      {agents.length === 0 ? (
        <Empty>No agents yet.</Empty>
      ) : (
        <CardList>
          {agents.map((a) => (
            <AgentRow
              key={a.id}
              agent={a}
              providerLabel={providerLabel(a.providerId)}
              manageable={a.tenantId !== undefined}
              onEdit={() => setEditing(a)}
              onOpenPage={onOpenPage}
            />
          ))}
        </CardList>
      )}
      {editing && <AgentDialog agent={editing} onClose={() => setEditing(null)} />}
    </>
  )
}

function AgentRow({
  agent,
  providerLabel,
  manageable,
  onEdit,
  onOpenPage,
}: {
  agent: Agent
  providerLabel: string
  /** Shared seed infrastructure is visible in every account but is not a custom
   * definition owned by the viewer. Only tenant-stamped agents expose mutation. */
  manageable: boolean
  onEdit: () => void
  /** Door to this definition's canonical page. Owned definitions have a private
   *  management page whether or not they are published; published ones expose
   *  their public face to other accounts at the same address. */
  onOpenPage: (agentId: string) => void
}) {
  useAgentMutationStatus()
  useAgentDeletionStatus()
  // D25 — the owner's review queue: fetched only for published definitions (the
  // only ones that can receive proposals).
  const proposals = useAgentProposals(agent.id, manageable && agent.published === true).data ?? []
  const openProposals = proposals.filter((p) => p.status === 'open')
  const [reviewing, setReviewing] = useState(false)
  // Notification door (R5): a proposal.* bell whose recipient OWNS this agent opens
  // the review dialog ON its proposal. Consumed once.
  const { pending, consume } = usePendingFocus()
  const proposalFocus = pending?.agentId === agent.id && pending?.proposalId ? pending.proposalId : null
  const [reviewFocus, setReviewFocus] = useState<string | null>(null)
  useEffect(() => {
    if (!proposalFocus) return
    setReviewing(true)
    setReviewFocus(proposalFocus)
    consume()
  }, [proposalFocus, consume])
  // Notification door (R6): an agent.forked bell targets the SOURCE agent (which the
  // recipient owns) with no proposalId — scroll this row into view + flash it. The
  // shared hook consumes the pending target so it fires once.
  const rowRef = useRef<HTMLDivElement>(null)
  const agentFocus = pending?.agentId === agent.id && !pending?.proposalId
  const flash = useFocusFlash(agentFocus, rowRef)
  const [confirmingRemoval, setConfirmingRemoval] = useState(false)
  const deleting = isAgentDeletionHeld(agent.id)
  const mutationHeld = deleting || isAgentMutationHeld(agent.id)
  const requestRemoval = () => {
    if (!mutationHeld) setConfirmingRemoval(true)
  }
  const confirmRemoval = () => {
    if (mutationHeld) return
    setConfirmingRemoval(false)
    void enqueueAgentDeletion(agent)
  }
  const status = agent.published ? `Published · v${agent.version ?? 1}` : manageable ? 'Private' : 'Built in'
  return (
    <>
      <SynopsisRow
        ref={rowRef}
        title={agent.label}
        description={`Runs on ${providerLabel} · ${agent.tools.length} tool${agent.tools.length === 1 ? '' : 's'}`}
        meta={deleting ? `Removing Agent… · ${status}` : status}
        prefix={deleting ? <span className="text-ink-faint"><Spinner size={12} /></span> : undefined}
        busy={deleting}
        onOpen={() => onOpenPage(agent.id)}
        trailing={
          manageable ? (
            <div className="flex shrink-0 items-center gap-1.5">
              {agent.published && proposals.length > 0 && (
                <button
                  onClick={() => setReviewing(true)}
                  disabled={mutationHeld}
                  className={`${INLINE_ACTION_CLASS} disabled:cursor-not-allowed disabled:opacity-50`}
                  aria-label={openProposals.length > 0
                    ? `Review ${openProposals.length} proposal${openProposals.length === 1 ? '' : 's'}`
                    : 'Review proposal history'}
                  title="Review change proposals against this published definition"
                >
                  {openProposals.length > 0
                    ? `${openProposals.length} proposal${openProposals.length === 1 ? '' : 's'}`
                    : 'Proposal history'}
                </button>
              )}
              <CardActions
                onEdit={onEdit}
                onDelete={requestRemoval}
                disabled={mutationHeld}
                disabledReason="Waiting for this Agent change to settle"
              />
            </div>
          ) : undefined
        }
        className={flash ? FOCUS_FLASH_CLASS : ''}
      />
      {confirmingRemoval && (
        <ConfirmDialog
          title={`Remove ${agent.label}?`}
          body={AGENT_DELETE_SCOPE}
          confirmLabel="Remove Agent"
          onConfirm={confirmRemoval}
          onCancel={() => setConfirmingRemoval(false)}
        />
      )}
      {manageable && reviewing && (
        <DeferredAgentProposalsReviewDialog
          agent={agent}
          proposals={proposals}
          focusProposalId={reviewFocus}
          Thread={ProposalThread}
          FieldDiff={ProposalFieldDiff}
          GitPullRequestIcon={GitPullRequest}
          GitMergeIcon={GitMerge}
          onClose={() => {
            setReviewing(false)
            setReviewFocus(null)
          }}
        />
      )}
    </>
  )
}

/** D27 — one proposal's discussion thread + acknowledgement-owned composer,
 * shared by the owner's review dialog and proposer's public detail. */
function ProposalThread({
  agentId,
  proposal,
  openForComments,
}: {
  agentId: string
  proposal: AgentChangeProposal
  openForComments: boolean
}) {
  const me = useMe().data
  useAgentProposalCommentCreationStatus()
  const [draft, setDraft] = useState('')
  const [error, setError] = useState<string | null>(null)
  const heldComment = heldAgentProposalCommentIntent(agentId, proposal.id)
  const commentHeld = heldComment !== null
  const comments = proposal.comments ?? []
  useEffect(() => {
    if (!heldComment) return
    setDraft(heldComment.body)
  }, [heldComment])
  if (comments.length === 0 && !openForComments && !commentHeld) return null
  const send = async () => {
    if (commentHeld || !draft.trim()) return
    if (!me) {
      setError('Sign in again before posting this comment.')
      return
    }
    setError(null)
    try {
      const outcome = await enqueueAgentProposalCommentCreation({
        tenantId: me.tenant.id,
        agentId,
        proposalId: proposal.id,
        body: draft,
      })
      if (outcome === 'applied') setDraft('')
      else setError('This comment was not posted. Your draft is still here.')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not post this comment.')
    }
  }
  return (
    <div className="mt-2 space-y-1.5 border-l-2 border-line pl-2.5">
      {/* Self-capped like every long field in this dialog family (review finding:
          FormDialog's shell doesn't scroll — an uncapped thread pushed the footer
          off-viewport). */}
      <div className="max-h-40 space-y-1.5 overflow-y-auto">
        {comments.map((c) => (
          <div key={c.id} className="text-[12px] leading-snug text-ink-soft">
            {/* FWD-5 Phase 3: an agent author wears the Bot badge; the human render
                stays a plain name (a proposal thread is parties-only — no door). */}
            {c.authorKind === 'agent' ? (
              <AgentActor label={c.author} />
            ) : (
              <span className="font-medium text-ink">{c.author}</span>
            )}
            <span className="text-ink-faint"> · {relativeTime(c.at)}</span>
            <div className="whitespace-pre-wrap">{c.body}</div>
          </div>
        ))}
      </div>
      {(openForComments || commentHeld) && (
        <div data-agent-proposal-comment-form aria-busy={commentHeld || undefined} className="flex items-center gap-1.5">
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void send()}
            maxLength={WORK_ITEM_COMMENT_MAX}
            disabled={commentHeld}
            placeholder="Discuss this proposal…"
            aria-label={`Comment on proposal ${proposal.id}`}
            className="min-w-0 flex-1 rounded-md border border-line bg-surface px-2 py-1 text-[12px] text-ink outline-none placeholder:text-ink-faint focus:border-line-strong"
          />
          <button
            onClick={() => void send()}
            disabled={commentHeld || !me || !draft.trim()}
            className={`shrink-0 ${SOFT_BUTTON_CLASS} px-2.5 py-1 text-[12px] disabled:opacity-45`}
          >
            {commentHeld ? 'Posting…' : 'Post'}
          </button>
        </div>
      )}
      {error && <p className="text-[11px] text-removed">{error}</p>}
    </div>
  )
}

/** The label per proposable definition field (D25). Module-level so the one Diff
 *  primitive below and any future consumer read the same names. */
const PROPOSAL_FIELD_LABEL: Record<string, string> = {
  label: 'Label',
  systemPrompt: 'System prompt',
  instructions: 'Instructions',
  tools: 'Tools',
}

/** The change a proposal carries, as a side-by-side field diff (current → proposed) —
 *  the shared **Diff** primitive (surface-audit S1). A proposal's payload IS a change,
 *  so it belongs in a diff, not prose. ONE rendering serves the owner's review queue
 *  AND the proposer's own "Your proposals" (who otherwise couldn't see their own
 *  change), so the two can't drift (form follows function). `current` is built by the
 *  caller from whatever definition its surface holds — the live Agent, or the public
 *  directory entry — so no cross-tenant field crosses a wall the caller couldn't
 *  already read. Left column = current (removed tint), right = proposed (added tint). */
function ProposalFieldDiff({
  fields,
  current,
}: {
  fields: AgentChangeProposal['fields']
  current: Record<string, string>
}) {
  return (
    <>
      {Object.entries(fields).map(([field, proposed]) => (
        <TextDiff
          key={field}
          label={PROPOSAL_FIELD_LABEL[field] ?? field}
          current={current[field]}
          proposed={Array.isArray(proposed) ? proposed.join(', ') : proposed}
        />
      ))}
    </>
  )
}

/** A published definition's resolved-work TRACK RECORD (surface-audit S10) — the
 *  concrete acts behind its D13 contribution count (a number that is a lineage), the way
 *  a contribution graph links to the actual work. P8-REDACTED server-side to shared-
 *  Project resolutions. Each row is TWO doors (S18): the sub-goal opens the work item's
 *  own page — its timeline IS the contribution's detail — and the project name opens
 *  the project. Reuses the changelog list's styling so the two read as one. */
function AgentResolvedWork({ agentId, totalContributions = 0 }: { agentId: string; totalContributions?: number }) {
  const rel = useRelations()
  const items = useAgentResolvedWork(agentId).data ?? []
  // Hidden only when there is nothing to explain. A count with an empty PUBLIC list
  // gets an honest empty state (like Public forks): the count also credits effects
  // on private projects, which the P8 wall keeps out of this list.
  if (items.length === 0 && totalContributions === 0) return null
  if (items.length === 0)
    return (
      <FormField label="Resolved work (0)">
        <p className="rounded-lg border border-line bg-panel-2 p-2.5 text-[11px] leading-snug text-ink-faint">
          None publicly visible — the contribution count also credits work on private projects, which stays private.
        </p>
      </FormField>
    )
  return (
    <FormField label={`Resolved work (${items.length})`}>
      <ul className="max-h-24 space-y-1 overflow-y-auto rounded-lg border border-line bg-panel-2 p-2.5 text-[11px] leading-snug text-ink-soft">
        {items.map((it, i) => (
          <li key={`${it.projectId}-${it.resolvedAt}-${i}`} className="flex items-baseline gap-1.5">
            <button
              onClick={() => rel.navigate('projects', it.projectId, it.itemId)}
              className={`min-w-0 flex-1 truncate text-left ${INLINE_ACTION_CLASS}`}
              title="Open this work item — the contribution's own page"
            >
              {it.subGoal}
            </button>
            <button
              onClick={() => rel.navigate('projects', it.projectId)}
              className={INLINE_ACTION_CLASS}
              title={`Open ${it.projectName}`}
            >
              {it.projectName}
            </button>
            <span className="shrink-0 text-ink-faint">{relativeTime(it.resolvedAt)}</span>
          </li>
        ))}
      </ul>
    </FormField>
  )
}

/** The PUBLIC forks behind a definition's fork counter (D18/S18) — directory entries
 *  whose lineage names this agent, each a door to that fork's own page. Deliberately
 *  a SUBSET of the count: a fork lives in its owner's private registry until
 *  published (GitHub's public-forks shape), and the empty state says so instead of
 *  pretending the count is wrong. Hidden entirely when the count is 0. */
function AgentPublicForks({
  agentId,
  totalForks,
  onOpenAgent,
}: {
  agentId: string
  totalForks: number
  onOpenAgent: (agentId: string) => void
}) {
  const rel = useRelations()
  const items = useAgentForks(agentId).data ?? []
  if (totalForks === 0 && items.length === 0) return null
  return (
    <FormField label={`Public forks (${items.length})`}>
      {items.length === 0 ? (
        <p className="rounded-lg border border-line bg-panel-2 p-2.5 text-[11px] leading-snug text-ink-faint">
          None published yet — a fork lives in its owner’s private registry until they publish it.
        </p>
      ) : (
        <ul className="max-h-24 space-y-1 overflow-y-auto rounded-lg border border-line bg-panel-2 p-2.5 text-[11px] leading-snug text-ink-soft">
          {items.map((f) => (
            <li key={f.agentId} className="flex items-baseline gap-1.5">
              <button
                onClick={() => onOpenAgent(f.agentId)}
                className={`min-w-0 truncate text-left ${INLINE_ACTION_CLASS}`}
                title="Open this fork's page"
              >
                {f.label}
              </button>
              <span className="min-w-0 flex-1 truncate">
                <OwnerLink ownerName={f.owner} own={f.own} onClick={() => rel.openOwner(f.owner)} />
              </span>
              {f.forkedAtVersion !== undefined && (
                <span className="shrink-0 text-ink-faint">forked at v{f.forkedAtVersion}</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </FormField>
  )
}

/** The version-history timeline of a published definition (D25) — one line per
 *  version: who authored it (a merged proposal, or the owner's own edit), the note, and
 *  when, newest first. A version badge is a number where a lineage lives; this is the
 *  lineage. Shared (surface-audit S4) so the owner's card and the visitor's detail
 *  render the same history and can't drift (form follows function). S12: the AUTHOR is
 *  an owner byline, so it's a door to that owner's profile like every other
 *  byline (postedBy, resolvedBy, the profile's "authored" line) — via the shared
 *  OwnerLink; `author` IS the profile handle, and store.ownerProfile pushes an
 *  "authored" activity for it, so a bare proposer's profile always resolves. */
function ChangelogList({ changelog }: { changelog: AgentChangelogEntry[] }) {
  const rel = useRelations()
  return (
    <ul className="max-h-24 space-y-1 overflow-y-auto rounded-lg border border-line bg-panel-2 p-2.5 text-[11px] leading-snug text-ink-soft">
      {[...changelog].reverse().map((l) => (
        <li key={l.version}>
          <span className="font-medium text-ink">v{l.version}</span> ·{' '}
          <OwnerLink ownerName={l.author} onClick={() => rel.openOwner(l.author)} /> · {l.note} ·{' '}
          {relativeTime(l.at)}
        </li>
      ))}
    </ul>
  )
}

/** Create / edit an Agent — the bundle that binds a Model provider (D9) to a system
 *  prompt (D10). Both pickers pre-select the registry's *default-flagged* entry, else
 *  the first listed (`defaultEntry` — the flag is exactly this pre-selection and
 *  nothing more); there is NO implicit "Default" option, because the API refuses an
 *  agent without concrete bindings (the strict-API rule). The prompt's fit against the
 *  chosen provider's family is checked live (the same `promptFitWarning` the Customize
 *  picker uses). New agents inherit the provider's authority + the full tool catalog;
 *  per-axis authority editing is a later refinement. */
function AgentDialog({ agent, onClose }: { agent: Agent | null; onClose: () => void }) {
  // Freeze the form's opening base. Ambient Agent events may update the page
  // behind this held draft; dirty-field comparison must not reinterpret those
  // remote changes as edits the user made here.
  const original = useRef(agent).current
  const tenantId = useMe().data?.tenant.id
  const providers = useProviders().data ?? []
  const prompts = useSystemPrompts().data ?? []
  const catalog = useAgentToolCatalog().data?.tools ?? []
  const [label, setLabel] = useState(agent?.label ?? '')
  const [providerId, setProviderId] = useState(agent?.providerId ?? '')
  const [promptId, setPromptId] = useState(agent?.systemPromptId ?? '')
  const [instructions, setInstructions] = useState(agent?.instructions ?? '')
  const [providerTouched, setProviderTouched] = useState(false)
  const [promptTouched, setPromptTouched] = useState(false)
  // The tool grant is EXPLICIT (INV-9 minimal risk: the API treats an omitted grant as
  // NO tools, never the catalog) — so the dialog states it: a new agent pre-checks the
  // full catalog (the visible edge convenience); an edit starts at 'keep' and only
  // sends the grant when the user actually flips it (per-tool editing is a later
  // refinement — a custom subset is preserved unless changed).
  const [toolChoice, setToolChoice] = useState<'keep' | 'all' | 'none'>(agent ? 'keep' : 'all')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  // The opt-in prompt-fit probe (D10/OQ5) — null until the user runs it; reset when the
  // pairing changes so a stale score never lingers.
  const [probe, setProbe] = useState<PromptProbeResult | null>(null)
  const [probing, setProbing] = useState(false)

  // New-Agent pickers resolve to the default-else-first entry after async registry
  // load. An existing imported Agent with no provider stays visibly unbound until
  // the user chooses one; otherwise a sparse rename would display a provider it did
  // not save. A BESPOKE prompt similarly keeps its explicit "keep current" option.
  const bespokePrompt = !!agent && !agent.systemPromptId
  const effectiveProviderId = providerId || (!agent ? defaultEntry(providers)?.id : '') || ''
  const effectivePromptId = promptId || (bespokePrompt ? '' : defaultEntry(prompts)?.id || '')
  // What the grant checkbox shows: 'keep' reflects the agent's current grant.
  // "Has the full catalog" is a SET test (every catalog tool granted), not a
  // length compare — a same-size custom subset (or a grant carrying a stale tool
  // not in the catalog) must not read as full.
  const agentHasFullCatalog = !!original && catalog.length > 0 && catalog.every((t) => original.tools.includes(t))
  // A custom subset worth PRESERVING when the user unchecks (neither empty nor full).
  const agentHasCustomSubset = !!original && original.tools.length > 0 && !agentHasFullCatalog
  const grantAll = toolChoice === 'all' || (toolChoice === 'keep' && agentHasFullCatalog)
  const providerChanged = providerTouched && effectiveProviderId !== (original?.providerId ?? '')
  const promptChanged = promptTouched && effectivePromptId !== (original?.systemPromptId ?? '')
  const selectedTools = toolChoice === 'all' ? catalog : []
  const toolsChanged = toolChoice !== 'keep' && (
    selectedTools.length !== (original?.tools.length ?? 0) ||
    selectedTools.some((tool) => !original?.tools.includes(tool))
  )
  const hasEditChanges = !!agent && (
    label.trim() !== (original?.label ?? '') ||
    instructions.trim() !== (original?.instructions ?? '') ||
    providerChanged ||
    promptChanged ||
    toolsChanged
  )
  const canSubmit =
    label.trim().length > 0 &&
    !!effectiveProviderId &&
    (bespokePrompt || !!effectivePromptId) &&
    // A full-catalog grant needs the catalog loaded — never send [] while showing "all".
    (toolChoice !== 'all' || catalog.length > 0) &&
    (!!agent || !!tenantId) &&
    (!agent || hasEditChanges) &&
    !busy

  // Live fit warning: the chosen prompt's family vs the chosen provider's.
  const providerFamily = providers.find((p) => p.id === effectiveProviderId)?.modelFamily ?? 'claude'
  const selectedPrompt = prompts.find((p) => p.id === effectivePromptId)
  const warning = selectedPrompt ? promptFitWarning(selectedPrompt, providerFamily) : null
  // Changing either side of the pairing invalidates a prior probe result.
  const onPrompt = (id: string) => { setPromptId(id); setPromptTouched(true); setProbe(null) }
  const onProvider = (id: string) => { setProviderId(id); setProviderTouched(true); setProbe(null) }
  const runProbe = async () => {
    if (!effectivePromptId) return
    setProbing(true)
    try {
      setProbe(await probePrompt(effectivePromptId, effectiveProviderId || undefined))
    } catch {
      setProbe(null)
    } finally {
      setProbing(false)
    }
  }

  const submit = async () => {
    if (!canSubmit) return
    setBusy(true)
    setError(null)
    try {
      if (agent) {
        // Sparse by USER intent, not by the live prop: after another device
        // changes an untouched field, Retry rebases only what this form actually
        // changed instead of replaying a stale full-form snapshot over it.
        const fields = {
          ...(label.trim() !== (original?.label ?? '') ? { label: label.trim() } : {}),
          ...(providerChanged ? { providerId: effectiveProviderId } : {}),
          ...(promptChanged ? { systemPromptId: effectivePromptId } : {}),
          ...(toolsChanged ? { tools: selectedTools } : {}),
          ...(instructions.trim() !== (original?.instructions ?? '') ? { instructions: instructions.trim() } : {}),
        }
        const outcome = await updateAgent(agent.id, fields)
        if (outcome === 'discarded') {
          setError('Your held edits were not saved. Review the latest agent, then apply what you still want.')
          setBusy(false)
          return
        }
      } else {
        const outcome = await enqueueAgentCreation({
          tenantId: tenantId!,
          request: {
            label: label.trim(),
            providerId: effectiveProviderId,
            systemPromptId: effectivePromptId,
            tools: grantAll ? catalog : [],
            instructions: instructions.trim(),
          },
        })
        if (outcome === 'discarded') {
          setError('Your Agent details are still here. Review them, then create again when ready.')
          setBusy(false)
          return
        }
      }
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save this agent.')
      setBusy(false)
    }
  }

  return (
    <FormDialog
      title={agent ? 'Edit agent' : 'New agent'}
      icon={<Bot size={18} className="text-ink-soft" />}
      submitLabel={agent ? 'Save' : 'Create'}
      canSubmit={canSubmit}
      onSubmit={submit}
      onClose={onClose}
      error={error}
      busy={busy}
    >
      <FormField label="Name">
        <input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
          placeholder="e.g. Code reviewer"
          className={FORM_INPUT_CLASS}
        />
      </FormField>
      <FormField label="Provider">
        {/* No implicit option: every agent names a concrete provider (the strict-API
            rule); the pre-selected entry is the registry's default-else-first. */}
        <select value={effectiveProviderId} onChange={(e) => onProvider(e.target.value)} className={FORM_INPUT_CLASS}>
          {agent && !agent.providerId && <option value="" disabled>Choose a provider</option>}
          {providers.map((p) => (
            <option key={p.id} value={p.id}>
              {/* The transport is visible at bind time (§4.6) — an <option>
                  can't carry the badge, so the cue rides the label text. The default
                  flag rides the same way. */}
              {`${p.label}${p.kind === 'session' ? ' · Session' : ''}${p.isDefault ? ' · Default' : ''}`}
            </option>
          ))}
        </select>
        {providers.find((p) => p.id === effectiveProviderId)?.kind === 'session' && (
          <span className="mt-1 flex items-start gap-1 text-[11px] text-ink-soft">
            <AlertCircle size={12} className="mt-0.5 shrink-0" />
            Relay: your own AI session answers this Agent’s turns — tool calls are relayed through it (each still lands as a consent card here).
          </span>
        )}
      </FormField>
      <FormField label="System prompt">
        <select value={effectivePromptId} onChange={(e) => onPrompt(e.target.value)} className={FORM_INPUT_CLASS}>
          {/* The ONLY empty option is a bespoke-prompt agent's "keep current" (merged
              proposal, fork — no library binding to show). Left untouched, the patch
              omits the binding and the custom prompt is preserved. Everything else
              picks a concrete library entry — there is no implicit "Default prompt". */}
          {bespokePrompt && <option value="">Keep current prompt (custom)</option>}
          {prompts.map((p) => (
            <option key={p.id} value={p.id}>
              {`${p.label}${p.isDefault ? ' · Default' : ''}`}
            </option>
          ))}
        </select>
        {/* An agent needs a concrete prompt (the strict-API rule) — an emptied library
            would otherwise just disable Create with no explanation. */}
        {!bespokePrompt && prompts.length === 0 && (
          <span className="mt-1 block text-[11px] text-ink-faint">
            The prompt library is empty — add one under Agents → Prompts first.
          </span>
        )}
        {warning && (
          <span className="mt-1 flex items-center gap-1 text-[11px] text-warn-strong">
            <AlertCircle size={12} className="shrink-0" /> {warning}
          </span>
        )}
        {/* The opt-in probe (D10/OQ5) sits beside the always-on static tag above — the deeper,
            scored upgrade, run on demand. Only meaningful for a real library prompt. */}
        {selectedPrompt && (
          <div className="mt-1.5 flex flex-col gap-1">
            <button
              type="button"
              onClick={runProbe}
              disabled={probing}
              className="self-start text-[11px] font-medium text-ink-soft underline-offset-2 hover:text-ink hover:underline disabled:opacity-50"
            >
              {probing ? 'Probing…' : probe ? 'Re-run fit probe' : 'Run fit probe'}
            </button>
            {probe && <ProbeResultCard probe={probe} />}
          </div>
        )}
      </FormField>
      <FormField label="Tools">
        {/* Unchecking RETURNS to the preserved custom subset when the agent has
            one (else it grants none) — so a check-then-uncheck can't silently
            destroy the subset the hint below promises to keep. */}
        <CheckboxRow checked={grantAll} onToggle={() => setToolChoice(grantAll ? (agentHasCustomSubset ? 'keep' : 'none') : 'all')}>
          <span className="text-[12px] leading-snug text-ink-soft">
            <span className="font-medium text-ink">Full tool catalog</span>
            {catalog.length > 0 ? ` — all ${catalog.length} tools` : ''}.{' '}
            {agentHasCustomSubset ? 'Unchecked keeps the current custom set' : (
              <>Unchecked grants <span className="font-medium text-ink">no tools</span> (the agent converses but can’t propose changes)</>
            )}. Per-tool selection is a later refinement.
          </span>
        </CheckboxRow>
        {toolChoice === 'keep' && agentHasCustomSubset && (
          <span className="mt-1 block text-[11px] text-ink-faint">
            Currently {agent!.tools.length} of {catalog.length || '…'} tools — the custom set is kept unless you change this.
          </span>
        )}
      </FormField>
      <FormField label="Instructions" optional>
        <textarea
          value={instructions}
          onChange={(e) => setInstructions(e.target.value)}
          rows={3}
          placeholder="Custom instructions appended after the system prompt."
          className={`${FORM_INPUT_CLASS} resize-none leading-relaxed`}
        />
      </FormField>
    </FormDialog>
  )
}

const PROBE_VERDICT_COLOR: Record<PromptProbeResult['verdict'], string> = {
  strong: 'text-ok-text',
  fair: 'text-warn-strong',
  weak: 'text-removed',
}

/** The opt-in probe's result (D10/OQ5) — a score + the per-aspect gradient the static tag
 *  collapses into one binary signal. Shown only after the user runs the probe. */
function ProbeResultCard({ probe }: { probe: PromptProbeResult }) {
  return (
    <div className="rounded-md border border-ink/10 bg-ink/[0.02] p-2 text-[11px]">
      <div className={`font-medium ${PROBE_VERDICT_COLOR[probe.verdict]}`}>
        {probe.verdict} fit · {probe.score}/100
      </div>
      <div className="mt-0.5 text-ink-soft">{probe.detail}</div>
      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-ink-faint">
        {probe.aspects.map((a) => (
          <span key={a.name}>
            {a.name} <span className="font-medium text-ink-soft">{a.score}</span>
          </span>
        ))}
      </div>
    </div>
  )
}

/** Model providers (D9) — the cognition source an Agent binds: family, effort levels,
 *  authority grant, and plan ceiling (the D8 cascade root). Mirrors the composer gauge's
 *  rows in a fuller card. */
/** The Models section — the Model-provider registry (D9) as a first-class rail
 *  surface. Every entry here is selectable as a model in any session's composer
 *  (the selector reads this same registry), so registering a provider and using
 *  it are two views of one concept: models are first-class citizens. */
function ModelsSection({
  collectionSectionId,
  providerId,
  onBack,
  backTo,
}: {
  collectionSectionId: string | null
  providerId: string | null
  onBack: () => void
  backTo: NavLocation | null
}) {
  const rel = useRelations()
  const providerIdRef = useRef(providerId)
  providerIdRef.current = providerId
  const providersQ = useProviders()
  const currentProviders = providersQ.data ?? []
  useProviderDeletionStatus()
  // Keep the exact reviewed detail page mounted if an early provider event
  // observes committed absence before server/device acknowledgement settles.
  const providers = [
    ...currentProviders,
    ...heldProviderDeletions().filter((held) =>
      !currentProviders.some((provider) => provider.id === held.id)),
  ]
  // null = no dialog; 'new' = create; a provider = edit that one.
  const [editing, setEditing] = useState<ModelProvider | 'new' | null>(null)
  const [updatingConnectionId, setUpdatingConnectionId] = useState<string | null>(null)
  useEffect(() => {
    if (updatingConnectionId && providerId !== updatingConnectionId) setUpdatingConnectionId(null)
  }, [providerId, updatingConnectionId])
  // A draft's explicit "Connect a model" door carries that draft in the pane
  // back stack. Once the registry has resolved and proves nothing can answer,
  // open the canonical provider form exactly once. Cancelling leaves the Models
  // page usable; a later successful endpoint creation still completes the handoff.
  const setupReturn = useRef(false)
  const setupOpened = useRef(false)
  const setupMounted = useRef(true)
  useEffect(() => {
    setupMounted.current = true
    return () => { setupMounted.current = false }
  }, [])
  const fromDraft = backTo?.kind === 'session' && backTo.sessionId === DRAFT_ID
  const fromDraftRef = useRef(fromDraft)
  fromDraftRef.current = fromDraft
  useEffect(() => {
    if (providerId || setupOpened.current || !fromDraft || providersQ.data === undefined) return
    if (!modelSetupRequired(providersQ.data)) return
    setupOpened.current = true
    setupReturn.current = true
    setEditing('new')
  }, [fromDraft, providerId, providersQ.data])

  const providerCreated = (created: CreatedProvider) => {
    // A Session provider is not ready merely because its rendezvous exists; its
    // drain loop must come online first. Only a provider that can answer now may
    // become the new-draft pick and return through the carried Back edge.
    if (!setupReturn.current || !modelProviderAvailable(created)) return
    void updateModelPreferences({ providerId: created.id, modelId: undefined }).then((outcome) => {
      if (outcome !== 'applied' || !setupReturn.current || !setupMounted.current || !fromDraftRef.current || providerIdRef.current) return
      setupReturn.current = false
      onBack()
    })
  }
  const [filter] = useSectionFilter('models')
  // The same list the rail's provider children show — kind facet (the shared
  // built-ins, the endpoints you registered, delegated Sessions) + order.
  const shown = listProviders(providers, filter)
  const [providersGroup] = modelCollectionSections(shown)
  const providersSelected = collectionSectionId === providersGroup.id
  const openProvider = providerId ? providers.find((provider) => provider.id === providerId) ?? null : null
  const updatingConnection = updatingConnectionId
    ? providers.find((provider) => provider.id === updatingConnectionId) ?? null
    : null

  // A provider is a rail LEAF with a canonical URL, so it gets an honest page;
  // the composite Models page remains the overview. The old implementation
  // merely scrolled and flashed this card in the index, making the rail promise
  // a resource that the main pane declined to show (UI-28/UI-30).
  if (providerId) {
    if (openProvider) {
      return (
        <ProviderDetailPage
          provider={openProvider}
          onEdit={() => setEditing(openProvider)}
          onUpdateConnection={openProvider.kind !== 'session' && openProvider.tenantId
            ? () => setUpdatingConnectionId(openProvider.id)
            : undefined}
          onAdd={() => setEditing('new')}
          onBack={onBack}
          backTo={backTo}
          onDeleted={() => {
            if (providerIdRef.current === openProvider.id) onBack()
          }}
        >
          {editing && (
            <ProviderDialog provider={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />
          )}
          {updatingConnection && (
            <ProviderConnectionDialog provider={updatingConnection} onClose={() => setUpdatingConnectionId(null)} />
          )}
        </ProviderDetailPage>
      )
    }
    return (
      <UnavailableResourcePage
        title="Provider"
        state={resolveResourceUnavailable([providersQ])}
        message="This provider isn’t visible from this account (or no longer exists)."
        backTo={backTo ?? { kind: 'section', section: 'models', projectId: null, scheduleId: null }}
        onBack={onBack}
        onRetry={() => retryResourceQueries([keys.providers])}
      />
    )
  }

  const projection = structuralCollectionProjection({
    section: 'models',
    fallbackLabel: 'Models',
    empty: 'No providers in this view.',
    itemNoun: 'provider',
    groups: [{
      key: providersGroup.id,
      label: providersGroup.label,
      keepEmpty: true,
      empty: 'No providers in this view.',
      items: collectionProjectionItems(
        shown,
        (provider) => provider.id,
        (provider) => provider.label,
      ),
    }],
  })

  return (
    <CompositeResourcePage section="models" sectionPage={providersSelected}>
      <PageHeader
        title="Models"
        subtitle={providersSelected ? providersGroup.label : 'Every model your sessions can run on — built-in, registered endpoint, or delegated AI session.'}
      >
        <PageActionButton
          icon={<Plus size={15} />}
          onClick={() => setEditing('new')}
          mirrorsRailFor="models"
          onRailInvoke={() => setEditing('new')}
        >
          New provider
        </PageActionButton>
      </PageHeader>
      <CompositePageControls
        section="models"
        filter={<SectionFilterMenu section="models" placement="page" />}
      />
      <MainCollectionTemplate
        projection={projection}
        renderItem={(item) => (
          <ProviderRow
            provider={item.value}
            onOpen={() => rel.navigate('models', item.value.id)}
          />
        )}
      />
      {editing && (
        <ProviderDialog
          provider={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onCreated={providerCreated}
        />
      )}
    </CompositeResourcePage>
  )
}

/** The canonical page behind one Models rail leaf. Provider configuration,
 * catalog/relay state, and management acts use the same named-section grammar
 * as ProjectDetail instead of redrawing a second kind of detail surface. */
function ProviderDetailPage({
  provider,
  onEdit,
  onUpdateConnection,
  onAdd,
  onBack,
  backTo,
  onDeleted,
  children,
}: {
  provider: ModelProvider
  onEdit: () => void
  onUpdateConnection?: () => void
  onAdd: () => void
  onBack: () => void
  backTo: NavLocation | null
  onDeleted: () => void
  children?: ReactNode
}) {
  useProviderDeletionStatus()
  const deleting = isProviderDeletionHeld(provider.id)
  return (
    <AtomicResourcePage aria-busy={deleting}>
      <header className={PAGE_HEADER_CLASS}>
        <div className="flex min-w-0 items-start gap-1">
          <BackButton to={backTo ?? { kind: 'section', section: 'models', projectId: null, scheduleId: null }} onBack={onBack} />
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h1 {...identityTitleProps(provider.label)} className={`${PAGE_TITLE_CLASS} truncate`}>{provider.label}</h1>
              {provider.isDefault && <DefaultBadge />}
              {deleting && <Spinner size={13} />}
            </div>
            <p className="mt-1 text-[13px] text-ink-soft">
              {deleting ? 'Removing Provider… · ' : ''}
              {provider.kind === 'session' ? 'Session provider · relay' : provider.modelFamily}
            </p>
          </div>
        </div>
      </header>
      <ProviderDetailSections
        provider={provider}
        onEdit={onEdit}
        onUpdateConnection={onUpdateConnection}
        onAdd={onAdd}
        onDeleted={onDeleted}
        deleting={deleting}
      />
      {children}
    </AtomicResourcePage>
  )
}

/** One provider in the Models INDEX. Like ProjectRow, this is a synopsis door:
 * identity first, one quiet descriptor, then one small state/count. Authority,
 * effort levels, catalog entries and management acts belong to the canonical
 * provider page — repeating them here made the index a stack of configuration
 * cards rather than a list someone could scan. */
function ProviderRow({ provider, onOpen }: { provider: ModelProvider; onOpen: () => void }) {
  const isSession = provider.kind === 'session'
  const modelCount = provider.models?.length ?? 0
  const descriptor = isSession ? 'Session relay' : provider.modelFamily
  const meta = isSession
    ? provider.online
      ? 'connected'
      : 'offline'
    : provider.execution === 'unconfigured'
      ? 'not configured'
      : provider.execution === 'mock'
        ? 'development mock'
        : `${modelCount} model${modelCount === 1 ? '' : 's'}`

  return (
    <SynopsisRow
      title={provider.label}
      description={descriptor}
      meta={`${meta}${provider.isDefault ? ' · default' : ''}`}
      onOpen={onOpen}
    />
  )
}

function ProviderDetailSections({
  provider,
  onEdit,
  onUpdateConnection,
  onAdd,
  onDeleted,
  deleting,
}: {
  provider: ModelProvider
  onEdit: () => void
  onUpdateConnection?: () => void
  onAdd: () => void
  onDeleted: () => void
  deleting: boolean
}) {
  const [error, setError] = useState<string | null>(null)
  const me = useMe().data
  useProviderDefinitionMutationStatus()
  useProviderDeletionStatus()
  useProviderConnectionStatus()
  const catalogRefresh = useProviderCatalogRefreshStatus()
  const rotation = useProviderSecretRotationStatus()
  const [confirmingRemoval, setConfirmingRemoval] = useState(false)
  const isSession = provider.kind === 'session'
  const manageable = provider.tenantId !== undefined
  const mutationHeld = deleting || isProviderDefinitionHeld(provider.id) || isProviderConnectionHeld(provider.id)
  const controlsHeld = mutationHeld
  const requestRemoval = () => {
    if (!controlsHeld) setConfirmingRemoval(true)
  }
  const confirmRemoval = () => {
    if (controlsHeld) return
    const outcome = enqueueProviderDeletion(provider)
    if (!outcome) return
    setConfirmingRemoval(false)
    void outcome.then(() => onDeleted())
  }
  const rotate = () => {
    if (controlsHeld) return
    setError(null)
    if (!me) {
      setError('Wait for your account to finish loading, then try again.')
      return
    }
    const result = enqueueProviderSecretRotation({
      identityKey: `${me.user.id}:${me.tenant.id}:${me.via ?? 'unsigned'}`,
      tenantId: me.tenant.id,
      providerId: provider.id,
      expectedRevision: provider.connectionRevision ?? 0,
    })
    if (!result) setError('Wait for the current provider change to settle before rotating its secret.')
  }
  const refresh = () => {
    if (controlsHeld) return
    setError(null)
    if (!me) {
      setError('Wait for your account to finish loading, then try again.')
      return
    }
    const outcome = enqueueProviderCatalogRefresh({
      tenantId: me.tenant.id,
      providerId: provider.id,
      expectedRevision: provider.connectionRevision ?? 0,
    })
    if (!outcome) setError('Wait for the current provider change to settle before refreshing its model catalog.')
  }
  const overview = (
    <>
      <div className="flex flex-wrap items-center gap-1">
        {isSession && (
          <span className="flex items-center gap-1.5 rounded bg-panel-2 px-1.5 py-0.5 text-[10px] text-ink-faint">
            <span className={`h-1.5 w-1.5 rounded-full ${provider.online ? 'bg-added' : 'bg-ink-faint/50'}`} />
            {provider.online ? 'Session connected' : 'Offline — drain loop not running'}
          </span>
        )}
        {isSession && provider.online && typeof provider.conversationWindow === 'number' && (
          <span
            className="rounded bg-panel-2 px-1.5 py-0.5 text-[10px] text-ink-faint"
            title="What this session's binding declared it can serve concurrently — the platform admits no more."
          >
            {provider.activeConversations ? `Answering ${provider.activeConversations} of ` : 'Serves up to '}
            {provider.conversationWindow} conversation{provider.conversationWindow === 1 ? '' : 's'}
          </span>
        )}
        {isSession && <RelayBadge />}
        {!isSession && (
          <span
            className={`rounded px-1.5 py-0.5 text-[10px] ${
              provider.execution === 'unconfigured'
                ? 'bg-warn/10 text-warn-strong'
                : 'bg-panel-2 text-ink-faint'
            }`}
          >
            {provider.execution === 'unconfigured'
              ? 'Not configured'
              : provider.execution === 'mock'
                ? 'Development mock'
                : 'Connected endpoint'}
          </span>
        )}
        {provider.effortLevels.map((effort) => (
          <span key={effort} className="rounded bg-panel-2 px-1.5 py-0.5 text-[10px] text-ink-faint">
            {effort}
          </span>
        ))}
      </div>
      <p className="mt-2 text-[12px] text-ink-soft">Grants {authorityLabel(provider.authority)}</p>
      <p className="mt-0.5 text-[12px] text-ink-faint">{providerPlanLabel(provider)}</p>
      {provider.execution === 'unconfigured' && (
        <p className="mt-2 text-[12px] text-warn-strong">
          Turns are blocked before they are written. Add a configured provider for this account, or supply the
          built-in endpoint through the launch environment.
        </p>
      )}
      {error && <p className="mt-2 text-[12px] text-removed">{error}</p>}
    </>
  )

  const catalog = !isSession ? (
    <>
      {(provider.models?.length ?? 0) > 0 && (
        <div className="flex flex-wrap items-center gap-1">
          {provider.models!.map((model) => (
            <span
              key={model.id}
              title={modelBlurb(model)}
              className={`rounded px-1.5 py-0.5 text-[10px] ${
                model.id === provider.defaultModelId ? 'bg-accent/10 text-ink' : 'bg-panel-2 text-ink-faint'
              }`}
            >
              {model.label}
              {model.id === provider.defaultModelId && <span className="text-ink-faint"> · default</span>}
            </span>
          ))}
        </div>
      )}
      <p className="mt-1.5 text-[11px] text-ink-faint">
        {provider.models?.length
          ? provider.catalogSource === 'listed'
            ? `${provider.models.length} models, listed from its endpoint`
            : `${provider.models.length} models, declared at registration`
          : 'No model catalog — turns run its configured model.'}
      </p>
    </>
  ) : null

  const relay = isSession ? (
    <>
      <div className="flex items-center gap-2 text-[12px] text-ink-soft">
        <KeyRound size={12} className="shrink-0 text-ink-faint" />
        <span className="font-mono">rv_live_••••{provider.secretHint ?? '????'}</span>
      </div>
    </>
  ) : null

  return (
    <>
      <FoldSection
        title="Overview"
        summary={`${provider.kind === 'session' ? 'Session relay' : provider.modelFamily} · grants ${authorityLabel(provider.authority)}`}
        actions={
          <>
            {!isSession && provider.execution === 'unconfigured' && (
              <SectionAction label="Add configured provider" icon={<Plus size={14} />} onClick={onAdd} />
            )}
            {manageable && (
              <SectionAction
                label="Edit provider"
                icon={<Pencil size={14} />}
                onClick={onEdit}
                disabled={controlsHeld}
                disabledReason="Waiting for this Provider change to settle"
              />
            )}
            {manageable && onUpdateConnection && (
              <SectionAction
                label="Update connection"
                icon={<Plug size={14} />}
                onClick={onUpdateConnection}
                disabled={controlsHeld}
                disabledReason="Waiting for this Provider change to settle"
              />
            )}
            {manageable && (
              <SectionAction
                label="Remove provider"
                icon={<Trash2 size={14} />}
                onClick={requestRemoval}
                disabled={controlsHeld}
                disabledReason="Waiting for this Provider change to settle"
              />
            )}
          </>
        }
      >
        {overview}
      </FoldSection>
      {!isSession && (
        <FoldSection
          title="Models"
          summary={`${provider.models?.length ?? 0} model${provider.models?.length === 1 ? '' : 's'}`}
          actions={
            manageable && provider.catalogSource === 'listed' ? (
              <SectionAction
                label={catalogRefresh.activeResourceId === provider.id || isProviderCatalogRefreshHeld(provider.id)
                  ? 'Refreshing model catalog'
                  : 'Refresh model catalog'}
                icon={<RefreshCw size={14} />}
                onClick={refresh}
                disabled={controlsHeld}
                disabledReason="Waiting for this Provider change to settle"
              />
            ) : undefined
          }
        >
          {catalog}
        </FoldSection>
      )}
      {isSession && (
        <FoldSection
          title="Relay"
          summary={provider.online ? 'Session connected' : 'Offline'}
          actions={
            manageable ? (
              <SectionAction
                label={rotation.busy && rotation.activeResourceId === provider.id ? 'Rotating relay secret' : 'Rotate relay secret'}
                icon={<RefreshCw size={14} />}
                onClick={rotate}
                disabled={controlsHeld}
                disabledReason="Waiting for this Provider change to settle"
              />
            ) : undefined
          }
        >
          {relay}
        </FoldSection>
      )}
      {confirmingRemoval && (
        <ConfirmDialog
          title={`Remove ${provider.label}?`}
          body={PROVIDER_DELETE_SCOPE}
          confirmLabel="Remove provider"
          onConfirm={confirmRemoval}
          onCancel={() => setConfirmingRemoval(false)}
        />
      )}
    </>
  )
}

/** ── The A2A Agent Card viewer (D20) ─────────────────────────────────────────
 *  A published Agent's (or an imported peer's) machine-readable front door,
 *  *presented* — not dumped. Clicking "A2A card" used to navigate the browser to the
 *  raw JSON endpoint; this fetches the card and lays it out instead: the endpoint URL
 *  (the artifact you hand a foreign agent framework) with Copy front-and-centre, a
 *  legible summary (identity · protocol · capabilities · skills · auth), and the raw
 *  JSON with its own Copy plus an "Open raw" escape hatch. It is a read-only viewer
 *  with copy affordances, so it mirrors RelaySecretPanel's shell — not the FormDialog
 *  form shell. The fetch is client-side: a same-origin card loads; a foreign
 *  `importedFrom` card that blocks cross-origin reads degrades honestly to the URL +
 *  Copy + Open-raw (never the surprise raw tab the old link produced). */
const CARD_FACT_CLASS = 'rounded-md bg-panel-2 px-1.5 py-0.5 text-[11px] text-ink-soft'
const CARD_LABEL_CLASS = 'mb-1 text-[11px] font-medium uppercase tracking-wide text-ink-faint'

/** A boolean capability as a labelled ✓/✗ — present even when off, because "no
 *  streaming" is information a foreign framework acts on, not a nothing to omit. */
function CapabilityFact({ label, on }: { label: string; on: boolean }) {
  return (
    <span className="inline-flex items-center gap-1">
      {on ? (
        <Check size={12} className="text-ok-strong" />
      ) : (
        <MinusCircle size={12} className="text-ink-faint" />
      )}
      <span className={on ? 'text-ink' : 'text-ink-faint'}>{label}</span>
    </span>
  )
}

function A2aCardDialog({
  url,
  title = 'A2A Agent Card',
  onClose,
}: {
  /** The absolute card endpoint (ours: a2aAgentCardUrl(id); a peer's: importedFrom.url). */
  url: string
  title?: string
  onClose: () => void
}) {
  const [card, setCard] = useState<A2aAgentCard | null>(null)
  const [state, setState] = useState<'loading' | 'loaded' | 'error'>('loading')
  const dialogRef = useRef<HTMLDivElement>(null)
  useFocusTrap(dialogRef, onClose)

  useEffect(() => {
    let live = true
    setState('loading')
    setCard(null)
    fetch(url, { headers: { accept: 'application/json' } })
      .then((r) => (r.ok ? (r.json() as Promise<unknown>) : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((data) => {
        if (!live) return
        // The card may come from an untrusted foreign instance — a non-object, an
        // array, or a shape missing fields is possible. Accept only a plain object;
        // every field is then guarded at render (render what's present, tolerate the rest).
        if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('not a card')
        setCard(data as A2aAgentCard)
        setState('loaded')
      })
      .catch(() => {
        if (live) setState('error')
      })
    return () => {
      live = false
    }
  }, [url])

  const rawJson = card ? JSON.stringify(card, null, 2) : ''
  // A foreign card's `skills` array may hold non-objects (`[null]`, strings) — the
  // render dereferences `s.id`/`s.name`, so drop any element that isn't an object
  // (the "every field guarded at render" promise, extended to the elements).
  const skills = (Array.isArray(card?.skills) ? card!.skills : []).filter(
    (s): s is NonNullable<typeof s> => !!s && typeof s === 'object',
  )
  const schemes =
    card?.securitySchemes && typeof card.securitySchemes === 'object' ? Object.entries(card.securitySchemes) : []
  const modes = card
    ? [
        ...(Array.isArray(card.defaultInputModes) ? card.defaultInputModes : []).map((m) => `in: ${m}`),
        ...(Array.isArray(card.defaultOutputModes) ? card.defaultOutputModes : []).map((m) => `out: ${m}`),
      ]
    : []

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex justify-center px-4 pt-[10dvh]"
      // Portals keep REACT ancestry: this viewer may be opened from a whole-card
      // door, so a click inside the dialog must not bubble back through that card
      // and navigate away. The scrim owns dismissal on mouse-down below.
      onClick={(event) => event.stopPropagation()}
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div
        className={`${SCRIM_CLASS} backdrop-blur-[1px]`}
        aria-hidden
        onMouseDown={onClose}
      />
      <div
        ref={dialogRef}
        className={`relative flex max-h-[80dvh] w-[560px] max-w-full flex-col ${DIALOG_SURFACE_CLASS}`}
      >
        <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
          <div className="flex items-center gap-2">
            <Share2 size={18} className="text-ink-soft" />
            <span className="text-[15px] font-semibold text-ink">{title}</span>
          </div>
          <button
            onClick={onClose}
            title="Close"
            aria-label="Close"
            className="-mr-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-ink-faint transition hover:bg-panel-2 hover:text-ink"
          >
            <X size={16} />
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-5" aria-live="polite">
          {/* The endpoint URL is the point of the whole surface — the string you hand a
              foreign framework — so it leads, with Copy as the primary action. */}
          <div>
            <p className={CARD_LABEL_CLASS}>Card URL — hand this to a foreign agent framework</p>
            <div className="flex items-center gap-2 rounded-lg border border-line bg-panel px-3 py-2">
              <code className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap font-mono text-[12px] text-ink">{url}</code>
              <CopyButton text={url} label="Copy" ariaLabel="Copy card URL" />
            </div>
          </div>

          {state === 'loading' && (
            <div className="flex items-center gap-2 py-6 text-[13px] text-ink-faint">
              <Spinner size={15} /> Loading the card…
            </div>
          )}

          {state === 'error' && (
            <div className="rounded-lg border border-line bg-panel-2 px-3 py-2.5 text-[12px] leading-relaxed text-ink-soft">
              Couldn’t read the card from here — a foreign instance may be unreachable or block cross-origin
              reads. Copy the URL above to hand it on, or{' '}
              <a href={url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 font-medium text-accent hover:underline">
                open it raw <ExternalLink size={11} />
              </a>
              .
            </div>
          )}

          {state === 'loaded' && card && (
            <>
              <div className="space-y-1">
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                  <span className="text-[15px] font-semibold text-ink">{card.name}</span>
                  {card.version && <span className="text-[12px] text-ink-faint">v{card.version}</span>}
                </div>
                {card.provider?.organization && <p className="text-[12px] text-ink-faint">by {card.provider.organization}</p>}
                {card.description && <p className="text-[12px] leading-relaxed text-ink-soft">{card.description}</p>}
              </div>

              <div className="flex flex-wrap gap-1.5">
                {card.protocolVersion && <span className={CARD_FACT_CLASS}>A2A {card.protocolVersion}</span>}
                {card.preferredTransport && <span className={CARD_FACT_CLASS}>{card.preferredTransport}</span>}
                {modes.map((m) => (
                  <span key={m} className={CARD_FACT_CLASS}>
                    {m}
                  </span>
                ))}
              </div>

              {/* Capabilities shown explicitly (✓/✗), not silently omitted when false —
                  "no streaming" is a fact a foreign framework needs, not an absence. */}
              {card.capabilities && (
                <div>
                  <p className={CARD_LABEL_CLASS}>Capabilities</p>
                  <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-[12px] text-ink-soft">
                    <CapabilityFact label="Streaming" on={card.capabilities.streaming === true} />
                    <CapabilityFact label="Push notifications" on={card.capabilities.pushNotifications === true} />
                  </div>
                </div>
              )}

              {skills.length > 0 && (
                <div>
                  <p className={CARD_LABEL_CLASS}>Skills ({skills.length})</p>
                  <ul className="space-y-1.5">
                    {skills.map((s) => (
                      <li key={s.id} className="rounded-lg border border-line bg-panel-2 px-2.5 py-1.5">
                        <div className="text-[12px] font-medium text-ink">{s.name || s.id}</div>
                        {s.description && <div className="text-[11px] leading-snug text-ink-soft">{s.description}</div>}
                        {Array.isArray(s.tags) && s.tags.length > 0 && (
                          <div className="mt-1 flex flex-wrap gap-1">
                            {s.tags.map((t) => (
                              <span key={t} className="rounded bg-panel px-1 py-px text-[10px] text-ink-faint">
                                {t}
                              </span>
                            ))}
                          </div>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <div>
                <p className={CARD_LABEL_CLASS}>Authentication</p>
                {schemes.length > 0 ? (
                  <div className="space-y-0.5">
                    {schemes.map(([name, s]) => (
                      <p key={name} className="text-[12px] text-ink-soft">
                        <span className="font-medium text-ink">{name}</span>
                        {s && [s.type, s.scheme].filter(Boolean).length > 0
                          ? ` — ${[s.type, s.scheme].filter(Boolean).join(' ')}`
                          : ''}
                        {card.security ? ' · required' : ' · optional'}
                      </p>
                    ))}
                  </div>
                ) : (
                  <p className="text-[12px] text-ink-soft">Open — no authentication advertised.</p>
                )}
              </div>

              <div>
                <div className="mb-1 flex items-center justify-between gap-2">
                  <p className={`${CARD_LABEL_CLASS} mb-0`}>Raw card (JSON)</p>
                  <div className="flex items-center gap-3">
                    <a
                      href={url}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-[11px] text-ink-faint transition hover:text-ink"
                    >
                      <ExternalLink size={11} /> Open raw
                    </a>
                    <CopyButton text={rawJson} label="Copy JSON" ariaLabel="Copy raw card JSON" />
                  </div>
                </div>
                <pre className="max-h-52 overflow-auto rounded-lg border border-line bg-panel p-3 font-mono text-[11px] leading-relaxed text-ink-soft">
                  {rawJson}
                </pre>
              </div>
            </>
          )}
        </div>

        <div className="flex shrink-0 items-center justify-end border-t border-line bg-panel px-5 py-3">
          <button
            onClick={onClose}
            className={`${SOFT_BUTTON_CLASS} px-3.5 py-1.5 text-[13px] `}
          >
            Done
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}

/** Create / edit a Model provider. New providers pick their transport up front —
 *  an **API endpoint** we dial (slice 18) or **My AI session** (the delegated-cognition
 *  relay: nothing to dial, so the form asks only for a label; effort levels stay the
 *  standard vocabulary and are advisory on a session). New providers register the
 *  standard effort vocabulary and inherit the account plan + unrestricted authority
 *  (the advanced cascade fields aren't exposed here yet); the model family is editable
 *  because it drives the D10 prompt-fit warning. Minting a session kind hands back the
 *  one-time rendezvous secret, revealed via RelaySecretPanel before the dialog closes. */
function ProviderDialog({
  provider,
  onClose,
  onCreated,
}: {
  provider: ModelProvider | null
  onClose: () => void
  /** First-run Models owns the return policy; the canonical dialog only reports
   * a verified endpoint row after its write-only credential lifecycle succeeds. */
  onCreated?: (provider: CreatedProvider) => void
}) {
  // Freeze the editor's opening base. Ambient provider events may refresh the
  // page behind this held draft; sparse intent must still mean what the user
  // changed, not whatever a newer prop happens to contain.
  const original = useRef(provider).current
  const tenantId = useMe().data?.tenant.id
  const [label, setLabel] = useState(provider?.label ?? '')
  const [family, setFamily] = useState(provider?.modelFamily ?? 'claude')
  const [kind, setKind] = useState<'endpoint' | 'session'>(provider?.kind ?? 'endpoint')
  const [baseURL, setBaseURL] = useState('')
  const [model, setModel] = useState('')
  const [apiKeyEnv, setApiKeyEnv] = useState('')
  const [apiKey, setApiKey] = useState('')
  const hasSecureDeviceVault = desktopCredentialsAvailable()
  // The default flag (the UI shortcut — spec: agents always bind explicitly; this only
  // pre-selects the New-agent picker). Sent only when it changed, so an unrelated edit
  // can't move another entry's flag.
  const [isDefault, setIsDefault] = useState(provider?.isDefault ?? false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  // A freshly minted Session provider: hold the one-time secret panel open until
  // the user confirms they saved it — only then does the dialog resolve.
  const [minted, setMinted] = useState<CreatedProvider | null>(null)
  const isSession = kind === 'session'
  const labelChanged = !!provider && label.trim() !== (original?.label ?? '')
  const familyChanged = !!provider && !isSession && family.trim() !== (original?.modelFamily ?? '')
  const defaultChanged = !!provider && isDefault !== (original?.isDefault ?? false)
  const hasEditChanges = labelChanged || familyChanged || defaultChanged
  const canSubmit =
    label.trim().length > 0 &&
    (isSession || (family.trim().length > 0 && (provider !== null || baseURL.trim().length > 0))) &&
    (!!provider || !!tenantId) &&
    (!provider || hasEditChanges) &&
    !busy

  const submit = async () => {
    if (!canSubmit) return
    setBusy(true)
    setError(null)
    try {
      if (provider) {
        const outcome = await updateProviderDefinition(provider.id, {
          ...(labelChanged ? { label: label.trim() } : {}),
          ...(familyChanged ? { modelFamily: family.trim() } : {}),
          ...(defaultChanged ? { isDefault } : {}),
        })
        if (outcome === 'discarded') {
          setError('Your held edits were not saved. Review the latest provider, then apply what you still want.')
          setBusy(false)
          return
        }
        onClose()
      } else if (isSession) {
        const result = await enqueueProviderCreation({
          tenantId: tenantId!,
          request: {
            label: label.trim(),
            modelFamily: 'claude', // advisory on a session — the far side picks its own model
            effortLevels: ['Low', 'Medium', 'High'],
            kind: 'session',
            ...(isDefault ? { isDefault } : {}),
          },
        })
        if (result.outcome === 'discarded') {
          setError('Your provider details are still here. Review them, then create again when ready.')
          setBusy(false)
          return
        }
        if (!result.provider?.secret) {
          throw new Error('The provider was created, but its relay secret could not be confirmed. Open the provider and rotate its secret.')
        }
        setMinted(result.provider) // the one-time reveal takes over; onClose comes from its Done
      } else {
        const result = await enqueueProviderCreation({
          tenantId: tenantId!,
          request: {
            label: label.trim(),
            modelFamily: family.trim(),
            effortLevels: ['Low', 'Medium', 'High'],
            config: {
              baseURL: baseURL.trim(),
              ...(model.trim() ? { model: model.trim() } : {}),
              ...(!hasSecureDeviceVault && apiKeyEnv.trim() ? { apiKeyEnv: apiKeyEnv.trim() } : {}),
            },
            ...(isDefault ? { isDefault } : {}),
          },
          ...(hasSecureDeviceVault && apiKey.trim() ? { deviceSecret: apiKey.trim() } : {}),
        })
        if (result.outcome === 'discarded') {
          setError('Your provider details are still here. Review them, then create again when ready.')
          setBusy(false)
          return
        }
        if (!result.provider) {
          throw new Error('The provider acknowledgement was incomplete. Review the registry before trying again.')
        }
        onClose()
        onCreated?.(result.provider)
        return
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save this provider.')
      setBusy(false)
    }
  }

  if (minted?.secret) return <RelaySecretPanel provider={minted} secret={minted.secret} onClose={onClose} />

  return (
    <FormDialog
      title={provider ? 'Edit provider' : 'New provider'}
      icon={<Cpu size={18} className="text-ink-soft" />}
      submitLabel={provider ? 'Save' : 'Create'}
      canSubmit={canSubmit}
      onSubmit={submit}
      onClose={onClose}
      error={error}
      busy={busy}
    >
      {!provider && (
        <FormField label="Kind">
          {/* The transport toggle: dial-out endpoint vs the dialed-in session relay. */}
          <div className="flex gap-1 rounded-lg border border-line bg-panel p-1">
            {(
              [
                ['endpoint', 'API endpoint'],
                ['session', 'My AI session'],
              ] as const
            ).map(([value, text]) => (
              <button
                key={value}
                type="button"
                onClick={() => setKind(value)}
                className={`flex-1 rounded-md px-2 py-1 text-[12px] font-medium transition ${
                  kind === value ? 'bg-surface text-ink ring-1 ring-line-strong' : 'text-ink-faint hover:text-ink-soft'
                }`}
              >
                {text}
              </button>
            ))}
          </div>
          {isSession && (
            <span className="mt-1.5 flex items-start gap-1.5 text-[11px] text-ink-faint">
              <span className="mt-0.5 shrink-0">
                <RelayBadge />
              </span>
              An AI session you already run does the thinking — nothing to dial, no key. You get a one-time rendezvous
              secret and a drain loop to start; tool calls are relayed through your session unexecuted, so relation
              cards and escalations still land here as consent prompts.
            </span>
          )}
        </FormField>
      )}
      <FormField label="Name">
        <input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
          placeholder={isSession ? 'e.g. My laptop’s Claude' : 'e.g. Anthropic (prod)'}
          className={FORM_INPUT_CLASS}
        />
      </FormField>
      {!isSession && (
        <>
          <FormField label="Model family">
            <input
              value={family}
              onChange={(e) => setFamily(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && submit()}
              placeholder="claude"
              className={FORM_INPUT_CLASS}
            />
            <span className="mt-1 block text-[11px] text-ink-faint">
              A system prompt tuned for a different family shows a fit warning when picked.
            </span>
          </FormField>
          {!provider && (
            <>
              <FormField label="Messages API URL">
                <input
                  type="url"
                  value={baseURL}
                  onChange={(e) => setBaseURL(e.target.value)}
                  placeholder="https://models.example.com/v1"
                  className={FORM_INPUT_CLASS}
                />
                <span className="mt-1 block text-[11px] text-ink-faint">
                  Must answer the Anthropic Messages protocol. The connection is verified before it is saved.
                </span>
              </FormField>
              <FormField label="Model ID (optional)">
                <input
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  placeholder="provider-model-id"
                  className={FORM_INPUT_CLASS}
                />
              </FormField>
              {hasSecureDeviceVault ? (
                <FormField label="API key (optional)">
                  <input
                    type="password"
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    placeholder="Paste API key"
                    autoComplete="new-password"
                    spellCheck={false}
                    className={FORM_INPUT_CLASS}
                  />
                  <span className="mt-1 block text-[11px] text-ink-faint">
                    Encrypted for your OS account and kept outside Agent Commons data. The backend stores only a generated reference.
                  </span>
                </FormField>
              ) : (
                <FormField label="Credential variable (optional)">
                  <input
                    value={apiKeyEnv}
                    onChange={(e) => setApiKeyEnv(e.target.value.toUpperCase())}
                    placeholder="PROVIDER_TEAM_KEY"
                    className={FORM_INPUT_CLASS}
                  />
                  <span className="mt-1 block text-[11px] text-ink-faint">
                    Enter a <span className="font-mono">PROVIDER_*</span> variable already available to the server. Only its name is stored; the secret never enters this app.
                  </span>
                </FormField>
              )}
            </>
          )}
        </>
      )}
      <DefaultToggle checked={isDefault} onChange={setIsDefault} entity="provider" />
    </FormDialog>
  )
}

/** Replace a private endpoint provider's write-only connection without ever
 * reading its current endpoint or credential back into the renderer. Blank
 * fields mean "keep"; every supplied value is merged and the effective
 * connection is probed before the atomic server swap. */
function ProviderConnectionDialog({ provider, onClose }: { provider: ModelProvider; onClose: () => void }) {
  const me = useMe().data
  const mutation = useProviderConnectionStatus()
  const [baseURL, setBaseURL] = useState('')
  const [model, setModel] = useState('')
  const [apiKeyEnv, setApiKeyEnv] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const hasSecureDeviceVault = desktopCredentialsAvailable()
  const recoveryOwned = mutation.activeResourceId === provider.id && Boolean(mutation.error)
  const hasReplacement = Boolean(
    baseURL.trim() || model.trim() || (hasSecureDeviceVault ? apiKey.trim() : apiKeyEnv.trim()),
  )

  const submit = async () => {
    if (!hasReplacement || busy) return
    if (!me) {
      setError('Wait for your account to finish loading, then try again.')
      return
    }
    setBusy(true)
    setError(null)
    const attempt = createProviderConnectionAttempt(
      {
        ...(baseURL.trim() ? { baseURL: baseURL.trim() } : {}),
        ...(model.trim() ? { model: model.trim() } : {}),
        ...(!hasSecureDeviceVault && apiKeyEnv.trim() ? { apiKeyEnv: apiKeyEnv.trim() } : {}),
      },
      provider.connectionRevision ?? 0,
      hasSecureDeviceVault && apiKey.trim() ? apiKey.trim() : undefined,
      crypto.randomUUID(),
    )
    try {
      const outcome = enqueueProviderConnection({ tenantId: me.tenant.id, providerId: provider.id, attempt })
      if (!outcome) {
        setError('Wait for the current provider change to settle before updating its connection.')
        setBusy(false)
        return
      }
      if (await outcome === 'applied') onClose()
      else {
        setError('Your connection details are still here. Review them, then update again when ready.')
        setBusy(false)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not update this connection.')
      setBusy(false)
    }
  }

  return (
    <FormDialog
      title="Update connection"
      icon={<Plug size={18} className="text-ink-soft" />}
      submitLabel="Verify & update"
      canSubmit={hasReplacement && !busy}
      onSubmit={submit}
      onClose={onClose}
      error={error}
      busy={busy && !recoveryOwned}
      fieldsDisabled={busy}
      cancelLabel={recoveryOwned ? 'Close form' : 'Cancel'}
    >
      <p className="text-[12px] leading-relaxed text-ink-soft">
        Replace only what changed for <span className="font-medium text-ink">{provider.label}</span>. Existing connection
        details stay write-only; blank fields remain unchanged. The complete connection is verified before anything is saved.
      </p>
      <FormField label="Messages API URL" optional>
        <input
          type="url"
          value={baseURL}
          onChange={(e) => setBaseURL(e.target.value)}
          placeholder="New URL — leave blank to keep"
          className={FORM_INPUT_CLASS}
        />
      </FormField>
      <FormField label="Model ID" optional>
        <input
          value={model}
          onChange={(e) => setModel(e.target.value)}
          placeholder="New model — leave blank to keep"
          className={FORM_INPUT_CLASS}
        />
      </FormField>
      {hasSecureDeviceVault ? (
        <FormField label="Replacement API key" optional>
          <input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="Paste replacement API key"
            autoComplete="new-password"
            spellCheck={false}
            className={FORM_INPUT_CLASS}
          />
          <span className="mt-1 block text-[11px] text-ink-faint">
            Encrypted for your OS account. The previous device key is retired only after this connection is accepted.
          </span>
        </FormField>
      ) : (
        <FormField label="Replacement credential variable" optional>
          <input
            value={apiKeyEnv}
            onChange={(e) => setApiKeyEnv(e.target.value.toUpperCase())}
            placeholder="PROVIDER_REPLACEMENT_KEY"
            className={FORM_INPUT_CLASS}
          />
          <span className="mt-1 block text-[11px] text-ink-faint">
            Name a <span className="font-mono">PROVIDER_*</span> variable already available to the server. Its value never enters this app.
          </span>
        </FormField>
      )}
    </FormDialog>
  )
}

/** System prompts (D10) — the reusable, target-family-tagged prompts an Agent starts
 *  from. Each shows its target family and a downgrade warning when it wouldn't fit the
 *  default-else-first provider's family (the pure `promptFitWarning` against the same
 *  entry the New-agent picker pre-selects). */
function PromptsTab() {
  const rel = useRelations()
  const currentPrompts = useSystemPrompts().data ?? []
  useSystemPromptDeletionStatus()
  const prompts = [
    ...currentPrompts,
    ...heldSystemPromptDeletions().filter((held) =>
      !currentPrompts.some((prompt) => prompt.id === held.id)),
  ]
  const providers = useProviders().data ?? []
  const providerFamily = defaultEntry(providers)?.modelFamily ?? 'claude'
  const [editing, setEditing] = useState<SystemPromptEntry | null>(null)
  return (
    <div className={prompts.length === 0 ? '' : LEDGER_LIST_CLASS}>
      {prompts.length === 0 ? (
        <Empty>No system prompts yet.</Empty>
      ) : (
        prompts.map((p) => (
          <LibraryPromptCard
            key={p.id}
            prompt={p}
            providerFamily={providerFamily}
            onOpen={() => rel.navigate(AGENT_SECTION, p.id, 'prompts')}
            onEdit={() => setEditing(p)}
          />
        ))
      )}
      {editing && <PromptDialog prompt={editing} onClose={() => setEditing(null)} />}
    </div>
  )
}

function LibraryPromptCard({
  prompt,
  providerFamily,
  onOpen,
  onEdit,
}: {
  prompt: SystemPromptEntry
  providerFamily: string
  onOpen: () => void
  onEdit: () => void
}) {
  useSystemPromptDefinitionMutationStatus()
  useSystemPromptDeletionStatus()
  const warning = promptFitWarning(prompt, providerFamily)
  const deleting = isSystemPromptDeletionHeld(prompt.id)
  const mutationHeld = deleting || isSystemPromptDefinitionHeld(prompt.id)
  return (
    <div
      onClick={cardDoorClick(onOpen)}
      aria-busy={deleting}
      className={`${LEDGER_ROW_CLASS} ${ROW_DOOR_CLASS} group w-full items-center text-left`}
    >
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-panel-2 text-ink-soft">
        <FileText size={15} />
      </span>
      <span className="min-w-0 flex-1">
        <button onClick={onOpen} className={`block max-w-full truncate text-left text-[13px] font-medium text-ink ${DOOR_CLASS}`}>
          {prompt.label}
        </button>
        <span className="mt-0.5 line-clamp-1 text-[12px] text-ink-soft">{prompt.body}</span>
        <span className="mt-0.5 block text-[11px] text-ink-faint">
          {deleting ? 'Removing prompt… · ' : ''}Tuned for {prompt.targetFamily}
        </span>
      </span>
      <span className="flex shrink-0 items-center gap-1.5">
        {prompt.isDefault && <DefaultBadge />}
        {warning && <span title={warning} className="shrink-0 text-warn-strong"><AlertCircle size={15} /></span>}
        {prompt.tenantId ? (
          <CardActions
            onEdit={onEdit}
            disabled={mutationHeld}
            disabledReason="Waiting for this prompt change to settle"
          />
        ) : (
          <StatusPill tone="neutral" label="Built in" />
        )}
      </span>
    </div>
  )
}

/** The other half of Building blocks. Tools used to be visible only as a count
 *  or an opaque snake_case grant inside an agent editor. A material is a
 *  resource in the Agents tree, so it gets the same scannable list and
 *  canonical page as a prompt. */
function ToolsTab() {
  const rel = useRelations()
  const query = useAgentToolCatalog()
  const tools = query.data?.entries ?? []
  if (!query.data) return <Empty>Loading tools…</Empty>
  if (tools.length === 0) return <Empty>No tools available.</Empty>
  return (
    <div className={LEDGER_LIST_CLASS}>
      {tools.map((tool) => (
        <div
          key={tool.name}
          onClick={cardDoorClick(() => rel.navigate(AGENT_SECTION, tool.name, 'tools'))}
          className={`${LEDGER_ROW_CLASS} ${ROW_DOOR_CLASS} w-full text-left`}
        >
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-panel-2 text-ink-soft">
            <Plug size={15} />
          </span>
          <span className="min-w-0 flex-1">
            <button
              onClick={() => rel.navigate(AGENT_SECTION, tool.name, 'tools')}
              className={`block max-w-full truncate text-left text-[13px] font-medium text-ink ${DOOR_CLASS}`}
            >
              {agentToolLabel(tool.name)}
            </button>
            <span className="mt-0.5 line-clamp-2 text-[12px] leading-snug text-ink-faint">{tool.description}</span>
          </span>
          <span className="shrink-0 font-mono text-[10px] text-ink-faint">{tool.name}</span>
        </div>
      ))}
    </div>
  )
}

/** Create / edit a library system prompt. The model family drives the D10 fit warning;
 *  the body is the text an Agent built from this entry drives the model with. */
function PromptDialog({ prompt, onClose }: { prompt: SystemPromptEntry | null; onClose: () => void }) {
  // Freeze the opening row so ambient invalidation cannot reinterpret a remote
  // change as local intent while this draft is held for conflict recovery.
  const original = useRef(prompt).current
  const tenantId = useMe().data?.tenant.id
  const [label, setLabel] = useState(prompt?.label ?? '')
  const [family, setFamily] = useState(prompt?.targetFamily ?? 'claude')
  const [bodyText, setBodyText] = useState(prompt?.body ?? '')
  // The default flag (the UI shortcut) — sent only when changed, like ProviderDialog's.
  const [isDefault, setIsDefault] = useState(prompt?.isDefault ?? false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const labelChanged = !!prompt && label.trim() !== (original?.label ?? '')
  const familyChanged = !!prompt && family.trim() !== (original?.targetFamily ?? '')
  const bodyChanged = !!prompt && bodyText.trim() !== (original?.body ?? '')
  const defaultChanged = !!prompt && isDefault !== (original?.isDefault ?? false)
  const hasEditChanges = labelChanged || familyChanged || bodyChanged || defaultChanged
  const canSubmit =
    label.trim().length > 0 &&
    family.trim().length > 0 &&
    bodyText.trim().length > 0 &&
    bodyText.trim().length <= MAX_SYSTEM_PROMPT_BODY_CHARS &&
    (!!prompt || !!tenantId) &&
    (!prompt || hasEditChanges) &&
    !busy

  const submit = async () => {
    if (!canSubmit) return
    setBusy(true)
    setError(null)
    try {
      if (prompt) {
        const outcome = await updateSystemPromptDefinition(prompt.id, {
          ...(labelChanged ? { label: label.trim() } : {}),
          ...(familyChanged ? { targetFamily: family.trim() } : {}),
          ...(bodyChanged ? { body: bodyText.trim() } : {}),
          ...(defaultChanged ? { isDefault } : {}),
        })
        if (outcome === 'discarded') {
          setError('Your held edits were not saved. Review the latest prompt, then apply what you still want.')
          setBusy(false)
          return
        }
      } else {
        const outcome = await enqueueSystemPromptCreation({
          tenantId: tenantId!,
          request: {
            label: label.trim(),
            targetFamily: family.trim(),
            body: bodyText.trim(),
            ...(isDefault ? { isDefault: true } : {}),
          },
        })
        if (outcome === 'discarded') {
          setError('Your prompt details are still here. Review them, then create again when ready.')
          setBusy(false)
          return
        }
      }
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save this prompt.')
      setBusy(false)
    }
  }

  return (
    <FormDialog
      title={prompt ? 'Edit prompt' : 'New prompt'}
      icon={<FileText size={18} className="text-ink-soft" />}
      submitLabel={prompt ? 'Save' : 'Create'}
      canSubmit={canSubmit}
      onSubmit={submit}
      onClose={onClose}
      error={error}
      busy={busy}
    >
      <FormField label="Name">
        <input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
          placeholder="e.g. Concise code reviewer"
          className={FORM_INPUT_CLASS}
        />
      </FormField>
      <FormField label="Model family">
        <input
          value={family}
          onChange={(e) => setFamily(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
          placeholder="claude"
          className={FORM_INPUT_CLASS}
        />
        <span className="mt-1 block text-[11px] text-ink-faint">
          Picking this prompt on a provider of a different family shows a fit warning.
        </span>
      </FormField>
      <FormField label="Prompt">
        <textarea
          value={bodyText}
          onChange={(e) => setBodyText(e.target.value)}
          rows={5}
          maxLength={MAX_SYSTEM_PROMPT_BODY_CHARS}
          placeholder="The system prompt an Agent drives the model with."
          className={`${FORM_INPUT_CLASS} resize-none leading-relaxed`}
        />
      </FormField>
      <DefaultToggle checked={isDefault} onChange={setIsDefault} entity="prompt" />
    </FormDialog>
  )
}

/** Commissions (D7/D13) — every agent→Project assignment across all Projects, grouped by
 *  Project. Each row reuses the Contributor row, so it shows the same Project-clamped
 *  reach (D12) the Project detail does. */
function CommissionsTab() {
  const commissions = useCommissions().data ?? []
  const agents = useAgents().data ?? []
  const agentsById = new Map(agents.map((a) => [a.id, a]))
  const projects = useRelations().allProjects()
  const projectName = (id: string) => projects.find((p) => p.id === id)?.name ?? id

  if (commissions.length === 0) return <Empty>No commissions yet.</Empty>

  const byProject = new Map<string, Commission[]>()
  for (const c of commissions) {
    const list = byProject.get(c.projectId)
    if (list) list.push(c)
    else byProject.set(c.projectId, [c])
  }

  return (
    <div className="space-y-6">
      {[...byProject.entries()].map(([projectId, list]) => (
        <ProjectCommissionGroup
          key={projectId}
          projectId={projectId}
          title={projectName(projectId)}
          list={list}
          cap={projects.find((p) => p.id === projectId)?.commissionCap}
          agentsById={agentsById}
        />
      ))}
    </div>
  )
}

/** One project's Contributors, with the same Project-local track record as its
 * detail page. Read work once per group, never once per row. */
function ProjectCommissionGroup({
  projectId,
  title,
  list,
  cap,
  agentsById,
}: {
  projectId: string
  title: string
  list: Commission[]
  cap: number | undefined
  agentsById: Map<string, Agent>
}) {
  const resolvedHere = resolvedByCommission(useOpenSubGoals(projectId).data ?? [])
  return (
    <div>
      <div className={`flex items-center justify-between gap-2 pb-2 ${LEDGER_RULE_CLASS}`}>
        <span className="text-[11px] font-semibold uppercase tracking-wide text-ink-faint">{title}</span>
        {cap !== undefined && (
          <span
            title={`Per-commissioner abuse cap: ${list.length} of ${cap} commissions used`}
            className={`shrink-0 rounded-full px-1.5 py-px text-[10px] font-medium ${
              list.length >= cap ? 'bg-removed/10 text-removed' : 'bg-ink/5 text-ink-soft'
            }`}
          >
            {list.length} / {cap} commissioned
          </span>
        )}
      </div>
      <CardList>
        {list.map((c) => (
          <div key={c.id} className="py-3">
            <ContributorRow
              commission={c}
              agentLabel={agentsById.get(c.agentId)?.label ?? c.agentLabel ?? c.agentId}
              contributions={agentsById.get(c.agentId)?.contributions}
              resolvedHere={resolvedHere.get(c.id)}
            />
          </div>
        ))}
      </CardList>
    </div>
  )
}

/** The AGENT discovery directory (docs/agent-commons.md, D17/D18) — published
 *  Agent definitions any account may fork. Agent-only since the Discover
 *  consolidation (social S4): the shared-PROJECT directory moved to the
 *  Commons' Browse band — resources are discovered where resources live, and
 *  the Agents hub keeps what it's for, definitions. Still a searchable LIST,
 *  not a feed: the directory never widens visibility, and ranking is a policy
 *  this prototype doesn't take. */
function DiscoverTab({ onOpenAgentPage }: { onOpenAgentPage: (agentId: string) => void }) {
  const rel = useRelations()
  const [q, setQ] = useState('')
  const query = q.trim() || undefined
  const agents = useAgentDirectory(query).data ?? []
  // Every owner byline is a DOOR to the owner's profile page (D21) — the one
  // "everything they share" surface (it subsumed the old filter chip).
  return (
    <div className="space-y-6">
      <div className="relative">
        <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search published agents…"
          aria-label="Search the agent directory"
          className={`${FORM_INPUT_CLASS} pl-8`}
        />
      </div>

      <div>
        <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
          Published agents
        </div>
        {agents.length === 0 ? (
          <Empty>No published agents{query ? ' match' : ' yet — publish one from the Agents tab'}.</Empty>
        ) : (
          <CardList>
            {agents.map((a) => (
              <PublishedAgentRow
                key={a.id}
                entry={a}
                onView={() => onOpenAgentPage(a.id)}
                onOwnerClick={() => rel.openOwner(a.owner)}
              />
            ))}
          </CardList>
        )}
      </div>

      <ImportAgentCardForm onOpenAgent={onOpenAgentPage} />
    </div>
  )
}

/** One shared Project in the Commons — the same synopsis row used in Browse and
 *  on a namespace profile. The project page owns the full description, roster,
 *  coordination state, and open-work detail; this directory face only helps the
 *  reader choose a destination. */
function SharedProjectRow({
  entry: p,
  onOpen,
  onOwnerClick,
}: {
  entry: ProjectDirectoryEntry
  onOpen: () => void
  onOwnerClick: () => void
}) {
  return (
    <SynopsisRow
      title={p.name}
      description={
        <>
          <OwnerLink ownerName={p.owner} own={p.own} onClick={onOwnerClick} />
          {p.description ? ` · ${p.description}` : ''}
        </>
      }
      meta={`${p.openWorkCount > 0 ? `${p.openWorkCount} open · ` : ''}${
        p.contributorCount > 0
          ? `${p.contributorCount} contributor${p.contributorCount === 1 ? '' : 's'}`
          : 'Open to contributors'
      }${p.guarded ? ' · coordinated' : ''} · ${shortRelativeTime(p.updatedAt)}`}
      onOpen={onOpen}
    />
  )
}

/** ── The namespace profile page (docs/agent-commons.md, D21) ────────────────
 *  A display name's ONE public face — the GitHub-user-page analog: everything the
 *  owner shares (projects, agents), their public track record, and their recent
 *  public acts. Served viewer-independent except the own-marker cue (minted by
 *  profileTitle, never inline): the owner sees this page exactly as visitors do,
 *  which is the point. Reached from any owner byline (directory rows, a shared
 *  project's header, a search hit). */
/** FWD-6 O3 — the org page's MEMBER panel: visible only to seats (the profile's
 *  viewer-relative `org` field). Everyone inside sees the roster; the OWNER also
 *  manages invitations (invite by email — existence-hidden server-side — and
 *  revoke pending ones). Everything public on this page stays identical for
 *  every viewer; this panel is the capability-gated affordance (COMMONS-13). */
function OrgMemberPanel({ org }: { org: NonNullable<OwnerProfile['org']> }) {
  const members = useOrgMembers(org.id).data ?? []
  const isOwner = org.role === 'owner'
  const inviteState = useOrgInvites(org.id, isOwner)
  const invites = inviteState.data ?? []
  const me = useMe().data
  const mutation = useOrgInviteOwnerStatus()
  const heldIssue = heldOrgInviteIssue(org.id)
  const heldRevokes = heldOrgInviteRevokes(org.id)
  const ownerActionHeld = isOrgInviteOwnerActionHeld(org.id)
  const [email, setEmail] = useState('')
  const [error, setError] = useState('')
  const visibleEmail = heldIssue?.request.email ?? email
  const pending = [
    ...invites.filter((invitation) => invitation.status === 'invited'),
    ...heldRevokes
      .map((held) => held.invitation)
      .filter((held) => !invites.some((invitation) => invitation.id === held.id && invitation.status === 'invited')),
  ]
  const normalizedEmail = visibleEmail.trim().toLowerCase()
  const duplicatePending = !!normalizedEmail && pending.some(
    (invitation) => invitation.email.trim().toLowerCase() === normalizedEmail,
  )
  const ledgerReady = inviteState.status === 'success'
  const issueFailed = !!heldIssue &&
    mutation.activeResourceId === orgInviteOwnerResourceId(heldIssue) &&
    !!mutation.error
  const invite = async () => {
    if (ownerActionHeld || !me || !ledgerReady || !visibleEmail.trim() || duplicatePending) return
    setError('')
    try {
      const outcome = await enqueueOrgInviteIssue({
        orgId: org.id,
        ownerUserId: me.user.id,
        email: visibleEmail,
        baselineInvites: invites,
      })
      if (outcome === 'applied') setEmail('')
      else setError('Invitation action dismissed. Check the ledger before trying again.')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not prepare invitation recovery.')
    }
  }
  const revoke = async (invitation: (typeof pending)[number]) => {
    if (ownerActionHeld) return
    setError('')
    try {
      const outcome = await enqueueOrgInviteRevoke(org.id, invitation)
      if (outcome === 'discarded') setError('Revocation dismissed. Check the invitation status before trying again.')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not prepare revocation recovery.')
    }
  }
  return (
    <div
      data-testid="org-member-panel"
      data-org-invite-owner-panel={ownerActionHeld ? (mutation.error ? 'failed' : 'pending') : undefined}
      aria-busy={ownerActionHeld ? 'true' : undefined}
      className="rounded-lg border border-line bg-panel p-3"
    >
      <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
        Members <span className="ml-1 normal-case font-normal">— you hold the {org.role} seat</span>
      </div>
      <ul className="space-y-1 text-[12px] text-ink-soft">
        {members.map((m, i) => (
          <li key={`${m.name}-${i}`} className="flex items-center gap-2">
            <span className="min-w-0 flex-1 truncate">{m.name}</span>
            <span className="text-[10px] uppercase tracking-wide text-ink-faint">{m.role}</span>
          </li>
        ))}
      </ul>
      {isOwner && (
        <div className="mt-3 border-t border-line pt-2.5">
          <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-faint">Invitations</div>
          {pending.length > 0 && (
            <ul className="mb-2 space-y-1 text-[12px] text-ink-soft">
              {pending.map((invitation) => {
                const held = heldOrgInviteRevoke(invitation.id)
                const failed = !!held &&
                  mutation.activeResourceId === orgInviteOwnerResourceId(held) &&
                  !!mutation.error
                return (
                  <li
                    key={invitation.id}
                    data-testid="org-invite-owner-row"
                    data-org-invite-owner-row={held ? (failed ? 'failed' : 'pending') : undefined}
                    className="flex items-center gap-2"
                  >
                    <span className="min-w-0 flex-1 truncate">{invitation.email}</span>
                    <button
                      onClick={() => void revoke(invitation)}
                      disabled={ownerActionHeld}
                      className={`${INLINE_ACTION_CLASS} disabled:opacity-50`}
                      title="Withdraw this pending invitation"
                    >
                      {held ? (failed ? 'Revoke held' : 'Revoking…') : 'Revoke'}
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
          <div className="flex items-center gap-1.5">
            <input
              value={visibleEmail}
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && !e.nativeEvent.isComposing && void invite()}
              disabled={ownerActionHeld}
              placeholder="Invite by email…"
              aria-label="Invite by email"
              className={`${FORM_INPUT_CLASS} flex-1`}
            />
            <button
              onClick={() => void invite()}
              disabled={ownerActionHeld || !visibleEmail.trim() || !ledgerReady || duplicatePending}
              className={INLINE_ACTION_CLASS}
            >
              {heldIssue ? (issueFailed ? 'Invite held' : 'Inviting…') : duplicatePending ? 'Already invited' : 'Invite'}
            </button>
          </div>
          {inviteState.status === 'loading' && inviteState.data === undefined && (
            <p className="mt-1 text-[11px] text-ink-faint">Loading invitations…</p>
          )}
          {inviteState.status === 'error' && (
            <p className="mt-1 text-[11px] text-removed">
              Couldn’t refresh invitations.{' '}
              <button
                onClick={() => retryResourceQueries([keys.orgInvites(org.id)])}
                className={INLINE_ACTION_CLASS}
              >
                Retry
              </button>
            </p>
          )}
          {error && <p className="mt-1 text-[11px] text-removed">{error}</p>}
        </div>
      )}
    </div>
  )
}

function OwnerProfilePage({
  name,
  sectionId,
  onOpenProject,
  onOpenAgentPage,
  onBack,
  backTo,
}: {
  name: string
  sectionId?: string | null
  onOpenProject: (id: string) => void
  onOpenAgentPage: (agentId: string) => void
  onBack: () => void
  backTo: NavLocation | null
}) {
  const rel = useRelations()
  const state = useOwnerProfile(name)
  const profile = state.data
  // S18 — the header's aggregate counts anchor to the Published-agents band, where
  // each definition carries its own per-agent lineage doors.
  const agentsBandRef = useRef<HTMLDivElement>(null)
  // S7 — the follow bands' anchor, so the header counts can open what they count.
  const followBandRef = useRef<HTMLDivElement>(null)
  if (!profile) {
    return (
      <UnavailableResourcePage
        title="Profile"
        state={resolveResourceUnavailable([state], { notFoundIsMissing: true })}
        message={`“${name}” shares nothing publicly — or doesn’t exist.`}
        backTo={backTo}
        onBack={onBack}
        onRetry={() => retryResourceQueries([keys.ownerProfile(name)])}
      />
    )
  }
  const s = profile.stats
  const selectedSection = ownerProfileSection(sectionId)
  const showProfileSection = (id: OwnerProfileSectionId) =>
    !selectedSection || selectedSection.id === id
  return (
    <CompositeResourcePage section="commons" sectionPage={selectedSection !== undefined}>
      <header className={PAGE_HEADER_CLASS}>
        <div className="flex min-w-0 items-start gap-3.5">
        <BackButton to={backTo} onBack={onBack} />
        {/* The identity mark at page scale — the same derived mark every byline
            wears (identity texture; the Globe stays the SHARED-entity cue). */}
        <IdentityMark name={profile.name} size={48} />
        <div className="min-w-0">
          <h1 className={PAGE_TITLE_CLASS}>
            {profileTitle(profile.name, profile.own)}
          </h1>
          {selectedSection && (
            <p className="mt-0.5 text-[13px] font-medium text-ink-soft">{selectedSection.label}</p>
          )}
          <p className="mt-0.5 text-[13px] text-ink-soft">{profileTagline(profile.name)}</p>
          {!selectedSection && <p className="mt-2 flex flex-wrap items-center gap-3 text-[11px] text-ink-faint">
            {/* The aggregate counts sum this owner's agents — the door lands on
                the Published-agents band, whose cards carry the per-agent lineage. */}
            <CreditLine
              contributions={s.contributions}
              forks={s.forks}
              onContributions={() => agentsBandRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })}
              onForks={() => agentsBandRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })}
            />
            <span>
              {s.sharedProjects} shared project{s.sharedProjects === 1 ? '' : 's'}
            </span>
            <span>
              {s.publishedAgents} published agent{s.publishedAgents === 1 ? '' : 's'}
            </span>
            {s.openWork > 0 && (
              <span title={`Open work items awaiting a taker across ${profile.name}'s shared projects`}>
                {s.openWork} open work item{s.openWork === 1 ? '' : 's'}
              </span>
            )}
            {/* S7 — the follow counts are DOORS to their bands below, the same
                move `CreditLine` makes for contributions/forks: a count you
                cannot open is a dead end, and "who follows me" is the question
                the number provokes. */}
            <button onClick={() => followBandRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })} className={STANDING_DOOR_CLASS}>
              {profile.follow.followers} follower{profile.follow.followers === 1 ? '' : 's'}
            </button>
            <button onClick={() => followBandRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })} className={STANDING_DOOR_CLASS}>
              {profile.follow.following} following
            </button>
          </p>}
        </div>
        </div>
        {/* The two acts a PERSON affords — the only controls on this page that
            act on the owner rather than navigating within it. Absent on your
            own profile, where the server reports neither (you cannot follow or
            message yourself). */}
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {!profile.own && (
            <FollowButton name={profile.name} following={profile.follow.youFollow === true} ready={!!profile} />
          )}
          {profile.follow.canMessage === true && (
            <MessageButton name={profile.name} dmId={profile.follow.dmId} onOpenDiscussion={(did) => rel.navigate('discussions', did)} />
          )}
        </div>
      </header>

      {!selectedSection && <CompositePageControls section="commons" />}
      <div>
        {showProfileSection('organization') && profile.org && (
          <FoldSection title="Organization" summary={`${profile.org.role} seat`}>
            <OrgMemberPanel org={profile.org} />
          </FoldSection>
        )}

        {/* S7 — the follow graph, walkable. Placed first among the bands because
            a profile is a PERSON's page and these are the person-to-person
            relations; the resource bands below are what they've published. */}
        {/* Two columns only when the PAGE is wide enough — `@2xl`, not `sm:`.
            This page renders inside split panes, so a viewport gate would put
            two roster columns in a 380px pane on a wide window (the UI-9 rule,
            locked by src/components/pane-safe-layout.test.ts — which caught this). */}
        {showProfileSection('network') && <div ref={followBandRef}>
          <FoldSection
            title="Network"
            summary={`${profile.follow.followers} followers · ${profile.follow.following} following`}
          >
            <div className="grid gap-6 @2xl:grid-cols-2">
              <FollowRosterBand
                title="Followers"
                rows={profile.follow.followerList}
                total={profile.follow.followers}
                emptyText={profile.own ? 'Nobody follows you yet.' : `Nobody follows ${profile.name} yet.`}
                onOpenOwner={(n) => rel.openOwner(n)}
              />
              <FollowRosterBand
                title="Following"
                rows={profile.follow.followingList}
                total={profile.follow.following}
                emptyText={profile.own ? 'You aren’t following anyone yet.' : `${profile.name} isn’t following anyone yet.`}
                onOpenOwner={(n) => rel.openOwner(n)}
              />
            </div>
          </FoldSection>
        </div>}

        {showProfileSection('shared-projects') && <FoldSection
          title="Shared projects"
          summary={`${profile.projects.length} project${profile.projects.length === 1 ? '' : 's'}`}
        >
          {profile.projects.length === 0 ? (
            <Empty>No shared projects.</Empty>
          ) : (
            <CardList>
              {profile.projects.map((p) => (
                <SharedProjectRow
                  key={p.id}
                  entry={p}
                  onOpen={() => onOpenProject(p.id)}
                  onOwnerClick={() => rel.openOwner(p.owner)}
                />
              ))}
            </CardList>
          )}
        </FoldSection>}

        {/* Commons activity (S5 profiles): what this owner PUBLISHED and
            LANDED — a viewer-walled projection of the feed (the caller's own
            Commons read filtered to this actor, so the wall math is the feed's;
            display names are the D21 handle, matching the page's identity key). */}
        {showProfileSection('commons-activity') && <ProfileCommonsBand actor={profile.name} />}

        {showProfileSection('published-agents') && <div ref={agentsBandRef}>
          <FoldSection
            title="Published agents"
            summary={`${profile.agents.length} agent${profile.agents.length === 1 ? '' : 's'}`}
          >
            {profile.agents.length === 0 ? (
              <Empty>No published agents.</Empty>
            ) : (
              <CardList>
                {profile.agents.map((a) => (
                  <PublishedAgentRow
                    key={a.id}
                    entry={a}
                    onView={() => onOpenAgentPage(a.id)}
                    onOwnerClick={() => rel.openOwner(a.owner)}
                  />
                ))}
              </CardList>
            )}
          </FoldSection>
        </div>}

        {showProfileSection('recent-public-activity') && <FoldSection
          title="Recent public activity"
          summary={`${s.workPosted} posted · ${s.workResolved} resolved`}
        >
          {profile.activity.length === 0 ? (
            <Empty>No public activity yet — posting or resolving open work shows up here.</Empty>
          ) : (
            <ul className="space-y-1.5">
              {profile.activity.map((a) => (
                <li
                  key={`${a.kind}-${a.projectId ?? a.agentLabel}-${a.subGoal}-${a.at}`}
                  className="flex items-baseline gap-2 text-[12px] text-ink-soft"
                >
                  {a.kind === 'authored' ? (
                    // D27 — merged-proposal authorship on another owner's definition. S9:
                    // the definition is a ref link to its owner's profile (like the
                    // posted/resolved project doors) — same role ⇒ same affordance.
                    <span className="min-w-0">
                      Authored <span className="font-medium text-ink">v{a.version}</span> of{' '}
                      {a.agentId ? (
                        // The definition now has its OWN page (COMMONS-26) — the truer door
                        // than the owner's profile the pre-page S9 link settled for.
                        <button
                          onClick={() => onOpenAgentPage(a.agentId!)}
                          className={INLINE_ACTION_CLASS}
                          title={`Open ${a.agentLabel}`}
                        >
                          {a.agentLabel}
                        </button>
                      ) : a.owner ? (
                        <button
                          onClick={() => rel.openOwner(a.owner!)}
                          className={INLINE_ACTION_CLASS}
                          title={`Open ${a.owner}’s profile`}
                        >
                          {a.agentLabel}
                        </button>
                      ) : (
                        <span className="font-medium text-ink">{a.agentLabel}</span>
                      )}
                      {a.subGoal ? ` — ${a.subGoal}` : ''}
                    </span>
                  ) : (
                    <span className="min-w-0">
                      {a.kind === 'posted' ? 'Posted' : 'Resolved'}{' '}
                      <span className="font-medium text-ink">{a.subGoal}</span>
                      {' on '}
                      <button
                        onClick={() => a.projectId && onOpenProject(a.projectId)}
                        className={INLINE_ACTION_CLASS}
                      >
                        {a.projectName}
                      </button>
                      {a.agentLabel ? ` via ${a.agentLabel}` : ''}
                    </span>
                  )}
                  <span className="ml-auto shrink-0 text-[11px] text-ink-faint">{relativeTime(a.at)}</span>
                </li>
              ))}
            </ul>
          )}
        </FoldSection>}

        {selectedSection?.id === 'organization' && !profile.org && (
          <PageEmpty>This profile has no organization section.</PageEmpty>
        )}
      </div>

    </CompositeResourcePage>
  )
}

/** The outbound A2A half (docs/a2a-integration.md, D20): paste a remote instance's
 *  Agent Card URL and the server fetches it into a private, UNBOUND definition-stub
 *  agent with `importedFrom` lineage — fork-across-instances, and like a fork the
 *  capability never travels: you bind your own model, authority, and budget. */
function ImportAgentCardForm({ onOpenAgent }: { onOpenAgent: (agentId: string) => void }) {
  const me = useMe().data
  useAgentImportStatus()
  const heldUrl = heldAgentImportUrl()
  const [url, setUrl] = useState(() => heldUrl ?? '')
  const [error, setError] = useState<string | null>(null)
  const mountedRef = useRef(false)
  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])
  useEffect(() => {
    if (heldUrl) setUrl(heldUrl)
  }, [heldUrl])
  const importCard = async () => {
    const frozenUrl = url.trim()
    if (!me || heldUrl || !frozenUrl) return
    setError(null)
    try {
      const result = await enqueueAgentImport({
        tenantId: me.tenant.id,
        request: { url: frozenUrl },
      })
      if (result.outcome === 'applied' && mountedRef.current) {
        onOpenAgent(result.agentId)
      } else if (result.outcome === 'discarded' && mountedRef.current) {
        setError('The Agent Card wasn’t imported. Review the URL and try again.')
      }
    } catch (e) {
      if (mountedRef.current) {
        setError(e instanceof Error ? e.message : 'Could not import this Agent Card.')
      }
    }
  }
  return (
    <div>
      <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
        Import from another instance
      </div>
      <div className="flex items-center gap-1.5">
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && void importCard()}
          placeholder="A2A Agent Card URL (…/a2a/agents/{id}/card)…"
          aria-label="Agent Card URL"
          disabled={!!heldUrl}
          className="min-w-0 flex-1 rounded-md border border-line bg-surface px-2 py-1 text-[12px] text-ink outline-none placeholder:text-ink-faint focus:border-line-strong"
        />
        <button
          onClick={() => void importCard()}
          disabled={!!heldUrl || !me || !url.trim()}
          aria-busy={!!heldUrl || undefined}
          className={`shrink-0 ${SOFT_BUTTON_CLASS} px-2.5 py-1 text-[12px] disabled:opacity-45`}
        >
          {heldUrl ? 'Importing…' : 'Import'}
        </button>
      </div>
      <p className="mt-1.5 text-[11px] text-ink-faint">
        The card&rsquo;s definition becomes a private agent with lineage — capability never travels:
        you bind your own model, authority, and budget.
      </p>
      {error && <p className="mt-1 text-[12px] text-removed">{error}</p>}
    </div>
  )
}

/** One published Agent in the directory. The canonical page owns its definition,
 *  track record and Fork act; this row keeps the public prompt synopsis and the
 *  smallest useful lineage counts without compressing that page into a card. */
function PublishedAgentRow({
  entry,
  onView,
  onOwnerClick,
}: {
  entry: AgentDirectoryEntry
  onView: () => void
  onOwnerClick: () => void
}) {
  return (
    <SynopsisRow
      title={entry.label}
      description={
        <>
          <OwnerLink ownerName={entry.owner} own={entry.own} onClick={onOwnerClick} />
          {` · ${entry.systemPrompt}`}
        </>
      }
      meta={`${entry.tools.length} tool${entry.tools.length === 1 ? '' : 's'} · ${
        entry.contributions
      } contribution${entry.contributions === 1 ? '' : 's'} · ${entry.forks} fork${entry.forks === 1 ? '' : 's'}`}
      onOpen={onView}
    />
  )
}

function AgentFactRow({ label, value, onOpen }: { label: string; value: string; onOpen?: () => void }) {
  return (
    <div className={LEDGER_ROW_CLASS}>
      <span className="w-24 shrink-0 text-[11px] font-semibold uppercase tracking-wide text-ink-faint">{label}</span>
      {onOpen ? (
        <button onClick={onOpen} className={`min-w-0 text-left text-[13px] text-ink ${DOOR_CLASS}`}>{value}</button>
      ) : (
        <span className="min-w-0 text-[13px] leading-relaxed text-ink-soft">{value}</span>
      )}
    </div>
  )
}

function PromptDetailPage({
  prompt,
  state,
  onBack,
  backTo,
  onRetry,
  onDeleted,
}: {
  prompt: SystemPromptEntry | null
  state: ResourceUnavailableState
  onBack: () => void
  backTo: NavLocation | null
  onRetry: () => void
  onDeleted: () => void
}) {
  const providers = useProviders().data ?? []
  const defaultFamily = defaultEntry(providers)?.modelFamily ?? 'claude'
  const [editing, setEditing] = useState(false)
  const [confirmingRemoval, setConfirmingRemoval] = useState(false)
  useSystemPromptDefinitionMutationStatus()
  useSystemPromptDeletionStatus()
  if (!prompt) {
    return (
      <UnavailableResourcePage
        title="Prompt"
        state={state}
        message="This prompt does not exist."
        backTo={backTo}
        onBack={onBack}
        onRetry={onRetry}
      />
    )
  }
  const deleting = isSystemPromptDeletionHeld(prompt.id)
  const mutationHeld = deleting || isSystemPromptDefinitionHeld(prompt.id)
  const confirmRemoval = () => {
    if (mutationHeld) return
    const outcome = enqueueSystemPromptDeletion(prompt)
    setConfirmingRemoval(false)
    void outcome.then((settled) => {
      if (settled === 'applied') onDeleted()
    })
  }
  const warning = promptFitWarning(prompt, defaultFamily)
  return (
    <AtomicResourcePage aria-busy={deleting}>
      <PageHeader
        title={prompt.label}
        badge={prompt.tenantId
          ? (prompt.isDefault ? <StatusPill tone="ok" label="Default" /> : undefined)
          : <StatusPill tone="neutral" label={prompt.isDefault ? 'Built in · Default' : 'Built in'} />}
        subtitle={`${deleting ? 'Removing prompt… · ' : ''}Prompt · Tuned for ${prompt.targetFamily}`}
      >
        {prompt.tenantId && (
          <PageActionButton
            icon={<Pencil size={14} />}
            onClick={() => setEditing(true)}
            disabled={mutationHeld}
          >
            Edit prompt
          </PageActionButton>
        )}
      </PageHeader>
      <FoldSection
        title="Prompt"
        summary="Text injected into an agent before its task instructions."
        actions={prompt.tenantId ? (
          <SectionAction
            label="Remove prompt"
            icon={<Trash2 size={14} />}
            onClick={() => setConfirmingRemoval(true)}
            disabled={mutationHeld}
            disabledReason="Waiting for this prompt change to settle"
          />
        ) : undefined}
      >
        <pre className="whitespace-pre-wrap rounded-lg border border-line bg-panel-2 p-3 font-sans text-[12px] leading-relaxed text-ink-soft">{prompt.body}</pre>
      </FoldSection>
      <FoldSection title="Compatibility" summary={`Authored for ${prompt.targetFamily}`}>
        <div className={LEDGER_LIST_CLASS}>
          <AgentFactRow label="Target" value={prompt.targetFamily} />
          <AgentFactRow label="Current default" value={defaultFamily} />
          <AgentFactRow label="Fit" value={warning ?? 'Matches the default provider family'} />
        </div>
      </FoldSection>
      {editing && prompt.tenantId && <PromptDialog prompt={prompt} onClose={() => setEditing(false)} />}
      {confirmingRemoval && (
        <ConfirmDialog
          title={`Remove ${prompt.label}?`}
          body={SYSTEM_PROMPT_DELETE_SCOPE}
          confirmLabel="Remove prompt"
          onConfirm={confirmRemoval}
          onCancel={() => setConfirmingRemoval(false)}
        />
      )}
    </AtomicResourcePage>
  )
}

function ToolDetailPage({
  tool,
  toolId,
  state,
  onBack,
  backTo,
  onRetry,
}: {
  tool: AgentToolEntry | null
  toolId: string
  state: ResourceUnavailableState
  onBack: () => void
  backTo: NavLocation | null
  onRetry: () => void
}) {
  if (!tool) {
    return (
      <UnavailableResourcePage
        title="Tool"
        state={state}
        message={`The tool “${agentToolLabel(toolId)}” is not available.`}
        backTo={backTo}
        onBack={onBack}
        onRetry={onRetry}
      />
    )
  }
  return (
    <AtomicResourcePage>
      <PageHeader title={agentToolLabel(tool.name)} subtitle="Tool · Built-in agent material" />
      <FoldSection title="Capability" summary={tool.description}>
        <p className="text-[13px] leading-relaxed text-ink-soft">{tool.description}</p>
      </FoldSection>
      <FoldSection title="Grant" summary="The exact capability token stored on an agent.">
        <div className={LEDGER_LIST_CLASS}>
          <AgentFactRow label="Token" value={tool.name} />
          <AgentFactRow label="Availability" value="Built in to this workspace" />
        </div>
      </FoldSection>
    </AtomicResourcePage>
  )
}

/** The one Agent entity page (COMMONS-26), shared by owner and visitor. An
 *  unpublished owned definition still resolves here; a visitor can resolve only
 *  the published directory projection. Capability changes controls and private
 *  sections, never the address or the page component. */
function AgentPublicPage({
  agentId,
  onOpenAgent,
  onBack,
  backTo,
}: {
  agentId: string
  /** Door to ANOTHER definition's page (a public fork row) — the same opener the
   *  directory rows use, so lineage hops stay on canonical pages. */
  onOpenAgent: (agentId: string) => void
  onBack: () => void
  backTo: NavLocation | null
}) {
  const rel = useRelations()
  const entries = useAgentDirectory(undefined)
  const agentsQ = useAgents()
  const meQ = useMe()
  const me = meQ.data
  const providers = useProviders().data ?? []
  const prompts = useSystemPrompts().data ?? []
  const registryAgent = (agentsQ.data ?? []).find((agent) => agent.id === agentId) ?? null
  // A tenant stamp means this account created the definition. An unstamped row is
  // shared seed infrastructure: visible and usable everywhere, but not silently
  // relabeled as every viewer's private custom agent.
  const ownedAgent = registryAgent?.tenantId ? registryAgent : null
  const builtInAgent = registryAgent && !registryAgent.tenantId ? registryAgent : null
  const directoryEntry = (entries.data ?? []).find((candidate) => candidate.id === agentId) ?? null
  const entry = useMemo<AgentDirectoryEntry | null>(() => {
    if (directoryEntry) return directoryEntry
    const localAgent = ownedAgent ?? builtInAgent
    if (!localAgent || !me) return null
    return {
      id: localAgent.id,
      label: localAgent.label,
      owner: builtInAgent ? 'Built in' : me.tenant.name,
      own: !builtInAgent,
      systemPrompt: localAgent.systemPrompt,
      tools: localAgent.tools,
      instructions: localAgent.instructions,
      contributions: localAgent.contributions ?? 0,
      forks: localAgent.forks ?? 0,
      version: localAgent.version ?? 1,
      changelog: localAgent.changelog ?? [],
    }
  }, [directoryEntry, ownedAgent, builtInAgent, me])
  const builtIn = !!builtInAgent
  const own = !builtIn && (!!ownedAgent || directoryEntry?.own === true)
  const published = directoryEntry !== null || ownedAgent?.published === true
  useAgentForkStatus()
  useAgentProposalCreationStatus()
  const forkHeld = entry ? isAgentForkHeld(entry.id) : false
  const heldProposalCreation = entry ? heldAgentProposalCreation(entry.id) : undefined
  const proposalCreationHeld = heldProposalCreation !== undefined
  const provider = providers.find((candidate) => candidate.id === registryAgent?.providerId)
  const prompt = prompts.find((candidate) => candidate.id === registryAgent?.systemPromptId)
  // S18 — the header counts are doors to their lineage SECTIONS on this page
  // (contributions → resolved work, forks → public forks): same-page anchors.
  const resolvedRef = useRef<HTMLDivElement>(null)
  const forksRef = useRef<HTMLDivElement>(null)
  const scrollTo = (ref: { current: HTMLDivElement | null }) =>
    ref.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [proposing, setProposing] = useState(false)
  const [cardModal, setCardModal] = useState<{ url: string; title: string } | null>(null)
  const [editing, setEditing] = useState(false)
  // R5b — a proposal bell landed here: focus that proposal in "Your proposals".
  const [proposalFocus, setProposalFocus] = useState<string | null>(null)
  const { pending, consume } = usePendingFocus()
  const agentLocationRef = useRef(agentId)
  agentLocationRef.current = agentId
  const agentMountedRef = useRef(false)
  useEffect(() => {
    agentMountedRef.current = true
    return () => { agentMountedRef.current = false }
  }, [])
  useEffect(() => {
    if (!entry || pending?.agentId !== entry.id || !pending?.proposalId) return
    setProposalFocus(pending.proposalId)
    consume()
  }, [pending, entry, consume])

  if (!entry) {
    return (
      <UnavailableResourcePage
        title="Agent"
        state={resolveResourceUnavailable([entries, agentsQ, meQ])}
        message="This definition isn’t in the directory — unpublished, or it never existed."
        backTo={backTo}
        onBack={onBack}
        onRetry={() => retryResourceQueries([keys.directoryAgents(), keys.workerAgents, keys.me])}
      />
    )
  }

  const fork = async () => {
    if (!me || forkHeld) return
    const origin = agentId
    setError(null)
    try {
      const result = await enqueueAgentFork({
        tenantId: me.tenant.id,
        sourceAgentId: entry.id,
      })
      if (
        result.outcome === 'applied' &&
        agentMountedRef.current &&
        agentLocationRef.current === origin
      ) {
        onOpenAgent(result.agentId)
      } else if (
        result.outcome === 'discarded' &&
        agentMountedRef.current &&
        agentLocationRef.current === origin
      ) {
        setError('The Agent wasn’t forked. Review the definition and try again.')
      }
    } catch (e) {
      if (agentMountedRef.current && agentLocationRef.current === origin) {
        setError(e instanceof Error ? e.message : 'Could not fork this Agent.')
      }
    }
  }
  const togglePublish = async () => {
    if (!ownedAgent || busy) return
    setBusy(true)
    setError(null)
    try {
      const outcome = await updateAgent(ownedAgent.id, { published: !ownedAgent.published })
      if (outcome === 'discarded') setError('The publishing change was not saved. Review the latest agent before trying again.')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not change publishing.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <AtomicResourcePage>
        <PageHeader
          title={entry.label}
          badge={builtIn
            ? <StatusPill tone="neutral" label="Built in" />
            : own
              ? (published ? <StatusPill tone="ok" label={`Published · v${entry.version}`} /> : <StatusPill tone="neutral" label="Private" />)
              : undefined}
          subtitle={
            <span className="flex flex-wrap items-center gap-x-3 gap-y-0.5">
              <span className="inline-flex items-center gap-1">
                {builtIn ? 'Workspace default' : <OwnerLink ownerName={entry.owner} own={entry.own} onClick={() => rel.openOwner(entry.owner)} />} · v{entry.version}
              </span>
              <CreditLine contributions={entry.contributions} forks={entry.forks} onContributions={() => scrollTo(resolvedRef)} onForks={() => scrollTo(forksRef)} />
            </span>
          }
        >
          {own ? (
            <PageActionButton icon={<Pencil size={14} />} onClick={() => setEditing(true)}>Edit agent</PageActionButton>
          ) : directoryEntry && !builtIn ? (
            <PageActionButton
              icon={<GitFork size={14} />}
              onClick={() => void fork()}
              disabled={forkHeld || !me}
              aria-busy={forkHeld || undefined}
              title="Forking copies the definition — you grant your own model and authority."
            >
              {forkHeld ? 'Forking…' : 'Fork agent'}
            </PageActionButton>
          ) : null}
        </PageHeader>

        <FoldSection
          title="Definition"
          summary={`${entry.tools.length} tool${entry.tools.length === 1 ? '' : 's'} · version ${entry.version}`}
          actions={
            <>
              {published && (
                <SectionAction
                  label="Open A2A card"
                  icon={<ExternalLink size={14} />}
                  onClick={() => setCardModal({ url: a2aAgentCardUrl(entry.id), title: `A2A card — ${entry.label}` })}
                />
              )}
              {!own && !builtIn && (
                <SectionAction
                  label={proposalCreationHeld ? 'Opening proposal…' : 'Propose a change'}
                  icon={proposalCreationHeld ? <Spinner size={14} /> : <GitPullRequest size={14} />}
                  onClick={() => { if (!proposalCreationHeld) setProposing(true) }}
                  expanded={proposing || proposalCreationHeld}
                  disabled={proposalCreationHeld}
                  disabledReason="Waiting for this proposal to settle"
                />
              )}
            </>
          }
        >
          <div className="space-y-4">
            <FormField label="System prompt">
              <pre className="whitespace-pre-wrap rounded-lg border border-line bg-panel-2 p-3 font-sans text-[12px] leading-relaxed text-ink-soft">
                {entry.systemPrompt}
              </pre>
            </FormField>
            {entry.instructions && (
              <FormField label="Instructions">
                <p className="rounded-lg border border-line bg-panel-2 p-3 text-[12px] leading-relaxed text-ink-soft">
                  {entry.instructions}
                </p>
              </FormField>
            )}
            <FormField label={`Tools (${entry.tools.length})`}>
              <div className="flex flex-wrap gap-1.5">
                {entry.tools.length === 0 ? (
                  <span className="text-[12px] text-ink-faint">No tools — a prose-only definition.</span>
                ) : (
                  entry.tools.map((tool) => (
                    <button key={tool} onClick={() => rel.navigate(AGENT_SECTION, tool, 'tools')} className={`${INLINE_ACTION_CLASS} rounded-md bg-panel-2 px-2 py-1`}>
                      {agentToolLabel(tool)}
                    </button>
                  ))
                )}
              </div>
            </FormField>
          </div>
        </FoldSection>
        {registryAgent && (
          <>
            <FoldSection title="Runtime" summary={`${provider?.label ?? 'No provider bound'} · ${prompt?.label ?? 'Bespoke prompt'}`}>
              <div className={LEDGER_LIST_CLASS}>
                <AgentFactRow label="Provider" value={provider?.label ?? 'No provider bound yet'} />
                <AgentFactRow label="Prompt" value={prompt?.label ?? 'Bespoke prompt'} onOpen={prompt ? () => rel.navigate(AGENT_SECTION, prompt.id, 'prompts') : undefined} />
                <AgentFactRow label="Authority" value={authorityLabel(registryAgent.authority)} />
                <AgentFactRow
                  label="Budget"
                  value={registryAgent.budget
                    ? registryAgent.budget.windows.map((window) => `${window.ceiling.toLocaleString()} tokens / ${window.label}`).join(' · ')
                    : 'Inherited from provider'}
                />
                {registryAgent.forkedFrom && (
                  <AgentFactRow
                    label="Lineage"
                    value={`Forked from ${registryAgent.forkedFrom.label}${
                      registryAgent.forkedFrom.version ? ` · v${registryAgent.forkedFrom.version}` : ''
                    }`}
                  />
                )}
                {registryAgent.importedFrom && (
                  <AgentFactRow
                    label="Origin"
                    value={`Imported from ${registryAgent.importedFrom.name} (A2A card)`}
                    onOpen={() => setCardModal({
                      url: registryAgent.importedFrom!.url,
                      title: `Imported card — ${registryAgent.importedFrom!.name}`,
                    })}
                  />
                )}
              </div>
            </FoldSection>
            {ownedAgent && (
              <FoldSection title="Distribution" summary={published ? `Published at version ${entry.version}` : 'Private to this account'}>
                <div className="space-y-2.5">
                  <p className="text-[12px] leading-relaxed text-ink-soft">
                    {published
                      ? 'This definition is available in Discover. Provider binding, authority, and budget remain private.'
                      : 'Publish the definition to make it forkable in Discover. Capability never travels with it.'}
                  </p>
                  <button onClick={() => void togglePublish()} disabled={busy} className={INLINE_ACTION_CLASS}>
                    {published ? 'Unpublish' : 'Publish to directory'}
                  </button>
                </div>
              </FoldSection>
            )}
          </>
        )}
        {(entry.changelog?.length ?? 0) > 0 && (
          <FoldSection
            title="Changelog"
            summary={`${entry.changelog!.length} version${entry.changelog!.length === 1 ? '' : 's'}`}
          >
            <ChangelogList changelog={entry.changelog!} />
          </FoldSection>
        )}
        <FoldSection
          title="Track record"
          summary={`${entry.contributions} contribution${entry.contributions === 1 ? '' : 's'} · ${entry.forks} fork${entry.forks === 1 ? '' : 's'}`}
        >
          <div className="space-y-4">
            {/* S10/S18 — the acts behind the contribution count (P8-redacted to shared
                projects), each row a door to the item's own page; then the public
                forks behind the fork count. The header counts anchor here. */}
            <div ref={resolvedRef}>
              <AgentResolvedWork agentId={entry.id} totalContributions={entry.contributions} />
            </div>
            <div ref={forksRef}>
              <AgentPublicForks agentId={entry.id} totalForks={entry.forks} onOpenAgent={onOpenAgent} />
            </div>
            {entry.contributions === 0 && entry.forks === 0 && <Empty>No public work or forks yet.</Empty>}
          </div>
        </FoldSection>
        {/* D27 — the proposer's end of the conversation: their proposals against this
            definition (status, the owner's note, the thread). The owner sees all of
            them here too — the same rows their review dialog resolves. */}
        {published && <YourProposals entry={entry} focusProposalId={proposalFocus} />}
        {error && <p className="text-[12px] text-removed">{error}</p>}
      {editing && ownedAgent && <AgentDialog agent={ownedAgent} onClose={() => setEditing(false)} />}
      {cardModal && (
        <A2aCardDialog
          url={cardModal.url}
          title={cardModal.title}
          onClose={() => setCardModal(null)}
        />
      )}
      {(proposing || proposalCreationHeld) && !own && !builtIn && (
        <ProposeChangeDialog
          entry={entry}
          heldRequest={heldProposalCreation?.request}
          onBack={() => setProposing(false)}
          onClose={() => setProposing(false)}
        />
      )}
    </AtomicResourcePage>
  )
}

function YourProposals({ entry, focusProposalId = null }: { entry: AgentDirectoryEntry; focusProposalId?: string | null }) {
  const mine = useAgentProposals(entry.id).data ?? []
  // A notification door (R5b) opened this detail ON a specific proposal — scroll it
  // into view + mark it once it's present (the list is a live fetch).
  const focusRef = useRef<HTMLDivElement>(null)
  const focusPresent = mine.some((p) => p.id === focusProposalId)
  useEffect(() => {
    if (focusProposalId && focusPresent) focusRef.current?.scrollIntoView({ block: 'center' })
  }, [focusProposalId, focusPresent])
  if (mine.length === 0) return null
  // The current published definition — the LEFT side of the diff. Public-face (the
  // directory entry the proposer already sees), so surfacing their own change against
  // it crosses no wall (surface-audit S1).
  const current: Record<string, string> = {
    label: entry.label,
    systemPrompt: entry.systemPrompt,
    instructions: entry.instructions,
    tools: entry.tools.join(', '),
  }
  return (
    <FoldSection
      title="Your proposals"
      summary={`${mine.length} proposal${mine.length === 1 ? '' : 's'}`}
    >
      <div className="space-y-2">
        {mine.map((p) => {
          const isFocus = p.id === focusProposalId
          return (
            <div
              key={p.id}
              ref={isFocus ? focusRef : undefined}
              className={`scroll-mt-4 rounded-lg border p-2 transition-colors ${
                isFocus ? `border-co ${FOCUS_FLASH_CLASS}` : 'border-line'
              }`}
            >
              <div className="flex items-center gap-2 text-[11px] text-ink-faint">
                <span className="font-medium text-ink-soft">against v{p.baseVersion}</span>
                <span>· {relativeTime(p.at)}</span>
                <span className="rounded-full bg-panel-2 px-1.5 py-px text-[10px] font-medium uppercase tracking-wide">
                  {p.status}
                </span>
                {/* The terminal lifecycle event — WHEN the owner merged/declined (D25;
                    surface-audit S1: resolvedAt was rendered nowhere). */}
                {p.status !== 'open' && p.resolvedAt && <span>· {relativeTime(p.resolvedAt)}</span>}
              </div>
              {p.note && <p className="mt-1 text-[12px] text-ink-soft">{p.note}</p>}
              {/* The proposer can now review THEIR OWN change, not just its note (S1). */}
              <ProposalFieldDiff fields={p.fields} current={current} />
              {p.responseNote && (
                <p className="mt-1 text-[11px] text-ink-faint">Owner’s note: {p.responseNote}</p>
              )}
              <ProposalThread agentId={entry.id} proposal={p} openForComments={p.status === 'open'} />
            </div>
          )
        })}
      </div>
    </FoldSection>
  )
}

/** D25 — open a change proposal against a published definition (the PR analog).
 *  FULL-FIELD: the form starts from the current definition; what you submit is the
 *  proposed replacement, reviewed by the owner as a side-by-side. Only definition
 *  fields exist here — capability is unrepresentable (the D18 wall). */
function ProposeChangeDialog({
  entry,
  heldRequest,
  onBack,
  onClose,
}: {
  entry: AgentDirectoryEntry
  heldRequest?: ProposeAgentChangeRequest
  onBack: () => void
  onClose: () => void
}) {
  const rel = useRelations()
  const me = useMe().data
  const [prompt, setPrompt] = useState(
    () => heldRequest?.fields.systemPrompt ?? entry.systemPrompt,
  )
  const [instructions, setInstructions] = useState(
    () => heldRequest?.fields.instructions ?? entry.instructions,
  )
  const [note, setNote] = useState(() => heldRequest?.note ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const held = heldRequest !== undefined || isAgentProposalCreationHeld(entry.id)
  // A CLEARED prompt is "keep the current one", not a change (review finding: the
  // server drops an empty prompt, so counting it as a change either opened a
  // proposal that didn't say what was meant, or 400'd a form that said it had
  // changes). Proposals replace, they never erase.
  const promptChanged = prompt.trim() !== '' && prompt.trim() !== entry.systemPrompt
  const instructionsChanged = instructions.trim() !== entry.instructions
  const changed = promptChanged || instructionsChanged
  const submit = async () => {
    if (busy || held || !changed) return
    if (!me) {
      setError('Sign in again before opening this proposal.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const outcome = await enqueueAgentProposalCreation({
        tenantId: me.tenant.id,
        agentId: entry.id,
        request: {
          fields: {
            ...(promptChanged ? { systemPrompt: prompt } : {}),
            ...(instructionsChanged ? { instructions } : {}),
          },
          note,
        },
      })
      if (outcome === 'applied') onClose()
      else setError('The proposal was not opened. Review your changes and try again when ready.')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not open this proposal.')
    } finally {
      setBusy(false)
    }
  }
  return (
      <FormDialog
        title={`Propose a change — ${entry.label}`}
        icon={<Bot size={18} />}
        kind="agent-proposal-creation"
        submitLabel={held || busy ? 'Opening proposal…' : 'Open proposal'}
        canSubmit={!busy && !held && !!me && changed}
        onSubmit={submit}
        onClose={() => { if (!held) onClose() }}
        error={error}
        busy={held || busy}
      >
        <p className="text-[12px] text-ink-faint">
          Against v{entry.version}{' '}
          <OwnerLink
            ownerName={entry.owner}
            own={entry.own}
            onClick={() => {
              onClose()
              rel.openOwner(entry.owner)
            }}
          />{' '}
          — the owner reviews and merges or declines.{' '}
          <button
            onClick={() => { if (!held) onBack() }}
            disabled={held}
            className={`${INLINE_ACTION_CLASS} disabled:cursor-not-allowed disabled:opacity-50`}
          >
            Back to the definition
          </button>
        </p>
        <FormField label="System prompt">
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={6}
            disabled={held || busy}
            aria-label="Proposed system prompt"
            className={`${FORM_INPUT_CLASS} resize-none font-mono text-[12px] leading-relaxed disabled:cursor-wait disabled:opacity-70`}
          />
        </FormField>
        <FormField label="Instructions" optional>
          <textarea
            value={instructions}
            onChange={(e) => setInstructions(e.target.value)}
            rows={3}
            disabled={held || busy}
            aria-label="Proposed instructions"
            className={`${FORM_INPUT_CLASS} resize-none leading-relaxed disabled:cursor-wait disabled:opacity-70`}
          />
        </FormField>
        <FormField label="Why this change" optional>
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            disabled={held || busy}
            placeholder="e.g. tightens the intro, drops the filler"
            aria-label="Proposal note"
            className={`${FORM_INPUT_CLASS} disabled:cursor-wait disabled:opacity-70`}
          />
        </FormField>
      </FormDialog>
  )
}

/** The detective audit trail (docs/agent-commons.md, D15/OQ7) — a read-only watch over
 *  cross-user effects (proxy / Project effect / commissioned host invoke), newest first,
 *  recording denied attempts as well as fulfilled ones. Refreshes live on `audit.entry`.
 *  The honest framing: a detective *backstop*, not the wall — attenuation (D12) is the wall. */
function AuditTab() {
  const entries = useAuditLog().data ?? []
  const agents = useAgents().data ?? []
  const labelFor = (id?: string) => (id ? (agents.find((a) => a.id === id)?.label ?? id) : undefined)
  // S11 — the sharpest signal is a DENIED outcome (the contract's own thesis: "a denied
  // proxy is exactly what a watcher wants to see"), yet in a growing ledger it's one red
  // dot among many. A two-state filter surfaces it directly. (Detective-audit scope: a
  // header control only — no row restructure, no day-grouping, no taint graph.)
  const [filter, setFilter] = useState<'all' | 'denied'>('all')
  const deniedCount = entries.filter((e) => e.outcome === 'denied').length
  const shown = filter === 'denied' ? entries.filter((e) => e.outcome === 'denied') : entries
  return (
    <div className="space-y-3">
      <p className="text-[12px] leading-relaxed text-ink-soft">
        A server-side watch over <span className="font-medium text-ink">cross-user</span> effects — the
        agent-to-agent proxy, Project effects, and commissioned host invokes — recorded whether allowed
        or refused. A <span className="font-medium text-ink">detective backstop</span>, not the wall:
        attenuation is what actually bounds reach.
      </p>
      {entries.length === 0 ? (
        <Empty>No cross-user effects recorded yet.</Empty>
      ) : (
        <>
          <SubTabs
            tabs={[
              { id: 'all', label: `All (${entries.length})` },
              { id: 'denied', label: `Denied (${deniedCount})` },
            ]}
            active={filter}
            onChange={setFilter}
          />
          {shown.length === 0 ? (
            <Empty>No denied effects — every recorded effect was allowed.</Empty>
          ) : (
            <CardList>
              {shown.map((e) => (
                <AuditEntryRow key={e.id} entry={e} actor={labelFor(e.actorAgentId) ?? e.commissionId} />
              ))}
            </CardList>
          )}
        </>
      )}
    </div>
  )
}

function AuditEntryRow({ entry, actor }: { entry: AuditEntry; actor?: string }) {
  const denied = entry.outcome === 'denied'
  return (
    <div className="flex items-center gap-2.5 py-2.5">
      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${denied ? 'bg-removed' : 'bg-ok'}`} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="shrink-0 rounded-full bg-ink/5 px-1.5 py-px text-[10px] font-medium uppercase tracking-wide text-ink-soft">
            {AUDIT_CHANNEL_LABEL[entry.channel]}
          </span>
          <span className={`shrink-0 text-[11px] font-medium ${denied ? 'text-removed' : 'text-ok-text'}`}>
            {denied ? 'denied' : 'fulfilled'}
          </span>
          <span className="truncate text-[13px] text-ink">
            {entry.capability} on <span className="font-medium">{entry.target}</span>
          </span>
        </div>
        {actor && <div className="text-[11px] text-ink-faint">by {actor}</div>}
      </div>
      <span className="shrink-0 text-[11px] text-ink-faint">{relativeTime(entry.at)}</span>
    </div>
  )
}

/* ─────────────── The maintainer console (the `admin` section) ─────────────── */

/** The instance-operator console (contract/admin.ts) — five surfaces over the
 *  maintainer-walled `/admin/*` reads, plus the account DETAIL page
 *  (`/admin/users/:id`, FWD-7 v1.1 — a canonical, addressable page like every
 *  detail, ADAPT-15). Rendered without the grant (a pasted URL — the rail
 *  hides the row) it degrades to an explanatory empty state; the server's 404
 *  wall keeps the data unreachable regardless. */
function AdminSection({
  subview,
  adminUserId = null,
  onBack,
  backTo,
}: {
  subview: string
  /** The open account detail (null = the console's panels) — the controlled
   *  focus id, set by the controller however the page was reached. */
  adminUserId?: string | null
  onBack: () => void
  backTo: NavLocation | null
}) {
  const granted = useMe().data?.instanceAdmin === true
  const meta = SECTION_META.admin
  // The detail page — a STALE id (a bookmark to a since-gone account) degrades
  // to the panels once the list has loaded and cannot resolve it (the
  // ContextsSection idiom); while the list is still loading, the detail shows
  // its own loading state rather than flashing the list.
  const usersQ = useAdminUsers(granted)
  const openDetail = granted && adminUserId && !(usersQ.data && !usersQ.data.some((u) => u.user.id === adminUserId))
  if (openDetail) return <AdminUserDetail userId={adminUserId} onBack={onBack} backTo={backTo} />
  const surfaceTitle =
    subview === 'orgs'
      ? 'Organizations'
      : subview === 'credentials'
        ? 'Credentials'
        : subview === 'audit'
          ? 'Audit'
          : subview === 'ops'
            ? 'Ops'
            : 'Accounts'
  return (
    <CompositeResourcePage section="admin">
      <PageHeader title={`${meta.label} · ${surfaceTitle}`} subtitle={meta.subtitle} />
      {!granted ? (
        <PageEmpty>
          This console is for instance maintainers. Sign in as an account on the server’s
          MAINTAINERS allowlist to use it.
        </PageEmpty>
      ) : (
        <>
          {subview === 'orgs' ? (
            <AdminOrgsPanel />
          ) : subview === 'credentials' ? (
            <AdminCredentialsPanel />
          ) : subview === 'audit' ? (
            <AdminAuditPanel />
          ) : subview === 'ops' ? (
            <AdminOpsPanel />
          ) : (
            <AdminAccountsPanel />
          )}
        </>
      )}
    </CompositeResourcePage>
  )
}

/** An account's own page in the maintainer console (FWD-7 v1.1): the full
 *  identity facts, its namespace and org seats, ITS bearer-token registry
 *  (revocable per row), and the deactivate act — everything the list rows
 *  abbreviate. Reads the same two list hooks the panels read (the registry
 *  has one home; no per-entity endpoint needed). */
function AdminUserDetail({ userId, onBack, backTo }: { userId: string; onBack: () => void; backTo: NavLocation | null }) {
  const usersQ = useAdminUsers(true)
  const row = usersQ.data?.find((u) => u.user.id === userId)
  const tokens = (useAdminTokens(true).data ?? []).filter((t) => t.userId === userId)
  return (
    <AtomicResourcePage>
      <header className={PAGE_HEADER_CLASS}>
        <div className="flex min-w-0 items-start gap-1">
          {/* Back follows real history (ADAPT-18); the structural fallback is
              the console's Accounts list. */}
          <BackButton
            to={backTo ?? { kind: 'section', section: 'admin', projectId: null, scheduleId: null }}
            onBack={onBack}
          />
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h1 {...identityTitleProps(row ? row.user.name : 'Account')} className={`${PAGE_TITLE_CLASS} truncate`}>{row ? row.user.name : 'Account'}</h1>
              {row?.seeded && <AdminBadge>Seeded</AdminBadge>}
              {row?.deactivated && <AdminBadge tone="danger">Deactivated</AdminBadge>}
            </div>
            <p className="mt-1 text-[13px] text-ink-soft">
              {row?.user.email ?? 'no credential'} · <span className="font-mono text-[12px]">{userId}</span>
            </p>
          </div>
        </div>
      </header>
      {!row ? (
        <PageEmpty>{usersQ.error ? 'The account read failed — are you still on the maintainer allowlist?' : 'Loading account…'}</PageEmpty>
      ) : (
        <div>
          <FoldSection
            title="Namespace"
            summary={row.homeTenant ? `${row.homeTenant.name} · ${row.homeTenant.kind}` : 'No home namespace'}
          >
            <CardList>
              {row.homeTenant ? (
                <div className={`${LEDGER_ROW_CLASS} items-center`}>
                  <span className="min-w-0 flex-1 truncate text-[13px] text-ink">{row.homeTenant.name}</span>
                  <AdminBadge>{row.homeTenant.kind}</AdminBadge>
                  <span className="shrink-0 font-mono text-[11px] text-ink-faint">{row.homeTenant.id}</span>
                </div>
              ) : (
                <p className={`${LEDGER_ROW_CLASS} text-[13px] text-ink-faint`}>No home namespace (a dangling membership).</p>
              )}
            </CardList>
          </FoldSection>
          <FoldSection
            title="Organization seats"
            summary={`${row.orgSeats.length} seat${row.orgSeats.length === 1 ? '' : 's'}`}
          >
            {row.orgSeats.length === 0 ? (
              <Empty>No org seats beyond the home namespace.</Empty>
            ) : (
              <CardList>
                {row.orgSeats.map((s) => (
                  <div key={s.tenant.id} className="flex items-center gap-2.5 py-2.5">
                    <span className="min-w-0 flex-1 truncate text-[13px] text-ink">{s.tenant.name}</span>
                    <AdminBadge>{s.role}</AdminBadge>
                    <span className="shrink-0 font-mono text-[11px] text-ink-faint">{s.tenant.id}</span>
                  </div>
                ))}
              </CardList>
            )}
          </FoldSection>
          <FoldSection
            title="Bearer tokens"
            summary={`${tokens.length} token${tokens.length === 1 ? '' : 's'}`}
          >
            {tokens.length === 0 ? (
              <Empty>No bearer tokens on this account.</Empty>
            ) : (
              <CardList>
                {tokens.map((t) => (
                  <div key={t.id} data-admin-token-id={t.id} className="flex items-center gap-2.5 py-2.5">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[13px] text-ink">{t.label ?? 'Unlabeled token'}</div>
                      <div className="truncate text-[11px] text-ink-faint">
                        minted {relativeTime(t.createdAt)} · <span className="font-mono">{t.id}</span>
                      </div>
                    </div>
                    <AdminConfirmAction
                      label="Revoke"
                      confirmLabel="Revoke token"
                      pendingLabel="Revoking…"
                      action={{ kind: 'revoke-token', userId, tokenId: t.id }}
                    />
                  </div>
                ))}
              </CardList>
            )}
          </FoldSection>
          {!row.seeded && !row.deactivated && (
            <FoldSection title="Danger zone" summary="Deactivate this account" defaultFolded>
              <div className="flex items-center gap-2.5 py-2.5">
                <p className="min-w-0 flex-1 text-[12px] leading-relaxed text-ink-soft">
                  Deactivating disables sign-in and revokes every bearer token. No data is deleted.
                </p>
                <AdminConfirmAction
                  label="Deactivate"
                  confirmLabel="Deactivate account"
                  pendingLabel="Deactivating…"
                  action={{ kind: 'deactivate-user', userId }}
                />
              </div>
            </FoldSection>
          )}
        </div>
      )}
    </AtomicResourcePage>
  )
}

/** The two-step inline confirm every destructive console act wears (the
 *  Composer chip-remove shape): first click arms, Cancel disarms — no new
 *  dialog primitive for a transient act. */
function AdminConfirmAction({
  label,
  confirmLabel,
  pendingLabel,
  action,
}: {
  label: string
  confirmLabel: string
  pendingLabel: string
  action: AdminActionTarget
}) {
  const me = useMe().data
  const mutation = useAdminActionStatus()
  const held = heldAdminAction(action)
  const resourceId = adminActionResourceId(action)
  const active = mutation.activeResourceId === resourceId
  const failed = active && mutation.error !== null
  const phase = held ? (!active ? 'queued' : failed ? 'failed' : 'pending') : undefined
  const [armed, setArmed] = useState(false)
  if (held) {
    return (
      <button
        type="button"
        data-admin-action={phase}
        data-admin-action-resource={resourceId}
        disabled
        aria-busy={active && !failed || undefined}
        title={failed ? 'Use Retry or Dismiss in the recovery banner' : undefined}
        className={`${DANGER_BUTTON_CLASS} shrink-0 px-2 py-0.5 text-[11px] disabled:opacity-55`}
      >
        {!active ? `${label} queued` : failed ? 'Waiting for Retry' : pendingLabel}
      </button>
    )
  }
  if (!armed) {
    return (
      <button
        type="button"
        data-admin-action-resource={resourceId}
        onClick={() => setArmed(true)}
        disabled={!me}
        className="shrink-0 rounded-md border border-line px-2 py-0.5 text-[11px] font-medium text-ink-soft transition hover:border-removed hover:text-removed"
      >
        {label}
      </button>
    )
  }
  return (
    <span className="flex shrink-0 items-center gap-1.5">
      <button
        type="button"
        data-admin-action-resource={resourceId}
        onClick={() => {
          setArmed(false)
          if (me) void enqueueAdminAction({ ...action, tenantId: me.tenant.id })
        }}
        disabled={!me}
        className={`${DANGER_BUTTON_CLASS} px-2 py-0.5 text-[11px]`}
      >
        {confirmLabel}
      </button>
      <button
        type="button"
        onClick={() => setArmed(false)}
        className="rounded-md px-1.5 py-0.5 text-[11px] text-ink-faint transition hover:text-ink"
      >
        Cancel
      </button>
    </span>
  )
}

/** A small badge for account/tenant facts (seeded / deactivated / kind). */
function AdminBadge({ tone = 'neutral', children }: { tone?: 'neutral' | 'danger'; children: ReactNode }) {
  return (
    <span
      className={`shrink-0 rounded-full px-1.5 py-px text-[10px] font-medium uppercase tracking-wide ${
        tone === 'danger' ? 'bg-removed/10 text-removed' : 'bg-ink/5 text-ink-soft'
      }`}
    >
      {children}
    </span>
  )
}

/** Accounts — every user + namespace on the instance, with the one v1 user
 *  mutation (deactivate, refused on seeded rows server-side). */
function AdminAccountsPanel() {
  const usersQ = useAdminUsers(true)
  const users = usersQ.data ?? []
  const tenants = useAdminTenants(true).data ?? []
  // The row door — through the pane bridge (ADAPT-17/18), so the detail opens
  // IN this pane with back history, exactly like every other section's rows.
  const rel = useRelations()
  return (
    <div className="space-y-5">
      {users.length === 0 ? (
        <Empty>{usersQ.error ? 'The accounts read failed — are you still on the maintainer allowlist?' : 'Loading accounts…'}</Empty>
      ) : (
        <CardList>
          {users.map((u) => (
            <AdminUserRowView key={u.user.id} row={u} onOpen={() => rel.navigate('admin', u.user.id)} />
          ))}
        </CardList>
      )}
      <div>
        <h2 className="mb-2 text-[13px] font-semibold text-ink">Tenants</h2>
        <CardList>
          {tenants.map((t) => (
            <AdminTenantRowView key={t.tenant.id} row={t} users={users} />
          ))}
        </CardList>
      </div>
    </div>
  )
}

function AdminUserRowView({ row, onOpen }: { row: AdminUserRow; onOpen: () => void }) {
  return (
    // The whole row opens the account (UI-17); the chevron that used to be a
    // second button to the same place is now the drill-in HINT it always read as.
    <div
      onClick={cardDoorClick(onOpen)}
      className={`${LEDGER_ROW_CLASS} items-center ${ROW_DOOR_CLASS}`}
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          {/* Title-as-door (the titles-are-doors rule): the name opens the
              account's own page; the row's acts live there now. */}
          <button onClick={onOpen} className={`min-w-0 truncate text-left text-[13px] text-ink ${DOOR_CLASS}`}>
            {row.user.name}
          </button>
          {row.seeded && <AdminBadge>Seeded</AdminBadge>}
          {row.deactivated && <AdminBadge tone="danger">Deactivated</AdminBadge>}
        </div>
        <div className="truncate text-[11px] text-ink-faint">
          {row.user.email ?? 'no credential'}
          {row.homeTenant ? ` · ${row.homeTenant.name}` : ''}
          {row.orgSeats.length > 0
            ? ` · ${row.orgSeats.map((s) => `${s.tenant.name} (${s.role})`).join(', ')}`
            : ''}
        </div>
      </div>
      <span className="shrink-0 text-[11px] text-ink-faint">
        {row.tokenCount} {row.tokenCount === 1 ? 'token' : 'tokens'}
      </span>
      {/* Static, not HOVER_CUE: the chevron is a drill-in hint, not a second
          destination. It still yields its width below `sm`. */}
      <ChevronRight size={14} className="shrink-0 text-ink-faint max-sm:hidden" />
    </div>
  )
}

/** A tenant row that EXPANDS in place to its member roster (a disclosure, not
 *  a page — the roster is derived from the same live users read). */
function AdminTenantRowView({ row, users }: { row: AdminTenantRow; users: AdminUserRow[] }) {
  const [open, setOpen] = useState(false)
  const members = users
    .flatMap((u) => [
      ...(u.homeTenant?.id === row.tenant.id ? [{ user: u.user, role: 'namespace owner' }] : []),
      ...u.orgSeats.filter((s) => s.tenant.id === row.tenant.id).map((s) => ({ user: u.user, role: s.role as string })),
    ])
  return (
    <div className="py-2.5">
      <button onClick={() => setOpen((o) => !o)} className="flex w-full items-center gap-2.5 text-left">
        <span className="flex h-4 w-4 shrink-0 items-center justify-center text-ink-faint">
          {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        </span>
        <span className="min-w-0 flex-1 truncate text-[13px] text-ink">{row.tenant.name}</span>
        {/* An org-KIND tenant can still be one person's namespace (Acme);
            the shared-org badge follows the `namespace` fact, not `kind`. */}
        <AdminBadge>{row.namespace ? 'namespace' : 'organization'}</AdminBadge>
        {row.seeded && <AdminBadge>Seeded</AdminBadge>}
        <span className="shrink-0 text-[11px] text-ink-faint">
          {row.members} {row.members === 1 ? 'member' : 'members'}
        </span>
      </button>
      {open && (
        <div className="mt-1.5 space-y-1 pl-6">
          <div className="font-mono text-[11px] text-ink-faint">{row.tenant.id}</div>
          {members.length === 0 ? (
            <div className="text-[11px] text-ink-faint">No resolvable members (a legacy snapshot echo).</div>
          ) : (
            members.map((m, i) => (
              <div key={`${m.user.id}-${i}`} className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate text-[12px] text-ink">{m.user.name}</span>
                <AdminBadge>{m.role}</AdminBadge>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  )
}

/** Organizations — orgs across the instance + the invite ledger (revoke on
 *  pending rows; the org-owner face stays `DELETE /orgs/:id/invites/:iid`). */
function AdminOrgsPanel() {
  const tenants = useAdminTenants(true).data ?? []
  const users = useAdminUsers(true).data ?? []
  const invites = useAdminInvites(true).data ?? []
  // TRUE orgs only: an org-kind tenant that is somebody's namespace (the Acme
  // seed world) is not an organization — the `namespace` fact discriminates —
  // and a seatless legacy tenant (a pre-collapse snapshot echo) has no roster
  // to show.
  const orgs = tenants.filter((t) => t.tenant.kind === 'org' && !t.namespace && t.members > 0)
  const membersOf = (orgId: string) =>
    users.flatMap((u) => u.orgSeats.filter((s) => s.tenant.id === orgId).map((s) => ({ user: u.user, role: s.role })))
  return (
    <div className="space-y-5">
      {orgs.length === 0 ? (
        <Empty>No organizations founded yet.</Empty>
      ) : (
        orgs.map((o) => (
          <div key={o.tenant.id}>
            <h2 className="mb-2 text-[13px] font-semibold text-ink">{o.tenant.name}</h2>
            <CardList>
              {membersOf(o.tenant.id).map((m) => (
                <div key={m.user.id} className="flex items-center gap-2.5 py-2.5">
                  <span className="min-w-0 flex-1 truncate text-[13px] text-ink">{m.user.name}</span>
                  <AdminBadge>{m.role}</AdminBadge>
                </div>
              ))}
            </CardList>
          </div>
        ))
      )}
      <div>
        <h2 className="mb-2 text-[13px] font-semibold text-ink">Invitations</h2>
        {invites.length === 0 ? (
          <Empty>No invitations yet.</Empty>
        ) : (
          <CardList>
            {invites.map((i) => (
              <AdminInviteRowView key={i.id} row={i} />
            ))}
          </CardList>
        )}
      </div>
    </div>
  )
}

function AdminInviteRowView({ row }: { row: AdminInviteRow }) {
  return (
    <div data-admin-invite-id={row.id} className="flex items-center gap-2.5 py-2.5">
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13px] text-ink">
          {row.email} <span className="text-ink-faint">→ {row.orgName}</span>
        </div>
        <div className="text-[11px] text-ink-faint">
          invited by {row.invitedBy} · {relativeTime(row.at)}
        </div>
      </div>
      <AdminBadge tone={row.status === 'revoked' ? 'danger' : 'neutral'}>{row.status}</AdminBadge>
      {row.status === 'invited' && (
        <AdminConfirmAction
          label="Revoke"
          confirmLabel="Revoke invite"
          pendingLabel="Revoking…"
          action={{ kind: 'revoke-invite', inviteId: row.id }}
        />
      )}
    </div>
  )
}

/** Credentials — every user's bearer-token registry rows (metadata only), with
 *  instance-side revocation. Peer + provider secrets keep their own surfaces. */
function AdminCredentialsPanel() {
  const tokens = useAdminTokens(true).data ?? []
  return (
    <div className="space-y-3">
      <p className="text-[12px] leading-relaxed text-ink-soft">
        Minted bearer tokens across every account — <span className="font-medium text-ink">metadata only</span>
        {' '}(the value is shown once, at mint). Revoking a row kills the credential immediately. A2A peer
        credentials and relay rendezvous secrets are administered on their own surfaces (Agents and Models).
      </p>
      {tokens.length === 0 ? (
        <Empty>No bearer tokens minted on this instance.</Empty>
      ) : (
        <CardList>
          {tokens.map((t) => (
            <div key={`${t.userId}:${t.id}`} data-admin-token-id={t.id} className="flex items-center gap-2.5 py-2.5">
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px] text-ink">{t.label ?? 'Unlabeled token'}</div>
                <div className="truncate text-[11px] text-ink-faint">
                  {t.userName} · minted {relativeTime(t.createdAt)}
                </div>
              </div>
              <AdminConfirmAction
                label="Revoke"
                confirmLabel="Revoke token"
                pendingLabel="Revoking…"
                action={{ kind: 'revoke-token', userId: t.userId, tokenId: t.id }}
              />
            </div>
          ))}
        </CardList>
      )}
    </div>
  )
}

/** Audit — the instance-wide (unscoped) read of the detective trail; the same
 *  row primitive as the Agents hub's tenant-scoped surface, plus the tenant. */
function AdminAuditPanel() {
  const entries = useAdminAudit(true).data ?? []
  return (
    <div className="space-y-3">
      <p className="text-[12px] leading-relaxed text-ink-soft">
        The detective audit trail across <span className="font-medium text-ink">every tenant</span> — the
        instance-wide view of the same ledger each tenant reads scoped on the Agents hub’s Audit surface.
      </p>
      {entries.length === 0 ? (
        <Empty>No cross-user effects recorded yet.</Empty>
      ) : (
        <CardList>
          {entries.map((e) => (
            <AdminAuditRowView key={e.id} entry={e} />
          ))}
        </CardList>
      )}
    </div>
  )
}

/** An audit row that EXPANDS in place to the entry's full record — the ids and
 *  exact timestamp the one-line summary abbreviates (a transient disclosure;
 *  an audit entry is a moment, not a lifecycle — no page, no URL). */
function AdminAuditRowView({ entry }: { entry: AuditEntry }) {
  const [open, setOpen] = useState(false)
  const facts: [string, string][] = [
    ['Entry id', entry.id],
    ['Channel', AUDIT_CHANNEL_LABEL[entry.channel]],
    ['Outcome', entry.outcome],
    ['Capability', entry.capability],
    ['Target', entry.target],
    ...(entry.actorAgentId ? ([['Acting agent', entry.actorAgentId]] as [string, string][]) : []),
    ...(entry.commissionId ? ([['Commission', entry.commissionId]] as [string, string][]) : []),
    ['Tenant', entry.tenantId],
    ['At', new Date(entry.at).toLocaleString()],
  ]
  return (
    // The divider list rhythm lives here; AuditEntryRow remains the semantic
    // content while this wrapper owns disclosure and its hit target.
    <div className="py-2.5">
      <button onClick={() => setOpen((o) => !o)} className="flex w-full items-center gap-1 text-left">
        <span className="flex h-4 w-4 shrink-0 items-center justify-center text-ink-faint">
          {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        </span>
        <div className="min-w-0 flex-1">
          <AuditEntryRow entry={entry} actor={`${entry.actorAgentId ?? entry.commissionId ?? 'a Contributor'} · ${entry.tenantId}`} />
        </div>
      </button>
      {open && (
        <div className="mb-2 ml-5 space-y-0.5 rounded-lg bg-panel-2 px-3 py-2">
          {facts.map(([k, v]) => (
            <div key={k} className="flex items-baseline gap-2">
              <span className="w-24 shrink-0 text-[11px] text-ink-faint">{k}</span>
              <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-ink">{v}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/** Ops — the health face as stat tiles, from the same derivation `/metrics`
 *  renders (`GET /admin/ops`). Refresh re-reads on demand (no admin SSE, v1). */
function AdminOpsPanel() {
  const opsQ = useAdminOps(true)
  const ops = opsQ.data
  if (!ops) {
    return (
      <Empty>
        {opsQ.error ? 'The ops read failed — are you still on the maintainer allowlist?' : 'Loading the ops snapshot…'}
      </Empty>
    )
  }
  const uptime =
    ops.uptimeSeconds >= 3600
      ? `${Math.floor(ops.uptimeSeconds / 3600)}h ${Math.floor((ops.uptimeSeconds % 3600) / 60)}m`
      : ops.uptimeSeconds >= 60
        ? `${Math.floor(ops.uptimeSeconds / 60)}m ${Math.floor(ops.uptimeSeconds % 60)}s`
        : `${Math.floor(ops.uptimeSeconds)}s`
  const counts = (rec: Record<string, number>) =>
    Object.entries(rec)
      .map(([k, v]) => `${k} ${v}`)
      .join(' · ') || 'none'
  const tiles: { label: string; value: string }[] = [
    { label: 'Status', value: ops.draining ? 'Draining' : 'Serving' },
    { label: 'Backend', value: ops.backend },
    { label: 'Uptime', value: uptime },
    { label: 'Store epoch', value: String(ops.epoch) },
    { label: 'Runners', value: counts(ops.runnersByStatus) },
    { label: 'Dispatch runs', value: counts(ops.dispatchByStatus) },
    { label: 'Model turns', value: counts(ops.turnsByOutcome) },
    { label: 'Requests', value: counts(ops.requestsByMethod) },
  ]
  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <button
          onClick={() => invalidate(keys.adminOps)}
          className="rounded-md border border-line px-2 py-0.5 text-[11px] font-medium text-ink-soft transition hover:border-accent hover:text-ink"
        >
          Refresh
        </button>
      </div>
      <div className="grid grid-cols-1 gap-3 @2xl:grid-cols-2">
        {tiles.map((t) => (
          <MetricTile key={t.label}>
            <div className="text-[11px] font-medium uppercase tracking-wide text-ink-faint">{t.label}</div>
            <div className="mt-1 text-[13px] font-medium text-ink">{t.value}</div>
          </MetricTile>
        ))}
      </div>
    </div>
  )
}

function GenericSection({ section, onOpenSession }: { section: SectionId; onOpenSession: (id: string) => void }) {
  const meta = SECTION_META[section]
  const [creating, setCreating] = useState(false)
  const rel = useRelations()
  const capabilities = useCapabilities()
  const dispatch = dispatchPresentation(capabilities.status === 'error' ? undefined : capabilities.data?.features.dispatchExecution)
  const openDispatch = () => { if (dispatch.available) setCreating(true) }
  return (
    <CompositeResourcePage section={section} projectSections={false}>
      <PageHeader
        title={meta.label}
        badge={
          meta.beta ? (
            <span className="rounded-full bg-accent-tint px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-accent-strong">
              Beta
            </span>
          ) : undefined
        }
        subtitle={meta.subtitle}
      >
        {section === 'dispatch' && (
          <PageActionButton
            icon={<Plus size={15} />}
            onClick={openDispatch}
            disabled={!dispatch.available}
            title={!dispatch.available ? dispatch.note : undefined}
            mirrorsRailFor="dispatch"
            onRailInvoke={dispatch.available ? openDispatch : undefined}
          >
            New dispatch
          </PageActionButton>
        )}
      </PageHeader>
      {section === 'dispatch' && <DispatchView onOpenSession={onOpenSession} />}
      {section === 'customize' && <CustomizeView />}
      {creating && <DeferredNewDispatchDialog onClose={() => setCreating(false)} onManageModelConnections={() => rel.navigate('models')} />}
    </CompositeResourcePage>
  )
}

/* ─────────────────────────── Scheduled ───────────────────────────
   A scheduled task is a recurring agentic workflow: on a cadence Claude runs an
   ordered sequence of tool-bearing steps and delivers the result. The list drills
   into a detail page whose hero is the workflow rail — and selecting a past run
   re-lights that rail to show exactly how far the run got. */

/** Per-tool glyph for step chips, the row mini-pipeline, and delivery nodes.
 *  connectorIconFor only knows Github/Plug/Server, so scheduled tools carry their
 *  own (brand-ish) lucide marks; an unknown id falls back to a plug. */
const STEP_TOOL_ICON: Record<string, LucideIcon> = {
  web: Globe,
  claude: Sparkles,
  session: MessageSquare,
  linear: SquareKanban,
  slack: MessageSquare,
  github: Github,
  gmail: Mail,
  gdrive: FileText,
  notion: FileText,
  amplitude: BarChart3,
  sentry: Bug,
}
function stepToolIcon(id: string): LucideIcon {
  return STEP_TOOL_ICON[id] ?? Plug
}

/** Chip tint + text color for a step tool's tone. connector/mcp/repo/workspace use
 *  the shared capability palette; 'web' (a built-in tool) and 'claude' (a pure
 *  reasoning step) read neutral so the rail never has a colorless hole. */
function toneChip(tone: StepToolTone): { tint: string; color: string } {
  if (tone === 'claude') return { tint: 'bg-panel-2', color: 'text-accent' }
  if (tone === 'web') return { tint: 'bg-panel-2', color: 'text-ink-soft' }
  return CHIP_TONES[tone as ChipTone]
}

/** A bare tool icon, tinted by tone. */
function ToolGlyph({ tool, size = 16 }: { tool: StepTool; size?: number }) {
  const Icon = stepToolIcon(tool.id)
  return <Icon size={size} className={toneChip(tool.tone).color} />
}

/** A small rounded tool node for the row mini-pipeline. */
function PipeNode({ tool }: { tool: StepTool }) {
  return (
    <span className="flex h-5 w-5 items-center justify-center rounded bg-panel-2">
      <ToolGlyph tool={tool} size={12} />
    </span>
  )
}

/** The full step chip — icon + label, with an amber dot when the tool needs auth. */
function ToolChip({ tool }: { tool: StepTool }) {
  const { tint, color } = toneChip(tool.tone)
  const Icon = stepToolIcon(tool.id)
  return (
    <span className={`inline-flex h-5 items-center gap-1 rounded-md px-1.5 text-[11px] font-medium ${tint} ${color}`}>
      <Icon size={11} />
      {tool.label}
      {tool.needsAuth && <span className="ml-0.5 h-1.5 w-1.5 rounded-full bg-warn" />}
    </span>
  )
}

/** The status pill for a task row / header: paused, failed, or "ran …". */
function taskPill(task: ScheduledTask): { tone: 'ok' | 'warn' | 'bad' | 'neutral'; label: string } {
  if (!task.enabled) return { tone: 'neutral', label: 'Paused' }
  if (task.lastStatus === 'failed') return { tone: 'bad', label: 'Failed' }
  if (task.lastStatus === 'cancelled') return { tone: 'ok', label: 'Active' }
  const last = task.runs[0]
  return { tone: 'ok', label: last ? `Ran ${relativeTime(last.at)}` : 'Active' }
}

/** The Routines section. Its main page and rail branch read the same live
 * routine filter, so the tree's head is an honest projection of this list. */
function ScheduledSection({
  scheduleId,
  scheduleSectionId,
  onOpenSchedule,
  onBack,
  backTo,
  onOpenSession,
}: {
  /** Which routine detail to show (null = the list) — the controlled source of
   *  truth, set by the controller however the detail was reached. */
  scheduleId: string | null
  scheduleSectionId?: string | null
  onOpenSchedule: (id: string) => void
  onBack: () => void
  backTo: NavLocation | null
  /** Open a run's session (the run-history rows + the rail both land here). */
  onOpenSession: (id: string) => void
}) {
  // The routines + their runs come straight from the server (one live source,
  // shared with the rail tree). Mutations are commands; the run.*
  // events invalidate the cache, so the list reflects run-now / the daemon live.
  const schedulesQ = useSchedules()
  const tenantId = useMe().data?.tenant.id
  useScheduleMutationStatus()
  useScheduleDeletionStatus()
  useScheduleRunStatus()
  useScheduleRunStopStatus()
  const items = schedulesQ.data ?? []
  const rel = useRelations()
  const projects = rel.allProjects()
  const projectIds = new Set(projects.map((project) => project.id))
  const [rawRoutineFilter, updateRoutineFilter] = useRoutineFilter()
  const routineFilter = clampRoutineFilter(rawRoutineFilter, projectIds)
  const [query, setQuery] = useState('')
  const [deleteTarget, setDeleteTarget] = useState<ScheduledTask | null>(null)
  const scheduleIdRef = useRef(scheduleId)
  scheduleIdRef.current = scheduleId
  const scheduledSectionMountedRef = useRef(false)
  useEffect(() => {
    scheduledSectionMountedRef.current = true
    return () => { scheduledSectionMountedRef.current = false }
  }, [])
  const scheduleMutationHeld = (id: string) =>
    isScheduleMutationHeld(id) || isScheduleDeletionHeld(id) || isScheduleRunHeld(id) || isScheduleRunStopHeldForTask(id)
  const toggleEnabled = (id: string) => {
    const t = items.find((x) => x.id === id)
    // The toggle is always rendered from `items`, so `t` is present; guard rather
    // than send an unresolved state (the server applies an explicit value only).
    if (t && !scheduleMutationHeld(id)) void toggleScheduleEnabled(id, !t.enabled)
  }
  const requestDelete = (task: ScheduledTask) => {
    if (!scheduleMutationHeld(task.id)) setDeleteTarget(task)
  }
  const confirmDelete = () => {
    const task = deleteTarget
    if (!task || scheduleMutationHeld(task.id)) return
    setDeleteTarget(null)
    void enqueueScheduleDeletion(task.id, task.revision ?? 0).then((outcome) => {
      if (outcome === 'applied' && scheduleIdRef.current === task.id) onBack()
    })
  }
  const deletionDialog = deleteTarget ? (
    <ConfirmDialog
      title={`Delete “${deleteTarget.name}”?`}
      body={ROUTINE_DELETE_SCOPE}
      confirmLabel="Delete routine"
      onConfirm={confirmDelete}
      onCancel={() => setDeleteTarget(null)}
    />
  ) : null

  const runNow = (id: string) => {
    const task = items.find((schedule) => schedule.id === id)
    if (!task || scheduleMutationHeld(id) || task.runs.some((run) => run.status === 'running')) return
    void enqueueScheduleRun(id)
  }
  const stopRun = (scheduleId: string, runId: string) => {
    if (!scheduleMutationHeld(scheduleId)) void enqueueScheduleRunStop({ scheduleId, runId })
  }

  const addFromTemplate = async (tpl: ScheduleTemplate): Promise<RevisionedMutationOutcome> => {
    if (!tenantId) return 'discarded'
    const created = await enqueueScheduleCreation({ tenantId, seed: tpl.seed })
    if (
      created.outcome === 'applied' &&
      scheduledSectionMountedRef.current &&
      scheduleIdRef.current === null
    ) {
      onOpenSchedule(created.taskId)
    }
    return created.outcome
  }

  // Clicking a row drills into the task's workflow + run history.
  const open = scheduleId ? (items.find((t) => t.id === scheduleId) ?? null) : null
  if (open)
    return (
      <>
        <ScheduledDetail
          task={open}
          sectionId={scheduleSectionId}
          running={isScheduleRunHeld(open.id) || open.runs.some((run) => run.status === 'running')}
          mutationHeld={scheduleMutationHeld(open.id)}
          onBack={onBack}
          backTo={backTo}
          onToggleEnabled={() => toggleEnabled(open.id)}
          onRunNow={() => runNow(open.id)}
          onStopRun={(runId) => stopRun(open.id, runId)}
          onOpenSession={onOpenSession}
          onRemove={() => requestDelete(open)}
        />
        {deletionDialog}
      </>
    )
  if (scheduleId) {
    return (
      <UnavailableResourcePage
        title="Routine"
        state={resolveResourceUnavailable([schedulesQ])}
        message="This routine isn’t visible from this account (or no longer exists)."
        backTo={backTo ?? { kind: 'section', section: 'scheduled', projectId: null, scheduleId: null }}
        onBack={onBack}
        onRetry={() => retryResourceQueries([keys.schedules])}
      />
    )
  }

  const needle = query.trim().toLowerCase()
  const matches = items.filter(
    (t) =>
      needle === '' ||
      t.name.toLowerCase().includes(needle) ||
      t.subtitle.toLowerCase().includes(needle) ||
      t.steps.some((s) => s.tool.label.toLowerCase().includes(needle)),
  )
  const filtered = filterRoutines(matches, routineFilter, {
    projectIdOfTask: rel.scheduleProjectId,
    projectName: (projectId) => projects.find((project) => project.id === projectId)?.name ?? 'Project',
  })
  const groups = filtered.groups
    .filter((group) => group.tasks.length > 0)
    .map((group) => ({
      key: group.key,
      label: group.label || 'Routines',
      items: group.tasks,
    }))
  const projection = partitionedCollectionProjection({
    section: 'scheduled',
    fallbackLabel: 'Routines',
    empty: collectionEmptyCopy('routines', items.length),
    itemNoun: 'routine',
    presentation: 'foldable',
    groups: groups.map((group) => ({
      key: group.key,
      label: group.label,
      tone: group.key === 'paused' ? 'muted' : undefined,
      items: collectionProjectionItems(
        group.items,
        (task) => task.id,
        (task) => task.name,
      ),
    })),
  })

  return (
    <>
    <CompositeResourcePage section="scheduled">
      <PageHeader
        title="Routines"
        subtitle="Recurring workflows — Claude runs their steps on a cadence and delivers the result."
      >
        <NewScheduleControl onAdd={addFromTemplate} />
      </PageHeader>
      <SearchBox value={query} onChange={setQuery} placeholder="Search routines…" mirrorsRailFor="scheduled" />
      <CompositePageControls
        section="scheduled"
        filter={
          <ScheduledFilterMenu
            filter={routineFilter}
            onChange={updateRoutineFilter}
            projects={projects}
            placement="page"
          />
        }
      />

      <MainCollectionTemplate
        projection={projection}
        renderItem={(item) => (
          <ScheduledRow
            task={item.value}
            running={isScheduleRunHeld(item.value.id) || item.value.runs.some((run) => run.status === 'running')}
            mutationHeld={scheduleMutationHeld(item.value.id)}
            onOpen={() => onOpenSchedule(item.value.id)}
            onToggle={() => toggleEnabled(item.value.id)}
            onRunNow={() => runNow(item.value.id)}
            onStopRun={(runId) => stopRun(item.value.id, runId)}
            onRemove={() => requestDelete(item.value)}
          />
        )}
      />
    </CompositeResourcePage>
    {deletionDialog}
    </>
  )
}

function ScheduledRow({
  task,
  running,
  mutationHeld,
  onOpen,
  onToggle,
  onRunNow,
  onStopRun,
  onRemove,
}: {
  task: ScheduledTask
  running: boolean
  mutationHeld: boolean
  onOpen: () => void
  onToggle: () => void
  onRunNow: () => void
  onStopRun: (runId: string) => void
  onRemove: () => void
}) {
  const lead = task.steps[0]?.tool ?? task.delivery.tool
  const pill = running ? { tone: 'warn' as const, label: 'Running…' } : taskPill(task)
  const lastRun = task.runs[0]
  return (
    // The row is a @container: its metadata is gated on the row's OWN width,
    // not the viewport (UI-9, docs/ui-invariants.md) — at 768px the viewport
    // is `md:` but the rail leaves this row ~450px, which can't afford what
    // `md:` promises; the rail/panel resize the row independently of the
    // window. Fixed-width blocks yield in order (next-run info, then the
    // pill) so the flex-1 name column — the row's identity — never collapses.
    <div
      onClick={cardDoorClick(onOpen)}
      className={`group @container flex items-center gap-3 ${ROW_DOOR_CLASS}`}
    >
      {/* The WHOLE row drills into the detail (UI-17) — see ContextRow: the hover
          wash covered the row while only this region took the click. The trailing
          controls (run, delete, the enabled switch) keep their own handlers.
          Dividers come from the ledger container's divide-y (lib/ledger). */}
      <div className="flex min-w-0 flex-1 items-center gap-3 py-3">
        <span data-routine-lead className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-panel-2">
          <ToolGlyph tool={lead} size={16} />
        </span>

        <div className="min-w-0 flex-1 overflow-hidden">
          <button
            onClick={onOpen}
            className={`block max-w-full truncate text-left text-[13px] text-ink hover:text-co ${DOOR_CLASS}`}
          >
            {task.name}
          </button>
          <MiniPipeline task={task} />
          <div className="truncate text-[12px] text-ink-faint @2xl:hidden">
            {task.steps.length} step{task.steps.length === 1 ? '' : 's'} · {task.subtitle}
          </div>
        </div>

        <div className="hidden shrink-0 pr-1 text-right @2xl:block">
          <div className="text-[12px] text-ink-soft">next {task.next}</div>
          <div className="text-[11px] text-ink-faint">{lastRun ? `ran ${relativeTime(lastRun.at)}` : 'no runs yet'}</div>
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-2">
        {/* In a tight row the pill yields its width to the name column. The
            labeled state band carries health without a second dot signal. */}
        <span className="hidden @sm:block">
          <StatusPill tone={pill.tone} label={pill.label} />
        </span>

        <div className={`flex items-center gap-1 focus-within:opacity-100 ${HOVER_REVEAL}`}>
          {running ? (canStopScheduleRun(task.own) ? <Tooltip label={SCHEDULE_RUN_STOP_SCOPE}>
            <button onClick={() => { const active = task.runs.find((run) => run.status === 'running'); if (active) onStopRun(active.id) }} disabled={mutationHeld} aria-label={SCHEDULE_RUN_STOP_LABEL} title={SCHEDULE_RUN_STOP_SCOPE} className="flex h-7 w-7 items-center justify-center rounded-md text-danger hover:bg-panel-2 disabled:opacity-40"><Square size={14} /></button>
          </Tooltip> : <span className="text-[11px] text-ink-faint">Running</span>) : <Tooltip label={mutationHeld ? ROUTINE_MUTATION_WAIT : 'Run now'}>
            <button
              onClick={onRunNow}
              disabled={mutationHeld}
              aria-label={`Run ${task.name} now`}
              className="flex h-7 w-7 items-center justify-center rounded-md text-ink-faint transition hover:bg-panel-2 hover:text-ink disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Play size={14} />
            </button>
          </Tooltip>}
          <button
            onClick={onRemove}
            disabled={mutationHeld}
            title={mutationHeld ? ROUTINE_MUTATION_WAIT : 'Delete routine'}
            aria-label={`Delete ${task.name}`}
            className="flex h-7 w-7 items-center justify-center rounded-md text-ink-faint transition hover:bg-removed-bg hover:text-removed disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Trash2 size={14} />
          </button>
        </div>

        <Toggle on={task.enabled} onToggle={onToggle} ariaLabel={`${task.name} enabled`} disabled={mutationHeld} />
      </div>
    </div>
  )
}

/** The row's at-a-glance pipeline: the step tools joined by chevrons, capped by
 *  the delivery target. Collapses the middle to "+N" past four steps. */
function MiniPipeline({ task }: { task: ScheduledTask }) {
  const rel = useRelations()
  const tools = task.steps.map((s) => s.tool)
  const shown = tools.length > 4 ? tools.slice(0, 3) : tools
  const overflow = tools.length - shown.length
  const artifactDelivery = rel.scheduleArtifactFor(task.id)
  const sessionDelivery = rel.scheduleSessionFor(task.id)
  const deliveryTarget = artifactDelivery?.name ?? sessionDelivery
  const ArtifactDeliveryIcon = artifactDelivery ? KIND_ICON[artifactDelivery.kind] : null
  return (
    <div className="mt-1 hidden items-center gap-1 @sm:flex">
      {shown.map((t, i) => (
        <span key={i} className="flex items-center gap-1">
          {i > 0 && <ChevronRight size={11} className="text-ink-faint" />}
          <PipeNode tool={t} />
        </span>
      ))}
      {overflow > 0 && (
        <>
          <ChevronRight size={11} className="text-ink-faint" />
          <span className="rounded bg-panel-2 px-1 text-[10px] font-medium text-ink-soft">+{overflow}</span>
        </>
      )}
      <ChevronRight size={11} className="text-ink-faint" />
      {artifactDelivery && ArtifactDeliveryIcon ? (
        <span
          title={`${KIND_LABEL[artifactDelivery.kind]} · ${deliveryTarget}`}
          aria-label={`${KIND_LABEL[artifactDelivery.kind]} · ${deliveryTarget}`}
          className="flex h-5 min-w-0 max-w-40 items-center gap-1 rounded bg-panel-2 px-1 text-[10px] font-medium text-ink-soft"
        >
          <ArtifactDeliveryIcon size={12} className="shrink-0" />
          <span className="truncate">{KIND_LABEL[artifactDelivery.kind]} · {deliveryTarget}</span>
        </span>
      ) : (
        <PipeNode tool={task.delivery.tool} />
      )}
    </div>
  )
}

/** "New routine" — a template picker cloned from AddContextControl. Picking a
 *  template seeds a fully-formed (paused) task into local state and drills straight
 *  into its detail, so the user lands on a populated workflow rather than a form. */
function NewScheduleControl({
  onAdd,
}: {
  onAdd: (tpl: ScheduleTemplate) => Promise<RevisionedMutationOutcome>
}) {
  const [open, setOpen] = useState(false)
  const [pendingTemplate, setPendingTemplate] = useState<string | null>(null)
  const [creationError, setCreationError] = useState<string | null>(null)
  const held = pendingTemplate !== null
  const ref = useDismissable<HTMLDivElement>(open, () => {
    if (!held) setOpen(false)
  })
  const popRef = usePopoverShift<HTMLDivElement>(open)
  const templates = useScheduleTemplates().data ?? []

  // Group templates by category, preserving first-seen order.
  const cats: { label: string; items: ScheduleTemplate[] }[] = []
  for (const t of templates) {
    let c = cats.find((x) => x.label === t.category)
    if (!c) {
      c = { label: t.category, items: [] }
      cats.push(c)
    }
    c.items.push(t)
  }

  const createFromTemplate = async (tpl: ScheduleTemplate) => {
    if (pendingTemplate) return
    setPendingTemplate(tpl.name)
    setCreationError(null)
    const outcome = await onAdd(tpl)
    if (outcome === 'applied') setOpen(false)
    else setCreationError('The routine was not created. Your template choice is still here.')
    setPendingTemplate(null)
  }
  const togglePicker = () => setOpen((current) => !current)
  const openFromRail = () => { if (!held) setOpen(true) }

  return (
    <div ref={ref} className="relative">
      <PageActionButton
        icon={<Plus size={15} />}
        onClick={togglePicker}
        disabled={held}
        mirrorsRailFor="scheduled"
        onRailInvoke={openFromRail}
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        New routine
      </PageActionButton>

      {open && (
        <div
          ref={popRef}
          role="dialog"
          aria-label="New routine"
          aria-busy={held || undefined}
          className={`absolute right-0 z-30 mt-2 w-[340px] overflow-hidden ${POPOVER_SURFACE}`}
        >
          <div className="max-h-[min(60dvh,440px)] overflow-y-auto p-2">
            <ScheduleCreationFeedback pendingTemplate={pendingTemplate} error={creationError} />
            {cats.map((c) => (
              <div key={c.label} className="pb-1">
                <p className="px-1.5 pb-1 pt-1 text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
                  {c.label}
                </p>
                {c.items.map((t) => (
                  <NewScheduleRow
                    key={t.name}
                    tpl={t}
                    onAdd={() => void createFromTemplate(t)}
                    disabled={held}
                    busy={pendingTemplate === t.name}
                  />
                ))}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function ScheduleCreationFeedback({
  pendingTemplate,
  error,
}: {
  pendingTemplate: string | null
  error: string | null
}) {
  if (!pendingTemplate && !error) return null
  return (
    <div
      role="status"
      className={`mx-1 mb-2 rounded-md px-2 py-1.5 text-[11px] ${
        error ? 'bg-removed-bg text-removed' : 'bg-accent/10 text-accent'
      }`}
    >
      {pendingTemplate ? `Creating “${pendingTemplate}”… Keep this picker open until it is confirmed.` : error}
    </div>
  )
}

function NewScheduleRow({
  tpl,
  onAdd,
  disabled = false,
  busy = false,
}: {
  tpl: ScheduleTemplate
  onAdd: () => void
  disabled?: boolean
  busy?: boolean
}) {
  const lead = tpl.seed.steps[0]?.tool
  const blank = tpl.category === 'Start from scratch'
  return (
    <button
      onClick={onAdd}
      disabled={disabled}
      aria-label={tpl.name}
      className="group mb-0.5 flex w-full items-center gap-2.5 rounded-lg px-1.5 py-1.5 text-left transition hover:bg-panel-2 disabled:cursor-not-allowed disabled:opacity-50"
    >
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-panel-2 text-ink-soft">
        {blank ? <Sparkles size={15} className="text-accent" /> : lead ? <ToolGlyph tool={lead} size={15} /> : <Clock size={15} />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-medium text-ink">{tpl.name}</span>
        <span className="block truncate text-[11px] text-ink-faint">{tpl.preview}</span>
      </span>
      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md text-ink-faint transition group-hover:bg-accent-solid group-hover:text-on-solid">
        {busy ? <Spinner size={13} /> : <Plus size={14} />}
      </span>
    </button>
  )
}

/** Drill-down for one scheduled task: the instruction, the workflow rail (lit by
 *  whichever run is selected), recent runs, and the schedule / delivery / tools /
 *  model side panels. */
function ScheduledDetail({
  task,
  sectionId,
  running,
  mutationHeld,
  onBack,
  backTo,
  onToggleEnabled,
  onRunNow,
  onStopRun,
  onOpenSession,
  onRemove,
}: {
  task: ScheduledTask
  sectionId?: string | null
  running: boolean
  mutationHeld: boolean
  onBack: () => void
  backTo: NavLocation | null
  onToggleEnabled: () => void
  onRunNow: () => void
  onStopRun: (runId: string) => void
  /** Open a run's session — the run-history rows link here, same destination as
   *  clicking the routine in the left rail. */
  onOpenSession: (id: string) => void
  onRemove: () => void
}) {
  useRecordView('schedule', task.id)
  const rel = useRelations()
  // Editing the routine name is a per-action entity edit; the delivery + notify
  // settings live in DeliveryPanel below.
  const [editingName, setEditingName] = useState(false)
  const [nameDraft, setNameDraft] = useState(task.name)
  const nameBaseRevision = useRef(task.revision ?? 0)
  const {
    busy: nameBusy,
    error: nameError,
    clearError: clearNameError,
    commit,
  } = useScheduleDraftCommit(updateSchedule, task.id, 'name', () => setEditingName(false))
  const cancelName = () => {
    if (nameBusy) return
    setNameDraft(task.name)
    clearNameError()
    setEditingName(false)
  }
  const saveName = async () => {
    const next = nameDraft.trim()
    if (!next || next === task.name || nameBusy) return
    await commit({ name: next }, nameBaseRevision.current)
  }

  // The rail reflects the freshest run (a live "Run now" overrides it with an
  // in-flight state until the new run resolves). Inspecting an *older* run is now
  // done by opening its session from the run history, which carries the full
  // thread + its own run switcher.
  const shownRun = running ? null : (task.runs[0] ?? null)
  const artifactDelivery = rel.scheduleArtifactFor(task.id)
  const artifactDeliveryTarget = artifactDelivery?.name
  const DeliveryIcon = artifactDelivery
    ? KIND_ICON[artifactDelivery.kind]
    : stepToolIcon(task.delivery.tool.id)
  const deliveryLabel = artifactDelivery
    ? `${KIND_LABEL[artifactDelivery.kind]} · ${artifactDeliveryTarget}`
    : task.delivery.tool.label

  // The Sharing stub's source — the roster the section itself renders, never a
  // second fact about it (the project page's stub got that wrong first).
  const scheduleGrants = useGrants('schedule', task.id).data ?? []
  // …and its grant composer's disclosure, the same as the project page's.
  const [sharingSchedule, setSharingSchedule] = useState(false)
  const [sharingHeld, setSharingHeld] = useState(false)
  const selectedSection = scheduleSection(sectionId)
  // A direct Sharing address is the share act itself, not an overview section
  // waiting for a second disclosure click (UI-18's host-vs-payload distinction).
  const sharingPage = selectedSection?.id === 'sharing'
  const own = task.own !== false
  const sectionAllowed = selectedSection?.visibility !== 'owner' || own
  const showScheduleSection = (id: ScheduleSectionId) =>
    sectionAllowed && (!selectedSection || selectedSection.id === id)

  return (
    <CompositeResourcePage section="scheduled" sectionPage={selectedSection !== undefined}>
      {/* A routine is a composite resource: instruction + workflow + execution
          history + its standing configuration. ProjectDetail established the
          page form for that nature, so routines use the same discoverable fold
          scope rather than a payload column plus a configuration sidebar. */}
      <header className={`${PAGE_HEADER_CLASS} ${SECTION_REVEAL_GROUP}`}>
        <div className="flex min-w-0 items-start gap-3">
          <BackButton to={backTo} onBack={onBack} />
          <span
            data-routine-delivery-icon
            title={deliveryLabel}
            {...namedIconProps(deliveryLabel)}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-panel-2 text-ink-soft"
          >
            <DeliveryIcon size={20} />
          </span>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              {editingName ? (
                <>
                  <h1 className="sr-only">{task.name}</h1>
                  <div className="flex min-w-0 items-center gap-1" aria-busy={nameBusy}>
                    <input
                      autoFocus
                      disabled={nameBusy}
                      value={nameDraft}
                      onChange={(e) => setNameDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Escape') cancelName()
                        if (e.key === 'Enter') void saveName()
                      }}
                      aria-label="Routine name"
                      className={`${PAGE_TITLE_CLASS} min-w-0 max-w-full rounded-md border border-accent bg-surface px-1.5 py-0.5 outline-none disabled:opacity-60`}
                    />
                    <button
                      onClick={() => void saveName()}
                      disabled={nameBusy || !nameDraft.trim() || nameDraft.trim() === task.name}
                      aria-label={nameBusy ? 'Saving routine name…' : 'Save routine name'}
                      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-accent transition hover:bg-accent-tint disabled:cursor-not-allowed disabled:opacity-45"
                    >
                      {nameBusy ? <Spinner size={13} /> : <Check size={13} />}
                    </button>
                    <button
                      onClick={cancelName}
                      disabled={nameBusy}
                      aria-label="Cancel routine rename"
                      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-ink-faint transition hover:bg-panel-2 hover:text-ink disabled:cursor-not-allowed disabled:opacity-45"
                    >
                      <X size={13} />
                    </button>
                  </div>
                </>
              ) : task.own !== false ? (
                <button
                  disabled={mutationHeld}
                  onClick={() => {
                    setNameDraft(task.name)
                    nameBaseRevision.current = task.revision ?? 0
                    clearNameError()
                    setEditingName(true)
                  }}
                  title={mutationHeld ? ROUTINE_MUTATION_WAIT : 'Rename routine'}
                  className="group flex min-w-0 items-center gap-1.5 rounded-md text-left transition hover:bg-panel-2/60 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <h1 {...identityTitleProps(task.name)} className={`${PAGE_TITLE_CLASS} truncate`}>{task.name}</h1>
                  <Pencil size={14} className={`shrink-0 text-ink-faint ${HOVER_CUE}`} />
                </button>
              ) : (
                // A visitor reads the name; renaming is the owner's act.
                <h1 {...identityTitleProps(task.name)} className={`${PAGE_TITLE_CLASS} truncate`}>{task.name}</h1>
              )}
              {running ? (
                <StatusPill tone="warn" label="Running…" />
              ) : !task.enabled ? (
                <StatusPill tone="neutral" label="Paused" />
              ) : task.lastStatus === 'failed' ? (
                <StatusPill tone="bad" label="Failed" />
              ) : (
                <StatusPill tone="ok" label="Active" />
              )}
            </div>
            <p className="mt-0.5 truncate text-[13px] text-ink-soft">{task.subtitle}</p>
            {nameError && <p role="status" className="mt-1 text-[12px] text-removed">{nameError}</p>}
            {selectedSection && (
              <p className="mt-0.5 text-[13px] font-medium text-ink-soft">{selectedSection.label}</p>
            )}
          </div>
        </div>

        {/* Run / Pause / Delete are the OWNER's acts — the routine's write routes
            gate on ownership, not the (now grant-widened) read. A visitor who was
            shared this routine reads it, discusses it and offers improvements;
            they never see a control that would 404. */}
        {task.own !== false && (
          <SectionActions>
          {canStopScheduleRun(task.own) && task.runs.filter((run) => run.status === 'running').map((run) => (
            <SectionAction key={`stop-${run.id}`} label={isScheduleRunStopHeldForTask(task.id) ? SCHEDULE_RUN_STOP_PENDING_LABEL : SCHEDULE_RUN_STOP_LABEL} icon={<Square size={14} />} onClick={() => onStopRun(run.id)} disabled={mutationHeld} disabledReason={mutationHeld ? ROUTINE_MUTATION_WAIT : SCHEDULE_RUN_STOP_SCOPE} />
          ))}
            {!running && <SectionAction
              label="Run now"
              icon={<Play size={14} />}
              onClick={onRunNow}
              disabled={mutationHeld}
              disabledReason={mutationHeld ? ROUTINE_MUTATION_WAIT : undefined}
            />}
            <SectionAction
              label={task.enabled ? 'Pause routine' : 'Resume routine'}
              icon={task.enabled ? <PauseCircle size={14} /> : <PlayCircle size={14} />}
              onClick={onToggleEnabled}
              disabled={mutationHeld}
              disabledReason={mutationHeld ? ROUTINE_MUTATION_WAIT : undefined}
            />
            <SectionAction label="Delete routine" icon={<Trash2 size={14} />} onClick={onRemove} disabled={mutationHeld} disabledReason={mutationHeld ? ROUTINE_MUTATION_WAIT : undefined} />
          </SectionActions>
        )}
      </header>

      {canStopScheduleRun(task.own) && running && <p data-routine-stop-scope className={AUTOMATION_NOTICE_CLASS}>{SCHEDULE_RUN_STOP_SCOPE}</p>}

      {!selectedSection && <CompositePageControls section="scheduled" />}
        <div>
          {!sectionAllowed && selectedSection && (
            <div className="border-t border-line-strong py-6">
              <h2 className="text-[15px] font-semibold text-ink">{selectedSection.label}</h2>
              <p className="mt-1 text-[13px] text-ink-soft">This routine section is private to its owner.</p>
            </div>
          )}
          {showScheduleSection('instruction') && (
            <PromptCard task={task} editable={own} />
          )}
          {showScheduleSection('workflow') && <WorkflowCard task={task} run={shownRun} running={running} />}

        {/* The bounded definition comes first. The owner's standing
            configuration follows as folded index rows, then the histories that
            can grow forever. This is the exact bounded → configuration → history
            ordering the project page established for composite resources. */}
        {own && (
        <>
          {/* Sharing — the OWNER's audience configuration, as on a project.
              Without it the routine's social surface was unreachable: it could be
              discussed and improved, but never shared with anyone to discuss or
              improve it.

              `defaultFolded` here is not decoration — it is REQUIRED to agree with
              the project page's Sharing, because the fold posture is keyed by
              TITLE (`lib/sectionFold.ts`: one preference about a kind of content,
              which is what keeps the key space bounded). Two same-named sections
              declaring different defaults would differ until the reader touched
              either one and then agree forever, which is a state nobody designed.
              The constraint the key imposes is now a lock —
              `main-column-sections.test.ts`. */}
          {showScheduleSection('sharing') && <FoldSection
            title="Sharing"
            defaultFolded
            heldOpen={sharingHeld}
            summary={
              scheduleGrants.length > 0 ? scheduleGrants.map((g) => audienceLabel(g.audience)).join(' · ') : 'Not shared'
            }
            // The same verb the project page's Sharing carries (UI-18). This
            // section was left standing-open when that one was fixed, which is
            // the shape of miss the FIRST lock could not see: it asked whether
            // SOME disclosure gate appeared before the field, and this component
            // has an unrelated one (the name editor) hundreds of lines earlier.
            // A gate is not a gate for every field in the file.
            actions={!sharingPage ?
              <SectionAction
                label="Share with an audience"
                icon={<Plus size={14} />}
                onClick={() => setSharingSchedule((v) => !v)}
                expanded={sharingSchedule}
                disabled={sharingHeld}
                disabledReason={sharingHeld ? SHARING_MUTATION_WAIT : undefined}
              />
              : undefined
            }
          >
            <GrantsPanel
              subject={{ kind: 'schedule', id: task.id }}
              composing={sharingPage || sharingSchedule}
              onHeldChange={setSharingHeld}
            />
          </FoldSection>}

          {showScheduleSection('schedule') && <SchedulePanel task={task} />}

          {showScheduleSection('delivery') && <DeliveryPanel task={task} />}

          {showScheduleSection('context-tools') && <ContextToolsPanel task={task} />}

          {showScheduleSection('external-mcp') && (
            <Suspense fallback={<InlineOperationStatus tone="status" message="Loading External MCP review…" />}>
              <DeferredRoutineMcpApprovalPanel routineId={task.id} routineName={task.name} />
            </Suspense>
          )}

          {showScheduleSection('model') && <ModelPanel task={task} />}
        </>
        )}

          {showScheduleSection('recent-runs') && (
            <RunHistoryCard task={task} onOpenRun={(runId) => onOpenSession(runSessionId(task.id, runId))} />
          )}
          {/* A routine is a social subject like any other: it can be shared,
              discussed, and IMPROVED. Landing a routine change runs the same
              `updateSchedule` the owner's own editor calls. */}
          {showScheduleSection('improvements') && (
            <ProposalsPanel subject={{ kind: 'schedule', id: task.id }} own={own} Section={FoldSection} />
          )}
          {showScheduleSection('discussion') && <DiscussionsPanel subject={{ kind: 'schedule', id: task.id }} own={own} />}
        </div>
    </CompositeResourcePage>
  )
}

/** The verbatim instruction every run executes against. A granted visitor sees
 * the payload; an owner edits one retained draft whose Save does not close the
 * section until the revisioned write is acknowledged. */
function PromptCard({ task, editable }: { task: ScheduledTask; editable: boolean }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(task.prompt)
  const baseRevision = useRef(task.revision ?? 0)
  const taRef = useRef<HTMLTextAreaElement>(null)
  const { busy, error, clearError, commit } = useScheduleDraftCommit(
    updateSchedule,
    task.id,
    'instruction',
    () => setEditing(false),
  )

  const startEdit = () => {
    setDraft(task.prompt)
    baseRevision.current = task.revision ?? 0
    clearError()
    setEditing(true)
  }
  const close = () => {
    if (busy) return
    clearError()
    setEditing(false)
  }
  const save = async () => {
    const next = draft.trim()
    if (!next || busy) return
    if (next === task.prompt) {
      close()
      return
    }
    await commit({ prompt: next }, baseRevision.current)
  }
  useEffect(() => {
    if (editing) taRef.current?.focus()
  }, [editing])

  return (
    <FoldSection
      title="Instruction"
      heldOpen={busy}
      summary={task.prompt}
      actions={
        !editing ? (
          <>
            {editable && <SectionAction label="Edit instruction" icon={<Pencil size={13} />} onClick={startEdit} />}
            <CopyButton text={task.prompt} ariaLabel="Copy instruction" variant="section" />
          </>
        ) : undefined
      }
    >
      {editing ? (
        <fieldset disabled={busy} className="contents">
          <textarea
            ref={taRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') close()
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void save()
            }}
            rows={5}
            placeholder="What should this routine do each time it runs?"
            className="w-full resize-none rounded-md border border-line bg-surface px-3 py-2.5 text-[13px] leading-relaxed text-ink outline-none transition placeholder:text-ink-faint focus:border-co disabled:opacity-60"
          />
          {error && <p role="status" className="mt-2 text-[12px] text-removed">{error}</p>}
          <div className="mt-2 flex items-center justify-end gap-2">
            <button
              onClick={close}
              disabled={busy}
              className="rounded-md px-2 py-1 text-[12px] font-medium text-ink-soft transition hover:text-ink disabled:cursor-not-allowed disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              onClick={() => void save()}
              disabled={busy || !draft.trim()}
              className={`flex items-center gap-1 ${SOFT_BUTTON_CLASS} px-2.5 py-1 text-[12px] disabled:cursor-not-allowed disabled:opacity-50`}
            >
              {busy ? <Spinner size={13} /> : <Check size={13} />}
              {busy ? 'Saving instruction…' : 'Save'}
            </button>
          </div>
        </fieldset>
      ) : (
        <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-ink">
          {task.prompt}
        </p>
      )}
    </FoldSection>
  )
}

type RailState = 'idle' | 'done' | 'fail' | 'running'

// Backgrounds are opaque (not a /10 alpha) so the rail line stays hidden behind
// the marker; the tint still reads as a soft fill for done / failed steps.
function railMarkerClasses(state: RailState): string {
  if (state === 'done') return 'border-ok bg-ok-tint text-ok-text'
  if (state === 'fail') return 'border-danger bg-danger-tint text-danger'
  if (state === 'running') return 'border-accent bg-surface text-accent'
  return 'border-line bg-surface text-ink-soft'
}

/** One node on the workflow rail. The vertical connector below the marker turns
 *  green once this node is complete, so a finished run's green "flows down" the
 *  rail to exactly the step it reached. */
function RailRow({
  state,
  connect,
  marker,
  delivery = false,
  children,
}: {
  state: RailState
  connect: boolean
  marker: ReactNode
  delivery?: boolean
  children: ReactNode
}) {
  const content =
    !delivery && state === 'done' ? (
      <Check size={14} />
    ) : !delivery && state === 'fail' ? (
      <AlertCircle size={14} />
    ) : !delivery && state === 'running' ? (
      <Spinner size={13} />
    ) : (
      marker
    )
  return (
    <div className="relative flex gap-3">
      {connect && (
        <span
          className={`absolute bottom-0 left-[13px] top-7 w-0.5 ${state === 'done' ? 'bg-ok' : 'bg-line'}`}
        />
      )}
      <span
        className={`relative z-10 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-2 bg-surface text-[12px] font-semibold ${railMarkerClasses(
          state,
        )}`}
      >
        {content}
      </span>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  )
}

/** The hero: the WHEN trigger, the numbered step rail, and the DELIVER terminus —
 *  all lit to reflect the selected run. */
function WorkflowCard({ task, run, running }: { task: ScheduledTask; run: ScheduledRun | null; running: boolean }) {
  const rel = useRelations()
  const [editing, setEditing] = useState(false)
  const [draftHeld, setDraftHeld] = useState(false)
  const reached = run ? run.reachedStep : 0
  const failedAt = run && run.status === 'failed' ? run.reachedStep : -1
  // A standing "save X / open a session each run" edit overrides where the
  // terminal node delivers, so the rail matches the "Delivers to" panel. An
  // artifact carries its own format: never label or draw it as the base
  // connector merely because that connector remains in the routine definition.
  const artifactDelivery = rel.scheduleArtifactFor(task.id)
  const sessionDelivery = rel.scheduleSessionFor(task.id)
  const overrideTarget = artifactDelivery?.name ?? sessionDelivery
  const deliveryTarget = overrideTarget ?? task.delivery.target
  const deliveryLabel = artifactDelivery ? KIND_LABEL[artifactDelivery.kind] : task.delivery.tool.label
  const ArtifactDeliveryIcon = artifactDelivery ? KIND_ICON[artifactDelivery.kind] : null

  const stepState = (i: number): RailState => {
    if (running) return 'running'
    if (!run) return 'idle'
    if (i < reached) return 'done'
    if (i === failedAt) return 'fail'
    return 'idle'
  }
  const deliveredState: RailState = running
    ? 'running'
    : run && run.status === 'ok' && run.reachedStep >= task.steps.length
      ? 'done'
      : 'idle'

  return (
    <FoldSection
      title="Workflow"
      heldOpen={draftHeld}
      summary={`${countLabel(task.steps.length, 'step')} · ${task.trigger}`}
      actions={
        task.own === true && !editing ? (
          <SectionAction label="Edit steps" icon={<Pencil size={13} />} onClick={() => setEditing(true)} />
        ) : undefined
      }
    >
        <div className="mb-3 flex items-center gap-2.5 rounded-lg bg-panel-2/40 px-3 py-2.5">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-surface text-ink-soft">
            <Clock size={15} />
          </span>
          <span className="text-[11px] font-semibold uppercase tracking-wide text-ink-faint">When</span>
          <span className="min-w-0 truncate text-[13px] text-ink">{task.trigger}</span>
        </div>

        {editing && task.own === true ? (
          <StepsEditor task={task} onHeldChange={setDraftHeld} onClose={() => setEditing(false)} />
        ) : (
          <div className="relative">
            {task.steps.map((s, i) => (
              <RailRow key={s.id} state={stepState(i)} connect marker={i + 1}>
                <div className="pb-5">
                  <ToolChip tool={s.tool} />
                  <p className="mt-1 text-[13px] text-ink">{s.action}</p>
                </div>
              </RailRow>
            ))}

            <RailRow
              state={deliveredState}
              connect={false}
              delivery
              marker={ArtifactDeliveryIcon
                ? <ArtifactDeliveryIcon size={14} />
                : <ToolGlyph tool={task.delivery.tool} size={14} />}
            >
              <div className="rounded-lg bg-accent-tint px-3 py-2.5">
                <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-accent-strong">
                  <SendHorizontal size={12} />
                  Deliver
                </div>
                <div className="mt-1 text-[13px] font-medium text-ink">
                  {deliveryLabel} · {deliveryTarget}
                </div>
                {!overrideTarget && task.delivery.note && (
                  <p className="mt-0.5 text-[12px] text-ink-soft">{task.delivery.note}</p>
                )}
              </div>
            </RailRow>
          </div>
        )}
    </FoldSection>
  )
}

/** The workflow step editor — a draft of the ordered steps you can reorder, edit
 *  (action text + tool), add to, and remove from, committed as one
 *  updateSchedule({ steps }) on Save (an entity field edit; the standing
 *  scheduleExtraTools overlay is a separate relation surface and is untouched). */
function StepsEditor({
  task,
  onHeldChange,
  onClose,
}: {
  task: ScheduledTask
  onHeldChange: (held: boolean) => void
  onClose: () => void
}) {
  const [steps, setSteps] = useState<WorkflowStep[]>(() => task.steps.map((s) => ({ ...s })))
  const [picking, setPicking] = useState<string | null>(null)
  const baseRevision = useRef(task.revision ?? 0)
  const { busy, error, commit } = useScheduleDraftCommit(updateSchedule, task.id, 'workflow', onClose, onHeldChange)

  const setAction = (i: number, action: string) =>
    setSteps((s) => s.map((x, j) => (j === i ? { ...x, action } : x)))
  const setTool = (i: number, tool: StepTool) => {
    setSteps((s) => s.map((x, j) => (j === i ? { ...x, tool } : x)))
    setPicking(null)
  }
  const add = () =>
    setSteps((s) => [...s, { id: crypto.randomUUID(), action: '', tool: STEP_TOOLS[0] }])
  const save = async () => {
    await commit({ steps: cleanSteps(steps) }, baseRevision.current)
  }

  return (
    <div aria-busy={busy}>
      <fieldset disabled={busy} className="contents">
        <div className="space-y-2">
          {steps.map((s, i) => (
            <div key={s.id} className="flex items-start gap-2 rounded-lg border border-line bg-panel-2/25 p-2">
              <span className="mt-1 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-line-strong bg-surface text-[11px] font-semibold text-ink-soft">
                {i + 1}
              </span>
              <div className="min-w-0 flex-1">
                <div className="relative inline-block">
                  <button
                    onClick={() => setPicking((p) => (p === s.id ? null : s.id))}
                    aria-haspopup="dialog"
                    aria-expanded={picking === s.id}
                    className="inline-flex items-center gap-1 rounded-md bg-surface px-1.5 py-0.5 text-[11px] font-medium text-ink ring-1 ring-line-strong transition hover:ring-accent"
                  >
                    <ToolGlyph tool={s.tool} size={12} />
                    {s.tool.label}
                    {s.tool.needsAuth && <span className="ml-0.5 h-1.5 w-1.5 rounded-full bg-warn" />}
                    <ChevronDown size={11} className="text-ink-faint" />
                  </button>
                  {picking === s.id && <StepToolPicker onPick={(t) => setTool(i, t)} onClose={() => setPicking(null)} />}
                </div>
                <textarea
                  value={s.action}
                  onChange={(e) => setAction(i, e.target.value)}
                  rows={2}
                  placeholder="What this step does…"
                  className="mt-1.5 w-full resize-none rounded-md border border-line bg-surface px-2 py-1.5 text-[13px] leading-snug text-ink outline-none transition placeholder:text-ink-faint focus:border-co"
                />
              </div>
              <div className="flex shrink-0 flex-col items-center gap-0.5">
                <button
                  onClick={() => setSteps((cur) => moveStep(cur, i, -1))}
                  disabled={i === 0}
                  title="Move up"
                  aria-label="Move step up"
                  className="flex h-5 w-5 items-center justify-center rounded text-ink-faint transition hover:bg-panel-2 hover:text-ink disabled:opacity-30"
                >
                  <ChevronUp size={13} />
                </button>
                <button
                  onClick={() => setSteps((cur) => moveStep(cur, i, 1))}
                  disabled={i === steps.length - 1}
                  title="Move down"
                  aria-label="Move step down"
                  className="flex h-5 w-5 items-center justify-center rounded text-ink-faint transition hover:bg-panel-2 hover:text-ink disabled:opacity-30"
                >
                  <ChevronDown size={13} />
                </button>
                <button
                  onClick={() => setSteps((cur) => removeStep(cur, i))}
                  title="Remove step"
                  aria-label="Remove step"
                  className="flex h-5 w-5 items-center justify-center rounded text-ink-faint transition hover:bg-removed-bg hover:text-removed"
                >
                  <Trash2 size={12} />
                </button>
              </div>
            </div>
          ))}
          {steps.length === 0 && (
            <p className="rounded-lg border border-dashed border-line py-4 text-center text-[12px] text-ink-faint">
              No steps yet — add the first one.
            </p>
          )}
        </div>

        <button
          onClick={add}
          className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-md border border-dashed border-line-strong py-2 text-[12px] font-medium text-ink-soft transition hover:border-accent hover:text-ink"
        >
          <Plus size={14} />
          Add step
        </button>

        {error && <p role="status" className="mt-2 text-[12px] text-removed">{error}</p>}

        <div className="mt-3 flex items-center justify-end gap-2 border-t border-line pt-3">
          <button onClick={onClose} disabled={busy} className="rounded-md px-2.5 py-1 text-[12px] font-medium text-ink-soft transition hover:text-ink disabled:cursor-not-allowed disabled:opacity-50">
            Cancel
          </button>
          <button
            onClick={save}
            disabled={busy}
            className={`flex items-center gap-1 ${SOFT_BUTTON_CLASS} px-2.5 py-1 text-[12px] disabled:cursor-not-allowed disabled:opacity-50`}
          >
            {busy ? <Spinner size={13} /> : <Check size={13} />}
            {busy ? 'Saving workflow…' : 'Save workflow'}
          </button>
        </div>
      </fieldset>
    </div>
  )
}

/** A tool picker popover — by default the whole STEP_TOOLS catalog (the step
 *  editor), or a caller-narrowed list (e.g. the Context-&-tools panel offers only
 *  connectors not already present). Tinted by tone. */
function StepToolPicker({
  onPick,
  onClose,
  tools = STEP_TOOLS,
  align = 'left',
}: {
  onPick: (tool: StepTool) => void
  onClose: () => void
  tools?: StepTool[]
  /** Which trigger edge the drop hugs: 'left' under an in-content trigger,
   *  'right' under a header-cluster verb at the panel's right edge (else the
   *  200px list floats off into the page gutter beside the panel). */
  align?: 'left' | 'right'
}) {
  // Mounted only while open (the parent conditionally renders it), so the dismiss
  // listeners should be live for its whole lifetime — pass open=true.
  const ref = useDismissable<HTMLDivElement>(true, onClose)
  const popRef = usePopoverShift<HTMLDivElement>(true)

  return (
    <div
      ref={(el) => {
        ref.current = el
        popRef.current = el
      }}
      role="dialog"
      aria-label="Pick a tool"
      className={`absolute top-full z-30 mt-1 max-h-[240px] w-[200px] overflow-y-auto p-1 ${
        align === 'right' ? 'right-0' : 'left-0'
      } ${POPOVER_SURFACE}`}
    >
      {tools.length === 0 && (
        <div className="px-2 py-3 text-center text-[12px] text-ink-faint">Every tool is already here.</div>
      )}
      {tools.map((t) => (
        <button
          key={t.id}
          onClick={() => onPick(t)}
          className="flex w-full items-center gap-2 rounded-lg px-1.5 py-1.5 text-left transition hover:bg-panel-2"
        >
          <ToolGlyph tool={t} size={14} />
          <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-ink">{t.label}</span>
          {t.needsAuth && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-warn" title="Needs auth" />}
        </button>
      ))}
    </div>
  )
}

function RunStatusIcon({ status }: { status: ScheduledRun['status'] }) {
  if (status === 'running') return <Spinner size={16} className="mt-0.5 shrink-0 text-accent" />
  if (status === 'failed') return <AlertCircle size={16} className="mt-0.5 shrink-0 text-danger" />
  if (status === 'cancelled') return <Square size={16} className="mt-0.5 shrink-0 text-ink-faint" />
  if (status === 'skipped') return <MinusCircle size={16} className="mt-0.5 shrink-0 text-ink-faint" />
  return <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-ok" />
}

/** A GitHub-streak-style strip of the last seven runs, newest on the right. */
function WeekStrip({ runs }: { runs: ScheduledRun[] }) {
  const recent = runs.slice(0, 7).reverse()
  const pad = Math.max(0, 7 - recent.length)
  const cells: (ScheduledRun['status'] | null)[] = [...Array(pad).fill(null), ...recent.map((r) => r.status)]
  return (
    <div className="flex items-center gap-1" title="Last 7 runs">
      {cells.map((s, i) => (
        <span
          key={i}
          className={`h-4 w-1.5 rounded-sm ${
            s === 'ok'
              ? 'bg-ok'
              : s === 'failed'
                ? 'bg-danger'
                : s === 'running'
                  ? 'bg-accent'
                  : s === 'skipped'
                    ? 'bg-line-strong'
                    : s === 'cancelled' ? 'bg-ink-faint' : 'bg-line'
          }`}
        />
      ))}
    </div>
  )
}

/** Recent runs — a 7-day reliability strip plus the run list; each row opens that
 *  run's own session (its full thread + run switcher), the same destination as
 *  clicking the routine in the left rail. */
function RunHistoryCard({
  task,
  onOpenRun,
}: {
  task: ScheduledTask
  onOpenRun: (id: string) => void
}) {
  return (
    <FoldSection
      title="Recent runs"
      summary={countOr(task.runs.length, 'run', 'runs', 'No runs')}
    >
      {task.runs.length === 0 ? (
        <p className="py-4 text-center text-[13px] text-ink-faint">No runs yet — Run now to try it.</p>
      ) : (
        <>
          <div className="mb-2 flex justify-end">
            <WeekStrip runs={task.runs} />
          </div>
          <CardList>
            {task.runs.map((r) => <RunRow key={r.id} run={r} taskId={task.id} onOpen={() => onOpenRun(r.id)} />)}
          </CardList>
        </>
      )}
    </FoldSection>
  )
}

/** One run of a routine — an addressable POSITION inside it (SOCIAL-6b), so it
 *  hosts the locus gutter and can be landed on by a `schedule-run` anchor.
 *
 *  The whole row used to BE the button. It can't stay one: a gutter control
 *  nested inside a button is invalid HTML and steals the row's click. So the row
 *  becomes a container and its TITLE is the door — which is this repo's rule
 *  anyway (titles are doors, src/CLAUDE.md; the whole-row button predated it). */
function RunRow({
  run,
  taskId,
  onOpen,
}: {
  run: ScheduledRun
  taskId: string
  onOpen: () => void
}) {
  const { pending } = usePendingFocus()
  const rowRef = useRef<HTMLDivElement>(null)
  const flash = useFocusFlash(pending?.runId === run.id, rowRef)
  return (
    <div
      ref={rowRef}
      onClick={cardDoorClick(onOpen)}
      // The whole row opens the run's session (UI-17); the chevron beside the
      // duration was already a hint, not a control. The flash owns the background
      // while it lasts — see CommonsCard for why the two can't be worn together.
      // Dividers come from the ledger container's divide-y (lib/ledger).
      className={`group flex items-start gap-3 py-3 transition ${
        flash ? FOCUS_FLASH_CLASS : ROW_DOOR_CLASS
      }`}
    >
      <RunStatusIcon status={run.status} />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <button
            onClick={onOpen}
            title="Open this run’s session"
            className={`truncate text-left text-[13px] text-ink hover:text-co ${DOOR_CLASS}`}
          >
            {relativeTime(run.at)}
          </button>
          <div className="flex shrink-0 items-baseline gap-1.5">
            {run.duration !== '—' && <span className="text-[11px] text-ink-faint">ran in {run.duration}</span>}
            <ChevronRight size={15} className={`text-ink-faint ${HOVER_CUE}`} />
          </div>
        </div>
        <p className={`mt-0.5 text-[12px] ${run.status === 'failed' ? 'text-danger-strong' : 'text-ink-soft'}`}>
          {run.summary}
        </p>
        {/* A failed run is exactly the thing a team talks about — and now the
            talk hangs on THAT run, not the whole routine. */}
        <LocusGutter
          subject={{ kind: 'schedule', id: taskId }}
          locus={{ kind: 'schedule-run', runId: run.id }}
          noun="run"
        />
      </div>
    </div>
  )
}

/** The distinct connectors / tools the workflow touches (the pure-reasoning Claude
 *  steps are omitted), each with its auth status — so a "Needs auth" tool explains
 *  at a glance why a run might fail. */
/** The "Delivers to" panel — where each run's output lands. The base destination
 *  (tool + target) is an entity field, editable here via updateSchedule({delivery}).
 *  A STANDING relation override (set-schedule-artifact / -session) wins on display
 *  and is shown read-only with its pre-approved badge — that's a separate relation
 *  surface (the consent boundary), so the base editor steps aside when one is set.
 *  The notify-on-failure toggle (also a routine field) lives here too. */
function DeliveryPanel({ task }: { task: ScheduledTask }) {
  const rel = useRelations()
  const artifactDelivery = rel.scheduleArtifactFor(task.id)
  const sessionDelivery = rel.scheduleSessionFor(task.id)
  const override = artifactDelivery?.name ?? sessionDelivery
  const preApproved = !!override
  const notifyOnFail = task.notifyOnFailure ?? true

  const [editing, setEditing] = useState(false)
  const [tool, setTool] = useState<StepTool>(task.delivery.tool)
  const [target, setTarget] = useState(task.delivery.target)
  const [picking, setPicking] = useState(false)
  const baseRevision = useRef(task.revision ?? 0)
  const { busy, error, clearError, commit } = useScheduleDraftCommit(
    updateSchedule,
    task.id,
    'delivery',
    () => setEditing(false),
  )

  const startEdit = () => {
    setTool(task.delivery.tool)
    setTarget(task.delivery.target)
    baseRevision.current = task.revision ?? 0
    clearError()
    setEditing(true)
  }
  const close = () => {
    if (busy) return
    clearError()
    setPicking(false)
    setEditing(false)
  }
  const save = async () => {
    const t = target.trim()
    if (!t || busy) return
    if (tool.id === task.delivery.tool.id && t === task.delivery.target) {
      close()
      return
    }
    await commit(
      { delivery: { tool, target: t, note: task.delivery.note } },
      baseRevision.current,
    )
  }

  const DeliveryIcon = artifactDelivery
    ? KIND_ICON[artifactDelivery.kind]
    : stepToolIcon(task.delivery.tool.id)
  const deliveryLabel = artifactDelivery
    ? KIND_LABEL[artifactDelivery.kind]
    : task.delivery.tool.label
  const displayTarget = override ?? task.delivery.target

  return (
    <FoldSection
      title="Delivers to"
      heldOpen={busy}
      defaultFolded
      summary={displayTarget}
      actions={
        !editing && !preApproved ? (
          <SectionAction label="Edit destination" icon={<Pencil size={13} />} onClick={startEdit} />
        ) : undefined
      }
    >
      {editing ? (
        <fieldset disabled={busy} className="contents">
          <div className="relative inline-block">
            <button
              onClick={() => setPicking((p) => !p)}
              aria-haspopup="dialog"
              aria-expanded={picking}
              className="inline-flex items-center gap-1 rounded-md bg-surface px-1.5 py-0.5 text-[11px] font-medium text-ink ring-1 ring-line-strong transition hover:ring-accent"
            >
              <ToolGlyph tool={tool} size={12} />
              {tool.label}
              <ChevronDown size={11} className="text-ink-faint" />
            </button>
            {picking && (
              <StepToolPicker
                onPick={(t) => {
                  setTool(t)
                  setPicking(false)
                }}
                onClose={() => setPicking(false)}
              />
            )}
          </div>
          <input
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') close()
              if (e.key === 'Enter') void save()
            }}
            placeholder="Where each run delivers…"
            aria-label="Delivery target"
            className="mt-1.5 w-full rounded-md border border-line bg-surface px-2 py-1.5 text-[13px] text-ink outline-none transition placeholder:text-ink-faint focus:border-co"
          />
          {error && <p role="status" className="mt-2 text-[12px] text-removed">{error}</p>}
          <div className="mt-2 flex items-center justify-end gap-2">
            <button onClick={close} disabled={busy} className="rounded-md px-2 py-1 text-[12px] font-medium text-ink-soft transition hover:text-ink disabled:cursor-not-allowed disabled:opacity-50">
              Cancel
            </button>
            <button
              onClick={() => void save()}
              disabled={busy || !target.trim()}
              className={`flex items-center gap-1 ${SOFT_BUTTON_CLASS} px-2.5 py-1 text-[12px] disabled:cursor-not-allowed disabled:opacity-50`}
            >
              {busy ? <Spinner size={13} /> : <Check size={13} />}
              {busy ? 'Saving delivery…' : 'Save'}
            </button>
          </div>
        </fieldset>
      ) : (
        <>
          <div className="flex items-center gap-2">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-panel-2">
              <DeliveryIcon size={15} className={toneChip(task.delivery.tool.tone).color} />
            </span>
            <div className="min-w-0">
              <div className="truncate text-[13px] font-medium text-ink">{displayTarget}</div>
              <div className="truncate text-[11px] text-ink-faint">{deliveryLabel}</div>
            </div>
          </div>
          {preApproved ? (
            <>
              <div className="mt-2 inline-flex items-center gap-1 rounded-md bg-ok-tint px-1.5 py-0.5 text-[11px] font-medium text-ok-text">
                <Check size={11} />
                Pre-approved · runs unprompted
              </div>
              <p className="mt-1.5 text-[11px] leading-relaxed text-ink-faint">
                A standing approval routes delivery here each run — it overrides the base destination.
              </p>
            </>
          ) : (
            task.delivery.note && <p className="mt-2 text-[12px] leading-relaxed text-ink-soft">{task.delivery.note}</p>
          )}
        </>
      )}
      <label className="mt-3 flex items-center justify-between gap-2 border-t border-line pt-3">
        <span className="flex items-center gap-1.5 text-[12px] text-ink-soft">
          <Bell size={13} />
          Notify me on failure
        </span>
        <Toggle
          on={notifyOnFail}
          onToggle={() => void updateSchedule(task.id, { notifyOnFailure: !notifyOnFail })}
          ariaLabel="Notify me on failure"
          disabled={busy}
        />
      </label>
    </FoldSection>
  )
}

/** The "Context & tools" panel — the connectors a routine's runs lean on (its
 *  steps + delivery + any standing-added extras), and an "Add tool" that approves
 *  a new one for every run. Adding is the `schedule-add-tool` STANDING relation op
 *  (a recurring effect, approved once) — the cross-entity surface, distinct from
 *  the routine's own fields. */
function ContextToolsPanel({ task }: { task: ScheduledTask }) {
  const rel = useRelations()
  const contextDoor = useContextDoor()
  const savedContexts = useSavedContexts().data?.contexts ?? []
  const [picking, setPicking] = useState(false)
  const [adding, setAdding] = useState(false)
  const seen = new Set<string>()
  const tools: StepTool[] = []
  // Steps + delivery, plus any tool-context a "let it use X each run" edit added
  // (standing-approved, so they belong in the run's toolbox).
  for (const t of [...task.steps.map((s) => s.tool), task.delivery.tool, ...rel.scheduleExtraToolsFor(task.id)]) {
    if (t.tone === 'claude' || t.tone === 'web' || seen.has(t.id)) continue
    seen.add(t.id)
    tools.push(t)
  }
  // Offer only connectors not already present (claude/web aren't context tools).
  const addable = STEP_TOOLS.filter((t) => t.tone !== 'claude' && t.tone !== 'web' && !seen.has(t.id))
  const addTool = (tool: StepTool) => {
    if (adding) return
    setAdding(true)
    void rel.applyOp({ kind: 'schedule-add-tool', scheduleId: task.id, scheduleName: task.name, cadence: task.cadence, tool }).then((outcome) => {
      setAdding(false)
      if (outcome === 'applied') setPicking(false)
    })
  }

  return (
    <FoldSection
      title="Context & tools"
      defaultFolded
      summary={tools.length === 0 ? 'No connectors' : tools.map((t) => t.label).join(' · ')}
      actions={
        <div className="relative">
          <SectionAction
            label="Add tool"
            icon={<Plus size={14} />}
            onClick={() => setPicking((p) => !p)}
            open={picking}
          />
          {picking && (
            <StepToolPicker align="right" tools={addable} onPick={addTool} onClose={() => setPicking(false)} />
          )}
        </div>
      }
    >
      {tools.length === 0 ? (
        <p className="text-[12px] text-ink-faint">No connectors yet.</p>
      ) : (
        <div className="space-y-2">
          {tools.map((t) => {
            // The connector's name is a door to its own Contexts page when it
            // resolves in the viewer's registry (S18); otherwise plain text.
            const door = contextDoor(t.id) ?? contextDoor(t.label)
            const compatible = savedContexts.filter((context) =>
              t.tone === 'mcp' ? context.kind === 'mcp' : context.kind === 'connector')
            const saved = compatible.find((context) =>
              context.id === t.id || context.label.toLocaleLowerCase() === t.label.toLocaleLowerCase())
            const status = saved?.status
            return (
              <div key={t.id} className="flex items-center gap-2">
                <ToolGlyph tool={t} size={15} />
                {door ? (
                  // Titles-are-doors styling (hover underline), keeping the row's
                  // own type scale rather than the inline-action one.
                  <button
                    onClick={door}
                    className={`min-w-0 flex-1 truncate text-left text-[13px] text-ink ${DOOR_CLASS}`}
                    title={`Open ${t.label} in Contexts`}
                  >
                    {t.label}
                  </button>
                ) : (
                  // Matches the door's weight: whether a tool resolves in your
                  // registry decides if the name is CLICKABLE, and must not also
                  // restyle it (the synopsis-row title pair is the precedent).
                  <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-ink">{t.label}</span>
                )}
                <StatusPill
                  tone={status === 'connected' ? 'ok' : status === 'needs-auth' ? 'warn' : 'bad'}
                  label={status === 'connected' ? 'Connected' : status === 'needs-auth' ? 'Needs auth' : 'Not connected'}
                />
              </div>
            )
          })}
        </div>
      )}
    </FoldSection>
  )
}

/** The Schedule side panel — cadence / next-run / timezone, now editable. The
 *  cadence chip, the WHEN sentence (task.trigger), and the next-run estimate are
 *  all DERIVED from one structured pick (lib/cadence), so editing the frequency
 *  keeps the three coherent. These are entity fields → a per-action updateSchedule. */
function SchedulePanel({ task }: { task: ScheduledTask }) {
  const [editing, setEditing] = useState(false)
  const { busy, error, clearError, commit } = useScheduleDraftCommit(
    updateSchedule, task.id, 'schedule', () => setEditing(false),
  )
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    let handle: ReturnType<typeof setTimeout>
    const tick = () => {
      setNow(Date.now())
      handle = setTimeout(tick, 60_000)
    }
    handle = setTimeout(tick, Math.max(1, 60_000 - (Date.now() % 60_000)))
    return () => clearTimeout(handle)
  }, [])
  const parsedCadence = parseCadence(task.cadence)
  const initialSpec: CadenceSpec = parsedCadence ?? { freq: 'daily', time: '09:00' }
  const nextLabel = !task.enabled
    ? 'Paused'
    : Number.isFinite(task.nextFireAt) && (task.nextFireAt as number) <= now
      ? 'Due now'
      : parsedCadence && Number.isFinite(task.nextFireAt)
        ? nextRunLabel(parsedCadence, new Date(now), task.timezone ?? 'UTC')
        : task.next
  return (
    <FoldSection
      title="Schedule"
      heldOpen={busy}
      defaultFolded
      summary={task.cadence}
      actions={
        <div className="relative">
          <SectionAction
            label="Edit schedule"
            icon={<Pencil size={13} />}
            onClick={() => { if (!editing) clearError(); setEditing((v) => !v) }}
            open={editing}
            disabled={busy}
            disabledReason={busy ? ROUTINE_MUTATION_WAIT : undefined}
          />
          {editing && <DeferredCadenceEditor
            task={task}
            busy={busy}
            error={error}
            commit={commit}
            initialSpec={initialSpec}
            timedFreqs={TIMED_FREQS}
            weekdayNames={WEEKDAY_NAMES}
            describe={describeCadence}
            nextLabel={nextRunLabel}
            busyIndicator={<Spinner size={13} />}
            doneIndicator={<Check size={13} />}
            onClose={busy ? () => {} : () => setEditing(false)}
          />}
        </div>
      }
    >
      <div className="space-y-2 text-[13px] text-ink">
        {[
          ['Cadence', task.cadence],
          ['Next run', nextLabel],
          ['Timezone', task.timezone ?? 'UTC'],
          ['After downtime', (task.missedFirePolicy ?? 'skip') === 'skip' ? 'Skip missed run' : 'Run once when back'],
        ].map(([label, value]) => (
          <div key={label} className="flex items-center justify-between gap-2">
            <span className="text-ink-soft">{label}</span>
            <span className="text-right font-medium">{value}</span>
          </div>
        ))}
      </div>
      {task.startedLabel && (
        <div className="mt-2.5 truncate border-t border-line pt-2.5 text-[11px] text-ink-faint">
          {task.startedLabel}
        </div>
      )}
    </FoldSection>
  )
}

/** One explicit unattended identity + cognition binding. The Agent and endpoint
 *  model remain orthogonal: changing one never silently rewrites the other. */
function ModelPanel({ task }: { task: ScheduledTask }) {
  const [editing, setEditing] = useState(false)
  const [draftHeld, setDraftHeld] = useState(false)
  const agents = useAgents().data ?? []
  const agent = agents.find((candidate) => candidate.id === task.agentId) ?? agents[0]
  return (
    <FoldSection
      title="Agent & model"
      heldOpen={draftHeld}
      defaultFolded
      summary={`${agent?.label ?? 'Unavailable Agent'} · ${task.model}`}
    >
      <div className="relative">
        <button
          onClick={() => setEditing((v) => !v)}
          disabled={draftHeld}
          title="Change Agent, model & effort"
          aria-haspopup="dialog"
          aria-expanded={editing}
          className="group inline-flex max-w-full items-center gap-1.5 rounded-lg bg-panel-2 px-3 py-1 text-[12px] font-medium text-ink ring-1 ring-transparent transition hover:ring-line-strong disabled:cursor-not-allowed disabled:opacity-50"
        >
          <ClaudeMark size={13} />
          <span className="truncate">{agent?.label ?? 'Unavailable Agent'} · {task.model}</span>
          <ChevronDown size={12} className="shrink-0 text-ink-faint transition group-hover:text-ink-soft" />
        </button>
        {editing && (
          <ScheduleModelPicker
            task={task}
            onHeldChange={setDraftHeld}
            onClose={() => setEditing(false)}
          />
        )}
      </div>
      <p className="mt-2 text-[11px] leading-relaxed text-ink-faint">
        Runs headless under this Agent’s tool, authority, and budget limits.
      </p>
    </FoldSection>
  )
}

/** The model + effort picker for a routine — endpoint providers only because a
 * Session provider has no unattended drain loop. Agent, provider, model, and
 * effort form one staged execution binding and land in one revisioned write. */
function ScheduleModelPicker({
  task,
  onHeldChange,
  onClose,
}: {
  task: ScheduledTask
  onHeldChange: (held: boolean) => void
  onClose: () => void
}) {
  const popRef = usePopoverShift<HTMLDivElement>(true)
  const providers = useProviders().data ?? []
  const agents = useAgents().data ?? []
  const agent = agents.find((candidate) => candidate.id === task.agentId) ?? agents[0]
  const legacy = parseModelChoice(task.model, providers)
  const init = task.providerId || task.modelId
    ? {
        pick: {
          ...(task.providerId && task.providerId !== DEFAULT_PROVIDER_ID ? { providerId: task.providerId } : {}),
          ...(task.modelId ? { modelId: task.modelId } : {}),
        },
        effort: task.effort,
      }
    : legacy
  const [agentId, setAgentId] = useState(agent?.id ?? task.agentId ?? '')
  const [pick, setPick] = useState<ModelPick>(init.pick)
  const [effort, setEffort] = useState<string | undefined>(init.effort)
  const baseRevision = useRef(task.revision ?? 0)
  useEffect(() => {
    if (!agentId && agent?.id) setAgentId(agent.id)
  }, [agent?.id, agentId])
  const { busy, error, commit } = useScheduleDraftCommit(
    updateSchedule,
    task.id,
    'Agent and model',
    onClose,
    onHeldChange,
  )
  const close = busy ? () => {} : onClose
  // Mounted only while open, so dismiss listeners live for its whole lifetime.
  const ref = useDismissable<HTMLDivElement>(true, close)

  const stageModel = (nextPick: ModelPick, nextEffort?: string) => {
    setPick(nextPick)
    setEffort(nextEffort)
  }
  const pickProvider = (providerId?: string) => {
    const nextPick: ModelPick = { ...(providerId ? { providerId } : {}) }
    const provider = pickedProvider(providers, nextPick)
    const model = pickedModel(provider, nextPick)
    stageModel(nextPick, resolveEffort(effortLevelsFor(provider, model), undefined))
  }
  const apply = async () => {
    if (!agentId || busy) return
    await commit(
      {
        agentId,
        providerId: pick.providerId ?? DEFAULT_PROVIDER_ID,
        modelId: pick.modelId ?? null,
        effort: effort ?? null,
      },
      baseRevision.current,
    )
  }

  return (
    <div
      ref={(el) => {
        ref.current = el
        popRef.current = el
      }}
      role="dialog"
      aria-label="Model and effort"
      aria-busy={busy}
      className={`absolute bottom-full right-0 z-30 mb-1.5 w-[300px] overflow-hidden ${POPOVER_SURFACE}`}
    >
      <fieldset disabled={busy} className="contents">
        <label className="block px-3 pt-2">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-ink-faint">Agent</span>
          <select
            aria-label="Routine agent"
            value={agentId}
            disabled={busy || agents.length === 0}
            onChange={(event) => setAgentId(event.currentTarget.value)}
            className={`${FORM_INPUT_CLASS} mt-1 w-full`}
          >
            {agents.length === 0 && <option value="">No Agent available</option>}
            {agents.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.label}</option>)}
          </select>
        </label>
        <ModelPickerMenu
          endpointOnly
          pick={pick}
          effort={effort}
          onPickModel={(next) => stageModel(next, effort)}
          onPickEffort={(nextEffort) => stageModel(pick, nextEffort)}
          onPickProvider={pickProvider}
        />
        {error && <p role="status" className="px-3 pb-2 text-[12px] text-removed">{error}</p>}
        <div className="flex justify-end gap-2 px-3 pb-2">
          <button
            onClick={close}
            disabled={busy}
            className="rounded-md px-2 py-1 text-[12px] font-medium text-ink-soft transition hover:text-ink disabled:cursor-not-allowed disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={() => void apply()}
            disabled={busy || !agentId}
            className={`flex items-center gap-1 ${SOFT_BUTTON_CLASS} px-2.5 py-1 text-[12px] disabled:cursor-not-allowed disabled:opacity-50`}
          >
            {busy ? <Spinner size={13} /> : <Check size={13} />}
            {busy ? 'Applying…' : 'Apply'}
          </button>
        </div>
      </fieldset>
    </div>
  )
}

function AutomationNotice({ kind }: { kind: 'standing' | 'work' }) {
  const capabilities = useCapabilities()
  const posture = automationPresentation(capabilities.status === 'error' ? undefined : capabilities.data?.features.simulatedAutomation)
  return <p role="note" data-automation-posture={posture.state} className={AUTOMATION_NOTICE_CLASS}>{posture[kind]}</p>
}

function DispatchNotice() {
  const capabilities = useCapabilities()
  const posture = dispatchPresentation(capabilities.status === 'error' ? undefined : capabilities.data?.features.dispatchExecution)
  return <p role="note" data-dispatch-posture={posture.state} className={AUTOMATION_NOTICE_CLASS}>{posture.note}</p>
}

function DispatchView({ onOpenSession }: { onOpenSession: (id: string) => void }) {
  const query = useDispatchRuns()
  const runs = query.data ?? []
  const projection = flatCollectionProjection({
    section: 'dispatch',
    fallbackLabel: 'Dispatch',
    empty: 'No dispatch runs yet.',
    items: collectionProjectionItems(runs, (run) => run.id, (run) => run.title),
  })
  return (
    <>
      <DispatchNotice />
      <p className="mb-3 text-[12px] text-ink-soft">Reply ready means a reply was saved, not that proposed actions were performed. Interrupted runs are never restarted automatically.</p>
      {query.status === 'error' && <InlineOperationStatus tone="alert" message="Couldn’t refresh Dispatch. Previously loaded runs may be out of date." action={{ label: 'Retry', onClick: () => retryResourceQueries([keys.dispatch]) }} />}
      {!query.data && query.status !== 'error' && <p role="status" className="text-[12px] text-ink-soft">Loading Dispatch…</p>}
      {query.data && (
      <MainCollectionTemplate
        projection={projection}
        renderItem={(item) => {
          const r = item.value
          return (
            <SynopsisRow
              prefix={r.execution ? <DispatchStatus status={r.status} /> : <History size={17} className="shrink-0 text-ink-faint" />}
              title={r.title}
              description={r.detail}
              meta={<span title={`${dispatchStatusLabel(r)} · ${relativeTime(r.startedAt)}`}>{dispatchStatusLabel(r)}</span>}
              onOpen={r.execution ? () => onOpenSession(r.execution!.sessionId) : undefined}
            />
          )
        }}
      />
      )}
    </>
  )
}

function CustomizeView() {
  return (
    <div>
      <AppearanceCard />
      <DefaultModelCard />
      <SystemPromptCard />
      <DesktopDataBoundary><Suspense fallback={<p role="status" className="text-[12px] text-ink-faint">Loading backup controls…</p>}>
        <DeferredDesktopDataCard />
      </Suspense></DesktopDataBoundary>
      <ToggleCard
        title="Weekly digest"
        desc="A Monday summary of everything you shipped."
        defaultOn
        storageKey="claude-ui.customize.weeklyDigest"
      />
      <ToggleCard
        title="Suggest scheduled tasks"
        desc="Spot repeat work and offer to automate it."
        storageKey="claude-ui.customize.suggestScheduled"
      />
    </div>
  )
}

/** Appearance is a preset plus orthogonal edits, never fourteen sealed skins.
 *  The preset selector replaces edits deliberately; each advanced dimension
 *  can then diverge and return to its preset value independently. lib/theme is
 *  still the only persistence + DOM funnel, so this editor is just a view over
 *  the recipe registry rather than a second theming system. */
function AppearanceCard() {
  const [pref, setPref] = useState<ThemePref>(loadThemePref)
  const [settings, setSettings] = useState<ThemeSettings>(loadThemeSettings)
  const [pickingTheme, setPickingTheme] = useState(false)
  const preset = PALETTES.find((option) => option.id === settings.preset)!
  const recipe = effectiveThemeRecipe(settings)
  const preview = deriveThemeTokens(recipe, 'light')
  const overrideCount = themeOverrideCount(settings)

  const commitMode = (next: ThemePref) => {
    setPref(next)
    saveThemePref(next)
  }
  const commitSettings = (next: ThemeSettings) => {
    setSettings(next)
    saveThemeSettings(next)
  }
  const commitPreset = (next: PaletteId) => {
    commitSettings(themeSettingsForPreset(next))
  }
  const commitAxis = (axis: ThemeAxisDefinition, value: ThemeRecipe[typeof axis.key]) => {
    commitSettings(setThemeAxis(settings, axis.key, value))
  }
  // Pref ids are lowercase; the chip label is just the capitalized id (and the
  // spelled-out record would trip INV-1's `dark:`-variant scan).
  const label = (opt: ThemePref) => opt[0].toUpperCase() + opt.slice(1)
  return (
    <FoldSection
      title="Appearance"
      summary={`${label(pref)} · ${preset.label}${overrideCount ? ` · ${overrideCount} tuned` : ''}`}
      persist={false}
    >
      <div className="space-y-4">
        <div className="grid gap-3 @xl:grid-cols-[minmax(0,1fr)_auto] @xl:items-center">
          <div>
            <p className="text-[12px] font-medium text-ink">Lighting</p>
            <p className="mt-0.5 text-[12px] text-ink-faint">Choose a mode or follow this device.</p>
          </div>
          <div role="radiogroup" aria-label="Theme" className="flex flex-wrap gap-1.5">
            {(['light', 'system', 'dark'] as const).map((opt) => {
              const active = opt === pref
              return (
                <button
                  key={opt}
                  role="radio"
                  aria-checked={active}
                  onClick={() => commitMode(opt)}
                  className={`rounded-lg px-3 py-1 text-[12px] font-medium transition ${
                    active ? 'bg-co-tint text-co-strong ring-1 ring-co/30' : 'bg-panel-2 text-ink-soft hover:text-ink'
                  }`}
                >
                  {label(opt)}
                </button>
              )
            })}
          </div>
        </div>

        <div className="grid gap-3 border-t border-line pt-4 @xl:grid-cols-[minmax(0,1fr)_minmax(180px,240px)] @xl:items-start">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <div aria-hidden className="flex -space-x-1">
                {[
                  preview['--color-canvas'],
                  preview['--color-ink'],
                  preview['--color-accent'],
                  preview['--color-co'],
                ].map((color, index) => (
                  <span
                    key={`${color}-${index}`}
                    className="h-4 w-4 rounded-full ring-1 ring-ink/15"
                    style={{ backgroundColor: color }}
                  />
                ))}
              </div>
              <p className="text-[12px] font-medium text-ink">{preset.label}</p>
            </div>
            <p className="mt-1 max-w-xl text-[12px] text-ink-faint">{preset.blurb}</p>
          </div>
          <div>
            {pickingTheme ? (
              <label className="block">
                <span className="sr-only">Theme preset</span>
                <select
                  autoFocus
                  aria-label="Theme preset"
                  value={settings.preset}
                  onBlur={() => setPickingTheme(false)}
                  onChange={(event) => {
                    commitPreset(event.currentTarget.value as PaletteId)
                    setPickingTheme(false)
                  }}
                  className={`${FORM_INPUT_CLASS} w-full`}
                >
                  <optgroup label="Classic">
                    {PALETTES.filter((option) => option.family === 'classic').map((option) => (
                      <option key={option.id} value={option.id}>{option.label}</option>
                    ))}
                  </optgroup>
                  <optgroup label="Vivid">
                    {PALETTES.filter((option) => option.family === 'vivid').map((option) => (
                      <option key={option.id} value={option.id}>{option.label}</option>
                    ))}
                  </optgroup>
                </select>
              </label>
            ) : (
              <button
                type="button"
                onClick={() => setPickingTheme(true)}
                className={`${SECONDARY_BUTTON_CLASS} flex w-full items-center justify-between gap-2 px-3 py-1.5 text-[12px]`}
                aria-label={`Change theme preset, current ${preset.label}`}
              >
                <span>{preset.label}</span>
                <ChevronDown size={13} className="text-ink-faint" />
              </button>
            )}
          </div>
        </div>

        <details className="group border-t border-line pt-3">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 rounded-md py-1 text-[12px] font-medium text-ink-soft hover:text-ink [&::-webkit-details-marker]:hidden">
            <span className="flex items-center gap-1.5">
              <ChevronRight size={13} className="transition group-open:rotate-90" />
              Tune palette
            </span>
            <span className="font-normal text-ink-faint">
              {overrideCount ? `${overrideCount} override${overrideCount === 1 ? '' : 's'}` : 'Using preset values'}
            </span>
          </summary>
          <div className="mt-3 grid gap-x-7 gap-y-5 @2xl:grid-cols-2">
            {THEME_AXIS_GROUPS.map((group) => (
              <fieldset key={group.id} className="min-w-0">
                <legend className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-ink-faint">{group.label}</legend>
                <div className="space-y-3">
                  {group.axes.map((axis) => (
                    <ThemeAxisControl
                      key={axis.key}
                      axis={axis}
                      value={recipe[axis.key]}
                      overridden={Object.hasOwn(settings.overrides, axis.key)}
                      onChange={(value) => commitAxis(axis, value)}
                      onReset={() => commitSettings(resetThemeAxis(settings, axis.key))}
                    />
                  ))}
                </div>
              </fieldset>
            ))}
          </div>
          {overrideCount > 0 && (
            <div className="mt-4 border-t border-line pt-3 text-right">
              <button onClick={() => commitSettings(themeSettingsForPreset(settings.preset))} className={INLINE_ACTION_CLASS}>
                Reset all tuning
              </button>
            </div>
          )}
        </details>
      </div>
    </FoldSection>
  )
}

function ThemeAxisControl({
  axis,
  value,
  overridden,
  onChange,
  onReset,
}: {
  axis: ThemeAxisDefinition
  value: ThemeRecipe[typeof axis.key]
  overridden: boolean
  onChange: (value: ThemeRecipe[typeof axis.key]) => void
  onReset: () => void
}) {
  const id = `theme-axis-${axis.key}`
  return (
    <div>
      <div className="mb-1 flex min-h-5 items-center justify-between gap-2">
        <label htmlFor={id} className="text-[12px] text-ink-soft">{axis.label}</label>
        <span className="flex items-center gap-2">
          <output htmlFor={id} className="tabular-nums text-[11px] text-ink-faint">
            {formatThemeAxisValue(axis, value)}
          </output>
          {overridden && (
            <button type="button" onClick={onReset} className={INLINE_ACTION_CLASS} aria-label={`Reset ${axis.label}`}>
              Reset
            </button>
          )}
        </span>
      </div>
      {axis.kind === 'range' ? (
        <input
          id={id}
          type="range"
          min={axis.min}
          max={axis.max}
          step={axis.step}
          value={value as number}
          onChange={(event) => onChange(Number(event.currentTarget.value))}
          className="block h-5 w-full cursor-pointer accent-accent"
        />
      ) : (
        <select
          id={id}
          value={value as string}
          onChange={(event) => onChange(event.currentTarget.value as ThemeRecipe[typeof axis.key])}
          className={`${FORM_INPUT_CLASS} w-full`}
        >
          {axis.options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
      )}
    </div>
  )
}

/** Customize and the composer share one personal, server-durable default.
 *  Saved references are intent, not execution authority: the existing live
 *  registry and send-time policy still resolve or refuse stale selections. */
function DefaultModelCard() {
  const { preferences: prefs, held } = useModelPreferences()
  const [open, setOpen] = useState(false)
  const ref = useDismissable<HTMLDivElement>(open, () => setOpen(false))
  const popRef = usePopoverShift<HTMLDivElement>(open)
  const providers = useProviders().data ?? []
  // Resolve display from the live registry without rewriting stored references
  // merely because a catalog is loading or a provider is temporarily absent.
  const pick: ModelPick = { providerId: prefs.providerId, modelId: prefs.modelId }

  return (
    <Card title="Default model" desc="Your starting model for new sessions in this workspace. Saved across app restarts.">
      <div ref={ref} className="relative">
        <button
          onClick={() => setOpen((o) => !o)}
          aria-haspopup="dialog"
          aria-expanded={open}
          className="group inline-flex items-center gap-1.5 rounded-lg bg-panel-2 px-3 py-1 text-[12px] font-medium text-ink ring-1 ring-transparent transition hover:ring-line-strong"
        >
          <ClaudeMark size={13} />
          <span>{displayModelLabel(providers, pick, prefs.providerId ? undefined : prefs.effort)}</span>
          <ChevronDown size={12} className="text-ink-faint transition group-hover:text-ink-soft" />
        </button>
        {open && (
          <div
            ref={popRef}
            role="dialog"
            aria-label="Default model and effort"
            className={`absolute right-0 top-full z-30 mt-1.5 w-[300px] overflow-hidden ${POPOVER_SURFACE}`}
          >
            <ModelPickerMenu
              pick={pick}
              effort={prefs.effort}
              disabled={held}
              onPickModel={(next) =>
                void updateModelPreferences({
                  providerId: next.providerId,
                  modelId: next.modelId,
                  ...(isOpusModel(next.modelId) ? {} : { fast: false }),
                })
              }
              onPickEffort={(effort) => { void updateModelPreferences({ effort }) }}
              onPickProvider={(providerId) => { void updateModelPreferences({ providerId, modelId: undefined }) }}
            />
          </div>
        )}
      </div>
    </Card>
  )
}

const SYSTEM_PROMPT_PREF_KEY = 'claude-ui.customize.systemPromptId'

/** The "Agent system prompt" setting (docs/agent-commons.md, D10) — pick a reusable,
 *  target-family-tagged prompt from the library for new Agents. The picker is where
 *  D10's compatibility check lives: when the chosen prompt's authored-for family
 *  differs from the account's provider model family, it shows a non-blocking downgrade
 *  warning at selection time (`promptFitWarning`) rather than silently applying a
 *  Claude-tuned prompt to an open model. Persists the choice like the default model. */
function SystemPromptCard() {
  const prompts = useSystemPrompts().data ?? []
  const providers = useProviders().data ?? []
  // The account's cognition source the prompt would run against — the default-else-
  // first provider, the same entry the New-agent picker pre-selects.
  const provider = defaultEntry(providers)
  const providerFamily = provider?.modelFamily ?? 'claude'

  const [selectedId, setSelectedId] = useState<string>(() => {
    try {
      return localStorage.getItem(SYSTEM_PROMPT_PREF_KEY) ?? 'sp-default'
    } catch {
      return 'sp-default'
    }
  })
  const [open, setOpen] = useState(false)
  const ref = useDismissable<HTMLDivElement>(open, () => setOpen(false))
  const popRef = usePopoverShift<HTMLDivElement>(open)

  const pick = (id: string) => {
    setSelectedId(id)
    try {
      localStorage.setItem(SYSTEM_PROMPT_PREF_KEY, id)
    } catch {
      /* ignore quota / privacy-mode errors */
    }
    setOpen(false)
  }

  const selected = prompts.find((p) => p.id === selectedId)
  const selectedWarning = selected ? promptFitWarning(selected, providerFamily) : null

  return (
    <Card title="Agent system prompt" desc="The library prompt new Agents start from.">
      <div ref={ref} className="relative">
        <button
          onClick={() => setOpen((o) => !o)}
          aria-haspopup="dialog"
          aria-expanded={open}
          title={selectedWarning ?? undefined}
          className="group inline-flex items-center gap-1.5 rounded-lg bg-panel-2 px-3 py-1 text-[12px] font-medium text-ink ring-1 ring-transparent transition hover:ring-line-strong"
        >
          {selectedWarning && <AlertCircle size={13} className="text-warn-strong" />}
          <span>{selected?.label ?? 'Choose a prompt'}</span>
          <ChevronDown size={12} className="text-ink-faint transition group-hover:text-ink-soft" />
        </button>
        {open && (
          <div
            ref={popRef}
            role="dialog"
            aria-label="Agent system prompt"
            className={`absolute right-0 top-full z-30 mt-1.5 w-[320px] p-2 ${POPOVER_SURFACE}`}
          >
            <div className="px-1.5 pb-1 pt-0.5 text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
              System prompt · checked against {provider?.label ?? 'provider'}
            </div>
            {prompts.map((p) => {
              const on = p.id === selectedId
              const warning = promptFitWarning(p, providerFamily)
              return (
                <button
                  key={p.id}
                  onClick={() => pick(p.id)}
                  className={`flex w-full items-start gap-2.5 rounded-lg px-1.5 py-1.5 text-left transition ${
                    on ? 'bg-panel-2' : 'hover:bg-panel-2/60'
                  }`}
                >
                  <span
                    className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${
                      on ? 'border-co-solid bg-co-solid text-on-solid' : 'border-line-strong'
                    }`}
                  >
                    {on && <Check size={11} strokeWidth={3} />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center justify-between gap-2">
                      <span className="block text-[13px] font-medium text-ink">{p.label}</span>
                      <span className="shrink-0 rounded bg-panel-2 px-1.5 py-0.5 text-[10px] text-ink-faint">
                        {p.targetFamily}
                      </span>
                    </span>
                    {warning && (
                      <span className="mt-1 flex items-start gap-1 text-[11px] leading-snug text-warn-text">
                        <AlertCircle size={12} className="mt-0.5 shrink-0" />
                        {warning}
                      </span>
                    )}
                  </span>
                </button>
              )
            })}
          </div>
        )}
      </div>
    </Card>
  )
}

/* ───────────────────────── shared bits ───────────────────────── */

function SearchBox({
  value,
  onChange,
  placeholder,
  mirrorsRailFor,
}: {
  value: string
  onChange: (v: string) => void
  placeholder: string
  mirrorsRailFor?: SectionId
}) {
  const input = useRef<HTMLInputElement>(null)
  useCompositeCommand(mirrorsRailFor, 'focus-search', () => input.current?.focus())
  return (
    <div className="mb-5 flex items-center gap-2.5 rounded-md border border-line bg-surface px-3.5 py-2.5 transition focus-within:border-co">
      <Search size={17} className="shrink-0 text-ink-faint" />
      <input
        ref={input}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="flex-1 bg-transparent text-[13px] text-ink outline-none placeholder:text-ink-faint"
      />
    </div>
  )
}

function PanelLabel({ children, flush }: { children: ReactNode; flush?: boolean }) {
  return (
    <div className={`${flush ? '' : 'mb-2 '}text-[11px] font-semibold uppercase tracking-wide text-ink-faint`}>
      {children}
    </div>
  )
}

/** A section with nothing in it — one quiet line, not a frame.
 *
 *  It was a dashed 12px-radius box with 48px of vertical padding, which made an
 *  EMPTY section the loudest thing on a page: a bigger, more decorated shape
 *  than the full sections around it, drawn to say that nothing is there. That
 *  inverts the whole point of the pass that removed the list boxes — and it was
 *  the more expensive of the two, at 39 call sites against 17.
 *
 *  Left-aligned rather than centred, because centring only reads as deliberate
 *  inside a box: with the frame gone, a centred line floats in the column with
 *  nothing explaining its position. Aligned to the column edge it sits exactly
 *  where the section's first row would have been, which is what it stands in
 *  for. */
function Empty({ children }: { children: ReactNode }) {
  return (
    <div className="py-1.5 text-[13px] text-ink-faint">
      {children}
    </div>
  )
}

/** A PAGE with nothing on it — a different role, and it kept its presence.
 *
 *  Found by asking where `<Empty>` actually renders: ten of its call sites are
 *  not a section's empty row but the page's whole content — "this work item no
 *  longer exists", "this console is for instance maintainers", the Commons feed
 *  with no posts. Collapsing those to a left-aligned line put a stray sentence
 *  under a heading on an otherwise blank screen, which reads as a rendering bug
 *  rather than as an answer.
 *
 *  So the two forms split, because they are two roles (form follows function):
 *  a section's empty state stands in for a ROW and belongs where that row would
 *  be; a page's empty state stands in for the PAGE and has to occupy it. Both
 *  lost the dashed frame — that was the noise, and neither role needs it. What
 *  a page keeps is the space and the centring, which only ever read as
 *  deliberate because something was holding them. */
function DispatchStatus({ status }: { status: DispatchRun['status'] }) {
  if (status === 'running')
    return <Spinner size={17} className="mt-0.5 shrink-0 text-accent" />
  if (status === 'failed') return <AlertCircle size={17} className="mt-0.5 shrink-0 text-danger" />
  return <CheckCircle2 size={17} className="mt-0.5 shrink-0 text-ok" />
}

function Toggle({
  on,
  onToggle,
  ariaLabel,
  disabled = false,
}: {
  on: boolean
  onToggle: () => void
  ariaLabel?: string
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      // A switch, announced as one: role + checked state so a screen reader says
      // "‹name›, switch, on/off" instead of an unnamed, stateless button (WCAG 4.1.2).
      role="switch"
      aria-checked={on}
      aria-label={ariaLabel}
      onClick={onToggle}
      disabled={disabled}
      className={`relative h-5 w-9 shrink-0 rounded-full transition disabled:cursor-not-allowed disabled:opacity-50 ${on ? 'bg-accent' : 'bg-line-strong'}`}
      title={disabled ? ROUTINE_MUTATION_WAIT : on ? 'Enabled' : 'Disabled'}
    >
      <span
        className={`absolute top-0.5 h-4 w-4 rounded-full bg-surface ring-1 ring-line-strong transition-all ${
          on ? 'left-[18px]' : 'left-0.5'
        }`}
      />
    </button>
  )
}

function Card({ title, desc, children }: { title: string; desc: string; children: ReactNode }) {
  return (
    <FoldSection title={title} summary={desc} persist={false}>
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        {/* The label keeps a readable basis; a control that can't fit beside it
            wraps below instead of squeezing the text one word per line. */}
        <p className="min-w-0 flex-1 basis-56 text-[12px] text-ink-faint">{desc}</p>
        <div className="shrink-0">{children}</div>
      </div>
    </FoldSection>
  )
}

/** A labeled card with a Toggle. When `storageKey` is given the setting persists to
 *  localStorage (a sticky client preference, like the model default) instead of
 *  resetting each visit. */
function ToggleCard({
  title,
  desc,
  defaultOn = false,
  storageKey,
}: {
  title: string
  desc: string
  defaultOn?: boolean
  storageKey?: string
}) {
  const [on, setOn] = useState(() => {
    if (!storageKey) return defaultOn
    try {
      const v = localStorage.getItem(storageKey)
      return v == null ? defaultOn : v === '1'
    } catch {
      return defaultOn
    }
  })
  const toggle = () =>
    setOn((v) => {
      const next = !v
      if (storageKey) {
        try {
          localStorage.setItem(storageKey, next ? '1' : '0')
        } catch {
          /* ignore quota / privacy-mode errors */
        }
      }
      return next
    })
  return (
    <Card title={title} desc={desc}>
      <Toggle on={on} onToggle={toggle} ariaLabel={title} />
    </Card>
  )
}
