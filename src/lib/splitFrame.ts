/** ── The split frame's pure tree math (spec ADAPT-16) ────────────────────────
 *  A general tiling model for the right panel area: a binary tree whose leaves
 *  are PANES (each showing one panel content — a PanelFocus target, the run
 *  switcher, or a not-yet-filled picker) and whose inner nodes are SPLITS
 *  (row = side-by-side, col = stacked), each carrying the fraction of its axis
 *  the first child takes. `null` means "no split frame" — the legacy single
 *  panel driven by `focus`, which stays the default; the tree exists only after
 *  the user splits, so every pre-split path is byte-identical to before.
 *
 *  Dependency-free on purpose (the railPanes.ts pattern): the component renders
 *  whatever this module computes, and tests/split-frame.test.ts locks the math
 *  without a DOM. Paths address nodes as strings of 'a'/'b' steps from the root
 *  ('' = root), so the tree round-trips JSON for the per-session persistence.
 *  Ratios are clamped on write against CONSTANT bounds (no context-dependent
 *  clamp ever lands in storage — the rail-width rule's easy case). */

export type SplitDir = 'row' | 'col'

/** What one pane shows. The first five mirror PanelFocus kinds; 'runs' is the
 *  scheduled-run switcher (today the one panel that exists WITHOUT a focus);
 *  'picker' is an empty pane awaiting the user's choice of content. */
export interface PaneContent {
  kind: 'workspace' | 'repo' | 'connector' | 'file' | 'photo' | 'runs' | 'picker'
  id: string
}

export type SplitNode =
  | { kind: 'pane'; content: PaneContent }
  | { kind: 'split'; dir: SplitDir; ratio: number; a: SplitNode; b: SplitNode }

/** Constant ratio bounds — a pane can shrink to 15% of its split's axis, no
 *  further, so no pane ever collapses to an unusable sliver. */
export const RATIO_MIN = 0.15
export const RATIO_MAX = 0.85
export const RATIO_DEFAULT = 0.5

export const pane = (content: PaneContent): SplitNode => ({ kind: 'pane', content })

export const clampRatio = (ratio: number): number => Math.min(RATIO_MAX, Math.max(RATIO_MIN, ratio))

export const sameContent = (x: PaneContent, y: PaneContent): boolean => x.kind === y.kind && x.id === y.id

/** The node at a path, or undefined for a path the tree doesn't have. */
export function nodeAt(root: SplitNode, path: string): SplitNode | undefined {
  let node: SplitNode = root
  for (const step of path) {
    if (node.kind !== 'split' || (step !== 'a' && step !== 'b')) return undefined
    node = node[step]
  }
  return node
}

/** Every pane leaf, left-to-right, with its path — the render walk and the
 *  "is this content already showing?" lookup. */
export function panes(root: SplitNode | null): Array<{ path: string; content: PaneContent }> {
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
function editAt(root: SplitNode, path: string, edit: (node: SplitNode) => SplitNode): SplitNode {
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
export function splitPane(root: SplitNode, path: string, dir: SplitDir, content: PaneContent): SplitNode {
  return editAt(root, path, (node) =>
    node.kind === 'pane' ? { kind: 'split', dir, ratio: RATIO_DEFAULT, a: node, b: pane(content) } : node,
  )
}

/** Close the pane at `path`: its sibling takes the parent split's whole slot.
 *  Closing the root pane (or an invalid path) returns null-safe results: the
 *  caller maps a single-pane close to "drop the frame" via the null return. */
export function closePane(root: SplitNode, path: string): SplitNode | null {
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
export function replacePane(root: SplitNode, path: string, content: PaneContent): SplitNode {
  return editAt(root, path, (node) => (node.kind === 'pane' ? { kind: 'pane', content } : node))
}

/** Set a split's ratio (clamped against the constant bounds). */
export function setRatio(root: SplitNode, path: string, ratio: number): SplitNode {
  return editAt(root, path, (node) => (node.kind === 'split' ? { ...node, ratio: clampRatio(ratio) } : node))
}

/** Drop panes whose content no longer exists (a detached repo, a removed
 *  connector), collapsing their splits — pickers always survive (they name
 *  nothing). Returns null when nothing keepable remains. */
export function prunePanes(root: SplitNode | null, keep: (content: PaneContent) => boolean): SplitNode | null {
  if (!root) return null
  if (root.kind === 'pane') return root.content.kind === 'picker' || keep(root.content) ? root : null
  const a = prunePanes(root.a, keep)
  const b = prunePanes(root.b, keep)
  if (a && b) return a === root.a && b === root.b ? root : { ...root, a, b }
  return a ?? b
}

/** The path of the first pane showing `content`, if any — chip clicks activate
 *  an already-visible pane instead of duplicating it. */
export function findPane(root: SplitNode | null, content: PaneContent): string | undefined {
  return panes(root).find((p) => sameContent(p.content, content))?.path
}
