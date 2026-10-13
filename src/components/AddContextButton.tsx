import { useEffect, useRef, useState } from 'react'
import {
  ChevronLeft,
  ChevronRight,
  FolderOpen,
  FileText,
  GitBranch,
  Image as ImageIcon,
  MessageSquare,
  Paperclip,
  Plug,
  Plus,
  Server,
} from 'lucide-react'
import type { AddedContext, Attachment, Connector, Repo, Workspace } from '../types'
import { AddTrigger } from './AddTrigger'
import { SectionAction } from './SectionAction'
import { useDismissable } from '../lib/useDismissable'
import { useContextIntake } from '../lib/contextIntake'
import { POPOVER_SURFACE } from '../lib/popover'
import { usePopoverShift } from '../lib/usePopoverShift'
import type { ContextTypeId } from '../../contract/contexts.ts'
import { DeferredMcpConnectionCreateDialog } from './DeferredMcpConnectionCreate.tsx'
import { DeferredContextPickerWorkflow } from './DeferredContextPickerWorkflow.tsx'

export type TypeId = ContextTypeId | 'discussion' | 'artifact'

/** Approx height of one recent row, and the fixed chrome a picker keeps around
 *  the list (header + label + Browse row + footer + padding). Used to size the
 *  inline recent list to the available height; the remainder folds into "More". */
const RECENT_ROW_H = 38
const RECENT_CHROME_H = 156

const CONTEXT_TYPES: { id: TypeId; label: string; desc: string; Icon: typeof Paperclip }[] = [
  { id: 'files', label: 'Files', desc: 'Text, documents, spreadsheets, slides and images', Icon: Paperclip },
  { id: 'photos', label: 'Photos', desc: 'Add from your photo library', Icon: ImageIcon },
  { id: 'discussion', label: 'Discussion', desc: 'Attach a saved copy of a discussion', Icon: MessageSquare },
  { id: 'artifact', label: 'Artifact', desc: 'Attach a saved copy of an Artifact', Icon: FileText },
  { id: 'folder', label: 'Folder', desc: 'Save a read-only copy of top-level text files', Icon: FolderOpen },
  { id: 'repo', label: 'Repository', desc: 'View available repository connections', Icon: GitBranch },
  { id: 'connector', label: 'Connector', desc: 'View available service connections', Icon: Plug },
  { id: 'mcp', label: 'MCP server', desc: 'Add a Model Context Protocol server', Icon: Server },
]

/** One consistent entry point for attaching context — every attachable thing
 *  (files, folders, repos, connectors, MCP servers) is "context" the thread
 *  gains. Step 1 picks the type; step 2 shows that type's quick picks plus a
 *  "Browse…" explorer for everything else. Every picker is multi-add: a pick
 *  attaches without closing and the row flips to ✓ Added; a "Done" footer closes.
 *  Whether a row reads "Added" is derived from what's *actually attached* to the
 *  thread (the live context props below), so it persists across reopens. */
export function AddContextButton({
  onAttach,
  connectors,
  repos,
  attachments,
  workspaces,
  variant = 'icon',
  label = 'Add context',
  sessionId,
  referenceCopiesEnabled = true,
}: {
  onAttach: (ctx: AddedContext) => void
  /** Session whose preview waits for this multi-add picker to finish. */
  sessionId?: string
  /** Saved references belong to conversations, not descriptive project context. */
  referenceCopiesEnabled?: boolean
  /** The thread's currently-attached context — drives which rows show "Added"
   *  and the repo→GitHub-connector prompt. */
  connectors: Connector[]
  repos: Repo[]
  attachments: Attachment[]
  workspaces: Workspace[]
  /** The trigger's shape. 'icon' (default) is the composer's 32×32 plus button;
   *  'inline' is the shared "+ Add context" text trigger (AddTrigger), so on a
   *  surface that sits beside an "Add routine"-style control the two match;
   *  'section' is the compact section-header verb (SectionAction), for a
   *  panel-header action cluster — its popover drops BELOW the trigger. */
  variant?: 'icon' | 'inline' | 'section'
  /** The inline trigger's label (icon variant is icon-only). */
  label?: string
}) {
  const [open, setOpen] = useState(false)
  const [mcpSetup, setMcpSetup] = useState(false)
  useContextIntake(sessionId, open)
  const [type, setType] = useState<TypeId | null>(null)
  // How many recent rows fit inline — measured from the space above the composer
  // so the list is "as long as the layout allows"; the rest folds into the
  // "More" flyout. Recomputed on open and on window resize.
  const [maxRecentRows, setMaxRecentRows] = useState(8)
  const wrapRef = useDismissable<HTMLDivElement>(open, () => close())
  // The popover opens left-aligned from the button, but the button can sit near a
  // right edge (e.g. the project side panel), where a 340px popover would overflow.
  // The shared containment hook nudges it back fully on-screen; the host need
  // not know its own position — the popover self-corrects in any layout.
  const popRef = usePopoverShift<HTMLDivElement>(open)

  const close = () => {
    setOpen(false)
    setType(null)
  }

  // Size the inline recent list to the height available above the composer: the
  // popover opens upward from the button, so the button's top is how much room
  // there is. Subtract the picker's fixed chrome, divide by a row's height.
  useEffect(() => {
    if (!open) return
    const recompute = () => {
      const top = wrapRef.current?.getBoundingClientRect().top ?? window.innerHeight
      const rows = Math.floor((top - 16 - RECENT_CHROME_H) / RECENT_ROW_H)
      // Cap the inline list at a comfortable height even on tall screens; beyond
      // that the tail folds into "More" rather than becoming a giant wall of rows.
      setMaxRecentRows(Math.max(3, Math.min(9, rows)))
    }
    recompute()
    window.addEventListener('resize', recompute)
    return () => window.removeEventListener('resize', recompute)
  }, [open])

  const activeType = type ? CONTEXT_TYPES.find((t) => t.id === type)! : null

  const toggle = () => (open ? close() : setOpen(true))

  return (
    <div ref={wrapRef} className="relative">
      {variant === 'inline' ? (
        <AddTrigger
          label={label}
          open={open}
          onClick={toggle}
          title="Add context — files, folders, repos, connectors, MCP servers"
        />
      ) : variant === 'section' ? (
        <SectionAction label={label} icon={<Plus size={14} />} onClick={toggle} open={open} />
      ) : (
        <button
          onClick={toggle}
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
      )}

      {open && (
        <div
          ref={popRef}
          role="dialog"
          aria-label="Add context"
          className={`absolute z-20 w-[340px] overflow-hidden ${
            variant === 'section' ? 'right-0 top-full mt-1.5' : 'bottom-full left-0 mb-2'
          } ${POPOVER_SURFACE}`}
        >
          {activeType === null ? (
            <div className="p-2">
              <div className="px-1.5 pb-1 pt-0.5 text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
                Add context
              </div>
              {CONTEXT_TYPES.filter((t) => (t.id !== 'discussion' && t.id !== 'artifact') || referenceCopiesEnabled).map((t) => (
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
                <DeferredContextPickerWorkflow
                  type={activeType.id}
                  maxRows={maxRecentRows}
                  onAttach={onAttach}
                  onClose={close}
                  onMcpSetup={() => { close(); setMcpSetup(true) }}
                  connectors={connectors}
                  repos={repos}
                  attachments={attachments}
                  workspaces={workspaces}
                  sessionId={sessionId}
                  referenceCopiesEnabled={referenceCopiesEnabled}
                />
              </div>
            </div>
          )}
        </div>
      )}
      {mcpSetup && <DeferredMcpConnectionCreateDialog onClose={() => setMcpSetup(false)} />}
    </div>
  )
}
