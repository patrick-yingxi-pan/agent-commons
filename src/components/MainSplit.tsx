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
import { useCallback, useRef, useState, type ReactNode } from 'react'
import { MessageSquare } from 'lucide-react'
import { ResizeHandle } from './ResizeHandle'
import { SectionView } from './SectionView'
import { SessionTitleBar } from './SessionTitleBar'
import { ConversationView } from './ConversationView'
import { ContextPanelView } from './ContextPanelView'
import { SECTION_META } from '../lib/sections'
import { clampRatio } from '../lib/splitFrame'
import type { MainPaneContent, MainSplitNode } from '../lib/mainSplit'
import type { NavLocation } from '../lib/nav'
import type { PanelFocus, SectionId } from '../types'
import type { ModelPick } from '../lib/models'
import {
  useSessions,
  applyRelationOp,
  attachContext,
  compactSession,
  patchSession,
  persistWorkspace,
} from '../api'
import { conversations } from '../controller/conversationStore'
import { usePaneConversation } from '../controller/usePaneConversation'
import { useSessionContextCommands } from '../controller/useSessionContextCommands'
import { SectionNavOverride, useRelations } from '../controller/useRelations'
import { paneNavTarget, type PaneSeed } from '../lib/paneNav'
import {
  DRAFT_ID,
  applyEscalationToLive,
  approvalView,
  escalationBinding,
  folderLabel,
  workspaceOf,
} from '../data/liveSession'
import { draft } from '../controller/draftController'
import { loadModelPrefs } from '../lib/modelPrefs'

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
  /** A pane composer's context-chip click. The right panel is scoped to the
   *  PRIMARY session until Phase 4 folds it into the tree — so the App opens
   *  the panel directly when the pane shows the primary's session (the
   *  duplicate case), and otherwise brings the session to the primary first. */
  onOpenSessionContext: (sessionId: string, focus: PanelFocus) => void
  /** A session's display title (the live rows) — pane title bars + picker labels. */
  sessionLabel: (id: string) => string
  /** A pane-hosted DRAFT materialized (its first send ran the shared draft
   *  funnel): the App retargets every draft pane to the real id. */
  onDraftAdopted: (realId: string) => void
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
          <SectionPane
            // Keyed on the full seed so a re-route (a rail facet, a
            // cross-section retarget) resets the pane-local nav cleanly.
            key={`${c.id}:${c.sub ?? ''}:${c.seed ? JSON.stringify(c.seed) : ''}`}
            section={c.id}
            initialSub={c.sub ?? null}
            initialFocus={c.seed}
            nav={props.nav}
            onRetarget={(content) => props.onFillPane(path, content)}
          />
        ) : c.kind === 'msession' ? (
          <ConversationPane sessionId={c.id} nav={props.nav} />
        ) : c.kind === 'context-panel' ? (
          <ContextPanelView
            sessionId={c.sessionId}
            panel={c.panel}
            onOpenSession={props.nav.onOpenSession}
            onOpenSchedule={props.nav.onOpenSchedule}
          />
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

function SectionPane({
  section,
  initialSub,
  initialFocus,
  nav,
  onRetarget,
}: {
  section: SectionId
  initialSub?: string | null
  /** Seeds the open DETAIL (a cross-section door retargeted this pane's leaf
   *  with the target entity — src/lib/paneNav.ts). */
  initialFocus?: PaneSeed
  nav: MainPaneNav
  /** Rewrite THIS pane's leaf (a cross-section entity door: the pane
   *  navigates to the target section with the detail open — never the primary). */
  onRetarget: (content: MainPaneContent) => void
}) {
  // Seeded from the routed content (a rail facet click carries its facet in,
  // a cross-section door carries its detail), pane-local after that (the
  // Branch keys this component on section+sub+seed, so a re-route resets
  // cleanly).
  const [subview, setSubview] = useState<string | null>(initialSub ?? null)
  const [focus, setFocus] = useState<PaneFocusState>({ ...NO_FOCUS, ...initialFocus })
  const [stack, setStack] = useState<PaneFocusState[]>([])

  const navigate = (next: Partial<PaneFocusState>) => {
    setStack((s) => [...s, focus])
    setFocus({ ...NO_FOCUS, ...next })
  }

  // Mirror of the open detail, so the stable pane bridge below can push the
  // back stack without a stale closure.
  const focusRef = useRef(focus)
  focusRef.current = focus

  // The pane-local nav bridge (ADAPT-17's pane-locality rule): every entity
  // door below — owner bylines, context rows, work-item links, "View in …" —
  // resolves against THIS pane through the SectionNavOverride that
  // useRelations() composes. Same-section targets push the pane's own detail
  // focus; cross-section targets retarget the pane's leaf (seeded); a shape
  // the pane can't host (a bare section jump) falls through to the root
  // bridge. SectionPane itself sits ABOVE its own override, so this
  // useRelations() reads the ROOT navigate.
  const rootNavigate = useRelations().navigate
  const paneNavigate = useCallback(
    (target: SectionId, id?: string, subId?: string) => {
      const t = paneNavTarget(section, target, id, subId)
      if (t.kind === 'focus') {
        setStack((s) => [...s, focusRef.current])
        setFocus({ ...NO_FOCUS, ...t.focus })
      } else if (t.kind === 'retarget') {
        onRetarget({ kind: 'msection', id: t.section, seed: t.seed })
      } else {
        rootNavigate(target, id, subId)
      }
    },
    [section, onRetarget, rootNavigate],
  )
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
    <SectionNavOverride.Provider value={paneNavigate}>
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
    </SectionNavOverride.Provider>
  )
}

/** ── An independent conversation in a pane (universal split Phases 3+5) ──────
 *  The SAME fully-fledged ConversationView the primary mounts — two panes on
 *  one session are two views in sync with the same keyed model (the store
 *  dedupes by key; the server's one-live-turn-per-session slot is the
 *  concurrency wall). This component is only the pane's CONTROLLER: the
 *  per-session command adapter — send/stop/retry through the store, attach /
 *  remove / compact / model-pick through the same shared funnels the singleton
 *  controller uses (bindingsFor, addContextToLive, workspaceOf, the escalation
 *  apply funnel), never a parallel implementation. */
function ConversationPane({ sessionId, nav }: { sessionId: string; nav: MainPaneNav }) {
  const conv = usePaneConversation(sessionId)
  const row = (useSessions().data ?? []).find((s) => s.id === sessionId)
  const isDraft = sessionId === DRAFT_ID

  // A pane-hosted DRAFT sends through the SHARED draft funnel (draftCore.ts —
  // the singleton's exact flow: coalesced materialization, FWD-1 flush before
  // the turn, FWD-2 focus carry). This host's `onAdopted` retargets every
  // draft pane to the real id; the model pick is the Customize default (the
  // draft pick UI lives on the singleton until the primary dissolves).
  const sendDraft = useCallback(
    (text: string) => {
      conversations.update(DRAFT_ID, (s) => ({
        ...s,
        typing: true,
        busy: true,
        sendFailure: null,
        live: { ...s.live, messages: [...s.live.messages, { id: `u-${Date.now()}`, role: 'user' as const, content: text }] },
      }))
      const prefs = loadModelPrefs()
      void draft.sendDraftTurn(
        text,
        () => ({ providerId: prefs.providerId, modelId: prefs.modelId }),
        undefined,
        (realId) => nav.onDraftAdopted(realId),
      )
    },
    [nav],
  )

  const approve = useCallback(
    (workspaceRoot?: string) => {
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
    },
    [sessionId, nav],
  )

  // The attach / remove funnels, session-parametric — the SAME hook a
  // context-panel pane's remove affordances use (useSessionContextCommands), so
  // the mapping can't fork per host. A pane session is always real (no
  // draft-buffering branch).
  const { addContext, removeContexts, removeFolder } = useSessionContextCommands(sessionId)

  const retry = useCallback(() => {
    const last = [...conversations.get(sessionId).live.messages].reverse().find((m) => m.role === 'user')
    if (last?.content) void conversations.dispatchTurn(sessionId, last.content)
  }, [sessionId])

  const compact = useCallback(async () => {
    try {
      const updated = await compactSession(sessionId)
      conversations.setLive(sessionId, (l) => ({ ...l, messages: updated.messages ?? [] }))
    } catch {
      /* leave the thread as-is; the user can retry */
    }
  }, [sessionId])

  // The session's two-level model pick, straight off the live row (the same
  // PATCH the primary's picker writes — one wire, two views).
  const modelPick: ModelPick = { providerId: row?.providerId, modelId: row?.modelId }
  const selectModel = useCallback(
    (pick: ModelPick) => {
      void patchSession(sessionId, { providerId: pick.providerId ?? '', modelId: pick.modelId ?? '' })
    },
    [sessionId],
  )

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col" data-conversation-pane={sessionId}>
      {/* The SAME title bar the primary wears (a run session outside the live
          list falls back to a title-only shell). */}
      <SessionTitleBar
        session={row ?? { id: sessionId, title: isDraft ? 'New session' : nav.sessionLabel(sessionId) }}
        onOpenProject={nav.onOpenProject}
        onOpenSchedule={nav.onOpenSchedule}
      />
      <ConversationView
        sessionId={sessionId}
        live={conv.live}
        typing={conv.typing}
        busy={conv.busy}
        streaming={!!(conv.busy && conv.liveTurn)}
        sendFailure={conv.sendFailure}
        pendingApproval={conv.pendingEscalation ? approvalView(conv.pendingEscalation.escalation) : null}
        onApprove={approve}
        onSend={isDraft ? sendDraft : (text) => void conversations.dispatchTurn(sessionId, text)}
        onStop={() => conversations.stop(sessionId)}
        onRetry={retry}
        onCompact={row ? compact : undefined}
        modelPick={modelPick}
        onSelectModel={row ? selectModel : undefined}
        onAddContext={addContext}
        onOpenContext={(f) => nav.onOpenSessionContext(sessionId, f)}
        onRemoveContexts={removeContexts}
        onRemoveFolder={removeFolder}
      />
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
