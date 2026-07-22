/** ── The turn gutter (social S2, SOCIAL-6b) ─────────────────────────────────
 *  Discussion at the granularity that matters: a thread anchored to ONE TURN of
 *  a conversation rather than the whole session. This is where a `session-turn`
 *  anchor locus is MINTED; `src/lib/anchorLocus.ts` is where one is resolved
 *  back to this spot.
 *
 *  The affordance follows GitHub's line gutter and costs the conversation
 *  nothing when unused: the opener is HOVER-REVEALED (invisible until the turn
 *  is hovered — `SECTION_REVEAL`), and the marker appears only once a thread
 *  actually exists. The conversation is this app's most sacred surface; a social
 *  feature may not tax it with permanent chrome.
 *
 *  READING happens on the thread's own page. Composing is inline because a
 *  comment's whole value is being written next to what it's about — but a
 *  discussion is a lifecycle entity, and this repo already decided a lifecycle
 *  wants a TIMELINE page (`/discussions/:did`, surface-from-nature). So the
 *  marker is a door, not an expander: turn → thread page → back to the turn
 *  (the `AnchorChip` resolves the locus and flashes it). */
import { useState } from 'react'
import { MessageSquarePlus, MessagesSquare } from 'lucide-react'
import type { Discussion } from '../../contract/index.ts'
import { useDiscussions } from '../api'
import { DRAFT_ID } from '../data/liveSession'
import { useRelations } from '../controller/useRelations'
import { HOVER_REVEAL } from '../lib/hoverReveal'
import { AnchorThreadComposer } from './AnchorThreadComposer'

/** The thread hanging on one turn, if any. Exported for the lock test: the
 *  match is on the LOCUS, so a session's root thread can never be mistaken for
 *  a turn's (and vice versa). */
export function threadOnTurn(threads: Discussion[], messageId: string): Discussion | null {
  return (
    threads.find((d) => d.anchor.locus?.kind === 'session-turn' && d.anchor.locus.messageId === messageId) ?? null
  )
}

export function TurnDiscussion({ sessionId, messageId }: { sessionId: string; messageId: string }) {
  const rel = useRelations()
  // An UNSENT draft has no server-side session, so its turns aren't addressable
  // — there is nothing for an anchor to point at, and asking would 404 on every
  // render. The gutter appears the moment the draft materializes.
  const real = sessionId !== DRAFT_ID
  // One query per SESSION (cache-keyed by the anchor ref), not per turn — the
  // cache entry is shared, so every row of a conversation reads one fetch.
  const threads = useDiscussions('session', sessionId, real).data ?? []
  const thread = threadOnTurn(threads, messageId)
  const [composing, setComposing] = useState(false)
  const subject = { kind: 'session', id: sessionId } as const
  const locus = { kind: 'session-turn', messageId } as const
  if (!real) return null

  return (
    // A tight strip: the gutter costs every turn its own height, so it stays as
    // close to the message as the hit target allows.
    <div className="mt-0.5">
      <div className="flex items-center gap-1.5">
        {thread && (
          <button
            onClick={() => rel.navigate('discussions', thread.id)}
            title="Open this turn’s thread"
            className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] text-ink-faint transition hover:bg-panel-2 hover:text-ink"
          >
            <MessagesSquare size={12} />
            <span className="tabular-nums">{thread.posts.length}</span>
          </button>
        )}
        {!composing && (
          <button
            onClick={() => setComposing(true)}
            title="Discuss this turn"
            className={`flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] text-ink-faint transition hover:bg-panel-2 hover:text-ink focus-visible:opacity-100 ${HOVER_REVEAL}`}
          >
            <MessageSquarePlus size={12} />
            {thread ? 'Reply' : 'Discuss this turn'}
          </button>
        )}
      </div>
      {composing && (
        <div className="mt-1.5">
          <AnchorThreadComposer
            subject={subject}
            thread={thread}
            locus={locus}
            placeholder={thread ? 'Reply to this turn’s thread…' : 'Start a thread on this turn…'}
            autoFocus
            onPosted={() => setComposing(false)}
            onCancel={() => setComposing(false)}
          />
        </div>
      )}
    </div>
  )
}
