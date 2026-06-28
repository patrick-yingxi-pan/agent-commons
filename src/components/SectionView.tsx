import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import {
  AlertCircle,
  ArrowLeft,
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
  Copy,
  Cpu,
  FileText,
  Folder,
  FolderGit2,
  GitBranch,
  Github,
  Globe,
  Loader2,
  Mail,
  MessageSquare,
  MinusCircle,
  PauseCircle,
  Pencil,
  Play,
  PlayCircle,
  Plug,
  Plus,
  Search,
  SendHorizontal,
  Server,
  Sparkles,
  SquareKanban,
  Trash2,
  Unplug,
  X,
  type LucideIcon,
} from 'lucide-react'
import type { AddedContext, ArtifactKind, Connector, SectionId } from '../types'
import { SECTION_META } from '../lib/sections'
import { FOLD_HEADER_CLASS } from '../lib/foldHeader'
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
import { EFFORTS, MODELS, composeModelLabel, parseModelLabel, type Effort, type ModelId } from '../lib/models'
import { loadModelPrefs, saveModelPrefs, type ModelPrefs } from '../lib/modelPrefs'
import { STEP_TOOLS } from '../lib/stepTools'
import { cleanSteps, moveStep, removeStep } from '../lib/steps'
import { ConnectorDetailBody } from './ConnectorPanel'
import { AddContextButton } from './AddContextButton'
import { AddTrigger } from './AddTrigger'
import { INLINE_ACTION_CLASS } from '../lib/inlineAction'
import { resolveBackLabel, type NavLocation } from '../lib/nav'
import { relativeTime } from '../lib/relativeTime'
import { Chip } from './Chip'
import { RowMenu, type RowMenuItem } from './RowMenu'
import { ClaudeMark } from './ClaudeMark'
import { SAVED_CONTEXTS, type SavedContext, type SavedContextKind } from '../data/savedContexts'
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
  setConnectorStatus,
  toggleScheduleEnabled,
  updateSchedule,
  createCommission,
  createProvider,
  updateProvider,
  deleteProvider,
  createSystemPrompt,
  updateSystemPrompt,
  deleteSystemPrompt,
  createAgent,
  updateAgent,
  deleteAgent,
  reserveSubGoal,
  releaseSubGoal,
  useAgents,
  useCommissions,
  useCommissionAuthority,
  useProjectSubGoals,
  useDispatchRuns,
  useProviders,
  useSavedContexts,
  useScheduleTemplates,
  useSchedules,
  useSessions,
  useSystemPrompts,
} from '../api'
import {
  promptFitWarning,
  type Agent,
  type Commission,
  type ModelProvider,
  type SystemPromptEntry,
} from '../../contract/index.ts'
import { authorityLabel, providerPlanLabel } from '../lib/agentCommonsLabels'
import { ArtifactThumb, ArtifactViewer, KIND_ICON, KIND_LABEL } from './artifactPreview'
import { useFocusTrap } from '../lib/useFocusTrap'
import { useDismissable } from '../lib/useDismissable'
import { useRelations } from '../controller/useRelations'
import { runSessionId, slug } from '../../contract/ids.ts'

/** The main area when a cross-cutting tool (Projects, Artifacts, …) is open
 *  instead of a conversation. All content is mock — this is a clickable demo.
 *  Projects and Artifacts get their own desktop-app-style layouts; the simpler
 *  tools share the generic header + body. */
export function SectionView({
  section,
  onOpenSession,
  onNewSession,
  onOpenProject,
  onOpenSchedule,
  onBack,
  backTo,
  railCollapsed = false,
  focusProjectId = null,
  focusScheduleId = null,
}: {
  section: SectionId
  onOpenSession: (id: string) => void
  onNewSession: () => void
  /** Open a project / routine detail through the controller, so every entry is one
   *  source of truth (the focus id below) and is recorded in navigation history. */
  onOpenProject: (id: string) => void
  onOpenSchedule: (id: string) => void
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
}) {
  const body =
    section === 'projects' ? (
      <ProjectsSection
        projectId={focusProjectId}
        onOpenProject={onOpenProject}
        onBack={onBack}
        backTo={backTo}
        onOpenSession={onOpenSession}
        onNewSession={onNewSession}
      />
    ) : section === 'artifacts' ? (
      <ArtifactsSection onOpenSession={onOpenSession} />
    ) : section === 'contexts' ? (
      <ContextsSection />
    ) : section === 'agents' ? (
      <AgentCommonsSection />
    ) : section === 'scheduled' ? (
      <ScheduledSection
        scheduleId={focusScheduleId}
        onOpenSchedule={onOpenSchedule}
        onBack={onBack}
        backTo={backTo}
        onOpenSession={onOpenSession}
      />
    ) : (
      <GenericSection section={section} />
    )
  return (
    <div className={`flex min-h-0 flex-1 flex-col ${railCollapsed ? 'pl-8' : ''}`}>{body}</div>
  )
}

/** The dynamic back button — returns to the previous page in navigation history
 *  (not a fixed structural parent) and names that destination, resolving the live
 *  project / routine name. Shared by the detail pages so the cue is identical. */
function BackButton({ to, onBack }: { to: NavLocation | null; onBack: () => void }) {
  const projects = useRelations().allProjects()
  const schedules = useSchedules().data ?? []
  const label = resolveBackLabel(to, {
    project: Object.fromEntries(projects.map((p) => [p.id, p.name])),
    schedule: Object.fromEntries(schedules.map((s) => [s.id, s.name])),
  })
  return (
    <button
      onClick={onBack}
      title={`Back to ${label}`}
      className="mb-4 inline-flex max-w-full items-center gap-1.5 text-[13px] font-medium text-ink-soft transition hover:text-ink"
    >
      <ArrowLeft size={15} className="shrink-0" />
      <span className="truncate">{label}</span>
    </button>
  )
}

/* ─────────────────────────── Projects ─────────────────────────── */

function ProjectsSection({
  projectId,
  onOpenProject,
  onBack,
  backTo,
  onOpenSession,
  onNewSession,
}: {
  /** Which project detail to show (null = the list) — the controlled source of
   *  truth, set by the controller however the detail was reached. */
  projectId: string | null
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
  // Includes projects created mid-tour (the relation graph's extras), so a freshly
  // created project shows in the list and opens to its detail like any seed one.
  const projects = rel.allProjects()

  // Create a project from the dialog: mint a unique id (across seed + created
  // ones, so a duplicate name can't re-file into an existing project), apply the
  // sessionless create-project op (optimistic + persisted + broadcast), then open
  // the new project — it's already in `projects` via the optimistic graph patch.
  const createProject = (name: string, description: string) => {
    const id = uniqueProjectId(name, new Set(projects.map((p) => p.id)))
    rel.applyOp({ kind: 'create-project', projectId: id, projectName: name, projectDescription: description })
    setCreating(false)
    onOpenProject(id)
  }

  const open = projectId ? (projects.find((p) => p.id === projectId) ?? null) : null
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

  return (
    <Page>
      <PageHeader title="Projects">
        <Dropdown label="Sort by" value={sort} options={['Last updated', 'Name']} onChange={setSort} />
        <PrimaryButton icon={<Plus size={15} />} onClick={() => setCreating(true)}>
          New project
        </PrimaryButton>
      </PageHeader>
      <SearchBox value={query} onChange={setQuery} placeholder="Search projects…" />
      {sorted.length === 0 ? (
        <Empty>
          {query.trim() ? `No projects match “${query.trim()}”.` : 'No projects yet — create one to group related work.'}
        </Empty>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {sorted.map((p) => (
            <ProjectCard
              key={p.id}
              project={p}
              sessionCount={rel.sessionsForProject(p.id).length}
              onOpen={() => onOpenProject(p.id)}
            />
          ))}
        </div>
      )}
      {creating && <NewProjectDialog onCreate={createProject} onClose={() => setCreating(false)} />}
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
  if (!taken.has(base)) return base
  let n = 2
  while (taken.has(`${base}-${n}`)) n += 1
  return `${base}-${n}`
}

/** The "New project" form — a centered modal (same idiom as ArtifactViewer): a
 *  required name and an optional description. Enter (in the name field) or the
 *  Create button submits; Escape, the backdrop, or Cancel dismisses. */
function NewProjectDialog({
  onCreate,
  onClose,
}: {
  onCreate: (name: string, description: string) => void
  onClose: () => void
}) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const dialogRef = useRef<HTMLDivElement>(null)
  const nameRef = useRef<HTMLInputElement>(null)

  // Focus the name field on open, trap Tab within the dialog, close on Escape,
  // restore focus on close.
  useFocusTrap(dialogRef, onClose, { initialFocus: nameRef })

  const canCreate = name.trim().length > 0
  const submit = () => {
    if (canCreate) onCreate(name.trim(), description.trim())
  }

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex justify-center px-4 pt-[14vh]"
      onMouseDown={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="New project"
    >
      <div className="absolute inset-0 bg-black/30 backdrop-blur-[1px]" />
      <div
        ref={dialogRef}
        onMouseDown={(e) => e.stopPropagation()}
        className="relative flex h-fit w-[460px] max-w-full flex-col overflow-hidden rounded-xl bg-surface shadow-2xl ring-1 ring-line-strong"
      >
        <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
          <div className="flex items-center gap-2">
            <Box size={18} className="text-cap-workspace" />
            <span className="text-[15px] font-semibold text-ink">New project</span>
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
              placeholder="e.g. Insights dashboard"
              className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-[14px] text-ink outline-none transition placeholder:text-ink-faint focus:border-accent"
            />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-[12px] font-medium text-ink-soft">
              Description <span className="font-normal text-ink-faint">(optional)</span>
            </span>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              placeholder="What this project groups together."
              className="w-full resize-none rounded-lg border border-line bg-surface px-3 py-2 text-[14px] leading-relaxed text-ink outline-none transition placeholder:text-ink-faint focus:border-accent"
            />
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
            Create project
          </button>
        </div>
      </div>
    </div>,
    document.body,
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
      className="flex min-h-[150px] flex-col rounded-2xl border border-line bg-surface p-5 text-left shadow-sm transition hover:border-line-strong hover:shadow"
    >
      <div className="text-[15px] font-semibold text-ink">{project.name}</div>
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

  return (
    <Page>
      <BackButton to={backTo} onBack={onBack} />

      <header className="mb-6 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="font-serif text-2xl font-semibold text-ink">{project.name}</h1>
          <p className="mt-1 text-sm text-ink-soft">{project.description}</p>
        </div>
        <PrimaryButton icon={<Plus size={15} />} onClick={onNewSession}>
          New session
        </PrimaryButton>
      </header>

      <div className="flex flex-col gap-6 lg:flex-row">
        {/* Main panel — the project's recent sessions. */}
        <div className="min-w-0 flex-1">
          <PanelLabel>Recent sessions</PanelLabel>
          {convs.length === 0 ? (
            <Empty>No sessions in this project yet.</Empty>
          ) : (
            <div className="overflow-hidden rounded-xl border border-line bg-surface shadow-sm">
              {convs.map((c, i) => (
                <div
                  key={c.id}
                  className={`group flex items-center transition hover:bg-panel-2/60 ${
                    i > 0 ? 'border-t border-line' : ''
                  }`}
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
                      className="mr-2 flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-ink-faint opacity-0 transition hover:bg-removed-bg hover:text-removed focus-visible:opacity-100 group-hover:opacity-100"
                    >
                      <MinusCircle size={15} />
                    </button>
                  </Tooltip>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Right panel — instructions, scheduled runs, and attached context. */}
        <aside className="w-full shrink-0 space-y-4 lg:w-72">
          <ProjectInstructions project={project} />

          <ContributorsPanel project={project} />

          <CoordinationPanel project={project} />

          <SidePanel title="Scheduled" icon={<Clock size={14} />}>
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
            <ProjectScheduleAdd
              linkedIds={new Set(realSchedules.map((t) => t.id))}
              onCreate={createSchedule}
              onLink={linkSchedule}
            />
          </SidePanel>

          <SidePanel title="Context" icon={<Folder size={14} />}>
            {contexts.length === 0 ? (
              <p className="text-[12px] text-ink-faint">No context attached yet.</p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {contexts.map((ctx, i) => (
                  <ProjectContextChip key={`${ctx.label}-${i}`} ctx={ctx} onRemove={() => removeContext(ctx.label)} />
                ))}
              </div>
            )}
            <div className="mt-2.5 border-t border-line pt-2.5">
              <AddContextButton
                variant="inline"
                onAttach={attachToProject}
                connectors={contextsToConnectors(contexts)}
                repos={[]}
                attachments={[]}
                workspaces={[]}
              />
            </div>
          </SidePanel>
        </aside>
      </div>
    </Page>
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
    <SidePanel title="Instructions" icon={<FileText size={14} />}>
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
          <button onClick={startEdit} className={`mt-2.5 ${INLINE_ACTION_CLASS}`}>
            <Pencil size={12} />
            {current ? 'Edit' : 'Add instructions'}
          </button>
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
            className="flex h-6 w-6 items-center justify-center rounded-md text-ink-faint opacity-0 transition hover:bg-panel-2 hover:text-ink focus-visible:opacity-100 group-hover:opacity-100"
          >
            {running ? <Loader2 size={13} className="animate-spin" /> : <Play size={13} />}
          </button>
        </Tooltip>
        <RowMenu ariaLabel={`Actions for ${task.name}`} items={menu} />
        <Toggle on={task.enabled} onToggle={onToggle} />
      </div>
    </div>
  )
}

/** A scoped context rendered as the session composer's Chip — the same tinted
 *  pill, with a hover-revealed ✕ that unscopes it (mirroring the composer's
 *  single-chip remove). The meta (branch, file count, …) surfaces as the hover
 *  tooltip since the pill itself only shows the label. */
function ProjectContextChip({ ctx, onRemove }: { ctx: ProjectContext; onRemove: () => void }) {
  const CIcon = CONTEXT_ICON[ctx.kind]
  return (
    <div className="group/chip relative inline-flex">
      <Chip icon={<CIcon size={12} />} tone={projectContextTone(ctx.kind)} active={false} hint={ctx.meta || ctx.label}>
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

/** The Scheduled card's create / link control — a "+ Add routine" trigger whose
 *  popover offers a template to spin up a NEW routine (pre-linked to this project)
 *  or an existing unlinked routine to LINK in. Both run on existing primitives:
 *  create = addScheduleFromSeed → link-schedule-project; link = link-schedule-project. */
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
  const templates = useScheduleTemplates().data ?? []
  const allSchedules = useSchedules().data ?? []
  const linkable = allSchedules.filter((t) => !linkedIds.has(t.id))

  return (
    <div ref={ref} className="relative mt-2.5 border-t border-line pt-2.5">
      <AddTrigger label="Add routine" open={open} onClick={() => setOpen((o) => !o)} />

      {open && (
        <div
          role="dialog"
          aria-label="Add a scheduled routine"
          className="absolute right-0 top-full z-30 mt-1.5 max-h-[360px] w-[300px] overflow-y-auto rounded-xl border border-line-strong bg-surface p-2 shadow-xl"
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
function ContributorsPanel({ project }: { project: Project }) {
  const commissions = useCommissions(project.id).data ?? []
  const agents = useAgents().data ?? []
  const agentsById = new Map(agents.map((a) => [a.id, a]))
  const commissionedIds = new Set(commissions.map((c) => c.agentId))
  const available = agents.filter((a) => !commissionedIds.has(a.id))

  return (
    <SidePanel title="Contributors" icon={<Cpu size={14} />}>
      {commissions.length === 0 ? (
        <p className="text-[12px] text-ink-faint">No agents commissioned yet.</p>
      ) : (
        <div className="space-y-2.5">
          {commissions.map((c) => (
            <ContributorRow key={c.id} commission={c} agentLabel={agentsById.get(c.agentId)?.label ?? c.agentId} />
          ))}
        </div>
      )}
      <CommissionAdd projectId={project.id} available={available} />
    </SidePanel>
  )
}

/** One Contributor row — the Agent's label + its **effective, Project-clamped reach**
 *  (D12): the connectors this Contributor can actually touch on the Project, which is
 *  its granted authority intersected with what the Project admits — never the owner's
 *  ambient set. Default-deny: an Agent granted everything still reaches only the
 *  Project's connectors. */
function ContributorRow({ commission, agentLabel }: { commission: Commission; agentLabel: string }) {
  const reach = useCommissionAuthority(commission.id).data
  // Post-clamp the connectors are always a concrete set (the Project admits a concrete
  // list); show them as the visible isolation boundary.
  const connectors = reach?.connectors ?? []
  const reachLabel =
    reach === undefined
      ? 'Resolving reach…'
      : connectors.length === 0
        ? 'Reaches no connectors on this project'
        : `Reaches ${connectors.join(' · ')}`
  return (
    <div className="flex items-start gap-2.5">
      <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500" />
      <div className="min-w-0">
        <div className="text-[13px] font-medium text-ink">{agentLabel}</div>
        <div className="text-[11px] text-ink-faint">{reachLabel}</div>
      </div>
    </div>
  )
}

/** The "Commission an agent" picker — the inline-add primitive (AddTrigger), listing
 *  the Agents not already contributing. Picking one POSTs a commission (inheriting the
 *  Agent's grant) and the panel refreshes via the commissions cache. */
function CommissionAdd({ projectId, available }: { projectId: string; available: Agent[] }) {
  const [open, setOpen] = useState(false)
  const ref = useDismissable<HTMLDivElement>(open, () => setOpen(false))
  const [pending, setPending] = useState<string | null>(null)

  const commission = async (agent: Agent) => {
    setPending(agent.id)
    try {
      await createCommission({ agentId: agent.id, projectId })
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
    <div ref={ref} className="relative mt-2.5 border-t border-line pt-2.5">
      <AddTrigger label="Commission an agent" open={open} onClick={() => setOpen((o) => !o)} />

      {open && (
        <div
          role="dialog"
          aria-label="Commission an agent"
          className="absolute right-0 top-full z-30 mt-1.5 w-[280px] rounded-xl border border-line-strong bg-surface p-2 shadow-xl"
        >
          {available.length === 0 ? (
            <p className="px-1.5 py-1 text-[12px] text-ink-faint">Every agent is already a Contributor.</p>
          ) : (
            available.map((a) => (
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
            ))
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

  const claim = async () => {
    const subGoal = draft.trim()
    if (!subGoal || busy) return
    setBusy(true)
    setConflict(null)
    try {
      await reserveSubGoal(project.id, VIEWER_PRINCIPAL, subGoal)
      setDraft('')
    } catch {
      // The guardian refused it — another Contributor holds this sub-goal. Conflict is a
      // question, not an abort: prompt to pick a different one (D11).
      setConflict(`"${subGoal}" is held by another Contributor — pick a different sub-goal.`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <SidePanel title="Coordination" icon={<GitBranch size={14} />}>
      {!guarded ? (
        <p className="text-[12px] text-ink-faint">This project isn’t a guarded resource.</p>
      ) : (
        <>
          {subGoals.length === 0 ? (
            <p className="text-[12px] text-ink-faint">No sub-goals in flight.</p>
          ) : (
            <div className="space-y-2.5">
              {subGoals.map((s) => (
                <div key={s.reservationId} className="group flex items-start gap-2.5">
                  <span
                    className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${
                      s.status === 'committed' ? 'bg-accent' : 'bg-emerald-500'
                    }`}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="text-[13px] font-medium text-ink">{s.subGoal}</div>
                    <div className="text-[11px] text-ink-faint">held by {s.holderLabel}</div>
                  </div>
                  <button
                    onClick={() => void releaseSubGoal(s.reservationId, project.id)}
                    aria-label={`Release ${s.subGoal}`}
                    className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-ink-faint opacity-0 transition hover:bg-removed-bg hover:text-removed focus-visible:opacity-100 group-hover:opacity-100"
                  >
                    <X size={13} />
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="mt-2.5 border-t border-line pt-2.5">
            <div className="flex items-center gap-1.5">
              <input
                value={draft}
                onChange={(e) => {
                  setDraft(e.target.value)
                  setConflict(null)
                }}
                onKeyDown={(e) => e.key === 'Enter' && claim()}
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
        </>
      )}
    </SidePanel>
  )
}

/* ─────────────────────────── Artifacts ─────────────────────────── */

const ARTIFACT_FILTERS = ['All', 'Documents', 'Images', 'Sheets', 'Slides', 'Emails']

function ArtifactsSection({ onOpenSession }: { onOpenSession: (id: string) => void }) {
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState('All')
  const [openId, setOpenId] = useState<string | null>(null)
  const [folded, setFolded] = useState<Set<string>>(new Set())
  const [creating, setCreating] = useState(false)
  const rel = useRelations()
  const projects = rel.allProjects()
  const sessions = useSessions().data ?? []
  // Resolve an artifact's `source` (the conversation that produced it, stored as a
  // title — artifacts carry no session id) to a real session, so "From ‹conversation›"
  // can navigate there. A created/sourceless artifact ("Created here") or a source
  // that isn't a known conversation simply has no match and stays a plain label.
  const sessionIdByTitle = useMemo(() => {
    const m = new Map<string, string>()
    for (const s of sessions) if (!m.has(s.title)) m.set(s.title, s.id)
    return m
  }, [sessions])

  const foldGroup = (id: string) =>
    setFolded((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })

  const needle = query.trim().toLowerCase()
  const wantKind =
    filter === 'Documents'
      ? 'doc'
      : filter === 'Images'
        ? 'image'
        : filter === 'Sheets'
          ? 'sheet'
          : filter === 'Slides'
            ? 'slide'
            : filter === 'Emails'
              ? 'email'
              : null

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
        <Dropdown label="Filter by" value={filter} options={ARTIFACT_FILTERS} onChange={setFilter} />
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
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
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
            const sid = sessionIdByTitle.get(openArtifact.source)
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
      className="fixed inset-0 z-50 flex justify-center px-4 pt-[12vh]"
      onMouseDown={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="New artifact"
    >
      <div className="absolute inset-0 bg-black/30 backdrop-blur-[1px]" />
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

const CONTEXT_FILTERS = ['All', 'Connectors', 'MCP servers', 'Repositories']

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
          role="dialog"
          aria-label="Add context"
          className="absolute right-0 z-30 mt-2 w-[320px] overflow-hidden rounded-xl border border-line-strong bg-surface shadow-xl"
        >
          <div className="max-h-[min(60vh,420px)] overflow-y-auto p-2">
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

function ContextsSection() {
  // The base list is server-owned: a connect / disconnect routes through the server,
  // which broadcasts `connector.status`, so the row's auth state reconciles here and
  // on every other client. Fall back to the seed while the first fetch is in flight.
  const saved = useSavedContexts()
  const base = saved.data?.contexts ?? SAVED_CONTEXTS
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState('All')
  // Which group headers are folded shut, and which context is opened in detail.
  const [folded, setFolded] = useState<Set<SavedContextKind>>(new Set())
  const [openId, setOpenId] = useState<string | null>(null)
  // Add / remove are local view conveniences (not server-backed): `removed` hides a
  // base row; `extra` layers locally set-up contexts on top.
  const [removed, setRemoved] = useState<Set<string>>(new Set())
  const [extra, setExtra] = useState<SavedContext[]>([])
  const items = [...extra, ...base.filter((c) => !removed.has(c.id))]

  // Connect / disconnect: a server-owned connector goes through the server (real
  // `connector.status` broadcast); a locally-added one flips in view state.
  const toggle = (id: string) => {
    const serverItem = base.find((c) => c.id === id)
    if (serverItem) {
      void setConnectorStatus(id, serverItem.status === 'connected' ? 'needs-auth' : 'connected')
    } else {
      setExtra((prev) =>
        prev.map((c) =>
          c.id === id ? { ...c, status: c.status === 'connected' ? 'needs-auth' : 'connected' } : c,
        ),
      )
    }
  }
  const remove = (id: string) => {
    setRemoved((prev) => new Set(prev).add(id))
    setExtra((prev) => prev.filter((c) => c.id !== id))
  }
  const add = (ctx: SavedContext) => {
    if (base.some((c) => c.id === ctx.id)) {
      // Re-adding a hidden base row just un-hides it.
      setRemoved((prev) => {
        const next = new Set(prev)
        next.delete(ctx.id)
        return next
      })
    } else {
      setExtra((prev) => (prev.some((c) => c.id === ctx.id) ? prev : [ctx, ...prev]))
    }
  }
  const foldGroup = (kind: SavedContextKind) =>
    setFolded((prev) => {
      const next = new Set(prev)
      next.has(kind) ? next.delete(kind) : next.add(kind)
      return next
    })

  // Clicking a row drills into the same detail a session shows for that context.
  const open = openId ? (items.find((c) => c.id === openId) ?? null) : null
  if (open)
    return (
      <ContextDetail
        ctx={open}
        onBack={() => setOpenId(null)}
        onToggle={() => toggle(open.id)}
        onRemove={() => {
          remove(open.id)
          setOpenId(null)
        }}
      />
    )

  const needle = query.trim().toLowerCase()
  const wantKind =
    filter === 'Connectors' ? 'connector' : filter === 'MCP servers' ? 'mcp' : filter === 'Repositories' ? 'repo' : null

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
        <Dropdown label="Show" value={filter} options={CONTEXT_FILTERS} onChange={setFilter} />
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
                        onOpen={() => setOpenId(c.id)}
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
    </Page>
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
        {ctx.kind === 'repo' ? (
          <StatusPill tone="neutral" label={ctx.dependsOnGitHub ? 'via GitHub' : 'Local only'} />
        ) : (
          <StatusPill tone={connected ? 'ok' : 'warn'} label={connected ? 'Connected' : 'Needs auth'} />
        )}

        {/* Hover-revealed actions — same idiom as the panel's per-folder delete. */}
        <div className="flex items-center gap-1 opacity-0 transition focus-within:opacity-100 group-hover:opacity-100">
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
  onToggle,
  onRemove,
}: {
  ctx: SavedContext
  onBack: () => void
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
      {/* The Contexts detail is only ever reached from the Contexts list, so back
          is always that list — a fixed location handed to the shared BackButton so
          all three detail pages share one cue. */}
      <BackButton to={{ kind: 'section', section: 'contexts', projectId: null, scheduleId: null }} onBack={onBack} />

      <header className="mb-6 flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-panel-2 text-ink-soft">
            <Icon size={20} />
          </span>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="truncate font-serif text-2xl font-semibold text-ink">{ctx.label}</h1>
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

      <div className="flex flex-col gap-6 lg:flex-row">
        <div className="min-w-0 flex-1">
          <div className="rounded-xl border border-line bg-surface p-4 shadow-sm">
            {isRepo ? (
              <RepoDetailBody ctx={ctx} />
            ) : (
              <ConnectorDetailBody connector={asConnector} connected={connected} />
            )}
          </div>
        </div>

        <aside className="w-full shrink-0 space-y-4 lg:w-72">
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
 *  commissions placing them on Projects. Sub-tabs because the four concepts are
 *  interdependent (an Agent binds a provider + prompt; a commission binds an Agent to a
 *  Project), so they read as one surface rather than four nav rows. Slice 1 lists each
 *  read-only; later slices add create / edit / delete per tab. */
type CommonsTab = 'agents' | 'providers' | 'prompts' | 'commissions'

const COMMONS_TABS: { id: CommonsTab; label: string }[] = [
  { id: 'agents', label: 'Agents' },
  { id: 'providers', label: 'Providers' },
  { id: 'prompts', label: 'Prompts' },
  { id: 'commissions', label: 'Commissions' },
]

function AgentCommonsSection() {
  const [tab, setTab] = useState<CommonsTab>('agents')
  return (
    <Page>
      <PageHeader title="Agents" />
      <p className="-mt-2 mb-4 text-[13px] leading-relaxed text-ink-soft">
        Your worker agents and the fabric they run on — the{' '}
        <span className="font-medium text-ink">providers</span> that supply cognition, the{' '}
        <span className="font-medium text-ink">prompts</span> they start from, and the{' '}
        <span className="font-medium text-ink">commissions</span> placing them on projects.
      </p>
      <SubTabs tabs={COMMONS_TABS} active={tab} onChange={setTab} />
      <div className="mt-5">
        {tab === 'agents' && <AgentsTab />}
        {tab === 'providers' && <ProvidersTab />}
        {tab === 'prompts' && <PromptsTab />}
        {tab === 'commissions' && <CommissionsTab />}
      </div>
    </Page>
  )
}

/** A segmented control for a section's sub-views — the in-page sibling of the nav rail. */
function SubTabs<T extends string>({
  tabs,
  active,
  onChange,
}: {
  tabs: { id: T; label: string }[]
  active: T
  onChange: (id: T) => void
}) {
  return (
    <div className="inline-flex items-center gap-1 rounded-lg border border-line bg-surface p-1 shadow-sm">
      {tabs.map((t) => {
        const on = t.id === active
        return (
          <button
            key={t.id}
            onClick={() => onChange(t.id)}
            aria-pressed={on}
            className={`rounded-md px-3 py-1 text-[13px] font-medium transition ${
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
function CommonsCard({ children }: { children: ReactNode }) {
  return <div className="group rounded-xl border border-line bg-surface p-4 shadow-sm">{children}</div>
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
    <div className="flex shrink-0 items-center gap-1 opacity-0 transition focus-within:opacity-100 group-hover:opacity-100">
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
  canSubmit,
  onSubmit,
  onClose,
  error,
  children,
}: {
  title: string
  icon: ReactNode
  submitLabel: string
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
      className="fixed inset-0 z-50 flex justify-center px-4 pt-[14vh]"
      onMouseDown={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div className="absolute inset-0 bg-black/30 backdrop-blur-[1px]" />
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
}: {
  icon: ReactNode
  title: string
  subtitle: ReactNode
  trailing?: ReactNode
}) {
  return (
    <div className="flex items-center gap-2.5">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-panel-2 text-ink-soft">
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[14px] font-medium text-ink">{title}</div>
        <div className="truncate text-[12px] text-ink-faint">{subtitle}</div>
      </div>
      {trailing}
    </div>
  )
}

/** Worker Agents (D6) — label, the provider it runs on, its tool count, and its
 *  authority grant ceiling (D8). Read-only here; create / edit / delete land in a
 *  later slice. */
function AgentsTab() {
  const agents = useAgents().data ?? []
  const providers = useProviders().data ?? []
  const providerLabel = (id?: string) => providers.find((p) => p.id === id)?.label ?? 'Default provider'
  const [editing, setEditing] = useState<Agent | 'new' | null>(null)
  return (
    <div className="space-y-3">
      <TabToolbar newLabel="New agent" onNew={() => setEditing('new')} />
      {agents.length === 0 ? (
        <Empty>No agents yet.</Empty>
      ) : (
        agents.map((a) => (
          <AgentCard key={a.id} agent={a} providerLabel={providerLabel(a.providerId)} onEdit={() => setEditing(a)} />
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
}: {
  agent: Agent
  providerLabel: string
  onEdit: () => void
}) {
  const [error, setError] = useState<string | null>(null)
  const del = async () => {
    setError(null)
    try {
      await deleteAgent(agent.id)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not delete this agent.')
    }
  }
  return (
    <CommonsCard>
      <CommonsCardHead
        icon={<Bot size={16} />}
        title={agent.label}
        subtitle={`Runs on ${providerLabel} · ${agent.tools.length} tool${agent.tools.length === 1 ? '' : 's'}`}
        trailing={<CardActions onEdit={onEdit} onDelete={del} />}
      />
      <p className="mt-2 text-[12px] text-ink-soft">Authority: {authorityLabel(agent.authority)}</p>
      {error && <p className="mt-2 text-[12px] text-removed">{error}</p>}
    </CommonsCard>
  )
}

/** Create / edit an Agent — the bundle that binds a Model provider (D9) to a system
 *  prompt (D10). Both pickers default to the seeded provider / prompt; the prompt's fit
 *  against the chosen provider's family is checked live (the same `promptFitWarning` the
 *  Customize picker uses). New agents inherit the provider's authority + the full tool
 *  catalog; per-axis authority editing is a later refinement. */
function AgentDialog({ agent, onClose }: { agent: Agent | null; onClose: () => void }) {
  const providers = useProviders().data ?? []
  const prompts = useSystemPrompts().data ?? []
  const [label, setLabel] = useState(agent?.label ?? '')
  const [providerId, setProviderId] = useState(agent?.providerId ?? '')
  const [promptId, setPromptId] = useState(agent?.systemPromptId ?? '')
  const [instructions, setInstructions] = useState(agent?.instructions ?? '')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const canSubmit = label.trim().length > 0 && !busy

  // Live fit warning: the chosen prompt's family vs the chosen provider's (the default
  // provider's family when none is chosen — providers[0] is the seeded default).
  const providerFamily = (providers.find((p) => p.id === providerId) ?? providers[0])?.modelFamily ?? 'claude'
  const selectedPrompt = prompts.find((p) => p.id === promptId)
  const warning = selectedPrompt ? promptFitWarning(selectedPrompt, providerFamily) : null

  const submit = async () => {
    if (!canSubmit) return
    setBusy(true)
    setError(null)
    const fields = {
      label: label.trim(),
      providerId,
      systemPromptId: promptId,
      instructions: instructions.trim(),
    }
    try {
      if (agent) await updateAgent(agent.id, fields)
      else await createAgent(fields)
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
        <select value={providerId} onChange={(e) => setProviderId(e.target.value)} className={FORM_INPUT_CLASS}>
          <option value="">Default provider</option>
          {providers.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>
      </FormField>
      <FormField label="System prompt">
        <select value={promptId} onChange={(e) => setPromptId(e.target.value)} className={FORM_INPUT_CLASS}>
          <option value="">Default prompt</option>
          {prompts.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>
        {warning && (
          <span className="mt-1 flex items-center gap-1 text-[11px] text-amber-600">
            <AlertCircle size={12} className="shrink-0" /> {warning}
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

/** Model providers (D9) — the cognition source an Agent binds: family, effort levels,
 *  authority grant, and plan ceiling (the D8 cascade root). Mirrors the composer gauge's
 *  rows in a fuller card. */
function ProvidersTab() {
  const providers = useProviders().data ?? []
  // null = no dialog; 'new' = create; a provider = edit that one.
  const [editing, setEditing] = useState<ModelProvider | 'new' | null>(null)
  return (
    <div className="space-y-3">
      <TabToolbar newLabel="New provider" onNew={() => setEditing('new')} />
      {providers.length === 0 ? (
        <Empty>No providers registered.</Empty>
      ) : (
        providers.map((p) => <ProviderCard key={p.id} provider={p} onEdit={() => setEditing(p)} />)
      )}
      {editing && (
        <ProviderDialog provider={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />
      )}
    </div>
  )
}

function ProviderCard({ provider, onEdit }: { provider: ModelProvider; onEdit: () => void }) {
  const [error, setError] = useState<string | null>(null)
  const del = async () => {
    setError(null)
    try {
      await deleteProvider(provider.id)
    } catch (e) {
      // The server refuses the default / a still-bound provider (409) — show its reason.
      setError(e instanceof Error ? e.message : 'Could not delete this provider.')
    }
  }
  return (
    <CommonsCard>
      <CommonsCardHead
        icon={<Cpu size={16} />}
        title={provider.label}
        subtitle={provider.modelFamily}
        trailing={<CardActions onEdit={onEdit} onDelete={del} />}
      />
      <div className="mt-2 flex flex-wrap gap-1">
        {provider.effortLevels.map((e) => (
          <span key={e} className="rounded bg-panel-2 px-1.5 py-0.5 text-[10px] text-ink-faint">
            {e}
          </span>
        ))}
      </div>
      <p className="mt-2 text-[12px] text-ink-soft">Grants {authorityLabel(provider.authority)}</p>
      <p className="mt-0.5 text-[12px] text-ink-faint">{providerPlanLabel(provider)}</p>
      {error && <p className="mt-2 text-[12px] text-removed">{error}</p>}
    </CommonsCard>
  )
}

/** Create / edit a Model provider. New providers register the standard effort vocabulary
 *  and inherit the account plan + unrestricted authority (the advanced cascade fields
 *  aren't exposed here yet); the model family is editable because it drives the D10
 *  prompt-fit warning. */
function ProviderDialog({ provider, onClose }: { provider: ModelProvider | null; onClose: () => void }) {
  const [label, setLabel] = useState(provider?.label ?? '')
  const [family, setFamily] = useState(provider?.modelFamily ?? 'claude')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const canSubmit = label.trim().length > 0 && family.trim().length > 0 && !busy

  const submit = async () => {
    if (!canSubmit) return
    setBusy(true)
    setError(null)
    try {
      if (provider) {
        await updateProvider(provider.id, { label: label.trim(), modelFamily: family.trim() })
      } else {
        await createProvider({
          label: label.trim(),
          modelFamily: family.trim(),
          effortLevels: ['Low', 'Medium', 'High'],
        })
      }
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save this provider.')
      setBusy(false)
    }
  }

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
      <FormField label="Name">
        <input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
          placeholder="e.g. Anthropic (prod)"
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
          A system prompt tuned for a different family shows a fit warning when picked.
        </span>
      </FormField>
    </FormDialog>
  )
}

/** System prompts (D10) — the reusable, target-family-tagged prompts an Agent starts
 *  from. Each shows its target family and a downgrade warning when it wouldn't fit the
 *  default provider's family (the pure `promptFitWarning`). */
function PromptsTab() {
  const prompts = useSystemPrompts().data ?? []
  const providers = useProviders().data ?? []
  const providerFamily = providers[0]?.modelFamily ?? 'claude'
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
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const canSubmit =
    label.trim().length > 0 && family.trim().length > 0 && bodyText.trim().length > 0 && !busy

  const submit = async () => {
    if (!canSubmit) return
    setBusy(true)
    setError(null)
    const fields = { label: label.trim(), targetFamily: family.trim(), body: bodyText.trim() }
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
        <div key={projectId}>
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
            {projectName(projectId)}
          </div>
          <CommonsCard>
            <div className="space-y-2.5">
              {list.map((c) => (
                <ContributorRow
                  key={c.id}
                  commission={c}
                  agentLabel={agentsById.get(c.agentId)?.label ?? c.agentId}
                />
              ))}
            </div>
          </CommonsCard>
        </div>
      ))}
    </div>
  )
}

function GenericSection({ section }: { section: SectionId }) {
  const meta = SECTION_META[section]
  const [creating, setCreating] = useState(false)
  return (
    <div className="flex-1 overflow-y-auto">
      <div className="mx-auto w-full max-w-3xl px-6 py-6">
        <header className="mb-5 flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="font-serif text-2xl font-semibold text-ink">{meta.label}</h1>
              {meta.beta && (
                <span className="rounded-full bg-accent-tint px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-accent-strong">
                  Beta
                </span>
              )}
            </div>
            <p className="mt-1 text-sm text-ink-soft">{meta.subtitle}</p>
          </div>
          {section === 'dispatch' && (
            <PrimaryButton icon={<Plus size={15} />} onClick={() => setCreating(true)}>
              New dispatch
            </PrimaryButton>
          )}
        </header>

        {section === 'dispatch' && <DispatchView />}
        {section === 'customize' && <CustomizeView />}
      </div>
      {creating && <NewDispatchDialog onClose={() => setCreating(false)} />}
    </div>
  )
}

/** The "New dispatch" form — a one-off agentic task: a required title + an optional
 *  detail. Dispatching kicks off a run that lands in the feed 'running' and finishes
 *  a beat later. Mirrors NewProjectDialog's modal idiom. */
function NewDispatchDialog({ onClose }: { onClose: () => void }) {
  const [title, setTitle] = useState('')
  const [detail, setDetail] = useState('')
  const dialogRef = useRef<HTMLDivElement>(null)
  const titleRef = useRef<HTMLInputElement>(null)
  useFocusTrap(dialogRef, onClose, { initialFocus: titleRef })

  const canCreate = title.trim().length > 0
  const submit = () => {
    if (!canCreate) return
    void createDispatch(title.trim(), detail.trim() || undefined)
    onClose()
  }

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex justify-center px-4 pt-[14vh]"
      onMouseDown={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="New dispatch"
    >
      <div className="absolute inset-0 bg-black/30 backdrop-blur-[1px]" />
      <div
        ref={dialogRef}
        onMouseDown={(e) => e.stopPropagation()}
        className="relative flex h-fit w-[460px] max-w-full flex-col overflow-hidden rounded-xl bg-surface shadow-2xl ring-1 ring-line-strong"
      >
        <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
          <div className="flex items-center gap-2">
            <SendHorizontal size={18} className="text-cap-workspace" />
            <span className="text-[15px] font-semibold text-ink">New dispatch</span>
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
            <span className="mb-1.5 block text-[12px] font-medium text-ink-soft">Task</span>
            <input
              ref={titleRef}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') submit()
              }}
              placeholder="e.g. Triage today’s new support tickets"
              className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-[14px] text-ink outline-none transition placeholder:text-ink-faint focus:border-accent"
            />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-[12px] font-medium text-ink-soft">
              Detail <span className="font-normal text-ink-faint">(optional)</span>
            </span>
            <textarea
              value={detail}
              onChange={(e) => setDetail(e.target.value)}
              rows={3}
              placeholder="What it should do, and where to deliver the result."
              className="w-full resize-none rounded-lg border border-line bg-surface px-3 py-2 text-[14px] leading-relaxed text-ink outline-none transition placeholder:text-ink-faint focus:border-accent"
            />
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
            <SendHorizontal size={15} />
            Dispatch
          </button>
        </div>
      </div>
    </div>,
    document.body,
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
  onOpenSchedule,
  onBack,
  backTo,
  onOpenSession,
}: {
  /** Which routine detail to show (null = the list) — the controlled source of
   *  truth, set by the controller however the detail was reached. */
  scheduleId: string | null
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
  const [filter, setFilter] = useState('All')
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
  const wantEnabled = filter === 'Active' ? true : filter === 'Paused' ? false : null
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
        <Dropdown label="Show" value={filter} options={['All', 'Active', 'Paused']} onChange={setFilter} />
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
    <div
      className={`group flex items-center gap-3 transition hover:bg-panel-2/50 ${
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

        <div className="min-w-0 flex-1">
          <div className="truncate text-[14px] font-medium text-ink">{task.name}</div>
          <MiniPipeline task={task} />
          <div className="truncate text-[12px] text-ink-faint sm:hidden">
            {task.steps.length} step{task.steps.length === 1 ? '' : 's'} · {task.subtitle}
          </div>
        </div>

        <div className="hidden shrink-0 pr-1 text-right md:block">
          <div className="text-[12px] text-ink-soft">next {task.next}</div>
          <div className="text-[11px] text-ink-faint">{lastRun ? `ran ${relativeTime(lastRun.at)}` : 'no runs yet'}</div>
        </div>
      </button>

      <div className="flex shrink-0 items-center gap-2 pr-4">
        <StatusPill tone={pill.tone} label={pill.label} />

        <div className="flex items-center gap-1 opacity-0 transition focus-within:opacity-100 group-hover:opacity-100">
          <Tooltip label="Run now">
            <button
              onClick={onRunNow}
              aria-label={`Run ${task.name} now`}
              className="flex h-7 w-7 items-center justify-center rounded-md text-ink-faint transition hover:bg-panel-2 hover:text-ink"
            >
              {running ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
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

        <Toggle on={task.enabled} onToggle={onToggle} />
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
    <div className="mt-1 hidden items-center gap-1 sm:flex">
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
          role="dialog"
          aria-label="New schedule"
          className="absolute right-0 z-30 mt-2 w-[340px] overflow-hidden rounded-xl border border-line-strong bg-surface shadow-xl"
        >
          <div className="max-h-[min(60vh,440px)] overflow-y-auto p-2">
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
      <BackButton to={backTo} onBack={onBack} />

      <header className="mb-6 flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
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
                  className="min-w-0 max-w-full rounded-md border border-accent bg-surface px-1.5 py-0.5 font-serif text-2xl font-semibold leading-tight text-ink outline-none"
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
                  <h1 className="truncate font-serif text-2xl font-semibold leading-tight text-ink">{task.name}</h1>
                  <Pencil size={14} className="shrink-0 text-ink-faint opacity-0 transition group-hover:opacity-100" />
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
            {running ? <Loader2 size={15} className="animate-spin" /> : <Play size={15} />}
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

      <div className="flex flex-col gap-6 lg:flex-row">
        <div className="min-w-0 flex-1 space-y-4">
          <PromptCard prompt={task.prompt} onSave={(prompt) => void updateSchedule(task.id, { prompt })} />
          <WorkflowCard task={task} run={shownRun} running={running} />
          <RunHistoryCard task={task} onOpenRun={(runId) => onOpenSession(runSessionId(task.id, runId))} />
        </div>

        <aside className="w-full shrink-0 space-y-4 lg:w-72">
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
    <div className="rounded-xl border border-line bg-surface p-4 shadow-sm">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-ink-faint">Instruction</span>
        {!editing && (
          <div className="flex items-center gap-0.5">
            <Tooltip label="Edit">
              <button
                onClick={startEdit}
                aria-label="Edit instruction"
                className="flex h-6 w-6 items-center justify-center rounded-md text-ink-faint transition hover:bg-panel-2 hover:text-ink-soft"
              >
                <Pencil size={13} />
              </button>
            </Tooltip>
            <Tooltip label="Copy">
              <button
                onClick={() => navigator.clipboard?.writeText(prompt)}
                aria-label="Copy instruction"
                className="flex h-6 w-6 items-center justify-center rounded-md text-ink-faint transition hover:bg-panel-2 hover:text-ink-soft"
              >
                <Copy size={14} />
              </button>
            </Tooltip>
          </div>
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
      <Loader2 size={13} className="animate-spin" />
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
    <div className="rounded-xl border border-line bg-surface shadow-sm">
      <div className="flex items-center justify-between border-b border-line px-4 py-3">
        <span className="text-[13px] font-semibold text-ink">Workflow</span>
        {editing ? (
          <span className="text-[12px] font-medium text-ink-faint">Editing steps</span>
        ) : (
          <div className="flex items-center gap-2.5">
            <span className="text-[12px] text-ink-faint">
              {task.steps.length} step{task.steps.length === 1 ? '' : 's'} · runs top to bottom
            </span>
            <button
              onClick={() => setEditing(true)}
              className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[12px] font-medium text-ink-faint transition hover:bg-panel-2 hover:text-ink"
            >
              <Pencil size={12} />
              Edit
            </button>
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
}: {
  onPick: (tool: StepTool) => void
  onClose: () => void
  tools?: StepTool[]
}) {
  // Mounted only while open (the parent conditionally renders it), so the dismiss
  // listeners should be live for its whole lifetime — pass open=true.
  const ref = useDismissable<HTMLDivElement>(true, onClose)

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label="Pick a tool"
      className="absolute left-0 top-full z-30 mt-1 max-h-[240px] w-[200px] overflow-y-auto rounded-xl border border-line-strong bg-surface p-1 shadow-xl"
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
  if (status === 'running') return <Loader2 size={16} className="mt-0.5 shrink-0 animate-spin text-accent" />
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
        className="mt-0.5 shrink-0 text-ink-faint opacity-0 transition group-hover:opacity-100"
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
    <SidePanel title="Delivers to" icon={<SendHorizontal size={14} />}>
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
            <>
              {task.delivery.note && <p className="mt-2 text-[12px] leading-relaxed text-ink-soft">{task.delivery.note}</p>}
              <button onClick={startEdit} className={`mt-2 ${INLINE_ACTION_CLASS}`}>
                <Pencil size={12} />
                Edit destination
              </button>
            </>
          )}
        </>
      )}
      <label className="mt-3 flex items-center justify-between gap-2 border-t border-line pt-3">
        <span className="flex items-center gap-1.5 text-[12px] text-ink-soft">
          <Bell size={13} />
          Notify me on failure
        </span>
        <Toggle on={notifyOnFail} onToggle={() => void updateSchedule(task.id, { notifyOnFailure: !notifyOnFail })} />
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
    <SidePanel title="Context & tools" icon={<Plug size={14} />}>
      {tools.length === 0 ? (
        <p className="text-[12px] text-ink-faint">No connectors yet.</p>
      ) : (
        <div className="space-y-2">
          {tools.map((t) => (
            <div key={t.id} className="flex items-center gap-2">
              <ToolGlyph tool={t} size={15} />
              <span className="min-w-0 flex-1 truncate text-[13px] text-ink">{t.label}</span>
              <StatusPill tone={t.needsAuth ? 'warn' : 'ok'} label={t.needsAuth ? 'Needs auth' : 'Connected'} />
            </div>
          ))}
        </div>
      )}
      <div className="relative mt-2.5 border-t border-line pt-2.5">
        <AddTrigger label="Add tool" open={picking} onClick={() => setPicking((p) => !p)} />
        {picking && <StepToolPicker tools={addable} onPick={addTool} onClose={() => setPicking(false)} />}
      </div>
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
    <SidePanel title="Schedule" icon={<Clock size={14} />}>
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
      <div className="relative mt-2.5 flex items-center justify-between gap-2 border-t border-line pt-2.5">
        <button
          onClick={() => setEditing((v) => !v)}
          aria-haspopup="dialog"
          aria-expanded={editing}
          className={INLINE_ACTION_CLASS}
        >
          <Pencil size={12} />
          Edit schedule
        </button>
        {task.startedLabel && <span className="truncate text-[11px] text-ink-faint">{task.startedLabel}</span>}
        {editing && <CadenceEditor task={task} onClose={() => setEditing(false)} />}
      </div>
    </SidePanel>
  )
}

/** The cadence editor popover — a frequency picker (+ time / weekday / timezone),
 *  with a live preview of the derived cadence + next-run. Apply writes the three
 *  derived fields via updateSchedule in one patch. */
function CadenceEditor({ task, onClose }: { task: ScheduledTask; onClose: () => void }) {
  // Mounted only while open, so dismiss listeners live for its whole lifetime.
  const ref = useDismissable<HTMLDivElement>(true, onClose)
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
      ref={ref}
      role="dialog"
      aria-label="Edit schedule"
      className="absolute right-0 top-full z-30 mt-1.5 w-[280px] rounded-xl border border-line-strong bg-surface p-3 shadow-xl"
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

/** The model + effort picker for a routine — reuses the shared catalog and the
 *  composer's two-section layout (model radios + an effort ladder). Each pick
 *  applies live via updateSchedule({ model }); "Done" closes. */
function ScheduleModelPicker({ task, onClose }: { task: ScheduledTask; onClose: () => void }) {
  // Mounted only while open, so dismiss listeners live for its whole lifetime.
  const ref = useDismissable<HTMLDivElement>(true, onClose)
  const init = parseModelLabel(task.model)
  const [modelId, setModelId] = useState<ModelId>(init.modelId)
  const [effort, setEffort] = useState<Effort>(init.effort)

  const pickModel = (id: ModelId) => {
    setModelId(id)
    void updateSchedule(task.id, { model: composeModelLabel(id, effort) })
  }
  const pickEffort = (e: Effort) => {
    setEffort(e)
    void updateSchedule(task.id, { model: composeModelLabel(modelId, e) })
  }

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label="Model and effort"
      className="absolute bottom-full right-0 z-30 mb-1.5 w-[280px] rounded-xl border border-line-strong bg-surface p-2 shadow-xl"
    >
      <div className="px-1.5 pb-1 pt-0.5 text-[11px] font-semibold uppercase tracking-wide text-ink-faint">Model</div>
      {MODELS.map((m) => {
        const on = m.id === modelId
        return (
          <button
            key={m.id}
            onClick={() => pickModel(m.id)}
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
            <span className="min-w-0">
              <span className="block text-[13px] font-medium text-ink">{m.name}</span>
              <span className="block text-[11px] leading-snug text-ink-faint">{m.blurb}</span>
            </span>
          </button>
        )
      })}
      <div className="my-1.5 border-t border-line" />
      <div className="px-1.5 pb-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-faint">Effort</div>
      <div className="flex gap-1 rounded-lg bg-panel-2 p-0.5">
        {EFFORTS.map((e) => {
          const on = e.id === effort
          return (
            <button
              key={e.id}
              onClick={() => pickEffort(e.id)}
              className={`flex-1 rounded-md px-1 py-1 text-[12px] font-medium transition ${
                on ? 'bg-surface text-ink shadow-sm ring-1 ring-line-strong' : 'text-ink-soft hover:text-ink'
              }`}
            >
              {e.label}
            </button>
          )
        })}
      </div>
      <div className="mt-2 flex justify-end px-1">
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
 *  new sessions start with. A pill that opens the shared model + effort menu. */
function DefaultModelCard() {
  const [prefs, setPrefs] = useState<ModelPrefs>(loadModelPrefs)
  const [open, setOpen] = useState(false)
  const ref = useDismissable<HTMLDivElement>(open, () => setOpen(false))

  const commit = (next: ModelPrefs) => {
    setPrefs(next)
    saveModelPrefs(next)
  }
  const pickModel = (modelId: ModelId) => {
    const isOpus = MODELS.find((m) => m.id === modelId)?.isOpus
    commit({ ...prefs, modelId, ...(isOpus ? {} : { fast: false }) })
  }
  const pickEffort = (effort: Effort) => commit({ ...prefs, effort })

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
          <span>{composeModelLabel(prefs.modelId, prefs.effort)}</span>
          <ChevronDown size={12} className="text-ink-faint transition group-hover:text-ink-soft" />
        </button>
        {open && (
          <div
            role="dialog"
            aria-label="Default model and effort"
            className="absolute right-0 top-full z-30 mt-1.5 w-[280px] rounded-xl border border-line-strong bg-surface p-2 shadow-xl"
          >
            <div className="px-1.5 pb-1 pt-0.5 text-[11px] font-semibold uppercase tracking-wide text-ink-faint">Model</div>
            {MODELS.map((m) => {
              const on = m.id === prefs.modelId
              return (
                <button
                  key={m.id}
                  onClick={() => pickModel(m.id)}
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
                  <span className="min-w-0">
                    <span className="block text-[13px] font-medium text-ink">{m.name}</span>
                    <span className="block text-[11px] leading-snug text-ink-faint">{m.blurb}</span>
                  </span>
                </button>
              )
            })}
            <div className="my-1.5 border-t border-line" />
            <div className="px-1.5 pb-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-faint">Effort</div>
            <div className="flex gap-1 rounded-lg bg-panel-2 p-0.5">
              {EFFORTS.map((e) => {
                const on = e.id === prefs.effort
                return (
                  <button
                    key={e.id}
                    onClick={() => pickEffort(e.id)}
                    className={`flex-1 rounded-md px-1 py-1 text-[12px] font-medium transition ${
                      on ? 'bg-surface text-ink shadow-sm ring-1 ring-line-strong' : 'text-ink-soft hover:text-ink'
                    }`}
                  >
                    {e.label}
                  </button>
                )
              })}
            </div>
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
  // The account's cognition source the prompt would run against — the seeded provider.
  const provider = providers[0]
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
            role="dialog"
            aria-label="Agent system prompt"
            className="absolute right-0 top-full z-30 mt-1.5 w-[320px] rounded-xl border border-line-strong bg-surface p-2 shadow-xl"
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
    <div className="flex-1 overflow-y-auto">
      <div className="mx-auto w-full max-w-5xl px-6 py-6">{children}</div>
    </div>
  )
}

function PageHeader({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <header className="mb-5 flex items-center justify-between gap-3">
      <h1 className="font-serif text-2xl font-semibold text-ink">{title}</h1>
      {children && <div className="flex shrink-0 items-center gap-2.5">{children}</div>}
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
        <div className="absolute right-0 z-20 mt-1 w-44 overflow-hidden rounded-lg border border-line bg-surface py-1 shadow-lg">
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

function PanelLabel({ children }: { children: ReactNode }) {
  return (
    <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
      {children}
    </div>
  )
}

function SidePanel({ title, icon, children }: { title: string; icon: ReactNode; children: ReactNode }) {
  return (
    <div className="rounded-xl border border-line bg-surface p-4 shadow-sm">
      <div className="mb-2.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
        {icon}
        {title}
      </div>
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
    return <Loader2 size={17} className="mt-0.5 shrink-0 animate-spin text-accent" />
  if (status === 'failed') return <AlertCircle size={17} className="mt-0.5 shrink-0 text-red-500" />
  return <CheckCircle2 size={17} className="mt-0.5 shrink-0 text-emerald-500" />
}

function Toggle({ on, onToggle }: { on: boolean; onToggle: () => void }) {
  return (
    <button
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
    <div className="flex items-center justify-between gap-4 rounded-xl border border-line bg-surface px-4 py-3 shadow-sm">
      <div className="min-w-0">
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
      <Toggle on={on} onToggle={toggle} />
    </Card>
  )
}
