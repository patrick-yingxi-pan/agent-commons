import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Check, ChevronRight, SlidersHorizontal } from 'lucide-react'
import type { Project } from '../types'
import { FlyoutPanel, useFlyout } from './RecentOverflowList'
import type {
  ActivityFilter,
  EnvFilter,
  GroupBy,
  SessionFilter,
  SortBy,
  StatusFilter,
} from '../lib/sessionFilter'

/** ── Recents "Filter & sort" menu — the sliders button + its popover ──────────
 *  A faithful take on the Claude desktop Code tab's session filter: one popover
 *  with six rows (Status / Project / Environment / Last activity / Group by /
 *  Sort by), each opening a submenu to the right. The popover and its submenus
 *  are portaled to <body> so the sidebar's scroll container can't clip them
 *  (same reason RecentOverflowList portals its flyout). Selecting an option
 *  keeps the menu open so several dimensions can be set in one pass; an outside
 *  click or Escape dismisses it.
 *
 *  The row value reads accent-toned when that dimension is *narrowing / changing*
 *  the list and muted when it sits at its neutral default — mirroring the app's
 *  blue/grey cue, here in the prototype's accent (coral). */

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
const ENV_LABEL: Record<EnvFilter, string> = { all: 'All', local: 'Local' }
const GROUP_LABEL: Record<GroupBy, string> = {
  none: 'None',
  date: 'Date',
  project: 'Project',
  environment: 'Environment',
}
const SORT_LABEL: Record<SortBy, string> = {
  recency: 'Recency',
  created: 'Created time',
  alpha: 'Alphabetically',
}

const POPOVER_WIDTH = 244
// Approximate rendered height (6 rows + a divider + padding); used only to decide
// whether to open the menu below or above the trigger.
const POPOVER_EST_HEIGHT = 220

export function SessionFilterMenu({
  filter,
  onChange,
  projects,
}: {
  filter: SessionFilter
  onChange: (next: SessionFilter) => void
  projects: Project[]
}) {
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)

  const set = (patch: Partial<SessionFilter>) => onChange({ ...filter, ...patch })

  // Anchor the popover to the sliders button: right edge aligned to the button
  // (so it opens leftward into the rail), and below it — but flipped above when
  // there isn't room below (the Recents header sits low under the Scheduled
  // feed), so the menu never runs off the viewport bottom.
  useLayoutEffect(() => {
    if (!open || !triggerRef.current) return
    const r = triggerRef.current.getBoundingClientRect()
    const M = 8
    const left = Math.max(M, Math.min(r.right - POPOVER_WIDTH, window.innerWidth - POPOVER_WIDTH - M))
    const roomBelow = window.innerHeight - r.bottom
    const top =
      roomBelow >= POPOVER_EST_HEIGHT + M ? r.bottom + 6 : Math.max(M, r.top - POPOVER_EST_HEIGHT - 6)
    setPos({ left, top })
  }, [open])

  // Dismiss on outside click / Escape. The popover panel and the submenu flyouts
  // each stop their own mousedown, so this fires only for genuine outside clicks;
  // clicks on the trigger are ignored here and handled by its onClick toggle.
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (triggerRef.current?.contains(e.target as Node)) return
      setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const projectValue =
    filter.projectId === 'all'
      ? 'All'
      : (projects.find((p) => p.id === filter.projectId)?.name ?? 'Unknown')

  return (
    <>
      <button
        ref={triggerRef}
        onClick={() => setOpen((o) => !o)}
        title="Filter & sort"
        aria-label="Filter & sort sessions"
        aria-haspopup="menu"
        aria-expanded={open}
        data-open={open}
        className="flex h-5 w-5 items-center justify-center rounded text-ink-faint transition hover:bg-surface/70 hover:text-ink-soft data-[open=true]:bg-surface data-[open=true]:text-ink"
      >
        <SlidersHorizontal size={14} />
      </button>

      {open &&
        pos &&
        createPortal(
          <div
            role="menu"
            aria-label="Filter & sort sessions"
            onMouseDown={(e) => e.stopPropagation()}
            style={{ position: 'fixed', left: pos.left, top: pos.top, width: POPOVER_WIDTH }}
            className="z-[60] rounded-xl border border-line-strong bg-surface p-1 text-[13px] shadow-xl"
          >
            <FilterRow label="Status" value={STATUS_LABEL[filter.status]} accent={filter.status !== 'all'} width={150}>
              {STATUS_OPTS.map((o) => (
                <Opt key={o.id} label={o.label} selected={filter.status === o.id} onSelect={() => set({ status: o.id })} />
              ))}
            </FilterRow>

            <FilterRow label="Project" value={projectValue} accent={filter.projectId !== 'all'} width={224}>
              <Opt label="All projects" selected={filter.projectId === 'all'} onSelect={() => set({ projectId: 'all' })} />
              {projects.map((p) => (
                <Opt
                  key={p.id}
                  label={p.name}
                  selected={filter.projectId === p.id}
                  onSelect={() => set({ projectId: p.id })}
                />
              ))}
            </FilterRow>

            <FilterRow label="Environment" value={ENV_LABEL[filter.environment]} accent={filter.environment !== 'all'} width={200}>
              <Opt label="All environments" selected={filter.environment === 'all'} onSelect={() => set({ environment: 'all' })} />
              <Opt label="Local" selected={filter.environment === 'local'} onSelect={() => set({ environment: 'local' })} />
              {/* TODO(env): add Cloud / Remote Control once those backends ship. */}
            </FilterRow>

            <FilterRow
              label="Last activity"
              value={filter.activity === 'all' ? 'All' : filter.activity}
              accent={filter.activity !== 'all'}
              width={140}
            >
              {ACTIVITY_OPTS.map((o) => (
                <Opt
                  key={o.id}
                  label={o.label}
                  selected={filter.activity === o.id}
                  onSelect={() => set({ activity: o.id })}
                />
              ))}
              <Divider />
              <Opt label="All" selected={filter.activity === 'all'} onSelect={() => set({ activity: 'all' })} />
            </FilterRow>

            <Divider />

            <FilterRow label="Group by" value={GROUP_LABEL[filter.groupBy]} accent={filter.groupBy !== 'none'} width={200}>
              <Opt label="Date" selected={filter.groupBy === 'date'} onSelect={() => set({ groupBy: 'date' })} />
              <Opt label="Project" selected={filter.groupBy === 'project'} onSelect={() => set({ groupBy: 'project' })} />
              {/* TODO: needs a per-session lifecycle state to group on. */}
              <Opt label="State" disabled />
              {/* TODO: needs PR status surfaced per repo-bearing session. */}
              <Opt label="PR status" disabled />
              <Opt label="Environment" selected={filter.groupBy === 'environment'} onSelect={() => set({ groupBy: 'environment' })} />
              {/* TODO: needs a user-defined custom-groups model. */}
              <Opt label="Custom groups" disabled />
              <Divider />
              <Opt label="None" selected={filter.groupBy === 'none'} onSelect={() => set({ groupBy: 'none' })} />
            </FilterRow>

            <FilterRow label="Sort by" value={SORT_LABEL[filter.sortBy]} accent={filter.sortBy !== 'recency'} width={184}>
              {SORT_OPTS.map((o) => (
                <Opt key={o.id} label={o.label} selected={filter.sortBy === o.id} onSelect={() => set({ sortBy: o.id })} />
              ))}
            </FilterRow>
          </div>,
          document.body,
        )}
    </>
  )
}

/** A top-level row: label, the current value (accent when non-neutral), and a
 *  chevron. Hovering opens its submenu flyout to the right (reusing the recents
 *  flyout's open/close-delay so the pointer can travel across the gap). */
function FilterRow({
  label,
  value,
  accent,
  width,
  children,
}: {
  label: string
  value: string
  accent: boolean
  width: number
  children: ReactNode
}) {
  const ref = useRef<HTMLButtonElement>(null)
  const { open, openNow, closeSoon } = useFlyout()
  return (
    <>
      <button
        ref={ref}
        type="button"
        role="menuitem"
        onMouseEnter={openNow}
        onMouseLeave={closeSoon}
        onFocus={openNow}
        onBlur={closeSoon}
        aria-haspopup="menu"
        aria-expanded={open}
        className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition hover:bg-panel-2 ${
          open ? 'bg-panel-2' : ''
        }`}
      >
        <span className="flex-1 text-ink">{label}</span>
        <span className={accent ? 'font-medium text-accent' : 'text-ink-faint'}>{value}</span>
        <ChevronRight size={14} className="shrink-0 text-ink-faint" />
      </button>
      {open && (
        <FlyoutPanel anchor={ref.current} width={width} onEnter={openNow} onLeave={closeSoon}>
          {children}
        </FlyoutPanel>
      )}
    </>
  )
}

/** A submenu option. `disabled` renders a muted, non-interactive stub (the
 *  group-by dimensions the prototype doesn't model yet). */
function Opt({
  label,
  selected,
  disabled,
  onSelect,
}: {
  label: string
  selected?: boolean
  disabled?: boolean
  onSelect?: () => void
}) {
  return (
    <button
      type="button"
      role="menuitemradio"
      aria-checked={!!selected}
      disabled={disabled}
      title={disabled ? 'Coming soon' : undefined}
      onClick={disabled ? undefined : onSelect}
      className={`flex w-full items-center justify-between gap-3 rounded-lg px-2 py-1.5 text-left transition ${
        disabled ? 'cursor-default text-ink-faint/60' : 'text-ink hover:bg-panel-2'
      }`}
    >
      <span>{label}</span>
      {selected && <Check size={14} className="shrink-0 text-accent" />}
    </button>
  )
}

function Divider() {
  return <div className="my-1 border-t border-line" />
}
