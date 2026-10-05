import { useEffect, useRef, useState, type ReactNode } from 'react'
import { ChevronRight, FolderOpen } from 'lucide-react'
import { useFocusTrap } from '../lib/useFocusTrap'
import { SCRIM_CLASS } from '../lib/scrim'
import { DIALOG_SURFACE_CLASS } from '../lib/dialog'
import { SOFT_BUTTON_CLASS } from '../lib/button'

/* ------------------------------------------------------------------ Browse --
   A simulated file-system explorer window (macOS Finder flavour) for picking
   something that isn't in the recents list. Selecting an item hands its id back
   to the picker, which runs the normal attach path (so the repo / folder
   dependency prompts still fire) and promotes it into recents. */

interface BrowseItem {
  id: string
  name: string
  meta?: string
  icon?: ReactNode
  /** Tailwind gradient class for grid (photo) thumbnails. */
  thumb?: string
}

interface BrowseGroup {
  label?: string
  items: BrowseItem[]
}

export function ContextBrowseDialog({
  title,
  location,
  groups,
  layout = 'list',
  onCancel,
  onConfirm,
}: {
  title: string
  location: string[]
  groups: BrowseGroup[]
  layout?: 'list' | 'grid'
  onCancel: () => void
  onConfirm: (id: string) => void
}) {
  const [picked, setPicked] = useState<string | null>(null)
  const dialogRef = useRef<HTMLDivElement>(null)
  const items = groups.flatMap((g) => g.items)
  const pickedItem = items.find((i) => i.id === picked) ?? null

  // Trap Tab within the browse window and restore focus on close. Escape is
  // handled below in capture phase (closeOnEscape: false) so it closes this
  // modal before the popover's own Escape handler tears the whole popover down.
  useFocusTrap(dialogRef, onCancel, { closeOnEscape: false })
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onCancel()
      }
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [onCancel])

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      onMouseDown={onCancel}
      role="dialog"
      aria-modal="true"
      aria-label={`${title} — browse`}
    >
      <div className={`${SCRIM_CLASS} backdrop-blur-[1px]`} />
      <div
        ref={dialogRef}
        onMouseDown={(e) => e.stopPropagation()}
        className={`relative flex max-h-[72dvh] w-[560px] max-w-[calc(100vw-16px)] flex-col ${DIALOG_SURFACE_CLASS} short:max-h-[85dvh]`}
      >
        {/* Title bar — Finder-style traffic lights + centered title. */}
        <div className="relative flex h-9 shrink-0 items-center border-b border-line bg-panel-2 px-3">
          <div className="flex items-center gap-1.5">
            <button
              onClick={onCancel}
              title="Close"
              aria-label="Close"
              className="h-3 w-3 rounded-full bg-[#ff5f57] ring-1 ring-black/10 transition hover:brightness-90"
            />
            <span className="h-3 w-3 rounded-full bg-[#febc2e] ring-1 ring-black/10" />
            <span className="h-3 w-3 rounded-full bg-[#28c840] ring-1 ring-black/10" />
          </div>
          <span className="absolute left-1/2 -translate-x-1/2 text-[12px] font-semibold text-ink-soft">
            {title}
          </span>
        </div>

        {/* Location / breadcrumb bar. */}
        <div className="flex shrink-0 items-center gap-1 border-b border-line px-3 py-1.5 text-[11px] text-ink-faint">
          <FolderOpen size={13} className="text-ink-faint" />
          {location.map((seg, i) => (
            <span key={i} className="flex items-center gap-1">
              {i > 0 && <ChevronRight size={11} className="text-line-strong" />}
              <span className={i === location.length - 1 ? 'font-medium text-ink-soft' : ''}>{seg}</span>
            </span>
          ))}
        </div>

        {/* Body. */}
        <div className="min-h-[140px] flex-1 overflow-y-auto p-2">
          {items.length === 0 ? (
            <div className="flex h-full min-h-[140px] items-center justify-center px-6 text-center text-[12px] text-ink-faint">
              Everything here is already in your recents.
            </div>
          ) : layout === 'grid' ? (
            <div className="grid grid-cols-4 gap-2 p-1">
              {items.map((it) => (
                <button
                  key={it.id}
                  title={it.name}
                  onClick={() => setPicked(it.id)}
                  onDoubleClick={() => onConfirm(it.id)}
                  className={`aspect-square rounded-lg ring-2 transition ${it.thumb ?? 'bg-panel-2'} ${
                    it.id === picked ? 'ring-accent' : 'ring-transparent hover:ring-line-strong'
                  }`}
                />
              ))}
            </div>
          ) : (
            groups.map((g, gi) => (
              <div key={gi} className="pb-1">
                {g.label && (
                  <p className="px-1 pb-1 pt-1 text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
                    {g.label}
                  </p>
                )}
                {g.items.map((it) => (
                  <button
                    key={it.id}
                    onClick={() => setPicked(it.id)}
                    onDoubleClick={() => onConfirm(it.id)}
                    className={`mb-0.5 flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition ${
                      it.id === picked ? 'bg-accent-tint ring-1 ring-accent/40' : 'hover:bg-panel-2'
                    }`}
                  >
                    <span className="shrink-0 text-ink-soft">{it.icon}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-medium text-ink">{it.name}</span>
                      {it.meta && <span className="block truncate text-[11px] text-ink-faint">{it.meta}</span>}
                    </span>
                  </button>
                ))}
              </div>
            ))
          )}
        </div>

        {/* Footer — selected name + Cancel / Open. */}
        <div className="flex shrink-0 items-center justify-between gap-2 border-t border-line bg-panel px-3 py-2">
          <span className="min-w-0 truncate text-[11px] text-ink-faint">
            {pickedItem ? pickedItem.name : 'Select an item to open'}
          </span>
          <div className="flex shrink-0 gap-1.5">
            <button
              onClick={onCancel}
              className="rounded-md px-2.5 py-1 text-[12px] font-medium text-ink-soft transition hover:bg-panel-2"
            >
              Cancel
            </button>
            <button
              onClick={() => picked && onConfirm(picked)}
              disabled={!picked}
              className={`${SOFT_BUTTON_CLASS} px-2.5 py-1 text-[12px] disabled:cursor-not-allowed disabled:opacity-40`}
            >
              Open
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
