/** ── The ONE @-mention picker (social S8) ────────────────────────────────────
 *  The behaviour half of `lib/mentionPicker.ts`: arming, key ownership, the
 *  caret restore and the listbox, in one place, for every composer that invites
 *  a mention.
 *
 *  One home because these rules are the ones that go wrong SILENTLY and cost a
 *  whole fix pass the first time (fc5ec63): arming must belong to TYPING (a
 *  caret move that re-armed a finished mention let the next Enter splice the
 *  name in twice), the caret restore must be a layout effect (a
 *  `requestAnimationFrame` can beat React's flush, so the `select` it fires
 *  re-derives the query just completed), and an open picker OWNS Enter. That
 *  last one is why the host's own keys come through this hook rather than sitting
 *  beside it: a second host whose Enter submits — a single-line comment field —
 *  would otherwise post half a name, and no amount of care in that component
 *  could prevent it. Here it cannot happen, because the host's handler only runs
 *  when the picker declined the key.
 *
 *  The ROSTER is the host's to supply, and the rule it must satisfy is the one
 *  `mentionPicker.ts` states: names the viewer is already looking at or has
 *  already declared — a thread's voices, a work item's participants, the people
 *  they follow. Never a directory (COMMONS-22: the client gets no enumerable
 *  name list, or a mention becomes an identity oracle). */
import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
  type SyntheticEvent,
} from 'react'
import { createPortal } from 'react-dom'
import { applyMention, mentionQuery, narrowMention, suggestMentions, MAX_MENTION_SUGGESTIONS } from './mentionPicker'
import { clampLeft, POPOVER_MARGIN, POPOVER_SURFACE } from './popover'

type MentionField = HTMLInputElement | HTMLTextAreaElement

/** The list's width, before the shared clamp narrows it on a small viewport. */
const LIST_WIDTH = 256
/** Between the field's edge and the list. */
const GAP = 4
/** One option's height (`py-1.5` + a 13px line) — used only to decide whether
 *  the list fits BELOW the field, so an estimate is enough. */
const OPTION_H = 32

export interface MentionPicker<T extends MentionField> {
  /** The picker is showing options — and therefore owns Enter / Tab / the
   *  arrows. Exposed so a host can tell WHY its own key didn't fire. */
  open: boolean
  /** Spread onto the field. `value` and the styling stay the host's.
   *
   *  The `aria-*` trio is the half a completion list cannot supply itself: the
   *  arrows move a selection the field still holds focus for, so without
   *  `aria-activedescendant` a screen-reader user hears nothing change (the
   *  combobox pattern, minus `role="combobox"` — that would overwrite a
   *  multi-line composer's own textbox semantics, and `aria-autocomplete` says
   *  the same thing without the trade). */
  fieldProps: {
    ref: RefObject<T | null>
    onChange: (e: ChangeEvent<T>) => void
    onKeyDown: (e: KeyboardEvent<T>) => void
    onBlur: () => void
    onSelect: (e: SyntheticEvent<T>) => void
    'aria-autocomplete': 'list' | 'none'
    'aria-controls': string | undefined
    'aria-activedescendant': string | undefined
  }
  /** The listbox, or `null`. It PORTALS to the body, so it may be rendered
   *  anywhere near the field — it takes its position from the field's own rect,
   *  not from its place in the tree. */
  list: ReactNode
  /** Close the picker — for a host that clears the draft itself (every submit
   *  does), since a programmatic clear never reaches `onChange`. */
  close: () => void
}

export function useMentionPicker<T extends MentionField>({
  roster,
  draft,
  setDraft,
  onKeyDown,
}: {
  roster: string[]
  draft: string
  setDraft: (next: string) => void
  /** The host's own keys. Runs ONLY when the picker did not consume the event,
   *  so "Enter posts" and "Enter completes the name" can never both fire. */
  onKeyDown?: (e: KeyboardEvent<T>) => void
}): MentionPicker<T> {
  const fieldRef = useRef<T>(null)
  const [mention, setMention] = useState<{ at: number; query: string } | null>(null)
  const [armed, setArmed] = useState(0)
  // Per INSTANCE, not a module constant: a page hosts several composers (a
  // routine's root thread and one of its runs'), and two lists sharing an id
  // would point every field at the first one's options.
  const listId = useId()
  const optionId = (i: number) => `${listId}-opt-${i}`
  // Stable while the roster is: recomputing per keystroke re-ranked an answer
  // that had not changed.
  const options = useMemo(() => (mention ? suggestMentions(roster, mention.query) : []), [roster, mention])

  /** ── Why the list PORTALS rather than anchoring in place ───────────────────
   *  A composer is not always in an open box. The work-item comment field sits
   *  inside a `CardList`, and the shared ledger recipe gives that container
   *  `overflow-hidden` (its rounded corners need it) — so a CSS-anchored list
   *  was cut off by the row it belongs to, found in the running app and visible
   *  in no unit test. A completion list must escape its container, which is
   *  exactly what this repo's PORTALED popovers already do (`RowMenu`,
   *  `FilterMenu`, `RecentOverflowList`): position fixed from the anchor's own
   *  rect, contained by the shared `clampLeft`.
   *
   *  Recomputed on every option change — the list re-renders per keystroke
   *  anyway — and on scroll/resize, because unlike those menus this one stays
   *  open while the writer types, and a fixed surface left behind by a scroll
   *  points at nothing. */
  const [pos, setPos] = useState<{ left: number; top: number; width: number } | null>(null)
  const place = () => {
    const el = fieldRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    const width = Math.min(LIST_WIDTH, window.innerWidth - 2 * POPOVER_MARGIN)
    // Below the field, flipping above when the bottom margin can't hold it —
    // the list is short, so a flip beats a scroll.
    const height = Math.min(options.length, MAX_MENTION_SUGGESTIONS) * OPTION_H + 8
    const below = r.bottom + GAP
    const top = below + height > window.innerHeight - POPOVER_MARGIN ? Math.max(POPOVER_MARGIN, r.top - GAP - height) : below
    const left = clampLeft(r.left, width, window.innerWidth)
    // Idempotent by VALUE, not by identity. Measuring is a render input here —
    // `setPos` runs from an effect that a re-render re-fires — so returning a
    // fresh object for an unchanged position is an infinite update loop, which
    // is exactly how the first cut blanked the page (React: "Maximum update
    // depth exceeded", found in the running app).
    setPos((p) => (p && p.left === left && p.top === top && p.width === width ? p : { left, top, width }))
  }
  // Re-measured whenever the list or the text changes — a caret that pushes the
  // field onto a second line moves the anchor.
  useLayoutEffect(place, [options, draft])
  // …and while it is open, on any ancestor's scroll (capture: the split
  // workspace scrolls PANES, not the page) or a resize. Unlike this repo's other
  // portaled menus, a completion list stays open while the writer types, so a
  // position measured once would drift off its field.
  const placeRef = useRef(place)
  // Refreshed in an effect, not during render: a render-phase ref write is a
  // side effect React is allowed to discard (a re-render it throws away would
  // leave the listener holding a closure that never ran).
  useEffect(() => {
    placeRef.current = place
  })
  useEffect(() => {
    if (options.length === 0) return
    const onMove = () => placeRef.current()
    window.addEventListener('scroll', onMove, true)
    window.addEventListener('resize', onMove)
    return () => {
      window.removeEventListener('scroll', onMove, true)
      window.removeEventListener('resize', onMove)
    }
  }, [options.length])

  /** Where the caret belongs once the accepted draft has RENDERED. A layout
   *  effect rather than a `requestAnimationFrame`, because the frame can land
   *  before React flushes: `setSelectionRange` fires `select`, and a `select`
   *  read against the PRE-accept value re-derives the query that was just
   *  completed — so the picker re-opened offering the name it had inserted, and
   *  the next Enter (a newline, as far as the writer is concerned) inserted it
   *  twice. Sequencing the restore after the draft removes the race instead of
   *  flagging it. */
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
    const next = applyMention(draft, mention.at, fieldRef.current?.selectionStart ?? draft.length, name)
    setDraft(next.text)
    setMention(null)
    pendingCaret.current = next.caret
  }

  return {
    open: options.length > 0,
    close: () => setMention(null),
    fieldProps: {
      ref: fieldRef,
      'aria-autocomplete': options.length > 0 ? 'list' : 'none',
      'aria-controls': options.length > 0 ? listId : undefined,
      'aria-activedescendant': options.length > 0 ? optionId(armed) : undefined,
      onChange: (e) => {
        const el = e.currentTarget
        setDraft(el.value)
        // TYPING arms the picker — only typing.
        setMention(mentionQuery(el.value, el.selectionStart ?? el.value.length))
        setArmed(0)
      },
      onKeyDown: (e) => {
        if (options.length === 0) {
          onKeyDown?.(e)
          return
        }
        // While the picker is open it owns these keys — Enter must complete the
        // name, not drop a newline into the middle of it (or post it).
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          e.preventDefault()
          setArmed((i) => (i + (e.key === 'ArrowDown' ? 1 : options.length - 1)) % options.length)
        } else if (e.key === 'Enter' || e.key === 'Tab') {
          e.preventDefault()
          accept(options[armed])
        } else if (e.key === 'Escape') {
          e.preventDefault()
          setMention(null)
        } else {
          onKeyDown?.(e)
        }
      },
      onBlur: () => setMention(null),
      onSelect: (e) => {
        const el = e.currentTarget
        const caret = el.selectionStart ?? el.value.length
        /** A caret move may only INVALIDATE an open picker, never open one.
         *
         *  Gated on the picker being VISIBLE, not merely on `mention` being set.
         *  An `@` anywhere before the caret leaves a query that matches nothing
         *  — an armed-but-invisible state — and narrowing from THAT is how the
         *  draft corruption survived its first fix: typing the whole line left
         *  "Grace Hopper for the review" armed and unseen, and a later click
         *  inside the name narrowed it back to "Grace ", which had options
         *  again. */
        if (options.length === 0) {
          if (mention) setMention(null)
          return
        }
        setMention(narrowMention(mention, el.value, caret))
      },
    },
    list:
      options.length > 0 && pos ?
        // A completion list, not a menu: it sits under the field it edits and
        // dies with the blur, so it needs no outside-click machinery. It takes
        // the shared containment because a composer renders inside panes as
        // narrow as the rail (UI-1).
        createPortal(
        <ul
          id={listId}
          role="listbox"
          aria-label="Mention someone"
          style={{ position: 'fixed', left: pos.left, top: pos.top, width: pos.width }}
          className={`z-[70] py-1 ${POPOVER_SURFACE}`}
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
              id={optionId(i)}
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
        </ul>,
        document.body,
        )
      : null,
  }
}
