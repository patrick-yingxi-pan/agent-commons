import { useRef, useState, type ReactNode } from 'react'
import { ArrowUp, FileText, GitBranch, Image as ImageIcon, PanelsTopLeft } from 'lucide-react'
import type { AddedContext, Attachment, Capability, Connector, PanelFocus } from '../types'
import { ModelEffortControl } from './ModelEffortControl'
import { AddContextButton } from './AddContextButton'
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
  const hasChips =
    hasWorkspace || hasRepo || connectors.length > 0 || attachments.length > 0

  const isActive = (f: PanelFocus) => sameFocus(focus, f)

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
        {/* Attached-context chips — click any one to open its sidebar */}
        {hasChips && (
          <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
            {hasWorkspace && (
              <Chip
                icon={<PanelsTopLeft size={12} />}
                tone="workspace"
                active={isActive({ kind: 'workspace' })}
                onClick={() => onOpenContext({ kind: 'workspace' })}
              >
                {workspaceName ?? 'Workspace'}
              </Chip>
            )}
            {hasRepo && (
              <Chip
                icon={<GitBranch size={12} />}
                tone="repo"
                active={isActive({ kind: 'repo' })}
                onClick={() => onOpenContext({ kind: 'repo' })}
              >
                {repoBranch ?? 'main'}
              </Chip>
            )}
            {connectors.map((c) => {
              const Icon = connectorIconFor(c.kind)
              return (
                <Chip
                  key={c.id}
                  icon={<Icon size={12} />}
                  tone="repo"
                  active={isActive({ kind: 'connector', id: c.id })}
                  onClick={() => onOpenContext({ kind: 'connector', id: c.id })}
                >
                  {c.label}
                </Chip>
              )
            })}
            {attachments.map((a) => (
              <Chip
                key={a.id}
                icon={a.kind === 'photo' ? <ImageIcon size={12} /> : <FileText size={12} />}
                tone="chat"
                active={isActive({ kind: a.kind, id: a.id })}
                onClick={() => onOpenContext({ kind: a.kind, id: a.id })}
              >
                {a.label}
              </Chip>
            ))}
          </div>
        )}

        {/* Input */}
        <div className="rounded-2xl border border-line-strong bg-surface shadow-sm transition focus-within:border-accent">
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
            className="max-h-[180px] w-full resize-none bg-transparent px-4 pt-3 text-[15px] leading-relaxed text-ink outline-none placeholder:text-ink-faint"
          />
          <div className="flex items-center justify-between px-3 pb-2.5 pt-1">
            <div className="flex items-center gap-1">
              <AddContextButton onAttach={onAddContext} />
              <ModelEffortControl />
            </div>
            <button
              onClick={submit}
              disabled={!value.trim()}
              className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent text-white transition enabled:hover:bg-accent-strong disabled:cursor-not-allowed disabled:opacity-30"
            >
              <ArrowUp size={17} strokeWidth={2.5} />
            </button>
          </div>
        </div>
        <p className="mt-1.5 text-center text-[11px] text-ink-faint">
          Prototype · the guided tour drives the escalation. Free-typed replies get a canned answer.
        </p>
      </div>
    </div>
  )
}

function Chip({
  icon,
  tone,
  active,
  onClick,
  children,
}: {
  icon: ReactNode
  tone: Capability
  active: boolean
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
      title="Open in sidebar"
      className={`inline-flex max-w-[220px] items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium transition ${toneClass} ${
        active ? 'ring-1 ring-accent' : 'ring-1 ring-transparent hover:ring-line-strong'
      }`}
    >
      {icon}
      <span className="truncate">{children}</span>
    </button>
  )
}
