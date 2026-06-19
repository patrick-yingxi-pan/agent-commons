import { useEffect, useRef, useState, type ReactNode } from 'react'
import {
  Check,
  ChevronLeft,
  ChevronRight,
  FileText,
  FolderGit2,
  FolderOpen,
  GitBranch,
  Github,
  Image as ImageIcon,
  Paperclip,
  Plug,
  Plus,
  Server,
} from 'lucide-react'
import type { AddedContext } from '../types'
import { gradientFor } from '../lib/thumbs'
import { GITHUB_CONNECTOR } from '../lib/connectors'
import { getDecision, setDecision } from '../lib/prefs'
import {
  CONNECTOR_OPTIONS,
  FILE_OPTIONS,
  FOLDER_ARTIFACTS,
  FOLDER_OPTIONS,
  GITHUB_REPO_OPTIONS,
  LOCAL_REPO_OPTIONS,
  MCP_OPTIONS,
  PHOTO_OPTIONS,
  REPO_DIFF,
  REPO_FILES,
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
export function AddContextButton({
  onAttach,
  hasGitHubConnector,
}: {
  onAttach: (ctx: AddedContext) => void
  /** Whether the GitHub connector is already attached — drives the "also add the
   *  connector?" prompt when attaching a repo with a GitHub remote. */
  hasGitHubConnector: boolean
}) {
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
                <WorkflowBody
                  type={activeType.id}
                  onAttach={attach}
                  hasGitHubConnector={hasGitHubConnector}
                />
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function WorkflowBody({
  type,
  onAttach,
  hasGitHubConnector,
}: {
  type: TypeId
  onAttach: (ctx: AddedContext) => void
  hasGitHubConnector: boolean
}) {
  if (type === 'folder') {
    return <FolderPicker onAttach={onAttach} hasGitHubConnector={hasGitHubConnector} />
  }
  if (type === 'repo') {
    return <RepoPicker onAttach={onAttach} hasGitHubConnector={hasGitHubConnector} />
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

type RepoContext = Extract<AddedContext, { kind: 'repo' }>

/** The chip / panel name for a local repo — the trailing folder name. */
function basename(path: string) {
  const parts = path.replace(/\/+$/, '').split('/')
  return parts[parts.length - 1] || path
}

/** A 3-choice attach confirmation shown inside the Add-context popover: Cancel
 *  aborts the whole attach; the secondary and primary buttons are the two
 *  outcomes; the ☐ remembers whichever outcome was picked. Used by both the
 *  repo connector prompt and the folder → repo / connector prompts. */
function AttachPromptCard({
  message,
  dontAsk,
  onToggleDontAsk,
  onCancel,
  secondaryLabel,
  onSecondary,
  primaryLabel,
  onPrimary,
}: {
  message: ReactNode
  dontAsk: boolean
  onToggleDontAsk: () => void
  onCancel: () => void
  secondaryLabel: string
  onSecondary: () => void
  primaryLabel: string
  onPrimary: () => void
}) {
  return (
    <div className="pb-1">
      <p className="px-1 text-[13px] leading-snug text-ink">{message}</p>
      <button
        type="button"
        onClick={onToggleDontAsk}
        className="mt-2 flex items-center gap-1.5 px-1 text-[11px] text-ink-soft transition hover:text-ink"
      >
        <span
          className={`flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border ${
            dontAsk ? 'border-accent bg-accent text-white' : 'border-line-strong'
          }`}
        >
          {dontAsk && <Check size={10} strokeWidth={3} />}
        </span>
        Don’t ask again
      </button>
      <div className="mt-2.5 flex flex-wrap justify-end gap-1.5">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md px-2 py-1 text-[12px] font-medium text-ink-soft transition hover:bg-panel-2"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={onSecondary}
          className="rounded-md px-2 py-1 text-[12px] font-medium text-ink ring-1 ring-line-strong transition hover:bg-panel-2"
        >
          {secondaryLabel}
        </button>
        <button
          type="button"
          onClick={onPrimary}
          className="rounded-md bg-accent px-2 py-1 text-[12px] font-medium text-white transition hover:bg-accent-strong"
        >
          {primaryLabel}
        </button>
      </div>
    </div>
  )
}

/** Repository picker: Local and GitHub sections. Picking a repo that has a
 *  GitHub remote, when the connector isn't already attached, asks whether to add
 *  the connector too (it's what's needed to push & open PRs) — Cancel aborts the
 *  whole attach, "Just the repo" / "Add both" decide, and a remembered choice
 *  skips the prompt next time. */
function RepoPicker({
  onAttach,
  hasGitHubConnector,
}: {
  onAttach: (ctx: AddedContext) => void
  hasGitHubConnector: boolean
}) {
  const [pending, setPending] = useState<RepoContext | null>(null)
  const [dontAsk, setDontAsk] = useState(false)

  const select = (ctx: RepoContext) => {
    // No GitHub remote, or the connector is already present → nothing to ask.
    if (!ctx.remote || hasGitHubConnector) {
      onAttach(ctx)
      return
    }
    const decision = getDecision('linkOnAttach')
    if (decision === 'always') {
      onAttach({ kind: 'connector', connector: GITHUB_CONNECTOR })
      onAttach(ctx)
      return
    }
    if (decision === 'never') {
      onAttach(ctx)
      return
    }
    setDontAsk(false)
    setPending(ctx)
  }

  if (pending) {
    return (
      <AttachPromptCard
        message={
          <>
            <span className="font-medium">{pending.label}</span> has a GitHub remote. Add the{' '}
            <span className="font-medium">GitHub connector</span> too, so Claude can push and open PRs?
          </>
        }
        dontAsk={dontAsk}
        onToggleDontAsk={() => setDontAsk((v) => !v)}
        onCancel={() => setPending(null)}
        secondaryLabel="Just the repo"
        onSecondary={() => {
          if (dontAsk) setDecision('linkOnAttach', 'never')
          onAttach(pending)
        }}
        primaryLabel="Add both"
        onPrimary={() => {
          if (dontAsk) setDecision('linkOnAttach', 'always')
          onAttach({ kind: 'connector', connector: GITHUB_CONNECTOR })
          onAttach(pending)
        }}
      />
    )
  }

  return (
    <>
      <Section label="Local">
        {LOCAL_REPO_OPTIONS.map((r) => (
          <OptionRow
            key={r.id}
            icon={<FolderGit2 size={16} />}
            label={r.path}
            meta={`${r.remote ?? 'local only'} · ${r.branch}`}
            onClick={() =>
              select({
                kind: 'repo',
                origin: 'local',
                label: basename(r.path),
                path: r.path,
                remote: r.remote,
                branch: r.branch,
                files: REPO_FILES,
                diff: REPO_DIFF,
                terminal: REPO_TERMINAL,
              })
            }
          />
        ))}
      </Section>
      <Section label="GitHub">
        {GITHUB_REPO_OPTIONS.map((r) => (
          <OptionRow
            key={r.id}
            icon={<Github size={16} />}
            label={r.remote}
            meta={`${r.branch} · ${r.meta}`}
            onClick={() =>
              select({
                kind: 'repo',
                origin: 'github',
                label: r.remote,
                remote: r.remote,
                branch: r.branch,
                files: REPO_FILES,
                diff: REPO_DIFF,
                terminal: REPO_TERMINAL,
              })
            }
          />
        ))}
      </Section>
    </>
  )
}

type FolderOption = (typeof FOLDER_OPTIONS)[number]

/** Folder picker. Attaching a folder normally just adds a workspace. When the
 *  folder is a git working tree it first offers to also attach it as a repo
 *  (code / diff / terminal); if that repo has a GitHub remote, it then chains
 *  the same "add the connector?" prompt the repo flow uses. Every prompt's
 *  Cancel aborts the whole attach, and each choice can be remembered. */
function FolderPicker({
  onAttach,
  hasGitHubConnector,
}: {
  onAttach: (ctx: AddedContext) => void
  hasGitHubConnector: boolean
}) {
  const [stage, setStage] = useState<'list' | 'repo' | 'connector'>('list')
  const [folder, setFolder] = useState<FolderOption | null>(null)
  const [dontAsk, setDontAsk] = useState(false)

  const attachFolder = (f: FolderOption) =>
    onAttach({ kind: 'folder', label: f.label, artifacts: FOLDER_ARTIFACTS })

  const repoCtxFor = (f: FolderOption): RepoContext => ({
    kind: 'repo',
    origin: 'local',
    label: basename(f.label),
    path: f.label,
    remote: f.repo?.remote,
    branch: f.repo!.branch,
    files: REPO_FILES,
    diff: REPO_DIFF,
    terminal: REPO_TERMINAL,
  })

  // Attach the folder (workspace) and its repo — connector first when wanted, so
  // focus lands on the repo.
  const attachFolderAndRepo = (f: FolderOption, withConnector: boolean) => {
    if (withConnector) onAttach({ kind: 'connector', connector: GITHUB_CONNECTOR })
    attachFolder(f)
    onAttach(repoCtxFor(f))
  }

  // The repo is being attached too — settle the GitHub connector question.
  const proceedWithRepo = (f: FolderOption) => {
    if (!f.repo?.remote || hasGitHubConnector) return attachFolderAndRepo(f, false)
    const decision = getDecision('linkOnAttach')
    if (decision === 'always') return attachFolderAndRepo(f, true)
    if (decision === 'never') return attachFolderAndRepo(f, false)
    setDontAsk(false)
    setFolder(f)
    setStage('connector')
  }

  const select = (f: FolderOption) => {
    if (!f.repo) return attachFolder(f) // not a git folder → workspace only
    const decision = getDecision('attachRepoOnFolder')
    if (decision === 'never') return attachFolder(f)
    if (decision === 'always') return proceedWithRepo(f)
    setDontAsk(false)
    setFolder(f)
    setStage('repo')
  }

  const backToList = () => {
    setStage('list')
    setFolder(null)
  }

  if (stage === 'repo' && folder) {
    return (
      <AttachPromptCard
        message={
          <>
            <span className="font-medium">{folder.label}</span> is a git repo (
            <span className="font-medium">{folder.repo!.branch}</span>). Also attach it as a{' '}
            <span className="font-medium">repository</span> — code, diff &amp; terminal?
          </>
        }
        dontAsk={dontAsk}
        onToggleDontAsk={() => setDontAsk((v) => !v)}
        onCancel={backToList}
        secondaryLabel="Just the folder"
        onSecondary={() => {
          if (dontAsk) setDecision('attachRepoOnFolder', 'never')
          attachFolder(folder)
        }}
        primaryLabel="Folder + repo"
        onPrimary={() => {
          if (dontAsk) setDecision('attachRepoOnFolder', 'always')
          proceedWithRepo(folder)
        }}
      />
    )
  }

  if (stage === 'connector' && folder) {
    return (
      <AttachPromptCard
        message={
          <>
            <span className="font-medium">{basename(folder.label)}</span> has a GitHub remote. Add the{' '}
            <span className="font-medium">GitHub connector</span> too, so Claude can push and open PRs?
          </>
        }
        dontAsk={dontAsk}
        onToggleDontAsk={() => setDontAsk((v) => !v)}
        onCancel={backToList}
        secondaryLabel="Skip connector"
        onSecondary={() => {
          if (dontAsk) setDecision('linkOnAttach', 'never')
          attachFolderAndRepo(folder, false)
        }}
        primaryLabel="Add connector"
        onPrimary={() => {
          if (dontAsk) setDecision('linkOnAttach', 'always')
          attachFolderAndRepo(folder, true)
        }}
      />
    )
  }

  return (
    <Section label="Recent folders">
      {FOLDER_OPTIONS.map((f) => (
        <OptionRow
          key={f.id}
          icon={<FolderOpen size={16} />}
          label={f.label}
          meta={`${f.meta}${f.repo ? ' · git repo' : ''}`}
          onClick={() => select(f)}
        />
      ))}
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
