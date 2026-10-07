import { useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Search, X } from 'lucide-react'
import { CONVERSATION_SEARCH_PAGE_SIZE, MAX_CONVERSATION_SEARCH_QUERY_CHARS } from '../../contract/conversationSearch.ts'
import { retryConversationSearch, useConversationSearch } from '../api/conversationSearch.ts'
import { conversationSearchMatches } from '../lib/conversationSearch.ts'
import { useBoundedDialog } from '../lib/useBoundedDialog.ts'
import { useFocusTrap } from '../lib/useFocusTrap.ts'
import { BOUNDED_DIALOG_BODY_CLASS, BOUNDED_DIALOG_LAYER_CLASS, BOUNDED_DIALOG_PANEL_CLASS, DIALOG_SURFACE_CLASS } from '../lib/dialog.ts'
import { SCRIM_CLASS } from '../lib/scrim.ts'
import { INLINE_ACTION_CLASS } from '../lib/inlineAction.ts'

export function ConversationSearch({ sessionId, onSelect, onClose }: {
  sessionId: string
  onSelect: (messageId: string) => void
  onClose: () => void
}) {
  const [query, setQuery] = useState('')
  const [debounced, setDebounced] = useState('')
  const [offset, setOffset] = useState(0)
  const [active, setActive] = useState(0)
  const dialogRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const resultsRef = useRef<HTMLDivElement>(null)
  const helpId = useId()
  const trimmed = query.trim()
  const needle = trimmed.toLowerCase()
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(trimmed), 160)
    return () => clearTimeout(timer)
  }, [trimmed])
  const server = useConversationSearch(sessionId, debounced, offset)
  const current = needle === debounced.toLowerCase()
  const settled = current && server.status === 'success' && conversationSearchMatches(server.data, needle, offset)
  const failed = current && server.status === 'error'
  const hits = settled ? server.data!.hits : []
  const total = settled ? server.data!.total : 0
  useFocusTrap(dialogRef, onClose, { initialFocus: inputRef })
  useBoundedDialog(dialogRef)
  useEffect(() => { setActive(0) }, [needle, offset])
  useEffect(() => { setActive((index) => Math.max(0, Math.min(index, hits.length - 1))) }, [hits.length])
  useEffect(() => {
    resultsRef.current?.querySelector('[data-search-active="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [active, server.data, settled])
  const select = (messageId: string) => { onClose(); onSelect(messageId) }
  const changePage = (next: number) => { setOffset(next); inputRef.current?.focus() }

  return createPortal(<div role="dialog" aria-modal="true" aria-label="Find in conversation"
    className={BOUNDED_DIALOG_LAYER_CLASS} onMouseDown={onClose}>
    <div className={SCRIM_CLASS} />
    <div ref={dialogRef} data-bounded-dialog="conversation-search" onMouseDown={(event) => event.stopPropagation()}
      className={`w-[580px] ${BOUNDED_DIALOG_PANEL_CLASS} ${DIALOG_SURFACE_CLASS}`}>
      <div className="flex shrink-0 items-center gap-2.5 border-b border-line px-3.5">
        <Search size={17} className="shrink-0 text-ink-soft" />
        <input ref={inputRef} value={query} maxLength={MAX_CONVERSATION_SEARCH_QUERY_CHARS}
          aria-label="Find in conversation" aria-describedby={helpId} placeholder="Find in this conversation…"
          className="min-w-0 flex-1 bg-transparent py-3 text-[15px] text-ink outline-none placeholder:text-ink-faint"
          onChange={(event) => { setQuery(event.target.value); setOffset(0); setActive(0) }}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing) return
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
              event.preventDefault()
              setActive((index) => Math.max(0, Math.min(hits.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1))))
            } else if (event.key === 'Enter' && hits[active]) {
              event.preventDefault(); select(hits[active].messageId)
            }
          }} />
        <button type="button" aria-label="Close search" onClick={onClose} className="shrink-0 rounded-md p-1 text-ink-soft hover:bg-panel-2"><X size={16} /></button>
      </div>
      <div id={helpId} className="shrink-0 border-b border-line px-3.5 py-2 text-[12px] text-ink-soft">
        Search saved message text and summaries. Attachments, tool details, and archived originals aren’t searched.
      </div>
      <div ref={resultsRef} data-conversation-search-results className={`${BOUNDED_DIALOG_BODY_CLASS} py-1.5`}>
        {!needle ? <p className="px-3.5 py-6 text-[13px] text-ink-soft">Find an earlier message, then open it in context.</p>
          : !settled ? <div role={failed ? 'alert' : 'status'} className="flex flex-wrap items-center gap-2 px-3.5 py-6 text-[13px] text-ink-soft">
            {failed ? 'Couldn’t search this conversation.' : 'Searching…'}
            {failed && <button type="button" className={INLINE_ACTION_CLASS} onClick={() => retryConversationSearch(sessionId, debounced, offset)}>Retry search</button>}
          </div>
          : hits.length === 0 ? <p role="status" className="px-3.5 py-6 text-[13px] text-ink-soft">
            {offset ? 'No matches on this page. Go back to review current results.' : 'No matching messages.'}
          </p> : hits.map((hit, index) => <button key={hit.messageId} type="button"
            data-conversation-search-result={hit.messageId} data-search-active={index === active}
            onFocus={() => setActive(index)} onMouseMove={() => setActive(index)} onClick={() => select(hit.messageId)}
            className={`block w-full px-3.5 py-3 text-left ${index === active ? 'bg-accent-tint' : 'hover:bg-panel-2'}`}>
            <span className="mb-1 block text-[11px] font-semibold text-ink-soft">{hit.role === 'user' ? 'User message' : 'Assistant message'}</span>
            <span className="block whitespace-pre-wrap text-[13px] leading-relaxed text-ink [overflow-wrap:anywhere]">{hit.snippet}</span>
          </button>)}
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-3 border-t border-line bg-panel px-3.5 py-2 text-[12px] text-ink-soft">
        <button type="button" className={INLINE_ACTION_CLASS} disabled={offset === 0} onClick={() => changePage(Math.max(0, offset - CONVERSATION_SEARCH_PAGE_SIZE))}>Previous page</button>
        <span role="status">{settled && needle ? `${hits.length ? offset + 1 : 0}–${hits.length ? offset + hits.length : 0} of ${total} messages` : '↑ ↓ select · Enter open'}</span>
        <button type="button" className={INLINE_ACTION_CLASS} disabled={!settled || offset + CONVERSATION_SEARCH_PAGE_SIZE >= total} onClick={() => changePage(offset + CONVERSATION_SEARCH_PAGE_SIZE)}>Next page</button>
        <span className="sr-only" role="status">{hits[active] ? `Selected ${offset + active + 1}: ${hits[active].snippet}` : ''}</span>
      </div>
    </div>
  </div>, document.body)
}
