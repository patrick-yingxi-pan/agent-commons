/** ── Sessions filter / sort / group — the pure model behind both projections'
 *  "Filter & sort" menu (mirrors the Claude desktop app's Code tab). No React:
 *  just the option vocabulary, the persisted preference blob, and one function
 *  that turns a session list + a filter into ordered, optionally-grouped rows.
 *  The menu component renders these; the Sidebar applies the result. */
import type { Session } from '../types'

export type StatusFilter = 'active' | 'archived' | 'all'
/** Only `local` is wired today. TODO(env): add 'cloud' | 'remote' when those
 *  backends exist (the seed sets every session to `local`). */
export type EnvFilter = 'all' | 'local'
export type ActivityFilter = 'all' | '1d' | '3d' | '7d' | '30d'
/** The groupings the prototype can actually back. The menu also *shows* State /
 *  PR status / Custom groups, but those are disabled stubs (no data model yet). */
export type GroupBy = 'none' | 'date' | 'project' | 'environment'
export type SortBy = 'recency' | 'created' | 'alpha'

export interface SessionFilter {
  status: StatusFilter
  /** A project id, or 'all'. */
  projectId: string
  environment: EnvFilter
  activity: ActivityFilter
  groupBy: GroupBy
  sortBy: SortBy
}

/** The neutral defaults from the screenshots: Active status (so archived hide),
 *  everything else wide-open, no grouping, recency sort. */
export const DEFAULT_SESSION_FILTER: SessionFilter = {
  status: 'active',
  projectId: 'all',
  environment: 'all',
  activity: 'all',
  groupBy: 'none',
  sortBy: 'recency',
}

// ── Persistence ─────────────────────────────────────────────────────────────
// Its own small localStorage blob, separate from layout prefs (uiPrefs.ts) since
// the values are string enums, not numbers/booleans.
const KEY = 'claude-ui.recents-filter.v1'

function readSessionFilter(): SessionFilter {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return DEFAULT_SESSION_FILTER
    // Merge over the defaults so a stored blob from an older shape stays valid.
    return { ...DEFAULT_SESSION_FILTER, ...(JSON.parse(raw) as Partial<SessionFilter>) }
  } catch {
    return DEFAULT_SESSION_FILTER
  }
}

let currentFilter: SessionFilter | null = null
const filterListeners = new Set<() => void>()

/** Stable external-store snapshot shared by the Sessions rail branch and page. */
export function sessionFilterSnapshot(): SessionFilter {
  return (currentFilter ??= readSessionFilter())
}

/** Back-compatible read name for existing non-React callers and tests. */
export function loadSessionFilter(): SessionFilter {
  return sessionFilterSnapshot()
}

export function subscribeSessionFilter(listener: () => void): () => void {
  filterListeners.add(listener)
  return () => filterListeners.delete(listener)
}

export function saveSessionFilter(f: SessionFilter) {
  currentFilter = { ...f }
  try {
    localStorage.setItem(KEY, JSON.stringify(f))
  } catch {
    /* ignore quota / privacy-mode errors */
  }
  for (const listener of [...filterListeners]) listener()
}

/** Clamp a persisted filter at RENDER, never in storage (the layout-height rule).
 *  The blob persists under one browser-wide key while `projectId` names a
 *  tenant-scoped entity — after an account switch the stored id resolves to
 *  nothing in the new world and would silently filter EVERY row out (the menu
 *  labelling it "Unknown"). A dangling id reads as 'all'; the stored choice
 *  survives untouched, so switching back restores it. */
export function clampSessionFilter(f: SessionFilter, validProjectIds: ReadonlySet<string>): SessionFilter {
  return f.projectId === 'all' || validProjectIds.has(f.projectId) ? f : { ...f, projectId: 'all' }
}

// ── The filter / sort / group pipeline ───────────────────────────────────────
const DAY = 86_400_000
const ACTIVITY_DAYS: Record<Exclude<ActivityFilter, 'all'>, number> = {
  '1d': 1,
  '3d': 3,
  '7d': 7,
  '30d': 30,
}

const ENV_LABEL: Record<string, string> = { local: 'Local', cloud: 'Cloud', remote: 'Remote Control' }
const ENV_ORDER: Record<string, number> = { local: 0, cloud: 1, remote: 2 }

/** One rendered section of the Sessions list. For `groupBy: 'none'` there is a
 *  single group with an empty label (the Sidebar draws it header-less). */
export interface SessionGroup {
  key: string
  label: string
  sessions: Session[]
}

/** What the pure function needs from the relationship graph / clock — passed in
 *  so this module stays React- and data-source-free. */
export interface FilterContext {
  /** The project a session belongs to (or null), from the relations graph. */
  projectIdOf: (sessionId: string) => string | null
  /** Display name for a project id. */
  projectName: (projectId: string) => string
  /** Current epoch ms — the reference point for the "Last activity" window. */
  now: number
}

/** Apply a filter to a session list: narrow → sort → group. Always returns
 *  groups (so the caller has one render path) plus the post-filter `total`. */
export function filterSessions(
  sessions: Session[],
  f: SessionFilter,
  ctx: FilterContext,
): { groups: SessionGroup[]; total: number } {
  const statusOf = (s: Session) => s.status ?? 'active'
  const envOf = (s: Session) => s.environment ?? 'local'

  const cutoff = f.activity === 'all' ? 0 : ctx.now - ACTIVITY_DAYS[f.activity] * DAY

  const rows = sessions.filter((s) => {
    if (f.status !== 'all' && statusOf(s) !== f.status) return false
    if (f.projectId !== 'all' && ctx.projectIdOf(s.id) !== f.projectId) return false
    if (f.environment !== 'all' && envOf(s) !== f.environment) return false
    if (f.activity !== 'all' && (s.updatedAt ?? 0) < cutoff) return false
    return true
  })

  sortRows(rows, f.sortBy)
  return { groups: groupRows(rows, f.groupBy, ctx), total: rows.length }
}

function sortRows(rows: Session[], by: SortBy) {
  // Pinned sessions float to the top regardless of the chosen sort (and, when
  // grouped, to the top of each bucket — the order is preserved per group).
  const pin = (s: Session) => (s.pinned ? 0 : 1)
  const cmp =
    by === 'alpha'
      ? (a: Session, b: Session) => a.title.localeCompare(b.title)
      : by === 'created'
        ? (a: Session, b: Session) => (b.createdAt ?? 0) - (a.createdAt ?? 0)
        : (a: Session, b: Session) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0)
  rows.sort((a, b) => pin(a) - pin(b) || cmp(a, b))
}

/** Calendar-relative bucket for the "Date" grouping. `order` fixes the section
 *  sequence (newest first); the label is what the header shows. */
function dateBucket(updatedAt: number | undefined, now: number): { key: string; label: string; order: number } {
  // Boundaries are CALENDAR days, not fixed 24h subtractions: a DST transition day
  // spans 23 or 25 hours, so `startOfToday − N*24h` lands at the wrong wall-clock
  // moment (a session from yesterday 00:30 fell into "Previous 7 days" the day
  // after fall-back). Step back N calendar days, then to local midnight.
  const startNDaysAgo = (n: number): number => {
    const d = new Date(now)
    d.setHours(0, 0, 0, 0)
    d.setDate(d.getDate() - n)
    return d.getTime()
  }
  const ms = updatedAt ?? 0
  if (ms >= startNDaysAgo(0)) return { key: 'today', label: 'Today', order: 0 }
  if (ms >= startNDaysAgo(1)) return { key: 'yesterday', label: 'Yesterday', order: 1 }
  if (ms >= startNDaysAgo(7)) return { key: 'week', label: 'Previous 7 days', order: 2 }
  if (ms >= startNDaysAgo(30)) return { key: 'month', label: 'Previous 30 days', order: 3 }
  return { key: 'older', label: 'Older', order: 4 }
}

function groupRows(rows: Session[], by: GroupBy, ctx: FilterContext): SessionGroup[] {
  if (by === 'none') return [{ key: 'all', label: '', sessions: rows }]

  // Preserve the (already-sorted) row order inside each bucket; order the buckets
  // themselves by a per-grouping rank, then label.
  const buckets = new Map<string, { label: string; order: number; sessions: Session[] }>()
  const push = (key: string, label: string, order: number, s: Session) => {
    const b = buckets.get(key)
    if (b) b.sessions.push(s)
    else buckets.set(key, { label, order, sessions: [s] })
  }

  for (const s of rows) {
    if (by === 'date') {
      const { key, label, order } = dateBucket(s.updatedAt, ctx.now)
      push(key, label, order, s)
    } else if (by === 'project') {
      const pid = ctx.projectIdOf(s.id)
      if (pid) push(pid, ctx.projectName(pid), 0, s)
      else push('__none', 'No project', 1, s)
    } else {
      const env = s.environment ?? 'local'
      push(env, ENV_LABEL[env] ?? env, ENV_ORDER[env] ?? 9, s)
    }
  }

  return [...buckets.entries()]
    .map(([key, b]) => ({ key, label: b.label, order: b.order, sessions: b.sessions }))
    .sort((a, b) => a.order - b.order || a.label.localeCompare(b.label))
    .map(({ key, label, sessions }) => ({ key, label, sessions }))
}
