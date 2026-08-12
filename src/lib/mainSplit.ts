/** ── The MAIN workspace split — view vocabulary + per-account persistence ────
 *  (universal split, docs/design/universal-split-workspace.md §2.1 + the
 *  Phase 6 equal-pages model.) The main surface right of the rail IS a split
 *  tree of equal pages (src/lib/splitFrame.ts, instantiated here) — no
 *  privileged pane; `null` = the empty BACKGROUND (a legal state the rail's
 *  doors repopulate):
 *
 *  - `msession` — a conversation (the fresh DRAFT included), fully
 *                 interactive through the keyed per-session store.
 *  - `msection` — a section page (Projects, Artifacts, …) with its own
 *                 pane-local navigation state (sub-view, open detail) —
 *                 fully interactive; global data through the shared api hooks.
 *  - `context-panel` — a session's context panel as a full pane.
 *
 *  Every kind is CONTENT (UI-15): choosers and switchers are floating chrome,
 *  never panes — the retired `mpicker` picker panes and `runs`-switcher
 *  context panes migrate out of persisted blobs (migrateMainSplit).
 *
 *  Persistence is PER ACCOUNT (the tree spans sessions), scoped like uiPrefs:
 *  the blob keys on the resolved user id, restore prunes at render, storage is
 *  never rewritten by a clamp. */
import type { SectionId } from '../types'
import { locOfSeed, type PaneSeed } from './paneNav.ts'
// `Live` is type-only (erased at runtime) — no cycle, and Node's native TS never
// loads data/liveSession to run this node-tested module.
import type { Live } from '../data/liveSession'
// Extension-qualified: this module is node-tested (src/lib/main-split.test.ts),
// and Node's native TS resolves runtime imports only with the explicit .ts.
import { closePane, panes, replacePane, splitPane, type PaneContent, type SplitNode } from './splitFrame.ts'
import { pathForView } from './urlRoutes.ts'

/** ── One entry of a pane's BACK history (the back-history rule, ADAPT-18) ────
 *  The page a pane showed before an IN-PAGE door replaced it: a section page
 *  (its sub-view + open detail, the shape a fresh mount reseeds from) or a
 *  conversation (its title carried — resolved when you leave it, the nav.ts
 *  session-title rule, since a run session may be in no list to look up
 *  later). Doors clicked INSIDE pane content push the origin onto the
 *  target's `back`; chrome doors reset it. (The notification inbox is a PAGE,
 *  not chrome, so its rows are in-page doors — see paneHistory's header.)
 *  Plain JSON — the stack persists with the tree. */
export type PaneLoc =
  | { kind: 'msection'; id: SectionId; sub?: string | null; seed?: PaneSeed }
  | { kind: 'msession'; id: string; title?: string }

export type MainPaneContent =
  // `sub` seeds the pane's local sub-view (a rail facet click routing into a
  // focused pane carries the facet along); `seed` seeds the pane's open DETAIL
  // (a cross-section door inside a pane — an owner byline, a linked context —
  // retargets the pane's leaf to the target section WITH the detail open,
  // src/lib/paneNav.ts). Both are seeds: pane-local state after mount — which
  // the pane REPORTS back as `at` (its live sub-view + open detail, written
  // rev-stably so the pane never remounts from describing itself): the URL
  // projects it (`/projects/:id` from a focused pane), persistence restores
  // it, and a fresh mount initializes from `at ?? seed`. `hist` is the pane's
  // REPORTED in-section back stack (the detail pages behind the live one),
  // reported rev-stably beside `at` so a door leaving the pane can fold the
  // whole in-section history into the target's `back` (src/lib/paneHistory.ts).
  // `back` is the carried CROSS-page history the back affordance walks.
  | { kind: 'msection'; id: SectionId; sub?: string | null; seed?: PaneSeed; at?: PaneAt; hist?: PaneSeed[]; back?: PaneLoc[] }
  | { kind: 'msession'; id: string; back?: PaneLoc[] }
  // A session's context panel as a FULL pane (universal split Phase 4): the
  // workspace / repo / connector / files / photos, scoped to its
  // OWNING session (`sessionId`) and resolved against that session's keyed live —
  // no longer a separate right frame that splits its own inner view (ADAPT-16,
  // retired). `id` is the stable (session, panel) identity, so a chip re-click
  // focuses the existing pane instead of tiling a duplicate; `panel` is the
  // PaneContent the ContextPanelView renders. `focusDriven` marks the ONE pane the
  // active session's `focus` drives (auto-open + per-session memory, FWD-2) — it
  // is found by this flag, not by position, so splitting its owning pane can never
  // orphan it; a context pane DUPLICATED via the rail drops the flag and becomes
  // an independent PINNED pane (the old ADAPT-16 multi-pane tiling, for free).
  | { kind: 'context-panel'; id: string; sessionId: string; panel: PaneContent; focusDriven?: boolean }

/** A section pane's LIVE location — the sub-view + open detail it reports. */
export type PaneAt = { sub: string | null } & PaneSeed

export type MainSplitNode = SplitNode<MainPaneContent>

/** Whether a pane's content is OWNED by `sessionId` — its conversation panes
 *  and its context panes alike (the live-prune unit: deleting a session
 *  evicts every pane it hosts, not just the focused one). */
export function hostsSession(c: MainPaneContent, sessionId: string): boolean {
  return (c.kind === 'msession' && c.id === sessionId) || (c.kind === 'context-panel' && c.sessionId === sessionId)
}

/** A pane's canonical URL path (ADAPT-15) — the ONE content→address rule: the
 *  focused-pane URL projection reads it, and the boot dedup matches the boot
 *  address against every restored pane with it (an address already on screen
 *  FOCUSES its pane instead of clobbering another). A conversation or section
 *  pane has its own path; a CONTEXT pane addresses as its OWNING conversation
 *  (a panel is not a page); a picker / unknown content has none (null). */
export function paneLocationPath(c: MainPaneContent): string | null {
  if (c.kind === 'msession') return pathForView({ kind: 'session', sessionId: c.id, title: '' }, null)
  if (c.kind === 'context-panel') return pathForView({ kind: 'session', sessionId: c.sessionId, title: '' }, null)
  if (c.kind === 'msection') {
    // The pane's REPORTED live location (`at`) wins — its deep page
    // (/projects/:id, /u/:name…) round-trips; the door seed covers the
    // pre-report frame.
    const loc = c.at ?? { sub: c.sub ?? null, ...(c.seed ?? {}) }
    return pathForView({ kind: 'section', section: c.id, ...locOfSeed(loc) }, loc.sub ?? null)
  }
  return null
}

/** The main tree's prune predicate: conversation / section panes are always
 *  kept (their content is a live registry read); a `context-panel` pane
 *  is kept only while its panel still resolves against its OWNING session's live
 *  (a detached repo / removed connector collapses it). `liveFor` returns a
 *  session's live (or undefined if it's gone — the pane collapses). The
 *  render passes this to `prunePanes` (splitFrame) — prune AT render, never in
 *  storage. */
export function mainPaneKeep(liveFor: (sessionId: string) => Live | undefined): (c: MainPaneContent) => boolean {
  return (c) => {
    if (c.kind !== 'context-panel') return true
    const l = liveFor(c.sessionId)
    return !!l && paneContentAlive(l)(c.panel)
  }
}

/** A context-panel pane's stable identity: its owning session + which panel.
 *  Two panes of the same (session, panel) collide on this id, so `findPane`
 *  focuses the existing pane instead of tiling a duplicate. Space-joined —
 *  session and panel ids are slugs (`auth-refactor`, `repo-demo`), never spaced,
 *  so the parts can't alias across the boundary. */
export const contextPaneId = (sessionId: string, panel: PaneContent): string =>
  `${sessionId} ${panel.kind} ${panel.id}`

/** Construct a context-panel pane's content for a session + panel. `focusDriven`
 *  marks the active session's focus-driven pane (exactly one at a time). */
export const contextPaneContent = (
  sessionId: string,
  panel: PaneContent,
  opts?: { focusDriven?: boolean },
): MainPaneContent => ({
  kind: 'context-panel',
  id: contextPaneId(sessionId, panel),
  sessionId,
  panel,
  ...(opts?.focusDriven ? { focusDriven: true } : {}),
})

/** Strip the `focusDriven` marker off a content value (a context pane duplicated via
 *  the rail becomes an independent PINNED pane; every other kind is unchanged). */
export const unpinnedContent = (c: MainPaneContent): MainPaneContent =>
  c.kind === 'context-panel' && c.focusDriven ? { kind: 'context-panel', id: c.id, sessionId: c.sessionId, panel: c.panel } : c

/** Whether a context panel's content still exists in the session — the prune
 *  predicate a detached repo / removed connector fails (its pane collapses).
 *  File / photo panes show the KIND's collection (their id is only the initial
 *  selection), so they survive while any attachment of that kind remains. */
export function paneContentAlive(l: Live) {
  return (c: PaneContent): boolean =>
    c.kind === 'workspace'
      ? l.workspaces.some((w) => w.id === c.id)
      : c.kind === 'repo'
        ? l.repos.some((r) => r.id === c.id)
        : c.kind === 'connector'
          ? l.connectors.some((x) => x.id === c.id)
          : l.attachments.some((a) => a.kind === c.kind)
}

/** Retarget every DRAFT conversation pane to the materialized session id — by
 *  CONTENT match, not path, so a duplicated draft pane retargets too. The
 *  draft entry `adopt`ed to the real id in the store; the pane leaves showing
 *  it must follow or they'd render the now-blank draft slot. Returns the tree
 *  unchanged (same reference) when nothing shows the draft. */
export function retargetDraftPanes(
  tree: MainSplitNode | null,
  draftId: string,
  realId: string,
): MainSplitNode | null {
  if (!tree) return tree
  let changed = false
  const walk = (n: MainSplitNode): MainSplitNode => {
    if (n.kind === 'pane') {
      if (n.content.kind === 'msession' && n.content.id === draftId) {
        changed = true
        // Spread, not rebuild: the pane's carried back history (ADAPT-18)
        // must survive the adoption.
        return { ...n, content: { ...n.content, id: realId } }
      }
      return n
    }
    return { ...n, a: walk(n.a), b: walk(n.b) }
  }
  const next = walk(tree)
  return changed ? next : tree
}

/** Close a pane — the ONE close rule, every pane equal (Phase 6, the owner's
 *  model): the sibling inherits the freed slot; closing the LAST pane returns
 *  null — the empty BACKGROUND surface, a legal state the rail's doors
 *  repopulate (not an implicit un-split "primary"). */
export function closeMainPane(tree: MainSplitNode, path: string): MainSplitNode | null {
  return closePane(tree, path)
}

/** ── The active session's context panel, as a pane in the ONE tree ───────────
 *  (universal split Phase 4.) The active conversation's open panel (its
 *  `focus`) is a `context-panel` pane marked `focusDriven` — found by that flag, not
 *  by position, so the user's own tiling never orphans it. */

/** The active session's focus-driven context pane (the one marked `focusDriven`), or
 *  null when the panel is closed. At most one exists at a time. */
export function findFocusDrivenContext(
  tree: MainSplitNode | null,
): { path: string; content: Extract<MainPaneContent, { kind: 'context-panel' }> } | null {
  const p = panes(tree).find((x) => x.content.kind === 'context-panel' && x.content.focusDriven)
  return p ? { path: p.path, content: p.content as Extract<MainPaneContent, { kind: 'context-panel' }> } : null
}

/** The tree WITHOUT the active session's focus-driven context pane — persisted
 *  instead of the live tree so the TRANSIENT projection of `focus` never lands in
 *  storage (the "clamp-at-render, never-in-storage" posture): on reload the tree
 *  restores its user-created panes (conversations, sections, PINNED context
 *  panes) and the sync effect re-derives the focus-driven context pane from `focus`,
 *  so no wrong-session panel flashes and there is no per-focus-toggle churn. */
export function withoutFocusDrivenContext(tree: MainSplitNode | null): MainSplitNode | null {
  const existing = findFocusDrivenContext(tree)
  return existing && tree ? closeMainPane(tree, existing.path) : tree
}

/** Reconcile the active session's context pane to `panel` (null = closed) — the
 *  pure edit `useMainSplit.setFocusDrivenContext` commits from the focus-sync effect.
 *  Returns the tree UNCHANGED when already in the desired state (no needless
 *  render / persist). Adding one splits the OWNING conversation's pane (the
 *  msession pane showing `sessionId` — no pane showing it, no projection);
 *  removing one collapses its split; a session/panel change replaces in place. */
export function setFocusDrivenContextTree(
  tree: MainSplitNode | null,
  sessionId: string,
  panel: PaneContent | null,
): MainSplitNode | null {
  const existing = findFocusDrivenContext(tree)
  if (!panel) return existing && tree ? closeMainPane(tree, existing.path) : tree
  const content = contextPaneContent(sessionId, panel, { focusDriven: true })
  if (existing && tree) {
    return existing.content.id === content.id ? tree : replacePane(tree, existing.path, content)
  }
  if (!tree) return tree // background — no conversation pane to anchor beside
  const anchor = panes(tree).find((x) => x.content.kind === 'msession' && x.content.id === sessionId)?.path
  if (anchor === undefined) return tree // the session isn't displayed
  return splitPane(tree, anchor, 'row', content)
}

/** ── Per-account persistence (the uiPrefs scoping pattern) ─────────────────── */
const KEY_BASE = 'claude-ui.mainsplit.v1'
let scope: string | null = null

/** Key the blob per account — set alongside setUiPrefScope (App.tsx). */
export function setMainSplitScope(userId: string): void {
  scope = userId
}

const key = () => (scope ? `${KEY_BASE}.${scope}` : KEY_BASE)

export function getMainSplitPref(): MainSplitNode | null {
  try {
    const raw = localStorage.getItem(key())
    if (!raw) return null
    return migrateMainSplit(JSON.parse(raw) as MainSplitNode)
  } catch {
    return null
  }
}

/** Legacy-blob migration: stored trees may carry pane kinds later builds
 *  retired — the `{kind:'primary'}` placeholder (pre-Phase 6, an alias of the
 *  dissolved singleton surface), `mpicker` chooser panes (pre-duplicate-split
 *  blobs), and `context-panel` panes holding the retired `runs` switcher (now
 *  the title bar's floating run-history click-down — UI-15: a chooser is
 *  chrome, never a pane). Strip those leaves (the sibling inherits the slot);
 *  the boot flow re-opens the remembered page as a concrete pane. Exported
 *  for its lock (src/lib/main-split.test.ts). */
export function migrateMainSplit(tree: MainSplitNode | null): MainSplitNode | null {
  const retired = (c: MainPaneContent): boolean => {
    const kind = (c as { kind: string }).kind
    return (
      kind === 'primary' ||
      kind === 'mpicker' ||
      (kind === 'context-panel' && ((c as { panel?: { kind?: string } }).panel?.kind as string) === 'runs')
    )
  }
  let next = tree
  // Re-collect after each close — paths shift as leaves collapse.
  for (;;) {
    const legacy = panes(next).find((p) => retired(p.content))
    if (!legacy || !next) return next
    next = closePane(next, legacy.path)
  }
}

export function setMainSplitPref(tree: MainSplitNode | null): void {
  try {
    if (tree === null) localStorage.removeItem(key())
    else localStorage.setItem(key(), JSON.stringify(tree))
  } catch {
    /* ignore quota / privacy-mode errors */
  }
}
