import type { Project } from '../types'
import { FilterMenu, type FilterRowSpec } from './FilterMenu'
import type { RoutineFilter, RoutineSortBy, RoutineStatusFilter } from '../lib/routineFilter'

/** ── Scheduled "Filter & sort" — the routine-flavoured menu ───────────────────
 *  The same control as Recents, retuned for the rail's routine list: the session
 *  filter's Status becomes Active / Paused, Project carries over, and Group by
 *  offers Project / Status. There's no Environment, Outcome, or Last-activity row
 *  (those were run concepts) and no Created-time sort. */

const STATUS_OPTS: { id: RoutineStatusFilter; label: string }[] = [
  { id: 'all', label: 'All routines' },
  { id: 'active', label: 'Active' },
  { id: 'paused', label: 'Paused' },
]

const SORT_OPTS: { id: RoutineSortBy; label: string }[] = [
  { id: 'alpha', label: 'Alphabetically' },
  { id: 'recency', label: 'Recency' },
]

const STATUS_VALUE: Record<RoutineStatusFilter, string> = {
  all: 'All',
  active: 'Active',
  paused: 'Paused',
}

export function ScheduledFilterMenu({
  filter,
  onChange,
  projects,
}: {
  filter: RoutineFilter
  onChange: (next: RoutineFilter) => void
  projects: Project[]
}) {
  const set = (patch: Partial<RoutineFilter>) => onChange({ ...filter, ...patch })

  const rows: FilterRowSpec[] = [
    {
      key: 'status',
      label: 'Status',
      value: STATUS_VALUE[filter.status],
      accent: filter.status !== 'all',
      width: 170,
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
      key: 'group',
      label: 'Group by',
      value: GROUP_LABEL(filter.groupBy),
      accent: filter.groupBy !== 'none',
      width: 184,
      dividerBefore: true,
      options: [
        { label: 'Project', selected: filter.groupBy === 'project', onSelect: () => set({ groupBy: 'project' }) },
        { label: 'Status', selected: filter.groupBy === 'status', onSelect: () => set({ groupBy: 'status' }) },
        { label: 'None', dividerBefore: true, selected: filter.groupBy === 'none', onSelect: () => set({ groupBy: 'none' }) },
      ],
    },
    {
      key: 'sort',
      label: 'Sort by',
      value: filter.sortBy === 'recency' ? 'Recency' : 'Alphabetically',
      accent: filter.sortBy !== 'recency',
      width: 184,
      options: SORT_OPTS.map((o) => ({
        label: o.label,
        selected: filter.sortBy === o.id,
        onSelect: () => set({ sortBy: o.id }),
      })),
    },
  ]

  return <FilterMenu ariaLabel="Filter & sort scheduled routines" rows={rows} />
}

function GROUP_LABEL(g: RoutineFilter['groupBy']): string {
  return { none: 'None', project: 'Project', status: 'Status' }[g]
}
