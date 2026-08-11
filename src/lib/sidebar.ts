/** ── Left-panel (sidebar) interaction styling ─────────────────────────────────
 *  Every clickable element in the left rail — the header icon buttons, the nav
 *  rows, the Recents and Scheduled rows, and the Scheduled fold header — shares
 *  one hover cue, so the whole panel reads as a single, consistent surface. It
 *  lives here as one string so it can't drift between those elements; locked by
 *  tests/sidebar.test.ts.
 *
 *  The hover is a STEP OFF THE GROUND, not a direction (owner directive
 *  2026-08-10). It used to be 70% `surface` over a rail that sat a step darker
 *  than the page; that premise died when the rail went FLUSH, because
 *  `--color-sidebar` is now `--color-canvas` itself — so a surface tint paints
 *  the rail in its own colour and the hover disappears.
 *
 *  `panel-2` is the neutral one step off the canvas, and which WAY it steps is
 *  the mode's business: darker in light (#efe8e5 on #fbf9f8), lighter in dark
 *  (#352d2e on #272122). Saying this cue "darkens" would be true of half the
 *  matrix and wrong about the other half — what it actually promises is
 *  separation from the ground, in whichever direction that mode has room for.
 *
 *  Which also collapses the reason this cue was kept apart from the page's fold
 *  headers (lib/foldHeader): that note read "the rail's darker surface wants a
 *  lightening hover, the near-white page wants a darkening one, and one tint
 *  can't be visible on both". Both grounds are now the same colour, and both
 *  cues are `panel-2/70`. They stay two constants because they dress different
 *  elements (FOLD_HOVER carries its own `transition` and a panel variant), but
 *  the VALUES have converged — if a third caller ever wants it, unify them.
 *
 *  Text-color hovers stay per-element (faint→ink for nav/icon, →ink-soft for the
 *  uppercase fold header) — only the background is unified here.
 *
 *  Plain string (no JSX, no imports) so the DOM-less Node test runner can import
 *  and assert it directly. */

/** The hover background shared by every interactive element in the left panel. */
export const SIDEBAR_HOVER = 'hover:bg-panel-2/70'

/** The rail's ACTIVE row — where you are, in one look for every row kind (owner
 *  directive 2026-08-10).
 *
 *  Neutral, not the co-color. The Bindery duet's place seat put a Prussian-blue
 *  pill here, which made a NAVIGATION marker the most saturated thing in a panel
 *  that had just given up its solid so it would stop shouting. Standing location
 *  does not need hue: a fill plus the weight bump says "here" unambiguously, and
 *  the reference clients all mark it that way.
 *
 *  co survives where it means the system just RESPONDED to you — the focus flash
 *  on arrival, field focus, a checked box, a selected radio. That is the sharper
 *  line the duet was reaching for: co marks a transient answer, weight and fill
 *  mark a standing state.
 *
 *  One constant for the section pill AND the session/recents rows, which had
 *  drifted into two different active looks (a tinted pill vs a ringed fill) in
 *  one panel — same role, same look. */
export const SIDEBAR_ACTIVE = 'bg-panel-2 font-medium text-ink'

/** The rail's h-8 ghost icon button — the header trio (collapse / search /
 *  bell), the split-view controls, AND the collapsed mini-rail's vertical
 *  column in the shell (the same controls, rotated): one role, one look. */
export const SIDEBAR_ICON_BUTTON = `flex h-8 w-8 items-center justify-center rounded-lg text-ink-soft transition ${SIDEBAR_HOVER} hover:text-ink`
