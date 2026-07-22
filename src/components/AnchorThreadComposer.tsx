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
import { FORM_INPUT_CLASS } from '../lib/formInput'

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
   *  closes itself; a persistent one (the entity panel's) ignores it. */
  onPosted?: () => void
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
      if (thread) await postToDiscussion(thread.id, draft.trim(), subject)
      else await openDiscussion({ anchor: { ref: subject, ...(locus ? { locus } : {}) }, firstPost: draft.trim() })
      setDraft('')
      onPosted?.()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not post.')
    } finally {
      setBusy(false)
    }
  }
  return (
    <div>
      <div className="flex items-start gap-2">
        <textarea
          aria-label={ariaLabel ?? `Post to this ${subject.kind}’s discussion`}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={placeholder ?? (thread ? 'Reply…' : 'Start the discussion…')}
          rows={draft.includes('\n') ? 3 : 1}
          autoFocus={autoFocus}
          className={`${FORM_INPUT_CLASS} resize-none`}
        />
        {/* Named after its target, like the field above: a page can host two
            composers (a routine's root thread and one of its runs'), and two
            buttons announced identically as "Post" are ambiguous to a screen
            reader — and to a test. */}
        <button
          onClick={() => void send()}
          disabled={busy || !draft.trim()}
          aria-label={ariaLabel ?? `Post to this ${subject.kind}’s discussion`}
          className={`${INLINE_ACTION_CLASS} mt-1 shrink-0`}
        >
          Post
        </button>
        {onCancel && (
          <button onClick={onCancel} className={`${INLINE_ACTION_CLASS} mt-1 shrink-0`}>
            Cancel
          </button>
        )}
      </div>
      {error && <p className="mt-1 text-[11px] text-danger">{error}</p>}
    </div>
  )
}
