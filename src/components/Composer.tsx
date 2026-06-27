import { useEffect, useRef, useState, type ReactNode } from 'react'
import {
  Check,
  CornerDownLeft,
  FileText,
  FolderGit2,
  GitBranch,
  Github,
  Image as ImageIcon,
  PanelsTopLeft,
  Trash2,
  X,
} from 'lucide-react'
import type {
  AddedContext,
  Attachment,
  Connector,
  PanelFocus,
  Repo,
  Workspace,
} from '../types'
import { ModelEffortControl } from './ModelEffortControl'
import { AddContextButton } from './AddContextButton'
import { Chip } from './Chip'
import { PermissionModeControl } from './PermissionModeControl'
import { AudioInputControl } from './AudioInputControl'
import { UsageControl } from './UsageControl'
import { HostsControl } from './HostsControl'
import { ProvidersControl } from './ProvidersControl'
import { GITHUB_CONNECTOR_ID, connectorIconFor } from '../lib/connectors'
import { getDecision, setDecision } from '../lib/prefs'
import { type ChipTone } from '../lib/capabilities'
import { sameFocus } from '../lib/focus'
import { useDismissable } from '../lib/useDismissable'

const SKIP_CONFIRM_KEY = 'claude-ui.composer.skipDeleteConfirm.v2'

/** Which context types the user has ticked "Don't ask again" for — keyed by the
 *  chip group's key (files, connectors, …), so muting one type leaves the
 *  confirmation in place for the others. */
function loadSkipConfirm(): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(SKIP_CONFIRM_KEY)
    return raw ? (JSON.parse(raw) as Record<string, boolean>) : {}
  } catch {
    return {}
  }
}

/** The distinct source folders contributing to a workspace, in first-seen
 *  order. A workspace's artifacts are tagged with the folder they came from;
 *  seeded/demo outputs carry no source, so such a workspace has zero folders. */
function workspaceFoldersOf(workspace: Workspace | undefined): { id: string; label: string }[] {
  if (!workspace) return []
  const seen = new Map<string, { id: string; label: string }>()
  for (const a of workspace.artifacts) {
    if (a.source && !seen.has(a.source.id)) seen.set(a.source.id, { id: a.source.id, label: a.source.label })
  }
  return [...seen.values()]
}

/** The single composer for every conversation. The chips above it show what
 *  context is *attached* to the thread — the thing that, in today's app, is
 *  instead encoded by which tab you opened. Every chip is clickable and opens
 *  that context's sidebar. */
export function Composer({
  workspaces,
  repos,
  connectors,
  attachments,
  focus,
  disabled,
  onSend,
  onAddContext,
  onOpenContext,
  onRemoveContexts,
  onRemoveFolder,
  sessionId,
  messageTokens,
}: {
  workspaces: Workspace[]
  repos: Repo[]
  connectors: Connector[]
  attachments: Attachment[]
  focus: PanelFocus | null
  /** Locks free-typing — used while the guided tour is auto-playing. */
  disabled?: boolean
  /** The open session, so the usage gauge's plan rings track this thread. */
  sessionId?: string
  /** Live Messages token count of the open thread, so the usage gauge + its
   *  context breakdown fill in real time as the conversation grows. */
  messageTokens?: number
  onSend: (text: string) => void
  onAddContext: (ctx: AddedContext) => void
  onOpenContext: (focus: PanelFocus) => void
  /** Removes one or more contexts at once (a cascade may remove two). */
  onRemoveContexts: (focuses: PanelFocus[]) => void
  /** Removes a single source folder from the shared workspace — used by the
   *  one-folder workspace chip's ✕ so it matches the panel's per-folder delete. */
  onRemoveFolder?: (sourceId: string) => void
}) {
  const [value, setValue] = useState('')
  const ref = useRef<HTMLTextAreaElement>(null)
  // "Don't ask again" — tracked per context type, so opting out of (say)
  // deleting files still confirms before removing a repo.
  const [skipConfirm, setSkipConfirm] = useState<Record<string, boolean>>(loadSkipConfirm)
  const setTypeSkip = (typeKey: string, v: boolean) => {
    setSkipConfirm((prev) => {
      const next = { ...prev, [typeKey]: v }
      try {
        localStorage.setItem(SKIP_CONFIRM_KEY, JSON.stringify(next))
      } catch {
        /* ignore quota / privacy-mode errors */
      }
      return next
    })
  }

  // Group attached context by type. Every type can hold more than one item, so
  // each one collapses into a single chip with a secondary list once it does;
  // a group with just one item renders as a plain chip.
  const connIcon = (kind: Connector['kind']) => {
    const Icon = connectorIconFor(kind)
    return <Icon size={12} />
  }
  const plainConnectors = connectors.filter((c) => c.kind !== 'mcp')
  const mcpServers = connectors.filter((c) => c.kind === 'mcp')
  const fileItems = attachments.filter((a) => a.kind === 'file')
  const photoItems = attachments.filter((a) => a.kind === 'photo')

  // Dependency between a GitHub-remote repo and the GitHub connector. It stays
  // invisible until a removal could break it — then the chip's confirm offers to
  // cascade (see the cascade plans below).
  const hasGitHubConnector = connectors.some((c) => c.id === GITHUB_CONNECTOR_ID)
  const remoteRepos = repos.filter((r) => r.remote)

  const groups: ChipGroupModel[] = []
  if (repos.length) {
    groups.push({
      key: 'repos',
      label: 'Repositories',
      tone: 'repo',
      icon: <GitBranch size={12} />,
      items: repos.map((r) => {
        // Removing this repo orphans the connector only if it's the sole repo
        // that still uses one.
        const orphansConnector =
          !!r.remote && hasGitHubConnector && remoteRepos.every((o) => o.id === r.id)
        return {
          key: r.id,
          label: r.label,
          icon: r.origin === 'local' ? <FolderGit2 size={12} /> : <Github size={12} />,
          focus: { kind: 'repo', id: r.id },
          cascade: orphansConnector
            ? {
                detail: 'Nothing else is using the GitHub connector — remove it too?',
                keepLabel: 'Keep connector',
                removeAllLabel: 'Remove both',
                extra: [{ kind: 'connector', id: GITHUB_CONNECTOR_ID }],
                prefKey: 'cascadeRepoRemove',
                keepValue: 'keep',
                removeAllValue: 'both',
              }
            : undefined,
        }
      }),
    })
  }
  if (plainConnectors.length) {
    groups.push({
      key: 'connectors',
      label: 'Connectors',
      tone: 'connector',
      icon: connIcon('connector'),
      items: plainConnectors.map((c) => {
        // Removing the GitHub connector strands any repo that depends on it.
        const dependents = c.id === GITHUB_CONNECTOR_ID ? remoteRepos : []
        const n = dependents.length
        return {
          key: c.id,
          label: c.label,
          icon: connIcon(c.kind),
          focus: { kind: 'connector', id: c.id },
          cascade: n
            ? {
                detail: `${n} repo${n > 1 ? 's' : ''} depend${n > 1 ? '' : 's'} on it — remove ${
                  n > 1 ? 'them' : 'it'
                } too?`,
                keepLabel: n > 1 ? 'Keep repos' : 'Keep repo',
                removeAllLabel: n > 1 ? 'Remove all' : 'Remove both',
                extra: dependents.map((r) => ({ kind: 'repo', id: r.id })),
                prefKey: 'cascadeConnectorRemove',
                keepValue: 'keep',
                removeAllValue: 'all',
              }
            : undefined,
        }
      }),
    })
  }
  if (mcpServers.length) {
    groups.push({
      key: 'mcp',
      label: 'MCP servers',
      tone: 'mcp',
      icon: connIcon('mcp'),
      items: mcpServers.map((c) => ({
        key: c.id,
        label: c.label,
        icon: connIcon('mcp'),
        focus: { kind: 'connector', id: c.id },
      })),
    })
  }
  if (fileItems.length) {
    groups.push({
      key: 'files',
      label: 'Files',
      tone: 'file',
      icon: <FileText size={12} />,
      items: fileItems.map((a) => ({
        key: a.id,
        label: a.label,
        icon: <FileText size={12} />,
        focus: { kind: 'file', id: a.id },
      })),
    })
  }
  if (photoItems.length) {
    groups.push({
      key: 'photos',
      label: 'Photos',
      tone: 'photo',
      icon: <ImageIcon size={12} />,
      items: photoItems.map((a) => ({
        key: a.id,
        label: a.label,
        icon: <ImageIcon size={12} />,
        focus: { kind: 'photo', id: a.id },
      })),
    })
  }
  // The workspace chip is special: the model keeps one shared workspace, and its
  // "items" are the distinct source folders inside it. So it renders by folder
  // count — a single removable chip at 0–1 folder, a counted chip at ≥2 (whose
  // folders are managed in the panel) — rather than going through the generic
  // group machinery like the other context types.
  const workspace = workspaces[0]
  const workspaceFolders = workspaceFoldersOf(workspace)
  const workspaceNode = !workspace ? null : workspaceFolders.length >= 2 ? (
    <Chip
      key="workspaces"
      icon={<PanelsTopLeft size={12} />}
      tone="workspace"
      active={sameFocus(focus, { kind: 'workspace', id: workspace.id })}
      count={workspaceFolders.length}
      hint={`${workspaceFolders.length} source folders`}
      onClick={() => onOpenContext({ kind: 'workspace', id: workspace.id })}
    >
      {workspace.label}
    </Chip>
  ) : (
    // 0–1 folder reuses the generic single-item chip. With one folder the chip
    // shows that folder's name and its ✕ removes just that folder (matching the
    // panel's per-folder delete); with none, the chip is the workspace itself
    // and its ✕ removes the whole workspace.
    <ChipGroup
      key="workspaces"
      group={{
        key: 'workspaces',
        label: 'Workspace',
        tone: 'workspace',
        icon: <PanelsTopLeft size={12} />,
        items: [
          {
            key: workspace.id,
            label: workspaceFolders[0]?.label ?? workspace.label,
            icon: <PanelsTopLeft size={12} />,
            focus: { kind: 'workspace', id: workspace.id },
          },
        ],
      }}
      focus={focus}
      onOpen={onOpenContext}
      onRemove={
        workspaceFolders[0] && onRemoveFolder
          ? () => onRemoveFolder(workspaceFolders[0].id)
          : onRemoveContexts
      }
      skipConfirm={!!skipConfirm['workspaces']}
      onSkipConfirm={(v) => setTypeSkip('workspaces', v)}
    />
  )

  const hasChips = !!workspaceNode || groups.length > 0

  const submit = () => {
    const t = value.trim()
    if (!t || disabled) return
    onSend(t)
    setValue('')
    if (ref.current) ref.current.style.height = 'auto'
  }

  return (
    <div className="px-4 pb-4 pt-1">
      <div className="mx-auto w-full max-w-3xl">
        {/* Attached-context chips — one per type. A type with several items
            collapses into a counted chip whose popup lists them; clicking an
            item opens that context's sidebar. */}
        {hasChips && (
          <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
            {workspaceNode}
            {groups.map((g) => (
              <ChipGroup
                key={g.key}
                group={g}
                focus={focus}
                onOpen={onOpenContext}
                onRemove={onRemoveContexts}
                skipConfirm={!!skipConfirm[g.key]}
                onSkipConfirm={(v) => setTypeSkip(g.key, v)}
              />
            ))}
          </div>
        )}

        {/* Input — clean inside; Enter sends, Shift+Enter for a new line */}
        <div
          className={`flex items-end gap-2 rounded-2xl border border-line-strong bg-surface px-4 py-3 shadow-sm transition focus-within:border-accent ${
            disabled ? 'opacity-60' : ''
          }`}
        >
          <textarea
            ref={ref}
            value={value}
            rows={1}
            disabled={disabled}
            onChange={(e) => {
              setValue(e.target.value)
              e.target.style.height = 'auto'
              e.target.style.height = Math.min(e.target.scrollHeight, 180) + 'px'
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                submit()
              }
            }}
            placeholder={disabled ? 'Playing the tour…' : 'Reply to Claude…'}
            className="max-h-[180px] min-w-0 flex-1 resize-none bg-transparent text-[15px] leading-relaxed text-ink outline-none placeholder:text-ink-faint disabled:cursor-not-allowed"
          />
          <span className="shrink-0 self-end pb-0.5 text-ink-faint" title="Enter to send">
            <CornerDownLeft size={16} />
          </span>
        </div>

        {/* Controls under the box, split left / right */}
        <div className="mt-2 flex items-center justify-between gap-2 px-0.5">
          <div className="flex items-center gap-1">
            <PermissionModeControl />
            <AddContextButton
              onAttach={onAddContext}
              connectors={connectors}
              repos={repos}
              attachments={attachments}
              workspaces={workspaces}
            />
            <AudioInputControl />
          </div>
          <div className="flex items-center gap-1.5">
            <ModelEffortControl />
            <ProvidersControl />
            <HostsControl />
            <UsageControl sessionId={sessionId} messageTokens={messageTokens} />
          </div>
        </div>

        <p className="mt-2 text-center text-[11px] text-ink-faint">
          Prototype · the model is a local mock, but every turn — tour or free-typed — is a real round-trip through the tool interface.
        </p>
      </div>
    </div>
  )
}

/** A dependency cascade offered when removing an item would break a link — e.g.
 *  removing the last GitHub-remote repo can also drop the now-unused connector,
 *  or removing the connector can also drop the repos that depend on it. */
interface CascadePlan {
  /** Second line of the confirm — the cascade question. */
  detail: string
  /** Button that removes only the clicked item (keeps the linked context). */
  keepLabel: string
  /** Button that removes the clicked item *and* the linked contexts. */
  removeAllLabel: string
  /** The linked contexts removed when the user picks "remove all". */
  extra: PanelFocus[]
  /** Persisted-decision key + the values stored for each choice. */
  prefKey: string
  keepValue: string
  removeAllValue: string
}

/** One attached-context item inside a typed group. */
interface ChipItem {
  key: string
  label: string
  icon: ReactNode
  focus: PanelFocus
  /** Present when removing this item can cascade to a linked context. */
  cascade?: CascadePlan
}

/** A type of attached context (Files, Connectors, …) with its items. */
interface ChipGroupModel {
  key: string
  label: string
  tone: ChipTone
  icon: ReactNode
  items: ChipItem[]
}

/** Renders a context type as a chip. A single item is a plain chip that opens
 *  its sidebar; several items collapse into a counted chip whose popup lists
 *  them, and picking one opens that item's sidebar. Each popup row also has a
 *  trash button that removes the item (after a confirmation that can be muted). */
function ChipGroup({
  group,
  focus,
  onOpen,
  onRemove,
  skipConfirm,
  onSkipConfirm,
}: {
  group: ChipGroupModel
  focus: PanelFocus | null
  onOpen: (f: PanelFocus) => void
  onRemove: (focuses: PanelFocus[]) => void
  skipConfirm: boolean
  onSkipConfirm: (v: boolean) => void
}) {
  const [open, setOpen] = useState(false)
  // The item key currently awaiting delete confirmation (null = none).
  const [confirmKey, setConfirmKey] = useState<string | null>(null)
  // Local "don't ask again" tick inside the confirmation prompt.
  const [dontAsk, setDontAsk] = useState(false)
  const anyActive = group.items.some((it) => sameFocus(focus, it.focus))

  // Dismiss the popup — or, for a single chip, its remove confirmation — on an
  // outside click or Escape.
  const wrapRef = useDismissable<HTMLDivElement>(open || confirmKey !== null, () => {
    setOpen(false)
    setConfirmKey(null)
    setDontAsk(false)
  })

  // Reset any pending confirmation whenever the popup closes.
  useEffect(() => {
    if (!open) {
      setConfirmKey(null)
      setDontAsk(false)
    }
  }, [open])

  const finishConfirm = () => {
    setConfirmKey(null)
    setDontAsk(false)
  }

  // Click the chip's trash / ✕. If a decision is already remembered (a basic
  // mute, or a cascade choice), apply it silently; otherwise open the confirm.
  const requestRemove = (it: ChipItem) => {
    if (it.cascade) {
      const decision = getDecision(it.cascade.prefKey)
      if (decision === it.cascade.removeAllValue) return onRemove([it.focus, ...it.cascade.extra])
      if (decision === it.cascade.keepValue) return onRemove([it.focus])
      setDontAsk(false)
      setConfirmKey(it.key)
      return
    }
    if (skipConfirm) return onRemove([it.focus])
    setDontAsk(false)
    setConfirmKey(it.key)
  }

  // "Only" removes just this item (the basic Remove, or a cascade's keep-the-link
  // choice); "All" also removes the linked contexts.
  const removeOnly = (it: ChipItem) => {
    if (dontAsk) {
      if (it.cascade) setDecision(it.cascade.prefKey, it.cascade.keepValue)
      else onSkipConfirm(true)
    }
    onRemove([it.focus])
    finishConfirm()
  }

  const removeAll = (it: ChipItem) => {
    if (dontAsk && it.cascade) setDecision(it.cascade.prefKey, it.cascade.removeAllValue)
    onRemove([it.focus, ...(it.cascade?.extra ?? [])])
    finishConfirm()
  }

  // A lone item needs no grouping — show it directly, with a hover ✕ to remove
  // it (the multi-item case gets its trash button inside the popup instead).
  if (group.items.length === 1) {
    const only = group.items[0]
    return (
      <div ref={wrapRef} className="relative">
        <div className="group/chip relative inline-flex">
          <Chip icon={only.icon} tone={group.tone} active={anyActive} onClick={() => onOpen(only.focus)}>
            {only.label}
          </Chip>
          <button
            type="button"
            onClick={() => requestRemove(only)}
            aria-label={`Remove ${only.label} from the conversation`}
            title="Remove from context"
            className="absolute -right-1.5 -top-1.5 flex h-4 w-4 items-center justify-center rounded-full border border-line-strong bg-surface text-ink-faint opacity-0 shadow-sm transition hover:bg-removed-bg hover:text-removed focus-visible:opacity-100 group-hover/chip:opacity-100"
          >
            <X size={10} strokeWidth={2.5} />
          </button>
        </div>

        {confirmKey === only.key && (
          <div className="absolute bottom-full left-0 z-20 mb-1.5 w-[264px] rounded-xl border border-line-strong bg-surface p-1 shadow-xl">
            <RemoveConfirm
              label={only.label}
              cascade={only.cascade}
              dontAsk={dontAsk}
              onToggleDontAsk={() => setDontAsk((v) => !v)}
              onCancel={finishConfirm}
              onRemoveOnly={() => removeOnly(only)}
              onRemoveAll={only.cascade ? () => removeAll(only) : undefined}
            />
          </div>
        )}
      </div>
    )
  }

  return (
    <div ref={wrapRef} className="relative">
      <Chip
        icon={group.icon}
        tone={group.tone}
        active={anyActive || open}
        count={group.items.length}
        expandable
        open={open}
        onClick={() => setOpen((o) => !o)}
      >
        {group.label}
      </Chip>

      {open && (
        <div
          role="menu"
          aria-label={group.label}
          className="absolute bottom-full left-0 z-20 mb-1.5 max-h-72 w-[256px] overflow-auto rounded-xl border border-line-strong bg-surface p-1 shadow-xl"
        >
          <div className="px-1.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
            {group.label}
          </div>
          {group.items.map((it) => {
            if (confirmKey === it.key) {
              return (
                <RemoveConfirm
                  key={it.key}
                  label={it.label}
                  cascade={it.cascade}
                  dontAsk={dontAsk}
                  onToggleDontAsk={() => setDontAsk((v) => !v)}
                  onCancel={finishConfirm}
                  onRemoveOnly={() => removeOnly(it)}
                  onRemoveAll={it.cascade ? () => removeAll(it) : undefined}
                />
              )
            }
            const active = sameFocus(focus, it.focus)
            return (
              <div
                key={it.key}
                className={`group flex items-center gap-1 rounded-lg pr-1 transition ${
                  active ? 'bg-panel-2' : 'hover:bg-panel-2/60'
                }`}
              >
                <button
                  type="button"
                  onClick={() => {
                    onOpen(it.focus)
                    setOpen(false)
                  }}
                  className="flex min-w-0 flex-1 items-center gap-2 px-1.5 py-1.5 text-left"
                >
                  <span className="shrink-0 text-ink-soft">{it.icon}</span>
                  <span className="min-w-0 flex-1 truncate text-[13px] text-ink">{it.label}</span>
                  {active && <Check size={14} className="shrink-0 text-accent" />}
                </button>
                <button
                  type="button"
                  onClick={() => requestRemove(it)}
                  title="Remove from context"
                  className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-ink-faint opacity-0 transition hover:bg-removed-bg hover:text-removed focus:opacity-100 group-hover:opacity-100"
                >
                  <Trash2 size={13} />
                </button>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

/** The remove confirmation — shared by the multi-item popup rows and the
 *  single-chip ✕ so both read and behave the same. Without a cascade it's the
 *  plain "Remove X?" with Cancel / Remove. With one it becomes the dependency
 *  prompt: a second line plus three choices — Cancel (abort), keep the linked
 *  context, or remove it too. The ☐ remembers whichever non-cancel choice. */
function RemoveConfirm({
  label,
  cascade,
  dontAsk,
  onToggleDontAsk,
  onCancel,
  onRemoveOnly,
  onRemoveAll,
}: {
  label: string
  cascade?: CascadePlan
  dontAsk: boolean
  onToggleDontAsk: () => void
  onCancel: () => void
  onRemoveOnly: () => void
  onRemoveAll?: () => void
}) {
  return (
    <div className="rounded-lg bg-panel-2/60 px-2 py-2">
      <p className="text-[12px] leading-snug text-ink">
        Remove <span className="font-medium">{label}</span>
        {cascade ? '?' : ' from the conversation?'}
      </p>
      {cascade && <p className="mt-1 text-[12px] leading-snug text-ink-soft">{cascade.detail}</p>}
      <button
        type="button"
        onClick={onToggleDontAsk}
        className="mt-2 flex items-center gap-1.5 text-[11px] text-ink-soft transition hover:text-ink"
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
      <div className="mt-2 flex flex-wrap justify-end gap-1.5">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md px-2 py-1 text-[12px] font-medium text-ink-soft transition hover:bg-panel-2"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={onRemoveOnly}
          className={
            cascade
              ? 'rounded-md px-2 py-1 text-[12px] font-medium text-ink ring-1 ring-line-strong transition hover:bg-panel-2'
              : 'rounded-md bg-removed px-2 py-1 text-[12px] font-medium text-white transition hover:brightness-95'
          }
        >
          {cascade ? cascade.keepLabel : 'Remove'}
        </button>
        {cascade && onRemoveAll && (
          <button
            type="button"
            onClick={onRemoveAll}
            className="rounded-md bg-removed px-2 py-1 text-[12px] font-medium text-white transition hover:brightness-95"
          >
            {cascade.removeAllLabel}
          </button>
        )}
      </div>
    </div>
  )
}

