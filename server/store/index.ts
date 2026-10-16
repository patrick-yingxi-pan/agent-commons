/** ── The mock backend's state + event bus ──────────────────────────────────
 *  In-memory working state, seeded from server/data, plus a tiny pub/sub the SSE
 *  channels subscribe to. In the real product this is a database + the Anthropic
 *  API; here it's plain objects the routes read and mutate.
 *
 *  When the real server runs, the UI-owned state is also durable: it's snapshotted
 *  to the filesystem on every mutation and rehydrated on boot (server/persistence/persist.ts),
 *  so a sent message / attached context / created session survives a restart. The
 *  selected world is the *baseline*, written on genuine first boot; development
 *  selects the showcase while release profiles select clean. A later boot loads
 *  the snapshot's stored choice. Tests leave persistence off and run purely in-memory. (Transient
 *  state — reservations, the live runner registry — is deliberately not persisted.)
 *
 *  State is added to this store as each resource's reads/commands migrate; Phase 1
 *  carries sessions + the event bus, the spine everything else hangs off. */
import { ImageAssetRegistry, rehydrateImageAssets } from '../imageAssets.ts'
import { contributionRuntimeMode, contributionReviewVersion } from '../contributionRuntime.ts'
import { automationRuntimeMode, requireAutomationFixture } from '../automationRuntime.ts'
import { dispatchPrompt, parseRealDispatchInput, type RealDispatchInput, type DispatchBinding } from '../../contract/dispatchExecution.ts'
import { parseProjectWorkDraftInput, type ProjectWorkDraftInput, type ProjectWorkDraftSource } from '../../contract/projectWorkDraft.ts'
import { projectWorkDraftPrompt } from '../projectWorkDraft.ts'
import { prepareProjectWorkMcpDraft } from '../projectWorkMcpDraft.ts'
import type { ProjectWorkMcpDraftPreview } from '../../contract/projectWorkMcpDraft.ts'
import { computeProjectWorkResolution } from '../projectWorkResolution.ts'
import { isLinkableProjectWorkItem } from '../projectWorkPersistence.ts'
import { dispatchSessionId } from '../dispatchIdentity.ts'
import { normalizedEnvelopeProposalLines, envelopeProposalLinesMatch, prepareContributionMcpLines, currentContributionMcpLine, type StoredContributionEnvelopeLine } from '../contributionEnvelope.ts'
import { createContributionEffectAttempt, settleContributionEffectAttempt, interruptContributionEffectAttempt, publicContributionEffectRun, contributionEffectConsumesSlot, CONTRIBUTION_EFFECT_ATTEMPT_MAX } from '../contributionEffectState.ts'
import { contributionMcpProposalOwner } from '../contributionMcpAuthority.ts'
import { executeBoundMcpCall, type McpBoundExecutionOutcome } from '../mcpBoundExecution.ts'
import { RoutineMcpRegistry, validateRoutineMcpRegistryJoins } from '../routineMcpRegistry.ts'
import { CommissionMcpRegistry, commissionMcpClaimActive, emptyCommissionMcpRegistry } from '../commissionMcpRegistry.ts'
import { commissionMcpClaimId } from '../commissionMcpClaim.ts'
import { CommissionMcpExecution } from '../commissionMcpExecution.ts'
import { commissionMcpLegacyDispatchBlocked, type CommissionMcpQueueCandidate } from '../commissionMcpRunner.ts'
import { validateCommissionMcpRegistryJoins } from '../commissionMcpAuthority.ts'
import { CommissionMcpHost, type CommissionMcpLiveSource, type CommissionMcpModelSelection } from '../commissionMcpHost.ts'
import { commissionMcpReviewFacts } from '../commissionMcpReview.ts'
import { commissionMcpToolPermitted } from '../commissionMcpPolicy.ts'
import type { CommissionMcpReview, CommissionMcpDecisionRequest, CommissionMcpDecisionResponse } from '../../contract/commissionMcpApi.ts'
import { RoutineMcpPolicyError, routineMcpCallPermitted, routineMcpJsonText, routineMcpPermissionOwner } from '../routineMcpPolicy.ts'
import { reserveRoutineMcpCall, settleRoutineMcpCall, interruptRoutineMcpRun, publicRoutineMcpReceipt, routineMcpReceiptNeedsReview } from '../routineMcpState.ts'
import { mcpRuntimeCapabilities } from '../mcpRuntime.ts'
import { mcpToolSchemaHash } from '../mcpToolAdmission.ts'
import { parseMcpActivityAuthorities, validateMcpActivityAuthorities, type McpActivityAuthority } from '../mcpActivityAuthority.ts'
import { AgentOwnershipRegistry, type AgentOwnership } from '../agentOwnership.ts'
import { ProxyRequestRegistry } from '../proxyRequestRegistry.ts'
import { ProxyRequestHost } from '../proxyRequestHost.ts'
import { ProxyRequestExecution } from '../proxyRequestExecution.ts'
import { ProxyArgumentExecution, type ProxyArgumentSource } from '../proxyArgumentExecution.ts'
import type { StoredProxyRequest } from '../proxyRequestState.ts'
import { prepareAgentRequestArguments } from '../proxyArgumentPreparation.ts'
import type { AgentRequestArgumentDraftBinding, AgentRequestDraftModel } from '../../contract/agentRequests.ts'
import type { AgentRequestReview } from '../../contract/agentRequests.ts'
import type { ProxyActor } from '../proxyRequestState.ts'
import { agentPerson } from '../agentPerson.ts'
import { parseMcpInputFlows, validateMcpInputFlows, mcpInputFlowKey, mcpInputBindingHash, mcpInputCommandHash, hasMcpInputFlowCapacity, MCP_INPUT_MAX_ROUNDS, MCP_INPUT_MAX_FLOWS, MCP_INPUT_TTL_MS, type McpInputFlow } from '../mcpInputState.ts'
import { parseMcpFormInputRequired, parseMcpFormResponses, type McpFormInputRequired } from '../mcpElicitation.ts'
import { parseMcpInputCommand } from '../mcpInputCommand.ts'
import type { McpInputReceipt, McpInputReviewState } from '../../contract/mcpInput.ts'
import type { McpBoundFormContinuation } from '../mcpBoundExecution.ts'
import type { RoutineMcpReview, RoutineMcpDecisionRequest, RoutineMcpDecisionResponse } from '../../contract/routineMcpApi.ts'
import type { RoutineMcpCallReceipt } from '../../contract/routineMcp.ts'
import type { McpBoundToolCall } from '../../contract/mcpExecution.ts'
import type { RoutineMcpRuntime } from '../model/connectorTools.ts'
import { publicReviewRun, reviewChangesetHash, sameReviewerBinding, validReviewerBinding, type StoredContributionReview } from '../contributionReviewState.ts'
import { MAX_CONTRIBUTION_REVIEWS, type ContributionReviewerBinding } from '../../contract/contributionReview.ts'
import { ContributionReviewGenerationError } from '../contributionReviewResult.ts'
import { MAX_DELEGATED_JUDGMENTS, type DelegatedJudgmentRequest } from '../../contract/delegatedJudgment.ts'
import { judgmentContextHash, publicJudgmentRun, sameJudgmentRequest, validJudgmentRequest, type StoredDelegatedJudgment } from '../delegatedJudgmentState.ts'
import { DelegatedJudgmentGenerationError, type DelegatedJudgmentInput } from '../delegatedJudgmentResult.ts'
import { delegationPolicyPatch, delegationVersions, sameDelegationPolicy, validDelegationExpiry } from '../delegationPolicy.ts'
import { MAX_DELEGATION_POLICY_CHARS, MAX_DELEGATION_VERSIONS, type PatchDelegationRequest } from '../../contract/delegations.ts'
import { UsageRecordingError } from '../modelUsage.ts'
import { parseArtifactMetadataEntries } from '../artifactMetadata.ts'
import { parseArtifactLifecycleEntries } from '../artifactLifecycle.ts'
import { nextArtifactLifecycle, type ArtifactLifecycle, type TrashedArtifact } from '../../contract/artifactLifecycle.ts'
import { parseScheduleStanding, pruneOrphanScheduleStanding, scheduleApprovalKeyMatches, scheduleStandingFailure } from '../scheduleStanding.ts'
import { parseScheduledArtifactSpec, type ScheduledArtifactSpec } from '../../contract/scheduledArtifact.ts'
import { sheetXlsx } from '../artifactXlsx.ts'
import { documentDocx, hasWordText } from '../artifactDocx.ts'
import { slidesPptx } from '../artifactPptx.ts'
import { hasPowerPointText } from '../artifactPptxLayout.ts'
import { authoredArtifact, type AuthoredArtifact } from '../../contract/artifactAuthoring.ts'
import { parseEditableArtifactBody } from '../../contract/artifactEditing.ts'
import { isSpreadsheetContent } from '../../contract/workbook.ts'
import { artifactBodyExcerpt } from '../../contract/artifactExcerpt.ts'
import { normalizeArtifactName, projectArtifactMetadata, type ArtifactMetadata } from '../../contract/artifactMetadata.ts'
import { isArtifactCreationId, type CreateArtifactRequest, type CreateArtifactResponse } from '../../contract/artifactCreation.ts'
import { imageAssetRef, imageAssetRefMatches, type ImageAssetRef } from '../../contract/imageAssets.ts'
import type { ImageSnapshot } from '../../contract/imageInput.ts'
import { parseImageAssetUpload, type ImageOriginalDownload } from '../../contract/imageOriginal.ts'
import type {
  A2aPeer,
  AnchorLocus,
  Artifact,
  ArtifactContent,
  ArtifactContentLibrary,
  ArtifactItem,
  ArtifactKind,
  Capabilities,
  Connector,
  ConnectorDetail,
  ContextStatus,
  ContextTypeId,
  CreateProjectRequest,
  CreateProjectResponse,
  CreateGrantRequest,
  DiffLine,
  Discussion,
  DispatchRun,
  CommonsLikeState,
  NotificationReadState,
  CommonsItem,
  Grant,
  OpenDiscussionRequest,
  OpenProposalRequest,
  SocialProposal,
  Message,
  Project,
  RecentsSnapshot,
  RedeemGrantResponse,
  RelationGraph,
  RelationOp,
  ResolveMessageRelationResponse,
  RunSessionEntry,
  SavedContext,
  SavedContextsSnapshot,
  SchedulePatch,
  ScheduledRun,
  ScheduledTask,
  ScheduleTemplate,
  ServerEvent,
  Session,
  SessionContext,
  SessionContextOperation,
  SessionContextState,
  SessionMetadataPatch,
  SessionPreferences,
  SessionWorkspace,
  ShareTier,
  SocialEntityRef,
  SocialEntityKind,
  ToolActivity,
  ToolActivityDecisionEligibility,
  McpToolResult,
  ModelPreferences,
  UsageSnapshot,
  ViewerModelPreferences,
} from '../../contract/index.ts'
import { createHash, randomUUID } from 'node:crypto'
import {
  type ArtifactHistoryPage,
  type ArtifactHistoryVersion,
  type ArtifactHistoryVersionMetadata,
  type ArtifactHistoryVersionResult,
  historyBodyWithoutRevision,
} from '../../contract/artifactHistory.ts'
import { prepareArtifactHistoryAppend, type StoredArtifactHistoryRestoreReceipt } from '../artifactHistory.ts'
import { searchArtifactVersions } from '../artifactVersionSearch.ts'
import { findArtifactBodySearchMatch } from '../artifactBodySearch.ts'
import { identifyDocumentBody } from '../documentIdentity.ts'
import { literalSearchSnippet } from '../../contract/literalSearch.ts'
import { MAX_ARTIFACT_VERSION_SEARCH_QUERY_CHARS, MAX_SEARCH_QUERY_CHARS } from '../../contract/search.ts'
import { firstConversationMessageMatch } from '../../contract/conversationSearch.ts'
import type { ArtifactDeletionPreview, ArtifactDeletionRequest, ArtifactDeletionResult } from '../../contract/artifactDeletion.ts'
import { parseArtifactRetirements, type ArtifactRetirement, type StoredArtifactDeletionReceipt } from '../artifactDeletion.ts'
import { isServedTextSnapshot, type ServedTextSnapshot, type RefreshServedAttachmentRequest } from '../../contract/servedTextSnapshot.ts'
import { isServedImageSnapshot, type ServedImageSnapshot } from '../../contract/servedImageSnapshot.ts'
import { isServedFolderSnapshot, type ServedFolderSnapshot, type ServedFolderScope } from '../../contract/servedFolderSnapshot.ts'
import { isLocalFolderRefreshRequest, type LocalFolderCapture, type LocalFolderRefreshRequest } from '../../contract/localFolderCapture.ts'
import { isLocalGitRefreshRequest, type LocalGitCapture, type LocalGitRefreshRequest } from '../../contract/localGitCapture.ts'
import { validWorkspaceFolders, workspaceFolders, replaceLocalFolderSnapshot, replaceLocalGitSnapshot, replaceServedFolderSnapshot } from '../../contract/workspaceFolders.ts'
import {
  applyGraphOp,
  artifactFromDraft,
  artifactMatchesSave,
  documentMarkdown,
  connectorsFor,
  describeCadence,
  discussionTitle,
  emptyGraph,
  opKey,
  projectContextSelectorIsAmbiguous,
  isProjectContextSource,
  recentEntries,
  runPrompt,
  runRecap,
  runSessionId,
  nextCadenceFireAt,
  nextRunLabel,
  parseCadence,
  seedGraph,
  FOLLOW_ROSTER_CAP,
  canonicalGrantNote,
  PROPOSABLE_SCHEDULE_FIELDS,
  SHARE_TIERS,
  tierPermits,
  tierRank,
  validTimeZone,
} from '../../contract/index.ts'
import { SESSIONS } from '../data/sessions.ts'
import { DISPATCH_RUNS, SCHEDULE_TEMPLATES, PROJECTS, ALL_ARTIFACTS, SCHEDULED_TASKS } from '../data/cowork.ts'
import {
  DEFAULT_RECENT_IDS,
  GITHUB_REPO_OPTIONS,
  LOCAL_REPO_OPTIONS,
} from '../data/contextOptions.ts'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'
import { fsReader, type FsReader } from '../fs.ts'
import { attachmentImageRef, attachmentSnapshotId, isAttachmentInput } from '../../contract/attachmentInput.ts'
import { buildDiscussionSnapshot, discussionIdFromContextId } from '../../contract/discussionSnapshot.ts'
import { artifactIdFromContextId, buildArtifactSnapshot } from '../../contract/artifactSnapshot.ts'
import type { FsCatalog, FsFileContent, FsFolderContents, FsSource, Identity } from '../../contract/index.ts'
import { fsRecentKey, parseFsRecentKey, docBlockText, MAX_ARTIFACT_BLOCK_CHARS, withDocBlockText } from '../../contract/index.ts'
import { resolveIdentity, ANONYMOUS_IDENTITY, LOCAL_IDENTITY } from '../identity.ts'
import { nonNegativeIntEnv } from '../env.ts'
import { SAVED_CONTEXTS, CONNECTED_CONNECTOR_IDS, CONNECTED_MCP_IDS } from '../data/savedContexts.ts'
import { connectorDetail } from '../data/connectorDetails.ts'
import { ARTIFACT_CONTENT } from '../data/artifactContent.ts'
import { estimateTokens, mintBudget } from '../usage.ts'
import { UsageRegistry } from '../usageRegistry.ts'
import { mintAuthority } from '../authority.ts'
import { CapabilityUnavailableError, ConflictError, NotFoundError, ValidationError } from '../conflict.ts'
import { LimitError } from '../limit.ts'
import { scopeMatches } from '../runner-runtime.ts'
import { isEndpointProtocol, MAX_DISCUSSION_POSTS, MENTION_MAX_NAME_LEN } from '../../contract/index.ts'
import { contextBreakdown, intersectAuthority, authorityAdmits, projectAdmittedAuthority, unrestricted, isProjectEffectMonotonic, rolePermits, roleRank, PROJECT_ROLES, OPEN_WORK_FIELD_MAX, WORK_ITEM_COMMENT_MAX, CONTRIBUTION_FIELD_MAX as MAX_CONTRIBUTION_FIELD_CHARS, CHANGE_ENTRY_KINDS, DELEGATED_ACT_KINDS, ESCALATION_TRIGGERS, clampAuthority, clampBudget, probeScore, SEARCH_GROUP_CAP, SEARCH_PAGE_SIZE, NOTIFICATION_CAP } from '../../contract/index.ts'
import type { Agent, AgentChangeProposal, AgentConfigurationPatch, AgentDirectoryEntry, AgentPublicFork, AgentResolvedItem, AppNotification, AuditEntry, ProposalCheck, Authority, Budget, CapabilityType, Commission, CommissionConfigurationPatch, CreateAgentRequest, ModelInfo, ModelProvider, ProviderDefinitionPatch, MyWork, MyWorkItem, MyWorkProposal, OpenSubGoal, Contribution, OpenContributionRequest, Delegation, CreateDelegationRequest, OwnerActivity, FollowRow, OwnerFollowFace, OwnerProfile, PostOpenSubGoalRequest, PrincipalRef, ProjectAction, ProjectDirectoryEntry, ProjectEffectResult, ProjectEffectType, ProjectRole, ProjectSubGoal, PromptProbeResult, ProposeAgentChangeRequest, ProxyRequest, ProxyResult, Reservation, SearchGroup, SearchHit, SearchPage, SearchResponse, SystemPromptDefinitionFields, SystemPromptDefinitionPatch, SystemPromptEntry, WatchState, WorkItemComment } from '../../contract/index.ts'
import { DEFAULT_PROVIDER, DEFAULT_PROVIDER_CONFIG, SEED_PROVIDERS, SEED_PROVIDER_CONFIGS, ProviderProbeError, validApiKeyEnv, type ProviderConfig } from '../data/providers.ts'
import { endpointExecution } from '../model/endpointExecution.ts'
import { SYSTEM_PROMPTS, SP_DEFAULT_ID, DEFAULT_SYSTEM_PROMPT_BODY } from '../data/prompts.ts'
import { SEED_COMMISSIONS } from '../data/commissions.ts'
import { baseToolDefinitions } from '../model/tools.ts'
import { systemPrompt, resolvedModelId, generateContributionReview, generateDelegatedJudgment, generateCommissionMcpArguments, generateAgentRequestArguments } from '../generate.ts'
import { RunnerRegistry } from '../registry.ts'
import { RunnerJournal } from '../journal.ts'
import { RelayRuntime, hashRelaySecret, mintRelaySecret, relaySecretHint, sameSecretHash } from '../relay.ts'
import { ResourceGuardian, GuardianError } from '../guardian.ts'
import { LOCAL_RUNNER_ID, LOCAL_RUNNER_SEED } from '../data/runners.ts'
import { runnerFs } from '../runnerFs.ts'
import { DEFAULT_AGENT } from '../data/workers.ts'
import { EMPTY_WORKSPACE, workspaceFromSeed } from '../workspace.ts'
import { PersistenceWriteError, STORE_VERSION, loadState, saveState, type PersistedState, type StoredNotification, type StoredAgentProposal, type StoredA2aPeer, type StoredOpenSubGoal, type StoredWorkItemComment, type StoredContribution, type StoredContributionEvent, type StoredDelegation, type StoredDelegationRetirement, type StoredGrant, type StoredDiscussion, type StoredDiscussionPost, type StoredSocialProposal } from '../persistence/persist.ts'
import { eventlog } from '../eventlog.ts'
import { accounts } from '../accounts.ts'
import { orgInviteAddressAudience } from '../orgInviteCreationIdentity.ts'
import { resolveInitialWorld, type InitialWorld } from '../initialWorld.ts'
import {
  isDraftSessionCreationId,
  isForkSessionCreationId,
  isSessionCreationId,
} from '../sessionCreationIdentity.ts'
import { isAgentCreationId } from '../agentCreationIdentity.ts'
import { isAgentProposalCreationId } from '../agentProposalCreationIdentity.ts'
import { isAgentProposalCommentCreationId } from '../agentProposalCommentCreationIdentity.ts'
import { isAgentProposalVerdictId } from '../agentProposalVerdictIdentity.ts'
import { isToolActivityDecisionId } from '../toolActivityDecisionIdentity.ts'
import { isRelationActionDecisionId } from '../relationActionDecisionIdentity.ts'
import { isSessionCompactionId } from '../sessionCompactionIdentity.ts'
import { isDelegationCreationId } from '../delegationCreationIdentity.ts'
import { isDelegationRevocationId } from '../delegationRevocationIdentity.ts'
import { isOpenWorkCreationId } from '../openWorkCreationIdentity.ts'
import { isWorkItemCommentCreationId } from '../workItemCommentCreationIdentity.ts'
import { isWorkItemRetractionId } from '../workItemRetractionIdentity.ts'
import { isContributionLandingId } from '../contributionLandingIdentity.ts'
import { isContributionEffectExecutionId } from '../contributionEffectExecutionIdentity.ts'
import { isContributionCrystallizationId } from '../contributionCrystallizationIdentity.ts'
import { isContributionEnvelopeApprovalId } from '../contributionEnvelopeApprovalIdentity.ts'
import { isContributionEnvelopeProposalId } from '../contributionEnvelopeProposalIdentity.ts'
import { isContributionCommentCreationId } from '../contributionCommentCreationIdentity.ts'
import { isContributionReviewId } from '../contributionReviewIdentity.ts'
import { isContributionReviewRequirementId } from '../contributionReviewRequirementIdentity.ts'
import { isDelegatedJudgmentId } from '../delegatedJudgmentIdentity.ts'
import { createContextRegistry } from '../contextRegistry.ts'
import { buildContextCatalog } from '../contextCatalog.ts'
import {
  createMcpConnectionRegistry,
  McpConnectionError,
  type McpConnectionSetup,
  type PrivateMcpConnection,
  type McpInspectionOperation,
} from '../mcpConnections.ts'
import { isExternalMcpId, type McpConnectionView } from '../../contract/mcpConnections.ts'
import { parseMcpToolResult } from '../mcpToolResult.ts'
import { MCP_MODERN_VERSION } from '../mcpProtocol.ts'
import { messageHistoryText } from '../toolActivityHistory.ts'
import {
  getSessionPreferences as viewerSessionPreferences,
  persistedSessionPreferences,
  pruneSessionPreferences,
  rehydrateSessionPreferences,
  removeSessionPreferences,
  setSessionPreferences as writeSessionPreferences,
} from '../sessionPreferences.ts'
import {
  getModelPreferences as viewerModelPreferences,
  persistedModelPreferences,
  rehydrateModelPreferences,
  setModelPreferences as writeModelPreferences,
} from '../modelPreferences.ts'

/** An ambient-event subscriber. `seq` is the event's global sequence number
 *  (server/eventlog.ts — the SSE `id:` field that makes the stream resumable);
 *  optional so existing single-arg subscribers stay valid. */
type Listener = (e: ServerEvent, seq?: number) => void
type PersistenceFaultListener = () => void

export interface SessionCompactionPlan {
  kind: 'ready'
  sessionId: string
  /** Exact active+archive base read before the asynchronous model call. */
  expectedState: string
  /** Prior summary (on re-compaction) plus newly compactable real turns. */
  sourceMessages: Message[]
  /** Only real turns newly leaving active context; synthetic summaries never archive. */
  archiveMessages: Message[]
}

export type SessionCompactionPreparation =
  | { kind: 'noop'; session: Session }
  | SessionCompactionPlan

/** A monotonic-ish boot id. Math.random/Date are fine here (server side, not in
 *  the resumable-workflow sandbox); a fresh value each boot signals a reseed. */
const EPOCH = `e${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`

const COMPACTION_KEEP_RECENT = 4
const MAX_COMPACTION_SUMMARY_CHARS = 16_000
const MAX_MCP_EXECUTION_SUMMARY_CHARS = 4_000

type McpExecutionSettlement = {
  status: 'done' | 'failed' | 'uncertain'
  summary: string
  result?: McpToolResult
}

function isMcpExecutionSettlement(value: unknown): value is McpExecutionSettlement {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const candidate = value as Record<string, unknown>
  if (candidate.status !== 'done' && candidate.status !== 'failed' && candidate.status !== 'uncertain') return false
  return typeof candidate.summary === 'string' && candidate.summary.trim().length > 0 &&
    candidate.summary.length <= MAX_MCP_EXECUTION_SUMMARY_CHARS
}

/** Message bodies can change without advancing session metadataRevision (relation
 * verdicts and tool outcomes are transcript state), so the compaction CAS covers the
 * complete active and archived documents—not merely ids or row metadata. */
function compactionState(session: Session): string {
  return JSON.stringify({ messages: session.messages ?? [], compactedMessages: session.compactedMessages ?? [] })
}

type UnresolvedExternalMcpStatus = 'proposed' | 'running' | 'awaiting-input'
function hasExternalMcpActivity(messages: readonly Message[], statuses: ReadonlySet<UnresolvedExternalMcpStatus>): boolean {
  return messages.some((message) => message.toolActivities?.some((activity) =>
    !!activity.mcp && isExternalMcpId(activity.connectorId) &&
    (activity.status === 'proposed' || activity.status === 'running' || activity.status === 'awaiting-input') && statuses.has(activity.status)))
}
const pendingExternalMcp = new Set<UnresolvedExternalMcpStatus>(['proposed', 'running', 'awaiting-input'])
const runningExternalMcp = new Set<UnresolvedExternalMcpStatus>(['running', 'awaiting-input'])
const unresolvedMcpConflict = () => new ConflictError(
  'Resolve proposed MCP tool requests and finish or stop pending MCP input before changing this conversation history.',
)

function sameLocalFolderCapture(left: LocalFolderCapture, right: LocalFolderCapture): boolean {
  return left.version === right.version && left.snapshotId === right.snapshotId && left.capturedAt === right.capturedAt &&
    left.connectionId === right.connectionId && left.files.length === right.files.length && left.files.every((file, index) => {
      const other = right.files[index]
      return file.name === other?.name && file.sizeBytes === other.sizeBytes &&
        file.snapshot.text === other?.snapshot.text && file.snapshot.omitted === other?.snapshot.omitted
    })
}

function sameLocalGitCapture(left: LocalGitCapture, right: LocalGitCapture): boolean {
  return left.version === right.version && left.snapshotId === right.snapshotId && left.capturedAt === right.capturedAt &&
    left.connectionId === right.connectionId && left.files.length === right.files.length && left.files.every((file, index) => {
      const other = right.files[index]
      return file.path === other?.path && file.sizeBytes === other.sizeBytes &&
        file.snapshot.text === other?.snapshot.text && file.snapshot.omitted === other?.snapshot.omitted
    })
}

// Which backend variant this process is: the default mock behaves like a NATIVE
// sidecar (it can touch the OS); `BACKEND=remote` makes it behave like a remote
// web server (native ops report unavailable). Same API, two fulfilments — this is
// how the one UI runs in both scenarios without env-sniffing (it reads the flags).
const BACKEND_MODE: 'mock' | 'remote' = process.env.BACKEND === 'remote' ? 'remote' : 'mock'
const NATIVE = BACKEND_MODE !== 'remote'
/** The baseline this process is serving. Historical snapshots predate the
 * discriminator and are therefore demo worlds; new release stores stamp clean. */
let worldMode: InitialWorld = 'demo'
const baseProjects = (): Project[] => worldMode === 'demo' ? PROJECTS : []
const baseArtifacts = (): ArtifactItem[] => worldMode === 'demo' ? ALL_ARTIFACTS.filter((artifact) => !artifactIsRetired(artifact.id)) : []

/** The tenant a tenant-scoped entity belongs to when it carries none — the backend's
 *  default principal's tenant (personal on desktop/mock; the web tenant on remote). Used
 *  to stamp created entities and to bucket seed/legacy rows so they're visible to the
 *  default reader on BOTH backends (F2 / PD9). Threading the *request's* tenant into the
 *  store mutators is a later slice; until then writes default here, matching the reads. */
function defaultTenantId(): string {
  return resolveIdentity(BACKEND_MODE).tenant.id
}

/** Whether an UNSTAMPED (seed/legacy) row is visible to `tenantId`. The untagged
 *  seeds are the FLAGSHIP demo world (docs/demo-accounts.md): they belong to the
 *  backend's default principal AND to Ada/Acme — the same seat's two faces (the
 *  desktop's local user; the web's default principal) — so the flagship dataset
 *  reads identically on both backends, and signing in as Ada on the desktop
 *  shows the same flagship world instead of an empty one. This never widens
 *  user data: every RUNTIME-created row is stamped with its creator's tenant at
 *  creation, so only seed rows are ever unstamped. (Ownership checks for writes
 *  still resolve to `defaultTenantId()` — visibility is the demo affordance,
 *  authority stays strict.) */
function seedVisibleTo(tenantId: string): boolean {
  return tenantId === defaultTenantId() || tenantId === 'tenant-acme'
}

/** FWD-6 O-D5 — member access is a UNION at the walls, never a switched world:
 *  a caller READS as their namespace plus every org they hold a seat in;
 *  owner-grade WRITES require the org's `owner` seat. One funnel pair, so the
 *  rule can't drift per surface (in practice only Projects carry org stamps —
 *  sessions/artifacts stamp their creator — so the union is precise by
 *  construction). Dev-seam synthetic tenants hold no seats (`seatIn` is
 *  namespace-rooted), so impersonation tests see exactly the old walls. */
function tenantReadsAs(callerTenant: string, owner: string): boolean {
  return owner === callerTenant || accounts.seatIn(callerTenant, owner) !== undefined
}
function tenantWritesAs(callerTenant: string, owner: string): boolean {
  return owner === callerTenant || accounts.seatIn(callerTenant, owner) === 'owner'
}

/** Person-owned MCP connections require the actual person and a current membership. Namespace
 * ownership is not person identity; legacy connections need neither inference. */
function activeMcpActor(tenantId: string, actorUserId?: string): string | undefined {
  return actorUserId && accounts.identityFor(actorUserId, tenantId) ? actorUserId : undefined
}

function mcpActivityOwner(session: Session, activity: ToolActivity): string | undefined {
  const flow = activity.decisionId && mcpInputFlows.get(mcpInputFlowKey(session.id, activity.decisionId))
  if (flow) return flow.ownerUserId
  const authority = mcpActivityAuthorities.get(mcpActivityAuthorityKey(session.id, activity.id))
  if (authority) return authority.ownerUserId
  const connection = mcpConnectionRegistry.snapshot()
  const identities = [
    ...connection.connections.filter(row => row.id === activity.connectorId && row.ownerUserId !== undefined)
      .map(row => row.ownerUserId),
    ...connection.retired.filter(row => row.id === activity.connectorId && row.ownerUserId !== undefined)
      .map(row => row.ownerUserId!),
  ]
  if (identities.length === 0) return undefined
  return identities.length === 1 ? identities[0] : ''
}

function mcpActivityActorAllowed(session: Session, activity: ToolActivity, actorUserId?: string): boolean {
  const flow = activity.decisionId && mcpInputFlows.get(mcpInputFlowKey(session.id, activity.decisionId))
  if (flow) return flow.activityId === activity.id && flow.ownerUserId === actorUserId && activeMcpActor(flow.tenantId, actorUserId) === actorUserId
  const ownerUserId = mcpActivityOwner(session, activity)
  if (ownerUserId === undefined) return true
  const authority = mcpActivityAuthorities.get(mcpActivityAuthorityKey(session.id, activity.id))
  return !!authority && actorUserId === ownerUserId && activeMcpActor(authority.tenantId, actorUserId) === ownerUserId
}

function mcpActivitySettlementActorAllowed(session: Session, activity: ToolActivity, actorUserId?: string): boolean {
  const flow = activity.decisionId && mcpInputFlows.get(mcpInputFlowKey(session.id, activity.decisionId))
  if (flow) return flow.activityId === activity.id && flow.ownerUserId === actorUserId
  const ownerUserId = mcpActivityOwner(session, activity)
  if (ownerUserId === undefined) return true
  const authority = mcpActivityAuthorities.get(mcpActivityAuthorityKey(session.id, activity.id))
  return !!authority && actorUserId === ownerUserId && authority.ownerUserId === ownerUserId
}

/** The tenant-visibility test every scoped read shares: a stamped row matches
 *  the caller's READ union (their namespace + org seats, FWD-6); an unstamped
 *  row follows the flagship rule above. */
function rowVisibleTo(row: { tenantId?: string }, tenantId: string): boolean {
  return row.tenantId ? tenantReadsAs(tenantId, row.tenantId) : seedVisibleTo(tenantId)
}

// ── Served filesystem sources (the Files / Photos / Folder context types) ──────
// Those three types are served from a REAL filesystem (contract/fs.ts, server/fs.ts).
// The web backend's own "cloud storage" is one source: a real directory it reads +
// serves over /fs/* — the in-repo `sample-cloud/` by default (deterministic,
// reviewable), env-overridable to a real path. Available on BOTH backends (it's the
// only source on a bare remote web server). Runner-host sources are resolved in
// `resolveFsReader` (the broker proxies each runner); the UI-host source is
// client-side and never resolved here.
const CLOUD_ROOT = process.env.CONTEXT_CLOUD_ROOT ?? join(process.cwd(), 'sample-cloud')
const cloudReader = fsReader(CLOUD_ROOT)
const CLOUD_SOURCE: FsSource = { id: 'cloud', kind: 'cloud', label: 'Cloud storage' }

const listeners = new Set<Listener>()
const persistenceFaultListeners = new Set<PersistenceFaultListener>()

// The canonical relationship graph — seeded from the entities' join fields, then
// mutated by confirmed ops (the one place a relation edit lands server-side).
let graph: RelationGraph = seedGraph(PROJECTS, ALL_ARTIFACTS, SCHEDULED_TASKS)
let artifactSeq = 0
const mintArtifactId = () => `art-live-${++artifactSeq}`

// A mutable copy of the schedules — runs are appended here (by run-now and the
// scheduler), toggles flip `enabled`, so the runs feed is a single live source
// rather than a frozen snapshot.
const schedules: ScheduledTask[] = JSON.parse(JSON.stringify(SCHEDULED_TASKS))
let runSeq = 0
let scheduleSeq = 0

/** The store owns durable run state; the server's routine worker owns model I/O.
 *  Configured once by the real entrypoint. Tests that exercise state in isolation
 *  can begin/settle runs explicitly without accidentally dialing an endpoint. */
type ScheduleExecutor = (taskId: string, runId: string) => void
let scheduleExecutor: ScheduleExecutor | undefined
let scheduleRunCanceller: ScheduleExecutor | undefined
export function configureScheduleExecutor(executor: ScheduleExecutor | undefined, cancel?: ScheduleExecutor): void {
  scheduleExecutor = executor
  scheduleRunCanceller = cancel
}

export interface RoutineExecutionContext {
  task: ScheduledTask
  run: ScheduledRun
  sessionId: string
  tenantId: string
  agent: Agent
  provider: ModelProvider
  providerConfig: ProviderConfig
  modelId?: string
  contexts: SessionContext[]
  approvedContextIds: Set<string>
  externalMcpConnections?: McpConnectionView[]
  routineMcp?: RoutineMcpRuntime
  blocked?: { code: NonNullable<ScheduledRun['failureCode']>; detail: string }
}

function scheduleTiming(cadence: string, timezone: string | undefined, after: number): { nextFireAt: number; next: string; trigger: string } {
  const zone = timezone ?? 'UTC'
  if (!validTimeZone(zone)) throw new ValidationError(`Unknown schedule timezone '${zone}'.`)
  const spec = parseCadence(cadence)
  if (!spec) throw new ValidationError(`Unsupported schedule cadence '${cadence}'.`)
  const nextFireAt = nextCadenceFireAt(spec, after, zone)
  if (nextFireAt === undefined) throw new ValidationError(`Schedule cadence '${cadence}' has no next fire time.`)
  return { nextFireAt, next: nextRunLabel(spec, new Date(after), zone), trigger: describeCadence(spec).trigger }
}

// A mutable copy of the dispatch feed — "New dispatch" prepends a one-off run that
// finishes a beat later. Transient (a one-off agent run), so it's NOT persisted —
// like the live runner registry, it rebuilds from seed on restart.
const dispatch: DispatchRun[] = JSON.parse(JSON.stringify(DISPATCH_RUNS))
let dispatchSeq = 0
const DISPATCH_SETTLE_MS = 1_200

/** Pristine seed sessions, captured before any rehydrate mutates SESSIONS in
 *  place — the reference `reconcileSeedTenancy` re-ensures rows/stamps from
 *  (SCHEDULED_TASKS / DISPATCH_RUNS stay pristine on their own: `schedules` /
 *  `dispatch` are deep copies, but `SESSIONS` is spliced directly). */
const SEED_SESSIONS: readonly Session[] = JSON.parse(JSON.stringify(SESSIONS))
/** Keyed human-session identities remain retired after explicit deletion, so a
 * delayed first-send Retry cannot resurrect a conversation another device
 * deliberately removed. */
let retiredSessionCreationIds = new Set<string>()
// (Seeded runs materialize their session rows below, right after the mint-funnel
// definitions — deliberately AFTER this pristine capture: run sessions are
// derived rows, re-ensured from the schedules on every boot, not seed-session
// rows for reconcileSeedTenancy to manage.)
// The detective audit trail (docs/agent-commons.md, D15/OQ7) — an append-only log of
// effects on the cross-user channels (proxy / Project effect / commissioned host invoke),
// recorded whether fulfilled or denied. Persisted (additive) so the watch survives a
// restart. Unbounded in the prototype (the demo volume is tiny); production would rotate it.
const auditLog: AuditEntry[] = []
let auditSeq = 0

// The Project open-work backlog (docs/agent-commons.md, D19) — posted work items, the
// issues-tray analog. Persisted (additive, like `auditLog`) so an un-taken item survives
// a restart; standing dispatch is synchronous at post time, so nothing in-flight ever
// needs crash recovery — only the items themselves persist.
// The stored work-item shape (`StoredOpenSubGoal`, server/persistence/format.ts):
// the wire type plus the poster's RAW tenant id — the strict authorization anchor
// for retract (review finding: display names are attacker-controlled —
// `createWorkspace` has no uniqueness guard — so a name comparison would let a
// colliding-name tenant close a victim's items) — and the acting principals of its
// post/retract acts (FWD-5 Phase 1). Server-private, stripped below.

/** The comment redaction seam stored → wire: drop private authority, serve KIND. */
function publicWorkItemComment(c: StoredWorkItemComment): WorkItemComment {
  const { principal, authorTenant, ...pub } = c
  void authorTenant
  return { ...pub, ...(principal ? { authorKind: principal.kind } : {}) }
}

/** Retract standing: the POSTER or the Project OWNER — both by RAW tenant id,
 *  for the reason recorded above (display names are attacker-controlled). The
 *  same predicate `retractOpenSubGoal` enforces, surfaced on the wire face
 *  because the client CANNOT derive it: the ids it would need are stripped one
 *  function below. A legacy item with no `postedByTenant` is poster-
 *  unretractable (fail-closed); its Project owner still holds the act. */
function canRetractItem(item: StoredOpenSubGoal, viewerTenant: string): boolean {
  const isPoster = item.postedByTenant !== undefined && item.postedByTenant === viewerTenant
  return isPoster || tenantWritesAs(viewerTenant, findProject(item.projectId)?.tenantId ?? defaultTenantId())
}

/** Resolution provenance is a live projection over the exact durable receipt.
 * Resolved labels or a legacy Commission id alone are never proof of execution. */
function hasSuccessfulCommissionMcpResolution(item: StoredOpenSubGoal): boolean {
  if (item.status !== 'done' || !item.resolvedBy) return false
  const claim = commissionMcpRegistry.claim(item.projectId, item.id)
  return !!claim && claim.phase === 'effect' && claim.attempt.status === 'done' &&
    claim.permission.projectId === item.projectId && claim.work.itemId === item.id &&
    claim.permission.commissionId === item.resolvedBy
}

function stripStoredCommissionResolution(item: StoredOpenSubGoal): StoredOpenSubGoal {
  const { commissionResolution: _injected, ...stored } = item as StoredOpenSubGoal & { commissionResolution?: unknown }
  void _injected
  return stored
}

/** The one redaction seam stored → wire: drop the poster's raw tenant id and the
 *  act principals; the wire face carries display names + principal KINDs only —
 *  plus the viewer-relative standing those stripped ids are needed to compute. */
function publicOpenSubGoal(item: StoredOpenSubGoal, viewerTenant?: string): OpenSubGoal {
  const {
    postedByTenant,
    postedByPrincipal,
    retractionId,
    retractedByTenant,
    retractedByPrincipal,
    comments,
    ...storedFace
  } = item
  // A legacy or injected stored value never survives this funnel; the public
  // field is regenerated only from the exact successful Commission MCP claim.
  const { commissionResolution: _injected, ...pub } = storedFace as typeof storedFace & { commissionResolution?: unknown }
  void postedByTenant
  void _injected
  void retractionId
  void retractedByTenant
  return {
    ...pub,
    ...(viewerTenant !== undefined && canRetractItem(item, viewerTenant) ? { canRetract: true } : {}),
    ...(postedByPrincipal ? { postedByKind: postedByPrincipal.kind } : {}),
    ...(retractedByPrincipal ? { retractedByKind: retractedByPrincipal.kind } : {}),
    ...(comments ? { comments: comments.map(publicWorkItemComment) } : {}),
    ...(hasSuccessfulCommissionMcpResolution(item) ? { commissionResolution: 'mcp' as const } : {}),
  }
}

const openSubGoals: StoredOpenSubGoal[] = []
let openSubGoalSeq = 0

/** The Project contribution ledgers (agent-contribution workflow Phase A —
 *  docs/design/agent-contribution-workflow.md). Same redaction seam as the work
 *  item: raw tenant ids + principals are server-private anchors; the wire face
 *  carries display names + principal KINDs only. */
const contributions: StoredContribution[] = []
// Only a newly durably admitted attempt may execute in this process. Rehydrate
// clears these fences: persisted pending attempts become uncertain, never retries.
const activeContributionReviews = new Map<string, object>()
const activeDelegatedJudgments = new Map<string, object>()
const activeContributionEffects = new Map<string, object>()
let contributionSeq = 0
// Ledger bounds — a queue, not a blob store (the MAX_OPEN_WORK rationale). The
// TOTAL cap exists because landing is contributor-or-owner and the contributor
// IS the opener — without it an open→land loop would grow another tenant's
// ledger + snapshot without limit (review finding, 2026-07-20); the open cap
// alone only bounds the in-flight band.
const MAX_OPEN_CONTRIBUTIONS_PER_PROJECT = 50
const MAX_CONTRIBUTIONS_PER_PROJECT = 200
const MAX_CONTRIBUTION_NOTES = 100
// Envelope bounds (Phase C): a legible plan, not a blanket grant — few lines,
// small cardinalities. An "unbounded" envelope would be consent theater (the
// design doc's envelope-specificity residue), so the funnel refuses it.
// Changeset bounds (Phase D): entries per version + versions per contribution
// (append-only means versions accumulate — a bound, not a blob store).
const MAX_CHANGESET_ENTRIES = 20
const MAX_CHANGESET_VERSIONS = 20
// TOTAL timeline-event bound: notes have their own cap, but the envelope kinds
// (proposed / approved / executed / refused) would otherwise grow another
// tenant's timeline + snapshot without limit — the same DoS class the total
// contribution cap closes (review finding, Phase C pass).
const MAX_CONTRIBUTION_EVENTS = 300

type NormalizedCrystallizationEntry = Omit<import('../../contract/index.ts').ChangeEntry, 'id'>

/** One normalization funnel feeds first application and durable replay
 * comparison. Duplicate detection happens after truncation so two overlong
 * targets cannot collapse into the same stored (kind,target) coordinate. */
function normalizedCrystallizationEntries(
  req: import('../../contract/index.ts').CrystallizeRequest,
): NormalizedCrystallizationEntry[] | undefined {
  const entries = req.entries
  if (!Array.isArray(entries) || entries.length === 0 || entries.length > MAX_CHANGESET_ENTRIES) return undefined
  const normalized: NormalizedCrystallizationEntry[] = []
  const seen = new Set<string>()
  for (const entry of entries) {
    if (
      !CHANGE_ENTRY_KINDS.includes(entry.kind) ||
      typeof entry.target !== 'string' || !entry.target.trim() ||
      typeof entry.after !== 'string' ||
      (entry.before !== undefined && typeof entry.before !== 'string')
    ) return undefined
    const next: NormalizedCrystallizationEntry = {
      kind: entry.kind,
      target: entry.target.trim().slice(0, MAX_CONTRIBUTION_FIELD_CHARS),
      ...(entry.before !== undefined ? { before: entry.before.slice(0, MAX_CONTRIBUTION_FIELD_CHARS) } : {}),
      after: entry.after.slice(0, MAX_CONTRIBUTION_FIELD_CHARS),
    }
    const key = `${next.kind}:${next.target}`
    if (seen.has(key)) return undefined
    seen.add(key)
    normalized.push(next)
  }
  return normalized
}

function crystallizationMatchesVersion(
  entries: NormalizedCrystallizationEntry[],
  version: import('../../contract/index.ts').ChangesetVersion,
): boolean {
  if (entries.length !== version.entries.length) return false
  return entries.every((entry, index) => {
    const stored = version.entries[index]
    return stored !== undefined &&
      entry.kind === stored.kind &&
      entry.target === stored.target &&
      entry.before === stored.before &&
      entry.after === stored.after
  })
}

function publicContributionEvent(ev: StoredContributionEvent): import('../../contract/index.ts').ContributionEvent {
  const {
    principal,
    notedByTenant,
    reviewedByTenant,
    reviewRequiredByTenant,
    delegatedByTenant,
    effectByTenant,
    effectResult,
    crystallizedByTenant,
    approvedByTenant,
    proposedByTenant,
    envelopeProposalLines,
    envelopeProposalExpectedVersion,
    envelopeProposalOwnerUserId,
    ...pub
  } = ev
  return { ...pub, ...(principal ? { actorKind: principal.kind } : {}) }
}
/** The Project delegation rosters (CW8, Phase F) — judgment handed to a worker
 *  Agent under a written policy, executing AS the delegator (the conservation
 *  law). `delegatorTenant` is the server-private anchor. */
const delegations: StoredDelegation[] = []
const delegationRetirements: StoredDelegationRetirement[] = []
let delegationSeq = 0
const MAX_DELEGATIONS_PER_PROJECT = 10

/** Wire face: strip the raw tenant anchor; the POLICY is the delegator's own
 *  instrument — served to them alone (the roster row itself is legible
 *  governance any project viewer may read). */
function publicDelegation(d: StoredDelegation, viewerTenant?: string): Delegation {
  const { delegatorTenant, policy, versions: _versions, ...pub } = d
  const mine = viewerTenant !== undefined && delegatorTenant === viewerTenant
  return structuredClone({ ...pub, revision: d.revision ?? 0,
    expired: d.expiresAt !== undefined && d.expiresAt <= Date.now(),
    ...(mine ? { policy, mine: true, versions: delegationVersions(d) } : {}) })
}

function delegationRevocationReceipt(
  revocationId: string,
  projectId: string,
  did: string,
  expectedCreatedAt: number | undefined,
  tenantId: string,
  expectedRevision?: number,
): true | 'invalid' | undefined {
  if (!isDelegationRevocationId(revocationId)) return 'invalid'
  const represented = delegationRetirements.find((retirement) => retirement.revocationId === revocationId)
  if (!represented) return undefined
  if (
    represented.projectId !== projectId ||
    represented.delegationId !== did ||
    represented.expectedCreatedAt !== expectedCreatedAt ||
    represented.expectedRevision !== expectedRevision ||
    represented.revokedByTenant !== tenantId
  ) return 'invalid'
  return true
}

/** ── Social-layer grants (S1 — docs/design/social-layer.md) ──────────────────
 *  Who can see/do what on a resource. Generic over the social nouns: the ONLY
 *  kind-branching lives in `grantSubjectRow` (the per-kind adapter the
 *  orthogonality rule allows); the grant rows, walls, and events never branch.
 *  `granterTenant`/`audienceTenant` are server-private (D23: authorization
 *  compares raw ids); `publicGrant` strips them. */
/** The seed social scene (docs/design/social-layer.md §7): Ada has published the
 *  flagship insights Project to Grace with a note — so the demo lands with one
 *  live share (readable cross-namespace, a comment-tier audience) without any
 *  setup. Ids are `grant-seed-*` so runtime mints never collide. The audience is
 *  a `principal`, not an `org`: `tenant-beta` is Grace's PERSON namespace (the
 *  seeds wear their people's names — server/accounts.ts), and the share path
 *  reads both kinds as the same tenant id, so the kind's only job is to state
 *  truthfully which sort of namespace was addressed. */
const SEED_GRANTS: StoredGrant[] = [
  {
    id: 'grant-seed-1',
    subject: { kind: 'project', id: 'p-insights' },
    audience: { kind: 'principal', principalId: 'tenant-beta' },
    tier: 'propose',
    note: 'Sharing our Q3 insights baseline — comments and improvement offers welcome before we lock the readout.',
    grantedBy: 'Ada Lovelace',
    grantedAt: Date.now() - 2 * 86_400_000,
    granterTenant: 'tenant-acme',
    audienceTenant: 'tenant-beta',
  },
]
const grants: StoredGrant[] = SEED_GRANTS.map((g) => ({ ...g }))
let grantSeq = 0

/** S5 guardrails — per-viewer mute lists (actor display names). An earmuff,
 *  never a wall: filtering happens in the VIEWER's own feed/bell projections. */
const mutes = new Map<string, Set<string>>()

/** The seeded FOLLOW graph, code-owned like `SEED_GRANTS` / `SEED_DISCUSSIONS`
 *  and re-ensured on load. Without it the Commons' Following lens is empty on
 *  every cold start and the profile's follower count reads 0 — the feature's
 *  whole payload invisible until someone happens to click Follow, which this
 *  repo counts as a coverage violation rather than a skip. Deliberately small
 *  and ONE-directional: Grace follows Ada (who publishes), which is exactly the
 *  asymmetric shape a real follow graph has. */
const SEED_FOLLOWS: [string, string[]][] = [['tenant-beta', ['Ada Lovelace']]]

/** S7 — per-viewer FOLLOW lists (followee display names): the positive twin of
 *  `mutes`, keyed the same way for the same reason (a display name is the D21
 *  public handle; raw tenant ids never cross). Deliberately not the `watches`
 *  store: that one's key is a resource and its consumer is the work-item bell
 *  audience, while this one's subject is a person and its consumer is the feed.
 *  The two sets are exclusive by construction — `setFollow` clears a mute. */
const follows = new Map<string, Set<string>>(SEED_FOLLOWS.map(([t, names]) => [t, new Set(names)]))

/** S7 — per-viewer read marks for discussions: `tenantId → discussionId → the
 *  TIMESTAMP read through`. Kept beside the thread rather than on it because
 *  "have I read this" is the reader's relationship to the thread, not a property
 *  of it — the same reasoning that puts `mine`/`liked`/`viewedAt` on the
 *  viewer's projection. Feeds the DM inbox's unread dot.
 *
 *  A timestamp, deliberately NOT a post COUNT: posts are deletable (S5
 *  guardrails), so a count-based mark silently shifts when the array shrinks —
 *  read 5, one retracted, two new, and the reader is told 1 unread instead of 2
 *  (found in review). A mark that names a MOMENT is stable under deletion.
 *
 *  Bounded like its sibling ledgers (the inbox's `NOTIFICATION_CAP`, the views
 *  ledger): this is disposable derived state, and an unbounded map would grow
 *  with browsing history and ride every snapshot forever. */
const discussionReads = new Map<string, Map<string, number>>()
const READ_MARKS_PER_TENANT = 500
const MAX_GRANTS_PER_SUBJECT = 100
/** Wire face: strip the raw tenant anchors AND the redemption roster (who
 *  clicked a link is nobody's business — the `publicDelegation` pattern). */
function publicGrant(g: StoredGrant): Grant {
  const { granterTenant, audienceTenant, redeemedBy, ...pub } = g
  return pub
}

/** ── Social-layer discussions (S2 — docs/design/social-layer.md §2.3) ────────
 *  The sixth noun: talk anchored to a resource. Visibility INHERITS the
 *  anchor's read wall (never wider — comments cannot leak a resource); a
 *  locus-free anchor is the subject's ROOT thread, and opening a second root is
 *  get-or-create (the first post appends instead — one public stream per
 *  subject) — generalized in SOCIAL-6b to one public stream per POSITION: an
 *  open whose locus equals an existing thread's appends there too, so a
 *  gutter's "discuss this turn" is unambiguous however many times it's
 *  clicked. Bounds are the D23 discussion-bounds trade-off. */
/** The seed scene's talk (docs/design/social-layer.md §7). The seeded grant
 *  above hands Grace a comment-tier view of Ada's flagship Project; this
 *  is the conversation that share produced — the audience asks, the owner
 *  answers. Without it the demo world had a share with nobody talking: the
 *  Discussions section, the entity panel's thread, and every discussion-detail
 *  surface rendered only empty states on a cold start, and the `/ui-review`
 *  sweep had no thread to address (it reported the hole as a COVERAGE
 *  violation — 2026-07-23). Ids are `disc-seed-*` / `dpost-seed-*` so runtime
 *  mints (`disc-N`) never collide. */
const SEED_DISCUSSIONS: StoredDiscussion[] = [
  {
    id: 'disc-seed-1',
    // No locus — the subject's ROOT thread, the one public stream per subject.
    anchor: { ref: { kind: 'project', id: 'p-insights' } },
    state: 'open',
    openedBy: 'Grace Hopper',
    openedAt: Date.now() - 36 * 3_600_000,
    openerTenant: 'tenant-beta',
    posts: [
      {
        id: 'dpost-seed-1',
        seq: 1,
        author: 'Grace Hopper',
        authorTenant: 'tenant-beta',
        body: 'Read through the Q3 baseline — the retention cut is clearer than ours. Is the cohort window fixed at 28 days, or does it follow the billing period?',
        at: Date.now() - 36 * 3_600_000,
        reactedBy: ['tenant-acme'],
      },
      {
        id: 'dpost-seed-2',
        seq: 2,
        author: 'Ada Lovelace',
        authorTenant: 'tenant-acme',
        body: 'Fixed at 28 days for now. Following the billing period is the obvious next cut — worth an improvement offer if you want to take it.',
        at: Date.now() - 30 * 3_600_000,
        reactedBy: [],
      },
    ],
  },
  // S7 — the seeded DIRECT MESSAGE. Same code-owned, id-prefixed shape as the
  // thread above, and it exists for the same reason: on a cold start the
  // Messages section, the inbox row, the profile's Message door and the DM face
  // on the thread page would every one of them render an empty state, which
  // this repo counts as a coverage violation rather than a skip.
  //
  // Anchored on 'Ada Lovelace' and opened by Grace Hopper, so the PAIR is
  // {tenant-beta, tenant-acme} and both flagship accounts land in a live
  // conversation — Ada sees it from Grace, Grace sees it from Ada.
  {
    id: 'disc-seed-2',
    anchor: { ref: { kind: 'principal', id: 'Ada Lovelace' } },
    state: 'open',
    openedBy: 'Grace Hopper',
    openedAt: Date.now() - 5 * 3_600_000,
    openerTenant: 'tenant-beta',
    targetTenant: 'tenant-acme',
    posts: [
      {
        id: 'dpost-seed-3',
        seq: 1,
        author: 'Grace Hopper',
        authorTenant: 'tenant-beta',
        body: 'Off-thread for a second — before I offer the billing-period change, is anyone else already on it? Don’t want to duplicate work.',
        at: Date.now() - 5 * 3_600_000,
        reactedBy: [],
      },
      {
        id: 'dpost-seed-4',
        seq: 2,
        author: 'Ada Lovelace',
        authorTenant: 'tenant-acme',
        body: 'Nobody’s on it. Go ahead — I’ll review it the same day you offer it.',
        at: Date.now() - 4 * 3_600_000,
        reactedBy: [],
      },
    ],
  },
]

const discussions: StoredDiscussion[] = SEED_DISCUSSIONS.map((d) => ({ ...d, posts: d.posts.map((p) => ({ ...p, reactedBy: [...p.reactedBy] })) }))
let discussionSeq = 0
const MAX_DISCUSSIONS_PER_SUBJECT = 100
/** S8 — how many posts ONE author may accumulate. Deliberately far above any
 *  real use (a per-anchor cap of 100 would have been a lifetime limit on
 *  speaking, the trap S7 stepped around for correspondents), but not absent:
 *  every post is a persisted row in the snapshot, and the contributions ledger
 *  already carries a total cap alongside its open cap for exactly this reason —
 *  a loop that opens and closes forever must not grow the store without bound.
 *  The router's rate limit bounds the RATE; this bounds the total. */
const MAX_POSTS_PER_AUTHOR = 1000
const MAX_DISCUSSION_CHARS = 2000

/** Do two anchors point at the SAME position? Absent === absent is the root.
 *  Structural rather than per-kind: every `AnchorLocus` variant is a flat record
 *  of scalars by construction (contract/social.ts), so one comparison serves
 *  every kind — and a new variant needs no edit here. */
function sameLocus(a: AnchorLocus | undefined, b: AnchorLocus | undefined): boolean {
  if (a === undefined || b === undefined) return a === b
  if (a.kind !== b.kind) return false
  const keys = new Set([...Object.keys(a), ...Object.keys(b)])
  return [...keys].every((k) => (a as Record<string, unknown>)[k] === (b as Record<string, unknown>)[k])
}

/** Wire face: strip the raw tenant anchors; reactions serve as a count + the
 *  caller's own bit (viewer-relative, computed at serve time — the `mine`
 *  pattern). */
/** Does the viewer OWN the anchor a thread hangs on? The moderator half of both
 *  two-party rules below (resolve, and post deletion). */
function ownsDiscussionAnchor(d: StoredDiscussion, viewerTenant: string): boolean {
  // S8 — a POST's anchor is a PERSON, and a person has no `grantSubjectRow`
  // (you cannot share one — the orthogonality matrix refuses grant × principal).
  // Its owner is simply whoever it is: the author. Without this arm the S5
  // guardrail rule "moderation lives with the anchor's owner" found nobody on a
  // wall, so an author could not delete a reply under their own post — the
  // one place the square admits abuse, and the one control that answers it.
  if (d.anchor.ref.kind === 'principal') {
    return isWallThread(d) && tenantWritesAs(viewerTenant, d.openerTenant)
  }
  const row = store.grantSubjectRow(d.anchor.ref)
  return row !== undefined && row !== 'unsupported' && ownsGrantSubject(row, viewerTenant)
}

/** Resolve standing: the OPENER or the anchor's OWNER — the same predicate
 *  `setDiscussionState` enforces, read here so the wire face carries the answer
 *  and no surface has to re-derive (or under-derive) it. */
function canResolveDiscussion(d: StoredDiscussion, viewerTenant: string): boolean {
  // S7 — a DM has NO resolved state. "Resolved" is a question-settled verdict on
  // a thread ABOUT something, and a conversation with a person is not a question
  // anyone closes. Found in the in-app pass: the control rendered for a DM's
  // opener and for nobody else, so one party could mark a two-party conversation
  // finished and the other could not even reopen it. Refused here, which is also
  // where the affordance reads its standing — one decision, not two.
  if (d.anchor.ref.kind === 'principal') return false
  return tenantWritesAs(viewerTenant, d.openerTenant) || ownsDiscussionAnchor(d, viewerTenant)
}

/** Delete standing (S5 guardrails): the post's AUTHOR retracts their own words;
 *  the ANCHOR OWNER moderates their surface. The same predicate
 *  `deleteDiscussionPost` enforces. */
function canDeletePost(d: StoredDiscussion, authorTenant: string, viewerTenant: string): boolean {
  return tenantWritesAs(viewerTenant, authorTenant) || ownsDiscussionAnchor(d, viewerTenant)
}

/** Every post under `pid`, at every depth (S9 reply chains). The UI has this
 *  walk too (`src/lib/replyTree.ts`) and the two deliberately do not share it:
 *  `src/` and `server/` meet only at `contract/`, which is wire TYPES, and a
 *  tree walk is not one. Both are `seen`-guarded for the same reason — a ring
 *  cannot be written through `resolveReplyTarget`, but the cost of being wrong
 *  is a request that never returns. */
function postDescendants(d: StoredDiscussion, pid: string): Set<string> {
  const out = new Set<string>()
  const stack = [pid]
  while (stack.length > 0) {
    const parent = stack.pop() as string
    for (const p of d.posts) {
      if (p.replyTo !== parent || p.id === pid || out.has(p.id)) continue
      out.add(p.id)
      stack.push(p.id)
    }
  }
  return out
}

/** S7 — the DM face on the wire. A direct message is not a variant type: it is
 *  a Discussion whose anchor is a person, so these are viewer-relative
 *  DECORATIONS computed at serve time (the `mine` pattern), never stored.
 *
 *  `counterpart` exists because the anchor names only ONE end. A DM's identity
 *  is the unordered pair, so the anchor's name is the right answer for the
 *  opener and exactly the wrong one for the recipient — who would otherwise see
 *  a thread labelled with their own name. */
function dmFace(d: StoredDiscussion, viewerTenant?: string): Partial<Discussion> {
  if (d.anchor.ref.kind !== 'principal') return {}
  // S8 — a POST is principal-anchored too, and must NOT wear the DM face: it has
  // no counterpart (you did not write to anybody), no inbox unread, and a
  // surface reading `direct` would render an utterance as mail. The two faces
  // are mutually exclusive because the anchor cannot be both you and not-you.
  if (isWallThread(d)) return {}
  if (viewerTenant === undefined) return { direct: true }
  const other = viewerTenant === d.openerTenant ? d.anchor.ref.id : d.openedBy
  const readThrough = discussionReads.get(viewerTenant)?.get(d.id) ?? 0
  // Your own words are never unread — count only posts somebody else wrote,
  // past the ORDINAL this reader last caught up to. An ordinal (not an index,
  // not a timestamp) is stable when a post is deleted and cannot tie.
  const unread = d.posts.filter((p) => (p.seq ?? 0) > readThrough && p.authorTenant !== viewerTenant).length
  return { direct: true, counterpart: other, ...(unread > 0 ? { unread } : {}) }
}

/** ── S8: is this thread a POST? ──────────────────────────────────────────────
 *  A principal-anchored thread is a DM when it names somebody else and a POST
 *  when it names its own author. One predicate, because four walls branch on it
 *  and they must agree; keyed on the STORED tenant ids, never the display name,
 *  for the reason `dmParties` states (a name is not an identity).
 *
 *  `targetTenant` is captured at open for every principal thread, so a wall
 *  thread is exactly `targetTenant === openerTenant`. Rows written before S7
 *  stamped the field fall back to the name lookup, like `dmParties`. */
function isWallThread(d: StoredDiscussion): boolean {
  if (d.anchor.ref.kind !== 'principal') return false
  const target = d.targetTenant ?? tenantIdForName(d.anchor.ref.id)
  return target !== undefined && target === d.openerTenant
}

/** The bell one post mints. A resource thread rings `social.discussed` — "someone
 *  is talking about your thing". A DM rings `social.messaged`, because that
 *  sentence would be a lie: nobody is discussing the recipient, somebody is
 *  writing TO them. The message row deliberately carries no subject face
 *  either: the anchored name IS the recipient, so echoing it back would label
 *  the bell with the reader's own name. The actor and the door are the whole
 *  story. A reply on a WALL rings `social.discussed` (S8): it IS talk about
 *  what that person said. */
function discussionBell(
  d: StoredDiscussion,
  tenantId: string,
  subjectName: string,
): Omit<StoredNotification, 'id' | 'read' | 'at' | 'tenantId'> {
  const actor = tenantName(tenantId)
  // S8 — a reply on somebody's WALL is talk about what they said, so it rings
  // as a discussion, not as a message. Only a thread addressed to another
  // person is mail.
  if (d.anchor.ref.kind === 'principal' && !isWallThread(d)) {
    return { kind: 'social.messaged', actor, discussionId: d.id }
  }
  // S8 — a reply on a WALL carries NO subject face: a post's subject is its
  // author, so echoing it would label the recipient's bell with their own name
  // (the mistake `social.messaged` exists to avoid). The actor and the door are
  // the whole story, exactly as for a message.
  if (d.anchor.ref.kind === 'principal') return { kind: 'social.replied', actor, discussionId: d.id }
  return {
    kind: 'social.discussed',
    actor,
    subjectKind: d.anchor.ref.kind,
    subjectId: d.anchor.ref.id,
    subjectName,
    discussionId: d.id,
  }
}

/** Mint one post. The ordinal rides the SAME global counter as the id, so it is
 *  monotonic across the whole store and can never be reused — deriving it from
 *  the thread's surviving posts would hand a deleted post's ordinal to the next
 *  one, and a reader whose mark sat on it would never see that message. */
function mintPost(
  body: string,
  tenantId: string,
  at = Date.now(),
  replyTo?: string,
  logicalPostId?: string,
): StoredDiscussionPost {
  const seq = (discussionSeq += 1)
  return {
    id: logicalPostId ?? `dpost-${seq}`,
    author: tenantName(tenantId),
    authorTenant: tenantId,
    body: body.slice(0, MAX_DISCUSSION_CHARS),
    at,
    reactedBy: [],
    seq,
    ...(replyTo !== undefined ? { replyTo } : {}),
  }
}

/** Find the durable representation of one keyed post. Tenant ownership is part
 *  of the lookup even though the id already hashes it: callers can never use a
 *  copied public post id as a replay credential. */
function discussionForLogicalPost(postId: string, tenantId: string): StoredDiscussion | undefined {
  return discussions.find((discussion) =>
    discussion.posts.some((post) => post.id === postId && post.authorTenant === tenantId),
  )
}

/** ── S9: where a reply actually attaches ─────────────────────────────────────
 *  The parent is the post NAMED, at whatever depth it sits — a reply chain is
 *  recursive (owner directive 2026-08-11).
 *
 *  This used to CAP the depth at one level, re-parenting an answer-to-an-answer
 *  onto that answer's own parent, because the renderer drew exactly one indent
 *  and a depth rule kept only in the UI is a rule the route does not have. The
 *  cap outlived its reason and became a lie the surface then repeated: a post
 *  answering Ada was recorded as answering GRACE, so it rendered under the wrong
 *  remark and rang the wrong person's bell. When the renderer learned to draw
 *  the chain, the write path had nothing left to protect — so the rule went out
 *  with the constraint that earned it, and DEPTH is now the reader's to collapse
 *  (`lib/replyTree.ts`) rather than the author's to lose.
 *
 *  No cycle is reachable from here: a parent must already exist, and the post
 *  being written carries an id nothing can name yet.
 *
 *  Returns `'unknown'` for an id that names no post in this thread, which the
 *  caller REFUSES rather than dropping to top level: a reply that silently
 *  detaches from what it answers is worse than one that fails, because the
 *  author cannot see that it happened. */
function resolveReplyTarget(d: StoredDiscussion, replyTo: string | undefined): string | undefined | 'unknown' {
  if (replyTo === undefined) return undefined
  return d.posts.some((p) => p.id === replyTo) ? replyTo : 'unknown'
}

function publicDiscussion(d: StoredDiscussion, viewerTenant?: string): Discussion {
  // `targetTenant` is stripped with `openerTenant`: a raw tenant id never
  // crosses the wire (the REDACTED rule). What the reader gets instead is the
  // viewer-relative `counterpart` name that `dmFace` computes.
  const { openerTenant, targetTenant, posts, ...pub } = d
  return {
    ...pub,
    stateRevision: d.stateRevision ?? 0,
    ...dmFace(d, viewerTenant),
    ...(isWallThread(d) ? { wall: true } : {}),
    ...(viewerTenant !== undefined && tenantWritesAs(viewerTenant, openerTenant) ? { mine: true } : {}),
    ...(viewerTenant !== undefined && canResolveDiscussion(d, viewerTenant) ? { canResolve: true } : {}),
    // The thread's own write standing, from the predicate the write path uses.
    ...(viewerTenant !== undefined && store.discussionWritableBy(d, viewerTenant) ? { canPost: true } : {}),
    posts: posts.map((p) => {
      const { authorTenant, reactedBy, reportedBy, ...post } = p
      // S8 — resolved at SERVE time, never stored: a display name can change,
      // and a stored copy would linkify a name its bearer no longer wears. Same
      // resolver that decided who was rung, so the highlighted set and the
      // notified set are one answer.
      //
      // The `@` guard is not decoration: `resolveMentions` indexes the whole
      // tenant registry on every call, and this runs per POST per READ — a
      // thread of 200 posts would rebuild that index 200 times to find nothing.
      // Almost no body contains an `@`, so the common case now costs a scan.
      const mentions = p.body.includes('@')
        ? [...new Set([...resolveMentions(p.body)].map((t) => tenantName(t)))]
        : []
      return {
        ...post,
        ...(mentions.length > 0 ? { mentions } : {}),
        reactions: reactedBy.length,
        ...(viewerTenant !== undefined && reactedBy.some((t) => tenantReadsAs(viewerTenant, t)) ? { reacted: true } : {}),
        ...(viewerTenant !== undefined && reportedBy?.includes(viewerTenant) ? { reported: true } : {}),
        ...(viewerTenant !== undefined && tenantWritesAs(viewerTenant, authorTenant) ? { mine: true } : {}),
        ...(viewerTenant !== undefined && canDeletePost(d, authorTenant, viewerTenant) ? { canDelete: true } : {}),
      }
    }),
  }
}

/** ── Artifact body edits (social S3's `artifact-patch`) ──────────────────────
 *  The authored library (`ARTIFACT_CONTENT`) stays an immutable FIXTURE keyed by
 *  file name; every edit lands here instead, keyed by ARTIFACT ID. Two artifacts
 *  in different tenants may share a name, so a name-keyed edit store would let
 *  one workspace rewrite another's document — authority never keys on a name
 *  (the S7 lesson). `store.artifactContent(tenantId)` projects only readable
 *  identities; `artifactBodyOf(id)` is the canonical artifact resolver. */
const artifactBodies = new Map<string, ArtifactContent>()
const artifactHistory = new Map<string, ArtifactHistoryVersion[]>()
const artifactHistoryRestoreReceipts = new Map<string, StoredArtifactHistoryRestoreReceipt>()
// Display metadata is independent of authored bytes and immutable save origin.
// This also lets demo rows be renamed without mutating the fixture library.
const artifactMetadata = new Map<string, ArtifactMetadata>()
// Retention is independent of body/name ordering. The canonical row remains
// present so historical saves and keyed creation can never silently recreate it.
const artifactLifecycle = new Map<string, ArtifactLifecycle>()
const artifactRetirements = new Map<string, ArtifactRetirement>()
const artifactDeletionReceipts = new Map<string, StoredArtifactDeletionReceipt>()
const artifactDeletionReviews = new Map<string, { artifactId: string; tenantId: string; fingerprint: string; lifecycleRevision: number }>()
const artifactIsRetired = (id: string): boolean => artifactRetirements.has(id)
const artifactIsTrashed = (id: string): boolean => !artifactIsRetired(id) && artifactLifecycle.get(id)?.state === 'trashed'
const artifactRetirementTenant = (id: string): string | undefined => artifactRetirements.get(id)?.tenantId
const artifactSaveOriginHash = (tenantId: string, origin: { name: string; source: string }): string =>
  createHash('sha256').update(JSON.stringify([tenantId, origin.name, origin.source])).digest('hex')
const artifactWithMetadata = (artifact: ArtifactItem): ArtifactItem => {
  const projected = { ...projectArtifactMetadata(artifact, artifactMetadata.get(artifact.id)),
    lifecycleRevision: artifactLifecycle.get(artifact.id)?.revision ?? 0 }
  const body = artifact.excerptSource === 'body' ? retainedArtifactBody(artifact.id) : undefined
  return body ? { ...projected, excerpt: artifactBodyExcerpt(body) ?? projected.excerpt } : projected
}

/** Commit one accepted body replacement together with the artifact row's shared
 * edit timestamp. The metadata overlay already owns that timestamp durably;
 * retaining its current name revision keeps body and rename CAS independent.
 * Publish only after the snapshot commits, matching the rename funnel. */
function commitArtifactBodyEdit(
  artifact: ArtifactItem,
  updated: ArtifactContent,
  options: { reason?: 'edit' | 'restore'; restoredFromRevision?: number; beforePersist?: () => void } = {},
): ArtifactContent {
  // Older snapshots admitted names outside today's metadata contract. Keep
  // those rows readable/renameable, but never persist an invalid name overlay.
  if (normalizeArtifactName(artifact.name) !== artifact.name) {
    throw new ValidationError('Rename this artifact to a valid name before editing its content.')
  }
  const current = retainedArtifactBody(artifact.id)
  if (!current || (updated.revision ?? 0) !== (current.revision ?? 0) + 1 ||
    (current.revision ?? 0) >= Number.MAX_SAFE_INTEGER) {
    throw new ConflictError('This artifact cannot accept another body revision. Refresh its current content before retrying.')
  }
  const committed = identifyDocumentBody(artifact.id, updated)
  const editedAt = Math.max(Date.now(), artifact.editedAt)
  const versions = prepareArtifactHistoryAppend(
    artifact.id, current, committed, new Date(editedAt).toISOString(), options.reason ?? 'edit',
    options.restoredFromRevision, artifactHistory.get(artifact.id),
  )
  artifactBodies.set(artifact.id, committed)
  artifactHistory.set(artifact.id, versions)
  artifactMetadata.set(artifact.id, {
    name: artifact.name,
    revision: artifact.metadataRevision ?? 0,
    editedAt,
  })
  options.beforePersist?.()
  persist()
  emit({ type: 'artifact.changed', artifactId: artifact.id })
  return committed
}

/** An artifact's CURRENT body — the edit if it has one, else the authored seed.
 *  Module-level so the store's methods AND the wire-face builders share one
 *  resolver (`publicSocialProposal` stamps a diff's base from it). */
function artifactBodyOf(artifactId: string): ArtifactContent | undefined {
  if (artifactIsTrashed(artifactId)) return undefined
  return retainedArtifactBody(artifactId)
}
/** Private retention resolver: only metadata/Trash projection may bypass the
 * ordinary read wall. Export/edit/model paths must use artifactBodyOf instead. */
function retainedArtifactBody(artifactId: string, knownBaseArtifact?: ArtifactItem): ArtifactContent | undefined {
  const stored = artifactBodies.get(artifactId)
  if (stored) return identifyDocumentBody(artifactId, stored)
  const a = knownBaseArtifact?.id === artifactId
    ? knownBaseArtifact
    : baseArtifacts().find((candidate) => candidate.id === artifactId)
  const body = a ? ARTIFACT_CONTENT[a.name] : undefined
  return body ? identifyDocumentBody(artifactId, body) : undefined
}

/** The text an addressed block carries right now, or undefined when the address
 *  doesn't resolve to a PATCHABLE block (unknown artifact, non-doc body, index
 *  out of range, or a block with no single editable string). The ONE answer
 *  behind three questions that must never disagree: may this patch be offered,
 *  what does its diff show as the before, and which blocks may the form list. */
function artifactBlockTextOf(artifactId: string, block: number): string | undefined {
  const body = artifactBodyOf(artifactId)
  if (!body || body.type !== 'doc') return undefined
  if (!Number.isInteger(block) || block < 0 || block >= body.blocks.length) return undefined
  return docBlockText(body.blocks[block])
}

function documentBlockIds(body: ArtifactContent | undefined): string[] | undefined {
  if (!body || body.type !== 'doc') return undefined
  const ids = body.blocks.map((block) => block.id)
  return ids.every((id): id is string => typeof id === 'string') ? ids : undefined
}

/** An unversioned legacy index can only be safe while all retained versions
 * prove the same stable block order. Legacy bodies have no such proof. */
function stableDocumentBlockOrder(artifactId: string): boolean {
  const current = documentBlockIds(artifactBodyOf(artifactId))
  if (!current) return false
  return (artifactHistory.get(artifactId) ?? []).every((version) => {
    const ids = documentBlockIds({ ...version.body, revision: version.revision } as ArtifactContent)
    return !!ids && ids.length === current.length && ids.every((id, index) => id === current[index])
  })
}

function validateNewDocumentBlockIds(
  artifactId: string,
  current: ArtifactContent,
  next: ArtifactContent,
): void {
  const currentIds = new Set(documentBlockIds(current) ?? [])
  const retainedIds = new Set<string>()
  for (const version of artifactHistory.get(artifactId) ?? []) {
    for (const id of documentBlockIds({ ...version.body, revision: version.revision } as ArtifactContent) ?? []) retainedIds.add(id)
  }
  for (const id of documentBlockIds(next) ?? []) {
    if (!currentIds.has(id) && retainedIds.has(id)) {
      throw new ValidationError('A retired Document block identity cannot be reused; restore its saved version or choose a new block identity.')
    }
  }
}

/** ── Social-layer proposals (S3 — docs/design/social-layer.md §2.4) ──────────
 *  The landing-ledger generalized: a typed delta offered to any noun, landed by
 *  the subject OWNER's consent into a per-subject linear ledger. The review
 *  thread is a normal Discussion anchored to the proposal (recursion). */
const socialProposals: StoredSocialProposal[] = []
let socialProposalSeq = 0
const MAX_PROPOSALS_PER_SUBJECT = 100
const MAX_PROPOSAL_CHARS = 2000
/** One prose block's ceiling — the `artifact-patch` delta's text and the owner's
 *  own edit share it, because both end in the same body. Same order as the other
 *  free-text caps; the point is a bound, not a precise budget. */
/** A patch is offerable when it is a non-empty object naming only proposable
 *  fields, each of the right primitive type. */
function isSchedulePatch(patch: unknown): boolean {
  if (typeof patch !== 'object' || patch === null || Array.isArray(patch)) return false
  const keys = Object.keys(patch)
  if (keys.length === 0) return false
  const allowed = new Set<string>(PROPOSABLE_SCHEDULE_FIELDS)
  const primitivesValid = keys.every((k) => {
    if (!allowed.has(k)) return false
    const v = (patch as Record<string, unknown>)[k]
    return k === 'enabled' || k === 'notifyOnFailure' ? typeof v === 'boolean' : typeof v === 'string' && v.trim().length > 0
  })
  if (!primitivesValid) return false
  const typed = patch as Record<string, unknown>
  if (typeof typed.cadence === 'string' && !parseCadence(typed.cadence)) return false
  if (typeof typed.timezone === 'string' && !validTimeZone(typed.timezone)) return false
  return true
}

/** Whether an applying proposal's reviewed target has moved since it was
 * offered. A missing precondition is a legacy row and remains landable under
 * its original unconditional semantics; new applying rows always carry one. */
function socialProposalIsStale(p: StoredSocialProposal): boolean {
  if (p.state !== 'offered' || p.baseRevision === undefined) return false
  switch (p.delta.kind) {
    case 'relation-op':
      return (graph.revision ?? 0) !== p.baseRevision
    case 'schedule-patch': {
      const task = schedules.find((candidate) => candidate.id === p.subject.id)
      return !task || (task.revision ?? 0) !== p.baseRevision
    }
    case 'artifact-patch': {
      const body = artifactBodyOf(p.subject.id)
      return !body || (p.baseRevision === undefined
        ? !stableDocumentBlockOrder(p.subject.id)
        : (body.revision ?? 0) !== p.baseRevision)
    }
    case 'suggestion':
      return false
  }
}

/** Wire face: strip server-only preconditions/raw authority; `mine` is
 * viewer-relative and `stale` is derived from current server truth. */
function publicSocialProposal(p: StoredSocialProposal, viewerTenant?: string): SocialProposal {
  const { offererTenant, appliedBase, offeredBase, baseRevision: _baseRevision, ...pub } = p
  // New proposals retain the exact before-side the offerer reviewed. A legacy
  // open row has no frozen base, so it keeps the prior live fallback rather than
  // inventing history during migration.
  const base =
    p.delta.kind !== 'artifact-patch'
      ? undefined
      : p.state === 'landed'
        ? appliedBase
        : offeredBase ?? artifactBlockTextOf(p.subject.id, p.delta.block)
  const stale = socialProposalIsStale(p)
  return {
    ...pub,
    ...(base !== undefined ? { deltaBase: base } : {}),
    ...(stale ? { stale: true } : {}),
    ...(viewerTenant !== undefined && tenantWritesAs(viewerTenant, offererTenant) ? { mine: true } : {}),
  }
}

/** The next L# for a subject — ONE landing ledger per subject (the Changes/
 *  Improvements consolidation, 2026-07-21): one past the highest landed number
 *  across every path that lands on it. For a project that is BOTH ledgers —
 *  the contribution workflow (Phase A–E) and social proposals (S3) — so the
 *  merged Changes panel reads as a single monotonic history. Derived from the
 *  ledgers themselves, never a counter: a restored snapshot can't double-assign. */
function nextLandingNumber(subject: SocialEntityRef): number {
  const topProposal = socialProposals.reduce(
    (m, x) => (x.subject.kind === subject.kind && x.subject.id === subject.id ? Math.max(m, x.landingNumber ?? 0) : m),
    0,
  )
  const topContribution =
    subject.kind === 'project'
      ? contributions.reduce((m, x) => (x.projectId === subject.id ? Math.max(m, x.landingNumber ?? 0) : m), 0)
      : 0
  return Math.max(topProposal, topContribution) + 1
}

/** A proposal has no wall of its own — its readability, tiers, and ownership
 *  are its SUBJECT's. Canonicalize a ref through that indirection (bounded:
 *  proposal subjects are never proposals more than a few deep by construction)
 *  so every predicate checks grants against the ref they actually ride on. */
function canonicalSocialRef(ref: SocialEntityRef): SocialEntityRef | undefined {
  let cur = ref
  for (let hops = 0; cur.kind === 'proposal'; hops += 1) {
    if (hops >= 4) return undefined
    const p = socialProposals.find((x) => x.id === cur.id)
    if (!p) return undefined
    cur = p.subject
  }
  return cur
}

/** The tier `viewerTenant` holds on a subject via grants (their read union) —
 *  module-level so the listing projections can consult it; `store.grantedTier`
 *  delegates here. */
function grantAddressedTo(g: StoredGrant, viewerTenant: string): boolean {
  return g.audience.kind === 'link'
    ? (g.redeemedBy ?? []).some((t) => tenantReadsAs(viewerTenant, t))
    : tenantReadsAs(viewerTenant, g.audienceTenant)
}

function addressedGrantFor(ref: SocialEntityRef, viewerTenant: string): StoredGrant | undefined {
  return grants.find(
    (g) => g.subject.kind === ref.kind && g.subject.id === ref.id && grantAddressedTo(g, viewerTenant),
  )
}

function grantedTierFor(ref: SocialEntityRef, viewerTenant: string): ShareTier | undefined {
  let best: ShareTier | undefined
  for (const g of grants) {
    if (g.subject.kind !== ref.kind || g.subject.id !== ref.id) continue
    // A LINK grant (S6) addresses whoever REDEEMED the token; a directed grant
    // addresses its audience's read union.
    if (!grantAddressedTo(g, viewerTenant)) continue
    if (best === undefined || tierRank(g.tier) > tierRank(best)) best = g.tier
  }
  return best
}

/** The public owner of a granted Project is the principal who opened that
 *  surface to this viewer. This matters for the deliberately UNSTAMPED flagship
 *  seeds: they have two private faces (the local desktop principal and Ada), but
 *  the seeded cross-account grant is specifically Ada's act. Falling back to the
 *  backend default labeled Grace's visitor page "by Personal" while its feed card
 *  correctly said Ada Lovelace — two owners for one Project. Stamped Projects keep
 *  their one owner; an ungranted legacy row keeps the backend-default fallback. */
function publicProjectOwnerTenant(project: Project, viewerTenant: string): string {
  if (project.tenantId) return project.tenantId
  return addressedGrantFor({ kind: 'project', id: project.id }, viewerTenant)?.granterTenant ?? defaultTenantId()
}

/** Who may act as a subject's OWNER for grants. A stamped row: its tenant's
 *  write union. An UNSTAMPED seed: the flagship faces (the backend's default
 *  principal AND Ada/Acme — `seedVisibleTo`'s one-seat-two-faces rule), because
 *  the demo flow IS Ada sharing the flagship world; a strict default-tenant
 *  check made her 403 on her own demo data (found live, 2026-07-21). Runtime
 *  rows are always stamped, so this never widens user data. */
function ownsGrantSubject(row: { tenantId?: string }, tenantId: string): boolean {
  if (row.tenantId) return tenantWritesAs(tenantId, row.tenantId)
  return tenantWritesAs(tenantId, defaultTenantId()) || seedVisibleTo(tenantId)
}

// CW5 — the trust threshold: landings on THIS project before the arithmetic
// grants Tier 0 (auto-land). Deliberately small (the demo must be reachable)
// and deliberately irrelevant to the Tier-2 floor (trust never buys past it).
const TRUST_LANDINGS = 3

/** The landing gate, computed — the CW5 arithmetic, served with its basis
 *  spelled out. Risk first (irreversible envelope lines ⇒ the Tier-2 human
 *  floor, unconditionally), then the owner's tightening, then trust. */
/** Risk covers DECLARED intent (current irreversible lines) AND EXECUTED
 *  history (`effectsFired`): amending the line away after the act ran must not
 *  drop the floor. ONE definition — `tierFor` and the delegation escalation
 *  both read it, because this expression is what keeps "the floor is not
 *  delegable" true (drift here would let a delegate land irreversible work
 *  with no human — review finding, Phase F pass). */
function isEffectfulContribution(c: StoredContribution): boolean {
  return c.effectsFired === true || (c.envelope?.lines ?? []).some((l) => !isProjectEffectMonotonic(l.type))
}
/** The CW5 trust input: this contributor's landed count on this project. */
function landedCountFor(projectId: string, contributorTenant: string | undefined): number {
  return contributions.filter(
    (x) => x.projectId === projectId && x.status === 'landed' && x.contributorTenant !== undefined && x.contributorTenant === contributorTenant,
  ).length
}

function tierFor(c: StoredContribution): import('../../contract/index.ts').ContributionTier {
  if (isEffectfulContribution(c)) return { level: 2, basis: 'irreversible effects — the owner lands (the floor; no record buys past it)' }
  const landedHere = landedCountFor(c.projectId, c.contributorTenant)
  if (c.reviewRequired === true) {
    return { level: 1, basis: `owner requires review · ${landedHere} landed here` }
  }
  if (landedHere < TRUST_LANDINGS) {
    return { level: 1, basis: `${landedHere} of ${TRUST_LANDINGS} landings here — adversarial review before landing` }
  }
  return { level: 0, basis: `trusted: ${landedHere} landed here · no effects — lands on green` }
}

function publicContribution(c: StoredContribution, viewerTenant?: string, viewerUserId?: string): Contribution {
  const { contributorTenant, contributorPrincipal, landingId, landedByTenant, events, reviewedVersion, reviewAttempts, judgmentAttempts, effectAttempts, envelope, ...pub } = c
  const effectiveReview = c.status === 'open' || reviewAttempts?.length ? contributionReviewVersion(c) : reviewedVersion
  const pendingEffect = effectAttempts?.some((run) => run.status === 'pending')
  const linkedWork = c.workItemId === undefined ? undefined :
    openSubGoals.find((item) => item.id === c.workItemId && item.projectId === c.projectId)
  const workOpen = c.workItemId === undefined || linkedWork?.status === 'open'
  return {
    ...pub,
    ...(c.workItemId === undefined ? {} : { workItemResolution: computeProjectWorkResolution(linkedWork, c).status }),
    ...(envelope ? { envelope: { ...envelope, lines: envelope.lines.map(({ mcpAuthority: _authority, mcp, ...line }) => ({
      ...line,
      ...(mcp ? { mcp: { connectionLabel: mcp.connectionLabel, toolName: mcp.toolName, arguments: structuredClone(mcp.arguments),
        ...(mcp.transport === undefined ? {} : { transport: mcp.transport }),
        ...(viewerTenant && c.status === 'open' && workOpen && !pendingEffect && envelope.status === 'approved' && envelope.approvedVersion === envelope.version &&
          line.used < line.cardinality && (effectAttempts?.length ?? 0) < CONTRIBUTION_EFFECT_ATTEMPT_MAX &&
          contributionEffectActor(c, viewerTenant) && currentContributionMcpLine(store, viewerTenant,
            { ...line, mcp, mcpAuthority: _authority }, activeMcpActor(viewerTenant, viewerUserId))
          ? { canRun: true as const } : {}),
      } } : {}),
    })) } } : {}),
    ...(effectiveReview !== undefined ? { reviewedVersion: effectiveReview } : {}),
    ...(contributorPrincipal ? { contributorKind: contributorPrincipal.kind } : {}),
    // Viewer-relative, never stored: display names aren't unique, so the client
    // must not infer "yours" from a name — the raw-id comparison happens HERE,
    // and only the boolean crosses the wire (the projects `own` pattern).
    ...(viewerTenant !== undefined && contributorTenant === viewerTenant ? { mine: true } : {}),
    // The gate, computed at serve time (never stored) — it moves as the
    // contributor's record and the envelope move.
    tier: tierFor(c),
    events: events.map(publicContributionEvent),
    ...(reviewAttempts ? { reviews: reviewAttempts.map(publicReviewRun) } : {}),
    ...(judgmentAttempts ? { judgments: judgmentAttempts.map((run) => publicJudgmentRun(run, viewerTenant)) } : {}),
    ...(effectAttempts ? { effects: effectAttempts.map(publicContributionEffectRun) } : {}),
  }
}

function contributionEffectActor(c: StoredContribution, tenantId: string): boolean {
  return store.grantSubjectVisible({ kind: 'project', id: c.projectId }, tenantId) &&
    (c.contributorTenant === tenantId || tenantWritesAs(tenantId, findProject(c.projectId)?.tenantId ?? defaultTenantId()))
}
// D23 discussion bounds — enough to coordinate, not a blob store (a hostile poster
// gets a cap, not a forum). Coarse by design; the design log records the trade-off.
const MAX_WORK_ITEM_COMMENTS = 100
// D29 — max notification RECIPIENTS one comment's `@mentions` may fan out to (review
// F1: the cap is on resolved targets, not token matches — a display name borne by K
// workspaces still can't ring K bells, so a comment can't become an amplifier).
const MENTION_CAP = 10
// The longest mentionable display name comes from the CONTRACT: the composer's
// picker bounds its query by the same fact, and a bound the two ends disagreed
// about would be a wall on one side and a lie on the other. It bounds the
// per-`@` candidate scan here, so parsing stays O(bodyLen) — independent of
// registry size AND its first-char distribution (review F2: a bucket index still
// scanned O(bucketSize) when names clustered on one first char).

// ── D24 — watching + the per-tenant notification inbox ──────────────────────
// Watch subscriptions: a SUBJECT key → the tenant ids watching it. Keyed by
// `kind:id` rather than a bare project id since the Commons grew a "Watched"
// lens (UI-19): the feed carries artifacts, sessions and threads too, and a
// watch that only projects could hold would have made that lens a half-feature.
// The project routes are the same store under `project:<id>`; persisted as
// [tenantId, key] pairs, and a pre-generalization snapshot's bare ids migrate
// on load.
const watches = new Map<string, Set<string>>()
/** The one place a subject becomes a watch key. */
function watchKey(ref: SocialEntityRef): string {
  return `${ref.kind}:${ref.id}`
}
const projectRef = (projectId: string): SocialEntityRef => ({ kind: 'project', id: projectId })

// ── The Commons lenses (S4) — the viewer's own relationships to a feed item ──
// Likes: a feed ITEM id (`share:<grantId>` / `landing:<proposalId>`, derived and
// stable) → the tenants who liked that act. Deliberately the same shape as a
// discussion post's reaction, and deliberately NOT a notification: a like rings
// nobody and moves no wall — it is the thinnest possible signal, kept so the
// "Liked" lens has an act that fills it.
const commonsLikes = new Map<string, Set<string>>()
// Recently viewed: tenantId → the subjects it opened, newest first, capped like
// the notification inbox. A pointer cache over things that remain readable where
// they live, never a second history.
const views = new Map<string, { key: string; kind: SocialEntityKind; id: string; at: number }[]>()
const MAX_VIEWS_PER_TENANT = 50
// The inbox: derived, capped, disposable rows (the acts themselves remain on their
// backlogs/profiles). Each row carries its RECIPIENT tenant — server-private; the
// tenant-scoped read serves only the caller's own rows, without the field.
const notifications: StoredNotification[] = []
let notificationSeq = 0

// ── D25 — change proposals against published definitions, keyed by agent id ──
const AGENT_PROPOSALS = new Map<string, StoredAgentProposal[]>()

// ── D28 — registered A2A peers (verified identity at the edge) ───────────────
const A2A_PEERS = new Map<string, StoredA2aPeer>()
let a2aPeerSeq = 0

/** Wire face of a peer: everything but the hash. */
function publicPeer(p: StoredA2aPeer): A2aPeer {
  const { tokenHash, ...pub } = p
  void tokenHash
  return pub
}
// Proposal bounds — a review queue, not a blob store (the D23 posture).
const MAX_OPEN_PROPOSALS = 20
const MAX_PROPOSAL_PROMPT_CHARS = 8000
const MAX_PROPOSAL_NOTE_CHARS = 2000
// Open-work backlog bounds — the SAME D23 posture. The backlog is the one
// cross-tenant-WRITABLE store (any tenant posts to any shared project, and the
// A2A edge accepts posts by default), and each post rewrites the whole
// snapshot, so an uncapped count/field is an unbounded-growth primitive against
// another tenant's project + the on-disk store. Cap the open count per project
// and every free-text field.
// Generous — the goal is only to prevent UNBOUNDED accumulation on a shared
// project (and its snapshot); the tighter anti-spam bound is the per-tenant
// notification inbox cap (200), which governs the fan-out a poster can inflict.
const MAX_OPEN_WORK_PER_PROJECT = 1000

/** The one redaction seam stored → wire: drop the proposer's raw tenant id and the
 *  act principals (FWD-5 Phase 1); serve display names + principal KINDs only. */
function publicProposal(p: StoredAgentProposal): AgentChangeProposal {
  const { proposedByTenant, proposedByPrincipal, verdictByTenant, comments, ...pub } = p
  void proposedByTenant
  void verdictByTenant
  return {
    ...pub,
    ...(proposedByPrincipal ? { proposedByKind: proposedByPrincipal.kind } : {}),
    ...(comments ? { comments: comments.map(publicWorkItemComment) } : {}),
  }
}

/** The review check (D27) — computed at read time for a prompt-changing proposal:
 *  the D10 static-tag face (which authored-for tag the replacement would discard,
 *  which provider family it runs on). Advisory, never gating; a scored probe of
 *  untagged bespoke text would be fabricated, so v1 reports what is knowable. */
function proposalCheck(p: StoredAgentProposal, agent: Agent): ProposalCheck | undefined {
  if (p.fields.systemPrompt === undefined) return undefined
  const providerFamily = resolveProvider(agent.providerId).modelFamily ?? 'claude'
  const replaced = agent.systemPromptId ? SYSTEM_PROMPT_LIB.get(agent.systemPromptId) : undefined
  return {
    providerFamily,
    ...(replaced ? { replacesFamily: replaced.targetFamily } : {}),
    note: replaced
      ? `Replaces a prompt authored for ${replaced.targetFamily} with untagged text; it will run on the ${providerFamily} family — run the fit probe after merging (D10).`
      : `Replaces the current prompt with untagged text; it will run on the ${providerFamily} family — run the fit probe after merging (D10).`,
  }
}

/** A proposal as SERVED: the redacted row plus its computed check. */
function serveProposal(p: StoredAgentProposal, agent: Agent): AgentChangeProposal {
  const check = proposalCheck(p, agent)
  return { ...publicProposal(p), ...(check ? { check } : {}) }
}

/** Fan one public act out to its interested tenants (D24), always MINUS the actor
 *  (you don't need a bell for what you just did). Synchronous and unbatched — the
 *  seam where a real digest/queue would go. No persist() here: every call site
 *  persists after its own mutation. */
function notifyTenants(
  recipients: Iterable<string>,
  actorTenant: string,
  row: Omit<StoredNotification, 'id' | 'read' | 'at' | 'tenantId'>,
): void {
  const unique = new Set(recipients)
  unique.delete(actorTenant)
  for (const tenantId of unique) {
    appendNotification(tenantId, { ...row, actorTenant })
  }
}

/** One notification write funnel. Social acts pass an `actorTenant` so their
 *  display name can be refreshed; system-originated operational alerts (routine
 *  failures) intentionally carry only their Agent display face. */
function appendNotification(
  tenantId: string,
  row: Omit<StoredNotification, 'id' | 'read' | 'at' | 'tenantId'>,
): void {
  notifications.push({ ...row, id: `ntf-${(notificationSeq += 1)}`, tenantId, at: Date.now(), read: false })
  const mine = notifications.filter((x) => x.tenantId === tenantId)
  if (mine.length > NOTIFICATION_CAP) {
    const drop = new Set(mine.slice(0, mine.length - NOTIFICATION_CAP).map((x) => x.id))
    for (let i = notifications.length - 1; i >= 0; i -= 1) {
      if (drop.has(notifications[i].id)) notifications.splice(i, 1)
    }
  }
  emit({ type: 'notification.changed', tenantId })
}

/** Drop every inbox row matching `doomed`, and tell each affected recipient's
 *  stream. The inverse of `notifyTenants`: bells are minted when an act happens
 *  and must die when it un-happens, or the inbox outlives its own subject matter
 *  (the "un-sharing silences the stale audience" rule, applied to retraction). */
function retractNotifications(doomed: (n: StoredNotification) => boolean): void {
  const touched = new Set<string>()
  for (let i = notifications.length - 1; i >= 0; i -= 1) {
    if (!doomed(notifications[i])) continue
    touched.add(notifications[i].tenantId)
    notifications.splice(i, 1)
  }
  for (const tenantId of touched) emit({ type: 'notification.changed', tenantId })
}

/** A work item's interested tenants: the Project's watchers, its owner, and the
 *  item's poster (participants are implicit watchers of their thread) — RE-CHECKED
 *  against the Project's visibility AT MINT TIME (review finding: watches and the
 *  poster anchor outlive an un-share, and a notification must never tell a tenant
 *  something the walls wouldn't show it if it went looking — so on a now-private
 *  Project the audience collapses to the owner alone). */
function workItemAudience(item: StoredOpenSubGoal): Set<string> {
  const project = findProject(item.projectId)
  const ownerTenant = project?.tenantId ?? defaultTenantId()
  if (project?.shared !== true) return new Set([ownerTenant])
  const out = new Set<string>(watches.get(watchKey(projectRef(item.projectId))) ?? [])
  out.add(ownerTenant)
  if (item.postedByTenant) out.add(item.postedByTenant)
  return out
}

/** The namespaces a comment names with `@<display name>` (D29), resolved SERVER-SIDE
 *  against the account registry (the client never receives an enumerable name list —
 *  a mention can't become an identity oracle). Match rules: the `@` must follow a
 *  non-word char (so an email local part like `ada@acme` is NOT a mention); the name
 *  that follows is the LONGEST registered display name whose end lands on a word
 *  boundary (so `@Ada Lovelace` binds the two-word name, and `@Ada` won't match
 *  inside `@Adam`). "Word char" is Unicode-aware (`\p{L}\p{N}_`), matching the client
 *  highlighter and excluding `x_@Name` / `@Name_x` (review F3). A display name is not
 *  unique (neither `createUser` nor `createOrg` guards it), so a match resolves to the
 *  tenants bearing it — the display name IS the public identity the whole system
 *  trusts; case-folded, like a handle. The result set is HARD-capped at MENTION_CAP
 *  *recipients* — NOT token matches — so a name borne by K namespaces can't fan one comment out to K
 *  bells (review F1): a self-serviceable notification amplifier. Resolution is a
 *  length-descending HASH lookup (the longest candidate substring that is a registered
 *  name and ends on a boundary wins), so the work per `@` is O(MENTION_MAX_NAME_LEN²) —
 *  bounded, independent of registry size AND its first-char distribution (review F2:
 *  a first-char bucket still scanned O(bucketSize) when names clustered on one char).
 *  Never widens visibility — the caller decides whether to honour the result (only a
 *  shared Project does; see commentOnOpenSubGoal). */
function resolveMentions(body: string): Set<string> {
  const byName = new Map<string, string[]>() // lower(name) → tenant ids bearing it
  let maxLen = 0 // longest registered (mentionable) name — bounds the per-`@` scan
  for (const [tid, t] of accounts.tenants) {
    const name = t.name
    if (name.length === 0 || name.length > MENTION_MAX_NAME_LEN) continue
    const key = name.toLowerCase()
    const arr = byName.get(key)
    if (arr) {
      arr.push(tid) // a duplicate display name — one key, several bearers
      continue
    }
    byName.set(key, [tid])
    if (name.length > maxLen) maxLen = name.length
  }
  const isWord = (ch: string | undefined) => ch !== undefined && /[\p{L}\p{N}_]/u.test(ch)
  const hits = new Set<string>()
  for (let i = 0; i < body.length && hits.size < MENTION_CAP; i += 1) {
    if (body[i] !== '@' || isWord(body[i - 1])) continue
    // Longest-match by length-descending hash lookup: the longest candidate that is a
    // registered name AND ends on a word boundary wins. O(maxLen²) per `@`, never O(registry).
    const upper = Math.min(maxLen, body.length - (i + 1))
    for (let len = upper; len >= 1; len -= 1) {
      const end = i + 1 + len
      if (isWord(body[end])) continue // the name must end at a boundary
      const ids = byName.get(body.slice(i + 1, end).toLowerCase())
      if (!ids) continue
      for (const tid of ids) {
        hits.add(tid)
        if (hits.size >= MENTION_CAP) break // the resolved-target hard cap (F1)
      }
      i = end - 1 // skip past the matched name
      break
    }
  }
  return hits
}
// Monotonic counters for server-minted session + message ids. The conversation is
// now server-owned (a sent turn persists; a draft materializes into a real session
// on first send), so the backend mints these — the client no longer fabricates them.
let sessionSeq = 0
let messageSeq = 0

// The plan-usage meter (5-hour / weekly windows). Accumulates the model's real
// token usage from every turn (store.recordUsage); the context-window figure is
// computed per session in store.usage. Period anchors and consumption persist;
// a restart cannot re-seed spend or move the reset boundary.
//
// Usage is metered PER TENANT (F2/PD9): the default tenant owns the seeded demo meter
// (so the gauge on the single-tenant mock reads exactly as before, and its
// constant ceilings remain the mint-time cascade root); every other tenant gets its own
// *fresh* meter on recorded spend, so one tenant's spend can't deplete another's window or
// leak into another's gauge. `meterFor(t)` resolves the right meter for a caller.
const usageRegistry = new UsageRegistry(() => Date.now(), defaultTenantId)
const meterFor = (tenantId?: string) => usageRegistry.readForTenant(tenantId)

// Generation-outcome counters (F6 PD31 observability): how each turn resolved — `ok` (the
// model answered), `fallback` (endpoint unreachable/slow → the degraded local reply),
// `aborted` (the turn was EXPLICITLY cancelled via the cancel route — a viewer disconnect
// merely detaches the view and the turn completes; server/turns.ts), `error` (fatal error).
// A global ops counter (model-endpoint health, not per-tenant billing), exposed at /metrics;
// transient like the request counters (reset each boot), so not persisted.
export type GenerationOutcome = 'ok' | 'fallback' | 'aborted' | 'error'
const generationCounts = new Map<GenerationOutcome, number>()

// The seeded worker Agents (docs/agent-commons.md, D6) — one for now, the
// degenerate N=1 case. Every Conversation resolves to it until users create more.
const WORKER_AGENTS = new Map<string, Agent>([[DEFAULT_AGENT.id, DEFAULT_AGENT]])
const agentOwnershipRegistry = new AgentOwnershipRegistry()
const proxyRequestRegistry = new ProxyRequestRegistry()
const proxyRequestHost = new ProxyRequestHost({
  registry: proxyRequestRegistry,
  agent: id => WORKER_AGENTS.get(id),
  ownership: id => agentOwnershipRegistry.get(id),
  active: actor => !!accounts.identityFor(actor.userId, actor.tenantId),
  visible: (agent, tenantId) => agent.published === true || registryVisible(agent, tenantId),
  commit: operation => commitMutationBatch(operation),
  changed: requestId => { emit({ type: 'agent-request.changed', requestId }); persist() },
  now: () => Date.now(),
})
const proxyRequestExecution: ProxyRequestExecution = new ProxyRequestExecution({
  registry: proxyRequestRegistry,
  ready: () => persistenceFault === null && !draining,
  otherWorkers: () => proxyArgumentExecution.activeActors(),
  permitted: (row, approval) => proxyRequestHost.executable(row) && proxyRequestTools(row.intent.owner.agentId,
    row.intent.owner).some(tool => tool.connectionId === approval.call.connectionId &&
      tool.connectionRevision === approval.call.connectionRevision && tool.tool.name === approval.call.toolName &&
      tool.schemaHash === approval.call.schemaHash && tool.transport === approval.transport),
  execute: (row, allowed, signal) => executeBoundMcpCall(store, row.intent.owner.tenantId,
    row.execution!.approval.call, allowed, row.intent.owner.userId, signal),
  commit: operation => commitMutationBatch(operation),
  changed: requestId => { emit({ type: 'agent-request.changed', requestId }); persist() },
  now: () => Date.now(),
  onError: error => { console.error('[Agent request] receipt settlement failed', error) },
})
const proxyArgumentExecution: ProxyArgumentExecution = new ProxyArgumentExecution({
  registry: proxyRequestRegistry,
  usage: usageRegistry,
  ready: () => persistenceFault === null && !draining,
  source: proxyArgumentSource,
  otherWorkers: () => proxyRequestExecution.activeActors(),
  generate: generateAgentRequestArguments,
  commit: operation => commitMutationBatch(operation),
  changed: requestId => { emit({ type: 'agent-request.changed', requestId }); persist() },
  now: () => Date.now(),
  onError: () => { console.error('[Agent request] argument-draft settlement failed; read saved status after recovery') },
})
function proxyRequestDraftModel(row: StoredProxyRequest): AgentRequestDraftModel | undefined {
  if (!proxyRequestHost.executable(row) || row.executionBlockedByRestore) return undefined
  const agent = WORKER_AGENTS.get(row.intent.owner.agentId)
  const provider = agent?.providerId && store.listProviders(row.intent.owner.tenantId).find(item => item.id === agent.providerId)
  if (!agent || !provider || provider.kind === 'session') return undefined
  const config = PROVIDER_CONFIGS.get(provider.id) ?? {}
  // No ambient development fallback: selecting an inspected call does not
  // quietly opt into a different model endpoint or fabricate model advice.
  if (endpointExecution(config) !== 'configured') return undefined
  return { agentRevision: agent.revision ?? 0, providerId: provider.id, providerLabel: provider.label,
    providerRevision: provider.definitionRevision ?? 0, providerConnectionRevision: provider.connectionRevision ?? 0,
    model: resolvedModelId(config) }
}
function proxyArgumentSource(row: StoredProxyRequest, binding: AgentRequestArgumentDraftBinding): ProxyArgumentSource | undefined {
  const model = proxyRequestDraftModel(row)
  if (!model || model.agentRevision !== binding.agentRevision || model.providerId !== binding.providerId ||
      model.providerRevision !== binding.providerRevision || model.providerConnectionRevision !== binding.providerConnectionRevision || model.model !== binding.model) return undefined
  const selected = proxyRequestTools(row.intent.owner.agentId, row.intent.owner).find(tool =>
    tool.connectionId === binding.connectionId && tool.connectionRevision === binding.connectionRevision &&
    tool.tool.name === binding.toolName && tool.schemaHash === binding.schemaHash && tool.transport === binding.transport)
  if (!selected) return undefined
  const agent = WORKER_AGENTS.get(row.intent.owner.agentId)!
  const provider = store.listProviders(row.intent.owner.tenantId).find(item => item.id === binding.providerId)!
  try {
    return { prepared: prepareAgentRequestArguments({ task: row.intent.task, agent, tool: selected.tool }),
      config: structuredClone({ ...PROVIDER_CONFIGS.get(provider.id), model: binding.model }),
      budgets: [agent.budget, provider.plan], tool: structuredClone(selected.tool) }
  } catch { return undefined }
}
function proxyRequestTools(agentId: string, actor: ProxyActor): AgentRequestReview['tools'] {
  const agent = WORKER_AGENTS.get(agentId), owner = agentOwnershipRegistry.get(agentId)
  if (!agent || !owner || owner.retired || owner.ownerUserId !== actor.userId || owner.tenantId !== actor.tenantId ||
      agent.tenantId !== actor.tenantId || !accounts.identityFor(actor.userId, actor.tenantId)) return []
  // Imported definitions remain unbound until their owner selects a provider;
  // absence must never borrow the cascade root's connection authority.
  const provider = agent.providerId && store.listProviders(actor.tenantId).find(row => row.id === agent.providerId)
  if (!provider) return []
  // This is an explicit human-selected call, not model reasoning or a shared
  // Project effect. Connector reach is by opaque connection id (Authority).
  const ceilings = [provider.authority ?? {}, agent.authority ?? {}]
  return store.mcpConnections(actor.tenantId, actor.userId)
    .filter(connection => connection.status === 'connected' && connection.execution === 'approval-required' &&
      (connection.transport !== 'stdio' || mcpRuntimeCapabilities().localProcesses === true) &&
      ceilings.every(authority => authorityAdmits(authority, 'connectors', connection.id)))
    .flatMap(connection => connection.tools.filter(tool => connection.executableTools?.includes(tool.name)).map(tool => ({
      connectionId: connection.id, connectionRevision: connection.revision, connectionLabel: connection.label,
      transport: connection.transport === 'stdio' ? 'stdio' as const : 'http' as const,
      schemaHash: mcpToolSchemaHash(tool), tool,
    })))
}
/** Keyed Agent identities remain retired after explicit deletion. Otherwise a
 * delayed New-Agent, Fork-agent, or Agent-import Retry could recreate a
 * definition the person deliberately removed on another device. */
let retiredAgentCreationIds = new Set<string>()
const resolveAgent = (id?: string): Agent => WORKER_AGENTS.get(id ?? '') ?? DEFAULT_AGENT
let workerAgentSeq = 0

/** Resolve a Project by id across both homes — the seeded set (`PROJECTS`) and the ones
 *  created at runtime (`graph.extraProjects`). The single lookup behind the D13 cap so it
 *  works regardless of where a Project came from. */
const findProject = (id: string): Project | undefined =>
  baseProjects().find((p) => p.id === id) ?? graph.extraProjects.find((p) => p.id === id)

/** The tenant a project belongs to (F2/PD9) — a seed/legacy or unknown project has no
 *  `tenantId`, so it belongs to the backend's default tenant. */
const projectTenant = (projectId: string): string => findProject(projectId)?.tenantId ?? defaultTenantId()

/** A tenant's public display name (D17 — the directory's `owner` face and an open-work
 *  item's `postedBy`). Resolves through the account registry; an unregistered id (a
 *  test-minted tenant) falls back to the raw id, which is what such a test asserts on. */
const tenantName = (tenantId: string): string => accounts.tenants.get(tenantId)?.name ?? tenantId

/** The inverse of `tenantName` — a display name back to the tenant that wears
 *  it (S7: a follow and a DM both address a person BY NAME, and the fan-out
 *  needs a stream to ring). Names are not guaranteed unique across an org and a
 *  namespace, so this resolves against NAMESPACES first — the acting identity a
 *  person signs in as, which is what a follow or a message is addressed to —
 *  and falls back to any tenant of that name. Undefined for a name nobody
 *  wears; every caller already treats that as the 404. */
const tenantIdForName = (name: string): string | undefined => {
  const all = [...accounts.tenants.values()].filter((t) => t.name === name)
  return (all.find((t) => accounts.isNamespace(t.id)) ?? all[0])?.id
}

/** Resolve an artifact across both homes — seeded (`ALL_ARTIFACTS`) + created
 *  (`graph.extraArtifacts`) — mirroring `findProject`. */
const retainedArtifact = (id: string): ArtifactItem | undefined => {
  const artifact = baseArtifacts().find((a) => a.id === id) ?? graph.extraArtifacts.find((a) => a.id === id)
  return artifact ? artifactWithMetadata(artifact) : undefined
}
const findArtifact = (id: string): ArtifactItem | undefined =>
  artifactIsTrashed(id) ? undefined : retainedArtifact(id)

/** A retained artifact suspends its entire anchored social tree, even where
 * a nested discussion has its own opener/grants. Iterate rather than recurse;
 * malformed cycles confer no visibility or authority. */
function socialSubjectSuspended(ref: SocialEntityRef): boolean {
  const visited = new Set<string>()
  let current: SocialEntityRef | undefined = ref
  while (current) {
    const key = `${current.kind}:${current.id}`
    if (visited.has(key)) return true
    visited.add(key)
    if (current.kind === 'artifact') return artifactIsTrashed(current.id)
    if (current.kind === 'discussion') {
      const id: string = current.id
      current = discussions.find((row) => row.id === id)?.anchor.ref
    } else if (current.kind === 'proposal') {
      const id: string = current.id
      current = socialProposals.find((row) => row.id === id)?.subject
    } else return false
  }
  return false
}

/** The same bounded ancestry walk, with the root artifact identified for a
 * lifecycle audience snapshot. Cycles fail closed. */
function socialSubjectHasArtifactAncestor(ref: SocialEntityRef, artifactId: string): boolean {
  const visited = new Set<string>()
  let current: SocialEntityRef | undefined = ref
  while (current) {
    const key = `${current.kind}:${current.id}`
    if (visited.has(key)) return false
    visited.add(key)
    if (current.kind === 'artifact') return current.id === artifactId
    if (current.kind === 'discussion') {
      const id: string = current.id
      current = discussions.find((row) => row.id === id)?.anchor.ref
    } else if (current.kind === 'proposal') {
      const id: string = current.id
      current = socialProposals.find((row) => row.id === id)?.subject
    } else return false
  }
  return false
}

function artifactDeletionCascade(artifactId: string) {
  const discussionsInCascade = discussions.filter((row) => socialSubjectHasArtifactAncestor(row.anchor.ref, artifactId))
  const discussionIds = new Set(discussionsInCascade.map((row) => row.id))
  const proposalsInCascade = socialProposals.filter((row) => socialSubjectHasArtifactAncestor(row.subject, artifactId))
  const proposalIds = new Set(proposalsInCascade.map((row) => row.id))
  const refs = new Set([
    `artifact:${artifactId}`,
    ...[...discussionIds].map((id) => `discussion:${id}`),
    ...[...proposalIds].map((id) => `proposal:${id}`),
  ])
  const shares = grants.filter((grant) => refs.has(`${grant.subject.kind}:${grant.subject.id}`))
  return { discussions: discussionsInCascade, proposals: proposalsInCascade, shares }
}

function artifactDeletionFingerprint(artifact: ArtifactItem, tenantId: string): string {
  const cascade = artifactDeletionCascade(artifact.id)
  const currentLifecycle = artifactLifecycle.get(artifact.id) ?? { state: 'active', revision: 0, changedAt: 0 }
  const bodyHistory = artifactHistory.get(artifact.id) ?? []
  const stable = <T extends { id: string }>(rows: T[]): T[] => [...rows].sort((a, b) => a.id.localeCompare(b.id))
  const payload = {
    artifact: { ...artifact, projectId: graph.artifactProject[artifact.id] ?? artifact.projectId },
    lifecycle: currentLifecycle,
    body: artifactBodies.get(artifact.id) ?? null,
    history: bodyHistory,
    metadata: artifactMetadata.get(artifact.id) ?? null,
    artifactProject: graph.artifactProject[artifact.id] ?? null,
    artifactSource: graph.artifactSource[artifact.id] ?? null,
    discussions: stable(cascade.discussions),
    proposals: stable(cascade.proposals),
    shares: stable(cascade.shares),
    tenantId,
  }
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex')
}

/** Agent-Commons registry visibility (F2/PD9). Unlike CONTENT (sessions/projects/artifacts,
 *  where a seed row belongs to the default tenant and is private to it), a registry entry is
 *  INFRASTRUCTURE: a seeded/shared one (no `tenantId` — e.g. the default agent/provider/prompt
 *  every tenant needs) is visible to ALL tenants, while a *created* one is private to its
 *  tenant. No tenant arg ⇒ everything (internal callers / tests). */
const registryVisible = <T extends { tenantId?: string }>(entry: T, tenantId?: string): boolean =>
  tenantId === undefined || entry.tenantId === undefined || entry.tenantId === tenantId

/** P8 role self-assign clamp (B8): a Commission owned by a tenant that is NOT the Project's
 *  owner may not hold a role above 'writer' — only the Project owner grants maintainer/owner.
 *  Both the mint (`createCommission`) and the re-grant (`updateCommission`) run through THIS one
 *  clamp, so a cross-tenant Contributor can't self-elevate via either path (join clamped, then
 *  PATCH-to-owner would be the bypass). reader/writer pass through; owner/maintainer clamp to
 *  writer. `owningTenant` undefined (internal/seed mint) ⇒ no clamp. An owner-driven cross-tenant
 *  elevation path is a Phase 2 item (docs/design/test-plan-coop-lifecycle.md). */
const clampContributorRole = (role: ProjectRole, owningTenant: string | undefined, projectId: string): ProjectRole => {
  // Normalize an unknown/invalid role to the safe baseline first (defense in depth: POST
  // /commissions 400s an invalid role, but the op path casts the JSON body unchecked, so a
  // hand-crafted commission-agent op could carry e.g. 'superadmin' — which must never be stored,
  // else roleRank(invalid) = PROJECT_ROLES.length outranks 'owner' and rolePermits throws on the
  // absent ROLE_ACTIONS key. P8 review finding). Then apply the cross-tenant self-assign clamp.
  const safe: ProjectRole = PROJECT_ROLES.includes(role) ? role : 'writer'
  const projectOwner = findProject(projectId)?.tenantId ?? defaultTenantId()
  if (owningTenant !== undefined && owningTenant !== projectOwner && roleRank(safe) > roleRank('writer')) return 'writer'
  return safe
}

/** The tenant an artifact belongs to (F2/PD9) — seed/legacy or unknown ⇒ the default
 *  tenant (parallels `projectTenant`; independent of the artifact's project). */
const artifactTenant = (artifactId: string): string => findArtifact(artifactId)?.tenantId ?? defaultTenantId()

/** The public face of a SHARED Project shown to a NON-owner (P8): identity + description
 *  only. The owner-scoped membership fields are emptied so the frozen Project object can't
 *  leak the owner's session ids / attached contexts / instructions across the tenant boundary
 *  (the graph's join maps are already owner-scoped; this closes the object-field channel). */
const publicSharedProject = (p: Project): Project => ({
  ...p,
  sessionIds: [],
  contexts: [],
  scheduled: [],
  instructions: '',
})

const projectDescription = (p: Project, g: RelationGraph): string =>
  g.projectDescriptions[p.id] ?? p.description

/** One read face for both the canonical registry and graph acknowledgements.
 * Public prose is current, but a grant never widens private membership or
 * instructions. Org members read the full face without acquiring owner acts. */
function projectForTenant(p: Project, g: RelationGraph, tenantId: string): Project | undefined {
  const current = { ...p, description: projectDescription(p, g) }
  const ownerName = tenantName(publicProjectOwnerTenant(p, tenantId))
  if (rowVisibleTo(p, tenantId)) {
    return {
      ...current,
      instructions: g.projectInstructions[p.id] ?? p.instructions,
      ownerName,
      own: ownsGrantSubject(p, tenantId),
    }
  }
  if (p.shared !== true && grantedTierFor({ kind: 'project', id: p.id }, tenantId) === undefined) return undefined
  return { ...publicSharedProject(current), ownerName, own: false, tenantId: undefined }
}

/** The public face of a Commission on a SHARED Project shown to a NON-owner (P8): the
 *  Contributor IDENTITY (agent / project / role) only. The D12 posture — `authority`, token
 *  `grant`, `reservationId` — is stripped, mirroring what `GET /commissions/:id/authority`
 *  deliberately refuses to leak: the public Contributor list is who-contributes, not the
 *  private reach/budget of another tenant's agent. */
const publicCommission = (c: Commission): Commission => ({
  id: c.id,
  tenantId: c.tenantId,
  agentId: c.agentId,
  // Resolved at READ time (never stored, so it can't go stale on an agent rename): the
  // Contributor's display label — WHO contributes is exactly what the public face is for.
  agentLabel: WORKER_AGENTS.get(c.agentId)?.label,
  projectId: c.projectId,
  role: c.role,
})

/** Project the relation graph to a tenant's view (F2/PD9): a tenant sees only its own
 *  projects/artifacts — seed rows themed per demo account (docs/demo-accounts.md) plus
 *  its created ones — and the join rows that reference an entity it can see. Unstamped
 *  seeds follow the flagship rule (`rowVisibleTo`). Routine joins follow their
 *  own read wall too; an id/name map is private data even without its row. */
function projectGraphForTenant(g: RelationGraph, tenantId: string): RelationGraph {
  const projVisible = (pid: string): boolean => {
    const p = findProject(pid)
    return p ? rowVisibleTo(p, tenantId) : seedVisibleTo(tenantId)
  }
  const artVisible = (aid: string): boolean => {
    if (artifactIsTrashed(aid)) return false
    const a = findArtifact(aid)
    return a ? rowVisibleTo(a, tenantId) : seedVisibleTo(tenantId)
  }
  /** Keep the rows whose PROJECT VALUE the caller can see — but `null` is not a
   *  project id, it is the explicit "unfiled" override (contract/api.ts), so
   *  there is nothing to gate and it must survive. It didn't: `projVisible(null)`
   *  found no project and fell through to `seedVisibleTo`, which is true only for
   *  the default/flagship tenant — so every OTHER tenant's explicit unfile was
   *  stripped from the graph they receive. Latent rather than reported (a
   *  non-flagship tenant's sessions carry no seed project for the override to
   *  contradict), and surfaced by typechecking `server/`: the parameter said
   *  `Record<string, string>` while the contract says `string | null`. */
  const byProjValue = (m: Record<string, string | null>): Record<string, string | null> =>
    Object.fromEntries(Object.entries(m).filter(([, pid]) => pid === null || projVisible(pid)))
  const byProjKey = <V>(m: Record<string, V>): Record<string, V> =>
    Object.fromEntries(Object.entries(m).filter(([pid]) => projVisible(pid)))
  const byArtKey = <V>(m: Record<string, V>): Record<string, V> =>
    Object.fromEntries(Object.entries(m).filter(([aid]) => artVisible(aid)))
  const byScheduleKey = <V>(m: Record<string, V>): Record<string, V> =>
    Object.fromEntries(Object.entries(m).filter(([id]) => {
      const task = schedules.find((candidate) => candidate.id === id)
      return task !== undefined && (rowVisibleTo(task, tenantId) ||
        grantedTierFor({ kind: 'schedule', id }, tenantId) !== undefined)
    }))
  const standingApprovalOwned = (key: string): boolean => {
    // Historical keys retain old artifact names, so current graph values are
    // not sufficient. Match a registered stable id; ambiguous legacy ids fail
    // closed rather than guessing whose approval a prefix belongs to.
    const matches = schedules.filter((task) => scheduleApprovalKeyMatches(key, task.id))
    return matches.length === 1 && rowVisibleTo(matches[0]!, tenantId)
  }
  return {
    ...g,
    // A SHARED Project (P8) is visible to every tenant so a non-owner can see it exists and
    // commission onto it — but to a NON-owner it's REDACTED to public metadata: the join maps
    // below are already owner-scoped (projVisible), and the Project object's own membership
    // fields (`sessionIds`/`contexts`/`scheduled`/`instructions`) are stripped here too, else
    // the frozen object leaks the owner's session ids + count across the tenant boundary. The
    // owner keeps the full object.
    extraProjects: g.extraProjects.flatMap((p) => {
      const projected = projectForTenant(p, g, tenantId)
      return projected ? [projected] : []
    }),
    extraArtifacts: g.extraArtifacts.filter((a) => !artifactIsTrashed(a.id) && rowVisibleTo(a, tenantId)).map(artifactWithMetadata),
    sessionProject: byProjValue(g.sessionProject),
    // An artifact→project row needs the artifact visible; the value is gated on project
    // visibility ONLY when it's a real project id — `''` is the reducer's "unfiled"
    // sentinel (refile → projectId:null), not a project, so it must survive for the owner
    // (else the client resolves `artifactProject[id] ?? art.projectId` back to the original
    // project and the unfile silently snaps back in a non-default tenant's own view).
    artifactProject: Object.fromEntries(Object.entries(g.artifactProject).filter(([aid, pid]) => artVisible(aid) && (pid === '' || projVisible(pid)))),
    scheduleProject: byScheduleKey(byProjValue(g.scheduleProject)),
    scheduleArtifact: byScheduleKey(g.scheduleArtifact),
    scheduleSession: byScheduleKey(g.scheduleSession),
    scheduleExtraTools: byScheduleKey(g.scheduleExtraTools),
    standingApprovals: Object.fromEntries(Object.entries(g.standingApprovals).filter(([key]) => standingApprovalOwned(key))),
    projectContexts: byProjKey(g.projectContexts),
    projectInstructions: byProjKey(g.projectInstructions),
    // The description is the PUBLIC "about" (D26): unlike instructions (owner-scoped),
    // its row survives for any viewer of a SHARED project — the same visibility
    // the project object itself has in this projection. This map is an OVERRIDE
    // of the project record's own description, exactly as projectInstructions
    // overrides its instructions; the reader resolves map ?? record.
    projectDescriptions: Object.fromEntries(
      Object.entries(g.projectDescriptions).filter(([pid]) => {
        if (projVisible(pid)) return true
        const p = findProject(pid)
        return p !== undefined && (p.shared === true || grantedTierFor({ kind: 'project', id: pid }, tenantId) !== undefined)
      }),
    ),
    artifactSource: byArtKey(g.artifactSource),
  }
}

// The registered Model providers (docs/agent-commons.md, D9) — the cognition source
// each Agent binds. One seeded for now (the degenerate N=1 case), wrapping the single
// implicit Anthropic client. The contract `ModelProvider` is paired with its
// server-only `ProviderConfig` (credentials / concrete model id) by id — the config
// never leaves the server, mirroring how `Capabilities` hides the key.
const MODEL_PROVIDERS = new Map<string, ModelProvider>(SEED_PROVIDERS.map((p) => [p.id, p]))
const PROVIDER_CONFIGS = new Map<string, ProviderConfig>(SEED_PROVIDER_CONFIGS)
const resolveProvider = (id?: string): ModelProvider => MODEL_PROVIDERS.get(id ?? '') ?? DEFAULT_PROVIDER

function validateProviderProtocolConfig(config: ProviderConfig): void {
  if (config.protocol !== undefined && !isEndpointProtocol(config.protocol)) {
    throw new ProviderProbeError(`A provider protocol must be 'anthropic-messages' or 'openai-responses'.`)
  }
  if (config.protocol === 'openai-responses' && (!config.baseURL?.trim() || !config.model?.trim())) {
    throw new ProviderProbeError(`The OpenAI Responses protocol requires an explicit baseURL and model.`)
  }
}
let providerSeq = 0

interface ScheduleBindingChoice {
  agent: Agent
  provider: ModelProvider
  modelId?: string
  effort?: string
  label: string
}

function scheduleModelLabel(provider: ModelProvider, modelId?: string, effort?: string): string {
  const model = provider.models?.find((candidate) => candidate.id === (modelId ?? provider.defaultModelId))
  const modelFace = model?.label ?? provider.label
  const base = provider.id === DEFAULT_PROVIDER.id || !model ? modelFace : `${provider.label} · ${modelFace}`
  return effort ? `${base} · ${effort}` : base
}

/** Resolve and validate the durable Agent/provider/model tuple for a routine.
 *  Labels are accepted only as a legacy edge and immediately canonicalized to
 *  ids; execution never routes by mutable display text. */
function scheduleBindingChoice(
  task: Pick<ScheduledTask, 'tenantId' | 'agentId' | 'providerId' | 'modelId' | 'effort' | 'model'>,
  patch: Pick<SchedulePatch, 'agentId' | 'providerId' | 'modelId' | 'effort' | 'model'> = {},
): ScheduleBindingChoice {
  const tenantId = task.tenantId ?? defaultTenantId()
  const agents = [...WORKER_AGENTS.values()].filter((agent) => registryVisible(agent, tenantId))
  const agentId = patch.agentId ?? task.agentId ?? DEFAULT_AGENT.id
  const agent = agents.find((candidate) => candidate.id === agentId)
  if (!agent) throw new ValidationError(`No Agent '${agentId}' is available to this routine.`)
  const providers = [...MODEL_PROVIDERS.values()].filter((provider) => registryVisible(provider, tenantId))

  let providerId = patch.providerId ?? task.providerId ?? agent.providerId ?? DEFAULT_PROVIDER.id
  let modelId = patch.modelId === null
    ? undefined
    : patch.modelId ?? (patch.providerId !== undefined ? undefined : task.modelId)
  let effort = patch.effort === null
    ? undefined
    : patch.effort ?? ((patch.providerId !== undefined || patch.modelId !== undefined) ? undefined : task.effort)

  // Legacy/direct callers may still send the old composed label. Resolve it at
  // the boundary, then persist ids; an unknown face is a 400, never decoration.
  if (patch.model !== undefined && patch.providerId === undefined && patch.modelId === undefined) {
    const legacyLabel = patch.model
    const nonDefault = providers.find((provider) =>
      provider.id !== DEFAULT_PROVIDER.id &&
      (legacyLabel === provider.label || legacyLabel.startsWith(`${provider.label} · `)))
    const provider = nonDefault ?? providers.find((candidate) => candidate.id === DEFAULT_PROVIDER.id)
    const model = provider?.models?.find((candidate) => legacyLabel.split('·').some((part) => part.trim() === candidate.label))
    if (!provider || (!model && legacyLabel !== provider.label)) {
      throw new ValidationError(`Unknown routine model '${legacyLabel}'. Choose a provider/model from the live registry.`)
    }
    providerId = provider.id
    modelId = model?.id
    const levels = model?.effortLevels ?? provider.effortLevels
    effort = levels.find((level) => legacyLabel.split('·').some((part) => part.trim() === level))
  }

  const provider = providers.find((candidate) => candidate.id === providerId)
  if (!provider) throw new ValidationError(`No endpoint provider '${providerId}' is available to this routine.`)
  if (provider.kind === 'session') {
    throw new ValidationError('Session providers cannot answer unattended routine runs; choose an endpoint provider.')
  }
  if (modelId) assertModelInCatalog(modelId, provider.id, agent.id)
  const model = provider.models?.find((candidate) => candidate.id === modelId)
  const levels = model?.effortLevels ?? provider.effortLevels
  if (effort !== undefined && levels.length > 0 && !levels.includes(effort)) {
    throw new ValidationError(`Provider '${provider.label}' does not offer effort '${effort}' for this model.`)
  }
  if (levels.length === 0) effort = undefined
  return { agent, provider, modelId, effort, label: scheduleModelLabel(provider, modelId, effort) }
}

// ── Provider model catalogs (the flexible per-provider model list) ───────────
// A provider may carry a `models` catalog (contract `ModelInfo[]` — every metadata
// field optional, absence = unknown), obtained from its endpoint's list API
// ('listed') or declared on the request ('static'). These helpers are the single
// validation/replacement funnel for both.

/** Refuse a malformed caller-declared catalog loudly (INV-9: an invalid value is
 *  refused, never silently normalized). `undefined` = no catalog, always valid. */
function assertCatalogModels(models: ModelInfo[] | undefined): void {
  if (models === undefined) return
  if (!Array.isArray(models) || models.length === 0) {
    throw new ValidationError('`models` must be a non-empty array of catalog entries.')
  }
  const seen = new Set<string>()
  for (const m of models) {
    if (!m || typeof m.id !== 'string' || !m.id || typeof m.label !== 'string' || !m.label) {
      throw new ValidationError('Every catalog model needs a non-empty string `id` and `label`.')
    }
    if (seen.has(m.id)) throw new ValidationError(`Duplicate catalog model id '${m.id}'.`)
    seen.add(m.id)
  }
}

/** The provider a session's turns effectively route through — the same INV-9
 *  inherit chain the messages route resolves (`session pick ?? agent's ?? default`).
 *  Shared by the model-pick wall, the catalog-refresh sweep, and the usage snapshot
 *  so "which provider is this session on" has exactly one answer. */
function effectiveProviderOf(session?: Session): ModelProvider {
  return resolveProvider(session?.providerId ?? resolveAgent(session?.agentId).providerId)
}

/** The session-modelId wall: a concrete model pick must name an entry in the
 *  effective provider's catalog — an unknown id (or a pick on a provider that
 *  enumerates nothing) is refused, never normalized. */
function assertModelInCatalog(modelId: string, providerId?: string, agentId?: string): void {
  const provider = resolveProvider(providerId ?? resolveAgent(agentId).providerId)
  if (provider.models?.some((m) => m.id === modelId)) return
  throw new ValidationError(
    provider.models?.length
      ? `Provider '${provider.label}' lists no model '${modelId}' — the pick must name a catalog entry.`
      : `Provider '${provider.label}' doesn't enumerate models — a concrete model can't be picked on it.`,
  )
}

/** THE model-pick invariant, enforced centrally: a stored `session.modelId`
 *  always names an entry in the catalog of the provider the session CURRENTLY
 *  resolves to. Re-validates every held pick against the live resolution and
 *  clears the ones whose namespace moved (each cleared row broadcast so open
 *  composers reconcile). Called by every mutation that can change a session's
 *  effective provider or its catalog — the direct paths (session provider patch,
 *  provider delete) clear inline where they already hold the row, and the
 *  indirect ones (catalog replacement, an Agent re-bind, an Agent hand-off, an
 *  Agent delete) run this sweep — so a validated-once pick can never dangle. */
function sweepSessionModelPicks(): void {
  for (const s of SESSIONS) {
    if (!s.modelId) continue
    const provider = effectiveProviderOf(s)
    if (provider.kind !== 'session' && provider.models?.some((m) => m.id === s.modelId)) continue
    delete s.modelId
    s.metadataRevision = (s.metadataRevision ?? 0) + 1
    emit({ type: 'session.updated', session: s })
  }
}

/** Replace a provider's model catalog (registration fetch, static declaration, or
 *  the refresh route) and stamp how it was obtained. Session model picks the new
 *  catalog no longer lists are cleared by the invariant sweep — the same
 *  documented cascade as a provider delete (the pick's namespace changed). */
function replaceProviderModels(
  id: string,
  models: ModelInfo[],
  source: 'listed' | 'static',
  expectedRevision?: number,
): ModelProvider | undefined {
  const current = MODEL_PROVIDERS.get(id)
  if (!current) return undefined
  const currentRevision = current.connectionRevision ?? 0
  if (expectedRevision !== undefined && expectedRevision !== currentRevision) {
    throw new ConflictError(
      `This provider connection changed elsewhere (expected revision ${expectedRevision}, current revision ${currentRevision}).`,
    )
  }
  assertCatalogModels(models)
  const next: ModelProvider = {
    ...current,
    models,
    catalogSource: source,
    connectionRevision: currentRevision + 1,
  }
  MODEL_PROVIDERS.set(id, next)
  sweepSessionModelPicks()
  emitProviderChanged(next)
  persist()
  return next
}

// The system-prompt library (docs/agent-commons.md, D10) — reusable, target-family-
// tagged prompts a user picks for an Agent. Seeded; the (prompt × provider) fit check
// is the pure `promptFitWarning` (contract), surfaced in the picker at selection.
const SYSTEM_PROMPT_LIB = new Map<string, SystemPromptEntry>(SYSTEM_PROMPTS.map((p) => [p.id, p]))
let systemPromptSeq = 0

// Per-tenant default flags for the two agent-binding registries (providers + system
// prompts) — a **UI pre-selection shortcut**, nothing more: the flagged entry is what
// a picker pre-selects; the API never resolves an absent binding to it (see
// `ValidationError`). A pointer, not a stored field, so at-most-one-per-tenant holds
// by construction and the flag is stamped viewer-relative at serve time (a private
// entry flagged by tenant A never reads as B's default). Zero defaults is a valid
// state — the UI then falls back to the first listed entry (`defaultEntry`). Unseeded
// on purpose: the seeded Anthropic provider / default prompt already sort first.
const REGISTRY_DEFAULTS = new Map<string, { providerId?: string; promptId?: string }>()
const defaultsFor = (tenantId?: string) => REGISTRY_DEFAULTS.get(tenantId ?? defaultTenantId())
function setRegistryDefault(field: 'providerId' | 'promptId', id: string | undefined, tenantId?: string): void {
  const key = tenantId ?? defaultTenantId()
  const next = { ...REGISTRY_DEFAULTS.get(key), [field]: id }
  if (next.providerId === undefined && next.promptId === undefined) REGISTRY_DEFAULTS.delete(key)
  else REGISTRY_DEFAULTS.set(key, next)
}
// Deletion hygiene: a removed entry must not linger as any tenant's default pointer.
function dropRegistryDefault(field: 'providerId' | 'promptId', id: string): void {
  for (const [key, value] of REGISTRY_DEFAULTS) {
    if (value[field] === id) setRegistryDefault(field, undefined, key)
  }
}

// Commissions (docs/agent-commons.md, D7/D13) — the agent→Project assignments, the
// leaf of the D8 cascade. Keyed by id; `listCommissions(projectId)` gives a Project's
// Contributors. Persisted to disk like the agent/provider registries (see persist.ts).
const COMMISSIONS = new Map<string, Commission>(SEED_COMMISSIONS.map((c) => [c.id, c]))
let commissionSeq = 0

// Resolve a sub-goal holder (D11) to a human label: a Contributor identity is a
// commission id → its Agent's label; a person-shaped sentinel uses the private
// owning tenant's public account name rather than leaking the sentinel itself.
function holderLabel(holder: string, ownerTenant?: string): string {
  const commission = COMMISSIONS.get(holder)
  if (!commission) return ownerTenant ? tenantName(ownerTenant) : holder
  return WORKER_AGENTS.get(commission.agentId)?.label ?? holder
}

// The holder's project role (D14), when the holder is a Contributor (a commission) — the
// standing surfaced on a sub-goal. An unset role reads as the 'writer' default; a
// non-commission principal has none (undefined).
function holderRole(holder: string): ProjectRole | undefined {
  const commission = COMMISSIONS.get(holder)
  return commission ? commission.role ?? 'writer' : undefined
}

// Runtime half of D8 (parent-shrink propagation): after a parent narrows, re-clamp the
// already-minted children so an over-grant can't outlive the shrink. Idempotent — a child
// already within its parent is untouched; a child that *inherits* (unset grant) follows the
// parent down on its own and needs no clamp.
const AUTHORITY_DIMENSIONS = ['tools', 'connectors', 'scopes'] as const
function equivalentAuthority(left: Authority | undefined, right: Authority | undefined): boolean {
  return AUTHORITY_DIMENSIONS.every((dimension) => {
    const leftGrant = left?.[dimension]
    const rightGrant = right?.[dimension]
    if (unrestricted(leftGrant) || unrestricted(rightGrant)) {
      return unrestricted(leftGrant) && unrestricted(rightGrant)
    }
    return leftGrant!.length === rightGrant!.length && leftGrant!.every((value) => rightGrant!.includes(value))
  })
}

function equivalentBudget(left: Budget | undefined, right: Budget | undefined): boolean {
  if (!left || !right) return left === right
  return left.windows.length === right.windows.length && left.windows.every((window) =>
    right.windows.some((candidate) => candidate.label === window.label && candidate.ceiling === window.ceiling),
  )
}

function reclampCommissionsOf(agent: Agent): void {
  const provider = resolveProvider(agent.providerId)
  const parentAuthority = agent.authority ?? provider.authority ?? {}
  const parentWindows = agent.budget?.windows ?? provider.plan?.windows ?? usageRegistry.planCeilings()
  for (const c of COMMISSIONS.values()) {
    if (c.agentId !== agent.id) continue
    const authority = c.authority ? clampAuthority(c.authority, parentAuthority) : c.authority
    const grant = c.grant ? clampBudget(c.grant, parentWindows) : c.grant
    if (equivalentAuthority(authority, c.authority) && equivalentBudget(grant, c.grant)) continue
    const next: Commission = {
      ...c,
      authority,
      grant,
      configurationRevision: (c.configurationRevision ?? 0) + 1,
    }
    COMMISSIONS.set(c.id, next)
    emit({ type: 'commission.changed', projectId: next.projectId })
  }
}
function reclampAgentsOf(provider: ModelProvider): void {
  const parentWindows = provider.plan?.windows ?? usageRegistry.planCeilings()
  for (const a of WORKER_AGENTS.values()) {
    if (a.providerId !== provider.id) continue
    const authority = a.authority ? clampAuthority(a.authority, provider.authority ?? {}) : a.authority
    const budget = a.budget ? clampBudget(a.budget, parentWindows) : a.budget
    if (JSON.stringify(authority) === JSON.stringify(a.authority) && JSON.stringify(budget) === JSON.stringify(a.budget)) {
      continue
    }
    const next: Agent = { ...a, authority, budget, revision: (a.revision ?? 0) + 1 }
    WORKER_AGENTS.set(a.id, next)
    reclampCommissionsOf(next) // transitively re-clamp this agent's Contributors
    emitAgentChanged(next)
  }
}

// Per-user recents — one non-evicting MRU id list per context type. Connectors /
// MCP seed from the connected accounts (their quick list shows every set-up
// element); files / photos / folder seed from the live cloud-storage scan
// (source-qualified ids — see fsRecentKey) so the quick list isn't empty out of the
// box; repo from the catalog defaults. Server-owned so it's per-user and syncs
// across devices (the audit flagged it as domain, not UI).
const CONTEXT_TYPES: ContextTypeId[] = ['files', 'photos', 'folder', 'repo', 'connector', 'mcp']
// Seed the fs types from the cloud catalog (the always-present source), newest first.
const seedFsRecents = (): { files: string[]; photos: string[]; folder: string[] } => {
  const cat = cloudReader.list()
  // Failed demo suggestion seeding must not prevent startup. Live catalog
  // reads below still preserve this unavailable result instead of returning [].
  if (!cat) return { files: [], photos: [], folder: [] }
  const key = (id: string) => fsRecentKey(CLOUD_SOURCE.id, id)
  return {
    files: cat.files.slice(0, 6).map((f) => key(f.id)),
    photos: cat.photos.slice(0, 7).map((p) => key(p.id)),
    folder: cat.folders.slice(0, 6).map((d) => key(d.id)),
  }
}
const seedContextRecents = (): RecentsSnapshot => {
  const fsSeed = seedFsRecents()
  const out = {} as RecentsSnapshot
  for (const t of CONTEXT_TYPES) {
    out[t] =
      t === 'connector'
        ? [...CONNECTED_CONNECTOR_IDS]
        : t === 'mcp'
          ? [...CONNECTED_MCP_IDS]
          : t === 'files' || t === 'photos' || t === 'folder'
            ? fsSeed[t]
            : [...DEFAULT_RECENT_IDS[t]]
  }
  return out
}

// Per-user set-up contexts (the Contexts page) — connectors / MCP servers / repos
// and their auth status, paired with their per-user Add-context recents. The
// extracted registry owns the tenant partition and returns public clones; this
// store remains responsible for durable acknowledgement and ambient events.
const contextRegistry = createContextRegistry({
  seedContexts: SAVED_CONTEXTS,
  seedRecents: seedContextRecents(),
  defaultTenantId,
})
const mcpConnectionRegistry = createMcpConnectionRegistry()
const routineMcpRegistry = new RoutineMcpRegistry()
const commissionMcpRegistry = new CommissionMcpRegistry()
const commissionMcpHost = new CommissionMcpHost({
  registry: commissionMcpRegistry, source: commissionMcpLiveSource, now: () => Date.now(),
  allowLocalPrograms: () => mcpRuntimeCapabilities().localProcesses === true,
  connection: (id, tenant, person) => store.mcpConnection(id, tenant, person),
  commit: operation => commitMutationBatch(operation),
  changed: (_commissionId, projectId) => { emit({ type: 'commission.changed', projectId }); persist() },
})
const commissionMcpExecution = new CommissionMcpExecution({
  registry: commissionMcpRegistry, usage: usageRegistry, source: commissionMcpLiveSource, now: () => Date.now(),
  allowLocalPrograms: () => mcpRuntimeCapabilities().localProcesses === true,
  ready: () => persistenceFault === null,
  connection: (id, tenant, person) => store.mcpConnection(id, tenant, person),
  commit: operation => commitMutationBatch(operation),
  changed: (_id, projectId) => { emit({ type: 'commission.changed', projectId }); persist() },
  work: (projectId, itemId) => {
    const item = openSubGoals.find(row => row.projectId === projectId && row.id === itemId && row.status === 'open' && row.type === 'mcp.mutate')
    return item ? { itemId: item.id, subGoal: item.subGoal, type: 'mcp.mutate', target: item.target, note: item.note } : undefined
  },
  capacity: scope => backgroundModelCapacity(scope.tenantId, scope.agentId),
  budgetAvailable: (source, id) => usageRegistry.reservationWithinLimits(id, source.scope.tenantId,
    [source.commission.grant, source.agent.budget, source.parentProvider?.plan, source.provider?.plan]),
  providerConfig: id => store.providerConfig(id), generate: generateCommissionMcpArguments,
  execute: (tenant, call, allowed, person, signal) => executeBoundMcpCall(store, tenant, call, allowed, person, signal),
  lease: (source, work) => {
    if (!source.project.guardianId) return { valid: () => true, release: () => {} }
    const resource = subGoalKey(source.project.guardianId, work.subGoal)
    const holder = commissionMcpClaimId(source.project.id, work.itemId)
    // 60s preparation + the shared executor's 30s bound. This unique work
    // holder cannot re-enter another invocation's reservation.
    const reservation = guardian.reserve(resource, holder, { ownerTenant: source.scope.tenantId, ttlMs: 120_000 })
    guardian.commit(reservation.id)
    return {
      valid: () => guardian.status(resource).active.some(row => row.id === reservation.id && row.holder === holder) &&
        guardian.ownedBy(reservation.id, source.scope.tenantId),
      release: () => {
        try { guardian.release(reservation.id) }
        catch (error) { if (!(error instanceof GuardianError) || error.code !== 'not_found') throw error }
      },
    }
  },
  complete: claim => {
    const item = openSubGoals.find(row => row.projectId === claim.permission.projectId && row.id === claim.work.itemId)!
    const owner = claim.permission.tenantId
    item.status = 'done'
    item.resolvedBy = claim.permission.commissionId
    item.resolvedByLabel = WORKER_AGENTS.get(claim.permission.agentId)!.label
    item.resolvedByOwner = tenantName(owner)
    item.resolvedAt = Date.now()
    store.recordContribution(claim.permission.commissionId)
    store.recordAudit({ channel: 'project-effect', commissionId: claim.permission.commissionId,
      capability: 'mcp.mutate', target: claim.work.target, outcome: 'fulfilled', tenantId: owner })
    notifyTenants(workItemAudience(item), owner, { kind: 'work.resolved', actor: tenantName(owner),
      projectId: item.projectId, projectName: findProject(item.projectId)?.name ?? '', subGoal: item.subGoal, workItemId: item.id })
    emit({ type: 'openwork.changed', projectId: item.projectId })
  },
})

/** Dispatch and commissioned jobs share the background-model envelope.
 * Conversations and Routines retain their separate admission paths. */
function backgroundModelCapacity(tenantId: string, agentId: string): boolean {
  const active = dispatch.filter(run => run.execution?.state === 'running')
    .map(run => ({ tenantId: run.tenantId ?? defaultTenantId(), agentId: run.execution!.agentId }))
  active.push(...commissionMcpRegistry.snapshot().claims.filter(commissionMcpClaimActive)
    .map(claim => ({ tenantId: claim.permission.tenantId, agentId: claim.permission.agentId })))
  return active.length < 4 && active.filter(run => run.tenantId === tenantId).length < 2 &&
    !active.some(run => run.tenantId === tenantId && run.agentId === agentId)
}
const mcpActivityAuthorities = new Map<string, McpActivityAuthority>()
const mcpInputFlows = new Map<string, McpInputFlow>()
const mcpActivityAuthorityKey = (sessionId: string, activityId: string) => JSON.stringify([sessionId, activityId])
function discardMcpActivityAuthorities(sessionId: string): void {
  for (const [key, authority] of mcpActivityAuthorities) if (authority.sessionId === sessionId) mcpActivityAuthorities.delete(key)
  for (const [key, flow] of mcpInputFlows) if (flow.sessionId === sessionId) mcpInputFlows.delete(key)
}

/** Only stable reviewed facts enter the digest. Run progress, cadence cursors,
 * names on receipts and unrelated graph edits cannot manufacture authority. */
function commissionMcpLiveSource(id: string, viewerTenant: string, actorUserId: string,
  selection?: CommissionMcpModelSelection): CommissionMcpLiveSource | undefined {
  const commission = COMMISSIONS.get(id)
  const owner = store.commissionOwnerTenant(id)
  if (!commission || !owner || !tenantWritesAs(viewerTenant, owner) || activeMcpActor(owner, actorUserId) !== actorUserId) return undefined
  const agent = WORKER_AGENTS.get(commission.agentId)
  const project = store.listProjects(owner).find(row => row.id === commission.projectId)
  const projectOwner = findProject(commission.projectId)?.tenantId ?? defaultTenantId()
  if (!agent || !project || (projectOwner !== owner && !project.shared)) return undefined
  const parentProvider = store.listProviders(owner).find(row => row.id === (agent.providerId ?? DEFAULT_PROVIDER.id))
  const provider = selection && store.listProviders(owner).find(row => row.id === selection.providerId)
  let execution: DispatchBinding | null = null
  let blockedReason: string | null = 'Choose an endpoint model before reviewing this permission.'
  if (selection) {
    const parsed = parseRealDispatchInput({ title: 'Commission work', execution: {
      agentId: agent.id, providerId: selection.providerId, modelId: selection.modelId } })
    if (parsed && provider && provider.kind !== 'session' && ['configured', 'mock'].includes(provider.execution ?? '')) {
      try { assertModelInCatalog(parsed.execution.modelId, provider.id, agent.id); execution = parsed.execution; blockedReason = null }
      catch { blockedReason = 'The selected model is no longer available. Choose a current endpoint model.' }
    } else blockedReason = 'Connect an endpoint provider and choose an available model.'
  }
  if (!parentProvider) blockedReason = 'The Agent’s configured provider is unavailable.'
  if (!store.commissionRolePermits(id, 'read') || !store.commissionRolePermits(id, 'reserve') || !store.commissionRolePermits(id, 'fire')) {
    blockedReason = 'This Contributor needs a role that can read, reserve and perform Project work.'
  }
  const ceilings = [parentProvider?.authority ?? {}, agent.authority ?? {}, commission.authority ?? {}, provider?.authority ?? {}]
  const tools = store.mcpConnections(owner, actorUserId)
    .filter(connection => connection.status === 'connected' && connection.execution === 'approval-required' &&
      (connection.transport === 'stdio' ? mcpRuntimeCapabilities().localProcesses === true :
        ['none', 'device-bearer', 'device-oauth'].includes(connection.authentication ?? '')))
    .flatMap(connection => connection.tools.filter(tool => connection.executableTools?.includes(tool.name) &&
      store.commissionCanReach(id, 'connectors', tool.name) && ceilings.every(authority => authorityAdmits(authority, 'connectors', tool.name)))
      .map(tool => ({ connectionId: connection.id, connectionRevision: connection.revision,
        connectionLabel: connection.label, schemaHash: mcpToolSchemaHash(tool), tool,
        ...(connection.transport === 'stdio' ? { transport: 'stdio' as const } : {}) })))
  if (!blockedReason && !tools.length) blockedReason = 'No inspected MCP tool is admitted by this Project and Contributor.'
  const audience = grants.filter(row => row.subject.kind === 'project' && row.subject.id === project.id)
    .sort((a, b) => a.id.localeCompare(b.id)).map(row => ({ id: row.id, audience: row.audience, tier: row.tier,
      audienceTenant: row.audienceTenant, redeemedBy: row.redeemedBy ?? [] }))
  return { scope: { tenantId: owner, ownerUserId: actorUserId, commissionId: id, projectId: project.id, agentId: agent.id },
    tenantId: owner, ownerUserId: actorUserId, commission, agent, project, provider, parentProvider, execution,
    projectContext: graph.projectContexts[project.id] ?? [], audience, tools, blockedReason }
}

type CommissionMcpLiveReviewCache = Map<string, { source: CommissionMcpLiveSource; reviewHash: string } | null>
type CommissionMcpPolicyRow = ReturnType<CommissionMcpRegistry['snapshot']>['policies'][number]

/** One exact work-target approval check shared by the unattended queue and the
 * legacy fixture fence. Capacity is deliberately handled by the caller: a busy
 * real approval remains real authority and must not turn into fixture work. */
function commissionMcpApprovedToolForWork(item: StoredOpenSubGoal, row: CommissionMcpPolicyRow, now: number,
  usedByRevision: ReadonlyMap<string, number>, liveReviewCache: CommissionMcpLiveReviewCache): boolean {
  const approval = row.policy.approval
  if (!approval || now < approval.approvedAt || now >= approval.expiresAt ||
      !approval.tools.some(tool => tool.toolName === item.target)) return false
  const revisionKey = JSON.stringify([row.tenantId, row.ownerUserId, row.commissionId, row.policy.revision])
  if ((usedByRevision.get(revisionKey) ?? 0) >= approval.maxWorkItems) return false
  const reviewKey = JSON.stringify([row.tenantId, row.ownerUserId, row.commissionId])
  let liveReview = liveReviewCache.get(reviewKey)
  if (liveReview === undefined) {
    const source = commissionMcpLiveSource(row.commissionId, row.tenantId, row.ownerUserId, approval.execution)
    const facts = source && commissionMcpReviewFacts(source)
    const current = !!source && !!facts && !source.blockedReason &&
      approval.configurationRevision === (source.commission.configurationRevision ?? 0) &&
      approval.reviewHash === facts.reviewHash && approval.tools.every(tool => source.tools.some(available =>
        available.connectionId === tool.connectionId && available.connectionRevision === tool.connectionRevision &&
        available.tool.name === tool.toolName && available.schemaHash === tool.schemaHash) &&
        (() => {
          const connection = store.mcpConnection(tool.connectionId, row.tenantId, row.ownerUserId)
          return commissionMcpToolPermitted(row, tool, connection, mcpRuntimeCapabilities().localProcesses === true)
        })())
    liveReview = current && source && facts ? { source, reviewHash: facts.reviewHash } : null
    liveReviewCache.set(reviewKey, liveReview)
  }
  if (!liveReview) return false
  return liveReview.source.tools.some(tool => tool.tool.name === item.target &&
    approval.tools.some(allowed => allowed.connectionId === tool.connectionId &&
      allowed.connectionRevision === tool.connectionRevision && allowed.schemaHash === tool.schemaHash &&
      allowed.toolName === tool.tool.name))
}

/** Does this exact still-open MCP item have fresh explicit authority for its
 * target? This intentionally ignores process/tenant/Agent occupancy so legacy
 * fixture dispatch cannot consume work that is merely waiting for queue room. */
function commissionMcpHasCurrentWorkAuthority(item: StoredOpenSubGoal): boolean {
  if (item.status !== 'open' || item.type !== 'mcp.mutate' ||
      !openSubGoals.some(row => row.projectId === item.projectId && row.id === item.id && row.status === 'open' &&
        row.type === 'mcp.mutate' && row.target === item.target)) return false
  const state = commissionMcpRegistry.snapshot()
  const workId = commissionMcpClaimId(item.projectId, item.id)
  if (state.claims.some(claim => claim.id === workId) || (state.blockedWork ?? []).includes(workId)) return false
  const current = new Map<string, typeof state.policies[number]>()
  for (const row of state.policies) {
    if (row.projectId !== item.projectId) continue
    const key = JSON.stringify([row.tenantId, row.ownerUserId, row.commissionId])
    const prior = current.get(key)
    if (!prior || prior.policy.revision < row.policy.revision) current.set(key, row)
  }
  const usedByRevision = new Map<string, number>()
  for (const claim of state.claims) {
    const key = JSON.stringify([claim.permission.tenantId, claim.permission.ownerUserId,
      claim.permission.commissionId, claim.permission.policy.revision])
    usedByRevision.set(key, (usedByRevision.get(key) ?? 0) + 1)
  }
  const liveReviewCache: CommissionMcpLiveReviewCache = new Map()
  const policies = [...current.values()].filter(row => row.policy.approval)
    .sort((a, b) => a.commissionId.localeCompare(b.commissionId))
  const now = Date.now()
  return policies.some(row => commissionMcpApprovedToolForWork(item, row, now, usedByRevision, liveReviewCache))
}

/** Fresh queue projection from the registry and live store facts. Durable
 * claims and restore fences are global work identity barriers, even when the
 * old claim belongs to another person or Commission. */
function commissionMcpWorkCandidates() {
  const now = Date.now()
  const state = commissionMcpRegistry.snapshot()
  const current = new Map<string, typeof state.policies[number]>()
  for (const row of state.policies) {
    const key = JSON.stringify([row.tenantId, row.ownerUserId, row.commissionId])
    const prior = current.get(key)
    if (!prior || prior.policy.revision < row.policy.revision) current.set(key, row)
  }
  const active = dispatch.filter(run => run.execution?.state === 'running')
    .map(run => ({ tenantId: run.tenantId ?? defaultTenantId(), agentId: run.execution!.agentId }))
  active.push(...state.claims.filter(commissionMcpClaimActive)
    .map(claim => ({ tenantId: claim.permission.tenantId, agentId: claim.permission.agentId })))
  const globalSlots = Math.max(0, 4 - active.length)
  if (globalSlots === 0) return [] as CommissionMcpQueueCandidate[]

  const tenantCounts = new Map<string, number>()
  const activeTenantAgents = new Set<string>()
  for (const row of active) {
    tenantCounts.set(row.tenantId, (tenantCounts.get(row.tenantId) ?? 0) + 1)
    activeTenantAgents.add(JSON.stringify([row.tenantId, row.agentId]))
  }
  const usedByRevision = new Map<string, number>()
  for (const claim of state.claims) {
    const key = JSON.stringify([claim.permission.tenantId, claim.permission.ownerUserId,
      claim.permission.commissionId, claim.permission.policy.revision])
    usedByRevision.set(key, (usedByRevision.get(key) ?? 0) + 1)
  }
  const claimedWork = new Set(state.claims.map(claim => claim.id))
  const blockedWork = new Set(state.blockedWork ?? [])
  const policiesByProject = new Map<string, typeof state.policies>()
  for (const row of current.values()) {
    if (!row.policy.approval) continue
    const policies = policiesByProject.get(row.projectId) ?? []
    policies.push(row)
    policiesByProject.set(row.projectId, policies)
  }
  for (const policies of policiesByProject.values()) policies.sort((a, b) => a.commissionId.localeCompare(b.commissionId))
  // FIFO by post time, with stable identity tie-breakers. This order is shared
  // across Agent scopes so an old backlog item is not hidden by a later post.
  const pendingWork = openSubGoals.filter(item => item.status === 'open' && item.type === 'mcp.mutate')
    .sort((a, b) => a.postedAt - b.postedAt || a.projectId.localeCompare(b.projectId) || a.id.localeCompare(b.id))
  const liveReviewCache: CommissionMcpLiveReviewCache = new Map()
  const candidates: CommissionMcpQueueCandidate[] = []
  const selectedTenantAgents = new Set<string>()
  for (const item of pendingWork) {
    if (candidates.length >= globalSlots) break
    if (claimedWork.has(commissionMcpClaimId(item.projectId, item.id)) || blockedWork.has(commissionMcpClaimId(item.projectId, item.id))) continue
    for (const row of policiesByProject.get(item.projectId) ?? []) {
      if (candidates.length >= globalSlots) break
      const tenantAgent = JSON.stringify([row.tenantId, row.agentId])
      if ((tenantCounts.get(row.tenantId) ?? 0) >= 2 || activeTenantAgents.has(tenantAgent) ||
          selectedTenantAgents.has(tenantAgent)) continue
      if (!commissionMcpApprovedToolForWork(item, row, now, usedByRevision, liveReviewCache)) continue
      candidates.push({ commissionId: row.commissionId, tenantId: row.tenantId, userId: row.ownerUserId,
        projectId: row.projectId, agentId: row.agentId, itemId: item.id })
      selectedTenantAgents.add(tenantAgent)
      tenantCounts.set(row.tenantId, (tenantCounts.get(row.tenantId) ?? 0) + 1)
      // One pending job per tenant/Agent in a projection. Further work for
      // this Agent is reconsidered after its durable attempt occupies history.
      break
    }
  }
  return candidates
}

function routineMcpFacts(task: ScheduledTask): { reviewHash: string; disclosures: string[] } {
  const owner = task.tenantId ?? defaultTenantId()
  const artifact = graph.extraArtifacts.find(row => row.sourceScheduleId === task.id && (row.tenantId ?? defaultTenantId()) === owner)
  const projectId = graph.scheduleProject[task.id] ?? null
  // This legacy relation stores a display label, never an existing Session ID.
  const sessionLabel = graph.scheduleSession[task.id] ?? null
  const refs: SocialEntityRef[] = [{ kind: 'schedule', id: task.id }]
  if (artifact) refs.push({ kind: 'artifact', id: artifact.id })
  if (projectId) refs.push({ kind: 'project', id: projectId })
  // Results also land in each run's real conversation. Its independent grants
  // can change while a model call is in flight; publication must recheck them.
  for (const run of task.runs) refs.push({ kind: 'session', id: runSessionId(task.id, run.id) })
  const audience = refs.flatMap(ref => grants.filter(row => row.subject.kind === ref.kind && row.subject.id === ref.id))
    .sort((a, b) => a.id.localeCompare(b.id))
  const agent = WORKER_AGENTS.get(task.agentId ?? DEFAULT_AGENT.id)
  const provider = MODEL_PROVIDERS.get(task.providerId ?? agent?.providerId ?? DEFAULT_PROVIDER.id)
  // Reputation, forks, publication history, and provider online/secret telemetry
  // are activity/provenance, not the configuration this permission reviewed.
  // Keep this projection explicit so those fields cannot silently enter the hash.
  const reviewedAgent = agent ? {
    id: agent.id, revision: agent.revision ?? 0, tenantId: agent.tenantId ?? null,
    label: agent.label, systemPrompt: agent.systemPrompt, instructions: agent.instructions,
    tools: agent.tools, providerId: agent.providerId ?? null,
    authority: agent.authority ?? null, budget: agent.budget ?? null,
  } : null
  const reviewedProvider = provider ? {
    id: provider.id, tenantId: provider.tenantId ?? null, kind: provider.kind ?? 'endpoint',
    definitionRevision: provider.definitionRevision ?? 0, connectionRevision: provider.connectionRevision ?? 0,
    label: provider.label, modelFamily: provider.modelFamily, effortLevels: provider.effortLevels,
    models: provider.models ?? null, catalogSource: provider.catalogSource ?? null,
    plan: provider.plan ?? null, authority: provider.authority ?? null,
    defaultModelId: provider.defaultModelId ?? null,
  } : null
  const project = projectId ? findProject(projectId) : undefined
  const reviewHash = createHash('sha256').update(routineMcpJsonText({
    owner, routineId: task.id, definitionRevision: task.revision ?? 0,
    artifact: graph.scheduleArtifact[task.id] ?? null, projectId, sessionLabel,
    extraTools: graph.scheduleExtraTools[task.id] ?? [],
    // Public definition and authority changes require fresh review too.
    agent: reviewedAgent, provider: reviewedProvider,
    project: project ? { id: project.id, shared: project.shared ?? false } : null,
    audience: audience.map(row => ({ id: row.id, subject: row.subject, audience: row.audience, tier: row.tier,
      audienceTenant: row.audienceTenant, redeemedBy: row.redeemedBy ?? [] })),
  })).digest('hex')
  const spec = parseScheduledArtifactSpec(graph.scheduleArtifact[task.id])
  return { reviewHash, disclosures: [
    `The Routine uses ${agent?.label ?? 'its selected Agent'} and ${provider?.label ?? 'its selected provider'}. Tool arguments are sent to the selected external MCP servers; results return to the model provider.`,
    `Run summaries and model output follow this Routine’s sharing and each run conversation’s independent sharing. Permission management and workspace-connection receipts stay with this workspace; personal OAuth and local-program tool choices and exact receipts stay private to their approver.`,
    spec ? `Successful output also updates ${spec.kind === 'doc' ? 'Document' : spec.kind === 'sheet' ? 'Sheet' : 'Slides'} “${spec.name}”, with that artifact’s current sharing.` : 'No standing artifact output is configured.',
    ...(projectId ? [`Project destination: ${project?.name ?? projectId}.`] : []),
    ...(project?.shared ? ['This destination Project is publicly shared. Its public definition is visible beyond its explicit grants.'] : []),
    ...(sessionLabel ? [`Configured conversation label: ${sessionLabel}. Each run creates its own conversation; this label is not an existing conversation destination.`] : []),
    audience.length ? `Current destination sharing: ${audience.map(row => `${row.subject.kind} → ${row.audience.kind === 'link' ? 'shared-link recipients' : tenantName(row.audienceTenant)} (${row.tier})`).join('; ')}.` : 'No additional share grants are configured on these destinations.',
    'External services and the model provider may charge fees. Call limits are not monetary caps. Each attempt consumes a slot, including a pre-submit refusal.',
    'OAuth calls use the approving person’s external account and require their continued workspace membership. Signing in or attaching a connection does not approve unattended calls. Personal tool choices and exact receipts stay private; authorized workspace members can revoke or replace the grant using their own connections.',
    'Local programs require separate unattended-call approval and the approving person’s continued workspace membership. They run with normal operating-system access and may act during startup before a tool call. Tool and call limits are not a process sandbox. Failed local attempts pause the Routine for review, even without a tool result.',
    'Changing the Routine, its Agent/provider, destinations, sharing, or selected tool definitions requires renewed review. Uncertain external calls pause the Routine and are never automatically repeated.',
  ] }
}

function pauseRoutineMcp(task: ScheduledTask): void {
  routineMcpRegistry.suspend(task.tenantId ?? defaultTenantId(), task.id)
  if (task.next !== 'Paused — review external calls' || task.enabled) task.revision = (task.revision ?? 0) + 1
  task.enabled = false
  task.next = 'Paused — review external calls'
  delete task.nextFireAt
  emit({ type: 'schedule.changed', taskId: task.id, tenantId: task.tenantId })
}

// Per-session attached contexts — the *attachment of record* (Primitive 1 of
// docs/shared-resource-coordination.md). Server-owned so every effect a session
// initiates can be mediated by naming one of these (Tiers A–C). Seeded for the
// demo sessions; created state is persisted to disk (see persist.ts).
const sessionContextBindings = new Map<string, SessionContext[]>([
  ['auth-refactor', [{ id: 'repo-auth', type: 'repo', label: 'auth-service', scope: '~/projects/auth-service' }]],
])

// Per-session live workspace — the panels a conversation has grown (the *content*
// of its attached contexts). Server-owned so a runtime attach survives a reload,
// the way the conversation does. Lazily materialized from the session's flat seed
// fields on first read (server/workspace.ts), then replaced by the client's
// write-through as context attaches/detaches. Persisted to disk (see persist.ts).
const sessionWorkspaces = new Map<string, SessionWorkspace>()
let imageAssets = new ImageAssetRegistry()

/** A session title from its first message — the leading words, trimmed to a row-
 *  friendly length (mirrors how the desktop app titles a fresh chat). Empty input
 *  (a session created before its first send) falls back to a neutral label. */
function titleFrom(firstMessage?: string): string {
  const text = (firstMessage ?? '').trim().replace(/\s+/g, ' ')
  if (!text) return 'New session'
  return text.length > 48 ? `${text.slice(0, 48).trimEnd()}…` : text
}

/** Strip resource bodies from invalidation-only session events before either the
 *  live wire or replay ring can retain them. One projection at the single publish
 *  point makes the bound structural: a future session mutator cannot accidentally
 *  broadcast an arbitrarily long transcript by passing its in-memory row. */
function eventForSubscribers(e: ServerEvent): ServerEvent {
  if (e.type === 'project.changed') {
    return { type: e.type, projectId: e.projectId, scope: e.scope }
  }
  if (e.type !== 'session.updated' && e.type !== 'session.removed') return e
  return {
    type: e.type,
    session: {
      id: e.session.id,
      ...(e.session.tenantId ? { tenantId: e.session.tenantId } : {}),
    },
  }
}

/** Publish a domain event to every open ambient SSE channel. The single publish
 *  point, so payload projection and the event log's global seq happen exactly
 *  once (the resumable-stream backbone — server/eventlog.ts, design §5.3). */
function publishEvent(e: ServerEvent): void {
  const projected = eventForSubscribers(e)
  const seq = eventlog.record(projected)
  for (const fn of listeners) {
    try {
      fn(projected, seq)
    } catch {
      /* a dead channel shouldn't break the others */
    }
  }
}

// A compound domain mutation may call several existing canonical mutators.
// Defer their persistence and events until the complete state transition is
// ready, so the durable snapshot and ambient observers never see a half-landed
// proposal. Node drives store mutations synchronously, so one module-level
// nesting depth is the narrowest honest transaction boundary here.
let mutationBatchDepth = 0
let mutationBatchNeedsPersist = false
let mutationBatchEvents: ServerEvent[] = []

/** Relay liveness is transient, but its visibility is durable Provider
 * ownership. Snapshot that routing fact while the row exists: a compound
 * Provider removal publishes only after durable absence, when a live lookup
 * would otherwise misroute its queued disconnect to the default tenant. */
function scopeRelayEventAtEmission(e: ServerEvent): ServerEvent {
  if (e.type !== 'relay.connected' && e.type !== 'relay.disconnected' && e.type !== 'relay.activity') return e
  if (e.tenantId !== undefined) return e
  const tenantId = MODEL_PROVIDERS.get(e.providerId)?.tenantId
  return tenantId ? { ...e, tenantId } : e
}

function emit(e: ServerEvent): void {
  const scoped = scopeRelayEventAtEmission(e)
  if (mutationBatchDepth > 0) {
    mutationBatchEvents.push(scoped)
    return
  }
  publishEvent(scoped)
}

/** Sharing/prose/default changes invalidate authorized reads, never broadcast
 * the relation payload. Capture prior public visibility for the unshare edge;
 * private/grant-only recipients are resolved by the read wall at delivery. */
function emitProjectChanged(project: Project, wasPublic = false): void {
  emit({
    type: 'project.changed',
    projectId: project.id,
    scope: wasPublic || project.shared === true ? 'public' : 'readers',
  })
}

/** One tenant-safe invalidation face for the Agent registry. A directory event
 * deliberately omits the raw owner id because it is broadcast to every reader;
 * private rows retain their owner stamp, while unstamped shared infrastructure
 * follows the registry's all-reader visibility rule. */
function emitAgentChanged(agent: Agent, directoryAffected = agent.published === true): void {
  emit(directoryAffected
    ? { type: 'agent.changed', agentId: agent.id, scope: 'directory' }
    : {
        type: 'agent.changed',
        agentId: agent.id,
        scope: 'owner',
        ...(agent.tenantId ? { tenantId: agent.tenantId } : {}),
      })
}

/** Tenant-safe invalidation for the provider registry. Shared infrastructure is
 * visible to every registry reader; tenant-owned providers stay owner-scoped. */
function emitProviderChanged(provider: ModelProvider): void {
  emit({
    type: 'provider.changed',
    providerId: provider.id,
    ...(provider.tenantId ? { tenantId: provider.tenantId } : {}),
  })
}

/** Tenant-safe invalidation for the prompt registry. */
function emitSystemPromptChanged(prompt: SystemPromptEntry): void {
  emit({
    type: 'systemprompt.changed',
    systemPromptId: prompt.id,
    ...(prompt.tenantId ? { tenantId: prompt.tenantId } : {}),
  })
}

// ── The one session mint funnel ──────────────────────────────────────────────
// Every session is registered through here — human-created (`store.createSession`,
// the "New chat" materialized on first send) and agent-created (`ensureRunSession`,
// a scheduled routine's run) — so the two kinds share one shape (the full uniform
// property set), one route surface, and one permission wall, and differ ONLY in
// the initiator stamp: `scheduledRunOf` present ⇒ an agent (that routine's run)
// opened the conversation; absent ⇒ a person did. `quiet` is the boot-time
// seed/rehydrate materialization: rows register without broadcasting (no SSE
// subscriber exists yet, and the event log's seq must not inflate at boot) and
// without a per-row snapshot write.

function mintSession(
  input: {
    id: string
    title: string
    preview: string
    tenantId?: string
    agentId?: string
    providerId?: string
    modelId?: string
    connectors?: Connector[]
    scheduledRunOf?: { taskId: string; taskName: string }
    forkedFrom?: { sessionId: string; title: string; atMessageId: string }
    messages?: Message[]
    /** Row timestamps (an agent session is stamped with its run's `at`, so seeded
     *  history keeps its fixture chronology); default = now. */
    at?: number
  },
  opts?: { quiet?: boolean },
): Session {
  const now = input.at ?? Date.now()
  const session: Session = {
    id: input.id,
    title: input.title,
    caps: ['chat'],
    agentId: input.agentId ?? DEFAULT_AGENT.id,
    ...(input.providerId ? { providerId: input.providerId } : {}),
    ...(input.modelId ? { modelId: input.modelId } : {}),
    // Tenancy: stamped when the initiator carries one (a human create always does;
    // an agent session mirrors its ROUTINE's stamp verbatim, so an unstamped
    // flagship seed keeps the two-faces visibility rule — F2/PD9, seedVisibleTo).
    ...(input.tenantId ? { tenantId: input.tenantId } : {}),
    ...(input.connectors ? { connectors: input.connectors } : {}),
    ...(input.scheduledRunOf ? { scheduledRunOf: input.scheduledRunOf } : {}),
    ...(input.forkedFrom ? { forkedFrom: input.forkedFrom } : {}),
    preview: input.preview,
    messages: input.messages ?? [],
    status: 'active',
    environment: 'local',
    createdAt: now,
    updatedAt: now,
    metadataRevision: 0,
  }
  // Agent sessions append (the sessions LIST excludes them — they surface through
  // the Scheduled rail/feed — so seed-list order must not shift under them);
  // human sessions lead the list, newest first.
  if (session.scheduledRunOf) SESSIONS.push(session)
  else SESSIONS.unshift(session)
  if (!opts?.quiet) {
    emit({ type: 'session.updated', session })
    persist()
  }
  return session
}

/** The recap's fixed per-session message id — the settle idempotency key (the
 *  opening prompt is `m1`; route-minted follow-up turns are `m-u-N`/`m-a-N`, so
 *  neither can collide with or masquerade as the recap). */
const RUN_RECAP_MESSAGE_ID = 'm2'

/** How much run history a routine retains — the scheduler accretes runs
 *  tick forever, and each run now carries a session row, so without a cap the
 *  store grows without bound (the principle server/store/store-runs.test.ts pins for
 *  standing artifacts applies here too). Old runs retire with their session
 *  rows through the same run↔session identity cascade the delete paths use. */
const RUN_HISTORY_CAP = 50

/** Proposed tool activities currently EXECUTING a confirm (`sessionId/activityId`).
 *  Deliberately transient (like reservations): the claim spans one route await,
 *  and a crash mid-execute should not wedge the proposal shut across a reboot. */
const TOOL_ACTIVITY_INFLIGHT = new Set<string>()

/** Project a run's frozen authored definition over the live routine row. Live
 *  registry/permission facts still resolve separately at attempt time. */
function taskForRun(task: ScheduledTask, run: ScheduledRun): ScheduledTask {
  if (!run.execution) return task
  return {
    ...task,
    trigger: run.execution.trigger,
    prompt: run.execution.prompt,
    steps: run.execution.steps,
    delivery: run.execution.delivery,
    agentId: run.execution.agentId,
    providerId: run.execution.providerId,
    modelId: run.execution.modelId,
    effort: run.execution.effort,
  }
}

/** The AGENT adapter of the mint funnel: the persisted session for one scheduled
 *  run, idempotent by its deterministic id (`srun-…`, contract/ids.ts) so run-now,
 *  the scheduler, boot-time materialization, and the feed lookup all converge on the
 *  same row. Minted with the user turn it ran (`runPrompt`); the recap lands when
 *  the run settles (`settleRunSession`), the way a human turn's reply does. On an
 *  EXISTING row the routine's code-owned facts re-stamp (P9 — the run-session
 *  face of `reconcileSeedTenancy`): tenancy and the initiator stamp's name follow
 *  the routine, so a snapshot written before a seed re-tenanted or renamed can't
 *  leave a run thread 404ing behind the wall its routine moved past. The row's
 *  `title` is deliberately NOT re-stamped — it's user-editable (PATCH rename). */
function ensureRunSession(task: ScheduledTask, run: ScheduledRun, opts?: { quiet?: boolean }): Session {
  const id = runSessionId(task.id, run.id)
  const existing = SESSIONS.find((s) => s.id === id)
  if (existing) {
    if (task.tenantId) existing.tenantId = task.tenantId
    else delete existing.tenantId
    if (existing.scheduledRunOf && existing.scheduledRunOf.taskName !== task.name) {
      existing.scheduledRunOf = { taskId: task.id, taskName: task.name }
    }
    return existing
  }
  const authored = taskForRun(task, run)
  return mintSession(
    {
      id,
      title: task.name,
      preview: run.summary,
      tenantId: task.tenantId,
      agentId: authored.agentId,
      providerId: authored.providerId,
      modelId: authored.modelId,
      connectors: connectorsFor(authored),
      scheduledRunOf: { taskId: task.id, taskName: task.name },
      messages: [{ id: 'm1', role: 'user', content: runPrompt(authored) }],
      at: run.at,
    },
    opts,
  )
}

/** Land a settled run's recap in its session — the assistant turn of the run's
 *  conversation, appended through the same message-append rules a human turn
 *  persists through. Idempotent (the recap is the thread's one assistant turn
 *  until a user follows up — a session that already carries one is left alone);
 *  a still-running run has no recap yet. Quiet path (boot healing — e.g. a run
 *  swept to 'failed' after a restart) stamps the run's own time, not now. */
function settleRunSession(task: ScheduledTask, run: ScheduledRun, opts?: { quiet?: boolean }): void {
  if (run.status === 'running') return
  const session = ensureRunSession(task, run, opts)
  // Idempotency keys on the RECAP itself (its fixed id), not "any assistant
  // turn" — a follow-up exchange that lands while the run is still executing
  // must not swallow the run's primary output.
  if ((session.messages ?? []).some((m) => m.id === RUN_RECAP_MESSAGE_ID)) return
  const message: Message = { id: RUN_RECAP_MESSAGE_ID, role: 'assistant', content: runRecap(taskForRun(task, run), run) }
  applyMessage(session, message, opts?.quiet ? run.at : Date.now())
  if (!opts?.quiet) {
    emit({ type: 'session.updated', session })
    persist()
  }
}

/** Retire a routine's oldest runs past the retention cap — WITH their session
 *  rows (the run↔session identity cascade). Quiet: the callers broadcast/persist
 *  the mutation that grew the history. */
function retireOldRuns(task: ScheduledTask): void {
  if (task.runs.length <= RUN_HISTORY_CAP) return
  const retired = task.runs.slice(RUN_HISTORY_CAP)
  task.runs = task.runs.slice(0, RUN_HISTORY_CAP)
  routineMcpRegistry.retainRuns(task.tenantId ?? defaultTenantId(), task.id, new Set(task.runs.map(run => run.id)))
  const goneIds = new Set(retired.map((r) => runSessionId(task.id, r.id)))
  for (let j = SESSIONS.length - 1; j >= 0; j -= 1) {
    if (goneIds.has(SESSIONS[j].id)) {
      discardMcpActivityAuthorities(SESSIONS[j].id)
      SESSIONS.splice(j, 1)
    }
  }
}

/** Materialize the session row for every run the schedules already carry — the
 *  boot-time pass (module init + rehydrate) that keeps the one-funnel invariant
 *  over SEED runs and over snapshots written before run sessions persisted.
 *  Idempotent by the deterministic run-session id (and existing rows get their
 *  code-owned facts re-stamped — P9). Applies the retention cap first, so an
 *  over-cap snapshot (a long-running scheduler's) shrinks to policy on boot —
 *  which also bounds this pass. */
function materializeRunSessions(): void {
  for (const task of schedules) {
    retireOldRuns(task)
    for (const run of task.runs) {
      ensureRunSession(task, run, { quiet: true })
      settleRunSession(task, run, { quiet: true })
    }
  }
}

/** The in-place message append shared by `appendMessage` (the store's public
 *  write) and the quiet boot-time recap healing — one place computes the row's
 *  preview + activity refresh. */
function applyMessage(session: Session, message: Message, at = Date.now()): void {
  session.messages = [...(session.messages ?? []), message]
  session.preview = message.content.slice(0, 120)
  session.updatedAt = at
}

// Materialize the session row for every seeded run — at module init, after the
// funnel's declarations (the `const` policy knobs above are TDZ before this
// line) and after SEED_SESSIONS' pristine capture. Quiet: registers without
// broadcasting, so booting doesn't inflate the event log.
materializeRunSessions()

// The native-runner registry — the broker's live view of connected hosts. In
// native/mock mode we seed the co-located runner (the one-runner registry the
// static capabilities describe); a remote web server seeds none.
const registry = new RunnerRegistry(emit)
if (NATIVE) {
  // The co-located sidecar: always reachable while this process is up, and it has no
  // external heartbeat client, so pin it against liveness reaping (it would otherwise be
  // swept after the TTL and the runner-host fs source would vanish).
  registry.register(LOCAL_RUNNER_SEED)
  registry.pin(LOCAL_RUNNER_ID)
}

// Resolve a served filesystem source id (`?source=`) to its reader + descriptor.
// `cloud` → the web backend's storage; `runner:<id>` → that online runner's host,
// proxied through the broker (the in-process reader stands in for the on-host
// runner reading its own disk). `ui-host` is client-side, so it never resolves
// here; an unknown / offline / unmapped / ungranted source → undefined (→ 404).
function resolveFsReader(sourceId: string, capability: 'fs.read' | 'fs.list'): { reader: FsReader; source: FsSource } | undefined {
  if (sourceId === 'cloud') return { reader: cloudReader, source: CLOUD_SOURCE }
  if (sourceId.startsWith('runner:')) {
    const runnerId = sourceId.slice('runner:'.length)
    const runner = registry.get(runnerId)
    if (!runner || runner.status !== 'online') return undefined
    const mapped = runnerFs(runner)
    if (!mapped?.supports(capability)) return undefined
    return { reader: mapped.reader, source: { id: sourceId, kind: 'runner', label: runner.label, runnerId } }
  }
  return undefined
}

function folderSnapshotStillPermitted(snapshot: ServedFolderSnapshot): boolean {
  if (snapshot.sourceId === 'cloud') return true
  const runner = registry.get(snapshot.sourceId.slice('runner:'.length))
  return !!runner && runner.status === 'online' &&
    !!runnerFs(runner)?.permitsFolderSnapshot(snapshot.path, snapshot.files)
}

/** The server-known filesystem sources for the picker's source switcher — the web
 *  backend's cloud storage, plus any online runner advertising fs access that the
 *  broker can actually read (has a mapped root). The client prepends its own
 *  `ui-host` source. */
function fsSourceList(): FsSource[] {
  const runnerSources = registry
    .list()
    .filter((r) => {
      if (r.status !== 'online') return false
      const mapped = runnerFs(r)
      return mapped?.supports('fs.read') || mapped?.supports('fs.list')
    })
    .map((r): FsSource => ({ id: `runner:${r.id}`, kind: 'runner', label: r.label, runnerId: r.id }))
  return [CLOUD_SOURCE, ...runnerSources]
}

// The effect journal — each runner's authoritative log of its host's effects (D2)
// + the server's projection of it. Emits `runner.effect` as effects project.
const journal = new RunnerJournal(emit)

// The delegated-cognition relay runtime (docs/delegated-cognition-provider.md) —
// the transient half of every `kind:'session'` provider: one-entry slot, parked
// puller, socket-or-in-flight liveness. Durable identity is the provider row
// (its secretHash); like the runner registry, this is deliberately NOT persisted.
// Emits `relay.connected|disconnected` on liveness flips.
const relay = new RelayRuntime(emit)

// The resource guardian — per shared resource (a context element), a reservation
// ledger enforcing a capacity invariant (D5). The escrow that lets the broker
// refuse a second session's irreversible write up front. Emits `reservation.changed`.
const guardian = new ResourceGuardian(emit)

// A Project's sub-goal namespace (D11) lives under its guardian id:
// `${guardianId}:${subGoal}`. Two Contributors on different sub-goals get distinct
// resources (concurrent); the same sub-goal is one capacity-1 resource (mutual
// exclusion → first-come wins, the second re-reasons).
const subGoalKey = (guardianId: string, subGoal: string) => `${guardianId}:${subGoal}`

/** Project guardian namespaces are reachable only through Project-aware routes,
 * where visibility, Contributor ownership, and role are enforced. */
const projectForGuardianResource = (resourceId: string): Project | undefined =>
  [...baseProjects(), ...graph.extraProjects].find((project) =>
    !!project.guardianId
    && (resourceId === project.guardianId || resourceId.startsWith(`${project.guardianId}:`)),
  )

/** Run `effect` while holding `resourceKey` at the guardian, committing the irreversible
 *  step — releasing **only what this call acquired**, so a holder that already held the
 *  resource (a reservation kept across a consent gate, or a seeded hold) keeps it after.
 *  `guardian.reserve` is re-entrant, so without this a re-entrant effect would free a
 *  pre-existing hold. Mirrors the invoke route's `acquiredHere` care, shared so the two
 *  guard methods can't drift. A concurrent *different* holder is refused before `effect`
 *  runs (`reserve` throws `GuardianError` 'conflict'). */
function guardedRun<T>(
  resourceKey: string,
  holder: string,
  effect: () => T,
  ownerTenant?: string,
): T {
  const heldBefore = guardian.heldBy(resourceKey, holder, ownerTenant)
  const reservation = guardian.reserve(resourceKey, holder, { ownerTenant })
  try {
    const result = effect()
    guardian.commit(reservation.id)
    return result
  } finally {
    if (!heldBefore) guardian.release(reservation.id)
  }
}

// Seed one held sub-goal on the guarded Insights Project so the Coordination panel
// demonstrates a Contributor holding a sub-goal — reserved by the seeded commission (a
// Contributor). A *different* principal claiming the same sub-goal then conflicts. Long
// TTL so the demo claim doesn't lapse at the 60s default mid-session. (Transient, like
// the rest of the guardian ledger — rebuilt from this line on each boot.)
guardian.reserve(subGoalKey('p-insights', 'auth-refactor'), 'commission-insights-default', {
  ttlMs: 365 * 24 * 60 * 60 * 1000,
  ownerTenant: defaultTenantId(),
})

// ── Filesystem persistence ──────────────────────────────────────────────────
// Off until the real server entrypoint calls `store.initPersistence()`; tests
// drive the store in-memory. When on, every mutation snapshots the UI-owned state
// and writes it atomically, so a sent message / attached context / created session
// survives a restart. Reservations + the runner registry are intentionally NOT
// persisted: they're live/transient (a stale lock or a phantom offline runner must
// not outlive the process).
let persistEnabled = false
/** One-way durability fault. Once a commit fails, this process can no longer
 * prove its in-memory graph matches disk; only a restart from the last durable
 * snapshot may clear the condition. */
let persistenceFault: PersistenceWriteError | null = null

/** Draining latch (F6 graceful shutdown): set on SIGTERM so `/readyz` fails while the
 *  process winds down. Transient — never persisted. */
let draining = false

/** Snapshot the mutable, UI-owned state for the on-disk format. */
function snapshot(): PersistedState {
  const persistedAccounts = accounts.toPersisted()
  const persistedContextRecents = contextRegistry.persistedRecents()
  return {
    version: STORE_VERSION,
    initialWorld: worldMode,
    sessions: SESSIONS,
    retiredSessionCreationIds: [...retiredSessionCreationIds],
    bindings: [...sessionContextBindings.entries()],
    workspaces: [...sessionWorkspaces.entries()],
    imageAssets: imageAssets.snapshot(),
    sessionPreferences: persistedSessionPreferences(),
    modelPreferences: persistedModelPreferences(),
    schedules,
    recents: persistedContextRecents.defaultRecents,
    recentsByTenant: persistedContextRecents.tenantRecents,
    graph,
    savedContexts: contextRegistry.persistedContexts(),
    mcpConnections: mcpConnectionRegistry.snapshot(),
    mcpActivityAuthorities: [...mcpActivityAuthorities.values()].map(row => ({ ...row })),
    mcpInputFlows: structuredClone([...mcpInputFlows.values()]),
    routineMcp: routineMcpRegistry.snapshot(),
    commissionMcp: commissionMcpRegistry.snapshot(),
    usageMeters: usageRegistry.snapshot(),
    usageReservations: usageRegistry.snapshotReservations(),
    // The Agent Commons registries (D6/D9/D10/D7) — provider configs ride alongside
    // the providers so a restored one keeps its concrete model id.
    providers: [...MODEL_PROVIDERS.entries()],
    providerConfigs: [...PROVIDER_CONFIGS.entries()],
    systemPrompts: [...SYSTEM_PROMPT_LIB.entries()],
    registryDefaults: [...REGISTRY_DEFAULTS.entries()], // per-tenant default-flag pointers (UI shortcut)
    agents: [...WORKER_AGENTS.entries()],
    agentOwnership: agentOwnershipRegistry.snapshot(),
    agentRequests: proxyRequestRegistry.snapshot(),
    retiredAgentCreationIds: [...retiredAgentCreationIds],
    commissions: [...COMMISSIONS.entries()],
    // D13 commission caps — only Projects that carry one (the seed Projects are otherwise
    // not persisted); rehydrate re-applies them onto the matching seed Project.
    commissionCaps: baseProjects().filter((p) => p.commissionCap !== undefined).map(
      (p) => [p.id, p.commissionCap!] as [string, number],
    ),
    // D14 default contributor roles — the same seed-overlay shape as the caps (a
    // created Project's defaultRole rides the graph slice on its own object).
    projectDefaultRoles: baseProjects().filter((p) => p.defaultRole !== undefined).map(
      (p) => [p.id, p.defaultRole!] as [string, ProjectRole],
    ),
    auditLog, // D15/OQ7 — the cross-user effect trail (append-only)
    dispatch, // P7 — one-off dispatch runs (a live run survives a restart)
    openSubGoals: openSubGoals.map(stripStoredCommissionResolution), // D19 — durable backlog; derived MCP provenance stays out of snapshots
    contributions, // Phase A — the Project landing ledgers (the linear history survives a restart)
    delegations, // Phase F — the delegation rosters (a standing judgment grant survives a restart)
    delegationRetirements, // Phase F — revoked keyed authority cannot be resurrected by Retry
    grants, // social S1 — who can see/do what (a share survives a restart)
    discussions, // social S2 — anchored threads (talk survives a restart)
    socialProposals, // social S3 — offered changes + the per-subject ledger
    artifactBodies: [...artifactBodies.entries()], // social S3 — edited artifact bodies (id-keyed)
    artifactHistory: [...artifactHistory.entries()],
    artifactHistoryRestoreReceipts: [...artifactHistoryRestoreReceipts.entries()],
    artifactMetadata: [...artifactMetadata.entries()],
    artifactLifecycle: [...artifactLifecycle.entries()],
    artifactRetirements: [...artifactRetirements.values()],
    artifactDeletionReceipts: [...artifactDeletionReceipts.entries()],
    mutes: [...mutes.entries()].map(([t, set]) => [t, [...set]] as [string, string[]]), // S5 earmuffs
    // S7 — the person layer: who each viewer follows, and how far they've read
    // each thread (the DM inbox's unread count).
    follows: [...follows.entries()].map(([t, set]) => [t, [...set]] as [string, string[]]),
    discussionReads: [...discussionReads.entries()].map(([t, m]) => [t, [...m.entries()]] as [string, [string, number][]]),
    // D24 — watch subscriptions ([tenantId, subjectKey] pairs) + the notification inbox.
    watches: [...watches.entries()].flatMap(([key, tenants]) => [...tenants].map((t) => [t, key] as [string, string])),
    notifications,
    // The Commons lenses (S4): likes per feed item, and each tenant's
    // recently-viewed ledger — both per principal, both survive a restart.
    commonsLikes: [...commonsLikes.entries()].flatMap(([itemId, tenants]) => [...tenants].map((t) => [t, itemId] as [string, string])),
    views: [...views.entries()].flatMap(([t, rows]) => rows.map((v) => [t, v.kind, v.id, v.at] as [string, string, string, number])),
    agentProposals: [...AGENT_PROPOSALS.entries()], // D25 — the definition review queue
    a2aPeers: [...A2A_PEERS.entries()], // D28 — verified-identity credentials (hashed)
    // The account registry (multi-account P7): onboarded users (scrypt
    // credential included — it must survive a restart), workspaces, memberships.
    accountUsers: persistedAccounts.users,
    accountTenants: persistedAccounts.tenants,
    memberships: persistedAccounts.memberships,
    orgInvites: persistedAccounts.orgInvites, // FWD-6 — the consent-gated org door
    apiTokens: persistedAccounts.apiTokens, // bearer-token registry (revocation survives restart)
    apiTokenMintReceipts: persistedAccounts.apiTokenMintReceipts, // keyed mint recovery/tombstones; never bearer values

    seq: {
      session: sessionSeq,
      message: messageSeq,
      schedule: scheduleSeq,
      run: runSeq,
      artifact: artifactSeq,
      provider: providerSeq,
      systemPrompt: systemPromptSeq,
      agent: workerAgentSeq,
      commission: commissionSeq,
      audit: auditSeq,
      dispatch: dispatchSeq,
      openSubGoal: openSubGoalSeq,
      contribution: contributionSeq,
      delegation: delegationSeq,
      grant: grantSeq,
      discussion: discussionSeq,
      socialProposal: socialProposalSeq,
      notification: notificationSeq,
      user: persistedAccounts.seq.user,
      tenant: persistedAccounts.seq.tenant,
      orgInvite: persistedAccounts.seq.orgInvite,
    },
  }
}

/** Construct the baseline for a release install from the same canonical snapshot
 * contract used by every later commit, then remove every authored-person/user-data
 * slice. Product infrastructure remains: one provider, one prompt, one Agent;
 * desktop also keeps its local device principal, while hosted starts accountless
 * until signup.
 * Keeping this here beside `snapshot` makes a newly durable slice conspicuous in
 * the first-run policy review instead of hiding a second persistence shape. */
function cleanFirstBootState(): PersistedState {
  const clean = snapshot()
  const persistedAccounts = accounts.toPersisted()
  const defaultPrompt = SYSTEM_PROMPTS.find((prompt) => prompt.id === SP_DEFAULT_ID)
  if (!defaultPrompt) throw new Error(`Missing required system prompt '${SP_DEFAULT_ID}'.`)

  clean.initialWorld = 'clean'
  clean.sessions = []
  clean.retiredSessionCreationIds = []
  clean.bindings = []
  clean.workspaces = []
  clean.sessionPreferences = []
  clean.modelPreferences = []
  clean.schedules = []
  clean.recents = { files: [], photos: [], folder: [], repo: [], connector: [], mcp: [] }
  clean.recentsByTenant = []
  clean.graph = emptyGraph()
  clean.savedContexts = []
  clean.mcpConnections = { connections: [], retired: [] }
  clean.routineMcp = { policies: [], runs: [], decisions: [] }
  clean.commissionMcp = emptyCommissionMcpRegistry()
  clean.usageMeters = []
  clean.usageReservations = []
  clean.providers = [[DEFAULT_PROVIDER.id, DEFAULT_PROVIDER]]
  clean.providerConfigs = [[DEFAULT_PROVIDER.id, DEFAULT_PROVIDER_CONFIG]]
  clean.systemPrompts = [[defaultPrompt.id, defaultPrompt]]
  clean.registryDefaults = []
  clean.agents = [[DEFAULT_AGENT.id, DEFAULT_AGENT]]
  clean.agentOwnership = []
  clean.agentRequests = []
  clean.retiredAgentCreationIds = []
  clean.commissions = []
  clean.commissionCaps = []
  clean.projectDefaultRoles = []
  clean.auditLog = []
  clean.dispatch = []
  clean.openSubGoals = []
  clean.contributions = []
  clean.delegations = []
  clean.delegationRetirements = []
  clean.grants = []
  clean.discussions = []
  clean.socialProposals = []
  clean.artifactBodies = []
  clean.artifactHistory = []
  clean.artifactHistoryRestoreReceipts = []
  clean.artifactMetadata = []
  clean.artifactLifecycle = []
  clean.artifactRetirements = []
  clean.artifactDeletionReceipts = []
  clean.mutes = []
  clean.follows = []
  clean.discussionReads = []
  clean.watches = []
  clean.commonsLikes = []
  clean.views = []
  clean.notifications = []
  clean.agentProposals = []
  clean.a2aPeers = []
  clean.accountUsers = NATIVE ? persistedAccounts.users.filter(([id]) => id === 'user-local') : []
  clean.accountTenants = NATIVE ? persistedAccounts.tenants.filter(([id]) => id === 'tenant-personal') : []
  clean.memberships = NATIVE
    ? persistedAccounts.memberships.filter(
        (membership) => membership.userId === 'user-local' && membership.tenantId === 'tenant-personal',
      )
    : []
  clean.apiTokens = []
  clean.apiTokenMintReceipts = []
  clean.orgInvites = []
  clean.seq = {
    session: 0,
    message: 0,
    schedule: 0,
    run: 0,
    artifact: 0,
    provider: 0,
    systemPrompt: 0,
    agent: 0,
    commission: 0,
    audit: 0,
    dispatch: 0,
    openSubGoal: 0,
    contribution: 0,
    delegation: 0,
    grant: 0,
    discussion: 0,
    socialProposal: 0,
    notification: 0,
    user: 0,
    tenant: 0,
    orgInvite: 0,
  }
  return clean
}

/** Latch one unrecoverable in-memory/durable divergence and notify every
 * supervising transport exactly once. A compound mutation that throws after a
 * canonical child already changed state is just as unsafe to keep serving as a
 * backend commit failure: only restart can restore the last known snapshot. */
function latchPersistenceFault(detail: unknown): PersistenceWriteError {
  if (!persistenceFault) {
    persistenceFault = detail instanceof PersistenceWriteError ? detail : new PersistenceWriteError(detail)
    draining = true
    for (const listener of persistenceFaultListeners) {
      try {
        listener()
      } catch {
        /* a dead transport shouldn't mask the durability failure */
      }
    }
    persistenceFaultListeners.clear()
  }
  return persistenceFault
}

/** Persist the current state (no-op until enabled). Called after every mutation.
 * A failed commit is one-way for this process: latch unready + draining before
 * throwing, so the originating route cannot return 2xx and later routes cannot
 * acknowledge the already-mutated in-memory graph. */
function persist(): void {
  if (mutationBatchDepth > 0) {
    mutationBatchNeedsPersist = true
    return
  }
  if (!persistEnabled) return
  if (persistenceFault) throw persistenceFault
  try {
    saveState(snapshot())
  } catch (error) {
    throw latchPersistenceFault(error)
  }
}

/** Commit one synchronous compound mutation as a single durable snapshot, then
 * publish its queued events. A commit failure therefore exposes neither a 2xx
 * nor ambient half-state; the existing durability latch walls the process. */
function commitMutationBatch<T>(work: () => T): T {
  const outer = mutationBatchDepth === 0
  mutationBatchDepth += 1
  let result: T
  try {
    result = work()
  } catch (error) {
    mutationBatchDepth -= 1
    const tainted = mutationBatchNeedsPersist || mutationBatchEvents.length > 0
    if (outer) {
      mutationBatchNeedsPersist = false
      mutationBatchEvents = []
    }
    // Canonical mutators change memory before calling persist(). If one of them
    // then throws, this process cannot prove the compound transition rolled
    // back. Fail closed instead of serving or later persisting half-state.
    if (outer && tainted) throw latchPersistenceFault(error)
    throw error
  }
  mutationBatchDepth -= 1
  if (!outer) return result

  const needsPersist = mutationBatchNeedsPersist
  const events = mutationBatchEvents
  mutationBatchNeedsPersist = false
  mutationBatchEvents = []
  // Leave commit errors to `persist`: it latches the process unready. The batch
  // depth is already restored, so its save is the one real durable write.
  if (needsPersist) persist()
  for (const event of events) publishEvent(event)
  return result
}

/** ── A stored display name is a CACHE of its authority id ────────────────────
 *  Every social row that carries a public NAME carries the raw tenant id beside
 *  it — `grantedBy`/`granterTenant`, `openedBy`/`openerTenant`,
 *  `author`/`authorTenant`, a principal anchor's id/`targetTenant` — because a
 *  name is the public face while the id is the authority (the rule
 *  `StoredDiscussion.targetTenant` was earned for). The name is written once at
 *  mint (`mintPost` and friends derive it from the id and nothing else), which
 *  makes it a cache — and a cache goes stale the moment a namespace is renamed.
 *
 *  So a snapshot's names are RE-DERIVED on load, not trusted. Earned 2026-08-09
 *  by the seed rename (Acme, Inc. → Ada Lovelace): without this, an existing
 *  `.data/store.json` boots the flagship demo half-renamed — the seeded thread
 *  and DM signed by a company that no longer exists, and the DM's anchor naming
 *  nobody, which is a broken conversation rather than a cosmetic wart. It
 *  generalizes past that one rename: any future rename, of a person or an org,
 *  is now free.
 *
 *  Only rows whose id still names a live tenant are refreshed — an id the
 *  registry has forgotten keeps the name it was written with, which is the
 *  honest record of who acted.
 *
 *  `follows` has no id to re-derive from (a per-viewer preference over a public
 *  handle, D21), so a rename ORPHANS one — and a dangling follow is not merely
 *  dead, it is a TRAP: the next signup to take that name silently inherits it,
 *  the very hazard `StoredDiscussion.targetTenant` exists to prevent one layer
 *  down. `setFollow` refuses any name it cannot reach, so an entry naming
 *  nobody could only have been orphaned — pruning it can't discard a live
 *  preference. `mutes` is deliberately NOT pruned: `setMute` takes any string
 *  by design (an earmuff is a pure preference, and one may legitimately name a
 *  party this store has never heard of), so absence there proves nothing.
 *
 *  Exported for its unit lock (server/routes/posts.test.ts), like `reconcileSeedTenancy`;
 *  rehydrate is the one runtime caller. */
/** ── Recover a DM's missing addressee id from its own posts ──────────────────
 *  A principal-anchored thread written before S7 stamped `targetTenant` carries
 *  only the anchor's display NAME — and a name is a cache, so the seed rename
 *  (Acme, Inc. → Ada Lovelace) left those rows naming somebody nobody is. The
 *  consequences compound rather than degrade: `dmParties` resolves to the opener
 *  ALONE, so the addressee 404s out of her own conversation, the thread vanishes
 *  from her inbox, and the `social.messaged` bell she was sent becomes a dead
 *  door — the failure the owner hit on 2026-08-11. `refreshStoredNames` cannot
 *  help, because it re-derives the anchor FROM the id that is missing.
 *
 *  The pair is recoverable from the thread itself: a DM admits exactly two
 *  writers, so anyone who has POSTED in it was a party. This cannot widen a
 *  wall — it names only people who demonstrably already wrote there.
 *
 *  Deliberately conservative, because a mis-stamp would convert an S8 WALL post
 *  (`targetTenant === openerTenant`) into a pair-walled DM and hide a public
 *  utterance. So it repairs only a row that is beyond every other repair — no
 *  stored id, an anchor name that resolves to nobody — and only when the posts
 *  name exactly ONE other tenant, leaving anything ambiguous untouched.
 *
 *  Runs BEFORE `refreshStoredNames`, which then re-derives the stale anchor from
 *  the id recovered here. Takes its rows like `reconcileSeedTenancy`, so the
 *  lock can hand it hand-built legacy shapes (server/routes/messages.test.ts). */
export function recoverDmParties(rows: StoredDiscussion[]): void {
  for (const d of rows) {
    if (d.anchor.ref.kind !== 'principal' || d.targetTenant !== undefined) continue
    if (tenantIdForName(d.anchor.ref.id) !== undefined) continue // the name still resolves; nothing to repair
    const others = [...new Set(d.posts.map((p) => p.authorTenant))].filter((t) => t !== d.openerTenant)
    if (others.length !== 1 || !accounts.tenants.has(others[0])) continue
    d.targetTenant = others[0]
  }
}

/** ── Recover a legacy DM bell's actor id from the thread it points at ────────
 *  The other half of the same 2026-08-11 report. A notification's `actor` is a
 *  stored display NAME, refreshed from `actorTenant` — and a row minted before
 *  that field keeps whatever name it was written with. After the seed rename
 *  that left the inbox announcing "Beta Platform sent you a message" while the
 *  conversation it opens is headed "Grace Hopper": one person, two names, one
 *  click apart — the exact confusion `StoredNotification`'s own comment warns of.
 *
 *  A DM bell can recover what a resource bell cannot: the thread has exactly two
 *  seats and the row already carries the RECIPIENT (`tenantId`), so the actor is
 *  the other one, unambiguously. A `social.discussed` bell gets no such repair —
 *  any of a thread's posters could have rung it, and guessing would put a name
 *  on an act somebody else committed. Restraint over coverage, as above. */
export function recoverBellActors(rows: StoredNotification[], threads: StoredDiscussion[]): void {
  for (const n of rows) {
    if (n.actorTenant !== undefined || !n.discussionId) continue
    const d = threads.find((t) => t.id === n.discussionId)
    if (!d || d.anchor.ref.kind !== 'principal' || isWallThread(d)) continue
    const parties = d.targetTenant !== undefined ? [d.openerTenant, d.targetTenant] : []
    const actor = parties.find((p) => p !== n.tenantId)
    if (actor === undefined || !accounts.tenants.has(actor)) continue
    n.actorTenant = actor
  }
}

/** Recover the authority id for legacy bells minted before `actorTenant` when
 *  their actor wears one of the six CODE-OWNED seed namespace names retired by
 *  the person-namespace collapse. Unlike an arbitrary display name, each of
 *  these aliases has one frozen historical meaning, so the repair is exact; an
 *  unknown name still keeps its honest legacy degrade. `refreshStoredNames`
 *  immediately re-derives the current public face from the recovered id. */
const LEGACY_SEED_ACTOR_TENANT: Readonly<Record<string, string>> = {
  'Acme, Inc.': 'tenant-acme',
  'Beta Platform': 'tenant-beta',
  Growthworks: 'tenant-growthworks',
  'Northlight Studio': 'tenant-northlight',
  'Harbor Support': 'tenant-harbor',
  'Rei’s Lab': 'tenant-reislab',
}

export function recoverSeedBellActors(rows: StoredNotification[]): void {
  for (const n of rows) {
    if (n.actorTenant !== undefined) continue
    const tenant = LEGACY_SEED_ACTOR_TENANT[n.actor]
    if (tenant !== undefined && accounts.tenants.has(tenant)) n.actorTenant = tenant
  }
}

export function refreshStoredNames(): void {
  const known = (id: string | undefined): boolean => id !== undefined && accounts.tenants.has(id)
  for (const g of grants) {
    if (known(g.granterTenant)) g.grantedBy = tenantName(g.granterTenant)
  }
  for (const d of discussions) {
    if (known(d.openerTenant)) d.openedBy = tenantName(d.openerTenant)
    if (d.anchor.ref.kind === 'principal' && d.targetTenant !== undefined && known(d.targetTenant)) {
      // REPLACED, not mutated in place like the fields around it: a row restored
      // from SEED_DISCUSSIONS is a shallow `{ ...seed }`, so its `anchor` is the
      // seed constant's own object — writing through it would rewrite the seed.
      d.anchor = { ...d.anchor, ref: { ...d.anchor.ref, id: tenantName(d.targetTenant) } }
    }
    for (const p of d.posts) {
      if (known(p.authorTenant)) p.author = tenantName(p.authorTenant)
    }
  }
  for (const n of notifications) {
    if (n.actorTenant !== undefined && known(n.actorTenant)) n.actor = tenantName(n.actorTenant)
  }
  const live = new Set([...accounts.tenants.values()].map((t) => t.name))
  for (const [tenantId, names] of follows) {
    for (const n of names) if (!live.has(n)) names.delete(n)
    if (names.size === 0) follows.delete(tenantId)
  }
}

/** ── The inbox is a PROJECTION over acts, reconciled on load ─────────────────
 *  `NOTIFICATION_CAP`'s own contract calls the inbox "a pointer cache over acts
 *  that remain readable on their backlogs/profiles, not a second history" — so a
 *  pointer at an act that is gone is not history worth keeping, it is a false
 *  claim with a dead door. `deleteDiscussionPost` retracts a bell as the post is
 *  retracted; this is the same rule applied to a SNAPSHOT, which is where rows
 *  minted before that funnel existed still sit.
 *
 *  A discussion bell asserts exactly one thing — *a post landed in this thread* —
 *  so it can be checked. In order of what the row can prove:
 *    • its thread is gone → dissolved; the door 404s.
 *    • it names a POST (every row minted since `postId`) that no longer exists.
 *    • legacy rows name no post, but `notifyTenants` stamps `at` in the same
 *      tick as the post it announces — so a surviving post at that INSTANT is
 *      the act, and no surviving post there means the act was retracted before
 *      `postId` existed to say which one it was.
 *
 *  The timestamp is the right legacy key precisely because the NAME is not.
 *  Judging a legacy row by whether its `actor` still resolves swept two correct
 *  bells out of the owner's own store on first run: after a rename no legacy
 *  actor name resolves, which is the staleness this whole change exists to
 *  tolerate — it says nothing about whether the act happened. Erring is
 *  one-directional here: two posts inside the window make a deleted one's bell
 *  match its neighbour and survive, which is a stale bell (recoverable) rather
 *  than a destroyed one (not).
 *
 *  Scoped to bells carrying a `discussionId` — `work.*` / `proposal.*` rows
 *  point at acts this sweep cannot see. */
const LEGACY_BELL_WINDOW_MS = 2_000
function retractOrphanedBells(): void {
  const byId = new Map(discussions.map((d) => [d.id, d]))
  retractNotifications((n) => {
    if (n.discussionId === undefined) return false
    const d = byId.get(n.discussionId)
    if (d === undefined) return true
    if (n.postId !== undefined) return !d.posts.some((p) => p.id === n.postId)
    return !d.posts.some((p) => Math.abs(p.at - n.at) <= LEGACY_BELL_WINDOW_MS)
  })
}

/** Replace the in-memory state with a loaded snapshot (rehydrate on boot). The
 *  seed containers are mutated in place (SESSIONS / schedules are imported / fixed
 *  bindings), the rest reassigned, and the id counters restored so freshly minted
 *  ids continue past the persisted ones. */
function rehydrate(s: PersistedState): boolean {
  // The snapshot owns its world after first boot. Missing means historical demo;
  // the current environment must never reinterpret an established database.
  worldMode = s.initialWorld ?? 'demo'
  artifactRetirements.clear()
  for (const row of parseArtifactRetirements(s.artifactRetirements)) artifactRetirements.set(row.artifactId, row)
  artifactDeletionReceipts.clear()
  for (const [key, receipt] of s.artifactDeletionReceipts ?? []) artifactDeletionReceipts.set(key, receipt)
  artifactDeletionReviews.clear()
  const demoWorld = worldMode === 'demo'
  if (!demoWorld) {
    guardian.clear()
  }
  SESSIONS.splice(0, SESSIONS.length, ...s.sessions)
  const inputFlows = parseMcpInputFlows(s.mcpInputFlows)
  if (!validateMcpInputFlows(inputFlows, SESSIONS)) throw new Error('Persisted MCP input has invalid activity bindings.')
  mcpInputFlows.clear()
  for (const flow of inputFlows) mcpInputFlows.set(mcpInputFlowKey(flow.sessionId, flow.decisionId), flow)
  const interruptedMcp: Array<{ tenantId: string; connector: string }> = []
  for (const session of SESSIONS) {
    for (const message of session.messages ?? []) {
      for (const activity of message.toolActivities ?? []) {
        if (activity.status !== 'running' || !activity.mcp) continue
        activity.status = 'uncertain'
        activity.summary = 'The server restarted while this MCP call was running. It may have completed and will not be run again automatically.'
        activity.failure = { code: 'connector_unavailable', retryable: false }
        interruptedMcp.push({ tenantId: session.tenantId ?? defaultTenantId(), connector: activity.connector })
      }
    }
  }
  retiredSessionCreationIds = new Set(
    (s.retiredSessionCreationIds ?? []).filter(isSessionCreationId),
  )
  schedules.splice(0, schedules.length, ...s.schedules)
  // Legacy live runs relied on an in-memory completion timer, so a restart lost
  // their worker and must fail them closed. Execution-aware rows carry durable
  // attempt state and are deliberately left running: the routine worker resumes
  // them from `nextAttemptAt` after rehydrate.
  for (const task of schedules) {
    for (const run of task.runs) {
      // Older durable runs used `{ artifactName, tools }`. Snapshot admission
      // validates both shapes; runtime owns only the detached canonical form so
      // a resumed attempt never executes against legacy object semantics.
      if (run.execution && Object.hasOwn(run.execution, 'standing')) {
        const standing = parseScheduleStanding(run.execution.standing)
        if (standing) run.execution.standing = standing
      }
      if (run.status === 'running' && run.id.startsWith('run-live-') && run.maxAttempts === undefined) {
        run.status = 'failed'
        run.duration = run.duration === '—' ? '0s' : run.duration
        run.summary = 'Interrupted by a server restart'
      }
    }
  }
  contextRegistry.rehydrate({
    savedContexts: s.savedContexts,
    defaultRecents: s.recents,
    tenantRecents: s.recentsByTenant,
  })
  mcpConnectionRegistry.rehydrate(s.mcpConnections)
  const activityAuthorities = parseMcpActivityAuthorities(s.mcpActivityAuthorities)
  if (!validateMcpActivityAuthorities(activityAuthorities, SESSIONS, mcpConnectionRegistry.snapshot())) {
    throw new Error('Persisted MCP activity authority has invalid owner or activity bindings.')
  }
  mcpActivityAuthorities.clear()
  for (const row of activityAuthorities) mcpActivityAuthorities.set(mcpActivityAuthorityKey(row.sessionId, row.activityId), row)
  routineMcpRegistry.replace(s.routineMcp ?? { policies: [], runs: [], decisions: [] })
  if (!validateRoutineMcpRegistryJoins(routineMcpRegistry.snapshot(), schedules, defaultTenantId())) {
    throw new Error('Persisted Routine MCP state has invalid owner or run bindings.')
  }
  // Merge over an empty graph so a snapshot written before a slice existed (e.g.
  // projectInstructions) gains it as an empty map rather than `undefined`. Runtime
  // artifacts persisted before tenant stamping belong to the default namespace;
  // code-owned demo seeds intentionally remain unstamped because `seedVisibleTo`
  // exposes that flagship dataset to both faces of the default seat.
  const seedArtifactIds = new Set(baseArtifacts().map((artifact) => artifact.id))
  let recoveredArtifactExcerpts = false
  graph = {
    ...emptyGraph(),
    ...s.graph,
    extraArtifacts: (s.graph.extraArtifacts ?? []).map((artifact) => {
      // The direct-create namespace has never accepted caller synopses. Only
      // that provable legacy case can recover intent; old consent saves cannot.
      const derived = artifact.excerptSource === undefined && isArtifactCreationId(artifact.id)
      recoveredArtifactExcerpts ||= derived
      return {
        ...artifact,
        ...(artifact.tenantId === undefined && !seedArtifactIds.has(artifact.id)
          ? { tenantId: defaultTenantId() } : {}),
        ...(derived ? { excerptSource: 'body' as const } : {}),
      }
    }),
  }
  sessionContextBindings.clear()
  for (const [k, v] of s.bindings) sessionContextBindings.set(k, v)
  sessionWorkspaces.clear()
  for (const [k, v] of s.workspaces) sessionWorkspaces.set(k, v)
  imageAssets = rehydrateImageAssets(s.imageAssets)
  // The Agent Commons registries (D6/D9/D10/D7). Each is replaced only when the
  // snapshot carries it, so a pre-v4-shaped snapshot keeps the seeded set rather
  // than wiping it (defensive — a v4 snapshot always writes all five).
  replaceMap(MODEL_PROVIDERS, s.providers)
  replaceMap(PROVIDER_CONFIGS, s.providerConfigs)
  // Reconcile the SEEDED providers against an older snapshot (the P9 re-stamp
  // rule — seed rows and their catalogs are CODE-owned): a pre-seed snapshot
  // gains a missing seed row (+ its server-only config), and a pre-catalog
  // snapshot regains the seed's model catalog. A snapshot that carries its own
  // catalog (a runtime refresh) or runtime edits wins over the seed; a runtime
  // DELETE of a seed therefore lasts only until the next restart — the same
  // mock semantics as seed sessions.
  const providerSeeds = demoWorld ? SEED_PROVIDERS : [DEFAULT_PROVIDER]
  for (const seed of providerSeeds) {
    const restored = MODEL_PROVIDERS.get(seed.id)
    if (!restored) MODEL_PROVIDERS.set(seed.id, seed)
    else if (!restored.models && seed.models) {
      MODEL_PROVIDERS.set(seed.id, { ...restored, models: seed.models, catalogSource: seed.catalogSource })
    }
  }
  const providerConfigSeeds = demoWorld
    ? SEED_PROVIDER_CONFIGS
    : [[DEFAULT_PROVIDER.id, DEFAULT_PROVIDER_CONFIG] as [string, ProviderConfig]]
  for (const [id, config] of providerConfigSeeds) {
    if (!PROVIDER_CONFIGS.has(id) && MODEL_PROVIDERS.has(id)) PROVIDER_CONFIGS.set(id, config)
  }
  // A relay's tool-use capability is the MAILBOX's — code-owned, like the seed
  // stamps above. A pre-v2 snapshot minted its Session providers `toolUse:false`
  // (the prose-only mailbox); the v2 framed mailbox relays tool calls, so restored
  // session configs are normalised up rather than pinning old relays to a
  // capability the code no longer has.
  for (const [id, config] of PROVIDER_CONFIGS) {
    if (config.kind === 'session' && config.capabilities?.toolUse !== true) {
      PROVIDER_CONFIGS.set(id, { ...config, capabilities: { ...config.capabilities, toolUse: true } })
    }
  }
  replaceMap(SYSTEM_PROMPT_LIB, s.systemPrompts)
  replaceMap(REGISTRY_DEFAULTS, s.registryDefaults)
  replaceMap(WORKER_AGENTS, s.agents)
  agentOwnershipRegistry.rehydrate(s.agentOwnership)
  proxyRequestRegistry.rehydrate(s.agentRequests)
  const recoveredAgentRequests = proxyRequestRegistry.recover(Date.now())
  retiredAgentCreationIds = new Set(
    (s.retiredAgentCreationIds ?? []).filter(isAgentCreationId),
  )
  replaceMap(COMMISSIONS, s.commissions)
  // D13 commission caps overlay onto the (re-seeded) Projects: clear any seed cap, then
  // re-apply the snapshot's, so a cap that was removed at runtime stays removed.
  for (const p of baseProjects()) p.commissionCap = undefined
  if (s.commissionCaps) {
    for (const [id, cap] of s.commissionCaps) {
      const p = baseProjects().find((x) => x.id === id)
      if (p) p.commissionCap = cap
    }
  }
  // D14 default contributor roles — the caps' twin overlay (cleared, then re-applied,
  // so a preference cleared at runtime stays cleared).
  for (const p of baseProjects()) p.defaultRole = undefined
  if (s.projectDefaultRoles) {
    for (const [id, role] of s.projectDefaultRoles) {
      const p = baseProjects().find((x) => x.id === id)
      if (p) p.defaultRole = role
    }
  }
  // D15/OQ7 audit trail — restore the append-only log (empty for a pre-field snapshot).
  auditLog.splice(0, auditLog.length, ...(s.auditLog ?? []))
  // P7 dispatch runs — restore the feed (keep the seed for a pre-field snapshot). Same
  // crash-recovery sweep as the routine scheduler: a LIVE-minted run ('d-new-*') left
  // 'running' when the process died has no completing timer anymore, so it'd be stuck
  // in-flight forever — settle it to 'failed'. Seed runs (d1/d2/d3), 'running' for visual
  // variety, aren't live-minted, so they're left alone.
  if (s.dispatch) dispatch.splice(0, dispatch.length, ...s.dispatch)
  let recoveredDispatch = false
  for (const run of dispatch) {
    if (run.status === 'running' && run.id.startsWith('d-new-')) {
      run.status = 'failed'
      if (run.execution) run.execution.state = 'interrupted'
      else run.detail = 'Interrupted by a server restart'
      recoveredDispatch = true
    }
  }
  // Seed reconciliation (the P9 rule — CODE seeds are authoritative): a snapshot
  // written by an older build carries the OLD seed shape — rows without the demo
  // accounts' tenant stamps, or missing rows a newer build added. Re-ensure every
  // code-seed row exists and wears the code's tenant; everything else the
  // snapshot says about a seed row (messages, appended runs, toggles) is kept.
  if (demoWorld) {
    reconcileSeedTenancy(SESSIONS, SEED_SESSIONS)
    reconcileSeedTenancy(schedules, SCHEDULED_TASKS)
    reconcileSeedTenancy(dispatch, DISPATCH_RUNS)
  }
  // Same P9 rule for the default Agent's explicit provider binding: a snapshot
  // written before the seed carried `providerId` restores it unbound (the card
  // would read "no provider bound"); the code seed is authoritative — backfill.
  const seededAgent = WORKER_AGENTS.get(DEFAULT_AGENT.id)
  if (seededAgent && !seededAgent.providerId) {
    WORKER_AGENTS.set(DEFAULT_AGENT.id, { ...seededAgent, providerId: DEFAULT_AGENT.providerId })
  }
  // The account registry (multi-account P7): restore onboarded accounts. A demo
  // snapshot re-ensures its switcher directory; a clean snapshot re-ensures only
  // the local device owner.
  accounts.rehydrate(
    {
      users: s.accountUsers,
      tenants: s.accountTenants,
      memberships: s.memberships,
      orgInvites: s.orgInvites,
      apiTokens: s.apiTokens,
      apiTokenMintReceipts: s.apiTokenMintReceipts,
      seq: { user: s.seq.user, tenant: s.seq.tenant, orgInvite: s.seq.orgInvite },
    },
    { demoSeeds: demoWorld, localSeed: demoWorld || NATIVE },
  )
  // The leaf persistence format can enforce owner equality for stamped Sessions,
  // but legacy rows without tenantId inherit this store's runtime default. Resolve
  // that owner only after seed/account reconciliation, before admitting the state.
  const sessionsById = new Map(SESSIONS.map((session) => [session.id, session]))
  for (const [sessionId, workspace] of sessionWorkspaces) {
    const session = sessionsById.get(sessionId)
    for (const attachment of workspace.attachments ?? []) {
      const snapshot = attachment.imageSnapshot
      if (!snapshot) continue
      const ownerTenant = session?.tenantId ?? defaultTenantId()
      const asset = imageAssets.get(snapshot.image.id)
      if (!session || !isServedImageSnapshot(snapshot) || !asset || asset.tenantId !== ownerTenant ||
          !imageAssetRefMatches(snapshot.image, asset.image, asset.original)) {
        throw new Error('Invalid served image receipt ownership in persisted workspace.')
      }
    }
  }
  usageRegistry.rehydrate(s.usageMeters, demoWorld)
  usageRegistry.rehydrateReservations(s.usageReservations)
  const recoveredUsageReservations = usageRegistry.recoverReservations()
  rehydrateModelPreferences(s.modelPreferences)
  const knownUsers = new Set(accounts.toPersisted().users.map(([id]) => id))
  rehydrateSessionPreferences(s.sessionPreferences, (userId, sessionId) => {
    if (!knownUsers.has(userId)) return undefined
    const session = SESSIONS.find((row) => row.id === sessionId)
    if (!session) return undefined
    return sessionWorkspaces.get(sessionId) ?? workspaceFromSeed(session)
  })
  sessionSeq = s.seq.session
  messageSeq = s.seq.message
  scheduleSeq = s.seq.schedule
  runSeq = s.seq.run
  artifactSeq = s.seq.artifact
  // The registry counters (default to the seed counter for a pre-v4 snapshot, so a
  // post-boot mint still lands past the seeds).
  providerSeq = s.seq.provider ?? providerSeq
  systemPromptSeq = s.seq.systemPrompt ?? systemPromptSeq
  workerAgentSeq = s.seq.agent ?? workerAgentSeq
  commissionSeq = s.seq.commission ?? commissionSeq
  // Restore the audit counter past the persisted ids (fall back to the trail length so a
  // pre-field snapshot's freshly minted ids never collide with restored ones).
  auditSeq = s.seq.audit ?? auditLog.length
  for (const recovered of interruptedMcp) {
    auditLog.push({
      id: `audit-${(auditSeq += 1)}`,
      tenantId: recovered.tenantId,
      channel: 'proxy',
      capability: 'mcp.call',
      target: recovered.connector,
      outcome: 'uncertain',
      at: Date.now(),
    })
  }
  // Dispatch counter (fall back to the seed counter for a pre-field snapshot).
  dispatchSeq = s.seq.dispatch ?? dispatchSeq
  // D19 open work — restore the backlog (empty for a pre-field snapshot); counter falls
  // back to the backlog length so freshly minted ids never collide with restored ones.
  openSubGoals.splice(0, openSubGoals.length, ...(s.openSubGoals ?? []).map(stripStoredCommissionResolution))
  openSubGoalSeq = s.seq.openSubGoal ?? openSubGoals.length
  commissionMcpRegistry.replace(s.commissionMcp ?? emptyCommissionMcpRegistry())
  if (!validateCommissionMcpRegistryJoins(commissionMcpRegistry.snapshot(), {
    commissions: [...COMMISSIONS.values()], agents: [...WORKER_AGENTS.values()], work: openSubGoals,
    connections: mcpConnectionRegistry.snapshot(), defaultTenantId: defaultTenantId(),
    projectIds: new Set([...baseProjects(), ...graph.extraProjects].map(project => project.id)),
  })) throw new Error('Persisted Commission MCP state has invalid owner, work or connection bindings.')
  const recoveredCommissionMcp = commissionMcpRegistry.recover(Date.now())
  // Phase A contributions — restore the ledgers (empty for a pre-field snapshot).
  // The counter's fallback floor is rows + ALL their events, not rows alone: the
  // shared seq mints contribution ids AND event ids (each row consumed ≥2), so a
  // length floor could re-mint a restored id (review finding, 2026-07-20).
  // (Envelope-line and changeset-entry ids consume the seq too and are NOT
  // counted here — latent-only: the fallback fires only for a snapshot with no
  // `seq.contribution`, which predates both features; every writer persists it.)
  contributions.splice(0, contributions.length, ...(s.contributions ?? []))
  activeContributionReviews.clear()
  activeDelegatedJudgments.clear()
  activeContributionEffects.clear()
  let recoveredContributionAttempts = false
  for (const contribution of contributions) {
    contribution.effectAttempts = contribution.effectAttempts?.map((run) => {
      if (run.status !== 'pending') return run
      recoveredContributionAttempts = true
      return interruptContributionEffectAttempt(run, Math.max(Date.now(), run.startedAt))
    })
    for (const run of contribution.judgmentAttempts ?? []) {
      if (run.status !== 'pending') continue
      run.status = 'uncertain'
      run.finishedAt = Math.max(Date.now(), run.startedAt)
      recoveredContributionAttempts = true
    }
    for (const run of contribution.reviewAttempts ?? []) {
      if (run.status !== 'pending') continue
      run.status = 'uncertain'
      run.finishedAt = Math.max(Date.now(), run.startedAt)
      recoveredContributionAttempts = true
    }
  }
  contributionSeq = s.seq.contribution ?? contributions.reduce((m, c) => m + 1 + c.events.length, 0)
  // Phase F delegations — same restore shape (each row consumes exactly one id).
  delegations.splice(0, delegations.length, ...(s.delegations ?? []))
  delegationRetirements.splice(0, delegationRetirements.length, ...(s.delegationRetirements ?? []))
  delegationSeq = s.seq.delegation ?? delegations.length
  // Social S1 grants — same restore shape (each row consumes exactly one id).
  // Seed rows are CODE-owned (the providers-reconcile rule): a snapshot missing
  // a seed grant regains it on load — so a runtime revoke of a seed lasts only
  // until the next restart (the seed-sessions mock semantics), and a snapshot
  // written by a pre-seed build can't erase the demo scene.
  grants.splice(0, grants.length, ...(s.grants ?? []))
  if (demoWorld) {
    for (const seed of SEED_GRANTS) {
      if (!grants.some((g) => g.id === seed.id)) grants.push({ ...seed })
    }
  }
  grantSeq = s.seq.grant ?? grants.filter((g) => !g.id.startsWith('grant-seed-')).length
  // Social S2 discussions — same restore shape (ids consume the shared counter),
  // and seed threads are CODE-owned exactly like the seed grants above: a
  // snapshot written by a pre-seed build can't leave the demo scene mute.
  discussions.splice(0, discussions.length, ...(s.discussions ?? []))
  if (demoWorld) {
    for (const seed of SEED_DISCUSSIONS) {
      if (!discussions.some((d) => d.id === seed.id)) {
        discussions.push({ ...seed, posts: seed.posts.map((p) => ({ ...p, reactedBy: [...p.reactedBy] })) })
      }
    }
  }
  discussionSeq =
    s.seq.discussion ??
    discussions.filter((d) => !d.id.startsWith('disc-seed-')).reduce((m, d) => m + 1 + d.posts.length, 0)
  // Social S3 proposals — same restore shape.
  socialProposals.splice(0, socialProposals.length, ...(s.socialProposals ?? []))
  socialProposalSeq = s.seq.socialProposal ?? socialProposals.length
  // Social S3 artifact bodies — the edits laid over the authored fixture. A
  // pre-field snapshot restores with none, i.e. every body at its seed text.
  artifactBodies.clear()
  for (const [id, body] of s.artifactBodies ?? []) artifactBodies.set(id, body)
  artifactHistory.clear()
  for (const [id, versions] of s.artifactHistory ?? []) artifactHistory.set(id, versions)
  artifactHistoryRestoreReceipts.clear()
  for (const [key, receipt] of s.artifactHistoryRestoreReceipts ?? []) artifactHistoryRestoreReceipts.set(key, receipt)
  artifactMetadata.clear()
  for (const [id, metadata] of parseArtifactMetadataEntries(s.artifactMetadata)) artifactMetadata.set(id, metadata)
  artifactLifecycle.clear()
  for (const [id, lifecycle] of parseArtifactLifecycleEntries(s.artifactLifecycle)) artifactLifecycle.set(id, lifecycle)
  const bodyMatchesArtifactKind = (artifact: ArtifactItem, body: ArtifactContent): boolean =>
    artifact.kind === 'doc' || artifact.kind === 'email'
      ? body.type === 'doc'
      : artifact.kind === 'sheet'
        ? body.type === 'sheet' || body.type === 'workbook'
        : artifact.kind === 'slide' && body.type === 'slides'
  for (const [id, versions] of artifactHistory) {
    const artifact = retainedArtifact(id)
    if (!artifact || versions.some((version) => !bodyMatchesArtifactKind(artifact, { ...version.body, revision: version.revision } as ArtifactContent))) {
      throw new Error('Persisted Artifact history references an unknown Artifact or incompatible body kind.')
    }
  }
  for (const receipt of artifactHistoryRestoreReceipts.values()) {
    const artifact = retainedArtifact(receipt.artifactId)
    if (!artifact || !store.artifactOwnedBy(artifact, receipt.tenantId)) {
      throw new Error('Persisted Artifact restore receipt has no matching owner authority.')
    }
  }
  // S5 mutes — same restore shape.
  mutes.clear()
  for (const [t, names] of s.mutes ?? []) mutes.set(t, new Set(names))
  // S7 follows + read marks — same restore shape (a pre-field snapshot loads
  // cleanly with nobody followed and everything unread).
  follows.clear()
  for (const [t, names] of s.follows ?? []) follows.set(t, new Set(names))
  // Re-ensure the seed graph, exactly as the seed grants and threads are: a
  // snapshot written before S7 must not boot into a world where the demo's one
  // follow relationship silently vanished. Additive — a runtime unfollow of a
  // seeded name is the one thing this would undo, and a cold start is a reset.
  if (demoWorld) {
    for (const [t, names] of SEED_FOLLOWS) {
      const set = follows.get(t) ?? new Set<string>()
      for (const n of names) set.add(n)
      follows.set(t, set)
    }
  }
  discussionReads.clear()
  for (const [t, marks] of s.discussionReads ?? []) discussionReads.set(t, new Map(marks))
  // D24 — watches + the inbox (empty for a pre-field snapshot); counter falls back
  // to the inbox length so freshly minted ids never collide with restored ones.
  watches.clear()
  for (const [tenantId, subject] of s.watches ?? []) {
    // A pre-generalization snapshot stored the bare PROJECT id; a key without a
    // kind prefix is one of those (ids themselves never contain ':').
    const key = subject.includes(':') ? subject : watchKey(projectRef(subject))
    const set = watches.get(key) ?? new Set<string>()
    set.add(tenantId)
    watches.set(key, set)
  }
  // The Commons lenses (no-ops for a pre-field snapshot).
  commonsLikes.clear()
  for (const [tenantId, itemId] of s.commonsLikes ?? []) {
    const set = commonsLikes.get(itemId) ?? new Set<string>()
    set.add(tenantId)
    commonsLikes.set(itemId, set)
  }
  views.clear()
  for (const [tenantId, kind, id, at] of s.views ?? []) {
    const rows = views.get(tenantId) ?? []
    rows.push({ key: `${kind}:${id}`, kind: kind as SocialEntityKind, id, at })
    views.set(tenantId, rows)
  }
  // Newest first + capped at read, like every other restored list: a snapshot
  // written by an older cap must not resurrect a longer history.
  for (const [t, rows] of views) views.set(t, rows.sort((a, b) => b.at - a.at).slice(0, MAX_VIEWS_PER_TENANT))
  notifications.splice(0, notifications.length, ...(s.notifications ?? []))
  notificationSeq = s.seq.notification ?? notifications.length
  replaceMap(AGENT_PROPOSALS, s.agentProposals) // D25 (no-op for a pre-field snapshot)
  replaceMap(A2A_PEERS, s.a2aPeers) // D28 (no-op for a pre-field snapshot)
  a2aPeerSeq = A2A_PEERS.size // ids are `peer-N`; size floors the counter safely past restores
  // LAST: every restored display name is a cache, and this re-derives (and
  // prunes) across the account registry, the grants, the threads, the follows
  // and the inbox — so it runs once, after all of them are loaded. The bell
  // sweep runs after it, so a row whose name was just re-derived is judged by
  // the name it actually wears now.
  // BEFORE the name refresh: a legacy DM missing its addressee id gets one back
  // from its own posts, so the refresh below has an id to re-derive the stale
  // anchor name from (without it the addressee stays locked out of her own
  // conversation and her bell is a dead door).
  recoverDmParties(discussions)
  // …then the bells pointing at those threads, which need the parties above to
  // have been recovered first. Both run before the name refresh, which is what
  // turns the recovered ids back into the names a reader actually sees.
  recoverBellActors(notifications, discussions)
  // A resource bell cannot infer its actor from the thread, but the six retired
  // seed aliases are frozen history rather than an arbitrary-name guess.
  recoverSeedBellActors(notifications)
  refreshStoredNames()
  retractOrphanedBells()
  // Run sessions are ordinary persisted rows, but a snapshot written before they
  // were (or one whose 'running' run was just swept to 'failed' above) can miss a
  // row or its recap — re-materialize through the same funnel, idempotently.
  materializeRunSessions()
  let recoveredRoutineMcp = false
  for (const ledger of routineMcpRegistry.snapshot().runs) {
    if (ledger.calls.length === 0 || ledger.phase === 'interrupted') continue
    const task = schedules.find(task => task.id === ledger.permission.routineId)!
    const run = task.runs.find(run => run.id === ledger.runId)!
    if (run.status !== 'running' && !ledger.calls.some(call => call.status === 'pending')) continue
    routineMcpRegistry.setRun(interruptRoutineMcpRun(ledger, Date.now()))
    routineMcpRegistry.suspend(ledger.permission.tenantId, task.id)
    task.enabled = false
    task.revision = (task.revision ?? 0) + 1
    delete task.nextFireAt
    task.next = 'Paused — review external calls'
    store.failScheduleRun(task.id, run.id, 'execution_error',
      'Interrupted after an external MCP attempt. Its effects may already exist. Review the call receipts before approving and enabling this Routine again.')
    recoveredRoutineMcp = true
  }
  const standingRecovery = pruneOrphanScheduleStanding(graph, schedules, defaultTenantId())
  graph = standingRecovery.graph
  return interruptedMcp.length > 0 || standingRecovery.changed || recoveredArtifactExcerpts || recoveredContributionAttempts || recoveredDispatch || recoveredRoutineMcp || recoveredCommissionMcp || recoveredUsageReservations || recoveredAgentRequests
}

/** Re-ensure the code's seed rows after a snapshot restore: a seed row missing
 *  from the snapshot (added by a newer build) is re-added; a present one gets
 *  the CODE's tenant stamp (tenancy is code-owned — the demo accounts' data
 *  split must not be undone by a pre-split snapshot). Runtime rows and runtime
 *  mutations to seed rows are untouched. Exported for its unit lock
 *  (server/data/demo-accounts.test.ts); rehydrate is the one runtime caller. */
export function reconcileSeedTenancy<T extends { id: string; tenantId?: string }>(live: T[], seeds: readonly T[]): void {
  for (const seed of seeds) {
    const got = live.find((r) => r.id === seed.id)
    if (!got) live.push(JSON.parse(JSON.stringify(seed)) as T)
    else if (seed.tenantId) got.tenantId = seed.tenantId
    else delete got.tenantId
  }
}

/** Replace a registry Map's contents from a snapshot's entry array, in place. A
 *  no-op when the snapshot omits the slice (a pre-v4 file), so the seeded set
 *  survives rather than being wiped to empty. */
function replaceMap<V>(map: Map<string, V>, entries?: [string, V][]): void {
  if (!entries) return
  map.clear()
  for (const [k, v] of entries) map.set(k, v)
}

/** Apply a routine's standing-approved effects on a run — the edits a user approved
 *  once, in advance, that now execute unprompted each run (the schedule is the unit
 *  of standing approval; docs/shared-resource-coordination.md). Today that's the
 *  "save <artifact> each run" approval (graph.scheduleArtifact): the run refreshes the
 *  routine's one delivered artifact and broadcasts `relation.applied` by:'standing' —
 *  a graph edit nobody confirmed *this* run, because it was pre-authorized. No
 *  standing approval on the routine → nothing happens.
 *
 *  Exactly one artifact is bound to the routine's stable id. Its body, synopsis,
 *  and latest run provenance publish in the enclosing terminal-run transaction;
 *  user filing and grants remain independent. Never adopt an ordinary authored
 *  document merely because its display name/source happens to match. */
function applyStandingEffects(task: ScheduledTask, sessionId: string, spec: ScheduledArtifactSpec, authored: AuthoredArtifact, at: number): void {
  const source = `Scheduled run of ${task.name}`
  const ownerTenantId = task.tenantId ?? defaultTenantId()
  const op: RelationOp = {
    kind: 'save-artifact',
    artifact: { name: spec.name, kind: spec.kind, meta: `Saved by ${task.name}`, excerpt: authored.excerpt },
    sessionId,
    sessionTitle: source,
    projectId: task.projectId,
    ownerTenantId,
  }
  const owned = graph.extraArtifacts.filter((artifact) => artifact.tenantId === ownerTenantId)
  const runSessions = new Set(task.runs.map((run) => runSessionId(task.id, run.id)))
  const existing = owned.find((artifact) => artifact.sourceScheduleId === task.id) ??
    // Upgrade only a metadata-only legacy delivery with an exact retained run
    // join. Missing/expired provenance cannot confer overwrite authority.
    owned.find((artifact) => spec.kind === 'doc' && !artifact.sourceScheduleId && artifact.kind === 'doc' &&
      artifact.name === spec.name && artifact.source === source &&
      artifact.sourceSessionId !== undefined && runSessions.has(artifact.sourceSessionId) &&
      !artifactBodies.has(artifact.id))
  if (!existing && [...artifactRetirements.values()].some((row) => row.tenantId === ownerTenantId && row.sourceScheduleId === task.id)) {
    throw new ConflictError('This routine’s saved Artifact was permanently deleted; it cannot create another output.')
  }
  const id = existing?.id ?? mintArtifactId()
  if (artifactIsTrashed(id)) throw new ConflictError('Restore this routine’s saved artifact from Trash before running it again.')
  const priorBody = existing ? retainedArtifactBody(id) : undefined
  // A newly created artifact begins at revision 0. A metadata-only legacy row
  // is already an identity the routine is adopting, so its first materialized
  // body is revision 1 even though no pre-existing bytes can be archived.
  const nextBodyRevision = priorBody ? (priorBody.revision ?? 0) + 1 : existing ? 1 : 0
  const bodyEditedAt = existing ? Math.max(at, existing.editedAt) : at
  if (priorBody && (priorBody.revision ?? 0) >= Number.MAX_SAFE_INTEGER) {
    throw new ConflictError('This routine artifact cannot accept another body revision.')
  }
  const nextBody = identifyDocumentBody(id, { ...authored.body, revision: nextBodyRevision })
  const nextHistory = priorBody
    ? prepareArtifactHistoryAppend(id, priorBody, nextBody, new Date(bodyEditedAt).toISOString(), 'edit', undefined, artifactHistory.get(id))
    : undefined
  const delivered: ArtifactItem = {
    ...artifactFromDraft(op.artifact, id, source, existing?.projectId ?? task.projectId ?? '',
      existing ? Math.max(at, existing.editedAt) : at, sessionId, ownerTenantId),
    sourceScheduleId: task.id,
    excerptSource: 'body',
    ...(existing ? { saveOrigin: existing.saveOrigin ?? { name: existing.name, source: existing.source } } : {}),
  }
  if (existing) {
    graph = {
      ...graph,
      extraArtifacts: graph.extraArtifacts.map((artifact) => artifact.id === id ? delivered : artifact),
    }
  } else {
    // The interactive reducer's name/source replay guard is not the identity
    // of a standing delivery. Distinct routines may legitimately share both.
    graph = {
      ...graph,
      extraArtifacts: [delivered, ...graph.extraArtifacts],
      artifactProject: delivered.projectId
        ? { ...graph.artifactProject, [id]: delivered.projectId } : graph.artifactProject,
    }
  }
  artifactBodies.set(id, nextBody)
  if (nextHistory) artifactHistory.set(id, nextHistory)
  graph = { ...graph, revision: (graph.revision ?? 0) + 1 }
  // Readers fetch the body through its read wall; private relation payloads do
  // not need to carry a second copy of the generated report.
  emit({ type: 'artifact.changed', artifactId: id })
  emit({ type: 'relation.applied', op, by: 'standing', tenantId: ownerTenantId })
}

/** Format conversion needs a separate identity policy. Until that is chosen,
 * refuse it without altering either the existing output or its standing grant.
 * Check again at execution/publication to cover older stores and late changes. */
function scheduleArtifactFormatFailure(task: ScheduledTask, spec: ScheduledArtifactSpec | null | undefined): string | undefined {
  if (!spec) return undefined
  const existing = graph.extraArtifacts.find((artifact) => artifact.sourceScheduleId === task.id &&
    (artifact.tenantId ?? defaultTenantId()) === (task.tenantId ?? defaultTenantId()))
  if (!existing && [...artifactRetirements.values()].some((row) => row.tenantId === (task.tenantId ?? defaultTenantId()) && row.sourceScheduleId === task.id)) {
    return 'This routine’s saved Artifact was permanently deleted; its output binding is retired.'
  }
  if (existing && artifactIsTrashed(existing.id)) return 'This routine’s saved artifact is in Trash. Restore it before running again; its saved content was not changed.'
  return existing && existing.kind !== spec.kind
    ? 'This routine already has a saved artifact in a different format. Keep its current format for now; its saved artifact was not changed.'
    : undefined
}

function sameServedSnapshot(a: ServedTextSnapshot, b: ServedTextSnapshot): boolean {
  if (a.version !== b.version || a.snapshotId !== b.snapshotId || a.capturedAt !== b.capturedAt ||
      a.sourceId !== b.sourceId || a.path !== b.path || a.text !== b.text) return false
  if (a.version === 1 || b.version === 1) return a.version === b.version
  return a.documentImport.format === b.documentImport.format && a.documentImport.status === b.documentImport.status &&
    (a.documentImport.format !== 'pdf' || (b.documentImport.format === 'pdf' &&
      a.documentImport.pages === b.documentImport.pages && a.documentImport.textPages === b.documentImport.textPages))
}

function sameServedImageSnapshot(a: ServedImageSnapshot, b: ServedImageSnapshot): boolean {
  return a.version === b.version && a.snapshotId === b.snapshotId && a.capturedAt === b.capturedAt &&
    a.sourceId === b.sourceId && a.path === b.path && a.image.id === b.image.id &&
    a.image.mimeType === b.image.mimeType && a.image.width === b.image.width &&
    a.image.height === b.image.height && a.image.byteLength === b.image.byteLength
}

/** First attachment may arrive with its renderer-captured image already saved.
 * Admit only its own tenant asset and a still-current exact-path read grant;
 * an existing same-key receipt is projection/replay data, not new authority. */
function canAdmitServedImageSnapshot(
  sessionId: string,
  attachment: import('../../contract/entities.ts').Attachment,
): boolean {
  const snapshot = attachment.imageSnapshot
  if (!snapshot || !isServedImageSnapshot(snapshot) ||
      attachment.id !== fsRecentKey(snapshot.sourceId, snapshot.path) ||
      attachment.source?.id !== snapshot.sourceId ||
      attachment.source.kind !== (snapshot.sourceId === 'cloud' ? 'cloud' : 'runner')) return false
  const session = SESSIONS.find((candidate) => candidate.id === sessionId)
  const tenantId = session?.tenantId ?? defaultTenantId()
  const asset = imageAssets.get(snapshot.image.id)
  return !!asset && asset.tenantId === tenantId && imageAssetRefMatches(snapshot.image, asset.image, asset.original) &&
    store.fsReadPermitted(snapshot.sourceId, snapshot.path)
}

/** Capture only through the destination owner's current source-read wall.
 * This synchronous projection commits no state until the whole context validates. */
function captureDiscussionContext(sessionId: string, attachmentId: string, snapshotId: string, requesterTenantId?: string): import('../../contract/entities.ts').Attachment {
  const session = store.getSession(sessionId)
  const discussionId = discussionIdFromContextId(attachmentId)
  if (!session || !discussionId) throw new NotFoundError('This discussion is unavailable.')
  if (requesterTenantId && !store.sessionOwnedBy(session, requesterTenantId)) throw new NotFoundError('This discussion is unavailable.')
  const discussion = store.getDiscussion(discussionId, requesterTenantId ?? session.tenantId ?? defaultTenantId())
  if (!discussion) throw new NotFoundError('This discussion is unavailable.')
  const snapshot = buildDiscussionSnapshot(discussion, snapshotId, new Date().toISOString())
  if (!snapshot) throw new ValidationError('Could not capture a complete discussion of 64 KB or less. The saved copy is unchanged.')
  return { id: attachmentId, kind: 'discussion', label: snapshot.title, discussionSnapshot: snapshot }
}

/** Capture only an exact current Artifact body behind its current read wall.
 * No metadata excerpt, compatibility name key, or client body can substitute. */
function captureArtifactContext(sessionId: string, attachmentId: string, snapshotId: string, requesterTenantId?: string): import('../../contract/entities.ts').Attachment {
  const session = store.getSession(sessionId)
  const artifactId = artifactIdFromContextId(attachmentId)
  if (!session || !artifactId) throw new NotFoundError('This Artifact is unavailable.')
  if (requesterTenantId && !store.sessionOwnedBy(session, requesterTenantId)) throw new NotFoundError('This Artifact is unavailable.')
  const tenantId = requesterTenantId ?? session.tenantId ?? defaultTenantId()
  const source = store.artifactSnapshotSource(artifactId, tenantId)
  if (!source) throw new NotFoundError('This Artifact is unavailable.')
  if ('unsupported' in source) throw new ValidationError('This Artifact has no supported saved body to copy.')
  const snapshot = buildArtifactSnapshot(source, snapshotId, new Date().toISOString())
  if (!snapshot) throw new ValidationError('Could not capture this complete supported Artifact body within the 64 KB limit. The saved copy is unchanged.')
  return { id: attachmentId, kind: 'artifact', label: snapshot.title, artifactSnapshot: snapshot }
}

/** Keep a store-owned saved-copy receipt monotonic across workspace projections.
 * Only the refresh commit path may name the one row whose saved copy is replaced. */
function preserveSessionWorkspaceSnapshots(
  sessionId: string,
  workspace: SessionWorkspace,
  refreshAttachmentId?: string,
  refreshFolderId?: string,
  refreshLocalFolderId?: string,
  refreshLocalGitFolderId?: string,
  captureTenantId?: string,
): SessionWorkspace {
  if (!validWorkspaceFolders(workspace.workspaces)) throw new ValidationError('Folder snapshots must match their attached source and identity.')
  const previousAttachments = new Map((sessionWorkspaces.get(sessionId)?.attachments ?? []).map((item) => [item.id, item]))
  const previousFolders = new Map((sessionWorkspaces.get(sessionId)?.workspaces ?? []).flatMap(workspaceFolders).map((item) => [item.id, item]))
  return {
    ...workspace,
    workspaces: workspace.workspaces.map((item) => {
      let preserved = item
      for (const folder of workspaceFolders(item)) {
        const previous = previousFolders.get(folder.id)
        const served = previous?.snapshot
        const local = previous?.localSnapshot
        const git = previous?.gitSnapshot
        if (served && refreshFolderId !== folder.id) preserved = replaceServedFolderSnapshot(preserved, folder.id, served)
        if (local && refreshLocalFolderId !== folder.id) preserved = replaceLocalFolderSnapshot(preserved, folder.id, local)
        if (git && refreshLocalGitFolderId !== folder.id) preserved = replaceLocalGitSnapshot(preserved, folder.id, git)
      }
      return preserved
    }),
    attachments: workspace.attachments.map((item) => {
      const previous = previousAttachments.get(item.id)
      if (item.kind === 'discussion' || previous?.kind === 'discussion') {
        if (!isAttachmentInput(item) || item.kind !== 'discussion') throw new ValidationError('The discussion reference is invalid.')
        if (refreshAttachmentId === item.id) return item
        // Generic writes (including stale retries) cannot replace an owned copy.
        // Only the explicit Refresh door can acquire newer source text.
        if (previous?.discussionSnapshot) return previous
        if (!item.discussionCaptureId || item.discussionSnapshot) {
          throw new ValidationError('Attach the discussion from its source to create a saved copy.')
        }
        return captureDiscussionContext(sessionId, item.id, item.discussionCaptureId, captureTenantId)
      }
      if (item.kind === 'artifact' || previous?.kind === 'artifact') {
        if (!isAttachmentInput(item) || item.kind !== 'artifact') throw new ValidationError('The Artifact reference is invalid.')
        if (refreshAttachmentId === item.id) return item
        if (previous?.artifactSnapshot) return previous
        if (!item.artifactCaptureId || item.artifactSnapshot) {
          throw new ValidationError('Attach the Artifact from its source to create a saved copy.')
        }
        return captureArtifactContext(sessionId, item.id, item.artifactCaptureId, captureTenantId)
      }
      const savedText = previous?.textSnapshot
      const savedImage = previous?.imageSnapshot
      if (refreshAttachmentId === item.id) return item
      if (!savedText && !savedImage) {
        if (item.imageSnapshot && !canAdmitServedImageSnapshot(sessionId, item)) {
          throw new ValidationError('The saved image requires its current exact-path read grant and an image asset owned by this conversation.')
        }
        return item
      }
      const saved = savedText ?? savedImage!
      const expectedKind = saved.sourceId === 'cloud' ? 'cloud' : 'runner'
      if (item.id !== fsRecentKey(saved.sourceId, saved.path) || item.source?.id !== saved.sourceId ||
          item.source.kind !== expectedKind || (savedText && item.kind !== 'file')) {
        throw new ConflictError('This served attachment changed. Reopen the conversation before updating its context.')
      }
      const { previewText: _preview, previewUrl: _url, documentImport: _import, image: _image, imageSnapshot: _imageSnapshot,
        textSnapshot: _textSnapshot, ...metadata } = item
      return savedText
        ? { ...metadata, kind: previous!.kind, textSnapshot: savedText }
        : { ...metadata, kind: previous!.kind, imageSnapshot: savedImage }
    }),
  }
}

/** Private compound commit used by ordinary context updates and owner Refresh.
 * The refresh capability is deliberately not part of the exported store API. */
function commitSessionContextState(
  sessionId: string,
  operations: SessionContextOperation[],
  workspace: SessionWorkspace,
  refreshAttachmentId?: string,
  refreshFolderId?: string,
  refreshLocalFolderId?: string,
  refreshLocalGitFolderId?: string,
  captureTenantId?: string,
  actorUserId?: string,
): SessionContextState {
  let contexts = sessionContextBindings.get(sessionId) ?? []
  const originalContextIds = new Set(contexts.filter((context) => context.type === 'mcp').map((context) => context.id))
  const session = SESSIONS.find((candidate) => candidate.id === sessionId)
  const tenantId = session?.tenantId ?? defaultTenantId()
  const mcpState = mcpConnectionRegistry.snapshot()
  for (const operation of operations) {
    const contextId = operation.action === 'attach' ? operation.context.id : operation.contextId
    if (!isExternalMcpId(contextId)) continue
    if (operation.action === 'detach') {
      // OAuth attachments are deliberately hidden from non-owners in the
      // shared-session projection. Do not let a tenant peer mutate that hidden
      // binding by submitting its known connection id.
      const isAttachedMcp = contexts.some(context => context.id === contextId && context.type === 'mcp')
      if (!isAttachedMcp) continue
      const mcpRow = mcpState.connections.find(row => row.id === contextId && row.tenantId === tenantId)
      const retiredMcp = mcpState.retired.find(row => row.id === contextId && row.tenantId === tenantId)
      const connectionOwner = mcpRow?.ownerUserId ?? retiredMcp?.ownerUserId
      if (connectionOwner !== undefined && connectionOwner !== activeMcpActor(tenantId, actorUserId)) {
        throw new ValidationError('Only the connection owner can detach this MCP context.')
      }
      continue
    }
    if (operation.context.type !== 'mcp') throw new ValidationError('An external MCP connection must be attached as MCP context.')
    const mcpRow = mcpState.connections.find(row => row.id === operation.context.id && row.tenantId === tenantId)
    const retiredMcp = mcpState.retired.find(row => row.id === operation.context.id && row.tenantId === tenantId)
    const connectionOwner = mcpRow?.ownerUserId ?? retiredMcp?.ownerUserId
    if (connectionOwner !== undefined && connectionOwner !== activeMcpActor(tenantId, actorUserId)) {
      throw new ValidationError('Only the connection owner can attach this MCP context.')
    }
    if ((!originalContextIds.has(operation.context.id) || mcpRow?.ownerUserId !== undefined) &&
        store.mcpConnection(operation.context.id, tenantId, actorUserId)?.execution !== 'approval-required') {
      throw new ValidationError('Inspect and connect this MCP server before attaching it.')
    }
  }
  const committedWorkspace = preserveSessionWorkspaceSnapshots(sessionId, workspace, refreshAttachmentId, refreshFolderId, refreshLocalFolderId, refreshLocalGitFolderId, captureTenantId)
  for (const operation of operations) {
    if (operation.action === 'detach') {
      contexts = contexts.filter((context) => context.id !== operation.contextId)
      continue
    }
    const input = operation.context
    const context: SessionContext = {
      id: input.id,
      type: input.type,
      label: input.label,
      scope: input.scope ?? '*',
      ...(input.source ? { source: input.source } : {}),
    }
    contexts = [...contexts.filter((candidate) => candidate.id !== context.id), context]
  }
  sessionContextBindings.set(sessionId, contexts)
  sessionWorkspaces.set(sessionId, committedWorkspace)
  pruneSessionPreferences(sessionId, committedWorkspace)
  emit({ type: 'session.contexts.changed', sessionId })
  const updatedSession = SESSIONS.find((candidate) => candidate.id === sessionId)
  if (updatedSession) emit({ type: 'session.updated', session: updatedSession })
  persist()
  return { contexts, workspace: committedWorkspace }
}

export const store = {
  epoch: EPOCH,

  // ── Native-runner registry + effect journal ──
  /** The live registry of native runners + their advertised capabilities. The
   *  runner routes read/mutate this; changes broadcast ambient `runner.*` events. */
  registry,
  /** Each runner's authoritative effect log + the server's projection of it (D2).
   *  The invoke route records + reconciles; the sync route merges an outbox. */
  journal,
  /** Per-resource reservation ledgers enforcing a capacity invariant (D5). The
   *  reservation routes drive it; the invoke route reserves/commits for
   *  non-monotonic effects so a second session can't write a held resource. */
  guardian,
  /** The delegated-cognition relay runtime — Session providers' transient half
   *  (slot / parked puller / liveness). The relay routes and the messages route's
   *  pre-turn gate read it; `relayReply` drives turns through it. */
  relay,

  /** Resolve a presented rendezvous secret to its Session provider — the relay
   *  routes' bearer wall. The presented secret is hashed once and compared
   *  constant-time against each session config's stored hash; no match (or a
   *  non-session provider) ⇒ undefined ⇒ 401. Binding is exactly this lookup:
   *  there is no enrollment protocol to have forgotten after a restart (§7.3). */
  relayProviderForSecret(secret: string): string | undefined {
    const presented = hashRelaySecret(secret)
    for (const [id, config] of PROVIDER_CONFIGS) {
      if (config.kind === 'session' && config.secretHash && sameSecretHash(config.secretHash, presented)) return id
    }
    return undefined
  },

  /** Turn on filesystem persistence and rehydrate from the last snapshot (if any).
   *  Called once by the real server entrypoint; tests leave it off and run
   *  in-memory. On first boot (no snapshot) the selected initial world is written
   *  as the baseline; after that the stored discriminator owns the choice.
   *  Existing unusable state throws before persistence is enabled or requests
   *  are admitted, including runtime ownership checks during rehydration. */
  initPersistence(): void {
    const loaded = loadState()
    if (loaded) {
      const recoveredState = rehydrate(loaded)
      persistEnabled = true
      // Older stores never recorded usage. Publish the one-time world-appropriate
      // baseline so even an otherwise read-only restart retains its period anchor.
      // Execution uncertainty and orphan standing-authority cleanup likewise
      // commit before the server admits requests, even without a later write.
      if (loaded.usageMeters === undefined || recoveredState) persist()
    }
    else if (resolveInitialWorld() === 'clean') {
      // Release first boot: replace every authored-person slice with the minimal
      // product infrastructure, then persist that canonical state. Rehydrate is
      // deliberately reused so first boot and every later boot take one path.
      rehydrate(cleanFirstBootState())
      persistEnabled = true
      persist()
    } else {
      // First boot (no snapshot): the commons showcase seeds THROUGH the real
      // mutators before the baseline snapshot is written — the demo is the
      // argument, and every workflow stage should be visible on first sign-in.
      persistEnabled = true
      this.seedCommonsShowcase()
      persist()
    }
  },

  /** ── The commons showcase (the sample-projects pass) ─────────────────────
   *  Ten shared projects across the six demo owners, each staging a DISTINCT
   *  stage of the contribution workflow (COMMONS-28…33) so Discover is a
   *  gallery of the system's own argument. Driven ENTIRELY through the real
   *  mutators (the snapshot:build philosophy — it cannot drift from the
   *  contract and reproduces identically in any clone). Idempotent: a world
   *  already showing the field guide is left untouched (re-running after a
   *  rehydrate would double-seed). In-memory tests call it explicitly. */
  seedCommonsShowcase(): void {
    if (graph.extraProjects.some((p) => p.id === 'p-field-guide')) return
    const ADA = defaultTenantId() // the flagship seat (Ada / Acme)
    const GRACE = 'tenant-beta'
    const MAYA = 'tenant-growthworks'
    const NOOR = 'tenant-northlight'
    const OMAR = 'tenant-harbor'
    const REI = 'tenant-reislab'
    /** Seed a shared showcase project.
     *
     *  It used to take TWO texts — a one-line `description` and a longer
     *  `readme` — and write both. They merged on 2026-08-13 (owner report: the
     *  create dialog's description field, the sub-line under the title and the
     *  About section are three faces of one text), so each caller now passes one
     *  string carrying both sentences: what the project IS, then how it works.
     *  That is what the two fields were actually saying between them, which is
     *  the argument for the merge rather than a casualty of it. */
    const mk = (owner: string, projectId: string, name: string, description: string) => {
      this.applyRelationOp({ kind: 'create-project', projectId, projectName: name, projectDescription: description }, owner)
      this.applyRelationOp({ kind: 'share-project', projectId, projectName: name, shared: true }, owner)
    }
    const contrib = (projectId: string, by: string, title: string, summary?: string, subGoal?: string) => {
      const c = this.openContribution(projectId, { title, summary, subGoal }, by, undefined)
      return typeof c === 'object' ? c.id : ''
    }
    const crystallizeNote = (projectId: string, cid: string, by: string, target: string, before: string | undefined, after: string) =>
      // 'note', not the project's description: these targets are guide pages,
      // postmortems and token files. The kind was 'readme', and the rename made a
      // pre-existing mislabel legible — a Changes row reading "description ·
      // postmortems/cache-stampede" claims a contribution edited the project's
      // About text when what it wrote was a postmortem.
      this.crystallizeContribution(projectId, cid, { entries: [{ kind: 'note', target, ...(before !== undefined ? { before } : {}), after }] }, by, undefined)
    const reviewedLand = (projectId: string, cid: string, by: string) => {
      this.reviewContribution(projectId, cid, by, undefined)
      this.landContribution(projectId, cid, by, undefined)
    }

    // 1 · The Commons Field Guide (Ada) — the LINEAR LEDGER + EARNED TRUST:
    // Rei lands three reviewed contributions (L1–L3), so her fourth reads
    // Tier 0 ("trusted: 3 landed here") — the trust arithmetic on display.
    mk(ADA, 'p-field-guide', 'The Commons Field Guide', 'A living handbook of how this commons works — contributed page by page. Every page arrived as a numbered landing: open the ledger and each entry traces to its why.')
    for (const [i, page] of (['Declare before doing', 'The envelope, explained', 'Tiers in plain words'] as const).entries()) {
      const cid = contrib('p-field-guide', REI, `Guide page: ${page}`, `Drafts the "${page}" chapter.`)
      crystallizeNote('p-field-guide', cid, REI, `guide/${i + 1}`, undefined, `${page} — the chapter text, v1.`)
      reviewedLand('p-field-guide', cid, REI)
    }
    contrib('p-field-guide', REI, 'Guide page: the aftermath', 'The fourth chapter — watch the Tier 0 chip.')

    // 2 · Launch Week Broadcast (Noor) — the EFFECT ENVELOPE: one approved
    // with a draft-escrow send half-used; one PROPOSED, sitting as Noor's
    // liability ask in Attention.
    mk(NOOR, 'p-launch-broadcast', 'Launch Week Broadcast', 'Outbound comms for launch week — every send pre-approved as an envelope. Nothing leaves this project without one: approval happens before the act, not after.')
    const lb1 = contrib('p-launch-broadcast', ADA, 'Press note to the launch list', 'Drafts and sends the press note.')
    this.proposeEnvelope('p-launch-broadcast', lb1, { lines: [{ type: 'connector.write', target: 'email:press-list', cardinality: 2, harness: 'draft-escrow', note: 're: launch week' }] }, ADA, undefined)
    this.approveEnvelope('p-launch-broadcast', lb1, NOOR, undefined)
    {
      const c = contributions.find((x) => x.id === lb1)
      const line = c?.envelope?.lines[0]
      if (line) this.runEnvelopeEffect('p-launch-broadcast', lb1, line.id, ADA, undefined)
    }
    const lb2 = contrib('p-launch-broadcast', MAYA, 'Partner heads-up email', 'One message to the partner list.')
    this.proposeEnvelope('p-launch-broadcast', lb2, { lines: [{ type: 'connector.write', target: 'email:partners', cardinality: 1, harness: 'cooling-window' }] }, MAYA, undefined)

    // 3 · Incident Postmortem Library (Grace) — the CHANGESET: v1 → v2 with
    // the review delta on the timeline, landed by the owner.
    mk(GRACE, 'p-postmortem-library', 'Incident Postmortem Library', 'Blameless postmortems, versioned like code. A postmortem is a changeset: before → after, revised in the open, landed once it reads true.')
    const pm = contrib('p-postmortem-library', OMAR, 'Postmortem: the cache stampede', 'What happened, and the fix.')
    crystallizeNote('p-postmortem-library', pm, OMAR, 'postmortems/cache-stampede', 'Root cause: unknown.', 'Root cause: cold-start stampede past an expired key.')
    crystallizeNote('p-postmortem-library', pm, OMAR, 'postmortems/cache-stampede', 'Root cause: unknown.', 'Root cause: cold-start stampede past an expired key. Fix: jittered TTLs + a request-coalescing gate.')
    this.reviewContribution('p-postmortem-library', pm, OMAR, undefined)
    this.landContribution('p-postmortem-library', pm, GRACE, undefined)

    // 4 · Growth Experiment Registry (Maya) — the TIER-1 PATH mid-flight: one
    // landed via review; one crystallized and AWAITING its review (the
    // contributor's error-catching ask).
    mk(MAYA, 'p-experiment-registry', 'Growth Experiment Registry', 'Every experiment writeup lands through review — self-landing once the adversarial pass clears its latest version.')
    const ex1 = contrib('p-experiment-registry', REI, 'Writeup: onboarding email subject test')
    crystallizeNote('p-experiment-registry', ex1, REI, 'experiments/subject-test', undefined, 'Variant B lifted opens 12%; shipped.')
    reviewedLand('p-experiment-registry', ex1, REI)
    const ex2 = contrib('p-experiment-registry', GRACE, 'Writeup: pricing page layout test')
    crystallizeNote('p-experiment-registry', ex2, GRACE, 'experiments/pricing-layout', undefined, 'No significant lift; keeping control.')

    // 5 · Support Macro Commons (Omar) — DELEGATION: a draft-mode delegate has
    // drafted one decision; an effectful ask ESCALATED back to the human.
    mk(OMAR, 'p-macro-commons', 'Support Macro Commons', 'Reply macros, curated — routine approvals delegated, sends escalated. A draft-mode delegate holds the routine and anything irreversible escalates back to a human: labor moves, liability does not.')
    // `Omit<Agent,'id'>` requires systemPrompt + instructions; this literal
    // supplied neither and was double-cast past the check, so the seeded agent
    // shipped `undefined` where the contract promises strings. Filled in rather
    // than re-cast (found by typechecking `server/`, FWD-8).
    const steward = this.createAgent(
      {
        label: 'Macro Steward',
        providerId: 'provider-claude',
        tools: [],
        systemPrompt: 'You steward a library of support reply macros. Prefer the shortest macro that answers the question.',
        instructions: 'Draft routine macro lookups for review. Anything that sends, refunds, or promises escalates to a human.',
      },
      OMAR,
    )
    const stewardId = steward.id
    const del = this.createDelegation('p-macro-commons', { agentId: stewardId, actKind: 'approve-envelope', policy: 'Approve read-only macro lookups without waking me.', mode: 'draft' }, OMAR)
    const delId = typeof del === 'object' && del !== null ? del.id : ''
    const mc1 = contrib('p-macro-commons', ADA, 'Macro: refund status lookup')
    this.proposeEnvelope('p-macro-commons', mc1, { lines: [{ type: 'connector.read', target: 'zendesk:orders', harness: 'dry-run' }] }, ADA, undefined)
    if (delId) this.runDelegation('p-macro-commons', mc1, delId, GRACE, undefined)
    const mc2 = contrib('p-macro-commons', MAYA, 'Macro: outage apology (sends email)')
    this.proposeEnvelope('p-macro-commons', mc2, { lines: [{ type: 'connector.write', target: 'email:affected-users', cardinality: 1, harness: 'draft-escrow' }] }, MAYA, undefined)
    if (delId) this.runDelegation('p-macro-commons', mc2, delId, GRACE, undefined)

    // 6 · Research Reading Circle (Rei) — VISIBLE INTENTS: two live sub-goal
    // leases on the Coordination board, one tied to an open contribution.
    mk(REI, 'p-reading-circle', 'Research Reading Circle', 'Papers claimed before they are summarized — no duplicate work. Claim one before you read it: the lease is visible, and abandonment self-heals in view of everyone.')
    this.reserveSubGoal('p-reading-circle', 'reader-rei', 'summarize: attention-is-all-you-need')
    this.reserveSubGoal('p-reading-circle', 'reader-ada', 'summarize: constitutional-ai')
    contrib('p-reading-circle', ADA, 'Summary: Constitutional AI', 'The claimed summary, in progress.', 'summarize: constitutional-ai')

    // 7 · Design Tokens Garden (Noor) — the AFTERMATH: a landed contribution
    // whose thread keeps accruing (CW7 — the page never fossilizes).
    mk(NOOR, 'p-token-garden', 'Design Tokens Garden', 'The shared palette, pruned in public. Landed work keeps its page alive — reverts, verifications and follow-ups accrue where the change lives.')
    const tg = contrib('p-token-garden', GRACE, 'Retire the legacy amber ramp')
    crystallizeNote('p-token-garden', tg, GRACE, 'tokens/amber', 'amber-500: #f59e0b (legacy ramp)', 'amber-600: #d97706 (single accent step)')
    this.reviewContribution('p-token-garden', tg, GRACE, undefined)
    this.landContribution('p-token-garden', tg, NOOR, undefined)
    this.noteContribution('p-token-garden', tg, 'Aftermath: verified across all six worlds — no contrast regressions.', NOOR, undefined)

    // 8 · The Data Dictionary (Maya) — OPEN WORK meets the ledger: a posted
    // work item beside a contribution declared against the same sub-goal.
    mk(MAYA, 'p-data-dictionary', 'The Data Dictionary', 'One canonical definition per metric — argued in the open. A definition is a contribution: declared, diffed, reviewed, landed; the backlog names what is still fuzzy.')
    this.postOpenSubGoal('p-data-dictionary', { subGoal: 'define: weekly-active-teams', type: 'mcp.query', target: 'warehouse:metrics', note: 'The current definition double-counts org moves.' }, MAYA, undefined)
    contrib('p-data-dictionary', OMAR, 'Define: activation event', 'Pins the activation event to first-project-created.', 'define: activation-event')

    // 9 · Onboarding Trailhead (Omar) — the STRANGER path: a first-time
    // contributor's Tier-1 chip, review still pending.
    mk(OMAR, 'p-onboarding-trailhead', 'Onboarding Trailhead', 'The new-hire guide, improved by the people who just walked it. First-time contributors are Tier 1 by arithmetic, not suspicion: one passed review and the work self-lands.')
    const ot = contrib('p-onboarding-trailhead', GRACE, 'Add the deploy-keys setup step')
    crystallizeNote('p-onboarding-trailhead', ot, GRACE, 'trailhead/deploy-keys', undefined, 'Step 4: mint your deploy key before the first clone.')

    // 10 · Release Notes Atelier (Grace) — the HARNESS LADDER on one envelope:
    // hold-until-landing beside cooling-window, approved, one act run.
    mk(GRACE, 'p-release-atelier', 'Release Notes Atelier', 'Notes per release — staged sends under explicit harnesses. Each send names its harness up front: what is held to landing, what cools before it fires.')
    const ra = contrib('p-release-atelier', ADA, 'v2.4 release notes', 'Drafts and stages the v2.4 notes.')
    this.proposeEnvelope('p-release-atelier', ra, {
      lines: [
        { type: 'connector.write', target: 'blog:changelog', cardinality: 1, harness: 'hold-until-landing' },
        { type: 'connector.write', target: 'email:subscribers', cardinality: 1, harness: 'cooling-window' },
      ],
    }, ADA, undefined)
    this.approveEnvelope('p-release-atelier', ra, GRACE, undefined)
    {
      const c = contributions.find((x) => x.id === ra)
      const cool = c?.envelope?.lines.find((l) => l.harness === 'cooling-window')
      if (cool) this.runEnvelopeEffect('p-release-atelier', ra, cool.id, ADA, undefined)
    }
  },

  // ── Capabilities (what this backend variant can do) ──
  /** What this backend variant can do, advertised so the UI needn't sniff
   *  Electron vs web. A native sidecar reports the local-* flags true and fulfils
   *  the native endpoints; a remote web server reports them false and 409s those
   *  endpoints (the load-bearing, server-side gate — see the routes' `gate()`). */
  capabilities(): Capabilities {
    return {
      backend: BACKEND_MODE,
      epoch: EPOCH,
      features: {
        localFs: NATIVE,
        localGit: NATIVE,
        osPicker: NATIVE,
        clipboard: NATIVE,
        // The account switcher (multi-account §5.6, revised): uniform across
        // backends — every backend honours the identity seam and advertises a
        // directory (web: org principals; desktop: the local user's
        // workspaces). Still a flag, so a deployment can turn it off.
        identitySwitch: true,
        // The production onboarding posture (multi-account §12): require a
        // VERIFIED sign-in before the workspace renders. Read per call (like
        // identityHeadersAllowed) so tests can toggle it without reloads.
        authGate: process.env.AUTH_GATE === 'require',
        scheduledExecution: true, // a remote server can run schedules too
        simulatedAutomation: automationRuntimeMode() === 'fixture',
        dispatchExecution: true,
        streaming: true,
      },
    }
  },
  /** True when this backend can fulfill a native feature; the native routes use
   *  it to 409 with `capability_unavailable` on a remote server. */
  can(feature: 'localFs' | 'localGit' | 'osPicker' | 'clipboard'): boolean {
    return this.capabilities().features[feature]
  },

  // ── Graceful shutdown (design F6 ops) ──
  /** Enter draining: on SIGTERM the process flips this so `GET /readyz` starts
   *  failing (503) and the load balancer stops sending new requests to this instance
   *  while in-flight work finishes. A one-way latch (a draining instance is on its way
   *  out). Liveness (`/healthz`) stays up so the orchestrator doesn't hard-kill it mid-drain. */
  beginDraining(): void {
    draining = true
  },
  isDraining(): boolean {
    return draining
  },
  /** False after the first failed durable commit. The latch never self-heals:
   * reopening traffic against a divergent in-memory store would turn a transient
   * disk problem into acknowledged data loss. */
  persistenceHealthy(): boolean {
    return persistenceFault === null
  },
  /** Subscribe a live transport to the one-way durability latch. Existing
   * ambient streams close on fault so clients reconnect through the product
   * wall instead of remaining attached to non-authoritative memory. */
  subscribePersistenceFault(fn: PersistenceFaultListener): () => void {
    persistenceFaultListeners.add(fn)
    return () => persistenceFaultListeners.delete(fn)
  },

  // ── Identity & tenancy (who's talking, which tenant — design F2) ──
  /** The current principal + tenant for a request (`GET /v1/me`). Desktop/mock is
   *  the single local user; the remote web server resolves a tenant-scoped principal
   *  from the auth seam (request headers stand in for verified IdP claims, F2). The
   *  backend is the single source for which deployment this is. */
  identity(headers?: Record<string, string | string[] | undefined>): Identity {
    const ident = resolveIdentity(BACKEND_MODE, headers)
    // The AUTH GATE's identity half (multi-account §12, hardened): when the gate
    // applies, a request that resolved to the backend DEFAULT (no verified
    // session, no dev-seam header assertion) reads as the anonymous principal —
    // a registry-less identity that owns nothing — so pre-sign-in, `/me`, the
    // identity echo, and every visibility wall name and serve NOBODY. The
    // router's 401 wall (routes/index.ts) is the loud half; this is the
    // defense-in-depth beneath it. `defaultTenantId()` deliberately bypasses
    // this (it calls resolveIdentity directly): the default principal still
    // OWNS the untagged seeds — the gate hides them from the wire, it doesn't
    // reassign them.
    if (ident.via === 'default' && this.capabilities().features.authGate) {
      return { ...ANONYMOUS_IDENTITY, via: 'default' }
    }
    return ident
  },
  /** The backend's default tenant — the owner of *shared* infrastructure (seeded registry
   *  entries with no `tenantId`, seed sessions/projects/artifacts). Used by the by-id write
   *  guard so shared infra is READ by all tenants but WRITTEN only by its owner (F2/PD9). */
  defaultTenantId(): string {
    return defaultTenantId()
  },

  // ── Served filesystem sources (Files / Photos / Folder — contract/fs.ts) ──
  /** The picker's source switcher list (cloud + any fs-capable runner). The client
   *  prepends its own `ui-host` source. */
  fsSources(): FsSource[] {
    return fsSourceList()
  },
  /** A source's top-level catalog (files / photos / folders). Undefined for an
   *  unknown / client-only source (→ 404/400 at the route). */
  fsCatalog(sourceId: string): FsCatalog | undefined {
    const r = resolveFsReader(sourceId, 'fs.list')
    if (!r) return undefined
    const catalog = r.reader.list()
    if (!catalog) return undefined
    const { files, photos, folders } = catalog
    return { source: r.source, files, photos, folders }
  },
  /** Scan a folder under a source → its artifacts (what the workspace shows). */
  fsFolder(sourceId: string, path: string): FsFolderContents | undefined {
    return resolveFsReader(sourceId, 'fs.list')?.reader.folderContents(path)
  },
  /** A file's textual content under a source (the editable preview). */
  fsText(sourceId: string, path: string): FsFileContent | undefined {
    return resolveFsReader(sourceId, 'fs.read')?.reader.readText(path)
  },
  /** Only an explicit intake/Refresh reads the source. Stored snapshots grant
   * neither future reads nor writes, and model preparation remains I/O-free. */
  fsSnapshot(sourceId: string, path: string, snapshotId = randomUUID()): ServedTextSnapshot | undefined {
    const content = resolveFsReader(sourceId, 'fs.read')?.reader.readSnapshot(path)
    if (!content) return undefined
    const snapshot = { version: 1 as const, snapshotId, capturedAt: new Date().toISOString(), sourceId, path, text: content.text }
    return isServedTextSnapshot(snapshot) ? snapshot : undefined
  },
  /** Current authorization to read one exact served path, without opening or
   *  rereading its contents. Used when the renderer submits an already-frozen
   *  document import for explicit Refresh. */
  fsReadPermitted(sourceId: string, path: string): boolean {
    if (sourceId === 'cloud') return !!cloudReader
    if (!sourceId.startsWith('runner:')) return false
    const runner = registry.get(sourceId.slice('runner:'.length))
    if (!runner || runner.status !== 'online') return false
    const mapped = runnerFs(runner)
    return !!mapped && mapped.supports('fs.read') && mapped.permitsRead(path)
  },
  async fsFolderSnapshot(sourceId: string, path: string, snapshotId = randomUUID(), scope: ServedFolderScope = 'flat'): Promise<ServedFolderSnapshot | undefined> {
    if (scope !== 'flat' && scope !== 'recursive') return undefined
    const files = await resolveFsReader(sourceId, 'fs.list')?.reader.folderSnapshot(path, undefined, scope)
    if (!files) return undefined
    const snapshot = { ...(scope === 'recursive' ? { version: 2 as const, scope } : { version: 1 as const }), snapshotId, capturedAt: new Date().toISOString(), sourceId, path, files }
    return isServedFolderSnapshot(snapshot) && folderSnapshotStillPermitted(snapshot) ? snapshot : undefined
  },
  async refreshSessionFolder(sessionId: string, folderId: string, request: RefreshServedAttachmentRequest, tenantId: string): Promise<SessionContextState> {
    const owned = () => {
      const session = store.getSession(sessionId)
      return session && store.sessionOwnedBy(session, tenantId)
    }
    if (!owned()) throw new ConflictError('Only the current conversation owner may refresh attached folders.')
    const workspace = store.sessionWorkspace(sessionId)
    const container = workspace?.workspaces.find((item) => workspaceFolders(item).some((folder) => folder.id === folderId))
    const folder = container && workspaceFolders(container).find((item) => item.id === folderId)
    const address = parseFsRecentKey(folderId)
    const binding = store.sessionContexts(sessionId).find((item) => item.id === folderId)
    const matchesBinding = () => {
      const current = store.sessionContexts(sessionId).find((item) => item.id === folderId)
      return current === binding && current?.type === 'folder' && current.source?.id === address?.sourceId &&
        current.source?.kind === (address?.sourceId === 'cloud' ? 'cloud' : 'runner') && current.scope === address?.entryId
    }
    if (!folder || !address || address.sourceId === 'ui-host' || !binding || !matchesBinding()) {
      throw new ConflictError('This served folder is no longer attached. Reopen the conversation before refreshing.')
    }
    if (folder.snapshot?.snapshotId === request.requestId) return { contexts: store.sessionContexts(sessionId), workspace }
    if ((folder.snapshot?.snapshotId ?? null) !== request.expectedSnapshotId) {
      throw new ConflictError('This saved folder changed. Reopen it before refreshing again.')
    }
    // Refresh keeps the capture's original scope. A new intake is required to
    // widen a flat copy; neither absent legacy scope nor caller JSON opts in.
    const recursive = folder.snapshot?.version === 2
    const snapshot = recursive
      ? await store.fsFolderSnapshot(address.sourceId, address.entryId, request.requestId, 'recursive')
      : await store.fsFolderSnapshot(address.sourceId, address.entryId, request.requestId)
    // Capture yields: ownership, exact binding, grants and target receipt must
    // still be current. Unrelated workspace changes are retained below.
    if (!owned() || !matchesBinding()) throw new ConflictError('The attached folder changed while reading. The saved copy is unchanged.')
    if (!snapshot || !isServedFolderSnapshot(snapshot) || snapshot.sourceId !== address.sourceId ||
        snapshot.path !== address.entryId || snapshot.snapshotId !== request.requestId ||
        snapshot.version !== (recursive ? 2 : 1) || !folderSnapshotStillPermitted(snapshot)) {
      throw new ValidationError('Could not capture this folder with its current permissions and limits. The saved copy is unchanged.')
    }
    const latest = store.sessionWorkspace(sessionId)
    const currentContainer = latest?.workspaces.find((item) => item.id === container.id)
    const current = currentContainer && workspaceFolders(currentContainer).find((item) => item.id === folderId)
    if (!current || (current.snapshot?.snapshotId ?? null) !== request.expectedSnapshotId) {
      // Another identical request may have committed during capture.
      if (current?.snapshot?.snapshotId === request.requestId) return { contexts: store.sessionContexts(sessionId), workspace: latest }
      throw new ConflictError('The attached folder changed while reading. The saved copy is unchanged.')
    }
    return commitSessionContextState(sessionId, [], {
      ...latest,
      workspaces: latest.workspaces.map((item) => item.id === currentContainer.id ? replaceServedFolderSnapshot(item, folderId, snapshot) : item),
    }, undefined, folderId)
  },
  /** Commit one native local-folder capture as frozen saved bytes. The opaque
   * connection identity only correlates an already-attached binding; this method
   * never opens, resolves, or otherwise reads a local path. */
  refreshSessionLocalFolder(sessionId: string, folderId: string, request: LocalFolderRefreshRequest, tenantId: string): SessionContextState {
    const owned = () => {
      const session = store.getSession(sessionId)
      return session && store.sessionOwnedBy(session, tenantId)
    }
    if (!owned()) throw new ConflictError('Only the current conversation owner may refresh attached folders.')
    if (!isLocalFolderRefreshRequest(request)) throw new ValidationError('The local folder capture is invalid. The saved copy is unchanged.')

    const workspace = store.sessionWorkspace(sessionId)
    const container = workspace?.workspaces.find((item) => workspaceFolders(item).some((folder) => folder.id === folderId))
    const folder = container && workspaceFolders(container).find((item) => item.id === folderId)
    const connectionId = request.snapshot.connectionId
    const binding = store.sessionContexts(sessionId).find((item) => item.id === folderId)
    const matchesBinding = () => {
      const current = store.sessionContexts(sessionId).find((item) => item.id === folderId)
      return current === binding && current?.type === 'folder' && current.source?.id === 'ui-host' &&
        current.source.kind === 'ui-host' && current.scope === connectionId
    }
    if (!folder || !container || folderId !== `ui-host::${connectionId}` || !binding || !matchesBinding()) {
      throw new ConflictError('This local folder is no longer attached. Reopen the conversation before refreshing.')
    }
    if (folder.localSnapshot?.snapshotId === request.requestId) {
      if (!sameLocalFolderCapture(folder.localSnapshot, request.snapshot)) {
        throw new ConflictError('This local folder refresh key was already used for different bytes.')
      }
      return { contexts: store.sessionContexts(sessionId), workspace }
    }
    if ((folder.localSnapshot?.snapshotId ?? null) !== request.expectedSnapshotId) {
      throw new ConflictError('This saved local folder changed. Reopen it before refreshing again.')
    }
    if (folder.localSnapshot && folder.localSnapshot.version !== request.snapshot.version) {
      throw new ConflictError('The saved local folder capture scope cannot change. Detach and reattach the folder to choose a different scope.')
    }
    const snapshot = request.snapshot
    const latest = store.sessionWorkspace(sessionId)
    const currentContainer = latest?.workspaces.find((item) => item.id === container.id)
    const current = currentContainer && workspaceFolders(currentContainer).find((item) => item.id === folderId)
    if (!owned() || !matchesBinding() || !currentContainer || !current ||
        (current.localSnapshot?.snapshotId ?? null) !== request.expectedSnapshotId) {
      // Replaying a committed id is valid only while the same folder binding is
      // still attached; a detached/reincarnated target never revives a receipt.
      if (owned() && matchesBinding() && current?.localSnapshot?.snapshotId === request.requestId &&
          sameLocalFolderCapture(current.localSnapshot, snapshot)) return { contexts: store.sessionContexts(sessionId), workspace: latest }
      throw new ConflictError('The attached local folder changed. The saved copy is unchanged.')
    }
    return commitSessionContextState(sessionId, [], {
      ...latest,
      workspaces: latest.workspaces.map((item) => item.id === currentContainer.id
        ? replaceLocalFolderSnapshot(item, folderId, snapshot)
        : item),
    }, undefined, undefined, folderId)
  },
  /** Commit a detached native Git working-tree capture. The connection ID is
   * only an attached-context correlation key; this path has no Git or filesystem
   * runtime authority and stores the exact bounded saved projection. */
  refreshSessionLocalGitFolder(sessionId: string, folderId: string, request: LocalGitRefreshRequest, tenantId: string): SessionContextState {
    const owned = () => {
      const session = store.getSession(sessionId)
      return session && store.sessionOwnedBy(session, tenantId)
    }
    if (!owned()) throw new ConflictError('Only the current conversation owner may refresh attached folders.')
    if (!isLocalGitRefreshRequest(request)) throw new ValidationError('The local Git capture is invalid. The saved copy is unchanged.')
    const workspace = store.sessionWorkspace(sessionId)
    const container = workspace?.workspaces.find((item) => workspaceFolders(item).some((folder) => folder.id === folderId))
    const folder = container && workspaceFolders(container).find((item) => item.id === folderId)
    const connectionId = request.snapshot.connectionId
    const binding = store.sessionContexts(sessionId).find((item) => item.id === folderId)
    const matchesBinding = () => {
      const current = store.sessionContexts(sessionId).find((item) => item.id === folderId)
      return current === binding && current?.type === 'folder' && current.source?.id === 'ui-host' &&
        current.source.kind === 'ui-host' && current.scope === connectionId
    }
    if (!folder || !container || folderId !== fsRecentKey('ui-host', connectionId) || !binding || !matchesBinding()) {
      throw new ConflictError('This local Git connection is no longer attached. Reopen the conversation before refreshing.')
    }
    if (folder.gitSnapshot?.snapshotId === request.requestId) {
      if (!sameLocalGitCapture(folder.gitSnapshot, request.snapshot)) throw new ConflictError('This local Git refresh key was already used for different bytes.')
      return { contexts: store.sessionContexts(sessionId), workspace }
    }
    if ((folder.gitSnapshot?.snapshotId ?? null) !== request.expectedSnapshotId) {
      throw new ConflictError('This saved Git snapshot changed. Reopen it before refreshing again.')
    }
    const snapshot = request.snapshot
    const latest = store.sessionWorkspace(sessionId)
    const currentContainer = latest?.workspaces.find((item) => item.id === container.id)
    const current = currentContainer && workspaceFolders(currentContainer).find((item) => item.id === folderId)
    if (!owned() || !matchesBinding() || !currentContainer || !current ||
        (current.gitSnapshot?.snapshotId ?? null) !== request.expectedSnapshotId) {
      if (owned() && matchesBinding() && current?.gitSnapshot?.snapshotId === request.requestId &&
          sameLocalGitCapture(current.gitSnapshot, snapshot)) return { contexts: store.sessionContexts(sessionId), workspace: latest }
      throw new ConflictError('The attached Git snapshot changed. The saved copy is unchanged.')
    }
    return commitSessionContextState(sessionId, [], {
      ...latest,
      workspaces: latest.workspaces.map((item) => item.id === currentContainer.id
        ? replaceLocalGitSnapshot(item, folderId, snapshot)
        : item),
    }, undefined, undefined, undefined, folderId)
  },
  refreshSessionAttachment(sessionId: string, attachmentId: string, request: RefreshServedAttachmentRequest, requesterTenantId?: string): SessionContextState {
    const workspace = store.sessionWorkspace(sessionId)
    const attachment = workspace?.attachments.find((item) => item.id === attachmentId)
    if (attachment?.kind === 'discussion') {
      if ('snapshot' in request || 'imageSnapshot' in request) throw new ValidationError('Discussion copies are captured by the server; supplied file or image content is not accepted.')
      const saved = attachment.discussionSnapshot
      if (!saved) throw new ConflictError('This discussion has no saved copy to refresh.')
      // Recover the exact acknowledged copy before requiring source access again.
      if (saved.snapshotId === request.requestId) return { contexts: store.sessionContexts(sessionId), workspace }
      if (saved.snapshotId !== request.expectedSnapshotId) throw new ConflictError('This saved discussion changed. Reopen it before refreshing again.')
      const refreshed = captureDiscussionContext(sessionId, attachmentId, request.requestId, requesterTenantId)
      return commitSessionContextState(sessionId, [], {
        ...workspace,
        attachments: workspace.attachments.map((item) => item.id === attachmentId ? refreshed : item),
      }, attachmentId, undefined, undefined, undefined, requesterTenantId)
    }
    if (attachment?.kind === 'artifact') {
      if ('snapshot' in request || 'imageSnapshot' in request) throw new ValidationError('Artifact copies are captured by the server; supplied file or image content is not accepted.')
      const saved = attachment.artifactSnapshot
      if (!saved) throw new ConflictError('This Artifact has no saved copy to refresh.')
      if (saved.snapshotId === request.requestId) return { contexts: store.sessionContexts(sessionId), workspace }
      if (saved.snapshotId !== request.expectedSnapshotId) throw new ConflictError('This saved Artifact changed. Reopen the conversation before refreshing again.')
      const refreshed = captureArtifactContext(sessionId, attachmentId, request.requestId, requesterTenantId)
      return commitSessionContextState(sessionId, [], {
        ...workspace,
        attachments: workspace.attachments.map((item) => item.id === attachmentId ? refreshed : item),
      }, attachmentId, undefined, undefined, undefined, requesterTenantId)
    }
    const address = parseFsRecentKey(attachmentId)
    const expectedKind = address?.sourceId === 'cloud' ? 'cloud' : 'runner'
    const frozenText = 'snapshot' in request ? request.snapshot : undefined
    const frozenImage = 'imageSnapshot' in request ? request.imageSnapshot : undefined
    if (!attachment || (!frozenImage && attachment.kind !== 'file') || !address || !attachment.source ||
        attachment.source.kind !== expectedKind || attachment.source.id !== address.sourceId) {
      throw new ConflictError('This served file is no longer attached. Reopen the conversation before refreshing.')
    }
    if (frozenText && (!isServedTextSnapshot(frozenText) || frozenText.version !== 2 ||
        frozenText.sourceId !== address.sourceId || frozenText.path !== address.entryId || frozenText.snapshotId !== request.requestId ||
        attachment.kind !== 'file' || attachment.imageSnapshot !== undefined)) {
      throw new ValidationError('The saved document does not match this attached file. The saved copy is unchanged.')
    }
    if (frozenImage && (!isServedImageSnapshot(frozenImage) ||
        frozenImage.sourceId !== address.sourceId || frozenImage.path !== address.entryId ||
        frozenImage.snapshotId !== request.requestId || attachment.textSnapshot !== undefined)) {
      throw new ValidationError('The saved image does not match this attached file. The saved copy is unchanged.')
    }
    // The captured ID is the durable receipt. A lost acknowledgement or restart
    // must recover its exact saved truth even if the source grant was later
    // revoked. Replay is scoped to both this attachment and the complete payload.
    const representedId = attachmentSnapshotId(attachment)
    if (representedId === request.requestId) {
      if (frozenImage && (!attachment.imageSnapshot || !sameServedImageSnapshot(attachment.imageSnapshot, frozenImage))) {
        throw new ConflictError('This served-image refresh key was already used for a different saved image.')
      }
      if (frozenText && (!attachment.textSnapshot || !sameServedSnapshot(attachment.textSnapshot, frozenText))) {
        throw new ConflictError('This served-file refresh key was already used for different saved text.')
      }
      if (!frozenImage && !frozenText && !attachment.textSnapshot) {
        throw new ConflictError('This served-file refresh key belongs to a different saved snapshot.')
      }
      return { contexts: store.sessionContexts(sessionId), workspace }
    }
    if ((representedId ?? null) !== request.expectedSnapshotId) {
      throw new ConflictError('This saved copy changed. Reopen it before refreshing again.')
    }
    // A fresh frozen renderer import remains subject to current exact-path read
    // authority, but this check requires no content read and cannot revoke an
    // already-committed receipt's recovery path.
    if ((frozenText || frozenImage) && !store.fsReadPermitted(address.sourceId, address.entryId)) {
      throw new ConflictError('This source no longer grants read access to the attached file. The saved copy is unchanged.')
    }
    let textSnapshot: ServedTextSnapshot | undefined
    if (frozenImage) {
      const session = store.getSession(sessionId)
      const tenantId = session?.tenantId ?? defaultTenantId()
      const row = imageAssets.get(frozenImage.image.id)
      if (!row || row.tenantId !== tenantId || !imageAssetRefMatches(frozenImage.image, row.image, row.original)) {
        throw new ValidationError('The saved image asset is unavailable to this conversation owner. The saved copy is unchanged.')
      }
    } else {
      textSnapshot = frozenText ?? store.fsSnapshot(address.sourceId, address.entryId, request.requestId)
      if (!textSnapshot) throw new ValidationError('Could not read a complete text file of 64 KB or less. The saved copy is unchanged.')
    }
    const latest = store.sessionWorkspace(sessionId)
    const current = latest?.attachments.find((item) => item.id === attachmentId)
    if (!store.getSession(sessionId) || current !== attachment || (attachmentSnapshotId(current) ?? null) !== request.expectedSnapshotId) {
      throw new ConflictError('The attached file changed while reading. The saved copy is unchanged.')
    }
    const { previewText: _preview, previewUrl: _url, documentImport: _import, image: _image, imageSnapshot: _imageSnapshot,
      textSnapshot: _textSnapshot, ...metadata } = current
    const refreshedAttachment = frozenImage ? { ...metadata, imageSnapshot: frozenImage } : { ...metadata, textSnapshot }
    if (!isAttachmentInput(refreshedAttachment)) {
      throw new ValidationError('The refreshed file no longer matches its attached source. The saved copy is unchanged.')
    }
    return commitSessionContextState(sessionId, [], {
      ...latest,
      attachments: latest.attachments.map((item) => item.id === attachmentId ? refreshedAttachment : item),
    }, attachmentId)
  },
  /** A file's raw bytes + content type under a source (image / binary serving). */
  fsBytes(sourceId: string, path: string): { bytes: Uint8Array; contentType: string } | undefined {
    return resolveFsReader(sourceId, 'fs.read')?.reader.readBytes(path)
  },

  // ── Native resources (only a native sidecar fulfills these — the arbitrary-path
  //    OS seam, distinct from the served sources above; gated, 409 on remote) ──
  /** OS file/photo/folder picker → the chosen path. */
  fsPick(kind: string): { path: string; kind: string } {
    return { path: kind === 'file' ? '~/Documents/launch-assets/gtm-brief.md' : '~/projects/insights-dashboard', kind }
  },
  /** Scan a local folder → the artifacts it holds. Delegates to the cloud reader so
   *  the dormant native route still returns real data after the fixture removal. */
  scanFolder(id: string): FsFolderContents | undefined {
    return cloudReader.folderContents(id)
  },
  /** Compute a local repo's working-tree diff (native git). */
  repoDiff(id: string): DiffLine[] | undefined {
    const repo =
      LOCAL_REPO_OPTIONS.find((r) => r.id === id) ?? GITHUB_REPO_OPTIONS.find((r) => r.id === id)
    return repo?.diff
  },

  // ── Event bus ──
  /** Subscribe to the ambient event stream; returns an unsubscribe fn. */
  subscribe(fn: Listener): () => void {
    listeners.add(fn)
    return () => listeners.delete(fn)
  },
  /** Publish a domain event to every open ambient SSE channel. */
  emit,

  /** The account registry changed (a signup, a new workspace — multi-account
   *  P7): persist, so real accounts survive a restart. The registry itself is a
   *  singleton (server/accounts.ts); the store owns WHEN it hits disk. */
  accountsMutated(): void {
    persist()
  },

  // ── Sessions ──
  /** The lightweight list rows (no message bodies) for the sidebar/search. */
  listSessions(tenantId?: string): Session[] {
    // Tenant-scoped enumeration (F2 / PD9): a tenant lists only its own sessions. A
    // seed/legacy session (no tenantId) belongs to the backend's default tenant, so it's
    // visible to the default reader on both backends. No arg ⇒ unscoped (internal use).
    // Agent-initiated (run) sessions are the same rows behind the same by-id routes,
    // but they surface through the Scheduled rail + `/runs/recent` — one row per
    // routine, not per run — so this list (Recents/search) scopes to human-initiated
    // conversations. A pure view rule, not a separate code path.
    const rows = SESSIONS.filter((s) => !s.scheduledRunOf)
    const within = tenantId
      ? rows.filter((s) => rowVisibleTo(s, tenantId))
      : rows
    return within.map((s) => ({
      id: s.id,
      title: s.title,
      caps: s.caps,
      preview: s.preview,
      tenantId: s.tenantId,
      // Viewer-relative ownership, matching the by-id read. When the call is
      // tenant-SCOPED, `rowVisibleTo` already filtered to the reader's own rows,
      // so every row here is owned — a fact, not an inference. An unscoped call
      // (internal use) has no reader, so it asserts nothing (absent = not owned).
      ...(tenantId ? { own: true } : {}),
      // Sidebar filter/sort backing — cheap scalars, safe to ship in the list rows.
      status: s.status,
      environment: s.environment,
      updatedAt: s.updatedAt,
      createdAt: s.createdAt,
      pinned: s.pinned,
      metadataRevision: s.metadataRevision ?? 0,
      // The driving Agent (D16 current-driver binding) — the client resolves it to a
      // provider kind for the relay affordances ("Waiting on your session…", §7.8).
      agentId: s.agentId,
      // The session's two-level model pick (the composer selector reads its
      // current value here — provider + concrete catalog model).
      providerId: s.providerId,
      modelId: s.modelId,
    }))
  },
  /** Whether a session is visible to `tenantId` — the route-level guard for reads by id,
   *  so a tenant can't open another tenant's session by guessing its id. A seed/legacy or
   *  synthesized (run) session with no tenantId belongs to the default tenant. */
  sessionVisibleToTenant(session: Pick<Session, 'id' | 'tenantId'>, tenantId: string): boolean {
    // Social S1: a grant opens the subject — the session share is the flagship
    // (replayable at `view`). Ownership stays strict; only READ widens.
    return rowVisibleTo(session, tenantId) || this.grantedTier({ kind: 'session', id: session.id }, tenantId) !== undefined
  },
  /** OWNERSHIP, the strict half of the funnel above — the reader's own row, with
   *  no grant widening it. The share configuration hangs off this: a granted
   *  visitor reads the conversation and may not reconfigure who else can. */
  sessionOwnedBy(session: Session, tenantId: string): boolean {
    return rowVisibleTo(session, tenantId)
  },
  /** Whether an ambient event should be delivered to a subscriber of `tenantId` (F2/PD9 —
   *  the push-side of the tenant boundary). The `/events` SSE fan-out is broadcast to
   *  every open channel, so without this a subscriber would observe *other* tenants'
   *  session pushes. Events that carry tenant-identifiable data are gated to the owning
   *  tenant; the rest (runner registry and dispatch) are global. A session that can't be resolved (an
   *  ephemeral/just-removed id) falls back to the default tenant, matching the read side. */
  eventVisibleToTenant(e: ServerEvent, tenantId: string, actorUserId?: string): boolean {
    switch (e.type) {
      case 'agent-request.changed':
        return actorUserId !== undefined && !!proxyRequestHost.read(e.requestId, { tenantId, userId: actorUserId })
      case 'session.updated':
        return this.sessionVisibleToTenant(e.session, tenantId)
      // The removed row rides the event (it's no longer resolvable by id) —
      // gated exactly like session.updated, so a delete is only observable
      // where the session itself was.
      case 'session.removed':
        return this.sessionVisibleToTenant(e.session, tenantId)
      case 'session.contexts.changed': {
        const s = SESSIONS.find((x) => x.id === e.sessionId)
        return s ? rowVisibleTo(s, tenantId) : seedVisibleTo(tenantId)
      }
      case 'audit.entry':
        return (e.entry.tenantId ?? defaultTenantId()) === tenantId
      case 'connector.status':
      case 'savedcontext.changed':
        return (e.tenantId ?? defaultTenantId()) === tenantId &&
          (e.ownerUserId === undefined || (activeMcpActor(tenantId, actorUserId) !== undefined && e.ownerUserId === actorUserId))
      case 'recents.changed':
        // Viewer setup state is strictly personal, not an org-resource read
        // union. The mutation stamp survives delete and carries only ids.
        return (e.tenantId ?? defaultTenantId()) === tenantId
      // Targeted (D24): an inbox event reaches its tenant's streams — and, FWD-6
      // O-D5, the streams of that org's members (the inbox is member-readable).
      case 'notification.changed':
        return tenantReadsAs(tenantId, e.tenantId)
      case 'social-access.changed':
        return tenantReadsAs(tenantId, e.tenantId)
      case 'org.invitation.changed':
        // Owners are explicit; the addressed account matches an opaque audience
        // minted for known and unknown emails alike, preserving the no-oracle wall.
        if (e.parties.includes(tenantId)) return true
        return orgInviteAddressAudience(accounts.emailOfHomeTenant(tenantId) ?? '') === e.addressAudience
      case 'relation.applied': {
        // Gate on the tenant that APPLIED the edit — not the op payload. Keying off
        // op.projectId leaked the unfile/unlink ops (projectId:null but carrying the
        // project *name*), and the projectless ops (handoff / Agent-Commons CRUD) leaked
        // their session/agent labels. A relation edit is the acting tenant's private
        // action, so it's visible only to that tenant (F2/PD9). Unstamped ⇒ default.
        if ((e.tenantId ?? defaultTenantId()) === tenantId) return true
        // FWD-6 O-D5: an edit that TOUCHED an ORG-owned project is the org's
        // business — its seats' caches must invalidate live (UI-12: a member's
        // Projects list would otherwise go stale on another seat's edit). Widened
        // ONLY for org owners (`isNamespace` excludes every person namespace, so
        // the legacy privacy — incl. cross-tenant ops on shared personal
        // projects — is bit-for-bit preserved).
        const pid = (e.op as { projectId?: string | null }).projectId
        if (pid != null) {
          const owner = projectTenant(pid)
          if (!accounts.isNamespace(owner) && accounts.seatIn(tenantId, owner) !== undefined) return true
        }
        return false
      }
      case 'project.changed':
        // An unshare still reaches former public readers. Private hints reuse
        // the current read wall, including org seats and directed grants, so
        // a revoked reader cannot receive private updates through replay.
        if (!findProject(e.projectId)) return false
        return e.scope === 'public' || (e.scope === 'readers' &&
          this.grantSubjectVisible({ kind: 'project', id: e.projectId }, tenantId))
      case 'openwork.changed': {
        // The backlog's visibility mirrors the Project's (D19/P8): everyone while it's
        // shared, owner-only while private. The event carries only the project id, so
        // there is nothing else to leak.
        const p = findProject(e.projectId)
        if (!p) return seedVisibleTo(tenantId)
        return p.shared === true || rowVisibleTo(p, tenantId)
      }
      case 'relay.connected':
      case 'relay.disconnected':
      case 'relay.activity': {
        // A Session provider is forced tenant-scoped (the mint wall), so its liveness
        // flips — and its per-turn delivery/settle activity (v5) — are that tenant's
        // private signal: another tenant must not observe when someone's delegated
        // session comes and goes, nor how busy it is. Prefer the server-owned
        // emission snapshot: atomic removal publishes after its row is gone.
        const p = MODEL_PROVIDERS.get(e.providerId)
        return (e.tenantId ?? p?.tenantId ?? defaultTenantId()) === tenantId
      }
      case 'run.started':
      case 'run.progress':
      case 'run.finished': {
        // A run event names its routine (taskName / the delivery-target summary) — a
        // tenant's private operational signal, gated like the schedules read itself.
        // These once fell through the global default, leaking every tenant's routine
        // names to every stream. A deleted routine falls back to the flagship rule.
        const t = schedules.find((x) => x.id === e.taskId)
        return t ? rowVisibleTo(t, tenantId) : seedVisibleTo(tenantId)
      }
      case 'schedule.changed':
        // Stamped at emit time (the row may already be deleted) — relation.applied's
        // pattern: the mutation is the owning tenant's private signal.
        return e.tenantId ? e.tenantId === tenantId : seedVisibleTo(tenantId)
      case 'artifact.changed': {
        // Mirrors the artifact's own READ wall, so a shared artifact's audience
        // sees a landed body edit live and nobody else learns the name exists.
        // An unresolvable id falls back to the flagship rule, like the gates above.
        // Keep direct root-read invalidation reachable to the retained audience
        // after Trash closes reads. Nested-only readers receive the separate
        // tenant-targeted social-access.changed hint below.
        const a = retainedArtifact(e.artifactId)
        const retiredOwner = artifactRetirementTenant(e.artifactId)
        if (retiredOwner) return retiredOwner === tenantId
        return a ? rowVisibleTo(a, tenantId) || grantedTierFor({ kind: 'artifact', id: a.id }, tenantId) !== undefined
          : seedVisibleTo(tenantId)
      }
      case 'agent.changed':
        // A published face is directory-wide, but its event carries no raw owner
        // id. Private configuration/activity reaches only the owning tenant;
        // unstamped registry infrastructure is shared with every tenant.
        return e.scope === 'directory'
          ? true
          : (e.tenantId ? e.tenantId === tenantId : true)
      case 'provider.changed':
        // Private providers and viewer-relative default-pointer changes stay in
        // their tenant. An unstamped shared-registry change invalidates every
        // reader without carrying an owner identifier.
        return e.tenantId ? e.tenantId === tenantId : true
      case 'systemprompt.changed':
        // Same registry visibility as providers: private definitions and
        // viewer-default pointers stay owner-scoped; shared infrastructure
        // refreshes every prompt-library reader.
        return e.tenantId ? e.tenantId === tenantId : true
      case 'delegation.changed':
      case 'contribution.changed': {
        // The ledger's visibility mirrors the Project's, exactly like openwork.changed:
        // everyone while shared, owner-only while private (only the project id rides).
        const p = findProject(e.projectId)
        if (!p) return seedVisibleTo(tenantId)
        return p.shared === true || rowVisibleTo(p, tenantId)
      }
      case 'commission.changed': {
        // The Contributor roster's visibility mirrors the Project's (P8/D19), exactly
        // like openwork.changed: everyone while shared, owner-only while private.
        const p = findProject(e.projectId)
        if (!p) return seedVisibleTo(tenantId)
        return p.shared === true || rowVisibleTo(p, tenantId)
      }
      case 'proposal.changed':
        // A proposal is a two-party negotiation (D25) — only proposer + owner streams.
        return e.parties.includes(tenantId)
      case 'grant.changed':
        // A grant is a two-party act (S1): granter + audience streams only. The
        // read union covers org audiences (a member's stream sees its org's party).
        return e.parties.some((p) => tenantReadsAs(tenantId, p))
      case 'discussion.changed': {
        // A discussion's visibility MIRRORS ITS ANCHOR's (S2 inheritance) —
        // delivered exactly where the subject itself is readable. A DM (S7) is
        // the exception the one wall already knows: its anchor is a person many
        // can see, but the thread reaches only its two parties, so the gate
        // resolves the row and asks the same predicate every read path asks.
        //
        // The row can legitimately be GONE by the time the gate runs — the last
        // post's deletion dissolves the thread and then emits. For a resource
        // anchor the fallback is the anchor's own wall; for a principal it is
        // DENY, because that fallback would be reachability, and reachability
        // would tell every third party who can see Ada that a message of hers
        // just changed. The pair rule has to hold on the dissolve path too.
        const d = discussions.find((x) => x.id === e.discussionId)
        if (d) return this.discussionReadableBy(d, tenantId)
        return e.anchor.ref.kind !== 'principal' && this.grantSubjectVisible(e.anchor.ref, tenantId)
      }
      case 'discussion-reads.changed':
        // Read cursors are viewer-private, even from the other party to the DM.
        // Strict equality also keeps personal state out of the org-seat union.
        return e.tenantId === tenantId
      case 'social-proposal.changed':
        // A proposal's visibility MIRRORS ITS SUBJECT's (S3) — same rule.
        return this.grantSubjectVisible(e.subject, tenantId)
      case 'follow.changed':
        // S7 — a two-party act, exactly like `grant.changed`: who follows whom
        // is the pair's business, and the event carries their RAW tenant ids.
        // Without this arm it fell through the global `default: return true`
        // below and broadcast both ids to every connected stream — the C31 leak
        // class the `reservation.changed` arm above was earned for, repeated.
        return e.parties.some((p) => tenantReadsAs(tenantId, p))
      case 'watch.changed':
        // Watch state belongs to exactly the active viewer namespace. The
        // subject may be private, so it must never ride an org-member read
        // union or the global fallthrough.
        return e.tenantId === tenantId
      case 'commons-like.changed':
        // The count is public only inside the item's existing subject wall;
        // the event carries no viewer membership and therefore widens nothing.
        return this.grantSubjectVisible(e.subject, tenantId)
      case 'reservation.changed': {
        // `resourceId` is `${guardianId}[:${subGoal}]` — the sub-goal suffix is free
        // text (a private Project's claim name). It once fell through the global
        // default, broadcasting that name to every tenant's stream (the run.* leak
        // class, C31). Gate on the OWNING Project like openwork.changed: everyone
        // while shared, owner-only while private; an unresolvable guardian (a bare
        // context-element key with no project) stays flagship-scoped.
        const p = projectForGuardianResource(e.resourceId)
        if (!p) return seedVisibleTo(tenantId)
        return p.shared === true || rowVisibleTo(p, tenantId)
      }
      default:
        return true
    }
  },
  /** A full session by id — messages + the live, server-owned `workspace` (its
   *  panels). The workspace is materialized from the flat seed fields on first
   *  read, then reflects any attach/detach write-through. */
  getSession(id: string, actorUserId?: string): Session | undefined {
    const session = SESSIONS.find((s) => s.id === id)
    if (!session) return undefined
    return { ...session, workspace: this.sessionWorkspace(id), contexts: this.sessionContexts(id, actorUserId) }
  },
  /** Exact creator-only state for a keyed human Session creation. */
  getSessionCreation(id: string, tenantId: string): Session | 'invalid' | 'retired' | undefined {
    if (retiredSessionCreationIds.has(id)) return 'retired'
    const session = SESSIONS.find((candidate) => candidate.id === id)
    if (!session) return undefined
    if ((session.tenantId ?? defaultTenantId()) !== tenantId || session.scheduledRunOf) return 'invalid'
    return this.getSession(id)
  },
  /** Find a message's tool activity without mutating it — the route reads a
   *  pending API or connector action here BEFORE executing it on confirm. */
  getToolActivity(sessionId: string, activityId: string): ToolActivity | undefined {
    const session = SESSIONS.find((s) => s.id === sessionId)
    const matches = (session?.messages ?? [])
      .flatMap((message) => message.toolActivities ?? [])
      .filter((activity) => activity.id === activityId)
    return matches.length === 1 ? matches[0] : undefined
  },
  /** Person gate for OAuth consent and replay. Namespace visibility does not
   * substitute for the frozen OAuth owner. */
  toolActivityActorPermitted(sessionId: string, activityId: string, tenantId: string, actorUserId?: string): boolean {
    const session = SESSIONS.find(candidate => candidate.id === sessionId)
    if (!session || !this.sessionOwnedBy(session, tenantId)) return false
    const candidates = [
      ...(session.messages ?? []).flatMap(message => message.toolActivities ?? []),
      ...(session.compactedMessages ?? []).flatMap(message => message.toolActivities ?? []),
    ].filter(activity => activity.id === activityId)
    // A stable id may be reused after compaction. Exact historical receipts
    // are resolved by getToolActivityDecision(), which checks the selected
    // receipt's actor before returning it. This preliminary gate must not hide
    // an authorized archived receipt merely because a later row reused its id;
    // fresh ambiguous decisions are still rejected by the receipt lookup.
    return candidates.some(activity => mcpActivityActorAllowed(session, activity, actorUserId))
  },
  /** Actor-relative consent controls for the shared transcript. The projection
   * contains activity ids only; private OAuth owner identities never cross the
   * store boundary. A retired OAuth connection may still be declined by its
   * frozen owner, but cannot be confirmed without its current exact binding. */
  toolActivityDecisionEligibility(sessionId: string, tenantId: string, actorUserId?: string): ToolActivityDecisionEligibility {
    const session = SESSIONS.find(candidate => candidate.id === sessionId)
    if (!session || !this.sessionOwnedBy(session, tenantId)) {
      return { decisionActivityIds: [], confirmActivityIds: [] }
    }
    const allCandidates = [
      ...(session.messages ?? []).flatMap(message => message.toolActivities ?? []),
      ...(session.compactedMessages ?? []).flatMap(message => message.toolActivities ?? [])
        .filter(activity => !!activity.mcp && isExternalMcpId(activity.connectorId)),
    ]
    const counts = new Map<string, number>()
    for (const activity of allCandidates) counts.set(activity.id, (counts.get(activity.id) ?? 0) + 1)
    // Archives can disambiguate exact receipts, but cannot accept a fresh act.
    const candidates = (session.messages ?? []).flatMap(message => message.toolActivities ?? [])
      .filter(activity => activity.kind === 'action' && activity.status === 'proposed')
    const decisionActivityIds: string[] = []
    const confirmActivityIds: string[] = []
    for (const activity of candidates) {
      if (counts.get(activity.id) !== 1 || !mcpActivityActorAllowed(session, activity, actorUserId)) continue
      decisionActivityIds.push(activity.id)
      if (activity.mcp) {
        const connection = this.mcpConnection(activity.connectorId, tenantId, actorUserId)
        if (mcpActivityOwner(session, activity) === undefined) {
          confirmActivityIds.push(activity.id)
          continue
        }
        if (!connection) continue
        const tool = connection.tools.find(candidate => candidate.name === activity.mcp!.toolName)
        const exactCurrentBinding = connection.status === 'connected' &&
          connection.revision === activity.mcp.connectionRevision &&
          connection.executableTools?.includes(activity.mcp.toolName) === true &&
          !!tool && mcpToolSchemaHash(tool) === activity.mcp.schemaHash
        if (exactCurrentBinding) confirmActivityIds.push(activity.id)
      } else {
        confirmActivityIds.push(activity.id)
      }
    }
    return { decisionActivityIds, confirmActivityIds }
  },
  /** Exact durable acknowledgement for a keyed tool-consent verdict. The
   * containing Session is both the persistence container and private tenant
   * authority; the wire receipt therefore needs no raw account anchor. */
  getToolActivityDecision(
    sessionId: string,
    activityId: string,
    decisionId: string,
    tenantId: string,
    decision: 'confirm' | 'decline',
    actorUserId?: string,
  ): ToolActivity | 'invalid' | undefined {
    if (!isToolActivityDecisionId(decisionId)) return 'invalid'
    const session = SESSIONS.find((candidate) => candidate.id === sessionId)
    if (!session || !this.sessionOwnedBy(session, tenantId)) return undefined
    const candidates = [
      ...(session.messages ?? []).flatMap((message) => message.toolActivities ?? [])
        .filter((activity) => activity.id === activityId)
        .map((activity) => ({ activity, archived: false })),
      ...(session.compactedMessages ?? []).flatMap((message) => message.toolActivities ?? [])
        .filter((activity) => activity.id === activityId && !!activity.mcp && isExternalMcpId(activity.connectorId))
        .map((activity) => ({ activity, archived: true })),
    ]
    const exact = candidates.filter(({ activity }) => activity.decisionId === decisionId)
    if (exact.length > 1) return 'invalid'
    if (exact.length === 1) {
      const { activity, archived } = exact[0]!
      if (!mcpActivityActorAllowed(session, activity, actorUserId)) return undefined
      const represented = decision === 'confirm'
        ? (!archived && (activity.status === 'running' || activity.status === 'awaiting-input')) || activity.status === 'done' || activity.status === 'failed' || activity.status === 'uncertain'
        : activity.status === 'declined'
      return activity.kind === 'action' && represented ? activity : 'invalid'
    }
    if (candidates.length > 1) return 'invalid'
    const candidate = candidates[0]
    if (!candidate) return undefined
    if (!mcpActivityActorAllowed(session, candidate.activity, actorUserId)) return undefined
    return !candidate.archived && candidate.activity.kind === 'action' && candidate.activity.status === 'proposed' &&
      candidate.activity.decisionId === undefined ? undefined : 'invalid'
  },
  /** Persist external execution intent before any credential or network await.
   * The receipt then owns every in-process and post-restart replay. */
  beginMcpToolActivityExecution(
    sessionId: string,
    activityId: string,
    decisionId: string,
    tenantId: string,
    actorUserId?: string,
    forms = false,
  ): ToolActivity | 'invalid' | undefined {
    if (!isToolActivityDecisionId(decisionId)) return 'invalid'
    const represented = this.getToolActivityDecision(sessionId, activityId, decisionId, tenantId, 'confirm', actorUserId)
    if (typeof represented === 'object' || represented === 'invalid') return represented
    const session = SESSIONS.find((candidate) => candidate.id === sessionId)
    if (!session || !this.sessionOwnedBy(session, tenantId)) return undefined
    const activity = this.getToolActivity(sessionId, activityId)
    if (!activity || activity.kind !== 'action' || activity.status !== 'proposed' || !activity.mcp ||
        !isExternalMcpId(activity.connectorId) || activity.op || activity.decisionId !== undefined) return 'invalid'
    if (!mcpActivityActorAllowed(session, activity, actorUserId)) return undefined
    if (forms && !activeMcpActor(tenantId, actorUserId)) return undefined
    if (forms && !hasMcpInputFlowCapacity(mcpInputFlows.size)) {
      throw new LimitError(`Private MCP input flow capacity is full (${MCP_INPUT_MAX_FLOWS}).`)
    }
    return commitMutationBatch(() => {
      activity.status = 'running'
      activity.decisionId = decisionId
      activity.summary = 'Running the approved MCP tool…'
      delete activity.failure
      delete activity.mcpResult
      if (forms) {
        const now = Date.now()
        mcpInputFlows.set(mcpInputFlowKey(sessionId, decisionId), {
          sessionId, activityId, decisionId, tenantId, ownerUserId: actorUserId!,
          bindingHash: mcpInputBindingHash(activity), createdAt: now, expiresAt: now + MCP_INPUT_TTL_MS,
          round: 0, receipts: [],
        })
      }
      persist()
      emit({ type: 'session.updated', session })
      return activity
    })
  },
  /** Settle the one durable external call. Only its matching running receipt may
   * land a result, so a late worker cannot overwrite restart uncertainty. */
  settleMcpToolActivityExecution(
    sessionId: string,
    activityId: string,
    decisionId: string,
    tenantId: string,
    outcome: unknown,
    actorUserId?: string,
    expectedRound = 0,
  ): ToolActivity | 'invalid' | undefined {
    const session = SESSIONS.find((candidate) => candidate.id === sessionId)
    if (!session || !this.sessionOwnedBy(session, tenantId)) return undefined
    const exactRunning = (session.messages ?? [])
      .flatMap((message) => message.toolActivities ?? [])
      .filter((activity) => activity.id === activityId && activity.decisionId === decisionId &&
        activity.kind === 'action' && !!activity.mcp && activity.status === 'running')
    if (exactRunning.length !== 1 || !isToolActivityDecisionId(decisionId)) return 'invalid'
    const activity = exactRunning[0]!
    // Settlement is worker completion, not fresh consent: preserve a known
    // result if membership was revoked during the already-authorized call, but
    // still require the exact frozen owner identity for OAuth-backed work.
    if (!mcpActivitySettlementActorAllowed(session, activity, actorUserId)) return undefined
    const flow = mcpInputFlows.get(mcpInputFlowKey(sessionId, decisionId))
    if (flow && (flow.round !== expectedRound || flow.bindingHash !== mcpInputBindingHash(activity))) return 'invalid'
    if (flow && outcome && typeof outcome === 'object' && 'status' in outcome && outcome.status === 'awaiting-input') {
      let pending: McpFormInputRequired
      try { pending = parseMcpFormInputRequired('pending' in outcome ? outcome.pending : undefined) }
      catch { return 'invalid' }
      if (flow.round < MCP_INPUT_MAX_ROUNDS && flow.expiresAt > Date.now() && activeMcpActor(flow.tenantId, actorUserId)) {
        return commitMutationBatch(() => {
          flow.round += 1
          flow.pending = pending
          activity.status = 'awaiting-input'
          activity.summary = 'Waiting for private input from the person who approved this MCP call.'
          delete activity.failure
          delete activity.mcpResult
          persist()
          emit({ type: 'session.updated', session })
          return activity
        })
      }
      outcome = { status: 'uncertain', summary: 'This MCP input review ended because its limit or current person authority was lost. Earlier remote effects may have occurred; no follow-up was sent.' }
    }
    if (!isMcpExecutionSettlement(outcome)) return 'invalid'
    // A refused continuation cannot erase the fact that an earlier round ran.
    if (flow && flow.round > 0 && outcome.status === 'failed' && outcome.result === undefined) {
      outcome = { status: 'uncertain', summary: 'The follow-up could not be sent. Earlier remote effects may have occurred; the final outcome is unknown.' }
    }
    if (!isMcpExecutionSettlement(outcome)) return 'invalid'
    let result: McpToolResult | undefined
    try { result = outcome.result === undefined ? undefined : parseMcpToolResult(outcome.result, MCP_MODERN_VERSION) }
    catch { return 'invalid' }
    if (outcome.status === 'done' && (!result || result.isError)) return 'invalid'
    if (outcome.status === 'failed' && result !== undefined && !result.isError) return 'invalid'
    if (outcome.status === 'uncertain' && result !== undefined) return 'invalid'
    return commitMutationBatch(() => {
      if (flow) delete flow.pending
      activity.status = outcome.status
      activity.summary = outcome.summary
      if (result) activity.mcpResult = result
      else delete activity.mcpResult
      activity.failure = outcome.status === 'failed'
        ? { code: 'connector_failed', retryable: false }
        : outcome.status === 'uncertain'
          ? { code: 'connector_unavailable', retryable: false }
          : undefined
      this.recordAudit({
        tenantId,
        channel: 'proxy',
        capability: 'mcp.call',
        target: activity.connector,
        outcome: outcome.status === 'done' ? 'fulfilled' : outcome.status,
      })
      persist()
      emit({ type: 'session.updated', session })
      return activity
    })
  },
  /** A private view never leaks the pending schema or opaque state to other
   * transcript readers. The exact flow, not a namespace owner, owns input. */
  mcpInputReview(sessionId: string, activityId: string, tenantId: string, actorUserId?: string, decisionId?: string): McpInputReviewState | undefined {
    const session = SESSIONS.find(row => row.id === sessionId)
    if (!session || !this.sessionVisibleToTenant(session, tenantId)) return undefined
    const exact = decisionId === undefined ? [] : [...session.messages ?? [], ...session.compactedMessages ?? []]
      .flatMap(row => row.toolActivities ?? []).filter(row => row.id === activityId && row.decisionId === decisionId)
    const activity = decisionId === undefined ? this.getToolActivity(sessionId, activityId) : exact.length === 1 ? exact[0] : undefined
    if (!activity?.mcp) return undefined
    const flow = activity.decisionId && mcpInputFlows.get(mcpInputFlowKey(sessionId, activity.decisionId))
    if (!flow || flow.activityId !== activityId || flow.tenantId !== tenantId ||
        flow.ownerUserId !== activeMcpActor(tenantId, actorUserId) || !this.sessionOwnedBy(session, tenantId) ||
        activity.status !== 'awaiting-input' || !flow.pending) return { activity: structuredClone(activity), review: null }
    const refusal = this.mcpInputRefusal(flow, activity)
    return { activity: structuredClone(activity), review: {
      decisionId: flow.decisionId, round: flow.round, expiresAt: flow.expiresAt,
      connectionLabel: activity.connector, toolName: activity.mcp.toolName,
      inputRequests: structuredClone(flow.pending.inputRequests), canContinue: !refusal,
      ...(refusal ? { refusal } : {}),
    } }
  },
  /** Current authority is rechecked immediately before reserving a response;
   * the executor repeats these checks around credential and network awaits. */
  mcpInputRefusal(flow: McpInputFlow, activity: ToolActivity): string | undefined {
    if (flow.expiresAt <= Date.now()) return 'This private input review expired. Stop locally; earlier remote effects may have occurred.'
    if (flow.bindingHash !== mcpInputBindingHash(activity)) return 'The original approved call changed. No follow-up can be sent.'
    const view = this.mcpConnection(activity.connectorId, flow.tenantId, flow.ownerUserId)
    const tool = view?.tools.find(row => row.name === activity.mcp?.toolName)
    if (!view || view.status !== 'connected' || view.protocolVersion !== MCP_MODERN_VERSION ||
        view.revision !== activity.mcp?.connectionRevision || !tool || mcpToolSchemaHash(tool) !== activity.mcp?.schemaHash ||
        !view.executableTools?.includes(tool.name) ||
        !this.sessionContexts(flow.sessionId, flow.ownerUserId).some(row => row.id === activity.connectorId && row.type === 'mcp')) {
      return 'The approved connection or attached tool is no longer available. Stop locally; no follow-up will be sent.'
    }
    return undefined
  },
  /** Used by the form executor around every asynchronous boundary, including
   * none/bearer connections whose ordinary registry access is tenant-scoped. */
  mcpInputExecutionPermitted(sessionId: string, activityId: string, decisionId: string, tenantId: string,
    actorUserId?: string): boolean {
    const flow = mcpInputFlows.get(mcpInputFlowKey(sessionId, decisionId))
    const activity = this.getToolActivity(sessionId, activityId)
    const session = SESSIONS.find(row => row.id === sessionId)
    return !!flow && !!activity && !!session && flow.activityId === activityId && flow.tenantId === tenantId &&
      this.sessionOwnedBy(session, tenantId) && flow.ownerUserId === activeMcpActor(tenantId, actorUserId) &&
      activity.decisionId === decisionId && activity.status === 'running' && !this.mcpInputRefusal(flow, activity)
  },
  /** Exact receipt reads never perform cleanup, credential lookup or network
   * work. Current public truth can advance beyond the acknowledged round. */
  mcpInputReceipt(sessionId: string, activityId: string, decisionId: string, responseId: string,
    tenantId: string, actorUserId?: string): McpInputReceipt | undefined {
    const session = SESSIONS.find(row => row.id === sessionId)
    const flow = mcpInputFlows.get(mcpInputFlowKey(sessionId, decisionId))
    if (!session || !flow || flow.activityId !== activityId || flow.tenantId !== tenantId ||
        !this.sessionOwnedBy(session, tenantId) || flow.ownerUserId !== activeMcpActor(tenantId, actorUserId)) return undefined
    const saved = flow.receipts.find(row => row.responseId === responseId)
    const matches = [...session.messages ?? [], ...session.compactedMessages ?? []].flatMap(row => row.toolActivities ?? [])
      .filter(row => row.id === activityId && row.decisionId === decisionId)
    if (!saved || matches.length !== 1) return undefined
    return { responseId, decisionId, round: saved.round, action: saved.action, activity: structuredClone(matches[0]!) }
  },
  /** Freeze and persist one response before I/O. A concurrent or restarted
   * request can only recover its receipt, never dispatch another attempt. */
  beginMcpInputResponse(sessionId: string, activityId: string, tenantId: string, actorUserId: string, input: unknown):
    { kind: 'execute'; activity: ToolActivity; continuation: McpBoundFormContinuation } |
    { kind: 'receipt'; receipt: McpInputReceipt } | 'invalid' | undefined {
    const command = parseMcpInputCommand(input)
    if (!command) return 'invalid'
    const session = SESSIONS.find(row => row.id === sessionId)
    const flow = mcpInputFlows.get(mcpInputFlowKey(sessionId, command.decisionId))
    if (!session || !flow || flow.activityId !== activityId || flow.tenantId !== tenantId ||
        !this.sessionOwnedBy(session, tenantId) || flow.ownerUserId !== activeMcpActor(tenantId, actorUserId)) return undefined
    const payloadHash = mcpInputCommandHash(command)
    const saved = flow.receipts.find(row => row.responseId === command.responseId)
    if (saved) {
      if (saved.payloadHash !== payloadHash) return 'invalid'
      const receipt = this.mcpInputReceipt(sessionId, activityId, command.decisionId, command.responseId, tenantId, actorUserId)
      return receipt ? { kind: 'receipt', receipt } : undefined
    }
    const activity = this.getToolActivity(sessionId, activityId)
    if (!activity || activity.decisionId !== command.decisionId || activity.status !== 'awaiting-input' ||
        !flow.pending || flow.round !== command.round || flow.bindingHash !== mcpInputBindingHash(activity)) return 'invalid'
    let continuation: McpBoundFormContinuation | undefined
    if (command.action === 'respond') {
      if (this.mcpInputRefusal(flow, activity)) return 'invalid'
      try { continuation = { pending: structuredClone(flow.pending), responses: parseMcpFormResponses(flow.pending, command.responses) } }
      catch { return 'invalid' }
    }
    return commitMutationBatch(() => {
      flow.receipts.push({ responseId: command.responseId, payloadHash, round: command.round, action: command.action })
      delete flow.pending
      activity.status = command.action === 'stop' ? 'uncertain' : 'running'
      activity.summary = command.action === 'stop'
        ? 'Stopped locally. No follow-up was sent; earlier remote effects may have occurred and their final outcome is unknown.'
        : 'Sending the privately reviewed MCP response…'
      activity.failure = command.action === 'stop' ? { code: 'connector_unavailable', retryable: false } : undefined
      persist()
      emit({ type: 'session.updated', session })
      if (continuation) return { kind: 'execute', activity, continuation }
      return { kind: 'receipt', receipt: this.mcpInputReceipt(sessionId, activityId, command.decisionId, command.responseId, tenantId, actorUserId)! }
    })
  },
  /** Time and membership revoke only waiting local reviews. Never race a live
   * request into apparent cancellation or dispatch anything from housekeeping. */
  expireMcpInputReviews(now = Date.now()): number {
    let count = 0
    return commitMutationBatch(() => {
      for (const flow of mcpInputFlows.values()) {
        if (!flow.pending || (flow.expiresAt > now && activeMcpActor(flow.tenantId, flow.ownerUserId))) continue
        const activity = this.getToolActivity(flow.sessionId, flow.activityId)
        const session = SESSIONS.find(row => row.id === flow.sessionId)
        if (!session || !activity || activity.decisionId !== flow.decisionId || activity.status !== 'awaiting-input') continue
        delete flow.pending
        activity.status = 'uncertain'
        activity.summary = 'The private MCP input review expired or its person lost access. No follow-up was sent; earlier remote effects may have occurred.'
        activity.failure = { code: 'connector_unavailable', retryable: false }
        count += 1
        emit({ type: 'session.updated', session })
      }
      if (count) persist()
      return count
    })
  },
  /** Claim a proposed action for execution — the synchronous gate that makes a
   *  confirm's execute-then-resolve sequence single-shot. The route's dispatch
   *  awaits (yields), so two concurrent confirms could both read `proposed` and
   *  execute the operation twice; the claim is taken BEFORE the first await, so
   *  only one caller wins. Returns true for that first caller only. Released by
   *  `releaseToolActivity` (inner refusal — the proposal stays open) or by
   *  `resolveToolActivity` (the verdict landed). Applies equally to generated
   *  API operations and connector/MCP actions. */
  claimToolActivity(sessionId: string, activityId: string, actorUserId?: string): boolean {
    const act = this.getToolActivity(sessionId, activityId)
    if (!act || act.kind !== 'action' || act.status !== 'proposed') return false
    const session = SESSIONS.find(candidate => candidate.id === sessionId)
    if (!session || !mcpActivityActorAllowed(session, act, actorUserId)) return false
    const key = `${sessionId}/${activityId}`
    if (TOOL_ACTIVITY_INFLIGHT.has(key)) return false
    TOOL_ACTIVITY_INFLIGHT.add(key)
    return true
  },
  /** Drop an execution claim without resolving — the effect runtime refused, so
   *  the activity stays `proposed` and confirm/decline both remain open. */
  releaseToolActivity(sessionId: string, activityId: string): void {
    TOOL_ACTIVITY_INFLIGHT.delete(`${sessionId}/${activityId}`)
  },
  /** Record the user's verdict on a proposed action. For an API-op activity the
   *  ROUTE has already executed the operation (through the router, as the
   *  confirmer — INV-11) and passes the result as `doneSummary`; a connector
   *  activity also carries the connector runtime's accepted result. Audited
   *  under the matching capability.
   *  A keyed verdict replays only its exact durable receipt; legacy unkeyed
   *  callers retain terminal-state replay. Generated writes receive the derived
   *  receipt key and connector adapters receive the stable activity id, but a confirm
   *  must still win `claimToolActivity` before dispatch (released here when the
   *  verdict lands, or by `releaseToolActivity` on an inner refusal). */
  resolveToolActivity(
    sessionId: string,
    activityId: string,
    decision: 'confirm' | 'decline',
    doneSummary?: string,
    options: { logicalId?: string; tenantId?: string; actorUserId?: string } = {},
  ): ToolActivity | 'invalid' | undefined {
    const session = SESSIONS.find((s) => s.id === sessionId)
    const activity = session && [
      ...(session.messages ?? []).flatMap(message => message.toolActivities ?? []),
      ...(session.compactedMessages ?? []).flatMap(message => message.toolActivities ?? []),
    ].find(candidate => candidate.id === activityId)
    if (session && activity && !mcpActivityActorAllowed(session, activity, options.actorUserId)) return undefined
    // The verdict lands (or the record is gone — e.g. a confirmed op deleted its
    // own hosting session): drop any execution claim unconditionally, so no
    // outcome can leave a `sessionId/activityId` key wedged in the in-flight set.
    TOOL_ACTIVITY_INFLIGHT.delete(`${sessionId}/${activityId}`)
    if (options.logicalId) {
      if (!options.tenantId) return 'invalid'
      const represented = this.getToolActivityDecision(
        sessionId,
        activityId,
        options.logicalId,
        options.tenantId,
        decision,
        options.actorUserId,
      )
      if (typeof represented === 'object') return represented
      if (represented === 'invalid') return represented
    }
    const currentSession = SESSIONS.find((s) => s.id === sessionId)
    if (!currentSession?.messages) return undefined
    if (options.tenantId && !this.sessionOwnedBy(currentSession, options.tenantId)) return undefined
    const matches = currentSession.messages
      .flatMap((message) => message.toolActivities ?? [])
      .filter((activity) => activity.id === activityId)
    if (matches.length > 1) return 'invalid'
    for (const m of currentSession.messages) {
      const act = m.toolActivities?.find((a) => a.id === activityId)
      if (!act) continue
      if (act.kind !== 'action' || act.status !== 'proposed') {
        return options.logicalId ? 'invalid' : act // legacy callers retain idempotent finality
      }
      // External MCP execution is a durable two-phase transition. It may never
      // cross the legacy execute-then-resolve connector shortcut.
      if (decision === 'confirm' && act.mcp) return 'invalid'
      // A connector action without a settled runtime result must stay open.
      // This prevents an internal caller from manufacturing `done` from the
      // development fixture or a generic string after the consent click.
      if (decision === 'confirm' && !act.op && !doneSummary) return act
      return commitMutationBatch(() => {
        act.status = decision === 'decline' ? 'declined' : 'done'
        if (options.logicalId) act.decisionId = options.logicalId
        if (decision === 'confirm') {
          act.summary = doneSummary ?? `${act.op?.method} ${act.op?.path} completed.`
          this.recordAudit({
            tenantId: currentSession.tenantId ?? defaultTenantId(),
            channel: 'proxy',
            capability: act.op ? 'api.write' : 'connector.write',
            target: act.op ? `${act.op.method} ${act.op.path}` : act.connector,
            outcome: 'fulfilled',
          })
        }
        persist()
        emit({ type: 'session.updated', session: currentSession })
        return act
      })
    }
    return undefined
  },

  /** A session's live workspace — the panels it has grown. Lazily seeded from the
   *  flat seed fields (server/workspace.ts) so a never-touched session still
   *  reports its seeded panels; an unknown / run session reports an empty one. */
  sessionWorkspace(id: string): SessionWorkspace {
    const stored = sessionWorkspaces.get(id)
    if (stored) return stored
    const session = SESSIONS.find((s) => s.id === id)
    const seeded = session ? workspaceFromSeed(session) : { ...EMPTY_WORKSPACE }
    sessionWorkspaces.set(id, seeded)
    return seeded
  },
  /** Binary snapshots are stored once, separately from workspace projections.
   * Deduplication is tenant-scoped, so content equality cannot expose another
   * account's upload. Abandoned selections expire only when unreferenced. */
  putImageAsset(tenantId: string, input: unknown) {
    const parsed = parseImageAssetUpload(input)
    if (!parsed) throw new ValidationError('Choose a valid image snapshot up to 3 MB and an original up to 8 MB.')
    const referenced = new Set([...sessionWorkspaces.values()].flatMap((workspace) => workspace.attachments.flatMap((item) => {
      const image = attachmentImageRef(item)
      return image ? [image.id] : []
    })))
    const cutoff = Date.now() - 60 * 60 * 1000
    // Garbage collection is its own committed transition; a later quota refusal
    // must not leave an uncommitted removal or poison the compound-mutation wall.
    if (imageAssets.remove(imageAssets.snapshot().filter((row) => row.createdAt < cutoff && !referenced.has(row.id)).map((row) => row.id))) persist()
    const row = imageAssets.put(tenantId, parsed.image, Date.now(), parsed.original)
    persist()
    return imageAssetRef(row.id, row.image, row.original)
  },
  /** Private source bytes are never widened by a conversation sharing grant. */
  imageOriginalForTenant(id: string, tenantId: string): ImageOriginalDownload | undefined {
    const row = imageAssets.get(id)
    return row?.tenantId === tenantId && row.original ? { id, original: row.original } : undefined
  },
  imageAssetForTenant(id: string, tenantId: string): ImageSnapshot | undefined {
    const row = imageAssets.get(id)
    if (!row) return undefined
    const visible = row.tenantId === tenantId || SESSIONS.some((session) =>
      this.sessionVisibleToTenant(session, tenantId) &&
      sessionWorkspaces.get(session.id)?.attachments.some((item) => attachmentImageRef(item)?.id === id))
    return visible ? row.image : undefined
  },
  imageReferencesAttachable(attachments: readonly import('../../contract/entities.ts').Attachment[], sessionId: string, tenantId: string): boolean {
    const current = this.sessionWorkspace(sessionId).attachments
    return attachments.every((item) => {
      const image = attachmentImageRef(item)
      if (!image) return true
      const row = imageAssets.get(image.id)
      if (!row || !imageAssetRefMatches(image, row.image, row.original)) return false
      if (item.imageSnapshot) {
        const represented = current.find((old) => old.id === item.id)?.imageSnapshot
        if (!represented &&
            (row.tenantId !== tenantId || !canAdmitServedImageSnapshot(sessionId, item))) return false
      }
      return row.tenantId === tenantId || this.sessionWorkspace(sessionId).attachments.some((old) => attachmentImageRef(old)?.id === row.id)
    })
  },
  /** Capture exactly the references in this authorized conversation; neither
   * caller-supplied ids elsewhere nor preview URLs can widen a model's input. */
  sessionImageInput(sessionId: string): Readonly<Record<string, ImageSnapshot>> {
    const images: Record<string, ImageSnapshot> = Object.create(null)
    for (const item of this.sessionWorkspace(sessionId).attachments) {
      const image = attachmentImageRef(item)
      if (!image) continue
      const row = imageAssets.get(image.id)
      if (row && imageAssetRefMatches(image, row.image, row.original)) images[row.id] = row.image
    }
    return images
  },
  /** Replace a session's live workspace (the client's attach/detach write-through —
   *  it assembles the merged panels from the server-owned context catalogs and
   *  persists the result here, the system of record). Broadcasts `session.updated`
   *  so any other client reconciles. Returns the stored workspace. */
  setSessionWorkspace(id: string, workspace: SessionWorkspace): SessionWorkspace {
    const committedWorkspace = preserveSessionWorkspaceSnapshots(id, workspace)
    sessionWorkspaces.set(id, committedWorkspace)
    pruneSessionPreferences(id, committedWorkspace)
    const session = SESSIONS.find((s) => s.id === id)
    if (session) emit({ type: 'session.updated', session })
    persist()
    return committedWorkspace
  },

  /** This viewer's durable panel intent for a session. Kept outside the shared
   * Session row so collaborators can view the same conversation differently. */
  sessionPreferences(userId: string, sessionId: string): SessionPreferences {
    return viewerSessionPreferences(userId, sessionId)
  },
  setSessionPreferences(userId: string, sessionId: string, panelFocus: import('../../contract/index.ts').PanelFocus | null): SessionPreferences {
    const session = SESSIONS.find((row) => row.id === sessionId)
    if (!session) throw new ValidationError(`No session '${sessionId}'`)
    try {
      const next = writeSessionPreferences(userId, sessionId, panelFocus, this.sessionWorkspace(sessionId))
      emit({ type: 'session.updated', session })
      persist()
      return next
    } catch (error) {
      if (error instanceof Error) throw new ValidationError(error.message)
      throw error
    }
  },

  /** Personal composer intent is scoped by both active namespace and person.
   * References remain preferences only; send-time registry validation owns
   * execution authority. */
  modelPreferences(tenantId: string, userId: string): ViewerModelPreferences {
    return viewerModelPreferences(tenantId, userId)
  },
  setModelPreferences(
    tenantId: string,
    userId: string,
    expectedTenantId: string,
    expectedUserId: string,
    expectedRevision: number,
    preferences: ModelPreferences,
  ): ViewerModelPreferences {
    const result = writeModelPreferences(
      tenantId, userId, expectedTenantId, expectedUserId, expectedRevision, preferences,
    )
    if (result.changed) persist()
    return result.value
  },

  /** Mint a server-owned message id. The conversation is the system of record, so
   *  persisted messages carry the backend's id — not one the client fabricated. */
  mintMessageId(role: 'user' | 'assistant'): string {
    return `m-${role[0]}-${(messageSeq += 1)}`
  },

  /** Materialize a new persisted session — the desktop app's "New chat" the moment
   *  it's first sent to. `firstMessage` seeds the title (its first words) + preview.
   *  The HUMAN adapter of the one mint funnel (`mintSession`); the agent adapter is
   *  `ensureRunSession` — same row shape, same broadcast/persist, differing only in
   *  the initiator stamp. The creating tenant is always stamped so the scoped
   *  list/read see it (F2 / PD9): the route passes the caller's tenant; absent
   *  that it's the backend's default tenant. */
  /** CONTINUE a conversation from one of its turns, in the caller's own
   *  namespace (social S3 — the design's "continue from turn 12 in your
   *  namespace"). Needs the `propose` tier on the source, mirroring
   *  `forkAgent`'s shape: a fork is a direct act, not a proposal, because it
   *  changes nothing about the source — there is nothing for its owner to
   *  consent to. They are RUNG instead, as public credit (the D18 rule).
   *
   *  The copy stops AT the named turn inclusive: that is what "from turn 12"
   *  means, and taking the whole thread would make the locus decorative. */
  forkSession(
    sourceId: string,
    atMessageId: string,
    tenantId: string,
    options: { logicalId?: string } = {},
  ): Session | 'forbidden' | undefined {
    if (options.logicalId) {
      if (!isForkSessionCreationId(options.logicalId)) {
        throw new ValidationError('That conversation branch identity is malformed.')
      }
      const represented = this.getSessionCreation(options.logicalId, tenantId)
      if (typeof represented === 'object') return represented
      if (represented === 'invalid') {
        throw new ValidationError('That conversation branch identity is already owned by another account.')
      }
      if (represented === 'retired') {
        throw new ValidationError('That conversation branch identity was already retired.')
      }
    }
    const source = SESSIONS.find((x) => x.id === sourceId)
    if (!source || !this.sessionVisibleToTenant(source, tenantId)) return undefined
    if (!this.socialSubjectProposable({ kind: 'session', id: sourceId }, tenantId)) return 'forbidden'
    const msgs = source.messages ?? []
    const cut = msgs.findIndex((m) => m.id === atMessageId)
    if (cut < 0) return undefined
    const taken = structuredClone(msgs.slice(0, cut + 1))
    if (hasExternalMcpActivity(taken, pendingExternalMcp)) throw unresolvedMcpConflict()
    const inputFlowCopies = new Map<string, McpInputFlow>()
    for (const activity of taken.flatMap(message => message.toolActivities ?? [])) {
      if (!activity.decisionId) continue
      const flow = mcpInputFlows.get(mcpInputFlowKey(source.id, activity.decisionId))
      if (flow && flow.tenantId === tenantId) inputFlowCopies.set(flow.decisionId, flow)
    }
    if (!hasMcpInputFlowCapacity(mcpInputFlows.size, inputFlowCopies.size)) {
      throw new LimitError(`Private MCP input flow capacity is full (${MCP_INPUT_MAX_FLOWS}).`)
    }
    return commitMutationBatch(() => {
      const fork = mintSession({
        id: options.logicalId ?? `sess-${(sessionSeq += 1)}`,
        title: source.title,
        preview: source.preview,
        tenantId,
        messages: taken,
        forkedFrom: { sessionId: source.id, title: source.title, atMessageId },
      })
      const forkActivityIds = new Set(taken.flatMap(message => message.toolActivities ?? []).map(activity => activity.id))
      for (const activityId of forkActivityIds) {
        const authority = mcpActivityAuthorities.get(mcpActivityAuthorityKey(source.id, activityId))
        if (authority) mcpActivityAuthorities.set(mcpActivityAuthorityKey(fork.id, activityId), { ...authority, sessionId: fork.id })
      }
      for (const flow of inputFlowCopies.values()) {
        mcpInputFlows.set(mcpInputFlowKey(fork.id, flow.decisionId), { ...structuredClone(flow), sessionId: fork.id })
      }
      // Public credit, like a definition fork: the source's owner is told.
      notifyTenants([source.tenantId ?? defaultTenantId()], tenantId, {
        kind: 'social.forked',
        actor: tenantName(tenantId),
        subjectKind: 'session',
        subjectId: source.id,
        subjectName: source.title,
      })
      persist()
      return fork
    })
  },
  createSession(
    firstMessage?: string,
    tenantId: string = defaultTenantId(),
    providerId?: string,
    modelId?: string,
    options: { logicalId?: string; persistFirstMessage?: true } = {},
  ): Session {
    if (options.logicalId) {
      if (!isDraftSessionCreationId(options.logicalId)) {
        throw new ValidationError('That conversation creation identity is malformed.')
      }
      const represented = this.getSessionCreation(options.logicalId, tenantId)
      if (typeof represented === 'object') return represented
      if (represented === 'invalid') {
        throw new ValidationError('That conversation creation identity is already owned by another account.')
      }
      if (represented === 'retired') {
        throw new ValidationError('That conversation creation identity was already retired.')
      }
    }
    if (options.persistFirstMessage && (typeof firstMessage !== 'string' || !firstMessage.trim())) {
      throw new ValidationError('Persisting a first message requires non-empty text.')
    }
    // A draft's concrete model pick must name an entry in its effective provider's
    // catalog (the picked provider's, else the default Agent's) — refused otherwise.
    if (modelId) assertModelInCatalog(modelId, providerId)
    return mintSession({
      id: options.logicalId ?? `sess-${(sessionSeq += 1)}`,
      title: titleFrom(firstMessage),
      preview: (firstMessage ?? '').slice(0, 120),
      tenantId,
      // The composer's model pick, when the draft made one (route-validated).
      providerId,
      modelId,
      ...(options.persistFirstMessage
        ? {
            messages: [{
              id: this.mintMessageId('user'),
              role: 'user' as const,
              content: firstMessage!,
            }],
          }
        : {}),
    })
  },

  /** The seeded worker Agents (docs/agent-commons.md, D6) — the degenerate N=1 set. */
  listAgents(tenantId?: string): Agent[] {
    // Tenant-scoped (F2/PD9): the shared default agent (no tenantId) is visible to all; a
    // created one only to its tenant. No arg ⇒ all (internal use, e.g. resolveAgent).
    return [...WORKER_AGENTS.values()].filter((a) => registryVisible(a, tenantId))
  },
  /** Resolve a Conversation's worker Agent; unset/unknown falls back to the seeded
   *  default. */
  getAgent(id?: string): Agent {
    return resolveAgent(id)
  },
  /** Private historical provenance only, not live permission. Never serialize
   * this into Agent rows; callers must separately check current membership,
   * Agent visibility/configuration, and explicit per-call human consent. */
  agentProvenance(id: string) {
    return agentOwnershipRegistry.get(id)
  },
  /** Only verified sessions or the explicit credential-less desktop posture
   * can address person-private requests. Development impersonation is not it. */
  agentRequestActor(headers?: Record<string, string | string[] | undefined>): ProxyActor | undefined {
    const who = this.identity(headers)
    if (!agentPerson(who, this.capabilities().features.authGate)) return undefined
    return accounts.identityFor(who.user.id, who.tenant.id) ? { tenantId: who.tenant.id, userId: who.user.id } : undefined
  },
  agentRequests(actor: ProxyActor) { return proxyRequestHost.list(actor) },
  agentRequestOptions(actor: ProxyActor) {
    const sourceAgents: { id: string; label: string }[] = [], targetAgents: { id: string; label: string }[] = []
    if (!accounts.identityFor(actor.userId, actor.tenantId)) return { sourceAgents, targetAgents }
    for (const agent of WORKER_AGENTS.values()) {
      const owner = agentOwnershipRegistry.get(agent.id)
      if (!owner || owner.retired || !accounts.identityFor(owner.ownerUserId, owner.tenantId)) continue
      if (owner.ownerUserId === actor.userId && owner.tenantId === actor.tenantId) sourceAgents.push({ id: agent.id, label: agent.label })
      else if (owner.ownerUserId !== actor.userId && (agent.published || registryVisible(agent, actor.tenantId))) {
        targetAgents.push({ id: agent.id, label: agent.label })
      }
    }
    return { sourceAgents, targetAgents }
  },
  agentRequest(id: string, actor: ProxyActor) { return proxyRequestHost.read(id, actor) },
  agentRequestReview(id: string, actor: ProxyActor): AgentRequestReview | undefined {
    const request = proxyRequestHost.read(id, actor), row = proxyRequestRegistry.get(id)
    if (!request || request.role !== 'owner' || !row) return undefined
    const tools = proxyRequestTools(row.intent.owner.agentId, actor)
    const blockedReason = row.executionBlockedByRestore ? 'This request was restored from a backup and cannot run. Ask for a fresh request after checking any earlier effects.' :
      row.status !== 'waiting' ? 'This request is no longer waiting to run.' :
      !proxyRequestHost.executable(row) ? 'An original Agent, person membership or visibility is no longer available.' :
      !WORKER_AGENTS.get(row.intent.owner.agentId)?.providerId ? 'Bind a model provider to this Agent before reviewing a call.' :
      !tools.length ? 'Connect and inspect an MCP server admitted by this Agent’s connection reach.' : null
    const draftModel = row.status === 'waiting' ? proxyRequestDraftModel(row) : undefined
    return { request, tools: row.status === 'waiting' ? tools : [], blockedReason, ...(draftModel ? { draftModel } : {}) }
  },
  createAgentRequest(actor: ProxyActor, key: unknown, input: unknown) { return proxyRequestHost.create(actor, key, input) },
  decideAgentRequest(id: string, actor: ProxyActor, input: unknown) {
    const view = proxyRequestHost.decide(id, actor, input)
    if (view.status === 'cancelled' || view.status === 'denied') { proxyRequestExecution.cancel(id); proxyArgumentExecution.cancel(id) }
    return view
  },
  runAgentRequest(id: string, actor: ProxyActor, input: unknown, authenticated: () => boolean) {
    proxyRequestExecution.start(id, actor, input, authenticated)
    return proxyRequestHost.read(id, actor)
  },
  draftAgentRequestArguments(id: string, actor: ProxyActor, input: unknown, authenticated: () => boolean) {
    proxyArgumentExecution.start(id, actor, input, authenticated)
    return proxyRequestHost.read(id, actor)
  },
  async stopAgentRequests() { await Promise.all([proxyRequestExecution.stop(), proxyArgumentExecution.stop()]) },
  /** Mint a worker Agent through the D8 creation funnel (docs/agent-commons.md): both
   *  faces of the cascade are enforced here against the Agent's **provider** (D9 — the
   *  cascade root), so the *agent ⊆ provider* invariant holds by construction.
   *  Authority (the primary face — tools / connectors / scopes) is checked with
   *  `mintAuthority`; the token budget (the quota face) with `mintBudget` against the
   *  provider plan, falling back to the account plan for a provider that declares none.
   *  The single seam where an Agent's grants are validated — there is no other way to
   *  introduce one. The mutated registry is snapshotted to disk (persist.ts), so a
   *  created Agent survives a restart. */
  createAgent(
    input: Omit<Agent, 'id'>,
    tenantId?: string,
    options: { logicalId?: string; ownerUserId?: string } = {},
  ): Agent {
    const ownerTenant = tenantId ?? input.tenantId
    // A keyed create owns this exact row beyond the HTTP response cache. A
    // replay is side-effect free and cannot overwrite later configuration.
    if (options.logicalId) {
      if (!ownerTenant) {
        throw new ValidationError('A keyed Agent creation must be account-scoped.')
      }
      if (!isAgentCreationId(options.logicalId)) {
        throw new ValidationError('That Agent creation identity is not valid.')
      }
      if (retiredAgentCreationIds.has(options.logicalId)) {
        throw new ValidationError('That Agent creation identity was already removed.')
      }
      const represented = WORKER_AGENTS.get(options.logicalId)
      if (represented) {
        if (represented.tenantId !== ownerTenant) {
          throw new ValidationError('That Agent creation identity is already owned by another account.')
        }
        return represented
      }
    }
    const provider = resolveProvider(input.providerId)
    if (input.authority) mintAuthority(provider.authority, input.authority)
    if (input.budget) mintBudget(provider.plan?.windows ?? usageRegistry.planCeilings(), input.budget)
    // Stamp the creating tenant (F2/PD9) so listAgents(tenant) scopes it; unset ⇒ shared.
    const agent: Agent = {
      ...input,
      id: options.logicalId ?? `agent-${workerAgentSeq + 1}`,
      tenantId: ownerTenant,
      revision: 0,
    }
    if (agentOwnershipRegistry.get(agent.id)) throw new ValidationError('That Agent identity has retained ownership history.')
    let ownership: AgentOwnership | undefined
    if (options.ownerUserId !== undefined) {
      if (!ownerTenant || !accounts.identityFor(options.ownerUserId, ownerTenant)) {
        throw new ValidationError('The creating person no longer has access to this account.')
      }
      try {
        ownership = agentOwnershipRegistry.prepare({ agentId: agent.id, tenantId: ownerTenant, ownerUserId: options.ownerUserId })
      } catch { throw new ValidationError('Private Agent ownership could not be recorded.') }
    }
    return commitMutationBatch(() => {
      if (ownership) agentOwnershipRegistry.bind(ownership)
      if (!options.logicalId) workerAgentSeq += 1
      WORKER_AGENTS.set(agent.id, agent)
      emitAgentChanged(agent)
      persist()
      return agent
    })
  },
  /** Create an Agent from a management request: resolve the `systemPrompt` body from the
   *  chosen library entry (D10), treat an omitted tool grant as empty, and run the same
   *  D8 funnel via `createAgent`. **Strict**: the provider and
   *  prompt bindings are required and must resolve — a missing/empty/unknown reference is
   *  a `ValidationError`, never an implicit resolution to a default (default-flagged
   *  entries are a UI pre-selection shortcut; the request must arrive concrete). */
  createAgentFromRequest(
    input: CreateAgentRequest,
    tenantId?: string,
    options: { logicalId?: string; ownerUserId?: string } = {},
  ): Agent {
    const provider = input.providerId ? MODEL_PROVIDERS.get(input.providerId) : undefined
    if (!provider) throw new ValidationError(`An agent must name a registered model provider — no provider '${input.providerId ?? ''}'.`)
    const entry = input.systemPromptId ? SYSTEM_PROMPT_LIB.get(input.systemPromptId) : undefined
    if (!entry) throw new ValidationError(`An agent must name a library system prompt — no system prompt '${input.systemPromptId ?? ''}'.`)
    return this.createAgent({
      label: input.label,
      systemPrompt: entry.body,
      systemPromptId: entry.id,
      providerId: provider.id,
      // Minimal risk (INV-9 'none' class): an omitted tool grant means NO tools — the
      // API never widens silently. The full catalog is an EXPLICIT, visible grant
      // (the dialog's checkbox; the tool builder stamps it onto the consent card).
      tools: input.tools ?? [],
      instructions: input.instructions ?? '',
      authority: input.authority,
      budget: input.budget,
    }, tenantId, options)
  },
  /** Exact creator-only state for a keyed direct creation, definition fork, or
   * remote-card import. Routes use this before changed Retry input/source I/O. */
  getAgentCreation(id: string, tenantId: string): Agent | 'invalid' | 'retired' | undefined {
    if (!isAgentCreationId(id)) return 'invalid'
    if (retiredAgentCreationIds.has(id)) return 'retired'
    const agent = WORKER_AGENTS.get(id)
    if (!agent) return undefined
    if (agent.tenantId !== tenantId) return 'invalid'
    return agent
  },
  /** Patch an Agent. A present field is applied; an absent one is left unchanged.
   *  **Strict like create**: a present provider / prompt id must resolve — empty string
   *  or an unknown id is a `ValidationError` ("clear to default" no longer exists; omit
   *  the field to keep the current binding, including a bespoke merged/forked prompt).
   *  Changing the prompt re-resolves the body; changing the provider (or grants)
   *  re-validates authority / budget against the resulting provider — the D8 funnel
   *  runs again, so a patch can't smuggle an over-grant past it. Undefined when
   *  unknown (→ 404). */
  updateAgentFromRequest(
    id: string,
    patch: AgentConfigurationPatch,
    expectedRevision?: number,
  ): Agent | undefined {
    const current = WORKER_AGENTS.get(id)
    if (!current) return undefined
    const currentRevision = current.revision ?? 0
    if (expectedRevision !== undefined && expectedRevision !== currentRevision) {
      throw new ConflictError(
        `This agent changed elsewhere (expected revision ${expectedRevision}, current revision ${currentRevision}).`,
      )
    }
    let providerId = current.providerId
    if ('providerId' in patch) {
      if (!patch.providerId || !MODEL_PROVIDERS.has(patch.providerId)) {
        throw new ValidationError(`An agent must name a registered model provider — no provider '${patch.providerId ?? ''}'.`)
      }
      providerId = patch.providerId
    }
    let systemPrompt = current.systemPrompt
    let systemPromptId = current.systemPromptId
    if ('systemPromptId' in patch) {
      const entry = patch.systemPromptId ? SYSTEM_PROMPT_LIB.get(patch.systemPromptId) : undefined
      if (!entry) throw new ValidationError(`An agent must name a library system prompt — no system prompt '${patch.systemPromptId ?? ''}'.`)
      systemPromptId = entry.id
      systemPrompt = entry.body
    }
    const authority = 'authority' in patch ? patch.authority : current.authority
    const budget = 'budget' in patch ? patch.budget : current.budget
    const provider = resolveProvider(providerId)
    if (authority) mintAuthority(provider.authority, authority)
    if (budget) mintBudget(provider.plan?.windows ?? usageRegistry.planCeilings(), budget)
    const next: Agent = {
      ...current,
      label: patch.label ?? current.label,
      instructions: 'instructions' in patch ? patch.instructions ?? '' : current.instructions,
      tools: patch.tools ?? current.tools,
      providerId,
      systemPrompt,
      systemPromptId,
      authority,
      budget,
      // The D18 publish/unpublish act — an explicit toggle on the patch path only
      // (never a creation side-effect). Normalized: false stores as absent.
      published: 'published' in patch ? (patch.published === true ? true : undefined) : current.published,
      id: current.id,
      revision: currentRevision + 1,
    }
    // D25 versioning: an owner edit that changes the DEFINITION of a published
    // agent bumps the version and logs authorship (private edits are drafts —
    // they don't version). Compared against `current`, so a no-op patch is silent.
    const definitionChanged =
      next.label !== current.label ||
      next.systemPrompt !== current.systemPrompt ||
      next.instructions !== current.instructions ||
      JSON.stringify(next.tools) !== JSON.stringify(current.tools)
    if (current.published === true && definitionChanged) {
      next.version = (current.version ?? 1) + 1
      next.changelog = [
        ...(current.changelog ?? []),
        { version: next.version, author: tenantName(current.tenantId ?? defaultTenantId()), note: 'Edited by the owner', at: Date.now() },
      ]
    }
    WORKER_AGENTS.set(id, next)
    reclampCommissionsOf(next) // D8 runtime: a narrowed Agent re-clamps its Contributors' grants
    // A re-bound provider changes what sessions INHERITING this Agent's provider
    // resolve to — their held model picks may now name another catalog's entries.
    if (next.providerId !== current.providerId) sweepSessionModelPicks()
    emitAgentChanged(next, current.published === true || next.published === true)
    persist()
    return next
  },
  /** Remove the exact reviewed Agent definition. The revision precondition and
   * dependency guards run before effects; proposal history, delegations, the row,
   * and any invalid session model picks then disappear in one durable/event batch.
   * Conversations and prior contribution records survive. */
  deleteAgent(id: string, expectedRevision?: number): boolean {
    const current = WORKER_AGENTS.get(id)
    if (!current) return false
    const currentRevision = current.revision ?? 0
    if (expectedRevision !== undefined && expectedRevision !== currentRevision) {
      throw new ConflictError(
        `This agent changed elsewhere (expected revision ${expectedRevision}, current revision ${currentRevision}).`,
      )
    }
    if (id === DEFAULT_AGENT.id) throw new ConflictError('The default agent can’t be removed.')
    const commissioned = [...COMMISSIONS.values()].filter((c) => c.agentId === id)
    if (commissioned.length > 0) {
      throw new ConflictError(
        `${commissioned.length} commission${commissioned.length === 1 ? '' : 's'} still ${commissioned.length === 1 ? 'assigns' : 'assign'} this agent — remove ${commissioned.length === 1 ? 'it' : 'them'} first.`,
      )
    }
    return commitMutationBatch(() => {
      // D25 hygiene: an orphaned proposal queue would ride the snapshot forever.
      AGENT_PROPOSALS.delete(id)
      // CW8: a delegation must not outlive its delegate. Notify each affected
      // Project once after the committed graph is already coherent.
      for (const projectId of new Set(delegations.filter((d) => d.agentId === id).map((d) => d.projectId))) {
        emit({ type: 'delegation.changed', projectId })
      }
      for (let i = delegations.length - 1; i >= 0; i -= 1) {
        if (delegations[i].agentId === id) {
          const delegation = delegations[i]
          if (isDelegationCreationId(delegation.id)) {
            delegationRetirements.push({
              delegationId: delegation.id,
              projectId: delegation.projectId,
              createdAt: delegation.createdAt,
            })
          }
          delegations.splice(i, 1)
        }
      }
      WORKER_AGENTS.delete(id)
      agentOwnershipRegistry.retire(id)
      if (isAgentCreationId(id)) retiredAgentCreationIds.add(id)
      // Sessions survive and resolve to the default Agent. Clear only model
      // picks invalid under that new inheritance chain.
      sweepSessionModelPicks()
      emitAgentChanged(current)
      persist()
      return true
    })
  },

  // ── Model providers (the cognition source — docs/agent-commons.md, D9) ──
  /** The registered Model providers, tenant-scoped (F2/PD9): the shared seeded provider(s)
   *  are visible to all; a created one only to its tenant. No arg ⇒ all (internal use).
   *  A `kind:'session'` row is stamped with its computed `online` flag at read time —
   *  the status dot; the flag is transient relay state, never stored. The viewer's
   *  default flag (`isDefault` — the UI pre-selection shortcut) is stamped the same
   *  way, from the per-tenant pointer, so it can never leak across tenants. */
  listProviders(tenantId?: string): ModelProvider[] {
    const defaultId = defaultsFor(tenantId)?.providerId
    return [...MODEL_PROVIDERS.values()]
      .filter((p) => registryVisible(p, tenantId))
      .map((p) => {
        // Protocol is connection truth, never provider-row truth. Strip any
        // stale/legacy row field before deriving the safe read projection.
        const { protocol: _storedProtocol, ...storedProvider } = p
        const provider = { ...storedProvider, definitionRevision: p.definitionRevision ?? 0 }
        const config = PROVIDER_CONFIGS.get(p.id)
        return p.kind === 'session'
          ? // The relay's live serving picture, stamped per read like `online`
            // (v5 handshake, observed half): how many conversations hold an
            // in-flight turn, and the negotiated admission window. Kept live by
            // `relay.activity` events; never stored, stripped at every patch.
            { ...provider, online: relay.online(p.id), activeConversations: relay.activeConversations(p.id), conversationWindow: relay.window(p.id) }
          : // What an UNSET pick resolves to and whether its server-only endpoint
            // can honestly execute. Both are serve-time stamps, never caller or
            // snapshot truth.
            {
              ...provider,
              connectionRevision: p.connectionRevision ?? 0,
              ...(config?.protocol === undefined
                ? { protocol: 'anthropic-messages' as const }
                : isEndpointProtocol(config.protocol)
                  ? { protocol: config.protocol }
                  : {}),
              defaultModelId: resolvedModelId(config),
              execution: endpointExecution(config),
            }
      })
      .map((p) => (p.id === defaultId ? { ...p, isDefault: true } : p))
  },
  /** Move / clear the caller's **default-provider** flag (the UI shortcut — see
   *  REGISTRY_DEFAULTS). `id` must be a provider the caller can see; `undefined`
   *  clears the flag, leaving the registry with no default (a valid state). */
  setDefaultProvider(id: string | undefined, tenantId?: string): void {
    if (id !== undefined && ![...MODEL_PROVIDERS.values()].some((p) => p.id === id && registryVisible(p, tenantId))) {
      throw new ValidationError(`No provider '${id}' to set as the default.`)
    }
    const ownerTenant = tenantId ?? defaultTenantId()
    const previous = defaultsFor(ownerTenant)?.providerId
    if (previous === id) return
    setRegistryDefault('providerId', id, ownerTenant)
    const changedId = id ?? previous
    if (changedId) emit({ type: 'provider.changed', providerId: changedId, tenantId: ownerTenant })
    persist()
  },
  /** Resolve an Agent's Model provider; unset/unknown falls back to the seeded
   *  default. */
  getProvider(id?: string): ModelProvider {
    return resolveProvider(id)
  },
  /** The endpoint + model config a turn on this provider runs against — server-only,
   *  never on the contract. Every field unset (the default provider) = inherit
   *  `generate.ts`'s env defaults, so `ANTHROPIC_BASE_URL` / `ANTHROPIC_MODEL` stay
   *  the one source for them. */
  providerConfig(id?: string): ProviderConfig {
    return PROVIDER_CONFIGS.get(id ?? '') ?? DEFAULT_PROVIDER_CONFIG
  },
  /** Credential references currently reachable from durable provider configs.
   * The desktop launcher uses this server-only projection after rehydration to
   * reconcile its OS-encrypted vault. Values never appear on HTTP reads, and the
   * launcher filters to its generated PROVIDER_DESKTOP_* namespace before IPC. */
  providerCredentialBindings(): { reference: string; providerId: string }[] {
    return [...PROVIDER_CONFIGS.entries()].flatMap(([providerId, config]) =>
      config.apiKeyEnv ? [{ reference: config.apiKeyEnv, providerId }] : [],
    )
  },
  /** Mint a Model provider through the D8 funnel: its plan must attenuate the account
   *  plan (`planCeilings`), so the cascade root can never exceed the subscription it
   *  sits under. The single seam a provider plan is validated — and the single seam a
   *  config that brings its **own endpoint** must arrive already carrying the probed
   *  capability record (`probeProviderEndpoint`, run by the route): an unverified
   *  endpoint is unrepresentable in the registry, same shape as an over-grant. */
  createProvider(
    input: Omit<ModelProvider, 'id'>,
    config: ProviderConfig = {},
    tenantId?: string,
    options: { logicalId?: string; isDefault?: boolean } = {},
  ): ModelProvider {
    const ownerTenant = tenantId ?? input.tenantId
    // A keyed registration owns this exact row beyond the process-local HTTP
    // response cache. Returning the represented row is deliberately side-effect
    // free: a later default choice must not be rewound by replaying an old mint.
    if (options.logicalId) {
      if (!ownerTenant) {
        throw new ValidationError('A keyed provider registration must be account-scoped.')
      }
      const represented = MODEL_PROVIDERS.get(options.logicalId)
      if (represented) {
        if (represented.tenantId !== ownerTenant) {
          throw new ValidationError('That provider registration identity is already owned by another account.')
        }
        return represented
      }
    }
    if (input.plan) mintBudget(usageRegistry.planCeilings(), input.plan)
    validateProviderProtocolConfig(config)
    if (config.baseURL && !config.capabilities) {
      throw new ProviderProbeError('A provider endpoint must pass the conformance probe before it is registered.')
    }
    // The credential-exfiltration wall (see validApiKeyEnv): a config may only ever
    // reference a PROVIDER_* env var, so no other server secret can be pointed at a
    // caller-supplied endpoint. The probe checks this too (before any request leaves);
    // this is the belt at the mint seam itself.
    if (!validApiKeyEnv(config.apiKeyEnv)) {
      throw new ProviderProbeError(`A provider credential must reference a 'PROVIDER_*' env var, not '${config.apiKeyEnv}'.`)
    }
    // The session-kind walls (docs/delegated-cognition-provider.md §6.3/§6.4), belt at
    // the mint seam like the two above: a relay has nothing to dial (an endpoint config
    // on it is a confusion, refused loudly), MUST carry an explicit `toolUse` boolean
    // (the capability is the MAILBOX's, code-owned — v2 relays tool calls, so the route
    // stamps `true`; leaving it to the unset default would silently mean tools-on, the
    // dangerous inversion §6.3 refuses), carries the hashed secret it authenticates by,
    // and is forced tenant-scoped (a shared relay would route one tenant's prompts to
    // another tenant's session model).
    if (config.kind === 'session') {
      if (config.baseURL || config.apiKeyEnv || config.protocol) {
        throw new ProviderProbeError('A Session provider has no endpoint to dial — it must not carry a baseURL, protocol, or credential.')
      }
      if (input.models) {
        throw new ProviderProbeError('A Session provider has no model catalog — its cognition is whatever session drains its mailbox.')
      }
      if (typeof config.capabilities?.toolUse !== 'boolean') {
        throw new ProviderProbeError('A Session provider must be minted with an explicit toolUse capability — never the unset default.')
      }
      if (!config.secretHash) {
        throw new ProviderProbeError('A Session provider must carry the hash of its rendezvous secret.')
      }
      if (!(tenantId ?? input.tenantId)) {
        throw new ProviderProbeError('A Session provider must be tenant-scoped — it can never be shared.')
      }
    }
    // A declared catalog is validated at the funnel (shape + unique ids); its source
    // stamp is server-derived — a caller-declared list is 'static' unless the route
    // fetched it from the endpoint itself ('listed'), and a provider with no catalog
    // carries no source at all.
    assertCatalogModels(input.models)
    // Stamp the creating tenant (F2/PD9) so listProviders(tenant) scopes it; unset ⇒ shared.
    // `isDefault` and `defaultModelId` are stripped: both are serve-time stamps
    // (the per-tenant pointer; the config-resolved model) — stored on the entity
    // they would leak across tenants / drift from the config they mirror.
    const provider: ModelProvider = {
      id: options.logicalId ?? `provider-${(providerSeq += 1)}`,
      tenantId: ownerTenant,
      ...(input.kind ? { kind: input.kind } : {}),
      ...(input.secretHint ? { secretHint: input.secretHint } : {}),
      label: input.label,
      modelFamily: input.modelFamily,
      effortLevels: input.effortLevels,
      ...(input.models ? { models: input.models } : {}),
      ...(input.catalogSource ? { catalogSource: input.catalogSource } : {}),
      ...(input.plan ? { plan: input.plan } : {}),
      ...(input.authority ? { authority: input.authority } : {}),
      definitionRevision: 0,
      ...(config.kind === 'session' ? {} : { connectionRevision: 0 }),
    }
    if (!provider.models) delete provider.catalogSource
    else provider.catalogSource ??= 'static'
    return commitMutationBatch(() => {
      MODEL_PROVIDERS.set(provider.id, provider)
      PROVIDER_CONFIGS.set(provider.id, config)
      emitProviderChanged(provider)
      persist()
      if (options.isDefault === true) this.setDefaultProvider(provider.id, ownerTenant)
      return provider
    })
  },
  /** Whether a reconstructed create-time relay secret still authenticates the
   * exact provider. Used only to recover a lost one-time mint response without
   * widening the provider-config read surface. */
  providerAcceptsRelaySecret(id: string, secret: string): boolean {
    const config = PROVIDER_CONFIGS.get(id)
    return config?.kind === 'session' && !!config.secretHash &&
      sameSecretHash(config.secretHash, hashRelaySecret(secret))
  },
  /** Patch a provider's own fields (label / family / effort levels / plan / authority).
   *  Re-validates a changed plan against the account plan — the same cascade-root
   *  invariant `createProvider` asserts. A narrowing re-clamps already-minted
   *  Agents and their commissions through the runtime half of D8. Undefined when
   *  unknown (→ 404); a supplied revision is compare-and-swap. */
  updateProvider(
    id: string,
    patch: ProviderDefinitionPatch,
    expectedRevision?: number,
  ): ModelProvider | undefined {
    const current = MODEL_PROVIDERS.get(id)
    if (!current) return undefined
    const currentRevision = current.definitionRevision ?? 0
    if (expectedRevision !== undefined && expectedRevision !== currentRevision) {
      throw new ConflictError(
        `This provider definition changed elsewhere (expected revision ${expectedRevision}, current revision ${currentRevision}).`,
      )
    }
    if (Object.keys(patch).length === 0) return current
    if (patch.plan) mintBudget(usageRegistry.planCeilings(), patch.plan)
    const next: ModelProvider = {
      ...current,
      ...patch,
      id: current.id,
      definitionRevision: currentRevision + 1,
    }
    MODEL_PROVIDERS.set(id, next)
    reclampAgentsOf(next) // D8 runtime: a narrowed provider re-clamps its Agents (+ their commissions)
    emitProviderChanged(next)
    persist()
    return next
  },
  /** Atomically replace an endpoint provider's server-only connection after the
   * route has probed the effective config. `catalog === null` deliberately
   * clears a stale listed catalog when the endpoint itself changed but exposes
   * no model-list API; `undefined` preserves the catalog for key/model-only
   * rotations. No write-only field is ever copied onto the public row. */
  replaceProviderConnection(
    id: string,
    config: ProviderConfig,
    catalog?: ModelInfo[] | null,
    expectedRevision?: number,
  ): ModelProvider | undefined {
    const current = MODEL_PROVIDERS.get(id)
    if (!current) return undefined
    const currentRevision = current.connectionRevision ?? 0
    if (expectedRevision !== undefined && expectedRevision !== currentRevision) {
      throw new ConflictError(
        `This provider connection changed elsewhere (expected revision ${expectedRevision}, current revision ${currentRevision}).`,
      )
    }
    if (PROVIDER_CONFIGS.get(id)?.kind === 'session' || config.kind === 'session') {
      throw new ValidationError('A Session provider has no endpoint connection to update.')
    }
    validateProviderProtocolConfig(config)
    if (config.baseURL && !config.capabilities) {
      throw new ProviderProbeError('A provider endpoint must pass the conformance probe before its connection is updated.')
    }
    if (!validApiKeyEnv(config.apiKeyEnv)) {
      throw new ProviderProbeError(`A provider credential must reference a 'PROVIDER_*' env var, not '${config.apiKeyEnv}'.`)
    }
    if (Array.isArray(catalog)) assertCatalogModels(catalog)

    PROVIDER_CONFIGS.set(id, config)
    let next: ModelProvider = { ...current, connectionRevision: currentRevision + 1 }
    if (catalog === null) {
      const { models: _models, catalogSource: _source, ...withoutCatalog } = next
      next = withoutCatalog
    } else if (catalog !== undefined) {
      next = { ...next, models: catalog, catalogSource: 'listed' }
    }
    MODEL_PROVIDERS.set(id, next)
    if (catalog !== undefined) sweepSessionModelPicks()
    emitProviderChanged(next)
    persist()
    return next
  },
  /** Replace a provider's model catalog from its endpoint's list API (the refresh
   *  route) — the 'listed' source stamp is earned only here and at registration. */
  refreshProviderModels(id: string, models: ModelInfo[], expectedRevision?: number): ModelProvider | undefined {
    return replaceProviderModels(id, models, 'listed', expectedRevision)
  },
  /** Replace a caller-authored static catalog through its dedicated route. */
  replaceStaticProviderModels(id: string, models: ModelInfo[], expectedRevision?: number): ModelProvider | undefined {
    return replaceProviderModels(id, models, 'static', expectedRevision)
  },
  /** Rotate a Session provider's rendezvous secret — the kill switch (§7.5).
   * A keyed request carries an opaque durable receipt and a deterministic secret:
   * exact replay can recover that bearer while it remains current, but no older
   * request can rewind a newer credential. An unkeyed caller retains the legacy
   * one-shot random rotation dialect. */
  rotateProviderSecret(
    id: string,
    options: { logicalId?: string; secret?: string; expectedRevision?: number } = {},
  ): { provider: ModelProvider; secret: string } | undefined {
    const current = MODEL_PROVIDERS.get(id)
    const config = PROVIDER_CONFIGS.get(id)
    if (!current || config?.kind !== 'session') return undefined
    const keyed = options.logicalId !== undefined || options.secret !== undefined
    if ((options.logicalId === undefined) !== (options.secret === undefined)) {
      throw new ValidationError('A keyed Session-secret rotation requires both its logical identity and derived secret.')
    }
    const matchingReceipt = current.secretRotationReceipt?.id === options.logicalId
      ? current.secretRotationReceipt
      : undefined
    if (keyed && matchingReceipt) {
      if (matchingReceipt.state === 'cancelled') {
        throw new ConflictError('This Session-secret rotation was cancelled.')
      }
      if (!sameSecretHash(config.secretHash ?? '', hashRelaySecret(options.secret!))) {
        throw new ConflictError('This Session-secret rotation no longer represents the active credential.')
      }
      return { provider: current, secret: options.secret! }
    }
    const currentRevision = current.connectionRevision ?? 0
    if (options.expectedRevision !== undefined && options.expectedRevision !== currentRevision) {
      throw new ConflictError(
        `This provider connection changed elsewhere (expected revision ${options.expectedRevision}, current revision ${currentRevision}).`,
      )
    }
    const secret = options.secret ?? mintRelaySecret()
    PROVIDER_CONFIGS.set(id, { ...config, secretHash: hashRelaySecret(secret) })
    let provider: ModelProvider = {
      ...current,
      secretHint: relaySecretHint(secret),
      connectionRevision: currentRevision + 1,
    }
    if (options.logicalId) {
      provider.secretRotationReceipt = { id: options.logicalId, state: 'applied' }
    } else {
      const { secretRotationReceipt: _, ...withoutReceipt } = provider
      provider = withoutReceipt
    }
    MODEL_PROVIDERS.set(id, provider)
    relay.retire(id)
    emitProviderChanged(provider)
    persist()
    return { provider, secret }
  },
  /** Cancel one keyed rotation before releasing its held client intent. Cancellation
   * advances connection ordering without changing the current secret, so a late
   * POST frozen at the old revision cannot apply. An already-applied exact receipt
   * must be recovered instead of hidden behind a cancellation acknowledgement. */
  cancelProviderSecretRotation(
    id: string,
    logicalId: string,
    expectedRevision: number,
  ): ModelProvider | undefined {
    const current = MODEL_PROVIDERS.get(id)
    const config = PROVIDER_CONFIGS.get(id)
    if (!current || config?.kind !== 'session') return undefined
    if (current.secretRotationReceipt?.id === logicalId) {
      if (current.secretRotationReceipt.state === 'applied') {
        throw new ConflictError('This Session-secret rotation already applied. Retry to recover its active credential.')
      }
      return current
    }
    const currentRevision = current.connectionRevision ?? 0
    if (expectedRevision !== currentRevision) {
      throw new ConflictError(
        `This provider connection changed elsewhere (expected revision ${expectedRevision}, current revision ${currentRevision}).`,
      )
    }
    const provider: ModelProvider = {
      ...current,
      connectionRevision: currentRevision + 1,
      secretRotationReceipt: { id: logicalId, state: 'cancelled' },
    }
    MODEL_PROVIDERS.set(id, provider)
    emitProviderChanged(provider)
    persist()
    return provider
  },
  /** Remove the exact reviewed provider across both public revision domains.
   * Definition/connection and dependency guards precede effects; session-pick
   * repair, registry/config absence, default cleanup, relay retirement, durability,
   * and their events then commit as one coherent transition. False when unknown. */
  deleteProvider(
    id: string,
    expected?: { definitionRevision: number; connectionRevision: number },
  ): boolean {
    const removed = MODEL_PROVIDERS.get(id)
    if (!removed) return false
    const definitionRevision = removed.definitionRevision ?? 0
    const connectionRevision = removed.connectionRevision ?? 0
    if (
      expected &&
      (expected.definitionRevision !== definitionRevision ||
        expected.connectionRevision !== connectionRevision)
    ) {
      throw new ConflictError(
        `This provider changed elsewhere (expected definition revision ${expected.definitionRevision} and connection revision ${expected.connectionRevision}; current revisions ${definitionRevision} and ${connectionRevision}).`,
      )
    }
    if (id === DEFAULT_PROVIDER.id) throw new ConflictError('The default provider can’t be removed.')
    const bound = [...WORKER_AGENTS.values()].filter((a) => a.providerId === id)
    if (bound.length > 0) {
      throw new ConflictError(
        `${bound.length} agent${bound.length === 1 ? '' : 's'} still ${bound.length === 1 ? 'runs' : 'run'} on this provider — repoint ${bound.length === 1 ? 'it' : 'them'} first.`,
      )
    }
    return commitMutationBatch(() => {
      // Retire before the row drops so relay.disconnected captures the Provider's
      // tenant. The surrounding batch delays publication until every related row
      // is coherent; the event's routing snapshot then survives registry absence.
      if (PROVIDER_CONFIGS.get(id)?.kind === 'session') relay.retire(id)
      // A direct conversation pick is lightweight, unlike an Agent binding. It
      // falls back to the Agent provider and its provider-local model pick clears.
      for (const s of SESSIONS.filter((s) => s.providerId === id)) {
        delete s.providerId
        delete s.modelId
        s.metadataRevision = (s.metadataRevision ?? 0) + 1
        emit({ type: 'session.updated', session: s })
      }
      MODEL_PROVIDERS.delete(id)
      PROVIDER_CONFIGS.delete(id)
      dropRegistryDefault('providerId', id)
      emitProviderChanged(removed)
      persist()
      return true
    })
  },

  // ── System-prompt library (docs/agent-commons.md, D10) ──
  /** The reusable, target-family-tagged system prompts a user picks for an Agent —
   *  tenant-scoped (F2/PD9): shared seeds visible to all, a created one to its tenant.
   *  The viewer's default flag is stamped at serve time, like `listProviders`. */
  listSystemPrompts(tenantId?: string): SystemPromptEntry[] {
    const defaultId = defaultsFor(tenantId)?.promptId
    return [...SYSTEM_PROMPT_LIB.values()]
      .filter((p) => registryVisible(p, tenantId))
      .map((p) => ({ ...p, definitionRevision: p.definitionRevision ?? 0 }))
      .map((p) => (p.id === defaultId ? { ...p, isDefault: true } : p))
  },
  /** Move / clear the caller's **default-prompt** flag — `setDefaultProvider`'s twin. */
  setDefaultSystemPrompt(id: string | undefined, tenantId?: string): void {
    if (id !== undefined && ![...SYSTEM_PROMPT_LIB.values()].some((p) => p.id === id && registryVisible(p, tenantId))) {
      throw new ValidationError(`No system prompt '${id}' to set as the default.`)
    }
    const ownerTenant = tenantId ?? defaultTenantId()
    const previous = defaultsFor(ownerTenant)?.promptId
    if (previous === id) return
    setRegistryDefault('promptId', id, ownerTenant)
    const changedId = id ?? previous
    if (changedId) emit({ type: 'systemprompt.changed', systemPromptId: changedId, tenantId: ownerTenant })
    persist()
  },
  /** Resolve one library entry by id (undefined when unknown — unlike provider/agent
   *  there is no "default prompt to fall back to" at this seam; the caller decides). */
  getSystemPrompt(id?: string): SystemPromptEntry | undefined {
    return id ? SYSTEM_PROMPT_LIB.get(id) : undefined
  },
  /** The opt-in prompt-fit probe (docs/agent-commons.md, D10/OQ5) — the deeper, scored
   *  upgrade beside the always-on static tag. Resolves the prompt's authored-for family
   *  and the chosen provider's model family, then scores the pairing. **Mock fulfilment:**
   *  a deterministic `probeScore`; a real probe would run a tool-use conformance check
   *  against the provider's model here (the model seam). Undefined for an unknown prompt
   *  (→ 404). */
  runProbe(systemPromptId: string, providerId?: string): PromptProbeResult | undefined {
    const prompt = SYSTEM_PROMPT_LIB.get(systemPromptId)
    if (!prompt) return undefined
    return probeScore(prompt.targetFamily, resolveProvider(providerId).modelFamily)
  },
  /** Add a prompt to the library. A plain registry add (prompt text is not a
   *  capability, so there is no attenuation funnel here — the fit *warning* is the
   *  selection-time check, `promptFitWarning`, surfaced in the picker). */
  createSystemPrompt(
    input: SystemPromptDefinitionFields,
    tenantId?: string,
    options: { logicalId?: string; isDefault?: boolean } = {},
  ): SystemPromptEntry {
    const ownerTenant = tenantId
    // Durable keyed creation is side-effect free on replay: neither definition
    // nor a newer viewer-default choice may be rewound by an old request.
    if (options.logicalId) {
      if (!ownerTenant) {
        throw new ValidationError('A keyed system-prompt creation must be account-scoped.')
      }
      const represented = SYSTEM_PROMPT_LIB.get(options.logicalId)
      if (represented) {
        if (represented.tenantId !== ownerTenant) {
          throw new ValidationError('That system-prompt creation identity is already owned by another account.')
        }
        return represented
      }
    }
    // Stamp the creating tenant (F2/PD9) so listSystemPrompts(tenant) scopes it; unset ⇒ shared.
    const entry: SystemPromptEntry = {
      id: options.logicalId ?? `sp-new-${(systemPromptSeq += 1)}`,
      tenantId: ownerTenant,
      label: input.label,
      body: input.body,
      targetFamily: input.targetFamily,
      definitionRevision: 0,
    }
    return commitMutationBatch(() => {
      SYSTEM_PROMPT_LIB.set(entry.id, entry)
      emitSystemPromptChanged(entry)
      persist()
      // Creation and its initial default pointer are one acknowledged durable
      // act. Replays return above and therefore cannot move a later choice.
      if (options.isDefault === true) this.setDefaultSystemPrompt(entry.id, ownerTenant)
      return entry
    })
  },
  /** Patch a library prompt's fields (label / body / target family). A plain registry
   *  edit — no attenuation funnel (prompt text isn't a capability). Undefined when
   *  unknown (→ 404). */
  updateSystemPrompt(
    id: string,
    patch: SystemPromptDefinitionPatch,
    expectedRevision?: number,
  ): SystemPromptEntry | undefined {
    const current = SYSTEM_PROMPT_LIB.get(id)
    if (!current) return undefined
    const currentRevision = current.definitionRevision ?? 0
    if (expectedRevision !== undefined && expectedRevision !== currentRevision) {
      throw new ConflictError(
        `This system prompt changed elsewhere (expected revision ${expectedRevision}, current revision ${currentRevision}).`,
      )
    }
    if (Object.keys(patch).length === 0) return current
    const next: SystemPromptEntry = {
      ...current,
      ...patch,
      id: current.id,
      definitionRevision: currentRevision + 1,
    }
    SYSTEM_PROMPT_LIB.set(id, next)
    emitSystemPromptChanged(next)
    persist()
    return next
  },
  /** Remove a library prompt. Refuses (ConflictError → 409) the seeded default — the
   *  default Agent's body is single-sourced from it — and any prompt an Agent still
   *  references (`systemPromptId`), so the user repoints those Agents first. False when
   *  unknown (→ 404). */
  deleteSystemPrompt(id: string, expectedRevision?: number): boolean {
    const current = SYSTEM_PROMPT_LIB.get(id)
    if (!current) return false
    const currentRevision = current.definitionRevision ?? 0
    if (expectedRevision !== undefined && expectedRevision !== currentRevision) {
      throw new ConflictError(
        `This system prompt changed elsewhere (expected revision ${expectedRevision}, current revision ${currentRevision}).`,
      )
    }
    if (id === SP_DEFAULT_ID) throw new ConflictError('The default system prompt can’t be removed.')
    const used = [...WORKER_AGENTS.values()].filter((a) => a.systemPromptId === id)
    if (used.length > 0) {
      throw new ConflictError(
        `${used.length} agent${used.length === 1 ? '' : 's'} still ${used.length === 1 ? 'uses' : 'use'} this prompt — repoint ${used.length === 1 ? 'it' : 'them'} first.`,
      )
    }
    return commitMutationBatch(() => {
      SYSTEM_PROMPT_LIB.delete(id)
      // The viewer-default flag is a shortcut, not a protection invariant.
      dropRegistryDefault('promptId', id)
      emitSystemPromptChanged(current)
      persist()
      return true
    })
  },

  // ── Commissions (the agent→Project assignment — docs/agent-commons.md, D7/D13) ──
  /** A Project's Contributors (its commissions), or all commissions when no project
   *  is given. The Contributor role is just an Agent that appears here for a Project.
   *  Tenant-scoped (F2/PD9): shared seeds visible to all, a created one to its tenant. */
  listCommissions(projectId?: string, tenantId?: string): Commission[] {
    // A SHARED Project's Contributor list is public across tenants (P8 — GitHub-style public
    // contributors): every commission ON it is visible to any viewer, whichever tenant created
    // it. Otherwise the usual registry scoping (own + shared-seed).
    const onShared = projectId != null && findProject(projectId)?.shared === true
    const scoped = [...COMMISSIONS.values()]
      .filter((c) => onShared || registryVisible(c, tenantId))
      .filter((c) => (projectId ? c.projectId === projectId : true))
    // A FOREIGN Contributor on a shared project is exposed as identity-only (redacted); the
    // caller's own (registryVisible) — and internal callers with no tenant — keep full detail,
    // so the D12 authority/grant posture never crosses the tenant boundary.
    return scoped.map((c) => {
      if (tenantId === undefined) return c
      const mine = (c.tenantId ?? defaultTenantId()) === tenantId
      return registryVisible(c, tenantId)
        ? { ...c, mine }
        : { ...publicCommission(c), mine: false }
    })
  },
  /** Resolve one commission by id (undefined when unknown). Unredacted — internal callers only. */
  getCommission(id: string): Commission | undefined {
    return COMMISSIONS.get(id)
  },
  /** A commission visible to `tenantId` for the by-id route — its own/seed (full), or a
   *  Contributor on a SHARED project (redacted to public identity), else undefined (404).
   *  Keeps `GET /commissions/:id` consistent with the shared-project list rather than 404ing
   *  a Contributor the list shows. */
  commissionVisibleToTenant(id: string, tenantId?: string): Commission | undefined {
    const c = COMMISSIONS.get(id)
    if (!c) return undefined
    if (registryVisible(c, tenantId)) {
      return tenantId === undefined
        ? c
        : { ...c, mine: (c.tenantId ?? defaultTenantId()) === tenantId }
    }
    return findProject(c.projectId)?.shared === true
      ? { ...publicCommission(c), mine: false }
      : undefined
  },
  /** The tenant that PAYS for a commissioned run (D13 owner-pays): the tenant that owns the
   *  commissioned Agent — NOT the Project's tenant. On a cross-tenant Contributor (P8) these
   *  differ, so a commissioned run must meter against this tenant's usage, not the Project
   *  owner's. This is the attribution primitive; wiring it into a live commissioned execution
   *  is a later slice (there's no commissioned-run path yet). Undefined for an unknown id. */
  commissionOwnerTenant(commissionId: string): string | undefined {
    const c = COMMISSIONS.get(commissionId)
    if (!c) return undefined
    return WORKER_AGENTS.get(c.agentId)?.tenantId ?? c.tenantId ?? defaultTenantId()
  },
  /** Mint a Commission through the **leaf** of the D8 funnel: its grant + authority must
   *  attenuate the *Agent's* (which themselves inherit the provider when unset) — so
   *  *commission ⊆ agent ⊆ provider* holds by construction, an over-grant is
   *  unrepresentable at mint, and a Commission can never carry authority the Agent never
   *  held (the confused-deputy wall, fatal where the commissioner is a stranger). The
   *  caller must have validated the agent + project exist; this asserts the cascade.
   *  Persisted to disk like the agent/provider registries (persist.ts).
   *
   *  Known limitation (token face): the parent is a *single* tier — the Agent's own
   *  budget, else the provider plan, else the account plan — not a per-window merge of
   *  the chain. So if an Agent declared a *partial* budget (only some windows), a
   *  commission tightening an *inherited* window is rejected. It errs safe (over-reject,
   *  never over-grant) and is unreachable today (every seed uses the full account window
   *  set); a per-window effective-budget merge (which would also touch `createAgent`,
   *  slice 3) is the proper fix when partial window sets are introduced. The unknown-agent
   *  guard throws a plain `Error` on purpose — the route pre-validates, so reaching it
   *  signals a bypassed-validation bug (a 500), not a client error. */
  /** Set (or clear, with `undefined`) a Project's D13 commission cap — the owner raising or
   *  lifting the abuse ceiling. The single setter behind both the hub and the conversational
   *  card (5.5). Undefined for an unknown Project (→ 404); persisted (survives a restart). */
  setCommissionCap(projectId: string, cap?: number): Project | undefined {
    // A created Project lives in the relation graph (`extraProjects`), a seeded one in
    // PROJECTS — resolve from both so the cap works wherever the Project came from. A
    // seed cap persists via the `commissionCaps` overlay; a created one via the `graph` slice.
    const project = findProject(projectId)
    if (!project) return undefined
    if (project.commissionCap === cap) return project
    project.commissionCap = cap
    persist()
    emitProjectChanged(project)
    return project
  },
  /** Set / clear a Project's **default contributor role** (D14) — the commissioning
   *  pickers' pre-selection, a pure UI shortcut (INV-9: `createCommission` still
   *  requires a concrete role; nothing resolves to this). `role` undefined = clear.
   *  Same resolve-from-both-homes + persistence shape as `setCommissionCap` (seed →
   *  the `projectDefaultRoles` overlay; created → the `graph` slice). */
  setProjectDefaultRole(projectId: string, role?: ProjectRole): Project | undefined {
    if (role !== undefined && !PROJECT_ROLES.includes(role)) {
      throw new ValidationError(`No such project role '${role}'.`)
    }
    const project = findProject(projectId)
    if (!project) return undefined
    if (project.defaultRole === role) return project
    project.defaultRole = role
    persist()
    emitProjectChanged(project)
    return project
  },
  /** How many active Commissions a Project currently holds — the count the D13 cap is
   *  measured against (one Contributor = one Commission). The Coordination/abuse read. */
  activeCommissionCount(projectId: string): number {
    let n = 0
    for (const c of COMMISSIONS.values()) if (c.projectId === projectId) n += 1
    return n
  },
  createCommission(
    input: Omit<Commission, 'id'>,
    tenantId?: string,
    options: { logicalId?: string } = {},
  ): Commission {
    const owningTenant = tenantId ?? input.tenantId
    if (options.logicalId && commissionMcpRegistry.isRetired(options.logicalId)) {
      throw new ConflictError('This retired Contributor identity cannot be reused. Create a new Contributor instead.')
    }
    // Keyed creation is side-effect free on durable replay: it does not re-run
    // capacity/authority checks or rewind later Contributor configuration.
    if (options.logicalId) {
      if (!owningTenant) {
        throw new ValidationError('A keyed commission creation must be account-scoped.')
      }
      const represented = COMMISSIONS.get(options.logicalId)
      if (represented) {
        if (represented.tenantId !== owningTenant) {
          throw new ValidationError('That commission creation identity is already owned by another account.')
        }
        return represented
      }
    }
    const agent = WORKER_AGENTS.get(input.agentId)
    if (!agent) throw new Error(`createCommission: unknown agent '${input.agentId}'`)
    const project = findProject(input.projectId)
    // D13 per-commissioner abuse cap — fail-closed at the *single* funnel, so the route and
    // the conversational (commission-agent op) path are both bounded. An at-cap Project
    // refuses the new Commission until one is removed or the owner raises the cap.
    const cap = project?.commissionCap
    if (cap !== undefined && this.activeCommissionCount(input.projectId) >= cap) {
      throw new LimitError(
        `Project '${input.projectId}' is at its commission cap (${cap}) — un-commission an Agent or raise the cap first.`,
      )
    }
    const provider = resolveProvider(agent.providerId)
    // Attenuate against the Agent's *effective* grants: an Agent that left a face unset
    // inherits its provider's there, so that inherited ceiling is the parent.
    if (input.authority) mintAuthority(agent.authority ?? provider.authority, input.authority)
    if (input.grant) {
      mintBudget(agent.budget?.windows ?? provider.plan?.windows ?? usageRegistry.planCeilings(), input.grant)
    }
    // Role is REQUIRED (INV-9): the funnel never picks one for the caller — the
    // commissioning surface pre-selects the Project's `defaultRole` (else the writer
    // baseline) VISIBLY, and what arrives here must be concrete. Then the P8
    // self-assign clamp (B8) runs, keyed on the commission's OWNING tenant vs the
    // Project owner (single-sourced with the re-grant path, so a cross-tenant joiner
    // can't self-elevate on mint or via PATCH).
    // Stamp the creating tenant (F2/PD9) so listCommissions(…, tenant) scopes it; unset ⇒ shared.
    if (!input.role || !PROJECT_ROLES.includes(input.role)) {
      throw new ValidationError(`A commission must name a project role (${PROJECT_ROLES.join(' / ')}) — got '${input.role ?? ''}'.`)
    }
    const role = clampContributorRole(input.role, owningTenant, input.projectId)
    // The D19 standing flag is the commission OWNER's consent to unprompted spend
    // (owner-pays) — normalized so anything but `true` stores as absent.
    const standing = input.standing === true ? true : undefined
    const commission: Commission = {
      ...input,
      role,
      standing,
      id: options.logicalId ?? `commission-${(commissionSeq += 1)}`,
      tenantId: owningTenant,
      configurationRevision: 0,
    }
    COMMISSIONS.set(commission.id, commission)
    // Ambient push (project-visibility-gated): a cross-tenant Contributor arriving on
    // a shared Project must reach the OWNER's open Contributors panel too — the acting
    // client's local invalidation can't (P8).
    emit({ type: 'commission.changed', projectId: commission.projectId })
    persist()
    return commission
  },
  /** Re-grant a commission — narrow (or restore) the authority / sub-budget it carries
   *  onto the Project. Re-runs the same leaf funnel `createCommission` uses (attenuate
   *  against the Agent's effective ceiling), so a patch can't smuggle a grant past the
   *  Agent. A present field is applied; an absent one is left unchanged. Undefined when
   *  unknown (→ 404). */
  updateCommission(
    id: string,
    patch: CommissionConfigurationPatch,
    expectedRevision?: number,
  ): Commission | undefined {
    const commission = COMMISSIONS.get(id)
    if (!commission) return undefined
    const currentRevision = commission.configurationRevision ?? 0
    if (expectedRevision !== undefined && expectedRevision !== currentRevision) {
      throw new ConflictError(
        `This commission changed elsewhere (expected revision ${expectedRevision}, current revision ${currentRevision}).`,
      )
    }
    const agent = WORKER_AGENTS.get(commission.agentId)
    const provider = resolveProvider(agent?.providerId)
    // PATCH authority is sparse by dimension: an omitted tools/connectors/scopes
    // face remains unchanged. This keeps orthogonal editor intent independent.
    const authority = 'authority' in patch
      ? { ...commission.authority, ...patch.authority }
      : commission.authority
    const grant = 'grant' in patch ? patch.grant : commission.grant
    // Role (D14) re-assignment: present ⇒ apply, absent ⇒ unchanged — then re-run the P8
    // self-assign clamp (B8) so a cross-tenant Contributor can't PATCH itself above 'writer'
    // (denyForeignEntry lets it edit its OWN commission; the clamp is the wall). Same helper as
    // the mint path, keyed on the commission's owning tenant vs the Project owner.
    const role = clampContributorRole(patch.role ?? commission.role ?? 'writer', commission.tenantId, commission.projectId)
    if (authority) mintAuthority(agent?.authority ?? provider.authority, authority)
    if (grant) {
      mintBudget(agent?.budget?.windows ?? provider.plan?.windows ?? usageRegistry.planCeilings(), grant)
    }
    // The D19 standing flag: present ⇒ apply (normalized), absent ⇒ unchanged. A newly
    // standing Contributor is offered the backlog's still-open items right away — the
    // one re-dispatch moment the synchronous model gets for free.
    const standing = 'standing' in patch ? (patch.standing === true ? true : undefined) : commission.standing
    const changed = role !== commission.role || standing !== commission.standing ||
      !equivalentAuthority(authority, commission.authority) ||
      !equivalentBudget(grant, commission.grant)
    if (!changed) return commission
    const next: Commission = {
      ...commission,
      role,
      authority,
      grant,
      standing,
      id: commission.id,
      configurationRevision: currentRevision + 1,
    }
    COMMISSIONS.set(id, next)
    if (standing && !commission.standing) {
      let took = false
      for (const item of openSubGoals) {
        if (item.projectId === next.projectId && item.status === 'open') {
          took = this.dispatchOpenSubGoal(item) || took
        }
      }
      if (took) emit({ type: 'openwork.changed', projectId: next.projectId })
    }
    emit({ type: 'commission.changed', projectId: next.projectId })
    persist()
    return next
  },
  /** Un-commission the exact reviewed Agent assignment from its Project. Its
   * configuration revision is the destructive precondition; the row and every
   * in-flight sub-goal it holds disappear in one durable/event batch. False when
   * unknown (→ 404). No protected default — a commission has no fallback role. */
  deleteCommission(id: string, expectedRevision?: number): boolean {
    const commission = COMMISSIONS.get(id)
    if (!commission) return false
    const currentRevision = commission.configurationRevision ?? 0
    if (expectedRevision !== undefined && expectedRevision !== currentRevision) {
      throw new ConflictError(
        `This contributor changed elsewhere (expected revision ${expectedRevision}, current revision ${currentRevision}).`,
      )
    }
    return commitMutationBatch(() => {
      this.projectSubGoals(commission.projectId)
        .filter((subGoal) => subGoal.holder === id)
        .forEach((subGoal) => this.releaseSubGoal(subGoal.reservationId))
      commissionMcpRegistry.retireCommission(id, Date.now())
      const retiredClaims = new Set(commissionMcpRegistry.snapshot().claims
        .filter(claim => claim.permission.commissionId === id).map(claim => claim.id))
      for (const hold of usageRegistry.snapshotReservations()) {
        if (retiredClaims.has(hold.id) && hold.status === 'active') {
          usageRegistry.settleReservation(hold.id, hold.tenantId, hold.report !== null)
        }
      }
      COMMISSIONS.delete(id)
      emit({ type: 'commission.changed', projectId: commission.projectId })
      persist()
      return true
    })
  },

  /** The **effective authority** a Contributor carries onto its Project (D12,
   *  docs/agent-commons.md): the agent's granted authority (commission ?? agent ??
   *  provider — the D8 ceiling) **clamped** to what the Project admits
   *  (`projectAdmittedAuthority`). So a commissioned Agent sees the *Project's*
   *  connectors / scopes, never its owner's ambient set — default-deny on anything the
   *  Project doesn't admit, even for an Agent granted everything. Undefined for an
   *  unknown commission. */
  commissionAuthority(commissionId: string): Authority | undefined {
    const commission = COMMISSIONS.get(commissionId)
    if (!commission) return undefined
    const agent = WORKER_AGENTS.get(commission.agentId)
    if (!agent) return undefined
    const provider = resolveProvider(agent.providerId)
    // The ceiling: the most authority this Contributor could hold (the D8 cascade).
    const granted = commission.authority ?? agent.authority ?? provider.authority ?? {}
    const project = findProject(commission.projectId) // seed + created (P8 shared Projects)
    // The wall: clamp the ceiling to what the Project ADMITS. Read the admitted contexts from
    // the relation graph's authoritative join map (`graph.projectContexts`) — a created Project
    // (P8 shared) carries its contexts only there, and even a seed Project's set is edited there
    // via scope/unscope, so the object's static `.contexts` can go stale. Fail **closed** — a
    // commission whose Project is gone admits no data (a security boundary must not fail open).
    // Fail **closed** at the fallback: if the graph has no recorded admitted set for this project
    // (a created Project not yet scoped, or the rehydrate seam where a snapshot's projectContexts
    // omits a seed id — P8 Phase 2a review), admit NOTHING rather than the object's frozen static
    // `.contexts` (which would fail OPEN). A seed Project's live set is always in the graph
    // (seedGraph copies it in + scope/unscope write the key), so this only bites the un-recorded case.
    const contexts = project ? (graph.projectContexts[commission.projectId] ?? []) : undefined
    const admitted = contexts ? projectAdmittedAuthority(contexts) : { connectors: [], scopes: [] }
    return intersectAuthority(granted, admitted)
  },
  /** The D12 mediation check, lifted from *(session, context)* to *(Project,
   *  commission, context)*: whether a Contributor may reach `target` on `dimension`.
   *  True iff the commission's **effective** (Project-clamped) authority admits it — so
   *  the owner's ambient connectors, absent from the Project, are unreachable. A
   *  missing commission reaches nothing. */
  commissionCanReach(commissionId: string, dimension: 'tools' | 'connectors' | 'scopes', target: string): boolean {
    const effective = this.commissionAuthority(commissionId)
    return effective ? authorityAdmits(effective, dimension, target) : false
  },
  /** Effect-time D12 scope wall for the host invoke path (OQ3): may this Commission's
   *  Contributor act on a filesystem `target`? The commission's **effective**
   *  (Project-clamped) `scopes` bound its file reach — `projectAdmittedAuthority` derives
   *  them from the Project's folder/repo contexts, so a path outside the Project's admitted
   *  roots is unreachable even to an Agent granted everything. **Unknown commission ⇒
   *  `false` (fail closed)** — a security boundary must not fail open. Unrestricted scopes
   *  (`'*'` / absent) impose no file wall. A concrete set admits only a `target` within one
   *  root (the same prefix boundary as context mediation, `scopeMatches`). A non-`fs.*`
   *  capability carries no commission scope bound here — its command `target` isn't a path,
   *  and the host grant (D3) + context mediation already bound it — so it passes. */
  commissionAdmitsTarget(commissionId: string, capability: CapabilityType, target: string): boolean {
    const effective = this.commissionAuthority(commissionId)
    if (!effective) return false // fail closed: no commission ⇒ no reach
    if (!capability.startsWith('fs.')) return true // commission scopes bound file reach only
    if (unrestricted(effective.scopes)) return true // no file wall
    return effective.scopes!.some((root) => scopeMatches(root, target))
  },
  /** Does this Commission's **role** (D14) permit `action` on its Project? The role is the
   *  permission baseline composed into the cascade alongside the D12 reach. **Unknown
   *  commission ⇒ `false` (fail closed)**; an unset role defaults to `'writer'` (the
   *  ordinary Contributor), so an old persisted commission still gates correctly. */
  commissionRolePermits(commissionId: string, action: ProjectAction): boolean {
    const commission = COMMISSIONS.get(commissionId)
    if (!commission) return false
    return rolePermits(commission.role ?? 'writer', action)
  },

  /** Append a message to a session's thread — the write that makes "send" real.
   *  Persists only for a known session; a draft is materialized via
   *  `createSession` first, and unknown ids aren't persisted here (returns
   *  undefined). Run sessions are ordinary rows (the one mint funnel), so a
   *  follow-up turn in one persists like any other. Refreshes the row's preview +
   *  activity, then broadcasts `session.updated` so every client's list reflects
   *  the new turn. */
  appendMessage(id: string, message: Message, options: { actorUserId?: string } = {}): Session | undefined {
    const session = SESSIONS.find((s) => s.id === id)
    if (!session) return undefined
    const tenantId = session.tenantId ?? defaultTenantId()
    const connectionState = mcpConnectionRegistry.snapshot()
    const authorities: McpActivityAuthority[] = []
    const seenOAuthIds = new Set<string>()
    for (const activity of message.toolActivities ?? []) {
      if (!activity.mcp || !isExternalMcpId(activity.connectorId)) continue
      const row = connectionState.connections.find(candidate => candidate.id === activity.connectorId && candidate.tenantId === tenantId)
      const retired = connectionState.retired.find(candidate => candidate.id === activity.connectorId && candidate.tenantId === tenantId)
      if (row?.ownerUserId === undefined) {
        const oauthIdentityExists = connectionState.connections.some(candidate => candidate.id === activity.connectorId && candidate.ownerUserId !== undefined) ||
          connectionState.retired.some(candidate => candidate.id === activity.connectorId && candidate.ownerUserId !== undefined)
        if (retired?.ownerUserId !== undefined || oauthIdentityExists) {
          throw new ConflictError('This person-owned MCP connection has been removed; its historical receipt cannot be recreated.')
        }
        continue
      }
      const actor = activeMcpActor(tenantId, options.actorUserId)
      const activityKey = mcpActivityAuthorityKey(session.id, activity.id)
      if (message.role !== 'assistant' || activity.kind !== 'action' || activity.status !== 'proposed' ||
          !actor || actor !== row.ownerUserId || !row.connected || row.revision !== activity.mcp.connectionRevision ||
          seenOAuthIds.has(activity.id) || mcpActivityAuthorities.has(activityKey) ||
          [...(session.messages ?? []), ...(session.compactedMessages ?? [])]
            .some(existing => (existing.toolActivities ?? []).some(candidate => candidate.id === activity.id))) {
        throw new ConflictError('This person-owned MCP proposal is no longer authorized for this person or connection.')
      }
      seenOAuthIds.add(activity.id)
      authorities.push({ sessionId: session.id, activityId: activity.id, connectionId: activity.connectorId, tenantId, ownerUserId: actor })
    }
    return commitMutationBatch(() => {
      applyMessage(session, message)
      for (const authority of authorities) mcpActivityAuthorities.set(mcpActivityAuthorityKey(authority.sessionId, authority.activityId), authority)
      emit({ type: 'session.updated', session })
      persist()
      return session
    })
  },
  /** Record the user's verdict on ONE proposed relation edit (keyed by `opKey`)
   *  on the message that carried it — the consent card's resolution, persisted so
   *  a reload (or a later op that moves the relation on) can't flip a resolved
   *  card back to pending. A recorded verdict is terminal: an exact retry is a
   *  no-op and an opposite legacy retry is invalid, so an older client cannot
   *  corrupt a newer receipt-backed decision. Returns undefined when the
   *  session/message doesn't exist or the message carries no proposal under
   *  that key (a verdict must name a real proposal — never minted onto
   *  arbitrary messages). */
  resolveMessageRelation(
    sessionId: string,
    messageId: string,
    key: string,
    verdict: 'confirmed' | 'skipped',
  ): Session | 'invalid' | undefined {
    const session = SESSIONS.find((s) => s.id === sessionId)
    const message = session?.messages?.find((m) => m.id === messageId)
    if (!session || !message) return undefined
    if (!(message.relationActions ?? []).some((op) => opKey(op) === key)) return undefined
    const representedVerdict = message.relationsResolved?.[key]
    if (representedVerdict !== undefined) {
      return representedVerdict === verdict ? session : 'invalid'
    }
    message.relationsResolved = { ...message.relationsResolved, [key]: verdict }
    session.updatedAt = Date.now()
    emit({ type: 'session.updated', session })
    persist()
    return session
  },
  /** Exact durable acknowledgement for a keyed relation-proposal decision. The
   * containing Session supplies persistence and private tenant authority; the
   * public receipt can therefore omit raw account identity. */
  getMessageRelationDecision(
    sessionId: string,
    messageId: string,
    key: string,
    decisionId: string,
    tenantId: string,
    verdict: 'confirmed' | 'skipped',
  ): ResolveMessageRelationResponse | 'invalid' | undefined {
    if (!isRelationActionDecisionId(decisionId)) return 'invalid'
    const session = SESSIONS.find((candidate) => candidate.id === sessionId)
    if (!session || !this.sessionOwnedBy(session, tenantId)) return undefined
    const message = session.messages?.find((candidate) => candidate.id === messageId)
    if (!message || !(message.relationActions ?? []).some((operation) => opKey(operation) === key)) {
      return undefined
    }
    const representedVerdict = message.relationsResolved?.[key]
    const representedId = message.relationDecisionIds?.[key]
    if (representedId === undefined) {
      return representedVerdict === undefined ? undefined : 'invalid'
    }
    if (representedId !== decisionId || representedVerdict !== verdict) return 'invalid'
    return { key, verdict, decisionId }
  },
  /** Apply and record one keyed first-party relation decision as a single
   * durable mutation. Legacy unkeyed callers stay on `resolveMessageRelation`,
   * whose historical contract records only a separately-applied effect. */
  decideMessageRelation(
    sessionId: string,
    messageId: string,
    key: string,
    verdict: 'confirmed' | 'skipped',
    decisionId: string,
    tenantId: string,
  ): ResolveMessageRelationResponse | 'forbidden' | 'invalid' | undefined {
    const represented = this.getMessageRelationDecision(
      sessionId,
      messageId,
      key,
      decisionId,
      tenantId,
      verdict,
    )
    if (represented) return represented
    const session = SESSIONS.find((candidate) => candidate.id === sessionId)
    if (!session) return undefined
    if (!this.sessionOwnedBy(session, tenantId)) return 'forbidden'
    const message = session.messages?.find((candidate) => candidate.id === messageId)
    const operation = message?.relationActions?.find((candidate) => opKey(candidate) === key)
    if (!message || !operation) return undefined
    if (message.relationsResolved?.[key] !== undefined) return 'invalid'
    if (this.opDeniedForTenant(operation, tenantId)) return 'forbidden'

    return commitMutationBatch(() => {
      if (verdict === 'confirmed') {
        if (operation.kind === 'attach-context') {
          const connector = {
            id: operation.connectorId,
            label: operation.connectorLabel,
            kind: operation.connectorKind,
          }
          const current = this.sessionWorkspace(sessionId)
          const workspace: SessionWorkspace = {
            ...current,
            connectors: [...current.connectors.filter((candidate) => candidate.id !== connector.id), connector],
          }
          this.updateSessionContextState(
            sessionId,
            [{
              action: 'attach',
              context: {
                id: connector.id,
                label: connector.label,
                type: connector.kind === 'mcp' ? 'mcp' : 'connector',
                scope: '*',
              },
            }],
            workspace,
          )
        } else {
          this.applyRelationOp(operation, tenantId)
        }
      }
      message.relationsResolved = { ...message.relationsResolved, [key]: verdict }
      message.relationDecisionIds = { ...message.relationDecisionIds, [key]: decisionId }
      session.updatedAt = Date.now()
      emit({ type: 'session.updated', session })
      persist()
      return { key, verdict, decisionId }
    })
  },
  /** Hand a Conversation off to a different worker Agent mid-thread (D16) — re-bind the
   *  session's driver. Subsequent turns are driven by, and stamped with (Message.agentId),
   *  the new Agent; the binding is *current-driver*, not immutable. Refuses an unknown
   *  Agent (ConflictError → 409). */
  setSessionAgent(sessionId: string, agentId: string): Session | undefined {
    const session = SESSIONS.find((s) => s.id === sessionId)
    if (!session) return undefined
    if (!WORKER_AGENTS.has(agentId)) {
      throw new ConflictError(`No agent '${agentId}' to hand off to — it may have been removed.`)
    }
    const currentRevision = session.metadataRevision ?? 0
    session.agentId = agentId
    session.updatedAt = Date.now()
    // The hand-off may change the session's effective provider (the new Agent's
    // binding) — a held model pick whose namespace moved must clear with it.
    sweepSessionModelPicks()
    // One user-level hand-off advances one revision even when the invariant
    // sweep also had to clear this row's now-invalid model pick.
    session.metadataRevision = currentRevision + 1
    emit({ type: 'session.updated', session })
    persist()
    return session
  },

  /** Edit a session's row-level fields from the sidebar's row menu — rename
   *  (title), pin/unpin, or archive/unarchive. Mutates in place and broadcasts
   *  `session.updated` so every client's list refreshes. */
  patchSession(
    id: string,
    patch: SessionMetadataPatch,
    expectedRevision?: number,
  ): Session | undefined {
    const session = SESSIONS.find((s) => s.id === id)
    if (!session) return undefined
    const currentRevision = session.metadataRevision ?? 0
    if (expectedRevision !== undefined && expectedRevision !== currentRevision) {
      throw new ConflictError(
        `This conversation changed elsewhere (expected revision ${expectedRevision}, current revision ${currentRevision}).`,
      )
    }
    // Validate the model pick BEFORE anything mutates (a refused patch must change
    // nothing): it must name an entry in the catalog of the provider this patch
    // leaves the session on — the incoming providerId when the patch carries one,
    // else the session's current effective provider.
    if (patch.modelId) {
      const nextProviderId = patch.providerId !== undefined ? patch.providerId || undefined : session.providerId
      assertModelInCatalog(patch.modelId, nextProviderId, session.agentId)
    }
    if (patch.title !== undefined) session.title = patch.title
    if (patch.status !== undefined) session.status = patch.status
    if (patch.pinned !== undefined) session.pinned = patch.pinned
    // The composer's model pick. Any falsy value ('' — the registry convention for
    // none/default — or a JSON null, which the route's validation skip lets through)
    // clears back to the Agent's own provider; only a real id is ever stored, so the
    // persisted row can't violate the wire type (`providerId?: string`).
    if (patch.providerId !== undefined) {
      if (patch.providerId) session.providerId = patch.providerId
      else delete session.providerId
      // The provider changed, so the model pick's namespace changed — clear it (the
      // documented cascade); a modelId in this same patch re-picks right below.
      delete session.modelId
    }
    // The concrete-model half of the pick (validated above); falsy clears back to
    // the provider's configured model — the INV-9 inherit state.
    if (patch.modelId !== undefined) {
      if (patch.modelId) session.modelId = patch.modelId
      else delete session.modelId
    }
    session.metadataRevision = currentRevision + 1
    emit({ type: 'session.updated', session })
    persist()
    return session
  },
  /** Delete a session (the row menu's "Delete") and every session-owned durable
   *  projection in one persisted mutation. A run session and its run are one
   *  entity in two projections, so deleting the conversation also retires the
   *  run from its routine's history — otherwise the run switcher would reopen a
   *  thread that no longer exists (and the boot materializer would re-mint it).
   *  Artifacts and forks merely cite a source session as provenance; they are
   *  independent resources and deliberately survive with a now-missing source. */
  removeSession(id: string, expectedRevision?: number): boolean {
    const i = SESSIONS.findIndex((s) => s.id === id)
    if (i === -1) return false
    const currentRevision = SESSIONS[i]!.metadataRevision ?? 0
    if (expectedRevision !== undefined && expectedRevision !== currentRevision) {
      throw new ConflictError(
        `This conversation changed elsewhere (expected revision ${expectedRevision}, current revision ${currentRevision}).`,
      )
    }
    if (hasExternalMcpActivity(SESSIONS[i]!.messages ?? [], runningExternalMcp)) {
      throw new ConflictError('Wait for the running MCP tool to finish before deleting this conversation.')
    }
    const [removed] = SESSIONS.splice(i, 1)
    discardMcpActivityAuthorities(id)
    if (isSessionCreationId(id)) retiredSessionCreationIds.add(id)
    const dispatchIndex = dispatch.findIndex((run) => run.execution?.sessionId === id)
    if (dispatchIndex !== -1) {
      dispatch.splice(dispatchIndex, 1)
      emit({ type: 'dispatch.changed' })
    }
    sessionContextBindings.delete(id)
    sessionWorkspaces.delete(id)
    removeSessionPreferences(id)
    if (Object.prototype.hasOwnProperty.call(graph.sessionProject, id)) {
      const sessionProject = { ...graph.sessionProject }
      delete sessionProject[id]
      graph = { ...graph, sessionProject, revision: (graph.revision ?? 0) + 1 }
    }
    if (removed.scheduledRunOf) {
      const task = schedules.find((t) => t.id === removed.scheduledRunOf!.taskId)
      if (task) {
        const before = task.runs.length
        task.runs = task.runs.filter((r) => runSessionId(task.id, r.id) !== removed.id)
        if (task.runs.length !== before) {
          emit({ type: 'schedule.changed', taskId: task.id, tenantId: task.tenantId })
        }
      }
    }
    // The definitive gone-signal (not `session.updated`, which only says
    // "refetch" — a receiver can't derive deletion from a refetched list,
    // and a run session isn't in any list to vanish from). Every client
    // prunes the removed session's panes live (the cross-client half of the
    // live-prune rule).
    emit({ type: 'session.removed', session: removed })
    persist()
    return true
  },

  // ── Session ↔ context bindings (the attachment of record — Primitive 1) ──
  /** The contexts attached to a session — the set every effect this session
   *  initiates is mediated against (docs/shared-resource-coordination.md). */
  sessionContexts(sessionId: string, actorUserId?: string): SessionContext[] {
    const session = SESSIONS.find(candidate => candidate.id === sessionId)
    const tenantId = session?.tenantId ?? defaultTenantId()
    const connection = mcpConnectionRegistry.snapshot()
    return (sessionContextBindings.get(sessionId) ?? []).filter(context => {
      if (!isExternalMcpId(context.id)) return true
      const owner = connection.connections.find(row => row.id === context.id && row.tenantId === tenantId)?.ownerUserId ??
        connection.retired.find(row => row.id === context.id && row.tenantId === tenantId)?.ownerUserId
      return owner === undefined || (owner === actorUserId && activeMcpActor(tenantId, actorUserId) === owner)
    })
  },
  /** Resolve one attached context for a session — the lookup the broker uses to
   *  mediate an effect (Primitive 2). Undefined when it isn't attached. */
  resolveSessionContext(sessionId: string, contextId: string, actorUserId?: string): SessionContext | undefined {
    return this.sessionContexts(sessionId, actorUserId).find((c) => c.id === contextId)
  },
  /** Attach a context to a session (idempotent by context id — re-attaching
   *  replaces it). Broadcasts `session.contexts.changed`; returns the new list. */
  attachContext(sessionId: string, ctx: SessionContext, actorUserId?: string): SessionContext[] {
    const list = sessionContextBindings.get(sessionId) ?? []
    if (isExternalMcpId(ctx.id)) {
      if (ctx.type !== 'mcp') throw new ValidationError('An external MCP connection must be attached as MCP context.')
      const alreadyAttached = list.some((candidate) => candidate.id === ctx.id && candidate.type === 'mcp')
      const session = SESSIONS.find((candidate) => candidate.id === sessionId)
      const tenantId = session?.tenantId ?? defaultTenantId()
      const mcpState = mcpConnectionRegistry.snapshot()
      const row = mcpState.connections.find(candidate => candidate.id === ctx.id && candidate.tenantId === tenantId)
      const retired = mcpState.retired.find(candidate => candidate.id === ctx.id && candidate.tenantId === tenantId)
      const connectionOwner = row?.ownerUserId ?? retired?.ownerUserId
      if (connectionOwner !== undefined && connectionOwner !== activeMcpActor(tenantId, actorUserId)) {
        throw new ValidationError('Only the connection owner can attach this MCP context.')
      }
      if ((!alreadyAttached || row?.ownerUserId !== undefined) && this.mcpConnection(ctx.id, tenantId, actorUserId)?.execution !== 'approval-required') {
        throw new ValidationError('Inspect and connect this MCP server before attaching it.')
      }
    }
    const next = [...list.filter((c) => c.id !== ctx.id), ctx]
    sessionContextBindings.set(sessionId, next)
    emit({ type: 'session.contexts.changed', sessionId })
    persist()
    return next
  },
  /** Detach a context from a session. Returns the new list, or undefined when the
   *  context wasn't attached (so the route can 404). */
  detachContext(sessionId: string, contextId: string): SessionContext[] | undefined {
    const list = sessionContextBindings.get(sessionId)
    if (!list || !list.some((c) => c.id === contextId)) return undefined
    const next = list.filter((c) => c.id !== contextId)
    sessionContextBindings.set(sessionId, next)
    emit({ type: 'session.contexts.changed', sessionId })
    persist()
    return next
  },
  /** Commit the attachment-of-record and its visible workspace as one unit.
   * Every operation is idempotent so a client may safely replay after losing
   * the acknowledgement. Validation happens at the route boundary before this
   * mutator touches either map; observers therefore see both new values or
   * neither, and persistence snapshots them together. */
  updateSessionContextState(
    sessionId: string,
    operations: SessionContextOperation[],
    workspace: SessionWorkspace,
    captureTenantId?: string,
    actorUserId?: string,
  ): SessionContextState {
    return commitSessionContextState(sessionId, operations, workspace, undefined, undefined, undefined, undefined, captureTenantId, actorUserId)
  },

  // ── Dispatch ──
  /** The agent-run feed shown in the Dispatch section — scoped to the caller's
   *  tenant when given (F2/PD9; the six demo accounts each seed their own —
   *  docs/demo-accounts.md). Unscoped for internal callers (metrics). */
  listDispatch(tenantId?: string): DispatchRun[] {
    if (!tenantId) return dispatch
    return dispatch.filter((d) => rowVisibleTo(d, tenantId))
  },
  /** Replay and retirement precede mutable registry/capacity gates. Never
   * reconstitute a deleted result or infer a fresh run from an existing row. */
  getRealDispatch(runId: string, tenantId: string): DispatchRun | 'retired' | undefined {
    const represented = dispatch.find((run) => run.id === runId && run.tenantId === tenantId)
    if (represented?.execution) return represented
    if (retiredSessionCreationIds.has(dispatchSessionId(runId))) return 'retired'
    return undefined
  },
  /** A draft is computation for the Commission owner, not a Project effect.
   * Source projection, grant checks and durable admission are synchronous: no
   * body/network wait can change authority between this check and the commit. */
  startProjectWorkDraft(value: ProjectWorkDraftInput, tenantId: string, runId: string, actorUserId?: string): DispatchRun {
    const represented = this.getRealDispatch(runId, tenantId)
    if (represented === 'retired') throw new NotFoundError('This Dispatch conversation was already removed.')
    if (represented) return represented
    const input = parseProjectWorkDraftInput(value)
    if (!input) throw new ValidationError('Provide an exact Project work source, Commission revision, and Agent/model binding.')
    const source = input.projectWork
    const project = this.listProjects(tenantId).find(row => row.id === source.projectId)
    const commission = COMMISSIONS.get(source.commissionId)
    const item = openSubGoals.find(row => row.id === source.itemId && row.projectId === source.projectId)
    // A private/granted Project is not a public cooperation grant. Match the
    // same live cross-tenant shared gate used by commissioned Project effects.
    const projectOwner = findProject(source.projectId)?.tenantId ?? defaultTenantId()
    if (!project || !item || !commission || commission.projectId !== source.projectId ||
      this.commissionOwnerTenant(commission.id) !== tenantId ||
      (projectOwner !== tenantId && project.shared !== true)) {
      throw new NotFoundError('The Project work item or owned Contributor is unavailable.')
    }
    if (item.status !== 'open') throw new ConflictError('This work item is no longer open.')
    if ((commission.configurationRevision ?? 0) !== source.expectedRevision) {
      throw new ConflictError('The Contributor changed. Review its current configuration before drafting.')
    }
    if (commission.agentId !== input.execution.agentId || !this.commissionRolePermits(commission.id, 'read')) {
      throw new ValidationError('The selected Agent must be this Contributor’s read-capable Agent.')
    }
    const agent = WORKER_AGENTS.get(commission.agentId)
    if (!agent) throw new NotFoundError('The selected Agent is unavailable.')
    const selectedProvider = this.listProviders(tenantId).find(row => row.id === input.execution.providerId)
    if (!selectedProvider) throw new NotFoundError('The selected model provider is unavailable.')
    for (const budget of [commission.grant, agent.budget, resolveProvider(agent.providerId).plan, selectedProvider.plan]) {
      const over = this.overSpendLimit(budget, tenantId)
      if (over) throw new LimitError(`Contributor budget limit reached for '${over.label}'.`)
    }
    const mcp = input.mcpProposal
      ? prepareProjectWorkMcpDraft(this, tenantId, actorUserId, input.mcpProposal, item)
      : undefined
    return this.startRealDispatch({ ...projectWorkDraftPrompt(project, item, commission, mcp), execution: input.execution }, tenantId, runId, source, mcp?.preview)
  },
  startRealDispatch(input: RealDispatchInput, tenantId: string, runId: string, projectWork?: ProjectWorkDraftSource, mcpProposal?: ProjectWorkMcpDraftPreview): DispatchRun {
    const represented = this.getRealDispatch(runId, tenantId)
    if (represented === 'retired') throw new NotFoundError('This Dispatch conversation was already removed.')
    if (represented) return represented
    if (dispatch.some((run) => run.id === runId)) throw new ConflictError('This key already represents a different Dispatch.')
    const parsed = parseRealDispatchInput(input)
    if (!parsed) throw new ValidationError('Dispatch requires a bounded task and explicit Agent, endpoint provider, and model.')
    if (mcpProposal && !projectWork) throw new ValidationError('An MCP argument draft requires its Project work source.')
    const { agentId, providerId, modelId } = parsed.execution
    const agent = this.listAgents(tenantId).find((row) => row.id === agentId)
    const provider = this.listProviders(tenantId).find((row) => row.id === providerId)
    if (!agent || !provider) throw new NotFoundError('The selected Agent or model provider is unavailable.')
    if (provider.kind === 'session') throw new ValidationError('Dispatch requires an endpoint model, not a Session provider.')
    assertModelInCatalog(modelId, providerId, agentId)
    if (provider.execution !== 'configured' && provider.execution !== 'mock') throw new CapabilityUnavailableError('Connect the selected model provider before starting Dispatch.')
    const over = this.overSpendLimit(agent.budget, tenantId)
    if (over) throw new LimitError(`Plan limit reached for '${over.label}'.`)
    // A Dispatch starts immediately or retains the user's form for Retry. It
    // never silently queues work that could later spend under changed authority.
    if (!backgroundModelCapacity(tenantId, agentId)) {
      throw new LimitError('Dispatch capacity is busy. Retry when another run finishes (4 per instance, 2 per account, 1 per Agent).')
    }
    const sessionId = dispatchSessionId(runId)
    if (SESSIONS.some((session) => session.id === sessionId)) throw new ConflictError('This Dispatch conversation identity is already in use.')
    const run: DispatchRun = {
      id: runId, tenantId, title: parsed.title.trim(), detail: parsed.detail?.trim() ?? '',
      status: 'running', startedAt: Date.now(),
      execution: { ...parsed.execution, kind: 'conversation', sessionId, state: 'running',
        ...(projectWork ? { projectWork: { ...projectWork } } : {}),
        ...(mcpProposal ? { mcpProposal: { ...mcpProposal } } : {}) },
    }
    return commitMutationBatch(() => {
      mintSession({
        id: sessionId, tenantId, title: run.title, preview: run.detail || run.title,
        agentId, providerId, modelId,
        messages: [{ id: this.mintMessageId('user'), role: 'user', content: dispatchPrompt(run.title, run.detail) }],
      })
      dispatch.unshift(run)
      emit({ type: 'dispatch.changed' })
      persist()
      return run
    })
  },
  /** One terminal transaction saves the real assistant/proposals and job face.
   * Terminal replay, deletion and late callbacks can never restart this job. */
  settleRealDispatch(runId: string, tenantId: string, outcome: GenerationOutcome, message?: Message): boolean {
    const run = dispatch.find((candidate) => candidate.id === runId && candidate.tenantId === tenantId)
    if (!run?.execution || run.execution.state !== 'running') return false
    const session = SESSIONS.find((candidate) => candidate.id === run.execution!.sessionId && candidate.tenantId === tenantId)
    if (!session) return false
    return commitMutationBatch(() => {
      if (message) {
        this.appendMessage(session.id, message)
        run.execution!.messageId = message.id
      }
      run.execution!.state = outcome === 'aborted' ? 'cancelled' : outcome === 'ok' && message ? 'replied' : 'failed'
      run.status = run.execution!.state === 'replied' ? 'done' : 'failed'
      emit({ type: 'dispatch.changed' })
      persist()
      return true
    })
  },
  /** Kick off a one-off dispatch (a single on-demand agent run). It lands
   *  'running', broadcasts, then finishes 'done' a beat later (the mock stand-in
   *  for a real agent run) and broadcasts again. Persisted at both edges (P7), so a
   *  live run survives a restart — and one caught mid-flight by a restart is swept to
   *  'failed' on rehydrate (the completing timer doesn't survive the process). Returns
   *  the run. */
  addDispatch(title: string, detail?: string, tenantId?: string, manualRunId?: string): DispatchRun {
    requireAutomationFixture('dispatch')
    if (manualRunId) {
      const represented = dispatch.find((run) => run.id === manualRunId && rowVisibleTo(run, tenantId ?? defaultTenantId()))
      if (represented) return represented
    }
    // Concurrency limit (P7): bound the in-flight one-off runs so unbounded dispatch can't
    // pile up. Opt-in via `DISPATCH_MAX_CONCURRENT` (read per call ⇒ off by default, so the
    // demo + existing tests are unaffected), mirroring the rate-limiter's opt-in shape. Count
    // only LIVE-minted (`d-new-*`) running runs — the seed feed's permanent 'running' fixture
    // (d1) has no completing timer and mustn't consume a slot (else a cap of 1 wedges forever).
    const cap = nonNegativeIntEnv(process.env.DISPATCH_MAX_CONCURRENT, 0)
    if (cap > 0) {
      const inFlight = dispatch.filter((r) => r.status === 'running' && r.id.startsWith('d-new-')).length
      if (inFlight >= cap) {
        throw new LimitError(`dispatch concurrency limit reached (${cap} in flight) — retry once a run finishes`)
      }
    }
    const run: DispatchRun = {
      id: manualRunId ?? `d-new-${(dispatchSeq += 1)}`,
      ...(tenantId ? { tenantId } : {}), // the creator's tenant (F2/PD9)
      title,
      status: 'running',
      startedAt: Date.now(),
      detail: detail?.trim() || 'Working on it…',
    }
    dispatch.unshift(run)
    emit({ type: 'dispatch.changed' })
    persist()
    setTimeout(() => {
      // startedAt is the start time — it doesn't change as the run settles; the UI
      // re-derives "started 4 minutes ago" → "4 minutes ago" from it live.
      if (run.status !== 'running') return // swept (e.g. after a restart) — don't resurrect it
      run.status = 'done'
      emit({ type: 'dispatch.changed' })
      persist()
    }, DISPATCH_SETTLE_MS)
    return run
  },

  // ── Contexts (the set-up ones, on the Contexts page) ──
  /** Public browse fixtures follow the persisted first-run world, not the
   * current process profile: a historical demo snapshot stays demo on release. */
  contextCatalog() {
    return buildContextCatalog(worldMode)
  },
  savedContexts(tenantId: string = defaultTenantId(), actorUserId?: string): SavedContextsSnapshot {
    const base = contextRegistry.snapshot(tenantId)
    const external = mcpConnectionRegistry.savedContexts(tenantId, activeMcpActor(tenantId, actorUserId))
    const contexts = [...base.contexts.filter((context) => !isExternalMcpId(context.id)), ...external]
    return {
      contexts,
      connectedConnectorIds: base.connectedConnectorIds.filter((id) => !isExternalMcpId(id)),
      connectedMcpIds: [
        ...base.connectedMcpIds.filter((id) => !isExternalMcpId(id)),
        ...external.filter((context) => context.status === 'connected').map((context) => context.id),
      ],
    }
  },
  /** Set a saved connector / MCP server's auth status — the connect / disconnect on
   *  the Contexts page, and the seam a real OAuth callback or token-expiry would use.
   *  Mutates the record, broadcasts `connector.status` so every client reconciles,
   *  and persists. Returns the new snapshot, or undefined for an unknown id. */
  setConnectorStatus(
    id: string,
    status: ContextStatus,
    tenantId: string = defaultTenantId(),
    expectedRevision?: number,
  ): SavedContextsSnapshot | undefined {
    if (isExternalMcpId(id)) throw new McpConnectionError('invalid')
    const result = contextRegistry.setStatus(id, status, tenantId, expectedRevision)
    if (!result) return undefined
    if (!result.changed) return this.savedContexts(tenantId)
    emit({ type: 'connector.status', id, status, tenantId })
    persist()
    return this.savedContexts(tenantId)
  },
  /** Save a context to the account's set-up list (the Contexts page's Add). The
   *  registry is the system of record — the page's add once lived in component
   *  state and evaporated on unmount. Idempotent by id (re-adding returns the
   *  existing row); broadcasts so every client's page + composer quick list
   *  reconcile; persists. */
  addSavedContext(ctx: SavedContext, tenantId: string = defaultTenantId()): SavedContext {
    if (isExternalMcpId(ctx.id)) throw new McpConnectionError('invalid')
    const { context, created } = contextRegistry.add(ctx, tenantId)
    if (!created) return context
    emit({ type: 'savedcontext.changed', id: context.id, tenantId })
    persist()
    return context
  },
  /** Remove a context from the set-up list (the page's "Remove from contexts").
   *  False for an unknown id (→ 404). */
  removeSavedContext(
    id: string,
    tenantId: string = defaultTenantId(),
    expectedRevision?: number,
  ): boolean {
    if (isExternalMcpId(id)) throw new McpConnectionError('invalid')
    if (!contextRegistry.remove(id, tenantId, expectedRevision)) return false
    emit({ type: 'savedcontext.changed', id, tenantId })
    persist()
    return true
  },
  /** Public MCP connection projection. Endpoint and credential references are
   * intentionally absent; execution readiness is a code-owned projection of
   * the connected inspection's admitted tool hashes. */
  mcpConnections(tenantId: string, actorUserId?: string): McpConnectionView[] {
    return mcpConnectionRegistry.list(tenantId, activeMcpActor(tenantId, actorUserId))
  },
  mcpConnection(id: string, tenantId: string, actorUserId?: string): McpConnectionView | undefined {
    return mcpConnectionRegistry.view(id, tenantId, activeMcpActor(tenantId, actorUserId))
  },
  /** Internal-only authority lookup for the transport and credential seam. */
  privateMcpConnection(id: string, tenantId: string, actorUserId?: string): PrivateMcpConnection | undefined {
    return mcpConnectionRegistry.privateConnection(id, tenantId, activeMcpActor(tenantId, actorUserId))
  },
  createMcpConnection(
    setup: McpConnectionSetup,
    tenantId: string,
    allowLoopback = false,
    actorUserId?: string,
  ): { connection: McpConnectionView; created: boolean } {
    return commitMutationBatch(() => {
      const result = mcpConnectionRegistry.create(setup, tenantId, allowLoopback, activeMcpActor(tenantId, actorUserId))
      if (result.created) {
        emit({ type: 'savedcontext.changed', id: result.connection.id, tenantId,
          ...(result.connection.transport === 'stdio' || result.connection.authentication === 'device-oauth' ? { ownerUserId: actorUserId! } : {}) })
        persist()
      }
      return result
    })
  },
  commitMcpInspection(
    id: string,
    tenantId: string,
    expectedRevision: number,
    discovery: Parameters<typeof mcpConnectionRegistry.commitInspection>[3],
    inspectedAt: number,
    credentialReference?: string,
    operation?: McpInspectionOperation,
    actorUserId?: string,
    grantReference?: string,
  ): McpConnectionView {
    return commitMutationBatch(() => {
      const result = mcpConnectionRegistry.commitInspection(
        id, tenantId, expectedRevision, discovery, inspectedAt, credentialReference, operation, activeMcpActor(tenantId, actorUserId), grantReference,
      )
      emit({ type: 'connector.status', id, status: 'connected', tenantId,
        ...(result.transport === 'stdio' || result.authentication === 'device-oauth' ? { ownerUserId: actorUserId! } : {}) })
      persist()
      return result
    })
  },
  disconnectMcpConnection(id: string, tenantId: string, expectedRevision: number, actorUserId?: string): McpConnectionView {
    return commitMutationBatch(() => {
      const result = mcpConnectionRegistry.disconnect(id, tenantId, expectedRevision, activeMcpActor(tenantId, actorUserId))
      emit({ type: 'connector.status', id, status: 'needs-auth', tenantId,
        ...(result.transport === 'stdio' || result.authentication === 'device-oauth' ? { ownerUserId: actorUserId! } : {}) })
      persist()
      return result
    })
  },
  removeMcpConnection(id: string, tenantId: string, expectedRevision: number, actorUserId?: string): boolean {
    return commitMutationBatch(() => {
      const row = this.privateMcpConnection(id, tenantId, actorUserId)
      const removed = mcpConnectionRegistry.remove(id, tenantId, expectedRevision, activeMcpActor(tenantId, actorUserId))
      if (removed) {
        emit({ type: 'savedcontext.changed', id, tenantId,
          ...(row?.ownerUserId ? { ownerUserId: actorUserId! } : {}) })
        persist()
      }
      return removed
    })
  },
  /** Internal credential bindings for the authenticated MCP transport. */
  mcpCredentialBindings() {
    return mcpConnectionRegistry.credentialBindings()
  },
  /** Private owner/revision bindings for the native stdio grant authority. */
  mcpStdioBindings() {
    return mcpConnectionRegistry.stdioBindings()
  },
  /** The sidebar detail for one connector / MCP server (mock: derived locally;
   *  a real backend fetches live resources from the connected service). */
  connectorDetail(connector: Connector, tenantId: string = defaultTenantId(), actorUserId?: string): ConnectorDetail {
    if (isExternalMcpId(connector.id)) {
      const connection = this.mcpConnection(connector.id, tenantId, actorUserId)
      if (!connection) throw new McpConnectionError('missing')
      const executable = connection.execution === 'approval-required'
      return {
        blurb: executable
          ? 'This saved external MCP catalog has admitted tools. Every call still requires explicit approval.'
          : 'This saved external MCP catalog currently has no admitted executable tools.',
        access: [executable
          ? 'Admitted tools require explicit approval before every call.'
          : 'Tool execution is unavailable until the connection is inspected and at least one tool is admitted.'],
        itemsLabel: 'Inspected tools',
        items: connection.tools.map(tool => ({ label: tool.name, ...(tool.description ? { meta: tool.description } : {}) })),
      }
    }
    return connectorDetail(connector)
  },

  // ── Artifact bodies ──
  /** Readable bodies keyed by exact identity. The demo library is a resolver
   *  input, never a public baseline: clean worlds and unrelated callers must
   *  not receive fictional content. Compatibility names are emitted only when
   *  unique across the whole projection and never in place of an exact ID. */
  artifactContent(tenantId: string): ArtifactContentLibrary {
    if (!tenantId) return {}
    const visible = new Map<string, { name: string; body: ArtifactContent | undefined }>()
    // Demo workspace items predate the canonical artifact registry and carry
    // separate IDs. Project only code-owned seed identities, never a filename
    // supplied by an authored row or attached file. The live session must still
    // contain the item and pass its current read wall (including revocation).
    if (worldMode === 'demo') {
      for (const seed of SEED_SESSIONS) {
        const session = SESSIONS.find((candidate) => candidate.id === seed.id)
        if (!session || !this.sessionVisibleToTenant(session, tenantId)) continue
        for (const artifact of seed.artifacts ?? []) {
          if (!session.artifacts?.some((candidate) => candidate.id === artifact.id)) continue
          const body = ARTIFACT_CONTENT[artifact.name]
          visible.set(artifact.id, { name: artifact.name, body: body ? identifyDocumentBody(artifact.id, body) : undefined })
        }
      }
    }
    for (const artifact of [...baseArtifacts(), ...graph.extraArtifacts].map(artifactWithMetadata)) {
      if (this.artifactVisibleToTenant(artifact, tenantId)) {
        visible.set(artifact.id, { name: artifact.name, body: artifactBodyOf(artifact.id) })
      }
    }
    // Count bodyless rows too: they must not inherit a different row's content
    // through a shared name or a name equal to their exact ID.
    const byName = new Map<string, number>()
    for (const { name } of visible.values()) byName.set(name, (byName.get(name) ?? 0) + 1)
    const bodies = new Map<string, ArtifactContent>()
    for (const [id, { name, body }] of visible) {
      if (!body) continue
      bodies.set(id, body)
      if (byName.get(name) === 1 && !visible.has(name)) bodies.set(name, body)
    }
    return Object.fromEntries(bodies)
  },
  /** Current exact Artifact read for a saved-context capture. `unsupported`
   * distinguishes a readable metadata row without a canonical saved body from
   * an absent/unreadable identity, without ever falling back to its name. */
  artifactSnapshotSource(id: string, tenantId: string): import('../../contract/artifactSnapshot.ts').ArtifactSnapshotSource | { unsupported: true } | undefined {
    const artifact = findArtifact(id)
    if (!artifact || !this.artifactVisibleToTenant(artifact, tenantId)) return undefined
    const body = artifactBodyOf(id)
    if (!body) return { unsupported: true }
    return { artifactId: artifact.id, title: artifact.name, artifactKind: artifact.kind, body }
  },
  artifactHistoryPage(artifactId: string, tenantId: string, beforeRevision?: number, limit = 50): ArtifactHistoryPage | undefined {
    const artifact = retainedArtifact(artifactId)
    const body = artifact && retainedArtifactBody(artifactId)
    if (!artifact || !body || !this.artifactOwnedBy(artifact, tenantId) || !historyBodyWithoutRevision(body)) return undefined
    const versions = artifactHistory.get(artifactId) ?? []
    const eligible = versions.filter((version) => beforeRevision === undefined || version.revision < beforeRevision)
    const page = eligible.slice(-Math.min(Math.max(limit, 1), 50)).reverse()
    const more = eligible.length > page.length
    const metadata: ArtifactHistoryVersionMetadata[] = page.map(({ body: _body, ...version }) => ({ ...version }))
    return {
      artifactId,
      currentRevision: body.revision ?? 0,
      versions: metadata,
      ...(more && page.length ? { nextBeforeRevision: page.at(-1)!.revision } : {}),
    }
  },
  artifactHistoryVersion(artifactId: string, revision: number, tenantId: string): ArtifactHistoryVersionResult | undefined {
    const artifact = retainedArtifact(artifactId)
    const body = artifact && retainedArtifactBody(artifactId)
    if (!artifact || !body || !this.artifactOwnedBy(artifact, tenantId) || !historyBodyWithoutRevision(body)) return undefined
    const version = artifactHistory.get(artifactId)?.find((candidate) => candidate.revision === revision)
    return version ? { artifactId, currentRevision: body.revision ?? 0, version: structuredClone(version) } : undefined
  },
  restoreArtifactHistoryVersion(
    artifactId: string,
    sourceRevision: number,
    expectedRevision: number,
    tenantId: string,
    userId: string,
    idempotencyKey: string,
  ): ArtifactHistoryVersionResult | undefined {
    const artifact = retainedArtifact(artifactId)
    const current = artifact && retainedArtifactBody(artifactId)
    if (!artifact || !current || !this.artifactOwnedBy(artifact, tenantId) || !historyBodyWithoutRevision(current)) return undefined
    const keyHash = createHash('sha256').update(idempotencyKey).digest('hex')
    const receiptKey = JSON.stringify([tenantId, userId, keyHash])
    const existingReceipt = artifactHistoryRestoreReceipts.get(receiptKey)
    if (existingReceipt) {
      if (existingReceipt.artifactId !== artifactId || existingReceipt.sourceRevision !== sourceRevision ||
        existingReceipt.expectedRevision !== expectedRevision) {
        throw new ConflictError('This Artifact restore key was already used for different reviewed intent.')
      }
      const version = artifactHistory.get(artifactId)?.find((candidate) => candidate.revision === existingReceipt.restoredRevision)
      if (!version) throw new ConflictError('The saved restore receipt is unavailable. Refresh the Artifact history.')
      return { artifactId, currentRevision: current.revision ?? 0, version: structuredClone(version) }
    }
    if (artifactIsTrashed(artifactId)) throw new ConflictError('Restore this Artifact from Trash before restoring a body version.')
    const target = artifactHistory.get(artifactId)?.find((candidate) => candidate.revision === sourceRevision)
    if (!target) return undefined
    const currentRevision = current.revision ?? 0
    if (currentRevision !== expectedRevision || currentRevision >= Number.MAX_SAFE_INTEGER) {
      throw new ConflictError(`This Artifact changed elsewhere (expected revision ${expectedRevision}, current revision ${currentRevision}).`)
    }
    const matchingKind = artifact.kind === 'doc' || artifact.kind === 'email'
      ? target.body.type === 'doc'
      : artifact.kind === 'sheet'
        ? target.body.type === 'sheet' || target.body.type === 'workbook'
        : artifact.kind === 'slide' && target.body.type === 'slides'
    if (!matchingKind) return undefined
    const currentHistoryBody = historyBodyWithoutRevision(current)
    if (sourceRevision === currentRevision || JSON.stringify(currentHistoryBody) === JSON.stringify(target.body)) {
      throw new ConflictError('This Artifact already has that saved body version.')
    }
    const updated = { ...structuredClone(target.body), revision: currentRevision + 1 } as ArtifactContent
    const receipt: StoredArtifactHistoryRestoreReceipt = {
      tenantId, userId, artifactId, keyHash, sourceRevision, expectedRevision,
      restoredRevision: currentRevision + 1,
    }
    commitArtifactBodyEdit(artifact, updated, {
      reason: 'restore',
      restoredFromRevision: sourceRevision,
      beforePersist: () => artifactHistoryRestoreReceipts.set(receiptKey, receipt),
    })
    const version = artifactHistory.get(artifactId)!.at(-1)!
    return { artifactId, currentRevision: updated.revision!, version: structuredClone(version) }
  },
  /** A fresh saved-document projection behind the exact artifact read wall.
   * Undefined hides existence; null means a readable row has no exportable
   * document. Only actual seed identities may use the demo name-keyed body. */
  exportArtifactDocument(artifactId: string, tenantId: string) {
    const artifact = findArtifact(artifactId)
    if (!artifact || !this.artifactVisibleToTenant(artifact, tenantId)) return undefined
    const body = artifactBodyOf(artifactId)
    if ((artifact.kind !== 'doc' && artifact.kind !== 'email') || body?.type !== 'doc') return null
    return { artifactId, ...documentMarkdown(artifact.name, body) }
  },
  async exportArtifactWord(artifactId: string, tenantId: string) {
    const artifact = findArtifact(artifactId)
    if (!artifact || !this.artifactVisibleToTenant(artifact, tenantId)) return undefined
    const body = artifactBodyOf(artifactId)
    if ((artifact.kind !== 'doc' && artifact.kind !== 'email') || body?.type !== 'doc' || !hasWordText(body)) return null
    // Freeze the saved revision before writing the package. A revoked reader
    // must not receive the bytes after the async writer yields.
    const exported = await documentDocx(artifact.name, structuredClone(body))
    const current = findArtifact(artifactId)
    if (!current || !this.artifactVisibleToTenant(current, tenantId)) return undefined
    return exported ? { artifactId, ...exported } : null
  },
  async exportArtifactSpreadsheet(artifactId: string, tenantId: string) {
    const artifact = findArtifact(artifactId)
    if (!artifact || !this.artifactVisibleToTenant(artifact, tenantId)) return undefined
    const body = artifactBodyOf(artifactId)
    if (artifact.kind !== 'sheet' || !body || !isSpreadsheetContent(body)) return null
    // Take one saved revision before the async writer yields; never mix rows
    // from different reads or borrow the compatibility name-keyed library.
    const exported = await sheetXlsx(artifact.name, structuredClone(body))
    const current = findArtifact(artifactId)
    if (!current || !this.artifactVisibleToTenant(current, tenantId)) return undefined
    return { artifactId, ...exported }
  },
  async exportArtifactPresentation(artifactId: string, tenantId: string) {
    const artifact = findArtifact(artifactId)
    if (!artifact || !this.artifactVisibleToTenant(artifact, tenantId)) return undefined
    const body = artifactBodyOf(artifactId)
    if (artifact.kind !== 'slide' || body?.type !== 'slides' || !hasPowerPointText(body)) return null
    const exported = await slidesPptx(artifact.name, structuredClone(body))
    const current = findArtifact(artifactId)
    if (!current || !this.artifactVisibleToTenant(current, tenantId)) return undefined
    return { artifactId, ...exported }
  },
  /** The text an addressed block carries right now — see `artifactBlockTextOf`. */
  artifactBlockText(artifactId: string, block: number): string | undefined {
    return artifactBlockTextOf(artifactId, block)
  },
  /** Commit a reviewed complete Document/sheet/workbook/deck draft. The acting
   * tenant, original kind, literal-body bounds and mandatory revision precede effects.
   * Metadata, immutable save origin and sharing remain independent. */
  updateStructuredArtifactContent(artifactId: string, content: unknown, expectedRevision: number, tenantId: string): ArtifactContent | undefined {
    const artifact = findArtifact(artifactId)
    if (!artifact || !this.artifactOwnedBy(artifact, tenantId)) return undefined
    const body = artifactBodyOf(artifactId)
    const next = parseEditableArtifactBody(content)
    const validKind = !!body && !!next && (artifact.kind === 'doc' || artifact.kind === 'email'
      ? body.type === 'doc' && next.type === 'doc'
      : artifact.kind === 'sheet'
        ? isSpreadsheetContent(body) && isSpreadsheetContent(next) && (body.type !== 'workbook' || next.type === 'workbook')
        : artifact.kind === 'slide' && body.type === 'slides' && next.type === 'slides')
    if (!body || !next || !validKind ||
      !Number.isSafeInteger(expectedRevision) || expectedRevision < 0) return undefined
    const revision = body.revision ?? 0
    if (revision !== expectedRevision || revision >= Number.MAX_SAFE_INTEGER) {
      throw new ConflictError(`This artifact changed elsewhere (expected revision ${expectedRevision}, current revision ${revision}).`)
    }
    if (next.type === 'doc') validateNewDocumentBlockIds(artifactId, body, next)
    const updated: ArtifactContent = { ...next, revision: revision + 1 }
    return commitArtifactBodyEdit(artifact, updated)
  },
  /** Rewrite ONE addressed prose block — the artifact layer's first real write
   *  path, and the ONE mutator behind both doors: the owner's own editor and a
   *  landed `artifact-patch` proposal. Landing must never be a parallel write
   *  path (the `updateSchedule` precedent), so there is exactly this function.
   *
   *  Refuses anything it could not honestly apply, rather than storing an inert
   *  record (INV-9): an unknown artifact, a non-doc body, an out-of-range index,
   *  a block that carries no single editable string (`docBlockText`), or empty
   *  text. Ownership is the CALLER's business — the route and the landing path
   *  each gate before calling, exactly as they do for a routine. */
  updateArtifactBlock(
    artifactId: string,
    block: number | string,
    text: string,
    expectedRevision?: number,
  ): ArtifactContent | undefined {
    const artifact = findArtifact(artifactId)
    if (!artifact || (artifact.kind !== 'doc' && artifact.kind !== 'email')) return undefined
    const body = artifactBodyOf(artifactId)
    if (!body || body.type !== 'doc') return undefined
    const index = typeof block === 'number'
      ? block
      : body.blocks.findIndex((candidate) => candidate.id === block)
    if (!Number.isInteger(index) || index < 0 || index >= body.blocks.length) return undefined
    const target = body.blocks[index]
    if (!target || docBlockText(target) === undefined) return undefined
    if (typeof block === 'string' &&
      (!target.id || !('h' in target || 'p' in target) || expectedRevision === undefined)) return undefined
    const currentRevision = body.revision ?? 0
    if (expectedRevision !== undefined && expectedRevision !== currentRevision) {
      throw new ConflictError(
        `This artifact changed elsewhere (expected revision ${expectedRevision}, current revision ${currentRevision}).`,
      )
    }
    if (typeof block === 'number' && expectedRevision === undefined && !stableDocumentBlockOrder(artifactId)) {
      throw new ConflictError('This legacy block address is no longer safe after a Document structure change. Refresh and retry with expectedRevision.')
    }
    // Clamped like every other free-text field the layer stores: this string is
    // written into a body that GET /artifact-content hands to every reader of
    // the document, so an unbounded one is an unbounded broadcast.
    const next = text.trim().slice(0, MAX_ARTIFACT_BLOCK_CHARS)
    if (!next) return undefined
    const blocks = body.blocks.map((b, i) => (i === index ? withDocBlockText(b, next) : b))
    const updated: ArtifactContent = { ...body, blocks, revision: currentRevision + 1 }
    return commitArtifactBodyEdit(artifact, updated)
  },

  // ── Usage (the composer gauge: context window + plan limit windows) ──
  /** Record one turn's real token usage (from the model's Messages response)
   *  against the rolling plan windows. Called by the message route after every
   *  turn — including ephemeral ones, since they consume real tokens. */
  recordUsage(inputTokens: number, outputTokens: number, tenantId?: string): void {
    usageRegistry.record(inputTokens, outputTokens, tenantId)
    persist()
  },
  /** Count one turn's outcome (F6 PD31 observability). Called by the message route after
   *  every turn so a degraded model path shows up in `/metrics` instead of being silent. */
  recordGenerationOutcome(outcome: GenerationOutcome): void {
    generationCounts.set(outcome, (generationCounts.get(outcome) ?? 0) + 1)
  },
  /** The generation-outcome tallies for `/metrics` — every known outcome present (0 until
   *  seen) so the Prometheus series exist from the first scrape. */
  generationOutcomes(): Record<GenerationOutcome, number> {
    return {
      ok: generationCounts.get('ok') ?? 0,
      fallback: generationCounts.get('fallback') ?? 0,
      aborted: generationCounts.get('aborted') ?? 0,
      error: generationCounts.get('error') ?? 0,
    }
  },
  /** Spend-time enforcement (D8): the plan window this Agent's effective budget has
   *  exhausted (consumed ≥ its effective ceiling), or null. The message route refuses a
   *  turn when this is non-null — the per-turn gate the mint-time funnel doesn't provide.
   *  Scoped to the caller's tenant (F2/PD9): one tenant exhausting its window doesn't 429
   *  another. Omitted `tenantId` ⇒ the default tenant (the single-tenant mock, and tests). */
  overSpendLimit(budget?: Budget, tenantId?: string): { label: string; ceiling: number } | null {
    return meterFor(tenantId).overLimit(budget)
  },
  /** The usage snapshot the composer gauge renders: the open session's real
   *  context-window fill (system+tools baseline + an estimate of every message in
   *  the thread) plus the live plan windows. `sessionId` selects which thread the
   *  context figure reflects; omitted = baseline only. */
  /** Snapshot the exact compaction input without changing state. The asynchronous
   *  model call happens outside the store; `applySessionCompaction` compares this
   *  base before committing, so a new turn or transcript verdict wins instead of
   *  disappearing behind a stale summary. */
  prepareSessionCompaction(sessionId: string): SessionCompactionPreparation | undefined {
    const session = SESSIONS.find((s) => s.id === sessionId)
    if (!session) return undefined
    const msgs = session.messages ?? []
    if (hasExternalMcpActivity(msgs, pendingExternalMcp)) throw unresolvedMcpConflict()
    if (msgs.length <= COMPACTION_KEEP_RECENT + 1) return { kind: 'noop', session: this.getSession(sessionId)! }
    const older = msgs.slice(0, msgs.length - COMPACTION_KEEP_RECENT)
    const olderReal = older.filter((m) => m.compactedFrom == null)
    return {
      kind: 'ready',
      sessionId,
      expectedState: compactionState(session),
      sourceMessages: structuredClone(older),
      archiveMessages: structuredClone(olderReal),
    }
  },
  /** Exact durable acknowledgement for one keyed compaction. Session ownership
   * is the private authority anchor; the opaque public id proves only the act. */
  getSessionCompaction(
    sessionId: string,
    compactionId: string,
    tenantId: string,
  ): Session | 'invalid' | undefined {
    if (!isSessionCompactionId(compactionId)) return 'invalid'
    const session = SESSIONS.find((candidate) => candidate.id === sessionId)
    if (!session || !this.sessionOwnedBy(session, tenantId)) return undefined
    if (!session.compactionReceiptIds?.includes(compactionId)) return undefined
    return this.getSession(sessionId)
  },
  /** A keyed request against an already-short thread is still acknowledged
   * durably. That keeps an exact Retry from inventing model work later after new
   * turns arrive, while the legacy unkeyed no-op remains a free read. */
  acknowledgeSessionCompaction(
    sessionId: string,
    compactionId: string,
    tenantId: string,
  ): Session | 'invalid' | undefined {
    if (!isSessionCompactionId(compactionId)) return 'invalid'
    const session = SESSIONS.find((candidate) => candidate.id === sessionId)
    if (!session || !this.sessionOwnedBy(session, tenantId)) return undefined
    if (session.compactionReceiptIds?.includes(compactionId)) return this.getSession(sessionId)
    session.compactionReceiptIds = [...(session.compactionReceiptIds ?? []), compactionId]
    emit({ type: 'session.updated', session })
    persist()
    return this.getSession(sessionId)
  },
  /** Commit one generated continuation brief if and only if the transcript still
   *  matches its preparation. Originals remain in the durable archive, one marker
   *  replaces the active prefix, and the event is published only after persistence. */
  applySessionCompaction(
    plan: SessionCompactionPlan,
    content: string,
    provenance: { agentId?: string; providerId?: string; modelId?: string } = {},
    receipt?: { logicalId: string; tenantId: string },
  ): Session | 'invalid' | undefined {
    const session = SESSIONS.find((s) => s.id === plan.sessionId)
    if (!session) return undefined
    if (receipt) {
      if (!isSessionCompactionId(receipt.logicalId) || !this.sessionOwnedBy(session, receipt.tenantId)) {
        return 'invalid'
      }
      if (session.compactionReceiptIds?.includes(receipt.logicalId)) return this.getSession(plan.sessionId)
    }
    if (hasExternalMcpActivity(session.messages ?? [], pendingExternalMcp)) throw unresolvedMcpConflict()
    if (compactionState(session) !== plan.expectedState) {
      throw new ConflictError('This conversation changed while its summary was being prepared. Nothing was archived; retry from the latest turns.')
    }
    const summaryContent = content.trim()
    if (!summaryContent || summaryContent.length > MAX_COMPACTION_SUMMARY_CHARS) {
      throw new ValidationError(`A conversation summary must contain 1..${MAX_COMPACTION_SUMMARY_CHARS} characters.`)
    }
    const recent = (session.messages ?? []).slice(-COMPACTION_KEEP_RECENT)
    const archive = [...(session.compactedMessages ?? []), ...plan.archiveMessages]
    const summary: Message = {
      id: this.mintMessageId('assistant'),
      role: 'assistant',
      content: summaryContent,
      compactedFrom: archive.length,
      ...provenance,
    }
    session.compactedMessages = archive
    session.messages = [summary, ...recent]
    if (receipt) {
      session.compactionReceiptIds = [...(session.compactionReceiptIds ?? []), receipt.logicalId]
    }
    session.updatedAt = Date.now()
    emit({ type: 'session.updated', session })
    persist()
    return this.getSession(plan.sessionId)
  },
  usage(sessionId?: string, tenantId?: string): UsageSnapshot {
    let messageTokens = 0
    const session = sessionId ? SESSIONS.find((s) => s.id === sessionId) : undefined
    for (const m of session?.messages ?? []) messageTokens += estimateTokens(messageHistoryText(m))
    // The context estimate includes the eagerly injected base tools and prompt.
    // Dynamic API/connector/routine tools and attachment payloads are not counted.
    const agent = resolveAgent(session?.agentId)
    const systemPromptTokens = estimateTokens(systemPrompt({ id: sessionId ?? '', title: session?.title ?? '' }, agent))
    // The context figures are measured against the session's RESOLVED cognition —
    // the same chain a turn routes (provider: session pick ?? agent's ?? default;
    // model: session pick ?? the provider's configured model) — so the gauge's
    // capacity comes from the provider's own catalog, never a client constant. A
    // Session provider's model is whatever session drains its mailbox (opaque), and
    // a model the catalog doesn't describe has no known window: both degrade to
    // unknown-capacity (`windowTokens` absent), the honest reading.
    const provider = effectiveProviderOf(session)
    // Session providers always receive base definitions through relayReply; the
    // explicit capability check governs endpoint generation only. Preserve that
    // behavior even if a restored legacy Session config says toolUse:false.
    const providerSupportsTools = provider.kind === 'session' ||
      PROVIDER_CONFIGS.get(provider.id)?.capabilities?.toolUse !== false
    const baseTools = baseToolDefinitions(agent.tools, providerSupportsTools)
    const systemToolsTokens = baseTools.length ? estimateTokens(JSON.stringify(baseTools)) : 0
    const opaque = provider.kind === 'session'
    const modelId = opaque ? undefined : session?.modelId ?? resolvedModelId(PROVIDER_CONFIGS.get(provider.id))
    const model = modelId ? provider.models?.find((m) => m.id === modelId) : undefined
    return {
      context: contextBreakdown({ messageTokens, systemToolsTokens, systemPromptTokens }, model?.contextWindow),
      limits: meterFor(tenantId).planLimits(), // per-tenant plan windows (F2/PD9)
      model: {
        providerId: provider.id,
        providerLabel: provider.label,
        ...(modelId ? { modelId } : {}),
        ...(model ? { modelLabel: model.label } : {}),
      },
    }
  },

  // ── Schedule templates (the "New schedule" starters) ──
  scheduleTemplates(): ScheduleTemplate[] {
    return SCHEDULE_TEMPLATES
  },

  // ── Entity graph (Projects / Artifacts / Schedules + the relationship graph) ──
  /** Mint one direct Project inside the authoritative boundary. The conversational
   * path keeps its proposed id because the consent card must be referentially
   * stable; the direct create form has no such pre-ack identity and therefore
   * must never derive one from a stale browser projection. */
  createProject(input: CreateProjectRequest, tenantId: string): CreateProjectResponse | undefined {
    const name = input.name.trim()
    const description = (input.description ?? '').trim()
    if (!name || name.length > 160) {
      throw new ValidationError('Project name must be between 1 and 160 characters.')
    }
    if (description.length > 10_000) {
      throw new ValidationError('Project description must be at most 10,000 characters.')
    }
    let projectId = `p-${randomUUID()}`
    while (findProject(projectId)) projectId = `p-${randomUUID()}`
    const op: RelationOp = {
      kind: 'create-project',
      projectId,
      projectName: name,
      projectDescription: description,
      ...(input.ownerTenantId ? { ownerTenantId: input.ownerTenantId } : {}),
    }
    if (this.opDeniedForTenant(op, tenantId)) return undefined
    const projected = this.applyRelationOp(op, tenantId)
    const project = projected.extraProjects.find((candidate) => candidate.id === projectId)
    if (!project) throw new ConflictError('The new Project could not be projected to its creator.')
    return { project, graph: projected }
  },
  /** Read the current representation of one keyed direct creation. The route
   * derives `id` from its authenticated tenant + logical key before accepting a
   * retry body, so this exact lookup is the durable acknowledgement boundary. */
  getArtifactCreation(id: string, tenantId: string): CreateArtifactResponse | 'invalid' | undefined {
    if (!isArtifactCreationId(id) || artifactIsRetired(id)) return 'invalid'
    if (artifactIsTrashed(id)) return 'invalid'
    const artifact = findArtifact(id)
    if (!artifact) return undefined
    if (!this.artifactOwnedBy(artifact, tenantId)) return 'invalid'
    const represented = this.listArtifacts(tenantId).find((candidate) => candidate.id === id)
    if (!represented || represented.own !== true) return 'invalid'
    return { artifact: represented, graph: projectGraphForTenant(graph, tenantId) }
  },
  /** Create one human/remote-authored Artifact under an exact keyed identity.
   * This intentionally does not enter save-artifact's provenance replay guard:
   * separate direct submissions may share a name, source, kind, and Project.
   * Row, body, filing and graph revision share one durable snapshot; the one
   * scoped artifact event refreshes all corresponding reader projections. */
  createArtifact(
    input: CreateArtifactRequest,
    tenantId: string,
    logicalId: string,
  ): CreateArtifactResponse | 'invalid' | undefined {
    if (!isArtifactCreationId(logicalId)) return 'invalid'
    if (artifactIsRetired(logicalId)) return 'invalid'
    const represented = this.getArtifactCreation(logicalId, tenantId)
    if (represented !== undefined) return represented

    const name = normalizeArtifactName(input?.name)
    if (!name) throw new ValidationError('Artifact name must be 1 to 240 characters and cannot contain control characters.')
    const authored = authoredArtifact(name, input?.kind, input?.body)
    if (!authored) throw new ValidationError(input?.kind === 'doc'
      ? 'Document body must contain text.'
      : 'Artifact body must match its kind and stay within the structured content limits.')
    if (input.projectId !== undefined && input.projectId !== null &&
      (typeof input.projectId !== 'string' || !input.projectId.trim())) {
      throw new ValidationError('projectId must be a non-empty string, null, or absent.')
    }
    const projectId = input.projectId ?? ''
    if (projectId) {
      const project = findProject(projectId)
      if (!project || !ownsGrantSubject(project, tenantId)) return undefined
    }

    const at = Date.now()
    const meta = input.kind === 'doc' ? 'Document' : input.kind === 'sheet' ? 'Sheet' : 'Slides'
    const artifact = artifactFromDraft(
      { name, kind: input.kind, meta, body: authored.draftBody, excerpt: authored.excerpt },
      logicalId,
      'Created here',
      projectId,
      at,
      undefined,
      tenantId,
    )
    artifact.excerptSource = 'body'
    graph = {
      ...graph,
      revision: (graph.revision ?? 0) + 1,
      extraArtifacts: [artifact, ...graph.extraArtifacts],
      artifactProject: projectId
        ? { ...graph.artifactProject, [logicalId]: projectId }
        : graph.artifactProject,
    }
    artifactBodies.set(logicalId, identifyDocumentBody(logicalId, { ...authored.body, revision: 0 }))
    persist()
    emit({ type: 'artifact.changed', artifactId: logicalId })
    const created = this.getArtifactCreation(logicalId, tenantId)
    if (!created || created === 'invalid') throw new ConflictError('The new Artifact could not be projected to its creator.')
    return created
  },
  /** Complete seeded + authored registry, using the graph's same viewer face.
   * Prose overlays are current; membership continues to live in relation maps. */
  listProjects(tenantId?: string): Project[] {
    const projects = [...graph.extraProjects, ...baseProjects()]
    if (!tenantId) return projects.map((p) => ({
      ...p, description: projectDescription(p, graph),
      instructions: graph.projectInstructions[p.id] ?? p.instructions,
    }))
    return projects.flatMap((p) => {
      const projected = projectForTenant(p, graph, tenantId)
      return projected ? [projected] : []
    })
  },
  /** Internal exact lookup across seeded and authored homes. Returns the live
   * object; callers must not send it verbatim cross-tenant (redact first). */
  findProject(id: string): Project | undefined {
    return findProject(id)
  },
  isProjectGuardianResource(resourceId: string): boolean {
    return !!projectForGuardianResource(resourceId)
  },
  /** Route a non-monotonic Project effect through the Project's guardian (D11,
   *  docs/agent-commons.md): a guarded Project is a shared resource, so its
   *  irreversible effects serialize at its guardian. Reserves the Project's guardian
   *  for `holder`, runs `effect` (the irreversible step) under a commit, then releases
   *  the lease. A concurrent effect by a *different* holder is refused
   *  (`GuardianError` 'conflict') — the escrow turning a second principal away up
   *  front. An unguarded Project (no `guardianId`) runs the effect directly
   *  (coordination-free). This is the *coarse* (whole-Project) lock; `guardSubGoalEffect`
   *  is the fine-grained, multi-principal form (D11). */
  guardProjectEffect<T>(projectId: string, holder: string, effect: () => T): T {
    const project = findProject(projectId) // seed + created (P8 shared Projects are guardable)
    if (!project?.guardianId) return effect()
    return guardedRun(
      project.guardianId,
      holder,
      effect,
      this.commissionOwnerTenant(holder) ?? defaultTenantId(),
    )
  },

  // ── Multi-principal coordination — sub-goal reservation (D11) ──
  /** Claim a **sub-goal** on a guarded Project for `holder` (a Contributor) — "I'm
   *  handling the auth refactor": a held, TTL'd, reversible reservation keyed
   *  `${guardianId}:${subGoal}`. Different sub-goals are distinct resources (Contributors
   *  proceed concurrently); the *same* sub-goal is capacity-1, so a second *different*
   *  holder is refused (`GuardianError` 'conflict') and re-reasons. Re-entrant for the
   *  same holder. Throws if the Project isn't guarded. */
  reserveSubGoal(projectId: string, holder: string, subGoal: string, ownerTenant?: string): Reservation {
    const project = findProject(projectId) // seed + created (P8 shared Projects are guardable)
    if (!project?.guardianId) {
      throw new GuardianError('conflict', `Project '${projectId}' is not a guarded resource`)
    }
    return guardian.reserve(subGoalKey(project.guardianId, subGoal), holder, {
      ownerTenant: ownerTenant ?? this.commissionOwnerTenant(holder) ?? defaultTenantId(),
    })
  },
  /** Release a sub-goal claim (free the lease so another Contributor may take it). */
  releaseSubGoal(reservationId: string): Reservation {
    return guardian.release(reservationId)
  },
  /** Run a non-monotonic Project effect under a **sub-goal** reservation (D11) — the
   *  fine-grained form of `guardProjectEffect`: reserve → commit → release, but keyed to
   *  one sub-goal, so two Contributors' effects on *different* sub-goals don't serialize
   *  against each other. The consent gate is the serialization gate. */
  guardSubGoalEffect<T>(projectId: string, holder: string, subGoal: string, effect: () => T): T {
    const project = findProject(projectId) // seed + created (P8 shared Projects are guardable)
    if (!project?.guardianId) return effect()
    return guardedRun(
      subGoalKey(project.guardianId, subGoal),
      holder,
      effect,
      this.commissionOwnerTenant(holder) ?? defaultTenantId(),
    )
  },
  /** Fire a Contributor's externally-effectful action on a shared Project (D11/D12) — the
   *  real path through the Guardian seam (the slice-4 "forward" effect, now wired). A
   *  monotonic effect (observe / query) runs coordination-free; a non-monotonic one
   *  (write / mutate / charge) is serialized on its sub-goal reservation, so a concurrent
   *  *different* principal on the same sub-goal is refused (`GuardianError` 'conflict').
   *  The connector/MCP reach (D12) is checked by the route before this runs. Mock
   *  fulfilment; the seam is real. */
  /** Append an entry to the detective audit trail (docs/agent-commons.md, D15/OQ7) — the
   *  server-side watch over cross-user effects. The store mints the id + stamps `at` (its
   *  own clock), so callers pass only the effect facts. Best-effort backstop, never a gate:
   *  it records, it never refuses. Persisted. */
  recordAudit(entry: Omit<AuditEntry, 'id' | 'at' | 'tenantId'> & { tenantId?: string }): void {
    // The effect's tenant — defaults to the *current backend's* resolved tenant, so the
    // write and the tenant-scoped read (GET /audit) agree on BOTH deployments: the
    // personal tenant on desktop, the web tenant on remote. (Defaulting to the personal
    // tenant unconditionally would leave the remote Audit hub permanently empty, since
    // its read scopes to the web tenant.) A later slice resolves the commission's owning
    // tenant per effect; until then this keeps the hub populated under the default principal.
    const tenantId = entry.tenantId ?? resolveIdentity(BACKEND_MODE).tenant.id
    const full: AuditEntry = { ...entry, tenantId, id: `audit-${(auditSeq += 1)}`, at: Date.now() }
    auditLog.push(full)
    emit({ type: 'audit.entry', entry: full }) // refresh a watching Audit surface
    persist()
  },
  /** The audit trail, newest first — the Audit surface's read. Scoped to `tenantId`
   *  when given (F2/F5): a tenant sees only its own trail. A pre-tenancy persisted
   *  entry (no `tenantId`) is treated as the local/personal tenant's. */
  listAuditLog(tenantId?: string): AuditEntry[] {
    const within = tenantId
      ? auditLog.filter((e) => (e.tenantId ?? LOCAL_IDENTITY.tenant.id) === tenantId)
      : auditLog
    return [...within].reverse()
  },
  /** Credit a successful **commissioned Project effect** to its Contributor's reputation
   *  (docs/agent-commons.md, D13 / OQ1) — the GitHub-style worker track record. Monotonic:
   *  it only ever increments, and only on success (a thrown guardian conflict never reaches
   *  here). Resolves the commission to its Agent; an unknown commission/Agent is a no-op
   *  (fail-quiet — reputation is a best-effort credit, never a gate). Persisted. */
  recordContribution(commissionId: string): void {
    const agentId = COMMISSIONS.get(commissionId)?.agentId
    if (!agentId) return
    const a = WORKER_AGENTS.get(agentId)
    if (!a) return
    const next = { ...a, contributions: (a.contributions ?? 0) + 1 }
    WORKER_AGENTS.set(agentId, next)
    // Reputation is independent of configuration revision, but every open Agent
    // face still needs the new monotonic count.
    emitAgentChanged(next)
    persist()
  },
  runProjectEffect(
    projectId: string,
    commissionId: string,
    subGoal: string,
    type: ProjectEffectType,
    target: string,
  ): ProjectEffectResult {
    requireAutomationFixture('project-effect')
    const monotonic = isProjectEffectMonotonic(type)
    const project = findProject(projectId) // seed + created (P8 shared Projects are guardable)
    const guarded = !monotonic && !!project?.guardianId
    const fulfil = (): ProjectEffectResult => {
      // Reach here only on a successful effect (the guarded path throws on conflict before
      // calling `fulfil`), so this is the single credit point for the D13 track record.
      this.recordContribution(commissionId)
      // Detective audit (D15/OQ7): the fulfilled Project effect on the cross-user channel. Owner-
      // pays attribution (D13) — stamped with the commission's AGENT owner (commissionOwnerTenant),
      // so a cross-tenant Contributor's effect on a shared Project lands in the agent owner's trail,
      // not the caller/backend tenant's.
      this.recordAudit({ channel: 'project-effect', commissionId, capability: type, target, outcome: 'fulfilled', tenantId: this.commissionOwnerTenant(commissionId) })
      return {
        projectId,
        commissionId,
        type,
        target,
        guarded,
        output: `${monotonic ? 'observed' : 'applied'} ${type} on '${target}'`,
      }
    }
    // Non-monotonic ⇒ serialize on the sub-goal reservation (a no-op for an unguarded
    // Project); monotonic ⇒ coordination-free (CALM).
    return monotonic ? fulfil() : this.guardSubGoalEffect(projectId, commissionId, subGoal, fulfil)
  },
  /** Agent-to-agent proxy (D15): A's Agent asks B's Agent (`toAgentId`) to act on B's private
   *  resource. **B acts under its *own* authority** — the requester's authority is never used
   *  and no credential crosses back; A receives only the result. Fulfils when B's authority
   *  admits the connector/MCP target (a `charge` needs no reach), else denies (B's side lacks
   *  the reach / declines). Mock fulfilment; the seam is real. Undefined for an unknown owner
   *  Agent (→ 404). */
  runAgentProxy(toAgentId: string, req: ProxyRequest): ProxyResult | undefined {
    requireAutomationFixture('proxy')
    const to = WORKER_AGENTS.get(toAgentId)
    if (!to) return undefined
    const reaches = req.capability.startsWith('connector.') || req.capability.startsWith('mcp.')
    const auth = to.authority ?? resolveProvider(to.providerId).authority ?? {}
    if (reaches && !authorityAdmits(auth, 'connectors', req.target)) {
      // Detective audit (D15): record the refused proxy too — a denied attempt is exactly
      // what a watcher wants to see (the actor is B, who declined under its own authority).
      this.recordAudit({ channel: 'proxy', actorAgentId: to.id, capability: req.capability, target: req.target, outcome: 'denied' })
      return { status: 'denied', actedBy: to.id, reason: `${to.label} may not reach '${req.target}'` }
    }
    this.recordAudit({ channel: 'proxy', actorAgentId: to.id, capability: req.capability, target: req.target, outcome: 'fulfilled' })
    return { status: 'fulfilled', actedBy: to.id, output: `${to.label} performed ${req.capability} on '${req.target}'` }
  },
  /** The sub-goals currently in flight on a Project — one entry per active Contributor
   *  claim (held or committed), the Coordination panel's read. Enumerates the guardian's
   *  resources under the Project's prefix; holders are resolved to their Agent label. */
  projectSubGoals(projectId: string, viewerTenant?: string): ProjectSubGoal[] {
    const project = findProject(projectId) // seed + created (P8 shared Projects are guardable)
    if (!project?.guardianId) return []
    const prefix = `${project.guardianId}:`
    const out: ProjectSubGoal[] = []
    for (const key of guardian.resourceIds()) {
      if (!key.startsWith(prefix)) continue
      const subGoal = key.slice(prefix.length)
      for (const r of guardian.status(key).active) {
        const ownerTenant = guardian.ownerTenantOf(r.id)
        out.push({
          subGoal,
          holder: r.holder,
          holderLabel: holderLabel(r.holder, ownerTenant),
          holderRole: holderRole(r.holder),
          ...(viewerTenant && guardian.ownedBy(r.id, viewerTenant) ? { canRelease: true } : {}),
          reservationId: r.id,
          status: r.status,
          at: r.at,
          expiresAt: r.expiresAt,
        })
      }
    }
    return out
  },
  // ── Discovery directories (D17) · publishing/forking (D18) · open work (D19) ──
  /** The shared-Project discovery directory (docs/agent-commons.md, D17): every Project
   *  whose owner marked it shared, from ANY tenant, redacted to public metadata plus
   *  aggregates that are themselves public acts (Contributor count, open work). Reuses
   *  the P8 sharing flag as the single visibility source — the directory never widens
   *  what sharing already exposed. `q` is a case-insensitive substring over
   *  name/description; ranking is deliberately absent (D17). */
  projectDirectory(tenantId: string, q?: string): ProjectDirectoryEntry[] {
    const needle = (q ?? '').trim().toLowerCase()
    // Only created Projects are shareable (the reducer's share-project touches
    // extraProjects only — seed Projects no-op), so the directory enumerates there.
    return graph.extraProjects
      .filter((p) => p.shared === true)
      .map((p) => ({ ...p, description: projectDescription(p, graph) }))
      .filter((p) => !needle || p.name.toLowerCase().includes(needle) || p.description.toLowerCase().includes(needle))
      .map((p) => {
        const owner = p.tenantId ?? defaultTenantId()
        return {
          id: p.id,
          name: p.name,
          description: p.description,
          owner: tenantName(owner),
          own: owner === tenantId,
          guarded: !!p.guardianId,
          contributorCount: this.activeCommissionCount(p.id),
          openWorkCount: openSubGoals.filter((o) => o.projectId === p.id && o.status === 'open').length,
          updatedAt: p.updatedAt,
        }
      })
  },
  /** The published-Agent discovery directory (D17/D18): every Agent whose owner set
   *  `published`, from ANY tenant, exposed as its DEFINITION (label / prompt / tools /
   *  instructions) + public track record. Authority / budget / provider binding are
   *  structurally absent from the entry type — a capability never travels (D18). */
  agentDirectory(tenantId: string, q?: string): AgentDirectoryEntry[] {
    const needle = (q ?? '').trim().toLowerCase()
    return [...WORKER_AGENTS.values()]
      .filter((a) => a.published === true)
      .filter((a) => !needle || a.label.toLowerCase().includes(needle) || a.instructions.toLowerCase().includes(needle))
      .map((a) => ({
        id: a.id,
        label: a.label,
        owner: tenantName(a.tenantId ?? defaultTenantId()),
        own: (a.tenantId ?? defaultTenantId()) === tenantId,
        systemPrompt: a.systemPrompt,
        tools: [...a.tools],
        instructions: a.instructions,
        contributions: a.contributions ?? 0,
        forks: a.forks ?? 0,
        version: a.version ?? 1,
        changelog: a.changelog ?? [],
      }))
  },
  // ── D25 — change proposals against a published definition (the PR analog) ──
  /** Open a proposal. The wall is the DIRECTORY's: published-only (an unpublished
   *  agent has no public face to propose against — the identical 404). Full-field,
   *  trimmed + capped; the open-queue is bounded ('capped' → 409). Only definition
   *  fields are representable (the D18 wall, structurally). Rings the owner's bell.
   *  `principal` (FWD-5 Phase 1, here and on every act mutator): the acting principal —
   *  REQUIRED but undefinable, so every caller decides attribution explicitly
   *  (`undefined` = a foreign A2A actor, attributed by `verifiedPeer`/`via` instead,
   *  or a deliberately unattributed context like the snapshot generator's seeding). */
  proposeAgentChange(
    agentId: string,
    req: ProposeAgentChangeRequest,
    tenantId: string,
    principal: PrincipalRef | undefined,
    options: { logicalId?: string } = {},
  ): AgentChangeProposal | 'capped' | 'invalid' | undefined {
    const agent = WORKER_AGENTS.get(agentId)
    if (!agent) return undefined
    if (options.logicalId) {
      if (!isAgentProposalCreationId(options.logicalId)) return 'invalid'
      const represented = (AGENT_PROPOSALS.get(agentId) ?? [])
        .find((proposal) => proposal.id === options.logicalId)
      if (represented) {
        if (represented.proposedByTenant !== tenantId) return 'invalid'
        if (agent.published !== true && !registryVisible(agent, tenantId)) return undefined
        return serveProposal(represented, agent)
      }
    }
    if (agent.published !== true) return undefined
    const f = req.fields ?? {}
    const fields: AgentChangeProposal['fields'] = {
      ...(typeof f.label === 'string' && f.label.trim() ? { label: f.label.trim().slice(0, 120) } : {}),
      ...(typeof f.systemPrompt === 'string' && f.systemPrompt.trim()
        ? { systemPrompt: f.systemPrompt.trim().slice(0, MAX_PROPOSAL_PROMPT_CHARS) }
        : {}),
      ...(typeof f.instructions === 'string' ? { instructions: f.instructions.trim().slice(0, MAX_PROPOSAL_NOTE_CHARS) } : {}),
      ...(Array.isArray(f.tools)
        ? { tools: f.tools.filter((t): t is string => typeof t === 'string' && !!t.trim()).map((t) => t.trim().slice(0, 80)).slice(0, 16) }
        : {}),
    }
    if (Object.keys(fields).length === 0) return undefined // route pre-validates; belt-and-braces
    const list = AGENT_PROPOSALS.get(agentId) ?? []
    if (list.filter((p) => p.status === 'open').length >= MAX_OPEN_PROPOSALS) return 'capped'
    const proposal: StoredAgentProposal = {
      id: options.logicalId ?? `${agentId}-p${list.length + 1}`, // keyed UI intent or legacy append-only identity
      proposedBy: tenantName(tenantId),
      proposedByTenant: tenantId,
      ...(principal ? { proposedByPrincipal: principal } : {}),
      fields,
      note: (req.note ?? '').trim().slice(0, MAX_PROPOSAL_NOTE_CHARS),
      baseVersion: agent.version ?? 1,
      at: Date.now(),
      status: 'open',
    }
    return commitMutationBatch(() => {
      list.push(proposal)
      AGENT_PROPOSALS.set(agentId, list)
      notifyTenants([agent.tenantId ?? defaultTenantId()], tenantId, {
        kind: 'proposal.opened',
        actor: proposal.proposedBy,
        agentId,
        agentLabel: agent.label,
        proposalId: proposal.id,
      })
      // The bell refreshes the inbox; THIS refreshes the review queue itself (the
      // owner's card prefetches it), so the door never opens on a stale list.
      emit({ type: 'proposal.changed', agentId, parties: [agent.tenantId ?? defaultTenantId(), tenantId] })
      persist()
      return serveProposal(proposal, agent)
    })
  },
  /** Exact creator-only durable acknowledgement for a keyed Agent proposal.
   * The proposal follows the same current read wall as its review list. */
  getAgentProposalCreation(
    agentId: string,
    proposalId: string,
    tenantId: string,
  ): AgentChangeProposal | 'invalid' | undefined {
    if (!isAgentProposalCreationId(proposalId)) return 'invalid'
    const agent = WORKER_AGENTS.get(agentId)
    if (!agent || (agent.published !== true && !registryVisible(agent, tenantId))) return undefined
    const represented = (AGENT_PROPOSALS.get(agentId) ?? [])
      .find((proposal) => proposal.id === proposalId)
    if (!represented) return undefined
    if (represented.proposedByTenant !== tenantId) return 'invalid'
    return serveProposal(represented, agent)
  },
  /** The review queue. The OWNER sees every proposal; anyone else who can see the
   *  agent sees only their OWN (a proposal is a conversation between proposer and
   *  owner, not a public feed — recorded trade-off). Undefined for an agent the
   *  caller can't see at all. */
  listAgentProposals(agentId: string, tenantId: string): AgentChangeProposal[] | undefined {
    const agent = WORKER_AGENTS.get(agentId)
    if (!agent || !(agent.published === true || registryVisible(agent, tenantId))) return undefined
    const list = AGENT_PROPOSALS.get(agentId) ?? []
    const owner = (agent.tenantId ?? defaultTenantId()) === tenantId
    return list.filter((p) => owner || p.proposedByTenant === tenantId).map((p) => serveProposal(p, agent))
  },
  /** D13 — the concrete work an Agent RESOLVED, the acts behind its contribution count
   *  (surface-audit S10: a number that is a lineage). Same existence-hiding gate as the
   *  proposal read (invisible agent ⇒ undefined ⇒ 404). The list is PUBLIC-FACE and
   *  P8-REDACTED, the load-bearing wall: an item is included ONLY if its Project is
   *  SHARED — a resolution on a PRIVATE Project is publicly invisible and must never
   *  leak here (the same `project.shared !== true` skip the profile's resolved-activity
   *  uses). Attribution is the resolving commission's Agent — so it survives the
   *  commission still existing (a deleted commission drops its items, like an
   *  unpublished changelog drops off, rather than inventing an attribution). */
  agentResolvedWork(agentId: string, tenantId: string): AgentResolvedItem[] | undefined {
    const agent = WORKER_AGENTS.get(agentId)
    if (!agent || !(agent.published === true || registryVisible(agent, tenantId))) return undefined
    const out: AgentResolvedItem[] = []
    for (const item of openSubGoals) {
      if (item.status !== 'done' || !item.resolvedBy) continue
      const project = findProject(item.projectId)
      if (!project || project.shared !== true) continue // P8 REDACTION — private resolutions never leak
      if (COMMISSIONS.get(item.resolvedBy)?.agentId !== agentId) continue
      out.push({ projectId: project.id, projectName: project.name, itemId: item.id, subGoal: item.subGoal, resolvedAt: item.resolvedAt ?? item.postedAt })
    }
    return out.sort((a, b) => b.resolvedAt - a.resolvedAt)
  },
  /** The PUBLIC forks of a published definition (D18) — the enumerable subset behind
   *  the fork counter. Same existence-hiding gate as `agentResolvedWork`. The P8 wall:
   *  a fork is listed ONLY if it is itself PUBLISHED — an unpublished fork lives in its
   *  owner's private registry and must never leak (so the count may exceed the list;
   *  the asymmetry is honest, like GitHub hiding private forks). Owner is the public
   *  display name, never a tenant id; `own` is computed viewer-relative. */
  agentPublicForks(agentId: string, tenantId: string): AgentPublicFork[] | undefined {
    const agent = WORKER_AGENTS.get(agentId)
    if (!agent || !(agent.published === true || registryVisible(agent, tenantId))) return undefined
    const out: AgentPublicFork[] = []
    for (const a of WORKER_AGENTS.values()) {
      if (a.published !== true || a.forkedFrom?.agentId !== agentId) continue // P8 — private forks never leak
      const owner = a.tenantId ?? defaultTenantId()
      out.push({
        agentId: a.id,
        label: a.label,
        owner: tenantName(owner),
        own: owner === tenantId,
        ...(a.forkedFrom.version !== undefined ? { forkedAtVersion: a.forkedFrom.version } : {}),
      })
    }
    return out.sort((a, b) => a.label.localeCompare(b.label))
  },
  /** Current containing proposal for one exact keyed comment receipt. Replay is
   * checked before lifecycle caps so an acknowledged comment remains provable
   * after its proposal resolves. Current visibility and party walls still apply. */
  getAgentProposalCommentCreation(
    agentId: string,
    proposalId: string,
    commentId: string,
    body: string,
    tenantId: string,
  ): AgentChangeProposal | 'invalid' | undefined {
    if (!isAgentProposalCommentCreationId(commentId)) return 'invalid'
    const agent = WORKER_AGENTS.get(agentId)
    if (!agent || !(agent.published === true || registryVisible(agent, tenantId))) return undefined
    const ownerTenant = agent.tenantId ?? defaultTenantId()
    const proposals = AGENT_PROPOSALS.get(agentId) ?? []
    const proposal = proposals.find((candidate) => candidate.id === proposalId)
    if (!proposal) return undefined
    if (ownerTenant !== tenantId && proposal.proposedByTenant !== tenantId) return undefined
    const comment = proposal.comments?.find((candidate) => candidate.id === commentId)
    if (!comment) {
      const collision = [...AGENT_PROPOSALS.values()].some((rows) =>
        rows.some((candidate) => candidate.comments?.some((entry) => entry.id === commentId)))
      return collision ? 'invalid' : undefined
    }
    const normalizedBody = body.trim().slice(0, WORK_ITEM_COMMENT_MAX)
    if (!normalizedBody || comment.authorTenant !== tenantId || comment.body !== normalizedBody) return 'invalid'
    return serveProposal(proposal, agent)
  },
  /** Comment on a proposal's thread (D27) — writable by exactly its TWO parties
   *  (proposer ↔ owner, raw tenant ids), while open (the verdict ends the
   *  conversation; the decline note is the last word). To anyone else the proposal
   *  does not exist (→ 404, matching the list read). Rings the OTHER party's bell. */
  commentOnAgentProposal(
    agentId: string,
    proposalId: string,
    body: string,
    tenantId: string,
    principal: PrincipalRef | undefined,
    options: { logicalId?: string } = {},
  ): AgentChangeProposal | 'closed' | 'capped' | 'invalid' | undefined {
    if (options.logicalId) {
      const represented = this.getAgentProposalCommentCreation(
        agentId,
        proposalId,
        options.logicalId,
        body,
        tenantId,
      )
      if (typeof represented === 'object') return represented
      if (represented === 'invalid') return 'invalid'
    }
    const agent = WORKER_AGENTS.get(agentId)
    if (!agent) return undefined
    const ownerTenant = agent.tenantId ?? defaultTenantId()
    // Visibility BEFORE everything, like the list and verdict siblings (review
    // finding): after an unpublish, the ex-proposer's READ 404s — so their WRITE
    // must too (write-without-read is incoherent, the 200 leaked the thread back,
    // and the still-open bell channel named an entity the walls now hide).
    if (ownerTenant !== tenantId && agent.published !== true) return undefined
    const proposal = (AGENT_PROPOSALS.get(agentId) ?? []).find((p) => p.id === proposalId)
    if (!proposal) return undefined
    const isOwner = ownerTenant === tenantId
    const isProposer = proposal.proposedByTenant === tenantId
    if (!isOwner && !isProposer) return undefined
    if (proposal.status !== 'open') return 'closed'
    const comments = (proposal.comments ??= [])
    if (comments.length >= MAX_WORK_ITEM_COMMENTS) return 'capped'
    const storedBody = body.trim().slice(0, WORK_ITEM_COMMENT_MAX)
    if (!storedBody) return 'invalid'
    const comment: StoredWorkItemComment = {
      id: options.logicalId ?? `${proposal.id}-c${comments.length + 1}`,
      author: tenantName(tenantId),
      ...(options.logicalId ? { authorTenant: tenantId } : {}),
      ...(principal ? { principal } : {}),
      body: storedBody,
      at: Date.now(),
    }
    return commitMutationBatch(() => {
      comments.push(comment)
      // No @mention fan-out: this thread is parties-only, so naming a third party
      // would leak a proposal the recipient cannot read.
      notifyTenants([isOwner ? proposal.proposedByTenant : ownerTenant], tenantId, {
        kind: 'proposal.commented',
        actor: tenantName(tenantId),
        agentId,
        agentLabel: agent.label,
        proposalId: proposal.id,
        commentId: comment.id,
      })
      emit({ type: 'proposal.changed', agentId, parties: [ownerTenant, proposal.proposedByTenant] })
      persist()
      return serveProposal(proposal, agent)
    })
  },
  /** Current containing proposal for one exact keyed owner verdict. The receipt,
   * action, normalized decline note, and raw owner must all agree; replay is
   * checked before the terminal gate and therefore survives response loss. */
  getAgentProposalVerdict(
    agentId: string,
    proposalId: string,
    verdictId: string,
    tenantId: string,
    action: 'merge' | 'decline',
    note?: string,
  ): AgentChangeProposal | 'forbidden' | 'invalid' | undefined {
    if (!isAgentProposalVerdictId(verdictId)) return 'invalid'
    const agent = WORKER_AGENTS.get(agentId)
    if (!agent) return undefined
    const ownerTenant = agent.tenantId ?? defaultTenantId()
    if (ownerTenant !== tenantId && agent.published !== true) return undefined
    const proposal = (AGENT_PROPOSALS.get(agentId) ?? []).find((candidate) => candidate.id === proposalId)
    if (!proposal) return undefined
    if (ownerTenant !== tenantId) return 'forbidden'
    if (proposal.verdictId !== verdictId) {
      const collision = [...AGENT_PROPOSALS.values()].some((rows) =>
        rows.some((candidate) => candidate.verdictId === verdictId))
      return collision ? 'invalid' : undefined
    }
    const normalizedNote = action === 'decline'
      ? (note ?? '').trim().slice(0, MAX_PROPOSAL_NOTE_CHARS)
      : ''
    const expectedStatus = action === 'merge' ? 'merged' : 'declined'
    if (
      proposal.verdictByTenant !== tenantId ||
      proposal.status !== expectedStatus ||
      (proposal.responseNote ?? '') !== normalizedNote
    ) return 'invalid'
    return serveProposal(proposal, agent)
  },
  /** The owner's verdict — merge or decline, open proposals only, owner only (raw
   *  tenant-id comparison — the D23 lesson). Merging applies the proposed fields,
   *  bumps the version, and writes the changelog line crediting the PROPOSER
   *  (authorship is provenance, deliberately not D13 reputation); either outcome
   *  rings the proposer's bell. */
  resolveAgentProposal(
    agentId: string,
    proposalId: string,
    tenantId: string,
    action: 'merge' | 'decline',
    note?: string,
    options: { logicalId?: string } = {},
  ): AgentChangeProposal | 'forbidden' | 'closed' | 'invalid' | undefined {
    if (options.logicalId) {
      const represented = this.getAgentProposalVerdict(
        agentId,
        proposalId,
        options.logicalId,
        tenantId,
        action,
        note,
      )
      if (typeof represented === 'object') return represented
      if (represented === 'forbidden' || represented === 'invalid') return represented
    }
    const agent = WORKER_AGENTS.get(agentId)
    if (!agent) return undefined
    const owner = (agent.tenantId ?? defaultTenantId()) === tenantId
    // Visibility BEFORE authorization (review finding): to a caller the agent is
    // invisible to (unpublished + foreign), a guessable proposal id must answer
    // 404 like everything else — a 403 would confirm "alive, with proposals".
    if (!owner && agent.published !== true) return undefined
    const proposal = (AGENT_PROPOSALS.get(agentId) ?? []).find((p) => p.id === proposalId)
    if (!proposal) return undefined
    if (!owner) return 'forbidden'
    if (proposal.status !== 'open') return 'closed'
    return commitMutationBatch(() => {
      proposal.resolvedAt = Date.now()
      if (options.logicalId) {
        proposal.verdictId = options.logicalId
        proposal.verdictByTenant = tenantId
      }
      if (action === 'merge') {
        const version = (agent.version ?? 1) + 1
        const next: Agent = {
          ...agent,
          ...(proposal.fields.label !== undefined ? { label: proposal.fields.label } : {}),
          ...(proposal.fields.systemPrompt !== undefined
            ? { systemPrompt: proposal.fields.systemPrompt, systemPromptId: undefined }
            : {}),
          ...(proposal.fields.instructions !== undefined ? { instructions: proposal.fields.instructions } : {}),
          ...(proposal.fields.tools !== undefined ? { tools: [...proposal.fields.tools] } : {}),
          version,
          changelog: [
            ...(agent.changelog ?? []),
            { version, author: proposal.proposedBy, note: proposal.note || 'Merged proposal', at: proposal.resolvedAt },
          ],
          revision: (agent.revision ?? 0) + 1,
        }
        WORKER_AGENTS.set(agentId, next)
        emitAgentChanged(next, true)
        proposal.status = 'merged'
      } else {
        proposal.status = 'declined'
        const trimmed = (note ?? '').trim().slice(0, MAX_PROPOSAL_NOTE_CHARS)
        if (trimmed) proposal.responseNote = trimmed
      }
      notifyTenants([proposal.proposedByTenant], tenantId, {
        kind: action === 'merge' ? 'proposal.merged' : 'proposal.declined',
        actor: tenantName(tenantId),
        agentId,
        agentLabel: WORKER_AGENTS.get(agentId)?.label ?? agent.label,
        proposalId: proposal.id,
      })
      emit({ type: 'proposal.changed', agentId, parties: [tenantId, proposal.proposedByTenant] })
      persist()
      return serveProposal(proposal, WORKER_AGENTS.get(agentId) ?? agent)
    })
  },
  /** The workspace profile — a display name's ONE public face (D21,
   *  `GET /directory/owners/:name`). A pure aggregation of rows that are ALREADY
   *  public, through the same redactions the directories use: shared Projects,
   *  published Agents, stats that are themselves public acts, and a recent-activity
   *  feed of open-work acts on SHARED Projects (an item on a private Project is not
   *  a public act). Viewer-independent except the viewer-relative `own` flags.
   *  Undefined (→ 404) for a name with no public rows: a workspace that shares
   *  nothing is invisible — the directory's existence-hiding, extended to identities. */
  /** The profile MINUS its follow face (S7). Split out because the follow face
   *  must ask, per roster name, "can the viewer see this one?" — and that
   *  question is `principalReachable`, which is this very computation. Asking it
   *  through the full `ownerProfile` would recurse: profile → follow face →
   *  reachability → profile. The cut is here, at the one place the two need to
   *  differ, so both faces still derive from ONE existence rule. */
  ownerProfileCore(name: string, tenantId: string): Omit<OwnerProfile, 'follow'> | undefined {
    const projects = this.projectDirectory(tenantId).filter((p) => p.owner === name)
    const agents = this.agentDirectory(tenantId).filter((a) => a.owner === name)
    // `posted` attributes by `postedBy` (already the display name); `resolved` by the
    // resolving commission's Agent owner (commissionOwnerTenant — the attribution
    // primitive), surfacing credit earned on OTHERS' Projects too.
    const activity: OwnerActivity[] = []
    let workPosted = 0
    let workResolved = 0
    for (const item of openSubGoals) {
      const project = findProject(item.projectId)
      if (!project || project.shared !== true) continue
      if (item.postedBy === name) {
        workPosted += 1
        activity.push({ kind: 'posted', at: item.postedAt, projectId: project.id, projectName: project.name, subGoal: item.subGoal })
      }
      if (item.status === 'done' && item.resolvedBy) {
        const resolverTenant = this.commissionOwnerTenant(item.resolvedBy)
        if (resolverTenant && tenantName(resolverTenant) === name) {
          workResolved += 1
          activity.push({
            kind: 'resolved',
            at: item.resolvedAt ?? item.postedAt,
            projectId: project.id,
            projectName: project.name,
            subGoal: item.subGoal,
            agentLabel: item.resolvedByLabel,
          })
        }
      }
    }
    // D27 — definition authorship: this name's merged proposals into ANOTHER
    // owner's published definition, read from the changelogs the directory already
    // serves (no new stored state; unpublished history drops off with the rest of
    // its public face). Provenance surfaced — deliberately not D13 reputation.
    for (const entry of this.agentDirectory(tenantId)) {
      if (entry.owner === name) continue
      for (const l of entry.changelog) {
        if (l.author !== name) continue
        // S9 — carry the OTHER owner (public display name) + the definition id so the
        // profile's authored line can be a ref link to their profile, like its siblings.
        activity.push({ kind: 'authored', at: l.at, agentLabel: entry.label, version: l.version, subGoal: l.note, owner: entry.owner, agentId: entry.id })
      }
    }
    // FWD-6 O3 — the org door: the VIEWER's seat in an org bearing this name
    // (computed, viewer-relative — the INV-9 read-side class; never stored).
    // It both unlocks the member panel client-side and keeps the page serving
    // for members when the org shares nothing public yet. Names collide, so the
    // seat resolves against org tenants only (namespaces excluded) — first hit.
    const seatOrg = [...accounts.tenants.values()].find(
      (t) => t.name === name && t.kind === 'org' && !accounts.isNamespace(t.id) && accounts.seatIn(tenantId, t.id) !== undefined,
    )
    const org = seatOrg ? { id: seatOrg.id, role: accounts.seatIn(tenantId, seatOrg.id)! } : undefined
    // S5 — a Commons publisher EXISTS: a name whose published shares/landings
    // the viewer can already see is a public identity to that viewer, even
    // with no legacy-shared projects/agents (the grant-based publish predates
    // nothing — it IS the new public face). Still viewer-walled, so the
    // existence-hiding rule holds: no visible acts, no profile.
    // `includeMuted` — see `listCommons`. Existence is not an opinion: a muted
    // workspace still exists, still has a profile, and (S7) can still be
    // followed or messaged. Only what they SAY is filtered.
    const publishes = this.listCommons(tenantId, { includeMuted: true }).some((i) => i.actor === name)
    // YOUR OWN profile always serves, however empty. Existence-hiding protects a
    // name from STRANGERS; hiding you from yourself protects nobody and breaks
    // the one page where you check who follows you (S7) — a workspace that has
    // published nothing is exactly the one that needs it. Found by the roster
    // row's own door: clicking yourself on a follower list landed on "shares
    // nothing publicly — or doesn't exist", about you. Same class as the mute
    // that erased an identity: a privacy rule aimed outward, fired inward.
    const own = tenantName(tenantId) === name
    if (!own && projects.length === 0 && agents.length === 0 && activity.length === 0 && !org && !publishes) return undefined
    activity.sort((a, b) => b.at - a.at)
    return {
      name,
      own,
      ...(org ? { org } : {}),
      projects,
      agents,
      stats: {
        sharedProjects: projects.length,
        publishedAgents: agents.length,
        contributions: agents.reduce((n, a) => n + a.contributions, 0),
        forks: agents.reduce((n, a) => n + a.forks, 0),
        openWork: projects.reduce((n, p) => n + p.openWorkCount, 0),
        workPosted,
        workResolved,
      },
      activity: activity.slice(0, 20),
    }
  },
  ownerProfile(name: string, tenantId: string): OwnerProfile | undefined {
    const core = this.ownerProfileCore(name, tenantId)
    return core ? { ...core, follow: this.ownerFollowFace(name, tenantId) } : undefined
  },
  /** S7 — the profile's follow face. The COUNTS are aggregates of public acts,
   *  like every other stat on this page. The NAMES are viewer-filtered: an
   *  unfiltered follower list would be a directory of principals the viewer
   *  could not have reached by any other door, which is exactly what
   *  existence-hiding forbids — so the count may honestly exceed the list, the
   *  posture `AgentPublicFork` already takes for forks.
   *
   *  Private, not called directly by a route: it is computed inside
   *  `ownerProfile`, which has already decided the name is visible at all. */
  ownerFollowFace(name: string, tenantId: string): OwnerFollowFace {
    const viewerName = tenantName(tenantId)
    const own = viewerName === name
    const subjectTenant = tenantIdForName(name)
    const followerTenants = [...follows.entries()].filter(([, set]) => set.has(name)).map(([t]) => t)
    const followingNames = subjectTenant !== undefined ? this.listFollows(subjectTenant) : []
    // "Can the viewer see this name" is the same reachability question the
    // profile itself answered — asked here per NAME, so one predicate decides
    // both which profiles serve and which names a roster may print.
    //
    // MEMOIZED because that predicate is expensive: `principalReachable` builds
    // a whole profile (directories, work items, changelogs, the entire Commons
    // feed) per name, and the two bands overlap heavily — mutual follows appear
    // in both. Without this, a 50+50 roster ran ~100 full profile computations
    // on one `GET /directory/owners/:name`.
    const dmWith =
      subjectTenant !== undefined && subjectTenant !== tenantId ?
        discussions.find((d) => {
          if (d.anchor.ref.kind !== 'principal') return false
          const parties = this.dmParties(d)
          return parties.includes(tenantId) && parties.includes(subjectTenant)
        })
      : undefined
    const reachable = new Map<string, boolean>()
    const visible = (n: string) => {
      if (n === viewerName) return true
      let hit = reachable.get(n)
      if (hit === undefined) {
        hit = this.principalReachable(n, tenantId)
        reachable.set(n, hit)
      }
      return hit
    }
    /** A roster band: viewer-filtered, sorted, capped — each row carrying the
     *  CALLER's relationship to that person, so the list's follow controls are
     *  the server's answer rather than a client join against `/me/follows`. */
    const roster = (names: string[]): FollowRow[] =>
      [...new Set(names)]
        .filter(visible)
        .sort()
        .slice(0, FOLLOW_ROSTER_CAP)
        .map((n) => ({
          name: n,
          ...(n === viewerName ? { own: true } : {}),
          ...(n !== viewerName && this.followsName(tenantId, n) ? { youFollow: true } : {}),
        }))
    return {
      followers: followerTenants.length,
      following: followingNames.length,
      followerList: roster(followerTenants.map(tenantName)),
      followingList: roster(followingNames),
      ...(!own && this.followsName(tenantId, name) ? { youFollow: true } : {}),
      // Reachability IS the profile serving at all: a name you can read is a
      // name you can write to. Reported rather than inferred client-side so the
      // affordance and the wall stay one decision (the SOCIAL-4b lesson).
      ...(!own && subjectTenant !== undefined ? { canMessage: true } : {}),
      // The pair's existing thread, resolved by TENANT id — the client used to
      // find it by matching display names off its own inbox.
      ...(!own && subjectTenant !== undefined && dmWith !== undefined ? { dmId: dmWith.id } : {}),
    }
  },
  /** S7 — mark a thread read up to its newest post. A private note to self like
   *  `recordView`: it rings nobody, moves no wall, and a thread the caller
   *  cannot read is silently ignored rather than refused (a refusal would make
   *  this an existence oracle). */
  discussionReadState(id: string, tenantId: string, throughPostId: string): import('../../contract/index.ts').DiscussionReadState {
    const d = discussions.find((candidate) => candidate.id === id)
    if (!d || !this.discussionReadableBy(d, tenantId)) return { throughPostId, read: true }
    const target = d.posts.find((post) => post.id === throughPostId)
    // Missing is terminal: posts cannot resurrect, and returning the same true
    // for unreadable/foreign ids keeps this recovery door from becoming an oracle.
    if (!target) return { throughPostId, read: true }
    const mark = discussionReads.get(tenantId)?.get(d.id) ?? 0
    return { throughPostId, read: mark >= (target.seq ?? 0) }
  },
  markDiscussionRead(id: string, tenantId: string, throughPostId?: string): boolean {
    const d = discussions.find((x) => x.id === id)
    if (!d || !this.discussionReadableBy(d, tenantId)) return false
    // `throughPostId` marks read up to ONE post (its moment); absent marks the
    // whole thread (INV-9: the complete-set constant). An id that isn't in this
    // thread is refused rather than silently widened to everything — marking
    // MORE read than the caller asked is the one failure that loses messages.
    let mark: number
    if (throughPostId !== undefined) {
      const p = d.posts.find((x) => x.id === throughPostId)
      if (!p) return false
      mark = p.seq ?? 0
    } else {
      mark = d.posts.reduce((m, p) => Math.max(m, p.seq ?? 0), 0)
    }
    const mine = discussionReads.get(tenantId) ?? new Map<string, number>()
    const previous = mine.get(d.id) ?? 0
    const next = Math.max(previous, mark)
    if (next === previous) return true
    // Never move the mark BACKWARD: a stale client re-sending an old post id
    // would otherwise resurrect messages the reader has already seen.
    mine.set(d.id, next)
    // Evict oldest-marked threads past the cap (the inbox's pointer-cache rule —
    // losing a mark just shows a thread unread again, never loses a message).
    if (mine.size > READ_MARKS_PER_TENANT) {
      const oldest = [...mine.entries()].sort((a, b) => a[1] - b[1]).slice(0, mine.size - READ_MARKS_PER_TENANT)
      for (const [did] of oldest) mine.delete(did)
    }
    discussionReads.set(tenantId, mine)
    emit({ type: 'discussion-reads.changed', tenantId })
    persist()
    return true
  },
  /** Global search (D22, `GET /search?q=`): typed, grouped hits across everything the
   *  caller can see. Every source below is an EXISTING per-tenant read or public
   *  redaction — search composes windows, it never opens a new one (a row absent from
   *  every page is absent from search; server/routes/search.test.ts locks the walls). Groups
   *  come in a fixed order, capped at SEARCH_GROUP_CAP with a true `total`; the
   *  private/commons split mirrors the pages' own bands (your projects vs shared-with-
   *  you; your registry vs the published directory), so nothing appears twice. */
  searchAll(tenantId: string, q?: string, page?: SearchPage): SearchResponse {
    const needle = (q ?? '').trim().toLowerCase()
    if (page?.type === 'artifactVersion' && (q ?? '').length > MAX_ARTIFACT_VERSION_SEARCH_QUERY_CHARS) {
      throw new ValidationError(`Artifact version search queries are limited to ${MAX_ARTIFACT_VERSION_SEARCH_QUERY_CHARS} characters.`)
    }
    if ((q ?? '').length > MAX_SEARCH_QUERY_CHARS) {
      throw new ValidationError(`Search queries are limited to ${MAX_SEARCH_QUERY_CHARS} characters.`)
    }
    if (!needle && !page) return { query: '', groups: [] }
    const hit = (...fields: (string | undefined)[]) => !!needle && fields.some((f) => f?.toLowerCase().includes(needle))
    const count = (n: number, noun: string) => `${n} ${noun}${n === 1 ? '' : 's'}`
    const group = (type: SearchHit['type'], label: string, hits: SearchHit[]): SearchGroup[] => {
      if (page) return type === page.type
        ? [{ type, label, total: hits.length, hits: hits.slice(page.offset, page.offset + SEARCH_PAGE_SIZE) }]
        : []
      return hits.length ? [{ type, label, total: hits.length, hits: hits.slice(0, SEARCH_GROUP_CAP) }] : []
    }

    if (page?.type === 'artifactVersion') {
      const seedArtifacts = baseArtifacts()
      const rows: Array<{ row: ArtifactItem; knownBaseArtifact?: ArtifactItem }> = [
        ...graph.extraArtifacts.map((row) => ({ row })),
        ...seedArtifacts.map((row) => ({ row, knownBaseArtifact: row })),
      ]
      const sources = rows.flatMap(({ row, knownBaseArtifact }) => {
        const artifact = projectArtifactMetadata(row, artifactMetadata.get(row.id))
        const body = retainedArtifactBody(row.id, knownBaseArtifact)
        if (!artifact || !body || !this.artifactOwnedBy(artifact, tenantId) || !historyBodyWithoutRevision(body)) return []
        return [{
          id: artifact.id,
          name: artifact.name,
          trashed: artifactIsTrashed(artifact.id),
          versions: artifactHistory.get(artifact.id) ?? [],
        }]
      })
      const historical = searchArtifactVersions(sources, q ?? '', page.offset)
      return { query: needle, page, groups: [historical] }
    }

    // 'Your projects' = seeds + created rows the caller owns; a FOREIGN shared row
    // (the Projects list's "Shared with you" band) surfaces via the directory group
    // below instead, so the two groups partition and nothing appears twice.
    const projects = this.listProjects(tenantId)
    // Org members retain their org's private read face even without owner acts;
    // foreign shared/granted rows carry no tenant stamp and form the other band.
    const ownProjects = projects.filter((p) => p.own !== false || p.tenantId !== undefined)
    const sharedProjects = projects.filter((p) => p.own === false && p.tenantId === undefined)
    const projectDir = this.projectDirectory(tenantId)
    const agentDir = this.agentDirectory(tenantId)
    const owners = [...new Set([...projectDir.map((p) => p.owner), ...agentDir.map((a) => a.owner)])]
    // Open work is findable exactly where its backlog is readable: on a project the
    // caller owns, or on any shared project (the project page's own wall).
    const openItems = openSubGoals.filter((o) => {
      const p = findProject(o.projectId)
      return o.status === 'open' && !!p && (p.shared === true || rowVisibleTo(p, tenantId))
    })

    // Search the exact current readable body, not the deliberately abbreviated
    // collection excerpt. Historical/Trash bodies keep their explicit owner-only
    // door above; names and compatibility aliases never resolve a body here.
    const artifacts = !page || page.type === 'artifact' ? this.listArtifacts(tenantId) : []
    const currentBodies = needle && artifacts.length ? this.artifactContent(tenantId) : {}
    const artifactHits = artifacts.flatMap((artifact): SearchHit[] => {
      const body = currentBodies[artifact.id]
      const bodyMatch = findArtifactBodySearchMatch(body, needle)
      const snippet = bodyMatch ? literalSearchSnippet(bodyMatch.text, needle) : undefined
      if (snippet === undefined && !hit(artifact.name, artifact.source, artifact.excerpt)) return []
      return [{
        type: 'artifact', id: artifact.id, title: artifact.name,
        subtitle: snippet ?? `${artifact.meta} · ${artifact.source}`,
        ...(bodyMatch && body ? { match: { revision: body.revision ?? 0, field: bodyMatch.field } } : {}),
      }]
    })

    // Global message search only applies to the conversation group. Avoid walking
    // every transcript at all when paging another category.
    const sessionHits: SearchHit[] = !page || page.type === 'session'
      ? SESSIONS
        .filter((s) => !s.scheduledRunOf && this.sessionVisibleToTenant(s, tenantId))
        .flatMap((s): SearchHit[] => {
          const messageMatch = needle ? firstConversationMessageMatch(s.messages ?? [], needle) : undefined
          if (messageMatch) return [{
            type: 'session', id: s.id, title: s.title, subtitle: messageMatch.snippet,
            match: { messageId: messageMatch.messageId, role: messageMatch.role },
          }]
          if (!hit(s.title, s.preview)) return []
          return [{ type: 'session', id: s.id, title: s.title, subtitle: s.preview }]
        })
      : []

    return {
      query: needle,
      ...(page ? { page } : {}),
      groups: [
        ...group('session', 'Sessions', sessionHits),
        ...group('project', 'Your projects', ownProjects
          .filter((p) => hit(p.name, p.description))
          .map((p): SearchHit => ({ type: 'project', id: p.id, title: p.name, subtitle: p.description }))),
        ...group('artifact', 'Artifacts', artifactHits),
        ...group('schedule', 'Scheduled', this.listSchedules(tenantId)
          .filter((s) => hit(s.name, s.subtitle, s.cadence))
          .map((s): SearchHit => ({ type: 'schedule', id: s.id, title: s.name, subtitle: s.subtitle }))),
        ...group('agent', 'Your agents', this.listAgents(tenantId)
          .filter((a) => hit(a.label, a.instructions))
          .map((a): SearchHit => ({ type: 'agent', id: a.id, title: a.label, subtitle: a.instructions }))),
        ...group('prompt', 'Prompts', this.listSystemPrompts(tenantId)
          .filter((p) => hit(p.label, p.body))
          .map((p): SearchHit => ({ type: 'prompt', id: p.id, title: p.label, subtitle: `Authored for ${p.targetFamily}` }))),
        ...group('model', 'Models', this.listProviders(tenantId)
          .filter((p) => hit(p.label))
          .map((p): SearchHit => ({ type: 'model', id: p.id, title: p.label, subtitle: p.kind === 'session' ? 'Delegated session provider' : 'Model endpoint' }))),
        ...group('context', 'Contexts', this.savedContexts(tenantId).contexts
          .filter((c) => hit(c.label, c.detail))
          .map((c): SearchHit => ({ type: 'context', id: c.id, title: c.label, subtitle: c.detail }))),
        ...group('owner', 'Workspaces', owners
          .filter((n) => hit(n))
          .map((n): SearchHit => ({
            type: 'owner',
            id: n,
            title: n,
            subtitle: `${count(projectDir.filter((p) => p.owner === n).length, 'shared project')} · ${count(agentDir.filter((a) => a.owner === n).length, 'published agent')}`,
          }))),
        ...group('sharedProject', 'Shared projects', sharedProjects
          .filter((p) => hit(p.name, p.description))
          .map((p): SearchHit => ({ type: 'sharedProject', id: p.id, title: p.name, subtitle: `Shared by ${p.ownerName} · ${p.description}` }))),
        ...group('publishedAgent', 'Published agents', agentDir
          .filter((a) => !a.own && hit(a.label, a.instructions))
          .map((a): SearchHit => ({ type: 'publishedAgent', id: a.id, title: a.label, subtitle: `Published by ${a.owner} · ${a.instructions}`, ref: a.owner }))),
        ...group('openWork', 'Open work', openItems
          .filter((o) => hit(o.subGoal, o.note, o.target))
          .map((o): SearchHit => ({
            type: 'openWork',
            id: o.id,
            title: o.subGoal,
            subtitle: `${findProject(o.projectId)?.name ?? ''} · needs ${o.type}`,
            ref: o.projectId,
          }))),
      ],
    }
  },
  /** Fork a published Agent's definition into the caller's tenant (D18). The copy is a
   *  new PRIVATE Agent carrying the definition (label / prompt / tools / instructions)
   *  with capability UNBOUND: authority and budget are dropped (the new owner re-grants
   *  through their own D8 funnel), the provider / prompt bindings survive only when the
   *  forker can see them (the shared seeds; a foreign private provider never crosses),
   *  and the track record resets (a fork is a recipe, not a reputation transplant).
   *  Lineage is stamped (`forkedFrom`) and the source's fork counter increments — the
   *  public credit. Undefined (→ 404, no existence leak) for an unknown id or a foreign
   *  Agent that isn't published; the caller's own Agents fork freely (duplicate). */
  forkAgent(
    sourceId: string,
    tenantId: string,
    options: { logicalId?: string; ownerUserId?: string } = {},
  ): Agent | undefined {
    if (options.logicalId) {
      const represented = this.getAgentCreation(options.logicalId, tenantId)
      if (typeof represented === 'object') return represented
      if (represented === 'invalid') throw new ValidationError('That Agent fork identity is not valid for this account.')
      if (represented === 'retired') throw new ValidationError('That Agent fork was already removed.')
    }
    const source = WORKER_AGENTS.get(sourceId)
    if (!source || !(source.published === true || registryVisible(source, tenantId))) return undefined
    const provider = source.providerId ? MODEL_PROVIDERS.get(source.providerId) : undefined
    const prompt = source.systemPromptId ? SYSTEM_PROMPT_LIB.get(source.systemPromptId) : undefined
    return commitMutationBatch(() => {
      const fork = this.createAgent(
        {
          label: source.label,
          systemPrompt: source.systemPrompt,
          systemPromptId: prompt && registryVisible(prompt, tenantId) ? prompt.id : undefined,
          tools: [...source.tools],
          instructions: source.instructions,
          providerId: provider && registryVisible(provider, tenantId) ? provider.id : undefined,
          // D25: record WHICH version was taken — the baseline a later proposal
          // (or "am I behind the source?") is measured against.
          forkedFrom: { agentId: source.id, label: source.label, version: source.version ?? 1 },
        },
        tenantId,
        options,
      )
      const creditedSource = { ...source, forks: (source.forks ?? 0) + 1 }
      WORKER_AGENTS.set(source.id, creditedSource)
      // Fork credit is activity (not a configuration revision), but it changes
      // the public directory face of a necessarily published source.
      emitAgentChanged(creditedSource, true)
      // D24: a fork is public credit — tell the definition's owner.
      notifyTenants([source.tenantId ?? defaultTenantId()], tenantId, {
        kind: 'agent.forked',
        actor: tenantName(tenantId),
        agentId: source.id,
        agentLabel: source.label,
      })
      persist()
      return fork
    })
  },
  /** Mint a private Agent from a fetched remote A2A **Agent Card** (D20,
   *  docs/a2a-integration.md) — the cross-INSTANCE sibling of `forkAgent`, with the
   *  same capability posture: the card's definition (name / description / advertised
   *  skills) becomes a definition STUB (default prompt body, no local tools — a
   *  remote skill name maps to no catalog entry), `importedFrom` stamps the lineage,
   *  and authority / budget / provider are NOT created — the importing owner binds
   *  their own through the D8 funnel. The route owns the fetch + shape validation. */
  importAgentFromCard(
    card: { name: string; description?: string; skills?: { id?: string; name?: string }[] },
    url: string,
    tenantId: string,
    options: { logicalId?: string; ownerUserId?: string } = {},
  ): Agent {
    // Untrusted remote input: trim + cap what lands in the registry. The route's
    // body cap bounds the total; these bound what the UI renders and the store
    // persists (a ~250KB "name" inside a within-cap card is still hostile).
    const name = card.name.trim().slice(0, 120)
    const skills = (Array.isArray(card.skills) ? card.skills : [])
      .map((s) => (typeof s?.name === 'string' && s.name) || (typeof s?.id === 'string' && s.id) || '')
      .filter(Boolean)
      .map((s) => s.slice(0, 80))
      .slice(0, 12)
    const description = (typeof card.description === 'string' ? card.description.trim() : '').slice(0, 2000)
    return this.createAgent(
      {
        label: name,
        systemPrompt: DEFAULT_SYSTEM_PROMPT_BODY,
        tools: [],
        instructions: [description, skills.length ? `Advertised skills (remote): ${skills.join(', ')}.` : '']
          .filter(Boolean)
          .join(' '),
        importedFrom: { url, name },
      },
      tenantId,
      options,
    )
  },
  /** A Project's open-work backlog (D19) — open items first (newest within each band).
   *  Served through the `publicOpenSubGoal` redaction (the poster's raw tenant id
   *  never crosses; the display name is the public face). */
  listOpenSubGoals(projectId: string, viewerTenant?: string): OpenSubGoal[] {
    const items = openSubGoals.filter((o) => o.projectId === projectId)
    const band = (o: OpenSubGoal) => (o.status === 'open' ? 0 : 1)
    return [...items]
      .sort((a, b) => band(a) - band(b) || b.postedAt - a.postedAt)
      .map((o) => publicOpenSubGoal(o, viewerTenant))
  },
  /** The caller's cross-cutting "Your work" dashboard (the GitHub your-issues /
   *  your-PRs analog): work items THEY posted across projects they can still see,
   *  and change proposals THEY authored against still-published definitions.
   *  Tenancy IS the filter (`postedByTenant` / `proposedByTenant` — the private
   *  authorization anchors, matched server-side and redacted on the way out, same
   *  as every other read). Visibility mirrors the entity pages': an unshared
   *  project's item and an unpublished definition's proposal drop off with the
   *  public face they rode on (never a side-channel that outlives the wall).
   *  Open items first, newest within each band. */
  myWork(tenantId: string): MyWork {
    const posted: MyWorkItem[] = []
    for (const o of openSubGoals) {
      if (o.postedByTenant !== tenantId) continue
      const project = findProject(o.projectId)
      if (!project) continue
      const owner = project.tenantId ?? defaultTenantId()
      const reads = owner === tenantId || accounts.seatIn(tenantId, owner) !== undefined
      if (!reads && project.shared !== true) continue
      posted.push({ ...publicOpenSubGoal(o), projectName: project.name })
    }
    const band = (o: OpenSubGoal) => (o.status === 'open' ? 0 : 1)
    posted.sort((a, b) => band(a) - band(b) || b.postedAt - a.postedAt)

    const proposals: MyWorkProposal[] = []
    const dir = new Map(this.agentDirectory(tenantId).map((e) => [e.id, e]))
    for (const [agentId, list] of AGENT_PROPOSALS) {
      const entry = dir.get(agentId)
      if (!entry) continue // unpublished ⇒ the public face (and the proposer's read) is gone
      for (const p of list) {
        if (p.proposedByTenant !== tenantId) continue
        proposals.push({ ...publicProposal(p), agentId, agentLabel: entry.label, agentOwner: entry.owner })
      }
    }
    const pband = (p: MyWorkProposal) => (p.status === 'open' ? 0 : 1)
    proposals.sort((a, b) => pband(a) - pband(b) || b.at - a.at)
    return { posted, proposals }
  },
  /** Exact creator/Project state for one keyed native open-work post. */
  getOpenWorkCreation(
    id: string,
    projectId: string,
    tenantId: string,
  ): OpenSubGoal | 'invalid' | undefined {
    if (!isOpenWorkCreationId(id)) return 'invalid'
    const represented = openSubGoals.find((item) => item.id === id)
    if (!represented) return undefined
    if (represented.projectId !== projectId || represented.postedByTenant !== tenantId) return 'invalid'
    return publicOpenSubGoal(represented, tenantId)
  },
  /** Post a work item onto a Project's backlog (D19) — the issues-tray act — then
   *  dispatch it to the Project's standing Contributors synchronously. Returns the item
   *  in its post-dispatch state: `done` when a standing Commission took it, `open` when
   *  none could (it stays visible in the backlog). The route validates visibility. */
  postOpenSubGoal(
    projectId: string,
    req: PostOpenSubGoalRequest,
    tenantId: string,
    principal: PrincipalRef | undefined,
    via?: 'a2a',
    verifiedPeer?: string,
    options: { logicalId?: string } = {},
  ): OpenSubGoal | 'capped' {
    if (options.logicalId) {
      const represented = this.getOpenWorkCreation(options.logicalId, projectId, tenantId)
      if (typeof represented === 'object') return represented
      if (represented === 'invalid') {
        throw new ValidationError('That open-work creation identity is not valid for this account and Project.')
      }
    }
    // The backlog is a bounded queue, not a blob store: refuse once the project
    // holds too many OPEN items (a hostile poster otherwise grows another
    // tenant's backlog + the snapshot without limit), and cap every free-text
    // field at the post funnel (the proposeAgentChange pattern).
    if (openSubGoals.filter((o) => o.projectId === projectId && o.status === 'open').length >= MAX_OPEN_WORK_PER_PROJECT) {
      return 'capped'
    }
    return commitMutationBatch(() => {
      const item: StoredOpenSubGoal = {
        id: options.logicalId ?? `work-${(openSubGoalSeq += 1)}`,
        projectId,
        subGoal: req.subGoal.trim().slice(0, OPEN_WORK_FIELD_MAX),
        type: req.type,
        target: req.target.trim().slice(0, OPEN_WORK_FIELD_MAX),
        note: (req.note ?? '').trim().slice(0, OPEN_WORK_FIELD_MAX),
        // D28: a verified peer's REGISTERED name is the attribution (never the
        // caller-supplied dev-seam headers); the stamp marks it verified.
        postedBy: verifiedPeer ?? tenantName(tenantId),
        ...(verifiedPeer ? { verifiedPeer } : {}),
        // The strict retract-authorization anchor — server-private (redacted on read).
        postedByTenant: tenantId,
        ...(principal ? { postedByPrincipal: principal } : {}),
        postedAt: Date.now(),
        status: 'open',
        // Provenance only (D20): an A2A-posted item passes the identical walls.
        ...(via ? { via } : {}),
      }
      openSubGoals.push(item)
      // The posted-notification fans out BEFORE dispatch so the two acts read in
      // order in every inbox (posted, then — when a standing taker fired — resolved).
      notifyTenants(workItemAudience(item), tenantId, {
        kind: 'work.posted',
        actor: item.postedBy,
        projectId,
        projectName: findProject(projectId)?.name ?? '',
        subGoal: item.subGoal,
        workItemId: item.id,
      })
      this.dispatchOpenSubGoal(item)
      emit({ type: 'openwork.changed', projectId })
      persist()
      return publicOpenSubGoal(item, tenantId)
    })
  },
  /** Standing dispatch (D19): offer an open item to the Project's `standing`
   *  Commissions, in role-rank order (ties first-come by id), and let the FIRST one
   *  that passes every wall take it. The walls are exactly the prompted path's — role
   *  (D14, checked here as the route does), reach (D12), and the Guardian (D11) inside
   *  `runProjectEffect`, which also credits (D13) and audits (D15). Dispatch adds a
   *  trigger, zero authority. An item nothing can take stays `open` — the seam where a
   *  real job queue would go. Synchronous and in-process by design (the trade-off D19
   *  accepts); a `GuardianError` (someone already holds the sub-goal) skips to the next
   *  candidate rather than failing the post. */
  dispatchOpenSubGoal(item: OpenSubGoal): boolean {
    // Posting and commission configuration remain real coordination operations;
    // a release cannot convert them into synthetic completion or credit.
    if (automationRuntimeMode() !== 'fixture') return false
    if (item.status !== 'open') return false
    // The legacy fixture shortcut is synchronous and tenant-standing based.
    // Keep it from completing freshly approved MCP work even when a shared
    // Dispatch/queue slot is occupied; capacity means "wait", not fixture work.
    if (item.type === 'mcp.mutate' && commissionMcpHasCurrentWorkAuthority(item)) return false
    // A durable real-work claim is never eligible for synthetic reassignment,
    // including after a failed preparation, uncertain effect, or grant renewal.
    if (commissionMcpLegacyDispatchBlocked(commissionMcpRegistry, item.projectId, item.id)) return false
    const monotonic = isProjectEffectMonotonic(item.type)
    const reaches = item.type.startsWith('connector.') || item.type.startsWith('mcp.')
    const candidates = [...COMMISSIONS.values()]
      .filter((c) => c.projectId === item.projectId && c.standing === true)
      .sort((a, b) => roleRank(b.role ?? 'writer') - roleRank(a.role ?? 'writer') || a.id.localeCompare(b.id))
    for (const c of candidates) {
      if (!this.commissionRolePermits(c.id, 'reserve')) continue
      if (!monotonic && !this.commissionRolePermits(c.id, 'fire')) continue
      if (reaches && !this.commissionCanReach(c.id, 'connectors', item.target)) continue
      try {
        this.runProjectEffect(item.projectId, c.id, item.subGoal, item.type, item.target)
      } catch (err) {
        if (err instanceof GuardianError) continue // held by someone else — next volunteer
        throw err
      }
      item.status = 'done'
      item.resolvedBy = c.id
      item.resolvedByLabel = WORKER_AGENTS.get(c.agentId)?.label ?? c.agentId
      item.resolvedAt = Date.now()
      // D24: unprompted work is exactly what a bell exists for — tell the item's
      // audience, attributed to the resolving agent's OWNER workspace (D13).
      {
        const resolverTenant = this.commissionOwnerTenant(c.id) ?? defaultTenantId()
        // FWD-5 Phase 3 — the attribution chain's owner leg, captured at act time
        // (like resolvedByLabel: the record survives a later commission delete).
        item.resolvedByOwner = tenantName(resolverTenant)
        notifyTenants(workItemAudience(item), resolverTenant, {
          kind: 'work.resolved',
          actor: tenantName(resolverTenant),
          projectId: item.projectId,
          projectName: findProject(item.projectId)?.name ?? '',
          subGoal: item.subGoal,
          workItemId: item.id,
        })
      }
      return true
    }
    return false
  },
  /** Current containing item for one keyed native comment acknowledgement. */
  getWorkItemCommentCreation(
    id: string,
    projectId: string,
    itemId: string,
    viewerTenant: string,
  ): OpenSubGoal | 'invalid' | undefined {
    if (!isWorkItemCommentCreationId(id)) return 'invalid'
    const item = openSubGoals.find((candidate) => candidate.id === itemId && candidate.projectId === projectId)
    if (!item) return undefined
    if (!item.comments?.some((comment) => comment.id === id)) {
      const collision = openSubGoals.some((candidate) => candidate.comments?.some((comment) => comment.id === id))
      return collision ? 'invalid' : undefined
    }
    return publicOpenSubGoal(item, viewerTenant)
  },
  /** Append a comment to a work item's flat discussion thread (D23): anyone who can
   *  see the Project may comment (the route enforces visibility with the same wall
   *  the backlog read uses); attribution is the display name, like `postedBy`.
   *  Append-only, trimmed + capped (per comment and per item — a bound, not a forum).
   *  Returns the updated item; `'capped'` when the thread is full; undefined for an
   *  unknown item (→ 404). */
  commentOnOpenSubGoal(
    projectId: string,
    itemId: string,
    body: string,
    tenantId: string,
    principal: PrincipalRef | undefined,
    verifiedPeer?: string,
    options: { logicalId?: string } = {},
  ): OpenSubGoal | 'capped' | undefined {
    if (options.logicalId) {
      const represented = this.getWorkItemCommentCreation(options.logicalId, projectId, itemId, tenantId)
      if (typeof represented === 'object') return represented
      if (represented === 'invalid') {
        throw new ValidationError('That comment creation identity is not valid for this work item.')
      }
    }
    const item = openSubGoals.find((o) => o.id === itemId && o.projectId === projectId)
    if (!item) return undefined
    const comments = (item.comments ??= [])
    if (comments.length >= MAX_WORK_ITEM_COMMENTS) return 'capped'
    return commitMutationBatch(() => {
      // Parse mentions from the STORED text (trimmed + sliced) so a mention past the
      // char cap — not visible in the comment — never notifies.
      const storedBody = body.trim().slice(0, WORK_ITEM_COMMENT_MAX)
      const comment: StoredWorkItemComment = {
        // Unkeyed compatibility keeps the stable append-only sequence; native UI
        // comments use the durable operation identity.
        id: options.logicalId ?? `${item.id}-c${comments.length + 1}`,
        // D28: a verified peer's registered name attributes the comment.
        author: verifiedPeer ?? tenantName(tenantId),
        ...(principal ? { principal } : {}),
        body: storedBody,
        at: Date.now(),
      }
      comments.push(comment)
      const project = findProject(projectId)
      const projectName = project?.name ?? ''
      // D29 — `@mention` fan-out, but ONLY on a shared Project: its backlog is already
      // world-visible (D17), so naming any workspace on it leaks nothing; on a private
      // Project (audience = owner alone) naming an outsider would leak its existence,
      // so mentions there resolve to no one (the D24 stale-audience wall).
      const mentioned = project?.shared === true ? resolveMentions(storedBody) : new Set<string>()
      // A mentioned party gets the more-specific `mentioned` bell, not ALSO a generic
      // `work.commented` — fan the comment audience MINUS the mention set.
      const commentAudience = new Set([...workItemAudience(item)].filter((t) => !mentioned.has(t)))
      notifyTenants(commentAudience, tenantId, {
        kind: 'work.commented',
        actor: verifiedPeer ?? tenantName(tenantId),
        projectId,
        projectName,
        subGoal: item.subGoal,
        workItemId: item.id,
        commentId: comment.id,
      })
      if (mentioned.size > 0) {
        notifyTenants(mentioned, tenantId, {
          kind: 'mentioned',
          actor: verifiedPeer ?? tenantName(tenantId),
          projectId,
          projectName,
          subGoal: item.subGoal,
          workItemId: item.id,
          commentId: comment.id,
        })
      }
      emit({ type: 'openwork.changed', projectId })
      persist()
      return publicOpenSubGoal(item, tenantId)
    })
  },
  /** Current item for one durable native retraction acknowledgement. */
  getWorkItemRetraction(
    id: string,
    projectId: string,
    itemId: string,
    tenantId: string,
  ): OpenSubGoal | 'invalid' | undefined {
    if (!isWorkItemRetractionId(id)) return 'invalid'
    const represented = openSubGoals.find((candidate) => candidate.retractionId === id)
    if (!represented) return undefined
    if (
      represented.id !== itemId ||
      represented.projectId !== projectId ||
      represented.retractedByTenant !== tenantId
    ) return 'invalid'
    return publicOpenSubGoal(represented, tenantId)
  },
  /** Retract a work item (D23) — the honest close: permitted only to the item's
   *  POSTER (raw-tenant compared) or the Project's OWNER tenant, and only while
   *  the item is still `open` — a `done` item is immutable history (the D13
   *  credit cannot be un-happened). Returns the updated item; `'forbidden'` /
   *  `'closed'` for the two refusals; undefined for an unknown item (→ 404).
   *  Also the store method behind A2A `tasks/cancel` (D20). */
  retractOpenSubGoal(
    projectId: string,
    itemId: string,
    tenantId: string,
    principal: PrincipalRef | undefined,
    options: { logicalId?: string } = {},
  ): OpenSubGoal | 'forbidden' | 'closed' | undefined {
    if (options.logicalId) {
      const represented = this.getWorkItemRetraction(options.logicalId, projectId, itemId, tenantId)
      if (typeof represented === 'object') return represented
      if (represented === 'invalid') {
        throw new ValidationError('That work-item retraction identity is not valid for this account and item.')
      }
    }
    const item = openSubGoals.find((o) => o.id === itemId && o.projectId === projectId)
    if (!item) return undefined
    // The SAME predicate the wire face reports (`canRetract`) — raw-id compared,
    // and FWD-6's org-OWNER-seat union underneath. One decision, not two that
    // happen to agree.
    if (!canRetractItem(item, tenantId)) return 'forbidden'
    if (item.status !== 'open') return 'closed'
    return commitMutationBatch(() => {
      item.status = 'retracted'
      item.retractedAt = Date.now()
      item.retractedBy = tenantName(tenantId)
      item.retractedByTenant = tenantId
      if (options.logicalId) item.retractionId = options.logicalId
      if (principal) item.retractedByPrincipal = principal
      notifyTenants(workItemAudience(item), tenantId, {
        kind: 'work.retracted',
        actor: item.retractedBy,
        projectId,
        projectName: findProject(projectId)?.name ?? '',
        subGoal: item.subGoal,
        workItemId: item.id,
      })
      emit({ type: 'openwork.changed', projectId })
      if (contributions.some((entry) => entry.projectId === projectId && entry.workItemId === itemId)) {
        emit({ type: 'contribution.changed', projectId })
      }
      persist()
      return publicOpenSubGoal(item, tenantId)
    })
  },

  // ── Social-layer grants (S1) ────────────────────────────────────────────────
  /** Resolve a social subject to its owning row — the ONE per-kind adapter
   *  (orthogonality: kinds live here, never in the grant logic). Returns the
   *  row's tenant stamp (unstamped seed rows ⇒ the default tenant, the
   *  ownership rule everywhere), or undefined when the subject doesn't exist.
   *  'discussion' is a documented refusal until S2 mints the entity. */
  grantSubjectRow(ref: SocialEntityRef): { tenantId?: string } | 'unsupported' | undefined {
    if (socialSubjectSuspended(ref)) return undefined
    switch (ref.kind) {
      case 'session':
        return SESSIONS.find((s) => s.id === ref.id)
      case 'project':
        return findProject(ref.id)
      case 'artifact':
        return findArtifact(ref.id)
      case 'schedule':
        return schedules.find((t) => t.id === ref.id)
      case 'context':
        // Contexts are tenant-owned now, but their social ref still carries only
        // kind + id while ids are intentionally reusable across tenant partitions.
        // A grant could not identify one authoritative row without smuggling an
        // owner into the public ref, so refuse the kind until its social identity
        // is designed rather than guessing across namespaces.
        return 'unsupported'
      case 'discussion': {
        // A discussion is itself grantable/anchorable (recursion, S2): its
        // owner face is the OPENER's namespace.
        const d = discussions.find((x) => x.id === ref.id)
        return d ? { tenantId: d.openerTenant } : undefined
      }
      case 'proposal': {
        // A proposal's wall IS its subject's wall (S3): readability, comment
        // authority, and grant ownership all resolve through the thing it
        // changes — a review thread is never wider than the change.
        const p = socialProposals.find((x) => x.id === ref.id)
        return p ? this.grantSubjectRow(p.subject) : undefined
      }
      case 'principal':
        // S7 — a PERSON is not a shareable row. Grants and proposals both
        // resolve authority through this adapter, so the single `'unsupported'`
        // here is what refuses "share Ada" and "offer a change to Ada" at once,
        // in the kind-level form that leaks no row's existence. Reading and
        // commenting on a principal do NOT come through here: they are
        // reachability (`principalReachable`), handled by the callers below.
        return 'unsupported'
    }
  },
  /** The ONE social read wall (existence-hiding): a subject is readable when
   *  the caller's read union owns it (unstamped seeds ⇒ the flagship rule), OR
   *  its legacy everyone-switch is on (`shared: true` — projects), OR a grant
   *  addresses them. Nonexistent and invisible answer identically. */
  grantSubjectVisible(ref: SocialEntityRef, viewerTenant: string): boolean {
    const canon = canonicalSocialRef(ref)
    if (!canon) return false
    // S7 — a PRINCIPAL has no owning row and no grants; "can you see this
    // subject" is reachability, the D21 publisher-existence rule. Note this is
    // visibility of the PERSON, not of any thread anchored to them: a DM's own
    // wall is the pair, enforced one level up in `discussionReadableBy`.
    if (canon.kind === 'principal') {
      return tenantName(viewerTenant) === canon.id || this.principalReachable(canon.id, viewerTenant)
    }
    const row = this.grantSubjectRow(canon)
    if (row === undefined || row === 'unsupported') return false
    if (row.tenantId ? tenantReadsAs(viewerTenant, row.tenantId) : seedVisibleTo(viewerTenant)) return true
    if ((row as { shared?: boolean }).shared === true) return true
    return this.grantedTier(canon, viewerTenant) !== undefined
  },
  /** Comment authority on a subject (S2): the owner always; anyone the legacy
   *  everyone-switch admits (the D23 anyone-who-sees-may-comment continuity);
   *  a granted audience at `comment` or above. `view` reads silently. */
  socialSubjectCommentable(ref: SocialEntityRef, tenantId: string): boolean {
    const canon = canonicalSocialRef(ref)
    if (!canon) return false
    // S7 — writing TO a person is reachability, not a tier: there is no owner to
    // grant `comment` and no tier that would mean anything on a human. You may
    // message someone you can already see, and nobody else. That single rule is
    // also the anti-spam floor: an unreachable name is a 404, not a refusal.
    if (canon.kind === 'principal') {
      return tenantName(tenantId) !== canon.id && this.principalReachable(canon.id, tenantId)
    }
    const row = this.grantSubjectRow(canon)
    if (row === undefined || row === 'unsupported') return false
    if (ownsGrantSubject(row, tenantId)) return true
    if ((row as { shared?: boolean }).shared === true) return true
    const held = grantedTierFor(canon, tenantId)
    return held !== undefined && tierPermits(held, 'comment')
  },

  // ── Social-layer discussions (S2) ───────────────────────────────────────────
  // ── The DM cut (S7) ─────────────────────────────────────────────────────────
  /** The two tenants a PRINCIPAL-anchored thread belongs to: its opener and the
   *  person it is addressed to. A DM's identity is this unordered pair — which
   *  is why Ada→Grace and Grace→Ada find the SAME thread — and so is its wall. */
  dmParties(d: StoredDiscussion): string[] {
    // The STORED id first — the wall is authority, and authority never keys on
    // a display name (names are not unique: `createUser` guards email, not
    // name). The name lookup is the fallback for rows written before the field
    // existed, which is exactly what those rows already relied on.
    const target = d.targetTenant ?? tenantIdForName(d.anchor.ref.id)
    return target !== undefined ? [d.openerTenant, target] : [d.openerTenant]
  },
  /** The ONE discussion read wall. For a resource anchor it is the S2
   *  inheritance rule (visibility of the thread = visibility of the subject).
   *  For a PRINCIPAL anchor it is the pair — because the anchor's own
   *  visibility is the wrong question: a person can be seen by many, while a
   *  message between two of them belongs to two.
   *
   *  Strict tenant equality, deliberately not `tenantReadsAs`: the org-seat
   *  read union exists so a member can read their org's RESOURCES, and a
   *  private message is not one. Every discussion read path goes through here,
   *  so the cut is made once rather than remembered at eleven call sites. */
  discussionReadableBy(d: StoredDiscussion, tenantId: string): boolean {
    // S8 — a POST is the third case, and it is the widest: its author anchored
    // to their own name, which is a publication, so the square reads it. (The
    // pair rule below would make a post readable by its author alone, which is
    // a diary, not a post.) `tenantId` is a signed-in principal by the time any
    // read path gets here — the auth gate is the wall in front of this one.
    if (isWallThread(d)) return true
    if (d.anchor.ref.kind === 'principal') return this.dmParties(d).includes(tenantId)
    return this.grantSubjectVisible(d.anchor.ref, tenantId)
  },
  /** Write authority on a thread — the wall's other half. For a resource it is
   *  the S2 comment tier. For a DM it is PARTY MEMBERSHIP, which is not the same
   *  as being able to open one: reachability is asymmetric (Ada publishes, so
   *  Grace can reach her; Grace may be nobody to Ada), and asking the general
   *  rule here would have let Grace start a conversation Ada could not answer.
   *  Being written to is standing to write back. */
  discussionWritableBy(d: StoredDiscussion, tenantId: string): boolean {
    // S8 — anyone who can READ a post may reply to it. That is what a square
    // is: the alternative (only the author may speak under their own post) is
    // a broadcast channel, and the layer already has moderation for the abuse
    // this admits — the author holds the delete on their own wall (see
    // `canDeletePost`), mute is the reader's earmuff, and the router's rate
    // limits bound the volume.
    if (isWallThread(d)) return this.discussionReadableBy(d, tenantId)
    if (d.anchor.ref.kind === 'principal') return this.dmParties(d).includes(tenantId)
    return this.socialSubjectCommentable(d.anchor.ref, tenantId)
  },
  /** The caller's DM inbox (S7): every principal-anchored thread they are a
   *  party to, most recently active first — the ordering a message list has by
   *  nature (a conversation's place in an inbox is when it last spoke, not when
   *  it opened). Resolved state is NOT a band here, unlike the discussions hub:
   *  a resolved DM is an archived conversation, and archiving is not this
   *  slice's job, so the order stays purely temporal. */
  listDirectMessages(tenantId: string): Discussion[] {
    const lastAt = (d: StoredDiscussion) => d.posts[d.posts.length - 1]?.at ?? d.openedAt
    return discussions
      // S8 — a WALL post is principal-anchored too, so it would ride the inbox
      // for free. It is not mail: the inbox means "talk with people", and a post
      // is talk with the square. Same one-list-each rule that keeps DMs out of
      // the discussions hub.
      .filter((d) => d.anchor.ref.kind === 'principal' && !isWallThread(d) && this.discussionReadableBy(d, tenantId))
      .sort((a, b) => lastAt(b) - lastAt(a))
      .map((d) => publicDiscussion(d, tenantId))
  },
  /** The discussions anchored to a subject, root thread first, then newest
   *  first. The route walls the anchor (existence-hiding). */
  listDiscussions(ref: SocialEntityRef, viewerTenant: string): Discussion[] {
    const rows = discussions.filter(
      (d) =>
        d.anchor.ref.kind === ref.kind &&
        d.anchor.ref.id === ref.id &&
        // S8 — on a PRINCIPAL this list means "what has this person posted".
        // Their DMs are anchored to the same name and would otherwise ride it;
        // those belong to the inbox (one list each, the rail rule).
        (ref.kind !== 'principal' || isWallThread(d)) &&
        this.discussionReadableBy(d, viewerTenant),
    )
    const band = (d: StoredDiscussion) => (d.anchor.locus === undefined ? 0 : 1)
    return [...rows].sort((a, b) => band(a) - band(b) || b.openedAt - a.openedAt).map((d) => publicDiscussion(d, viewerTenant))
  },
  /** Open a discussion. The anchor must be READABLE (else the existence-hiding
   *  404) and the opener COMMENTABLE (a view-tier audience reads silently). An
   *  open onto a POSITION that already carries a thread is get-or-create: the
   *  first post appends to the existing thread instead — one public stream per
   *  (subject, locus). Locus-free is the subject's root (the original
   *  root-thread rule); SOCIAL-6b generalizes the same rule to every locus so a
   *  gutter affordance can't fork a second thread on the turn it points at. */
  openDiscussion(
    req: OpenDiscussionRequest,
    tenantId: string,
    logicalPostId?: string,
  ): Discussion | 'forbidden' | 'capped' | undefined {
    if (logicalPostId) {
      const represented = discussionForLogicalPost(logicalPostId, tenantId)
      if (represented) {
        return this.discussionReadableBy(represented, tenantId)
          ? publicDiscussion(represented, tenantId)
          : undefined
      }
    }
    // New Artifact block discussions are keyed by stable body identity, never
    // by a position that can move after insertion or reorder. Numeric callers
    // are accepted only as a current index and canonicalized before lookup;
    // old persisted numeric loci remain distinct and therefore unavailable.
    if (req.anchor.locus?.kind === 'artifact-block' && req.anchor.ref.kind !== 'artifact') return undefined
    if (req.anchor.ref.kind === 'artifact' && req.anchor.locus?.kind === 'artifact-block') {
      const locus = req.anchor.locus
      if (!this.grantSubjectVisible(req.anchor.ref, tenantId)) return undefined
      if (!this.socialSubjectCommentable(req.anchor.ref, tenantId)) return 'forbidden'
      const artifact = findArtifact(req.anchor.ref.id)
      if (!artifact || (artifact.kind !== 'doc' && artifact.kind !== 'email')) return undefined
      const body = artifactBodyOf(req.anchor.ref.id)
      if (!body || body.type !== 'doc') return undefined
      const blockIndex = 'block' in locus
        ? locus.block
        : body.blocks.findIndex((block) => block.id === locus.blockId)
      if (!Number.isInteger(blockIndex) || blockIndex < 0 || blockIndex >= body.blocks.length) return undefined
      const blockId = body.blocks[blockIndex]?.id
      if (!blockId) return undefined
      req = {
        ...req,
        anchor: { ...req.anchor, locus: { kind: 'artifact-block', blockId } },
      }
    }
    // Get-or-create, resolved FIRST for a principal. For a RESOURCE the key is
    // (subject, locus) — one public stream per position. For a PRINCIPAL there
    // is no public stream to be one of, so the key is the unordered PAIR:
    // whichever end opens it, and however many times, Ada↔Grace is one
    // conversation. That specialization is what makes the DM inbox fall out of
    // the existing primitive for free.
    //
    // The ordering matters. Reachability (below) is ASYMMETRIC — Ada is a public
    // identity to Grace because Ada publishes, while Grace may be nobody to Ada
    // — so gating the whole call on it would let Grace open a thread that Ada
    // could never answer. A message you have received is a message you may
    // reply to; that is the rule, and it holds because an existing pair thread
    // short-circuits to the append path, whose authority is party membership.
    const dmTarget = req.anchor.ref.kind === 'principal' ? tenantIdForName(req.anchor.ref.id) : undefined
    // A name with no tenant behind it has no stream to deliver to, so a thread
    // on it would be a one-party room: refuse it as the same 404 rather than
    // store a conversation that can never have a second voice (INV-9's rule —
    // refuse, don't persist something inert).
    if (req.anchor.ref.kind === 'principal' && dmTarget === undefined) return undefined
    // ── S8: anchoring to YOURSELF is a POST ─────────────────────────────────
    // S7 refused this outright, for a real reason: get-or-create had been moved
    // ahead of the authority checks, which made the pair predicate
    // `parties.includes(me) && parties.includes(me)` — trivially true of every
    // conversation you are in — so a self-addressed note appended to whichever
    // thread matched first. The guard was right; the refusal was a placeholder.
    //
    // A self-anchored thread now means an utterance on your own wall, and it
    // takes the OPPOSITE identity rule from a DM: a message is get-or-CREATE
    // (one conversation per pair, forever), while a post is always NEW. Two
    // things you say are two posts, not one conversation with itself — which is
    // also what keeps the old bug dead, since a post never looks a thread up.
    const isPost = dmTarget !== undefined && dmTarget === tenantId
    if (isPost) return this.openWallPost(req.firstPost, tenantId, logicalPostId)
    const held =
      dmTarget !== undefined ?
        discussions.find((d) => {
          if (d.anchor.ref.kind !== 'principal') return false
          const parties = this.dmParties(d)
          return parties.includes(tenantId) && parties.includes(dmTarget)
        })
      : discussions.find(
          (d) =>
            d.anchor.ref.kind === req.anchor.ref.kind &&
            d.anchor.ref.id === req.anchor.ref.id &&
            sameLocus(d.anchor.locus, req.anchor.locus),
        )
    if (held) {
      const out = this.postToDiscussion(held.id, req.firstPost, tenantId, undefined, logicalPostId)
      // An OPEN never answers a post — it passes no `replyTo` — so the S9
      // reply-parent refusal is unreachable here. Narrowed rather than widening
      // this function's own contract with a case none of its callers can hit.
      return out === 'no-parent' ? undefined : out
    }
    if (!this.grantSubjectVisible(req.anchor.ref, tenantId)) return undefined
    if (!this.socialSubjectCommentable(req.anchor.ref, tenantId)) return 'forbidden'
    // The per-subject cap bounds how many threads may hang on ONE resource. It
    // does not apply to a principal: a DM's identity is the PAIR, so every
    // sender legitimately gets their own thread on the same anchor, and counting
    // them together would cap a popular person at 100 correspondents for life —
    // the 101st stranger permanently unable to write to them. Get-or-create
    // already bounds a pair to exactly one thread, which is the real limit here.
    if (dmTarget === undefined) {
      const anchored = discussions.filter((d) => d.anchor.ref.kind === req.anchor.ref.kind && d.anchor.ref.id === req.anchor.ref.id)
      if (anchored.length >= MAX_DISCUSSIONS_PER_SUBJECT) return 'capped'
    }
    const now = Date.now()
    const d: StoredDiscussion = {
      id: `disc-${(discussionSeq += 1)}`,
      anchor: { ref: { kind: req.anchor.ref.kind, id: req.anchor.ref.id }, ...(req.anchor.locus ? { locus: req.anchor.locus } : {}) },
      state: 'open',
      stateRevision: 0,
      openedBy: tenantName(tenantId),
      openedAt: now,
      openerTenant: tenantId,
      // S7 — capture the addressee's raw id NOW (see `StoredDiscussion`): the
      // anchor's display name is a public face, not an identity.
      ...(dmTarget !== undefined ? { targetTenant: dmTarget } : {}),
      posts: [mintPost(req.firstPost, tenantId, now, undefined, logicalPostId)],
    }
    discussions.push(d)
    // The FIRST post rings too — it is the moment someone starts talking about
    // your thing, which is exactly when you want to know. (The append path rings
    // from postToDiscussion; a new thread has no other participants yet, so the
    // audience is just the anchor's owner.)
    notifyTenants(this.discussionAudience(d), tenantId, {
      ...discussionBell(d, tenantId, this.commonsSubjectFace(d.anchor.ref).name),
      postId: d.posts[0].id,
    })
    emit({ type: 'discussion.changed', discussionId: d.id, anchor: d.anchor })
    persist()
    return publicDiscussion(d, tenantId)
  },
  /** ── S8: mint one POST on the caller's own wall ────────────────────────────
   *  A Discussion anchored to the author's own principal. Everything a post
   *  needs already exists on that object — replies, reactions, retract/report,
   *  the `/discussions/:did` permalink, the hand-it-to-Claude hook — so this
   *  function is deliberately thin: the feature is the ANCHOR, not new
   *  machinery.
   *
   *  It rings NOBODY by itself. A followee's utterance reaches their followers'
   *  Commons lens and never their bell — the same cut `social.followed` argues
   *  and `watch` already makes: a bell means you are involved, and access isn't
   *  involvement. The one exception is being NAMED, which is being addressed.
   *
   *  No per-anchor cap: `MAX_DISCUSSIONS_PER_SUBJECT` counts threads on one
   *  anchor, and applying it here would cap a person at 100 posts for life —
   *  the same lifetime-cap trap S7 had to step around for correspondents. The
   *  real bound on utterance volume is the router's rate limit. */
  openWallPost(body: string, tenantId: string, logicalPostId?: string): Discussion | 'capped' | undefined {
    if (logicalPostId) {
      const represented = discussionForLogicalPost(logicalPostId, tenantId)
      if (represented) {
        return this.discussionReadableBy(represented, tenantId)
          ? publicDiscussion(represented, tenantId)
          : undefined
      }
    }
    const text = body.trim()
    if (!text) return undefined
    const mine = discussions.filter((d) => isWallThread(d) && d.openerTenant === tenantId)
    if (mine.length >= MAX_POSTS_PER_AUTHOR) return 'capped'
    const now = Date.now()
    const post = mintPost(text, tenantId, now, undefined, logicalPostId)
    const d: StoredDiscussion = {
      id: `disc-${(discussionSeq += 1)}`,
      anchor: { ref: { kind: 'principal', id: tenantName(tenantId) } },
      state: 'open',
      stateRevision: 0,
      openedBy: tenantName(tenantId),
      openedAt: now,
      openerTenant: tenantId,
      // The wall predicate reads the STORED id, so a post is self-anchored by
      // identity and not by a name that a later same-named signup could shift.
      targetTenant: tenantId,
      posts: [post],
    }
    discussions.push(d)
    this.ringMentions(d, post, tenantId)
    emit({ type: 'discussion.changed', discussionId: d.id, anchor: d.anchor })
    persist()
    return publicDiscussion(d, tenantId)
  },
  /** Ring everyone a post NAMES (S8). Being mentioned is being addressed, so it
   *  rings even though the post itself rings nobody. Resolution reuses the ONE
   *  mention resolver the work-item comments already use — its word-boundary
   *  rules, longest-match and recipient cap were earned by review, and a second
   *  parser would drift from them.
   *
   *  Only people who can READ the thread are rung: a mention must never become
   *  a way to make a private thread's existence (or its words) known. */
  ringMentions(d: StoredDiscussion, post: StoredDiscussionPost, tenantId: string): void {
    const mentioned = [...resolveMentions(post.body)].filter(
      (t) => !tenantWritesAs(tenantId, t) && this.discussionReadableBy(d, t),
    )
    if (mentioned.length === 0) return
    notifyTenants(mentioned, tenantId, {
      kind: 'social.mentioned',
      actor: tenantName(tenantId),
      discussionId: d.id,
      postId: post.id,
    })
  },
  /** The caller's discussions hub read (S2): threads they PARTICIPATE in
   *  (opened, posted, or reacted) whose anchor they can still read — losing
   *  the grant loses the thread (inheritance holds everywhere). Open first,
   *  then most recently active.
   *
   *  DMs are EXCLUDED (S7). They are discussions by construction, so they would
   *  ride this list for free — but they have their own place (`Messages`), and
   *  the same rows in two rail sections is the duplication the rail rules
   *  forbid. The hub means "talk about things"; the inbox means "talk with
   *  people". One list each. */
  listMyDiscussions(tenantId: string): Discussion[] {
    const participates = (d: StoredDiscussion) =>
      tenantReadsAs(tenantId, d.openerTenant) ||
      d.posts.some((p) => tenantReadsAs(tenantId, p.authorTenant) || p.reactedBy.some((t) => tenantReadsAs(tenantId, t)))
    const lastAt = (d: StoredDiscussion) => d.posts[d.posts.length - 1]?.at ?? d.openedAt
    return discussions
      // Principal-anchored threads are excluded whichever kind they are: a DM
      // belongs to the inbox and a POST to the square, and the same row in two
      // rail sections is the duplication the rail rules forbid.
      .filter((d) => d.anchor.ref.kind !== 'principal' && participates(d) && this.discussionReadableBy(d, tenantId))
      .sort((a, b) => (a.state === b.state ? lastAt(b) - lastAt(a) : a.state === 'open' ? -1 : 1))
      .map((d) => publicDiscussion(d, tenantId))
  },
  /** One discussion by id — readable through its ANCHOR's wall (inheritance:
   *  a discussion is never wider than what it discusses). */
  getDiscussion(id: string, viewerTenant: string): Discussion | undefined {
    const d = discussions.find((x) => x.id === id)
    if (!d || !this.discussionReadableBy(d, viewerTenant)) return undefined
    return publicDiscussion(d, viewerTenant)
  },
  /** Append a post — commentable callers only; allowed after resolve too (the
   *  CW7 aftermath rule: a resolved thread's story keeps accruing). */
  postToDiscussion(
    id: string,
    body: string,
    tenantId: string,
    replyTo?: string,
    logicalPostId?: string,
  ): Discussion | 'forbidden' | 'capped' | 'no-parent' | undefined {
    if (logicalPostId) {
      const represented = discussionForLogicalPost(logicalPostId, tenantId)
      if (represented) {
        return this.discussionReadableBy(represented, tenantId)
          ? publicDiscussion(represented, tenantId)
          : undefined
      }
    }
    const d = discussions.find((x) => x.id === id)
    if (!d || !this.discussionReadableBy(d, tenantId)) return undefined
    if (!this.discussionWritableBy(d, tenantId)) return 'forbidden'
    if (d.posts.length >= MAX_DISCUSSION_POSTS) return 'capped'
    // S9 — resolve the answered post before anything lands, so a bad parent
    // refuses the whole write instead of leaving a detached reply.
    const parent = resolveReplyTarget(d, replyTo)
    if (parent === 'unknown') return 'no-parent'
    // The interested parties, read BEFORE the post lands so the new author isn't
    // counted as a prior participant (notifyTenants drops the actor anyway, but
    // the set should mean what it says).
    const audience = this.discussionAudience(d)
    const post = mintPost(body, tenantId, Date.now(), parent, logicalPostId)
    d.posts.push(post)
    // S9 — a REPLY rings the person it answers, and that row REPLACES the
    // generic one for them: being answered is why they care, and two bells for
    // one post is the noise the mention rule already refuses. Everyone else in
    // the thread still hears the ordinary "someone posted" row.
    const answered = parent !== undefined ? d.posts.find((p) => p.id === parent)?.authorTenant : undefined
    if (answered !== undefined && answered !== tenantId) {
      notifyTenants([answered], tenantId, {
        kind: 'social.replied',
        actor: tenantName(tenantId),
        actorTenant: tenantId,
        discussionId: d.id,
        postId: post.id,
      })
    }
    // Someone is talking about your thing / replied where you're talking. The
    // one social act whose subject nobody would otherwise be told about.
    notifyTenants(
      audience.filter((t) => t !== answered),
      tenantId,
      {
        ...discussionBell(d, tenantId, this.commonsSubjectFace(d.anchor.ref).name),
        postId: post.id,
      },
    )
    // S8 — and anyone this post NAMES, wherever it was written: a mention is
    // addressed at a person, so it reaches them even when they are neither the
    // anchor's owner nor already in the thread.
    this.ringMentions(d, post, tenantId)
    emit({ type: 'discussion.changed', discussionId: d.id, anchor: d.anchor })
    persist()
    return publicDiscussion(d, tenantId)
  },
  /** Who a thread's activity concerns: the ANCHOR OWNER (it is their resource
   *  being discussed) plus everyone already IN the thread (they are in the
   *  conversation). Deliberately not "everyone who can read the anchor" — a
   *  widely-shared project would turn every comment into a broadcast; the D24
   *  rule is that a bell means *you* are involved, and merely having access
   *  isn't involvement. Watchers get the feed, not the bell.
   *
   *  Filtered by CURRENT visibility, not past participation: a participant whose
   *  grant was revoked must stop being rung — the row carries the subject's
   *  display name and would door into a 404, so a stale bell both leaks that the
   *  thing is still being talked about and dead-ends. (The same rule the work
   *  layer earned: "un-sharing silences the stale audience".) */
  discussionAudience(d: StoredDiscussion): string[] {
    // S8 — a POST's interested parties are its AUTHOR plus whoever has already
    // spoken under it, exactly like a resource thread's owner + participants.
    // Deliberately NOT everyone who can read it: the whole square can, and
    // ringing them would turn one reply into a broadcast (D24 — a bell means
    // you are involved, and access isn't involvement).
    if (isWallThread(d)) {
      return [...new Set([d.openerTenant, ...d.posts.map((p) => p.authorTenant)])]
    }
    // S7 — a DM has no anchor OWNER row; its "interested parties" ARE the pair,
    // which is also its wall, so the general rule below would find nobody. The
    // pair is the right answer for the same reason it is the right wall.
    if (d.anchor.ref.kind === 'principal') return this.dmParties(d)
    const row = this.grantSubjectRow(d.anchor.ref)
    const owner = row !== undefined && row !== 'unsupported' ? (row.tenantId ?? defaultTenantId()) : undefined
    const parties = new Set([...(owner ? [owner] : []), ...d.posts.map((p) => p.authorTenant)])
    return [...parties].filter((t) => this.discussionReadableBy(d, t))
  },
  /** Set the caller's one thin reaction on a post — any READER may endorse.
   *  Omission retains the legacy toggle; explicit first-party state makes a
   *  retry idempotent instead of reversing the requested result. */
  setDiscussionReaction(
    id: string,
    postId: string,
    tenantId: string,
    reacted?: boolean,
  ): Discussion | undefined {
    const d = discussions.find((x) => x.id === id)
    if (!d || !this.discussionReadableBy(d, tenantId)) return undefined
    const p = d.posts.find((x) => x.id === postId)
    if (!p) return undefined
    const i = p.reactedBy.indexOf(tenantId)
    const desired = reacted ?? i < 0
    if ((i >= 0) === desired) return publicDiscussion(d, tenantId)
    if (desired) p.reactedBy.push(tenantId)
    else p.reactedBy.splice(i, 1)
    emit({ type: 'discussion.changed', discussionId: d.id, anchor: d.anchor })
    persist()
    return publicDiscussion(d, tenantId)
  },
  /** Delete a post (S5 guardrails): the AUTHOR retracts their own words, or
   *  the ANCHOR OWNER moderates their surface — nobody else. Non-parties get
   *  the existence-hiding 404. Deleting the LAST post removes the thread (an
   *  empty discussion is noise, the openDiscussion rule in reverse). */
  deleteDiscussionPost(
    did: string,
    pid: string,
    tenantId: string,
    /** Take the whole BRANCH — the post and every answer under it — instead of
     *  promoting its children (owner directive 2026-08-11). INV-9: absent means
     *  the fixed, minimal-risk answer, which is the narrow delete. A cascade
     *  that happened by default would be the single most destructive act in the
     *  product reached by the most ordinary click. */
    cascade = false,
    /** Complete post-id set reviewed by the caller. Omission is the legacy
     * unconditional meaning; a supplied set is an exact branch precondition. */
    expectedPostIds?: readonly string[],
  ): Discussion | null | 'conflict' | 'forbidden' | undefined {
    const d = discussions.find((x) => x.id === did)
    if (!d || !this.discussionReadableBy(d, tenantId)) return undefined
    const i = d.posts.findIndex((x) => x.id === pid)
    if (i < 0) return undefined
    // What is going: the post, plus its descendants when cascading.
    const doomed = new Set<string>([pid])
    if (cascade) for (const id of postDescendants(d, pid)) doomed.add(id)
    // The SAME predicate the wire face reports (`post.canDelete`) — asked of
    // EVERY post that would go, not just the one that was clicked.
    //
    // This is what keeps cascade from becoming a way to silence a critic. S9's
    // promote-on-retract rule exists because "the author of a parent does not
    // get to retract somebody else's words"; a cascade that skipped the check
    // would hand that exact power back through a checkbox. So an ANCHOR OWNER
    // (who may delete anything on their own surface) can take a whole branch,
    // and a mere author can only take a branch that is entirely their own.
    // All-or-nothing: a partial cascade would delete some of the words and
    // report success, leaving the reader to work out which.
    for (const p of d.posts) {
      if (doomed.has(p.id) && !canDeletePost(d, p.authorTenant, tenantId)) return 'forbidden'
    }
    // Compare only after authority so a stale or malicious set cannot probe
    // hidden branch membership. Newly arrived descendants are not covered by
    // the earlier confirmation and must never be swept into it.
    if (
      expectedPostIds !== undefined &&
      (expectedPostIds.length !== doomed.size || expectedPostIds.some((id) => !doomed.has(id)))
    ) return 'conflict'
    for (let k = d.posts.length - 1; k >= 0; k -= 1) if (doomed.has(d.posts[k].id)) d.posts.splice(k, 1)
    // S9 — a retracted post must not strand the replies that answered it. They
    // are promoted to top level rather than deleted with it: they are somebody
    // ELSE's words, and the author of a parent does not get to retract them by
    // retracting their own. An orphan would be worse than either — a reply
    // pointing at nothing renders as a top-level post anyway, but only by
    // accident, and any surface that grouped strictly would drop it from view.
    //
    // Deliberately NOT grafted onto the retracted post's own parent, now that
    // chains run deep (2026-08-11) and the graft would be expressible. Grafting
    // asserts an edge nobody wrote — "C answers A" when C answered B — which is
    // the same misattribution the write path stopped making when the depth cap
    // came out; fixing it on one path and committing it on the other would be
    // incoherent. It costs less than it looks: only DIRECT children promote,
    // and each carries its own subtree with it (their descendants still name
    // them), so exactly one edge is cut, not a branch flattened.
    //
    // Under a CASCADE this loop finds nothing — a tree has no edge from outside
    // a subtree into it — and that is exactly why it is left general rather
    // than branched on `cascade`: the promotion rule is about what survives,
    // and asking "does anything still point at something that went?" is the
    // honest form of it either way.
    for (const p of d.posts) if (p.replyTo !== undefined && doomed.has(p.replyTo)) delete p.replyTo
    const dissolved = d.posts.length === 0
    if (dissolved) discussions.splice(discussions.indexOf(d), 1)
    // A bell is a POINTER at an act — so retracting the act retracts the bell.
    // Without this, a deleted post went on announcing itself: the inbox claimed
    // a reply that no longer existed, and its door landed in a thread where the
    // reader could not find one (owner-reported 2026-08-09). Dissolving the
    // thread takes every remaining row with it — their door is gone too, and a
    // bell that cannot be opened is worse than no bell.
    retractNotifications((n) => (dissolved ? n.discussionId === did : n.postId !== undefined && doomed.has(n.postId)))
    emit({ type: 'discussion.changed', discussionId: d.id, anchor: d.anchor })
    persist()
    return dissolved ? null : publicDiscussion(d, tenantId)
  },
  /** Report a post (S5): rings the ANCHOR OWNER — the moderator who holds the
   *  delete. Owner moderation first; instance-level escalation is S6. */
  reportDiscussionPost(did: string, pid: string, tenantId: string): Discussion | undefined {
    const d = discussions.find((x) => x.id === did)
    if (!d || !this.discussionReadableBy(d, tenantId)) return undefined
    const post = d.posts.find((x) => x.id === pid)
    if (!post) return undefined
    const row = this.grantSubjectRow(d.anchor.ref)
    if (row === undefined || row === 'unsupported') return undefined
    post.reportedBy ??= []
    if (post.reportedBy.includes(tenantId)) return publicDiscussion(d, tenantId)
    post.reportedBy.push(tenantId)
    notifyTenants([row.tenantId ?? defaultTenantId()], tenantId, {
      kind: 'social.reported',
      actor: tenantName(tenantId),
      subjectKind: d.anchor.ref.kind,
      subjectId: d.anchor.ref.id,
      subjectName: this.commonsSubjectFace(d.anchor.ref).name,
      discussionId: d.id,
      postId: post.id,
    })
    persist()
    return publicDiscussion(d, tenantId)
  },
  /** The caller's mute list (S5): actor DISPLAY NAMES filtered from their own
   *  feed and bells — a per-viewer earmuff, never a wall (the muted party's
   *  access is untouched; names are the D21 public handle, matching profiles). */
  listMutes(tenantId: string): string[] {
    return [...(mutes.get(tenantId) ?? [])].sort()
  },
  setMute(name: string, muted: boolean, tenantId: string): string[] {
    const set = mutes.get(tenantId) ?? new Set<string>()
    if (muted) set.add(name)
    else set.delete(name)
    if (set.size > 0) mutes.set(tenantId, set)
    else mutes.delete(tenantId)
    persist()
    return this.listMutes(tenantId)
  },

  // ── Follow (S7) — mute's positive twin ──────────────────────────────────────
  /** The caller's follow list: followee DISPLAY NAMES, sorted. Their own list,
   *  so tenancy IS the filter and there is no parameter. */
  listFollows(tenantId: string): string[] {
    return [...(follows.get(tenantId) ?? [])].sort()
  },
  followsName(tenantId: string, name: string): boolean {
    return follows.get(tenantId)?.has(name) === true
  },
  /** May the caller SEE this name at all? The D21 publisher-existence rule,
   *  extracted so follow, DM-reachability and the profile route share ONE
   *  answer: a name whose profile serves is a name you can follow and write to.
   *  Anything else — an invisible workspace, a nonexistent one — is identically
   *  404, which is the whole point (a reachability probe must not be an
   *  existence oracle). */
  principalReachable(name: string, tenantId: string): boolean {
    return this.ownerProfileCore(name, tenantId) !== undefined
  },
  /** Follow / unfollow. `'self'` refuses following yourself (a self-follow makes
   *  every count a lie and the Following lens a mirror); undefined is the
   *  existence-hiding 404 for a name the caller cannot see. Following CLEARS a
   *  mute on the same name: the two are exclusive statements about one person,
   *  and the newer, more explicit one wins (an unfollow does NOT re-mute —
   *  restoring an earmuff nobody asked for would be the same defect inverted). */
  setFollow(name: string, following: boolean, tenantId: string): string[] | 'self' | undefined {
    if (tenantName(tenantId) === name) return 'self'
    if (!this.principalReachable(name, tenantId)) return undefined
    const set = follows.get(tenantId) ?? new Set<string>()
    const wasFollowing = set.has(name)
    const muted = mutes.get(tenantId)
    const clearsMute = following && muted?.has(name) === true
    if (wasFollowing === following && !clearsMute) return this.listFollows(tenantId)
    if (following) set.add(name)
    else set.delete(name)
    if (set.size > 0) follows.set(tenantId, set)
    else follows.delete(tenantId)
    if (following) {
      if (muted?.delete(name) && muted.size === 0) mutes.delete(tenantId)
    }
    const target = tenantIdForName(name)
    // A follow rings the followee — the one bell it mints, because somebody
    // acted ON them. Their publishes reach the follower's LENS, never a bell.
    if (!wasFollowing && following && target !== undefined) {
      notifyTenants([target], tenantId, { kind: 'social.followed', actor: tenantName(tenantId) })
    }
    emit({ type: 'follow.changed', parties: target !== undefined ? [tenantId, target] : [tenantId] })
    persist()
    return this.listFollows(tenantId)
  },

  /** Resolve / reopen — the opener's or the anchor owner's act (the two
   *  parties with standing; a visitor's thread isn't closable by a bystander). */
  setDiscussionState(
    id: string,
    state: 'open' | 'resolved',
    tenantId: string,
    expectedStateRevision?: number,
  ): Discussion | 'conflict' | 'forbidden' | undefined {
    const d = discussions.find((x) => x.id === id)
    if (!d || !this.discussionReadableBy(d, tenantId)) return undefined
    // The SAME predicate the wire face reports (`canResolve`), so the control
    // the UI shows and the act the server allows are one decision.
    if (!canResolveDiscussion(d, tenantId)) return 'forbidden'
    // Explicit desired state is its own durable replay proof. A stale command
    // may converge when somebody already reached that state, but it may not
    // overwrite an intervening opposite transition (including an ABA cycle).
    if (d.state === state) return publicDiscussion(d, tenantId)
    if (expectedStateRevision !== undefined && (d.stateRevision ?? 0) !== expectedStateRevision) return 'conflict'
    d.state = state
    d.stateRevision = (d.stateRevision ?? 0) + 1
    emit({ type: 'discussion.changed', discussionId: d.id, anchor: d.anchor })
    persist()
    return publicDiscussion(d, tenantId)
  },
  /** The grants on a subject, viewer-relative: the subject's OWNER sees the
   *  full list; anyone else sees only the rows addressed to their read union
   *  (you can always see what was shared TO you, never the rest of the
   *  roster). The route walls subject visibility (existence-hiding 404). */
  listGrants(ref: SocialEntityRef, viewerTenant: string): Grant[] {
    if (socialSubjectSuspended(ref)) return []
    const rows = grants.filter((g) => g.subject.kind === ref.kind && g.subject.id === ref.id)
    const row = this.grantSubjectRow(ref)
    const owner = row !== undefined && row !== 'unsupported' && ownsGrantSubject(row, viewerTenant)
    return rows
      .filter((g) =>
        owner ||
        (g.audience.kind === 'link'
          ? (g.redeemedBy ?? []).some((t) => tenantReadsAs(viewerTenant, t))
          : tenantReadsAs(viewerTenant, g.audienceTenant)),
      )
      .map(publicGrant)
  },
  /** Create a grant — the consent-carded share act. Owner-only (tenantWritesAs
   *  on the subject's stamp); the audience resolves to a tenant id up front so
   *  the SSE gate and shared-with-me reads key on one field. INV-9: an absent
   *  `note` means share silently — access only, no Commons card. */
  createGrant(req: CreateGrantRequest, tenantId: string): Grant | 'forbidden' | 'invalid' | 'capped' | undefined {
    // S7 — the one place the recursion rule is CUT. A discussion is normally
    // grantable (S2), but a DM's wall is the pair BY CONSTRUCTION: there is no
    // third seat to sell, and a grant would quietly hand one out. Refused here,
    // once, rather than defended at each read path — and refused as `'invalid'`
    // (the kind-level shape) because the caller is its opener and already knows
    // the thread exists, so there is nothing to hide, only something to deny.
    if (req.subject.kind === 'discussion') {
      const d = discussions.find((x) => x.id === req.subject.id)
      if (d?.anchor.ref.kind === 'principal') return 'invalid'
    }
    const row = this.grantSubjectRow(req.subject)
    if (row === 'unsupported') return 'invalid' // kind-level refusal: leaks no row's existence
    if (row === undefined) return undefined
    if (!ownsGrantSubject(row, tenantId)) {
      // Existence-hiding beats forbidden: a caller the subject is invisible to
      // gets the same 404 as a nonexistent id; only a caller who can already
      // SEE it (they hold a grant) learns "yes it exists, but not yours".
      return this.grantSubjectVisible(req.subject, tenantId) ? 'forbidden' : undefined
    }
    if (!SHARE_TIERS.includes(req.tier)) return 'invalid'
    const note = canonicalGrantNote(req.note)
    // S6 — a LINK grant: the server mints the token (never caller-supplied —
    // a guessable token would be a wall with a hole); "anyone with the link"
    // means anyone SIGNED IN who redeems it. Anonymous rendering through the
    // auth gate is the recorded production tail. One link per subject: a
    // re-mint rotates the token (the old link dies — revocation by rotation).
    if (req.audience.kind === 'link') {
      const token = randomBytes(16).toString('base64url')
      const rows = grants.filter((g) => g.subject.kind === req.subject.kind && g.subject.id === req.subject.id)
      const existing = rows.find((g) => g.audience.kind === 'link')
      if (existing) {
        existing.audience = { kind: 'link', token }
        existing.tier = req.tier
        existing.redeemedBy = [] // rotation invalidates every prior redemption
        if (note === undefined) delete existing.note
        else existing.note = note
        emit({ type: 'grant.changed', subject: req.subject, parties: [existing.granterTenant] })
        persist()
        return publicGrant(existing)
      }
      if (rows.length >= MAX_GRANTS_PER_SUBJECT) return 'capped'
      const g: StoredGrant = {
        id: `grant-${(grantSeq += 1)}`,
        subject: { kind: req.subject.kind, id: req.subject.id },
        audience: { kind: 'link', token },
        tier: req.tier,
        ...(note === undefined ? {} : { note }),
        grantedBy: tenantName(tenantId),
        grantedAt: Date.now(),
        granterTenant: tenantId,
        audienceTenant: '',
        redeemedBy: [],
      }
      grants.push(g)
      emit({ type: 'grant.changed', subject: g.subject, parties: [tenantId] })
      persist()
      return publicGrant(g)
    }
    const audienceTenant = req.audience.kind === 'principal' ? req.audience.principalId : req.audience.orgId
    if (!audienceTenant || !accounts.tenants.has(audienceTenant)) return 'invalid'
    if (tenantReadsAs(tenantId, audienceTenant)) return 'invalid' // sharing to yourself/your own seat is a no-op ask
    const rows = grants.filter((g) => g.subject.kind === req.subject.kind && g.subject.id === req.subject.id)
    if (rows.length >= MAX_GRANTS_PER_SUBJECT) return 'capped'
    // One live grant per (subject, audience): a re-grant replaces the tier/note
    // rather than accreting rows (the commission re-grant pattern).
    const existing = rows.find((g) => g.audienceTenant === audienceTenant)
    if (existing) {
      // S5 — an ESCALATION re-rings the audience (a widened capability is news;
      // a lateral or narrowing re-grant is not — silence over noise).
      const escalated = tierRank(req.tier) > tierRank(existing.tier)
      existing.tier = req.tier
      if (note === undefined) delete existing.note
      else existing.note = note
      emit({ type: 'grant.changed', subject: req.subject, parties: [existing.granterTenant, audienceTenant] })
      if (escalated) {
        notifyTenants([audienceTenant], tenantId, {
          kind: 'social.shared',
          actor: existing.grantedBy,
          subjectKind: existing.subject.kind,
          subjectId: existing.subject.id,
          subjectName: this.commonsSubjectFace(existing.subject).name,
        })
      }
      persist()
      return publicGrant(existing)
    }
    const g: StoredGrant = {
      id: `grant-${(grantSeq += 1)}`,
      subject: { kind: req.subject.kind, id: req.subject.id },
      audience: req.audience,
      tier: req.tier,
      ...(note === undefined ? {} : { note }),
      grantedBy: tenantName(tenantId),
      grantedAt: Date.now(),
      granterTenant: tenantId,
      audienceTenant,
    }
    grants.push(g)
    emit({ type: 'grant.changed', subject: g.subject, parties: [tenantId, audienceTenant] })
    // S5 — the share rings its audience (the inbox row carries only public faces).
    const face = this.commonsSubjectFace(g.subject)
    notifyTenants([audienceTenant], tenantId, {
      kind: 'social.shared',
      actor: g.grantedBy,
      subjectKind: g.subject.kind,
      subjectId: g.subject.id,
      subjectName: face.name,
    })
    persist()
    return publicGrant(g)
  },
  /** Revoke a grant: the granter's act, or the audience declining what was
   *  shared to them (both parties may end the relationship). A NON-party gets
   *  the same 404 as a nonexistent id — grant ids are sequential, so a
   *  forbidden here would let an id probe confirm a grant exists
   *  (existence-hiding, the create-path lesson applied at revoke). */
  revokeGrant(grantId: string, tenantId: string): 'ok' | undefined {
    const i = grants.findIndex((g) => g.id === grantId)
    if (i < 0) return undefined
    const g = grants[i]
    if (!tenantWritesAs(tenantId, g.granterTenant) && !tenantReadsAs(tenantId, g.audienceTenant)) return undefined
    grants.splice(i, 1)
    emit({ type: 'grant.changed', subject: g.subject, parties: [g.granterTenant, g.audienceTenant] })
    persist()
    return 'ok'
  },
  /** The tier `viewerTenant` holds on a subject via grants (their read union —
   *  a personal grant or any org seat), or undefined when nothing was shared.
   *  The S1 read-side hook: subject-visibility walls OR this into their checks. */
  grantedTier(ref: SocialEntityRef, viewerTenant: string): ShareTier | undefined {
    return socialSubjectSuspended(ref) ? undefined : grantedTierFor(ref, viewerTenant)
  },
  /** Redeem a link token (S6): the signed-in caller joins the grant's
   *  redeemed set — thereafter the ordinary tier machinery treats them as
   *  audience. Idempotent; an unknown/rotated token is the existence-hiding
   *  404. Returns the subject so the client can land on its page. Deliberately
   *  SILENT (no bell either way): who clicked a link is nobody's business —
   *  the redaction rule extended to notifications. */
  redeemGrant(token: string, tenantId: string): RedeemGrantResponse | undefined {
    const g = grants.find((x) => x.audience.kind === 'link' && x.audience.token === token)
    if (!g) return undefined
    if (socialSubjectSuspended(g.subject)) return undefined
    const set = g.redeemedBy ?? (g.redeemedBy = [])
    if (!set.includes(tenantId)) {
      set.push(tenantId)
      emit({ type: 'grant.changed', subject: g.subject, parties: [g.granterTenant, tenantId] })
      persist()
    }
    return { subject: { ...g.subject }, tier: g.tier }
  },

  // ── Social-layer proposals (S3) ─────────────────────────────────────────────
  /** Propose authority on a subject: the owner; the legacy everyone-switch
   *  (parity with any-viewer contributions); a granted audience at `propose`+. */
  socialSubjectProposable(ref: SocialEntityRef, tenantId: string): boolean {
    const canon = canonicalSocialRef(ref)
    if (!canon) return false
    const row = this.grantSubjectRow(canon)
    if (row === undefined || row === 'unsupported') return false
    if (ownsGrantSubject(row, tenantId)) return true
    if ((row as { shared?: boolean }).shared === true) return true
    const held = grantedTierFor(canon, tenantId)
    return held !== undefined && tierPermits(held, 'propose')
  },
  /** A subject's proposals: offered first, then the landed ledger L{n}
   *  descending (the contributions read order). Route walls the subject. */
  listSocialProposals(ref: SocialEntityRef, viewerTenant: string): SocialProposal[] {
    if (socialSubjectSuspended(ref)) return []
    const rows = socialProposals.filter((p) => p.subject.kind === ref.kind && p.subject.id === ref.id)
    const band = (p: StoredSocialProposal) => (p.state === 'offered' ? 0 : 1)
    return [...rows]
      .sort((a, b) => band(a) - band(b) || (b.landingNumber ?? 0) - (a.landingNumber ?? 0) || b.offeredAt - a.offeredAt)
      .map((p) => publicSocialProposal(p, viewerTenant))
  },
  getSocialProposal(id: string, viewerTenant: string): SocialProposal | undefined {
    const p = socialProposals.find((x) => x.id === id)
    if (!p || !this.grantSubjectVisible(p.subject, viewerTenant)) return undefined
    return publicSocialProposal(p, viewerTenant)
  },
  /** Exact creator-only representation used before a keyed Retry body is read. */
  getSocialProposalCreation(id: string, tenantId: string): SocialProposal | 'invalid' | undefined {
    const p = socialProposals.find((candidate) => candidate.id === id)
    if (!p) return undefined
    if (p.offererTenant !== tenantId) return 'invalid'
    if (!this.grantSubjectVisible(p.subject, tenantId)) return undefined
    return publicSocialProposal(p, tenantId)
  },
  /** Offer a change. Subject must be READABLE (else the existence-hiding 404)
   *  and the offerer PROPOSABLE. The rationale opens the review thread — a
   *  normal Discussion anchored to the new proposal (recursion, one thread
   *  machinery). */
  openSocialProposal(
    req: OpenProposalRequest,
    tenantId: string,
    options: { logicalId?: string } = {},
  ): SocialProposal | 'forbidden' | 'capped' | 'invalid' | undefined {
    if (options.logicalId) {
      const represented = this.getSocialProposalCreation(options.logicalId, tenantId)
      if (represented !== undefined) return represented
      // A represented row may have become unreadable since it was offered.
      // Its identity remains occupied; never reuse it for changed Retry input.
      if (socialProposals.some((candidate) => candidate.id === options.logicalId)) return undefined
    }
    if (!this.grantSubjectVisible(req.subject, tenantId)) return undefined
    if (!this.socialSubjectProposable(req.subject, tenantId)) return 'forbidden'
    if (req.delta.kind === 'suggestion' && !req.delta.text.trim()) return 'invalid'
    if (req.delta.kind === 'relation-op' && typeof (req.delta.op as { kind?: unknown })?.kind !== 'string') return 'invalid'
    // A `schedule-patch` must be able to APPLY: it only makes sense on a routine,
    // and an empty patch would land as a no-op that still consumed an L#. Refused
    // at the door rather than stored as an inert record (INV-9, strict core).
    if (req.delta.kind === 'schedule-patch') {
      if (req.subject.kind !== 'schedule') return 'invalid'
      if (!isSchedulePatch(req.delta.patch)) return 'invalid'
    }
    // An `artifact-patch` must be able to APPLY, by the same rule: the subject is
    // an artifact, the address resolves to a patchable block, and the text both
    // says something and says something DIFFERENT — an identical rewrite is the
    // body edit's version of the empty patch, a no-op that would still burn an L#.
    if (req.delta.kind === 'artifact-patch') {
      if (req.subject.kind !== 'artifact') return 'invalid'
      const base = this.artifactBlockText(req.subject.id, req.delta.block)
      // Validate the CLAMPED text, so what is checked is what would be stored
      // and applied — checking the raw string could accept an offer whose
      // truncated form is a no-op against the base.
      const next = req.delta.text.trim().slice(0, MAX_ARTIFACT_BLOCK_CHARS)
      if (base === undefined || !next || next === base) return 'invalid'
      req.delta = { kind: 'artifact-patch', block: req.delta.block, text: next }
    }
    // Freeze the target domain at OFFER time. Landing is consent to this
    // reviewed change, not permission to silently rebase it over whatever a
    // second device wrote during review. Suggestions have no machine target and
    // therefore need no precondition. Additive-optional storage keeps older
    // snapshots landable under their historical unconditional behavior.
    const baseRevision =
      req.delta.kind === 'relation-op'
        ? (graph.revision ?? 0)
        : req.delta.kind === 'schedule-patch'
          ? (schedules.find((task) => task.id === req.subject.id)?.revision ?? 0)
          : req.delta.kind === 'artifact-patch'
            ? (artifactBodyOf(req.subject.id)?.revision ?? 0)
            : undefined
    const offeredBase =
      req.delta.kind === 'artifact-patch'
        ? artifactBlockTextOf(req.subject.id, req.delta.block)
        : undefined
    const rows = socialProposals.filter((p) => p.subject.kind === req.subject.kind && p.subject.id === req.subject.id)
    if (rows.length >= MAX_PROPOSALS_PER_SUBJECT) return 'capped'
    const p: StoredSocialProposal = {
      id: options.logicalId ?? `sprop-${(socialProposalSeq += 1)}`,
      subject: { kind: req.subject.kind, id: req.subject.id },
      delta: req.delta.kind === 'suggestion' ? { kind: 'suggestion', text: req.delta.text.slice(0, MAX_PROPOSAL_CHARS) } : req.delta,
      state: 'offered',
      offeredBy: tenantName(tenantId),
      offeredAt: Date.now(),
      discussionId: '', // set below — the thread anchors to the proposal, so the row must exist first
      offererTenant: tenantId,
      ...(baseRevision !== undefined ? { baseRevision } : {}),
      ...(offeredBase !== undefined ? { offeredBase } : {}),
    }
    return commitMutationBatch(() => {
      socialProposals.push(p)
      const review = this.openDiscussion(
        { anchor: { ref: { kind: 'proposal', id: p.id } }, firstPost: req.rationale.slice(0, MAX_PROPOSAL_CHARS) },
        tenantId,
      )
      if (typeof review !== 'object') {
        socialProposals.pop() // roll back the half-made proposal; refusals surface as invalid
        return 'invalid'
      }
      p.discussionId = review.id
      emit({ type: 'social-proposal.changed', proposalId: p.id, subject: p.subject })
      // S5 — an offered improvement rings the subject's OWNER (the consent-holder).
      const subjRow = this.grantSubjectRow(p.subject)
      if (subjRow !== undefined && subjRow !== 'unsupported') {
        const face = this.commonsSubjectFace(p.subject)
        notifyTenants([subjRow.tenantId ?? defaultTenantId()], tenantId, {
          kind: 'social.offered',
          actor: p.offeredBy,
          subjectKind: p.subject.kind,
          subjectId: p.subject.id,
          subjectName: face.name,
        })
      }
      persist()
      return publicSocialProposal(p, tenantId)
    })
  },
  /** Land — the subject OWNER's consent: assign the next per-subject ledger
   *  number (monotonic, derived from the ledger itself) and APPLY the delta
   *  through its applier (relation ops run the real reducer; a suggestion's
   *  landing is the acceptance record). */
  landSocialProposal(id: string, tenantId: string): SocialProposal | 'forbidden' | 'closed' | 'stale' | 'inapplicable' | undefined {
    const p = socialProposals.find((x) => x.id === id)
    if (!p || !this.grantSubjectVisible(p.subject, tenantId)) return undefined
    const row = this.grantSubjectRow(p.subject)
    if (row === undefined || row === 'unsupported' || !ownsGrantSubject(row, tenantId)) return 'forbidden'
    if (p.state !== 'offered') return 'closed'
    // The proposal's subject wall grants the consent decision, not arbitrary
    // authority over every id embedded in a relation op. Re-run the canonical
    // cross-tenant op wall for the actual landing principal.
    if (p.delta.kind === 'relation-op' && this.opDeniedForTenant(p.delta.op, tenantId)) return 'inapplicable'
    // Old snapshots can carry a schedule delta offered before cadence/timezone
    // became strict. Re-check at effect time so review never turns that legacy
    // row into a 500 or a partially applied definition.
    if (p.delta.kind === 'schedule-patch' && !isSchedulePatch(p.delta.patch)) return 'inapplicable'
    if (p.delta.kind === 'artifact-patch') {
      const artifact = findArtifact(p.subject.id)
      if (!artifact || normalizeArtifactName(artifact.name) !== artifact.name) return 'inapplicable'
    }
    if (socialProposalIsStale(p)) return 'stale'
    return commitMutationBatch(() => {
      // Landing runs the REAL mutator for every applying kind — the same call the
      // owner's own editor makes, never a parallel write path. The batch folds
      // its resource write, ledger verdict, bell, and events into one snapshot.
      if (p.delta.kind === 'relation-op') this.applyRelationOp(p.delta.op, tenantId)
      if (p.delta.kind === 'schedule-patch') this.updateSchedule(p.subject.id, p.delta.patch, p.baseRevision)
      if (p.delta.kind === 'artifact-patch') {
        // Freeze the pre-image BEFORE applying: once landed the row is history,
        // and history cannot be recomputed from a body that has since moved on.
        p.appliedBase = p.offeredBase ?? artifactBlockTextOf(p.subject.id, p.delta.block)
        this.updateArtifactBlock(p.subject.id, p.delta.block, p.delta.text, p.baseRevision)
      }
      p.state = 'landed'
      // ONE landing ledger per subject (the consolidation, 2026-07-21): a project's
      // L# sequence is shared with its contribution ledger — both landing paths
      // derive one-past-the-highest across BOTH, so the merged Changes panel reads
      // as a single history. Derived from the ledgers themselves (never a counter),
      // so a restored snapshot can't double-assign.
      p.landingNumber = nextLandingNumber(p.subject)
      emit({ type: 'social-proposal.changed', proposalId: p.id, subject: p.subject })
      // S5 — the verdict rings the OFFERER (the D25 two-party loop).
      notifyTenants([p.offererTenant], tenantId, {
        kind: 'social.landed',
        actor: tenantName(tenantId),
        subjectKind: p.subject.kind,
        subjectId: p.subject.id,
        subjectName: this.commonsSubjectFace(p.subject).name,
      })
      persist()
      return publicSocialProposal(p, tenantId)
    })
  },
  /** Decline — the owner's polite no. To third parties the proposal stays the
   *  existence-hiding 404 either way. */
  declineSocialProposal(id: string, tenantId: string): SocialProposal | 'forbidden' | 'closed' | undefined {
    const p = socialProposals.find((x) => x.id === id)
    if (!p || !this.grantSubjectVisible(p.subject, tenantId)) return undefined
    const row = this.grantSubjectRow(p.subject)
    if (row === undefined || row === 'unsupported' || !ownsGrantSubject(row, tenantId)) return 'forbidden'
    if (p.state !== 'offered') return 'closed'
    return commitMutationBatch(() => {
      p.state = 'declined'
      emit({ type: 'social-proposal.changed', proposalId: p.id, subject: p.subject })
      // S5 — the polite no rings the offerer too.
      notifyTenants([p.offererTenant], tenantId, {
        kind: 'social.declined',
        actor: tenantName(tenantId),
        subjectKind: p.subject.kind,
        subjectId: p.subject.id,
        subjectName: this.commonsSubjectFace(p.subject).name,
      })
      persist()
      return publicSocialProposal(p, tenantId)
    })
  },

  // ── The Commons feed (S4) — a projection over the primitives ────────────────
  /** The subject's embed face, resolved per kind at serve time (the
   *  ResourcePreview adapter's server half — display name + one line; nothing
   *  stored, so a rename can't go stale). */
  commonsSubjectFace(ref: SocialEntityRef): { name: string; blurb?: string; turns?: { role: 'user' | 'assistant'; text: string }[]; artifactKind?: ArtifactKind } {
    switch (ref.kind) {
      case 'project': {
        const p = findProject(ref.id)
        return { name: p?.name ?? ref.id, ...(p?.description ? { blurb: p.description } : {}) }
      }
      case 'session': {
        const s = SESSIONS.find((x) => x.id === ref.id)
        // A conversation previews AS conversation: the last two turns ride the
        // embed (trimmed — the card is a teaser, the session page the door).
        const turns = (s?.messages ?? [])
          .slice(-2)
          .filter((m) => m.content.trim())
          .map((m) => ({ role: m.role, text: m.content.slice(0, 200) }))
        return { name: s?.title ?? ref.id, ...(s?.preview ? { blurb: s.preview } : {}), ...(turns.length ? { turns } : {}) }
      }
      case 'schedule': {
        const t = schedules.find((x) => x.id === ref.id)
        return { name: t?.name ?? ref.id, ...(t?.cadence ? { blurb: t.cadence } : {}) }
      }
      case 'artifact': {
        const a = findArtifact(ref.id)
        return { name: a?.name ?? ref.id, ...(a?.kind ? { artifactKind: a.kind } : {}) }
      }
      case 'context': {
        const c = contextRegistry.snapshot(defaultTenantId()).contexts.find((x) => x.id === ref.id)
        return { name: c?.label ?? ref.id }
      }
      case 'discussion': {
        const d = discussions.find((x) => x.id === ref.id)
        return { name: d ? discussionTitle(d.posts[0]?.body) : ref.id }
      }
      case 'proposal': {
        const p = socialProposals.find((x) => x.id === ref.id)
        return { name: p ? `Proposal on ${p.subject.kind} ${p.subject.id}` : ref.id }
      }
      case 'principal':
        // A person's face IS their display name — it is already the public
        // handle, so there is nothing to resolve and nothing to redact.
        return { name: ref.id }
    }
  },
  /** The caller's Commons feed: published shares (grants carrying a NOTE —
   *  silent grants stay out by design, INV-9's distinction made visible) and
   *  ledger landings, on subjects the caller can read — their world's public
   *  face, chronological, no ranking. Each item carries the subject's root
   *  discussion (the card's comments ARE the entity page's thread). */
  listCommons(tenantId: string, opts?: { includeMuted?: boolean }): CommonsItem[] {
    const items: CommonsItem[] = []
    const rootOf = (ref: SocialEntityRef) =>
      discussions.find((d) => d.anchor.ref.kind === ref.kind && d.anchor.ref.id === ref.id && d.anchor.locus === undefined)
    // The caller's own relationships, read once per feed rather than per item.
    const viewedAt = new Map((views.get(tenantId) ?? []).map((v) => [v.key, v.at]))
    const followed = follows.get(tenantId)
    const push = (
      base: Omit<CommonsItem, 'subjectName' | 'subjectBlurb' | 'discussionId' | 'commentCount' | 'likes'> & {
        /** The acting tenant — server-private; it never reaches the wire, only
         *  the viewer-relative `mine` it decides (the REDACTED-face rule). */
        actorTenant?: string
        /** The item's OWN thread, when it has one (S8 posts). Absent = look the
         *  subject's root thread up, which is what a share/landing wants. */
        thread?: StoredDiscussion
      },
    ) => {
      const { actorTenant, thread, ...item } = base
      const face = this.commonsSubjectFace(item.subject)
      // S8 — a POST carries its own thread: the utterance and the conversation
      // under it are one object, so there is no separate root to look up (and
      // looking one up by subject would find some OTHER post by the same
      // author, since every post shares the anchor).
      const root = thread ?? rootOf(item.subject)
      const likedBy = commonsLikes.get(item.id)
      const seen = viewedAt.get(watchKey(item.subject))
      items.push({
        ...item,
        subjectName: face.name,
        ...(face.blurb ? { subjectBlurb: face.blurb } : {}),
        ...(face.turns ? { subjectTurns: face.turns } : {}),
        ...(face.artifactKind ? { subjectArtifactKind: face.artifactKind } : {}),
        ...(root ? { discussionId: root.id } : {}),
        // For a post the opening entry IS the card's text, so it is not one of
        // the "comments" the count promises; for a share/landing every post in
        // the subject's root thread is.
        commentCount: Math.max(0, (root?.posts.length ?? 0) - (item.kind === 'post' ? 1 : 0)),
        // The lens signals (S4, + `followed` in S7). Each is the READER's
        // relationship, so each is computed here and absent when it doesn't
        // hold. `followed` is the only one keyed on the ACTOR rather than the
        // subject — which is precisely what makes it a social feed.
        ...(actorTenant !== undefined && tenantReadsAs(tenantId, actorTenant) ? { mine: true } : {}),
        likes: likedBy?.size ?? 0,
        ...(likedBy?.has(tenantId) ? { liked: true } : {}),
        ...(watches.get(watchKey(item.subject))?.has(tenantId) ? { watched: true } : {}),
        ...(seen !== undefined ? { viewedAt: seen } : {}),
        ...(followed?.has(item.actor) ? { followed: true } : {}),
      })
    }
    // S5 earmuff — the viewer's own filter. `includeMuted` exists for the ONE
    // caller that must not honor it: the profile's publisher-existence check
    // (S7). Muting somebody is an earmuff, never a wall — but that check asked
    // the muted feed whether a name publishes, so muting a person whose only
    // public face was their publishes made their PROFILE 404, i.e. erased them.
    // A mute silences what someone says; it must not unmake who they are.
    const muted = opts?.includeMuted === true ? undefined : mutes.get(tenantId)
    for (const g of grants) {
      if (g.note === undefined) continue
      if (muted?.has(g.grantedBy)) continue
      if (!this.grantSubjectVisible(g.subject, tenantId)) continue
      push({ id: `share:${g.id}`, kind: 'share', at: g.grantedAt, actor: g.grantedBy, actorTenant: g.granterTenant, note: g.note, subject: g.subject })
    }
    // ── S8: the posts ────────────────────────────────────────────────────────
    // Every wall thread is a feed item. Its subject is the AUTHOR's principal,
    // so the card's door is their profile and the `followed` lens (keyed on the
    // actor) turns the square into a Following timeline for free.
    for (const d of discussions) {
      if (!isWallThread(d)) continue
      const opening = d.posts[0]
      if (!opening) continue
      if (muted?.has(d.openedBy)) continue
      if (!this.discussionReadableBy(d, tenantId)) continue
      push({
        id: `post:${d.id}`,
        kind: 'post',
        at: opening.at,
        actor: d.openedBy,
        actorTenant: d.openerTenant,
        note: opening.body,
        subject: { kind: 'principal', id: d.anchor.ref.id },
        thread: d,
      })
    }
    for (const p of socialProposals) {
      if (p.state !== 'landed') continue
      if (muted?.has(p.offeredBy)) continue
      if (!this.grantSubjectVisible(p.subject, tenantId)) continue
      push({ id: `landing:${p.id}`, kind: 'landing', at: p.offeredAt, actor: p.offeredBy, actorTenant: p.offererTenant, landingNumber: p.landingNumber, subject: p.subject })
    }
    return items.sort((a, b) => b.at - a.at)
  },

  // ── The contribution ledger (agent-contribution workflow Phase A) ───────────
  /** A Project's contribution ledger: open contributions first (newest first),
   *  then landed ones in REVERSE ledger order (L{n} descending — the "Recently
   *  landed" read). Served through the `publicContribution` redaction. */
  listContributions(projectId: string, viewerTenant?: string, viewerUserId?: string): Contribution[] {
    const rows = contributions.filter((c) => c.projectId === projectId)
    const band = (c: StoredContribution) => (c.status === 'open' ? 0 : 1)
    return [...rows]
      .sort((a, b) => band(a) - band(b) || (b.landingNumber ?? 0) - (a.landingNumber ?? 0) || b.openedAt - a.openedAt)
      .map((c) => publicContribution(c, viewerTenant, viewerUserId))
  },
  /** Re-project mutation acknowledgements with the same current person-relative
   * capabilities as ledger reads. Private OAuth identity never crosses the wire. */
  contributionForViewer(projectId: string, contributionId: string, tenantId: string, actorUserId?: string): Contribution | undefined {
    if (!this.grantSubjectVisible({ kind: 'project', id: projectId }, tenantId)) return undefined
    const c = contributions.find((entry) => entry.id === contributionId && entry.projectId === projectId)
    return c ? publicContribution(c, tenantId, actorUserId) : undefined
  },
  /** Open (declare) a contribution — the CW1 intent made visible. Any tenant that
   *  can SEE the Project may open one (the route validates visibility, the
   *  open-subgoal pattern); free text is capped at the funnel. */
  openContribution(
    projectId: string,
    req: OpenContributionRequest,
    tenantId: string,
    principal: PrincipalRef | undefined,
    options: { logicalId?: string } = {},
  ): Contribution | 'capped' | 'invalid' | 'invalid-work' | 'closed-work' {
    if (options.logicalId) {
      const represented = contributions.find((contribution) => contribution.id === options.logicalId)
      if (represented) {
        if (represented.projectId !== projectId || represented.contributorTenant !== tenantId) return 'invalid'
        return publicContribution(represented, tenantId)
      }
    }
    if (Object.hasOwn(req, 'initialMcpProposal')) return 'invalid-work'
    // The link is exact immutable identity, never a free-text claim or a source
    // of authority. Derive its sub-goal from current same-Project work.
    let linkedWork: StoredOpenSubGoal | undefined
    if (req.workItemId !== undefined) {
      if (typeof req.workItemId !== 'string' || !req.workItemId || req.workItemId.length > 200 ||
          req.workItemId.trim() !== req.workItemId || /[\u0000-\u001f\u007f-\u009f]/.test(req.workItemId) ||
          !this.grantSubjectVisible({ kind: 'project', id: projectId }, tenantId)) return 'invalid-work'
      linkedWork = openSubGoals.find((item) => item.id === req.workItemId && item.projectId === projectId)
      if (!isLinkableProjectWorkItem(linkedWork) ||
          (req.subGoal !== undefined && (typeof req.subGoal !== 'string' || req.subGoal.trim() !== linkedWork.subGoal))) return 'invalid-work'
      if (linkedWork.status !== 'open') return 'closed-work'
    }
    const rows = contributions.filter((c) => c.projectId === projectId)
    if (rows.length >= MAX_CONTRIBUTIONS_PER_PROJECT || rows.filter((c) => c.status === 'open').length >= MAX_OPEN_CONTRIBUTIONS_PER_PROJECT) {
      return 'capped'
    }
    const now = Date.now()
    const actor = tenantName(tenantId)
    // The session door is stored only when the OPENER's tenant can actually see
    // the named session — a caller-supplied foreign session id would otherwise
    // ride the public ledger as a leaked private identifier (review finding).
    const namedSession = req.sessionId ? SESSIONS.find((s) => s.id === req.sessionId) : undefined
    const sessionOk = namedSession !== undefined && this.sessionVisibleToTenant(namedSession, tenantId)
    return commitMutationBatch(() => {
      const id = options.logicalId ?? `contrib-${contributionSeq + 1}`
      if (!options.logicalId) contributionSeq += 1
      const eventId = `cev-${contributionSeq + 1}`
      contributionSeq += 1
      const c: StoredContribution = {
        id,
        projectId,
        title: req.title.slice(0, MAX_CONTRIBUTION_FIELD_CHARS),
        summary: (req.summary ?? '').slice(0, MAX_CONTRIBUTION_FIELD_CHARS),
        ...(linkedWork ? { workItemId: linkedWork.id, subGoal: linkedWork.subGoal } :
          req.subGoal?.trim() ? { subGoal: req.subGoal.trim().slice(0, MAX_CONTRIBUTION_FIELD_CHARS) } : {}),
        ...(sessionOk ? { sessionId: req.sessionId } : {}),
        contributor: actor,
        contributorTenant: tenantId,
        ...(principal ? { contributorPrincipal: principal } : {}),
        status: 'open',
        openedAt: now,
        events: [{ id: eventId, kind: 'opened', at: now, actor, ...(principal ? { principal } : {}) }],
      }
      contributions.push(c)
      emit({ type: 'contribution.changed', projectId })
      persist()
      return publicContribution(c, tenantId)
    })
  },
  /** Explicit reviewed item-first publication. The selected call is validated
   * against the current inspected connection before re-entering the synchronous
   * mutation boundary; work and connection authority are checked again there.
   * This creates a proposal only—approval and Run remain separate human acts. */
  async openContributionWithInitialMcpProposal(
    projectId: string,
    req: OpenContributionRequest,
    tenantId: string,
    principal: PrincipalRef | undefined,
    options: { logicalId?: string; actorUserId?: string; isCurrent?: () => boolean } = {},
  ): Promise<Contribution | 'capped' | 'invalid' | 'invalid-work' | 'closed-work' | 'invalid-proposal' | 'conflict'> {
    if (!options.logicalId) return 'invalid-proposal'
    const represented = contributions.find((contribution) => contribution.id === options.logicalId)
    if (represented) {
      if (represented.projectId !== projectId || represented.contributorTenant !== tenantId) return 'invalid'
      return publicContribution(represented, tenantId, options.actorUserId)
    }
    if (!Object.hasOwn(req, 'initialMcpProposal') || !req.initialMcpProposal ||
        typeof req.title !== 'string' || !req.title.trim() || typeof req.workItemId !== 'string' ||
        (req.summary !== undefined && typeof req.summary !== 'string') ||
        (req.subGoal !== undefined && typeof req.subGoal !== 'string') ||
        (req.sessionId !== undefined && typeof req.sessionId !== 'string')) return 'invalid-proposal'
    if (!this.grantSubjectVisible({ kind: 'project', id: projectId }, tenantId)) return 'invalid-work'
    const linkedWork = openSubGoals.find((item) => item.id === req.workItemId && item.projectId === projectId)
    if (!isLinkableProjectWorkItem(linkedWork) || linkedWork.status !== 'open' ||
        (req.subGoal !== undefined && (typeof req.subGoal !== 'string' || req.subGoal.trim() !== linkedWork.subGoal))) {
      return linkedWork && linkedWork.status !== 'open' ? 'closed-work' : 'invalid-work'
    }
    const proposalLines = normalizedEnvelopeProposalLines({ lines: [{
      type: 'mcp.mutate', target: linkedWork.target, cardinality: 1, harness: 'explicit-call', note: '',
      mcp: req.initialMcpProposal,
    }] })
    if (!proposalLines) return 'invalid-proposal'
    // Legacy HTTP headers may synthesize tenant test identities; ordinary
    // tenant-owned HTTP connections need no person lookup. The binding resolver
    // independently proves membership/ownership whenever the row is person-owned.
    const actorUserId = principal?.kind === 'user' ? options.actorUserId ?? principal.id : undefined
    const preparedLines = await prepareContributionMcpLines(this, tenantId, proposalLines, actorUserId)

    // The async schema validator may yield. Recheck all mutable joins before
    // publishing so a closed/retracted work item or revised connection cannot
    // produce a half-valid public Contribution.
    if (!this.grantSubjectVisible({ kind: 'project', id: projectId }, tenantId)) return 'invalid-work'
    if (options.isCurrent && !options.isCurrent()) return 'conflict'
    // A request that raced with this exact keyed create replays its represented
    // row before consulting mutable item or connection state. Current read
    // authority was checked just above; replay adds no new authority or effect.
    const raced = contributions.find((contribution) => contribution.id === options.logicalId)
    if (raced) {
      if (raced.projectId !== projectId || raced.contributorTenant !== tenantId) return 'invalid'
      return publicContribution(raced, tenantId, options.actorUserId)
    }
    if (!preparedLines || preparedLines.length !== 1) return 'invalid-proposal'
    if (!openSubGoals.includes(linkedWork) || linkedWork.status !== 'open') return 'closed-work'
    if (!isLinkableProjectWorkItem(linkedWork) || linkedWork.id !== req.workItemId ||
        linkedWork.target !== proposalLines[0]?.target) return 'invalid-work'
    const preparedLine = preparedLines[0]
    if (!preparedLine || !currentContributionMcpLine(this, tenantId, { ...preparedLine, id: 'preparing', used: 0 }, actorUserId)) {
      return 'invalid-proposal'
    }
    const rows = contributions.filter((contribution) => contribution.projectId === projectId)
    if (rows.length >= MAX_CONTRIBUTIONS_PER_PROJECT ||
        rows.filter((contribution) => contribution.status === 'open').length >= MAX_OPEN_CONTRIBUTIONS_PER_PROJECT) return 'capped'
    const now = Date.now()
    const actor = tenantName(tenantId)
    const publishedProposalLine = proposalLines[0]!
    const proposalTransport = preparedLine.mcp?.transport
    const persistedProposalLines = [{
      ...publishedProposalLine,
      ...(proposalTransport === undefined || !publishedProposalLine.mcp ? {} : {
        mcp: { ...publishedProposalLine.mcp, transport: proposalTransport },
      }),
    }]
    const proposalOwnerUserId = preparedLine.mcpAuthority?.ownerUserId
    const namedSession = req.sessionId ? SESSIONS.find((session) => session.id === req.sessionId) : undefined
    const sessionOk = namedSession !== undefined && this.sessionVisibleToTenant(namedSession, tenantId)
    return commitMutationBatch(() => {
      const id = options.logicalId!
      const openedEventId = `cev-${(contributionSeq += 1)}`
      const lineId = `cev-${(contributionSeq += 1)}`
      const proposalEventId = `cev-${(contributionSeq += 1)}`
      const c: StoredContribution = {
        id,
        projectId,
        title: req.title.trim().slice(0, MAX_CONTRIBUTION_FIELD_CHARS),
        summary: (req.summary ?? '').trim().slice(0, MAX_CONTRIBUTION_FIELD_CHARS),
        workItemId: linkedWork.id,
        subGoal: linkedWork.subGoal,
        ...(sessionOk ? { sessionId: req.sessionId } : {}),
        contributor: actor,
        contributorTenant: tenantId,
        ...(principal ? { contributorPrincipal: principal } : {}),
        status: 'open',
        openedAt: now,
        envelope: {
          version: 1,
          status: 'proposed',
          proposedBy: actor,
          proposedAt: now,
          lines: [{ id: lineId, ...structuredClone(preparedLine), used: 0 }],
        },
        events: [
          { id: openedEventId, kind: 'opened', at: now, actor, ...(principal ? { principal } : {}) },
          { id: proposalEventId, kind: 'envelope-proposed', at: now, actor, envelopeVersion: 1,
            body: 'v1 · 1 act', proposedByTenant: tenantId, envelopeProposalExpectedVersion: 0,
            envelopeProposalLines: persistedProposalLines,
            ...(proposalOwnerUserId === undefined ? {} : { envelopeProposalOwnerUserId: proposalOwnerUserId }),
            ...(principal ? { principal } : {}) },
        ],
      }
      contributions.push(c)
      emit({ type: 'contribution.changed', projectId })
      persist()
      return publicContribution(c, tenantId, options.actorUserId)
    })
  },
  /** Current containing Contribution for one keyed native comment receipt. */
  getContributionCommentCreation(
    id: string,
    projectId: string,
    contributionId: string,
    body: string,
    tenantId: string,
  ): Contribution | 'invalid' | undefined {
    if (!isContributionCommentCreationId(id)) return 'invalid'
    const contribution = contributions.find(
      (candidate) => candidate.id === contributionId && candidate.projectId === projectId,
    )
    if (!contribution) return undefined
    const event = contribution.events.find((candidate) => candidate.id === id)
    if (!event) {
      const collision = contributions.some((candidate) => candidate.events.some((entry) => entry.id === id))
      return collision ? 'invalid' : undefined
    }
    const normalizedBody = body.trim().slice(0, MAX_CONTRIBUTION_FIELD_CHARS)
    if (
      !normalizedBody ||
      event.kind !== 'note' ||
      event.notedByTenant !== tenantId ||
      event.body !== normalizedBody
    ) return 'invalid'
    return publicContribution(contribution, tenantId)
  },
  /** Append a note to a contribution's timeline — the flat discussion thread.
   * Deliberately allowed AFTER landing too: the page keeps accruing (CW7 — a
   * landed contribution's story includes its aftermath). */
  noteContribution(
    projectId: string,
    cid: string,
    body: string,
    tenantId: string,
    principal: PrincipalRef | undefined,
    options: { logicalId?: string } = {},
  ): Contribution | 'capped' | 'invalid' | undefined {
    if (options.logicalId) {
      const represented = this.getContributionCommentCreation(
        options.logicalId,
        projectId,
        cid,
        body,
        tenantId,
      )
      if (typeof represented === 'object') return represented
      if (represented === 'invalid') return 'invalid'
    }
    const c = contributions.find((x) => x.id === cid && x.projectId === projectId)
    if (!c) return undefined
    if (c.events.filter((e) => e.kind === 'note').length >= MAX_CONTRIBUTION_NOTES) return 'capped'
    const storedBody = body.trim().slice(0, MAX_CONTRIBUTION_FIELD_CHARS)
    if (!storedBody) return 'invalid'
    return commitMutationBatch(() => {
      c.events.push({
        id: options.logicalId ?? `cev-${(contributionSeq += 1)}`,
        kind: 'note',
        at: Date.now(),
        actor: tenantName(tenantId),
        body: storedBody,
        ...(options.logicalId ? { notedByTenant: tenantId } : {}),
        ...(principal ? { principal } : {}),
      })
      emit({ type: 'contribution.changed', projectId })
      persist()
      return publicContribution(c, tenantId)
    })
  },
  /** Current Contribution for one durable native landing acknowledgement. */
  getContributionLanding(
    id: string,
    projectId: string,
    contributionId: string,
    tenantId: string,
  ): Contribution | 'invalid' | undefined {
    if (!isContributionLandingId(id)) return 'invalid'
    const represented = contributions.find((candidate) => candidate.landingId === id)
    if (!represented) return undefined
    if (
      represented.id !== contributionId ||
      represented.projectId !== projectId ||
      represented.landedByTenant !== tenantId
    ) return 'invalid'
    return publicContribution(represented, tenantId)
  },
  /** Land a contribution: assign the next landing number (monotonic PER PROJECT —
   *  the linear ledger, CW6) and close the lifecycle. Contributor or Project
   *  owner only — the Phase-A placeholder for the CW5 tier arithmetic (recorded
   *  in the design doc's build plan; the authorization comparison is raw tenant
   *  ids, the D23 lesson, via the same `tenantWritesAs` union as retract). */
  landContribution(
    projectId: string,
    cid: string,
    tenantId: string,
    principal: PrincipalRef | undefined,
    options: { eventActor?: string; logicalId?: string } = {},
  ): Contribution | 'forbidden' | 'closed' | 'needs-owner' | 'needs-review' | 'pending-effect' | 'closed-work' | 'needs-work-result' | undefined {
    if (options.logicalId) {
      const represented = this.getContributionLanding(options.logicalId, projectId, cid, tenantId)
      if (typeof represented === 'object') return represented
      if (represented === 'invalid') {
        throw new ValidationError('That Contribution landing identity is not valid for this account and ledger row.')
      }
    }
    const c = contributions.find((x) => x.id === cid && x.projectId === projectId)
    if (!c) return undefined
    const ownerTenant = findProject(projectId)?.tenantId ?? defaultTenantId()
    const ownerActs = tenantWritesAs(tenantId, ownerTenant)
    const isContributor = c.contributorTenant !== undefined && c.contributorTenant === tenantId
    if (!isContributor && !ownerActs) return 'forbidden'
    if (c.status !== 'open') return 'closed'
    if (c.workItemId !== undefined && (!ownerActs || principal?.kind !== 'user' || options.eventActor !== undefined)) return 'needs-owner'
    if (c.effectAttempts?.some((run) => run.status === 'pending')) return 'pending-effect'
    let resolvedWork: { item: StoredOpenSubGoal; effectId: string } | undefined
    if (c.workItemId !== undefined) {
      // A linked landing is the owner's explicit acceptance, not an Agent
      // judgment or automatic tier promotion. It spends no Commission credit.
      if (!this.grantSubjectVisible({ kind: 'project', id: projectId }, tenantId)) return 'forbidden'
      const item = openSubGoals.find((entry) => entry.id === c.workItemId && entry.projectId === projectId)
      const resolution = computeProjectWorkResolution(item, c)
      if (!item || resolution.status === 'closed') return 'closed-work'
      if (resolution.status !== 'ready') return 'needs-work-result'
      resolvedWork = { item, effectId: resolution.effectId }
    }
    // CW5 — the tier gates the CONTRIBUTOR's self-land; the owner may always
    // land (the human authority the tiers exist to spend wisely, not to bind).
    if (!ownerActs) {
      const tier = tierFor(c)
      // The floor: irreversible effects land only by the owner's human act —
      // no landed record buys past it (tierFor ignores trust at level 2).
      if (tier.level === 2) return 'needs-owner'
      // Tier 1: the adversarial verdict must cover the LATEST version — a
      // re-crystallize invalidates it, and un-crystallized work has nothing
      // a reviewer could pass (reviewedVersion stays unset ⇒ refused).
      if (tier.level === 1 && contributionReviewVersion(c) !== (c.changeset?.length ?? 0)) return 'needs-review'
    }
    return commitMutationBatch(() => {
      const now = Date.now()
      // The ledger position: one past the project's highest landed number across
      // BOTH landing paths (contributions + social proposals — the one-ledger
      // consolidation) — derived from the ledgers themselves, so a restored
      // snapshot can't double-assign.
      c.status = 'landed'
      c.landingNumber = nextLandingNumber({ kind: 'project', id: projectId })
      c.landedAt = now
      c.landedBy = tenantName(tenantId)
      c.landedByTenant = tenantId
      if (options.logicalId) c.landingId = options.logicalId
      // `eventActor` — the CW8 dual stamp, same rationale as approveEnvelope's.
      c.events.push({ id: `cev-${(contributionSeq += 1)}`, kind: 'landed', at: now, actor: options.eventActor ?? c.landedBy, ...(principal ? { principal } : {}) })
      if (resolvedWork) {
        const { item, effectId } = resolvedWork
        item.status = 'done'
        item.resolvedAt = now
        item.contributionResolution = { contributionId: c.id, effectId, by: c.landedBy }
        notifyTenants(workItemAudience(item), tenantId, {
          kind: 'work.resolved', actor: c.landedBy, projectId,
          projectName: findProject(projectId)?.name ?? '', subGoal: item.subGoal, workItemId: item.id,
        })
        emit({ type: 'openwork.changed', projectId })
      }
      emit({ type: 'contribution.changed', projectId })
      persist()
      return publicContribution(c, tenantId)
    })
  },

  // ── The attention ledger (CW9, Phase G) — interrupts justify themselves ─────
  /** Meter human attention the way tokens are metered (the D8 move applied to
   *  the truly scarce resource). Counts are arithmetic over the project's
   *  timelines; asks are computed FOR THE CALLER (the who-can-decide triage);
   *  the proposal is a mechanical pattern-match — never fabricated cognition. */
  attentionLedger(projectId: string, tenantId: string): import('../../contract/index.ts').AttentionLedger {
    const rows = contributions.filter((c) => c.projectId === projectId)
    const ownerTenant = findProject(projectId)?.tenantId ?? defaultTenantId()
    const ownerActs = tenantWritesAs(tenantId, ownerTenant)
    let humanActs = 0, delegatedActs = 0, machineActs = 0, escalations = 0
    // A monotonic-envelope approval taken by the HUMAN — the pattern the
    // self-proposed optimization watches for.
    let manualMonotonicApprovals = 0
    for (const c of rows) {
      // Explicit MCP runs have their own append-only receipts, not duplicate
      // fixture events. Count the per-call human act, and conservatively count
      // any execution whose slot may have been consumed.
      humanActs += c.effectAttempts?.length ?? 0
      machineActs += c.effectAttempts?.filter(contributionEffectConsumesSlot).length ?? 0
      for (const ev of c.events) {
        // The dual stamp (" · delegation-N") marks a delegate's execution —
        // our own stable format (locked by the delegations test). Display
        // names are attacker-controlled, so a name embedding the marker could
        // skew a COUNT — a cosmetic ledger miscount only, never authority
        // (the gates all compare raw tenant ids); accepted for the prototype.
        const delegated = ev.actor.includes(' · delegation-')
        switch (ev.kind) {
          case 'envelope-approved':
            if (delegated) delegatedActs += 1
            else {
              humanActs += 1
              if (!isEffectfulContribution(c)) manualMonotonicApprovals += 1
            }
            break
          case 'landed':
            delegated ? (delegatedActs += 1) : (humanActs += 1)
            break
          case 'review-required':
            humanActs += 1
            break
          case 'delegated-decision':
          case 'delegated-draft':
            delegatedActs += 1
            break
          case 'delegated-escalation':
            escalations += 1
            break
          case 'review-passed':
          case 'effect-executed':
            machineActs += 1
            break
        }
      }
    }
    const asks: import('../../contract/index.ts').AttentionAsk[] = []
    for (const c of rows) {
      if (c.status !== 'open') continue
      const mine = c.contributorTenant !== undefined && c.contributorTenant === tenantId
      const tier = tierFor(c)
      if (ownerActs) {
        // The owner's asks are the LIABILITY moments only a human can take.
        if (c.envelope?.status === 'proposed') {
          asks.push({ contributionId: c.id, title: c.title, function: 'liability', label: 'Approve the effect envelope — you become responsible for its acts' })
        } else if (tier.level === 2) {
          asks.push({ contributionId: c.id, title: c.title, function: 'liability', label: 'The floor: only you can land this (irreversible effects)' })
        }
      }
      if (mine && tier.level === 1) {
        // The contributor's next step — error-catching a machine act holds.
        const latest = c.changeset?.length ?? 0
        if (latest === 0) {
          asks.push({ contributionId: c.id, title: c.title, function: 'error-catching', label: 'Crystallize a changeset — un-crystallized work has nothing a reviewer can pass' })
        } else if (contributionReviewVersion(c) !== latest) {
          const label = `Ask the project owner to start a model review of v${latest}, or review and land manually`
          asks.push({ contributionId: c.id, title: c.title, function: 'error-catching', label })
        }
      }
    }
    // The self-proposed optimization (owner-only): ≥2 manual approvals of
    // MONOTONIC envelopes with no approve-envelope delegation standing —
    // a pattern a draft-mode delegation could hold.
    const hasApproveDelegation = delegations.some((d) => d.projectId === projectId && d.actKind === 'approve-envelope' &&
      (d.expiresAt === undefined || d.expiresAt > Date.now()))
    const proposal =
      contributionRuntimeMode() === 'fixture' && ownerActs && manualMonotonicApprovals >= 2 && !hasApproveDelegation
        ? `${manualMonotonicApprovals} of your approvals were monotonic-only envelopes — a draft-mode delegation could hold these (irreversible ones would still escalate to you).`
        : undefined
    return { humanActs, delegatedActs, machineActs, escalations, asks, ...(proposal ? { proposal } : {}) }
  },

  // ── Delegations (CW8, Phase F) — judgment as delegable work ─────────────────
  /** A Project's delegation roster. Any viewer reads the GOVERNANCE face
   *  (who may decide what, under which triggers); the POLICY text rides only
   *  for the delegator (`publicDelegation`). The route walls visibility. */
  listDelegations(projectId: string, viewerTenant?: string): Delegation[] {
    return delegations.filter((d) => d.projectId === projectId).map((d) => publicDelegation(d, viewerTenant))
  },
  /** Mint a Delegation — the CW8 funnel, with its three STRUCTURAL refusals:
   *  empty policy (a blank check), an escalation set without `effectful`
   *  (the floor is not delegable — the server ADDS it if merely omitted, so
   *  stating it is optional but escaping it is impossible), and a delegate
   *  agent the delegator doesn't own. Project-owner only, raw tenant ids. */
  createDelegation(
    projectId: string,
    req: CreateDelegationRequest,
    tenantId: string,
    options: { logicalId?: string } = {},
  ): Delegation | 'forbidden' | 'invalid' | 'capped' | 'retired' | undefined {
    const project = findProject(projectId)
    if (!project) return undefined
    const ownerTenant = project.tenantId ?? defaultTenantId()
    if (!tenantWritesAs(tenantId, ownerTenant)) return 'forbidden'
    if (options.logicalId) {
      if (!isDelegationCreationId(options.logicalId)) return 'invalid'
      if (delegationRetirements.some((retirement) => retirement.delegationId === options.logicalId)) {
        return 'retired'
      }
      const represented = delegations.find((delegation) => delegation.id === options.logicalId)
      if (represented) {
        if (represented.projectId !== projectId || represented.delegatorTenant !== tenantId) return 'invalid'
        return publicDelegation(represented, tenantId)
      }
    }
    if (delegations.filter((d) => d.projectId === projectId).length >= MAX_DELEGATIONS_PER_PROJECT) return 'capped'
    const agent = WORKER_AGENTS.get(req.agentId)
    if (
      !agent || (agent.tenantId ?? defaultTenantId()) !== tenantId ||
      !DELEGATED_ACT_KINDS.includes(req.actKind) ||
      typeof req.policy !== 'string' || !req.policy.trim() ||
      (req.escalation !== undefined && (!Array.isArray(req.escalation) || req.escalation.some((t) => !ESCALATION_TRIGGERS.includes(t)))) ||
      (req.mode !== undefined && req.mode !== 'draft' && req.mode !== 'decide')
    ) return 'invalid'
    if (req.policy.trim().length > MAX_DELEGATION_POLICY_CHARS ||
      (req.expiresAt !== undefined && (!validDelegationExpiry(req.expiresAt) || req.expiresAt <= Date.now()))) return 'invalid'
    const escalation = ESCALATION_TRIGGERS.filter((trigger) => trigger === 'effectful' || req.escalation?.includes(trigger))
    return commitMutationBatch(() => {
      const id = options.logicalId ?? `delegation-${delegationSeq + 1}`
      if (!options.logicalId) delegationSeq += 1
      const d: StoredDelegation = {
        id,
        projectId,
        agentId: req.agentId,
        agentLabel: agent.label,
        actKind: req.actKind,
        policy: req.policy.trim().slice(0, MAX_DELEGATION_POLICY_CHARS),
        escalation,
        mode: req.mode ?? 'draft',
        createdAt: Date.now(),
        revision: 0,
        ...(req.expiresAt === undefined ? {} : { expiresAt: req.expiresAt }),
        delegatorTenant: tenantId,
      }
      d.versions = delegationVersions(d)
      delegations.push(d)
      emit({ type: 'delegation.changed', projectId })
      persist()
      return publicDelegation(d, tenantId)
    })
  },
  /** Exact-version full replacement. Retained next-version truth proves replay
   * even after later edits; neither Retry nor a stale tab can widen authority. */
  patchDelegation(projectId: string, did: string, request: PatchDelegationRequest, tenantId: string): Delegation | 'forbidden' | undefined {
    const d = delegations.find((row) => row.id === did && row.projectId === projectId)
    const project = findProject(projectId)
    if (!d || !project) return undefined
    if (d.delegatorTenant !== tenantId || !tenantWritesAs(tenantId, project.tenantId ?? defaultTenantId())) return 'forbidden'
    const input = delegationPolicyPatch(request)
    const versions = delegationVersions(d)
    const represented = versions.find((version) => version.revision === input.expectedRevision + 1)
    if (represented && sameDelegationPolicy(represented, input)) return publicDelegation(d, tenantId)
    if (input.expectedRevision !== (d.revision ?? 0)) {
      throw new ConflictError('This Delegation policy changed. Review its current version before editing again.')
    }
    if (versions.length >= MAX_DELEGATION_VERSIONS) throw new ConflictError('This Delegation has reached its 50-version limit. Revoke it and create a replacement.')
    if (input.expiresAt !== null && input.expiresAt <= Date.now()) throw new ValidationError('The expiry must be in the future.')
    const version = {
      revision: input.expectedRevision + 1, policy: input.policy, escalation: input.escalation, mode: input.mode,
      ...(input.expiresAt === null ? {} : { expiresAt: input.expiresAt }),
      updatedAt: Math.max(Date.now(), versions.at(-1)!.updatedAt),
    }
    return commitMutationBatch(() => {
      d.policy = version.policy
      d.escalation = version.escalation
      d.mode = version.mode
      d.revision = version.revision
      if (version.expiresAt === undefined) delete d.expiresAt
      else d.expiresAt = version.expiresAt
      d.versions = [...versions, version]
      emit({ type: 'delegation.changed', projectId })
      persist()
      return publicDelegation(d, tenantId)
    })
  },
  /** Revoke — the delegator's one-tap descent (always free, CW8's ladder).
   *  The PROJECT OWNER's write-union may also revoke (review finding: a seat-
   *  holder who minted and then lost the seat must not leave an irrevocable
   *  row squatting on the roster — the owner governs their project's gates).
   *  The creation stamp and policy revision pin first-party consent. A keyed act also
   *  leaves a private durable receipt; every keyed-created row leaves a
   *  tombstone so a delayed creation Retry cannot resurrect revoked authority. */
  deleteDelegation(
    projectId: string,
    did: string,
    tenantId: string,
    options: { expectedCreatedAt?: number; expectedRevision?: number; revocationId?: string } = {},
  ): true | 'forbidden' | 'invalid' | undefined {
    if (options.revocationId) {
      const replay = delegationRevocationReceipt(
        options.revocationId,
        projectId,
        did,
        options.expectedCreatedAt,
        tenantId,
        options.expectedRevision,
      )
      if (replay !== undefined) return replay
    }
    const i = delegations.findIndex((d) => d.id === did && d.projectId === projectId)
    if (i < 0) return undefined
    const ownerTenant = findProject(projectId)?.tenantId ?? defaultTenantId()
    if (delegations[i].delegatorTenant !== tenantId && !tenantWritesAs(tenantId, ownerTenant)) return 'forbidden'
    const delegation = delegations[i]
    if (options.expectedRevision !== undefined && options.expectedRevision !== (delegation.revision ?? 0)) {
      throw new ConflictError('This Delegation policy changed. Review its current version before revoking it.')
    }
    if (options.expectedCreatedAt !== undefined && options.expectedCreatedAt !== delegation.createdAt) {
      throw new ConflictError(
        `This delegation no longer matches the reviewed authority (expected creation stamp ${options.expectedCreatedAt}, current stamp ${delegation.createdAt}).`,
      )
    }
    return commitMutationBatch(() => {
      delegations.splice(i, 1)
      if (isDelegationCreationId(delegation.id) || options.revocationId) {
        delegationRetirements.push({
          delegationId: delegation.id,
          projectId,
          createdAt: delegation.createdAt,
          ...(options.revocationId
            ? {
                revocationId: options.revocationId,
                revokedByTenant: tenantId,
                ...(options.expectedCreatedAt === undefined ? {} : { expectedCreatedAt: options.expectedCreatedAt }),
                ...(options.expectedRevision === undefined ? {} : { expectedRevision: options.expectedRevision }),
              }
            : {}),
        })
      }
      emit({ type: 'delegation.changed', projectId })
      persist()
      return true
    })
  },
  /** Exact private receipt for a keyed revocation. Changed precondition reuse is
   *  invalid; absence means the operation is not durably represented. */
  getDelegationRevocation(
    revocationId: string,
    projectId: string,
    did: string,
    expectedCreatedAt: number | undefined,
    tenantId: string,
    expectedRevision?: number,
  ): true | 'invalid' | undefined {
    return delegationRevocationReceipt(revocationId, projectId, did, expectedCreatedAt, tenantId, expectedRevision)
  },
  /** Current containing ledger row for one exact delegated-judgment receipt.
   * Replay does not depend on the Delegation still standing or on the acted-on
   * envelope/status remaining current: the immutable event owns that answer. */
  getDelegatedJudgment(
    id: string,
    projectId: string,
    contributionId: string,
    delegationId: string,
    tenantId: string,
  ): Contribution | 'invalid' | undefined {
    if (!isDelegatedJudgmentId(id)) return 'invalid'
    const contribution = contributions.find(
      (candidate) => candidate.id === contributionId && candidate.projectId === projectId,
    )
    if (!contribution) return undefined
    // A real attempt cannot be adopted by the legacy fixture path, including
    // while pending or after an uncertain result without a timeline event.
    if (contributions.some((candidate) => candidate.judgmentAttempts?.some((run) => run.id === id))) return 'invalid'
    const event = contribution.events.find((candidate) => candidate.id === id)
    if (!event) {
      const collision = contributions.some((candidate) => candidate.events.some((entry) => entry.id === id))
      return collision ? 'invalid' : undefined
    }
    if (
      !['delegated-decision', 'delegated-draft', 'delegated-escalation'].includes(event.kind) ||
      event.delegationId !== delegationId ||
      event.delegatedByTenant !== tenantId
    ) return 'invalid'
    return publicContribution(contribution, tenantId)
  },
  /** Exercise a Delegation on one contribution. The order is load-bearing:
   *  1. SEPARATION OF DUTIES — the contributor may never trigger the decision
   *     on their own work (self-approval unrepresentable), unless they ARE the
   *     delegator (then it's the owner's own authority, delegation moot).
   *  2. The MECHANICAL escalation triggers — checked structurally, no model:
   *     any named condition holding ⇒ the delegate does NOT decide; an
   *     `delegated-escalation` event wakes the human instead.
   *  3. The DECISION (the model-seam: the mock always finds the policy
   *     satisfied) — `draft` mode records the guess; `decide` mode EXECUTES
   *     the act AS THE DELEGATOR, the event dual-stamped
   *     ("‹Agent› for ‹Owner› · delegation-N") — the conservation law. */
  runDelegation(
    projectId: string,
    cid: string,
    did: string,
    tenantId: string,
    principal: PrincipalRef | undefined,
    options: { logicalId?: string } = {},
  ): Contribution | 'forbidden' | 'self' | 'inapplicable' | 'invalid' | 'unconfigured' | undefined {
    if (contributionRuntimeMode() === 'unconfigured') return 'unconfigured'
    if (options.logicalId) {
      const represented = this.getDelegatedJudgment(options.logicalId, projectId, cid, did, tenantId)
      if (typeof represented === 'object') return represented
      if (represented === 'invalid') return 'invalid'
    }
    const d = delegations.find((x) => x.id === did && x.projectId === projectId)
    const c = contributions.find((x) => x.id === cid && x.projectId === projectId)
    if (!d || !c) return undefined
    if (d.expiresAt !== undefined && d.expiresAt <= Date.now()) return 'inapplicable'
    if (c.status !== 'open') return 'inapplicable'
    const isContributor = c.contributorTenant !== undefined && c.contributorTenant === tenantId
    if (isContributor && tenantId !== d.delegatorTenant) return 'self'
    // The decide path appends TWO events (the act's own + the decision record),
    // so it needs two slots under the bound (review finding: no overshoot).
    if (c.events.length >= MAX_CONTRIBUTION_EVENTS - 1) return 'inapplicable'
    const now = Date.now()
    const stamp = `${d.agentLabel} for ${tenantName(d.delegatorTenant)} · ${d.id}`
    const pushEvent = (kind: 'delegated-decision' | 'delegated-draft' | 'delegated-escalation', body: string) => {
      c.events.push({
        id: options.logicalId ?? `cev-${(contributionSeq += 1)}`,
        kind,
        at: now,
        actor: stamp,
        body,
        delegationId: d.id,
        delegationRevision: d.revision ?? 0,
        ...(options.logicalId ? { delegatedByTenant: tenantId } : {}),
        ...(principal ? { principal } : {}),
      })
      emit({ type: 'contribution.changed', projectId })
      persist()
    }
    // The act must be pending: approve-envelope needs a proposed envelope;
    // land needs an open contribution (already checked).
    if (d.actKind === 'approve-envelope' && c.envelope?.status !== 'proposed') return 'inapplicable'
    // Mechanical triggers — structural facts, checked for real, through the
    // SAME definitions the tier arithmetic uses (one source: drift between the
    // two is what would un-delegate the floor — review finding).
    return commitMutationBatch(() => {
      const holds: Record<import('../../contract/index.ts').EscalationTrigger, boolean> = {
        effectful: isEffectfulContribution(c),
        unreviewed: (c.changeset?.length ?? 0) === 0 || c.reviewedVersion !== c.changeset!.length,
        stranger: landedCountFor(projectId, c.contributorTenant) === 0,
      }
      const fired = d.escalation.filter((t) => holds[t])
      if (fired.length > 0) {
        pushEvent('delegated-escalation', `escalated to ${tenantName(d.delegatorTenant)} — ${fired.join(', ')}`)
        return publicContribution(c, tenantId)
      }
      const verdict = `policy satisfied (mock) — would ${d.actKind === 'land' ? 'land' : 'approve the envelope'}`
      if (d.mode === 'draft') {
        pushEvent('delegated-draft', verdict)
        return publicContribution(c, tenantId)
      }
      // Decide: execute AS the delegator (the conservation law), the act's own
      // event dual-stamped FROM THE START via `eventActor`. The outer batch
      // commits that act and this receipt in one durable snapshot.
      const out =
        d.actKind === 'approve-envelope'
          ? this.approveEnvelope(projectId, cid, d.delegatorTenant, principal, stamp)
          : this.landContribution(projectId, cid, d.delegatorTenant, principal, { eventActor: stamp })
      if (typeof out !== 'object') return 'inapplicable'
      pushEvent('delegated-decision', verdict.replace('would ', ''))
      return publicContribution(c, tenantId)
    })
  },

  /** Owner-started policy evaluation. Durable admission precedes the one paid
   * request; a result is advice until current authority proves the exact act. */
  async runDelegatedModelJudgment(
    projectId: string,
    cid: string,
    did: string,
    tenantId: string,
    principal: PrincipalRef | undefined,
    logicalId: string,
    request: DelegatedJudgmentRequest,
  ): Promise<Contribution | 'forbidden' | 'invalid' | 'conflict' | 'unconfigured' | 'limit' | undefined> {
    if (!isDelegatedJudgmentId(logicalId) || !validJudgmentRequest(request)) return 'invalid'
    const c = contributions.find((entry) => entry.id === cid && entry.projectId === projectId)
    if (!c) return undefined
    const represented = c.judgmentAttempts?.find((run) => run.id === logicalId)
    if (represented) {
      return represented.tenantId === tenantId && represented.delegationId === did && sameJudgmentRequest(represented.request, request)
        ? publicContribution(c, tenantId) : 'conflict'
    }
    if (contributions.some((entry) => entry.events.some((event) => event.id === logicalId) ||
      entry.judgmentAttempts?.some((run) => run.id === logicalId))) return 'conflict'
    if (!this.contributionReviewOwner(projectId, tenantId)) return 'forbidden'
    const d = delegations.find((entry) => entry.id === did && entry.projectId === projectId)
    if (!d) return undefined
    if (d.delegatorTenant !== tenantId) return 'forbidden'
    const applicable = (): boolean => c.status === 'open' &&
      (d.expiresAt === undefined || d.expiresAt > Date.now()) &&
      (d.actKind === 'approve-envelope' ? c.envelope?.status === 'proposed' : !!c.changeset?.length && c.envelope?.status !== 'proposed')
    if (!applicable() || (d.revision ?? 0) !== request.expectedDelegationRevision ||
      (c.changeset?.at(-1)?.version ?? null) !== request.expectedChangesetVersion ||
      (c.envelope?.version ?? null) !== request.expectedEnvelopeVersion ||
      (c.judgmentAttempts?.length ?? 0) >= MAX_DELEGATED_JUDGMENTS ||
      c.judgmentAttempts?.some((run) => run.status === 'pending') || c.events.length >= MAX_CONTRIBUTION_EVENTS - 1) return 'conflict'

    const binding = structuredClone(request.reviewer)
    const agent = WORKER_AGENTS.get(binding.agentId)
    const provider = this.listProviders(tenantId).find((entry) => entry.id === binding.providerId)
    if (!agent || !provider) return undefined
    const bindingCurrent = (): boolean => {
      const currentAgent = WORKER_AGENTS.get(binding.agentId)
      const currentProvider = this.listProviders(tenantId).find((entry) => entry.id === binding.providerId)
      return !!currentAgent && !!currentProvider && d.agentId === binding.agentId &&
        (currentAgent.tenantId ?? defaultTenantId()) === tenantId && currentAgent.providerId === binding.providerId &&
        (currentAgent.revision ?? 0) === binding.agentRevision && (currentProvider.definitionRevision ?? 0) === binding.providerRevision &&
        (currentProvider.connectionRevision ?? 0) === binding.connectionRevision
    }
    if (!bindingCurrent()) return 'conflict'
    const config = structuredClone(PROVIDER_CONFIGS.get(provider.id) ?? {})
    if (provider.kind === 'session' || endpointExecution(config) !== 'configured') return 'unconfigured'
    if (this.overSpendLimit(provider.plan, tenantId) || this.overSpendLimit(agent.budget, tenantId)) return 'limit'
    const captureInput = (): DelegatedJudgmentInput => structuredClone({
      policy: {
        actKind: d.actKind, mode: d.mode, policy: d.policy!, escalation: d.escalation, revision: d.revision ?? 0,
        ...(d.expiresAt === undefined ? {} : { expiresAt: d.expiresAt }),
      },
      changeset: c.changeset?.at(-1) ?? null,
      envelope: publicContribution(c).envelope ?? null,
      risk: {
        effectful: isEffectfulContribution(c),
        unreviewed: !c.changeset?.length || contributionReviewVersion(c) !== c.changeset.at(-1)!.version,
        stranger: landedCountFor(projectId, c.contributorTenant) === 0,
        readOnlyEnvelope: (c.envelope?.lines ?? []).every((line) => isProjectEffectMonotonic(line.type)),
      },
    })
    const contextHash = (input: DelegatedJudgmentInput): string => judgmentContextHash({
      input, contributor: c.contributorTenant, owner: findProject(projectId)?.tenantId ?? defaultTenantId(),
      reviewRequired: c.reviewRequired === true, reviewedVersion: contributionReviewVersion(c),
    })
    const frozen = captureInput()
    const run: StoredDelegatedJudgment = {
      id: logicalId, delegationId: did, delegationRevision: d.revision ?? 0, actKind: d.actKind, mode: d.mode,
      changesetVersion: request.expectedChangesetVersion, envelopeVersion: request.expectedEnvelopeVersion,
      reviewer: agent.label, provider: provider.label, model: resolvedModelId(config),
      startedAt: Math.max(Date.now(), (c.judgmentAttempts?.at(-1)?.startedAt ?? 0) + 1), status: 'pending',
      tenantId, request: structuredClone(request), delegationCreatedAt: d.createdAt, contextHash: contextHash(frozen),
    }
    const fence = {}
    commitMutationBatch(() => {
      c.judgmentAttempts ??= []
      c.judgmentAttempts.push(run)
      emit({ type: 'contribution.changed', projectId })
      persist()
    })
    activeDelegatedJudgments.set(logicalId, fence)
    try {
      let result: { decision: 'approve' | 'decline' | 'escalate'; summary: string } | undefined
      let failure: 'failed' | 'uncertain' | undefined
      const fired = frozen.policy.escalation.filter((trigger) => frozen.risk[trigger])
      // The hard floor is independent of editable triggers and model output.
      if (frozen.risk.effectful || !frozen.risk.readOnlyEnvelope || fired.length) {
        result = { decision: 'escalate', summary: `Human judgment required: ${fired.length ? fired.join(', ') : 'external effects'}. No model request was sent.` }
      } else {
        try {
          result = await generateDelegatedJudgment(frozen, config, (usage) => {
            if (activeDelegatedJudgments.get(logicalId) !== fence) throw new Error('Judgment execution was replaced.')
            this.recordUsage(usage.inputTokens, usage.outputTokens, tenantId)
          })
        } catch (error) {
          if (error instanceof UsageRecordingError) throw error.cause ?? error
          failure = error instanceof DelegatedJudgmentGenerationError ? 'failed' : 'uncertain'
        }
      }
      if (activeDelegatedJudgments.get(logicalId) !== fence) return 'conflict'
      return commitMutationBatch(() => {
        run.finishedAt = Math.max(Date.now(), run.startedAt)
        if (!result) run.status = failure ?? 'uncertain'
        else {
          run.decision = result.decision
          run.summary = result.summary
          const currentGrant = delegations.find((entry) => entry.id === did && entry.projectId === projectId)
          const current = this.contributionReviewOwner(projectId, tenantId) && currentGrant === d &&
            d.delegatorTenant === tenantId && d.createdAt === run.delegationCreatedAt &&
            (d.revision ?? 0) === run.delegationRevision && applicable() && bindingCurrent() &&
            JSON.stringify(PROVIDER_CONFIGS.get(provider.id) ?? {}) === JSON.stringify(config) &&
            contextHash(captureInput()) === run.contextHash && c.events.length < MAX_CONTRIBUTION_EVENTS - 1
          if (!current) run.status = 'stale'
          else {
            const stamp = `${run.reviewer} for ${tenantName(tenantId)} · ${did} v${run.delegationRevision}`
            run.status = result.decision === 'decline' ? 'declined' : result.decision === 'escalate' ? 'escalated' : d.mode === 'draft' ? 'draft' : 'decided'
            if (run.status === 'decided') {
              const applied = d.actKind === 'approve-envelope'
                ? this.approveEnvelope(projectId, cid, tenantId, principal, stamp, { expectedVersion: run.envelopeVersion! })
                : this.landContribution(projectId, cid, tenantId, principal, { eventActor: stamp })
              if (typeof applied !== 'object') run.status = 'stale'
            }
            if (run.status !== 'stale') c.events.push({
              id: logicalId, at: run.finishedAt, actor: stamp, delegationId: did, delegationRevision: run.delegationRevision,
              delegatedByTenant: tenantId, ...(principal ? { principal } : {}),
              kind: run.status === 'decided' ? 'delegated-decision' : run.status === 'draft' ? 'delegated-draft' :
                run.status === 'declined' ? 'delegated-decline' : 'delegated-escalation',
              // Public history never contains model prose derived from private policy.
              body: run.status === 'decided' ? 'Applied the approved delegated act.' : run.status === 'draft' ? 'Recommended approval; no act applied.' :
                run.status === 'declined' ? 'Declined the delegated act; the owner remains in control.' : 'Escalated to the owner; no act applied.',
            })
          }
        }
        emit({ type: 'contribution.changed', projectId })
        persist()
        return publicContribution(c, tenantId)
      })
    } finally {
      if (activeDelegatedJudgments.get(logicalId) === fence) activeDelegatedJudgments.delete(logicalId)
    }
  },

  // ── The review tier (CW5, Phase E) — the gate as arithmetic ─────────────────
  contributionReviewOwner(projectId: string, tenantId: string): boolean {
    const project = findProject(projectId)
    return !!project && tenantWritesAs(tenantId, project.tenantId ?? defaultTenantId())
  },
  /** One explicit owner-funded, tool-free call. The pending receipt is the
   * durable execution boundary; no catch/replay path may dispatch it again. */
  async runContributionModelReview(
    projectId: string,
    cid: string,
    tenantId: string,
    logicalId: string,
    expectedVersion: number,
    binding: ContributionReviewerBinding,
  ): Promise<Contribution | 'forbidden' | 'invalid' | 'conflict' | 'unconfigured' | 'limit' | undefined> {
    if (!this.contributionReviewOwner(projectId, tenantId)) return 'forbidden'
    if (!isContributionReviewId(logicalId) || !Number.isSafeInteger(expectedVersion) || expectedVersion < 1 || !validReviewerBinding(binding)) return 'invalid'
    const c = contributions.find((entry) => entry.id === cid && entry.projectId === projectId)
    if (!c) return undefined
    const represented = c.reviewAttempts?.find((run) => run.id === logicalId)
    if (represented) {
      return represented.tenantId === tenantId && represented.version === expectedVersion && sameReviewerBinding(represented.binding, binding)
        ? publicContribution(c, tenantId) : 'conflict'
    }
    if (contributions.some((entry) => entry.events.some((event) => event.id === logicalId) || entry.reviewAttempts?.some((run) => run.id === logicalId))) return 'conflict'
    const version = c.changeset?.at(-1)
    if (c.status !== 'open' || !version || version.version !== expectedVersion ||
      (c.reviewAttempts?.length ?? 0) >= MAX_CONTRIBUTION_REVIEWS || c.reviewAttempts?.some((run) => run.status === 'pending')) return 'conflict'
    // Exact scoped lookups, never the conversation seam's default fallback.
    const agent = this.listAgents(tenantId).find((entry) => entry.id === binding.agentId)
    const provider = this.listProviders(tenantId).find((entry) => entry.id === binding.providerId)
    if (!agent || !provider) return undefined
    if (agent.providerId !== provider.id || (agent.revision ?? 0) !== binding.agentRevision ||
      (provider.definitionRevision ?? 0) !== binding.providerRevision || (provider.connectionRevision ?? 0) !== binding.connectionRevision) return 'conflict'
    const config = structuredClone(PROVIDER_CONFIGS.get(provider.id) ?? {})
    if (provider.kind === 'session' || endpointExecution(config) !== 'configured') return 'unconfigured'
    if (this.overSpendLimit(provider.plan, tenantId) || this.overSpendLimit(agent.budget, tenantId)) return 'limit'
    const frozenVersion = structuredClone(version)
    const frozenAgent = structuredClone(agent)
    const run: StoredContributionReview = {
      id: logicalId, version: expectedVersion, tenantId, binding: { ...binding },
      changesetHash: reviewChangesetHash(frozenVersion),
      reviewer: agent.label, provider: provider.label, model: resolvedModelId(config),
      startedAt: Math.max(Date.now(), (c.reviewAttempts?.at(-1)?.startedAt ?? 0) + 1), status: 'pending',
    }
    const fence = {}
    commitMutationBatch(() => {
      c.reviewAttempts ??= []
      c.reviewAttempts.push(run)
      emit({ type: 'contribution.changed', projectId })
      persist()
    })
    activeContributionReviews.set(logicalId, fence)
    try {
      let result: import('../../contract/index.ts').ContributionReviewResult | undefined
      let failure: 'failed' | 'uncertain' | undefined
      try {
        result = await generateContributionReview(frozenVersion, frozenAgent, config, (usage) => {
          // A restore fences callbacks from the replaced world as well as its verdict.
          if (activeContributionReviews.get(logicalId) !== fence) throw new Error('Review execution was replaced.')
          this.recordUsage(usage.inputTokens, usage.outputTokens, tenantId)
        })
      } catch (error) {
        if (error instanceof UsageRecordingError) throw error.cause ?? error
        failure = error instanceof ContributionReviewGenerationError ? 'failed' : 'uncertain'
      }
      if (activeContributionReviews.get(logicalId) !== fence) return 'conflict'
      return commitMutationBatch(() => {
        run.finishedAt = Math.max(Date.now(), run.startedAt)
        if (result) {
          run.summary = result.summary
          run.findings = result.findings
          run.status = c.status !== 'open' || !c.changeset?.at(-1) || reviewChangesetHash(c.changeset.at(-1)!) !== run.changesetHash
            ? 'stale' : result.findings.length ? 'findings' : 'passed'
        } else run.status = failure ?? 'uncertain'
        emit({ type: 'contribution.changed', projectId })
        persist()
        return publicContribution(c, tenantId)
      })
    } finally {
      if (activeContributionReviews.get(logicalId) === fence) activeContributionReviews.delete(logicalId)
    }
  },
  /** Current containing ledger row for one durable exact-version review receipt. */
  getContributionReview(
    id: string,
    projectId: string,
    contributionId: string,
    tenantId: string,
    expectedVersion?: number,
  ): Contribution | 'invalid' | undefined {
    if (!isContributionReviewId(id)) return 'invalid'
    const contribution = contributions.find(
      (candidate) => candidate.id === contributionId && candidate.projectId === projectId,
    )
    if (!contribution) return undefined
    const event = contribution.events.find((candidate) => candidate.id === id)
    if (!event) {
      const collision = contributions.some((candidate) => candidate.events.some((entry) => entry.id === id))
      return collision ? 'invalid' : undefined
    }
    if (
      event.kind !== 'review-passed' ||
      !Number.isSafeInteger(event.reviewedVersion) ||
      (event.reviewedVersion ?? 0) < 1 ||
      event.reviewedByTenant !== tenantId ||
      (expectedVersion !== undefined && event.reviewedVersion !== expectedVersion)
    ) return 'invalid'
    return publicContribution(contribution, tenantId)
  },
  /** Current containing ledger row for one durable review-requirement receipt. */
  getContributionReviewRequirement(
    id: string,
    projectId: string,
    contributionId: string,
    tenantId: string,
  ): Contribution | 'invalid' | undefined {
    if (!isContributionReviewRequirementId(id)) return 'invalid'
    const contribution = contributions.find(
      (candidate) => candidate.id === contributionId && candidate.projectId === projectId,
    )
    if (!contribution) return undefined
    const event = contribution.events.find((candidate) => candidate.id === id)
    if (!event) {
      const collision = contributions.some((candidate) => candidate.events.some((entry) => entry.id === id))
      return collision ? 'invalid' : undefined
    }
    if (
      event.kind !== 'review-required' ||
      event.reviewRequiredByTenant !== tenantId ||
      contribution.reviewRequired !== true
    ) return 'invalid'
    return publicContribution(contribution, tenantId)
  },
  /** The owner's explicit tightening: force ≥ Tier 1 on a contribution the
   *  arithmetic would auto-land. TIGHTEN-ONLY is structural — no op unsets the
   *  flag (loosening a computed gate is unrepresentable, D8's discipline
   *  applied to review). Owner only; open contributions only. */
  requireContributionReview(
    projectId: string,
    cid: string,
    tenantId: string,
    principal: PrincipalRef | undefined,
    options: { logicalId?: string } = {},
  ): Contribution | 'forbidden' | 'conflict' | 'invalid' | undefined {
    if (options.logicalId) {
      const represented = this.getContributionReviewRequirement(
        options.logicalId,
        projectId,
        cid,
        tenantId,
      )
      if (typeof represented === 'object') return represented
      if (represented === 'invalid') return 'invalid'
    }
    const c = contributions.find((x) => x.id === cid && x.projectId === projectId)
    if (!c) return undefined
    const ownerTenant = findProject(projectId)?.tenantId ?? defaultTenantId()
    if (!tenantWritesAs(tenantId, ownerTenant)) return 'forbidden'
    if (c.status !== 'open' || c.reviewRequired === true) return 'conflict'
    if (c.events.length >= MAX_CONTRIBUTION_EVENTS) return 'conflict'
    return commitMutationBatch(() => {
      c.reviewRequired = true
      c.events.push({
        id: options.logicalId ?? `cev-${(contributionSeq += 1)}`,
        kind: 'review-required',
        at: Date.now(),
        actor: tenantName(tenantId),
        ...(options.logicalId ? { reviewRequiredByTenant: tenantId } : {}),
        ...(principal ? { principal } : {}),
      })
      emit({ type: 'contribution.changed', projectId })
      persist()
      return publicContribution(c, tenantId)
    })
  },
  /** Run the Tier-1 adversarial review — the declared MODEL-SEAM: the interface
   *  is real (a verdict over the latest crystallized version, recorded on the
   *  timeline, consumed by the landing gate), the cognition is canned (the mock
   *  reviewer confirms no findings; a real deployment points this at a refuter-
   *  prompted agent). Any viewer may trigger it (it is a machine act, not a
   *  judgment — the route walls visibility); it requires something to review. */
  reviewContribution(
    projectId: string,
    cid: string,
    tenantId: string,
    principal: PrincipalRef | undefined,
    options: { logicalId?: string; expectedVersion?: number } = {},
  ): Contribution | 'nothing' | 'stale' | 'conflict' | 'invalid' | 'unconfigured' | undefined {
    if (contributionRuntimeMode() === 'unconfigured') return 'unconfigured'
    if (options.logicalId) {
      const represented = this.getContributionReview(
        options.logicalId,
        projectId,
        cid,
        tenantId,
        options.expectedVersion,
      )
      if (typeof represented === 'object') return represented
      if (represented === 'invalid') return 'invalid'
    }
    const c = contributions.find((x) => x.id === cid && x.projectId === projectId)
    if (!c) return undefined
    const latest = c.changeset?.length ?? 0
    if (c.status !== 'open' || latest === 0) return 'nothing'
    if (
      options.expectedVersion !== undefined &&
      (!Number.isSafeInteger(options.expectedVersion) || options.expectedVersion < 1)
    ) return 'invalid'
    if (options.expectedVersion !== undefined && options.expectedVersion !== latest) return 'stale'
    if (c.events.length >= MAX_CONTRIBUTION_EVENTS) return 'conflict'
    return commitMutationBatch(() => {
      c.reviewedVersion = latest
      c.events.push({
        id: options.logicalId ?? `cev-${(contributionSeq += 1)}`,
        kind: 'review-passed',
        at: Date.now(),
        actor: 'Adversarial reviewer (mock)',
        body: `no confirmed findings · v${latest}`,
        reviewedVersion: latest,
        ...(options.logicalId ? { reviewedByTenant: tenantId } : {}),
        ...(principal ? { principal } : {}),
      })
      emit({ type: 'contribution.changed', projectId })
      persist()
      return publicContribution(c, tenantId)
    })
  },

  // ── The changeset (CW3/CW4, Phase D) — crystallization without amnesia ──────
  /** Current containing ledger row for one durable crystallization receipt.
   * The exact normalized payload must still match, so reusing a key cannot
   * redirect an already-acknowledged append to different changes. */
  getContributionCrystallization(
    id: string,
    projectId: string,
    contributionId: string,
    req: import('../../contract/index.ts').CrystallizeRequest,
    tenantId: string,
  ): Contribution | 'invalid' | undefined {
    if (!isContributionCrystallizationId(id)) return 'invalid'
    const contribution = contributions.find(
      (candidate) => candidate.id === contributionId && candidate.projectId === projectId,
    )
    if (!contribution) return undefined
    const event = contribution.events.find((candidate) => candidate.id === id)
    if (!event) {
      const collision = contributions.some((candidate) => candidate.events.some((entry) => entry.id === id))
      return collision ? 'invalid' : undefined
    }
    const entries = normalizedCrystallizationEntries(req)
    if (
      event.kind !== 'crystallized' ||
      !Number.isSafeInteger(event.changesetVersion) ||
      (event.changesetVersion ?? 0) < 1 ||
      event.crystallizedByTenant !== tenantId ||
      !entries
    ) return 'invalid'
    const version = contribution.changeset?.find((candidate) => candidate.version === event.changesetVersion)
    if (!version || !crystallizationMatchesVersion(entries, version)) return 'invalid'
    return publicContribution(contribution, tenantId)
  },
  /** Crystallize a changeset version: the work's mergeable payload as typed
   *  before→after entries, APPENDED as v(n+1) — never rewriting a prior
   *  version (no force-push; the revision history is the record, and the
   *  event body carries the REVIEW DELTA vs the prior version). Contributor
   *  or owner only (authoring the changeset is the work's own act, unlike the
   *  open deliberation of notes/envelope proposals); open contributions only. */
  crystallizeContribution(
    projectId: string,
    cid: string,
    req: import('../../contract/index.ts').CrystallizeRequest,
    tenantId: string,
    principal: PrincipalRef | undefined,
    options: { logicalId?: string } = {},
  ): Contribution | 'forbidden' | 'closed' | 'invalid' | 'capped' | undefined {
    if (options.logicalId) {
      const represented = this.getContributionCrystallization(options.logicalId, projectId, cid, req, tenantId)
      if (typeof represented === 'object') return represented
      if (represented === 'invalid') {
        throw new ValidationError('That Contribution crystallization identity is not valid for this account, ledger row, and payload.')
      }
    }
    const c = contributions.find((x) => x.id === cid && x.projectId === projectId)
    if (!c) return undefined
    const ownerTenant = findProject(projectId)?.tenantId ?? defaultTenantId()
    const isContributor = c.contributorTenant !== undefined && c.contributorTenant === tenantId
    if (!isContributor && !tenantWritesAs(tenantId, ownerTenant)) return 'forbidden'
    if (c.status !== 'open') return 'closed'
    const entries = normalizedCrystallizationEntries(req)
    if (!entries) return 'invalid'
    const versions = c.changeset ?? []
    if (versions.length >= MAX_CHANGESET_VERSIONS) return 'capped'
    if (c.events.length >= MAX_CONTRIBUTION_EVENTS) return 'capped'
    const now = Date.now()
    const actor = tenantName(tenantId)
    const version: import('../../contract/index.ts').ChangesetVersion = {
      version: versions.length + 1,
      at: now,
      by: actor,
      entries: entries.map((entry) => ({
        id: `cev-${(contributionSeq += 1)}`,
        ...entry,
      })),
    }
    // The review delta vs the prior version, keyed by (kind, target): what a
    // returning reviewer reads first (CW4 — "what changed since I looked").
    const prior = versions.at(-1)
    let delta = ''
    if (prior) {
      const key = (e: { kind: string; target: string }) => `${e.kind}:${e.target}`
      const prev = new Map(prior.entries.map((e) => [key(e), e]))
      const next = new Map(version.entries.map((e) => [key(e), e]))
      let added = 0, removed = 0, changed = 0
      for (const [k, e] of next) {
        const p = prev.get(k)
        if (!p) added += 1
        else if (p.after !== e.after || (p.before ?? '') !== (e.before ?? '')) changed += 1
      }
      for (const k of prev.keys()) if (!next.has(k)) removed += 1
      delta = ` (vs v${prior.version}: +${added} −${removed} ~${changed})`
    }
    return commitMutationBatch(() => {
      c.changeset = [...versions, version]
      c.events.push({
        id: options.logicalId ?? `cev-${(contributionSeq += 1)}`,
        kind: 'crystallized',
        at: now,
        actor,
        changesetVersion: version.version,
        body: `v${version.version} · ${version.entries.length} change${version.entries.length === 1 ? '' : 's'}${delta}`,
        ...(options.logicalId ? { crystallizedByTenant: tenantId } : {}),
        ...(principal ? { principal } : {}),
      })
      emit({ type: 'contribution.changed', projectId })
      persist()
      return publicContribution(c, tenantId)
    })
  },

  // ── The effect envelope (CW1, Phase C) — approval before action ─────────────
  /** Propose or AMEND a contribution's envelope: a new version, status
   *  `proposed` — an amendment structurally invalidates the prior approval
   *  (the approval names the version it covered; CW4 append-only applies to
   *  authorization too). Anyone who can SEE the project may propose/counter-
   *  propose (deliberation is open — the route walls visibility); APPROVAL is
   *  the gate, not proposal. Open contributions only: a landed one's plan is
   *  immutable history. */
  getContributionEnvelopeProposal(
    id: string,
    projectId: string,
    contributionId: string,
    req: import('../../contract/index.ts').ProposeEnvelopeRequest,
    tenantId: string,
    actorUserId?: string,
  ): Contribution | 'invalid' | undefined {
    if (!isContributionEnvelopeProposalId(id)) return 'invalid'
    const contribution = contributions.find(
      (candidate) => candidate.id === contributionId && candidate.projectId === projectId,
    )
    if (!contribution) return undefined
    const event = contribution.events.find((candidate) => candidate.id === id)
    if (!event) {
      const collision = contributions.some((candidate) => candidate.events.some((entry) => entry.id === id))
      return collision ? 'invalid' : undefined
    }
    const lines = normalizedEnvelopeProposalLines(req)
    if (
      event.kind !== 'envelope-proposed' ||
      !Number.isSafeInteger(event.envelopeVersion) ||
      (event.envelopeVersion ?? 0) < 1 ||
      event.proposedByTenant !== tenantId ||
      event.envelopeProposalExpectedVersion !== req.expectedVersion ||
      !lines ||
      !event.envelopeProposalLines ||
      !envelopeProposalLinesMatch(lines, event.envelopeProposalLines)
    ) return 'invalid'
    const ownerUserId = contributionMcpProposalOwner(event)
    if (ownerUserId && activeMcpActor(tenantId, actorUserId) !== ownerUserId) return 'invalid'
    return publicContribution(contribution, tenantId, actorUserId)
  },
  /** Inspection/schema work is local and may await. Re-enter the synchronous
   * proposal funnel only if the original world and exact authority still hold. */
  async proposeMcpEnvelope(
    projectId: string,
    cid: string,
    req: import('../../contract/index.ts').ProposeEnvelopeRequest,
    tenantId: string,
    principal: PrincipalRef | undefined,
    options: { logicalId?: string } = {},
  ): Promise<Contribution | 'closed' | 'invalid' | 'forbidden' | 'conflict' | 'capped' | undefined> {
    if (!this.grantSubjectVisible({ kind: 'project', id: projectId }, tenantId)) return undefined
    if (!options.logicalId || !Number.isSafeInteger(req.expectedVersion) || (req.expectedVersion ?? -1) < 0) return 'invalid'
    const actorUserId = principal?.kind === 'user' ? activeMcpActor(tenantId, principal.id) : undefined
    const represented = this.getContributionEnvelopeProposal(options.logicalId, projectId, cid, req, tenantId, actorUserId)
    if (represented !== undefined) return represented
    const c = contributions.find((entry) => entry.id === cid && entry.projectId === projectId)
    if (!c) return undefined
    const lines = normalizedEnvelopeProposalLines(req)
    if (!lines || !lines.some((line) => line.mcp)) return 'invalid'
    const request = { lines, expectedVersion: req.expectedVersion }
    const preparedLines = await prepareContributionMcpLines(this, tenantId, lines, actorUserId)
    if (!preparedLines) return 'invalid'
    if (!contributions.includes(c)) return 'conflict'
    if (!this.grantSubjectVisible({ kind: 'project', id: projectId }, tenantId)) return undefined
    return this.proposeEnvelope(projectId, cid, request, tenantId, principal, { ...options, preparedLines })
  },
  proposeEnvelope(
    projectId: string,
    cid: string,
    req: import('../../contract/index.ts').ProposeEnvelopeRequest,
    tenantId: string,
    principal: PrincipalRef | undefined,
    options: { logicalId?: string; preparedLines?: Array<Omit<StoredContributionEnvelopeLine, 'id' | 'used'>> } = {},
  ): Contribution | 'closed' | 'invalid' | 'forbidden' | 'conflict' | 'capped' | undefined {
    const actorUserId = principal?.kind === 'user' ? activeMcpActor(tenantId, principal.id) : undefined
    if (
      req.expectedVersion !== undefined &&
      (!Number.isSafeInteger(req.expectedVersion) || req.expectedVersion < 0)
    ) return 'invalid'
    if (options.logicalId) {
      const represented = this.getContributionEnvelopeProposal(
        options.logicalId,
        projectId,
        cid,
        req,
        tenantId,
        actorUserId,
      )
      if (typeof represented === 'object') return represented
      if (represented === 'invalid') {
        throw new ValidationError('That Contribution envelope proposal identity is not valid for this account, ledger row, base version, and payload.')
      }
    }
    const c = contributions.find((x) => x.id === cid && x.projectId === projectId)
    if (!c) return undefined
    if (c.status !== 'open') return 'closed'
    if (c.effectAttempts?.some((run) => run.status === 'pending')) return 'conflict'
    const currentVersion = c.envelope?.version ?? 0
    if (req.expectedVersion !== undefined && currentVersion !== req.expectedVersion) return 'conflict'
    // Deliberation is open while the envelope is UNAPPROVED — but amending an
    // APPROVED envelope resets the grant, an ungated revocation power a hostile
    // viewer must not hold over the contributor's standing approval (review
    // finding): once approved, only the contributor or the owner may amend.
    if (c.envelope?.status === 'approved') {
      const ownerTenant = findProject(projectId)?.tenantId ?? defaultTenantId()
      const isContributor = c.contributorTenant !== undefined && c.contributorTenant === tenantId
      if (!isContributor && !tenantWritesAs(tenantId, ownerTenant)) return 'forbidden'
    }
    if (c.events.length >= MAX_CONTRIBUTION_EVENTS) return 'capped'
    const lines = normalizedEnvelopeProposalLines(req)
    if (!lines) return 'invalid'
    const bound = lines.some((line) => line.mcp)
    if (bound && (!options.preparedLines || req.expectedVersion === undefined || !options.logicalId)) return 'invalid'
    const storedLines: Array<Omit<StoredContributionEnvelopeLine, 'id' | 'used'>> = options.preparedLines ?? lines.map(({ mcp: _mcp, ...line }) => line)
    if (storedLines.length !== lines.length || !storedLines.every((line) =>
      currentContributionMcpLine(this, tenantId, { ...line, id: 'preparing', used: 0 }, actorUserId))) return 'invalid'
    const envelopeProposalOwnerUserId = storedLines.find((line) => line.mcpAuthority?.ownerUserId !== undefined)?.mcpAuthority?.ownerUserId
    const proposalLines = lines.map((line, index) => {
      const transport = storedLines[index]?.mcp?.transport
      return line.mcp && transport === 'stdio' ? { ...line, mcp: { ...line.mcp, transport } } : line
    })
    const now = Date.now()
    const actor = tenantName(tenantId)
    const version = currentVersion + 1
    // The event carries what the amendment SUPERSEDED (lines + spend) — the
    // envelope object holds only the current version, so the timeline is where
    // a replaced version's record survives (review finding: don't destroy the
    // what-ran-under-v1 answer).
    const superseded = c.envelope
      ? ` (supersedes v${c.envelope.version}: ${c.envelope.lines.map((l) => `${l.type}→${l.target} ${l.used}/${l.cardinality}`).join(', ')})`
      : ''
    return commitMutationBatch(() => {
      c.envelope = {
        version,
        status: 'proposed',
        proposedBy: actor,
        proposedAt: now,
        lines: storedLines.map((line) => ({
          id: `cev-${(contributionSeq += 1)}`,
          ...structuredClone(line),
          used: 0,
        })),
      }
      c.events.push({
        id: options.logicalId ?? `cev-${(contributionSeq += 1)}`,
        kind: 'envelope-proposed',
        at: now,
        actor,
        envelopeVersion: version,
        body: `v${version} · ${lines.length} act${lines.length === 1 ? '' : 's'}${superseded}`,
        ...(options.logicalId ? {
          proposedByTenant: tenantId,
          envelopeProposalLines: structuredClone(proposalLines),
          ...(envelopeProposalOwnerUserId === undefined ? {} : { envelopeProposalOwnerUserId }),
          ...(req.expectedVersion !== undefined
            ? { envelopeProposalExpectedVersion: req.expectedVersion }
            : {}),
        } : {}),
        ...(principal ? { principal } : {}),
      })
      emit({ type: 'contribution.changed', projectId })
      persist()
      return publicContribution(c, tenantId, actorUserId)
    })
  },
  /** Current containing ledger row for one durable envelope-approval receipt.
   * A supplied reviewed version must match the event exactly, so Retry can
   * never redirect consent to a later amendment. */
  getContributionEnvelopeApproval(
    id: string,
    projectId: string,
    contributionId: string,
    tenantId: string,
    expectedVersion?: number,
    actorUserId?: string,
  ): Contribution | 'invalid' | undefined {
    if (!isContributionEnvelopeApprovalId(id)) return 'invalid'
    const contribution = contributions.find(
      (candidate) => candidate.id === contributionId && candidate.projectId === projectId,
    )
    if (!contribution) return undefined
    const event = contribution.events.find((candidate) => candidate.id === id)
    if (!event) {
      const collision = contributions.some((candidate) => candidate.events.some((entry) => entry.id === id))
      return collision ? 'invalid' : undefined
    }
    if (
      event.kind !== 'envelope-approved' ||
      !Number.isSafeInteger(event.envelopeVersion) ||
      (event.envelopeVersion ?? 0) < 1 ||
      event.approvedByTenant !== tenantId ||
      (expectedVersion !== undefined && event.envelopeVersion !== expectedVersion)
    ) return 'invalid'
    return publicContribution(contribution, tenantId, actorUserId)
  },
  /** Approve the envelope AS PROPOSED — the human judgment moment (the floor
   *  rule: external acts need at least one human approval per envelope; what
   *  follows at act time is mechanical). Project-owner only (`tenantWritesAs`,
   *  raw ids — D14's role gate for commission actors arrives with their
   *  execution path); exact first-party consent stamps the reviewed version. */
  approveEnvelope(
    projectId: string,
    cid: string,
    tenantId: string,
    principal: PrincipalRef | undefined,
    eventActor?: string,
    options: { logicalId?: string; expectedVersion?: number } = {},
  ): Contribution | 'forbidden' | 'conflict' | undefined {
    const actorUserId = principal?.kind === 'user' ? activeMcpActor(tenantId, principal.id) : undefined
    if (options.logicalId) {
      const represented = this.getContributionEnvelopeApproval(
        options.logicalId,
        projectId,
        cid,
        tenantId,
        options.expectedVersion,
        actorUserId,
      )
      if (typeof represented === 'object') return represented
      if (represented === 'invalid') {
        throw new ValidationError('That Contribution envelope approval identity is not valid for this account, ledger row, and reviewed version.')
      }
    }
    const c = contributions.find((x) => x.id === cid && x.projectId === projectId)
    if (!c?.envelope) return undefined
    const ownerTenant = findProject(projectId)?.tenantId ?? defaultTenantId()
    if (!tenantWritesAs(tenantId, ownerTenant)) return 'forbidden'
    if (c.status !== 'open' || c.envelope.status !== 'proposed') return 'conflict'
    if (c.envelope.lines.some((line) => line.mcp) && options.expectedVersion === undefined) return 'conflict'
    if (options.expectedVersion !== undefined && c.envelope.version !== options.expectedVersion) return 'conflict'
    if (c.events.length >= MAX_CONTRIBUTION_EVENTS) return 'conflict'
    const now = Date.now()
    const actor = tenantName(tenantId)
    const approvedVersion = c.envelope.version
    // `eventActor` (CW8): a delegated approval stamps the EVENT with the dual
    // identity from the start — no post-hoc patch, no crash window persisting
    // an un-stamped record (review finding, Phase F). `approvedBy` stays the
    // DELEGATOR's name deliberately: the row-level attribution is the
    // liability holder (the conservation law); the event carries the how.
    return commitMutationBatch(() => {
      c.envelope!.status = 'approved'
      c.envelope!.approvedBy = actor
      c.envelope!.approvedAt = now
      c.envelope!.approvedVersion = approvedVersion
      c.events.push({
        id: options.logicalId ?? `cev-${(contributionSeq += 1)}`,
        kind: 'envelope-approved',
        at: now,
        actor: eventActor ?? actor,
        envelopeVersion: approvedVersion,
        body: `v${approvedVersion}`,
        ...(options.logicalId ? { approvedByTenant: tenantId } : {}),
        ...(principal ? { principal } : {}),
      })
      emit({ type: 'contribution.changed', projectId })
      persist()
      return publicContribution(c, tenantId, actorUserId)
    })
  },
  /** Current containing ledger row and outcome for one durable effect receipt. */
  getContributionEffectExecution(
    id: string,
    projectId: string,
    contributionId: string,
    lineId: string,
    tenantId: string,
  ): { contribution: Contribution; result: 'executed' | 'unapproved' | 'refused' } | 'invalid' | undefined {
    if (!isContributionEffectExecutionId(id)) return 'invalid'
    const contribution = contributions.find(
      (candidate) => candidate.id === contributionId && candidate.projectId === projectId,
    )
    if (!contribution) return undefined
    const event = contribution.events.find((candidate) => candidate.id === id)
    if (!event) {
      const collision = contributions.some((candidate) => candidate.events.some((entry) => entry.id === id))
      return collision ? 'invalid' : undefined
    }
    if (
      (event.kind !== 'effect-executed' && event.kind !== 'effect-refused') ||
      event.lineId !== lineId ||
      event.effectByTenant !== tenantId ||
      event.effectResult === undefined
    ) return 'invalid'
    return { contribution: publicContribution(contribution, tenantId), result: event.effectResult }
  },
  /** Reserve one exact call durably before any external work. Repeated request
   * identities read receipts, including pending/uncertain; they never dispatch. */
  async runContributionMcpEffect(
    projectId: string,
    cid: string,
    lineId: string,
    tenantId: string,
    options: { logicalId: string; expectedVersion: number; actorUserId?: string },
  ): Promise<Contribution | 'forbidden' | 'invalid' | 'conflict' | undefined> {
    if (!this.grantSubjectVisible({ kind: 'project', id: projectId }, tenantId)) return undefined
    const { logicalId, expectedVersion, actorUserId } = options
    if (!isContributionEffectExecutionId(logicalId) || !Number.isSafeInteger(expectedVersion) || expectedVersion < 1 || !lineId) return 'invalid'
    const c = contributions.find((entry) => entry.id === cid && entry.projectId === projectId)
    if (!c) return undefined
    const represented = c.effectAttempts?.find((run) => run.id === logicalId)
    if (represented) {
      if (represented.tenantId !== tenantId || represented.lineId !== lineId || represented.envelopeVersion !== expectedVersion) return 'conflict'
      if (represented.ownerUserId && activeMcpActor(tenantId, actorUserId) !== represented.ownerUserId) return 'forbidden'
      return publicContribution(c, tenantId, actorUserId)
    }
    if (contributions.some((entry) => entry.events.some((event) => event.id === logicalId) ||
      entry.effectAttempts?.some((run) => run.id === logicalId) || entry.reviewAttempts?.some((run) => run.id === logicalId) ||
      entry.judgmentAttempts?.some((run) => run.id === logicalId))) return 'conflict'
    if (!contributionEffectActor(c, tenantId)) return 'forbidden'
    const workOpen = () => c.workItemId === undefined || openSubGoals.some((item) =>
      item.id === c.workItemId && item.projectId === projectId && item.status === 'open')
    if (!workOpen()) return 'conflict'
    const envelope = c.envelope
    const line = envelope?.lines.find((entry) => entry.id === lineId)
    if (c.status !== 'open' || !envelope || envelope.status !== 'approved' || envelope.version !== expectedVersion ||
      envelope.approvedVersion !== expectedVersion || !line?.mcpAuthority || !line.mcp || line.used >= line.cardinality ||
      (c.effectAttempts?.length ?? 0) >= CONTRIBUTION_EFFECT_ATTEMPT_MAX || c.effectAttempts?.some((run) => run.status === 'pending')) return 'conflict'
    if (!currentContributionMcpLine(this, tenantId, line, activeMcpActor(tenantId, actorUserId))) return 'forbidden'
    const run = createContributionEffectAttempt({ id: logicalId, tenantId, projectId, contributionId: cid,
      envelopeVersion: expectedVersion, lineId, actor: tenantName(tenantId), connectionLabel: line.mcp.connectionLabel,
      call: line.mcpAuthority.call, startedAt: Date.now(),
      ...(line.mcpAuthority.ownerUserId ? { ownerUserId: line.mcpAuthority.ownerUserId } : {}),
      ...(line.mcpAuthority.transport === 'stdio' ? { transport: 'stdio' as const } : {}) })
    const fence = {}
    commitMutationBatch(() => {
      c.effectAttempts ??= []
      c.effectAttempts.push(run)
      line.used += 1
      // Permanent conservative floor: an admitted external call is never made
      // low-risk by replacing its envelope or losing the acknowledgement.
      c.effectsFired = true
      emit({ type: 'contribution.changed', projectId })
      persist()
    })
    activeContributionEffects.set(logicalId, fence)
    try {
      let outcome: McpBoundExecutionOutcome
      try {
        outcome = await executeBoundMcpCall(this, tenantId, run.call, () =>
          activeContributionEffects.get(logicalId) === fence && contributions.includes(c) &&
          contributionEffectActor(c, tenantId) && workOpen() && c.status === 'open' && c.envelope === envelope &&
          envelope.status === 'approved' && envelope.approvedVersion === expectedVersion &&
          c.effectAttempts?.includes(run) === true && run.status === 'pending' &&
          currentContributionMcpLine(this, tenantId, line, activeMcpActor(tenantId, actorUserId)), actorUserId)
      } catch {
        outcome = { status: 'uncertain', summary: '' }
      }
      if (activeContributionEffects.get(logicalId) !== fence) return 'conflict'
      const settled = settleContributionEffectAttempt(run, outcome, Math.max(Date.now(), run.startedAt))
      return commitMutationBatch(() => {
        c.effectAttempts![c.effectAttempts!.indexOf(run)] = settled
        if (!contributionEffectConsumesSlot(settled)) line.used -= 1
        emit({ type: 'contribution.changed', projectId })
        persist()
        // A revoked caller receives no fresh content even if their submitted
        // call completed; its receipt remains available to current readers.
        return this.grantSubjectVisible({ kind: 'project', id: projectId }, tenantId) &&
          (!run.ownerUserId || activeMcpActor(tenantId, actorUserId) === run.ownerUserId)
          ? publicContribution(c, tenantId, actorUserId) : undefined
      })
    } finally {
      if (activeContributionEffects.get(logicalId) === fence) activeContributionEffects.delete(logicalId)
    }
  },
  /** Fire ONE act against an envelope line — the MECHANICAL match (CW1/CW6):
   *  envelope approved, line exists, cardinality remaining; a matching act
   *  consumes and records, a deviating one is refused AND recorded (the
   *  refusal is timeline material — never silent). Contributor or owner only.
   *  The external effect itself is the platform's mock boundary — the record
   *  IS the act here, the same way connector effects are canned elsewhere. */
  runEnvelopeEffect(
    projectId: string,
    cid: string,
    lineId: string,
    tenantId: string,
    principal: PrincipalRef | undefined,
    options: { logicalId?: string } = {},
  ): Contribution | 'forbidden' | 'closed' | 'unapproved' | 'refused' | 'unconfigured' | undefined {
    if (contributionRuntimeMode() === 'unconfigured') return 'unconfigured'
    if (options.logicalId) {
      const represented = this.getContributionEffectExecution(
        options.logicalId,
        projectId,
        cid,
        lineId,
        tenantId,
      )
      if (typeof represented === 'object') {
        return represented.result === 'executed' ? represented.contribution : represented.result
      }
      if (represented === 'invalid') {
        throw new ValidationError('That Contribution effect identity is not valid for this account, ledger row, and envelope line.')
      }
    }
    const c = contributions.find((x) => x.id === cid && x.projectId === projectId)
    if (!c) return undefined
    const ownerTenant = findProject(projectId)?.tenantId ?? defaultTenantId()
    const isContributor = c.contributorTenant !== undefined && c.contributorTenant === tenantId
    if (!isContributor && !tenantWritesAs(tenantId, ownerTenant)) return 'forbidden'
    // A landed contribution's plan is immutable history — remaining cardinality
    // does NOT survive the landing (review finding: the server now agrees with
    // the UI). The hold-until-landing harness firing AT landing is a later
    // stage's mechanism, not a back door through this one.
    if (c.status !== 'open') return 'closed'
    const now = Date.now()
    const actor = tenantName(tenantId)
    const refuse = (reason: string): 'unapproved' | 'refused' => {
      const result = reason.startsWith('no approved envelope') ? 'unapproved' : 'refused'
      // The refusal is recorded — unless the timeline is at its bound (the
      // record IS the act here, so an unrecordable act is refused unrecorded).
      if (c.events.length < MAX_CONTRIBUTION_EVENTS) {
        commitMutationBatch(() => {
          c.events.push({
            id: options.logicalId ?? `cev-${(contributionSeq += 1)}`,
            kind: 'effect-refused',
            at: now,
            actor,
            body: reason,
            lineId,
            ...(options.logicalId ? { effectByTenant: tenantId, effectResult: result } : {}),
            ...(principal ? { principal } : {}),
          })
          emit({ type: 'contribution.changed', projectId })
          persist()
        })
      }
      return result
    }
    if (c.events.length >= MAX_CONTRIBUTION_EVENTS) return 'refused'
    if (!c.envelope || c.envelope.status !== 'approved') return refuse('no approved envelope covers this act')
    const line = c.envelope.lines.find((l) => l.id === lineId)
    if (!line) return refuse('outside the approved envelope — amend and re-approve')
    if (line.mcp || line.mcpAuthority || line.harness === 'explicit-call') return 'refused'
    if (line.used >= line.cardinality) return refuse(`${line.type} → ${line.target}: cardinality exhausted (${line.cardinality} of ${line.cardinality} used)`)
    return commitMutationBatch(() => {
      line.used += 1
      // The floor covers history: once an irreversible act runs, the Tier-2
      // stamp is permanent (never unset — see the contract field's rationale).
      if (!isProjectEffectMonotonic(line.type)) c.effectsFired = true
      c.events.push({
        id: options.logicalId ?? `cev-${(contributionSeq += 1)}`,
        kind: 'effect-executed',
        at: now,
        actor,
        body: `${line.type} → ${line.target} · ${line.harness} · ${line.used}/${line.cardinality}`,
        lineId,
        ...(options.logicalId ? { effectByTenant: tenantId, effectResult: 'executed' } : {}),
        ...(principal ? { principal } : {}),
      })
      emit({ type: 'contribution.changed', projectId })
      persist()
      return publicContribution(c, tenantId)
    })
  },

  // ── D28 — peer credentials (verified identity at the A2A edge) ──
  /** Mint a peer credential: the token is returned ONCE; only its SHA-256 persists
   *  (the relay-secret pattern). The registered NAME — chosen by the owner, not
   *  self-declared by the remote — is what verified acts are stamped with. */
  createA2aPeer(name: string): { peer: A2aPeer; token: string } {
    const token = mintRelaySecret()
    const peer: StoredA2aPeer = {
      id: `peer-${(a2aPeerSeq += 1)}`,
      name: name.trim().slice(0, 120),
      createdAt: Date.now(),
      secretHint: relaySecretHint(token),
      tokenHash: hashRelaySecret(token),
    }
    A2A_PEERS.set(peer.id, peer)
    persist()
    return { peer: publicPeer(peer), token }
  },
  listA2aPeers(): A2aPeer[] {
    return [...A2A_PEERS.values()].map(publicPeer)
  },
  /** Revocation IS deletion — the hash dies with the peer. */
  deleteA2aPeer(id: string): boolean {
    const had = A2A_PEERS.delete(id)
    if (had) persist()
    return had
  },
  /** Resolve an `Authorization: Bearer …` header to a registered peer (constant-
   *  time hash compare). Undefined for absent/unknown credentials — the caller
   *  decides whether that's fatal (`A2A_REQUIRE_AUTH`) or just unverified. */
  resolveA2aPeer(authorization: string | undefined): A2aPeer | undefined {
    const token = authorization?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim()
    if (!token) return undefined
    const hash = hashRelaySecret(token)
    for (const p of A2A_PEERS.values()) {
      if (sameSecretHash(p.tokenHash, hash)) return publicPeer(p)
    }
    return undefined
  },

  // ── D24 — watching + the notification inbox ──
  /** Set the caller's watch on a Project (the route validates visibility with the
   *  same wall as reading it — watching needs only visibility, COMMONS-13). */
  /** Set the caller's watch on any subject (the route validates visibility with
   *  the same wall as reading it — watching needs only visibility, COMMONS-13). */
  setWatch(subject: SocialEntityRef, tenantId: string, watching: boolean): WatchState {
    const key = watchKey(subject)
    const set = watches.get(key) ?? new Set<string>()
    if (set.has(tenantId) === watching) return { watching }
    if (watching) set.add(tenantId)
    else set.delete(tenantId)
    if (set.size > 0) watches.set(key, set)
    else watches.delete(key)
    emit({ type: 'watch.changed', tenantId, subject })
    persist()
    return { watching }
  },
  watchState(subject: SocialEntityRef, tenantId: string): WatchState {
    return { watching: watches.get(watchKey(subject))?.has(tenantId) ?? false }
  },
  /** Read the exact public aggregate and private viewer membership for one
   * feed item behind the same subject wall as the Commons projection. */
  commonsLikeState(itemId: string, tenantId: string): CommonsLikeState | undefined {
    const subject = this.commonsItemSubject(itemId)
    if (!subject || !this.grantSubjectVisible(subject, tenantId)) return undefined
    const set = commonsLikes.get(itemId)
    return { likes: set?.size ?? 0, liked: set?.has(tenantId) ?? false }
  },
  /** Set the caller's like on ONE feed item. Visibility is the item's
   *  SUBJECT's wall (a like is never wider than what it likes), so an item the
   *  caller can't read is the existence-hiding undefined. Repeating realized
   *  desired state is a true no-op: no persistence write and no fictional push. */
  setCommonsLike(itemId: string, tenantId: string, liked: boolean): CommonsLikeState | undefined {
    const subject = this.commonsItemSubject(itemId)
    if (!subject || !this.grantSubjectVisible(subject, tenantId)) return undefined
    const set = commonsLikes.get(itemId) ?? new Set<string>()
    if (set.has(tenantId) === liked) return { likes: set.size, liked }
    if (liked) set.add(tenantId)
    else set.delete(tenantId)
    if (set.size > 0) commonsLikes.set(itemId, set)
    else commonsLikes.delete(itemId)
    emit({ type: 'commons-like.changed', itemId, subject })
    persist()
    return { likes: set.size, liked }
  },
  /** The SUBJECT behind a derived feed-item id — the wall every per-item act
   *  checks. This is the one parser for every shape `listCommons` mints, and it
   *  must stay exhaustive over them: an unparsed shape resolves to undefined,
   *  which every caller reads as "no such item" — so the act 404s on a row the
   *  feed is happily rendering. S8 added `post:<discussionId>` and this parser
   *  was not widened, so liking a wall post answered 404 and the button sat
   *  there saying "Couldn't update" (found in-app, 2026-08-08). The comment
   *  here used to assert share and landing were "the only two shapes", which is
   *  how a closed set goes stale: `server/routes/posts.test.ts` now checks the parser
   *  against the ids `listCommons` actually mints, rather than a list. */
  commonsItemSubject(itemId: string): SocialEntityRef | undefined {
    const [kind, ...rest] = itemId.split(':')
    const id = rest.join(':')
    if (kind === 'share') return grants.find((g) => g.id === id && g.note !== undefined)?.subject
    if (kind === 'landing') {
      const p = socialProposals.find((x) => x.id === id && x.state === 'landed')
      return p?.subject
    }
    // A post's subject is its author's own principal — the same ref the feed
    // item carries. Gated on `isWallThread` for the reason the other two are
    // gated: a DM is principal-anchored too, and it is not a feed item.
    if (kind === 'post') {
      const d = discussions.find((x) => x.id === id)
      return d !== undefined && isWallThread(d) ? d.anchor.ref : undefined
    }
    return undefined
  },
  /** Record that the caller OPENED a subject's page — the ledger behind the
   *  Commons' "Recently viewed" lens. Per principal, capped and evicting (the
   *  inbox posture); re-viewing moves an entry rather than adding one, so the
   *  list is "the last N things you looked at", not "the last N times you
   *  looked". Silently ignores a subject the caller can't read: a view is a
   *  private note to self, never worth a 403 that confirms existence. */
  recordView(subject: SocialEntityRef, tenantId: string): void {
    if (!this.grantSubjectVisible(subject, tenantId)) return
    const key = watchKey(subject)
    const rows = (views.get(tenantId) ?? []).filter((v) => v.key !== key)
    rows.unshift({ key, kind: subject.kind, id: subject.id, at: Date.now() })
    views.set(tenantId, rows.slice(0, MAX_VIEWS_PER_TENANT))
    persist()
  },
  /** The caller's inbox, newest first — ONLY its own rows, served without the
   *  recipient field (the wire shape is `AppNotification`). */
  /** The caller's inbox — their namespace's rows plus every org's they hold a
   *  seat in (FWD-6 O-D5: an org's bell is member-readable). */
  listNotifications(tenantId: string): AppNotification[] {
    const muted = mutes.get(tenantId)
    return notifications
      .filter((x) => tenantReadsAs(tenantId, x.tenantId))
      .filter((x) => !muted?.has(x.actor)) // S5 earmuff — the bell honors the mute too
      // Inbox doors are projections, not another home for a retained subject.
      // Keep the stored history/read state so restoration is reversible.
      .filter((x) => !((x.subjectKind === 'artifact' || x.subjectKind === 'discussion' || x.subjectKind === 'proposal') &&
        x.subjectId && socialSubjectSuspended({ kind: x.subjectKind, id: x.subjectId })) &&
        !(x.discussionId && socialSubjectSuspended({ kind: 'discussion', id: x.discussionId })))
      .map(({ tenantId: _recipient, actorTenant: _actor, postId: _post, ...pub }) => pub)
      .reverse()
  },
  /** Exact read-state recovery for named inbox rows. Unlike the visible list,
   * this ignores reversible mute presentation so hidden unread state cannot be
   * mistaken for durable absence; the recipient/member wall still applies. */
  notificationReadState(tenantId: string, ids: readonly string[]): NotificationReadState[] {
    const named = new Set(ids)
    return notifications
      .filter((row) => named.has(row.id) && tenantReadsAs(tenantId, row.tenantId))
      .map((row) => ({ id: row.id, read: row.read }))
  },
  /** Mark the caller's rows read — the named ids, or all. Idempotent; emits (and
   *  persists) only when something actually flipped. The same union as the read:
   *  a member may settle the org's bell (a disposable, derived row — not an act). */
  markNotificationsRead(tenantId: string, ids?: string[]): AppNotification[] {
    const named = ids ? new Set(ids) : null
    // Invalidate per RECIPIENT tenant, not per caller: a member settling an org
    // row must reach the org's other member streams (which gate on the row's
    // tenant through the same union), not just their own.
    const touched = new Set<string>()
    for (const x of notifications) {
      if (!tenantReadsAs(tenantId, x.tenantId) || x.read) continue
      if (named && !named.has(x.id)) continue
      x.read = true
      touched.add(x.tenantId)
    }
    if (touched.size > 0) {
      for (const t of touched) emit({ type: 'notification.changed', tenantId: t })
      persist()
    }
    return this.listNotifications(tenantId)
  },

  /** The complete artifact registry, including authored relation-graph rows.
   * Read visibility may widen through grants; ownership never does. */
  listArtifacts(tenantId?: string): ArtifactItem[] {
    const artifacts = [...graph.extraArtifacts, ...baseArtifacts()].filter((a) => !artifactIsTrashed(a.id)).map((a) => ({
      ...artifactWithMetadata(a),
      projectId: graph.artifactProject[a.id] ?? a.projectId,
    }))
    if (!tenantId) return artifacts
    return artifacts.filter((a) => this.artifactVisibleToTenant(a, tenantId)).map((a) => ({
      // Viewer-relative ownership, like every other shared subject: a granted
      // reader opens the artifact and never gets its filing controls.
      ...a,
      own: this.artifactOwnedBy(a, tenantId),
      tenantId: this.artifactOwnedBy(a, tenantId) ? a.tenantId : undefined,
    }))
  },
  /** Exact internal lookup across seeded and authored rows; callers apply the
   * same visibility/ownership wall as the complete registry. */
  artifactById(id: string): ArtifactItem | undefined {
    return findArtifact(id)
  },
  /** Retained identities are visible only through this owner-only collection.
   * Normal reads, exports and social subjects stay closed until restoration. */
  listTrashedArtifacts(tenantId: string): TrashedArtifact[] {
    return [...graph.extraArtifacts, ...baseArtifacts()]
      .filter((artifact) => artifactIsTrashed(artifact.id) && this.artifactOwnedBy(artifact, tenantId))
      .map((artifact) => ({
        artifact: { ...artifactWithMetadata(artifact), projectId: graph.artifactProject[artifact.id] ?? artifact.projectId, own: true },
        trashedAt: artifactLifecycle.get(artifact.id)!.changedAt,
      }))
      .sort((a, b) => b.trashedAt - a.trashedAt || a.artifact.id.localeCompare(b.artifact.id))
  },
  /** Owner-only authoritative lifecycle snapshot. Legacy absence projects as
   * active revision zero without mutating or eagerly stamping old rows. */
  getArtifactLifecycle(id: string, tenantId: string) {
    const artifact = retainedArtifact(id)
    if (!artifact || !this.artifactOwnedBy(artifact, tenantId)) return undefined
    const lifecycle = artifactLifecycle.get(id) ?? { state: 'active' as const, revision: 0, changedAt: 0 }
    return {
      artifact: {
        ...artifactWithMetadata(artifact),
        projectId: graph.artifactProject[id] ?? artifact.projectId,
        own: true,
      },
      lifecycle: { ...lifecycle },
    }
  },
  /** Owner-only review snapshot for permanent deletion. The opaque token is
   * transient and binds every row that the reviewed cascade would remove. */
  previewArtifactDeletion(id: string, tenantId: string): ArtifactDeletionPreview | undefined {
    const artifact = retainedArtifact(id)
    if (!artifact || !this.artifactOwnedBy(artifact, tenantId)) return undefined
    if (!artifactIsTrashed(id)) throw new ConflictError('Move this Artifact to Trash before permanently deleting it.')
    const lifecycle = artifactLifecycle.get(id)!
    const cascade = artifactDeletionCascade(id)
    const reviewToken = randomBytes(32).toString('hex')
    this.pruneArtifactDeletionReviews()
    artifactDeletionReviews.set(reviewToken, {
      artifactId: id,
      tenantId,
      lifecycleRevision: lifecycle.revision,
      fingerprint: artifactDeletionFingerprint(artifact, tenantId),
    })
    return {
      artifactId: id,
      artifactName: artifact.name,
      lifecycleRevision: lifecycle.revision,
      reviewToken,
      counts: {
        versions: artifactHistory.get(id)?.length ?? 0,
        shares: cascade.shares.length,
        discussions: cascade.discussions.length,
        proposals: cascade.proposals.length,
      },
    }
  },
  pruneArtifactDeletionReviews(): void {
    while (artifactDeletionReviews.size >= 512) {
      const oldest = artifactDeletionReviews.keys().next().value as string | undefined
      if (!oldest) break
      artifactDeletionReviews.delete(oldest)
    }
  },
  /** Durable owner+key receipt is checked before row lookup, so a lost
   * acknowledgement can replay after deletion/restart without exposing whether
   * another account owned the target. */
  permanentlyDeleteArtifact(
    id: string,
    request: ArtifactDeletionRequest,
    tenantId: string,
    userId: string,
    idempotencyKey: string,
  ): ArtifactDeletionResult | undefined {
    const keyHash = createHash('sha256').update(idempotencyKey).digest('hex')
    const receiptKey = JSON.stringify([tenantId, userId, keyHash])
    const requestTokenHash = createHash('sha256').update(request.reviewToken).digest('hex')
    const represented = artifactDeletionReceipts.get(receiptKey)
    if (represented) {
      if (represented.artifactId !== id || represented.expectedLifecycleRevision !== request.expectedLifecycleRevision ||
        represented.reviewTokenHash !== requestTokenHash) {
        throw new ConflictError('This deletion key already represents a different request.')
      }
      return { artifactId: id, deleted: true }
    }
    const artifact = retainedArtifact(id)
    if (!artifact || !this.artifactOwnedBy(artifact, tenantId)) return undefined
    if (!artifactIsTrashed(id)) throw new ConflictError('Move this Artifact to Trash before permanently deleting it.')
    const review = artifactDeletionReviews.get(request.reviewToken)
    const lifecycle = artifactLifecycle.get(id)!
    if (!review || review.artifactId !== id || review.tenantId !== tenantId ||
      request.expectedLifecycleRevision !== review.lifecycleRevision || lifecycle.revision !== review.lifecycleRevision ||
      artifactDeletionFingerprint(artifact, tenantId) !== review.fingerprint) {
      throw new ConflictError('This Artifact or its deletion cascade changed after review. Review the current deletion details again.')
    }

    const cascade = artifactDeletionCascade(id)
    const deletedDiscussionIds = new Set(cascade.discussions.map((row) => row.id))
    const deletedProposalIds = new Set(cascade.proposals.map((row) => row.id))
    const subjectKeys = new Set([
      `artifact:${id}`,
      ...[...deletedDiscussionIds].map((subjectId) => `discussion:${subjectId}`),
      ...[...deletedProposalIds].map((subjectId) => `proposal:${subjectId}`),
    ])
    const removedFeedIds = new Set([
      ...cascade.shares.filter((grant) => grant.note !== undefined).map((grant) => `share:${grant.id}`),
      ...cascade.proposals.filter((proposal) => proposal.state === 'landed').map((proposal) => `landing:${proposal.id}`),
      ...cascade.discussions.map((discussion) => `post:${discussion.id}`),
    ])
    const retirement: ArtifactRetirement = {
      artifactId: id,
      tenantId,
      ...(!isArtifactCreationId(id) && artifact.saveOrigin ? { saveOriginHash: artifactSaveOriginHash(tenantId, artifact.saveOrigin) } :
        (artifact.sourceSessionId && !isArtifactCreationId(artifact.id) && typeof artifact.source === 'string'
          ? { saveOriginHash: artifactSaveOriginHash(tenantId, { name: artifact.name, source: artifact.source }) }
          : {})),
      ...(artifact.sourceScheduleId ? { sourceScheduleId: artifact.sourceScheduleId } : {}),
      discussionIds: cascade.discussions.map((row) => row.id).sort(),
      proposalIds: cascade.proposals.map((row) => row.id).sort(),
    }
    const receipt: StoredArtifactDeletionReceipt = {
      tenantId,
      userId,
      artifactId: id,
      keyHash,
      expectedLifecycleRevision: request.expectedLifecycleRevision,
      reviewTokenHash: requestTokenHash,
    }
    const audiences = new Set<string>([tenantId])
    for (const grant of cascade.shares) {
      if (grant.granterTenant) audiences.add(grant.granterTenant)
      if (grant.audienceTenant) audiences.add(grant.audienceTenant)
      for (const audience of grant.redeemedBy ?? []) audiences.add(audience)
    }
    for (const discussion of cascade.discussions) audiences.add(discussion.openerTenant)
    for (const proposal of cascade.proposals) audiences.add(proposal.offererTenant)

    artifactRetirements.set(id, retirement)
    graph = {
      ...graph,
      extraArtifacts: graph.extraArtifacts.filter((row) => row.id !== id),
      artifactProject: Object.fromEntries(Object.entries(graph.artifactProject).filter(([key]) => key !== id)),
      artifactSource: Object.fromEntries(Object.entries(graph.artifactSource).filter(([key]) => key !== id)),
      revision: (graph.revision ?? 0) + 1,
    }
    artifactBodies.delete(id)
    artifactHistory.delete(id)
    for (const [key, row] of artifactHistoryRestoreReceipts) if (row.artifactId === id) artifactHistoryRestoreReceipts.delete(key)
    artifactMetadata.delete(id)
    artifactLifecycle.delete(id)
    grants.splice(0, grants.length, ...grants.filter((grant) => !subjectKeys.has(`${grant.subject.kind}:${grant.subject.id}`)))
    discussions.splice(0, discussions.length, ...discussions.filter((row) => !deletedDiscussionIds.has(row.id)))
    socialProposals.splice(0, socialProposals.length, ...socialProposals.filter((row) => !deletedProposalIds.has(row.id)))
    for (const [, reads] of discussionReads) for (const discussionId of deletedDiscussionIds) reads.delete(discussionId)
    for (const key of [...watches.keys()]) if (subjectKeys.has(key)) watches.delete(key)
    for (const key of removedFeedIds) commonsLikes.delete(key)
    for (const [tenant, rows] of views) views.set(tenant, rows.filter((row) => !subjectKeys.has(`${row.kind}:${row.id}`)))
    notifications.splice(0, notifications.length, ...notifications.filter((row) =>
      !(row.subjectKind && row.subjectId && subjectKeys.has(`${row.subjectKind}:${row.subjectId}`)) &&
      !(row.discussionId && deletedDiscussionIds.has(row.discussionId)) &&
      !(row.proposalId && deletedProposalIds.has(row.proposalId))))
    for (const [key, value] of artifactDeletionReviews) if (value.artifactId === id) artifactDeletionReviews.delete(key)
    artifactDeletionReceipts.set(receiptKey, receipt)
    persist()
    emit({ type: 'artifact.changed', artifactId: id })
    for (const recipient of audiences) if (recipient !== tenantId) emit({ type: 'social-access.changed', tenantId: recipient })
    return { artifactId: id, deleted: true }
  },
  artifactIsRetired(id: string): boolean {
    return artifactIsRetired(id)
  },
  /** One durable CAS for Trash and restore. Replaying its immediate represented
   * step acknowledges it; old retries cannot cross a later opposite transition.
   * Body, metadata, filing, source, proposals and current grants are retained. */
  setArtifactLifecycle(id: string, state: 'active' | 'trashed', expectedRevision: number, tenantId: string) {
    const artifact = retainedArtifact(id)
    if (!artifact || !this.artifactOwnedBy(artifact, tenantId)) return undefined
    const collectNestedReaders = (): Set<string> => {
      const candidates = new Set<string>(accounts.tenants.keys())
      candidates.add(tenantId)
      for (const grant of grants) {
        if (grant.granterTenant) candidates.add(grant.granterTenant)
        if (grant.audienceTenant) candidates.add(grant.audienceTenant)
        for (const redeemedTenant of grant.redeemedBy ?? []) candidates.add(redeemedTenant)
      }
      const descendantDiscussions = discussions.filter((row) => socialSubjectHasArtifactAncestor(row.anchor.ref, id))
      const descendantProposals = socialProposals.filter((row) => socialSubjectHasArtifactAncestor(row.subject, id))
      for (const discussion of descendantDiscussions) {
        candidates.add(discussion.openerTenant)
        for (const post of discussion.posts) candidates.add(post.authorTenant)
      }
      for (const proposal of descendantProposals) candidates.add(proposal.offererTenant)

      const readers = new Set<string>()
      for (const candidateTenant of candidates) {
        const rootVisible = this.artifactVisibleToTenant(artifact, candidateTenant)
        const nestedVisible = descendantDiscussions.some((row) => this.discussionReadableBy(row, candidateTenant)) ||
          descendantProposals.some((row) => this.grantSubjectVisible({ kind: 'proposal', id: row.id }, candidateTenant))
        if (!rootVisible && nestedVisible) readers.add(candidateTenant)
      }
      return readers
    }
    // Trash snapshots while the ordinary read wall is still open; restore
    // snapshots immediately after it reopens. The real social access predicates
    // decide recipients, rather than a parallel approximation of grants.
    const nestedReadersBeforeTrash = state === 'trashed' ? collectNestedReaders() : undefined
    const current = artifactLifecycle.get(id)
    const result = nextArtifactLifecycle(current, state, expectedRevision, Math.max(Date.now(), current?.changedAt ?? 0))
    if (result.kind === 'invalid') throw new ValidationError('A valid target state and non-negative lifecycle revision are required.')
    if (result.kind === 'conflict') throw new ConflictError('This artifact’s Trash state changed. Review its current state before trying again.')
    if (result.kind === 'changed') {
      artifactLifecycle.set(id, result.value)
      graph = { ...graph, revision: (graph.revision ?? 0) + 1 }
      persist()
      emit({ type: 'artifact.changed', artifactId: id })
      const nestedReaders = nestedReadersBeforeTrash ?? collectNestedReaders()
      for (const recipient of nestedReaders) emit({ type: 'social-access.changed', tenantId: recipient })
    }
    return { artifact: { ...artifactWithMetadata(artifact), projectId: graph.artifactProject[id] ?? artifact.projectId, own: true }, lifecycle: { ...result.value } }
  },
  /** Owner-only display rename. No document byte, filing, sharing, save receipt,
   * or routine configuration is changed. Publication follows durable commit. */
  renameArtifact(id: string, name: string, expectedRevision: number, tenantId: string): ArtifactItem | undefined {
    const artifact = findArtifact(id)
    if (!artifact || !this.artifactOwnedBy(artifact, tenantId)) return undefined
    const normalized = normalizeArtifactName(name)
    if (normalized === undefined) throw new ValidationError('Choose a name with 1–240 characters and no control characters.')
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) {
      throw new ValidationError('expectedRevision must be a non-negative safe integer.')
    }
    const revision = artifact.metadataRevision ?? 0
    if (expectedRevision !== revision) throw new ConflictError('This artifact name changed elsewhere. Review the latest name before retrying.')
    if (normalized === artifact.name) return this.listArtifacts(tenantId).find((row) => row.id === id)
    if (revision === Number.MAX_SAFE_INTEGER) throw new ConflictError('This artifact cannot accept another metadata revision.')
    artifactMetadata.set(id, {
      name: normalized,
      revision: revision + 1,
      editedAt: Math.max(Date.now(), artifact.editedAt),
    })
    graph = { ...graph, revision: (graph.revision ?? 0) + 1 }
    persist()
    emit({ type: 'artifact.changed', artifactId: id })
    return this.listArtifacts(tenantId).find((row) => row.id === id)
  },
  /** Whether an artifact is visible to `tenantId` — read widens through a grant
   *  (SOCIAL-4), ownership stays strict. Without this a shared artifact was
   *  discussable and even carried a Commons card, while the artifact itself
   *  stayed invisible to the audience: a grant that granted nothing. */
  artifactVisibleToTenant(a: ArtifactItem, tenantId: string): boolean {
    return !artifactIsTrashed(a.id) && (rowVisibleTo(a, tenantId) || this.grantedTier({ kind: 'artifact', id: a.id }, tenantId) !== undefined)
  },
  /** OWNERSHIP — the strict half (filing, deletion, the share configuration). */
  artifactOwnedBy(a: ArtifactItem, tenantId: string): boolean {
    return rowVisibleTo(a, tenantId)
  },
  /** Routines, scoped to the caller's tenant when given (F2/PD9 — each demo
   *  account seeds its own themed set). Unscoped for internal callers (the
   *  scheduler, run lookups by id). */
  listSchedules(tenantId?: string): ScheduledTask[] {
    if (!tenantId) return schedules
    // Viewer-relative ownership rides the projection (never stored): a grant
    // widens the READ below, so "visible" and "owned" are no longer the same
    // question for a routine, and the UI must be told which one it has.
    return schedules
      .filter((t) => this.scheduleVisibleToTenant(t, tenantId))
      .map((t) => ({ ...t, revision: t.revision ?? 0, own: this.scheduleOwnedBy(t, tenantId) }))
  },
  /** Whether a routine is visible to `tenantId` — the route-level guard for the
   *  by-id reads/mutations, mirroring sessionVisibleToTenant. Social S1: a grant
   *  OPENS its subject, and a routine is a subject like any other (SOCIAL-4 was
   *  wired for projects and sessions; a shared routine was readable by nobody).
   *  Read widens; ownership stays strict. */
  scheduleVisibleToTenant(task: ScheduledTask, tenantId: string): boolean {
    return rowVisibleTo(task, tenantId) || this.grantedTier({ kind: 'schedule', id: task.id }, tenantId) !== undefined
  },
  /** OWNERSHIP — the strict half. Editing, landing a proposal, and the share
   *  configuration all hang off this, never off mere visibility. */
  scheduleOwnedBy(task: ScheduledTask, tenantId: string): boolean {
    return rowVisibleTo(task, tenantId)
  },

  // ── Scheduled runs (a single live feed; runs are server-owned) ──
  /** Separate owner-only permission projection; never attach this to a shared
   * ScheduledTask, graph or public run Session. */
  commissionMcpReview(id: string, viewerTenant: string, actorUserId: string,
    selection?: CommissionMcpModelSelection): CommissionMcpReview | undefined {
    return commissionMcpHost.review(id, viewerTenant, actorUserId, selection)
  },
  /** Internal queue projection. Each row is freshly checked against the
   * current person-private approval, model review, current HTTP tool binding,
   * open work identity, and durable claim/restore fences. */
  commissionMcpWorkCandidates() {
    return commissionMcpWorkCandidates()
  },
  decideCommissionMcp(id: string, viewerTenant: string, request: CommissionMcpDecisionRequest,
    actorUserId: string): CommissionMcpDecisionResponse | undefined {
    return commissionMcpHost.decide(id, viewerTenant, request, actorUserId)
  },
  /** Host-only one-shot execution seam. The server queue calls this only for
   * candidates from the current private person-scoped approval projection. */
  runCommissionMcpWork(id: string, tenantId: string, actorUserId: string, itemId: string, signal?: AbortSignal) {
    return commissionMcpExecution.run(id, tenantId, actorUserId, itemId, signal)
  },
  routineMcpReview(id: string, viewerTenant: string, actorUserId?: string): RoutineMcpReview | undefined {
    const task = schedules.find(task => task.id === id)
    if (!task) return undefined
    const owner = task.tenantId ?? defaultTenantId()
    if (!tenantWritesAs(viewerTenant, owner)) return undefined
    const facts = routineMcpFacts(task)
    const storedPolicy = routineMcpRegistry.policy(owner, id)
    const policy = storedPolicy?.policy ?? { version: 1 as const, revision: 0, approval: null }
    const actor = activeMcpActor(owner, actorUserId)
    const grantOwner = routineMcpPermissionOwner(storedPolicy)
    const agent = WORKER_AGENTS.get(task.agentId ?? DEFAULT_AGENT.id)
    const provider = MODEL_PROVIDERS.get(task.providerId ?? agent?.providerId ?? DEFAULT_PROVIDER.id)
    const authority = intersectAuthority(provider?.authority ?? {}, agent?.authority ?? {})
    const toolsFor = (person?: string) => this.mcpConnections(owner, person)
      .filter(connection => connection.status === 'connected' && connection.execution === 'approval-required' &&
        (connection.transport !== 'stdio' || mcpRuntimeCapabilities().localProcesses === true) &&
        (authorityAdmits(authority, 'connectors', connection.id) || authorityAdmits(authority, 'connectors', connection.label)))
      .flatMap(connection => connection.tools.filter(tool => connection.executableTools?.includes(tool.name))
        .map(tool => ({ connectionId: connection.id, connectionRevision: connection.revision, connectionLabel: connection.label,
          schemaHash: mcpToolSchemaHash(tool), tool, ...(connection.transport === 'stdio' ? { transport: 'stdio' as const } : {}) })))
    const tools = toolsFor(actor)
    // Availability is a fact about the saved grant, not whoever is viewing it.
    // The other person's catalog is used only internally, never projected.
    const grantTools = grantOwner !== undefined && grantOwner !== actor ? toolsFor(grantOwner) : tools
    const approval = policy.approval
    const active = !!approval && approval.definitionRevision === (task.revision ?? 0) && approval.reviewHash === facts.reviewHash &&
      (grantOwner === undefined || activeMcpActor(owner, grantOwner) === grantOwner) &&
      Date.now() >= approval.approvedAt && Date.now() < approval.expiresAt && approval.tools.every(selected => grantTools.some(tool =>
        tool.connectionId === selected.connectionId && tool.connectionRevision === selected.connectionRevision &&
        tool.tool.name === selected.toolName && tool.schemaHash === selected.schemaHash))
    const otherPerson = !!approval && grantOwner !== undefined && grantOwner !== actor
    return { routineId: id, definitionRevision: task.revision ?? 0, ...facts,
      policy: otherPerson ? { ...policy, approval: null } : policy, active: !otherPerson && active, tools,
      ...(otherPerson ? { otherPersonApproval: { active } } : {}),
      runs: task.runs.flatMap(run => {
        const ledger = routineMcpRegistry.run(owner, id, run.id)
        return ledger && (routineMcpPermissionOwner(ledger.permission) === undefined || routineMcpPermissionOwner(ledger.permission) === actor)
          ? [{ runId: run.id, status: run.status, phase: ledger.phase, calls: ledger.calls.map(publicRoutineMcpReceipt) }] : []
      }) }
  },
  decideRoutineMcp(id: string, viewerTenant: string, request: RoutineMcpDecisionRequest, actorUserId?: string): RoutineMcpDecisionResponse | undefined {
    const review = this.routineMcpReview(id, viewerTenant, actorUserId)
    const task = schedules.find(task => task.id === id)
    if (!review || !task) return undefined
    const tenantId = task.tenantId ?? defaultTenantId()
    const actor = activeMcpActor(tenantId, actorUserId)
    // An HTTP actor captured before a body await cannot fall back to legacy
    // workspace authority after losing membership, even for exact replay.
    if (actorUserId !== undefined && actor !== actorUserId) return undefined
    return commitMutationBatch(() => {
      const decision = routineMcpRegistry.decide({ tenantId, routineId: id }, request, {
        definitionRevision: review.definitionRevision, reviewHash: review.reviewHash, now: Date.now(),
        actorUserId: actor,
        allowLocalPrograms: mcpRuntimeCapabilities().localProcesses === true,
        connection: (connectionId, owner, person) => {
          // The policy parser checks the catalog; the review also filters the
          // bound Agent/provider authority, which must not be bypassed by POST.
          if (!review.tools.some(tool => tool.connectionId === connectionId)) return undefined
          return this.mcpConnection(connectionId, owner, person)
        },
      })
      if (!decision.replayed) {
        emit({ type: 'schedule.changed', taskId: id, tenantId: task.tenantId })
        persist()
      }
      return { routineId: id, requestId: request.requestId, decisionId: decision.decisionId, review: this.routineMcpReview(id, viewerTenant, actorUserId)! }
    })
  },
  routineMcpRunMayRetry(taskId: string, runId: string): boolean {
    const task = schedules.find(task => task.id === taskId)
    if (!task) return false
    const ledger = routineMcpRegistry.run(task.tenantId ?? defaultTenantId(), taskId, runId)
    return !ledger || (ledger.phase === 'active' && ledger.calls.length === 0)
  },
  /** This host-only boundary commits a slot before entering the one-shot
   * executor. A timeout publishes uncertainty before another call can start. */
  async executeRoutineMcpCall(taskId: string, runId: string, call: McpBoundToolCall, key: string, signal?: AbortSignal,
    execute: typeof executeBoundMcpCall = executeBoundMcpCall): Promise<RoutineMcpCallReceipt> {
    const task = schedules.find(task => task.id === taskId)
    const run = task?.runs.find(run => run.id === runId)
    if (!task || !run || run.status !== 'running' || signal?.aborted) throw new RoutineMcpPolicyError('denied')
    const owner = task.tenantId ?? defaultTenantId()
    const ledger = routineMcpRegistry.run(owner, taskId, runId)
    if (!ledger) throw new RoutineMcpPolicyError('denied')
    const reserved = commitMutationBatch(() => {
      const reservation = reserveRoutineMcpCall(ledger, { key, call, live: routineMcpRegistry.policy(owner, taskId),
        definitionRevision: task.revision ?? 0, reviewHash: routineMcpFacts(task).reviewHash, now: Date.now(),
        allowLocalPrograms: mcpRuntimeCapabilities().localProcesses === true,
        connection: (id, tenant, person) => this.mcpConnection(id, tenant, person) })
      if (reservation.created) {
        routineMcpRegistry.setRun(reservation.run)
        emit({ type: 'schedule.changed', taskId, tenantId: task.tenantId })
        persist()
      }
      return reservation
    })
    if (!reserved.created) return publicRoutineMcpReceipt(reserved.receipt)
    const settle = (outcome: McpBoundExecutionOutcome): RoutineMcpCallReceipt => commitMutationBatch(() => {
      const current = routineMcpRegistry.run(owner, taskId, runId)
      const receipt = current?.calls.find(receipt => receipt.id === reserved.receipt.id)
      if (!current || !receipt) return { ...publicRoutineMcpReceipt(reserved.receipt), status: 'uncertain', finishedAt: Date.now() }
      if (receipt.status !== 'pending') return publicRoutineMcpReceipt(receipt)
      const settled = settleRoutineMcpCall(current, receipt.id, outcome, Math.max(Date.now(), receipt.startedAt))
      routineMcpRegistry.setRun(settled)
      const result = settled.calls.find(call => call.id === receipt.id)!
      if (routineMcpReceiptNeedsReview(result)) {
        pauseRoutineMcp(task)
        this.failScheduleRun(taskId, runId, 'execution_error',
          'External MCP work may have taken effect. This Routine is paused. Review its call receipts before enabling it and renewing permission.')
      }
      emit({ type: 'schedule.changed', taskId, tenantId: task.tenantId })
      persist()
      return publicRoutineMcpReceipt(result)
    })
    const onAbort = () => { settle({ status: 'uncertain', summary: 'External MCP execution was interrupted.' }) }
    signal?.addEventListener('abort', onAbort, { once: true })
    try {
      if (signal?.aborted) return settle({ status: 'uncertain', summary: '' })
      let outcome: McpBoundExecutionOutcome
      try {
        outcome = await execute(this, owner, reserved.receipt.call, () => {
          const current = routineMcpRegistry.run(owner, taskId, runId)
          const context = this.routineExecutionContext(taskId, runId)
          return !signal?.aborted && !persistenceFault && !!context && !context.blocked &&
            current?.calls.some(receipt => receipt.id === reserved.receipt.id && receipt.status === 'pending') === true &&
            routineMcpCallPermitted(current.permission, routineMcpRegistry.policy(owner, taskId), task.revision ?? 0,
              reserved.receipt.call, Date.now(), (id, tenant, person) => this.mcpConnection(id, tenant, person), routineMcpFacts(task).reviewHash,
              mcpRuntimeCapabilities().localProcesses === true)
        }, routineMcpPermissionOwner(ledger.permission), signal)
      } catch { outcome = { status: 'uncertain', summary: '' } }
      return settle(outcome)
    } finally { signal?.removeEventListener('abort', onAbort) }
  },
  /** The left rail's recent runs (newest-first, capped) — the caller's tenant's
   *  routines only when given (a run session belongs to its routine's tenant).
   *  Each entry carries the run's PERSISTED session row (the same row the by-id
   *  session routes serve — one source, so a rename shows here too); the quiet
   *  ensure only covers a row a pre-feature snapshot didn't carry. */
  recentRuns(tenantId?: string): RunSessionEntry[] {
    return recentEntries(tenantId ? this.listSchedules(tenantId) : schedules).map(({ task, run }) => ({
      task,
      run,
      session: ensureRunSession(task, run, { quiet: true }),
    }))
  },
  /** Begin a durable background turn. The store records the job before handing
   *  it to the configured routine worker; model I/O never lives in this state
   *  module. A scheduled run is idempotent by `(routine id, scheduledFor)`;
   *  keyed manual Run-now uses its supplied durable identity, while an active
   *  different run is returned for the route to reject as an overlap. */
  runSchedule(id: string, options?: { scheduledFor?: number; startedAt?: number; manualRunId?: string }): ScheduledRun | undefined {
    return commitMutationBatch(() => {
      const task = schedules.find((t) => t.id === id)
      if (!task) return undefined
      if (options?.manualRunId !== undefined) {
        const represented = task.runs.find((run) => run.id === options.manualRunId)
        if (represented) return represented
      }
      if (options?.scheduledFor !== undefined) {
        const represented = task.runs.find((r) => r.scheduledFor === options.scheduledFor)
        if (represented) return represented
      }
      // No overlapping runs of the same routine: a durable retry owns the routine
      // until it settles, so a scheduler tick or Run now returns that row.
      const inFlight = task.runs.find((r) => r.status === 'running')
      if (inFlight) return inFlight
      const startedAt = options?.startedAt ?? Date.now()
      const binding = scheduleBindingChoice(task)
      const rawArtifact = graph.scheduleArtifact[task.id]
      const artifact = rawArtifact === undefined ? null : parseScheduledArtifactSpec(rawArtifact)
      if (artifact === undefined) throw new ValidationError('The routine’s standing approvals are invalid. Update them before starting a run.')
      const standing = parseScheduleStanding({
        artifact,
        tools: graph.scheduleExtraTools[task.id] ?? [],
      })
      if (!standing) throw new ValidationError('The routine’s standing approvals are invalid. Update them before starting a run.')
      const run: ScheduledRun = {
        id: options?.manualRunId ?? `run-live-${(runSeq += 1)}`,
        status: 'running',
        duration: '—',
        reachedStep: 0,
        summary: options?.scheduledFor === undefined ? 'Queued on demand…' : 'Queued on schedule…',
        at: startedAt,
        attempts: 0,
        maxAttempts: Math.max(1, Math.min(8, nonNegativeIntEnv(process.env.ROUTINE_MAX_ATTEMPTS, 3))),
        nextAttemptAt: startedAt,
        execution: {
          definitionRevision: task.revision ?? 0,
          trigger: task.trigger,
          prompt: task.prompt,
          steps: structuredClone(task.steps),
          delivery: structuredClone(task.delivery),
          standing,
          agentId: binding.agent.id,
          providerId: binding.provider.id,
          ...(binding.modelId ? { modelId: binding.modelId } : {}),
          ...(binding.effort ? { effort: binding.effort } : {}),
        },
        ...(options?.scheduledFor === undefined ? {} : { scheduledFor: options.scheduledFor }),
      }
      task.runs = [run, ...task.runs]
      const permission = routineMcpRegistry.policy(task.tenantId ?? defaultTenantId(), task.id)
      // Capture once, even if it later expires or is revoked. A late approval
      // must never be inherited by a job queued without one.
      if (permission?.policy.approval) routineMcpRegistry.queue(permission, run.id)
      // Bounded history (the scheduler runs forever): past the cap the oldest run
      // retires together with its session row.
      retireOldRuns(task)
      // The run's conversation opens the moment the job is durable — the worker's
      // final model reply or failure recap lands in this same persisted thread.
      const session = ensureRunSession(task, run)
      emit({ type: 'run.started', taskId: task.id, taskName: task.name, sessionId: session.id, run })
      persist()
      // Microtasks run after this batch commits, so model I/O cannot race ahead
      // of the durable job or its ambient start event.
      queueMicrotask(() => scheduleExecutor?.(task.id, run.id))
      return run
    })
  },
  /** Running rows the worker must resume after process restart. */
  pendingScheduleRuns(): Array<{ taskId: string; runId: string; nextAttemptAt: number }> {
    return schedules.flatMap((task) => task.runs
      .filter((run) => run.status === 'running' && run.maxAttempts !== undefined)
      .map((run) => ({ taskId: task.id, runId: run.id, nextAttemptAt: run.nextAttemptAt ?? Date.now() })))
  },
  /** Stop is a durable exact-run decision, not a change to future cadence or
   * an undo of external effects. Close admission/publication before asking the
   * worker to abort; a crash between those steps still cannot replay this run. */
  stopScheduleRun(taskId: string, runId: string, actorTenantId: string, finishedAt = Date.now()): ScheduledRun | undefined {
    const stopped = commitMutationBatch(() => {
      const task = schedules.find(candidate => candidate.id === taskId)
      if (!actorTenantId || !task || !this.scheduleOwnedBy(task, actorTenantId)) return undefined
      const run = task.runs.find(candidate => candidate.id === runId)
      if (!run || run.status !== 'running') return run
      const ledger = routineMcpRegistry.run(task.tenantId ?? defaultTenantId(), taskId, runId)
      const needsReview = ledger?.calls.some(call => call.status === 'pending' || routineMcpReceiptNeedsReview(call)) === true
      if (ledger && ledger.phase !== 'interrupted') routineMcpRegistry.setRun({ ...interruptRoutineMcpRun(ledger, finishedAt), phase: 'interrupted' })
      if (needsReview) pauseRoutineMcp(task)
      run.status = 'cancelled'
      run.duration = `${Math.max(0, Math.ceil((finishedAt - run.at) / 1000))}s`
      run.summary = 'Stopped by request'
      run.detail = needsReview
        ? 'Stopped by request. External MCP work may already have taken effect. This Routine is paused. Review its call receipts before enabling it and renewing permission.'
        : 'Stopped by request. No further output will be published for this run. Stopping does not undo external actions or change the Routine’s schedule.'
      delete run.nextAttemptAt
      delete run.failureCode
      task.lastStatus = 'cancelled'
      const session = ensureRunSession(task, run)
      settleRunSession(task, run)
      emit({ type: 'run.finished', taskId: task.id, taskName: task.name, sessionId: session.id, run })
      persist()
      return run
    })
    // This is outside the commit boundary: no interruption can precede durable
    // terminal state, even if abort listeners settle private call receipts.
    if (stopped?.status === 'cancelled') scheduleRunCanceller?.(taskId, runId)
    return stopped
  },
  /** Resolve the immutable facts one attempt runs under. Every failure is a
   *  typed, user-facing terminal condition rather than a hidden fallback. */
  routineExecutionContext(taskId: string, runId: string): RoutineExecutionContext | undefined {
    const task = schedules.find((candidate) => candidate.id === taskId)
    const run = task?.runs.find((candidate) => candidate.id === runId)
    if (!task || !run || run.status !== 'running') return undefined
    const executionTask = taskForRun(task, run)
    const tenantId = task.tenantId ?? defaultTenantId()
    const visibleAgents = this.listAgents(tenantId)
    const agent = visibleAgents.find((candidate) => candidate.id === executionTask.agentId) ??
      (executionTask.agentId === undefined ? DEFAULT_AGENT : undefined)
    if (!agent) {
      return {
        task: executionTask, run, sessionId: runSessionId(task.id, run.id), tenantId,
        agent: DEFAULT_AGENT, provider: DEFAULT_PROVIDER, providerConfig: DEFAULT_PROVIDER_CONFIG,
        contexts: [], approvedContextIds: new Set(),
        blocked: { code: 'authority_denied', detail: `The routine's bound Agent '${executionTask.agentId}' is unavailable in this workspace.` },
      }
    }
    const providerId = executionTask.providerId ?? agent.providerId ?? DEFAULT_PROVIDER.id
    const provider = this.listProviders(tenantId).find((candidate) => candidate.id === providerId)
    if (!provider || provider.kind === 'session') {
      return {
        task: executionTask, run, sessionId: runSessionId(task.id, run.id), tenantId,
        agent, provider: provider ?? DEFAULT_PROVIDER, providerConfig: this.providerConfig(providerId),
        contexts: [], approvedContextIds: new Set(),
        blocked: {
          code: 'model_unavailable',
          detail: provider?.kind === 'session'
            ? 'Session providers cannot answer unattended routine runs; choose an endpoint provider.'
            : `The routine's endpoint provider '${providerId}' is unavailable in this workspace.`,
        },
      }
    }
    const providerConfig = this.providerConfig(provider.id)
    const legacyModel = provider.models?.find((candidate) => executionTask.model.includes(candidate.label))?.id
    const modelId = executionTask.modelId ?? legacyModel ?? provider.defaultModelId ?? providerConfig.model
    // A provider without a catalog can still have one configured model. An
    // endpoint's absent catalog means unknown, not empty (MODEL-16).
    if (modelId && provider.models && !provider.models.some((candidate) => candidate.id === modelId)) {
      return {
        task: executionTask, run, sessionId: runSessionId(task.id, run.id), tenantId,
        agent, provider, providerConfig, modelId, contexts: [], approvedContextIds: new Set(),
        blocked: { code: 'model_unavailable', detail: `Provider '${provider.label}' no longer lists model '${modelId}'.` },
      }
    }
    if (endpointExecution(providerConfig) === 'unconfigured') {
      return {
        task: executionTask, run, sessionId: runSessionId(task.id, run.id), tenantId,
        agent, provider, providerConfig, modelId, contexts: [], approvedContextIds: new Set(),
        blocked: { code: 'model_unavailable', detail: `Provider '${provider.label}' is not configured for execution.` },
      }
    }

    const standingFailure = scheduleStandingFailure(task.id, run.execution?.standing, graph) ??
      scheduleArtifactFormatFailure(task, run.execution?.standing?.artifact)
    if (standingFailure) {
      return {
        task: executionTask, run, sessionId: runSessionId(task.id, run.id), tenantId,
        agent, provider, providerConfig, modelId, contexts: [], approvedContextIds: new Set(),
        blocked: { code: 'authority_denied', detail: standingFailure },
      }
    }
    const referenced = [
      ...[...executionTask.steps.map((step) => step.tool), executionTask.delivery.tool].map((tool) => ({ tool, exactId: false })),
      ...(run.execution?.standing?.tools ?? []).map((tool) => ({ tool, exactId: true })),
    ].filter(({ tool }) => tool.tone === 'connector' || tool.tone === 'mcp')
    const contexts: SessionContext[] = []
    const permission = routineMcpRegistry.run(tenantId, taskId, runId)
    const permissionOwner = routineMcpPermissionOwner(permission?.permission)
    const missing: string[] = []
    const denied: string[] = []
    const effectiveAuthority = intersectAuthority(provider.authority ?? {}, agent.authority ?? {})
    for (const { tool, exactId } of referenced) {
      const compatible = this.savedContexts(tenantId, permissionOwner).contexts.filter((context) =>
        tool.tone === 'mcp' ? context.kind === 'mcp' : context.kind === 'connector')
      // Authored legacy workflow rows retain their historical label lookup;
      // a frozen standing grant is always an exact identity, never a label.
      const saved = compatible.find((context) => context.id === tool.id) ??
        (exactId ? undefined : compatible.find((context) => context.label.toLowerCase() === tool.label.toLowerCase()))
      if (!saved || saved.status !== 'connected') {
        missing.push(tool.label)
        continue
      }
      if (contexts.some((context) => context.id === saved.id)) continue
      if (isExternalMcpId(saved.id) && !permission?.permission.policy.approval?.tools.some(tool => tool.connectionId === saved.id)) {
        denied.push(`${saved.label} (explicit Routine MCP permission required)`)
        continue
      }
      if (!authorityAdmits(effectiveAuthority, 'connectors', saved.id) &&
          !authorityAdmits(effectiveAuthority, 'connectors', saved.label)) {
        denied.push(saved.label)
        continue
      }
      contexts.push({
        id: saved.id,
        type: saved.kind === 'mcp' ? 'mcp' : 'connector',
        label: saved.label,
        scope: saved.detail || '*',
      })
    }
    const approvedContextIds = new Set(contexts.map((context) => context.id))
    const review = permission ? this.routineMcpReview(taskId, tenantId, permissionOwner) : undefined
    const externalMcpConnections: McpConnectionView[] = []
    let mcpBlocked = false
    if (permission) {
      mcpBlocked = !review?.active || review.policy.revision !== permission.permission.policy.revision ||
        permission.phase !== 'active' || permission.calls.some(routineMcpReceiptNeedsReview)
      for (const selected of permission.permission.policy.approval!.tools) {
        const connection = this.mcpConnection(selected.connectionId, tenantId, permissionOwner)
        if (!connection || !review?.tools.some(tool => tool.connectionId === selected.connectionId &&
          tool.connectionRevision === selected.connectionRevision && tool.tool.name === selected.toolName && tool.schemaHash === selected.schemaHash)) {
          mcpBlocked = true
          continue
        }
        if (!externalMcpConnections.some(row => row.id === connection.id)) {
          externalMcpConnections.push(connection)
          if (!contexts.some(context => context.id === connection.id)) contexts.push({ id: connection.id, type: 'mcp', label: connection.label, scope: 'Explicit Routine MCP permission' })
        }
      }
    }
    // After uncertainty, neither a new cadence nor Run now may quietly omit
    // the suspended tools and restart the same work. Fresh review is required.
    const unresolved = routineMcpRegistry.snapshot().runs.some(ledger => ledger.permission.tenantId === tenantId &&
      ledger.permission.routineId === taskId && ledger.calls.some(routineMcpReceiptNeedsReview) &&
      (!review?.active || review.policy.revision <= ledger.permission.policy.revision))
    const blocked = denied.length > 0
      ? { code: 'authority_denied' as const, detail: `The bound Agent is not allowed to use ${denied.join(', ')}.` }
      : missing.length > 0
        ? { code: 'context_unavailable' as const, detail: `Connect ${missing.join(', ')} before this routine can run.` }
        : mcpBlocked || unresolved
          ? { code: 'authority_denied' as const, detail: 'Review and renew this Routine’s external MCP permission before running it. Its definition, destination, sharing, tool binding or prior call outcome changed.' }
          : undefined
    return {
      task: executionTask, run, sessionId: runSessionId(task.id, run.id), tenantId,
      agent, provider, providerConfig, modelId, contexts, approvedContextIds,
      ...(permission ? { externalMcpConnections, routineMcp: {
        tools: permission.permission.policy.approval!.tools.map(tool =>
          permission.permission.localAuthority?.connectionIds.includes(tool.connectionId)
            ? { ...tool, transport: 'stdio' as const } : tool),
        ...(permission.permission.policy.approval!.localPrograms === true &&
          permission.permission.localAuthority?.connectionIds.length && mcpRuntimeCapabilities().localProcesses === true
          ? { localPrograms: true as const } : {}),
        execute: (call: McpBoundToolCall, key: string, signal?: AbortSignal) => this.executeRoutineMcpCall(taskId, runId, call, key, signal),
      } } : {}),
      ...(blocked ? { blocked } : {}),
    }
  },
  markScheduleRunAttempt(taskId: string, runId: string, attempt: number, at = Date.now()): ScheduledRun | undefined {
    return commitMutationBatch(() => {
      const task = schedules.find((candidate) => candidate.id === taskId)
      const run = task?.runs.find((candidate) => candidate.id === runId)
      if (!task || !run || run.status !== 'running') return undefined
      run.attempts = attempt
      run.nextAttemptAt = at
      run.summary = `Running attempt ${attempt} of ${run.maxAttempts ?? attempt}…`
      emit({ type: 'run.progress', taskId, runId, reachedStep: run.reachedStep, status: 'running' })
      persist()
      return run
    })
  },
  deferScheduleRun(taskId: string, runId: string, nextAttemptAt: number, detail: string): ScheduledRun | undefined {
    return commitMutationBatch(() => {
      const task = schedules.find((candidate) => candidate.id === taskId)
      const run = task?.runs.find((candidate) => candidate.id === runId)
      if (!task || !run || run.status !== 'running') return undefined
      if (!this.routineMcpRunMayRetry(taskId, runId)) return this.failScheduleRun(taskId, runId, 'execution_error',
        'External MCP work was already attempted. This model prompt cannot be retried automatically.')
      run.nextAttemptAt = nextAttemptAt
      run.summary = `Retrying after attempt ${run.attempts ?? 0}…`
      run.detail = detail
      emit({ type: 'schedule.changed', taskId, tenantId: task.tenantId })
      persist()
      return run
    })
  },
  completeScheduleRun(
    taskId: string,
    runId: string,
    message: Message,
    provenance: { agentId: string; providerId: string; modelId?: string },
    finishedAt = Date.now(),
    structuredOutput?: unknown,
  ): ScheduledRun | undefined {
    return commitMutationBatch(() => {
      const task = schedules.find((candidate) => candidate.id === taskId)
      const run = task?.runs.find((candidate) => candidate.id === runId)
      if (!task || !run || run.status !== 'running') return undefined
      const ledger = routineMcpRegistry.run(task.tenantId ?? defaultTenantId(), taskId, runId)
      if (ledger) {
        const review = this.routineMcpReview(taskId, task.tenantId ?? defaultTenantId(), routineMcpPermissionOwner(ledger.permission))
        if (!review?.active || review.policy.revision !== ledger.permission.policy.revision) return this.failScheduleRun(taskId, runId,
          'authority_denied', 'External MCP permission or destination sharing changed during this run. Its private call receipts are retained; no output was published.')
      }
      if (ledger?.calls.some(call => call.status !== 'done')) return this.failScheduleRun(taskId, runId, 'execution_error',
        'An external MCP attempt did not complete successfully. Review the private call receipts; no automatic retry was made.')
      const standingFailure = scheduleStandingFailure(task.id, run.execution?.standing, graph) ??
        scheduleArtifactFormatFailure(task, run.execution?.standing?.artifact)
      if (standingFailure) return this.failScheduleRun(taskId, runId, 'authority_denied', standingFailure, finishedAt)
      const spec = run.execution?.standing?.artifact
      const authored = spec ? authoredArtifact(spec.name, spec.kind, spec.kind === 'doc' ? message.content : structuredOutput) : undefined
      if (spec && !authored) {
        return this.failScheduleRun(taskId, runId, 'execution_error',
          spec.kind === 'doc'
            ? 'The routine returned no document text. Its saved artifact was not changed.'
            : 'The routine did not return valid structured content in the approved format. Its saved artifact was not changed.', finishedAt)
      }
      run.status = 'ok'
      run.reachedStep = taskForRun(task, run).steps.length
      run.duration = `${Math.max(0, Math.ceil((finishedAt - run.at) / 1000))}s`
      run.summary = `${run.scheduledFor === undefined ? 'Completed on demand' : 'Completed on schedule'} — open the run result`
      run.detail = message.content
      delete run.nextAttemptAt
      delete run.failureCode
      task.lastStatus = 'ok'
      const session = ensureRunSession(task, run)
      // The provider's message id is not a durable idempotency key. Run sessions
      // already reserve `m2` for their primary result, so stamp the actual model
      // reply onto that key; boot-time materialization will then never append a
      // second synthesized recap after restart.
      const stamped: Message = { ...message, id: RUN_RECAP_MESSAGE_ID, ...provenance }
      applyMessage(session, stamped, finishedAt)
      if (spec && authored) applyStandingEffects(task, session.id, spec, authored, finishedAt)
      emit({ type: 'session.updated', session })
      emit({ type: 'run.finished', taskId: task.id, taskName: task.name, sessionId: session.id, run })
      persist()
      return run
    })
  },
  failScheduleRun(
    taskId: string,
    runId: string,
    code: NonNullable<ScheduledRun['failureCode']>,
    detail: string,
    finishedAt = Date.now(),
  ): ScheduledRun | undefined {
    return commitMutationBatch(() => {
      const task = schedules.find((candidate) => candidate.id === taskId)
      const run = task?.runs.find((candidate) => candidate.id === runId)
      if (!task || !run || run.status !== 'running') return undefined
      const ledger = routineMcpRegistry.run(task.tenantId ?? defaultTenantId(), taskId, runId)
      if (ledger?.calls.some(call => call.status === 'pending' || routineMcpReceiptNeedsReview(call))) {
        if (ledger.phase !== 'interrupted') routineMcpRegistry.setRun(interruptRoutineMcpRun(ledger, finishedAt))
        pauseRoutineMcp(task)
        detail = 'External MCP work may already have taken effect. This Routine is paused. Review its call receipts before enabling it and renewing permission.'
      }
      run.status = 'failed'
      run.duration = `${Math.max(0, Math.ceil((finishedAt - run.at) / 1000))}s`
      run.summary = `Failed after ${run.attempts ?? 0} attempt${run.attempts === 1 ? '' : 's'}`
      run.detail = detail
      run.failureCode = code
      delete run.nextAttemptAt
      task.lastStatus = 'failed'
      const session = ensureRunSession(task, run)
      settleRunSession(task, run)
      if (task.notifyOnFailure !== false) {
        const agentId = run.execution?.agentId ?? task.agentId
        const agent = agentId ? WORKER_AGENTS.get(agentId) : DEFAULT_AGENT
        appendNotification(task.tenantId ?? defaultTenantId(), {
          kind: 'schedule.failed',
          actor: agent?.label ?? 'Routine runner',
          scheduleId: task.id,
          scheduleName: task.name,
          runId: run.id,
        })
      }
      emit({ type: 'run.finished', taskId: task.id, taskName: task.name, sessionId: session.id, run })
      persist()
      return run
    })
  },
  /** Represent an overdue fire that policy deliberately skipped. This is a real,
   *  visible run/session row (not a silent cursor jump), with the same fire-time
   *  idempotency as execution. */
  recordSkippedScheduleFire(id: string, scheduledFor: number, at = Date.now()): ScheduledRun | undefined {
    const task = schedules.find((t) => t.id === id)
    if (!task) return undefined
    const represented = task.runs.find((run) => run.scheduledFor === scheduledFor)
    if (represented) return represented
    const run: ScheduledRun = {
      id: `run-live-${(runSeq += 1)}`,
      status: 'skipped',
      duration: '0s',
      reachedStep: 0,
      summary: 'Missed while the app was offline — skipped by policy',
      detail: 'This routine is set to skip missed runs. Its next future occurrence remains scheduled.',
      at,
      scheduledFor,
    }
    task.runs = [run, ...task.runs]
    retireOldRuns(task)
    const session = ensureRunSession(task, run)
    settleRunSession(task, run)
    emit({ type: 'run.finished', taskId: task.id, taskName: task.name, sessionId: session.id, run })
    persist()
    return run
  },
  /** Advance the durable scheduler cursor without revising the human-authored
   *  routine definition. The display label is derived from the same cadence core. */
  setScheduleNextFire(id: string, nextFireAt: number, now = Date.now()): ScheduledTask | undefined {
    const task = schedules.find((t) => t.id === id)
    if (!task) return undefined
    const timing = scheduleTiming(task.cadence, task.timezone, now)
    if (timing.nextFireAt !== nextFireAt) {
      throw new ValidationError('The scheduler cursor must be the next cadence occurrence.')
    }
    task.nextFireAt = nextFireAt
    task.next = timing.next
    task.trigger = timing.trigger
    emit({ type: 'schedule.changed', taskId: task.id, tenantId: task.tenantId })
    persist()
    return task
  },
  /** Set a routine's enabled state — to an explicit value, or toggle when the
   *  value is omitted. */
  setScheduleEnabled(id: string, enabled?: boolean): ScheduledTask | undefined {
    const task = schedules.find((t) => t.id === id)
    if (!task) return undefined
    return this.updateSchedule(id, { enabled: enabled ?? !task.enabled })
  },
  /** Merge a partial patch of a routine's OWN fields (the entity edits behind the
   *  detail page — name, prompt, cadence, model, steps, …). Only the fields present
   *  in the patch are written; id / runs / run-derived state are never touched
   *  (cross-entity bindings live in the relation graph, not here). Returns the
   *  updated task, or undefined if no routine has that id. */
  updateSchedule(
    id: string,
    patch: SchedulePatch,
    expectedRevision?: number,
  ): ScheduledTask | undefined {
    const task = schedules.find((t) => t.id === id)
    if (!task) return undefined
    const currentRevision = task.revision ?? 0
    if (expectedRevision !== undefined && expectedRevision !== currentRevision) {
      throw new ConflictError(
        `This routine changed elsewhere (expected revision ${expectedRevision}, current revision ${currentRevision}).`,
      )
    }
    if (patch.missedFirePolicy !== undefined && patch.missedFirePolicy !== 'skip' && patch.missedFirePolicy !== 'catch-up-once') {
      throw new ValidationError(`Unknown missed-fire policy '${patch.missedFirePolicy}'.`)
    }
    const prospectiveCadence = patch.cadence ?? task.cadence
    const prospectiveTimezone = patch.timezone ?? task.timezone
    const timingChanged = patch.cadence !== undefined || patch.timezone !== undefined
    const enabling = patch.enabled === true && !task.enabled
    const willBeEnabled = patch.enabled ?? task.enabled
    const now = Date.now()
    // Validate timing edits even while paused. A newly enabled or currently
    // enabled changed routine also receives its first future durable cursor.
    const validatedTiming = timingChanged ? scheduleTiming(prospectiveCadence, prospectiveTimezone, now) : undefined
    const nextTiming = willBeEnabled && (timingChanged || enabling || !Number.isFinite(task.nextFireAt))
      ? validatedTiming ?? scheduleTiming(prospectiveCadence, prospectiveTimezone, now)
      : undefined
    const bindingChanged =
      patch.agentId !== undefined || patch.providerId !== undefined || patch.modelId !== undefined ||
      patch.effort !== undefined || patch.model !== undefined
    const binding = bindingChanged || enabling
      ? scheduleBindingChoice(task, patch)
      : undefined
    if (patch.enabled !== undefined) task.enabled = patch.enabled
    if (patch.name !== undefined) {
      task.name = patch.name
      // The runs' sessions carry the routine's name (title + initiator stamp) —
      // sync them so the run threads can't drift from a renamed routine (UI-12:
      // no stale mirror of a live source). Quietly: one rename must not emit a
      // full-payload session.updated per run (a routine can hold RUN_HISTORY_CAP
      // of them — that would flood the event-log ring and fan out N refetches);
      // the schedule.changed below is the one broadcast, and the run rows aren't
      // in the sessions list, so nothing reads them except a by-id open — which
      // re-reads on select.
      for (const s of SESSIONS) {
        if (s.scheduledRunOf?.taskId !== task.id) continue
        s.title = patch.name
        s.scheduledRunOf = { ...s.scheduledRunOf, taskName: patch.name }
        s.metadataRevision = (s.metadataRevision ?? 0) + 1
      }
    }
    if (patch.prompt !== undefined) task.prompt = patch.prompt
    if (patch.cadence !== undefined) {
      task.cadence = patch.cadence
      // Cadence is authored; the WHEN sentence is its projection. A proposal
      // that changes only recurrence must not leave the workflow saying the old time.
      task.trigger = validatedTiming!.trigger
    }
    if (patch.timezone !== undefined) task.timezone = patch.timezone
    if (patch.missedFirePolicy !== undefined) task.missedFirePolicy = patch.missedFirePolicy
    if (binding) {
      task.agentId = binding.agent.id
      task.providerId = binding.provider.id
      if (binding.modelId) task.modelId = binding.modelId
      else delete task.modelId
      if (binding.effort) task.effort = binding.effort
      else delete task.effort
      task.model = binding.label
    }
    if (patch.notifyOnFailure !== undefined) task.notifyOnFailure = patch.notifyOnFailure
    if (patch.delivery !== undefined) task.delivery = patch.delivery
    if (patch.steps !== undefined) task.steps = patch.steps
    if (!task.enabled) {
      delete task.nextFireAt
    } else if (nextTiming) {
      task.nextFireAt = nextTiming.nextFireAt
      task.next = nextTiming.next
    }
    task.revision = currentRevision + 1
    emit({ type: 'schedule.changed', taskId: task.id, tenantId: task.tenantId })
    persist()
    return task
  },
  /** Add a routine from a template (lands paused), return it. A keyed caller
   * supplies its tenant-scoped durable identity so replay still converges after
   * the route's in-memory response cache is gone. */
  addSchedule(seed: Omit<ScheduledTask, 'id'>, logicalId?: string): ScheduledTask {
    if (logicalId) {
      const ownerTenant = seed.tenantId ?? defaultTenantId()
      const represented = schedules.find((task) =>
        task.id === logicalId && (task.tenantId ?? defaultTenantId()) === ownerTenant)
      if (represented) return represented
    }
    const timing = scheduleTiming(seed.cadence, seed.timezone, Date.now())
    const binding = scheduleBindingChoice(seed)
    const task: ScheduledTask = {
      ...seed,
      id: logicalId ?? `s-new-${(scheduleSeq += 1)}`,
      revision: 0,
      agentId: binding.agent.id,
      providerId: binding.provider.id,
      model: binding.label,
      ...(binding.modelId ? { modelId: binding.modelId } : {}),
      ...(binding.effort ? { effort: binding.effort } : {}),
    }
    task.trigger = timing.trigger
    if (task.enabled) {
      task.nextFireAt = timing.nextFireAt
      task.next = timing.next
    } else {
      delete task.nextFireAt
    }
    schedules.unshift(task)
    // A seed can carry run history — capped, and every run gets its session row
    // through the same funnel (the one-funnel invariant holds wherever runs
    // enter the store).
    retireOldRuns(task)
    for (const run of task.runs) {
      ensureRunSession(task, run, { quiet: true })
      settleRunSession(task, run, { quiet: true })
    }
    emit({ type: 'schedule.changed', taskId: task.id, tenantId: task.tenantId })
    persist()
    return task
  },
  /** Remove one reviewed routine definition and every run-session projection in
   * one durable batch. Run conversations are routine-owned; their independent
   * context/workspace/preferences/project joins must not survive as orphans.
   * Artifacts they produced remain independent provenance-bearing resources. */
  removeSchedule(id: string, expectedRevision?: number): boolean {
    const i = schedules.findIndex((t) => t.id === id)
    if (i < 0) return false
    if (routineMcpRegistry.snapshot().runs.some(run => run.permission.routineId === id && run.calls.some(call => call.status === 'pending'))) {
      throw new ConflictError('An external MCP call is still pending. Wait for its receipt before removing this Routine.')
    }
    const currentRevision = schedules[i]!.revision ?? 0
    if (expectedRevision !== undefined && expectedRevision !== currentRevision) {
      throw new ConflictError(
        `This routine changed elsewhere (expected revision ${expectedRevision}, current revision ${currentRevision}).`,
      )
    }
    return commitMutationBatch(() => {
      routineMcpRegistry.removeRoutine(schedules[i]!.tenantId ?? defaultTenantId(), id)
      const [gone] = schedules.splice(i, 1)
      const removedSessions: Session[] = []
      for (let j = SESSIONS.length - 1; j >= 0; j -= 1) {
        const session = SESSIONS[j]!
        if (session.scheduledRunOf?.taskId !== gone.id) continue
        removedSessions.push(...SESSIONS.splice(j, 1))
        discardMcpActivityAuthorities(session.id)
        sessionContextBindings.delete(session.id)
        sessionWorkspaces.delete(session.id)
        removeSessionPreferences(session.id)
      }

      let graphChanged = false
      const sessionProject = { ...graph.sessionProject }
      for (const session of removedSessions) {
        if (!Object.prototype.hasOwnProperty.call(sessionProject, session.id)) continue
        delete sessionProject[session.id]
        graphChanged = true
      }
      const removeRoutineKey = <T>(map: Record<string, T>): Record<string, T> => {
        if (!Object.hasOwn(map, gone.id)) return map
        graphChanged = true
        const next = { ...map }
        delete next[gone.id]
        return next
      }
      const scheduleProject = removeRoutineKey(graph.scheduleProject)
      const scheduleArtifact = removeRoutineKey(graph.scheduleArtifact)
      const scheduleSession = removeRoutineKey(graph.scheduleSession)
      const scheduleExtraTools = removeRoutineKey(graph.scheduleExtraTools)
      const standingApprovals = Object.fromEntries(Object.entries(graph.standingApprovals).filter(([key]) => {
        // Historical labels remain in keys. Preserve another live routine's
        // ambiguous legacy key rather than claiming its authority for this one.
        const owned = scheduleApprovalKeyMatches(key, gone.id) &&
          !schedules.some((task) => scheduleApprovalKeyMatches(key, task.id))
        if (owned) graphChanged = true
        return !owned
      }))
      const detachedArtifacts: string[] = []
      const owner = gone.tenantId ?? defaultTenantId()
      const extraArtifacts = graph.extraArtifacts.map((artifact) => {
        if (artifact.sourceScheduleId !== gone.id || (artifact.tenantId ?? defaultTenantId()) !== owner) return artifact
        // The output remains an independent resource with its original run
        // provenance. Only its deleted routine's overwrite binding disappears.
        const { sourceScheduleId: _binding, ...independent } = artifact
        detachedArtifacts.push(artifact.id)
        graphChanged = true
        return independent
      })
      if (graphChanged) {
        graph = {
          ...graph,
          sessionProject,
          scheduleProject,
          scheduleArtifact,
          scheduleSession,
          scheduleExtraTools,
          standingApprovals,
          extraArtifacts,
          revision: (graph.revision ?? 0) + 1,
        }
      }

      for (const artifactId of detachedArtifacts) emit({ type: 'artifact.changed', artifactId })
      // Open run panes need the definitive gone signal; schedule.changed alone
      // only refreshes routine projections and cannot identify every run session.
      for (const session of removedSessions) emit({ type: 'session.removed', session })
      // Stamped from the removed row — the gate can no longer resolve it by id.
      emit({ type: 'schedule.changed', taskId: gone.id, tenantId: gone.tenantId })
      persist()
      return true
    })
  },

  // ── Recents (per-user Add-context shortcut lists) ──
  recents(tenantId: string = defaultTenantId()): RecentsSnapshot {
    return contextRegistry.recents(tenantId)
  },
  /** Promote an id to the front of its type's list — non-evicting; the list only
   *  grows. Broadcasts so every open picker (and other devices) reflects it. */
  pushRecent(type: ContextTypeId, id: string, tenantId: string = defaultTenantId()): RecentsSnapshot {
    const snapshot = contextRegistry.pushRecent(type, id, tenantId)
    emit({ type: 'recents.changed', contextType: type, ids: snapshot[type], tenantId })
    persist()
    return snapshot
  },

  /** The current relationship graph (seed + applied edits). */
  relationGraph(tenantId?: string): RelationGraph {
    // No tenant ⇒ the full graph (internal callers, tests). A tenant ⇒ its projected view
    // (F2/PD9). The default tenant's projection equals the full graph (all seed rows are
    // the default tenant's), so the route can always pass the caller's tenant safely.
    return tenantId ? projectGraphForTenant(graph, tenantId) : graph
  },
  /** Apply a confirmed relation op (the canonical write), broadcast it, and return the
   *  (possibly unchanged) graph. Three kinds of op land here:
   *   • An **Agent Commons CRUD** op (D6/D9/D10/D7) edits a *registry*, not the graph,
   *     so it's executed through the same mutator the Agents hub uses (the D8 funnel +
   *     the 409 guards) — Claude proposing it and the user confirming the card is just
   *     another caller of that one seam. A stale reference (the agent was removed after
   *     the proposal) is a `ConflictError` → 409.
   *   • `attach-context` is a live-session effect, not a graph edit (the caller applies
   *     it), so it's a graph no-op here.
   *   • Every other op is a relationship-graph edit, applied by the pure reducer.
   *  All three broadcast `relation.applied` and persist. */
  applyRelationOp(op: RelationOp, tenantId?: string): RelationGraph {
    if (op.kind === 'set-schedule-artifact') {
      const spec = parseScheduledArtifactSpec({ name: op.artifactName,
        kind: Object.hasOwn(op, 'artifactKind') ? op.artifactKind : 'doc' })
      if (!spec) throw new ValidationError('The routine output must have a valid name and an explicit supported format.')
      const scheduleId = op.scheduleId
      const task = schedules.find((candidate) => candidate.id === scheduleId)
      const failure = task && scheduleArtifactFormatFailure(task, spec)
      if (failure) throw new ConflictError(failure)
    }
    if (op.kind === 'scope-context' && op.context.source !== undefined && !isProjectContextSource(op.context.source)) {
      throw new ValidationError('This context source is malformed.')
    }
    if (tenantId && op.kind === 'scope-context' && op.context.source?.kind === 'mcp' &&
        isExternalMcpId(op.context.source.id) &&
        !mcpConnectionRegistry.view(op.context.source.id, tenantId)) {
      throw new ValidationError('This context source is unavailable.')
    }
    if (op.kind === 'unscope-context' && op.contextSource !== undefined && !isProjectContextSource(op.contextSource)) {
      throw new ValidationError('This context source is malformed.')
    }
    if (op.kind === 'unscope-context') {
      const contexts = graph.projectContexts[op.projectId] ?? []
      if (projectContextSelectorIsAmbiguous(contexts, op)) {
        throw new ValidationError('This context selector is ambiguous; refresh and include its source identity.')
      }
    }
    // Project prose has no independent row object/revision, so compare the
    // exact field the author reviewed. This avoids a coarse graph-revision
    // fence: filing a Conversation or editing an unrelated Project must not
    // make a valid prose save stale. Absence deliberately preserves the legacy
    // unconditional-write contract for older callers.
    if (op.kind === 'set-project-description' && op.expectedDescription !== undefined) {
      const current = graph.projectDescriptions[op.projectId]
        ?? findProject(op.projectId)?.description
        ?? ''
      if (op.expectedDescription !== current) {
        throw new ConflictError('This Project description changed elsewhere.')
      }
    }
    if (op.kind === 'set-project-instructions' && op.expectedInstructions !== undefined) {
      const current = graph.projectInstructions[op.projectId]
        ?? findProject(op.projectId)?.instructions
        ?? ''
      if (op.expectedInstructions !== current) {
        throw new ConflictError("This Project's instructions changed elsewhere.")
      }
    }
    // Capture values, not a live row: share changes replace graph rows and a
    // public-to-private transition must still invalidate its former readers.
    const projectBefore = op.kind === 'share-project' || op.kind === 'set-project-description'
      ? findProject(op.projectId) : undefined
    const publicFaceBefore = projectBefore && {
      id: projectBefore.id,
      shared: projectBefore.shared === true,
      description: projectDescription(projectBefore, graph),
    }
    // A current authored save is one compound durable act: validate and
    // normalize its authored body before the graph can mint metadata, then lay
    // the body under the minted id before the single persist below. Historical
    // metadata-only saves remain replayable; new producers always supply body.
    let authored: AuthoredArtifact | undefined
    let bodyDerivedExcerpt = false
    let existingArtifactId: string | undefined
    if (op.kind === 'save-artifact') {
      if (!op.artifact || typeof op.artifact.name !== 'string') {
        throw new ValidationError('Artifact name (string) is required.')
      }
      if (typeof op.artifact.meta !== 'string') {
        throw new ValidationError('Artifact meta must be a string.')
      }
      if (op.artifact.excerpt !== undefined && typeof op.artifact.excerpt !== 'string') {
        throw new ValidationError('Artifact excerpt must be a string when supplied.')
      }
      bodyDerivedExcerpt = !op.artifact.excerpt?.trim()
      // Replay identity is tenant-scoped. The incoming owner stamp is never
      // trusted: the authenticated caller (or fixed desktop tenant) supplies it
      // here before the tenant-agnostic shared reducer sees the operation.
      const ownerTenantId = tenantId ?? defaultTenantId()
      op = { ...op, ownerTenantId }
      const artifactName = op.artifact.body === undefined ? op.artifact.name : normalizeArtifactName(op.artifact.name)
      if (artifactName === undefined) {
        throw new ValidationError('Artifact name must be 1 to 240 characters and cannot contain control characters.')
      }
      if (artifactName !== op.artifact.name) {
        op = { ...op, artifact: { ...op.artifact, name: artifactName } }
      }
      const saveOp = op
      const saveOriginHash = artifactSaveOriginHash(ownerTenantId, {
        name: artifactName,
        source: saveOp.sessionTitle ?? 'Created here',
      })
      if ([...artifactRetirements.values()].some((row) => row.tenantId === ownerTenantId && row.saveOriginHash === saveOriginHash)) {
        throw new ConflictError('This Artifact’s saved origin was permanently deleted and cannot be recreated by replaying the same save.')
      }
      existingArtifactId = graph.extraArtifacts.find((candidate) => artifactMatchesSave(candidate, saveOp))?.id
      if (op.artifact.body !== undefined) {
        authored = authoredArtifact(artifactName, op.artifact.kind, op.artifact.body)
        if (!authored) throw new ValidationError(op.artifact.kind === 'doc'
          ? 'Document body must contain text.'
          : 'Artifact body must match its kind and stay within the structured content limits.')
        if (existingArtifactId) {
          const existingBody = artifactBodies.get(existingArtifactId)
          const replayBody = identifyDocumentBody(existingArtifactId, { ...authored.body, revision: 0 })
          if (!existingBody || JSON.stringify(existingBody) !== JSON.stringify(replayBody)) {
            throw new ConflictError(`An artifact named '${artifactName}' already exists here.`)
          }
        }
        op = {
          ...op,
          artifact: {
            ...op.artifact,
            body: authored.draftBody,
            excerpt: op.artifact.excerpt?.trim() || authored.excerpt,
          },
        }
      }
    }
    switch (op.kind) {
      case 'create-provider':
        // A user-confirmed provider is a proper cascade root: grant everything (the
        // account plan still bounds it), matching the seeded default's explicit '*'.
        this.createProvider({
          label: op.label,
          modelFamily: op.modelFamily,
          effortLevels: ['Low', 'Medium', 'High'],
          authority: { tools: ['*'], connectors: ['*'], scopes: ['*'] },
        }, {}, tenantId)
        break
      case 'create-prompt':
        this.createSystemPrompt({ label: op.label, body: op.body, targetFamily: op.targetFamily }, tenantId)
        break
      case 'create-agent': {
        // The tool builder stamps concrete bindings on every proposal (default-else-
        // first when the model named none), so the consent card the user confirmed
        // already NAMED the provider + prompt — by library id, or as a bundled
        // same-turn `newPrompt` payload (the card showed its body). A proposal with
        // neither (a stale pre-strictness one) is refused like any other invalid
        // create — never silently resolved to a default.
        if (!op.providerId || (!op.systemPromptId && !op.newPrompt)) {
          throw new ValidationError('This proposal predates the required provider/prompt bindings — ask for it again.')
        }
        let promptId = op.systemPromptId
        if (!promptId && op.newPrompt) {
          // Materialise the bundled prompt — reusing an identically-labelled library
          // entry the tenant can already see (a replayed op, or the stand-alone
          // prompt card confirmed by an older client) rather than minting a
          // duplicate: the create-project exists-check pattern.
          const label = op.newPrompt.label.trim().toLowerCase()
          const existing = [...SYSTEM_PROMPT_LIB.values()].find(
            (p) => p.label.trim().toLowerCase() === label && (p.tenantId === undefined || p.tenantId === tenantId),
          )
          promptId = (existing ?? this.createSystemPrompt(
            { label: op.newPrompt.label, body: op.newPrompt.body, targetFamily: op.newPrompt.targetFamily },
            tenantId,
          )).id
        }
        this.createAgentFromRequest({
          label: op.label,
          providerId: op.providerId,
          systemPromptId: promptId!,
          instructions: op.instructions,
          // Absent on a stale proposal ⇒ the empty set (minimal risk) — unlike the
          // bindings above, absence here has an honest meaning, so no refusal.
          tools: op.tools,
        }, tenantId)
        break
      }
      case 'commission-agent':
        if (!WORKER_AGENTS.has(op.agentId)) {
          throw new ConflictError(`No agent '${op.agentId}' to commission — it may have been removed.`)
        }
        this.createCommission({ agentId: op.agentId, projectId: op.projectId, role: op.role }, tenantId)
        break
      case 'uncommission-agent':
        // Idempotent: a commission already gone (e.g. removed in the hub first) is a
        // benign no-op, not an error — the Contributor is absent either way.
        this.deleteCommission(op.commissionId)
        break
      case 'handoff-agent':
        this.setSessionAgent(op.sessionId, op.agentId) // D16: re-bind the Conversation's driver
        break
      case 'set-commission-cap':
        this.setCommissionCap(op.projectId, op.cap) // D13: the owner's abuse ceiling, via the same card
        break
      case 'set-project-default-role':
        this.setProjectDefaultRole(op.projectId, op.role) // D14: the pickers' pre-selection, via the same card
        break
      case 'attach-context':
        break // a live-session effect, applied by the caller
      default:
        graph = applyGraphOp(graph, op, mintArtifactId, Date.now())
        // Stamp the creating tenant on a newly-created project so the graph projection
        // (relationGraph(tenantId)) scopes it (F2/PD9). The shared reducer stays tenant-
        // agnostic; the server (which knows the caller) owns the stamp.
        if (op.kind === 'create-project') {
          const created = graph.extraProjects.find((p) => p.id === op.projectId)
          // FWD-6 O-D4: an explicit ownerTenantId (validated in opDeniedForTenant —
          // a held seat) stamps the org; ABSENT means the caller's own namespace,
          // the fixed minimal-risk absence class (INV-9), never a mutable default.
          if (created && created.tenantId === undefined) created.tenantId = op.ownerTenantId ?? tenantId ?? defaultTenantId()
        } else if (op.kind === 'save-artifact') {
          // The reducer unshifts the new artifact to extraArtifacts[0] (its id is minted
          // internally). Stamp the creating tenant so the projection scopes it (F2/PD9).
          const saveOp = op
          const created = graph.extraArtifacts.find((candidate) => artifactMatchesSave(candidate, saveOp))
          if (created && created.tenantId === undefined) created.tenantId = tenantId ?? defaultTenantId()
          if (created && authored && !existingArtifactId) {
            if (bodyDerivedExcerpt) created.excerptSource = 'body'
            artifactBodies.set(created.id, identifyDocumentBody(created.id, { ...authored.body, revision: 0 }))
            emit({ type: 'artifact.changed', artifactId: created.id })
          }
        }
    }
    // Version the complete snapshot before broadcasting/responding. A client's
    // own HTTP response can cross a newer ambient refetch on the wire; revision
    // comparison prevents the older full graph from rewinding that newer view.
    graph = { ...graph, revision: (graph.revision ?? 0) + 1 }
    // Commit before publishing either hint. Inside a compound mutation this
    // marks its durable batch; both events remain queued until that commit.
    persist()
    // Stamp the acting tenant so the SSE fan-out delivers this only to that tenant (F2/PD9).
    emit({ type: 'relation.applied', op, by: 'user', tenantId: tenantId ?? defaultTenantId() })
    const projectAfter = publicFaceBefore && findProject(publicFaceBefore.id)
    if (publicFaceBefore && projectAfter && (
      publicFaceBefore.shared !== (projectAfter.shared === true) ||
      publicFaceBefore.description !== projectDescription(projectAfter, graph)
    )) emitProjectChanged(projectAfter, publicFaceBefore.shared)
    // Return the caller's projected view (F2/PD9); no tenant ⇒ the full graph.
    return tenantId ? projectGraphForTenant(graph, tenantId) : graph
  },
  /** Whether a relation op must be REFUSED for `tenantId` (F2/PD9). The route rejects it
   *  404 (existence-hiding) BEFORE the shared reducer applies it. Two independent checks —
   *  a violation of EITHER denies:
   *    • **Destination project** — an op whose (non-null) `projectId` names a project the
   *      caller doesn't own. `create-project` is *not* exempt: a brand-new id resolves to no
   *      project (allowed), but a create-project COLLIDING with a foreign id takes the
   *      reducer's re-file path (contract/graph.ts) and would inject the caller's session
   *      into the victim's project — so it must be refused like any other foreign target.
   *    • **Subject session** — an op that moves a SESSION (`sessionId`) it doesn't own, e.g.
   *      unfiling (`projectId:null`) another tenant's session. Sessions are tenant-scoped
   *      (sessionVisibleToTenant); an unknown session has no owner to protect (allowed).
   *  Seed projects/sessions are the default tenant's, so the default caller passes. (The
   *  artifact and routine SUBJECT axes are checked independently of a destination.) */
  opDeniedForTenant(op: RelationOp, tenantId: string): boolean {
    // A source-qualified project scope is an admission of a tenant-owned
    // external MCP identity. Keep the source opaque at the wire boundary, but
    // do not let a caller mint a foreign or phantom connection reference. The
    // source owner may still remove a stale graph row later via unscope; this
    // check is intentionally only on new scope admission.
    if (op.kind === 'scope-context' && op.context.source?.kind === 'mcp' &&
        isExternalMcpId(op.context.source.id) &&
        !mcpConnectionRegistry.view(op.context.source.id, tenantId)) return true
    const pid = (op as { projectId?: string | null }).projectId
    // `!= null`, not truthiness: an EMPTY-STRING projectId is still a real key on the write
    // side and buckets to the default tenant on read (projectTenant('') ⇒ default), so it
    // must run the ownership check too — a truthy `if (pid)` would skip '' and let a
    // non-default tenant inject a ''-keyed row into the default view. The genuine unfile is
    // `projectId: null`, which stays exempt here (handled by the subject-session check).
    if (pid != null) {
      // An UNKNOWN project id is not un-owned: `projectGraphForTenant` buckets any row
      // keyed by an id with no Project object to the DEFAULT tenant (projectTenant ⇒
      // defaultTenantId()). So a non-default caller keying a project row (scope-context,
      // set-project-instructions, file-session, …) under a guessed/ghost id would inject
      // it into the default tenant's projection — refuse it. `create-project` is the sole
      // exception: an unknown id there MINTS a fresh Project stamped with the caller, so a
      // brand-new id is legitimately the caller's; only a COLLISION with an existing
      // foreign project must be refused (findProject resolves it).
      const owner = projectTenant(pid) // defaultTenantId() for an unknown id
      if (op.kind === 'create-project') {
        if (findProject(pid) && !tenantWritesAs(tenantId, owner)) return true
        // FWD-6 O-D4 — the owner picker: a present ownerTenantId must be a tenant
        // the caller holds a SEAT in (their own namespace included); anything else
        // is refused with the same existence-hiding 404 as any foreign target —
        // never normalized to a namespace it didn't say (INV-9).
        if (op.ownerTenantId && accounts.seatIn(tenantId, op.ownerTenantId) === undefined) return true
      } else if (!tenantWritesAs(tenantId, owner)) {
        // P8 carve-out — the ONE cross-tenant project op allowed: commissioning your OWN
        // agent onto a SHARED Project (the cooperation primitive, D13 owner-pays). The
        // agent-subject axis below still requires the agent be the caller's own, so this
        // admits a Contributor without letting anyone conscript a foreign agent or write
        // other content into a foreign Project (file-session/scope/share-project stay owner-only).
        if (!(op.kind === 'commission-agent' && findProject(pid)?.shared === true)) return true
        // Close the ghost-vs-foreign existence oracle (P8 review): on THIS cross-tenant path an
        // UNKNOWN agent is denied here (uniform 404), matching the KNOWN-foreign denial the
        // general agent-subject axis gives below — else a foreign caller could distinguish a real
        // private agent (foreign ⇒ 404) from a ghost (would fall through to the 409 the
        // same-tenant "agent removed" case gives). The same-tenant path (owner === tenantId) is
        // untouched, so that helpful 409 is preserved for a caller's own removed agent.
        if (!WORKER_AGENTS.get(op.agentId)) return true
      }
    }
    // Subject ARTIFACT: an op that moves/edits an existing artifact (refile-artifact,
    // set-artifact-source) it doesn't own. Like the project axis, an unknown/empty id
    // buckets to the default tenant on read (artifactTenant), so `!= null` (not truthiness)
    // — a non-default caller keying a ghost/'' artifact row is refused. (save-artifact
    // MINTS a new id internally, carries no `artifactId`, so it's naturally exempt here.)
    const aid = (op as { artifactId?: string }).artifactId
    if (aid != null && (artifactIsTrashed(aid) || artifactIsRetired(aid))) return true
    if (aid != null && artifactTenant(aid) !== tenantId) return true
    // A routine's standing bindings are writes, not shared-reader actions.
    // Unknown and blank ids have no owner and cannot mint ghost authority.
    const scheduleId = (op as { scheduleId?: string }).scheduleId
    if (scheduleId !== undefined) {
      const task = schedules.find((candidate) => candidate.id === scheduleId)
      if (!task || !this.scheduleOwnedBy(task, tenantId)) return true
    }
    const sid = (op as { sessionId?: string }).sessionId
    if (sid) {
      const session = SESSIONS.find((s) => s.id === sid)
      if (session && !this.sessionVisibleToTenant(session, tenantId)) return true
    }
    // Subject AGENT / COMMISSION (Agent-Commons registry axes, F2/PD9): a relation op that
    // names an existing agent/commission the caller can't see (commission-agent, handoff-agent
    // → agentId; uncommission-agent → commissionId) is refused — a tenant can't commission,
    // hand a session off to, or uncommission another tenant's PRIVATE registry entry. A shared
    // (seeded) entry is visible to all (registryVisible); an unknown id isn't a leak (registries
    // have no read-projection), so only a KNOWN foreign entry is denied.
    const opAgentId = (op as { agentId?: string }).agentId
    if (opAgentId != null) {
      const agent = WORKER_AGENTS.get(opAgentId)
      if (agent && !registryVisible(agent, tenantId)) return true
    }
    const opCommissionId = (op as { commissionId?: string }).commissionId
    if (opCommissionId != null) {
      const commission = COMMISSIONS.get(opCommissionId)
      if (commission && !registryVisible(commission, tenantId)) return true
    }
    return false
  },
}
