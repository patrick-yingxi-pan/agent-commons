/** ── Foldable list-section headers ───────────────────────────────────────────
 *  The disclosure headers that collapse / expand a group of rows *in place* — the
 *  Artifacts / Contexts / Scheduled section headers and a workspace panel's folder
 *  headers. Their styling lives here so the hover cue that tells a user "this
 *  header is click-able" stays identical across them: change it once and every fold
 *  header follows, instead of the cue drifting between copy-pasted copies.
 *
 *  These hovers used to differ from the left rail's on purpose, because the rail
 *  sat a step darker than the page: one tint cannot read on two grounds, so the
 *  page darkened and the rail lightened toward white. The FLUSH rail (owner
 *  directive 2026-08-10) killed that premise — `--color-sidebar` IS
 *  `--color-canvas`, so there is one ground and one cue, `panel-2`, the neutral
 *  step off it (darker in light mode and LIGHTER in dark; the promise is
 *  separation from the ground, never a direction). The lock moved with the rule
 *  rather than outliving it — `src/lib/foldHeader.test.ts` now asserts the two
 *  hovers AGREE, and fails a cue painted in the ground's own colour.
 *
 *  Plain strings (no JSX, no imports) so the DOM-less Node test runner can import
 *  and assert them — see src/lib/foldHeader.test.ts, which locks that every surface
 *  keeps a visible hover and that nothing re-hardcodes the cue. */

/** The hover affordance for a foldable header: a soft background highlight plus the
 *  transition, so mousing over visibly marks the header as clickable. One entry per
 *  surface — the tint chosen to actually read on the background that surface sits on. */
export const FOLD_HOVER = {
  /** The page canvas — one step off the ground, the same cue the rail wears. */
  page: 'transition hover:bg-panel-2/70',
  /** Inside a workspace panel — a soft surface lift (matches the panel's own rows). */
  panel: 'transition hover:bg-surface/60',
}

/** The full class for a page-level section group header: content-width and
 *  left-aligned with the list below (the negative margin cancels the left padding,
 *  so the hover highlight gets breathing room with no resting-state layout shift),
 *  carrying the page hover.
 *
 *  **Shape and cue only — no bottom margin**, which is the rule `POST_ACT_CLASS`
 *  states about colour, arrived at here by the same route. It carried `mb-1.5`,
 *  and `<FoldSection>` (whose own wrapper owns the gap, and which must give that
 *  gap back when it folds to one line) appended `mb-0` to cancel it. That does
 *  not cancel anything: two `margin-bottom` utilities in one class attribute
 *  have no defined winner, the cascade decides by the order they appear in the
 *  generated CSS, and `mb-1.5` won — measured, 6px where 0 was intended, on
 *  every section header on every entity page. A shared primitive must not own a
 *  property any caller varies; the two callers who want the margin now say so. */
export const FOLD_HEADER_CLASS =
  `group -ml-1.5 flex w-fit items-center gap-1.5 rounded-md py-1 pl-1.5 pr-2.5 text-left ${FOLD_HOVER.page}`

/** ── The child ORDER these headers share: label first, chevron last ──────────
 *  Not expressible in the class above — a string has no opinion about child
 *  order — so it is stated here and locked in `foldHeader.test.ts` against both
 *  consumers (`FoldSection` on entity pages, the group header on hub lists).
 *
 *  Earned by measurement (owner report 2026-08-13: *"the layout is still
 *  visually messy"*). With the chevron leading, a section's LABEL rendered 19px
 *  right of its own rule and its own content — the rule spanned the column, the
 *  content started at the column, and the only thing that did not was the word
 *  naming them. Twelve sections down a page, that reads as a zigzag nobody can
 *  name but everybody sees.
 *
 *  Why not hang the chevron in the margin, the way a document outline does: at
 *  375px the container has 16px of padding, so a −19px hang puts the glyph
 *  outside the viewport — UI-2, no horizontal scroll, ever.
 *
 *  What trailing costs: the chevrons stop forming a column of their own, since
 *  they now follow words of different lengths. That is the right trade at this
 *  ratio — the labels are the page's skeleton and the glyphs are 13px. */
export const FOLD_HEADER_ORDER = 'label, then chevron' as const

/** ── The section's body indent ───────────────────────────────────────────────
 *  A section is a RULE spanning the column, a label flush under its left end,
 *  and its content inset from both — so the rule and the title read as the
 *  section's frame and everything else reads as being inside it (owner
 *  directive 2026-08-13: *"indenting section contents to make section frames
 *  outstanding is the right direction … we need to apply this rule uniformly
 *  across all sections"*).
 *
 *  **Uniformly is the whole requirement.** Two sections already indented and
 *  ten did not, because the indent was an accident of each content type's own
 *  padding rather than a decision anyone had made: measured across one project
 *  page, the first glyph of a section's content landed at 0, 16, 24, 32, 39 or
 *  44 — six different left edges down twelve sections. The number here is 16
 *  because that is what the in-section rows were already using (`px-4`), so the
 *  page keeps the spacing it had and only the sections that had none change.
 *
 *  The companion rule, which is what makes it uniform rather than additive: a
 *  section indents its content ONCE, and nothing inside re-indents. Rows in a
 *  section's list carry vertical padding only (both sides — the inset is symmetric, so
 *  a row and the prose above it share a right edge as well as a left one) — their horizontal padding was
 *  this same 16px applied a second time, which is why list text sat at 32 while
 *  the prose beside it sat at 0. Locked in `main-column-sections.test.ts`. */
export const SECTION_BODY_CLASS = 'px-4'

/** ── The gap BETWEEN sections, which depends on whether they are folded ──────
 *  Owner question, 2026-08-13: *"how about giving more vertical space between
 *  sections? Can that bring more cleanness?"* Tried at 24 (what it was), 32, 36
 *  and 10 in the running app, and the answer turned out to be yes AND no,
 *  because the two states of this page want opposite things:
 *
 *  - OPEN, a section is a BLOCK — a rule, a label and a paragraph or a list.
 *    Blocks need air between them or the label reads as belonging to the
 *    content above it as much as below. 24px against the 8px inside a section
 *    is a 3:1 ratio; 32 makes it 4:1, and the grouping snaps into place.
 *  - FOLDED, a section is a ROW — one line, in a list of twelve. Rows want to
 *    be tight, because the tightness is what makes them read as ONE list.
 *    At 36 the folded page was twelve scattered lines that had stopped being
 *    an index; at 12 it is an index again.
 *
 *  So the gap belongs to the SECTION, not to the stack that holds it — a
 *  container can only say one thing, and this needs to say two. Callers that
 *  used to space their own section stacks give that up (`ProjectDetail`'s
 *  `space-y-6`), or the two would fight and the larger would win, which is
 *  exactly the folded case losing. */
export const SECTION_GAP = { open: 'mb-8', folded: 'mb-3' } as const
