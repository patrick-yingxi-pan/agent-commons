/** ── Foldable list-section headers ───────────────────────────────────────────
 *  The disclosure headers that collapse / expand a group of rows *in place* — the
 *  Artifacts / Contexts / Scheduled section headers, the sidebar's Scheduled
 *  routines header, and a workspace panel's folder headers. Their styling lives
 *  here so the hover cue that tells a user "this header is click-able" stays
 *  identical across the app: change it once and every fold header follows, instead
 *  of the cue drifting between copy-pasted copies.
 *
 *  Plain strings (no JSX, no imports) so the DOM-less Node test runner can import
 *  and assert them directly — see tests/foldHeader.test.ts, which locks that every
 *  surface keeps a hover background and that nothing re-hardcodes the cue. */

/** The hover affordance for a foldable header: a soft background highlight (in the
 *  app's row-hover idiom) plus the transition, so mousing over visibly marks the
 *  header as clickable. One entry per surface — the SAME cue, tinted to sit
 *  naturally on the background it lands on. */
export const FOLD_HOVER = {
  /** The page canvas — the Artifacts / Contexts / Scheduled section group headers. */
  page: 'transition hover:bg-panel-2/70',
  /** The warm sidebar surface — matches the sidebar's own white row hovers. */
  sidebar: 'transition hover:bg-surface',
  /** Inside a workspace panel — the artifact folder group headers. */
  panel: 'transition hover:bg-surface/60',
}

/** The full class for a page-level section group header: content-width and
 *  left-aligned with the list below (the negative margin cancels the left padding,
 *  so the hover highlight gets breathing room with no resting-state layout shift),
 *  carrying the shared page hover affordance. */
export const FOLD_HEADER_CLASS =
  `group mb-1.5 -ml-1.5 flex w-fit items-center gap-1.5 rounded-md py-1 pl-1.5 pr-2.5 text-left ${FOLD_HOVER.page}`
