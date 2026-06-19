import type { ReactNode } from 'react'
import { PanelLeftClose, Plus, Search, SlidersHorizontal } from 'lucide-react'
import type { Conversation, SectionId } from '../types'
import { ResizeHandle } from './ResizeHandle'
import { SECTION_META, SECTION_ORDER } from '../lib/sections'
import { SCHEDULED_TASKS } from '../data/cowork'

export function Sidebar({
  conversations,
  activeId,
  activeSection,
  onSelect,
  onNewTask,
  onOpenSection,
  onToggleCollapse,
  onOpenSearch,
  onResizeStart,
  onResize,
  onResizeEnd,
}: {
  conversations: Conversation[]
  activeId: string
  activeSection: SectionId | null
  onSelect: (id: string) => void
  onNewTask: () => void
  onOpenSection: (s: SectionId) => void
  /** Collapse the rail (its own toggle, top-left). Re-opening is handled by a
   *  floating control in the parent, since this one hides with the rail. */
  onToggleCollapse: () => void
  /** Open the floating search palette (the rail keeps only an icon). */
  onOpenSearch: () => void
  /** Drag-to-resize wiring; the parent owns the width and clamps it. */
  onResizeStart: () => void
  onResize: (clientX: number) => void
  onResizeEnd: () => void
}) {
  const inConversation = activeSection === null
  const scheduledPinned = SCHEDULED_TASKS.filter((t) => t.enabled)

  return (
    <aside className="relative flex h-full w-full shrink-0 flex-col border-r border-line bg-sidebar">
      <ResizeHandle side="right" onStart={onResizeStart} onMove={onResize} onEnd={onResizeEnd} />
      {/* Rail header — the collapse toggle sits at the top-left, with a search
          icon beside it; both on one line (no separate product top bar). Search
          opens a floating palette rather than filtering inline. */}
      <div className="flex items-center gap-1 px-2 pt-2.5">
        <button
          onClick={onToggleCollapse}
          title="Collapse sidebar"
          aria-label="Collapse sidebar"
          className="flex h-8 w-8 items-center justify-center rounded-lg text-ink-soft transition hover:bg-surface hover:text-ink"
        >
          <PanelLeftClose size={18} />
        </button>
        <button
          onClick={onOpenSearch}
          title="Search  (⌘K)"
          aria-label="Search"
          className="flex h-8 w-8 items-center justify-center rounded-lg text-ink-soft transition hover:bg-surface hover:text-ink"
        >
          <Search size={18} />
        </button>
      </div>

      {/* Nav: a new task plus the cross-cutting tools. */}
      <nav className="mt-3 px-2">
        <NavRow icon={<Plus size={16} />} label="New task" onClick={onNewTask} />
        {SECTION_ORDER.map((id) => {
          const { label, Icon, beta } = SECTION_META[id]
          return (
            <NavRow
              key={id}
              icon={<Icon size={16} />}
              label={label}
              beta={beta}
              active={activeSection === id}
              onClick={() => onOpenSection(id)}
            />
          )
        })}
      </nav>

      <div className="mt-3 min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        {/* Pinned scheduled tasks. */}
        {scheduledPinned.length > 0 && (
          <>
            <SectionLabel>Scheduled</SectionLabel>
            {scheduledPinned.map((t) => (
              <button
                key={t.id}
                onClick={() => onOpenSection('scheduled')}
                className="group flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left transition hover:bg-surface/70"
              >
                <Dot active={false} />
                <span className="min-w-0 flex-1 truncate text-[13px] text-ink">{t.name}</span>
                <span className="shrink-0 text-[11px] text-ink-faint">
                  {t.cadence.split('·')[0].trim()}
                </span>
              </button>
            ))}
          </>
        )}

        {/* Recents — one compact line per conversation. */}
        <div className="mt-3 flex items-center justify-between pr-1">
          <SectionLabel className="mt-0">Recents</SectionLabel>
          <button
            title="Filter & sort"
            className="flex h-5 w-5 items-center justify-center rounded text-ink-faint transition hover:bg-surface/70 hover:text-ink-soft"
          >
            <SlidersHorizontal size={14} />
          </button>
        </div>

        {conversations.map((c) => {
          const active = inConversation && c.id === activeId
          return (
            <button
              key={c.id}
              onClick={() => onSelect(c.id)}
              title={c.preview}
              className={`group flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left transition ${
                active ? 'bg-surface shadow-sm ring-1 ring-line-strong' : 'hover:bg-surface/70'
              }`}
            >
              <Dot active={active} />
              <span className="min-w-0 flex-1 truncate text-[13px] text-ink">{c.title}</span>
            </button>
          )
        })}
      </div>

      <div className="border-t border-line px-3 py-2.5">
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-full bg-accent text-sm font-semibold text-white">
            P
          </div>
          <div className="leading-tight">
            <div className="text-xs font-medium text-ink">Patrick Pan</div>
            <div className="text-[11px] text-ink-faint">Prototype workspace</div>
          </div>
        </div>
      </div>
    </aside>
  )
}

function NavRow({
  icon,
  label,
  beta,
  active,
  onClick,
}: {
  icon: ReactNode
  label: string
  beta?: boolean
  active?: boolean
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className={`flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-[13px] transition ${
        active ? 'bg-panel-2 font-medium text-ink' : 'text-ink-soft hover:bg-surface/70 hover:text-ink'
      }`}
    >
      <span className="shrink-0">{icon}</span>
      <span className="flex-1 text-left">{label}</span>
      {beta && (
        <span className="rounded bg-panel-2 px-1.5 py-0.5 text-[10px] font-medium text-ink-soft">
          Beta
        </span>
      )}
    </button>
  )
}

function SectionLabel({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={`px-2 pb-1 pt-1 text-[11px] font-semibold uppercase tracking-wide text-ink-faint ${className}`}
    >
      {children}
    </div>
  )
}

/** A leading status dot — filled for the active item, a hollow ring otherwise. */
function Dot({ active }: { active: boolean }) {
  return (
    <span
      className={`h-2 w-2 shrink-0 rounded-full ${
        active ? 'bg-accent' : 'border border-line-strong bg-transparent'
      }`}
    />
  )
}
