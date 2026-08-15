/** ── Foldable list-section headers ───────────────────────────────────────────
 *  The disclosure headers that collapse / expand a page section or a workspace
 *  panel folder *in place*. Collection roots once hand-built a second
 *  group-header consumer; they now use FoldSection itself. Styling lives here
 *  so the hover cue that tells a user "this header is click-able" stays
 *  identical across them: change it once and every fold header follows,
 *  instead of the cue drifting between copy-pasted copies.
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

/** ── The child ORDER: label first, chevron last ─────────────────────────────
 *  Not expressible in the class above — a string has no opinion about child
 *  order — so it is stated here and locked in `foldHeader.test.ts` against the
 *  one main-page consumer, `FoldSection`.
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
export const SECTION_BODY_INSET = 'px-4'

/** ── …and the same rule on the VERTICAL axis: space it once, from outside ────
 *  `divide-y` draws no border above its FIRST row, so that row's top padding is
 *  the space under a divider that is not there — and directly under a section's
 *  rule it landed on top of the space the section had already left
 *  (`SECTION_RULE_SPACE.below`). Measured: a list section put its first line of
 *  text 20px under the rule where a prose section put its at 8.
 *
 *  So the section takes it back — and takes it HERE rather than on `CardList`,
 *  which is the difference between a rule and a side effect. The first spelling
 *  put `first:-mt-3` on the list itself, where it fires for any list that
 *  happens to be its parent's first child: the profile page's follower bands
 *  are a heading plus a list, so the cancel reached one that has no rule above
 *  it and never doubled anything. The claim is "the section's rule IS this
 *  list's first divider", which is only true of a list sitting directly under
 *  that rule — so the selector says exactly that, and `data-card-list` is the
 *  handle `CardList` stamps to be found by (the repo's `data-popover` /
 *  `data-section-title` idiom).
 *
 *  **The TOP only, and the missing bottom half is the interesting part.** The
 *  first cut carried `last:-mb-3` too, on the symmetric-looking reasoning that
 *  a list's trailing row padding is added to the gap before the next section.
 *  It is — and it is not a DOUBLING: at the top the section's rule had already
 *  supplied the space, while at the bottom the last row's padding is the row's
 *  own breathing room, the mirror of the top padding every other row has.
 *  Cancelling it made the section's border box end 12px above its own content,
 *  so the gap between section BOXES measured 20 where the visible gap was 32 —
 *  and the inter-section rhythm lock, which measures boxes, correctly reported a
 *  third rhythm on a page that is supposed to have two. **A negative margin that
 *  makes a box smaller than what it contains is a lie every later measurement
 *  inherits**, which is a steep price for 12px of trailing space that was never
 *  wrong. */
export const SECTION_LIST_UNDOUBLE = '[&>[data-card-list]:first-child]:-mt-3'

export const SECTION_BODY_CLASS = `${SECTION_BODY_INSET} ${SECTION_LIST_UNDOUBLE}`

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
 *  (Those ratios are the reasoning as it stood. The 8 became 12 the same day,
 *  when `SECTION_RULE_SPACE` equalized the space around the rule, so the open
 *  ratio today is 32:12. The comparison is what decided the number; it is kept
 *  as it was made rather than quietly restated against a figure that moved.)
 *
 *  So the gap belongs to the SECTION, not to the stack that holds it — a
 *  container can only say one thing, and this needs to say two. Callers that
 *  used to space their own section stacks give that up (`ProjectDetail`'s
 *  `space-y-6`), or the two would fight and the larger would win, which is
 *  exactly the folded case losing. */
export const SECTION_GAP = { open: 'mb-8', folded: 'mb-3' } as const

/** ── The space AROUND the rule, which is the same on both sides ──────────────
 *  Owner directive 2026-08-13: *"make the vertical spaces above and below the
 *  rule equal."* It shipped at 6 above and 8 below, and measured worse than
 *  that sounds, because two other things were adding to one side only.
 *
 *  **12px, both sides, and 12 is not an arbitrary pick** — it is the vertical
 *  padding a `CardList` row already carries. That is what makes the rule
 *  uniform rather than merely symmetric: under a rule, a list's first row and a
 *  section's first line of prose now start at the same distance, and the first
 *  row sits as far below the section's rule as every later row sits below its
 *  own hairline. One number spaces the label, the rule, the prose and the list.
 *
 *  The two class values differ because they measure from different edges:
 *  `above` is the header's padding under a label button that carries its own
 *  `py-1` (`FOLD_HEADER_CLASS`, for the hover pill), so 4 + 8 = 12; `below` is
 *  the header's margin, straight, 12. Written as one constant so the pair can
 *  never drift apart, and measured — not read — by `e2e/project-page.spec.ts`,
 *  which asserts the gap above equals the gap below in every section on the
 *  page. A spacing rule stated in two units is exactly the kind a source scan
 *  can bless while the page shows something else. */
export const SECTION_RULE_SPACE = { above: 'pb-2', below: 'mb-3' } as const
