/** ── Shared cue: the anchored popover surface ─────────────────────────────────
 *  One styled primitive + one piece of containment math for every floating
 *  surface anchored to a trigger — the composer-row popovers (add-context,
 *  permission mode, model/effort, microphone, usage, gauges), the chip
 *  confirm/group popups, and the section-page dropdowns — plus the portaled
 *  menus (RowMenu, FilterMenu, the recents flyout), which position themselves
 *  with `clampLeft`.
 *
 *  The invariant this module owns: **a popover must lie fully inside the
 *  viewport** (minus POPOVER_MARGIN on each side). CSS anchoring alone can't
 *  guarantee that — `left-0`/`right-0` follows the trigger, so a trigger near a
 *  screen edge pushes a fixed-width panel off the other side. Containment is
 *  therefore two parts, both sourced from here:
 *    • POPOVER_SURFACE — the shared chrome, including the width clamp
 *      `max-w-[calc(100vw-16px)]` (16px = 2 × POPOVER_MARGIN; locked together
 *      by tests/popover.test.ts) so no popover can be wider than the viewport;
 *    • usePopoverShift (lib/usePopoverShift.ts) — measures the anchored rect
 *      and translates it back inside the viewport via `shiftIntoSpan`.
 *
 *  Form follows function (src/CLAUDE.md): same role ⇒ same look ⇒ same behaviour.
 *  Components must wear POPOVER_SURFACE and take their containment from this
 *  module instead of re-hardcoding either — locked by tests/popover.test.ts,
 *  which fails on any anchored surface that re-declares the chrome inline.
 *
 *  This invariant was earned the ratchet way (docs/ui-invariants.md): the
 *  composer popovers truncated at extreme narrow widths because containment
 *  had been applied per-instance (one max-w clamp in AddContextButton, one
 *  hand-rolled clamp each in RowMenu/FilterMenu/RecentOverflowList) instead of
 *  at the funnel. */

/** Minimum gap between a popover edge and the viewport edge, px. */
export const POPOVER_MARGIN = 8

/** The chrome every anchored popover wears. Callers add positioning
 *  (absolute/fixed, anchor, z-index), width, and padding; the width clamp here
 *  guarantees the surface can never exceed the viewport. */
export const POPOVER_SURFACE =
  'max-w-[calc(100vw-16px)] rounded-xl border border-line-strong bg-surface shadow-xl'

/** How far to translate a span [start, end] (a rect's edges on one axis) so it
 *  lies inside [POPOVER_MARGIN, span − POPOVER_MARGIN]. Pushes back from the
 *  far edge first, then floors at the near edge — so an over-tall/over-wide
 *  surface pins to the near margin and overflows the far one (the width clamp
 *  makes that impossible horizontally). Returns 0 when already contained. */
export function shiftIntoSpan(start: number, end: number, span: number): number {
  let d = 0
  if (end > span - POPOVER_MARGIN) d = span - POPOVER_MARGIN - end
  if (start + d < POPOVER_MARGIN) d = POPOVER_MARGIN - start
  return d
}

/** The same containment for surfaces that position themselves (portal-fixed
 *  menus computing a `left` from the trigger rect): the left coordinate that
 *  keeps [left, left+width] inside the viewport. */
export function clampLeft(left: number, width: number, viewportWidth: number): number {
  return left + shiftIntoSpan(left, left + width, viewportWidth)
}
