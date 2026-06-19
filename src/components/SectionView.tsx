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
  Loader2,
  MessageSquare,
  Plug,
  Plus,
  Search,
} from 'lucide-react'
import type { Session, SectionId } from '../types'
import { SECTION_META } from '../lib/sections'
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
}: {
  section: SectionId
  onOpenSession: (id: string) => void
  onNewSession: () => void
}) {
  if (section === 'projects')
    return <ProjectsSection onOpenSession={onOpenSession} onNewSession={onNewSession} />
  if (section === 'artifacts') return <ArtifactsSection />
  return <GenericSection section={section} />
}

/* ─────────────────────────── Projects ─────────────────────────── */

function ProjectsSection({
  onOpenSession,
  onNewSession,
}: {
  onOpenSession: (id: string) => void
  onNewSession: () => void
}) {
  const [openId, setOpenId] = useState<string | null>(null)
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
