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
 *  src/lib/ledger.test.ts locks the recipe and forbids hand-rolled copies.
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
 *  this module exists to end, and src/lib/ledger.test.ts scans for regressions. */

/** The collection: hairline dividers between rows, and **no frame of its own**
 *  (owner directive 2026-08-12 — *"remove boxes for items in sections, they are
 *  visual noise; make section titles and boundaries more clear"*).
 *
 *  This replaced `LEDGER_BOX_CLASS`, which added `rounded-md border border-line
 *  overflow-hidden` around the same rows. The 2026-07-31 flat pass had already
 *  made that argument once and stopped one step short: it removed the card
 *  chrome (16px radius, shadow, surface fill) because it out-talked the content,
 *  and kept a lighter box. Seventeen of them on a page of eight sections is the
 *  same defect at lower volume — a page reads as a stack of containers before it
 *  reads as content.
 *
 *  **The structure moves UP, to the section title.** A collection sitting under a
 *  titled section never needed to say "I am a group" — the title already did,
 *  and the two together said it twice. So the boundary is one horizontal stroke
 *  under the heading (`LEDGER_RULE_CLASS`) instead of four around the list, and
 *  the row dividers that survive are doing a different job: separating items, not
 *  enclosing them.
 *
 *  `overflow-hidden` went with the radius it existed to clip, which is the point
 *  worth remembering if a hover wash ever needs to bleed past a row again. */
export const LEDGER_LIST_CLASS = 'divide-y divide-line'

/** The boundary a section title draws under itself — the stroke that replaced
 *  the box. One home, because it is now the ONLY thing separating a section from
 *  the next one, and a page where half the sections drew it would read as
 *  broken rather than as quiet.
 *
 *  **`line-strong`, where the row dividers are `line`.** That ordering is the
 *  point and not a preference: after the boxes came off, a section boundary and
 *  a row separator were the same hairline, so a page of eight sections and
 *  thirty rows read as thirty-eight equal strokes with no hierarchy in them —
 *  quieter than the boxes and less legible, which is half of what was asked for
 *  and the wrong half. One step up is enough to rank them, and `line-strong` is
 *  the step the palette already defines in both modes (#d9cbc7 / #4c4143). */
export const LEDGER_RULE_CLASS = 'border-b border-line-strong'

/** A collection's own header row, where it has one that is not a page section's
 *  (a titled sub-list: "Recent runs", "Workflow", a project group's name).
 *
 *  It lost its `bg-panel` fill with the box. A filled band is a header INSIDE a
 *  container; with no container it is a grey stripe lying on the canvas, which
 *  is more chrome than the border it replaced, not less. It carries the rule
 *  instead — the same stroke a section title draws, so a sub-list and a section
 *  read as one kind of thing at two levels. */
export const LEDGER_HEAD_CLASS =
  `flex items-center gap-2 ${LEDGER_RULE_CLASS} px-3.5 py-2 text-[12px] font-semibold text-ink`

/** The count chip inside a ledger head. */
export const LEDGER_COUNT_CLASS =
  'rounded-full bg-line px-1.5 py-px text-[10px] font-semibold leading-relaxed text-ink-soft'

/** A ledger row's layout skeleton: baseline-aligned columns. Its hosting
 *  FoldSection owns the horizontal inset (UI-30), so the row carries only its
 *  vertical rhythm. Callers append the door cue (ROW_DOOR_CLASS) when the row
 *  fronts a page, plus their own type sizes and colors. */
export const LEDGER_ROW_CLASS = 'flex items-baseline gap-2.5 py-2.5'

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
