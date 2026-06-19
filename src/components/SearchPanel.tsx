import { useEffect, useMemo, useRef, useState } from 'react'
import {
  FileText,
  Image as ImageIcon,
  Mail,
  MessageSquare,
  Presentation,
  Search,
  Sheet,
  type LucideIcon,
} from 'lucide-react'
import type { ArtifactKind, Session, SectionId } from '../types'
import { SECTION_META, SECTION_ORDER } from '../lib/sections'
import { ALL_ARTIFACTS, PROJECTS, SCHEDULED_TASKS } from '../data/cowork'

const KIND_ICON: Record<ArtifactKind, LucideIcon> = {
  doc: FileText,
  email: Mail,
  image: ImageIcon,
  slide: Presentation,
  sheet: Sheet,
}

interface Result {
  key: string
  title: string
  subtitle: string
  Icon: LucideIcon
  run: () => void
}

interface Group {
  label: string
  items: Result[]
}

/** A command-palette search over everything the prototype knows about —
 *  sessions, projects, artifacts, scheduled tasks, and the nav pages.
 *  Typing filters live; ↑/↓ + ↵ or a click runs the result (open the
 *  conversation / jump to the page). Opened from the rail's search icon. */
export function SearchPanel({
  sessions,
  onSelectSession,
  onOpenSection,
  onClose,
}: {
  sessions: Session[]
  onSelectSession: (id: string) => void
  onOpenSection: (s: SectionId) => void
  onClose: () => void
}) {
  const [q, setQ] = useState('')
  const [active, setActive] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const groups = useMemo<Group[]>(() => {
    const needle = q.trim().toLowerCase()
    const hit = (...fields: string[]) =>
      needle === '' || fields.some((f) => f.toLowerCase().includes(needle))

    const goSession = (id: string) => () => {
      onSelectSession(id)
      onClose()
    }
    const goSection = (s: SectionId) => () => {
      onOpenSection(s)
      onClose()
    }

    const sessionResults: Result[] = sessions
      .filter((c) => hit(c.title, c.preview))
      .map((c) => ({
        key: `c-${c.id}`,
        title: c.title,
        subtitle: c.preview,
        Icon: MessageSquare,
        run: goSession(c.id),
      }))

    const projectResults: Result[] = PROJECTS.filter((p) => hit(p.name, p.description)).map((p) => ({
      key: `p-${p.id}`,
      title: p.name,
      subtitle: `${p.sessionIds.length} session${p.sessionIds.length === 1 ? '' : 's'} · ${p.description}`,
      Icon: SECTION_META.projects.Icon,
      run: goSection('projects'),
    }))

    const artifactResults: Result[] = ALL_ARTIFACTS.filter((a) => hit(a.name, a.source)).map((a) => ({
      key: `a-${a.id}`,
      title: a.name,
      subtitle: `${a.meta} · ${a.source}`,
      Icon: KIND_ICON[a.kind],
      run: goSection('artifacts'),
    }))

    const scheduledResults: Result[] = SCHEDULED_TASKS.filter((s) => hit(s.name, s.cadence)).map(
      (s) => ({
        key: `s-${s.id}`,
        title: s.name,
        subtitle: s.cadence,
        Icon: SECTION_META.scheduled.Icon,
        run: goSection('scheduled'),
      }),
    )

    const pageResults: Result[] = SECTION_ORDER.filter((id) =>
      hit(SECTION_META[id].label, SECTION_META[id].subtitle),
    ).map((id) => ({
      key: `pg-${id}`,
      title: SECTION_META[id].label,
      subtitle: SECTION_META[id].subtitle,
      Icon: SECTION_META[id].Icon,
      run: goSection(id),
    }))

    // Empty query → a tidy "jump to" default; typed query → ranked matches.
    if (needle === '') {
      return [
        { label: 'Jump to', items: pageResults },
        { label: 'Recent', items: sessionResults.slice(0, 5) },
      ].filter((g) => g.items.length > 0)
    }
    return [
      { label: 'Sessions', items: sessionResults },
      { label: 'Projects', items: projectResults },
      { label: 'Artifacts', items: artifactResults },
      { label: 'Scheduled', items: scheduledResults },
      { label: 'Pages', items: pageResults },
    ].filter((g) => g.items.length > 0)
  }, [q, sessions, onSelectSession, onOpenSection, onClose])

  const flat = useMemo(() => groups.flatMap((g) => g.items), [groups])

  // Keep the active row in range as results change.
  useEffect(() => {
    setActive((a) => (a >= flat.length ? 0 : a))
  }, [flat.length])

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((a) => Math.min(a + 1, flat.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((a) => Math.max(a - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      flat[active]?.run()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      onClose()
    }
  }

  let idx = -1

  return (
    <div
      className="fixed inset-0 z-50 flex justify-center px-4 pt-[12vh]"
      onMouseDown={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Search"
    >
      <div className="absolute inset-0 bg-black/30 backdrop-blur-[1px]" />
      <div
        onMouseDown={(e) => e.stopPropagation()}
        className="relative flex max-h-[68vh] w-[580px] max-w-full flex-col overflow-hidden rounded-xl bg-surface shadow-2xl ring-1 ring-line-strong"
      >
        <div className="flex shrink-0 items-center gap-2.5 border-b border-line px-3.5">
          <Search size={17} className="shrink-0 text-ink-faint" />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Search sessions, projects, artifacts…"
            className="flex-1 bg-transparent py-3 text-[15px] text-ink outline-none placeholder:text-ink-faint"
          />
          <kbd className="shrink-0 rounded border border-line-strong bg-panel-2 px-1.5 py-0.5 text-[10px] font-medium text-ink-faint">
            esc
          </kbd>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto py-1.5">
          {flat.length === 0 ? (
            <div className="px-4 py-10 text-center text-[13px] text-ink-faint">
              No matches for “{q.trim()}”.
            </div>
          ) : (
            groups.map((g) => (
              <div key={g.label} className="pb-1">
                <div className="px-3.5 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
                  {g.label}
                </div>
                {g.items.map((r) => {
                  idx += 1
                  const isActive = idx === active
                  const here = idx
                  return (
                    <button
                      key={r.key}
                      onMouseMove={() => setActive(here)}
                      onClick={r.run}
                      className={`flex w-full items-center gap-3 px-3.5 py-2 text-left transition ${
                        isActive ? 'bg-accent-tint' : 'hover:bg-panel-2'
                      }`}
                    >
                      <r.Icon
                        size={16}
                        className={`shrink-0 ${isActive ? 'text-accent-strong' : 'text-ink-faint'}`}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] font-medium text-ink">{r.title}</span>
                        <span className="block truncate text-[11px] text-ink-faint">{r.subtitle}</span>
                      </span>
                    </button>
                  )
                })}
              </div>
            ))
          )}
        </div>

        <div className="flex shrink-0 items-center gap-3 border-t border-line bg-panel px-3.5 py-1.5 text-[11px] text-ink-faint">
          <span className="flex items-center gap-1">
            <Kbd>↑</Kbd>
            <Kbd>↓</Kbd>
            navigate
          </span>
          <span className="flex items-center gap-1">
            <Kbd>↵</Kbd>
            open
          </span>
          <span className="ml-auto">{flat.length} result{flat.length === 1 ? '' : 's'}</span>
        </div>
      </div>
    </div>
  )
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="rounded border border-line-strong bg-panel-2 px-1 py-0.5 font-medium text-ink-faint">
      {children}
    </kbd>
  )
}
