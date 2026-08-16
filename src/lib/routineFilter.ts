/** ── Scheduled-routines filter / sort / group ────────────────────────────────
 *  Routines is a normal instance branch in the account-resource tree. Its
 *  rail rows and main page therefore read this same live, per-account choice:
 *  the session filter's "Status" becomes routine Active/Paused, and a
 *  routine's "recency" is its freshest run. No React here — just the option
 *  vocabulary, persistence, stable snapshot, and pipeline. */
import type { ScheduledTask } from '../types'
import { getLayout, setLayout, subscribeLayout, uiPrefScope } from './uiPrefs.ts'

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

/** Neutral defaults: every routine in one resource list, freshest-run-first.
 * Status is mutable metadata, not a structural level in the resource tree;
 * people can still opt into status or project grouping from the shared menu. */
export const DEFAULT_ROUTINE_FILTER: RoutineFilter = {
  status: 'all',
  projectId: 'all',
  groupBy: 'none',
  sortBy: 'recency',
}

// ── Persistence ──────────────────────────────────────────────────────────────
// One JSON string inside uiPrefs: this standing view choice follows the active
// account, whichever projection changes it. The suffix retires the former browser-
// wide localStorage blob owned by the separate Scheduled pane.
const KEY = 'scheduledFilter.v4'
const LEGACY_KEY = 'scheduledFilter.v3'

export function loadRoutineFilter(): RoutineFilter {
  try {
    const raw = getLayout(KEY, '')
    if (raw) return { ...DEFAULT_ROUTINE_FILTER, ...(JSON.parse(raw) as Partial<RoutineFilter>) }

    // v3 made status grouping the neutral default. Preserve any real status,
    // project, sort, or project-group choices while retiring that implicit
    // Active/Paused hierarchy; an explicit v4 choice can select it again.
    const legacyRaw = getLayout(LEGACY_KEY, '')
    if (!legacyRaw) return DEFAULT_ROUTINE_FILTER
    const legacy = { ...DEFAULT_ROUTINE_FILTER, ...(JSON.parse(legacyRaw) as Partial<RoutineFilter>) }
    return { ...legacy, groupBy: legacy.groupBy === 'status' ? 'none' : legacy.groupBy }
  } catch {
    return DEFAULT_ROUTINE_FILTER
  }
}

export function saveRoutineFilter(f: RoutineFilter) {
  setLayout(KEY, JSON.stringify(f))
}

let memo: RoutineFilter | null = null
let memoScope: string | null = uiPrefScope()

subscribeLayout(() => {
  memo = null
})

/** Stable live snapshot for useSyncExternalStore. Account scope is part of its
 *  identity because scope switches are intentionally silent during render. */
export function routineFilterSnapshot(): RoutineFilter {
  const scope = uiPrefScope()
  if (scope !== memoScope) {
    memoScope = scope
    memo = null
  }
  if (memo) return memo
  memo = loadRoutineFilter()
  return memo
}

export function isRoutineFilterActive(filter: RoutineFilter): boolean {
  return (
    filter.status !== DEFAULT_ROUTINE_FILTER.status ||
    filter.projectId !== DEFAULT_ROUTINE_FILTER.projectId ||
    filter.groupBy !== DEFAULT_ROUTINE_FILTER.groupBy ||
    filter.sortBy !== DEFAULT_ROUTINE_FILTER.sortBy
  )
}

/** Clamp a persisted filter at RENDER, never in storage — the sessionFilter rule:
 *  a stored projectId from another account's world (the blob is browser-wide,
 *  the entity tenant-scoped) must not filter every routine out; it reads as
 *  'all' until the owning account returns. */
export function clampRoutineFilter(f: RoutineFilter, validProjectIds: ReadonlySet<string>): RoutineFilter {
  return f.projectId === 'all' || validProjectIds.has(f.projectId) ? f : { ...f, projectId: 'all' }
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
