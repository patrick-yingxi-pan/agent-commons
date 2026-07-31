import { useEffect, useMemo, useRef, useState } from 'react'
import { FileText, Globe, ListChecks, MessageSquare, Search, type LucideIcon } from 'lucide-react'
import type { SearchHit, SearchHitType } from '../../contract/index.ts'
import type { Session, SectionId } from '../types'
import { SECTION_META, SECTION_ORDER } from '../lib/sections'
import { useFocusTrap } from '../lib/useFocusTrap'
import { SCRIM_CLASS } from '../lib/scrim'
import { DIALOG_SURFACE_CLASS } from '../lib/dialog'
import { useGlobalSearch } from '../api'

/** Icon per server hit type. Section-shaped types reuse the section's own icon
 *  (one cue per concept); the commons types get their public-face cues. */
const HIT_ICON: Record<SearchHitType, LucideIcon> = {
  session: MessageSquare,
  project: SECTION_META.projects.Icon,
  artifact: SECTION_META.artifacts.Icon,
  schedule: SECTION_META.scheduled.Icon,
  agent: SECTION_META.agents.Icon,
  prompt: FileText,
  model: SECTION_META.models.Icon,
  context: SECTION_META.contexts.Icon,
  owner: Globe,
  sharedProject: SECTION_META.projects.Icon,
  publishedAgent: SECTION_META.agents.Icon,
  openWork: ListChecks,
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

/** The command palette — the product's ONE global search surface (D22: the rail
 *  owns search; there is deliberately no top bar). A typed query asks the server
 *  (`GET /search`) for typed, grouped hits across everything the caller can see —
 *  private workspace AND the commons (shared projects, published agents, owners,
 *  open work) — and every hit DEEP-LINKS: a project hit opens the project page, an
 *  owner hit the workspace profile (D21), a session hit the thread. The empty-query
 *  default ("Jump to" + recents) and the Pages group stay client-side — they're
 *  navigation over the shell itself, not entity search. */
export function SearchPanel({
  sessions,
  onSelectSession,
  onOpenSection,
  onOpenProject,
  onOpenSchedule,
  onOpenOwner,
  onOpenAgentPage,
  onClose,
}: {
  sessions: Session[]
  onSelectSession: (id: string) => void
  onOpenSection: (s: SectionId) => void
  onOpenProject: (id: string) => void
  onOpenSchedule: (id: string) => void
  onOpenOwner: (name: string) => void
  /** A published definition's own page (COMMONS-26) — the publishedAgent hit's door. */
  onOpenAgentPage: (agentId: string) => void
  onClose: () => void
}) {
  const [q, setQ] = useState('')
  const [active, setActive] = useState(0)
  const dialogRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // Debounced server query — one request per typing pause, cached per query.
  const [debouncedQ, setDebouncedQ] = useState('')
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q.trim()), 160)
    return () => clearTimeout(t)
  }, [q])
  const server = useGlobalSearch(debouncedQ)

  // Focus the search input on open, trap Tab within the palette, close on
  // Escape, restore focus on close.
  useFocusTrap(dialogRef, onClose, { initialFocus: inputRef })

  const needle = q.trim()
  // The server echoes the (lowercased) query it answered — mismatch means the
  // answer for what's typed is still in flight, so "no matches" would be a lie.
  const settled = needle === '' || server.data?.query === needle.toLowerCase()

  const groups = useMemo<Group[]>(() => {
    const goSession = (id: string) => () => {
      onSelectSession(id)
      onClose()
    }
    const goSection = (s: SectionId) => () => {
      onOpenSection(s)
      onClose()
    }

    const pageResults: Result[] = SECTION_ORDER.filter(
      (id) =>
        needle === '' ||
        SECTION_META[id].label.toLowerCase().includes(needle.toLowerCase()) ||
        SECTION_META[id].subtitle.toLowerCase().includes(needle.toLowerCase()),
    ).map((id) => ({
      key: `pg-${id}`,
      title: SECTION_META[id].label,
      subtitle: SECTION_META[id].subtitle,
      Icon: SECTION_META[id].Icon,
      run: goSection(id),
    }))

    // Empty query → a tidy "jump to" default over the shell + recent threads.
    if (needle === '') {
      const recent: Result[] = sessions.slice(0, 5).map((c) => ({
        key: `c-${c.id}`,
        title: c.title,
        subtitle: c.preview,
        Icon: MessageSquare,
        run: goSession(c.id),
      }))
      return [
        { label: 'Jump to', items: pageResults },
        { label: 'Recent', items: recent },
      ].filter((g) => g.items.length > 0)
    }

    // Typed query → the server's grouped hits, each a DEEP LINK to its entity.
    const door = (hit: SearchHit): (() => void) => {
      const go = (fn: () => void) => () => {
        fn()
        onClose()
      }
      switch (hit.type) {
        case 'session':
          return go(() => onSelectSession(hit.id))
        case 'project':
        case 'sharedProject':
          // One page serves owner and visitor alike (COMMONS-13) — same door.
          return go(() => onOpenProject(hit.id))
        case 'schedule':
          return go(() => onOpenSchedule(hit.id))
        case 'owner':
          return go(() => onOpenOwner(hit.id))
        case 'publishedAgent':
          // The definition's OWN page (COMMONS-26) — the canonical door, like every
          // other hit landing on its entity's page.
          return go(() => onOpenAgentPage(hit.id))
        case 'openWork':
          // The backlog lives on the project page — `ref` carries the projectId.
          return go(() => (hit.ref ? onOpenProject(hit.ref) : onOpenSection('projects')))
        case 'artifact':
          return go(() => onOpenSection('artifacts'))
        case 'model':
          return go(() => onOpenSection('models'))
        case 'context':
          return go(() => onOpenSection('contexts'))
        case 'agent':
        case 'prompt':
          return go(() => onOpenSection('agents'))
      }
    }

    const serverGroups: Group[] = (server.data?.groups ?? []).map((g) => ({
      // The cap is honest: when more matched than shown, the header says so.
      label: g.total > g.hits.length ? `${g.label} · ${g.hits.length} of ${g.total}` : g.label,
      items: g.hits.map((h) => ({
        key: `${h.type}-${h.id}`,
        title: h.title,
        subtitle: h.subtitle,
        Icon: HIT_ICON[h.type],
        run: door(h),
      })),
    }))

    return [...serverGroups, { label: 'Pages', items: pageResults }].filter((g) => g.items.length > 0)
  }, [needle, sessions, server.data, onSelectSession, onOpenSection, onOpenProject, onOpenSchedule, onOpenOwner, onOpenAgentPage, onClose])

  const flat = useMemo(() => groups.flatMap((g) => g.items), [groups])

  // Keep the active row in range as results change — including the ↓-during-empty
  // case (an arrow while "Searching…" would otherwise pin the index at -1, and
  // Enter would no-op after results land).
  useEffect(() => {
    setActive((a) => (a >= flat.length || a < 0 ? 0 : a))
  }, [flat.length])

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((a) => Math.max(0, Math.min(a + 1, flat.length - 1)))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((a) => Math.max(a - 1, 0))
    } else if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
      // Not the Enter that commits an IME composition (that keydown carries
      // isComposing) — only a real submit opens the active hit.
      e.preventDefault()
      flat[active]?.run()
    }
    // Escape (and the Tab trap) are handled by useFocusTrap.
  }

  let idx = -1

  return (
    <div
      className="fixed inset-0 z-50 flex justify-center px-4 pt-[12dvh] short:pt-[6dvh]"
      onMouseDown={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Search"
    >
      <div className={`${SCRIM_CLASS} backdrop-blur-[1px]`} />
      <div
        ref={dialogRef}
        onMouseDown={(e) => e.stopPropagation()}
        className={`relative flex max-h-[68dvh] w-[580px] max-w-full flex-col ${DIALOG_SURFACE_CLASS} short:max-h-[85dvh]`}
      >
        <div className="flex shrink-0 items-center gap-2.5 border-b border-line px-3.5">
          <Search size={17} className="shrink-0 text-ink-faint" />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Search everything — sessions, projects, agents, workspaces…"
            className="flex-1 bg-transparent py-3 text-[15px] text-ink outline-none placeholder:text-ink-faint"
          />
          <kbd className="shrink-0 rounded border border-line-strong bg-panel-2 px-1.5 py-0.5 text-[10px] font-medium text-ink-faint">
            esc
          </kbd>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto py-1.5">
          {flat.length === 0 ? (
            <div className="px-4 py-10 text-center text-[13px] text-ink-faint">
              {settled ? (
                <>No matches for “{needle}”.</>
              ) : server.error ? (
                // A failed fetch would otherwise read "Searching…" forever for this
                // query (an errored key refetches on the next palette open).
                'Search is unavailable right now — try again.'
              ) : (
                'Searching…'
              )}
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
