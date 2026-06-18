import { useState, type ReactNode } from 'react'
import {
  AlertCircle,
  CheckCircle2,
  FileText,
  Image as ImageIcon,
  Loader2,
  Mail,
  Plus,
  Presentation,
  Sheet,
} from 'lucide-react'
import type { ArtifactKind, SectionId } from '../types'
import { SECTION_META } from '../lib/sections'
import {
  ALL_ARTIFACTS,
  DISPATCH_RUNS,
  PROJECTS,
  SCHEDULED_TASKS,
  type DispatchRun,
  type ScheduledTask,
} from '../data/cowork'

const KIND_ICON: Record<ArtifactKind, typeof FileText> = {
  doc: FileText,
  email: Mail,
  image: ImageIcon,
  slide: Presentation,
  sheet: Sheet,
}

/** The main area when a cross-cutting tool (Projects, Artifacts, …) is open
 *  instead of a conversation. All content is mock — this is a clickable demo. */
export function SectionView({ section }: { section: SectionId }) {
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
            <button className="flex shrink-0 items-center gap-1.5 rounded-lg border border-line-strong bg-surface px-3 py-1.5 text-[13px] font-medium text-ink shadow-sm transition hover:border-accent hover:text-accent-strong">
              <Plus size={15} />
              {section === 'projects'
                ? 'New project'
                : section === 'scheduled'
                  ? 'New schedule'
                  : section === 'dispatch'
                    ? 'New dispatch'
                    : 'Upload'}
            </button>
          )}
        </header>

        {section === 'projects' && <ProjectsView />}
        {section === 'artifacts' && <ArtifactsView />}
        {section === 'scheduled' && <ScheduledView />}
        {section === 'dispatch' && <DispatchView />}
        {section === 'customize' && <CustomizeView />}
      </div>
    </div>
  )
}

function ProjectsView() {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {PROJECTS.map((p) => (
        <button
          key={p.id}
          className="flex flex-col rounded-xl border border-line bg-surface p-4 text-left shadow-sm transition hover:border-accent hover:shadow"
        >
          <div className="flex items-baseline justify-between gap-2">
            <span className="font-medium text-ink">{p.name}</span>
            <span className="shrink-0 text-[11px] text-ink-faint">{p.updated}</span>
          </div>
          <span className="mt-1 line-clamp-2 text-[13px] leading-snug text-ink-soft">
            {p.description}
          </span>
          <span className="mt-3 text-[11px] text-ink-faint">{p.items} items</span>
        </button>
      ))}
    </div>
  )
}

function ArtifactsView() {
  return (
    <div className="overflow-hidden rounded-xl border border-line bg-surface shadow-sm">
      {ALL_ARTIFACTS.map((a, i) => {
        const Icon = KIND_ICON[a.kind]
        return (
          <button
            key={a.id}
            className={`flex w-full items-center gap-3 px-3 py-2.5 text-left transition hover:bg-panel-2/60 ${
              i > 0 ? 'border-t border-line' : ''
            }`}
          >
            <Icon size={17} className="shrink-0 text-cap-workspace" />
            <div className="min-w-0 flex-1">
              <div className="truncate text-[13px] font-medium text-ink">{a.name}</div>
              <div className="truncate text-[11px] text-ink-faint">{a.meta}</div>
            </div>
            <span className="shrink-0 truncate text-[11px] text-ink-faint">{a.source}</span>
          </button>
        )
      })}
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
      <Card title="Default model" desc="What new conversations start with.">
        <span className="rounded-lg bg-panel-2 px-3 py-1 text-[12px] font-medium text-ink">
          Claude Opus 4.8 · High
        </span>
      </Card>
      <ToggleCard title="Weekly digest" desc="A Monday summary of everything you shipped." defaultOn />
      <ToggleCard title="Suggest scheduled tasks" desc="Spot repeat work and offer to automate it." />
    </div>
  )
}

/* — shared bits — */

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
