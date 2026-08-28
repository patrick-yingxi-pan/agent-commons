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
 *  named per path (UI-11). The overlay tiers (ADAPT-11) keep the same mounted
 *  tree but hide every branch outside the focused path, so the focused pane
 *  fills the surface without losing in-flight pane state on a tier hop. */
import { Component, lazy, Suspense, useCallback, useMemo, useRef, type ReactNode } from 'react'
import { ResizeHandle } from './ResizeHandle'
import { ConversationPane } from './ConversationPane'
import { ContextPanelView } from './ContextPanelView'
import { clampRatio, nodeAt, panes } from '../lib/splitFrame'
import type { MainPaneContent, MainSplitNode, PaneAt, PaneLoc } from '../lib/mainSplit'
import { contentForLoc, withBackPush } from '../lib/paneHistory'
import type { FocusTarget } from '../lib/notificationDoor'
import type { PanelFocus, SectionId } from '../types'
import { FocusContext, type PendingFocus } from '../lib/focusContext'
import { SectionNavOverride } from '../controller/useRelations'
import { seedFor, type PaneSeed } from '../lib/paneNav'
import { SECTION_META } from '../lib/sections'

/** Section pages pull the 14k-line cross-cutting feature surface. Keep that
 * graph off a conversation boot; React.lazy caches the module after the first
 * section navigation, so split panes share one download and one evaluation. */
const SectionPane = lazy(() => import('./SectionPane').then((module) => ({ default: module.SectionPane })))

/** The doors a pane hands to the SHELL — each lands its target in the FOCUSED
 *  pane, like every navigation (the equal-pages model has no primary). */
export interface MainPaneNav {
  onOpenSession: (id: string) => void
  /** Point the transient highlight at a position in THIS pane — the second half
   *  of a locus door (SOCIAL-6b): the caller navigates by whatever door its
   *  subject kind uses (a session fill, a section route), then says what to land
   *  on. ONE callback for every locus kind, because which position a locus means
   *  is `src/lib/anchorLocus.ts`'s job, not the nav's — a per-kind door prop
   *  would grow with the union. `panePath` is stamped by PaneBody so a duplicate
   *  pane on the same page can't steal the highlight. */
  onFocusHere: (target: FocusTarget, panePath?: string) => void
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
      <p className="max-w-xs text-center text-[13px] leading-relaxed text-ink-faint">
        No pages open. Start a new session or open anything from the sidebar.
      </p>
    </div>
  )
}

/** A page-shaped fallback rather than a blank pane or global overlay. The rail,
 * sibling panes, and navigation stay usable while the section feature loads. */
function SectionLoadingState({ section }: { section: SectionId }) {
  return (
    <div
      role="status"
      aria-live="polite"
      data-section-loading
      className="flex min-h-0 min-w-0 flex-1 items-center justify-center bg-canvas px-6"
    >
      <p className="text-[13px] leading-relaxed text-ink-faint">Loading {SECTION_META[section].label}…</p>
    </div>
  )
}

/** A rejected dynamic import is usually a stale deploy or interrupted network
 * request. Contain it to the pane and let the person choose a full reload: that
 * refreshes the asset manifest without an automatic-reload loop, while the
 * persisted split tree returns them to the same page. */
class SectionLoadBoundary extends Component<
  { section: SectionId; children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  render() {
    if (!this.state.failed) return this.props.children
    const label = SECTION_META[this.props.section].label
    return (
      <div
        role="alert"
        data-section-load-error
        className="flex min-h-0 min-w-0 flex-1 items-center justify-center bg-canvas px-6"
      >
        <div className="max-w-xs text-center">
          <p className="text-[13px] font-medium leading-relaxed text-ink">Couldn’t load {label}</p>
          <p className="mt-1 text-[12px] leading-relaxed text-ink-faint">
            The app may have updated, or the connection was interrupted.
          </p>
          <button
            type="button"
            className="mt-4 rounded-lg border border-line bg-raised px-3 py-1.5 text-[12px] font-medium text-ink transition-colors hover:bg-hover"
            onClick={() => window.location.reload()}
          >
            Try again
          </button>
        </div>
      </div>
    )
  }
}

/** The gate App renders — panes are the ONLY render path (Phase 6, no
 *  privileged surface): `null` tree = the background. Every responsive tier
 *  keeps ONE mounted Branch tree. Medium/narrow hide branches outside the
 *  focused path and let its wrappers flex full-surface; wide reveals the same
 *  instances as tiles. Keeping identity through the tier hop is load-bearing:
 *  an unresolved form or editor may not evaporate because the window resized. */
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
  onReportAt: (path: string, at: PaneAt, hist: PaneSeed[], rev: number) => void
  onRatio: (path: string, ratio: number) => void
}) {
  if (!tree) return <Background />
  // A restored/just-collapsed tree can briefly carry a stale focus path. Wide
  // would still show its panes, but overlay path-hiding would otherwise hide
  // every branch. Resolve the same first-leaf fallback the old overlay renderer
  // used, without forking into a second rendered tree.
  const focused = nodeAt(tree, focusedPane)?.kind === 'pane' ? focusedPane : (panes(tree)[0]?.path ?? '')
  return (
    <MainSplit
      tree={tree}
      overlay={overlay}
      focusedPane={focused}
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
  overlay = false,
  focusedPane,
  nav,
  onFocusPane,
  onFillPane,
  onReportAt,
  onRatio,
}: {
  tree: MainSplitNode
  /** Preserve the tree but show only the focused path at overlay tiers. */
  overlay?: boolean
  focusedPane: string
  nav: MainPaneNav
  onFocusPane: (path: string) => void
  onFillPane: (path: string, content: MainPaneContent) => void
  onReportAt: (path: string, at: PaneAt, hist: PaneSeed[], rev: number) => void
  onRatio: (path: string, ratio: number) => void
}) {
  return (
    <div
      className="flex min-h-0 min-w-0 flex-1"
      data-main-split={overlay ? undefined : ''}
      data-main-overlay={overlay || undefined}
    >
      <Branch
        node={tree}
        path=""
        overlay={overlay}
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

/** The pane's back affordance: the carried stack's top (`loc` — resolves the
 *  label) and the pop (`go` — fills the pane with it, stack shortened). */
export interface PaneBackOut {
  loc: PaneLoc
  go: () => void
}

/** ONE leaf renderer for every host — the tiled Branch and the overlay tiers'
 *  focused-pane-only view render the identical content (no fork). It is also
 *  the ONE funnel for the back-history rule (ADAPT-18): every door that
 *  originates INSIDE this pane's content — a session row, a title-bar
 *  breadcrumb, a relation card's "View in …", a cross-section retarget —
 *  replaces the pane through `fillWith`, which pushes the outgoing page (with
 *  its whole history chain) onto the target's back stack. The shell's chrome
 *  doors (the rail, the palette) never come through here and reset the stack
 *  instead. The notification inbox is not chrome — it is a page whose rows come
 *  through this funnel like every other in-page door. */
function PaneBody({
  content: c,
  path,
  rev,
  nav,
  onFillPane,
  onReportAt,
  focused,
}: {
  content: MainPaneContent
  path: string
  /** The leaf's replace revision — a re-route to content-equal state still
   *  lands fresh (rail section re-click → section root). */
  rev?: number
  nav: MainPaneNav
  onFillPane: (path: string, content: MainPaneContent) => void
  onReportAt: (path: string, at: PaneAt, hist: PaneSeed[], rev: number) => void
  focused: boolean
}) {
  const fillWith = useCallback(
    (target: MainPaneContent) => onFillPane(path, withBackPush(c, target, nav.sessionLabel)),
    [c, path, nav, onFillPane],
  )
  const paneNav = useMemo<MainPaneNav>(
    () => ({
      ...nav,
      onOpenSession: (id) => fillWith({ kind: 'msession', id }),
      // Stamp THIS pane as the one that may consume the highlight (the caller
      // has already filled it through whichever door its subject kind uses).
      onFocusHere: (target) => nav.onFocusHere(target, path),
      onOpenProject: (id) => fillWith({ kind: 'msection', id: 'projects', seed: { projectId: id } }),
      onOpenSchedule: (id) => fillWith({ kind: 'msection', id: 'scheduled', seed: { scheduleId: id } }),
    }),
    [nav, fillWith, path],
  )
  // The pane-level relations bridge: entity doors inside CONVERSATION and
  // panel content (a relation card's "View in …") land in THIS pane with the
  // origin pushed. SectionPane nests its own override below for section
  // pages, so same-section targets keep pushing its local detail focus.
  const relNav = useCallback(
    (section: SectionId, id?: string, subId?: string) => {
      const seed = seedFor(section, id, subId)
      fillWith({ kind: 'msection', id: section, ...(seed ? { seed } : {}) })
    },
    [fillWith],
  )
  // The back affordance pops WITHOUT a push — walking history must not grow it.
  const backOut = useMemo<PaneBackOut | undefined>(() => {
    const stack = c.kind === 'context-panel' ? undefined : c.back
    if (!stack?.length) return undefined
    const top = stack[stack.length - 1]
    return { loc: top, go: () => onFillPane(path, contentForLoc(top, stack.slice(0, -1))) }
  }, [c, path, onFillPane])

  const body = c.kind === 'msection' ? (
    <SectionLoadBoundary
      key={`${c.id}:${c.sub ?? ''}:${c.seed ? JSON.stringify(c.seed) : ''}:${rev ?? 0}`}
      section={c.id}
    >
      <Suspense fallback={<SectionLoadingState section={c.id} />}>
        <SectionPane
          // Keyed on the full seed + the leaf revision so ANY re-route (a rail
          // facet, a cross-section retarget, a same-section re-click) resets the
          // pane-local nav cleanly. `at` (the pane's REPORTED live location) is
          // deliberately NOT in the key — the pane must not remount from
          // describing itself; a fresh mount initializes from it instead (a
          // reload restores the pane to the same deep spot). `back` stays out
          // too: history changes never remount the page carrying them.
          key={`${c.id}:${c.sub ?? ''}:${c.seed ? JSON.stringify(c.seed) : ''}:${rev ?? 0}`}
          section={c.id}
          initialSub={c.at ? (c.at.sub ?? null) : (c.sub ?? null)}
          initialFocus={c.at ? seedOfAt(c.at) : c.seed}
          // A RESTORE mount (the reported `at` present — reload or tree restore)
          // rehydrates the persisted in-section stack too, so the back walk
          // survives; tier hops keep this instance mounted. A door-seeded mount
          // starts with an empty local stack.
          initialStack={c.at ? c.hist : undefined}
          nav={paneNav}
          onRetarget={fillWith}
          // Reports are stamped with the leaf revision this instance rendered
          // under, so a stale instance's late report can't overwrite a route
          // that already replaced the leaf (reportPaneAt drops mismatches).
          onAt={(at, hist) => onReportAt(path, at, hist, rev ?? 0)}
          backOut={backOut}
          focused={focused}
        />
      </Suspense>
    </SectionLoadBoundary>
  ) : c.kind === 'msession' ? (
    <ConversationPane sessionId={c.id} nav={paneNav} backOut={backOut} />
  ) : (
    <ContextPanelView
      sessionId={c.sessionId}
      panel={c.panel}
      onGone={nav.onPaneSubjectGone ? () => nav.onPaneSubjectGone!(path, c) : undefined}
    />
  )
  // Every pane content resolves the relations nav bridge against ITSELF
  // (ADAPT-17's pane-locality, extended to conversations and panels).
  const scoped = <SectionNavOverride.Provider value={relNav}>{body}</SectionNavOverride.Provider>
  // The notification-door focus target, scoped to THIS pane (nav.focusCtxFor
  // answers non-null only for the pane the door landed in) — without a host
  // bridge the default empty context stands.
  return nav.focusCtxFor ? (
    <FocusContext.Provider value={nav.focusCtxFor(path)}>{scoped}</FocusContext.Provider>
  ) : (
    scoped
  )
}

interface BranchProps {
  node: MainSplitNode
  path: string
  overlay: boolean
  focusedPane: string
  nav: MainPaneNav
  onFocusPane: (path: string) => void
  onFillPane: (path: string, content: MainPaneContent) => void
  onReportAt: (path: string, at: PaneAt, hist: PaneSeed[], rev: number) => void
  onRatio: (path: string, ratio: number) => void
}

function Branch(props: BranchProps) {
  const { node, path, overlay, focusedPane, onFocusPane, onRatio } = props
  const ref = useRef<HTMLDivElement>(null)

  if (node.kind === 'pane') {
    const c = node.content
    const focused = focusedPane === path
    // A pane at the root path IS the whole workspace — focus is unambiguous,
    // so it wears no cue at all (the old always-on accent ring read as noise).
    const solo = path === ''
    return (
      <div
        // No per-pane chrome AT ALL: content edge to edge (close lives in the
        // rail cluster beside the split buttons). Pointer-down anywhere focuses
        // the pane (capture — a click on a button inside still counts). In a
        // split, "the rail cluster acts HERE" reads by recession, not
        // decoration: unfocused panes sit on the rail's sidebar tone while the
        // focused pane keeps the bright canvas — the inactive-window idiom,
        // quieter than the accent ring it replaces.
        className={`relative flex min-h-0 min-w-0 flex-1 flex-col transition-colors ${
          solo || focused ? 'bg-canvas' : 'bg-sidebar'
        }`}
        data-main-pane={path || 'root'}
        data-focused={focused || undefined}
        onPointerDownCapture={() => onFocusPane(path)}
      >
        <PaneBody
          content={c}
          path={path}
          rev={node.rev}
          focused={focused}
          nav={props.nav}
          onFillPane={props.onFillPane}
          onReportAt={props.onReportAt}
        />
      </div>
    )
  }

  const row = node.dir === 'row'
  const ratio = clampRatio(node.ratio)
  // The same absolute floors the right-panel frame earned (rulebook finding):
  // percentage bases never shrink a pane under a usable minimum.
  const minStyle = row ? { minWidth: 320 } : { minHeight: 160 }
  const aPath = `${path}a`
  const bPath = `${path}b`
  const onFocusedPath = (childPath: string) => !overlay || focusedPane.startsWith(childPath)
  const childStyle = (childRatio: number, visible: boolean) =>
    overlay
      ? { flex: '1 1 0%', minWidth: 0, minHeight: 0, ...(visible ? {} : { display: 'none' }) }
      : { flex: `${childRatio} 1 0%`, ...minStyle }
  const child = (n: MainSplitNode, p: string) => <Branch {...props} node={n} path={p} />
  return (
    <div ref={ref} className={`flex min-h-0 min-w-0 flex-1 ${row ? 'flex-row' : 'flex-col'}`}>
      <div className="flex min-h-0 min-w-0" style={childStyle(ratio, onFocusedPath(aPath))}>
        {child(node.a, aPath)}
      </div>
      <div
        className="relative flex min-h-0 min-w-0"
        style={childStyle(1 - ratio, onFocusedPath(bPath))}
      >
        <div className={overlay ? 'hidden' : 'contents'}>
          <ResizeHandle
            side={row ? 'left' : 'top'}
            ownsEdge
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
        </div>
        {child(node.b, bPath)}
      </div>
    </div>
  )
}

/* SectionPane and ConversationPane live in their own files
 * (./SectionPane, ./ConversationPane) — this file is only the
 * frame: the gate, the tree renderer, and the one shared leaf renderer. */
