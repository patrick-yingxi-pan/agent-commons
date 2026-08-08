/** The shared input style — one source so every text field in the app reads the
 *  same (form follows function, src/CLAUDE.md). Lives in `lib/` rather than
 *  beside its first caller so components outside the section tree — the
 *  conversation's turn composer among them — can share the cue instead of
 *  re-hardcoding it. Locked by `tests/form-input.test.ts`.
 *
 *  ── Two shapes, one look ────────────────────────────────────────────────────
 *  A field that is only a field wears the whole cue itself (`FORM_INPUT_CLASS`).
 *  A field that HOSTS a control of its own — a composer, whose submit belongs
 *  inside the box rather than floating beside it (owner directive 2026-08-08:
 *  "make the post button into the text box") — cannot: a border on the textarea
 *  would draw a box INSIDE the box, and the focus answer would light the inner
 *  edge while the outer one, the one the reader sees as the field, stayed dead.
 *
 *  So the cue is split at its natural seam. The CHROME (frame, ground, radius,
 *  focus answer) moves to a shell the field and its buttons share; the CONTROL
 *  keeps only what a control has (type, ground-transparent, its own inset). The
 *  pieces are declared once below, so the two shapes cannot drift into two
 *  different-looking fields — which is the whole reason this module exists. */

/** Frame + ground + radius. Whichever element wears this IS the field, visually
 *  — so it is also the element that must answer focus. */
const FIELD_CHROME = 'w-full rounded-md border border-line bg-surface transition'

/** How text reads inside a field, wherever the frame happens to be. */
const FIELD_TEXT = 'text-[14px] text-ink outline-none placeholder:text-ink-faint'

/** The plain field: chrome and control on one element. `focus:border-co` —
 *  field focus is a PLACE cue, so it answers in the co-color (the seat law,
 *  src/index.css). */
export const FORM_INPUT_CLASS = `${FIELD_CHROME} px-3 py-2 ${FIELD_TEXT} focus:border-co`

/** The composer's field: the same chrome on a SHELL that holds the control and
 *  its verbs on one baseline (`items-end`, so the submit stays pinned to the
 *  bottom-right as the box grows). `focus-within` rather than `focus` because
 *  the element wearing the frame is no longer the element taking the caret —
 *  miss that and the field simply stops answering focus. */
export const FIELD_SHELL_CLASS = `${FIELD_CHROME} flex items-end gap-1.5 p-1.5 focus-within:border-co`

/** The control inside a shell: no frame, no ground of its own, and a smaller
 *  inset — the shell's padding supplies the rest, so text still starts 12px in,
 *  exactly where `FORM_INPUT_CLASS`'s `px-3` puts it. */
export const FIELD_BARE_CLASS = `min-w-0 flex-1 bg-transparent px-1.5 py-1.5 ${FIELD_TEXT}`
