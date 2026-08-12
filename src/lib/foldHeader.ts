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
