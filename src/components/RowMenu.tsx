import { Fragment, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Check, ChevronRight, MoreVertical } from 'lucide-react'
import type { Project } from '../types'
import { FlyoutPanel, useFlyout } from './RecentOverflowList'

/** ── A sidebar row's overflow ("⋮") menu ──────────────────────────────────────
 *  The small action menu hung off every Recents session and Scheduled routine
 *  row, mirroring the desktop app's row menu. The item set is described by the
 *  caller (it differs per entity, and shifts when the row is in a project — Add →
 *  Change + Remove), so this component only owns the chrome: the trigger, the
 *  body-portaled popover (so the rail's scroll container can't clip it), a
 *  project picker submenu, and an inline confirm for destructive items.
 *
 *  Like the filter menu, the popover and its submenu portal to <body>; an outside
 *  click or Escape dismisses. */

export type RowMenuItem =
  | {
      kind: 'action'
      key: string
      label: string
      icon: ReactNode
      onSelect: () => void
      danger?: boolean
      /** When set, the item asks first: the popover swaps to this confirm message
       *  with Cancel / Confirm before `onSelect` fires. */
      confirm?: string
    }
  | {
      kind: 'project'
      key: string
      label: string
      icon: ReactNode
      projects: Project[]
      currentId: string | null
      onPick: (projectId: string) => void
    }
  | { kind: 'divider'; key: string }

const POPOVER_WIDTH = 208
const POPOVER_EST_HEIGHT = 240

export function RowMenu({ ariaLabel, items }: { ariaLabel: string; items: RowMenuItem[] }) {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)
  // A destructive item awaiting its second click (the inline confirm view).
  const [confirming, setConfirming] = useState<{ message: string; onSelect: () => void } | null>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)

  const close = () => {
    setOpen(false)
    setConfirming(null)
  }

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

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (triggerRef.current?.contains(e.target as Node)) return
      close()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close()
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const run = (fn: () => void) => {
    close()
    fn()
  }

  return (
    <>
      <button
        ref={triggerRef}
        onClick={(e) => {
          e.stopPropagation()
          setOpen((o) => !o)
        }}
        aria-label={ariaLabel}
        aria-haspopup="menu"
        aria-expanded={open}
        data-open={open}
        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-ink-faint opacity-0 transition hover:bg-panel-2 hover:text-ink focus:opacity-100 focus:outline-none group-hover:opacity-100 data-[open=true]:bg-panel-2 data-[open=true]:text-ink data-[open=true]:opacity-100"
      >
        <MoreVertical size={15} />
      </button>

      {open &&
        pos &&
        createPortal(
          <div
            role="menu"
            aria-label={ariaLabel}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
            style={{ position: 'fixed', left: pos.left, top: pos.top, width: POPOVER_WIDTH }}
            className="z-[60] rounded-xl border border-line-strong bg-surface p-1 text-[13px] shadow-xl"
          >
            {confirming ? (
              <ConfirmView
                message={confirming.message}
                onCancel={() => setConfirming(null)}
                onConfirm={() => run(confirming.onSelect)}
              />
            ) : (
              items.map((item) => {
                if (item.kind === 'divider') return <Divider key={item.key} />
                if (item.kind === 'project')
                  return (
                    <ProjectRow
                      key={item.key}
                      label={item.label}
                      icon={item.icon}
                      projects={item.projects}
                      currentId={item.currentId}
                      onPick={(pid) => run(() => item.onPick(pid))}
                    />
                  )
                return (
                  <ActionRow
                    key={item.key}
                    label={item.label}
                    icon={item.icon}
                    danger={item.danger}
                    onSelect={() =>
                      item.confirm
                        ? setConfirming({ message: item.confirm, onSelect: item.onSelect })
                        : run(item.onSelect)
                    }
                  />
                )
              })
            )}
          </div>,
          document.body,
        )}
    </>
  )
}

function ActionRow({
  label,
  icon,
  danger,
  onSelect,
}: {
  label: string
  icon: ReactNode
  danger?: boolean
  onSelect: () => void
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onSelect}
      className={`flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition ${
        danger ? 'text-removed hover:bg-removed-bg' : 'text-ink hover:bg-panel-2'
      }`}
    >
      <span className="flex h-4 w-4 shrink-0 items-center justify-center">{icon}</span>
      <span className="flex-1">{label}</span>
    </button>
  )
}

/** A row with a submenu of projects (Add / Change). The current project, if any,
 *  shows a check; picking a different one calls `onPick`. */
function ProjectRow({
  label,
  icon,
  projects,
  currentId,
  onPick,
}: {
  label: string
  icon: ReactNode
  projects: Project[]
  currentId: string | null
  onPick: (projectId: string) => void
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
        className={`flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-ink transition hover:bg-panel-2 ${
          open ? 'bg-panel-2' : ''
        }`}
      >
        <span className="flex h-4 w-4 shrink-0 items-center justify-center">{icon}</span>
        <span className="flex-1">{label}</span>
        <ChevronRight size={14} className="shrink-0 text-ink-faint" />
      </button>
      {open && (
        <FlyoutPanel anchor={ref.current} width={208} onEnter={openNow} onLeave={closeSoon}>
          {projects.length === 0 ? (
            <div className="px-2 py-1.5 text-[12px] text-ink-faint">No projects yet</div>
          ) : (
            projects.map((p) => (
              <button
                key={p.id}
                type="button"
                role="menuitemradio"
                aria-checked={currentId === p.id}
                onClick={() => onPick(p.id)}
                className="flex w-full items-center justify-between gap-3 rounded-lg px-2 py-1.5 text-left text-[13px] text-ink transition hover:bg-panel-2"
              >
                <span className="min-w-0 truncate">{p.name}</span>
                {currentId === p.id && <Check size={14} className="shrink-0 text-accent" />}
              </button>
            ))
          )}
        </FlyoutPanel>
      )}
    </>
  )
}

function ConfirmView({
  message,
  onCancel,
  onConfirm,
}: {
  message: string
  onCancel: () => void
  onConfirm: () => void
}) {
  return (
    <div className="px-2 py-1.5">
      <p className="px-0.5 pb-2 text-[12px] leading-snug text-ink-soft">{message}</p>
      <div className="flex items-center justify-end gap-1.5">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-lg px-2.5 py-1 text-[12px] font-medium text-ink-soft transition hover:bg-panel-2 hover:text-ink"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={onConfirm}
          className="rounded-lg bg-removed px-2.5 py-1 text-[12px] font-semibold text-white shadow-sm transition hover:opacity-90"
        >
          Delete
        </button>
      </div>
    </div>
  )
}

function Divider() {
  return <div className="my-1 border-t border-line" />
}

/** Convenience: build the project-membership items shared by sessions and
 *  routines — "Add to project ›" when unfiled, or "Change project › +
 *  Remove from project" when filed. `set(projectId | null)` applies the change. */
export function projectMenuItems(
  currentId: string | null,
  projects: Project[],
  set: (projectId: string | null) => void,
  icons: { add: ReactNode; remove: ReactNode },
): RowMenuItem[] {
  const picker: RowMenuItem = {
    kind: 'project',
    key: 'project',
    label: currentId ? 'Change project' : 'Add to project',
    icon: icons.add,
    projects,
    currentId,
    onPick: (pid) => set(pid),
  }
  if (!currentId) return [picker]
  return [picker, { kind: 'action', key: 'remove-project', label: 'Remove from project', icon: icons.remove, onSelect: () => set(null) }]
}
