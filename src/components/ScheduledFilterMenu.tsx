import type { Project } from '../types'
import { FilterMenu, type FilterRowSpec } from './FilterMenu'
import type { OutcomeFilter, RunActivityFilter, RunFilter, RunSortBy } from '../lib/runFilter'

/** ── Scheduled "Filter & sort" — the run-flavoured menu ───────────────────────
 *  The same control as Recents, retuned for the recent-runs feed: the session
 *  filter's Status becomes run Outcome (All / Succeeded / Failed / Skipped), and
 *  Group by offers Date / Project / Outcome. There's no Environment row (every
 *  run is local) and no Created-time sort (a run's only time is when it ran). */

const OUTCOME_OPTS: { id: OutcomeFilter; label: string }[] = [
  { id: 'all', label: 'All outcomes' },
  { id: 'ok', label: 'Succeeded' },
  { id: 'failed', label: 'Failed' },
  { id: 'skipped', label: 'Skipped' },
]

const ACTIVITY_OPTS: { id: RunActivityFilter; label: string }[] = [
  { id: '1d', label: '1d' },
  { id: '3d', label: '3d' },
  { id: '7d', label: '7d' },
  { id: '30d', label: '30d' },
]

const SORT_OPTS: { id: RunSortBy; label: string }[] = [
  { id: 'alpha', label: 'Alphabetically' },
  { id: 'recency', label: 'Recency' },
]

const OUTCOME_VALUE: Record<OutcomeFilter, string> = {
  all: 'All',
  ok: 'Succeeded',
  failed: 'Failed',
  skipped: 'Skipped',
}

export function ScheduledFilterMenu({
  filter,
  onChange,
  projects,
}: {
  filter: RunFilter
  onChange: (next: RunFilter) => void
  projects: Project[]
}) {
  const set = (patch: Partial<RunFilter>) => onChange({ ...filter, ...patch })

  const rows: FilterRowSpec[] = [
    {
      key: 'outcome',
      label: 'Outcome',
      value: OUTCOME_VALUE[filter.outcome],
      accent: filter.outcome !== 'all',
      width: 170,
      options: OUTCOME_OPTS.map((o) => ({
        label: o.label,
        selected: filter.outcome === o.id,
        onSelect: () => set({ outcome: o.id }),
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
      width: 184,
      dividerBefore: true,
      options: [
        { label: 'Date', selected: filter.groupBy === 'date', onSelect: () => set({ groupBy: 'date' }) },
        { label: 'Project', selected: filter.groupBy === 'project', onSelect: () => set({ groupBy: 'project' }) },
        { label: 'Outcome', selected: filter.groupBy === 'outcome', onSelect: () => set({ groupBy: 'outcome' }) },
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

  return <FilterMenu ariaLabel="Filter & sort scheduled runs" rows={rows} />
}

function GROUP_LABEL(g: RunFilter['groupBy']): string {
  return { none: 'None', date: 'Date', project: 'Project', outcome: 'Outcome' }[g]
}
