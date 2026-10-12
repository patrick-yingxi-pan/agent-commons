import type { OpenSubGoal } from '../types'

export interface CommissionTrackRecordSummary {
  /** Total completed items this Commission resolved on the current Project. */
  count: number
  lastAt: number
  realCount: number
  simulatedCount: number
}

/** Fold a project's work items into a per-commission resolved-work summary (surface-audit
 *  S8): for each commission that RESOLVED items here, how many, and when it last did.
 *  `resolvedBy` is the commission id; only `done` items with one count. Pure over the
 *  served items (no DOM, node-testable), so a standing Contributor's row can show its
 *  LOCAL track record — the acts it produced on THIS project — instead of the
 *  cross-project Award total that misreads as local output. */
export function resolvedByCommission(
  items: readonly OpenSubGoal[],
): Map<string, CommissionTrackRecordSummary> {
  const out = new Map<string, CommissionTrackRecordSummary>()
  for (const o of items) {
    if (o.status !== 'done' || !o.resolvedBy) continue
    const cur = out.get(o.resolvedBy) ?? { count: 0, lastAt: 0, realCount: 0, simulatedCount: 0 }
    cur.count += 1
    if (o.commissionResolution === 'mcp') cur.realCount += 1
    else cur.simulatedCount += 1
    cur.lastAt = Math.max(cur.lastAt, o.resolvedAt ?? 0)
    out.set(o.resolvedBy, cur)
  }
  return out
}

/** A done item without the server-derived MCP marker is historical fixture
 * provenance, even when it has a Commission resolver label. */
export function resolvedWorkKindLabel(item: Pick<OpenSubGoal,
  'status' | 'resolvedBy' | 'commissionResolution' | 'contributionResolution'>): string | undefined {
  if (item.status !== 'done') return undefined
  if (item.contributionResolution) return 'Owner contribution'
  if (!item.resolvedBy) return 'Completed'
  return item.commissionResolution === 'mcp' ? 'Real MCP' : 'Simulated'
}
