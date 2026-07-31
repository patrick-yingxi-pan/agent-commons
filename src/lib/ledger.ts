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
 *  The flat radius scale (one decision, stated once): collections (ledger
 *  boxes) 6px · items (quiet cards) 8px · standalone interactive objects (the
 *  composer, dialogs) 12px. Nothing at rest casts a shadow at any tier.
 *
 *  Which form fits an item: a scannable ONE-LINER (a context, a project, a run)
 *  is a LEDGER ROW; an item with a rich body — a thumbnail, a thread head, an
 *  in-place management card (a model provider's chips + actions) — is a QUIET
 *  CARD in a stack or grid. Surface follows the entity's nature, applied to
 *  chrome.
 *
 *  The 2026-07-31 migration converted every collection (Projects, Contexts,
 *  Scheduled, CardList → ledger; Artifacts, Commons, Models cards → quiet
 *  card) and swept every resting shadow. When adding a new collection, take
 *  the recipe from here — a ledger row inside a card is the box-in-box defect
 *  this module exists to end, and tests/ledger.test.ts scans for regressions. */

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

/** The QUIET CARD — the flat direction's other item form: a gallery tile or feed
 *  card (Artifacts, the Commons feed, Discover) whose item is visual enough to
 *  earn its own frame. Hairline border, 8px radius, NO resting shadow — hover is
 *  the border waking up (lib/cardDoor's CARD_DOOR_CLASS). Deliberately carries
 *  no border COLOR: a card wearing a transient border (the focus flash) must
 *  choose its color in one place at the call site (two `border-*` colors in one
 *  class attribute have no defined winner — the cascade lesson in lib/textDoor),
 *  so callers append `border-line` at rest or their flash arm. Padding stays
 *  caller-side too: a thumbnail tile is flush (p-0 + inner sections), a feed
 *  card is p-4. */
export const QUIET_CARD_CLASS = 'rounded-lg border bg-surface'
