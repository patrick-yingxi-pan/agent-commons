/** ── The split tree's pure math (spec ADAPT-16; universal split §2.1) ────────
 *  ONE general tiling model: a binary tree whose leaves are PANES (each showing
 *  one content value) and whose inner nodes are SPLITS (row = side-by-side,
 *  col = stacked), each carrying the fraction of its axis the first child
 *  takes. `null` means "no split" — a single surface; the tree exists only
 *  after the user splits, so every pre-split path is byte-identical to before.
 *
 *  GENERIC over the content type (universal split Phase 2): the right-panel
 *  frame instantiates it with `PaneContent` (the default type argument, so its
 *  call sites read unchanged) and the MAIN workspace tree with its own view
 *  vocabulary (src/lib/mainSplit.ts). Content only needs `kind` + `id` — the
 *  identity `findPane` matches on.
 *
 *  Dependency-free on purpose (the railSplit.ts pattern): the components render
 *  whatever this module computes, and src/lib/split-frame.test.ts locks the math
 *  without a DOM. Paths address nodes as strings of 'a'/'b' steps from the root
 *  ('' = root), so the tree round-trips JSON for persistence. Ratios are
 *  clamped on write against CONSTANT bounds (no context-dependent clamp ever
 *  lands in storage — the rail-width rule's easy case). */

export type SplitDir = 'row' | 'col'

/** The identity every pane content carries — what `findPane` matches on. */
export interface PaneId {
  kind: string
  id: string
}

/** What one CONTEXT-PANEL pane shows — the kinds mirror PanelFocus: real
 *  attached CONTENT only, never a chooser or a switcher (UI-15,
 *  docs/ui-invariants.md — navigation lists float as popovers; the retired
 *  'runs' switcher and 'picker' kinds migrate out of persisted trees in
 *  mainSplit's migrateMainSplit). */
export interface PaneContent {
  kind: 'workspace' | 'repo' | 'connector' | 'file' | 'photo'
  id: string
}

export type SplitNode<C extends PaneId = PaneContent> =
  // `rev` bumps on every explicit replace (routeToFocused / a door): a
  // re-route to CONTENT-EQUAL state still means "land fresh" (a rail section
  // re-click returns to the section root, not the pane's old local detail) —
  // the render keys on it so the page remounts.
  | { kind: 'pane'; content: C; rev?: number }
  | { kind: 'split'; dir: SplitDir; ratio: number; a: SplitNode<C>; b: SplitNode<C> }

/** Constant ratio bounds — a pane can shrink to 15% of its split's axis, no
 *  further, so no pane ever collapses to an unusable sliver. */
export const RATIO_MIN = 0.15
export const RATIO_MAX = 0.85
export const RATIO_DEFAULT = 0.5

export const pane = <C extends PaneId>(content: C): SplitNode<C> => ({ kind: 'pane', content })

export const clampRatio = (ratio: number): number => Math.min(RATIO_MAX, Math.max(RATIO_MIN, ratio))

export const sameContent = (x: PaneId, y: PaneId): boolean => x.kind === y.kind && x.id === y.id

/** The node at a path, or undefined for a path the tree doesn't have. */
export function nodeAt<C extends PaneId>(root: SplitNode<C>, path: string): SplitNode<C> | undefined {
  let node: SplitNode<C> = root
  for (const step of path) {
    if (node.kind !== 'split' || (step !== 'a' && step !== 'b')) return undefined
    node = node[step]
  }
  return node
}

/** Every pane leaf, left-to-right, with its path — the render walk and the
 *  "is this content already showing?" lookup. */
export function panes<C extends PaneId>(root: SplitNode<C> | null): Array<{ path: string; content: C }> {
  if (!root) return []
  if (root.kind === 'pane') return [{ path: '', content: root.content }]
  return [
    ...panes(root.a).map((p) => ({ ...p, path: `a${p.path}` })),
    ...panes(root.b).map((p) => ({ ...p, path: `b${p.path}` })),
  ]
}

/** Rebuild the tree with `path` replaced by what `edit` returns. An invalid
 *  path returns the tree unchanged (never throws — a stale path from a racing
 *  click is a no-op, not a crash). */
function editAt<C extends PaneId>(root: SplitNode<C>, path: string, edit: (node: SplitNode<C>) => SplitNode<C>): SplitNode<C> {
  if (path === '') return edit(root)
  if (root.kind !== 'split') return root
  const step = path[0]
  if (step !== 'a' && step !== 'b') return root
  const child = editAt(root[step], path.slice(1), edit)
  return child === root[step] ? root : { ...root, [step]: child }
}

/** Split the pane at `path`: it keeps its content and takes the first half; the
 *  new sibling shows `content` (usually a picker). Splitting a split node is
 *  refused (unchanged) — only panes split. */
export function splitPane<C extends PaneId>(root: SplitNode<C>, path: string, dir: SplitDir, content: C): SplitNode<C> {
  return editAt(root, path, (node) =>
    node.kind === 'pane' ? { kind: 'split', dir, ratio: RATIO_DEFAULT, a: node, b: pane(content) } : node,
  )
}

/** Close the pane at `path`: its sibling takes the parent split's whole slot.
 *  Closing the root pane (or an invalid path) returns null-safe results: the
 *  caller maps a single-pane close to "drop the frame" via the null return. */
export function closePane<C extends PaneId>(root: SplitNode<C>, path: string): SplitNode<C> | null {
  if (path === '') return null // the last pane — the frame dissolves
  const parentPath = path.slice(0, -1)
  const step = path[path.length - 1]
  if (step !== 'a' && step !== 'b') return root
  const parent = nodeAt(root, parentPath)
  if (!parent || parent.kind !== 'split') return root
  const sibling = parent[step === 'a' ? 'b' : 'a']
  return editAt(root, parentPath, () => sibling)
}

/** Replace the content of the pane at `path` (the picker filling in, or a chip
 *  click retargeting the active pane). */
export function replacePane<C extends PaneId>(root: SplitNode<C>, path: string, content: C): SplitNode<C> {
  return editAt(root, path, (node) =>
    node.kind === 'pane' ? { kind: 'pane', content, rev: (node.rev ?? 0) + 1 } : node,
  )
}

/** Update a pane's content WITHOUT bumping `rev` — for reflecting a pane's own
 *  LIVE state back into the tree (its reported location): the pane must not
 *  remount from describing itself (replacePane's bump is for ROUTES). */
export function updatePaneContent<C extends PaneId>(root: SplitNode<C>, path: string, content: C): SplitNode<C> {
  return editAt(root, path, (node) => (node.kind === 'pane' ? { ...node, content } : node))
}

/** Set a split's ratio (clamped against the constant bounds). */
export function setRatio<C extends PaneId>(root: SplitNode<C>, path: string, ratio: number): SplitNode<C> {
  return editAt(root, path, (node) => (node.kind === 'split' ? { ...node, ratio: clampRatio(ratio) } : node))
}

/** Drop panes whose content no longer exists (a detached repo, a removed
 *  connector, a deleted session), collapsing their splits. Returns null when
 *  nothing keepable remains. */
export function prunePanes<C extends PaneId>(root: SplitNode<C> | null, keep: (content: C) => boolean): SplitNode<C> | null {
  if (!root) return null
  if (root.kind === 'pane') return keep(root.content) ? root : null
  const a = prunePanes(root.a, keep)
  const b = prunePanes(root.b, keep)
  if (a && b) return a === root.a && b === root.b ? root : { ...root, a, b }
  return a ?? b
}

/** The path of the first pane showing `content`, if any — chip clicks activate
 *  an already-visible pane instead of duplicating it. */
export function findPane<C extends PaneId>(root: SplitNode<C> | null, content: PaneId): string | undefined {
  return panes(root).find((p) => sameContent(p.content, content))?.path
}
