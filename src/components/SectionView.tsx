import { useContext, useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react'
import { createPortal } from 'react-dom'
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
  ChevronUp,
  Clock,
  Cpu,
  ExternalLink,
  FileText,
  Folder,
  FolderGit2,
  GitBranch,
  GitFork,
  Github,
  GitMerge,
  GitPullRequest,
  Globe,
  History,
  KeyRound,
  Lock,
  Mail,
  MessageSquare,
  MinusCircle,
  PauseCircle,
  Pencil,
  Play,
  PlayCircle,
  Plug,
  Plus,
  RefreshCw,
  Search,
  SendHorizontal,
  Server,
  Share2,
  Sparkles,
  SquareKanban,
  Trash2,
  Unplug,
  X,
  type LucideIcon,
} from 'lucide-react'
import type { AddedContext, ArtifactKind, Connector, SavedContext, SavedContextKind, SectionId } from '../types'
import { SECTION_META } from '../lib/sections'
import { FOLD_HEADER_CLASS } from '../lib/foldHeader'
import { PAGE_HEADER_CLASS, PAGE_TITLE_CLASS } from '../lib/pageHeader'
import { connectorIconFor } from '../lib/connectors'
import { CHIP_TONES, type ChipTone } from '../lib/capabilities'
import { addedToProjectContexts, contextsToConnectors, projectContextTone } from '../lib/projectContext'
import {
  type CadenceSpec,
  type Frequency,
  TIMED_FREQS,
  WEEKDAY_NAMES,
  describeCadence,
  nextRunLabel,
  parseCadence,
} from '../lib/cadence'
import { composeModelLabel, displayModelLabel, isOpusModel, modelBlurb, parseModelChoice, type ModelPick } from '../lib/models'
import { loadModelPrefs, saveModelPrefs, type ModelPrefs } from '../lib/modelPrefs'
import { ModelPickerMenu } from './ModelPickerMenu'
import { STEP_TOOLS } from '../lib/stepTools'
import { cleanSteps, moveStep, removeStep } from '../lib/steps'
import { ConnectorDetailBody } from './ConnectorPanel'
import { AddContextButton } from './AddContextButton'
import { INLINE_ACTION_CLASS } from '../lib/inlineAction'
import { profileTitle, PROFILE_TAGLINE } from '../lib/publicFace'
import { ActorByline, AgentActor, Byline, CreditLine, OwnerLink, WorkspaceMark } from './PublicFace'
import { TextDiff } from './TextDiff'
import { CopyButton } from './CopyButton'
import { CheckboxRow, DefaultBadge, DefaultToggle } from './Checkbox'
import { Spinner } from './Spinner'
import { BackButton, PageBackContext } from './BackButton'
import type { NavLocation } from '../lib/nav'
import { SECTION_SUBVIEWS } from '../lib/subviews'
import { usePendingFocus, useFocusFlash } from '../lib/focusContext'
import { relativeTime } from '../lib/relativeTime'
import { Chip } from './Chip'
import { RowMenu, type RowMenuItem } from './RowMenu'
import { ClaudeMark } from './ClaudeMark'
import { SAVED_CONTEXTS } from '../data/savedContexts'
import {
  CONNECTOR_OPTIONS,
  GITHUB_REPO_OPTIONS,
  LOCAL_REPO_OPTIONS,
  MCP_OPTIONS,
} from '../data/contextOptions'
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
  addScheduleFromSeed,
  createDispatch,
  isOptimisticId,
  removeSchedule,
  runScheduleNow,
  addSavedContext,
  removeSavedContext,
  setConnectorStatus,
  toggleScheduleEnabled,
  updateSchedule,
  createCommission,
  createProvider,
  updateProvider,
  deleteProvider,
  rotateProvider,
  refreshProviderModels,
  createSystemPrompt,
  updateSystemPrompt,
  deleteSystemPrompt,
  createAgent,
  updateAgent,
  deleteAgent,
  forkAgent,
  importAgentCard,
  a2aAgentCardUrl,
  postOpenSubGoal,
  commentOnWorkItem,
  retractWorkItem,
  setProjectWatch,
  proposeAgentChange,
  resolveAgentProposal,
  commentOnAgentProposal,
  useAgentProposals,
  useMe,
  useWatchState,
  updateCommission,
  deleteCommission,
  reserveSubGoal,
  releaseSubGoal,
  probePrompt,
  mintApiToken,
  revokeApiToken,
  useApiTokens,
  API_BASE,
  useAgents,
  useAgentDirectory,
  useAgentForks,
  useAgentResolvedWork,
  useAuditLog,
  useCommissions,
  useCommissionAuthority,
  useOpenSubGoals,
  useContributions,
  openContribution,
  noteContribution,
  landContribution,
  proposeEnvelope,
  approveEnvelope,
  runEnvelopeEffect,
  crystallizeContribution,
  useMyWork,
  useOwnerProfile,
  useMyOrgs,
  useOrgMembers,
  useOrgInvites,
  inviteToOrg,
  revokeOrgInvite,
  useProjectDirectory,
  useProjectSubGoals,
  useDispatchRuns,
  useProviders,
  useAdminUsers,
  useAdminTenants,
  useAdminInvites,
  useAdminTokens,
  useAdminAudit,
  useAdminOps,
  adminDeactivateUser,
  adminRevokeToken,
  adminRevokeInvite,
  invalidate,
  keys,
  useSavedContexts,
  useScheduleTemplates,
  useSchedules,
  useSessions,
  useSystemPrompts,
  useAgentToolCatalog,
} from '../api'
import {
  promptFitWarning,
  defaultEntry,
  projectAdmittedAuthority,
  PROJECT_ROLES,
  PROJECT_EFFECT_TYPES,
  ENVELOPE_HARNESSES,
  CHANGE_ENTRY_KINDS,
  AUDIT_CHANNEL_LABEL,
  type EnvelopeHarness,
  type ChangeEntryKind,
  type A2aAgentCard,
  type Agent,
  type AgentChangeProposal,
  type AgentChangelogEntry,
  type AgentDirectoryEntry,
  type AuditEntry,
  type AdminInviteRow,
  type AdminTenantRow,
  type AdminTokenRow,
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
} from '../../contract/index.ts'
import { authorityLabel, providerPlanLabel } from '../lib/agentCommonsLabels'
import { bootstrapPrompt } from '../lib/connectorInstall'
import { ArtifactThumb, ArtifactViewer, KIND_ICON, KIND_LABEL } from './artifactPreview'
import { artifactMetaIsSpecific } from '../lib/artifactMeta'
import { resolvedByCommission } from '../lib/commissionTrackRecord'
import { useFocusTrap } from '../lib/useFocusTrap'
import { useDismissable } from '../lib/useDismissable'
import { SCRIM_CLASS } from '../lib/scrim'
import { POPOVER_SURFACE } from '../lib/popover'
import { usePopoverShift } from '../lib/usePopoverShift'
import { useRelations } from '../controller/useRelations'
import { runSessionId, slug } from '../../contract/ids.ts'
import { HOVER_REVEAL, HOVER_CUE, SECTION_REVEAL, SECTION_REVEAL_GROUP } from '../lib/hoverReveal'
import { SectionAction } from './SectionAction'

/** The main area when a cross-cutting tool (Projects, Artifacts, …) is open
 *  instead of a conversation. All content is mock — this is a clickable demo.
 *  Projects and Artifacts get their own desktop-app-style layouts; the simpler
 *  tools share the generic header + body. */
export function SectionView({
  section,
  subview,
  onOpenSubview,
  onOpenSession,
  onNewSession,
  onOpenProject,
  onOpenSchedule,
  onOpenProposal,
  onBack,
  backTo,
  railCollapsed = false,
  focusProjectId = null,
  focusScheduleId = null,
  focusOwnerName = null,
  focusWorkItemId = null,
  focusContributionId = null,
  focusAgentId = null,
  focusContextId = null,
  focusAdminUserId = null,
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
  backTo: NavLocation | null
  /** When the left rail is collapsed, a floating expand toggle sits in the
   *  top-left of this panel; inset the content so it clears that button rather
   *  than rendering underneath it. */
  railCollapsed?: boolean
  /** The project / routine detail to show (null = the section list). The single
   *  source of truth for which detail is open — driven by the controller whether
   *  reached by a breadcrumb, a deep-link, or a list-card click. */
  focusProjectId?: string | null
  focusScheduleId?: string | null
  /** A workspace profile open under the Agents section (D21) — the display name.
   *  Same single-source-of-truth discipline as the two above. */
  focusOwnerName?: string | null
  /** A work item's own page under the open project (the issue-page analog) —
   *  meaningful only with `focusProjectId`; null = the project page itself. */
  focusWorkItemId?: string | null
  /** A contribution's own page under the open project (the PR-page analog,
   *  workflow Phase A) — meaningful only with `focusProjectId`. */
  focusContributionId?: string | null
  /** A published definition's own page under Agents (COMMONS-26); null = hub/profile. */
  focusAgentId?: string | null
  /** A saved context's detail page under Contexts (ADAPT-15); null = the list. */
  focusContextId?: string | null
  /** An account's detail page under the maintainer console (FWD-7 v1.1);
   *  null = the console's panels. */
  focusAdminUserId?: string | null
  /** Open a published definition's page — the one door every card routes through. */
  onOpenAgentPage: (agentId: string) => void
}) {
  const body =
    section === 'projects' ? (
      <ProjectsSection
        projectId={focusProjectId}
        workItemId={focusWorkItemId}
        contributionId={focusContributionId}
        subview={subview}
        onOpenProject={onOpenProject}
        onBack={onBack}
        backTo={backTo}
        onOpenSession={onOpenSession}
        onNewSession={onNewSession}
      />
    ) : section === 'artifacts' ? (
      <ArtifactsSection subview={subview} onOpenSession={onOpenSession} />
    ) : section === 'contexts' ? (
      <ContextsSection subview={subview} contextId={focusContextId} onBack={onBack} backTo={backTo} />
    ) : section === 'models' ? (
      <ModelsSection subview={subview} />
    ) : section === 'agents' ? (
      // The Agents hub's children are distinct SURFACES (not one list filtered), so its
      // sub-view is a surface id — defaulting to the worker list when the rail sub-view is
      // null. The content sections below instead take the raw sub-view (a group id or null).
      <AgentCommonsSection
        owner={focusOwnerName}
        agentId={focusAgentId}
        subview={subview ?? 'agents'}
        onOpenProject={onOpenProject}
        onOpenProposal={onOpenProposal}
        onOpenAgentPage={onOpenAgentPage}
        onBack={onBack}
        backTo={backTo}
      />
    ) : section === 'scheduled' ? (
      <ScheduledSection
        scheduleId={focusScheduleId}
        subview={subview}
        onOpenSchedule={onOpenSchedule}
        onBack={onBack}
        backTo={backTo}
        onOpenSession={onOpenSession}
      />
    ) : section === 'admin' ? (
      // The maintainer console (contract/admin.ts): like the Agents hub its
      // children are SURFACES, defaulting to Accounts when the rail sub-view is
      // null. Reached without the grant (a pasted URL), it degrades to an
      // explanatory empty state — the server's 404 wall keeps every list empty
      // regardless.
      <AdminSection subview={subview ?? 'accounts'} adminUserId={focusAdminUserId} onBack={onBack} backTo={backTo} />
    ) : (
      <GenericSection section={section} />
    )
  return (
    // The hub pages' back state (ADAPT-18): when history exists — a bare
    // in-page door landed here, or the local stack popped back to the list —
    // the shared PageHeader leads with the one back control. Detail pages
    // render BackButton from their props directly.
    <PageBackContext.Provider value={backTo ? { to: backTo, onBack } : null}>
      <div className={`flex min-h-0 flex-1 flex-col ${railCollapsed ? 'pl-8' : ''}`}>{body}</div>
    </PageBackContext.Provider>
  )
}

/* The dynamic back button — returns to the previous page in navigation history
 * (not a fixed structural parent) and names that destination — now lives in
 * src/components/BackButton.tsx (ADAPT-18): the conversation title bar wears
 * the same control for a session opened from a page, so it left this file. */

/* ─────────────────────────── Projects ─────────────────────────── */

function ProjectsSection({
  projectId,
  workItemId,
  contributionId,
  subview,
  onOpenProject,
  onBack,
  backTo,
  onOpenSession,
  onNewSession,
}: {
  /** Which project detail to show (null = the list) — the controlled source of
   *  truth, set by the controller however the detail was reached. */
  projectId: string | null
  /** A work item's own page inside that project (null = the project page). */
  workItemId?: string | null
  /** A contribution's own page inside that project (null = the project page). */
  contributionId?: string | null
  /** The rail's group node (lib/subviews): null = yours + shared, 'mine' = yours only,
   *  'shared' = the commons band only. */
  subview: string | null
  onOpenProject: (id: string) => void
  onBack: () => void
  backTo: NavLocation | null
  onOpenSession: (id: string) => void
  onNewSession: () => void
}) {
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState('Last updated')
  const [creating, setCreating] = useState(false)
  const rel = useRelations()
  // FWD-6: the caller's org seats — the New-project owner picker's options and
  // the "Your organizations" band's membership test (matched by tenant id; the
  // projection keeps `tenantId` on every seat-visible row).
  const myOrgs = useMyOrgs().data ?? []
  const myOrgIds = new Set(myOrgs.map((o) => o.tenant.id))
  // Includes projects created mid-conversation (the relation graph's extras), so a freshly
  // created project shows in the list and opens to its detail like any seed one.
  const projects = rel.allProjects()

  // Create a project from the dialog: mint a unique id (across seed + created
  // ones, so a duplicate name can't re-file into an existing project), apply the
  // sessionless create-project op (optimistic + persisted + broadcast), then open
  // the new project — it's already in `projects` via the optimistic graph patch.
  // `ownerTenantId` (FWD-6 O-D4): undefined = the caller's own namespace (the
  // fixed absence, INV-9); an org id = the picker's explicit, validated choice.
  const createProject = (name: string, description: string, ownerTenantId?: string) => {
    const id = uniqueProjectId(name, new Set(projects.map((p) => p.id)))
    rel.applyOp({
      kind: 'create-project',
      projectId: id,
      projectName: name,
      projectDescription: description,
      ...(ownerTenantId ? { ownerTenantId } : {}),
    })
    setCreating(false)
    onOpenProject(id)
  }

  const open = projectId ? (projects.find((p) => p.id === projectId) ?? null) : null
  if (open && workItemId)
    return <WorkItemPage project={open} workItemId={workItemId} onBack={onBack} backTo={backTo} />
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
        onBack={onBack}
        backTo={backTo}
        onOpenSession={onOpenSession}
        onNewSession={onNewSession}
      />
    )

  const needle = query.trim().toLowerCase()
  const filtered = projects.filter(
    (p) =>
      needle === '' ||
      p.name.toLowerCase().includes(needle) ||
      p.description.toLowerCase().includes(needle),
  )
  // "Last updated" keeps source order (already newest-first); "Name" sorts A→Z.
  const sorted = sort === 'Name' ? [...filtered].sort((a, b) => a.name.localeCompare(b.name)) : filtered
  // Yours vs your orgs vs the commons (shared-surface UI model): an ORG-owned
  // project is reached through a seat (FWD-6 — banded under "Your organizations",
  // whatever your role); a FOREIGN shared project is a different relationship —
  // browsable, joinable, not yours. Neither interleaves with your own.
  const isOrgRow = (p: Project) => !!p.tenantId && myOrgIds.has(p.tenantId)
  const orgRows = sorted.filter(isOrgRow)
  const mine = sorted.filter((p) => p.own !== false && !isOrgRow(p))
  const sharedWithYou = sorted.filter((p) => p.own === false && !isOrgRow(p))

  // Single-column on every tier (surface-from-nature: a text-led entity list is a
  // scannable, comparable LIST — GitHub's repo-list idiom; multi-column is for
  // thumbnail-led GALLERIES like Artifacts). Also unifies with the commons band:
  // the same entity read as 2-col cards under "Yours" but 1-col in Discover.
  const grid = (items: Project[]) => (
    <div className="space-y-3">
      {items.map((p) => (
        <ProjectCard
          key={p.id}
          project={p}
          sessionCount={rel.sessionsForProject(p.id).length}
          onOpen={() => onOpenProject(p.id)}
        />
      ))}
    </div>
  )

  return (
    <Page>
      <PageHeader title="Projects">
        <Dropdown label="Sort by" value={sort} options={['Last updated', 'Name']} onChange={setSort} />
        <PrimaryButton icon={<Plus size={15} />} onClick={() => setCreating(true)}>
          New project
        </PrimaryButton>
      </PageHeader>
      <SearchBox value={query} onChange={setQuery} placeholder="Search projects…" />
      {/* The rail's group node owns the yours/shared split: 'shared' isolates the commons
          band; 'mine' your own; null shows yours with the shared band below. */}
      {subview === 'shared' ? (
        sharedWithYou.length === 0 ? (
          <Empty>
            {query.trim()
              ? `No projects shared with you match “${query.trim()}”.`
              : 'No projects shared with you yet — other workspaces’ shared projects show here.'}
          </Empty>
        ) : (
          grid(sharedWithYou)
        )
      ) : (
        <>
          {mine.length === 0 ? (
            <Empty>
              {/* "of yours": a search may still match the Shared-with-you band below. */}
              {query.trim() ? `No projects of yours match “${query.trim()}”.` : 'No projects yet — create one to group related work.'}
            </Empty>
          ) : (
            grid(mine)
          )}
          {subview !== 'mine' && orgRows.length > 0 && (
            <div className="mt-8">
              <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
                Your organizations
              </div>
              <p className="mb-3 text-[12px] text-ink-faint">
                Projects owned by organizations you belong to — a seat, not a switch (the byline is
                the org's page).
              </p>
              {grid(orgRows)}
            </div>
          )}
          {subview !== 'mine' && sharedWithYou.length > 0 && (
            <div className="mt-8">
              <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
                Shared with you
              </div>
              <p className="mb-3 text-[12px] text-ink-faint">
                Projects other workspaces opened to the commons — visit one to commission your agent
                or take open work.
              </p>
              {grid(sharedWithYou)}
            </div>
          )}
        </>
      )}
      {creating && <NewProjectDialog orgs={myOrgs} onCreate={createProject} onClose={() => setCreating(false)} />}
    </Page>
  )
}

/** A unique project id derived from the name, disambiguated against ids already in
 *  use (seed + created). The reducer is idempotent on id, so a colliding id would
 *  silently re-file into the existing project instead of creating a new one —
 *  hence the suffix. Falls back to "project" when the name has no slug characters.
 *
 *  `taken` is the *locally cached* graph, so this id is not globally collision-safe:
 *  two clients creating the same name within the relation.applied broadcast window
 *  can derive the same id. The server reducer is idempotent on id (it re-files
 *  rather than minting a duplicate), so the graph stays consistent; the loser's
 *  name/description is simply dropped. Acceptable for this single-user prototype —
 *  the production fix is server-owned id minting (docs/shared-resource-coordination). */
function uniqueProjectId(name: string, taken: Set<string>): string {
  const base = slug(name) || 'project'
  // The projects sub-view ids are RESERVED WORDS in the address grammar
  // (`/projects/mine` is the "Yours" facet — spec ADAPT-15), so a project may
  // never mint one as its id or its URL would parse as the facet instead.
  const reserved = new Set([...taken, ...(SECTION_SUBVIEWS.projects ?? []).map((v) => v.id)])
  if (!reserved.has(base)) return base
  let n = 2
  while (reserved.has(`${base}-${n}`)) n += 1
  return `${base}-${n}`
}

/** The "New project" form — a centered modal (same idiom as ArtifactViewer): a
 *  required name, an optional description, and — when the caller holds org
 *  seats (FWD-6 O-D4) — an OWNER picker: "You" (the default pre-selection; the
 *  request then omits ownerTenantId, the fixed INV-9 absence) or one of your
 *  orgs (the request carries the concrete, validated id). */
function NewProjectDialog({
  orgs,
  onCreate,
  onClose,
}: {
  orgs: MyOrg[]
  onCreate: (name: string, description: string, ownerTenantId?: string) => void
  onClose: () => void
}) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [owner, setOwner] = useState('') // '' = You (the person namespace)

  const canCreate = name.trim().length > 0
  const submit = () => {
    if (canCreate) onCreate(name.trim(), description.trim(), owner || undefined)
  }

  return (
    <FormDialog
      title="New project"
      icon={<Box size={18} className="text-cap-workspace" />}
      submitLabel="Create project"
      submitIcon={<Plus size={15} />}
      canSubmit={canCreate}
      onSubmit={submit}
      onClose={onClose}
    >
      <FormField label="Name">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit()
          }}
          placeholder="e.g. Insights dashboard"
          className={FORM_INPUT_CLASS}
        />
      </FormField>
      <FormField label="Description" optional>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={3}
          placeholder="What this project groups together."
          className={`${FORM_INPUT_CLASS} resize-none leading-relaxed`}
        />
      </FormField>
      {orgs.length > 0 && (
        <FormField label="Owner">
          <select
            aria-label="Project owner"
            value={owner}
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

function ProjectCard({
  project,
  sessionCount,
  onOpen,
}: {
  project: Project
  sessionCount: number
  onOpen: () => void
}) {
  return (
    <button
      onClick={onOpen}
      className="flex min-h-[150px] w-full flex-col rounded-2xl border border-line bg-surface p-5 text-left shadow-sm transition hover:border-line-strong hover:shadow"
    >
      <div className="text-[15px] font-semibold text-ink">{project.name}</div>
      {project.own === false && (
        <div className="mt-1">
          <Byline ownerName={project.ownerName} own={false} />
        </div>
      )}
      <div className="mt-2 line-clamp-2 text-[13px] leading-snug text-ink-soft">
        {project.description}
      </div>
      <div className="mt-auto flex items-center gap-2 pt-4 text-[12px] text-ink-faint">
        <span>Updated {relativeTime(project.updatedAt)}</span>
        <span>·</span>
        <span>
          {sessionCount} session{sessionCount === 1 ? '' : 's'}
        </span>
      </div>
    </button>
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
  onBack,
  backTo,
  onOpenSession,
  onNewSession,
}: {
  project: Project
  onBack: () => void
  backTo: NavLocation | null
  onOpenSession: (id: string) => void
  onNewSession: () => void
}) {
  const rel = useRelations()
  const convs = rel.sessionsForProject(project.id)
  const contexts = rel.contextsForProject(project.id)

  // The project's recurring runs split two ways: the *real* routines the relation
  // graph links here (full ScheduledTask — togglable, runnable, openable) and the
  // hand-authored seed cadences that aren't backed by a real task (shown static).
  const realSchedules = rel.schedulesForProject(project.id)
  const realNames = new Set(realSchedules.map((t) => t.name))
  const staticSchedules = project.scheduled.filter((s) => !realNames.has(s.name))
  const hasSchedules = realSchedules.length > 0 || staticSchedules.length > 0

  // "Run now" spinners — an id is in the set until its run resolves (cleared on a
  // timer as a safety net), mirroring the Scheduled section's own controls.
  const [running, setRunning] = useState<Set<string>>(new Set())
  const timers = useRef<number[]>([])
  useEffect(() => () => timers.current.forEach((t) => window.clearTimeout(t)), [])

  const toggleEnabled = (id: string, enabled: boolean) => void toggleScheduleEnabled(id, !enabled)
  const runNow = (id: string) => {
    if (running.has(id)) return
    setRunning((prev) => new Set(prev).add(id))
    void runScheduleNow(id)
    const timer = window.setTimeout(() => {
      setRunning((prev) => {
        const next = new Set(prev)
        next.delete(id)
        return next
      })
    }, 2000)
    timers.current.push(timer)
  }

  // ── Scheduled-run CRUD — all on existing primitives, no new backend op ──
  // Create: mint a routine from a template (lands paused), link it to this project,
  // then drill into its detail to edit cadence/steps (the Scheduled section's own
  // "new schedule" path). Link/unlink move only the project↔schedule edge in the
  // relation graph; delete destroys the routine globally.
  const createSchedule = async (tpl: ScheduleTemplate) => {
    const task = await addScheduleFromSeed(tpl.seed)
    linkSchedule(task)
    rel.navigate('scheduled', task.id)
  }
  const linkSchedule = (task: ScheduledTask) =>
    rel.applyOp({ kind: 'link-schedule-project', scheduleId: task.id, scheduleName: task.name, projectId: project.id, projectName: project.name })
  const unlinkSchedule = (task: ScheduledTask) =>
    rel.applyOp({ kind: 'link-schedule-project', scheduleId: task.id, scheduleName: task.name, projectId: null, projectName: project.name })
  const deleteSchedule = (id: string) => void removeSchedule(id)

  // Remove a session from this project — the file-session op with a null project
  // (the graph patch drops it from sessionsForProject, so the row disappears).
  const unfileSession = (id: string, title: string) =>
    rel.applyOp({ kind: 'file-session', sessionId: id, sessionTitle: title, projectId: null, projectName: project.name })

  // Scope / unscope context — both server-owned relation edits. Adding reuses the
  // session composer's full Add-context picker (mapping each AddedContext to the
  // project's ProjectContext shape); removing splices it by label.
  const addContext = (ctx: ProjectContext) =>
    rel.applyOp({ kind: 'scope-context', projectId: project.id, projectName: project.name, context: ctx })
  const removeContext = (label: string) =>
    rel.applyOp({ kind: 'unscope-context', projectId: project.id, projectName: project.name, contextLabel: label })
  const attachToProject = (ctx: AddedContext) => {
    for (const pc of addedToProjectContexts(ctx)) addContext(pc)
  }

  // The permission split (shared-surface UI model): this ONE page serves owner and
  // visitor alike — what changes is which affordances exist, never the location.
  // `own !== false` covers seeds/optimistic rows the projection hasn't stamped yet.
  const own = project.own !== false

  return (
    <Page>
      <header className={PAGE_HEADER_CLASS}>
        <div className="flex min-w-0 items-start gap-3">
          <BackButton to={backTo} onBack={onBack} />
          <div className="min-w-0">
          <h1 className={PAGE_TITLE_CLASS}>{project.name}</h1>
          {(project.shared === true || !own) && (
            <div className="mt-1">
              {/* The owner name is a DOOR to the workspace's profile page (D21) —
                  when the projection stamped one (seed rows carry none). */}
              <Byline
                ownerName={project.ownerName}
                own={project.own}
                onOwnerClick={
                  project.ownerName ? () => rel.navigate('agents', project.ownerName) : undefined
                }
              />
            </div>
          )}
          <p className="mt-1 text-sm text-ink-soft">{project.description}</p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {/* Watch (D24) — on shared projects, for owner and visitor alike: watching
              needs only visibility (capability shapes affordances, not location). */}
          {project.shared === true && <WatchButton projectId={project.id} />}
          {own && (
            <PrimaryButton icon={<Plus size={15} />} onClick={onNewSession}>
              New session
            </PrimaryButton>
          )}
        </div>
      </header>

      <div className="flex flex-col gap-6 @3xl:flex-row">
        {/* Main panel — the project's recent sessions. */}
        <div className="min-w-0 flex-1">
          {/* The README (D26) — the PUBLIC "about", read by owner and visitor alike;
              only the owner gets the edit affordance (capability shapes affordances). */}
          <ProjectReadme project={project} own={own} />
          {/* Main-column sections (S17): each a bare uppercase heading with its list
              CARDED below — the heading is never inside the box (SidePanel's chrome
              belongs to the rail; a main-column section wearing it reads as a stray
              rail panel). */}
          <div className="space-y-6">
          <MainSection title="Recent sessions">
          {convs.length === 0 ? (
            <Empty>
              {own
                ? 'No sessions in this project yet.'
                : 'The owner’s sessions are private — the shared surfaces are below: commission your agent, claim a sub-goal, or take open work.'}
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
                    className="flex min-w-0 flex-1 items-center gap-3 px-4 py-3 text-left"
                  >
                    <MessageSquare size={16} className="shrink-0 text-ink-faint" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[14px] font-medium text-ink">{c.title}</div>
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
          </MainSection>

          {/* The commons panels live in the MAIN column, not the rail: Contributors
              and Coordination/Open work are the page's PAYLOAD (for a visitor, the
              entire point — the earlier aside squeezed the issues-tray analog to
              288px behind an empty "sessions are private" note), while the rail
              keeps what a rail is for: the owner's configuration. */}
          {/* The contribution ledger (workflow Phase A): the project's pulse —
              what's in flight now, and the linear history of what landed.
              Payload for owner and visitor alike, like the panels below. */}
          <ChangesPanel project={project} onOpenSession={onOpenSession} />
          <ContributorsPanel project={project} />
          <CoordinationPanel project={project} />
          </div>
        </div>

        {/* Right rail — the OWNER's configuration (instructions, scheduled runs,
            attached context); a visitor's projection redacts all of it (P8), so
            the rail renders only for the owner and the visitor page is one column. */}
        {own && (
        <aside className="w-full shrink-0 space-y-4 @3xl:w-72">
          <ProjectInstructions project={project} />

          {/* Sharing — the owner's audience/onboarding CONFIGURATION (S17): it used
              to hide inside the Contributors payload; config belongs in the rail.
              Seed projects can't toggle share (the server refuses), so the switch
              gates on isCreatedProject; the role pre-selection applies either way. */}
          <SidePanel title="Sharing" icon={<Globe size={14} />}>
            {rel.isCreatedProject(project.id) && <ShareToggle project={project} />}
            <DefaultRolePicker project={project} />
          </SidePanel>

          {/* The whole aside is already owner-gated above — these panels don't
              re-check `own` (the inner guards were dead-always-true). */}
          <SidePanel
            title="Scheduled"
            icon={<Clock size={14} />}
            revealActions={!hasSchedules}
            actions={
              <ProjectScheduleAdd
                linkedIds={new Set(realSchedules.map((t) => t.id))}
                onCreate={createSchedule}
                onLink={linkSchedule}
              />
            }
          >
            {!hasSchedules ? (
              <p className="text-[12px] text-ink-faint">No scheduled runs yet.</p>
            ) : (
              <div className="space-y-2.5">
                {realSchedules.map((t) => (
                  <ProjectScheduleRow
                    key={t.id}
                    task={t}
                    running={running.has(t.id)}
                    onToggle={() => toggleEnabled(t.id, t.enabled)}
                    onRun={() => runNow(t.id)}
                    onOpen={() => rel.navigate('scheduled', t.id)}
                    onUnlink={() => unlinkSchedule(t)}
                    onDelete={() => deleteSchedule(t.id)}
                  />
                ))}
                {staticSchedules.map((s, i) => (
                  <div key={`static-${i}`} className="flex items-start gap-2.5">
                    <span
                      className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${
                        s.enabled ? 'bg-emerald-500' : 'bg-line-strong'
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
          </SidePanel>

          <SidePanel
            title="Context"
            icon={<Folder size={14} />}
            revealActions={contexts.length === 0}
            actions={
              <AddContextButton
                variant="section"
                onAttach={attachToProject}
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
                  <ProjectContextChip key={`${ctx.label}-${i}`} ctx={ctx} onRemove={() => removeContext(ctx.label)} />
                ))}
              </div>
            )}
          </SidePanel>
        </aside>
        )}
      </div>
    </Page>
  )
}

/** The project README (D26) — the GitHub-parity "about": the PUBLIC landing content
 *  of a shared project, distinct from `instructions` (private owner context the
 *  projection strips for visitors). Rendered for every viewer when non-empty; the
 *  owner gets Edit (a `set-project-readme` op — server-owned, persisted, broadcast). */
function ProjectReadme({ project, own }: { project: Project; own: boolean }) {
  const rel = useRelations()
  const current = rel.readmeForProject(project.id) ?? ''
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(current)
  if (!current && !own) return null
  const save = () => {
    rel.applyOp({ kind: 'set-project-readme', projectId: project.id, projectName: project.name, readme: draft.trim() })
    setEditing(false)
  }
  return (
    <div className="mb-6">
      <MainSection
        title="About"
        revealActions={!current}
        actions={
          own && !editing ? (
            <SectionAction
              label="Edit README — public, every viewer reads this"
              icon={<Pencil size={13} />}
              onClick={() => {
                setDraft(current)
                setEditing(true)
              }}
            />
          ) : undefined
        }
      >
      {editing ? (
        <div>
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setEditing(false)
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) save()
            }}
            rows={6}
            placeholder="What is this project, and how does one contribute? (public — every viewer reads this)"
            aria-label="Project README"
            className="w-full resize-none rounded-lg border border-line bg-surface px-2.5 py-2 text-[13px] leading-relaxed text-ink outline-none transition placeholder:text-ink-faint focus:border-accent"
          />
          <div className="mt-2 flex items-center justify-end gap-2">
            <button
              onClick={() => setEditing(false)}
              className="rounded-md px-2 py-1 text-[12px] font-medium text-ink-soft transition hover:text-ink"
            >
              Cancel
            </button>
            <button
              onClick={save}
              className="flex items-center gap-1 rounded-md bg-ink px-2.5 py-1 text-[12px] font-medium text-canvas shadow-sm transition hover:opacity-90"
            >
              <Check size={13} />
              Save
            </button>
          </div>
        </div>
      ) : current ? (
        <p className="whitespace-pre-wrap rounded-xl border border-line bg-surface p-4 text-[13px] leading-relaxed text-ink-soft">
          {current}
        </p>
      ) : (
        <p className="text-[12px] text-ink-faint">
          No README yet — the public “about” a visitor reads first.
        </p>
      )}
      </MainSection>
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
  const taRef = useRef<HTMLTextAreaElement>(null)

  const startEdit = () => {
    setDraft(current)
    setEditing(true)
  }
  const save = () => {
    rel.applyOp({
      kind: 'set-project-instructions',
      projectId: project.id,
      projectName: project.name,
      instructions: draft.trim(),
    })
    setEditing(false)
  }

  useEffect(() => {
    if (editing) taRef.current?.focus()
  }, [editing])

  return (
    <SidePanel
      title="Instructions"
      icon={<FileText size={14} />}
      revealActions={!current}
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
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setEditing(false)
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) save()
            }}
            rows={7}
            placeholder="How should Claude work inside this project?"
            className="w-full resize-none rounded-lg border border-line bg-surface px-2.5 py-2 text-[13px] leading-relaxed text-ink outline-none transition placeholder:text-ink-faint focus:border-accent"
          />
          <div className="mt-2 flex items-center justify-end gap-2">
            <button
              onClick={() => setEditing(false)}
              className="rounded-md px-2 py-1 text-[12px] font-medium text-ink-soft transition hover:text-ink"
            >
              Cancel
            </button>
            <button
              onClick={save}
              className="flex items-center gap-1 rounded-md bg-ink px-2.5 py-1 text-[12px] font-medium text-canvas shadow-sm transition hover:opacity-90"
            >
              <Check size={13} />
              Save
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
    </SidePanel>
  )
}

/** A real project routine in the Scheduled card — a click-through into the
 *  routine's full detail, a Run-now with a spinner, a live enable toggle, and a
 *  ⋯ menu for project membership (unlink) and deletion. The dot echoes its last
 *  run's status, like the Scheduled section's own rows. */
function ProjectScheduleRow({
  task,
  running,
  onToggle,
  onRun,
  onOpen,
  onUnlink,
  onDelete,
}: {
  task: ScheduledTask
  running: boolean
  onToggle: () => void
  onRun: () => void
  onOpen: () => void
  onUnlink: () => void
  onDelete: () => void
}) {
  const dot =
    task.lastStatus === 'ok' ? 'bg-emerald-500' : task.lastStatus === 'failed' ? 'bg-red-500' : 'bg-line-strong'
  const menu: RowMenuItem[] = [
    { kind: 'action', key: 'open', label: 'Open in Scheduled', icon: <ChevronRight size={14} />, onSelect: onOpen },
    { kind: 'divider', key: 'd1' },
    { kind: 'action', key: 'unlink', label: 'Remove from project', icon: <MinusCircle size={14} />, onSelect: onUnlink },
    {
      kind: 'action',
      key: 'delete',
      label: 'Delete routine',
      icon: <Trash2 size={14} />,
      danger: true,
      confirm: `Delete “${task.name}”? This removes the routine everywhere, not just from this project.`,
      onSelect: onDelete,
    },
  ]
  return (
    <div className="group flex items-center gap-1">
      <button onClick={onOpen} className="flex min-w-0 flex-1 items-start gap-2.5 text-left" title="Open in Scheduled">
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
        <Tooltip label="Run now">
          <button
            onClick={onRun}
            aria-label={`Run ${task.name} now`}
            className={`flex h-6 w-6 items-center justify-center rounded-md text-ink-faint hover:bg-panel-2 hover:text-ink focus-visible:opacity-100 ${HOVER_REVEAL}`}
          >
            {running ? <Spinner size={13} /> : <Play size={13} />}
          </button>
        </Tooltip>
        <RowMenu ariaLabel={`Actions for ${task.name}`} items={menu} />
        <Toggle on={task.enabled} onToggle={onToggle} ariaLabel={`${task.name} enabled`} />
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
function useContextDoor(): (name: string) => (() => void) | undefined {
  const rel = useRelations()
  const items = useSavedContexts().data?.contexts ?? SAVED_CONTEXTS
  return (name: string) => {
    const n = name.trim().toLowerCase()
    const hit = items.find((c) => c.id.toLowerCase() === n || c.label.toLowerCase() === n)
    return hit ? () => rel.navigate('contexts', hit.id) : undefined
  }
}

function ProjectContextChip({ ctx, onRemove }: { ctx: ProjectContext; onRemove: () => void }) {
  const CIcon = CONTEXT_ICON[ctx.kind]
  // The chip is a DOOR to the context's own page when it resolves in the viewer's
  // registry (S18); otherwise Chip renders its display-only, non-interactive form.
  const door = useContextDoor()(ctx.label)
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
        className="absolute -right-1.5 -top-1.5 flex h-4 w-4 items-center justify-center rounded-full border border-line-strong bg-surface text-ink-faint opacity-0 shadow-sm transition hover:bg-removed-bg hover:text-removed focus-visible:opacity-100 group-hover/chip:opacity-100"
      >
        <X size={10} strokeWidth={2.5} />
      </button>
    </div>
  )
}

/** The Scheduled card's create / link control — the header's "Add routine" verb,
 *  whose popover offers a template to spin up a NEW routine (pre-linked to this
 *  project) or an existing unlinked routine to LINK in. Both run on existing
 *  primitives: create = addScheduleFromSeed → link-schedule-project; link =
 *  link-schedule-project. */
function ProjectScheduleAdd({
  linkedIds,
  onCreate,
  onLink,
}: {
  linkedIds: Set<string>
  onCreate: (tpl: ScheduleTemplate) => void
  onLink: (task: ScheduledTask) => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useDismissable<HTMLDivElement>(open, () => setOpen(false))
  const popRef = usePopoverShift<HTMLDivElement>(open)
  const templates = useScheduleTemplates().data ?? []
  const allSchedules = useSchedules().data ?? []
  const linkable = allSchedules.filter((t) => !linkedIds.has(t.id))

  return (
    <div ref={ref} className="relative">
      <SectionAction label="Add routine" icon={<Plus size={14} />} onClick={() => setOpen((o) => !o)} open={open} />

      {open && (
        <div
          ref={popRef}
          role="dialog"
          aria-label="Add a scheduled routine"
          className={`absolute right-0 top-full z-30 mt-1.5 max-h-[360px] w-[300px] overflow-y-auto p-2 ${POPOVER_SURFACE}`}
        >
          <p className="px-1.5 pb-1 pt-1 text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
            New routine
          </p>
          {templates.map((tpl) => {
            const lead = tpl.seed.steps[0]?.tool
            const blank = tpl.category === 'Start from scratch'
            return (
              <button
                key={tpl.name}
                onClick={() => {
                  onCreate(tpl)
                  setOpen(false)
                }}
                className="group mb-0.5 flex w-full items-center gap-2.5 rounded-lg px-1.5 py-1.5 text-left transition hover:bg-panel-2"
              >
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-panel-2 text-ink-soft">
                  {blank ? <Sparkles size={15} className="text-accent" /> : lead ? <ToolGlyph tool={lead} size={15} /> : <Clock size={15} />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-medium text-ink">{tpl.name}</span>
                  <span className="block truncate text-[11px] text-ink-faint">{tpl.preview}</span>
                </span>
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md text-ink-faint transition group-hover:bg-accent group-hover:text-white">
                  <Plus size={13} />
                </span>
              </button>
            )
          })}
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
                    className="group mb-0.5 flex w-full items-center gap-2.5 rounded-lg px-1.5 py-1.5 text-left transition hover:bg-panel-2"
                  >
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-panel-2 text-ink-soft">
                      <ToolGlyph tool={lead} size={15} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-medium text-ink">{t.name}</span>
                      <span className="block truncate text-[11px] text-ink-faint">{t.cadence}</span>
                    </span>
                    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md text-ink-faint transition group-hover:bg-accent group-hover:text-white">
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
 *  workspaces (tenants). Only CREATED Projects are shareable (the `share-project` op no-ops on a
 *  seed id), so the toggle is offered only for those (ContributorsPanel gates it). Applies the
 *  owner-only `share-project` relation op BY HAND — the same op the model proposes
 *  conversationally (`share_project` tool), through the one relation-edit gate. A shared Project
 *  accepts a different tenant's own agent as a Contributor (owner-pays), clamped to what the
 *  Project admits; un-sharing revokes that cross-workspace effect access. */
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
      aria-label={shared ? 'Make project private' : 'Share project across workspaces'}
      data-testid="share-toggle"
      className="mb-3 flex w-full items-start gap-2.5 rounded-lg border border-line bg-ink/[0.02] px-2.5 py-2 text-left transition hover:border-ink/20"
    >
      <span className={`mt-0.5 shrink-0 ${shared ? 'text-emerald-600' : 'text-ink-faint'}`}>
        {shared ? <Globe size={14} /> : <Lock size={14} />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[12px] font-medium text-ink">
          {shared ? 'Shared across workspaces' : 'Private to this workspace'}
        </span>
        <span className="block text-[11px] text-ink-faint">
          {shared
            ? 'Other workspaces can commission their own agents here (owner-pays).'
            : 'Only this workspace can contribute. Share to accept cross-workspace agents.'}
        </span>
      </span>
      <span
        className={`mt-0.5 flex h-4 w-7 shrink-0 items-center rounded-full px-0.5 transition ${shared ? 'justify-end bg-emerald-500' : 'justify-start bg-ink/15'}`}
      >
        <span className="h-3 w-3 rounded-full bg-white shadow-sm" />
      </span>
    </button>
  )
}

/** The project's Contributors — pure PAYLOAD now (S17): the owner's sharing config
 *  (share switch, default role) moved to the rail's Sharing panel, so this section
 *  reads the same for owner and visitor — the commissioned agents, carded. */
function ContributorsPanel({ project }: { project: Project }) {
  const commissions = useCommissions(project.id).data ?? []
  const agents = useAgents().data ?? []
  const agentsById = new Map(agents.map((a) => [a.id, a]))
  const commissionedIds = new Set(commissions.map((c) => c.agentId))
  const available = agents.filter((a) => !commissionedIds.has(a.id))

  return (
    <MainSection
      title="Contributors"
      revealActions={commissions.length === 0}
      actions={
        <CommissionAdd projectId={project.id} available={available} joinRole={project.defaultRole ?? 'writer'} />
      }
    >
      {commissions.length === 0 ? (
        <p className="text-[12px] text-ink-faint">No agents commissioned yet.</p>
      ) : (
        <CardList>
          {commissions.map((c) => (
            <div key={c.id} className="px-4 py-3">
              <ContributorRow
                commission={c}
                agentLabel={agentsById.get(c.agentId)?.label ?? c.agentLabel ?? c.agentId}
                contributions={agentsById.get(c.agentId)?.contributions}
              />
            </div>
          ))}
        </CardList>
      )}
    </MainSection>
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
  /** S8 — for a STANDING commission, what it actually resolved on THIS project (its
   *  local track record, distinct from the cross-project Award total). Undefined for a
   *  non-standing commission (no unprompted acts to summarize). */
  resolvedHere?: { count: number; lastAt: number }
}) {
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
  const [error, setError] = useState<string | null>(null)
  const del = async () => {
    setError(null)
    try {
      await deleteCommission(commission.id, commission.projectId)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not remove this contributor.')
    }
  }
  return (
    <div className="group flex items-start gap-2.5">
      <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-[13px] font-medium text-ink">{agentLabel}</span>
          <span className="shrink-0 rounded-full bg-ink/5 px-1.5 py-px text-[10px] font-medium uppercase tracking-wide text-ink-soft">
            {commission.role ?? 'writer'}
          </span>
          {commission.standing && (
            <span
              title="Standing: volunteers for this project’s open work — takes posted items unprompted, on its owner’s plan"
              className="shrink-0 rounded-full bg-accent/10 px-1.5 py-px text-[10px] font-medium uppercase tracking-wide text-accent"
            >
              standing
            </span>
          )}
          {contributions ? (
            <span
              title={`${contributions} commissioned ${contributions === 1 ? 'contribution' : 'contributions'} on the Commons`}
              className="inline-flex shrink-0 items-center gap-0.5 rounded-full bg-emerald-500/10 px-1.5 py-px text-[10px] font-medium text-emerald-700"
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
        {/* S8 — the acts this STANDING contributor produced HERE (D19), so the row shows
            local output, not just the cross-project Award total that misreads as local. */}
        {resolvedHere && (
          <div
            className="text-[11px] text-ink-faint"
            title="Open work this standing contributor took on THIS project — distinct from its cross-project contribution total"
          >
            {resolvedHere.count > 0
              ? `Took ${resolvedHere.count} item${resolvedHere.count === 1 ? '' : 's'} here · last ${relativeTime(resolvedHere.lastAt)}`
              : 'Standing · no items taken yet'}
          </div>
        )}
        {error && <div className="text-[11px] text-removed">{error}</div>}
      </div>
      <CardActions onEdit={project ? () => setEditing(true) : undefined} onDelete={del} />
      {editing && project && (
        <CommissionDialog commission={commission} project={project} onClose={() => setEditing(false)} />
      )}
    </div>
  )
}

/** One Project-admitted reach axis as a checklist (connectors or file scopes) — the shared
 *  primitive behind both, so the two axes can't drift (same role ⇒ same look). */
function AdmittedChecklist({
  label,
  admitted,
  selected,
  onToggle,
  emptyText,
}: {
  label: string
  admitted: string[]
  selected: Set<string>
  onToggle: (value: string) => void
  emptyText: string
}) {
  return (
    <div>
      <span className="mb-1.5 block text-[12px] font-medium text-ink-soft">{label}</span>
      {admitted.length === 0 ? (
        <p className="text-[12px] text-ink-faint">{emptyText}</p>
      ) : (
        <div className="space-y-1.5">
          {admitted.map((v) => (
            <CheckboxRow key={v} checked={selected.has(v)} onToggle={() => onToggle(v)} className="text-[13px] text-ink">
              {v}
            </CheckboxRow>
          ))}
        </div>
      )}
    </div>
  )
}

/** Re-grant a Contributor — narrow (or restore) which of the Project's admitted **connectors
 *  and file scopes** it may reach (D12). The Project's admitted set is the wall on each axis:
 *  each checklist is bounded by it, and unchecking narrows the Contributor below it. The role
 *  (D14) sets the permission baseline. All-checked ⇒ the full admitted reach. */
function CommissionDialog({
  commission,
  project,
  onClose,
}: {
  commission: Commission
  project: Project
  onClose: () => void
}) {
  const admitted = projectAdmittedAuthority(project.contexts)
  const admittedConnectors = admitted.connectors ?? []
  const admittedScopes = admitted.scopes ?? []
  // Start from the current grant, or the full admitted set when the grant is unset / '*'.
  const startSet = (granted: string[] | undefined, all: string[]) =>
    new Set(!granted || granted.includes('*') ? all : granted)
  const [connectors, setConnectors] = useState<Set<string>>(() => startSet(commission.authority?.connectors, admittedConnectors))
  const [scopes, setScopes] = useState<Set<string>>(() => startSet(commission.authority?.scopes, admittedScopes))
  const [role, setRole] = useState<ProjectRole>(commission.role ?? 'writer')
  const [standing, setStanding] = useState(commission.standing === true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const toggle = (setFn: typeof setConnectors) => (v: string) =>
    setFn((prev) => {
      const next = new Set(prev)
      next.has(v) ? next.delete(v) : next.add(v)
      return next
    })

  const submit = async () => {
    if (busy) return
    setBusy(true)
    setError(null)
    // Always send the explicit checked set (an `undefined` would be dropped by JSON, so
    // the server couldn't tell "clear" from "unchanged"). The reach is this set ∩ the
    // Project's admitted set; checking every box restores the full admitted reach.
    try {
      await updateCommission(commission.id, commission.projectId, {
        role,
        standing,
        authority: { connectors: [...connectors], scopes: [...scopes] },
      })
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not update this contributor.')
      setBusy(false)
    }
  }

  return (
    <FormDialog
      title="Edit contributor"
      icon={<Cpu size={18} className="text-ink-soft" />}
      submitLabel="Save"
      canSubmit={!busy}
      onSubmit={submit}
      onClose={onClose}
      error={error}
    >
      <div className="mb-3">
        <label className="mb-1.5 block text-[12px] font-medium text-ink-soft" htmlFor="commission-role">
          Project role
        </label>
        <select
          id="commission-role"
          value={role}
          onChange={(e) => setRole(e.target.value as ProjectRole)}
          className={FORM_INPUT_CLASS}
        >
          {PROJECT_ROLES.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
        <p className="mt-1.5 text-[11px] text-ink-faint">
          The permission baseline: a reader may read; writer &amp; maintainer may fire effects and
          reserve sub-goals; owner may also commission others.
        </p>
      </div>
      <CheckboxRow checked={standing} onToggle={() => setStanding(!standing)} className="mb-3">
        <span className="text-[12px] leading-snug text-ink-soft">
          <span className="font-medium text-ink">Standing</span> — volunteer this agent for the
          project’s open work: when a work item is posted it may take it{' '}
          <span className="font-medium text-ink">unprompted</span>, spending your plan (owner-pays,
          D19). Approved once, here — the same shape as a standing schedule approval.
        </span>
      </CheckboxRow>
      <div className="space-y-3">
        <AdmittedChecklist
          label="Connectors this contributor may reach"
          admitted={admittedConnectors}
          selected={connectors}
          onToggle={toggle(setConnectors)}
          emptyText="This project admits no connectors."
        />
        <AdmittedChecklist
          label="File scopes this contributor may reach"
          admitted={admittedScopes}
          selected={scopes}
          onToggle={toggle(setScopes)}
          emptyText="This project admits no folders or repos."
        />
        <p className="text-[11px] text-ink-faint">
          The Project’s admitted set is the wall; unchecking narrows this Contributor’s reach below it.
        </p>
      </div>
    </FormDialog>
  )
}

/** The "Commission an agent" picker — the Contributors header's verb, listing
 *  the Agents not already contributing. Picking one POSTs a commission (inheriting the
 *  Agent's grant) and the panel refreshes via the commissions cache. The role is
 *  stated, not implied (INV-9 — the request must name one): `joinRole` is the
 *  Project's defaultRole-else-writer, shown in the picker so a click grants exactly
 *  what it says; per-contributor changes live in the row's Edit dialog. */
function CommissionAdd({ projectId, available, joinRole }: { projectId: string; available: Agent[]; joinRole: ProjectRole }) {
  const [open, setOpen] = useState(false)
  const ref = useDismissable<HTMLDivElement>(open, () => setOpen(false))
  const popRef = usePopoverShift<HTMLDivElement>(open)
  const [pending, setPending] = useState<string | null>(null)

  const commission = async (agent: Agent) => {
    setPending(agent.id)
    try {
      await createCommission({ agentId: agent.id, projectId, role: joinRole })
      setOpen(false)
    } catch {
      // The server funnel rejects an over-grant / unknown id; the picker only ever
      // creates *inheriting* commissions (no scoped grant), so this is unreachable
      // today. Handle it anyway — keep the picker open so a retry is possible, and
      // don't leak an unhandled rejection. (A scoped-commission UI would surface the
      // error here.)
    } finally {
      setPending(null)
    }
  }

  return (
    // The section header's verb (S17) — the popover anchors under the header's
    // right edge, where the trigger now lives.
    <div ref={ref} className="relative">
      <SectionAction
        label="Commission an agent"
        icon={<Plus size={14} />}
        onClick={() => setOpen((o) => !o)}
        open={open}
      />

      {open && (
        <div
          ref={popRef}
          role="dialog"
          aria-label="Commission an agent"
          className={`absolute right-0 top-full z-30 mt-1.5 w-[280px] p-2 ${POPOVER_SURFACE}`}
        >
          {available.length === 0 ? (
            <p className="px-1.5 py-1 text-[12px] text-ink-faint">Every agent is already a Contributor.</p>
          ) : (
            <>
              {available.map((a) => (
                <button
                  key={a.id}
                  onClick={() => commission(a)}
                  disabled={pending === a.id}
                  className="group mb-0.5 flex w-full items-center gap-2.5 rounded-lg px-1.5 py-1.5 text-left transition hover:bg-panel-2 disabled:opacity-50"
                >
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-panel-2 text-ink-soft">
                    <Cpu size={15} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-medium text-ink">{a.label}</span>
                    <span className="block truncate text-[11px] text-ink-faint">
                      {a.tools.length} tool{a.tools.length === 1 ? '' : 's'}
                    </span>
                  </span>
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md text-ink-faint transition group-hover:bg-accent group-hover:text-white">
                    <Plus size={13} />
                  </span>
                </button>
              ))}
              {/* The role a pick grants — stated, not implied (the strict API requires
                  the request to name one; this is the visible edge choice). */}
              <p className="mt-1 border-t border-line px-1.5 pt-1.5 text-[11px] text-ink-faint">
                Joins as <span className="font-medium text-ink-soft">{joinRole}</span> — change per
                contributor via its Edit.
              </p>
            </>
          )}
        </div>
      )}
    </div>
  )
}

/** The demo principal a UI claim is made as — a *second* Contributor, distinct from
 *  the seeded one, so claiming the seeded sub-goal demonstrates a multi-principal
 *  conflict (D11). */
const VIEWER_PRINCIPAL = 'you'

/** The project's "Coordination" card (docs/agent-commons.md, D11) — the in-flight
 *  sub-goals different Contributors are handling, reserved at the Project's Guardian.
 *  Claiming a sub-goal already held by another Contributor is refused (409) and surfaced
 *  as a re-reason prompt — "conflict is a question, not an abort". Only meaningful for a
 *  guarded Project; an unguarded one reserves nothing. */
function CoordinationPanel({ project }: { project: Project }) {
  const subGoals = useProjectSubGoals(project.id).data ?? []
  const guarded = !!project.guardianId
  const [draft, setDraft] = useState('')
  const [conflict, setConflict] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  // Claim AS a principal you control: yourself, or one of YOUR agents commissioned on
  // this Project (P8 cross-tenant cooperation: an agent's sub-goal claim is how it
  // "works" here). A FOREIGN Contributor's agent never resolves in this tenant's
  // registry, so it can't be picked — the same caller-identity wall the route enforces
  // (`commissionActorDenied`), mirrored in the affordance.
  const commissions = useCommissions(project.id).data ?? []
  const agents = useAgents().data ?? []
  const ownAgentById = new Map(agents.map((a) => [a.id, a]))
  const ownCommissions = commissions.filter((c) => ownAgentById.has(c.agentId))
  const [holder, setHolder] = useState(VIEWER_PRINCIPAL)
  // The claim form is ON DEMAND — the section header's verb discloses it (the
  // always-open form read as noise on a page you're only reading).
  const [claiming, setClaiming] = useState(false)

  const claim = async () => {
    const subGoal = draft.trim()
    if (!subGoal || busy) return
    setBusy(true)
    setConflict(null)
    try {
      // An unknown (deleted) commission still selected falls back to claiming as yourself.
      const as = holder === VIEWER_PRINCIPAL || ownCommissions.some((c) => c.id === holder) ? holder : VIEWER_PRINCIPAL
      await reserveSubGoal(project.id, as, subGoal)
      setDraft('')
      setClaiming(false)
    } catch (e) {
      // Only a CONFLICT (409) means another Contributor holds this sub-goal — a
      // question, not an abort: prompt to pick a different one (D11). Any other
      // failure (network, 401, 500) must surface its real message, not a false
      // "held by another Contributor".
      const msg = e instanceof Error ? e.message : ''
      setConflict(
        /conflict|at capacity|held by/i.test(msg)
          ? `"${subGoal}" is held by another Contributor — pick a different sub-goal.`
          : msg || 'Could not claim that sub-goal — please try again.',
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
    <MainSection
      title="Coordination"
      revealActions={subGoals.length === 0 || claiming}
      actions={
        guarded ? (
          <SectionAction
            label="Claim a sub-goal"
            icon={<Plus size={14} />}
            onClick={() => setClaiming((v) => !v)}
            expanded={claiming}
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
              {subGoals.map((s) => (
                <div key={s.reservationId} className="group flex items-start gap-2.5 px-4 py-3">
                  <span
                    className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${
                      s.status === 'committed' ? 'bg-accent' : 'bg-emerald-500'
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
                  <button
                    onClick={() => void releaseSubGoal(s.reservationId, project.id)}
                    aria-label={`Release ${s.subGoal}`}
                    className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-ink-faint hover:bg-removed-bg hover:text-removed focus-visible:opacity-100 ${HOVER_REVEAL}`}
                  >
                    <X size={13} />
                  </button>
                </div>
              ))}
            </CardList>
          )}

          {claiming && (
          <div className="mt-2.5">
            {ownCommissions.length > 0 && (
              <select
                value={holder}
                onChange={(e) => setHolder(e.target.value)}
                aria-label="Claim as"
                data-testid="claim-as"
                className="mb-1.5 w-full rounded-lg border border-line bg-surface px-2 py-1 text-[12px] text-ink outline-none focus:border-line-strong"
              >
                <option value={VIEWER_PRINCIPAL}>Claim as: You</option>
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
                  setConflict(null)
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') claim()
                  if (e.key === 'Escape') setClaiming(false)
                }}
                placeholder="Claim a sub-goal…"
                className="min-w-0 flex-1 rounded-lg border border-line bg-surface px-2 py-1 text-[12px] text-ink outline-none placeholder:text-ink-faint focus:border-line-strong"
              />
              <button
                onClick={claim}
                disabled={busy || !draft.trim()}
                className="shrink-0 rounded-lg bg-accent px-2.5 py-1 text-[12px] font-medium text-white transition enabled:hover:bg-accent/90 disabled:opacity-45"
              >
                Claim
              </button>
            </div>
            {conflict && (
              <p className="mt-1.5 flex items-start gap-1 text-[11px] leading-snug text-amber-700">
                <AlertCircle size={12} className="mt-0.5 shrink-0" />
                {conflict}
              </p>
            )}
          </div>
          )}
        </>
      )}
    </MainSection>

    {/* Open work is its OWN top-level section (S17) — it was a mini-heading buried
        inside Coordination, one level deeper than its nature (the issues tray, a
        first-class backlog) warrants. Same guardian gate as before: posting routes
        through the guardian walls, so an unguarded project has no backlog. */}
    {guarded && <OpenWorkList projectId={project.id} ownerCanModerate={project.own !== false} />}
    </>
  )
}

/** Render a comment body with `@mention` tokens styled (D29) — PURELY cosmetic: a
 *  heuristic `@`+word-run cue, never a claim the name resolved (the server never
 *  confirms a resolution back to the reader, so highlighting can't leak existence).
 *  Multi-word workspace names highlight only their first token — a signal, not the
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
function OpenWorkList({ projectId, ownerCanModerate }: { projectId: string; ownerCanModerate: boolean }) {
  const items = useOpenSubGoals(projectId).data ?? []
  const [subGoal, setSubGoal] = useState('')
  const [type, setType] = useState<ProjectEffectType>('charge')
  const [target, setTarget] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // The post form is ON DEMAND, disclosed by the section header's verb — the
  // backlog reads as a backlog, not as a permanently-open form.
  const [composing, setComposing] = useState(false)

  const post = async () => {
    if (busy || !subGoal.trim() || !target.trim()) return
    setBusy(true)
    setError(null)
    try {
      await postOpenSubGoal(projectId, { subGoal: subGoal.trim(), type, target: target.trim() })
      setSubGoal('')
      setTarget('')
      setComposing(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not post this work item.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <MainSection
      title="Open work"
      revealActions={items.length === 0 || composing}
      actions={
        <SectionAction
          label="Post a work item"
          icon={<Plus size={14} />}
          onClick={() => setComposing((v) => !v)}
          expanded={composing}
        />
      }
    >
      {items.length === 0 ? (
        <p className="text-[12px] text-ink-faint">
          Nothing posted. Post a work item — a standing contributor may take it unprompted.
        </p>
      ) : (
        <CardList>
          {items.map((o) => (
            <div key={o.id} className="px-4 py-3">
              <WorkItemRow item={o} projectId={projectId} ownerCanModerate={ownerCanModerate} />
            </div>
          ))}
        </CardList>
      )}
      {composing && (
      <div className="mt-2 space-y-1.5">
        <input
          autoFocus
          value={subGoal}
          onChange={(e) => setSubGoal(e.target.value)}
          onKeyDown={(e) => e.key === 'Escape' && setComposing(false)}
          placeholder="Post a work item (sub-goal)…"
          aria-label="Work item sub-goal"
          className="w-full rounded-lg border border-line bg-surface px-2 py-1 text-[12px] text-ink outline-none placeholder:text-ink-faint focus:border-line-strong"
        />
        <div className="flex items-center gap-1.5">
          <select
            value={type}
            onChange={(e) => setType(e.target.value as ProjectEffectType)}
            aria-label="Effect type"
            className="rounded-lg border border-line bg-surface px-2 py-1 text-[12px] text-ink outline-none focus:border-line-strong"
          >
            {PROJECT_EFFECT_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
          <input
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') post()
              if (e.key === 'Escape') setComposing(false)
            }}
            placeholder="Target (connector / descriptor)…"
            aria-label="Effect target"
            className="min-w-0 flex-1 rounded-lg border border-line bg-surface px-2 py-1 text-[12px] text-ink outline-none placeholder:text-ink-faint focus:border-line-strong"
          />
          <button
            onClick={post}
            disabled={busy || !subGoal.trim() || !target.trim()}
            className="shrink-0 rounded-lg bg-accent px-2.5 py-1 text-[12px] font-medium text-white transition enabled:hover:bg-accent/90 disabled:opacity-45"
          >
            Post
          </button>
        </div>
        {error && <p className="text-[11px] text-removed">{error}</p>}
      </div>
      )}
    </MainSection>
  )
}

/** The watch toggle (D24) — subscribe to a shared Project's public acts (work
 *  posted / resolved / commented / retracted land in your bell). Reads and writes
 *  the caller's own subscription; the server walls it on visibility. */
function WatchButton({ projectId }: { projectId: string }) {
  const state = useWatchState(projectId).data
  const [failed, setFailed] = useState(false)
  const [busy, setBusy] = useState(false)
  const watching = state?.watching === true
  const toggle = async () => {
    if (busy || !state) return
    setBusy(true)
    setFailed(false)
    try {
      await setProjectWatch(projectId, !watching)
    } catch {
      // The button renders purely from the server state, so a swallowed failure
      // would leave it visually unchanged with no signal — flag it (the title
      // reflects it) instead of an unhandled rejection.
      setFailed(true)
    } finally {
      setBusy(false)
    }
  }
  return (
    <button
      onClick={toggle}
      disabled={busy || !state}
      aria-pressed={watching}
      title={failed ? 'Couldn’t update — click to retry' : watching ? 'Stop receiving this project’s public acts' : 'Get this project’s public acts in your notifications'}
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[13px] font-medium transition disabled:opacity-45 ${
        watching
          ? 'border-accent/40 bg-accent-tint text-accent-strong'
          : 'border-line text-ink-soft hover:border-line-strong hover:text-ink'
      }`}
    >
      <Bell size={14} /> {watching ? 'Watching' : 'Watch'}
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
  ownerCanModerate,
}: {
  item: OpenSubGoal
  projectId: string
  ownerCanModerate: boolean
}) {
  const myName = useMe().data?.tenant.name
  const comments = o.comments ?? []
  const [threadOpen, setThreadOpen] = useState(false)
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const mayRetract = o.status === 'open' && (ownerCanModerate || o.postedBy === myName)
  // S13 — the poster / retractedBy / comment author are workspace public identities, so
  // each is a door to that workspace's profile (the shared OwnerLink), like every other
  // byline. Theme #3's work-item-poster RefLink target, finally built.
  const rel = useRelations()
  const ownerDoor = (name: string) => rel.navigate('agents', name)

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

  const send = async () => {
    if (busy || !draft.trim()) return
    setBusy(true)
    setError(null)
    try {
      await commentOnWorkItem(projectId, o.id, draft.trim())
      setDraft('')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not post this comment.')
    } finally {
      setBusy(false)
    }
  }
  const retract = async () => {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      await retractWorkItem(projectId, o.id)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not retract this item.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      ref={rowRef}
      className={`flex items-start gap-2.5 scroll-mt-6 rounded-lg -mx-2 px-2 py-1 transition-colors ${
        flash ? 'bg-accent-tint ring-1 ring-accent/40' : 'ring-1 ring-transparent'
      }`}
    >
      <span
        className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${
          o.status === 'done' ? 'bg-emerald-500' : o.status === 'retracted' ? 'bg-line-strong' : 'bg-amber-500'
        }`}
      />
      <div className="min-w-0 flex-1">
        {/* The title is the door to the item's OWN page (GitHub's issue-title-as-link);
            the comment-count link below stays the inline quick-thread. */}
        <button
          onClick={() => rel.navigate('projects', projectId, o.id)}
          className={`block max-w-full text-left text-[13px] font-medium hover:underline ${
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
              {' · '}done by <AgentActor label={o.resolvedByLabel} />
              {o.resolvedByOwner ? (
                <>
                  {' '}· agent of{' '}
                  <OwnerLink bare ownerName={o.resolvedByOwner} onClick={() => ownerDoor(o.resolvedByOwner!)} />
                </>
              ) : null}
              {o.resolvedAt ? ` · ${relativeTime(o.resolvedAt)}` : ''}
            </span>
          ) : o.status === 'retracted' ? (
            <>
              {' · '}retracted by{' '}
              <OwnerLink bare ownerName={o.retractedBy ?? o.postedBy} onClick={() => ownerDoor(o.retractedBy ?? o.postedBy)} />
              {o.retractedAt ? ` · ${relativeTime(o.retractedAt)}` : ''}
            </>
          ) : (
            <>
              {' · '}posted by <OwnerLink bare ownerName={o.postedBy} onClick={() => ownerDoor(o.postedBy)} /> ·{' '}
              {relativeTime(o.postedAt)} — awaiting a taker
            </>
          )}
        </div>
        <div className="mt-0.5 flex items-center gap-3 text-[11px]">
          <button onClick={() => setThreadOpen((v) => !v)} className={INLINE_ACTION_CLASS}>
            {comments.length === 0
              ? 'Comment'
              : `${comments.length} comment${comments.length === 1 ? '' : 's'}`}
          </button>
          {mayRetract && (
            <button onClick={retract} disabled={busy} className={INLINE_ACTION_CLASS} title="Close this item unresolved (poster or project owner)">
              Retract
            </button>
          )}
        </div>
        {threadOpen && (
          <div className="mt-1.5 space-y-1.5 border-l-2 border-line pl-2.5">
            {comments.map((c) => (
              <div
                key={c.id}
                className={`rounded text-[12px] leading-snug text-ink-soft transition-colors ${
                  c.id === anchorComment ? 'bg-accent-tint -mx-1 px-1' : ''
                }`}
              >
                {/* S13/FWD-5 — the comment author renders by principal KIND: a human is
                    a workspace door; an agent wears the Bot badge (one funnel). */}
                <ActorByline name={c.author} kind={c.authorKind} onOwnerClick={() => ownerDoor(c.author)} />
                <span className="text-ink-faint"> · {relativeTime(c.at)}</span>
                <div className="whitespace-pre-wrap">{renderCommentBody(c.body)}</div>
              </div>
            ))}
            <div className="flex items-center gap-1.5">
              <input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && send()}
                placeholder="Add a comment… @mention to notify"
                aria-label={`Comment on ${o.subGoal}`}
                className="min-w-0 flex-1 rounded-lg border border-line bg-surface px-2 py-1 text-[12px] text-ink outline-none placeholder:text-ink-faint focus:border-line-strong"
              />
              <button
                onClick={send}
                disabled={busy || !draft.trim()}
                className="shrink-0 rounded-lg bg-accent px-2.5 py-1 text-[12px] font-medium text-white transition enabled:hover:bg-accent/90 disabled:opacity-45"
              >
                Post
              </button>
            </div>
          </div>
        )}
        {error && <p className="mt-1 text-[11px] text-removed">{error}</p>}
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
}: {
  project: Project
  workItemId: string
  onBack: () => void
  backTo: NavLocation | null
}) {
  const items = useOpenSubGoals(project.id).data ?? []
  const o = items.find((i) => i.id === workItemId) ?? null
  const myName = useMe().data?.tenant.name
  const rel = useRelations()
  const ownerDoor = (name: string) => rel.navigate('agents', name)
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

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

  if (!o) {
    return (
      <Page>
        <div className="mb-4">
          <BackButton to={backTo} onBack={onBack} />
        </div>
        <Empty>This work item no longer exists on “{project.name}”.</Empty>
      </Page>
    )
  }

  const comments = o.comments ?? []
  const mayRetract = o.status === 'open' && (project.own !== false || o.postedBy === myName)

  const send = async () => {
    if (busy || !draft.trim()) return
    setBusy(true)
    setError(null)
    try {
      await commentOnWorkItem(project.id, o.id, draft.trim())
      setDraft('')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not post this comment.')
    } finally {
      setBusy(false)
    }
  }
  const retract = async () => {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      await retractWorkItem(project.id, o.id)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not retract this item.')
    } finally {
      setBusy(false)
    }
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
      <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-600 px-2.5 py-0.5 text-[12px] font-medium text-white">
        <CheckCircle2 size={13} /> Done
      </span>
    ) : o.status === 'retracted' ? (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-ink-faint px-2.5 py-0.5 text-[12px] font-medium text-white">
        <MinusCircle size={13} /> Retracted
      </span>
    ) : (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-600 px-2.5 py-0.5 text-[12px] font-medium text-white">
        <Clock size={13} /> Open
      </span>
    )

  return (
    <Page>
      <div className="mx-auto w-full max-w-2xl">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-3">
            <BackButton to={backTo} onBack={onBack} />
            <h1 className={PAGE_TITLE_CLASS}>{o.subGoal}</h1>
          </div>
          {mayRetract && (
            <button
              onClick={retract}
              disabled={busy}
              title="Close this item unresolved (poster or project owner)"
              className="shrink-0 rounded-lg border border-line px-2.5 py-1 text-[12px] font-medium text-ink-soft transition hover:border-line-strong hover:text-ink disabled:opacity-45"
            >
              Retract
            </button>
          )}
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-ink-faint">
          {badge}
          <span>
            posted by <OwnerLink bare ownerName={o.postedBy} onClick={() => ownerDoor(o.postedBy)} /> ·{' '}
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
              className="font-medium text-ink-soft hover:underline"
            >
              {project.name}
            </button>
          </span>
        </div>

        {/* The timeline — transitions + conversation, interleaved in time order. */}
        <div className="mt-5 space-y-3 border-l-2 border-line pl-4">
          {events.map((ev) =>
            ev.kind === 'posted' ? (
              <div key={ev.key} className="rounded-lg border border-line bg-surface px-3 py-2">
                <div className="text-[12px] text-ink-faint">
                  <OwnerLink bare ownerName={o.postedBy} onClick={() => ownerDoor(o.postedBy)} /> posted this
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
                  flash && ev.comment.id === anchorComment ? 'bg-accent-tint ring-1 ring-accent/40' : ''
                }`}
              >
                <div className="text-[12px] text-ink-faint">
                  <ActorByline
                    name={ev.comment.author}
                    kind={ev.comment.authorKind}
                    onOwnerClick={() => ownerDoor(ev.comment.author)}
                  />
                  <span> · {relativeTime(ev.comment.at)}</span>
                </div>
                <div className="mt-1 whitespace-pre-wrap text-[13px] leading-snug text-ink-soft">
                  {renderCommentBody(ev.comment.body)}
                </div>
              </div>
            ) : ev.kind === 'done' ? (
              <div key={ev.key} className="flex items-center gap-2 py-0.5 text-[12px] text-ink-faint">
                <CheckCircle2 size={14} className="shrink-0 text-emerald-600" />
                <span title={o.resolvedBy ? `Resolved under commission ${o.resolvedBy}` : undefined}>
                  done by <AgentActor label={o.resolvedByLabel} />
                  {o.resolvedByOwner ? (
                    <>
                      {' '}· agent of{' '}
                      <OwnerLink bare ownerName={o.resolvedByOwner} onClick={() => ownerDoor(o.resolvedByOwner!)} />
                    </>
                  ) : null}
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
                    onClick={() => ownerDoor(o.retractedBy ?? o.postedBy)}
                  />
                  {o.retractedAt ? ` · ${relativeTime(o.retractedAt)}` : ''} — closed unresolved
                </span>
              </div>
            ),
          )}
        </div>

        {/* The conversation continues below the timeline — same funnel as the
            backlog row's composer (anyone who can see the project may comment). */}
        <div className="mt-4 flex items-center gap-1.5">
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && send()}
            placeholder="Add a comment… @mention to notify"
            aria-label={`Comment on ${o.subGoal}`}
            className="min-w-0 flex-1 rounded-lg border border-line bg-surface px-3 py-1.5 text-[13px] text-ink outline-none placeholder:text-ink-faint focus:border-line-strong"
          />
          <button
            onClick={send}
            disabled={busy || !draft.trim()}
            className="shrink-0 rounded-lg bg-accent px-3 py-1.5 text-[13px] font-medium text-white transition enabled:hover:bg-accent/90 disabled:opacity-45"
          >
            Post
          </button>
        </div>
        {error && <p className="mt-1.5 text-[12px] text-removed">{error}</p>}
      </div>
    </Page>
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
function ChangesPanel({ project, onOpenSession }: { project: Project; onOpenSession: (id: string) => void }) {
  const rel = useRelations()
  const list = useContributions(project.id).data ?? []
  const [composing, setComposing] = useState(false)
  const [title, setTitle] = useState('')
  const [summary, setSummary] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const openPage = (cid: string) => rel.navigate('projects', project.id, `changes/${cid}`)
  const declare = async () => {
    if (busy || !title.trim()) return
    setBusy(true)
    setError(null)
    try {
      const c = await openContribution(project.id, { title: title.trim(), summary: summary.trim() || undefined })
      setTitle('')
      setSummary('')
      setComposing(false)
      openPage(c.id)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not open this contribution.')
    } finally {
      setBusy(false)
    }
  }
  return (
    <MainSection
      title="Changes"
      revealActions={list.length === 0 || composing}
      actions={
        <SectionAction
          label="Open a contribution — declare work before doing it"
          icon={<Plus size={14} />}
          onClick={() => setComposing((v) => !v)}
          expanded={composing}
        />
      }
    >
      {list.length === 0 ? (
        <p className="text-[12px] text-ink-faint">
          Nothing yet. A contribution is declared before the work and lands as a numbered entry — the
          project’s history, every entry traceable to its why.
        </p>
      ) : (
        <CardList>
          {list.map((c) => (
            <div key={c.id} className="flex items-center gap-2.5 px-4 py-2.5">
              {/* The leading slot carries the entity's state in ONE form: a live
                  pulse while open, the ledger number once landed — same column,
                  so the list reads as one ledger with its newest entries still
                  in motion. */}
              <span className="flex w-8 shrink-0 items-center justify-end">
                {c.status === 'open' ? (
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" aria-label="In flight" />
                ) : (
                  <span className="text-[12px] font-semibold tabular-nums text-ink-faint">L{c.landingNumber}</span>
                )}
              </span>
              <div className="min-w-0 flex-1">
                <button
                  onClick={() => openPage(c.id)}
                  className="block max-w-full truncate text-left text-[13px] font-medium text-ink hover:underline"
                >
                  {c.title}
                </button>
                <div className="truncate text-[11px] text-ink-faint">
                  by {c.contributor}
                  {c.status === 'open'
                    ? ` · opened ${relativeTime(c.openedAt)}`
                    : c.landedAt
                      ? ` · landed ${relativeTime(c.landedAt)}`
                      : ''}
                  {c.subGoal ? ` · ${c.subGoal}` : ''}
                  {c.envelope
                    ? ` · ${c.envelope.lines.length} act${c.envelope.lines.length === 1 ? '' : 's'} ${
                        c.envelope.status === 'approved' ? '· approved' : '· awaiting approval'
                      }`
                    : ''}
                </div>
              </div>
              {c.status === 'open' && c.sessionId && c.mine === true && (
                <button
                  onClick={() => onOpenSession(c.sessionId!)}
                  className="shrink-0 rounded-lg border border-line px-2 py-0.5 text-[11px] font-medium text-ink-soft transition hover:border-line-strong hover:text-ink"
                  title="Open the conversation doing this work"
                >
                  View the work
                </button>
              )}
            </div>
          ))}
        </CardList>
      )}
      {composing && (
        <div className="mt-2 space-y-1.5">
          <input
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void declare()
              if (e.key === 'Escape') setComposing(false)
            }}
            placeholder="What will this contribution do? (one line)"
            aria-label="Contribution title"
            className="w-full rounded-lg border border-line bg-surface px-2 py-1 text-[12px] text-ink outline-none placeholder:text-ink-faint focus:border-line-strong"
          />
          <div className="flex items-center gap-1.5">
            <input
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void declare()
                if (e.key === 'Escape') setComposing(false)
              }}
              placeholder="Summary — what changes, and why (optional)…"
              aria-label="Contribution summary"
              className="min-w-0 flex-1 rounded-lg border border-line bg-surface px-2 py-1 text-[12px] text-ink outline-none placeholder:text-ink-faint focus:border-line-strong"
            />
            <button
              onClick={() => void declare()}
              disabled={busy || !title.trim()}
              className="shrink-0 rounded-lg bg-accent px-2.5 py-1 text-[12px] font-medium text-white transition enabled:hover:bg-accent/90 disabled:opacity-45"
            >
              Open
            </button>
          </div>
          {error && <p className="text-[11px] text-removed">{error}</p>}
        </div>
      )}
    </MainSection>
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
  const list = useContributions(project.id).data ?? []
  const c = list.find((x) => x.id === contributionId) ?? null
  const rel = useRelations()
  const ownerDoor = (name: string) => rel.navigate('agents', name)
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!c) {
    return (
      <Page>
        <div className="mb-4">
          <BackButton to={backTo} onBack={onBack} />
        </div>
        <Empty>This contribution no longer exists on “{project.name}”.</Empty>
      </Page>
    )
  }

  // Phase-A landing permission (the CW5 tier arithmetic's stand-in): the
  // contributor (the viewer-relative `mine` stamp — display names aren't
  // unique, so never a name comparison) or the project owner. The server
  // enforces on raw tenant ids; this only decides whether to OFFER the act.
  const mayLand = c.status === 'open' && (project.own !== false || c.mine === true)

  const send = async () => {
    if (busy || !draft.trim()) return
    setBusy(true)
    setError(null)
    try {
      await noteContribution(project.id, c.id, draft.trim())
      setDraft('')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not post this comment.')
    } finally {
      setBusy(false)
    }
  }
  const land = async () => {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      await landContribution(project.id, c.id)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not land this contribution.')
    } finally {
      setBusy(false)
    }
  }

  const badge =
    c.status === 'landed' ? (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-600 px-2.5 py-0.5 text-[12px] font-medium text-white">
        <CheckCircle2 size={13} /> Landed · L{c.landingNumber}
      </span>
    ) : (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-600 px-2.5 py-0.5 text-[12px] font-medium text-white">
        <Clock size={13} /> Open
      </span>
    )

  return (
    <Page>
      <div className="mx-auto w-full max-w-2xl">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-3">
            <BackButton to={backTo} onBack={onBack} />
            <h1 className={PAGE_TITLE_CLASS}>{c.title}</h1>
          </div>
          {mayLand && (
            <button
              onClick={() => void land()}
              disabled={busy}
              title={`Land this contribution — it becomes L${(list.reduce((m, x) => Math.max(m, x.landingNumber ?? 0), 0) + 1)} in ${project.name}’s history`}
              className="shrink-0 rounded-lg bg-ink px-3 py-1 text-[12px] font-medium text-canvas shadow-sm transition hover:opacity-90 disabled:opacity-45"
            >
              Land
            </button>
          )}
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-ink-faint">
          {badge}
          <span>
            by <OwnerLink bare ownerName={c.contributor} onClick={() => ownerDoor(c.contributor)} /> ·{' '}
            {relativeTime(c.openedAt)}
          </span>
          {c.subGoal && <span>· {c.subGoal}</span>}
          <span>
            · in{' '}
            <button
              onClick={() => rel.navigate('projects', project.id)}
              className="font-medium text-ink-soft hover:underline"
            >
              {project.name}
            </button>
          </span>
          {/* The trace door — only offered to its owner (sessions are
              tenant-walled; a door that can never open is worse than none). */}
          {c.sessionId && c.mine === true && (
            <span>
              ·{' '}
              <button onClick={() => onOpenSession(c.sessionId!)} className="font-medium text-ink-soft hover:underline">
                View the work
              </button>
            </span>
          )}
        </div>

        {/* The changeset (CW3/CW4, Phase D) — the work's mergeable payload as
            before→after diffs, versioned append-only. */}
        <ChangesetCard project={project} c={c} />

        {/* The effect envelope (CW1, Phase C) — the plan's authorization,
            visually its own block: an external act must never hide inside the
            prose/diff idiom (CW3). */}
        <EnvelopeCard project={project} c={c} />

        {/* The timeline — lifecycle transitions + the conversation, one record
            in time order (append-only, CW4; it keeps accruing after landing, CW7). */}
        <div className="mt-5 space-y-3 border-l-2 border-line pl-4">
          {c.events.map((ev) =>
            ev.kind === 'opened' ? (
              <div key={ev.id} className="rounded-lg border border-line bg-surface px-3 py-2">
                <div className="text-[12px] text-ink-faint">
                  <OwnerLink bare ownerName={ev.actor} onClick={() => ownerDoor(ev.actor)} /> opened this
                  {ev.actorKind === 'agent' ? ' (agent)' : ''} · {relativeTime(ev.at)}
                </div>
                <div className="mt-1 whitespace-pre-wrap text-[13px] leading-snug text-ink">
                  {c.summary.trim() ? c.summary : <span className="text-ink-faint">No summary given.</span>}
                </div>
              </div>
            ) : ev.kind === 'note' ? (
              <div key={ev.id} className="rounded-lg border border-line bg-surface px-3 py-2">
                <div className="text-[12px] text-ink-faint">
                  <OwnerLink bare ownerName={ev.actor} onClick={() => ownerDoor(ev.actor)} />
                  <span> · {relativeTime(ev.at)}</span>
                </div>
                <div className="mt-1 whitespace-pre-wrap text-[13px] leading-snug text-ink-soft">{ev.body}</div>
              </div>
            ) : ev.kind === 'landed' ? (
              <div key={ev.id} className="flex items-center gap-2 py-0.5 text-[12px] text-ink-faint">
                <CheckCircle2 size={14} className="shrink-0 text-emerald-600" />
                <span>
                  landed as <span className="font-semibold text-ink-soft">L{c.landingNumber}</span> by{' '}
                  <OwnerLink bare ownerName={ev.actor} onClick={() => ownerDoor(ev.actor)} /> · {relativeTime(ev.at)}
                </span>
              </div>
            ) : ev.kind === 'crystallized' ? (
              <div key={ev.id} className="flex items-center gap-2 py-0.5 text-[12px] text-ink-faint">
                <Pencil size={14} className="shrink-0 text-ink-faint" />
                <span>
                  <OwnerLink bare ownerName={ev.actor} onClick={() => ownerDoor(ev.actor)} /> crystallized{' '}
                  {ev.body} · {relativeTime(ev.at)}
                </span>
              </div>
            ) : ev.kind === 'envelope-proposed' ? (
              <div key={ev.id} className="flex items-center gap-2 py-0.5 text-[12px] text-ink-faint">
                <AlertCircle size={14} className="shrink-0 text-amber-600" />
                <span>
                  <OwnerLink bare ownerName={ev.actor} onClick={() => ownerDoor(ev.actor)} /> proposed the effect
                  envelope {ev.body} · {relativeTime(ev.at)}
                </span>
              </div>
            ) : ev.kind === 'envelope-approved' ? (
              <div key={ev.id} className="flex items-center gap-2 py-0.5 text-[12px] text-ink-faint">
                <CheckCircle2 size={14} className="shrink-0 text-emerald-600" />
                <span>
                  <OwnerLink bare ownerName={ev.actor} onClick={() => ownerDoor(ev.actor)} /> approved the envelope{' '}
                  {ev.body} · {relativeTime(ev.at)}
                </span>
              </div>
            ) : ev.kind === 'effect-executed' ? (
              <div key={ev.id} className="flex items-center gap-2 py-0.5 text-[12px] text-ink-faint">
                <span className="ml-0.5 h-2 w-2 shrink-0 rounded-full bg-accent" aria-hidden />
                <span>
                  <OwnerLink bare ownerName={ev.actor} onClick={() => ownerDoor(ev.actor)} /> ran {ev.body} ·{' '}
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
        <div className="mt-4 flex items-center gap-1.5">
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void send()}
            placeholder="Add a comment…"
            aria-label={`Comment on ${c.title}`}
            className="min-w-0 flex-1 rounded-lg border border-line bg-surface px-3 py-1.5 text-[13px] text-ink outline-none placeholder:text-ink-faint focus:border-line-strong"
          />
          <button
            onClick={() => void send()}
            disabled={busy || !draft.trim()}
            className="shrink-0 rounded-lg bg-accent px-3 py-1.5 text-[13px] font-medium text-white transition enabled:hover:bg-accent/90 disabled:opacity-45"
          >
            Post
          </button>
        </div>
        {error && <p className="mt-1.5 text-[12px] text-removed">{error}</p>}
      </div>
    </Page>
  )
}

/** The changeset card (CW3/CW4, Phase D) — the contribution page's payload
 *  block: the LATEST crystallized version's entries, each a real before→after
 *  through the shared TextDiff (a change is a diff, never prose). Versions are
 *  append-only; earlier ones survive as timeline events carrying the review
 *  delta. The composer accumulates entries locally, then crystallizes one
 *  version — revision is a new version, never an edit (no force-push). */
function ChangesetCard({ project, c }: { project: Project; c: Contribution }) {
  const mayAct = c.mine === true || project.own !== false
  const versions = c.changeset ?? []
  const latest = versions.at(-1)
  const [composing, setComposing] = useState(false)
  const [kind, setKind] = useState<ChangeEntryKind>('note')
  const [target, setTarget] = useState('')
  const [before, setBefore] = useState('')
  const [after, setAfter] = useState('')
  const [pending, setPending] = useState<{ kind: ChangeEntryKind; target: string; before?: string; after: string }[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  if (!latest && (c.status !== 'open' || !mayAct)) return null

  const addEntry = () => {
    if (!target.trim() || !after.trim()) return
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
    if (busy || entries.length === 0) return
    setBusy(true)
    setError(null)
    try {
      await crystallizeContribution(project.id, c.id, { entries })
      setPending([])
      setTarget('')
      setBefore('')
      setAfter('')
      setComposing(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not crystallize this version.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mt-5 rounded-xl border border-line bg-surface">
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
            className="rounded-lg border border-line px-2 py-0.5 text-[11px] font-medium text-ink-soft transition hover:border-line-strong hover:text-ink"
          >
            {latest ? 'Revise' : 'Crystallize'}
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
      {composing && (
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
              aria-label="Change kind"
              className="rounded-lg border border-line bg-surface px-2 py-1 text-[12px] text-ink outline-none focus:border-line-strong"
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
              placeholder="Target (path / name / surface)…"
              aria-label="Change target"
              className="min-w-0 flex-1 rounded-lg border border-line bg-surface px-2 py-1 text-[12px] text-ink outline-none placeholder:text-ink-faint focus:border-line-strong"
            />
          </div>
          <textarea
            value={before}
            onChange={(e) => setBefore(e.target.value)}
            rows={2}
            placeholder="Before (leave empty for a create)…"
            aria-label="Before text"
            className="w-full resize-none rounded-lg border border-line bg-surface px-2 py-1 text-[12px] text-ink outline-none placeholder:text-ink-faint focus:border-line-strong"
          />
          <textarea
            value={after}
            onChange={(e) => setAfter(e.target.value)}
            rows={2}
            placeholder="After…"
            aria-label="After text"
            className="w-full resize-none rounded-lg border border-line bg-surface px-2 py-1 text-[12px] text-ink outline-none placeholder:text-ink-faint focus:border-line-strong"
          />
          <div className="flex items-center justify-end gap-1.5">
            <button
              onClick={addEntry}
              disabled={!target.trim() || !after.trim()}
              className="rounded-lg border border-line px-2.5 py-1 text-[12px] font-medium text-ink-soft transition enabled:hover:border-line-strong enabled:hover:text-ink disabled:opacity-45"
            >
              Add change
            </button>
            <button
              onClick={() => void crystallize()}
              disabled={busy || (pending.length === 0 && !(target.trim() && after.trim()))}
              className="rounded-lg bg-accent px-2.5 py-1 text-[12px] font-medium text-white transition enabled:hover:bg-accent/90 disabled:opacity-45"
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

/** The envelope card (CW1, Phase C) — the contribution page's authorization
 *  block: what external acts this work may fire, under which harness, how many
 *  used. Consent-card-shaped rows; the approve act is the owner's one human
 *  judgment (the floor rule), after which Run is a mechanical match. */
function EnvelopeCard({ project, c }: { project: Project; c: Contribution }) {
  const own = project.own !== false
  const mayAct = c.mine === true || own
  const env = c.envelope
  const [composing, setComposing] = useState(false)
  const [type, setType] = useState<ProjectEffectType>('connector.write')
  const [target, setTarget] = useState('')
  const [cardinality, setCardinality] = useState(1)
  const [harness, setHarness] = useState<EnvelopeHarness>('draft-escrow')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // No envelope and nothing left to declare (landed) — nothing to show.
  if (!env && (c.status !== 'open' || !mayAct)) return null

  const act = async (fn: () => Promise<unknown>, fail: string) => {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      await fn()
    } catch (e) {
      setError(e instanceof Error ? e.message : fail)
    } finally {
      setBusy(false)
    }
  }
  const propose = () =>
    act(async () => {
      if (!target.trim()) return
      const lines = [
        ...(env?.lines ?? []).map((l) => ({ type: l.type, target: l.target, cardinality: l.cardinality, harness: l.harness, note: l.note })),
        { type, target: target.trim(), cardinality, harness },
      ]
      await proposeEnvelope(project.id, c.id, { lines })
      setTarget('')
      setComposing(false)
    }, 'Could not propose the envelope.')

  return (
    <div className="mt-5 rounded-xl border border-line bg-surface">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-3 py-2">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
          Effect envelope{env ? ` · v${env.version}` : ''}
        </div>
        <div className="flex items-center gap-1.5">
          {env &&
            (env.status === 'approved' ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-600/10 px-2 py-0.5 text-[11px] font-medium text-emerald-700">
                <CheckCircle2 size={12} /> Approved by {env.approvedBy}
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 rounded-full bg-amber-600/10 px-2 py-0.5 text-[11px] font-medium text-amber-700">
                <AlertCircle size={12} /> Awaiting approval
              </span>
            ))}
          {env && env.status === 'proposed' && own && c.status === 'open' && (
            <button
              onClick={() => void act(() => approveEnvelope(project.id, c.id), 'Could not approve.')}
              disabled={busy}
              title="Approve these acts as proposed — matching acts then run without re-asking"
              className="rounded-lg bg-ink px-2.5 py-0.5 text-[11px] font-medium text-canvas shadow-sm transition hover:opacity-90 disabled:opacity-45"
            >
              Approve
            </button>
          )}
          {c.status === 'open' && mayAct && (
            <button
              onClick={() => setComposing((v) => !v)}
              className="rounded-lg border border-line px-2 py-0.5 text-[11px] font-medium text-ink-soft transition hover:border-line-strong hover:text-ink"
            >
              {env ? 'Amend' : 'Declare effects'}
            </button>
          )}
        </div>
      </div>
      {env ? (
        env.lines.map((l) => (
          <div key={l.id} className="flex items-center gap-2.5 border-b border-line px-3 py-2 last:border-b-0">
            <div className="min-w-0 flex-1">
              <div className="truncate text-[13px] text-ink">
                {l.type} → <span className="font-medium">{l.target}</span>
              </div>
              <div className="truncate text-[11px] text-ink-faint">
                ≤{l.cardinality} · {l.harness}
                {l.note ? ` · ${l.note}` : ''}
              </div>
            </div>
            <span className="shrink-0 text-[11px] tabular-nums text-ink-faint">
              {l.used}/{l.cardinality} used
            </span>
            {env.status === 'approved' && c.status === 'open' && mayAct && (
              <button
                onClick={() => void act(() => runEnvelopeEffect(project.id, c.id, l.id), 'Could not run this act.')}
                disabled={busy || l.used >= l.cardinality}
                title={
                  l.used >= l.cardinality
                    ? 'Cardinality exhausted — amend the envelope for more'
                    : `Fire one ${l.type} act on ${l.target} (mechanically matched against this line)`
                }
                className="shrink-0 rounded-lg bg-accent px-2.5 py-0.5 text-[11px] font-medium text-white transition enabled:hover:bg-accent/90 disabled:opacity-45"
              >
                Run
              </button>
            )}
          </div>
        ))
      ) : (
        <p className="px-3 py-2 text-[12px] text-ink-faint">
          No external acts declared. If this work needs to send, charge, or reach outside the project,
          declare the envelope <em>before</em> acting — approval happens here, not after the fact.
        </p>
      )}
      {composing && (
        <div className="flex flex-wrap items-center gap-1.5 border-t border-line px-3 py-2">
          <select
            value={type}
            onChange={(e) => setType(e.target.value as ProjectEffectType)}
            aria-label="Effect type"
            className="rounded-lg border border-line bg-surface px-2 py-1 text-[12px] text-ink outline-none focus:border-line-strong"
          >
            {PROJECT_EFFECT_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
          <input
            autoFocus
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void propose()
              if (e.key === 'Escape') setComposing(false)
            }}
            placeholder="Target (connector / descriptor)…"
            aria-label="Effect target"
            className="min-w-0 flex-1 rounded-lg border border-line bg-surface px-2 py-1 text-[12px] text-ink outline-none placeholder:text-ink-faint focus:border-line-strong"
          />
          <input
            type="number"
            min={1}
            max={20}
            value={cardinality}
            onChange={(e) => setCardinality(Math.max(1, Math.min(20, Number(e.target.value) || 1)))}
            aria-label="Max acts"
            title="How many acts this line authorizes (≤)"
            className="w-14 rounded-lg border border-line bg-surface px-2 py-1 text-[12px] text-ink outline-none focus:border-line-strong"
          />
          <select
            value={harness}
            onChange={(e) => setHarness(e.target.value as EnvelopeHarness)}
            aria-label="Safety harness"
            title="The containment this line runs under (CW5's ladder)"
            className="rounded-lg border border-line bg-surface px-2 py-1 text-[12px] text-ink outline-none focus:border-line-strong"
          >
            {ENVELOPE_HARNESSES.map((h) => (
              <option key={h} value={h}>
                {h}
              </option>
            ))}
          </select>
          <button
            onClick={() => void propose()}
            disabled={busy || !target.trim()}
            className="shrink-0 rounded-lg bg-accent px-2.5 py-1 text-[12px] font-medium text-white transition enabled:hover:bg-accent/90 disabled:opacity-45"
          >
            Propose v{(env?.version ?? 0) + 1}
          </button>
        </div>
      )}
      {error && <p className="px-3 pb-2 text-[11px] text-removed">{error}</p>}
    </div>
  )
}

/* ─────────────────────────── Artifacts ─────────────────────────── */


/** The Artifacts gallery. Its kind facet is chosen in the RAIL TREE (ADAPT-13 — the
 *  `subview` prop; the group ids ARE the ArtifactKind values), never an in-page bar. */
function ArtifactsSection({ subview, onOpenSession }: { subview: string | null; onOpenSession: (id: string) => void }) {
  const [query, setQuery] = useState('')
  const [openId, setOpenId] = useState<string | null>(null)
  const [folded, setFolded] = useState<Set<string>>(new Set())
  const [creating, setCreating] = useState(false)
  const rel = useRelations()
  const projects = rel.allProjects()
  const sessions = useSessions().data ?? []
  // Resolve an artifact's producing conversation for "From ‹conversation›": by its
  // stable `sourceSessionId` when stamped (runtime saves), else by the `source`
  // TITLE (seed/legacy artifacts — a best-effort fallback: a title is mutable and
  // not unique). A created/sourceless artifact ("Created here") or an unknown
  // source has no match and stays a plain label.
  const sessionIdByTitle = useMemo(() => {
    const m = new Map<string, string>()
    for (const s of sessions) if (!m.has(s.title)) m.set(s.title, s.id)
    return m
  }, [sessions])
  const sourceSessionOf = (a: ArtifactItem) =>
    a.sourceSessionId && sessions.some((s) => s.id === a.sourceSessionId)
      ? a.sourceSessionId
      : sessionIdByTitle.get(a.source)

  const foldGroup = (id: string) =>
    setFolded((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })

  const needle = query.trim().toLowerCase()
  // The filter tab ids ARE the ArtifactKind values: 'all' → no kind filter, else
  // restrict to that kind.
  // The rail's group node (lib/subviews) drives the type filter: null = all types (the
  // page still folds by project), else focus the chosen type.
  const wantKind = subview ? (subview as ArtifactKind) : null

  const matches = rel.allArtifacts().filter(
    (a) =>
      (wantKind === null || a.kind === wantKind) &&
      (needle === '' ||
        a.name.toLowerCase().includes(needle) ||
        (a.excerpt ?? '').toLowerCase().includes(needle) ||
        a.source.toLowerCase().includes(needle)),
  )

  // Sorted by project by default — group in PROJECTS order, drop empty groups.
  // Membership comes from the relation graph, so an AI "move to project" /
  // "save as artifact under …" edit re-groups the gallery live. A trailing
  // "Unfiled" bucket catches artifacts not under any project (e.g. a draft
  // saved with no project), so nothing a user confirmed can vanish from view.
  const knownProjectId = new Set(projects.map((p) => p.id))
  const groups = [
    ...projects.map((p) => ({ id: p.id, name: p.name, items: matches.filter((a) => rel.artifactProjectId(a) === p.id) })),
    { id: '__unfiled', name: 'Unfiled', items: matches.filter((a) => !knownProjectId.has(rel.artifactProjectId(a))) },
  ].filter((g) => g.items.length > 0)

  const openArtifact = openId ? (rel.allArtifacts().find((a) => a.id === openId) ?? null) : null

  // Create an artifact straight from the gallery (no session): a sessionless
  // save-artifact op, optionally filed under a project. Server-owned + persisted
  // via the same /relations/ops path; not auto-opened because the server mints
  // its id (the optimistic id would be replaced on reconcile).
  const createArtifact = (draft: { name: string; kind: ArtifactKind; excerpt: string }, projectId: string | null) => {
    const project = projectId ? projects.find((p) => p.id === projectId) : undefined
    rel.applyOp({
      kind: 'save-artifact',
      artifact: { name: draft.name, kind: draft.kind, meta: KIND_LABEL[draft.kind], excerpt: draft.excerpt || undefined },
      projectId: project?.id,
      projectName: project?.name,
    })
    setCreating(false)
  }

  // Assign an artifact to a project (or unfile it, projectId null) — re-files via
  // the relation graph, re-grouping the gallery live for every client. A not-yet-
  // reconciled artifact has no server id to re-file (its optimistic id is about to
  // be replaced), so skip it — the gallery already prevents opening one.
  const assignProject = (artifact: ArtifactItem, projectId: string | null) => {
    if (isOptimisticId(artifact.id)) return
    const project = projectId ? projects.find((p) => p.id === projectId) : undefined
    rel.applyOp({
      kind: 'refile-artifact',
      artifactId: artifact.id,
      artifactName: artifact.name,
      projectId: project?.id ?? null,
      projectName: project?.name ?? '',
    })
  }

  return (
    <Page>
      <PageHeader title="Artifacts">
        <PrimaryButton icon={<Plus size={15} />} onClick={() => setCreating(true)}>
          New artifact
        </PrimaryButton>
      </PageHeader>
      <SearchBox value={query} onChange={setQuery} placeholder="Search artifacts…" />

      {groups.length === 0 ? (
        <Empty>No artifacts match.</Empty>
      ) : (
        <div className="space-y-7">
          {groups.map((g) => {
            const isFolded = folded.has(g.id)
            return (
              <div key={g.id}>
                <FoldGroupHeader
                  label={g.name}
                  count={g.items.length}
                  folded={isFolded}
                  onToggle={() => foldGroup(g.id)}
                />
                {!isFolded && (
                  <div className="grid grid-cols-1 gap-3 @2xl:grid-cols-2 @4xl:grid-cols-3">
                    {g.items.map((a) => {
                      // A just-created artifact carries a temporary optimistic id until the
                      // server's authoritative `art-live-*` id replaces it on reconcile. Don't
                      // let it be opened in that window — its id isn't one the server would
                      // recognize, so opening (then re-filing) it would target a phantom id.
                      const pending = isOptimisticId(a.id)
                      return (
                        <ArtifactCard
                          key={a.id}
                          artifact={a}
                          source={rel.artifactSourceFor(a.id)}
                          pending={pending}
                          onOpen={() => {
                            if (!pending) setOpenId(a.id)
                          }}
                        />
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {openArtifact && (
        <ArtifactViewer
          artifact={openArtifact}
          projects={projects}
          currentProjectId={rel.artifactProjectId(openArtifact)}
          onAssignProject={(projectId) => assignProject(openArtifact, projectId)}
          onOpenSource={(() => {
            const sid = sourceSessionOf(openArtifact)
            return sid ? () => { onOpenSession(sid); setOpenId(null) } : undefined
          })()}
          onClose={() => setOpenId(null)}
        />
      )}
      {creating && (
        <NewArtifactDialog projects={projects} onCreate={createArtifact} onClose={() => setCreating(false)} />
      )}
    </Page>
  )
}

/** The "New artifact" form — name, a kind picker (doc / sheet / image / slide /
 *  email), an optional one-line excerpt, and an optional project to file it under.
 *  Mirrors NewProjectDialog's modal idiom. */
function NewArtifactDialog({
  projects,
  onCreate,
  onClose,
}: {
  projects: Project[]
  onCreate: (draft: { name: string; kind: ArtifactKind; excerpt: string }, projectId: string | null) => void
  onClose: () => void
}) {
  const [name, setName] = useState('')
  const [kind, setKind] = useState<ArtifactKind>('doc')
  const [excerpt, setExcerpt] = useState('')
  const [projectId, setProjectId] = useState<string | null>(null)
  const dialogRef = useRef<HTMLDivElement>(null)
  const nameRef = useRef<HTMLInputElement>(null)

  // Focus the name field on open, trap Tab within the dialog, close on Escape,
  // restore focus on close.
  useFocusTrap(dialogRef, onClose, { initialFocus: nameRef })

  const canCreate = name.trim().length > 0
  const submit = () => {
    if (canCreate) onCreate({ name: name.trim(), kind, excerpt: excerpt.trim() }, projectId)
  }

  const KINDS: ArtifactKind[] = ['doc', 'sheet', 'image', 'slide', 'email']

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex justify-center px-4 pt-[12dvh]"
      onMouseDown={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="New artifact"
    >
      <div className={`${SCRIM_CLASS} backdrop-blur-[1px]`} />
      <div
        ref={dialogRef}
        onMouseDown={(e) => e.stopPropagation()}
        className="relative flex h-fit w-[480px] max-w-full flex-col overflow-hidden rounded-xl bg-surface shadow-2xl ring-1 ring-line-strong"
      >
        <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
          <div className="flex items-center gap-2">
            <FileText size={18} className="text-cap-workspace" />
            <span className="text-[15px] font-semibold text-ink">New artifact</span>
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

        <div className="space-y-4 p-5">
          <label className="block">
            <span className="mb-1.5 block text-[12px] font-medium text-ink-soft">Name</span>
            <input
              ref={nameRef}
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') submit()
              }}
              placeholder="e.g. launch-brief.md"
              className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-[14px] text-ink outline-none transition placeholder:text-ink-faint focus:border-accent"
            />
          </label>

          <div>
            <span className="mb-1.5 block text-[12px] font-medium text-ink-soft">Type</span>
            <div className="flex flex-wrap gap-1.5">
              {KINDS.map((k) => {
                const KIcon = KIND_ICON[k]
                const on = kind === k
                return (
                  <button
                    key={k}
                    onClick={() => setKind(k)}
                    aria-pressed={on}
                    className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[12px] font-medium transition ${
                      on
                        ? 'border-accent bg-accent-tint text-accent-strong'
                        : 'border-line bg-surface text-ink-soft hover:border-line-strong'
                    }`}
                  >
                    <KIcon size={14} />
                    {KIND_LABEL[k]}
                  </button>
                )
              })}
            </div>
          </div>

          <label className="block">
            <span className="mb-1.5 block text-[12px] font-medium text-ink-soft">
              Excerpt <span className="font-normal text-ink-faint">(optional)</span>
            </span>
            <textarea
              value={excerpt}
              onChange={(e) => setExcerpt(e.target.value)}
              rows={2}
              placeholder="A one-line preview shown on the card."
              className="w-full resize-none rounded-lg border border-line bg-surface px-3 py-2 text-[14px] leading-relaxed text-ink outline-none transition placeholder:text-ink-faint focus:border-accent"
            />
          </label>

          <label className="block">
            <span className="mb-1.5 block text-[12px] font-medium text-ink-soft">
              Project <span className="font-normal text-ink-faint">(optional)</span>
            </span>
            <select
              value={projectId ?? ''}
              onChange={(e) => setProjectId(e.target.value || null)}
              className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-[14px] text-ink outline-none transition focus:border-accent"
            >
              <option value="">No project</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="flex shrink-0 items-center justify-end gap-2 border-t border-line bg-panel px-5 py-3">
          <button
            onClick={onClose}
            className="rounded-lg border border-line-strong bg-surface px-3.5 py-1.5 text-[13px] font-medium text-ink-soft shadow-sm transition hover:border-accent hover:text-ink"
          >
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={!canCreate}
            className="flex items-center gap-1.5 rounded-lg bg-ink px-3.5 py-1.5 text-[13px] font-medium text-canvas shadow-sm transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Plus size={15} />
            Create artifact
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}

function ArtifactCard({
  artifact,
  source,
  pending = false,
  onOpen,
}: {
  artifact: ArtifactItem
  source?: string
  /** A just-created artifact still reconciling to its server id — shown saving and
   *  not openable until its real id lands (so it can't be opened or re-filed by a
   *  temporary id the server won't recognize). */
  pending?: boolean
  onOpen: () => void
}) {
  const Icon = KIND_ICON[artifact.kind]
  return (
    <button
      onClick={onOpen}
      disabled={pending}
      aria-busy={pending}
      className={`flex flex-col overflow-hidden rounded-xl border border-line bg-surface text-left shadow-sm transition ${
        pending ? 'cursor-default opacity-60' : 'hover:border-line-strong hover:shadow'
      }`}
    >
      <div className="h-28 w-full overflow-hidden border-b border-line bg-panel-2/40">
        <ArtifactThumb kind={artifact.kind} name={artifact.name} excerpt={artifact.excerpt} />
      </div>
      <div className="flex flex-1 flex-col p-3.5">
        <div className="flex items-center gap-2">
          <Icon size={15} className="shrink-0 text-cap-workspace" />
          <span className="truncate text-[13px] font-semibold text-ink">{artifact.name}</span>
        </div>
        {artifact.excerpt && (
          <p className="mt-1.5 line-clamp-2 text-[12px] leading-snug text-ink-soft">
            {artifact.excerpt}
          </p>
        )}
        {source && (
          <div className="mt-2 inline-flex w-fit items-center gap-1 rounded bg-accent-tint px-1.5 py-0.5 text-[10px] font-medium text-accent-strong">
            from {source}
          </div>
        )}
        <div className="mt-3">
          {/* S6 — the gallery card's own descriptor (meta), when it's more specific than
              the generic kind label (the shared guard prevents "Document · Document"). */}
          {artifactMetaIsSpecific(artifact.meta, KIND_LABEL[artifact.kind]) && (
            <span className="mr-2 text-[11px] text-ink-soft">{artifact.meta}</span>
          )}
          <span className="text-[11px] text-ink-faint">
            {pending ? 'Saving…' : `Edited ${relativeTime(artifact.editedAt)}`}
          </span>
        </div>
      </div>
    </button>
  )
}

/* ─────────────────────────── Contexts ─────────────────────────── */

const CONTEXT_GROUPS: { kind: SavedContextKind; label: string }[] = [
  { kind: 'connector', label: 'Connectors' },
  { kind: 'mcp', label: 'MCP servers' },
  { kind: 'repo', label: 'Repositories' },
]


/** The reusable context the workspace already knows about — connectors and MCP
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

/* ── Add context ─────────────────────────────────────────────────────────────
   The same catalog a session attaches from (data/contextOptions), surfaced here
   as savable contexts. An option that's already a saved context reuses its rich
   seed entry; anything new (not yet set up) gets a freshly-derived one — so the
   page can add the exact connectors / MCP servers / repos a session can. */

const SEED_BY_ID = new Map(SAVED_CONTEXTS.map((c) => [c.id, c]))

/** The trailing folder name of a local repo path. */
function repoBasename(p: string) {
  const parts = p.replace(/\/+$/, '').split('/')
  return parts[parts.length - 1] || p
}

const connectorSaved = (o: { id: string; label: string; kind?: Connector['kind'] }): SavedContext =>
  SEED_BY_ID.get(o.id) ?? {
    id: o.id,
    label: o.label,
    kind: 'connector',
    connectorKind: o.kind ?? 'connector',
    status: 'connected',
    detail: 'Connected',
    lastUsedAt: Date.now(),
    sessions: 0,
  }

const mcpSaved = (o: { id: string; label: string; meta: string }): SavedContext =>
  SEED_BY_ID.get(o.id) ?? {
    id: o.id,
    label: o.label,
    kind: 'mcp',
    status: 'connected',
    detail: o.meta,
    lastUsedAt: Date.now(),
    sessions: 0,
  }

const githubRepoSaved = (o: { id: string; remote: string; branch: string }): SavedContext =>
  SEED_BY_ID.get(o.id) ?? {
    id: o.id,
    label: o.remote,
    kind: 'repo',
    origin: 'github',
    dependsOnGitHub: true,
    status: 'connected',
    detail: `github · ${o.branch}`,
    lastUsedAt: Date.now(),
    sessions: 0,
  }

const localRepoSaved = (o: { id: string; path: string; branch: string; remote?: string }): SavedContext =>
  SEED_BY_ID.get(o.id) ?? {
    id: o.id,
    label: repoBasename(o.path),
    kind: 'repo',
    origin: 'local',
    dependsOnGitHub: !!o.remote,
    status: 'connected',
    detail: `${o.path} · ${o.branch}${o.remote ? '' : ' · local only'}`,
    lastUsedAt: Date.now(),
    sessions: 0,
  }

/** Every addable context, grouped the same way the page lists them. */
const ADDABLE_GROUPS: { kind: SavedContextKind; label: string; items: SavedContext[] }[] = [
  { kind: 'connector', label: 'Connectors', items: CONNECTOR_OPTIONS.map(connectorSaved) },
  { kind: 'mcp', label: 'MCP servers', items: MCP_OPTIONS.map(mcpSaved) },
  {
    kind: 'repo',
    label: 'Repositories',
    items: [...GITHUB_REPO_OPTIONS.map(githubRepoSaved), ...LOCAL_REPO_OPTIONS.map(localRepoSaved)],
  },
]

/** A bubble that appears after a short hover delay — for icon-only controls whose
 *  purpose isn't obvious at a glance (e.g. the connect/disconnect plug). Rendered
 *  in a body portal with fixed positioning so it can't be clipped by an ancestor's
 *  `overflow-hidden` (the rounded list crops the top row's upward bubble). */
function Tooltip({
  label,
  children,
  delay = 400,
}: {
  label: string
  children: ReactNode
  delay?: number
}) {
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null)
  const ref = useRef<HTMLSpanElement>(null)
  const timer = useRef<number | undefined>(undefined)

  const openSoon = () => {
    timer.current = window.setTimeout(() => {
      const el = ref.current
      if (!el) return
      const r = el.getBoundingClientRect()
      setPos({ x: r.left + r.width / 2, y: r.top })
    }, delay)
  }
  const cancel = () => {
    window.clearTimeout(timer.current)
    setPos(null)
  }
  useEffect(() => () => window.clearTimeout(timer.current), [])

  return (
    <span
      ref={ref}
      className="relative inline-flex"
      onMouseEnter={openSoon}
      onMouseLeave={cancel}
      onFocus={openSoon}
      onBlur={cancel}
    >
      {children}
      {pos &&
        createPortal(
          <span
            role="tooltip"
            style={{ left: pos.x, top: pos.y }}
            className="pointer-events-none fixed z-50 -translate-x-1/2 -translate-y-[calc(100%_+_6px)] whitespace-nowrap rounded-md bg-ink px-2 py-1 text-[11px] font-medium text-canvas shadow-md"
          >
            {label}
            <span className="absolute left-1/2 top-full h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rotate-45 bg-ink" />
          </span>,
          document.body,
        )}
    </span>
  )
}

/** The header "Add context" button + its popover. Lists everything not yet saved
 *  (grouped by type); adding one drops it from the popover and into the list,
 *  staying open so several can be added in a row. */
function AddContextControl({
  existingIds,
  onAdd,
}: {
  existingIds: Set<string>
  onAdd: (ctx: SavedContext) => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useDismissable<HTMLDivElement>(open, () => setOpen(false))
  const popRef = usePopoverShift<HTMLDivElement>(open)

  const groups = ADDABLE_GROUPS.map((g) => ({
    ...g,
    items: g.items.filter((c) => !existingIds.has(c.id)),
  })).filter((g) => g.items.length > 0)

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="dialog"
        aria-expanded={open}
        className="flex shrink-0 items-center gap-1.5 rounded-lg bg-ink px-3.5 py-1.5 text-[13px] font-medium text-canvas shadow-sm transition hover:opacity-90"
      >
        <Plus size={15} />
        Add context
      </button>

      {open && (
        <div
          ref={popRef}
          role="dialog"
          aria-label="Add context"
          className={`absolute right-0 z-30 mt-2 w-[320px] overflow-hidden ${POPOVER_SURFACE}`}
        >
          <div className="max-h-[min(60dvh,420px)] overflow-y-auto p-2">
            {groups.length === 0 ? (
              <div className="px-2 py-6 text-center text-[12px] text-ink-faint">
                Everything’s set up — nothing new to add.
              </div>
            ) : (
              groups.map((g) => (
                <div key={g.kind} className="pb-1">
                  <p className="px-1.5 pb-1 pt-1 text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
                    {g.label}
                  </p>
                  {g.items.map((c) => (
                    <AddContextRow key={c.id} ctx={c} onAdd={() => onAdd(c)} />
                  ))}
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function AddContextRow({ ctx, onAdd }: { ctx: SavedContext; onAdd: () => void }) {
  const Icon = contextIcon(ctx)
  return (
    <button
      onClick={onAdd}
      className="group mb-0.5 flex w-full items-center gap-2.5 rounded-lg px-1.5 py-1.5 text-left transition hover:bg-panel-2"
    >
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-panel-2 text-ink-soft">
        <Icon size={15} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-medium text-ink">{ctx.label}</span>
        <span className="block truncate text-[11px] text-ink-faint">{ctx.detail}</span>
      </span>
      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md text-ink-faint transition group-hover:bg-accent group-hover:text-white">
        <Plus size={14} />
      </span>
    </button>
  )
}

/** The Contexts filter (in-page, the shared SubTabs primitive): the tab ids ARE the
 *  SavedContextKind values, so the body switches on the choice directly. */
function ContextsSection({
  subview,
  contextId,
  onBack,
  backTo,
}: {
  subview: string | null
  /** The open detail (null = the list) — nav-owned (ADAPT-15: the detail was once
   *  component state with no address; now it's a page at /contexts/:id). */
  contextId: string | null
  onBack: () => void
  backTo: NavLocation | null
}) {
  const rel = useRelations()
  // The base list is server-owned: a connect / disconnect routes through the server,
  // which broadcasts `connector.status`, so the row's auth state reconciles here and
  // on every other client. Fall back to the seed while the first fetch is in flight.
  const saved = useSavedContexts()
  const items = saved.data?.contexts ?? SAVED_CONTEXTS
  const [query, setQuery] = useState('')
  // Which group headers are folded shut.
  const [folded, setFolded] = useState<Set<SavedContextKind>>(new Set())

  // Add / remove / connect all route through the SERVER (the registry is the
  // system of record — these once lived in component state and silently
  // evaporated when the section unmounted): the optimistic cache write makes the
  // row flip instantly, the broadcast reconciles every other client.
  const toggle = (id: string) => {
    const item = items.find((c) => c.id === id)
    if (item) void setConnectorStatus(id, item.status === 'connected' ? 'needs-auth' : 'connected')
  }
  const remove = (id: string) => {
    void removeSavedContext(id)
  }
  const add = (ctx: SavedContext) => {
    void addSavedContext(ctx)
  }
  const foldGroup = (kind: SavedContextKind) =>
    setFolded((prev) => {
      const next = new Set(prev)
      next.has(kind) ? next.delete(kind) : next.add(kind)
      return next
    })

  // Clicking a row drills into the same detail a session shows for that context —
  // through the controller (rel.navigate), so the page has an address and history.
  // A stale id (removed context, dead link) degrades to the list.
  const open = contextId ? (items.find((c) => c.id === contextId) ?? null) : null
  if (open)
    return (
      <ContextDetail
        ctx={open}
        onBack={onBack}
        backTo={backTo}
        onToggle={() => toggle(open.id)}
        onRemove={() => {
          remove(open.id)
          onBack()
        }}
      />
    )

  const needle = query.trim().toLowerCase()
  // The filter tab ids ARE the SavedContextKind values: 'all' → no kind filter, else
  // restrict to that kind.
  // The rail's group node (lib/subviews) drives the filter: null = all kinds (folded
  // groups on the page), else focus the chosen kind.
  const wantKind = subview ? (subview as SavedContextKind) : null

  const visible = items.filter(
    (c) =>
      (wantKind === null || c.kind === wantKind) &&
      (needle === '' || c.label.toLowerCase().includes(needle) || c.detail.toLowerCase().includes(needle)),
  )
  const groups = CONTEXT_GROUPS.map((g) => ({
    ...g,
    items: visible.filter((c) => c.kind === g.kind),
  })).filter((g) => g.items.length > 0)

  return (
    <Page>
      <PageHeader title="Contexts">
        <AddContextControl existingIds={new Set(items.map((c) => c.id))} onAdd={add} />
      </PageHeader>
      <p className="-mt-2 mb-4 text-[13px] leading-relaxed text-ink-soft">
        Accounts, servers, and repos you’ve set up once. Any session can reuse them from{' '}
        <span className="font-medium text-ink">Add context</span> — no re-authenticating, no re-cloning.
      </p>
      <SearchBox value={query} onChange={setQuery} placeholder="Search contexts…" />

      {groups.length === 0 ? (
        <Empty>No contexts match.</Empty>
      ) : (
        <div className="space-y-7">
          {groups.map((g) => {
            const isFolded = folded.has(g.kind)
            return (
              <div key={g.kind}>
                <FoldGroupHeader
                  label={g.label}
                  count={g.items.length}
                  folded={isFolded}
                  onToggle={() => foldGroup(g.kind)}
                />
                {!isFolded && (
                  <div className="overflow-hidden rounded-xl border border-line bg-surface shadow-sm">
                    {g.items.map((c, i) => (
                      <ContextRow
                        key={c.id}
                        ctx={c}
                        first={i === 0}
                        onOpen={() => rel.navigate('contexts', c.id)}
                        onToggle={() => toggle(c.id)}
                        onRemove={() => remove(c.id)}
                      />
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      <McpAccessCard />
    </Page>
  )
}

/** The other direction of the Contexts page (access-parity INV-11): the rows
 *  above are what THIS workspace connects to; this card is how other agents
 *  connect to IT — the workspace as an auth-gated MCP server. The mint is a
 *  one-time reveal (the server keeps only the signed token's verifiability,
 *  and this panel keeps nothing); the copy IS the save, same as the relay
 *  secret panel's rule. */
function McpAccessCard() {
  const me = useMe()
  const signedIn = me.data?.via === 'session'
  const tokens = useApiTokens(signedIn)
  const [minted, setMinted] = useState<{ token: string; tokenId?: string } | null>(null)
  const [label, setLabel] = useState('')
  const [core, setCore] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // The externally dialable endpoint, derived from API_BASE like the relay
  // panel's URLs — right in EVERY deploy shape (dev's Vite proxy forwards
  // /api, not the root `/mcp` alias, so the base-path form is the one that
  // always answers; production serves both).
  const baseUrl = `${new URL(API_BASE, window.location.origin).href.replace(/\/$/, '')}/mcp`
  // `?toolset=core` narrows tools/list to the everyday subset — a PRESENTATION
  // choice for the connecting client (a model's tool context stays small);
  // every operation stays callable by name on either URL (INV-11).
  const mcpUrl = core ? `${baseUrl}?toolset=core` : baseUrl
  const mint = async () => {
    setBusy(true)
    setError(null)
    try {
      const session = await mintApiToken(label.trim() || undefined)
      setMinted({ token: session.token, tokenId: session.tokenId })
      setLabel('')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not mint a token.')
    } finally {
      setBusy(false)
    }
  }
  // Ready-to-paste client wiring (the generic `mcpServers` shape MCP clients
  // share — deliberately no harness-specific install recipe: that design
  // lesson is locked by tests/connector-serve.test.ts). Computed for the COPY
  // ACTION only, never rendered — the credential shows in exactly one place.
  const jsonConfig = minted
    ? JSON.stringify({ mcpServers: { workspace: { type: 'http', url: mcpUrl, headers: { Authorization: `Bearer ${minted.token}` } } } }, null, 2)
    : null
  return (
    <div className="mt-8 overflow-hidden rounded-xl border border-line bg-surface shadow-sm">
      <div className="flex items-center gap-2 border-b border-line px-4 py-3">
        <Server size={15} className="text-ink-soft" />
        <span className="text-[13px] font-semibold text-ink">This workspace is an MCP server</span>
      </div>
      <div className="space-y-3 px-4 py-3.5 text-[13px] leading-relaxed text-ink-soft">
        <p>
          Any MCP client — another Claude, an agent, a script — can drive everything this UI can:
          same account, same walls, by construction. Point it at the endpoint and authenticate with
          a minted token.
        </p>
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
        {minted ? (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate rounded-lg bg-panel-2/50 px-2.5 py-1.5 font-mono text-[12px] text-ink">{minted.token}</span>
              <CopyButton text={minted.token} label="Copy token" ariaLabel="Copy the access token" />
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
          <div className="flex flex-wrap items-center gap-2.5">
            <input
              type="text"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Token label (optional — e.g. laptop MCP)"
              maxLength={80}
              disabled={!signedIn}
              className="min-w-0 flex-1 rounded-lg border border-line bg-panel-2/30 px-2.5 py-1.5 text-[12px] text-ink placeholder:text-ink-faint focus:outline-none focus:ring-1 focus:ring-accent disabled:opacity-50"
            />
            <button
              onClick={mint}
              disabled={busy || !signedIn}
              className="flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-[12px] font-semibold text-white shadow-sm transition hover:bg-accent-strong disabled:opacity-50"
            >
              <KeyRound size={13} />
              Mint access token
            </button>
            {!signedIn && <span className="text-[11px] text-ink-faint">Sign in to mint — a token is minted from a verified session.</span>}
            {error && <span className="text-[11px] text-red-600">{error}</span>}
          </div>
        )}
        {signedIn && (tokens.data?.length ?? 0) > 0 && (
          <div className="space-y-1 border-t border-line pt-2.5">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-ink-faint">Active tokens</div>
            {tokens.data!.map((t) => (
              <div key={t.id} className="flex items-center gap-2 text-[12px]">
                <KeyRound size={12} className="shrink-0 text-ink-faint" />
                <span className="min-w-0 flex-1 truncate text-ink">
                  {t.label ?? 'Unlabeled token'}
                  <span className="text-ink-faint"> · minted {new Date(t.createdAt).toLocaleDateString()}</span>
                  {minted?.tokenId === t.id && <span className="text-emerald-600"> · just minted</span>}
                </span>
                <button
                  onClick={() =>
                    revokeApiToken(t.id)
                      // Revoking the just-minted token retires its reveal too —
                      // a dead credential must not linger on screen as copyable.
                      .then(() => setMinted((m) => (m?.tokenId === t.id ? null : m)))
                      .catch(() => {})
                  }
                  className="rounded-lg px-2 py-0.5 text-[11px] font-medium text-ink-faint transition hover:bg-red-50 hover:text-red-600"
                >
                  Revoke
                </button>
              </div>
            ))}
            <p className="text-[11px] text-ink-faint">
              Revoking kills the credential immediately — the registry, not the signature, is what keeps a token alive.
            </p>
          </div>
        )}
      </div>
    </div>
  )
}

function ContextRow({
  ctx,
  first,
  onOpen,
  onToggle,
  onRemove,
}: {
  ctx: SavedContext
  first: boolean
  onOpen: () => void
  onToggle: () => void
  onRemove: () => void
}) {
  const Icon = contextIcon(ctx)
  const connected = ctx.status === 'connected'

  return (
    <div
      className={`group flex items-center gap-3 transition hover:bg-panel-2/50 ${
        first ? '' : 'border-t border-line'
      }`}
    >
      {/* The main region drills into the detail; the trailing actions sit outside
          this button so they don't trigger the navigation. */}
      <button onClick={onOpen} className="flex min-w-0 flex-1 items-center gap-3 px-4 py-3 text-left">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-panel-2 text-ink-soft">
          <Icon size={16} />
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-[14px] font-medium text-ink">{ctx.label}</span>
            {ctx.kind === 'repo' && (
              <span className="shrink-0 rounded bg-panel-2 px-1.5 py-0.5 text-[10px] font-medium text-ink-soft">
                {ctx.origin === 'local' ? 'Local' : 'GitHub'}
              </span>
            )}
          </div>
          <div className="truncate text-[12px] text-ink-faint">{ctx.detail}</div>
        </div>

        <div className="hidden shrink-0 pr-1 text-right sm:block">
          <div className="text-[12px] text-ink-soft">
            {ctx.sessions} session{ctx.sessions === 1 ? '' : 's'}
          </div>
          <div className="text-[11px] text-ink-faint">
            {ctx.lastUsedAt == null ? 'Never used' : `Last used ${relativeTime(ctx.lastUsedAt)}`}
          </div>
        </div>
      </button>

      <div className="flex shrink-0 items-center gap-2 pr-4">
        {/* Below sm the pill yields its width to the name column — the detail
            view (and the connect/disconnect control itself) carries the status. */}
        <span className="max-sm:hidden">
          {ctx.kind === 'repo' ? (
            <StatusPill tone="neutral" label={ctx.dependsOnGitHub ? 'via GitHub' : 'Local only'} />
          ) : (
            <StatusPill tone={connected ? 'ok' : 'warn'} label={connected ? 'Connected' : 'Needs auth'} />
          )}
        </span>

        {/* Hover-revealed actions — same idiom as the panel's per-folder delete. */}
        <div className={`flex items-center gap-1 focus-within:opacity-100 ${HOVER_REVEAL}`}>
          {ctx.kind !== 'repo' && (
            <Tooltip label={connected ? 'Disconnect' : 'Connect'}>
              <button
                onClick={onToggle}
                aria-label={connected ? `Disconnect ${ctx.label}` : `Connect ${ctx.label}`}
                className="flex h-7 w-7 items-center justify-center rounded-md text-ink-faint transition hover:bg-panel-2 hover:text-ink"
              >
                {connected ? <Unplug size={14} /> : <Plug size={14} />}
              </button>
            </Tooltip>
          )}
          <button
            onClick={onRemove}
            title="Remove from contexts"
            aria-label={`Remove ${ctx.label} from contexts`}
            className="flex h-7 w-7 items-center justify-center rounded-md text-ink-faint transition hover:bg-removed-bg hover:text-removed"
          >
            <Trash2 size={14} />
          </button>
        </div>
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
  onRemove,
}: {
  ctx: SavedContext
  onBack: () => void
  backTo: NavLocation | null
  onToggle: () => void
  onRemove: () => void
}) {
  const Icon = contextIcon(ctx)
  const isRepo = ctx.kind === 'repo'
  const connected = ctx.status === 'connected'
  const asConnector: Connector = {
    id: ctx.id,
    label: ctx.label,
    kind: ctx.kind === 'mcp' ? 'mcp' : ctx.connectorKind,
  }

  return (
    <Page>
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
              <h1 className={`${PAGE_TITLE_CLASS} truncate`}>{ctx.label}</h1>
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
              className="flex items-center gap-1.5 rounded-lg border border-line-strong bg-surface px-3 py-1.5 text-[13px] font-medium text-ink shadow-sm transition hover:border-accent"
            >
              {connected ? <Unplug size={14} /> : <Plug size={14} />}
              {connected ? 'Disconnect' : 'Connect'}
            </button>
          )}
          <button
            onClick={onRemove}
            className="flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-[13px] font-medium text-ink-soft shadow-sm transition hover:border-removed hover:bg-removed-bg hover:text-removed"
          >
            <Trash2 size={14} />
            Remove
          </button>
        </div>
      </header>

      <div className="flex flex-col gap-6 @3xl:flex-row">
        <div className="min-w-0 flex-1">
          <div className="rounded-xl border border-line bg-surface p-4 shadow-sm">
            {isRepo ? (
              <RepoDetailBody ctx={ctx} />
            ) : (
              <ConnectorDetailBody connector={asConnector} connected={connected} />
            )}
          </div>
        </div>

        <aside className="w-full shrink-0 space-y-4 @3xl:w-72">
          <SidePanel title="Usage" icon={<Clock size={14} />}>
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
          </SidePanel>

          {isRepo && ctx.dependsOnGitHub && (
            <SidePanel title="Depends on" icon={<Github size={14} />}>
              <div className="flex items-center gap-2 text-[13px] text-ink">
                <Github size={15} className="shrink-0 text-ink-soft" />
                GitHub connector
              </div>
              <p className="mt-1.5 text-[12px] leading-relaxed text-ink-faint">
                Sessions that attach this repo reuse the GitHub connector — no re-cloning.
              </p>
            </SidePanel>
          )}
        </aside>
      </div>
    </Page>
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
      <div className="flex items-center gap-1.5 text-[12px] font-medium text-emerald-700">
        <span className="h-2 w-2 rounded-full bg-emerald-500" />
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
      ? 'bg-emerald-500'
      : tone === 'warn'
        ? 'bg-amber-500'
        : tone === 'bad'
          ? 'bg-red-500'
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

/** The Agents hub (docs/agent-commons.md) — one left-panel home for the multi-tenant
 *  fabric: the worker Agents, the Model providers + system prompts they run on, and the
 *  commissions placing them on Projects. The four concepts are interdependent (an Agent
 *  binds a provider + prompt; a commission binds an Agent to a Project), so they read as
 *  ONE surface — its sub-views live in the rail's drill-in menu (lib/subviews), not an
 *  in-page segmented control, so all of the app's section navigation lives in one place. */
type CommonsTab = 'agents' | 'work' | 'prompts' | 'commissions' | 'discover' | 'audit'

function AgentCommonsSection({
  owner,
  agentId,
  subview,
  onOpenProject,
  onOpenProposal,
  onOpenAgentPage,
  onBack,
  backTo,
}: {
  /** A workspace profile to show instead of the hub (D21) — null = the hub. */
  owner: string | null
  /** A published definition's own page (COMMONS-26) — null = the hub / profile. */
  agentId: string | null
  /** The active hub sub-view — a CommonsTab id, defaulting to the worker-agents surface
   *  ('agents') when the section is on its default (rail subview null). */
  subview: string
  onOpenProject: (id: string) => void
  /** Open a change proposal on its review surface (the same door the bell uses). */
  onOpenProposal: (agentId: string, proposalId: string, ownerName: string | null) => void
  onOpenAgentPage: (agentId: string) => void
  onBack: () => void
  backTo: NavLocation | null
}) {
  const tab = subview as CommonsTab
  // NB: no "reset the sub-view for an agent door" effect here — the door entry
  // points (openAgent / openProposal in useSessionWorkspace) already land the hub
  // on its default surface in the same update that sets the focus target, and a
  // component-side reset routed through the openSubview funnel would CLEAR that
  // pendingFocus. The controller is the single source of the reset.
  if (agentId) {
    return <AgentPublicPage agentId={agentId} onOpenAgent={onOpenAgentPage} onBack={onBack} backTo={backTo} />
  }
  if (owner) {
    return (
      <OwnerProfilePage
        name={owner}
        onOpenProject={onOpenProject}
        onOpenAgentPage={onOpenAgentPage}
        onBack={onBack}
        backTo={backTo}
      />
    )
  }
  return (
    <Page>
      <PageHeader title="Agents" />
      <p className="-mt-2 mb-4 text-[13px] leading-relaxed text-ink-soft">
        Your worker agents and the fabric they run on — the{' '}
        <span className="font-medium text-ink">prompts</span> they start from and the{' '}
        <span className="font-medium text-ink">commissions</span> placing them on projects.
        The models that supply their cognition live in the sidebar’s{' '}
        <span className="font-medium text-ink">Models</span> section.
      </p>
      <div className="mt-1">
        {tab === 'agents' && <AgentsTab onOpenPage={onOpenAgentPage} />}
        {tab === 'work' && <YourWorkTab onOpenProposal={onOpenProposal} />}
        {tab === 'prompts' && <PromptsTab />}
        {tab === 'commissions' && <CommissionsTab />}
        {tab === 'discover' && <DiscoverTab onOpenAgentPage={onOpenAgentPage} />}
        {tab === 'audit' && <AuditTab />}
      </div>
    </Page>
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
    <div className={`inline-flex max-w-full flex-wrap items-center gap-1 rounded-lg border border-line bg-surface shadow-sm ${pad}`}>
      {tabs.map((t) => {
        const on = t.id === active
        return (
          <button
            key={t.id}
            onClick={() => onChange(t.id)}
            aria-pressed={on}
            className={`rounded-md font-medium transition ${btn} ${
              on ? 'bg-ink text-canvas shadow-sm' : 'text-ink-soft hover:text-ink'
            }`}
          >
            {t.label}
          </button>
        )
      })}
    </div>
  )
}

/** The shared card shell + head for the Agents-hub lists — one icon-tile + title +
 *  subtitle row (with optional trailing slot), so the four tabs read as one system
 *  (form follows function). The body below the head is each card's own children. */
function CommonsCard({
  children,
  cardRef,
  flash = false,
}: {
  children: ReactNode
  /** Set by a notification-door target (R6) so the card can scroll itself into view. */
  cardRef?: RefObject<HTMLDivElement | null>
  /** Lit briefly when a door lands on this card (the shared focus-flash cue). */
  flash?: boolean
}) {
  return (
    <div
      ref={cardRef}
      className={`group scroll-mt-6 rounded-xl border bg-surface p-4 shadow-sm transition-colors ${
        flash ? 'border-accent bg-accent-tint ring-1 ring-accent/40' : 'border-line'
      }`}
    >
      {children}
    </div>
  )
}

/** The shared input style for the hub's form dialogs — one source so every field reads
 *  the same (form follows function). */
const FORM_INPUT_CLASS =
  'w-full rounded-lg border border-line bg-surface px-3 py-2 text-[14px] text-ink outline-none transition placeholder:text-ink-faint focus:border-accent'

/** A right-aligned "New ‹thing›" toolbar above a hub list — the same affordance on
 *  every tab. */
function TabToolbar({ newLabel, onNew }: { newLabel: string; onNew: () => void }) {
  return (
    <div className="flex justify-end">
      <PrimaryButton icon={<Plus size={15} />} onClick={onNew}>
        {newLabel}
      </PrimaryButton>
    </div>
  )
}

/** Hover-revealed edit / delete actions on a management card — the same idiom as the
 *  Contexts rows. Shared so every hub card exposes the same cue. */
function CardActions({ onEdit, onDelete }: { onEdit?: () => void; onDelete?: () => void }) {
  return (
    <div className={`flex shrink-0 items-center gap-1 focus-within:opacity-100 ${HOVER_REVEAL}`}>
      {onEdit && (
        <button
          onClick={onEdit}
          title="Edit"
          aria-label="Edit"
          className="flex h-7 w-7 items-center justify-center rounded-md text-ink-faint transition hover:bg-panel-2 hover:text-ink"
        >
          <Pencil size={14} />
        </button>
      )}
      {onDelete && (
        <button
          onClick={onDelete}
          title="Delete"
          aria-label="Delete"
          className="flex h-7 w-7 items-center justify-center rounded-md text-ink-faint transition hover:bg-removed-bg hover:text-removed"
        >
          <Trash2 size={14} />
        </button>
      )}
    </div>
  )
}

/** A labeled form field for the hub dialogs. */
function FormField({ label, optional, children }: { label: string; optional?: boolean; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[12px] font-medium text-ink-soft">
        {label}
        {optional && <span className="font-normal text-ink-faint"> (optional)</span>}
      </span>
      {children}
    </label>
  )
}

/** The shared create / edit modal shell for the Agents hub — portal + focus trap, a
 *  titled header, a body of fields, an inline error slot, and a Cancel / submit footer.
 *  One primitive so every concept's dialog looks and behaves identically (form follows
 *  function); each dialog supplies only its own fields + submit handler. */
function FormDialog({
  title,
  icon,
  submitLabel,
  submitIcon,
  canSubmit,
  onSubmit,
  onClose,
  error,
  children,
}: {
  title: string
  icon: ReactNode
  submitLabel: string
  submitIcon?: ReactNode
  canSubmit: boolean
  onSubmit: () => void
  onClose: () => void
  error?: string | null
  children: ReactNode
}) {
  const dialogRef = useRef<HTMLDivElement>(null)
  useFocusTrap(dialogRef, onClose)
  // Land focus on the first field, not the close button useFocusTrap would otherwise
  // pick (this mount effect runs after the trap's, so it wins).
  useEffect(() => {
    dialogRef.current?.querySelector<HTMLElement>('input, textarea, select')?.focus()
  }, [])
  return createPortal(
    <div
      className="fixed inset-0 z-50 flex justify-center px-4 pt-[14dvh]"
      onMouseDown={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div className={`${SCRIM_CLASS} backdrop-blur-[1px]`} />
      <div
        ref={dialogRef}
        onMouseDown={(e) => e.stopPropagation()}
        className="relative flex h-fit w-[460px] max-w-full flex-col overflow-hidden rounded-xl bg-surface shadow-2xl ring-1 ring-line-strong"
      >
        <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
          <div className="flex items-center gap-2">
            {icon}
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

        <div className="space-y-4 p-5">
          {children}
          {error && <p className="text-[12px] text-removed">{error}</p>}
        </div>

        <div className="flex shrink-0 items-center justify-end gap-2 border-t border-line bg-panel px-5 py-3">
          <button
            onClick={onClose}
            className="rounded-lg border border-line-strong bg-surface px-3.5 py-1.5 text-[13px] font-medium text-ink-soft shadow-sm transition hover:border-accent hover:text-ink"
          >
            Cancel
          </button>
          <button
            onClick={onSubmit}
            disabled={!canSubmit}
            className="flex items-center gap-1.5 rounded-lg bg-ink px-3.5 py-1.5 text-[13px] font-medium text-canvas shadow-sm transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {submitIcon}
            {submitLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}

function CommonsCardHead({
  icon,
  title,
  subtitle,
  trailing,
  onOpen,
}: {
  icon: ReactNode
  title: string
  subtitle: ReactNode
  trailing?: ReactNode
  /** When the card fronts a page / detail, the TITLE is the door (GitHub's
   *  title-as-link) — the same handler as the card's explicit open affordance,
   *  so every way in shares one destination. Absent = a non-navigating head. */
  onOpen?: () => void
}) {
  return (
    <div className="flex items-center gap-2.5">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-panel-2 text-ink-soft">
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        {onOpen ? (
          <button
            onClick={onOpen}
            className="block max-w-full truncate text-left text-[14px] font-medium text-ink hover:underline"
          >
            {title}
          </button>
        ) : (
          <div className="truncate text-[14px] font-medium text-ink">{title}</div>
        )}
        <div className="truncate text-[12px] text-ink-faint">{subtitle}</div>
      </div>
      {trailing}
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
    s === 'open' ? 'bg-amber-500' : s === 'done' || s === 'merged' ? 'bg-emerald-500' : 'bg-line-strong'
  return (
    <div className="space-y-5">
      <section>
        <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
          Work items you posted
        </div>
        {work.posted.length === 0 ? (
          <Empty>Nothing posted yet — post a work item on a shared project and follow it here.</Empty>
        ) : (
          <div className="space-y-1.5">
            {work.posted.map((o) => (
              <div key={o.id} className="flex items-start gap-2.5 rounded-lg border border-line bg-surface px-3 py-2">
                <span className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${statusDot(o.status)}`} />
                <div className="min-w-0 flex-1">
                  <button
                    onClick={() => rel.navigate('projects', o.projectId, o.id)}
                    className={`block max-w-full truncate text-left text-[13px] font-medium hover:underline ${
                      o.status === 'retracted' ? 'text-ink-faint line-through' : 'text-ink'
                    }`}
                  >
                    {o.subGoal}
                  </button>
                  <div className="text-[11px] text-ink-faint">
                    in{' '}
                    <button onClick={() => rel.navigate('projects', o.projectId)} className="font-medium hover:underline">
                      {o.projectName}
                    </button>{' '}
                    · {o.status === 'open' ? 'awaiting a taker' : o.status} · {relativeTime(o.postedAt)}
                    {(o.comments?.length ?? 0) > 0
                      ? ` · ${o.comments!.length} comment${o.comments!.length === 1 ? '' : 's'}`
                      : ''}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
      <section>
        <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
          Proposals you opened
        </div>
        {work.proposals.length === 0 ? (
          <Empty>No change proposals yet — propose a change from a published definition in Discover.</Empty>
        ) : (
          <div className="space-y-1.5">
            {work.proposals.map((p) => (
              <div key={p.id} className="flex items-start gap-2.5 rounded-lg border border-line bg-surface px-3 py-2">
                <span className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${statusDot(p.status)}`} />
                <div className="min-w-0 flex-1">
                  <button
                    onClick={() => onOpenProposal(p.agentId, p.id, p.agentOwner === myName ? null : p.agentOwner)}
                    className="block max-w-full truncate text-left text-[13px] font-medium text-ink hover:underline"
                  >
                    {p.note.trim() || `Change to ${p.agentLabel}`}
                  </button>
                  <div className="text-[11px] text-ink-faint">
                    on {p.agentLabel} · by{' '}
                    <OwnerLink bare ownerName={p.agentOwner} onClick={() => rel.navigate('agents', p.agentOwner)} /> ·{' '}
                    {p.status} · {relativeTime(p.at)}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}

/** Worker Agents (D6) — label, the provider it runs on, its tool count, and its
 *  authority grant ceiling (D8). Read-only here; create / edit / delete land in a
 *  later slice. */
function AgentsTab({ onOpenPage }: { onOpenPage: (agentId: string) => void }) {
  const agents = useAgents().data ?? []
  const providers = useProviders().data ?? []
  // Every creatable agent names its provider (the strict-API rule); only definition-
  // only fork/import stubs (D18/D20 — capability never travels) are unbound, so say
  // that instead of implying a hidden default resolution.
  const providerLabel = (id?: string) => providers.find((p) => p.id === id)?.label ?? 'No provider bound yet'
  const [editing, setEditing] = useState<Agent | 'new' | null>(null)
  return (
    <div className="space-y-3">
      <TabToolbar newLabel="New agent" onNew={() => setEditing('new')} />
      {agents.length === 0 ? (
        <Empty>No agents yet.</Empty>
      ) : (
        agents.map((a) => (
          <AgentCard key={a.id} agent={a} providerLabel={providerLabel(a.providerId)} onEdit={() => setEditing(a)} onOpenPage={onOpenPage} />
        ))
      )}
      {editing && <AgentDialog agent={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </div>
  )
}

function AgentCard({
  agent,
  providerLabel,
  onEdit,
  onOpenPage,
}: {
  agent: Agent
  providerLabel: string
  onEdit: () => void
  /** Door to this definition's PUBLIC page (published agents only — the page is the
   *  directory's face, so an unpublished agent has none and its count stays text). */
  onOpenPage: (agentId: string) => void
}) {
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  // D25 — the owner's review queue: fetched only for published definitions (the
  // only ones that can receive proposals).
  const proposals = useAgentProposals(agent.id, agent.published === true).data ?? []
  const openProposals = proposals.filter((p) => p.status === 'open')
  const [reviewing, setReviewing] = useState(false)
  // S4 — the version-history timeline the owner (who authored every version) could see
  // only as a bare badge. Shown regardless of publish state: the badge is
  // published-only, but the changelog persists after an unpublish.
  const changelog = agent.changelog ?? []
  const [showHistory, setShowHistory] = useState(false)
  // The A2A-card viewer, driven by WHICH card was asked for — this definition's own
  // published card and (if present) its imported-from lineage card are distinct URLs
  // that can both exist on one agent, so a single boolean would be ambiguous.
  const [cardModal, setCardModal] = useState<{ url: string; title: string } | null>(null)
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
  // recipient owns) with no proposalId — scroll this card into view + flash it. The
  // shared hook consumes the pending target so it fires once.
  const cardRef = useRef<HTMLDivElement>(null)
  const agentFocus = pending?.agentId === agent.id && !pending?.proposalId
  const flash = useFocusFlash(agentFocus, cardRef)
  const del = async () => {
    setError(null)
    try {
      await deleteAgent(agent.id)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not delete this agent.')
    }
  }
  // The D18 publish/unpublish act — an explicit toggle (a definition is published
  // deliberately, never as a side-effect of an edit).
  const togglePublish = async () => {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      await updateAgent(agent.id, { published: !agent.published })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not change publishing.')
    } finally {
      setBusy(false)
    }
  }
  return (
    <CommonsCard cardRef={cardRef} flash={flash}>
      <CommonsCardHead
        icon={<Bot size={16} />}
        title={agent.label}
        subtitle={`Runs on ${providerLabel} · ${agent.tools.length} tool${agent.tools.length === 1 ? '' : 's'}`}
        trailing={
          <div className="flex shrink-0 items-center gap-1.5">
            {agent.published && (
              <span
                title="Published to the directory — any account may fork this definition"
                className="rounded-full bg-accent/10 px-1.5 py-px text-[10px] font-medium uppercase tracking-wide text-accent"
              >
                Published · v{agent.version ?? 1}
              </span>
            )}
            <CardActions onEdit={onEdit} onDelete={del} />
          </div>
        }
      />
      <p className="mt-2 text-[12px] text-ink-soft">Authority: {authorityLabel(agent.authority)}</p>
      {agent.forkedFrom && (
        <p className="mt-1 inline-flex items-center gap-1 text-[12px] text-ink-faint">
          {/* S7 — the label is a VERBATIM provenance snapshot (kept as text, never a
              live deep link that 404s on unpublish); the pinned VERSION is the baseline
              a "am I behind the source?" check measures against — revealed, not dropped. */}
          <GitFork size={12} /> Forked from {agent.forkedFrom.label}
          {agent.forkedFrom.version ? ` · v${agent.forkedFrom.version}` : ''}
        </p>
      )}
      {agent.importedFrom && (
        <p className="mt-1 inline-flex items-center gap-1 text-[12px] text-ink-faint">
          {/* S7 — a cross-instance provenance relation is a ref link, not a dead label
              with the URL buried in a hover title: the source card is one click away. */}
          <Globe size={12} /> Imported from{' '}
          <button
            onClick={() =>
              setCardModal({ url: agent.importedFrom!.url, title: `Imported card — ${agent.importedFrom!.name}` })
            }
            title={agent.importedFrom.url}
            className="underline decoration-dotted underline-offset-2 transition hover:text-ink"
          >
            {agent.importedFrom.name}
          </button>{' '}
          (A2A card)
        </p>
      )}
      {agent.contributions ? (
        // S18 — the count is a door to its lineage where one exists: the public page's
        // resolved-work list (published only; unpublished agents have no public page,
        // so the count stays honest text).
        agent.published ? (
          <button
            onClick={() => onOpenPage(agent.id)}
            title="Open this agent's page — the resolved work behind this count"
            className="mt-1 inline-flex items-center gap-1 text-[12px] text-emerald-700 underline underline-offset-2 transition hover:text-emerald-800"
          >
            <Award size={12} /> {agent.contributions} commissioned contribution
            {agent.contributions === 1 ? '' : 's'} on the Commons
          </button>
        ) : (
          <p className="mt-1 inline-flex items-center gap-1 text-[12px] text-emerald-700">
            <Award size={12} /> {agent.contributions} commissioned contribution
            {agent.contributions === 1 ? '' : 's'} on the Commons
          </p>
        )
      ) : null}
      <div className="mt-2 flex items-center gap-3">
        <button
          onClick={togglePublish}
          disabled={busy}
          className={INLINE_ACTION_CLASS}
          title={
            agent.published
              ? 'Remove this agent from the directory (copies already forked stay with their owners)'
              : 'Share this agent’s definition (prompt · tools · instructions) in the directory — your model, authority, and budget are never shared'
          }
        >
          {agent.published ? 'Unpublish' : 'Publish to directory'}
        </button>
        {agent.published && (
          <button
            onClick={() => setCardModal({ url: a2aAgentCardUrl(agent.id), title: `A2A card — ${agent.label}` })}
            className={INLINE_ACTION_CLASS}
            title="The machine-readable A2A Agent Card for this published definition — hand this URL to a foreign agent framework"
          >
            A2A card
          </button>
        )}
        {(agent.forks ?? 0) > 0 && (
          <span className="inline-flex items-center gap-1 text-[11px] text-ink-faint">
            <GitFork size={11} /> forked {agent.forks} time{agent.forks === 1 ? '' : 's'}
          </span>
        )}
        {/* S4 — the owner reaches their own version-history timeline, not just a badge. */}
        {changelog.length > 0 && (
          <button
            onClick={() => setShowHistory((v) => !v)}
            className={INLINE_ACTION_CLASS}
            aria-expanded={showHistory}
            title="This definition’s version history — who authored each version and why"
          >
            <History size={12} /> {showHistory ? 'Hide history' : `History (${changelog.length})`}
          </button>
        )}
        {/* D25 — the review queue: proposals sent back by forkers/visitors. */}
        {agent.published && proposals.length > 0 && (
          <button
            onClick={() => setReviewing(true)}
            className={INLINE_ACTION_CLASS}
            title="Review change proposals against this published definition"
          >
            {openProposals.length > 0
              ? `Review ${openProposals.length} proposal${openProposals.length === 1 ? '' : 's'}`
              : 'Proposal history'}
          </button>
        )}
      </div>
      {showHistory && changelog.length > 0 && (
        <div className="mt-2">
          <ChangelogList changelog={changelog} />
        </div>
      )}
      {error && <p className="mt-2 text-[12px] text-removed">{error}</p>}
      {cardModal && (
        <A2aCardDialog url={cardModal.url} title={cardModal.title} onClose={() => setCardModal(null)} />
      )}
      {reviewing && (
        <ProposalsReviewDialog
          agent={agent}
          proposals={proposals}
          focusProposalId={reviewFocus}
          onClose={() => {
            setReviewing(false)
            setReviewFocus(null)
          }}
        />
      )}
    </CommonsCard>
  )
}

/** D27 — one proposal's discussion thread + composer, shared by the owner's review
 *  dialog and the proposer's view on the public detail (one thread, two ends —
 *  form follows function). The composer shows only while the proposal is open
 *  (the verdict ends the conversation). */
function ProposalThread({
  agentId,
  proposal,
  openForComments,
}: {
  agentId: string
  proposal: AgentChangeProposal
  openForComments: boolean
}) {
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const comments = proposal.comments ?? []
  if (comments.length === 0 && !openForComments) return null
  const send = async () => {
    if (busy || !draft.trim()) return
    setBusy(true)
    setError(null)
    try {
      await commentOnAgentProposal(agentId, proposal.id, draft.trim())
      setDraft('')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not post this comment.')
    } finally {
      setBusy(false)
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
      {openForComments && (
        <div className="flex items-center gap-1.5">
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && send()}
            placeholder="Discuss this proposal…"
            aria-label={`Comment on proposal ${proposal.id}`}
            className="min-w-0 flex-1 rounded-lg border border-line bg-surface px-2 py-1 text-[12px] text-ink outline-none placeholder:text-ink-faint focus:border-line-strong"
          />
          <button
            onClick={send}
            disabled={busy || !draft.trim()}
            className="shrink-0 rounded-lg bg-accent px-2.5 py-1 text-[12px] font-medium text-white transition enabled:hover:bg-accent/90 disabled:opacity-45"
          >
            Post
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
                <OwnerLink ownerName={f.owner} own={f.own} onClick={() => rel.navigate('agents', f.owner)} />
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
 *  a workspace byline, so it's a door to that workspace's profile like every other
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
          <OwnerLink ownerName={l.author} onClick={() => rel.navigate('agents', l.author)} /> · {l.note} ·{' '}
          {relativeTime(l.at)}
        </li>
      ))}
    </ul>
  )
}

/** D25 — the owner's review queue: each proposal as a side-by-side (current vs
 *  proposed, per changed field), with the stale flag and the two verdicts. Merging
 *  applies the fields, bumps the version, and credits the proposer in the changelog. */
function ProposalsReviewDialog({
  agent,
  proposals,
  onClose,
  focusProposalId = null,
}: {
  agent: Agent
  proposals: AgentChangeProposal[]
  onClose: () => void
  /** A notification door opened this dialog ON a specific proposal (R5) — scroll it
   *  into view and mark it. Null when opened by the Review button. */
  focusProposalId?: string | null
}) {
  const dialogRef = useRef<HTMLDivElement>(null)
  useFocusTrap(dialogRef, onClose)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const currentVersion = agent.version ?? 1
  // Scroll the door's target proposal into view once it's present (the list is a
  // live fetch, so it may arrive after the dialog opens).
  const focusRef = useRef<HTMLDivElement>(null)
  const focusPresent = proposals.some((p) => p.id === focusProposalId)
  useEffect(() => {
    if (focusProposalId && focusPresent) focusRef.current?.scrollIntoView({ block: 'center' })
  }, [focusProposalId, focusPresent])
  const verdict = async (pid: string, action: 'merge' | 'decline') => {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      await resolveAgentProposal(agent.id, pid, action)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not resolve this proposal.')
    } finally {
      setBusy(false)
    }
  }
  const current: Record<string, string> = {
    label: agent.label,
    systemPrompt: agent.systemPrompt,
    instructions: agent.instructions,
    tools: agent.tools.join(', '),
  }
  return (
    <div
      className="fixed inset-0 z-50 flex justify-center px-4 pt-[10dvh] short:pt-[5dvh]"
      onMouseDown={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={`Proposals — ${agent.label}`}
    >
      <div className={SCRIM_CLASS} />
      <div
        ref={dialogRef}
        onMouseDown={(e) => e.stopPropagation()}
        className="relative flex max-h-[76dvh] w-[640px] max-w-full flex-col overflow-hidden rounded-xl bg-surface shadow-2xl ring-1 ring-line-strong"
      >
        <div className="flex shrink-0 items-center gap-2.5 border-b border-line px-4 py-3">
          <GitPullRequest size={16} className="shrink-0 text-ink-faint" />
          <span className="flex-1 text-[14px] font-semibold text-ink">
            Proposals — {agent.label} <span className="font-normal text-ink-faint">(v{currentVersion})</span>
          </span>
          <button onClick={onClose} aria-label="Close" className="text-ink-faint transition hover:text-ink">
            <X size={16} />
          </button>
        </div>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
          {proposals.map((p) => {
            const isFocus = p.id === focusProposalId
            return (
            <div
              key={p.id}
              ref={isFocus ? focusRef : undefined}
              className={`scroll-mt-4 rounded-xl border p-3 transition-colors ${
                isFocus ? 'border-accent bg-accent-tint ring-1 ring-accent/40' : 'border-line'
              }`}
            >
              <div className="flex items-center gap-2 text-[12px]">
                <span className="font-medium text-ink">{p.proposedBy}</span>
                <span className="text-ink-faint">· {relativeTime(p.at)} · against v{p.baseVersion}</span>
                {p.status === 'open' && p.baseVersion < currentVersion && (
                  <span
                    title="Authored against an older version — review with care (never auto-rebased)"
                    className="rounded-full bg-amber-500/10 px-1.5 py-px text-[10px] font-medium text-amber-700"
                  >
                    stale
                  </span>
                )}
                {p.status !== 'open' && (
                  <span className="rounded-full bg-panel-2 px-1.5 py-px text-[10px] font-medium uppercase tracking-wide text-ink-faint">
                    {p.status}
                  </span>
                )}
                {/* The terminal lifecycle event's timestamp (D25; surface-audit S1). */}
                {p.status !== 'open' && p.resolvedAt && (
                  <span className="text-ink-faint">· {relativeTime(p.resolvedAt)}</span>
                )}
              </div>
              {p.note && <p className="mt-1 text-[12px] text-ink-soft">{p.note}</p>}
              <ProposalFieldDiff fields={p.fields} current={current} />
              {/* D27 — the check row: the honest, knowable facts about a prompt
                  replacement (advisory, never gating — the merge stays the gate). */}
              {p.check && (
                <p className="mt-2 flex items-start gap-1 rounded-lg bg-amber-500/10 px-2 py-1.5 text-[11px] leading-snug text-amber-700">
                  <AlertCircle size={12} className="mt-0.5 shrink-0" /> {p.check.note}
                </p>
              )}
              <ProposalThread agentId={agent.id} proposal={p} openForComments={p.status === 'open'} />
              {p.status === 'open' ? (
                <div className="mt-2.5 flex items-center gap-2">
                  <button
                    onClick={() => void verdict(p.id, 'merge')}
                    disabled={busy}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-ink px-2.5 py-1 text-[12px] font-medium text-canvas transition enabled:hover:opacity-90 disabled:opacity-45"
                  >
                    <GitMerge size={13} /> Merge
                  </button>
                  <button onClick={() => void verdict(p.id, 'decline')} disabled={busy} className={INLINE_ACTION_CLASS}>
                    Decline
                  </button>
                </div>
              ) : p.responseNote ? (
                <p className="mt-2 text-[11px] text-ink-faint">Owner’s note: {p.responseNote}</p>
              ) : null}
            </div>
            )
          })}
        </div>
        {error && <p className="border-t border-line px-4 py-2 text-[12px] text-removed">{error}</p>}
      </div>
    </div>
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
  const providers = useProviders().data ?? []
  const prompts = useSystemPrompts().data ?? []
  const catalog = useAgentToolCatalog().data?.tools ?? []
  const [label, setLabel] = useState(agent?.label ?? '')
  const [providerId, setProviderId] = useState(agent?.providerId ?? '')
  const [promptId, setPromptId] = useState(agent?.systemPromptId ?? '')
  const [instructions, setInstructions] = useState(agent?.instructions ?? '')
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

  // The pickers' EFFECTIVE values: untouched state resolves to the default-else-first
  // entry (registries load async, so this is derived, not initial state). An agent
  // carrying a BESPOKE prompt (merged proposal, fork) has no library binding — its
  // picker keeps a "keep current" option ('') and must never be coerced onto a library
  // entry by an unrelated edit; only that case leaves effectivePromptId empty.
  const bespokePrompt = !!agent && !agent.systemPromptId
  const effectiveProviderId = providerId || defaultEntry(providers)?.id || ''
  const effectivePromptId = promptId || (bespokePrompt ? '' : defaultEntry(prompts)?.id || '')
  // What the grant checkbox shows: 'keep' reflects the agent's current grant.
  // "Has the full catalog" is a SET test (every catalog tool granted), not a
  // length compare — a same-size custom subset (or a grant carrying a stale tool
  // not in the catalog) must not read as full.
  const agentHasFullCatalog = !!agent && catalog.length > 0 && catalog.every((t) => agent.tools.includes(t))
  // A custom subset worth PRESERVING when the user unchecks (neither empty nor full).
  const agentHasCustomSubset = !!agent && agent.tools.length > 0 && !agentHasFullCatalog
  const grantAll = toolChoice === 'all' || (toolChoice === 'keep' && agentHasFullCatalog)
  const canSubmit =
    label.trim().length > 0 &&
    !!effectiveProviderId &&
    (bespokePrompt || !!effectivePromptId) &&
    // A full-catalog grant needs the catalog loaded — never send [] while showing "all".
    (toolChoice !== 'all' || catalog.length > 0) &&
    !busy

  // Live fit warning: the chosen prompt's family vs the chosen provider's.
  const providerFamily = providers.find((p) => p.id === effectiveProviderId)?.modelFamily ?? 'claude'
  const selectedPrompt = prompts.find((p) => p.id === effectivePromptId)
  const warning = selectedPrompt ? promptFitWarning(selectedPrompt, providerFamily) : null
  // Changing either side of the pairing invalidates a prior probe result.
  const onPrompt = (id: string) => { setPromptId(id); setProbe(null) }
  const onProvider = (id: string) => { setProviderId(id); setProbe(null) }
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
    const fields = {
      label: label.trim(),
      providerId: effectiveProviderId,
      // Send the prompt binding only when the picker actually CHANGED (review
      // finding): a bespoke-prompt agent's picker shows '' ("Keep current prompt") —
      // sending a binding on an unrelated edit would silently destroy the merged /
      // forked prompt (a rename would revert v2 → the picked library body).
      ...(effectivePromptId !== (agent?.systemPromptId ?? '') ? { systemPromptId: effectivePromptId } : {}),
      // The tool grant, spelled out (the API's own default is the EMPTY set): sent on
      // create always, on edit only when the user flipped the checkbox — 'keep'
      // preserves a custom subset exactly like the bespoke-prompt guard above.
      ...(toolChoice !== 'keep' ? { tools: toolChoice === 'all' ? catalog : [] } : {}),
      instructions: instructions.trim(),
    }
    try {
      if (agent) await updateAgent(agent.id, fields)
      else await createAgent({ ...fields, systemPromptId: effectivePromptId, tools: grantAll ? catalog : [] })
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
          <span className="mt-1 flex items-center gap-1 text-[11px] text-amber-600">
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
  strong: 'text-emerald-700',
  fair: 'text-amber-600',
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
function ModelsSection({ subview }: { subview: string | null }) {
  const providers = useProviders().data ?? []
  // null = no dialog; 'new' = create; a provider = edit that one.
  const [editing, setEditing] = useState<ModelProvider | 'new' | null>(null)
  // The rail's group node (lib/subviews) classifies by provider kind: the built-in /
  // shared providers (no tenant), the endpoints you register, and delegated Sessions
  // (always tenant-stamped). null = all.
  const shown =
    subview === 'builtin'
      ? providers.filter((p) => !p.tenantId)
      : subview === 'registered'
        ? providers.filter((p) => !!p.tenantId && p.kind !== 'session')
        : subview === 'session'
          ? providers.filter((p) => p.kind === 'session')
          : providers
  return (
    <Page>
      <PageHeader title="Models" />
      <p className="-mt-2 mb-4 text-[13px] leading-relaxed text-ink-soft">
        Every model your sessions can run on. Each entry is a{' '}
        <span className="font-medium text-ink">model provider</span> — the built-in Anthropic
        one, a Messages endpoint you register, or a{' '}
        <span className="font-medium text-ink">Session provider</span> answered by an AI
        session you already run. All of them appear in the composer’s model selector, so a
        model registered here is immediately usable in any conversation.
      </p>
      <div className="space-y-3">
        <TabToolbar newLabel="New provider" onNew={() => setEditing('new')} />
        {shown.length === 0 ? (
          <Empty>No providers in this view.</Empty>
        ) : (
          shown.map((p) => <ProviderCard key={p.id} provider={p} onEdit={() => setEditing(p)} />)
        )}
        {editing && (
          <ProviderDialog provider={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />
        )}
      </div>
    </Page>
  )
}

/** The shared relay badge — a Session provider's transport is *declared, not
 *  discovered* (docs/delegated-cognition-provider.md §4.6), so the same cue rides the
 *  provider card, the create panel, and the secret dialog. Since the v2 framed
 *  mailbox, relayed turns carry the full tool surface: the far session relays tool
 *  calls back unexecuted, and each lands here as the same consent card. */
function RelayBadge() {
  return (
    <span
      title="Your own AI session answers this provider’s turns over a rendezvous relay. Tool calls are relayed through it unexecuted — each proposal still lands here as a consent card."
      className="rounded bg-panel-2 px-1.5 py-0.5 text-[10px] font-medium text-ink-soft"
    >
      Relay
    </span>
  )
}

function ProviderCard({ provider, onEdit }: { provider: ModelProvider; onEdit: () => void }) {
  const [error, setError] = useState<string | null>(null)
  // Rotate mints a fresh rendezvous secret (kill switch) — shown once via the panel.
  const [rotated, setRotated] = useState<CreatedProvider | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const isSession = provider.kind === 'session'
  const del = async () => {
    setError(null)
    try {
      await deleteProvider(provider.id)
    } catch (e) {
      // The server refuses the default / a still-bound provider (409) — show its reason.
      setError(e instanceof Error ? e.message : 'Could not delete this provider.')
    }
  }
  const rotate = async () => {
    setError(null)
    try {
      setRotated(await rotateProvider(provider.id))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not rotate the secret.')
    }
  }
  const refresh = async () => {
    setError(null)
    setRefreshing(true)
    try {
      await refreshProviderModels(provider.id)
    } catch (e) {
      // The endpoint didn't answer a model list (400) — the catalog stays untouched.
      setError(e instanceof Error ? e.message : 'Could not refresh the model catalog.')
    } finally {
      setRefreshing(false)
    }
  }
  return (
    <CommonsCard>
      <CommonsCardHead
        icon={<Cpu size={16} />}
        title={provider.label}
        subtitle={isSession ? 'Session · relay' : provider.modelFamily}
        trailing={
          <div className="flex items-center gap-1.5">
            {provider.isDefault && <DefaultBadge />}
            <CardActions onEdit={onEdit} onDelete={del} />
          </div>
        }
      />
      <div className="mt-2 flex flex-wrap items-center gap-1">
        {isSession && (
          <span className="flex items-center gap-1.5 rounded bg-panel-2 px-1.5 py-0.5 text-[10px] text-ink-faint">
            <span className={`h-1.5 w-1.5 rounded-full ${provider.online ? 'bg-added' : 'bg-ink-faint/50'}`} />
            {provider.online ? 'Session connected' : 'Offline — drain loop not running'}
          </span>
        )}
        {/* The observed serving picture (v5 handshake): what the binding DECLARED
            (the negotiated window) and what it is doing right now — kept live by
            relay.activity events, stamped per read, never a promise. */}
        {isSession && provider.online && typeof provider.conversationWindow === 'number' && (
          <span
            className="rounded bg-panel-2 px-1.5 py-0.5 text-[10px] text-ink-faint"
            title="What this session's binding declared it can serve concurrently — the platform admits no more. The count is live: conversations with a relayed turn in flight right now."
          >
            {provider.activeConversations ? `Answering ${provider.activeConversations} of ` : 'Serves up to '}
            {provider.conversationWindow} conversation{provider.conversationWindow === 1 ? '' : 's'}
          </span>
        )}
        {isSession && <RelayBadge />}
        {provider.effortLevels.map((e) => (
          <span key={e} className="rounded bg-panel-2 px-1.5 py-0.5 text-[10px] text-ink-faint">
            {e}
          </span>
        ))}
      </div>
      {/* The provider's own model catalog (spec MODEL-16) — what the composer's
          Model section lists for it. One chip per model (the configured default
          marked); the source note says how the list was obtained, and a LISTED
          catalog can be re-fetched from the endpoint it came from. A Session
          provider has none (its cognition is whatever session drains it). */}
      {!isSession && (
        <div className="mt-2">
          {(provider.models?.length ?? 0) > 0 && (
            <div className="flex flex-wrap items-center gap-1">
              {provider.models!.map((m) => (
                <span
                  key={m.id}
                  title={modelBlurb(m)}
                  className={`rounded px-1.5 py-0.5 text-[10px] ${
                    m.id === provider.defaultModelId ? 'bg-accent/10 text-ink' : 'bg-panel-2 text-ink-faint'
                  }`}
                >
                  {m.label}
                  {m.id === provider.defaultModelId && <span className="text-ink-faint"> · default</span>}
                </span>
              ))}
            </div>
          )}
          <div className="mt-1.5 flex items-center gap-2 text-[11px] text-ink-faint">
            <span>
              {provider.models?.length
                ? provider.catalogSource === 'listed'
                  ? `${provider.models.length} models, listed from its endpoint`
                  : `${provider.models.length} models, declared at registration`
                : 'No model catalog — turns run its configured model.'}
            </span>
            {provider.catalogSource === 'listed' && (
              <button
                onClick={refresh}
                disabled={refreshing}
                className="inline-flex items-center gap-1 rounded-md border border-line px-1.5 py-0.5 text-[11px] text-ink-soft transition enabled:hover:border-accent enabled:hover:text-ink disabled:opacity-60"
                title="Re-fetch the catalog from the provider’s own model-list API. Session model picks the new list no longer carries are cleared."
              >
                <RefreshCw size={11} />
                {refreshing ? 'Refreshing…' : 'Refresh models'}
              </button>
            )}
          </div>
        </div>
      )}
      {isSession && (
        <div className="mt-2 flex items-center gap-2 text-[12px] text-ink-soft">
          <KeyRound size={12} className="shrink-0 text-ink-faint" />
          {/* The masked fingerprint — the secret itself was shown once at mint and never again. */}
          <span className="font-mono">rv_live_••••{provider.secretHint ?? '????'}</span>
          <button
            onClick={rotate}
            className="ml-1 inline-flex items-center gap-1 rounded-md border border-line px-1.5 py-0.5 text-[11px] text-ink-soft transition hover:border-accent hover:text-ink"
            title="Mint a fresh secret; the old one dies instantly (an in-flight relayed turn falls back)."
          >
            <RefreshCw size={11} />
            Rotate
          </button>
        </div>
      )}
      <p className="mt-2 text-[12px] text-ink-soft">Grants {authorityLabel(provider.authority)}</p>
      <p className="mt-0.5 text-[12px] text-ink-faint">{providerPlanLabel(provider)}</p>
      {error && <p className="mt-2 text-[12px] text-removed">{error}</p>}
      {rotated?.secret && <RelaySecretPanel provider={rotated} secret={rotated.secret} onClose={() => setRotated(null)} />}
    </CommonsCard>
  )
}

/** A copyable one-liner — code scrolls inside its box with the bar itself hidden
 *  (the row stays draggable/scrollable; Copy carries the full text), so stacked
 *  rows don't each grow a grey scrollbar pill. One uniform treatment: the secret
 *  and the two command rows read as one family. */
function CodeRow({
  text,
  ariaLabel,
  className = '',
  onCopied,
}: {
  text: string
  ariaLabel: string
  className?: string
  /** Told when the user takes this row's text (see CopyButton.onCopied). */
  onCopied?: () => void
}) {
  return (
    <div className={`flex items-center gap-2 rounded-lg border border-line bg-panel px-3 py-2 ${className}`}>
      <code className="no-scrollbar min-w-0 flex-1 overflow-x-auto whitespace-nowrap font-mono text-[12px] text-ink">
        {text}
      </code>
      <CopyButton text={text} ariaLabel={ariaLabel} onCopied={onCopied} />
    </div>
  )
}

/** The one-time rendezvous-secret reveal (mint and rotate). The secret is a password —
 *  it exists nowhere but this panel (the server keeps only a hash). Not the shared
 *  FormDialog: this is a reveal, not a form (no Cancel — there is nothing to cancel
 *  back to).
 *
 *  ── Rethought around the JOB, not the artifact ──────────────────────────────
 *  The user isn't here to collect a secret; they're here to bring this provider
 *  ONLINE. Three facts shape the panel:
 *
 *  1. **One artifact: the bootstrap prompt** (`bootstrapPrompt`, spec MODEL-22).
 *     The panel used to walk the user through a harness-specific install (a
 *     Claude-CLI recipe per shell dialect) plus a connect sentence — which
 *     silently excluded every non-Claude harness (Codex, Cursor, opencode, ones
 *     we've never heard of). Now the far AGENT onboards itself: the user pastes
 *     ONE prompt into the session that will do the thinking; it fetches the
 *     agent-facing setup guide (`GET /connector/setup`) and installs the
 *     connector its own way — or drives the relay protocol directly over HTTP.
 *     The prompt carries the secret, and it is the single place the credential
 *     is ever displayed (one credential, one artifact to save).
 *  2. **The panel can prove it worked.** It watches the provider's live `online`
 *     flag while open and flips to a Connected state the moment the far session
 *     latches — the natural end of the job.
 *  3. **The close-gate is observed, never attested.** No "I've saved it"
 *     checkbox — the gate opens on either of two OBSERVED facts: the user copied
 *     the bootstrap prompt (they have the credential), or the relay connected
 *     (the credential demonstrably arrived). Copy IS the save. */
function RelaySecretPanel({ provider, secret, onClose }: { provider: ModelProvider; secret: string; onClose: () => void }) {
  // Taking the line IS saving it — the copy is the act, observed. The old panel asked
  // for the copy AND a checkbox attesting to the copy: a ceremonial second click that
  // proved nothing the first didn't. So the Copy on the connect line satisfies the gate.
  const [tookLine, setTookLine] = useState(false)
  const dialogRef = useRef<HTMLDivElement>(null)
  // Liveness is stamped server-side per read (`relay.online`) with no push channel,
  // so while this panel is open and still waiting, poll the registry. The poll stops
  // the moment it connects (and on unmount) — it never runs in the background.
  const live = useProviders().data?.find((p) => p.id === provider.id)
  const connected = live?.online === true
  useEffect(() => {
    if (connected) return
    const timer = setInterval(() => invalidate(keys.providers), 2000)
    return () => clearInterval(timer)
  }, [connected])
  // Two proofs, no promises: the relay connecting shows the secret reached its
  // destination; short of that, copying the connect line shows the user has it.
  const canClose = connected || tookLine
  const guardedClose = () => canClose && onClose()
  useFocusTrap(dialogRef, guardedClose)
  // The externally dialable relay base: the same-origin `/api/v1` resolved to an
  // absolute URL (an absolute VITE_API_BASE passes through unchanged), so every
  // command below is right in every deploy shape, not just default-port dev.
  const relayUrl = new URL(API_BASE, window.location.origin).href.replace(/\/$/, '')
  // The human-clickable escape hatches for an agent that can't reach the network
  // itself: the agent-facing setup guide (the same document the prompt tells the
  // agent to fetch) and the raw connector download (spec MODEL-14).
  const setupUrl = `${relayUrl}/connector/setup`
  const connectorUrl = `${relayUrl}/connector`
  const prompt = bootstrapPrompt(relayUrl, secret)
  return createPortal(
    <div className="fixed inset-0 z-50 flex justify-center px-4 pt-[14dvh]" onMouseDown={guardedClose} role="dialog" aria-modal="true" aria-label="Connect your session">
      <div className={`${SCRIM_CLASS} backdrop-blur-[1px]`} />
      <div
        ref={dialogRef}
        onMouseDown={(e) => e.stopPropagation()}
        className="relative flex h-fit w-[520px] max-w-full flex-col overflow-hidden rounded-xl bg-surface shadow-2xl ring-1 ring-line-strong"
      >
        <div className="flex items-center gap-2 border-b border-line px-5 py-3.5">
          <KeyRound size={18} className="text-ink-soft" />
          <span className="text-[15px] font-semibold text-ink">Connect your session</span>
          <RelayBadge />
        </div>
        <div className="p-5">
          <p className="text-[15px] font-semibold leading-5 text-ink">Paste into the session that will do the thinking</p>
          <p className="mt-1 text-[12px] leading-relaxed text-ink-soft">
            Works in any agent — it fetches the setup guide and installs itself (MCP), or drives the relay protocol
            directly.
          </p>
          {/* Copying this row IS the save — it satisfies the close-gate (see above). */}
          <CodeRow className="mt-2" text={prompt} ariaLabel="Copy bootstrap prompt" onCopied={() => setTookLine(true)} />
          <p className="mt-1.5 text-[12px] leading-relaxed text-ink-faint">
            <span className="font-semibold text-ink">Shown once</span> — this prompt carries your secret. Use a{' '}
            <span className="font-medium text-ink-soft">dedicated session without dangerous tools</span>: relayed
            prompts are untrusted text. Installing by hand instead? Open the{' '}
            <a href={setupUrl} target="_blank" rel="noreferrer" className="font-medium text-accent hover:underline">
              setup guide
            </a>{' '}
            or{' '}
            <a href={connectorUrl} download="session-relay.mjs" className="font-medium text-accent hover:underline">
              download the connector
            </a>
            .
          </p>
          {connected ? (
            <p className="mt-4 flex items-center gap-2 rounded-lg border border-line bg-added-bg px-3 py-2 text-[12px] font-medium text-added">
              <CheckCircle2 size={14} className="shrink-0" />
              Connected — “{provider.label}” is answering.
            </p>
          ) : (
            <p className="mt-4 flex items-center gap-1.5 text-[11px] text-ink-faint">
              <Spinner size={11} /> Waiting for your session…
            </p>
          )}
        </div>
        <div className="flex shrink-0 items-center justify-between gap-3 border-t border-line bg-panel px-5 py-3">
          {/* The gate names itself only while it's shut — no nagging once it's open. */}
          <span className="text-[12px] text-ink-faint">{canClose ? '' : 'Copy the prompt to continue.'}</span>
          <button
            onClick={onClose}
            disabled={!canClose}
            className="rounded-lg bg-ink px-3.5 py-1.5 text-[13px] font-medium text-canvas shadow-sm transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Done
          </button>
        </div>
      </div>
    </div>,
    document.body,
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
        <Check size={12} className="text-emerald-600" />
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
      onMouseDown={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div className={`${SCRIM_CLASS} backdrop-blur-[1px]`} />
      <div
        ref={dialogRef}
        onMouseDown={(e) => e.stopPropagation()}
        className="relative flex max-h-[80dvh] w-[560px] max-w-full flex-col overflow-hidden rounded-xl bg-surface shadow-2xl ring-1 ring-line-strong"
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
            className="rounded-lg bg-ink px-3.5 py-1.5 text-[13px] font-medium text-canvas shadow-sm transition hover:opacity-90"
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
function ProviderDialog({ provider, onClose }: { provider: ModelProvider | null; onClose: () => void }) {
  const [label, setLabel] = useState(provider?.label ?? '')
  const [family, setFamily] = useState(provider?.modelFamily ?? 'claude')
  const [kind, setKind] = useState<'endpoint' | 'session'>(provider?.kind ?? 'endpoint')
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
  const canSubmit = label.trim().length > 0 && (isSession || family.trim().length > 0) && !busy

  const submit = async () => {
    if (!canSubmit) return
    setBusy(true)
    setError(null)
    const defaultChanged = isDefault !== (provider?.isDefault ?? false)
    try {
      if (provider) {
        await updateProvider(provider.id, {
          label: label.trim(),
          modelFamily: family.trim(),
          ...(defaultChanged ? { isDefault } : {}),
        })
        onClose()
      } else if (isSession) {
        const created = await createProvider({
          label: label.trim(),
          modelFamily: 'claude', // advisory on a session — the far side picks its own model
          effortLevels: ['Low', 'Medium', 'High'],
          kind: 'session',
          ...(isDefault ? { isDefault } : {}),
        })
        setMinted(created) // the one-time reveal takes over; onClose comes from its Done
      } else {
        await createProvider({
          label: label.trim(),
          modelFamily: family.trim(),
          effortLevels: ['Low', 'Medium', 'High'],
          ...(isDefault ? { isDefault } : {}),
        })
        onClose()
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
                  kind === value ? 'bg-surface text-ink shadow-sm ring-1 ring-line-strong' : 'text-ink-faint hover:text-ink-soft'
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
      )}
      <DefaultToggle checked={isDefault} onChange={setIsDefault} entity="provider" />
    </FormDialog>
  )
}

/** System prompts (D10) — the reusable, target-family-tagged prompts an Agent starts
 *  from. Each shows its target family and a downgrade warning when it wouldn't fit the
 *  default-else-first provider's family (the pure `promptFitWarning` against the same
 *  entry the New-agent picker pre-selects). */
function PromptsTab() {
  const prompts = useSystemPrompts().data ?? []
  const providers = useProviders().data ?? []
  const providerFamily = defaultEntry(providers)?.modelFamily ?? 'claude'
  const [editing, setEditing] = useState<SystemPromptEntry | 'new' | null>(null)
  return (
    <div className="space-y-3">
      <TabToolbar newLabel="New prompt" onNew={() => setEditing('new')} />
      {prompts.length === 0 ? (
        <Empty>No system prompts yet.</Empty>
      ) : (
        prompts.map((p) => (
          <LibraryPromptCard key={p.id} prompt={p} providerFamily={providerFamily} onEdit={() => setEditing(p)} />
        ))
      )}
      {editing && <PromptDialog prompt={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </div>
  )
}

function LibraryPromptCard({
  prompt,
  providerFamily,
  onEdit,
}: {
  prompt: SystemPromptEntry
  providerFamily: string
  onEdit: () => void
}) {
  const [error, setError] = useState<string | null>(null)
  const warning = promptFitWarning(prompt, providerFamily)
  const del = async () => {
    setError(null)
    try {
      await deleteSystemPrompt(prompt.id)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not delete this prompt.')
    }
  }
  return (
    <CommonsCard>
      <CommonsCardHead
        icon={<FileText size={16} />}
        title={prompt.label}
        subtitle={`Tuned for ${prompt.targetFamily}`}
        trailing={
          <div className="flex items-center gap-1.5">
            {prompt.isDefault && <DefaultBadge />}
            {warning && (
              <span title={warning} className="shrink-0 text-amber-600">
                <AlertCircle size={15} />
              </span>
            )}
            <CardActions onEdit={onEdit} onDelete={del} />
          </div>
        }
      />
      <p className="mt-2 line-clamp-2 text-[12px] text-ink-soft">{prompt.body}</p>
      {error && <p className="mt-2 text-[12px] text-removed">{error}</p>}
    </CommonsCard>
  )
}

/** Create / edit a library system prompt. The model family drives the D10 fit warning;
 *  the body is the text an Agent built from this entry drives the model with. */
function PromptDialog({ prompt, onClose }: { prompt: SystemPromptEntry | null; onClose: () => void }) {
  const [label, setLabel] = useState(prompt?.label ?? '')
  const [family, setFamily] = useState(prompt?.targetFamily ?? 'claude')
  const [bodyText, setBodyText] = useState(prompt?.body ?? '')
  // The default flag (the UI shortcut) — sent only when changed, like ProviderDialog's.
  const [isDefault, setIsDefault] = useState(prompt?.isDefault ?? false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const canSubmit =
    label.trim().length > 0 && family.trim().length > 0 && bodyText.trim().length > 0 && !busy

  const submit = async () => {
    if (!canSubmit) return
    setBusy(true)
    setError(null)
    const defaultChanged = isDefault !== (prompt?.isDefault ?? false)
    const fields = {
      label: label.trim(),
      targetFamily: family.trim(),
      body: bodyText.trim(),
      ...(defaultChanged ? { isDefault } : {}),
    }
    try {
      if (prompt) await updateSystemPrompt(prompt.id, fields)
      else await createSystemPrompt(fields)
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

/** One project's commissioned Contributors. Fetches the project's open work ONCE here
 *  (not per row) and folds it into a resolvedBy → {count, last} map, so each STANDING
 *  Contributor can show what it actually did HERE (S8) — the per-project track record
 *  that the cross-project Award total (a state word) otherwise misreads as local. */
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
      <div className="mb-2 flex items-center justify-between gap-2">
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
      <CommonsCard>
        <div className="space-y-2.5">
          {list.map((c) => (
            <ContributorRow
              key={c.id}
              commission={c}
              agentLabel={agentsById.get(c.agentId)?.label ?? c.agentLabel ?? c.agentId}
              contributions={agentsById.get(c.agentId)?.contributions}
              resolvedHere={c.standing ? resolvedHere.get(c.id) ?? { count: 0, lastAt: 0 } : undefined}
            />
          ))}
        </div>
      </CommonsCard>
    </div>
  )
}

/** The discovery directory (docs/agent-commons.md, D17) — what other accounts made
 *  public: shared Projects open to Contributors, and published Agent definitions any
 *  account may fork (D18). Deliberately a searchable LIST, not a feed — the directory
 *  never widens visibility (each entry is the row's existing public face), and ranking
 *  is a policy this prototype doesn't take. One debounced-enough search box filters
 *  both directories (substring on name/description, server-side). */
function DiscoverTab({ onOpenAgentPage }: { onOpenAgentPage: (agentId: string) => void }) {
  const rel = useRelations()
  const [q, setQ] = useState('')
  const query = q.trim() || undefined
  const projects = useProjectDirectory(query).data ?? []
  const agents = useAgentDirectory(query).data ?? []
  // Every owner byline is a DOOR to the workspace's profile page (D21) — the one
  // "everything this workspace shares" surface (it subsumed the old filter chip).
  const openOwner = (name: string) => rel.navigate('agents', name)
  return (
    <div className="space-y-6">
      <div className="relative">
        <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search shared projects and published agents…"
          aria-label="Search the directory"
          className={`${FORM_INPUT_CLASS} pl-8`}
        />
      </div>

      <div>
        <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
          Shared projects
        </div>
        {projects.length === 0 ? (
          <Empty>No shared projects{query ? ' match' : ' yet — share one from its project page'}.</Empty>
        ) : (
          <div className="space-y-3">
            {projects.map((p) => (
              <SharedProjectCard
                key={p.id}
                entry={p}
                onOpen={() => rel.navigate('projects', p.id)}
                onOwnerClick={() => openOwner(p.owner)}
              />
            ))}
          </div>
        )}
      </div>

      <div>
        <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
          Published agents
        </div>
        {agents.length === 0 ? (
          <Empty>No published agents{query ? ' match' : ' yet — publish one from the Agents tab'}.</Empty>
        ) : (
          <div className="space-y-3">
            {agents.map((a) => (
              <PublishedAgentCard
                key={a.id}
                entry={a}
                onView={() => onOpenAgentPage(a.id)}
                onOwnerClick={() => openOwner(a.owner)}
              />
            ))}
          </div>
        )}
      </div>

      <ImportAgentCardForm />
    </div>
  )
}

/** One shared Project in the commons — the D17 directory face. Rendered identically
 *  on the Discover tab and a workspace profile (form follows function: same role,
 *  one card). The card is a DOOR: the shared project page (one page, owner and
 *  visitor alike) is where joining happens; the byline is a door to the owner. */
function SharedProjectCard({
  entry: p,
  onOpen,
  onOwnerClick,
}: {
  entry: ProjectDirectoryEntry
  onOpen: () => void
  onOwnerClick: () => void
}) {
  return (
    <CommonsCard>
      <CommonsCardHead
        icon={<SquareKanban size={16} />}
        title={p.name}
        onOpen={onOpen}
        subtitle={
          <>
            <OwnerLink ownerName={p.owner} own={p.own} onClick={onOwnerClick} />
            {` · updated ${relativeTime(p.updatedAt)}`}
          </>
        }
        trailing={
          p.openWorkCount > 0 ? (
            <span
              title={`${p.openWorkCount} open work item${p.openWorkCount === 1 ? '' : 's'} awaiting a taker`}
              className="shrink-0 rounded-full bg-amber-500/10 px-2 py-px text-[11px] font-medium text-amber-700"
            >
              {p.openWorkCount} open
            </span>
          ) : undefined
        }
      />
      {p.description && <p className="mt-2 text-[12px] text-ink-soft">{p.description}</p>}
      <p className="mt-1.5 flex items-center gap-3 text-[11px] text-ink-faint">
        <span>
          {p.contributorCount} contributor{p.contributorCount === 1 ? '' : 's'}
          {p.guarded ? ' · coordinated (guardian)' : ''}
        </span>
        <button onClick={onOpen} className={INLINE_ACTION_CLASS}>
          Open project
        </button>
      </p>
    </CommonsCard>
  )
}

/** ── The workspace profile page (docs/agent-commons.md, D21) ─────────────────
 *  A display name's ONE public face — the GitHub-user-page analog: everything the
 *  workspace shares (projects, agents), its public track record, and its recent
 *  public acts. Served viewer-independent except the own-marker cue (minted by
 *  profileTitle, never inline): the owner sees this page exactly as visitors do,
 *  which is the point. Reached from any owner byline (directory cards, a shared
 *  project's header, a search hit). */
/** FWD-6 O3 — the org page's MEMBER panel: visible only to seats (the profile's
 *  viewer-relative `org` field). Everyone inside sees the roster; the OWNER also
 *  manages invitations (invite by email — existence-hidden server-side — and
 *  revoke pending ones). Everything public on this page stays identical for
 *  every viewer; this panel is the capability-gated affordance (COMMONS-13). */
function OrgMemberPanel({ org }: { org: NonNullable<OwnerProfile['org']> }) {
  const members = useOrgMembers(org.id).data ?? []
  const isOwner = org.role === 'owner'
  const invites = useOrgInvites(org.id, isOwner).data ?? []
  const [email, setEmail] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const invite = async () => {
    if (busy || !email.trim()) return // the guard also blocks a double-fire (Enter + click)
    setBusy(true)
    setError('')
    try {
      const r = await inviteToOrg(org.id, email.trim())
      if (r.ok) setEmail('')
      else setError(r.message)
    } finally {
      setBusy(false)
    }
  }
  // A revoke can race the invitee's accept — the result-object reports it in the
  // same message slot the invite path uses (the hook re-read the ledger already).
  const revoke = async (inviteId: string) => {
    if (busy) return
    setBusy(true)
    try {
      const r = await revokeOrgInvite(org.id, inviteId)
      setError(r.ok ? '' : r.message)
    } finally {
      setBusy(false)
    }
  }
  const pending = invites.filter((i) => i.status === 'invited')
  return (
    <div data-testid="org-member-panel" className="rounded-lg border border-line bg-panel p-3">
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
              {pending.map((i) => (
                <li key={i.id} className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate">{i.email}</span>
                  <button
                    onClick={() => void revoke(i.id)}
                    className={INLINE_ACTION_CLASS}
                    title="Withdraw this pending invitation"
                  >
                    Revoke
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="flex items-center gap-1.5">
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && !e.nativeEvent.isComposing && void invite()}
              placeholder="Invite by email…"
              aria-label="Invite by email"
              className={`${FORM_INPUT_CLASS} flex-1`}
            />
            <button onClick={() => void invite()} disabled={busy || !email.trim()} className={INLINE_ACTION_CLASS}>
              Invite
            </button>
          </div>
          {error && <p className="mt-1 text-[11px] text-removed">{error}</p>}
        </div>
      )}
    </div>
  )
}

function OwnerProfilePage({
  name,
  onOpenProject,
  onOpenAgentPage,
  onBack,
  backTo,
}: {
  name: string
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
  if (!profile) {
    return (
      <Page>
        <div className="mb-4">
          <BackButton to={backTo} onBack={onBack} />
        </div>
        {state.error ? (
          // The 404 face: a workspace that shares nothing is indistinguishable
          // from one that doesn't exist (existence-hiding, D21).
          <Empty>“{name}” shares nothing publicly — or doesn’t exist.</Empty>
        ) : null}
      </Page>
    )
  }
  const s = profile.stats
  return (
    <Page>
      <header className={PAGE_HEADER_CLASS}>
        <div className="flex min-w-0 items-start gap-3.5">
        <BackButton to={backTo} onBack={onBack} />
        {/* The identity mark at page scale — the same derived mark every byline
            wears (identity texture; the Globe stays the SHARED-entity cue). */}
        <WorkspaceMark name={profile.name} size={48} />
        <div className="min-w-0">
          <h1 className={PAGE_TITLE_CLASS}>
            {profileTitle(profile.name, profile.own)}
          </h1>
          <p className="mt-0.5 text-[13px] text-ink-soft">{PROFILE_TAGLINE}</p>
          <p className="mt-2 flex flex-wrap items-center gap-3 text-[11px] text-ink-faint">
            {/* The aggregate counts sum this workspace's agents — the door lands on
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
              <span title="Open work items awaiting a taker across this workspace's shared projects">
                {s.openWork} open work item{s.openWork === 1 ? '' : 's'}
              </span>
            )}
          </p>
        </div>
        </div>
      </header>

      <div className="space-y-6">
        {profile.org && <OrgMemberPanel org={profile.org} />}
        <div>
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
            Shared projects
          </div>
          {profile.projects.length === 0 ? (
            <Empty>No shared projects.</Empty>
          ) : (
            <div className="space-y-3">
              {profile.projects.map((p) => (
                <SharedProjectCard
                  key={p.id}
                  entry={p}
                  onOpen={() => onOpenProject(p.id)}
                  onOwnerClick={() => rel.navigate('agents', p.owner)}
                />
              ))}
            </div>
          )}
        </div>

        <div ref={agentsBandRef}>
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
            Published agents
          </div>
          {profile.agents.length === 0 ? (
            <Empty>No published agents.</Empty>
          ) : (
            <div className="space-y-3">
              {profile.agents.map((a) => (
                <PublishedAgentCard
                  key={a.id}
                  entry={a}
                  onView={() => onOpenAgentPage(a.id)}
                  onOwnerClick={() => rel.navigate('agents', a.owner)}
                />
              ))}
            </div>
          )}
        </div>

        <div>
          <div className="mb-2 flex items-baseline gap-2 text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
            <span>Recent public activity</span>
            <span className="font-normal normal-case tracking-normal">
              {s.workPosted} posted · {s.workResolved} resolved
            </span>
          </div>
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
                          onClick={() => rel.navigate('agents', a.owner!)}
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
        </div>
      </div>

    </Page>
  )
}

/** The outbound A2A half (docs/a2a-integration.md, D20): paste a remote instance's
 *  Agent Card URL and the server fetches it into a private, UNBOUND definition-stub
 *  agent with `importedFrom` lineage — fork-across-instances, and like a fork the
 *  capability never travels: you bind your own model, authority, and budget. */
function ImportAgentCardForm() {
  const [url, setUrl] = useState('')
  const [busy, setBusy] = useState(false)
  const [imported, setImported] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const importCard = async () => {
    if (busy || !url.trim()) return
    setBusy(true)
    setError(null)
    setImported(null)
    try {
      const agent = await importAgentCard(url.trim())
      setImported(agent.label)
      setUrl('')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not import this Agent Card.')
    } finally {
      setBusy(false)
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
          onKeyDown={(e) => e.key === 'Enter' && importCard()}
          placeholder="A2A Agent Card URL (…/a2a/agents/{id}/card)…"
          aria-label="Agent Card URL"
          className="min-w-0 flex-1 rounded-lg border border-line bg-surface px-2 py-1 text-[12px] text-ink outline-none placeholder:text-ink-faint focus:border-line-strong"
        />
        <button
          onClick={importCard}
          disabled={busy || !url.trim()}
          className="shrink-0 rounded-lg bg-accent px-2.5 py-1 text-[12px] font-medium text-white transition enabled:hover:bg-accent/90 disabled:opacity-45"
        >
          Import
        </button>
      </div>
      <p className="mt-1.5 text-[11px] text-ink-faint">
        The card&rsquo;s definition becomes a private agent with lineage — capability never travels:
        you bind your own model, authority, and budget.
      </p>
      {imported && (
        <p className="mt-1 text-[12px] text-emerald-700">
          Imported &ldquo;{imported}&rdquo; — find it in the Agents tab.
        </p>
      )}
      {error && <p className="mt-1 text-[12px] text-removed">{error}</p>}
    </div>
  )
}

/** One published Agent in the directory — the D18 public face: the definition (prompt /
 *  tools / instructions) and the public track record, with the FORK act inline. What is
 *  deliberately absent is any capability: authority, budget, and provider binding never
 *  ride a directory entry, so there is nothing here to leak. */
function PublishedAgentCard({
  entry,
  onView,
  onOwnerClick,
}: {
  entry: AgentDirectoryEntry
  onView: () => void
  onOwnerClick: () => void
}) {
  const [busy, setBusy] = useState(false)
  const [forked, setForked] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fork = async () => {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      await forkAgent(entry.id)
      setForked(true)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not fork this agent.')
    } finally {
      setBusy(false)
    }
  }
  return (
    <CommonsCard>
      <CommonsCardHead
        icon={<Bot size={16} />}
        title={entry.label}
        onOpen={onView}
        subtitle={
          <>
            <OwnerLink ownerName={entry.owner} own={entry.own} onClick={onOwnerClick} />
            {` · ${entry.tools.length} tool${entry.tools.length === 1 ? '' : 's'}`}
          </>
        }
        trailing={
          <button
            onClick={fork}
            disabled={busy || forked}
            className={`inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-line px-2.5 py-1 text-[12px] font-medium transition ${
              forked ? 'text-emerald-700' : 'text-ink-soft hover:border-line-strong hover:text-ink'
            } disabled:cursor-default`}
          >
            <GitFork size={13} /> {forked ? 'Forked ✓' : 'Fork'}
          </button>
        }
      />
      <p className="mt-2 line-clamp-2 text-[12px] text-ink-soft" title={entry.systemPrompt}>
        {entry.systemPrompt}
      </p>
      <p className="mt-1.5 flex items-center gap-3 text-[11px] text-ink-faint">
        {/* On a card the counts are doors to the PAGE (where their lineage sections
            live) — the "42 stars → stargazers" shape, one hop shallower. */}
        <CreditLine contributions={entry.contributions} forks={entry.forks} onContributions={onView} onForks={onView} />
        {/* The card is a DOOR: the full public definition (and the A2A card link) lives
            one click in, like a repo page behind a search result. */}
        <button onClick={onView} className={INLINE_ACTION_CLASS}>
          View definition
        </button>
      </p>
      {error && <p className="mt-2 text-[12px] text-removed">{error}</p>}
    </CommonsCard>
  )
}

/** The public PAGE of a published Agent (COMMONS-26) — the repo-page analog behind
 *  every directory card, replacing the old detail dialog (a published definition is
 *  a versioned lifecycle entity — versions, changelog, proposals, forks — and the
 *  surface-from-nature rule gives that a page, not a modal): the FULL definition
 *  (prompt / instructions / tools — exactly the D18 public face, nothing more), the
 *  changelog, the public track record, and the doors out — Fork (the human act),
 *  the A2A card (the same fact, machine-readable — D20), Propose a change (the
 *  fork's inverse, in a dialog: a transient act). One page for every viewer;
 *  what is structurally absent mirrors the wire (no authority, budget, provider).
 *  Addressable at /agents/:id (ADAPT-15); a proposal.* bell for the PROPOSER lands
 *  here with their proposal focused (the pending-focus consumption, R5b). */
function AgentPublicPage({
  agentId,
  onOpenAgent,
  onBack,
  backTo,
}: {
  agentId: string
  /** Door to ANOTHER definition's page (a public fork row) — the same opener the
   *  directory cards use, so lineage hops stay on canonical pages. */
  onOpenAgent: (agentId: string) => void
  onBack: () => void
  backTo: NavLocation | null
}) {
  const rel = useRelations()
  const entries = useAgentDirectory(undefined)
  // S18 — the header counts are doors to their lineage SECTIONS on this page
  // (contributions → resolved work, forks → public forks): same-page anchors.
  const resolvedRef = useRef<HTMLDivElement>(null)
  const forksRef = useRef<HTMLDivElement>(null)
  const scrollTo = (ref: { current: HTMLDivElement | null }) =>
    ref.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  const entry = (entries.data ?? []).find((e) => e.id === agentId) ?? null
  const [busy, setBusy] = useState(false)
  const [forked, setForked] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [proposing, setProposing] = useState(false)
  const [showCard, setShowCard] = useState(false)
  // R5b — a proposal bell landed here: focus that proposal in "Your proposals".
  const [proposalFocus, setProposalFocus] = useState<string | null>(null)
  const { pending, consume } = usePendingFocus()
  useEffect(() => {
    if (!entry || pending?.agentId !== entry.id || !pending?.proposalId) return
    setProposalFocus(pending.proposalId)
    consume()
  }, [pending, entry, consume])

  if (!entry) {
    return (
      <Page>
        <div className="mb-4">
          <BackButton to={backTo} onBack={onBack} />
        </div>
        {entries.data ? (
          // The 404 face: an unpublished definition is indistinguishable from one
          // that never existed (existence-hiding, D18).
          <Empty>This definition isn’t in the directory — unpublished, or it never existed.</Empty>
        ) : null}
      </Page>
    )
  }

  const fork = async () => {
    if (busy || forked) return
    setBusy(true)
    setError(null)
    try {
      await forkAgent(entry.id)
      setForked(true)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not fork this agent.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Page>
      <div className="mx-auto w-full max-w-2xl">
        <header className={PAGE_HEADER_CLASS}>
          <div className="flex min-w-0 flex-1 items-start gap-3.5">
          <BackButton to={backTo} onBack={onBack} />
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-panel-2 text-ink-soft">
            <Bot size={22} />
          </div>
          <div className="min-w-0 flex-1">
            <h1 className={PAGE_TITLE_CLASS}>{entry.label}</h1>
            <p className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[12px] text-ink-faint">
              <span className="inline-flex items-center gap-1">
                <OwnerLink ownerName={entry.owner} own={entry.own} onClick={() => rel.navigate('agents', entry.owner)} />
                {' '}· v{entry.version}
              </span>
              <CreditLine
                contributions={entry.contributions}
                forks={entry.forks}
                onContributions={() => scrollTo(resolvedRef)}
                onForks={() => scrollTo(forksRef)}
              />
            </p>
          </div>
          </div>
          <button
            onClick={fork}
            disabled={busy || forked}
            title="Forking copies the definition — you grant your own model & authority."
            className={`inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-[13px] font-medium transition ${
              forked ? 'text-emerald-700' : 'text-ink-soft hover:border-line-strong hover:text-ink'
            } disabled:cursor-default`}
          >
            <GitFork size={14} /> {forked ? 'Forked ✓' : 'Fork'}
          </button>
        </header>

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
                entry.tools.map((t) => (
                  <span key={t} className="rounded-md bg-panel-2 px-1.5 py-0.5 text-[11px] text-ink-soft">
                    {t}
                  </span>
                ))
              )}
            </div>
          </FormField>
          {(entry.changelog?.length ?? 0) > 0 && (
            <FormField label={`Changelog (${entry.changelog!.length})`}>
              <ChangelogList changelog={entry.changelog!} />
            </FormField>
          )}
          <p className="flex items-center gap-3 text-[11px] text-ink-faint">
            <button
              onClick={() => setShowCard(true)}
              className={INLINE_ACTION_CLASS}
              title="This definition as a machine-readable A2A Agent Card — hand the URL to a foreign agent framework"
            >
              A2A card
            </button>
            {/* D25 — the fork's inverse: send an improvement BACK to the owner. */}
            <button onClick={() => setProposing(true)} className={INLINE_ACTION_CLASS}>
              Propose a change
            </button>
          </p>
          {/* S10/S18 — the acts behind the contribution count (P8-redacted to shared
              projects), each row a door to the item's own page; then the public
              forks behind the fork count. The header counts anchor here. */}
          <div ref={resolvedRef}>
            <AgentResolvedWork agentId={entry.id} totalContributions={entry.contributions} />
          </div>
          <div ref={forksRef}>
            <AgentPublicForks agentId={entry.id} totalForks={entry.forks} onOpenAgent={onOpenAgent} />
          </div>
          {/* D27 — the proposer's end of the conversation: their proposals against this
              definition (status, the owner's note, the thread). The owner sees all of
              them here too — the same rows their review dialog resolves. */}
          <YourProposals entry={entry} focusProposalId={proposalFocus} />
          {error && <p className="text-[12px] text-removed">{error}</p>}
        </div>
      </div>
      {showCard && (
        <A2aCardDialog
          url={a2aAgentCardUrl(entry.id)}
          title={`A2A card — ${entry.label}`}
          onClose={() => setShowCard(false)}
        />
      )}
      {proposing && <ProposeChangeDialog entry={entry} onBack={() => setProposing(false)} onClose={() => setProposing(false)} />}
    </Page>
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
    <FormField label={`Your proposals (${mine.length})`}>
      <div className="space-y-2">
        {mine.map((p) => {
          const isFocus = p.id === focusProposalId
          return (
          <div
            key={p.id}
            ref={isFocus ? focusRef : undefined}
            className={`scroll-mt-4 rounded-lg border p-2 transition-colors ${
              isFocus ? 'border-accent bg-accent-tint ring-1 ring-accent/40' : 'border-line'
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
            {p.responseNote && <p className="mt-1 text-[11px] text-ink-faint">Owner’s note: {p.responseNote}</p>}
            <ProposalThread agentId={entry.id} proposal={p} openForComments={p.status === 'open'} />
          </div>
          )
        })}
      </div>
    </FormField>
  )
}

/** D25 — open a change proposal against a published definition (the PR analog).
 *  FULL-FIELD: the form starts from the current definition; what you submit is the
 *  proposed replacement, reviewed by the owner as a side-by-side. Only definition
 *  fields exist here — capability is unrepresentable (the D18 wall). */
function ProposeChangeDialog({
  entry,
  onBack,
  onClose,
}: {
  entry: AgentDirectoryEntry
  onBack: () => void
  onClose: () => void
}) {
  const rel = useRelations()
  const [prompt, setPrompt] = useState(entry.systemPrompt)
  const [instructions, setInstructions] = useState(entry.instructions)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // A CLEARED prompt is "keep the current one", not a change (review finding: the
  // server drops an empty prompt, so counting it as a change either opened a
  // proposal that didn't say what was meant, or 400'd a form that said it had
  // changes). Proposals replace, they never erase.
  const promptChanged = prompt.trim() !== '' && prompt.trim() !== entry.systemPrompt
  const instructionsChanged = instructions.trim() !== entry.instructions
  const changed = promptChanged || instructionsChanged
  const submit = async () => {
    if (busy || !changed) return
    setBusy(true)
    setError(null)
    try {
      await proposeAgentChange(entry.id, {
        fields: {
          ...(promptChanged ? { systemPrompt: prompt } : {}),
          ...(instructionsChanged ? { instructions } : {}),
        },
        note,
      })
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not open this proposal.')
      setBusy(false)
    }
  }
  return (
    <FormDialog
      title={`Propose a change — ${entry.label}`}
      icon={<Bot size={18} />}
      submitLabel="Open proposal"
      canSubmit={!busy && changed}
      onSubmit={submit}
      onClose={onClose}
      error={error}
    >
      <p className="text-[12px] text-ink-faint">
        Against v{entry.version}{' '}
        <OwnerLink
          ownerName={entry.owner}
          own={entry.own}
          onClick={() => {
            onClose()
            rel.navigate('agents', entry.owner)
          }}
        />{' '}
        — the owner reviews and merges or declines.{' '}
        <button onClick={onBack} className={INLINE_ACTION_CLASS}>
          Back to the definition
        </button>
      </p>
      <FormField label="System prompt">
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          rows={6}
          aria-label="Proposed system prompt"
          className={`${FORM_INPUT_CLASS} resize-none font-mono text-[12px] leading-relaxed`}
        />
      </FormField>
      <FormField label="Instructions" optional>
        <textarea
          value={instructions}
          onChange={(e) => setInstructions(e.target.value)}
          rows={3}
          aria-label="Proposed instructions"
          className={`${FORM_INPUT_CLASS} resize-none leading-relaxed`}
        />
      </FormField>
      <FormField label="Why this change" optional>
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="e.g. tightens the intro, drops the filler"
          aria-label="Proposal note"
          className={FORM_INPUT_CLASS}
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
            <CommonsCard>
              <div className="divide-y divide-ink/5">
                {shown.map((e) => (
                  <AuditEntryRow key={e.id} entry={e} actor={labelFor(e.actorAgentId) ?? e.commissionId} />
                ))}
              </div>
            </CommonsCard>
          )}
        </>
      )}
    </div>
  )
}

function AuditEntryRow({ entry, actor }: { entry: AuditEntry; actor?: string }) {
  const denied = entry.outcome === 'denied'
  return (
    <div className="flex items-center gap-2.5 py-2 first:pt-0 last:pb-0">
      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${denied ? 'bg-removed' : 'bg-emerald-500'}`} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="shrink-0 rounded-full bg-ink/5 px-1.5 py-px text-[10px] font-medium uppercase tracking-wide text-ink-soft">
            {AUDIT_CHANNEL_LABEL[entry.channel]}
          </span>
          <span className={`shrink-0 text-[11px] font-medium ${denied ? 'text-removed' : 'text-emerald-700'}`}>
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
  return (
    <div className="flex-1 overflow-y-auto @container">
      <div className="mx-auto w-full max-w-3xl px-6 py-6">
        <PageHeader title={meta.label} subtitle={meta.subtitle} />
        {!granted ? (
          <Empty>
            This console is for instance maintainers. Sign in as an account on the server’s
            MAINTAINERS allowlist to use it.
          </Empty>
        ) : subview === 'orgs' ? (
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
      </div>
    </div>
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
  const [error, setError] = useState<string | null>(null)
  const act = async (run: () => Promise<{ ok: true } | { ok: false; message: string }>) => {
    setError(null)
    const out = await run()
    if (!out.ok) setError(out.message)
  }
  return (
    <Page>
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
              <h1 className={`${PAGE_TITLE_CLASS} truncate`}>{row ? row.user.name : 'Account'}</h1>
              {row?.seeded && <AdminBadge>Seeded</AdminBadge>}
              {row?.deactivated && <AdminBadge tone="danger">Deactivated</AdminBadge>}
            </div>
            <p className="mt-1 text-sm text-ink-soft">
              {row?.user.email ?? 'no credential'} · <span className="font-mono text-[12px]">{userId}</span>
            </p>
          </div>
        </div>
      </header>
      {!row ? (
        <Empty>{usersQ.error ? 'The account read failed — are you still on the maintainer allowlist?' : 'Loading account…'}</Empty>
      ) : (
        <div className="space-y-5">
          {error && <p className="text-[12px] text-removed">{error}</p>}
          <div>
            <h2 className="mb-2 text-[13px] font-semibold text-ink">Namespace</h2>
            <CommonsCard>
              {row.homeTenant ? (
                <div className="flex items-center gap-2.5">
                  <span className="min-w-0 flex-1 truncate text-[13px] text-ink">{row.homeTenant.name}</span>
                  <AdminBadge>{row.homeTenant.kind}</AdminBadge>
                  <span className="shrink-0 font-mono text-[11px] text-ink-faint">{row.homeTenant.id}</span>
                </div>
              ) : (
                <p className="text-[13px] text-ink-faint">No home namespace (a dangling membership).</p>
              )}
            </CommonsCard>
          </div>
          <div>
            <h2 className="mb-2 text-[13px] font-semibold text-ink">Organization seats</h2>
            {row.orgSeats.length === 0 ? (
              <Empty>No org seats beyond the home namespace.</Empty>
            ) : (
              <CommonsCard>
                <div className="divide-y divide-ink/5">
                  {row.orgSeats.map((s) => (
                    <div key={s.tenant.id} className="flex items-center gap-2.5 py-2 first:pt-0 last:pb-0">
                      <span className="min-w-0 flex-1 truncate text-[13px] text-ink">{s.tenant.name}</span>
                      <AdminBadge>{s.role}</AdminBadge>
                      <span className="shrink-0 font-mono text-[11px] text-ink-faint">{s.tenant.id}</span>
                    </div>
                  ))}
                </div>
              </CommonsCard>
            )}
          </div>
          <div>
            <h2 className="mb-2 text-[13px] font-semibold text-ink">Bearer tokens</h2>
            {tokens.length === 0 ? (
              <Empty>No bearer tokens on this account.</Empty>
            ) : (
              <CommonsCard>
                <div className="divide-y divide-ink/5">
                  {tokens.map((t) => (
                    <div key={t.id} className="flex items-center gap-2.5 py-2 first:pt-0 last:pb-0">
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[13px] text-ink">{t.label ?? 'Unlabeled token'}</div>
                        <div className="truncate text-[11px] text-ink-faint">
                          minted {relativeTime(t.createdAt)} · <span className="font-mono">{t.id}</span>
                        </div>
                      </div>
                      <AdminConfirmAction
                        label="Revoke"
                        confirmLabel="Revoke token"
                        onConfirm={() => void act(() => adminRevokeToken(userId, t.id))}
                      />
                    </div>
                  ))}
                </div>
              </CommonsCard>
            )}
          </div>
          {!row.seeded && !row.deactivated && (
            <div>
              <h2 className="mb-2 text-[13px] font-semibold text-ink">Danger zone</h2>
              <CommonsCard>
                <div className="flex items-center gap-2.5">
                  <p className="min-w-0 flex-1 text-[12px] leading-relaxed text-ink-soft">
                    Deactivating disables sign-in and revokes every bearer token. No data is deleted.
                  </p>
                  <AdminConfirmAction
                    label="Deactivate"
                    confirmLabel="Deactivate account"
                    onConfirm={() => void act(() => adminDeactivateUser(userId))}
                  />
                </div>
              </CommonsCard>
            </div>
          )}
        </div>
      )}
    </Page>
  )
}

/** The two-step inline confirm every destructive console act wears (the
 *  Composer chip-remove shape): first click arms, Cancel disarms — no new
 *  dialog primitive for a transient act. */
function AdminConfirmAction({
  label,
  confirmLabel,
  onConfirm,
}: {
  label: string
  confirmLabel: string
  onConfirm: () => void
}) {
  const [armed, setArmed] = useState(false)
  if (!armed) {
    return (
      <button
        onClick={() => setArmed(true)}
        className="shrink-0 rounded-md border border-line px-2 py-0.5 text-[11px] font-medium text-ink-soft transition hover:border-removed hover:text-removed"
      >
        {label}
      </button>
    )
  }
  return (
    <span className="flex shrink-0 items-center gap-1.5">
      <button
        onClick={() => {
          setArmed(false)
          onConfirm()
        }}
        className="rounded-md bg-removed px-2 py-0.5 text-[11px] font-medium text-canvas transition hover:opacity-90"
      >
        {confirmLabel}
      </button>
      <button
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
        <CommonsCard>
          <div className="divide-y divide-ink/5">
            {users.map((u) => (
              <AdminUserRowView key={u.user.id} row={u} onOpen={() => rel.navigate('admin', u.user.id)} />
            ))}
          </div>
        </CommonsCard>
      )}
      <div>
        <h2 className="mb-2 text-[13px] font-semibold text-ink">Tenants</h2>
        <CommonsCard>
          <div className="divide-y divide-ink/5">
            {tenants.map((t) => (
              <AdminTenantRowView key={t.tenant.id} row={t} users={users} />
            ))}
          </div>
        </CommonsCard>
      </div>
    </div>
  )
}

function AdminUserRowView({ row, onOpen }: { row: AdminUserRow; onOpen: () => void }) {
  return (
    <div className="flex items-center gap-2.5 py-2 first:pt-0 last:pb-0">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          {/* Title-as-door (the titles-are-doors rule): the name opens the
              account's own page; the row's acts live there now. */}
          <button onClick={onOpen} className="truncate text-[13px] font-medium text-ink hover:underline">
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
      <button
        onClick={onOpen}
        aria-label={`Open ${row.user.name}`}
        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-ink-faint transition hover:bg-panel-2 hover:text-ink"
      >
        <ChevronRight size={14} />
      </button>
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
    <div className="py-2 first:pt-0 last:pb-0">
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
  const [error, setError] = useState<string | null>(null)
  // TRUE orgs only: an org-kind tenant that is somebody's namespace (the Acme
  // seed world) is not an organization — the `namespace` fact discriminates —
  // and a seatless legacy tenant (a pre-collapse snapshot echo) has no roster
  // to show.
  const orgs = tenants.filter((t) => t.tenant.kind === 'org' && !t.namespace && t.members > 0)
  const membersOf = (orgId: string) =>
    users.flatMap((u) => u.orgSeats.filter((s) => s.tenant.id === orgId).map((s) => ({ user: u.user, role: s.role })))
  const revoke = async (id: string) => {
    setError(null)
    const out = await adminRevokeInvite(id)
    if (!out.ok) setError(out.message)
  }
  return (
    <div className="space-y-5">
      {error && <p className="text-[12px] text-removed">{error}</p>}
      {orgs.length === 0 ? (
        <Empty>No organizations founded yet.</Empty>
      ) : (
        orgs.map((o) => (
          <div key={o.tenant.id}>
            <h2 className="mb-2 text-[13px] font-semibold text-ink">{o.tenant.name}</h2>
            <CommonsCard>
              <div className="divide-y divide-ink/5">
                {membersOf(o.tenant.id).map((m) => (
                  <div key={m.user.id} className="flex items-center gap-2.5 py-2 first:pt-0 last:pb-0">
                    <span className="min-w-0 flex-1 truncate text-[13px] text-ink">{m.user.name}</span>
                    <AdminBadge>{m.role}</AdminBadge>
                  </div>
                ))}
              </div>
            </CommonsCard>
          </div>
        ))
      )}
      <div>
        <h2 className="mb-2 text-[13px] font-semibold text-ink">Invitations</h2>
        {invites.length === 0 ? (
          <Empty>No invitations yet.</Empty>
        ) : (
          <CommonsCard>
            <div className="divide-y divide-ink/5">
              {invites.map((i) => (
                <AdminInviteRowView key={i.id} row={i} onRevoke={() => revoke(i.id)} />
              ))}
            </div>
          </CommonsCard>
        )}
      </div>
    </div>
  )
}

function AdminInviteRowView({ row, onRevoke }: { row: AdminInviteRow; onRevoke: () => void }) {
  return (
    <div className="flex items-center gap-2.5 py-2 first:pt-0 last:pb-0">
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
        <AdminConfirmAction label="Revoke" confirmLabel="Revoke invite" onConfirm={onRevoke} />
      )}
    </div>
  )
}

/** Credentials — every user's bearer-token registry rows (metadata only), with
 *  instance-side revocation. Peer + provider secrets keep their own surfaces. */
function AdminCredentialsPanel() {
  const tokens = useAdminTokens(true).data ?? []
  const [error, setError] = useState<string | null>(null)
  const revoke = async (row: AdminTokenRow) => {
    setError(null)
    const out = await adminRevokeToken(row.userId, row.id)
    if (!out.ok) setError(out.message)
  }
  return (
    <div className="space-y-3">
      <p className="text-[12px] leading-relaxed text-ink-soft">
        Minted bearer tokens across every account — <span className="font-medium text-ink">metadata only</span>
        {' '}(the value is shown once, at mint). Revoking a row kills the credential immediately. A2A peer
        credentials and relay rendezvous secrets are administered on their own surfaces (Agents and Models).
      </p>
      {error && <p className="text-[12px] text-removed">{error}</p>}
      {tokens.length === 0 ? (
        <Empty>No bearer tokens minted on this instance.</Empty>
      ) : (
        <CommonsCard>
          <div className="divide-y divide-ink/5">
            {tokens.map((t) => (
              <div key={`${t.userId}:${t.id}`} className="flex items-center gap-2.5 py-2 first:pt-0 last:pb-0">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px] text-ink">{t.label ?? 'Unlabeled token'}</div>
                  <div className="truncate text-[11px] text-ink-faint">
                    {t.userName} · minted {relativeTime(t.createdAt)}
                  </div>
                </div>
                <AdminConfirmAction label="Revoke" confirmLabel="Revoke token" onConfirm={() => revoke(t)} />
              </div>
            ))}
          </div>
        </CommonsCard>
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
        <CommonsCard>
          <div className="divide-y divide-ink/5">
            {entries.map((e) => (
              <AdminAuditRowView key={e.id} entry={e} />
            ))}
          </div>
        </CommonsCard>
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
    // The divide-y list rhythm lives HERE: the embedded AuditEntryRow is this
    // wrapper's sole child, so its own `py-2 first:pt-0 last:pb-0` rhythm
    // self-neutralizes (both variants match) — without the wrapper's padding
    // every row would sit flush against the hairlines.
    <div className="py-2 first:pt-0 last:pb-0">
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
          <CommonsCard key={t.label}>
            <div className="text-[11px] font-medium uppercase tracking-wide text-ink-faint">{t.label}</div>
            <div className="mt-1 text-[13px] font-medium text-ink">{t.value}</div>
          </CommonsCard>
        ))}
      </div>
    </div>
  )
}

function GenericSection({ section }: { section: SectionId }) {
  const meta = SECTION_META[section]
  const [creating, setCreating] = useState(false)
  return (
    <div className="flex-1 overflow-y-auto">
      <div className="mx-auto w-full max-w-3xl px-6 py-6">
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
            <PrimaryButton icon={<Plus size={15} />} onClick={() => setCreating(true)}>
              New dispatch
            </PrimaryButton>
          )}
        </PageHeader>

        {section === 'dispatch' && <DispatchView />}
        {section === 'customize' && <CustomizeView />}
      </div>
      {creating && <NewDispatchDialog onClose={() => setCreating(false)} />}
    </div>
  )
}

/** The "New dispatch" form — a one-off agentic task: a required title + an optional
 *  detail. Dispatching kicks off a run that lands in the feed 'running' and finishes
 *  a beat later. Built on the shared FormDialog primitive. */
function NewDispatchDialog({ onClose }: { onClose: () => void }) {
  const [title, setTitle] = useState('')
  const [detail, setDetail] = useState('')

  const canCreate = title.trim().length > 0
  const submit = () => {
    if (!canCreate) return
    void createDispatch(title.trim(), detail.trim() || undefined)
    onClose()
  }

  return (
    <FormDialog
      title="New dispatch"
      icon={<SendHorizontal size={18} className="text-cap-workspace" />}
      submitLabel="Dispatch"
      submitIcon={<SendHorizontal size={15} />}
      canSubmit={canCreate}
      onSubmit={submit}
      onClose={onClose}
    >
      <FormField label="Task">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit()
          }}
          placeholder="e.g. Triage today’s new support tickets"
          className={FORM_INPUT_CLASS}
        />
      </FormField>
      <FormField label="Detail" optional>
        <textarea
          value={detail}
          onChange={(e) => setDetail(e.target.value)}
          rows={3}
          placeholder="What it should do, and where to deliver the result."
          className={`${FORM_INPUT_CLASS} resize-none leading-relaxed`}
        />
      </FormField>
    </FormDialog>
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
      {tool.needsAuth && <span className="ml-0.5 h-1.5 w-1.5 rounded-full bg-amber-500" />}
    </span>
  )
}

/** The status pill for a task row / header: paused, failed, or "ran …". */
function taskPill(task: ScheduledTask): { tone: 'ok' | 'warn' | 'bad' | 'neutral'; label: string } {
  if (!task.enabled) return { tone: 'neutral', label: 'Paused' }
  if (task.lastStatus === 'failed') return { tone: 'bad', label: 'Failed' }
  const last = task.runs[0]
  return { tone: 'ok', label: last ? `Ran ${relativeTime(last.at)}` : 'Active' }
}

function ScheduledSection({
  scheduleId,
  subview,
  onOpenSchedule,
  onBack,
  backTo,
  onOpenSession,
}: {
  /** Which routine detail to show (null = the list) — the controlled source of
   *  truth, set by the controller however the detail was reached. */
  scheduleId: string | null
  /** The rail's group node (lib/subviews): null = all, else 'active' | 'paused'. */
  subview: string | null
  onOpenSchedule: (id: string) => void
  onBack: () => void
  backTo: NavLocation | null
  /** Open a run's session (the run-history rows + the rail both land here). */
  onOpenSession: (id: string) => void
}) {
  // The routines come from the server; ScheduledSection keeps a local working
  // The routines + their runs come straight from the server now (one live source,
  // shared with the rail's recent-runs feed). Mutations are commands; the run.*
  // events invalidate the cache, so the list reflects run-now / the daemon live.
  const items = useSchedules().data ?? []
  const [query, setQuery] = useState('')
  const [folded, setFolded] = useState<Set<'active' | 'paused'>>(new Set())
  // Ids with a "Run now" in flight — drives the button spinner until the run's
  // run.finished event lands (cleared on a timer as a safety net).
  const [running, setRunning] = useState<Set<string>>(new Set())
  const timers = useRef<number[]>([])
  useEffect(() => () => timers.current.forEach((t) => window.clearTimeout(t)), [])

  const toggleEnabled = (id: string) => {
    const t = items.find((x) => x.id === id)
    // The toggle is always rendered from `items`, so `t` is present; guard rather
    // than send an unresolved state (the server applies an explicit value only).
    if (t) void toggleScheduleEnabled(id, !t.enabled)
  }
  const remove = (id: string) => void removeSchedule(id)

  const runNow = (id: string) => {
    if (running.has(id)) return
    setRunning((prev) => new Set(prev).add(id))
    void runScheduleNow(id)
    const timer = window.setTimeout(() => {
      setRunning((prev) => {
        const next = new Set(prev)
        next.delete(id)
        return next
      })
    }, 2000)
    timers.current.push(timer)
  }

  const addFromTemplate = async (tpl: ScheduleTemplate) => {
    const task = await addScheduleFromSeed(tpl.seed)
    onOpenSchedule(task.id)
  }

  const foldGroup = (g: 'active' | 'paused') =>
    setFolded((prev) => {
      const next = new Set(prev)
      next.has(g) ? next.delete(g) : next.add(g)
      return next
    })

  // Clicking a row drills into the task's workflow + run history.
  const open = scheduleId ? (items.find((t) => t.id === scheduleId) ?? null) : null
  if (open)
    return (
      <ScheduledDetail
        task={open}
        running={running.has(open.id)}
        onBack={onBack}
        backTo={backTo}
        onToggleEnabled={() => toggleEnabled(open.id)}
        onRunNow={() => runNow(open.id)}
        onOpenSession={onOpenSession}
        onRemove={() => {
          remove(open.id)
          onBack()
        }}
      />
    )

  const needle = query.trim().toLowerCase()
  const matches = items.filter(
    (t) =>
      needle === '' ||
      t.name.toLowerCase().includes(needle) ||
      t.subtitle.toLowerCase().includes(needle) ||
      t.steps.some((s) => s.tool.label.toLowerCase().includes(needle)),
  )
  // The filter tab ids drive the enabled filter.
  const wantEnabled = subview === 'active' ? true : subview === 'paused' ? false : null
  const allGroups = [
    { key: 'active' as const, label: 'Active', items: matches.filter((t) => t.enabled) },
    { key: 'paused' as const, label: 'Paused', items: matches.filter((t) => !t.enabled) },
  ]
  const groups = allGroups.filter((g) => {
    if (wantEnabled === true && g.key !== 'active') return false
    if (wantEnabled === false && g.key !== 'paused') return false
    return g.items.length > 0
  })

  return (
    <Page>
      <PageHeader title="Scheduled">
        <NewScheduleControl onAdd={addFromTemplate} />
      </PageHeader>
      <p className="-mt-2 mb-4 text-[13px] leading-relaxed text-ink-soft">
        Recurring workflows — Claude runs a sequence of steps on a cadence and delivers the result. Open one to
        see its steps and run history.
      </p>
      <SearchBox value={query} onChange={setQuery} placeholder="Search scheduled tasks…" />

      {groups.length === 0 ? (
        <Empty>No scheduled tasks match.</Empty>
      ) : (
        <div className="space-y-7">
          {groups.map((g) => {
            const isFolded = folded.has(g.key)
            return (
              <div key={g.key}>
                <FoldGroupHeader
                  label={g.label}
                  count={g.items.length}
                  folded={isFolded}
                  onToggle={() => foldGroup(g.key)}
                />
                {!isFolded && (
                  <div
                    className={`overflow-hidden rounded-xl border border-line bg-surface shadow-sm ${
                      g.key === 'paused' ? 'opacity-80' : ''
                    }`}
                  >
                    {g.items.map((t, i) => (
                      <ScheduledRow
                        key={t.id}
                        task={t}
                        first={i === 0}
                        running={running.has(t.id)}
                        onOpen={() => onOpenSchedule(t.id)}
                        onToggle={() => toggleEnabled(t.id)}
                        onRunNow={() => runNow(t.id)}
                        onRemove={() => remove(t.id)}
                      />
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </Page>
  )
}

function ScheduledRow({
  task,
  first,
  running,
  onOpen,
  onToggle,
  onRunNow,
  onRemove,
}: {
  task: ScheduledTask
  first: boolean
  running: boolean
  onOpen: () => void
  onToggle: () => void
  onRunNow: () => void
  onRemove: () => void
}) {
  const lead = task.steps[0]?.tool ?? task.delivery.tool
  const pill = running ? { tone: 'warn' as const, label: 'Running…' } : taskPill(task)
  const lastRun = task.runs[0]
  const dot =
    task.lastStatus === 'ok' ? 'bg-emerald-500' : task.lastStatus === 'failed' ? 'bg-red-500' : 'bg-line-strong'

  return (
    // The row is a @container: its metadata is gated on the row's OWN width,
    // not the viewport (UI-9, docs/ui-invariants.md) — at 768px the viewport
    // is `md:` but the rail leaves this row ~450px, which can't afford what
    // `md:` promises; the rail/panel resize the row independently of the
    // window. Fixed-width blocks yield in order (next-run info, then the
    // pill) so the flex-1 name column — the row's identity — never collapses.
    <div
      className={`group @container flex items-center gap-3 transition hover:bg-panel-2/50 ${
        first ? '' : 'border-t border-line'
      }`}
    >
      {/* The main region drills into the detail; the trailing controls sit outside
          this button so they don't trigger navigation. */}
      <button onClick={onOpen} className="flex min-w-0 flex-1 items-center gap-3 px-4 py-3 text-left">
        <span className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-panel-2">
          <ToolGlyph tool={lead} size={16} />
          <span className={`absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full ring-2 ring-surface ${dot}`} />
        </span>

        <div className="min-w-0 flex-1 overflow-hidden">
          <div className="truncate text-[14px] font-medium text-ink">{task.name}</div>
          <MiniPipeline task={task} />
          <div className="truncate text-[12px] text-ink-faint @2xl:hidden">
            {task.steps.length} step{task.steps.length === 1 ? '' : 's'} · {task.subtitle}
          </div>
        </div>

        <div className="hidden shrink-0 pr-1 text-right @2xl:block">
          <div className="text-[12px] text-ink-soft">next {task.next}</div>
          <div className="text-[11px] text-ink-faint">{lastRun ? `ran ${relativeTime(lastRun.at)}` : 'no runs yet'}</div>
        </div>
      </button>

      <div className="flex shrink-0 items-center gap-2 pr-4">
        {/* In a tight row the pill yields its width to the name column — the
            icon's status dot already carries ok/failed, the detail the rest. */}
        <span className="hidden @sm:block">
          <StatusPill tone={pill.tone} label={pill.label} />
        </span>

        <div className={`flex items-center gap-1 focus-within:opacity-100 ${HOVER_REVEAL}`}>
          <Tooltip label="Run now">
            <button
              onClick={onRunNow}
              aria-label={`Run ${task.name} now`}
              className="flex h-7 w-7 items-center justify-center rounded-md text-ink-faint transition hover:bg-panel-2 hover:text-ink"
            >
              {running ? <Spinner size={14} /> : <Play size={14} />}
            </button>
          </Tooltip>
          <button
            onClick={onRemove}
            title="Delete schedule"
            aria-label={`Delete ${task.name}`}
            className="flex h-7 w-7 items-center justify-center rounded-md text-ink-faint transition hover:bg-removed-bg hover:text-removed"
          >
            <Trash2 size={14} />
          </button>
        </div>

        <Toggle on={task.enabled} onToggle={onToggle} ariaLabel={`${task.name} enabled`} />
      </div>
    </div>
  )
}

/** The row's at-a-glance pipeline: the step tools joined by chevrons, capped by
 *  the delivery target. Collapses the middle to "+N" past four steps. */
function MiniPipeline({ task }: { task: ScheduledTask }) {
  const tools = task.steps.map((s) => s.tool)
  const shown = tools.length > 4 ? tools.slice(0, 3) : tools
  const overflow = tools.length - shown.length
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
      <PipeNode tool={task.delivery.tool} />
    </div>
  )
}

/** "New schedule" — a template picker cloned from AddContextControl. Picking a
 *  template seeds a fully-formed (paused) task into local state and drills straight
 *  into its detail, so the user lands on a populated workflow rather than a form. */
function NewScheduleControl({ onAdd }: { onAdd: (tpl: ScheduleTemplate) => void }) {
  const [open, setOpen] = useState(false)
  const ref = useDismissable<HTMLDivElement>(open, () => setOpen(false))
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

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="dialog"
        aria-expanded={open}
        className="flex shrink-0 items-center gap-1.5 rounded-lg bg-ink px-3.5 py-1.5 text-[13px] font-medium text-canvas shadow-sm transition hover:opacity-90"
      >
        <Plus size={15} />
        New schedule
      </button>

      {open && (
        <div
          ref={popRef}
          role="dialog"
          aria-label="New schedule"
          className={`absolute right-0 z-30 mt-2 w-[340px] overflow-hidden ${POPOVER_SURFACE}`}
        >
          <div className="max-h-[min(60dvh,440px)] overflow-y-auto p-2">
            {cats.map((c) => (
              <div key={c.label} className="pb-1">
                <p className="px-1.5 pb-1 pt-1 text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
                  {c.label}
                </p>
                {c.items.map((t) => (
                  <NewScheduleRow
                    key={t.name}
                    tpl={t}
                    onAdd={() => {
                      onAdd(t)
                      setOpen(false)
                    }}
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

function NewScheduleRow({ tpl, onAdd }: { tpl: ScheduleTemplate; onAdd: () => void }) {
  const lead = tpl.seed.steps[0]?.tool
  const blank = tpl.category === 'Start from scratch'
  return (
    <button
      onClick={onAdd}
      className="group mb-0.5 flex w-full items-center gap-2.5 rounded-lg px-1.5 py-1.5 text-left transition hover:bg-panel-2"
    >
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-panel-2 text-ink-soft">
        {blank ? <Sparkles size={15} className="text-accent" /> : lead ? <ToolGlyph tool={lead} size={15} /> : <Clock size={15} />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-medium text-ink">{tpl.name}</span>
        <span className="block truncate text-[11px] text-ink-faint">{tpl.preview}</span>
      </span>
      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md text-ink-faint transition group-hover:bg-accent group-hover:text-white">
        <Plus size={14} />
      </span>
    </button>
  )
}

/** Drill-down for one scheduled task: the instruction, the workflow rail (lit by
 *  whichever run is selected), recent runs, and the schedule / delivery / tools /
 *  model side panels. */
function ScheduledDetail({
  task,
  running,
  onBack,
  backTo,
  onToggleEnabled,
  onRunNow,
  onOpenSession,
  onRemove,
}: {
  task: ScheduledTask
  running: boolean
  onBack: () => void
  backTo: NavLocation | null
  onToggleEnabled: () => void
  onRunNow: () => void
  /** Open a run's session — the run-history rows link here, same destination as
   *  clicking the routine in the left rail. */
  onOpenSession: (id: string) => void
  onRemove: () => void
}) {
  // Editing the routine name is a per-action entity edit; the delivery + notify
  // settings live in DeliveryPanel below.
  const [editingName, setEditingName] = useState(false)
  const [nameDraft, setNameDraft] = useState(task.name)

  // The rail reflects the freshest run (a live "Run now" overrides it with an
  // in-flight state until the new run resolves). Inspecting an *older* run is now
  // done by opening its session from the run history, which carries the full
  // thread + its own run switcher.
  const shownRun = running ? null : (task.runs[0] ?? null)
  const DeliveryIcon = stepToolIcon(task.delivery.tool.id)

  return (
    <Page>
      <header className={PAGE_HEADER_CLASS}>
        <div className="flex min-w-0 items-start gap-3">
          <BackButton to={backTo} onBack={onBack} />
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-panel-2 text-ink-soft">
            <DeliveryIcon size={20} />
          </span>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              {editingName ? (
                <input
                  autoFocus
                  value={nameDraft}
                  onChange={(e) => setNameDraft(e.target.value)}
                  onBlur={() => setEditingName(false)}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') {
                      setNameDraft(task.name)
                      setEditingName(false)
                    }
                    if (e.key === 'Enter') {
                      const next = nameDraft.trim()
                      if (next && next !== task.name) void updateSchedule(task.id, { name: next })
                      setEditingName(false)
                    }
                  }}
                  aria-label="Routine name"
                  className={`${PAGE_TITLE_CLASS} min-w-0 max-w-full rounded-md border border-accent bg-surface px-1.5 py-0.5 outline-none`}
                />
              ) : (
                <button
                  onClick={() => {
                    setNameDraft(task.name)
                    setEditingName(true)
                  }}
                  title="Rename routine"
                  className="group flex min-w-0 items-center gap-1.5 rounded-md text-left transition hover:bg-panel-2/60"
                >
                  <h1 className={`${PAGE_TITLE_CLASS} truncate`}>{task.name}</h1>
                  <Pencil size={14} className={`shrink-0 text-ink-faint ${HOVER_CUE}`} />
                </button>
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
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <button
            onClick={onRunNow}
            disabled={running}
            className="flex items-center gap-1.5 rounded-lg bg-ink px-3.5 py-1.5 text-[13px] font-medium text-canvas shadow-sm transition hover:opacity-90 disabled:opacity-60"
          >
            {running ? <Spinner size={15} /> : <Play size={15} />}
            {running ? 'Running…' : 'Run now'}
          </button>
          <button
            onClick={onToggleEnabled}
            className="flex items-center gap-1.5 rounded-lg border border-line-strong bg-surface px-3 py-1.5 text-[13px] font-medium text-ink shadow-sm transition hover:border-accent"
          >
            {task.enabled ? <PauseCircle size={15} /> : <PlayCircle size={15} />}
            {task.enabled ? 'Pause' : 'Resume'}
          </button>
          <button
            onClick={onRemove}
            className="flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-[13px] font-medium text-ink-soft shadow-sm transition hover:border-removed hover:bg-removed-bg hover:text-removed"
          >
            <Trash2 size={14} />
            Delete
          </button>
        </div>
      </header>

      <div className="flex flex-col gap-6 @3xl:flex-row">
        <div className="min-w-0 flex-1 space-y-4">
          <PromptCard prompt={task.prompt} onSave={(prompt) => void updateSchedule(task.id, { prompt })} />
          <WorkflowCard task={task} run={shownRun} running={running} />
          <RunHistoryCard task={task} onOpenRun={(runId) => onOpenSession(runSessionId(task.id, runId))} />
        </div>

        <aside className="w-full shrink-0 space-y-4 @3xl:w-72">
          <SchedulePanel task={task} />

          <DeliveryPanel task={task} />

          <ContextToolsPanel task={task} />

          <ModelPanel task={task} />
        </aside>
      </div>
    </Page>
  )
}

/** The verbatim instruction every run executes against — an entity field, so it's
 *  inline-editable (✎ → textarea, ⌘/Ctrl+Enter or Save commits via updateSchedule).
 *  Copy stays available in read mode. */
function PromptCard({ prompt, onSave }: { prompt: string; onSave: (prompt: string) => void }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(prompt)
  const taRef = useRef<HTMLTextAreaElement>(null)

  const startEdit = () => {
    setDraft(prompt)
    setEditing(true)
  }
  const save = () => {
    const next = draft.trim()
    if (next && next !== prompt) onSave(next)
    setEditing(false)
  }
  useEffect(() => {
    if (editing) taRef.current?.focus()
  }, [editing])

  return (
    <div className={`rounded-xl border border-line bg-surface p-4 shadow-sm ${SECTION_REVEAL_GROUP}`}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-ink-faint">Instruction</span>
        {!editing && (
          <SectionActions>
            <SectionAction label="Edit instruction" icon={<Pencil size={13} />} onClick={startEdit} />
            <CopyButton text={prompt} ariaLabel="Copy instruction" />
          </SectionActions>
        )}
      </div>
      {editing ? (
        <div className="mt-2">
          <textarea
            ref={taRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setEditing(false)
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) save()
            }}
            rows={5}
            placeholder="What should this routine do each time it runs?"
            className="w-full resize-none rounded-lg border border-line bg-surface px-3 py-2.5 text-[13px] leading-relaxed text-ink outline-none transition placeholder:text-ink-faint focus:border-accent"
          />
          <div className="mt-2 flex items-center justify-end gap-2">
            <button
              onClick={() => setEditing(false)}
              className="rounded-md px-2 py-1 text-[12px] font-medium text-ink-soft transition hover:text-ink"
            >
              Cancel
            </button>
            <button
              onClick={save}
              className="flex items-center gap-1 rounded-md bg-ink px-2.5 py-1 text-[12px] font-medium text-canvas shadow-sm transition hover:opacity-90"
            >
              <Check size={13} />
              Save
            </button>
          </div>
        </div>
      ) : (
        <p className="mt-2 whitespace-pre-wrap rounded-lg bg-panel-2/40 px-3 py-2.5 text-[13px] leading-relaxed text-ink">
          {prompt}
        </p>
      )}
    </div>
  )
}

type RailState = 'idle' | 'done' | 'fail' | 'running'

// Backgrounds are opaque (not a /10 alpha) so the rail line stays hidden behind
// the marker; the tint still reads as a soft fill for done / failed steps.
function railMarkerClasses(state: RailState): string {
  if (state === 'done') return 'border-emerald-500 bg-emerald-50 text-emerald-700'
  if (state === 'fail') return 'border-red-500 bg-red-50 text-red-500'
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
          className={`absolute bottom-0 left-[13px] top-7 w-0.5 ${state === 'done' ? 'bg-emerald-500' : 'bg-line'}`}
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
  const reached = run ? run.reachedStep : 0
  const failedAt = run && run.status === 'failed' ? run.reachedStep : -1
  // A standing "save X / open a session each run" edit overrides where the
  // terminal node delivers, so the rail matches the "Delivers to" panel.
  const overrideTarget = rel.scheduleArtifactFor(task.id) ?? rel.scheduleSessionFor(task.id)
  const deliveryTarget = overrideTarget ?? task.delivery.target

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
    <div className={`rounded-xl border border-line bg-surface shadow-sm ${SECTION_REVEAL_GROUP}`}>
      <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-3">
        <span className="text-[13px] font-semibold text-ink">Workflow</span>
        {editing ? (
          <span className="text-[12px] font-medium text-ink-faint">Editing steps</span>
        ) : (
          <div className="flex items-center gap-2">
            <span className="text-[12px] text-ink-faint">
              {task.steps.length} step{task.steps.length === 1 ? '' : 's'} · runs top to bottom
            </span>
            <SectionActions>
              <SectionAction label="Edit steps" icon={<Pencil size={13} />} onClick={() => setEditing(true)} />
            </SectionActions>
          </div>
        )}
      </div>
      <div className="p-4">
        <div className="mb-3 flex items-center gap-2.5 rounded-lg bg-panel-2/40 px-3 py-2.5">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-surface text-ink-soft">
            <Clock size={15} />
          </span>
          <span className="text-[11px] font-semibold uppercase tracking-wide text-ink-faint">When</span>
          <span className="min-w-0 truncate text-[13px] text-ink">{task.trigger}</span>
        </div>

        {editing ? (
          <StepsEditor task={task} onClose={() => setEditing(false)} />
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

            <RailRow state={deliveredState} connect={false} delivery marker={<ToolGlyph tool={task.delivery.tool} size={14} />}>
              <div className="rounded-lg bg-accent-tint px-3 py-2.5">
                <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-accent-strong">
                  <SendHorizontal size={12} />
                  Deliver
                </div>
                <div className="mt-1 text-[13px] font-medium text-ink">
                  {task.delivery.tool.label} · {deliveryTarget}
                </div>
                {!overrideTarget && task.delivery.note && (
                  <p className="mt-0.5 text-[12px] text-ink-soft">{task.delivery.note}</p>
                )}
              </div>
            </RailRow>
          </div>
        )}
      </div>
    </div>
  )
}

/** The workflow step editor — a draft of the ordered steps you can reorder, edit
 *  (action text + tool), add to, and remove from, committed as one
 *  updateSchedule({ steps }) on Save (an entity field edit; the standing
 *  scheduleExtraTools overlay is a separate relation surface and is untouched). */
function StepsEditor({ task, onClose }: { task: ScheduledTask; onClose: () => void }) {
  const [steps, setSteps] = useState<WorkflowStep[]>(() => task.steps.map((s) => ({ ...s })))
  const [picking, setPicking] = useState<string | null>(null)

  const setAction = (i: number, action: string) =>
    setSteps((s) => s.map((x, j) => (j === i ? { ...x, action } : x)))
  const setTool = (i: number, tool: StepTool) => {
    setSteps((s) => s.map((x, j) => (j === i ? { ...x, tool } : x)))
    setPicking(null)
  }
  const add = () =>
    setSteps((s) => [...s, { id: crypto.randomUUID(), action: '', tool: STEP_TOOLS[0] }])
  const save = () => {
    void updateSchedule(task.id, { steps: cleanSteps(steps) })
    onClose()
  }

  return (
    <div>
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
                  {s.tool.needsAuth && <span className="ml-0.5 h-1.5 w-1.5 rounded-full bg-amber-500" />}
                  <ChevronDown size={11} className="text-ink-faint" />
                </button>
                {picking === s.id && <StepToolPicker onPick={(t) => setTool(i, t)} onClose={() => setPicking(null)} />}
              </div>
              <textarea
                value={s.action}
                onChange={(e) => setAction(i, e.target.value)}
                rows={2}
                placeholder="What this step does…"
                className="mt-1.5 w-full resize-none rounded-md border border-line bg-surface px-2 py-1.5 text-[13px] leading-snug text-ink outline-none transition placeholder:text-ink-faint focus:border-accent"
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
        className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-line-strong py-2 text-[12px] font-medium text-ink-soft transition hover:border-accent hover:text-ink"
      >
        <Plus size={14} />
        Add step
      </button>

      <div className="mt-3 flex items-center justify-end gap-2 border-t border-line pt-3">
        <button onClick={onClose} className="rounded-md px-2.5 py-1 text-[12px] font-medium text-ink-soft transition hover:text-ink">
          Cancel
        </button>
        <button
          onClick={save}
          className="flex items-center gap-1 rounded-md bg-ink px-2.5 py-1 text-[12px] font-medium text-canvas shadow-sm transition hover:opacity-90"
        >
          <Check size={13} />
          Save workflow
        </button>
      </div>
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
          {t.needsAuth && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" title="Needs auth" />}
        </button>
      ))}
    </div>
  )
}

function RunStatusIcon({ status }: { status: ScheduledRun['status'] }) {
  if (status === 'running') return <Spinner size={16} className="mt-0.5 shrink-0 text-accent" />
  if (status === 'failed') return <AlertCircle size={16} className="mt-0.5 shrink-0 text-red-500" />
  if (status === 'skipped') return <MinusCircle size={16} className="mt-0.5 shrink-0 text-ink-faint" />
  return <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-emerald-500" />
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
              ? 'bg-emerald-500'
              : s === 'failed'
                ? 'bg-red-500'
                : s === 'running'
                  ? 'bg-accent'
                  : s === 'skipped'
                    ? 'bg-line-strong'
                    : 'bg-line'
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
    <div className="rounded-xl border border-line bg-surface shadow-sm">
      <div className="flex items-center justify-between border-b border-line px-4 py-3">
        <span className="text-[13px] font-semibold text-ink">Recent runs</span>
        {task.runs.length > 0 && <WeekStrip runs={task.runs} />}
      </div>
      {task.runs.length === 0 ? (
        <div className="px-4 py-8 text-center text-[13px] text-ink-faint">No runs yet — Run now to try it.</div>
      ) : (
        <div>
          {task.runs.map((r, i) => (
            <RunRow key={r.id} run={r} first={i === 0} onOpen={() => onOpenRun(r.id)} />
          ))}
        </div>
      )}
    </div>
  )
}

function RunRow({
  run,
  first,
  onOpen,
}: {
  run: ScheduledRun
  first: boolean
  onOpen: () => void
}) {
  return (
    <button
      onClick={onOpen}
      title="Open this run’s session"
      className={`group flex w-full items-start gap-3 px-4 py-3 text-left transition hover:bg-panel-2/60 ${
        first ? '' : 'border-t border-line'
      }`}
    >
      <RunStatusIcon status={run.status} />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-[13px] font-medium text-ink">{relativeTime(run.at)}</span>
          {run.duration !== '—' && <span className="shrink-0 text-[11px] text-ink-faint">ran in {run.duration}</span>}
        </div>
        <p className={`mt-0.5 text-[12px] ${run.status === 'failed' ? 'text-red-600' : 'text-ink-soft'}`}>
          {run.summary}
        </p>
      </div>
      <ChevronRight
        size={15}
        className={`mt-0.5 shrink-0 text-ink-faint ${HOVER_CUE}`}
      />
    </button>
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
  const override = rel.scheduleArtifactFor(task.id) ?? rel.scheduleSessionFor(task.id)
  const preApproved = !!override
  const notifyOnFail = task.notifyOnFailure ?? true

  const [editing, setEditing] = useState(false)
  const [tool, setTool] = useState<StepTool>(task.delivery.tool)
  const [target, setTarget] = useState(task.delivery.target)
  const [picking, setPicking] = useState(false)

  const startEdit = () => {
    setTool(task.delivery.tool)
    setTarget(task.delivery.target)
    setEditing(true)
  }
  const save = () => {
    const t = target.trim()
    if (t) void updateSchedule(task.id, { delivery: { tool, target: t, note: task.delivery.note } })
    setEditing(false)
  }

  const DeliveryIcon = stepToolIcon(task.delivery.tool.id)
  const displayTarget = override ?? task.delivery.target

  return (
    <SidePanel
      title="Delivers to"
      icon={<SendHorizontal size={14} />}
      actions={
        !editing && !preApproved ? (
          <SectionAction label="Edit destination" icon={<Pencil size={13} />} onClick={startEdit} />
        ) : undefined
      }
    >
      {editing ? (
        <div>
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
              if (e.key === 'Escape') setEditing(false)
              if (e.key === 'Enter') save()
            }}
            placeholder="Where each run delivers…"
            aria-label="Delivery target"
            className="mt-1.5 w-full rounded-md border border-line bg-surface px-2 py-1.5 text-[13px] text-ink outline-none transition placeholder:text-ink-faint focus:border-accent"
          />
          <div className="mt-2 flex items-center justify-end gap-2">
            <button onClick={() => setEditing(false)} className="rounded-md px-2 py-1 text-[12px] font-medium text-ink-soft transition hover:text-ink">
              Cancel
            </button>
            <button
              onClick={save}
              className="flex items-center gap-1 rounded-md bg-ink px-2.5 py-1 text-[12px] font-medium text-canvas shadow-sm transition hover:opacity-90"
            >
              <Check size={13} />
              Save
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="flex items-center gap-2">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-panel-2">
              <DeliveryIcon size={15} className={toneChip(task.delivery.tool.tone).color} />
            </span>
            <div className="min-w-0">
              <div className="truncate text-[13px] font-medium text-ink">{displayTarget}</div>
              <div className="truncate text-[11px] text-ink-faint">{task.delivery.tool.label}</div>
            </div>
          </div>
          {preApproved ? (
            <>
              <div className="mt-2 inline-flex items-center gap-1 rounded-md bg-emerald-50 px-1.5 py-0.5 text-[11px] font-medium text-emerald-700">
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
        <Toggle on={notifyOnFail} onToggle={() => void updateSchedule(task.id, { notifyOnFailure: !notifyOnFail })} ariaLabel="Notify me on failure" />
      </label>
    </SidePanel>
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
  const [picking, setPicking] = useState(false)
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
    rel.applyOp({ kind: 'schedule-add-tool', scheduleId: task.id, scheduleName: task.name, cadence: task.cadence, tool })
    setPicking(false)
  }

  return (
    <SidePanel
      title="Context & tools"
      icon={<Plug size={14} />}
      revealActions={tools.length === 0}
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
            return (
              <div key={t.id} className="flex items-center gap-2">
                <ToolGlyph tool={t} size={15} />
                {door ? (
                  // Titles-are-doors styling (hover underline), keeping the row's
                  // own type scale rather than the inline-action one.
                  <button
                    onClick={door}
                    className="min-w-0 flex-1 truncate text-left text-[13px] text-ink transition hover:underline"
                    title={`Open ${t.label} in Contexts`}
                  >
                    {t.label}
                  </button>
                ) : (
                  <span className="min-w-0 flex-1 truncate text-[13px] text-ink">{t.label}</span>
                )}
                <StatusPill tone={t.needsAuth ? 'warn' : 'ok'} label={t.needsAuth ? 'Needs auth' : 'Connected'} />
              </div>
            )
          })}
        </div>
      )}
    </SidePanel>
  )
}

/** The frequencies offered by the cadence editor, and a small timezone set. */
const FREQ_OPTIONS: { id: Frequency; label: string }[] = [
  { id: 'every-30m', label: 'Every 30 min' },
  { id: 'hourly', label: 'Hourly' },
  { id: 'every-2h', label: 'Every 2 hours' },
  { id: 'weekdays', label: 'Weekdays' },
  { id: 'daily', label: 'Daily' },
  { id: 'weekly', label: 'Weekly' },
]
const TIMEZONES = [
  'America/Los_Angeles',
  'America/Denver',
  'America/Chicago',
  'America/New_York',
  'UTC',
  'Europe/London',
  'Europe/Berlin',
  'Asia/Tokyo',
  'Asia/Shanghai',
  'Australia/Sydney',
]

/** The Schedule side panel — cadence / next-run / timezone, now editable. The
 *  cadence chip, the WHEN sentence (task.trigger), and the next-run estimate are
 *  all DERIVED from one structured pick (lib/cadence), so editing the frequency
 *  keeps the three coherent. These are entity fields → a per-action updateSchedule. */
function SchedulePanel({ task }: { task: ScheduledTask }) {
  const [editing, setEditing] = useState(false)
  return (
    <SidePanel
      title="Schedule"
      icon={<Clock size={14} />}
      actions={
        <div className="relative">
          <SectionAction
            label="Edit schedule"
            icon={<Pencil size={13} />}
            onClick={() => setEditing((v) => !v)}
            open={editing}
          />
          {editing && <CadenceEditor task={task} onClose={() => setEditing(false)} />}
        </div>
      }
    >
      <div className="space-y-2 text-[13px] text-ink">
        <div className="flex items-center justify-between gap-2">
          <span className="text-ink-soft">Cadence</span>
          <span className="text-right font-medium">{task.cadence}</span>
        </div>
        <div className="flex items-center justify-between gap-2">
          <span className="text-ink-soft">Next run</span>
          <span className="text-right font-medium">{task.enabled ? task.next : 'Paused'}</span>
        </div>
        {task.timezone && (
          <div className="flex items-center justify-between gap-2">
            <span className="text-ink-soft">Timezone</span>
            <span className="text-right font-medium">{task.timezone}</span>
          </div>
        )}
      </div>
      {task.startedLabel && (
        <div className="mt-2.5 truncate border-t border-line pt-2.5 text-[11px] text-ink-faint">
          {task.startedLabel}
        </div>
      )}
    </SidePanel>
  )
}

/** The cadence editor popover — a frequency picker (+ time / weekday / timezone),
 *  with a live preview of the derived cadence + next-run. Apply writes the three
 *  derived fields via updateSchedule in one patch. */
function CadenceEditor({ task, onClose }: { task: ScheduledTask; onClose: () => void }) {
  // Mounted only while open, so dismiss listeners live for its whole lifetime.
  const ref = useDismissable<HTMLDivElement>(true, onClose)
  const popRef = usePopoverShift<HTMLDivElement>(true)
  const [spec, setSpec] = useState<CadenceSpec>(() => parseCadence(task.cadence) ?? { freq: 'daily', time: '09:00' })
  const [tz, setTz] = useState(task.timezone ?? 'America/Los_Angeles')

  const timed = TIMED_FREQS.includes(spec.freq)
  const preview = describeCadence(spec)
  const next = nextRunLabel(spec, new Date())

  const apply = () => {
    const derived = describeCadence(spec)
    void updateSchedule(task.id, {
      cadence: derived.cadence,
      trigger: derived.trigger,
      next: nextRunLabel(spec, new Date()),
      timezone: tz,
    })
    onClose()
  }

  return (
    <div
      ref={(el) => {
        ref.current = el
        popRef.current = el
      }}
      role="dialog"
      aria-label="Edit schedule"
      className={`absolute right-0 top-full z-30 mt-1.5 w-[280px] p-3 ${POPOVER_SURFACE}`}
    >
      <div className="text-[11px] font-semibold uppercase tracking-wide text-ink-faint">Frequency</div>
      <div className="mt-1.5 grid grid-cols-2 gap-1">
        {FREQ_OPTIONS.map((f) => {
          const on = spec.freq === f.id
          return (
            <button
              key={f.id}
              onClick={() => setSpec((s) => ({ ...s, freq: f.id, time: s.time ?? '09:00', weekday: s.weekday ?? 1 }))}
              aria-pressed={on}
              className={`rounded-lg border px-2 py-1 text-[12px] font-medium transition ${
                on ? 'border-accent bg-accent-tint text-accent-strong' : 'border-line bg-surface text-ink-soft hover:border-line-strong'
              }`}
            >
              {f.label}
            </button>
          )
        })}
      </div>

      {spec.freq === 'weekly' && (
        <label className="mt-2.5 block">
          <span className="text-[11px] font-medium text-ink-soft">Day</span>
          <select
            value={spec.weekday ?? 1}
            onChange={(e) => setSpec((s) => ({ ...s, weekday: Number(e.target.value) }))}
            className="mt-1 w-full rounded-lg border border-line bg-surface px-2 py-1.5 text-[13px] text-ink outline-none transition focus:border-accent"
          >
            {WEEKDAY_NAMES.map((n, i) => (
              <option key={i} value={i}>
                {n}
              </option>
            ))}
          </select>
        </label>
      )}

      {timed && (
        <label className="mt-2.5 block">
          <span className="text-[11px] font-medium text-ink-soft">Time</span>
          <input
            type="time"
            value={spec.time ?? '09:00'}
            onChange={(e) => setSpec((s) => ({ ...s, time: e.target.value }))}
            className="mt-1 w-full rounded-lg border border-line bg-surface px-2 py-1.5 text-[13px] text-ink outline-none transition focus:border-accent"
          />
        </label>
      )}

      <label className="mt-2.5 block">
        <span className="text-[11px] font-medium text-ink-soft">Timezone</span>
        <select
          value={tz}
          onChange={(e) => setTz(e.target.value)}
          className="mt-1 w-full rounded-lg border border-line bg-surface px-2 py-1.5 text-[13px] text-ink outline-none transition focus:border-accent"
        >
          {TIMEZONES.map((z) => (
            <option key={z} value={z}>
              {z}
            </option>
          ))}
        </select>
      </label>

      <div className="mt-3 rounded-lg bg-panel-2/50 px-2.5 py-2 text-[12px] text-ink-soft">
        <span className="font-medium text-ink">{preview.cadence}</span> · next {next}
      </div>

      <div className="mt-2.5 flex items-center justify-end gap-2">
        <button onClick={onClose} className="rounded-md px-2 py-1 text-[12px] font-medium text-ink-soft transition hover:text-ink">
          Cancel
        </button>
        <button
          onClick={apply}
          className="flex items-center gap-1 rounded-md bg-ink px-2.5 py-1 text-[12px] font-medium text-canvas shadow-sm transition hover:opacity-90"
        >
          <Check size={13} />
          Apply
        </button>
      </div>
    </div>
  )
}

/** The Model side panel — the model + effort the routine runs on, now a picker
 *  (entity field → per-action updateSchedule). The stored label is composed from
 *  the shared model/effort catalog (lib/models), the same one the composer uses. */
function ModelPanel({ task }: { task: ScheduledTask }) {
  const [editing, setEditing] = useState(false)
  return (
    <SidePanel title="Model" icon={<Sparkles size={14} />}>
      <div className="relative">
        <button
          onClick={() => setEditing((v) => !v)}
          title="Change model & effort"
          aria-haspopup="dialog"
          aria-expanded={editing}
          className="group inline-flex max-w-full items-center gap-1.5 rounded-lg bg-panel-2 px-3 py-1 text-[12px] font-medium text-ink ring-1 ring-transparent transition hover:ring-line-strong"
        >
          <ClaudeMark size={13} />
          <span className="truncate">{task.model}</span>
          <ChevronDown size={12} className="shrink-0 text-ink-faint transition group-hover:text-ink-soft" />
        </button>
        {editing && <ScheduleModelPicker task={task} onClose={() => setEditing(false)} />}
      </div>
      <p className="mt-2 text-[11px] leading-relaxed text-ink-faint">Runs headless — no approval prompts.</p>
    </SidePanel>
  )
}

/** The model + effort picker for a routine — the shared ModelPickerMenu
 *  (provider → the provider's own catalog → effort, all from the live registry),
 *  so a model registered in the Models section is schedulable too. The pick is
 *  stored as a composed LABEL ("Claude Opus 4.8 · High" / "Provider · Model") —
 *  `parseModelChoice` bridges it back. Each pick applies live via
 *  updateSchedule({ model }); "Done" closes. (Runs are mock-synthesized, so the
 *  field is descriptive — the same honesty boundary as the rest of Scheduled.) */
function ScheduleModelPicker({ task, onClose }: { task: ScheduledTask; onClose: () => void }) {
  // Mounted only while open, so dismiss listeners live for its whole lifetime.
  const ref = useDismissable<HTMLDivElement>(true, onClose)
  const popRef = usePopoverShift<HTMLDivElement>(true)
  const providers = useProviders().data ?? []
  const init = parseModelChoice(task.model, providers)
  const [pick, setPick] = useState<ModelPick>(init.pick)
  const [effort, setEffort] = useState<string | undefined>(init.effort)

  const commit = (nextPick: ModelPick, nextEffort?: string) => {
    setPick(nextPick)
    setEffort(nextEffort)
    void updateSchedule(task.id, { model: composeModelLabel(providers, nextPick, nextEffort) })
  }

  return (
    <div
      ref={(el) => {
        ref.current = el
        popRef.current = el
      }}
      role="dialog"
      aria-label="Model and effort"
      className={`absolute bottom-full right-0 z-30 mb-1.5 w-[300px] overflow-hidden ${POPOVER_SURFACE}`}
    >
      <ModelPickerMenu
        pick={pick}
        effort={effort}
        onPickModel={(next) => commit(next, effort)}
        onPickEffort={(e) => commit(pick, e)}
        onPickProvider={(providerId) => commit({ providerId }, effort)}
      />
      <div className="flex justify-end px-3 pb-2">
        <button onClick={onClose} className="rounded-md px-2 py-1 text-[12px] font-medium text-ink-soft transition hover:text-ink">
          Done
        </button>
      </div>
    </div>
  )
}

function DispatchView() {
  const runs = useDispatchRuns().data ?? []
  return (
    <div className="space-y-2.5">
      {runs.map((r) => (
        <div
          key={r.id}
          className="flex items-start gap-3 rounded-xl border border-line bg-surface px-4 py-3 shadow-sm"
        >
          <DispatchStatus status={r.status} />
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline justify-between gap-2">
              <span className="truncate text-[14px] font-medium text-ink">{r.title}</span>
              <span className="shrink-0 text-[11px] text-ink-faint">
                {r.status === 'running' ? `started ${relativeTime(r.startedAt)}` : relativeTime(r.startedAt)}
              </span>
            </div>
            <p className="mt-0.5 text-[12px] leading-snug text-ink-soft">{r.detail}</p>
          </div>
        </div>
      ))}
    </div>
  )
}

function CustomizeView() {
  return (
    <div className="space-y-3">
      <Card title="Appearance" desc="This prototype ships in a single light theme by design.">
        <div className="flex gap-1.5">
          {(['Light', 'System', 'Dark'] as const).map((opt) => {
            const active = opt === 'Light'
            return (
              <span
                key={opt}
                title={active ? undefined : 'Light theme only in this prototype'}
                aria-disabled={!active}
                className={`rounded-lg px-3 py-1 text-[12px] font-medium ${
                  active ? 'bg-accent text-white' : 'cursor-not-allowed bg-panel-2/50 text-ink-faint line-through'
                }`}
              >
                {opt}
              </span>
            )
          })}
        </div>
      </Card>
      <DefaultModelCard />
      <SystemPromptCard />
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

/** The "Default model" setting — reads & writes the SAME persisted preference the
 *  composer's model control uses (lib/modelPrefs), so changing it here changes what
 *  new sessions start with. The shared ModelPickerMenu, so any registered
 *  provider — and any model from its own catalog — is a valid default too (a
 *  fresh draft starts on it; a later-deleted provider or dropped model degrades
 *  back to the inherit default at send). */
function DefaultModelCard() {
  const [prefs, setPrefs] = useState<ModelPrefs>(loadModelPrefs)
  const [open, setOpen] = useState(false)
  const ref = useDismissable<HTMLDivElement>(open, () => setOpen(false))
  const popRef = usePopoverShift<HTMLDivElement>(open)
  const providers = useProviders().data ?? []
  // Stale-pref tolerance: a pick whose provider/model is gone renders (and
  // behaves) as the inherit default rather than a dangling name — the display
  // resolves against the live registry.
  const pick: ModelPick = { providerId: prefs.providerId, modelId: prefs.modelId }

  const commit = (next: ModelPrefs) => {
    setPrefs(next)
    saveModelPrefs(next)
  }

  return (
    <Card title="Default model" desc="What new sessions and the composer start with.">
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
              onPickModel={(next) =>
                commit({
                  ...prefs,
                  providerId: next.providerId,
                  modelId: next.modelId,
                  ...(isOpusModel(next.modelId) ? {} : { fast: false }),
                })
              }
              onPickEffort={(e) => commit({ ...prefs, effort: e })}
              onPickProvider={(providerId) => commit({ ...prefs, providerId, modelId: undefined })}
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
          {selectedWarning && <AlertCircle size={13} className="text-amber-600" />}
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
                      on ? 'border-accent bg-accent text-white' : 'border-line-strong'
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
                      <span className="mt-1 flex items-start gap-1 text-[11px] leading-snug text-amber-700">
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

/** A foldable section group header — the chevron + label + count disclosure shared
 *  verbatim by the Artifacts, Contexts, and Scheduled lists. Styling (including the
 *  hover cue that signals click-ability) comes from lib/foldHeader, so all three
 *  stay in lockstep instead of drifting between copy-pasted copies. */
function FoldGroupHeader({
  label,
  count,
  folded,
  onToggle,
}: {
  label: string
  count: number
  folded: boolean
  onToggle: () => void
}) {
  return (
    <button onClick={onToggle} aria-expanded={!folded} className={FOLD_HEADER_CLASS}>
      <ChevronDown
        size={15}
        className={`text-ink-faint transition group-hover:text-ink-soft ${folded ? '-rotate-90' : ''}`}
      />
      <span className="text-[13px] font-semibold text-ink">{label}</span>
      <span className="text-[12px] text-ink-faint">{count}</span>
    </button>
  )
}

function Page({ children }: { children: ReactNode }) {
  return (
    // A @container: page-INTERNAL layout switches (a detail's side column, a
    // card grid's column count) gate on THIS element's width — a page renders
    // full-surface or in a half-width split pane, so a viewport breakpoint
    // (`lg:`) is the wrong variable (UI-9 generalized: at a 1280px window,
    // `lg:` held two columns inside a 500px pane and squeezed both).
    <div className="flex-1 overflow-y-auto @container">
      <div className="mx-auto w-full max-w-5xl px-4 py-5 sm:px-6 sm:py-6">{children}</div>
    </div>
  )
}

function PageHeader({
  title,
  badge,
  subtitle,
  children,
}: {
  title: string
  badge?: ReactNode
  subtitle?: ReactNode
  children?: ReactNode
}) {
  // A hub reached through an in-page door carries the back affordance too
  // (ADAPT-18) — the identical control the detail pages lead with. Rendered
  // OUTSIDE the max-sm:hidden title (the NarrowBar carries the title below
  // sm, but back must stay reachable there).
  const back = useContext(PageBackContext)
  return (
    <header className={PAGE_HEADER_CLASS}>
      <div className="flex min-w-0 items-start gap-1">
        {back && <BackButton to={back.to} onBack={back.onBack} />}
        <div className="min-w-0">
          {/* Below sm the shell's NarrowBar already carries the section title —
              repeating it here would read twice on one screen. */}
          <div className="flex items-center gap-2 max-sm:hidden">
            <h1 className={PAGE_TITLE_CLASS}>{title}</h1>
            {badge}
          </div>
          {subtitle && <p className="mt-1 text-sm text-ink-soft max-sm:mt-0">{subtitle}</p>}
        </div>
      </div>
      {children && <div className="flex min-w-0 shrink-0 flex-wrap items-center gap-2.5">{children}</div>}
    </header>
  )
}

function PrimaryButton({
  icon,
  children,
  onClick,
}: {
  icon?: ReactNode
  children: ReactNode
  onClick?: () => void
}) {
  return (
    <button
      onClick={onClick}
      className="flex shrink-0 items-center gap-1.5 rounded-lg bg-ink px-3.5 py-1.5 text-[13px] font-medium text-canvas shadow-sm transition hover:opacity-90"
    >
      {icon}
      {children}
    </button>
  )
}

function SearchBox({
  value,
  onChange,
  placeholder,
}: {
  value: string
  onChange: (v: string) => void
  placeholder: string
}) {
  return (
    <div className="mb-5 flex items-center gap-2.5 rounded-xl border border-line bg-surface px-3.5 py-2.5 shadow-sm transition focus-within:border-accent">
      <Search size={17} className="shrink-0 text-ink-faint" />
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="flex-1 bg-transparent text-[14px] text-ink outline-none placeholder:text-ink-faint"
      />
    </div>
  )
}

function Dropdown({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: string
  options: string[]
  onChange: (v: string) => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useDismissable<HTMLDivElement>(open, () => setOpen(false))
  const popRef = usePopoverShift<HTMLDivElement>(open)

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1.5 rounded-lg border border-line-strong bg-surface px-3 py-1.5 text-[13px] text-ink shadow-sm transition hover:border-accent"
      >
        <span className="text-ink-faint">{label}</span>
        <span className="font-medium">{value}</span>
        <ChevronDown size={14} className={`text-ink-faint transition ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div ref={popRef} className={`absolute right-0 z-20 mt-1 w-44 overflow-hidden py-1 ${POPOVER_SURFACE}`}>
          {options.map((opt) => (
            <button
              key={opt}
              onClick={() => {
                onChange(opt)
                setOpen(false)
              }}
              className={`flex w-full items-center justify-between px-3 py-1.5 text-left text-[13px] transition hover:bg-panel-2 ${
                opt === value ? 'font-medium text-accent-strong' : 'text-ink'
              }`}
            >
              {opt}
              {opt === value && <Check size={14} />}
            </button>
          ))}
        </div>
      )}
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

/** A section header's right-aligned verb cluster — hover-revealed (SECTION_REVEAL),
 *  pinned visible via `revealed` when the section is empty (the action then IS the
 *  content). Negative block margin swallows the h-6 buttons' extra height so a
 *  header with actions keeps the exact rhythm of one without. */
function SectionActions({ children, revealed }: { children: ReactNode; revealed?: boolean }) {
  return (
    <div className={`-my-1.5 flex shrink-0 items-center gap-0.5 ${SECTION_REVEAL} ${revealed ? 'opacity-100' : ''}`}>
      {children}
    </div>
  )
}

function SidePanel({
  title,
  icon,
  actions,
  revealActions,
  children,
}: {
  title: string
  icon: ReactNode
  /** Header verbs (SectionAction buttons / popover triggers), hover-revealed. */
  actions?: ReactNode
  /** Pin the verbs visible — pass "the section is empty" (discoverability). */
  revealActions?: boolean
  children: ReactNode
}) {
  return (
    <div className={`rounded-xl border border-line bg-surface p-4 shadow-sm ${SECTION_REVEAL_GROUP}`}>
      <div className="mb-2.5 flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
          {icon}
          {title}
        </div>
        {actions && <SectionActions revealed={revealActions}>{actions}</SectionActions>}
      </div>
      {children}
    </div>
  )
}

/** A MAIN-column section (S17) — the Recent-sessions idiom shared: a bare uppercase
 *  heading (PanelLabel) with the content below it, NOT a boxed card. SidePanel (the
 *  heading INSIDE the box) is the rail panel's chrome; a main-column section wearing
 *  it reads as a stray rail panel. The section's list cards through <CardList>.
 *  `actions`/`revealActions`: the same header verb cluster SidePanel carries. */
function MainSection({
  title,
  actions,
  revealActions,
  children,
}: {
  title: string
  actions?: ReactNode
  revealActions?: boolean
  children: ReactNode
}) {
  return (
    <section className={SECTION_REVEAL_GROUP}>
      <div className="mb-2 flex items-center justify-between gap-2">
        <PanelLabel flush>{title}</PanelLabel>
        {actions && <SectionActions revealed={revealActions}>{actions}</SectionActions>}
      </div>
      {children}
    </section>
  )
}

/** The one main-column LIST container (Recent sessions' box, shared): the ITEMS are
 *  what's carded — one bordered surface around the list, rows divided — while the
 *  section around it stays a bare heading (S17). */
function CardList({ children }: { children: ReactNode }) {
  return (
    <div className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface shadow-sm">
      {children}
    </div>
  )
}

function Empty({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-line py-12 text-center text-[13px] text-ink-faint">
      {children}
    </div>
  )
}

function DispatchStatus({ status }: { status: DispatchRun['status'] }) {
  if (status === 'running')
    return <Spinner size={17} className="mt-0.5 shrink-0 text-accent" />
  if (status === 'failed') return <AlertCircle size={17} className="mt-0.5 shrink-0 text-red-500" />
  return <CheckCircle2 size={17} className="mt-0.5 shrink-0 text-emerald-500" />
}

function Toggle({ on, onToggle, ariaLabel }: { on: boolean; onToggle: () => void; ariaLabel?: string }) {
  return (
    <button
      type="button"
      // A switch, announced as one: role + checked state so a screen reader says
      // "‹name›, switch, on/off" instead of an unnamed, stateless button (WCAG 4.1.2).
      role="switch"
      aria-checked={on}
      aria-label={ariaLabel}
      onClick={onToggle}
      className={`relative h-5 w-9 shrink-0 rounded-full transition ${on ? 'bg-accent' : 'bg-line-strong'}`}
      title={on ? 'Enabled' : 'Disabled'}
    >
      <span
        className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all ${
          on ? 'left-[18px]' : 'left-0.5'
        }`}
      />
    </button>
  )
}

function Card({ title, desc, children }: { title: string; desc: string; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-xl border border-line bg-surface px-4 py-3 shadow-sm">
      {/* The label keeps a readable basis; a control that can't fit beside it
          wraps below instead of squeezing the text one word per line. */}
      <div className="min-w-0 flex-1 basis-56">
        <div className="text-[14px] font-medium text-ink">{title}</div>
        <div className="text-[12px] text-ink-faint">{desc}</div>
      </div>
      <div className="shrink-0">{children}</div>
    </div>
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
