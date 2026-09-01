import { motion } from 'framer-motion'
import { useState, type ReactNode } from 'react'
import { ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react'
import type { Message } from '../types'
import { retryCompactedMessages, useCompactedMessages } from '../api/compactedMessages'
import { COMPACTED_MESSAGE_PAGE_SIZE } from '../api/sessionPaging'
import { renderRich } from '../lib/rich'
import { Spinner } from './Spinner'

/** Rare, recovery-oriented conversation state. It is a separate lazy chunk so
 * ordinary first-load conversations do not pay for archive paging and block
 * Markdown; the summary marker remains the synchronous switch in MessageRow. */
export default function ConversationSummary({ message, sessionId }: { message: Message; sessionId: string }) {
  const [expanded, setExpanded] = useState(false)
  const [cursors, setCursors] = useState<Array<string | undefined>>([undefined])
  const pageIndex = cursors.length - 1
  const cursor = cursors[pageIndex]
  const archive = useCompactedMessages(sessionId, cursor, expanded)
  const regionId = `compaction-${message.id}`
  const start = pageIndex * COMPACTED_MESSAGE_PAGE_SIZE + 1
  const end = start + (archive.data?.items.length ?? 0) - 1

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.28 }} className="px-4 py-2">
      <div className="mx-auto w-full max-w-3xl rounded-xl border border-line bg-panel-2/30">
        <button
          type="button"
          aria-expanded={expanded}
          aria-controls={regionId}
          onClick={() => setExpanded((open) => !open)}
          className="flex min-h-10 w-full items-center gap-2 rounded-xl px-3 text-left text-[12px] text-ink-soft transition hover:bg-panel-2"
        >
          <ChevronDown size={14} className={`shrink-0 text-accent transition-transform ${expanded ? 'rotate-180' : ''}`} />
          <span className="min-w-0 flex-1 sm:flex sm:items-baseline sm:gap-2">
            <span className="block font-medium text-ink">Conversation summary</span>
            <span className="block text-[11px] text-ink-faint sm:text-[12px]">{message.compactedFrom} earlier {message.compactedFrom === 1 ? 'message' : 'messages'}</span>
          </span>
        </button>
        {expanded && (
          <div id={regionId} className="border-t border-line px-3 pb-3 pt-2">
            <SummaryMarkdown text={message.content} />
            <div className="mt-3 border-t border-line pt-2" aria-label="Archived conversation messages">
              <div className="mb-1.5 flex min-h-7 items-center justify-between gap-2 text-[11px] text-ink-faint">
                <span>{archive.data?.items.length ? `Archived messages ${start}–${end}` : 'Archived messages'}</span>
                <div className="flex items-center gap-1">
                  {pageIndex > 0 && (
                    <button
                      type="button"
                      onClick={() => setCursors((items) => items.slice(0, -1))}
                      className="inline-flex min-h-7 items-center gap-1 rounded-md px-2 transition hover:bg-surface hover:text-ink"
                    >
                      <ChevronLeft size={12} /> Previous
                    </button>
                  )}
                  {archive.data?.nextCursor && (
                    <button
                      type="button"
                      onClick={() => setCursors((items) => [...items, archive.data!.nextCursor!])}
                      className="inline-flex min-h-7 items-center gap-1 rounded-md px-2 transition hover:bg-surface hover:text-ink"
                    >
                      Next <ChevronRight size={12} />
                    </button>
                  )}
                </div>
              </div>
              {(archive.status === 'idle' || archive.status === 'loading') && <div role="status" className="flex items-center gap-2 py-2 text-[12px] text-ink-faint"><Spinner size={13} /> Loading archived messages…</div>}
              {archive.error && (
                <button
                  type="button"
                  onClick={() => retryCompactedMessages(sessionId, cursor)}
                  className="min-h-8 rounded-md px-2 text-[12px] font-medium text-accent-strong transition hover:bg-accent-tint"
                >
                  Couldn’t load the archive · Retry
                </button>
              )}
              {archive.data?.items.map((archived) => (
                <div key={archived.id} className="grid grid-cols-[5rem_1fr] gap-2 border-t border-line/70 py-2 first:border-t-0">
                  <span className="text-[11px] font-medium text-ink-faint">{archived.role === 'user' ? 'You' : 'Assistant'}</span>
                  <span className="whitespace-pre-wrap text-[12px] leading-relaxed text-ink-soft">{renderRich(archived.content)}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </motion.div>
  )
}

/** Compaction asks providers for small block Markdown. Ordinary turn prose uses
 * `renderRich`'s inline dialect; this renderer adds only semantic headings,
 * paragraphs, and lists so provider punctuation never leaks into the reading UI. */
function SummaryMarkdown({ text }: { text: string }) {
  const lines = text.split('\n')
  const blocks: ReactNode[] = []
  let index = 0
  while (index < lines.length) {
    const line = lines[index].trim()
    if (!line) {
      index += 1
      continue
    }
    const heading = line.match(/^#{1,4}\s+(.+)$/)
    if (heading) {
      blocks.push(<h3 key={`heading-${index}`} className="text-[13px] font-semibold leading-relaxed text-ink">{renderRich(heading[1])}</h3>)
      index += 1
      continue
    }
    const unordered = line.match(/^[-*]\s+(.+)$/)
    const ordered = line.match(/^\d+[.)]\s+(.+)$/)
    if (unordered || ordered) {
      const orderedList = !!ordered
      const items: ReactNode[] = []
      while (index < lines.length) {
        const match = lines[index].trim().match(orderedList ? /^\d+[.)]\s+(.+)$/ : /^[-*]\s+(.+)$/)
        if (!match) break
        items.push(<li key={`item-${index}`}>{renderRich(match[1])}</li>)
        index += 1
      }
      const List = orderedList ? 'ol' : 'ul'
      blocks.push(<List key={`list-${index}`} className={`${orderedList ? 'list-decimal' : 'list-disc'} space-y-1 pl-5`}>{items}</List>)
      continue
    }
    const paragraph: string[] = []
    while (index < lines.length) {
      const next = lines[index].trim()
      if (!next || /^#{1,4}\s+/.test(next) || /^[-*]\s+/.test(next) || /^\d+[.)]\s+/.test(next)) break
      paragraph.push(next)
      index += 1
    }
    blocks.push(<p key={`paragraph-${index}`}>{renderRich(paragraph.join(' '))}</p>)
  }
  return <div className="space-y-2 text-[13px] leading-relaxed text-ink">{blocks}</div>
}
