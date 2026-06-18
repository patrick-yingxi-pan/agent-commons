import { useRef, useState } from 'react'
import { ArrowUp, GitBranch, Github, PanelsTopLeft, Paperclip, Plus } from 'lucide-react'
import type { Capability, Connector } from '../types'
import { ModelEffortControl } from './ModelEffortControl'

/** The single composer for every conversation. The chips above it show what
 *  context is *attached* to the thread — the thing that, in today's app, is
 *  instead encoded by which tab you opened. */
export function Composer({
  caps,
  connectors,
  repoBranch,
  workspaceName,
  onSend,
}: {
  caps: Capability[]
  connectors: Connector[]
  repoBranch?: string
  workspaceName?: string
  onSend: (text: string) => void
}) {
  const [value, setValue] = useState('')
  const ref = useRef<HTMLTextAreaElement>(null)

  const hasWorkspace = caps.includes('workspace')
  const hasRepo = caps.includes('repo')

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
        {/* Attached-context chips */}
        <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
          {hasWorkspace && (
            <Chip icon={<PanelsTopLeft size={12} />} tone="workspace">
              {workspaceName ?? 'Workspace'}
            </Chip>
          )}
          {hasRepo && (
            <Chip icon={<GitBranch size={12} />} tone="repo">
              {repoBranch ?? 'main'}
            </Chip>
          )}
          {connectors.map((c) => (
            <Chip key={c.id} icon={<Github size={12} />} tone="repo">
              {c.label}
            </Chip>
          ))}
          <button
            className="inline-flex items-center gap-1 rounded-full border border-dashed border-line-strong px-2 py-0.5 text-[11px] font-medium text-ink-faint transition hover:border-accent hover:text-accent-strong"
            title="Attach a folder, repo, or connector — escalates the same thread"
          >
            <Plus size={12} />
            Add context
          </button>
        </div>

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
              <button
                className="flex h-7 w-7 items-center justify-center rounded-lg text-ink-faint transition hover:bg-panel-2 hover:text-ink"
                title="Attach files"
              >
                <Paperclip size={16} />
              </button>
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
  children,
}: {
  icon: React.ReactNode
  tone: Capability
  children: React.ReactNode
}) {
  const toneClass =
    tone === 'workspace'
      ? 'bg-[#f7efe0] text-cap-workspace'
      : tone === 'repo'
        ? 'bg-[#e9f0f3] text-cap-repo'
        : 'bg-panel-2 text-cap-chat'
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full ${toneClass} px-2 py-0.5 text-[11px] font-medium`}
    >
      {icon}
      {children}
    </span>
  )
}
