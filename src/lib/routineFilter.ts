/** ── Scheduled-routines filter / sort / group — the model behind the left
 *  rail's "Filter & sort" menu. The rail now lists *routines* (each entry is a
 *  recurring workflow, not one run of it), so this is the routine-flavoured
 *  sibling of sessionFilter.ts: the session filter's "Status" becomes routine
 *  Active/Paused, and a routine's "recency" is its freshest run. No React here —
 *  just the option vocabulary, the persisted blob, and the pipeline. */
import type { ScheduledTask } from '../types'

export type RoutineStatusFilter = 'all' | 'active' | 'paused'
export type RoutineGroupBy = 'none' | 'project' | 'status'
export type RoutineSortBy = 'recency' | 'alpha'

export interface RoutineFilter {
  status: RoutineStatusFilter
  /** A project id, or 'all'. */
  projectId: string
  groupBy: RoutineGroupBy
  sortBy: RoutineSortBy
}

/** Neutral defaults: every routine, no grouping, freshest-run-first. */
export const DEFAULT_ROUTINE_FILTER: RoutineFilter = {
  status: 'all',
  projectId: 'all',
  groupBy: 'none',
  sortBy: 'recency',
}

// ── Persistence ──────────────────────────────────────────────────────────────
// `.v2` — the rail switched from a per-run feed to a per-routine one, so a stale
// v1 run-filter blob (outcome / activity / date-group) must not poison this.
const KEY = 'claude-ui.scheduled-filter.v2'

export function loadRoutineFilter(): RoutineFilter {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return DEFAULT_ROUTINE_FILTER
    return { ...DEFAULT_ROUTINE_FILTER, ...(JSON.parse(raw) as Partial<RoutineFilter>) }
  } catch {
    return DEFAULT_ROUTINE_FILTER
  }
}

export function saveRoutineFilter(f: RoutineFilter) {
  try {
    localStorage.setItem(KEY, JSON.stringify(f))
  } catch {
    /* ignore quota / privacy-mode errors */
  }
}

// ── The filter / sort / group pipeline ───────────────────────────────────────
const STATUS_LABEL: Record<string, string> = { active: 'Active', paused: 'Paused' }
const STATUS_ORDER: Record<string, number> = { active: 0, paused: 1 }

export interface RoutineGroup {
  key: string
  label: string
  tasks: ScheduledTask[]
}

export interface RoutineFilterContext {
  /** The project a routine belongs to (or null), from the relations graph. */
  projectIdOfTask: (taskId: string) => string | null
  projectName: (projectId: string) => string
}

/** Resolve a routine's project: the relations-graph mapping, falling back to the
 *  routine's seed `projectId`. */
function projectOf(task: ScheduledTask, ctx: RoutineFilterContext): string | null {
  return ctx.projectIdOfTask(task.id) ?? task.projectId ?? null
}

/** A routine's recency = its freshest run's timestamp (`at`, absolute epoch-ms,
 *  larger = newer). Routines that have never run sort last (−∞, below any real
 *  run under the descending recency sort below). */
function freshestAt(task: ScheduledTask): number {
  return task.runs[0]?.at ?? Number.NEGATIVE_INFINITY
}

/** Apply a filter to a routine list: narrow → sort → group. Always returns
 *  groups (one render path) plus the post-filter `total`. */
export function filterRoutines(
  tasks: ScheduledTask[],
  f: RoutineFilter,
  ctx: RoutineFilterContext,
): { groups: RoutineGroup[]; total: number } {
  const rows = tasks.filter((t) => {
    if (f.status === 'active' && !t.enabled) return false
    if (f.status === 'paused' && t.enabled) return false
    if (f.projectId !== 'all' && projectOf(t, ctx) !== f.projectId) return false
    return true
  })

  if (f.sortBy === 'alpha') rows.sort((a, b) => a.name.localeCompare(b.name))
  else rows.sort((a, b) => freshestAt(b) - freshestAt(a))

  return { groups: groupRows(rows, f.groupBy, ctx), total: rows.length }
}

function groupRows(rows: ScheduledTask[], by: RoutineGroupBy, ctx: RoutineFilterContext): RoutineGroup[] {
  if (by === 'none') return [{ key: 'all', label: '', tasks: rows }]

  const buckets = new Map<string, { label: string; order: number; tasks: ScheduledTask[] }>()
  const push = (key: string, label: string, order: number, t: ScheduledTask) => {
    const b = buckets.get(key)
    if (b) b.tasks.push(t)
    else buckets.set(key, { label, order, tasks: [t] })
  }

  for (const t of rows) {
    if (by === 'project') {
      const pid = projectOf(t, ctx)
      if (pid) push(pid, ctx.projectName(pid), 0, t)
      else push('__none', 'No project', 1, t)
    } else {
      const key = t.enabled ? 'active' : 'paused'
      push(key, STATUS_LABEL[key], STATUS_ORDER[key], t)
    }
  }

  return [...buckets.entries()]
    .map(([key, b]) => ({ key, label: b.label, order: b.order, tasks: b.tasks }))
    .sort((a, b) => a.order - b.order || a.label.localeCompare(b.label))
    .map(({ key, label, tasks }) => ({ key, label, tasks }))
}
