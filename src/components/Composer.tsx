import { useEffect, useRef, useState, type ReactNode } from 'react'
import {
  Check,
  ChevronDown,
  CornerDownLeft,
  FileText,
  GitBranch,
  Image as ImageIcon,
  PanelsTopLeft,
  Trash2,
} from 'lucide-react'
import type {
  AddedContext,
  Attachment,
  Capability,
  Connector,
  PanelFocus,
  Repo,
  Workspace,
} from '../types'
import { ModelEffortControl } from './ModelEffortControl'
import { AddContextButton } from './AddContextButton'
import { PermissionModeControl } from './PermissionModeControl'
import { AudioInputControl } from './AudioInputControl'
import { UsageControl } from './UsageControl'
import { connectorIconFor } from '../lib/connectors'
import { CAP_META } from '../lib/capabilities'
import { sameFocus } from '../lib/focus'

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
  onRemoveContext,
}: {
  workspaces: Workspace[]
  repos: Repo[]
  connectors: Connector[]
  attachments: Attachment[]
  focus: PanelFocus | null
  /** Locks free-typing — used while the guided tour is auto-playing. */
  disabled?: boolean
  onSend: (text: string) => void
  onAddContext: (ctx: AddedContext) => void
  onOpenContext: (focus: PanelFocus) => void
  onRemoveContext: (focus: PanelFocus) => void
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

  const groups: ChipGroupModel[] = []
  if (workspaces.length) {
    groups.push({
      key: 'workspaces',
      label: 'Workspaces',
      tone: 'workspace',
      icon: <PanelsTopLeft size={12} />,
      items: workspaces.map((w) => ({
        key: w.id,
        label: w.label,
        icon: <PanelsTopLeft size={12} />,
        focus: { kind: 'workspace', id: w.id },
      })),
    })
  }
  if (repos.length) {
    groups.push({
      key: 'repos',
      label: 'Repositories',
      tone: 'repo',
      icon: <GitBranch size={12} />,
      items: repos.map((r) => ({
        key: r.id,
        label: r.label,
        icon: <GitBranch size={12} />,
        focus: { kind: 'repo', id: r.id },
      })),
    })
  }
  if (plainConnectors.length) {
    groups.push({
      key: 'connectors',
      label: 'Connectors',
      tone: 'repo',
      icon: connIcon('connector'),
      items: plainConnectors.map((c) => ({
        key: c.id,
        label: c.label,
        icon: connIcon(c.kind),
        focus: { kind: 'connector', id: c.id },
      })),
    })
  }
  if (mcpServers.length) {
    groups.push({
      key: 'mcp',
      label: 'MCP servers',
      tone: 'repo',
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
      tone: 'chat',
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
      tone: 'chat',
      icon: <ImageIcon size={12} />,
      items: photoItems.map((a) => ({
        key: a.id,
        label: a.label,
        icon: <ImageIcon size={12} />,
        focus: { kind: 'photo', id: a.id },
      })),
    })
  }
  const hasChips = groups.length > 0

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
            {groups.map((g) => (
              <ChipGroup
                key={g.key}
                group={g}
                focus={focus}
                onOpen={onOpenContext}
                onRemove={onRemoveContext}
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
            <AddContextButton onAttach={onAddContext} />
            <AudioInputControl />
          </div>
          <div className="flex items-center gap-1.5">
            <ModelEffortControl />
            <UsageControl />
          </div>
        </div>

        <p className="mt-2 text-center text-[11px] text-ink-faint">
          Prototype · the guided tour drives the escalation. Free-typed replies get a canned answer.
        </p>
      </div>
    </div>
  )
}

/** One attached-context item inside a typed group. */
interface ChipItem {
  key: string
  label: string
  icon: ReactNode
  focus: PanelFocus
}

/** A type of attached context (Files, Connectors, …) with its items. */
interface ChipGroupModel {
  key: string
  label: string
  tone: Capability
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
  onRemove: (f: PanelFocus) => void
  skipConfirm: boolean
  onSkipConfirm: (v: boolean) => void
}) {
  const [open, setOpen] = useState(false)
  // The item key currently awaiting delete confirmation (null = none).
  const [confirmKey, setConfirmKey] = useState<string | null>(null)
  // Local "don't ask again" tick inside the confirmation prompt.
  const [dontAsk, setDontAsk] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)
  const anyActive = group.items.some((it) => sameFocus(focus, it.focus))

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  // Reset any pending confirmation whenever the popup closes.
  useEffect(() => {
    if (!open) {
      setConfirmKey(null)
      setDontAsk(false)
    }
  }, [open])

  const requestRemove = (it: ChipItem) => {
    if (skipConfirm) {
      onRemove(it.focus)
      return
    }
    setDontAsk(false)
    setConfirmKey(it.key)
  }

  const confirmRemove = (it: ChipItem) => {
    if (dontAsk) onSkipConfirm(true)
    onRemove(it.focus)
    setConfirmKey(null)
    setDontAsk(false)
  }

  // A lone item needs no grouping — show it directly.
  if (group.items.length === 1) {
    const only = group.items[0]
    return (
      <Chip icon={only.icon} tone={group.tone} active={anyActive} onClick={() => onOpen(only.focus)}>
        {only.label}
      </Chip>
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
                <div key={it.key} className="rounded-lg bg-panel-2/60 px-2 py-2">
                  <p className="text-[12px] leading-snug text-ink">
                    Remove <span className="font-medium">{it.label}</span> from the conversation?
                  </p>
                  <button
                    type="button"
                    onClick={() => setDontAsk((v) => !v)}
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
                  <div className="mt-2 flex justify-end gap-1.5">
                    <button
                      type="button"
                      onClick={() => setConfirmKey(null)}
                      className="rounded-md px-2 py-1 text-[12px] font-medium text-ink-soft transition hover:bg-panel-2"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={() => confirmRemove(it)}
                      className="rounded-md bg-removed px-2 py-1 text-[12px] font-medium text-white transition hover:brightness-95"
                    >
                      Remove
                    </button>
                  </div>
                </div>
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

function Chip({
  icon,
  tone,
  active,
  count,
  expandable,
  open,
  onClick,
  children,
}: {
  icon: ReactNode
  tone: Capability
  active: boolean
  count?: number
  expandable?: boolean
  open?: boolean
  onClick: () => void
  children: ReactNode
}) {
  // One source of truth for the per-capability palette (see lib/capabilities).
  const { tint, color } = CAP_META[tone]
  const toneClass = `${tint} ${color}`
  return (
    <button
      onClick={onClick}
      title={expandable ? `${children} (${count})` : 'Open in sidebar'}
      aria-haspopup={expandable ? 'menu' : undefined}
      aria-expanded={expandable ? open : undefined}
      className={`inline-flex max-w-[220px] items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium transition ${toneClass} ${
        active ? 'ring-1 ring-accent' : 'ring-1 ring-transparent hover:ring-line-strong'
      }`}
    >
      {icon}
      <span className="truncate">{children}</span>
      {count != null && <span className="tabular-nums opacity-60">· {count}</span>}
      {expandable && (
        <ChevronDown size={11} className={`opacity-70 transition ${open ? 'rotate-180' : ''}`} />
      )}
    </button>
  )
}
