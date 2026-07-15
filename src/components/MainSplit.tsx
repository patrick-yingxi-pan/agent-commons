/** ── The MAIN workspace split frame (universal split Phases 2–4) ─────────────
 *  Tiles the main surface right of the rail into the split tree
 *  (src/lib/mainSplit.ts vocabulary): the `primary` pane renders the singleton
 *  controller's surface (injected as a closure — the pre-split JSX untouched);
 *  `msection` panes are INDEPENDENT, fully interactive section pages with
 *  pane-local navigation (SectionPane below); `msession` panes independent
 *  conversations. NO per-pane chrome (the 2026-07-15 redesign): panes render
 *  their content edge to edge — the rail's split/close cluster acts on the
 *  FOCUSED pane (pointer-down focuses; the focused pane wears a subtle inset
 *  accent ring), and rail navigation retargets the focused pane. Close lives
 *  in that same rail cluster (no per-pane affordance at all); the primary
 *  can't close: it is where the URL lives (ADAPT-15). Dividers are the ONE keyboard-operable
 *  ResizeHandle, named per path (UI-11). Wide tier only (the caller gates,
 *  ADAPT-11): overlay tiers render the primary surface alone and the tree
 *  persists. */
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { ArrowUp, MessageSquare, Square } from 'lucide-react'
import { ResizeHandle } from './ResizeHandle'
import { SectionView } from './SectionView'
import { SessionTitleBar } from './SessionTitleBar'
import { MessageRow, TypingRow } from './Message'
import { EscalationPrompt } from './EscalationPrompt'
import { SECTION_META } from '../lib/sections'
import { clampRatio } from '../lib/splitFrame'
import type { MainPaneContent, MainSplitNode } from '../lib/mainSplit'
import type { NavLocation } from '../lib/nav'
import type { SectionId } from '../types'
import { useSessions, applyRelationOp, attachContext, persistWorkspace } from '../api'
import { conversations } from '../controller/conversationStore'
import { usePaneConversation } from '../controller/usePaneConversation'
import { applyEscalationToLive, approvalView, escalationBinding, folderLabel, workspaceOf } from '../data/liveSession'

/** Global doors a pane hands off to the PRIMARY surface (opening a thread from
 *  a pane's session list shows it where conversations live — the primary). */
export interface MainPaneNav {
  onOpenSession: (id: string) => void
  onNewSession: () => void
  onOpenProposal: (agentId: string, proposalId: string, ownerName: string | null) => void
  /** The title bar's breadcrumb doors (a pane conversation's home project /
   *  routine) — global navigation, so they land on the primary surface. */
  onOpenProject: (id: string) => void
  onOpenSchedule: (id: string) => void
  /** A session's display title (the live rows) — pane title bars + picker labels. */
  sessionLabel: (id: string) => string
}

/** The gate App renders: no tree (or an overlay tier) passes the primary
 *  surface through UNTOUCHED — the pre-split app, byte-identical; a tree tiles
 *  it as the primary pane beside the independent ones. */
export function MainSplitGate({
  tree,
  children,
  focusedPane,
  nav,
  onFocusPane,
  onFillPane,
  onRatio,
}: {
  tree: MainSplitNode | null
  children: ReactNode
  focusedPane: string
  nav: MainPaneNav
  onFocusPane: (path: string) => void
  onFillPane: (path: string, content: MainPaneContent) => void
  onRatio: (path: string, ratio: number) => void
}) {
  if (!tree) return <>{children}</>
  return (
    <MainSplit
      tree={tree}
      renderPrimary={() => children}
      focusedPane={focusedPane}
      nav={nav}
      onFocusPane={onFocusPane}
      onFillPane={onFillPane}
      onRatio={onRatio}
    />
  )
}

export function MainSplit({
  tree,
  renderPrimary,
  focusedPane,
  nav,
  onFocusPane,
  onFillPane,
  onRatio,
}: {
  tree: MainSplitNode
  renderPrimary: () => ReactNode
  focusedPane: string
  nav: MainPaneNav
  onFocusPane: (path: string) => void
  onFillPane: (path: string, content: MainPaneContent) => void
  onRatio: (path: string, ratio: number) => void
}) {
  return (
    <div className="flex min-h-0 min-w-0 flex-1" data-main-split>
      <Branch
        node={tree}
        path=""
        renderPrimary={renderPrimary}
        focusedPane={focusedPane}
        nav={nav}
        onFocusPane={onFocusPane}
        onFillPane={onFillPane}
        onRatio={onRatio}
      />
    </div>
  )
}

interface BranchProps {
  node: MainSplitNode
  path: string
  renderPrimary: () => ReactNode
  focusedPane: string
  nav: MainPaneNav
  onFocusPane: (path: string) => void
  onFillPane: (path: string, content: MainPaneContent) => void
  onRatio: (path: string, ratio: number) => void
}

function Branch(props: BranchProps) {
  const { node, path, focusedPane, onFocusPane, onRatio } = props
  const ref = useRef<HTMLDivElement>(null)

  if (node.kind === 'pane') {
    const c = node.content
    const focused = focusedPane === path
    return (
      <div
        // No per-pane chrome AT ALL: content edge to edge (close lives in the
        // rail cluster beside the split buttons). Pointer-down anywhere focuses
        // the pane (capture — a click on a button inside still counts); the
        // focused pane wears a subtle inset accent ring so "the rail cluster
        // acts HERE" is always legible.
        className={`relative flex min-h-0 min-w-0 flex-1 flex-col bg-canvas ${
          focused ? 'ring-1 ring-inset ring-accent/35' : ''
        }`}
        data-main-pane={path || 'root'}
        data-focused={focused || undefined}
        onPointerDownCapture={() => onFocusPane(path)}
      >
        {c.kind === 'primary' ? (
          props.renderPrimary()
        ) : c.kind === 'msection' ? (
          <SectionPane key={`${c.id}:${c.sub ?? ''}`} section={c.id} initialSub={c.sub ?? null} nav={props.nav} />
        ) : c.kind === 'msession' ? (
          <ConversationPane sessionId={c.id} nav={props.nav} />
        ) : (
          <MainPicker onPick={(content) => props.onFillPane(path, content)} />
        )}
      </div>
    )
  }

  const row = node.dir === 'row'
  const ratio = clampRatio(node.ratio)
  // The same absolute floors the right-panel frame earned (rulebook finding):
  // percentage bases never shrink a pane under a usable minimum.
  const minStyle = row ? { minWidth: 320 } : { minHeight: 160 }
  const child = (n: MainSplitNode, p: string) => <Branch {...props} node={n} path={p} />
  return (
    <div ref={ref} className={`flex min-h-0 min-w-0 flex-1 ${row ? 'flex-row' : 'flex-col'}`}>
      <div className="flex min-h-0 min-w-0" style={{ flex: `${ratio} 1 0%`, ...minStyle }}>
        {child(node.a, `${path}a`)}
      </div>
      <div
        className={`relative flex min-h-0 min-w-0 ${row ? 'border-l' : 'border-t'} border-line`}
        style={{ flex: `${1 - ratio} 1 0%`, ...minStyle }}
      >
        <ResizeHandle
          side={row ? 'left' : 'top'}
          label={`Resize view panes (${path || 'root'})`}
          value={Math.round((1 - ratio) * 100)}
          min={15}
          max={85}
          onMove={(client) => {
            const rect = ref.current?.getBoundingClientRect()
            if (!rect) return
            onRatio(path, row ? (client - rect.left) / Math.max(1, rect.width) : (client - rect.top) / Math.max(1, rect.height))
          }}
        />
        {child(node.b, `${path}b`)}
      </div>
    </div>
  )
}

/** ── An independent section page, navigation scoped to its pane ──────────────
 *  Fully interactive: it reads the same live registries every section page
 *  reads (the api hooks are global), but its sub-view, open detail, and back
 *  stack are PANE-LOCAL — navigating inside one pane never moves another (and
 *  never touches the URL: the address stays the primary's, ADAPT-15).
 *  Conversation doors (open a thread, new session) hand off to the primary
 *  surface — where conversations live until Phase 3. */
interface PaneFocusState {
  projectId: string | null
  scheduleId: string | null
  ownerName: string | null
  workItemId: string | null
  agentId: string | null
  contextId: string | null
}
const NO_FOCUS: PaneFocusState = { projectId: null, scheduleId: null, ownerName: null, workItemId: null, agentId: null, contextId: null }

function SectionPane({ section, initialSub, nav }: { section: SectionId; initialSub?: string | null; nav: MainPaneNav }) {
  // Seeded from the routed content (a rail facet click carries its facet in),
  // pane-local after that (the Branch keys this component on section+sub, so a
  // re-route resets cleanly).
  const [subview, setSubview] = useState<string | null>(initialSub ?? null)
  const [focus, setFocus] = useState<PaneFocusState>(NO_FOCUS)
  const [stack, setStack] = useState<PaneFocusState[]>([])

  const navigate = (next: Partial<PaneFocusState>) => {
    setStack((s) => [...s, focus])
    setFocus({ ...NO_FOCUS, ...next })
  }
  const onBack = () => {
    setStack((s) => {
      const prev = s.at(-1)
      setFocus(prev ?? NO_FOCUS)
      return s.slice(0, -1)
    })
  }
  const top = stack.at(-1)
  const backTo: NavLocation | null =
    stack.length > 0
      ? { kind: 'section', section, projectId: top?.projectId ?? null, scheduleId: top?.scheduleId ?? null, ownerName: top?.ownerName ?? null }
      : focus.projectId || focus.scheduleId || focus.ownerName || focus.agentId || focus.contextId
        ? { kind: 'section', section, projectId: null, scheduleId: null, ownerName: null }
        : null

  return (
    <SectionView
      section={section}
      subview={subview}
      onOpenSubview={(id) => {
        setSubview(id)
        setFocus(NO_FOCUS)
      }}
      onOpenSession={nav.onOpenSession}
      onNewSession={nav.onNewSession}
      onOpenProject={(id) => navigate({ projectId: id })}
      onOpenSchedule={(id) => navigate({ scheduleId: id })}
      onOpenProposal={nav.onOpenProposal}
      onBack={onBack}
      backTo={backTo}
      focusProjectId={focus.projectId}
      focusScheduleId={focus.scheduleId}
      focusOwnerName={focus.ownerName}
      focusWorkItemId={focus.workItemId}
      focusAgentId={focus.agentId}
      focusContextId={focus.contextId}
      onOpenAgentPage={(id) => navigate({ agentId: id })}
    />
  )
}

/** ── An independent conversation in a pane (universal split Phase 3) ─────────
 *  Driven by the keyed conversation store: its OWN composer, its own streaming
 *  turn (the server's one-live-turn-per-session slot is the concurrency wall),
 *  its own consent prompts — fully interactive beside the primary. Two panes
 *  on one session share one entry (the store dedupes by key). The escalation
 *  approval applies through the SAME funnels the primary uses
 *  (applyEscalationToLive / escalationBinding) — one consent flow, two hosts. */
function ConversationPane({ sessionId, nav }: { sessionId: string; nav: MainPaneNav }) {
  const conv = usePaneConversation(sessionId)
  const bottomRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [conv.live.messages, conv.typing, conv.pendingEscalation])

  const pendingApproval = conv.pendingEscalation ? approvalView(conv.pendingEscalation.escalation) : null
  const approve = (workspaceRoot?: string) => {
    const pending = conversations.get(sessionId).pendingEscalation
    if (!pending) return
    const esc = pending.escalation
    if (esc.kind === 'project') {
      applyRelationOp({
        kind: 'create-project',
        projectId: esc.project.id,
        projectName: esc.project.name,
        projectDescription: esc.project.description,
        ...(esc.fileSession ? { sessionId, sessionTitle: nav.sessionLabel(sessionId) } : {}),
      })
    } else {
      const label = workspaceRoot ? folderLabel(workspaceRoot) : `${nav.sessionLabel(sessionId)} files`
      const next = applyEscalationToLive(conversations.get(sessionId).live, esc, label)
      conversations.setLive(sessionId, next)
      const binding = escalationBinding(esc, label, workspaceRoot)
      if (binding) void attachContext(sessionId, binding).catch(() => {})
      void persistWorkspace(sessionId, workspaceOf(next)).catch(() => {})
    }
    conversations.patch(sessionId, { pendingEscalation: null })
  }

  // The SAME title bar the primary surface wears (panes are homogeneous): live
  // title + home breadcrumb. A session outside the live list (a run session)
  // falls back to a title-only shell.
  const row = (useSessions().data ?? []).find((s) => s.id === sessionId)

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col" data-conversation-pane={sessionId}>
      <SessionTitleBar
        session={row ?? { id: sessionId, title: nav.sessionLabel(sessionId) }}
        onOpenProject={nav.onOpenProject}
        onOpenSchedule={nav.onOpenSchedule}
      />
      <div className="flex-1 overflow-y-auto">
        <div className="py-4">
          {conv.live.messages.map((m) => (
            <MessageRow key={m.id} message={m} sessionId={sessionId} />
          ))}
          {conv.typing && <TypingRow />}
          {pendingApproval && (
            <EscalationPrompt
              key={pendingApproval.kind}
              kind={pendingApproval.kind}
              rootChoices={pendingApproval.kind === 'workspace' ? pendingApproval.rootChoices : undefined}
              connectorLabel={pendingApproval.kind === 'repo' ? pendingApproval.connectorLabel : undefined}
              projectName={pendingApproval.kind === 'project' ? pendingApproval.projectName : undefined}
              onApprove={approve}
            />
          )}
          <div ref={bottomRef} />
        </div>
      </div>
      <PaneComposer
        busy={conv.busy}
        failure={conv.sendFailure}
        onSend={(text) => void conversations.dispatchTurn(sessionId, text)}
        onStop={() => conversations.stop(sessionId)}
      />
    </div>
  )
}

/** The pane's lean composer — send / stop / the server's refusal copy. (The
 *  full composer's context chips, model picker, and usage gauge remain the
 *  primary surface's for now — the Phase 5 polish list.) */
function PaneComposer({
  busy,
  failure,
  onSend,
  onStop,
}: {
  busy: boolean
  failure: string | null
  onSend: (text: string) => void
  onStop: () => void
}) {
  const [value, setValue] = useState('')
  const send = () => {
    const text = value.trim()
    if (!text || busy) return
    setValue('')
    onSend(text)
  }
  return (
    <div className="shrink-0 border-t border-line p-2.5">
      {failure && <div className="px-1 pb-1.5 text-[12px] text-removed">{failure}</div>}
      <div className="flex items-end gap-1.5 rounded-xl border border-line bg-panel px-2.5 py-1.5">
        <textarea
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              send()
            }
          }}
          placeholder={busy ? 'Claude is replying…' : 'Reply in this conversation…'}
          rows={1}
          className="max-h-32 min-h-6 w-full resize-none bg-transparent text-sm text-ink outline-none placeholder:text-ink-faint"
          data-pane-composer
        />
        {busy ? (
          <button
            onClick={onStop}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-ink text-white transition hover:bg-ink/85"
            title="Stop"
          >
            <Square size={12} fill="currentColor" />
          </button>
        ) : (
          <button
            onClick={send}
            disabled={!value.trim()}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-accent text-white transition enabled:hover:brightness-95 disabled:opacity-40"
            title="Send"
          >
            <ArrowUp size={14} />
          </button>
        )}
      </div>
    </div>
  )
}

/** The empty pane's content picker — every section page and every conversation. */
function MainPicker({ onPick }: { onPick: (content: MainPaneContent) => void }) {
  const sessions = useSessions().data ?? []
  return (
    <div className="flex h-full w-full min-w-0 flex-col overflow-hidden bg-canvas" data-main-picker>
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        <div className="px-1 pb-2 text-[12px] font-medium text-ink-faint">Choose what this pane shows</div>
        {(Object.keys(SECTION_META) as SectionId[]).map((id) => {
          const meta = SECTION_META[id]
          return (
            <button
              key={id}
              onClick={() => onPick({ kind: 'msection', id })}
              className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm text-ink transition hover:bg-surface"
            >
              <meta.Icon size={16} className="shrink-0 text-ink-soft" />
              <span className="min-w-0">
                <span className="block truncate font-medium">{meta.label}</span>
                <span className="block truncate text-[12px] text-ink-faint">{meta.subtitle}</span>
              </span>
            </button>
          )
        })}
        {sessions.length > 0 && (
          <>
            <div className="px-1 pb-2 pt-3 text-[12px] font-medium text-ink-faint">Conversations</div>
            {sessions.slice(0, 12).map((s) => (
              <button
                key={s.id}
                onClick={() => onPick({ kind: 'msession', id: s.id })}
                className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm text-ink transition hover:bg-surface"
                data-pick-session={s.id}
              >
                <MessageSquare size={16} className="shrink-0 text-ink-soft" />
                <span className="truncate font-medium">{s.title}</span>
              </button>
            ))}
          </>
        )}
      </div>
    </div>
  )
}
