/** ── Focused split views for the account-resource rail (UI-39) ──────────────
 *
 * The rail and main workspace share the same binary split vocabulary. A rail
 * split is deliberately narrower: it is always vertical (`col`) and every
 * leaf projects the same complete resource forest. The persisted anchor locator
 * identifies the entry a restored view begins at; it never reparents that entry
 * or changes the resource ontology.
 */
import { closePane, pane, panes, splitPane, type SplitNode } from './splitFrame.ts'

export type RailPaneContent = {
  kind: 'rail-view'
  /** Stable identity keeps an existing view's scroll memory through tree edits. */
  id: string
  /** Index among `[data-rail-entry]` rows where this view begins on restore. */
  anchorIndex?: number
  /** Human-visible identity used when disclosure/capping changes the row index. */
  anchorLabel?: string
}

export type RailSplitNode = SplitNode<RailPaneContent>

export const initialRailSplit = (): RailSplitNode => pane({ kind: 'rail-view', id: 'rail-root' })

/** Split one rail view downward and put the selected entry at the top of the
 * new lower view. The existing view remains the first child, matching the main
 * workspace's focused-pane split rule. */
export function splitRailView(
  tree: RailSplitNode,
  path: string,
  anchorIndex: number,
  anchorLabel: string,
  id: string,
): RailSplitNode {
  return splitPane(tree, path, 'col', { kind: 'rail-view', id, anchorIndex, anchorLabel })
}

/** Delete one focused rail view. The last complete-forest view is retained so
 * navigation can never disappear from an open rail. */
export function closeRailView(tree: RailSplitNode, path: string): RailSplitNode {
  if (panes(tree).length <= 1) return tree
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
    return (
      !!content &&
      content.kind === 'rail-view' &&
      typeof content.id === 'string' &&
      (content.anchorIndex === undefined ||
        (typeof content.anchorIndex === 'number' && Number.isInteger(content.anchorIndex) && content.anchorIndex >= 0)) &&
      (content.anchorLabel === undefined || typeof content.anchorLabel === 'string')
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
    return validNode(parsed) ? parsed : initialRailSplit()
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
