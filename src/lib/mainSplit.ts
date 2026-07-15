/** ── The MAIN workspace split — view vocabulary + per-account persistence ────
 *  (universal split Phase 2, docs/design/universal-split-workspace.md §2.1.)
 *  The main surface right of the rail tiles into a split tree
 *  (src/lib/splitFrame.ts, instantiated with this vocabulary):
 *
 *  - `primary`  — THE controller-driven surface (the active conversation or the
 *                 active section page): exactly what the un-split app shows,
 *                 rendered by the same JSX. Exactly one primary pane exists in
 *                 any tree; rail/palette navigation lands here, and its
 *                 location is the address bar's (ADAPT-15 unchanged).
 *  - `msection` — an INDEPENDENT section page (Projects, Artifacts, …) with its
 *                 own pane-local navigation state (sub-view, open detail) —
 *                 fully interactive; global data through the shared api hooks.
 *  - `msession` — an independent conversation (Phase 3; the store is ready).
 *  - `mpicker`  — an empty pane awaiting the user's choice.
 *
 *  Persistence is PER ACCOUNT (the tree spans sessions), scoped like uiPrefs:
 *  the blob keys on the resolved user id, restore prunes at render, storage is
 *  never rewritten by a clamp. */
import type { SectionId } from '../types'
// `Live` is type-only (erased at runtime) — no cycle, and Node's native TS never
// loads data/liveSession to run this node-tested module.
import type { Live } from '../data/liveSession'
// Extension-qualified: this module is node-tested (tests/main-split.test.ts),
// and Node's native TS resolves runtime imports only with the explicit .ts.
import { closePane, nodeAt, pane, panes, replacePane, splitPane, type PaneContent, type SplitNode } from './splitFrame.ts'

export type MainPaneContent =
  | { kind: 'primary'; id: 'primary' }
  // `sub` seeds the pane's local sub-view (a rail facet click routing into a
  // focused pane carries the facet along) — pane-local state after that.
  | { kind: 'msection'; id: SectionId; sub?: string | null }
  | { kind: 'msession'; id: string }
  // A session's context panel as a FULL pane (universal split Phase 4): the
  // workspace / repo / connector / files / photos / run switcher, scoped to its
  // OWNING session (`sessionId`) and resolved against that session's keyed live —
  // no longer a separate right frame that splits its own inner view (ADAPT-16,
  // retired). `id` is the stable (session, panel) identity, so a chip re-click
  // focuses the existing pane instead of tiling a duplicate; `panel` is the
  // PaneContent the ContextPanelView renders. `primary` marks the ONE pane the
  // active session's `focus` drives (auto-open + per-session memory, FWD-2) — it
  // is found by this flag, not by position, so splitting the primary can never
  // orphan it; a context pane DUPLICATED via the rail drops the flag and becomes
  // an independent PINNED pane (the old ADAPT-16 multi-pane tiling, for free).
  | { kind: 'context-panel'; id: string; sessionId: string; panel: PaneContent; primary?: boolean }
  // Legacy: pre-duplicate-split blobs may still hold empty picker panes; the
  // UI renders them but nothing mints them anymore (a split now DUPLICATES
  // the focused pane — no picker step).
  | { kind: 'mpicker'; id: string }

export type MainSplitNode = SplitNode<MainPaneContent>

/** The main tree's prune predicate: conversation / section / primary panes are
 *  always kept (their content is a live registry read); a `context-panel` pane
 *  is kept only while its panel still resolves against its OWNING session's live
 *  (a detached repo / removed connector collapses it). `liveFor` returns a
 *  session's live (or undefined if it's gone — the pane collapses); `isRun` says
 *  whether a session is a scheduled-run session (the runs panel needs one). The
 *  render passes this to `prunePanes` (splitFrame) — prune AT render, never in
 *  storage. */
export function mainPaneKeep(
  liveFor: (sessionId: string) => Live | undefined,
  isRun: (sessionId: string) => boolean,
): (c: MainPaneContent) => boolean {
  return (c) => {
    if (c.kind !== 'context-panel') return true
    const l = liveFor(c.sessionId)
    return !!l && paneContentAlive(l, isRun(c.sessionId))(c.panel)
  }
}

/** A context-panel pane's stable identity: its owning session + which panel.
 *  Two panes of the same (session, panel) collide on this id, so `findPane`
 *  focuses the existing pane instead of tiling a duplicate. Space-joined —
 *  session and panel ids are slugs (`auth-refactor`, `repo-demo`), never spaced,
 *  so the parts can't alias across the boundary. */
export const contextPaneId = (sessionId: string, panel: PaneContent): string =>
  `${sessionId} ${panel.kind} ${panel.id}`

/** Construct a context-panel pane's content for a session + panel. `primary`
 *  marks the active session's focus-driven pane (exactly one at a time). */
export const contextPaneContent = (
  sessionId: string,
  panel: PaneContent,
  opts?: { primary?: boolean },
): MainPaneContent => ({
  kind: 'context-panel',
  id: contextPaneId(sessionId, panel),
  sessionId,
  panel,
  ...(opts?.primary ? { primary: true } : {}),
})

/** Strip the `primary` marker off a content value (a context pane duplicated via
 *  the rail becomes an independent PINNED pane; every other kind is unchanged). */
export const unpinnedContent = (c: MainPaneContent): MainPaneContent =>
  c.kind === 'context-panel' && c.primary ? { kind: 'context-panel', id: c.id, sessionId: c.sessionId, panel: c.panel } : c

/** Whether a context panel's content still exists in the session — the prune
 *  predicate a detached repo / removed connector fails (its pane collapses).
 *  File / photo panes show the KIND's collection (their id is only the initial
 *  selection), so they survive while any attachment of that kind remains; a runs
 *  pane needs a run session. Shared with the legacy frame's prune
 *  (useSessionWorkspace) so there is ONE aliveness rule. */
export function paneContentAlive(l: Live, isRunSession: boolean) {
  return (c: PaneContent): boolean =>
    c.kind === 'workspace'
      ? l.workspaces.some((w) => w.id === c.id)
      : c.kind === 'repo'
        ? l.repos.some((r) => r.id === c.id)
        : c.kind === 'connector'
          ? l.connectors.some((x) => x.id === c.id)
          : c.kind === 'runs'
            ? isRunSession
            : l.attachments.some((a) => a.kind === c.kind)
}

export const PRIMARY: MainPaneContent = { kind: 'primary', id: 'primary' }

let mainPickerSeq = 0
export const newMainPicker = (): MainPaneContent => ({ kind: 'mpicker', id: `mpk-${(mainPickerSeq += 1)}` })

/** Close a pane, keeping the MAIN tree's invariant: the tree exists to hold
 *  more than the primary — down to one pane (or, guarded, a tree that somehow
 *  lost its primary) it dissolves to null and the plain surface returns. */
export function closeMainPane(tree: MainSplitNode, path: string): MainSplitNode | null {
  const next = closePane(tree, path)
  if (!next) return null
  if (next.kind === 'pane' || !panes(next).some((p) => p.content.kind === 'primary')) return null
  return next
}

/** Close the PRIMARY pane's tile — the homogeneity rule (panes are equals to
 *  the user; the primary is an implementation detail): the primary ROLE
 *  survives (it is where the URL lives) by RELOCATING into the pane that
 *  inherits the freed space. That successor's content is returned as
 *  `promoted` — the caller navigates the singleton controller onto it, so the
 *  address honestly names what the surviving tile shows — and its leaf is
 *  re-stamped `primary`. Returns null when `path` isn't the primary pane
 *  (close those with `closeMainPane`); `tree: null` when only the promoted
 *  pane remained (the frame dissolves to the plain surface). */
export function closePrimaryPane(
  tree: MainSplitNode,
  path: string,
): { tree: MainSplitNode | null; promoted: MainPaneContent } | null {
  const node = nodeAt(tree, path)
  if (!node || node.kind !== 'pane' || node.content.kind !== 'primary') return null
  const collapsed = closePane(tree, path)
  if (!collapsed) return null // a lone-primary tree shouldn't exist; nothing to promote
  // The successor: the first pane that took the primary's slot — but a
  // `context-panel` pane is NOT a navigable surface (it can't become the URL
  // owner), so it's skipped. Prefer a pane in the freed subtree; else any
  // non-context pane; refuse when only context panes remain (nothing to promote
  // to — the close is a no-op, e.g. [primary | its own context pane]).
  const parentPath = path.slice(0, -1)
  const promotable = panes(collapsed).filter((p) => p.content.kind !== 'context-panel')
  const successor = promotable.find((p) => p.path.startsWith(parentPath)) ?? promotable[0]
  if (!successor) return null
  const next = replacePane(collapsed, successor.path, PRIMARY)
  return { tree: next.kind === 'pane' ? null : next, promoted: successor.content }
}

/** ── The active session's context panel, as a pane in the ONE tree ───────────
 *  (universal split Phase 4.) The primary conversation's open panel (its
 *  `focus`) is a `context-panel` pane marked `primary` — found by that flag, not
 *  by position, so the user's own tiling never orphans it. */

/** The active session's focus-driven context pane (the one marked `primary`), or
 *  null when the panel is closed. At most one exists at a time. */
export function findPrimaryContext(
  tree: MainSplitNode | null,
): { path: string; content: Extract<MainPaneContent, { kind: 'context-panel' }> } | null {
  const p = panes(tree).find((x) => x.content.kind === 'context-panel' && x.content.primary)
  return p ? { path: p.path, content: p.content as Extract<MainPaneContent, { kind: 'context-panel' }> } : null
}

/** The tree WITHOUT the active session's focus-driven context pane — persisted
 *  instead of the live tree so the TRANSIENT projection of `focus` never lands in
 *  storage (the "clamp-at-render, never-in-storage" posture): on reload the tree
 *  restores its user-created panes (conversations, sections, PINNED context
 *  panes) and the sync effect re-derives the primary context pane from `focus`,
 *  so no wrong-session panel flashes and there is no per-focus-toggle churn. */
export function withoutPrimaryContext(tree: MainSplitNode | null): MainSplitNode | null {
  const existing = findPrimaryContext(tree)
  return existing && tree ? closeMainPane(tree, existing.path) : tree
}

/** Reconcile the active session's context pane to `panel` (null = closed) — the
 *  pure edit `useMainSplit.setPrimaryContext` commits from the focus-sync effect.
 *  Returns the tree UNCHANGED when already in the desired state (no needless
 *  render / persist). Adding one splits the primary pane; removing one collapses
 *  its split; switching sessions or panels replaces it in place. */
export function setPrimaryContextTree(
  tree: MainSplitNode | null,
  sessionId: string,
  panel: PaneContent | null,
): MainSplitNode | null {
  const existing = findPrimaryContext(tree)
  if (!panel) return existing && tree ? closeMainPane(tree, existing.path) : tree
  const content = contextPaneContent(sessionId, panel, { primary: true })
  if (existing && tree) {
    return existing.content.id === content.id ? tree : replacePane(tree, existing.path, content)
  }
  // No panel yet: split the primary pane, adding the context pane beside it.
  const base = tree ?? pane(PRIMARY)
  const primaryPath = panes(base).find((x) => x.content.kind === 'primary')?.path ?? ''
  return splitPane(base, primaryPath, 'row', content)
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
    return raw ? (JSON.parse(raw) as MainSplitNode) : null
  } catch {
    return null
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
