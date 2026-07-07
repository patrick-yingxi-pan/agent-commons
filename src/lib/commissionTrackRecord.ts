import type { OpenSubGoal } from '../types'

/** Fold a project's work items into a per-commission resolved-work summary (surface-audit
 *  S8): for each commission that RESOLVED items here, how many, and when it last did.
 *  `resolvedBy` is the commission id; only `done` items with one count. Pure over the
 *  served items (no DOM, node-testable), so a standing Contributor's row can show its
 *  LOCAL track record — the acts it produced on THIS project — instead of the
 *  cross-project Award total that misreads as local output. */
export function resolvedByCommission(
  items: readonly OpenSubGoal[],
): Map<string, { count: number; lastAt: number }> {
  const out = new Map<string, { count: number; lastAt: number }>()
  for (const o of items) {
    if (o.status !== 'done' || !o.resolvedBy) continue
    const cur = out.get(o.resolvedBy) ?? { count: 0, lastAt: 0 }
    cur.count += 1
    cur.lastAt = Math.max(cur.lastAt, o.resolvedAt ?? 0)
    out.set(o.resolvedBy, cur)
  }
  return out
}
