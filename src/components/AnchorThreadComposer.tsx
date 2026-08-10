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
import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { AnchorLocus, Discussion, SocialEntityRef } from '../../contract/index.ts'
import { openDiscussion, postToDiscussion } from '../api'
import { INLINE_ACTION_CLASS } from '../lib/inlineAction'
import { SOFT_BUTTON_CLASS } from '../lib/button'
import { composerRows, FIELD_BARE_CLASS, FIELD_SHELL_CLASS } from '../lib/formInput'
import { POPOVER_SURFACE } from '../lib/popover'
import { usePopoverShift } from '../lib/usePopoverShift'
import { applyMention, mentionQuery, narrowMention, suggestMentions, threadVoices } from '../lib/mentionPicker'

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
  // ── The @-mention picker (S8) ──────────────────────────────────────────────
  // A mention only rings if the author reproduces a whole display name, and
  // every name in this world contains a space — so the composer offers the
  // names this conversation has already heard rather than leaving the writer to
  // remember them. The roster is derived from the thread it is already given
  // (`threadVoices`), so this costs no fetch and mints no new wire face.
  const fieldRef = useRef<HTMLTextAreaElement>(null)
  const [mention, setMention] = useState<{ at: number; query: string } | null>(null)
  const [armed, setArmed] = useState(0)
  // The roster is stable while a thread is: recomputing it per keystroke walked
  // and reversed every post in the thread for an answer that had not changed.
  const voices = useMemo(() => threadVoices(thread), [thread])
  const options = mention ? suggestMentions(voices, mention.query) : []
  const popRef = usePopoverShift<HTMLUListElement>(options.length > 0)
  /** TYPING arms the picker — only typing. */
  const armFromEdit = (text: string, caret: number) => {
    setMention(mentionQuery(text, caret))
    setArmed(0)
  }
  /** A caret move may only INVALIDATE an open picker, never open one.
   *
   *  Arming on caret placement corrupted drafts: clicking inside a mention you
   *  finished minutes ago re-offered it, and since an open picker owns Enter,
   *  the next Enter — pressed for a newline — spliced the name in a second time
   *  ("thanks @Grace Hopper for the review" became "…@Grace Hopper Hopper for
   *  the review"). It also stole the arrow keys from caret navigation in a
   *  multi-line draft. The picker belongs to the mention BEING WRITTEN, so a
   *  caret that leaves that query closes it, and one that stays inside it just
   *  re-reads the query. */
  const narrowOnCaret = (text: string, caret: number) => {
    // Gated on the picker being VISIBLE, not merely on `mention` being set. An
    // `@` anywhere before the caret leaves a query that matches nothing — an
    // armed-but-empty state the user cannot see — and narrowing from THAT is
    // how the corruption survived its first fix: typing the whole line left
    // "Grace Hopper for the review" armed and invisible, and a later click
    // inside the name narrowed it back to "Grace ", which had options again.
    if (options.length === 0) {
      if (mention) setMention(null)
      return
    }
    setMention(narrowMention(mention, text, caret))
  }
  /** Where the caret belongs once the accepted draft has RENDERED. Applied in a
   *  layout effect rather than a `requestAnimationFrame`, because the frame can
   *  land before React flushes: `setSelectionRange` fires `select`, and a
   *  `select` read against the PRE-accept value re-derives the query that was
   *  just completed — so the picker re-opened offering the name it had inserted,
   *  and the next Enter (a newline, as far as the writer is concerned) inserted
   *  it twice. Sequencing the restore after the draft removes the race instead
   *  of flagging it. */
  const pendingCaret = useRef<number | null>(null)
  useLayoutEffect(() => {
    const to = pendingCaret.current
    if (to === null) return
    pendingCaret.current = null
    fieldRef.current?.focus()
    fieldRef.current?.setSelectionRange(to, to)
  }, [draft])
  const accept = (name: string) => {
    if (!mention || !name) return
    const field = fieldRef.current
    const next = applyMention(draft, mention.at, field?.selectionStart ?? draft.length, name)
    setDraft(next.text)
    setMention(null)
    pendingCaret.current = next.caret
  }
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
      setMention(null)
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
      {/* The positioning context is a WRAPPER, not the shell itself: the shell's
          cue is a shared primitive worn verbatim (a composer that hosts its own
          verbs wears FIELD_SHELL_CLASS), and the picker is anchored under the
          whole field rather than laid out inside its verb row. */}
      <div className="relative">
      <div className={FIELD_SHELL_CLASS}>
        <textarea
          ref={fieldRef}
          aria-label={ariaLabel ?? `Post to this ${subject.kind}’s discussion`}
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value)
            armFromEdit(e.target.value, e.target.selectionStart ?? e.target.value.length)
          }}
          onKeyDown={(e) => {
            if (options.length === 0) return
            // While the picker is open it owns these keys — Enter must complete
            // the name, not drop a newline into the middle of it.
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
              e.preventDefault()
              setArmed((i) => (i + (e.key === 'ArrowDown' ? 1 : options.length - 1)) % options.length)
            } else if (e.key === 'Enter' || e.key === 'Tab') {
              e.preventDefault()
              accept(options[armed])
            } else if (e.key === 'Escape') {
              e.preventDefault()
              setMention(null)
            }
          }}
          onBlur={() => setMention(null)}
          onSelect={(e) => {
            const el = e.currentTarget
            narrowOnCaret(el.value, el.selectionStart ?? el.value.length)
          }}
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
      {options.length > 0 && (
        // A completion list, not a menu: it sits under the field it edits and
        // dies with the blur, so it needs no outside-click machinery. It takes
        // the shared containment because a composer renders inside panes as
        // narrow as the rail (UI-1).
        <ul
          ref={popRef}
          role="listbox"
          aria-label="Mention someone"
          className={`absolute left-0 top-full z-40 mt-1 w-64 max-w-full py-1 ${POPOVER_SURFACE}`}
        >
          {options.map((name, i) => (
            // The `li` IS the option. A `listbox` owns `option`s, so wrapping
            // them in list items put a `listitem` between the two and left the
            // listbox owning nothing a screen reader would read as a choice.
            // It is deliberately not a BUTTON either: the field keeps focus and
            // drives the picker with the arrows, so an option must not be a tab
            // stop of its own (the combobox pattern).
            <li
              key={name}
              role="option"
              aria-selected={i === armed}
              // The field keeps focus: mousedown fires before blur, so the
              // picker isn't torn down before the click it was clicked for.
              onMouseDown={(ev) => {
                ev.preventDefault()
                accept(name)
              }}
              onMouseEnter={() => setArmed(i)}
              className={`flex w-full cursor-pointer items-center gap-1.5 px-3 py-1.5 text-left text-[13px] transition ${
                i === armed ? 'bg-panel-2 text-ink' : 'text-ink-soft'
              }`}
            >
              {/* Decorative: the option IS the name, and two text-bearing
                  children would splice a space into its accessible name
                  ("@ Grace Hopper") — neither what it reads as nor what a
                  test can address. */}
              <span aria-hidden="true" className="text-ink-faint">
                @
              </span>
              <span className="truncate">{name}</span>
            </li>
          ))}
        </ul>
      )}
      </div>
      {error && <p className="mt-1 text-[11px] text-danger">{error}</p>}
    </div>
  )
}
