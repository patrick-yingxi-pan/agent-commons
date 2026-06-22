import type { Project } from '../types'
import { FilterMenu, type FilterRowSpec } from './FilterMenu'
import type { ActivityFilter, SessionFilter, SortBy, StatusFilter } from '../lib/sessionFilter'

/** ── Recents "Filter & sort" — the session-flavoured menu ─────────────────────
 *  A faithful take on the Claude desktop Code tab's session filter: Status /
 *  Project / Environment / Last activity / Group by / Sort by. It just maps the
 *  current SessionFilter into FilterMenu row specs; the popover/flyout mechanics
 *  live in FilterMenu. Environment is simplified to All / Local for now (TODO:
 *  Cloud / Remote Control), and State / PR status / Custom groups show as
 *  disabled stubs (no data model yet). */

const STATUS_OPTS: { id: StatusFilter; label: string }[] = [
  { id: 'active', label: 'Active' },
  { id: 'archived', label: 'Archived' },
  { id: 'all', label: 'All' },
]

const ACTIVITY_OPTS: { id: ActivityFilter; label: string }[] = [
  { id: '1d', label: '1d' },
  { id: '3d', label: '3d' },
  { id: '7d', label: '7d' },
  { id: '30d', label: '30d' },
]

const SORT_OPTS: { id: SortBy; label: string }[] = [
  { id: 'alpha', label: 'Alphabetically' },
  { id: 'created', label: 'Created time' },
  { id: 'recency', label: 'Recency' },
]

const STATUS_LABEL: Record<StatusFilter, string> = { active: 'Active', archived: 'Archived', all: 'All' }
const SORT_LABEL: Record<SortBy, string> = { recency: 'Recency', created: 'Created time', alpha: 'Alphabetically' }

export function SessionFilterMenu({
  filter,
  onChange,
  projects,
}: {
  filter: SessionFilter
  onChange: (next: SessionFilter) => void
  projects: Project[]
}) {
  const set = (patch: Partial<SessionFilter>) => onChange({ ...filter, ...patch })

  const rows: FilterRowSpec[] = [
    {
      key: 'status',
      label: 'Status',
      value: STATUS_LABEL[filter.status],
      accent: filter.status !== 'all',
      width: 150,
      options: STATUS_OPTS.map((o) => ({
        label: o.label,
        selected: filter.status === o.id,
        onSelect: () => set({ status: o.id }),
      })),
    },
    {
      key: 'project',
      label: 'Project',
      value:
        filter.projectId === 'all'
          ? 'All'
          : (projects.find((p) => p.id === filter.projectId)?.name ?? 'Unknown'),
      accent: filter.projectId !== 'all',
      width: 224,
      options: [
        { label: 'All projects', selected: filter.projectId === 'all', onSelect: () => set({ projectId: 'all' }) },
        ...projects.map((p) => ({
          label: p.name,
          selected: filter.projectId === p.id,
          onSelect: () => set({ projectId: p.id }),
        })),
      ],
    },
    {
      key: 'environment',
      label: 'Environment',
      value: filter.environment === 'all' ? 'All' : 'Local',
      accent: filter.environment !== 'all',
      width: 200,
      options: [
        { label: 'All environments', selected: filter.environment === 'all', onSelect: () => set({ environment: 'all' }) },
        { label: 'Local', selected: filter.environment === 'local', onSelect: () => set({ environment: 'local' }) },
        // TODO(env): add Cloud / Remote Control once those backends ship.
      ],
    },
    {
      key: 'activity',
      label: 'Last activity',
      value: filter.activity === 'all' ? 'All' : filter.activity,
      accent: filter.activity !== 'all',
      width: 140,
      options: [
        ...ACTIVITY_OPTS.map((o) => ({
          label: o.label,
          selected: filter.activity === o.id,
          onSelect: () => set({ activity: o.id }),
        })),
        { label: 'All', dividerBefore: true, selected: filter.activity === 'all', onSelect: () => set({ activity: 'all' }) },
      ],
    },
    {
      key: 'group',
      label: 'Group by',
      value: GROUP_LABEL(filter.groupBy),
      accent: filter.groupBy !== 'none',
      width: 200,
      dividerBefore: true,
      options: [
        { label: 'Date', selected: filter.groupBy === 'date', onSelect: () => set({ groupBy: 'date' }) },
        { label: 'Project', selected: filter.groupBy === 'project', onSelect: () => set({ groupBy: 'project' }) },
        { label: 'State', disabled: true }, // TODO: needs a per-session lifecycle state to group on.
        { label: 'PR status', disabled: true }, // TODO: needs PR status surfaced per repo-bearing session.
        { label: 'Environment', selected: filter.groupBy === 'environment', onSelect: () => set({ groupBy: 'environment' }) },
        { label: 'Custom groups', disabled: true }, // TODO: needs a user-defined custom-groups model.
        { label: 'None', dividerBefore: true, selected: filter.groupBy === 'none', onSelect: () => set({ groupBy: 'none' }) },
      ],
    },
    {
      key: 'sort',
      label: 'Sort by',
      value: SORT_LABEL[filter.sortBy],
      accent: filter.sortBy !== 'recency',
      width: 184,
      options: SORT_OPTS.map((o) => ({
        label: o.label,
        selected: filter.sortBy === o.id,
        onSelect: () => set({ sortBy: o.id }),
      })),
    },
  ]

  return <FilterMenu ariaLabel="Filter & sort sessions" rows={rows} />
}

function GROUP_LABEL(g: SessionFilter['groupBy']): string {
  return { none: 'None', date: 'Date', project: 'Project', environment: 'Environment' }[g]
}
