/** ── Focused split views for the account-resource rail (UI-39) ──────────────
 *
 * The rail and main workspace share the same binary split vocabulary. A rail
 * split is deliberately narrower: it is always vertical (`col`). Its leaves
 * are rooted projections of the ONE account-resource tree: the default root is
 * the whole forest; splitting an arbitrary entry makes that canonical node the
 * visible root of the new view, with its descendants intact and its ancestors
 * and outside siblings absent. This changes viewport scope, never ontology.
 */
import { closePane, nodeAt, pane, panes, RATIO_DEFAULT, splitPane, type SplitNode } from './splitFrame.ts'

export type RailViewRoot = {
  /** Stable path identity stamped on the canonical rail-tree node. */
  key: string
  /** Human-readable identity for inspection and persistence diagnostics. */
  label: string
  /** Canonical ancestor node keys, ordered forest-root to immediate parent. */
  ancestors: string[]
}

/** One revisioned disclosure request. A canonical key scopes it to that whole
 * subtree (root included); null addresses the complete forest. */
export type RailFoldSignal = { revision: number; expanded: boolean; targetKey: string | null }

export const railFoldAffects = (signal: RailFoldSignal, nodeKey: string): boolean =>
  signal.targetKey === null || nodeKey === signal.targetKey || nodeKey.startsWith(`${signal.targetKey}/`)

export type RailPaneContent = {
  kind: 'rail-view'
  /** Stable identity keeps an existing view's scroll memory through tree edits. */
  id: string
  /** Absent means the complete forest; present means this canonical subtree. */
  root?: RailViewRoot
}

export type RailSplitNode = SplitNode<RailPaneContent>

export const initialRailSplit = (): RailSplitNode => pane({ kind: 'rail-view', id: 'rail-root' })

/** The complete forest is the rail's recovery anchor, not an ordinary leaf.
 * A valid live or restored tree always retains one unrooted projection so a
 * user can get back from any narrowly rooted view without resetting storage. */
export function ensureCompleteRailView(tree: RailSplitNode): RailSplitNode {
  if (panes(tree).some(({ content }) => content.root === undefined)) return tree
  return {
    kind: 'split',
    dir: 'col',
    ratio: RATIO_DEFAULT,
    a: initialRailSplit(),
    b: tree,
  }
}

/** Split one rail view downward and make the selected canonical node the root
 * of the new lower view. The existing view remains the first child, matching
 * the main workspace's focused-pane split rule. */
export function splitRailView(
  tree: RailSplitNode,
  path: string,
  root: RailViewRoot,
  id: string,
): RailSplitNode {
  return splitPane(tree, path, 'col', { kind: 'rail-view', id, root })
}

/** Only a rooted secondary projection can close. The complete forest remains
 * the permanent recovery anchor even when other rail views exist. */
export function canCloseRailView(tree: RailSplitNode, path: string): boolean {
  const node = nodeAt(tree, path)
  return node?.kind === 'pane' && node.content.root !== undefined && panes(tree).length > 1
}

export function closeRailView(tree: RailSplitNode, path: string): RailSplitNode {
  if (!canCloseRailView(tree, path)) return tree
  return closePane(tree, path) ?? tree
}

// ── Per-account persistence (parallel to mainSplit.ts) ─────────────────────
const KEY_BASE = 'claude-ui.railsplit.v1'
let scope: string | null = null

export function setRailSplitScope(userId: string): void {
  scope = userId
}

const key = () => (scope ? `${KEY_BASE}.${scope}` : KEY_BASE)

function validNode(value: unknown): value is RailSplitNode {
  if (!value || typeof value !== 'object') return false
  const node = value as Record<string, unknown>
  if (node.kind === 'pane') {
    const content = node.content as Record<string, unknown> | undefined
    const root = content?.root as Record<string, unknown> | undefined
    const validRoot =
      root === undefined ||
      (typeof root.key === 'string' &&
        typeof root.label === 'string' &&
        Array.isArray(root.ancestors) &&
        root.ancestors.every((ancestor) => typeof ancestor === 'string'))
    return (
      !!content &&
      content.kind === 'rail-view' &&
      typeof content.id === 'string' &&
      !('anchorIndex' in content) &&
      !('anchorLabel' in content) &&
      validRoot
    )
  }
  return (
    node.kind === 'split' &&
    node.dir === 'col' &&
    typeof node.ratio === 'number' &&
    validNode(node.a) &&
    validNode(node.b)
  )
}

export function getRailSplitPref(): RailSplitNode {
  try {
    const raw = localStorage.getItem(key())
    if (!raw) return initialRailSplit()
    const parsed: unknown = JSON.parse(raw)
    if (!validNode(parsed)) return initialRailSplit()
    const repaired = ensureCompleteRailView(parsed)
    if (repaired !== parsed) setRailSplitPref(repaired)
    return repaired
  } catch {
    return initialRailSplit()
  }
}

export function setRailSplitPref(tree: RailSplitNode): void {
  try {
    localStorage.setItem(key(), JSON.stringify(tree))
  } catch {
    // Storage can be unavailable (privacy mode / quota); live state still works.
  }
}
