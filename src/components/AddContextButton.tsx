import { useEffect, useRef, useState, type ReactNode } from 'react'
import {
  ChevronLeft,
  ChevronRight,
  FileText,
  FolderOpen,
  GitBranch,
  Image as ImageIcon,
  Paperclip,
  Plug,
  Plus,
  Server,
} from 'lucide-react'
import type { AddedContext } from '../types'
import { gradientFor } from '../lib/thumbs'
import {
  CONNECTOR_OPTIONS,
  FILE_OPTIONS,
  FOLDER_ARTIFACTS,
  FOLDER_OPTIONS,
  MCP_OPTIONS,
  PHOTO_OPTIONS,
  REPO_DIFF,
  REPO_FILES,
  REPO_OPTIONS,
  REPO_TERMINAL,
} from '../data/contextOptions'

type TypeId = 'files' | 'photos' | 'folder' | 'repo' | 'connector' | 'mcp'

const CONTEXT_TYPES: { id: TypeId; label: string; desc: string; Icon: typeof Paperclip }[] = [
  { id: 'files', label: 'Files', desc: 'Images, PDFs, docs from your computer', Icon: Paperclip },
  { id: 'photos', label: 'Photos', desc: 'Add from your photo library', Icon: ImageIcon },
  { id: 'folder', label: 'Folder', desc: 'Attach a local directory as a workspace', Icon: FolderOpen },
  { id: 'repo', label: 'Repository', desc: 'Connect a git repo to read & edit code', Icon: GitBranch },
  { id: 'connector', label: 'Connector', desc: 'Google Drive, Slack, Notion, Linear…', Icon: Plug },
  { id: 'mcp', label: 'MCP server', desc: 'Add a Model Context Protocol server', Icon: Server },
]

/** One consistent entry point for attaching context — every attachable thing
 *  (files, folders, repos, connectors, MCP servers) is "context" the thread
 *  gains. Step 1 picks the type; step 2 runs that type's specific workflow. */
export function AddContextButton({ onAttach }: { onAttach: (ctx: AddedContext) => void }) {
  const [open, setOpen] = useState(false)
  const [type, setType] = useState<TypeId | null>(null)
  const wrapRef = useRef<HTMLDivElement>(null)

  const close = () => {
    setOpen(false)
    setType(null)
  }

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) close()
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close()
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const attach = (ctx: AddedContext) => {
    onAttach(ctx)
    close()
  }

  const activeType = type ? CONTEXT_TYPES.find((t) => t.id === type)! : null

  return (
    <div ref={wrapRef} className="relative">
      <button
        onClick={() => (open ? close() : setOpen(true))}
        className={`flex h-8 w-8 items-center justify-center rounded-lg transition ${
          open ? 'bg-panel-2 text-ink' : 'text-ink-soft hover:bg-panel-2 hover:text-ink'
        }`}
        title="Add context — files, folders, repos, connectors, MCP servers"
        aria-label="Add context"
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        <Plus size={18} />
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Add context"
          className="absolute bottom-full left-0 z-20 mb-2 w-[340px] overflow-hidden rounded-xl border border-line-strong bg-surface shadow-xl"
        >
          {activeType === null ? (
            <div className="p-2">
              <div className="px-1.5 pb-1 pt-0.5 text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
                Add context
              </div>
              {CONTEXT_TYPES.map((t) => (
                <button
                  key={t.id}
                  onClick={() => setType(t.id)}
                  className="flex w-full items-center gap-2.5 rounded-lg px-1.5 py-1.5 text-left transition hover:bg-panel-2"
                >
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-panel-2 text-ink-soft">
                    <t.Icon size={15} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[13px] font-medium text-ink">{t.label}</span>
                    <span className="block truncate text-[11px] text-ink-faint">{t.desc}</span>
                  </span>
                  <ChevronRight size={15} className="shrink-0 text-ink-faint" />
                </button>
              ))}
            </div>
          ) : (
            <div className="p-2">
              <div className="flex items-center gap-1 px-0.5 pb-1.5">
                <button
                  onClick={() => setType(null)}
                  className="flex h-6 w-6 items-center justify-center rounded-md text-ink-soft transition hover:bg-panel-2"
                  title="Back"
                >
                  <ChevronLeft size={16} />
                </button>
                <span className="flex items-center gap-1.5 text-[13px] font-semibold text-ink">
                  <activeType.Icon size={14} />
                  {activeType.label}
                </span>
              </div>
              <div className="px-0.5">
                <WorkflowBody type={activeType.id} onAttach={attach} />
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function WorkflowBody({ type, onAttach }: { type: TypeId; onAttach: (ctx: AddedContext) => void }) {
  if (type === 'folder') {
    return (
      <Section label="Recent folders">
        {FOLDER_OPTIONS.map((f) => (
          <OptionRow
            key={f.id}
            icon={<FolderOpen size={16} />}
            label={f.label}
            meta={f.meta}
            onClick={() => onAttach({ kind: 'folder', label: f.label, artifacts: FOLDER_ARTIFACTS })}
          />
        ))}
      </Section>
    )
  }
  if (type === 'repo') {
    return (
      <Section label="Your repositories">
        {REPO_OPTIONS.map((r) => (
          <OptionRow
            key={r.id}
            icon={<GitBranch size={16} />}
            label={r.label}
            meta={`${r.branch} · ${r.meta}`}
            onClick={() =>
              onAttach({
                kind: 'repo',
                label: r.label,
                branch: r.branch,
                files: REPO_FILES,
                diff: REPO_DIFF,
                terminal: REPO_TERMINAL,
                connector: { id: 'gh-mcp', label: 'GitHub', kind: 'github' },
              })
            }
          />
        ))}
      </Section>
    )
  }
  if (type === 'connector') {
    return (
      <Section label="Available connectors">
        {CONNECTOR_OPTIONS.map((c) => (
          <OptionRow
            key={c.id}
            icon={<Plug size={16} />}
            label={c.label}
            meta="Connect account"
            onClick={() =>
              onAttach({
                kind: 'connector',
                connector: { id: c.id, label: c.label, kind: c.kind ?? 'connector' },
              })
            }
          />
        ))}
      </Section>
    )
  }
  if (type === 'mcp') {
    return (
      <Section label="From the MCP registry">
        {MCP_OPTIONS.map((m) => (
          <OptionRow
            key={m.id}
            icon={<Server size={16} />}
            label={m.label}
            meta={m.meta}
            onClick={() =>
              onAttach({ kind: 'mcp', connector: { id: `mcp-${m.id}`, label: `MCP · ${m.label}`, kind: 'mcp' } })
            }
          />
        ))}
      </Section>
    )
  }
  if (type === 'files') {
    return (
      <div className="pb-1">
        <div className="mb-2 flex flex-col items-center justify-center rounded-lg border border-dashed border-line-strong px-3 py-4 text-center">
          <Paperclip size={18} className="mb-1 text-ink-faint" />
          <span className="text-[12px] font-medium text-ink">Drop files here</span>
          <span className="text-[11px] text-ink-faint">or pick a recent file below</span>
        </div>
        {FILE_OPTIONS.map((f) => (
          <OptionRow
            key={f.id}
            icon={<FileText size={16} />}
            label={f.label}
            meta={f.meta}
            onClick={() =>
              onAttach({ kind: 'files', attachments: [{ id: f.id, label: f.label, kind: 'file' }] })
            }
          />
        ))}
      </div>
    )
  }
  // photos
  return (
    <Section label="Photo library">
      <div className="grid grid-cols-4 gap-1.5 px-1 pb-1">
        {PHOTO_OPTIONS.map((p) => (
          <button
            key={p.id}
            title={p.label}
            onClick={() =>
              onAttach({ kind: 'photos', attachments: [{ id: p.id, label: p.label, kind: 'photo' }] })
            }
            className={`aspect-square rounded-lg ring-1 ring-black/5 transition hover:opacity-80 ${gradientFor(
              p.id,
            )}`}
          />
        ))}
      </div>
    </Section>
  )
}

function Section({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="pb-1">
      <p className="px-1 pb-1.5 text-[11px] text-ink-faint">{label}</p>
      {children}
    </div>
  )
}

function OptionRow({
  icon,
  label,
  meta,
  onClick,
}: {
  icon: ReactNode
  label: string
  meta?: string
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className="mb-0.5 flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition hover:bg-panel-2"
    >
      <span className="shrink-0 text-ink-soft">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-medium text-ink">{label}</span>
        {meta && <span className="block truncate text-[11px] text-ink-faint">{meta}</span>}
      </span>
      <Plus size={15} className="shrink-0 text-ink-faint" />
    </button>
  )
}
