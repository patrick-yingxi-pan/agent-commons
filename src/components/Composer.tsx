import { useEffect, useRef, useState, type ReactNode } from 'react'
import {
  Check,
  ChevronDown,
  CornerDownLeft,
  FileText,
  GitBranch,
  Image as ImageIcon,
  PanelsTopLeft,
} from 'lucide-react'
import type { AddedContext, Attachment, Capability, Connector, PanelFocus } from '../types'
import { ModelEffortControl } from './ModelEffortControl'
import { AddContextButton } from './AddContextButton'
import { PermissionModeControl } from './PermissionModeControl'
import { AudioInputControl } from './AudioInputControl'
import { UsageControl } from './UsageControl'
import { connectorIconFor } from '../lib/connectors'
import { sameFocus } from '../lib/focus'

/** The single composer for every conversation. The chips above it show what
 *  context is *attached* to the thread — the thing that, in today's app, is
 *  instead encoded by which tab you opened. Every chip is clickable and opens
 *  that context's sidebar. */
export function Composer({
  caps,
  connectors,
  attachments,
  repoBranch,
  workspaceName,
  focus,
  onSend,
  onAddContext,
  onOpenContext,
}: {
  caps: Capability[]
  connectors: Connector[]
  attachments: Attachment[]
  repoBranch?: string
  workspaceName?: string
  focus: PanelFocus | null
  onSend: (text: string) => void
  onAddContext: (ctx: AddedContext) => void
  onOpenContext: (focus: PanelFocus) => void
}) {
  const [value, setValue] = useState('')
  const ref = useRef<HTMLTextAreaElement>(null)

  const hasWorkspace = caps.includes('workspace')
  const hasRepo = caps.includes('repo')

  // Group attached context by type. Types that can hold more than one item
  // (connectors, MCP servers, files, photos) collapse into a single chip with
  // a secondary list; a group with just one item renders as a plain chip.
  const connIcon = (kind: Connector['kind']) => {
    const Icon = connectorIconFor(kind)
    return <Icon size={12} />
  }
  const plainConnectors = connectors.filter((c) => c.kind !== 'mcp')
  const mcpServers = connectors.filter((c) => c.kind === 'mcp')
  const fileItems = attachments.filter((a) => a.kind === 'file')
  const photoItems = attachments.filter((a) => a.kind === 'photo')

  const groups: ChipGroupModel[] = []
  if (hasWorkspace) {
    groups.push({
      key: 'workspace',
      label: 'Workspace',
      tone: 'workspace',
      icon: <PanelsTopLeft size={12} />,
      items: [
        {
          key: 'workspace',
          label: workspaceName ?? 'Workspace',
          icon: <PanelsTopLeft size={12} />,
          focus: { kind: 'workspace' },
        },
      ],
    })
  }
  if (hasRepo) {
    groups.push({
      key: 'repo',
      label: 'Repository',
      tone: 'repo',
      icon: <GitBranch size={12} />,
      items: [
        {
          key: 'repo',
          label: repoBranch ?? 'main',
          icon: <GitBranch size={12} />,
          focus: { kind: 'repo' },
        },
      ],
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
    if (!t) return
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
              <ChipGroup key={g.key} group={g} focus={focus} onOpen={onOpenContext} />
            ))}
          </div>
        )}

        {/* Input — clean inside; Enter sends, Shift+Enter for a new line */}
        <div className="flex items-end gap-2 rounded-2xl border border-line-strong bg-surface px-4 py-3 shadow-sm transition focus-within:border-accent">
          <textarea
            ref={ref}
            value={value}
            rows={1}
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
            placeholder="Reply to Claude…"
            className="max-h-[180px] min-w-0 flex-1 resize-none bg-transparent text-[15px] leading-relaxed text-ink outline-none placeholder:text-ink-faint"
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
 *  them, and picking one opens that item's sidebar. */
function ChipGroup({
  group,
  focus,
  onOpen,
}: {
  group: ChipGroupModel
  focus: PanelFocus | null
  onOpen: (f: PanelFocus) => void
}) {
  const [open, setOpen] = useState(false)
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
        <div className="absolute bottom-full left-0 z-20 mb-1.5 max-h-64 w-[244px] overflow-auto rounded-xl border border-line-strong bg-surface p-1 shadow-xl">
          <div className="px-1.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
            {group.label}
          </div>
          {group.items.map((it) => {
            const active = sameFocus(focus, it.focus)
            return (
              <button
                key={it.key}
                onClick={() => {
                  onOpen(it.focus)
                  setOpen(false)
                }}
                className={`flex w-full items-center gap-2 rounded-lg px-1.5 py-1.5 text-left transition ${
                  active ? 'bg-panel-2' : 'hover:bg-panel-2/60'
                }`}
              >
                <span className="shrink-0 text-ink-soft">{it.icon}</span>
                <span className="min-w-0 flex-1 truncate text-[13px] text-ink">{it.label}</span>
                {active && <Check size={14} className="shrink-0 text-accent" />}
              </button>
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
  const toneClass =
    tone === 'workspace'
      ? 'bg-[#f7efe0] text-cap-workspace'
      : tone === 'repo'
        ? 'bg-[#e9f0f3] text-cap-repo'
        : 'bg-panel-2 text-cap-chat'
  return (
    <button
      onClick={onClick}
      title={expandable ? `${children} (${count})` : 'Open in sidebar'}
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
