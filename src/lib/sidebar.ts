/** ── Left-panel (sidebar) interaction styling ─────────────────────────────────
 *  Every clickable element in the left rail — the header icon buttons, the nav
 *  rows, the Recents and Scheduled rows, and the Scheduled fold header — shares
 *  one hover cue, so the whole panel reads as a single, consistent surface. It
 *  lives here as one string so it can't drift between those elements; locked by
 *  tests/sidebar.test.ts.
 *
 *  The tint is 70% surface, not full: an *active* row already fills with full
 *  surface + a ring, so the lighter hover stays clearly distinct from selection.
 *  Pair it with the element's own `transition` (every sidebar control already has
 *  one). Text-color hovers stay per-element (faint→ink for nav/icon, →ink-soft for
 *  the uppercase fold header) — only the background is being unified.
 *
 *  This is the rail's OWN hover, deliberately not shared with the page fold headers
 *  (lib/foldHeader): the rail's darker surface wants a lightening hover, the
 *  near-white page wants a darkening one, and one tint can't be visible on both.
 *
 *  Plain string (no JSX, no imports) so the DOM-less Node test runner can import
 *  and assert it directly. The sidebar's filter-menu triggers (FilterMenu) already
 *  use this same 70%-surface hover, so the whole rail stays of a piece. */

/** The hover background shared by every interactive element in the left panel. */
export const SIDEBAR_HOVER = 'hover:bg-surface/70'
