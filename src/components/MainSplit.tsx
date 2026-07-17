/** ── The MAIN workspace split frame (universal split, the equal-pages model) ─
 *  Tiles the main surface right of the rail into the split tree
 *  (src/lib/mainSplit.ts vocabulary). Panes are the ONLY render path — no
 *  privileged pane kind (Phase 6 dissolved the `primary` singleton):
 *  `msession` panes are independent conversations (the DRAFT included, via
 *  the shared draft funnel), `msection` panes independent section pages with
 *  pane-local navigation (SectionPane), `context-panel` panes a session's
 *  attached context (ContextPanelView), and a `null` tree is the BACKGROUND.
 *  NO per-pane chrome: panes render edge to edge — the rail's split/close
 *  cluster acts on the FOCUSED pane (pointer-down focuses; the focused pane
 *  wears a subtle inset accent ring), rail navigation retargets it, and ONE
 *  close rule covers every pane (the sibling inherits the slot; closing the
 *  last pane leaves the background). The address bar projects the focused
 *  pane (ADAPT-15). Dividers are the ONE keyboard-operable ResizeHandle,
 *  named per path (UI-11). The overlay tiers (ADAPT-11) render the focused
 *  pane alone via MainSplitGate; the tree persists and re-tiles on wide. */
import { useRef, type ReactNode } from 'react'
import { ResizeHandle } from './ResizeHandle'
import { SectionPane } from './SectionPane'
import { ConversationPane } from './ConversationPane'
import { ContextPanelView } from './ContextPanelView'
import { clampRatio, nodeAt, panes } from '../lib/splitFrame'
import type { MainPaneContent, MainSplitNode, PaneAt } from '../lib/mainSplit'
import type { PanelFocus } from '../types'
import { FocusContext, type PendingFocus } from '../lib/focusContext'
import type { PaneSeed } from '../lib/paneNav'

/** The doors a pane hands to the SHELL — each lands its target in the FOCUSED
 *  pane, like every navigation (the equal-pages model has no primary). */
export interface MainPaneNav {
  onOpenSession: (id: string) => void
  onNewSession: () => void
  onOpenProposal: (agentId: string, proposalId: string, ownerName: string | null) => void
  /** The title bar's breadcrumb doors (a pane conversation's home project /
   *  routine) — entity doors, landing in the focused pane. */
  onOpenProject: (id: string) => void
  onOpenSchedule: (id: string) => void
  /** A pane composer's context-chip click: toggles ITS session's STORE-held
   *  `focus` — the wide tier tiles the panel beside that conversation (the
   *  focus projection), the overlay tiers dock it; remembered per session
   *  (FWD-2). */
  onOpenSessionContext: (sessionId: string, focus: PanelFocus) => void
  /** A session's display title (the live rows) — pane title bars + picker labels. */
  sessionLabel: (id: string) => string
  /** A pane-hosted DRAFT materialized (its first send ran the shared draft
   *  funnel): the App retargets every draft pane to the real id. */
  onDraftAdopted: (realId: string) => void
  /** The narrow tier's in-flow rail toggle — a conversation's title bar HOUSES
   *  it (ADAPT-11: content must never slide under a floating control);
   *  undefined on the other tiers. */
  railToggle?: ReactNode
  /** The notification-door focus target, PER PANE: PaneBody provides
   *  `focusCtxFor(path)` to its subtree — only the pane the door LANDED in
   *  sees a pending target, so a duplicate pane showing the same page can't
   *  steal or double-fire the highlight (docs/notification-routing.md). */
  focusCtxFor?: (path: string) => PendingFocus
  /** LIVE PRUNE: a pane reports its SUBJECT is definitively gone (a context
   *  pane whose context was detached, once its session's entry is
   *  server-reconciled). The host closes a PINNED pane via the tree; a
   *  focus-driven pane clears its DRIVER instead (`focus` — closing the
   *  projection directly would just be re-projected). Undefined on hosts
   *  without a tree (the overlay dock hides via `focus` already). */
  onPaneSubjectGone?: (path: string, content: MainPaneContent) => void
}

/** The empty BACKGROUND — what shows when the last page closes (the owner's
 *  equal-pages model: the tree may reach zero panes; the rail's doors — New
 *  session, a section, a recent — repopulate it). */
function Background() {
  return (
    <div className="flex min-h-0 min-w-0 flex-1 items-center justify-center bg-canvas" data-main-background>
      <p className="max-w-xs text-center text-sm leading-relaxed text-ink-faint">
        No pages open. Start a new session or open anything from the sidebar.
      </p>
    </div>
  )
}

/** The gate App renders — panes are the ONLY render path (Phase 6, no
 *  privileged surface): `null` tree = the background; the overlay tiers
 *  (medium/narrow — no room to tile, ADAPT-11) render the FOCUSED pane alone,
 *  full-surface (the tree persists and re-tiles on return to wide); the wide
 *  tier tiles the whole tree. */
export function MainSplitGate({
  tree,
  overlay,
  focusedPane,
  nav,
  onFocusPane,
  onFillPane,
  onReportAt,
  onRatio,
}: {
  tree: MainSplitNode | null
  /** True on the medium/narrow tiers — render the focused pane only. */
  overlay: boolean
  focusedPane: string
  nav: MainPaneNav
  onFocusPane: (path: string) => void
  onFillPane: (path: string, content: MainPaneContent) => void
  onReportAt: (path: string, at: PaneAt) => void
  onRatio: (path: string, ratio: number) => void
}) {
  if (!tree) return <Background />
  if (overlay) {
    const focusedNode = nodeAt(tree, focusedPane)
    const fallback = panes(tree)[0]
    const leaf =
      focusedNode?.kind === 'pane'
        ? { content: focusedNode.content, path: focusedPane, rev: focusedNode.rev }
        : fallback
          ? { ...fallback, rev: (nodeAt(tree, fallback.path) as { rev?: number } | null)?.rev }
          : null
    if (!leaf) return <Background />
    return (
      <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-canvas" data-main-pane={leaf.path || 'root'} data-focused>
        <PaneBody content={leaf.content} path={leaf.path} rev={leaf.rev} nav={nav} onFillPane={onFillPane} onReportAt={onReportAt} />
      </div>
    )
  }
  return (
    <MainSplit
      tree={tree}
      focusedPane={focusedPane}
      nav={nav}
      onFocusPane={onFocusPane}
      onFillPane={onFillPane}
      onReportAt={onReportAt}
      onRatio={onRatio}
    />
  )
}

export function MainSplit({
  tree,
  focusedPane,
  nav,
  onFocusPane,
  onFillPane,
  onReportAt,
  onRatio,
}: {
  tree: MainSplitNode
  focusedPane: string
  nav: MainPaneNav
  onFocusPane: (path: string) => void
  onFillPane: (path: string, content: MainPaneContent) => void
  onReportAt: (path: string, at: PaneAt) => void
  onRatio: (path: string, ratio: number) => void
}) {
  return (
    <div className="flex min-h-0 min-w-0 flex-1" data-main-split>
      <Branch
        node={tree}
        path=""
        focusedPane={focusedPane}
        nav={nav}
        onFocusPane={onFocusPane}
        onFillPane={onFillPane}
        onReportAt={onReportAt}
        onRatio={onRatio}
      />
    </div>
  )
}

/** A reported location minus its sub-view — the detail seed a fresh mount
 *  re-initializes from. */
const seedOfAt = ({ sub: _sub, ...seed }: PaneAt): PaneSeed => seed

/** ONE leaf renderer for every host — the tiled Branch and the overlay tiers'
 *  focused-pane-only view render the identical content (no fork). */
function PaneBody({
  content: c,
  path,
  rev,
  nav,
  onFillPane,
  onReportAt,
}: {
  content: MainPaneContent
  path: string
  /** The leaf's replace revision — a re-route to content-equal state still
   *  lands fresh (rail section re-click → section root). */
  rev?: number
  nav: MainPaneNav
  onFillPane: (path: string, content: MainPaneContent) => void
  onReportAt: (path: string, at: PaneAt) => void
}) {
  const body = c.kind === 'msection' ? (
    <SectionPane
      // Keyed on the full seed + the leaf revision so ANY re-route (a rail
      // facet, a cross-section retarget, a same-section re-click) resets the
      // pane-local nav cleanly. `at` (the pane's REPORTED live location) is
      // deliberately NOT in the key — the pane must not remount from
      // describing itself; a fresh mount initializes from it instead (a
      // reload restores the pane to the same deep spot).
      key={`${c.id}:${c.sub ?? ''}:${c.seed ? JSON.stringify(c.seed) : ''}:${rev ?? 0}`}
      section={c.id}
      initialSub={c.at ? (c.at.sub ?? null) : (c.sub ?? null)}
      initialFocus={c.at ? seedOfAt(c.at) : c.seed}
      nav={nav}
      onRetarget={(content) => onFillPane(path, content)}
      onAt={(at) => onReportAt(path, at)}
    />
  ) : c.kind === 'msession' ? (
    <ConversationPane sessionId={c.id} nav={nav} />
  ) : (
    <ContextPanelView
      sessionId={c.sessionId}
      panel={c.panel}
      onGone={nav.onPaneSubjectGone ? () => nav.onPaneSubjectGone!(path, c) : undefined}
    />
  )
  // The notification-door focus target, scoped to THIS pane (nav.focusCtxFor
  // answers non-null only for the pane the door landed in) — without a host
  // bridge the default empty context stands.
  return nav.focusCtxFor ? (
    <FocusContext.Provider value={nav.focusCtxFor(path)}>{body}</FocusContext.Provider>
  ) : (
    body
  )
}

interface BranchProps {
  node: MainSplitNode
  path: string
  focusedPane: string
  nav: MainPaneNav
  onFocusPane: (path: string) => void
  onFillPane: (path: string, content: MainPaneContent) => void
  onReportAt: (path: string, at: PaneAt) => void
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
        <PaneBody content={c} path={path} rev={node.rev} nav={props.nav} onFillPane={props.onFillPane} onReportAt={props.onReportAt} />
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

/* SectionPane and ConversationPane live in their own files
 * (./SectionPane, ./ConversationPane) — this file is only the
 * frame: the gate, the tree renderer, and the one shared leaf renderer. */
