/** ── The locus gutter (social S2, SOCIAL-6b) ────────────────────────────────
 *  Discussion at the granularity that matters: a thread anchored to ONE POSITION
 *  inside an entity — a turn of a conversation, a run of a routine — rather than
 *  the whole thing. This is the ONE place an `AnchorLocus` is MINTED from a UI
 *  surface; `src/lib/anchorLocus.ts` is where one is resolved back.
 *
 *  Generic over the anchor by construction (the GrantsPanel rule): a surface
 *  that has addressable positions hands it a subject + a locus + the words for
 *  that kind of position, and gets the same affordance every other surface has.
 *  Two hand-written gutters would be two places for the composer, the
 *  get-or-create match and the door to drift.
 *
 *  The affordance follows GitHub's line gutter and costs its host nothing when
 *  unused: the opener is HOVER-REVEALED (invisible until the row is hovered) and
 *  the marker appears only once a thread exists. A conversation is this app's
 *  most sacred surface; a social feature may not tax it with permanent chrome.
 *
 *  READING happens on the thread's own page. Composing is inline because a
 *  comment's whole value is being written next to what it's about — but a
 *  discussion is a lifecycle entity, and this repo already decided a lifecycle
 *  wants a TIMELINE page (`/discussions/:did`, surface-from-nature). So the
 *  marker is a door, not an expander: position → thread page → back to the
 *  position (the `AnchorChip` resolves the locus and flashes it). */
import { useState } from 'react'
import { MessageSquarePlus, MessagesSquare } from 'lucide-react'
import type { AnchorLocus, Discussion, SocialEntityRef } from '../../contract/index.ts'
import { useDiscussions, useSocialCapability } from '../api'
import { useRelations } from '../controller/useRelations'
import { HOVER_REVEAL } from '../lib/hoverReveal'
import { AnchorThreadComposer } from './AnchorThreadComposer'

/** The thread hanging on exactly this position, if any. Exported for the lock
 *  test: the match is on the LOCUS, so a subject's ROOT thread can never be
 *  mistaken for a position's (and one position's never for another's).
 *  Structural, like the server's `sameLocus` — every variant is a flat record of
 *  scalars, so one comparison serves every kind. */
export function threadAt(threads: Discussion[], locus: AnchorLocus): Discussion | null {
  return (
    threads.find((d) => {
      const held = d.anchor.locus
      if (!held || held.kind !== locus.kind) return false
      const keys = new Set([...Object.keys(held), ...Object.keys(locus)])
      return [...keys].every((k) => (held as Record<string, unknown>)[k] === (locus as Record<string, unknown>)[k])
    }) ?? null
  )
}

export function LocusGutter({
  subject,
  locus,
  /** What one of these positions is called, in the opener ("Discuss this turn").
   *  Lowercase — it reads as the tail of a sentence. */
  noun,
  /** False when the subject doesn't exist server-side yet (an unsent draft
   *  conversation): nothing to anchor to, and asking would 404 every render. */
  enabled = true,
}: {
  subject: SocialEntityRef
  locus: AnchorLocus
  noun: string
  enabled?: boolean
}) {
  const rel = useRelations()
  // One query per SUBJECT (cache-keyed by the anchor ref), not per position —
  // the cache entry is shared, so every row of a surface reads one fetch.
  const threads = useDiscussions(subject.kind, subject.id, enabled).data ?? []
  const thread = threadAt(threads, locus)
  // Capability shapes affordances (src/CLAUDE.md): a `view`-tier reader may READ
  // every thread and may not post to any, so they get the marker and no opener.
  // Offering an act the write path refuses is worse on a surface like this than
  // anywhere else — there is one gutter per turn, so a dead affordance is dead
  // fifty times over.
  const canComment = useSocialCapability(subject.kind, subject.id, enabled).data?.canComment === true
  const [composing, setComposing] = useState(false)
  if (!enabled) return null

  return (
    // A tight strip: the gutter costs every row its own height, so it stays as
    // close to the content as the hit target allows.
    <div className="mt-0.5">
      <div className="flex items-center gap-1.5">
        {thread && (
          <button
            onClick={() => rel.navigate('discussions', thread.id)}
            title={`Open this ${noun}’s thread`}
            className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] text-ink-faint transition hover:bg-panel-2 hover:text-ink"
          >
            <MessagesSquare size={12} />
            <span className="tabular-nums">{thread.posts.length}</span>
          </button>
        )}
        {!composing && canComment && (
          <button
            onClick={() => setComposing(true)}
            title={`Discuss this ${noun}`}
            className={`flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] text-ink-faint transition hover:bg-panel-2 hover:text-ink focus-visible:opacity-100 ${HOVER_REVEAL}`}
          >
            <MessageSquarePlus size={12} />
            {thread ? 'Reply' : `Discuss this ${noun}`}
          </button>
        )}
      </div>
      {composing && (
        <div className="mt-1.5">
          <AnchorThreadComposer
            subject={subject}
            thread={thread}
            locus={locus}
            placeholder={thread ? `Reply to this ${noun}’s thread…` : `Start a thread on this ${noun}…`}
            autoFocus
            onPosted={() => setComposing(false)}
            onCancel={() => setComposing(false)}
          />
        </div>
      )}
    </div>
  )
}
