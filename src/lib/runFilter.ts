/** ── Scheduled-runs filter / sort / group — the model behind the Scheduled
 *  feed's "Filter & sort" menu. The sibling of sessionFilter.ts, but for the
 *  left rail's recent-runs list: each entry is a *run* (with an outcome and a
 *  minutes-ago timestamp), tied to a routine that may live in a project. The
 *  session filter's "Status" becomes run "Outcome" here; everything else
 *  (Project / Last activity / Group by / Sort by) carries over. */
import type { RunSessionEntry } from '../types'

/** Run outcome — the analog of the session filter's Status. `ScheduledRun.status`
 *  also has 'running'; there's no explicit option for it, so in-flight runs show
 *  only under "All". */
export type OutcomeFilter = 'all' | 'ok' | 'failed' | 'skipped'
export type RunActivityFilter = 'all' | '1d' | '3d' | '7d' | '30d'
export type RunGroupBy = 'none' | 'date' | 'project' | 'outcome'
export type RunSortBy = 'recency' | 'alpha'

export interface RunFilter {
  outcome: OutcomeFilter
  /** A project id, or 'all'. */
  projectId: string
  activity: RunActivityFilter
  groupBy: RunGroupBy
  sortBy: RunSortBy
}

export const DEFAULT_RUN_FILTER: RunFilter = {
  outcome: 'all',
  projectId: 'all',
  activity: 'all',
  groupBy: 'none',
  sortBy: 'recency',
}

// ── Persistence (its own blob, separate from the session filter's) ───────────
const KEY = 'claude-ui.scheduled-filter.v1'

export function loadRunFilter(): RunFilter {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return DEFAULT_RUN_FILTER
    return { ...DEFAULT_RUN_FILTER, ...(JSON.parse(raw) as Partial<RunFilter>) }
  } catch {
    return DEFAULT_RUN_FILTER
  }
}

export function saveRunFilter(f: RunFilter) {
  try {
    localStorage.setItem(KEY, JSON.stringify(f))
  } catch {
    /* ignore quota / privacy-mode errors */
  }
}

// ── The filter / sort / group pipeline ───────────────────────────────────────
const DAY = 86_400_000
const MINUTE = 60_000
const ACTIVITY_DAYS: Record<Exclude<RunActivityFilter, 'all'>, number> = { '1d': 1, '3d': 3, '7d': 7, '30d': 30 }

/** `run.at` is minutes-ago (smaller = more recent); convert to an absolute epoch. */
const atMs = (entry: RunSessionEntry, now: number) => now - entry.run.at * MINUTE

const OUTCOME_LABEL: Record<string, string> = { ok: 'Succeeded', failed: 'Failed', skipped: 'Skipped', running: 'Running' }
// Group ordering: what needs attention first, successes, then no-ops.
const OUTCOME_ORDER: Record<string, number> = { failed: 0, running: 1, ok: 2, skipped: 3 }

export interface RunGroup {
  key: string
  label: string
  entries: RunSessionEntry[]
}

export interface RunFilterContext {
  /** The project a routine belongs to (or null), from the relations graph. */
  projectIdOfTask: (taskId: string) => string | null
  projectName: (projectId: string) => string
  /** Current epoch ms — the reference point for "Last activity" + Date grouping. */
  now: number
}

/** Resolve a run entry's project: the relations-graph mapping, falling back to
 *  the routine's seed `projectId`. */
function projectOf(entry: RunSessionEntry, ctx: RunFilterContext): string | null {
  return ctx.projectIdOfTask(entry.task.id) ?? entry.task.projectId ?? null
}

export function filterRuns(
  entries: RunSessionEntry[],
  f: RunFilter,
  ctx: RunFilterContext,
): { groups: RunGroup[]; total: number } {
  const cutoff = f.activity === 'all' ? 0 : ctx.now - ACTIVITY_DAYS[f.activity] * DAY

  const rows = entries.filter((e) => {
    if (f.outcome !== 'all' && e.run.status !== f.outcome) return false
    if (f.projectId !== 'all' && projectOf(e, ctx) !== f.projectId) return false
    if (f.activity !== 'all' && atMs(e, ctx.now) < cutoff) return false
    return true
  })

  // Recency = smaller `at` first; Alphabetically = by routine name.
  if (f.sortBy === 'alpha') rows.sort((a, b) => a.task.name.localeCompare(b.task.name))
  else rows.sort((a, b) => a.run.at - b.run.at)

  return { groups: groupRows(rows, f.groupBy, ctx), total: rows.length }
}

function dateBucket(ms: number, now: number): { key: string; label: string; order: number } {
  const startOfToday = new Date(now).setHours(0, 0, 0, 0)
  if (ms >= startOfToday) return { key: 'today', label: 'Today', order: 0 }
  if (ms >= startOfToday - DAY) return { key: 'yesterday', label: 'Yesterday', order: 1 }
  if (ms >= startOfToday - 7 * DAY) return { key: 'week', label: 'Previous 7 days', order: 2 }
  if (ms >= startOfToday - 30 * DAY) return { key: 'month', label: 'Previous 30 days', order: 3 }
  return { key: 'older', label: 'Older', order: 4 }
}

function groupRows(rows: RunSessionEntry[], by: RunGroupBy, ctx: RunFilterContext): RunGroup[] {
  if (by === 'none') return [{ key: 'all', label: '', entries: rows }]

  const buckets = new Map<string, { label: string; order: number; entries: RunSessionEntry[] }>()
  const push = (key: string, label: string, order: number, e: RunSessionEntry) => {
    const b = buckets.get(key)
    if (b) b.entries.push(e)
    else buckets.set(key, { label, order, entries: [e] })
  }

  for (const e of rows) {
    if (by === 'date') {
      const { key, label, order } = dateBucket(atMs(e, ctx.now), ctx.now)
      push(key, label, order, e)
    } else if (by === 'project') {
      const pid = projectOf(e, ctx)
      if (pid) push(pid, ctx.projectName(pid), 0, e)
      else push('__none', 'No project', 1, e)
    } else {
      const s = e.run.status
      push(s, OUTCOME_LABEL[s] ?? s, OUTCOME_ORDER[s] ?? 9, e)
    }
  }

  return [...buckets.entries()]
    .map(([key, b]) => ({ key, label: b.label, order: b.order, entries: b.entries }))
    .sort((a, b) => a.order - b.order || a.label.localeCompare(b.label))
    .map(({ key, label, entries }) => ({ key, label, entries }))
}
