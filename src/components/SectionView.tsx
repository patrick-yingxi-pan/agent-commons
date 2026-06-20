import { useEffect, useRef, useState, type ReactNode } from 'react'
import {
  AlertCircle,
  ArrowLeft,
  Check,
  CheckCircle2,
  ChevronDown,
  Clock,
  FileText,
  Folder,
  FolderGit2,
  GitBranch,
  Github,
  Loader2,
  MessageSquare,
  Plug,
  Plus,
  Search,
  Server,
  Trash2,
  Unplug,
} from 'lucide-react'
import type { Connector, Session, SectionId } from '../types'
import { SECTION_META } from '../lib/sections'
import { connectorIconFor } from '../lib/connectors'
import { ConnectorDetailBody } from './ConnectorPanel'
import { SAVED_CONTEXTS, type SavedContext, type SavedContextKind } from '../data/savedContexts'
import {
  CONNECTOR_OPTIONS,
  GITHUB_REPO_OPTIONS,
  LOCAL_REPO_OPTIONS,
  MCP_OPTIONS,
} from '../data/contextOptions'
import { SESSIONS } from '../data/sessions'
import {
  ALL_ARTIFACTS,
  DISPATCH_RUNS,
  PROJECTS,
  SCHEDULED_TASKS,
  type ArtifactItem,
  type DispatchRun,
  type Project,
  type ProjectContext,
  type ScheduledTask,
} from '../data/cowork'
import { ArtifactThumb, ArtifactViewer, KIND_ICON } from './artifactPreview'

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

  const open = openId ? (PROJECTS.find((p) => p.id === openId) ?? null) : null
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
  const filtered = PROJECTS.filter(
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
        <PrimaryButton icon={<Plus size={15} />}>New project</PrimaryButton>
      </PageHeader>
      <SearchBox value={query} onChange={setQuery} placeholder="Search projects…" />
      {sorted.length === 0 ? (
        <Empty>No projects match “{query.trim()}”.</Empty>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {sorted.map((p) => (
            <ProjectCard key={p.id} project={p} onOpen={() => setOpenId(p.id)} />
          ))}
        </div>
      )}
    </Page>
  )
}

function ProjectCard({ project, onOpen }: { project: Project; onOpen: () => void }) {
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
          {project.sessionIds.length} session{project.sessionIds.length === 1 ? '' : 's'}
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
  const convs = project.sessionIds
    .map((id) => SESSIONS.find((c) => c.id === id))
    .filter(Boolean) as Session[]

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
            <p className="text-[13px] leading-relaxed text-ink-soft">{project.instructions}</p>
          </SidePanel>

          <SidePanel title="Scheduled" icon={<Clock size={14} />}>
            {project.scheduled.length === 0 ? (
              <p className="text-[12px] text-ink-faint">No scheduled runs.</p>
            ) : (
              <div className="space-y-2.5">
                {project.scheduled.map((s, i) => (
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
            <div className="space-y-2">
              {project.contexts.map((ctx, i) => {
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

  const matches = ALL_ARTIFACTS.filter(
    (a) =>
      (wantKind === null || a.kind === wantKind) &&
      (needle === '' ||
        a.name.toLowerCase().includes(needle) ||
        (a.excerpt ?? '').toLowerCase().includes(needle) ||
        a.source.toLowerCase().includes(needle)),
  )

  // Sorted by project by default — group in PROJECTS order, drop empty groups.
  const groups = PROJECTS.map((p) => ({
    project: p,
    items: matches.filter((a) => a.projectId === p.id),
  })).filter((g) => g.items.length > 0)

  const openArtifact = openId ? (ALL_ARTIFACTS.find((a) => a.id === openId) ?? null) : null
  const projectName = (pid: string) => PROJECTS.find((p) => p.id === pid)?.name ?? 'Other'

  return (
    <Page>
      <PageHeader title="Artifacts">
        <Dropdown label="Filter by" value={filter} options={ARTIFACT_FILTERS} onChange={setFilter} />
        <PrimaryButton icon={<Plus size={15} />}>New artifact</PrimaryButton>
      </PageHeader>
      <SearchBox value={query} onChange={setQuery} placeholder="Search artifacts…" />

      {groups.length === 0 ? (
        <Empty>No artifacts match.</Empty>
      ) : (
        <div className="space-y-7">
          {groups.map((g) => (
            <div key={g.project.id}>
              <div className="mb-2.5 flex items-baseline gap-2">
                <span className="text-[13px] font-semibold text-ink">{g.project.name}</span>
                <span className="text-[12px] text-ink-faint">{g.items.length}</span>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {g.items.map((a) => (
                  <ArtifactCard key={a.id} artifact={a} onOpen={() => setOpenId(a.id)} />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {openArtifact && (
        <ArtifactViewer
          artifact={openArtifact}
          projectName={projectName(openArtifact.projectId)}
          onClose={() => setOpenId(null)}
        />
      )}
    </Page>
  )
}

function ArtifactCard({ artifact, onOpen }: { artifact: ArtifactItem; onOpen: () => void }) {
  const Icon = KIND_ICON[artifact.kind]
  return (
    <button
      onClick={onOpen}
      className="flex flex-col overflow-hidden rounded-xl border border-line bg-surface text-left shadow-sm transition hover:border-line-strong hover:shadow"
    >
      <div className="h-28 w-full overflow-hidden border-b border-line bg-panel-2/40">
        <ArtifactThumb kind={artifact.kind} id={artifact.id} name={artifact.name} />
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
        <div className="mt-3 flex items-center gap-2">
          <span className="rounded bg-panel-2 px-1.5 py-0.5 text-[10px] font-medium text-ink-soft">
            {artifact.tag}
          </span>
          <span className="text-[11px] text-ink-faint">Edited {artifact.edited}</span>
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
 *  purpose isn't obvious at a glance (e.g. the connect/disconnect plug). */
function Tooltip({
  label,
  children,
  delay = 400,
}: {
  label: string
  children: ReactNode
  delay?: number
}) {
  const [show, setShow] = useState(false)
  const timer = useRef<number | undefined>(undefined)
  const openSoon = () => {
    timer.current = window.setTimeout(() => setShow(true), delay)
  }
  const cancel = () => {
    window.clearTimeout(timer.current)
    setShow(false)
  }
  useEffect(() => () => window.clearTimeout(timer.current), [])

  return (
    <span
      className="relative inline-flex"
      onMouseEnter={openSoon}
      onMouseLeave={cancel}
      onFocus={openSoon}
      onBlur={cancel}
    >
      {children}
      {show && (
        <span
          role="tooltip"
          className="pointer-events-none absolute bottom-full left-1/2 z-30 mb-1.5 -translate-x-1/2 whitespace-nowrap rounded-md bg-ink px-2 py-1 text-[11px] font-medium text-canvas shadow-md"
        >
          {label}
          <span className="absolute left-1/2 top-full h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rotate-45 bg-ink" />
        </span>
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
  const [items, setItems] = useState(SAVED_CONTEXTS)
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState('All')
  // Which group headers are folded shut, and which context is opened in detail.
  const [folded, setFolded] = useState<Set<SavedContextKind>>(new Set())
  const [openId, setOpenId] = useState<string | null>(null)

  const toggle = (id: string) =>
    setItems((prev) =>
      prev.map((c) =>
        c.id === id ? { ...c, status: c.status === 'connected' ? 'needs-auth' : 'connected' } : c,
      ),
    )
  const remove = (id: string) => setItems((prev) => prev.filter((c) => c.id !== id))
  const add = (ctx: SavedContext) =>
    setItems((prev) => (prev.some((c) => c.id === ctx.id) ? prev : [ctx, ...prev]))
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

function StatusPill({ tone, label }: { tone: 'ok' | 'warn' | 'neutral'; label: string }) {
  const dot = tone === 'ok' ? 'bg-emerald-500' : tone === 'warn' ? 'bg-amber-500' : 'bg-line-strong'
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
              {section === 'scheduled' ? 'New schedule' : section === 'dispatch' ? 'New dispatch' : 'Upload'}
            </PrimaryButton>
          )}
        </header>

        {section === 'scheduled' && <ScheduledView />}
        {section === 'dispatch' && <DispatchView />}
        {section === 'customize' && <CustomizeView />}
      </div>
    </div>
  )
}

function ScheduledView() {
  return (
    <div className="space-y-2.5">
      {SCHEDULED_TASKS.map((t) => (
        <ScheduledRow key={t.id} task={t} />
      ))}
    </div>
  )
}

function ScheduledRow({ task }: { task: ScheduledTask }) {
  const [enabled, setEnabled] = useState(task.enabled)
  return (
    <div className="flex items-center gap-3 rounded-xl border border-line bg-surface px-4 py-3 shadow-sm">
      <StatusDot status={task.lastStatus} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-[14px] font-medium text-ink">{task.name}</div>
        <div className="truncate text-[12px] text-ink-faint">
          {task.cadence} · next {task.next}
        </div>
      </div>
      <Toggle on={enabled} onToggle={() => setEnabled((v) => !v)} />
    </div>
  )
}

function DispatchView() {
  return (
    <div className="space-y-2.5">
      {DISPATCH_RUNS.map((r) => (
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

function StatusDot({ status }: { status: ScheduledTask['lastStatus'] }) {
  const tone =
    status === 'ok' ? 'bg-emerald-500' : status === 'failed' ? 'bg-red-500' : 'bg-line-strong'
  return <span className={`mt-0.5 h-2.5 w-2.5 shrink-0 rounded-full ${tone}`} />
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
