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
 *  (subject, locus) — `openDiscussion` in server/store/index.ts). So callers that
 *  don't already hold the thread may pass `thread: null` and still land in the
 *  right conversation — two clients racing the first post can't fork it. */
import { useEffect, useMemo, useState } from 'react'
import type { AnchorLocus, Discussion, SocialEntityRef } from '../../contract/index.ts'
import { useMe } from '../api'
import {
  enqueueThreadPost,
  isSocialPostMutationHeld,
  useSocialPostMutationStatus,
} from '../controller/socialPostMutations.ts'
import { INLINE_ACTION_CLASS } from '../lib/inlineAction'
import { SOFT_BUTTON_CLASS } from '../lib/button'
import { composerRows, FIELD_BARE_CLASS, FIELD_SHELL_CLASS } from '../lib/formInput'
import { threadVoices } from '../lib/mentionPicker'
import { useMentionPicker } from '../lib/useMentionPicker'

export function AnchorThreadComposer({
  subject,
  thread,
  locus,
  placeholder,
  ariaLabel,
  autoFocus,
  onPosted,
  onCancel,
  replyTo,
  onHeldChange,
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
  /** Answer ONE post rather than the thread (S9). Only meaningful with a
   *  `thread` — there is nothing to answer in a conversation that does not
   *  exist yet, which is why the open path below ignores it rather than
   *  inventing a parent. Any post in the thread is a valid parent, at any
   *  depth: the reply lands where it was aimed, and how deep that is becomes
   *  the reader's problem to fold, not the writer's to lose. */
  replyTo?: string
  /** Lets a disclosure/popover keep the exact composer mounted while its post
   *  is uncertain. Every duplicate projection observes the controller hold. */
  onHeldChange?: (held: boolean) => void
}) {
  const [draft, setDraft] = useState('')
  const [acting, setActing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const tenantId = useMe().data?.tenant.id
  useSocialPostMutationStatus()
  const anchorLocus = thread?.anchor.locus ?? locus
  const sharedHeld = isSocialPostMutationHeld(subject, anchorLocus)
  const held = acting || sharedHeld
  useEffect(() => onHeldChange?.(held), [held, onHeldChange])
  // ── The @-mention picker (S8) ──────────────────────────────────────────────
  // A mention only rings if the author reproduces a whole display name, and
  // every name in this world contains a space — so the composer offers the
  // names this conversation has already heard rather than leaving the writer to
  // remember them. The roster is derived from the thread it is already given
  // (`threadVoices`), so this costs no fetch and mints no new wire face; the
  // BEHAVIOUR is the one shared picker, so a second host cannot re-derive the
  // arming rules that took a fix pass to get right (lib/useMentionPicker).
  // The roster is stable while a thread is: recomputing it per keystroke walked
  // and reversed every post in the thread for an answer that had not changed.
  const voices = useMemo(() => threadVoices(thread), [thread])
  const mention = useMentionPicker<HTMLTextAreaElement>({
    roster: voices,
    draft,
    setDraft,
    // Ctrl/⌘+Enter posts (owner directive 2026-08-11). Routed THROUGH the hook
    // rather than declared on the element, because an open picker owns Enter:
    // this way the shortcut cannot fire while a half-typed name is being
    // completed, and the writer never posts "@Grace Ho". Plain Enter stays a
    // newline — this is a multi-line composer and a post is prose. `send` is
    // referenced before its declaration on purpose: the two close over each
    // other (the send path tells the picker to close), and a key event can only
    // arrive long after both exist.
    onKeyDown: (e) => {
      if (e.key !== 'Enter' || !(e.ctrlKey || e.metaKey)) return
      e.preventDefault()
      void send()
    },
  })
  const send = async () => {
    const body = draft.trim()
    if (held || !body) return
    if (!tenantId) {
      setError('Sign in again before posting.')
      return
    }
    setActing(true)
    setError(null)
    onHeldChange?.(true)
    try {
      const result = await enqueueThreadPost({
        tenantId,
        subject,
        ...(thread ? { discussionId: thread.id } : {}),
        ...(anchorLocus ? { locus: anchorLocus } : {}),
        body,
        ...(replyTo !== undefined ? { replyTo } : {}),
      })
      if (result.outcome === 'applied' && result.discussion) {
        setDraft('')
        // The clear never reaches the field's `onChange`, so the picker is told.
        mention.close()
        onPosted?.(result.discussion)
      } else if (result.outcome === 'discarded') {
        setError('That post was not applied. Your words are still here.')
      } else {
        setError('The post landed, but its thread could not be confirmed. Refresh the thread before posting again.')
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not start that post.')
    } finally {
      setActing(false)
      onHeldChange?.(isSocialPostMutationHeld(subject, anchorLocus))
    }
  }
  return (
    <div aria-busy={held || undefined}>
      {/* The verbs live INSIDE the field (owner directive 2026-08-08), on the
          box's own baseline — so the composer reads as one object rather than a
          field with controls drifting off its edge, and the submit stays pinned
          bottom-right as the box grows. The pair is ranked: Post is the
          affirmative soft verb, Cancel stays ghost text. Rendering both as the
          same grey text makes "send it" and "throw it away" look like one
          control typed twice. */}
      <fieldset disabled={held} className="min-w-0 border-0 p-0">
        <div className={FIELD_SHELL_CLASS}>
          <textarea
            {...mention.fieldProps}
            aria-label={ariaLabel ?? `Post to this ${subject.kind}’s discussion`}
            value={draft}
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
            disabled={held || !draft.trim()}
            aria-label={ariaLabel ?? `Post to this ${subject.kind}’s discussion`}
            // The shortcut is discoverable from the control it fires — a keystroke
            // nothing on screen mentions is a keystroke only its author knows.
            // ⌘+Enter works too and is deliberately not spelled out: naming both
            // in a tooltip costs more reading than the Mac reflex it would serve.
            title="Post (Ctrl+Enter)"
            className={`${SOFT_BUTTON_CLASS} shrink-0 px-3 py-1.5 text-[13px] disabled:opacity-45`}
          >
            {acting ? 'Posting…' : 'Post'}
          </button>
        </div>
      </fieldset>
      {mention.list}
      {error && <p role="alert" className="mt-1 text-[11px] text-danger">{error}</p>}
    </div>
  )
}
