import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowRight, FileText, Globe, History, ListChecks, MessageSquare, Search, X, type LucideIcon } from 'lucide-react'
import { MAX_SEARCH_QUERY_CHARS, SEARCH_PAGE_SIZE, type SearchHitType, type SearchPage } from '../../contract/index.ts'
import type { Session, SectionId } from '../types'
import { SECTION_META, SECTION_ORDER } from '../lib/sections'
import { useFocusTrap } from '../lib/useFocusTrap'
import { SCRIM_CLASS } from '../lib/scrim'
import { BOUNDED_DIALOG_BODY_CLASS, BOUNDED_DIALOG_LAYER_CLASS, BOUNDED_DIALOG_PANEL_CLASS, DIALOG_SURFACE_CLASS } from '../lib/dialog'
import { useBoundedDialog } from '../lib/useBoundedDialog'
import { retryGlobalSearch, useGlobalSearch } from '../api'
import { searchHitDestination, searchHitKey, searchHitVersionLabel, searchResponseMatches, searchResultSubtitleClass, searchResultHasTextPreview } from '../lib/searchResults'
import { INLINE_ACTION_CLASS } from '../lib/inlineAction'

/** Icon per server hit type. Section-shaped types reuse the section's own icon
 *  (one cue per concept); the commons types get their public-face cues. */
const HIT_ICON: Record<SearchHitType, LucideIcon> = {
  session: MessageSquare,
  project: SECTION_META.projects.Icon,
  artifact: SECTION_META.artifacts.Icon,
  artifactVersion: History,
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
  detailLabel?: string
  textPreview?: boolean
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
 *  your own namespace AND the commons (shared projects, published agents, owners,
 *  open work) — and every hit DEEP-LINKS: a project hit opens the project page, an
 *  owner hit their profile (D21), a session hit the thread. The empty-query
 *  default ("Jump to" + recents) and the Pages group stay client-side — they're
 *  navigation over the shell itself, not entity search. */
export function SearchPanel({
  sessions,
  onSelectSession,
  onOpenSection,
  onClose,
}: {
  sessions: Session[]
  onSelectSession: (id: string, messageId?: string) => void
  onOpenSection: (s: SectionId, id?: string, subId?: string) => void
  onClose: () => void
}) {
  const [q, setQ] = useState('')
  const [active, setActive] = useState(0)
  const [page, setPage] = useState<SearchPage | undefined>()
  const searchingVersions = page?.type === 'artifactVersion'
  const dialogRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const resultsRef = useRef<HTMLDivElement>(null)

  // Debounced server query — one request per typing pause, cached per query.
  const [debouncedQ, setDebouncedQ] = useState('')
  const queryTooLong = q.trim().length > MAX_SEARCH_QUERY_CHARS
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q.trim()), 160)
    return () => clearTimeout(t)
  }, [q])
  const blockedQuery = queryTooLong || debouncedQ.length > MAX_SEARCH_QUERY_CHARS
  const server = useGlobalSearch(blockedQuery ? '' : debouncedQ, blockedQuery ? undefined : page)

  // Focus the search input on open, trap Tab within the palette, close on
  // Escape, restore focus on close.
  useFocusTrap(dialogRef, onClose, { initialFocus: inputRef })
  useBoundedDialog(dialogRef)

  const needle = q.trim()
  // The server echoes the (lowercased) query it answered — mismatch means the
  // answer for what's typed is still in flight, so "no matches" would be a lie.
  const currentQuery = debouncedQ.toLowerCase() === needle.toLowerCase()
  const settled = !queryTooLong && currentQuery && server.status === 'success' && searchResponseMatches(server.data, needle, page)
  const failed = currentQuery && server.status === 'error'
  const pageGroup = settled && page ? server.data?.groups[0] : undefined
  const changePage = useCallback((next: SearchPage | undefined) => {
    setPage(next)
    setActive(0)
    inputRef.current?.focus()
  }, [])

  const groups = useMemo<Group[]>(() => {
    const goSession = (id: string) => () => {
      onSelectSession(id)
      onClose()
    }
    const goSection = (s: SectionId) => () => {
      onOpenSection(s)
      onClose()
    }

    const pageResults: Result[] = (page ? [] : SECTION_ORDER).filter(
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
    if (needle === '' && !searchingVersions) {
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
    const serverGroups: Group[] = (settled ? server.data?.groups ?? [] : []).map((g) => ({
      // The cap is honest: when more matched than shown, the header says so.
      label: !page && g.total > g.hits.length ? `${g.label} · ${g.hits.length} of ${g.total}` : g.label,
      items: [...g.hits.flatMap((h): Result[] => {
        const destination = searchHitDestination(h)
        if (!destination) return []
        return [{
          key: searchHitKey(h),
          title: h.title,
          subtitle: h.subtitle,
          detailLabel: h.type === 'session' && h.match
            ? h.match.role === 'user' ? 'User message' : 'Assistant message'
            : searchHitVersionLabel(h),
          textPreview: searchResultHasTextPreview(h.type),
          Icon: HIT_ICON[h.type],
          run: () => {
            if (destination.kind === 'session') onSelectSession(destination.id, destination.messageId)
            else onOpenSection(destination.section, destination.id, destination.subId)
            onClose()
          },
        }]
      }), ...(!page && g.total > g.hits.length ? [{
        key: `more-${g.type}`, title: `Show all ${g.label}`, subtitle: `${g.total} matches`, Icon: ArrowRight,
        run: () => changePage({ type: g.type, offset: 0 }),
      }] : [])],
    }))

    return [...serverGroups, { label: 'Pages', items: pageResults }].filter((g) => g.items.length > 0)
  }, [needle, sessions, server.data, settled, page, searchingVersions, changePage, onSelectSession, onOpenSection, onClose])

  const flat = useMemo(() => groups.flatMap((g) => g.items), [groups])

  // Keep the active row in range as results change — including the ↓-during-empty
  // case (an arrow while "Searching…" would otherwise pin the index at -1, and
  // Enter would no-op after results land).
  useEffect(() => {
    setActive((a) => (a >= flat.length || a < 0 ? 0 : a))
  }, [flat.length])

  useEffect(() => {
    resultsRef.current?.querySelector('[data-search-active="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [active, flat])

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
      className={BOUNDED_DIALOG_LAYER_CLASS}
      onMouseDown={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Search"
    >
      <div className={`${SCRIM_CLASS} backdrop-blur-[1px]`} />
      <div
        ref={dialogRef}
        data-bounded-dialog="search"
        onMouseDown={(e) => e.stopPropagation()}
        className={`w-[580px] ${BOUNDED_DIALOG_PANEL_CLASS} ${DIALOG_SURFACE_CLASS}`}
      >
        <div className="flex shrink-0 items-center gap-2.5 border-b border-line px-3.5">
          <Search size={17} className="shrink-0 text-ink-faint" />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => { setQ(e.target.value); setPage(searchingVersions ? { type: 'artifactVersion', offset: 0 } : undefined); setActive(0) }}
            onKeyDown={onKeyDown}
            aria-label="Search everything"
            aria-describedby="search-help"
            placeholder={searchingVersions ? 'Find text in your saved artifact versions…' : 'Search everything — sessions, projects, agents, people…'}
            className="min-w-0 flex-1 bg-transparent py-3 text-[15px] text-ink outline-none placeholder:text-ink-faint"
          />
          <button type="button" aria-label="Close search" onClick={onClose} className="shrink-0 rounded-md p-1 text-ink-faint hover:bg-panel-2"><X size={16} /></button>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-line px-3.5 py-2">
          {page && <button type="button" className={INLINE_ACTION_CLASS} onClick={() => changePage(undefined)}>{searchingVersions ? 'Current resources' : 'All categories'}</button>}
          {!searchingVersions && <button type="button" className={INLINE_ACTION_CLASS} onClick={() => changePage({ type: 'artifactVersion', offset: 0 })}>Search saved versions</button>}
          <span className="text-[11px] text-ink-faint">{searchingVersions ? 'Only your retained artifact versions, including Trash. Opening a result changes nothing.' : page?.type === 'session' || !page ? 'Matches in message text open the first matching message. Archived originals and tool output aren’t searched. Artifact versions are searched separately.' : 'Results reflect current access; changes may shift pages.'}</span>
        </div>
        {queryTooLong && <p role="status" className="px-3.5 py-2 text-[12px] text-ink-soft">Shorten your query to {MAX_SEARCH_QUERY_CHARS} characters to search.</p>}
        {needle && !queryTooLong && !settled && <div role="status" className="flex shrink-0 flex-wrap items-center gap-2 px-3.5 py-2 text-[12px] text-ink-soft">
          <span>{failed ? 'Search is unavailable right now.' : 'Searching…'}</span>
          {failed && <button type="button" className={INLINE_ACTION_CLASS} onClick={() => retryGlobalSearch(debouncedQ, page)}>Retry search</button>}
        </div>}
        <div ref={resultsRef} data-search-results className={`${BOUNDED_DIALOG_BODY_CLASS} py-1.5`}>
          {searchingVersions && !needle ? <p className="px-4 py-10 text-center text-[13px] text-ink-faint">Type to search your saved artifact versions.</p> : flat.length === 0 && settled ? (
            <div role="status" className="break-words px-4 py-10 text-center text-[13px] text-ink-faint [overflow-wrap:anywhere]">
              {page ? 'No matches on this page. Go back to review current results.' : <>No matches for “{needle}”.</>}
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
                      type="button"
                      aria-label={r.key.startsWith('more-') ? r.title : undefined}
                      data-search-result={r.key}
                      data-search-active={isActive}
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
                        <span title={r.title} className="block truncate text-[13px] font-medium text-ink">{r.title}</span>
                        {r.detailLabel && <span className={`block break-words text-[11px] ${searchResultSubtitleClass(isActive)}`}>{r.detailLabel}</span>}
                        <span title={r.subtitle} className={`${r.textPreview ? 'line-clamp-3 break-words [overflow-wrap:anywhere]' : 'block truncate'} text-[11px] ${searchResultSubtitleClass(isActive)}`}>{r.subtitle}</span>
                      </span>
                    </button>
                  )
                })}
              </div>
            ))
          )}
        </div>
        {page && <div className="flex shrink-0 flex-wrap items-center gap-2 border-t border-line px-3.5 py-2">
          <button type="button" className={INLINE_ACTION_CLASS} disabled={page.offset === 0} onClick={() => changePage({ ...page, offset: Math.max(0, page.offset - SEARCH_PAGE_SIZE) })}>Previous page</button>
          <span role="status" className="text-[11px] text-ink-soft">{pageGroup ? `${pageGroup.hits.length ? page.offset + 1 : 0}–${pageGroup.hits.length ? page.offset + pageGroup.hits.length : 0} of ${pageGroup.total}` : '…'}</span>
          <button type="button" className={INLINE_ACTION_CLASS} disabled={!pageGroup || page.offset + SEARCH_PAGE_SIZE >= pageGroup.total} onClick={() => changePage({ ...page, offset: page.offset + SEARCH_PAGE_SIZE })}>Next page</button>
        </div>}
        <div id="search-help" className="flex shrink-0 flex-wrap items-center gap-3 border-t border-line bg-panel px-3.5 py-1.5 text-[11px] text-ink-faint">
          <span className="flex items-center gap-1">
            <Kbd>↑</Kbd>
            <Kbd>↓</Kbd>
            navigate
          </span>
          <span className="flex items-center gap-1">
            <Kbd>↵</Kbd>
            open
          </span>
          <span className="ml-auto">esc close</span>
        </div>
        <span className="sr-only" role="status">{flat[active] ? `Selected ${flat[active].title}` : ''}</span>
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
