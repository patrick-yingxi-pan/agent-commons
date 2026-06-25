/** ── Foldable list-section headers ───────────────────────────────────────────
 *  The disclosure headers that collapse / expand a group of rows *in place* — the
 *  Artifacts / Contexts / Scheduled section headers and a workspace panel's folder
 *  headers. Their styling lives here so the hover cue that tells a user "this
 *  header is click-able" stays identical across them: change it once and every fold
 *  header follows, instead of the cue drifting between copy-pasted copies.
 *
 *  These hovers INTENTIONALLY differ from the left rail's (lib/sidebar's
 *  SIDEBAR_HOVER), even though sharing one token is tempting. The reason is the
 *  background each sits on: the page canvas (#faf9f5) is near-white, so a hover only
 *  reads if it DARKENS (bg-panel-2/70); the rail (#f2f0e9) is darker, so its hover
 *  LIGHTENS toward white (bg-surface/70). No single tint is visible on both — a
 *  light tint vanishes on the canvas, a dark tint fights the rail — so each surface
 *  keeps the tint that's actually legible on it. (We tried unifying to the rail
 *  hover; it made the page headers nearly invisible. Don't re-unify without first
 *  changing the page background.)
 *
 *  Plain strings (no JSX, no imports) so the DOM-less Node test runner can import
 *  and assert them — see tests/foldHeader.test.ts, which locks that every surface
 *  keeps a visible hover and that nothing re-hardcodes the cue. */

/** The hover affordance for a foldable header: a soft background highlight plus the
 *  transition, so mousing over visibly marks the header as clickable. One entry per
 *  surface — the tint chosen to actually read on the background that surface sits on. */
export const FOLD_HOVER = {
  /** The page canvas (#faf9f5, near-white) — darken so the hover reads. */
  page: 'transition hover:bg-panel-2/70',
  /** Inside a workspace panel — a soft surface lift (matches the panel's own rows). */
  panel: 'transition hover:bg-surface/60',
}

/** The full class for a page-level section group header: content-width and
 *  left-aligned with the list below (the negative margin cancels the left padding,
 *  so the hover highlight gets breathing room with no resting-state layout shift),
 *  carrying the page hover. */
export const FOLD_HEADER_CLASS =
  `group mb-1.5 -ml-1.5 flex w-fit items-center gap-1.5 rounded-md py-1 pl-1.5 pr-2.5 text-left ${FOLD_HOVER.page}`
