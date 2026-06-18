import { PenSquare, Search, Sparkles } from 'lucide-react'
import type { Conversation } from '../types'
import { CapBadges } from './CapBadges'

export function Sidebar({
  conversations,
  activeId,
  query,
  onQuery,
  onSelect,
}: {
  conversations: Conversation[]
  activeId: string
  query: string
  onQuery: (q: string) => void
  onSelect: (id: string) => void
}) {
  const q = query.trim().toLowerCase()
  const filtered = q
    ? conversations.filter(
        (c) => c.title.toLowerCase().includes(q) || c.preview.toLowerCase().includes(q),
      )
    : conversations

  return (
    <aside className="flex h-full w-[272px] shrink-0 flex-col border-r border-line bg-sidebar">
      <div className="px-3 pt-3">
        <button
          className="flex w-full items-center gap-2 rounded-lg border border-line-strong bg-surface px-3 py-2 text-sm font-medium text-ink shadow-sm transition hover:border-accent hover:text-accent-strong"
          onClick={() => onSelect(conversations[0].id)}
        >
          <PenSquare size={16} />
          New conversation
        </button>

        <div className="relative mt-3">
          <Search
            size={15}
            className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-faint"
          />
          <input
            value={query}
            onChange={(e) => onQuery(e.target.value)}
            placeholder="Search all work…"
            className="w-full rounded-lg border border-line bg-surface/70 py-1.5 pl-8 pr-2 text-sm text-ink outline-none placeholder:text-ink-faint focus:border-accent"
          />
        </div>
      </div>

      <div className="mt-3 flex items-center gap-1.5 px-4 pb-1 text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
        <Sparkles size={12} />
        One history · all work
      </div>

      <nav className="flex-1 overflow-y-auto px-2 pb-3">
        {filtered.map((c) => {
          const active = c.id === activeId
          return (
            <button
              key={c.id}
              onClick={() => onSelect(c.id)}
              className={`mb-0.5 flex w-full flex-col gap-1.5 rounded-lg px-2.5 py-2 text-left transition ${
                active ? 'bg-surface shadow-sm ring-1 ring-line-strong' : 'hover:bg-surface/60'
              }`}
            >
              <div className="flex items-baseline justify-between gap-2">
                <span className="truncate text-sm font-medium text-ink">{c.title}</span>
                <span className="shrink-0 text-[11px] text-ink-faint">{c.updatedLabel}</span>
              </div>
              <span className="line-clamp-1 text-xs text-ink-soft">{c.preview}</span>
              <div className="flex items-center justify-between">
                <CapBadges caps={c.caps} />
                {c.isDemo && (
                  <span className="rounded-full bg-accent-tint px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-accent-strong">
                    Demo
                  </span>
                )}
              </div>
            </button>
          )
        })}
        {filtered.length === 0 && (
          <p className="px-2.5 py-6 text-center text-sm text-ink-faint">No matches.</p>
        )}
      </nav>

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
