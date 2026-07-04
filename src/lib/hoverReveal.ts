/** ── Shared cue: hover-revealed row affordances ──────────────────────────────
 *  The "appears when you hover the row" idiom (trash / run / edit buttons,
 *  pencil and chevron cues) — one primitive, two narrow-tier behaviours:
 *
 *    • HOVER_REVEAL — real *controls*: sole affordances like a chip's trash or
 *      a row's connect/disconnect. Touch has no hover, so below `sm` they are
 *      PERSISTENT (`max-sm:opacity-100`) — visible and tappable, never an
 *      invisible tap target.
 *    • HOVER_CUE — decorative hover *hints* (a pencil beside an editable
 *      title, a chevron on a drill-in row). Below `sm` they are GONE
 *      (`max-sm:hidden`) — a hint nobody can hover shouldn't reserve width.
 *
 *  The invariant this module owns (docs/ui-invariants.md UI-7): a
 *  hover-revealed element is persistent or absent on narrow — never
 *  `opacity-0`-but-space-reserving. Earned by the first /ui-review sweep:
 *  at 320px the Scheduled and Contexts rows' invisible action clusters starved
 *  the flex-1 name column to ~0px, leaving rows with no identity ("G…").
 *  Locked by tests/hoverReveal.test.ts — a component writing its own
 *  `group-hover:opacity-100` fails the scan. Callers add their own focus
 *  variants, colors, and layout. */
export const HOVER_REVEAL = 'opacity-0 transition group-hover:opacity-100 max-sm:opacity-100'
export const HOVER_CUE = 'opacity-0 transition group-hover:opacity-100 max-sm:hidden'
