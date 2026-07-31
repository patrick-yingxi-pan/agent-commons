/** ── The ledger ───────────────────────────────────────────────────────────────
 *  The flat-collection recipe (owner directive 2026-07-31): a collection of
 *  entities renders as ONE bordered container with hairline-divided rows — the
 *  GitHub repo-file-list idiom — never as a pile of per-item cards. Chosen over
 *  the card grid because the card chrome (16px radius + shadow + surface fill on
 *  the two-tone ground) out-talked the content it carried; the diagnosis and the
 *  direction comparison live in the 2026-07-31 design brainstorm. Elevation now
 *  means FLOATING: shadows are for overlays (lib/popover), not resting lists.
 *
 *  Form follows function, like lib/textDoor and lib/cardDoor: every collection
 *  that fronts entities is one role, so the container chrome is defined once
 *  here and consumed everywhere. `divide-y` draws the head→row and row→row
 *  hairlines from the container, so a row carries no border of its own — which
 *  is exactly what ROW_DOOR_CLASS (lib/cardDoor) expects a row inside a bordered
 *  list container to look like; append it at the call site for rows that front a
 *  page, along with the row's own sizes and colors.
 *
 *  Plain strings (no JSX) so the DOM-less test runner can import and scan —
 *  tests/ledger.test.ts locks the recipe and forbids hand-rolled copies.
 *
 *  Migration note: Projects is the first converted surface; the remaining
 *  card-pile collections (Artifacts, Contexts, the hub lists in SectionView)
 *  convert band by band. When converting one, delete its per-item card chrome
 *  entirely — a ledger row inside a card is the box-in-box defect this module
 *  exists to end. */

/** The container: one border, small radius, hairline dividers between children
 *  (the head included). `overflow-hidden` keeps row hover washes inside the
 *  rounded corners. */
export const LEDGER_BOX_CLASS = 'divide-y divide-line overflow-hidden rounded-md border border-line'

/** The container's header band: quiet panel fill, one weight, room for a count
 *  chip and a right-aligned action cluster. */
export const LEDGER_HEAD_CLASS =
  'flex items-center gap-2 bg-panel px-3.5 py-2 text-[12px] font-semibold text-ink'

/** The count chip inside a ledger head. */
export const LEDGER_COUNT_CLASS =
  'rounded-full bg-line px-1.5 py-px text-[10.5px] font-semibold leading-4 text-ink-soft'

/** A ledger row's layout skeleton: baseline-aligned columns. Callers append the
 *  door cue (ROW_DOOR_CLASS) when the row fronts a page, plus their own type
 *  sizes and colors. */
export const LEDGER_ROW_CLASS = 'flex items-baseline gap-2.5 px-3.5 py-2.5'
