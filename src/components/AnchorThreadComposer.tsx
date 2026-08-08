/** The ONE anchor-thread composer (social S2/S4/S6b).
 *
 *  Posts into the thread hanging on an ANCHOR — a subject, optionally at a
 *  position inside it — get-or-creating that thread on the first post. Shared by
 *  the entity page's Discussion panel, the Commons feed card, and the
 *  conversation's per-turn gutter, so "comment here" behaves identically in
 *  every projection of the same thread (form follows function, src/CLAUDE.md).
 *
 *  Get-or-create is the SERVER's rule, not this component's: an open onto an
 *  anchor that already carries a thread appends there (one public stream per
 *  (subject, locus) — `openDiscussion` in server/store.ts). So callers that
 *  don't already hold the thread may pass `thread: null` and still land in the
 *  right conversation — two clients racing the first post can't fork it. */
import { useState } from 'react'
import type { AnchorLocus, Discussion, SocialEntityRef } from '../../contract/index.ts'
import { openDiscussion, postToDiscussion } from '../api'
import { INLINE_ACTION_CLASS } from '../lib/inlineAction'
import { SOFT_BUTTON_CLASS } from '../lib/button'
import { composerRows, FIELD_BARE_CLASS, FIELD_SHELL_CLASS } from '../lib/formInput'

export function AnchorThreadComposer({
  subject,
  thread,
  locus,
  placeholder,
  ariaLabel,
  autoFocus,
  onPosted,
  onCancel,
}: {
  subject: SocialEntityRef
  /** The thread already on this anchor, when the caller holds it — used only to
   *  choose the cheaper append path and the placeholder's voice. */
  thread: Discussion | null
  /** The position inside the subject this thread hangs on. Absent = the
   *  subject's ROOT thread (the original S2 rule). */
  locus?: AnchorLocus
  placeholder?: string
  /** The accessible name. Defaults to the SUBJECT's thread; a composer on a
   *  POSITION inside that subject passes its own, so two composers on one page
   *  (a routine's root thread and one of its runs') are never announced
   *  identically. */
  ariaLabel?: string
  autoFocus?: boolean
  /** Fired after a successful post — a transient composer (the turn gutter's)
   *  closes itself; a persistent one (the entity panel's) ignores it. Receives
   *  the thread the post landed in, which the caller often cannot know in
   *  advance: get-or-create is the server's rule, so "which conversation was
   *  that?" is only answerable from the response. The DM door uses it to open
   *  the thread it just started. */
  onPosted?: (thread: Discussion) => void
  /** Present ⇒ render a Cancel beside Post (a composer that was opened by an
   *  affordance must be closable without posting). */
  onCancel?: () => void
}) {
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const send = async () => {
    if (busy || !draft.trim()) return
    setBusy(true)
    setError(null)
    try {
      const landed =
        thread ?
          await postToDiscussion(thread.id, draft.trim(), subject)
        : await openDiscussion({ anchor: { ref: subject, ...(locus ? { locus } : {}) }, firstPost: draft.trim() })
      setDraft('')
      onPosted?.(landed)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not post.')
    } finally {
      setBusy(false)
    }
  }
  return (
    <div>
      {/* The verbs live INSIDE the field (owner directive 2026-08-08), on the
          box's own baseline — so the composer reads as one object rather than a
          field with controls drifting off its edge, and the submit stays pinned
          bottom-right as the box grows. The pair is ranked: Post is the
          affirmative soft verb, Cancel stays ghost text. Rendering both as the
          same grey text makes "send it" and "throw it away" look like one
          control typed twice. */}
      <div className={FIELD_SHELL_CLASS}>
        <textarea
          aria-label={ariaLabel ?? `Post to this ${subject.kind}’s discussion`}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={placeholder ?? (thread ? 'Reply…' : 'Start the discussion…')}
          rows={composerRows(draft, 6)}
          autoFocus={autoFocus}
          className={`${FIELD_BARE_CLASS} resize-none`}
        />
        {onCancel && (
          <button onClick={onCancel} className={`${INLINE_ACTION_CLASS} shrink-0 px-1 py-1.5`}>
            Cancel
          </button>
        )}
        {/* Named after its target, like the field above: a page can host two
            composers (a routine's root thread and one of its runs'), and two
            buttons announced identically as "Post" are ambiguous to a screen
            reader — and to a test. */}
        <button
          onClick={() => void send()}
          disabled={busy || !draft.trim()}
          aria-label={ariaLabel ?? `Post to this ${subject.kind}’s discussion`}
          className={`${SOFT_BUTTON_CLASS} shrink-0 px-3 py-1.5 text-[13px] disabled:opacity-45`}
        >
          Post
        </button>
      </div>
      {error && <p className="mt-1 text-[11px] text-danger">{error}</p>}
    </div>
  )
}
