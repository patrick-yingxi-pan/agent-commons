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
// Extension-qualified: this module is node-tested (tests/main-split.test.ts),
// and Node's native TS resolves runtime imports only with the explicit .ts.
import { closePane, panes, type SplitNode } from './splitFrame.ts'

export type MainPaneContent =
  | { kind: 'primary'; id: 'primary' }
  | { kind: 'msection'; id: SectionId }
  | { kind: 'msession'; id: string }
  | { kind: 'mpicker'; id: string }

export type MainSplitNode = SplitNode<MainPaneContent>

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
