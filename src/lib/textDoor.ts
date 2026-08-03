/** ── The text door ────────────────────────────────────────────────────────────
 *  A word that opens a page. Three surfaces spell the same act: a list row's
 *  TITLE fronting its entity (the titles-are-doors rule, src/CLAUDE.md), a NAME
 *  inside a metadata line ("· in ‹project›", "View the work"), and an owner /
 *  source byline that stays underlined at rest. Same role ⇒ same look, so the
 *  cue is defined once here (form follows function, like lib/inlineAction and
 *  lib/hoverReveal).
 *
 *  It was the last parallel-control rule in this repo with a documented rule but
 *  NO primitive and no lock, and it had drifted exactly as far as that implies:
 *  eighteen hand-rolled spellings, `transition` on two of eleven title doors (so
 *  most snapped on hover while two eased), one door that had silently dropped
 *  `font-medium` (the UI-14 drift shape, repeated), one metadata door with no
 *  color token at all, and — inside PublicFace itself, under a comment promising
 *  consumers would never touch the class — a verbatim retype of the module's own
 *  OWNER_LINK_CLASS. The lock that should have caught the strays greped a single
 *  file. See docs/ui-invariants.md UI-16.
 *
 *  ── What the cue owns, and what the caller owns ──
 *  These strings carry the DOOR-NESS: the weight and the underline behaviour.
 *  Callers append COLOR, SIZE and LAYOUT, and must, because both genuinely vary
 *  by container and neither is what drifts:
 *    • size — a door has to match the type scale of its own non-door sibling. In
 *      CommonsCardHead the title is 14px whether or not it opens anything
 *      (SectionView.tsx, the `onOpen ? <button …> : <div …>` pair); a compact
 *      list row's is 13px. Baking one size in would break the pair.
 *    • color — nine title doors are `text-ink`, but a RETRACTED work item's door
 *      is `text-ink-faint line-through`. Two conflicting `text-*` utilities in
 *      one class attribute have no defined winner (the cascade orders by the
 *      generated sheet, not by the attribute), so the color must be chosen once,
 *      at the call site, exactly as those ternaries already do it.
 *  The convention callers should follow: a row's title door is `text-ink`; a
 *  door inside a metadata line is `text-ink-soft`.
 *
 *  Plain strings (no JSX, no imports) so the DOM-less Node test runner can
 *  import and assert them — tests/text-door.test.ts scans every file under src/
 *  and fails if a component spells a door by hand.
 *
 *  NOT this role, deliberately — don't "helpfully" unify these:
 *    • an EXTERNAL `<a href>` (the relay setup + A2A links) — leaving the app is
 *      a different promise from opening a page in it, and it wears `text-accent`
 *      to say so.
 *    • the dotted provenance opener (an imported agent card's source URL) — a
 *      dotted underline is the "this reveals detail" cue, not a door.
 *    • the sign-in flow's links — already funnelled as AUTH_LINK_CLASS in
 *      lib/authFlow.ts, which owns the auth screens' whole cue set.
 *    • a quiet ghost text action that DOES something rather than going somewhere
 *      (Retract, "Mark all read", the prompt probe) — that is INLINE_ACTION_CLASS. */

/** The door cue: a title or an inline name that underlines on hover. Append the
 *  color, the size, and any layout (`truncate`, `block max-w-full text-left`,
 *  `min-w-0 flex-1`). Semibold since the Claret candidate landed — its ledger
 *  rows carry visibly bold title doors (the GitHub repo-list weight), and one
 *  weight for every door means every door bolds together. */
export const DOOR_CLASS = 'font-semibold transition hover:underline'

/** The STANDING door — underlined at rest, not just on hover: the owner byline
 *  ("by Ada Lab"), a CreditLine count that opens its lineage, an artifact's
 *  "From ‹source›". Standing underline because these sit inside prose that
 *  gives them no other affordance cue. Append the hover color the container
 *  wants (`hover:text-ink` on its own, `group-hover:text-ink` inside a larger
 *  button). */
export const STANDING_DOOR_CLASS = 'underline decoration-line-strong underline-offset-2 transition'
