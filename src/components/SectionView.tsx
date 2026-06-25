import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import {
  AlertCircle,
  ArrowLeft,
  BarChart3,
  Bell,
  Box,
  Bug,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  Copy,
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
import type { ArtifactKind, Connector, SectionId } from '../types'
import { SECTION_META } from '../lib/sections'
import { connectorIconFor } from '../lib/connectors'
import { CHIP_TONES, type ChipTone } from '../lib/capabilities'
import { ConnectorDetailBody } from './ConnectorPanel'
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
} from '../data/cowork'
import {
  addScheduleFromSeed,
  isOptimisticId,
  removeSchedule,
  runScheduleNow,
  setConnectorStatus,
  toggleScheduleEnabled,
  useDispatchRuns,
  useSavedContexts,
  useScheduleTemplates,
  useSchedules,
} from '../api'
import { ArtifactThumb, ArtifactViewer, KIND_ICON, KIND_LABEL } from './artifactPreview'
import { useFocusTrap } from '../lib/useFocusTrap'
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
  railCollapsed = false,
  initialProjectId = null,
  initialScheduleId = null,
}: {
  section: SectionId
  onOpenSession: (id: string) => void
  onNewSession: () => void
  /** When the left rail is collapsed, a floating expand toggle sits in the
   *  top-left of this panel; inset the content so it clears that button rather
   *  than rendering underneath it. */
  railCollapsed?: boolean
  /** When opened via a session's "In ‹Project›" breadcrumb, the project to show
   *  in detail straight away (null = the project list). */
  initialProjectId?: string | null
  /** When opened via a run session's "Scheduled run of ‹routine›" breadcrumb,
   *  the routine to open in detail straight away (null = the schedule list). */
  initialScheduleId?: string | null
}) {
  const body =
    section === 'projects' ? (
      // Key on the deep-link target (focusProjectId). The "In ‹Project›"
      // breadcrumb sets it and remounts straight into that project's detail;
      // clicking the rail's Projects item clears it, so coming back to the rail
      // from a breadcrumb remounts to the list rather than the deep-linked
      // project. (A drill-down opened by clicking a card is local to the section
      // and stays put.)
      <ProjectsSection
        key={initialProjectId ?? 'projects-list'}
        onOpenSession={onOpenSession}
        onNewSession={onNewSession}
        initialProjectId={initialProjectId}
      />
    ) : section === 'artifacts' ? (
      <ArtifactsSection />
    ) : section === 'contexts' ? (
      <ContextsSection />
    ) : section === 'scheduled' ? (
      // Key on the deep-link target so a run session's breadcrumb remounts
      // straight into that routine's detail (mirrors Projects above).
      <ScheduledSection
        key={initialScheduleId ?? 'scheduled-list'}
        initialOpenId={initialScheduleId}
        onOpenSession={onOpenSession}
      />
    ) : (
      <GenericSection section={section} />
    )
  return (
    <div className={`flex min-h-0 flex-1 flex-col ${railCollapsed ? 'pl-8' : ''}`}>{body}</div>
  )
}

/* ─────────────────────────── Projects ─────────────────────────── */

function ProjectsSection({
  onOpenSession,
  onNewSession,
  initialProjectId,
}: {
  onOpenSession: (id: string) => void
  onNewSession: () => void
  initialProjectId: string | null
}) {
  const [openId, setOpenId] = useState<string | null>(initialProjectId)
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
    const projectId = uniqueProjectId(name, new Set(projects.map((p) => p.id)))
    rel.applyOp({ kind: 'create-project', projectId, projectName: name, projectDescription: description })
    setCreating(false)
    setOpenId(projectId)
  }

  const open = openId ? (projects.find((p) => p.id === openId) ?? null) : null
  if (open)
    return (
      <ProjectDetail
        project={open}
        onBack={() => setOpenId(null)}
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
              onOpen={() => setOpenId(p.id)}
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
        <span>Updated {project.updated}</span>
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
  onOpenSession,
  onNewSession,
}: {
  project: Project
  onBack: () => void
  onOpenSession: (id: string) => void
  onNewSession: () => void
}) {
  const rel = useRelations()
  const convs = rel.sessionsForProject(project.id)
  const contexts = rel.contextsForProject(project.id)
  // The project's recurring runs: its hand-authored cadence plus any global
  // schedule the relation graph links here (deduped by name), so an AI
  // "link schedule to project" edit shows up alongside the seeded ones.
  const scheduled = [
    ...project.scheduled,
    ...rel
      .schedulesForProject(project.id)
      .filter((t) => !project.scheduled.some((s) => s.name === t.name))
      .map((t) => ({ name: t.name, cadence: t.cadence, enabled: t.enabled })),
  ]

  return (
    <Page>
      <button
        onClick={onBack}
        className="mb-4 inline-flex items-center gap-1.5 text-[13px] font-medium text-ink-soft transition hover:text-ink"
      >
        <ArrowLeft size={15} />
        Projects
      </button>

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
                <button
                  key={c.id}
                  onClick={() => onOpenSession(c.id)}
                  className={`flex w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-panel-2/60 ${
                    i > 0 ? 'border-t border-line' : ''
                  }`}
                >
                  <MessageSquare size={16} className="shrink-0 text-ink-faint" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[14px] font-medium text-ink">{c.title}</div>
                    <div className="truncate text-[12px] text-ink-faint">{c.preview}</div>
                  </div>
                  <span className="shrink-0 text-[11px] text-ink-faint">{c.updatedLabel}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Right panel — instructions, scheduled runs, and attached context. */}
        <aside className="w-full shrink-0 space-y-4 lg:w-72">
          <SidePanel title="Instructions" icon={<FileText size={14} />}>
            {project.instructions ? (
              <p className="text-[13px] leading-relaxed text-ink-soft">{project.instructions}</p>
            ) : (
              <p className="text-[12px] text-ink-faint">No custom instructions yet.</p>
            )}
          </SidePanel>

          <SidePanel title="Scheduled" icon={<Clock size={14} />}>
            {scheduled.length === 0 ? (
              <p className="text-[12px] text-ink-faint">No scheduled runs.</p>
            ) : (
              <div className="space-y-2.5">
                {scheduled.map((s, i) => (
                  <div key={i} className="flex items-start gap-2.5">
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

          <SidePanel title="Context" icon={<Folder size={14} />}>
            {contexts.length === 0 ? (
              <p className="text-[12px] text-ink-faint">No context attached yet.</p>
            ) : (
            <div className="space-y-2">
              {contexts.map((ctx, i) => {
                const CIcon = CONTEXT_ICON[ctx.kind]
                return (
                  <div key={i} className="flex items-center gap-2.5">
                    <CIcon size={15} className="shrink-0 text-ink-faint" />
                    <span className="min-w-0 flex-1 truncate text-[13px] text-ink">{ctx.label}</span>
                    <span className="shrink-0 truncate text-[11px] text-ink-faint">{ctx.meta}</span>
                  </div>
                )
              })}
            </div>
            )}
          </SidePanel>
        </aside>
      </div>
    </Page>
  )
}

/* ─────────────────────────── Artifacts ─────────────────────────── */

const ARTIFACT_FILTERS = ['All', 'Documents', 'Images', 'Sheets', 'Slides', 'Emails']

function ArtifactsSection() {
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState('All')
  const [openId, setOpenId] = useState<string | null>(null)
  const [folded, setFolded] = useState<Set<string>>(new Set())
  const [creating, setCreating] = useState(false)
  const rel = useRelations()
  const projects = rel.allProjects()

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
                <button
                  onClick={() => foldGroup(g.id)}
                  aria-expanded={!isFolded}
                  className="group mb-2.5 flex w-full items-center gap-1.5 text-left"
                >
                  <ChevronDown
                    size={15}
                    className={`text-ink-faint transition group-hover:text-ink-soft ${
                      isFolded ? '-rotate-90' : ''
                    }`}
                  />
                  <span className="text-[13px] font-semibold text-ink">{g.name}</span>
                  <span className="text-[12px] text-ink-faint">{g.items.length}</span>
                </button>
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
        <div className="mt-3 flex items-center gap-2">
          <span className="rounded bg-panel-2 px-1.5 py-0.5 text-[10px] font-medium text-ink-soft">
            {artifact.tag}
          </span>
          <span className="text-[11px] text-ink-faint">
            {pending ? 'Saving…' : `Edited ${artifact.edited}`}
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
    detail: 'Connected · just now',
    lastUsed: 'just now',
    sessions: 0,
  }

const mcpSaved = (o: { id: string; label: string; meta: string }): SavedContext =>
  SEED_BY_ID.get(o.id) ?? {
    id: o.id,
    label: o.label,
    kind: 'mcp',
    status: 'connected',
    detail: o.meta,
    lastUsed: 'just now',
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
    lastUsed: 'just now',
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
    lastUsed: 'just now',
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
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

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
                <button
                  onClick={() => foldGroup(g.kind)}
                  aria-expanded={!isFolded}
                  className="group mb-2.5 flex w-full items-center gap-1.5 text-left"
                >
                  <ChevronDown
                    size={15}
                    className={`text-ink-faint transition group-hover:text-ink-soft ${
                      isFolded ? '-rotate-90' : ''
                    }`}
                  />
                  <span className="text-[13px] font-semibold text-ink">{g.label}</span>
                  <span className="text-[12px] text-ink-faint">{g.items.length}</span>
                </button>
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
            {ctx.lastUsed === '—' ? 'Never used' : `Last used ${ctx.lastUsed}`}
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
      <button
        onClick={onBack}
        className="mb-4 inline-flex items-center gap-1.5 text-[13px] font-medium text-ink-soft transition hover:text-ink"
      >
        <ArrowLeft size={15} />
        Contexts
      </button>

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
                <span className="font-medium">{ctx.lastUsed === '—' ? 'Never' : ctx.lastUsed}</span>
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

function GenericSection({ section }: { section: SectionId }) {
  const meta = SECTION_META[section]
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
          {section !== 'customize' && (
            <PrimaryButton icon={<Plus size={15} />}>
              {section === 'dispatch' ? 'New dispatch' : 'Upload'}
            </PrimaryButton>
          )}
        </header>

        {section === 'dispatch' && <DispatchView />}
        {section === 'customize' && <CustomizeView />}
      </div>
    </div>
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
  return { tone: 'ok', label: last ? `Ran ${last.absolute}` : 'Active' }
}

function ScheduledSection({
  initialOpenId = null,
  onOpenSession,
}: {
  initialOpenId?: string | null
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
  const [openId, setOpenId] = useState<string | null>(initialOpenId)
  // Ids with a "Run now" in flight — drives the button spinner until the run's
  // run.finished event lands (cleared on a timer as a safety net).
  const [running, setRunning] = useState<Set<string>>(new Set())
  const timers = useRef<number[]>([])
  useEffect(() => () => timers.current.forEach((t) => window.clearTimeout(t)), [])

  const toggleEnabled = (id: string) => {
    const t = items.find((x) => x.id === id)
    void toggleScheduleEnabled(id, t ? !t.enabled : undefined)
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
    setOpenId(task.id)
  }

  const foldGroup = (g: 'active' | 'paused') =>
    setFolded((prev) => {
      const next = new Set(prev)
      next.has(g) ? next.delete(g) : next.add(g)
      return next
    })

  // Clicking a row drills into the task's workflow + run history.
  const open = openId ? (items.find((t) => t.id === openId) ?? null) : null
  if (open)
    return (
      <ScheduledDetail
        task={open}
        running={running.has(open.id)}
        onBack={() => setOpenId(null)}
        onToggleEnabled={() => toggleEnabled(open.id)}
        onRunNow={() => runNow(open.id)}
        onOpenSession={onOpenSession}
        onRemove={() => {
          remove(open.id)
          setOpenId(null)
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
                <button
                  onClick={() => foldGroup(g.key)}
                  aria-expanded={!isFolded}
                  className="group mb-2.5 flex w-full items-center gap-1.5 text-left"
                >
                  <ChevronDown
                    size={15}
                    className={`text-ink-faint transition group-hover:text-ink-soft ${isFolded ? '-rotate-90' : ''}`}
                  />
                  <span className="text-[13px] font-semibold text-ink">{g.label}</span>
                  <span className="text-[12px] text-ink-faint">{g.items.length}</span>
                </button>
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
                        onOpen={() => setOpenId(t.id)}
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
          <div className="text-[11px] text-ink-faint">{lastRun ? `ran ${lastRun.absolute}` : 'no runs yet'}</div>
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
  const ref = useRef<HTMLDivElement>(null)
  const templates = useScheduleTemplates().data ?? []

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

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
  onToggleEnabled,
  onRunNow,
  onOpenSession,
  onRemove,
}: {
  task: ScheduledTask
  running: boolean
  onBack: () => void
  onToggleEnabled: () => void
  onRunNow: () => void
  /** Open a run's session — the run-history rows link here, same destination as
   *  clicking the routine in the left rail. */
  onOpenSession: (id: string) => void
  onRemove: () => void
}) {
  const [notifyOnFail, setNotifyOnFail] = useState(true)
  const rel = useRelations()
  // Standing-approved recurring effects: an AI "save X each run" / "open a
  // session each run" edit overrides where this schedule delivers, and the
  // pre-approval means it runs unprompted.
  const savedArtifact = rel.scheduleArtifactFor(task.id)
  const sessionTarget = rel.scheduleSessionFor(task.id)
  const deliveryTarget = savedArtifact ?? sessionTarget ?? task.delivery.target
  const preApproved = !!(savedArtifact || sessionTarget)

  // The rail reflects the freshest run (a live "Run now" overrides it with an
  // in-flight state until the new run resolves). Inspecting an *older* run is now
  // done by opening its session from the run history, which carries the full
  // thread + its own run switcher.
  const shownRun = running ? null : (task.runs[0] ?? null)
  const DeliveryIcon = stepToolIcon(task.delivery.tool.id)

  return (
    <Page>
      <button
        onClick={onBack}
        className="mb-4 inline-flex items-center gap-1.5 text-[13px] font-medium text-ink-soft transition hover:text-ink"
      >
        <ArrowLeft size={15} />
        Scheduled
      </button>

      <header className="mb-6 flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-panel-2 text-ink-soft">
            <DeliveryIcon size={20} />
          </span>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="font-serif text-2xl font-semibold leading-tight text-ink">{task.name}</h1>
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
          <PromptCard prompt={task.prompt} />
          <WorkflowCard task={task} run={shownRun} running={running} />
          <RunHistoryCard task={task} onOpenRun={(runId) => onOpenSession(runSessionId(task.id, runId))} />
        </div>

        <aside className="w-full shrink-0 space-y-4 lg:w-72">
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
            {task.startedLabel && (
              <p className="mt-2.5 border-t border-line pt-2.5 text-[11px] text-ink-faint">{task.startedLabel}</p>
            )}
          </SidePanel>

          <SidePanel title="Delivers to" icon={<SendHorizontal size={14} />}>
            <div className="flex items-center gap-2">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-panel-2">
                <DeliveryIcon size={15} className={toneChip(task.delivery.tool.tone).color} />
              </span>
              <div className="min-w-0">
                <div className="truncate text-[13px] font-medium text-ink">{deliveryTarget}</div>
                <div className="truncate text-[11px] text-ink-faint">{task.delivery.tool.label}</div>
              </div>
            </div>
            {preApproved && (
              <div className="mt-2 inline-flex items-center gap-1 rounded-md bg-emerald-50 px-1.5 py-0.5 text-[11px] font-medium text-emerald-700">
                <Check size={11} />
                Pre-approved · runs unprompted
              </div>
            )}
            {!preApproved && task.delivery.note && (
              <p className="mt-2 text-[12px] leading-relaxed text-ink-soft">{task.delivery.note}</p>
            )}
            <label className="mt-3 flex items-center justify-between gap-2 border-t border-line pt-3">
              <span className="flex items-center gap-1.5 text-[12px] text-ink-soft">
                <Bell size={13} />
                Notify me on failure
              </span>
              <Toggle on={notifyOnFail} onToggle={() => setNotifyOnFail((v) => !v)} />
            </label>
          </SidePanel>

          <ContextToolsPanel task={task} />

          <SidePanel title="Model" icon={<Sparkles size={14} />}>
            <span className="inline-flex items-center gap-1.5 rounded-lg bg-panel-2 px-3 py-1 text-[12px] font-medium text-ink">
              <ClaudeMark size={13} />
              {task.model}
            </span>
            <p className="mt-2 text-[11px] leading-relaxed text-ink-faint">Runs headless — no approval prompts.</p>
          </SidePanel>
        </aside>
      </div>
    </Page>
  )
}

function PromptCard({ prompt }: { prompt: string }) {
  return (
    <div className="rounded-xl border border-line bg-surface p-4 shadow-sm">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-ink-faint">Instruction</span>
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
      <p className="mt-2 rounded-lg bg-panel-2/40 px-3 py-2.5 text-[13px] leading-relaxed text-ink">{prompt}</p>
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
        <span className="text-[12px] text-ink-faint">
          {task.steps.length} step{task.steps.length === 1 ? '' : 's'} · runs top to bottom
        </span>
      </div>
      <div className="p-4">
        <div className="mb-3 flex items-center gap-2.5 rounded-lg bg-panel-2/40 px-3 py-2.5">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-surface text-ink-soft">
            <Clock size={15} />
          </span>
          <span className="text-[11px] font-semibold uppercase tracking-wide text-ink-faint">When</span>
          <span className="min-w-0 truncate text-[13px] text-ink">{task.trigger}</span>
        </div>

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
      </div>
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
          <span className="text-[13px] font-medium text-ink">
            {run.when} <span className="font-normal text-ink-faint">· {run.absolute}</span>
          </span>
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
function ContextToolsPanel({ task }: { task: ScheduledTask }) {
  const rel = useRelations()
  const seen = new Set<string>()
  const tools: StepTool[] = []
  // Steps + delivery, plus any tool-context an AI "let it use X each run" edit
  // added (those are standing-approved, so they belong in the run's toolbox).
  for (const t of [...task.steps.map((s) => s.tool), task.delivery.tool, ...rel.scheduleExtraToolsFor(task.id)]) {
    if (t.tone === 'claude' || t.tone === 'web' || seen.has(t.id)) continue
    seen.add(t.id)
    tools.push(t)
  }
  if (tools.length === 0) return null
  return (
    <SidePanel title="Context & tools" icon={<Plug size={14} />}>
      <div className="space-y-2">
        {tools.map((t) => (
          <div key={t.id} className="flex items-center gap-2">
            <ToolGlyph tool={t} size={15} />
            <span className="min-w-0 flex-1 truncate text-[13px] text-ink">{t.label}</span>
            <StatusPill tone={t.needsAuth ? 'warn' : 'ok'} label={t.needsAuth ? 'Needs auth' : 'Connected'} />
          </div>
        ))}
      </div>
    </SidePanel>
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
              <span className="shrink-0 text-[11px] text-ink-faint">{r.when}</span>
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
      <Card title="Appearance" desc="Match the system theme, or pick light or dark.">
        <div className="flex gap-1.5">
          {['System', 'Light', 'Dark'].map((opt, i) => (
            <span
              key={opt}
              className={`rounded-lg px-3 py-1 text-[12px] font-medium ${
                i === 0 ? 'bg-accent text-white' : 'bg-panel-2 text-ink-soft'
              }`}
            >
              {opt}
            </span>
          ))}
        </div>
      </Card>
      <Card title="Default model" desc="What new sessions start with.">
        <span className="rounded-lg bg-panel-2 px-3 py-1 text-[12px] font-medium text-ink">
          Claude Opus 4.8 · High
        </span>
      </Card>
      <ToggleCard title="Weekly digest" desc="A Monday summary of everything you shipped." defaultOn />
      <ToggleCard title="Suggest scheduled tasks" desc="Spot repeat work and offer to automate it." />
    </div>
  )
}

/* ───────────────────────── shared bits ───────────────────────── */

function Page({ children }: { children: ReactNode }) {
  return (
    <div className="flex-1 overflow-y-auto">
      <div className="mx-auto w-full max-w-5xl px-6 py-6">{children}</div>
    </div>
  )
}

function PageHeader({ title, children }: { title: string; children: ReactNode }) {
  return (
    <header className="mb-5 flex items-center justify-between gap-3">
      <h1 className="font-serif text-2xl font-semibold text-ink">{title}</h1>
      <div className="flex shrink-0 items-center gap-2.5">{children}</div>
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
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

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

function ToggleCard({ title, desc, defaultOn = false }: { title: string; desc: string; defaultOn?: boolean }) {
  const [on, setOn] = useState(defaultOn)
  return (
    <Card title={title} desc={desc}>
      <Toggle on={on} onToggle={() => setOn((v) => !v)} />
    </Card>
  )
}
