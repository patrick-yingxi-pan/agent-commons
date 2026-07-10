/** ── Resizable, foldable rail body panes (ADAPT-13) ───────────────────────────
 *  The rail's lower body is a small **accordion** of stacked panes — Sections,
 *  Scheduled, Recents. Each pane can be **folded** (collapsed to just its header)
 *  and, when open, holds a **persisted, FIXED** height — except the **bottom-most
 *  open pane**, which **flexes** to fill whatever height the others leave (so
 *  folding never opens a gap). Draggable dividers sit below each fixed (open,
 *  non-flex) pane and resize it; the flex pane absorbs the difference.
 *
 *  This module is the pure math (no React, no DOM), so `tests/` can lock it. Two
 *  invariants it guarantees:
 *   - **fixed unless manually adjusted** — `layoutPanes` clamps stored heights to
 *     fit the CURRENT available height without ever mutating them (the clamp lives
 *     at render, never in storage — the rail-width rule).
 *   - **the clamp never leaks into storage** — `dragPane` returns a new height for
 *     ONLY the pane being dragged, computed against the OTHER panes' EFFECTIVE
 *     (clamped, on-screen) heights, so a drag maps 1:1 to the cursor and can't
 *     rewrite an untouched pane's stored value. */

/** Kept dependency-free (no imports) so the DOM-less Node test runner can import the
 *  math directly — hence a local `clamp` rather than uiPrefs's (same one-liner). */
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n))

/** A pane's minimum height: its header + ~2 rows. No open pane shrinks below this. */
export const RAIL_PANE_MIN = 96
/** Default fixed heights on first run (px) — clamped at render like any stored value. */
export const RAIL_SECTIONS_DEFAULT = 288
export const RAIL_SCHEDULED_DEFAULT = 160
/** A folded pane collapses to just its header — this strip's approximate height. */
export const RAIL_PANE_HEADER = 32
/** The in-flow gutter each divider occupies between two panes. */
export const RAIL_GUTTER = 8

export type PaneId = 'sections' | 'scheduled' | 'recents'

export type PaneInput = {
  id: PaneId
  /** Does this pane exist at all (e.g. Scheduled only when there are routines)? */
  present: boolean
  /** Is it unfolded (showing its body)? A folded pane is a header strip. */
  open: boolean
  /** Stored fixed height (used only when the pane is open AND not the flex pane). */
  height: number
}

export type PaneLayout = {
  id: PaneId
  open: boolean
  /** Rendered height in px (folded → header strip; flex → the computed remainder). */
  height: number
  /** The bottom-most open pane, which fills the remainder. */
  flex: boolean
  /** Folded to just its header. */
  folded: boolean
  /** A draggable divider sits below this pane (true only for open, non-flex panes). */
  divider: boolean
}

type Opts = { min?: number; header?: number; gutter?: number }

/** Resolve every present pane to a rendered height for the current `avail`. Folded
 *  panes take a header strip; open non-flex panes take their clamped stored height
 *  (each clamped so the panes after it keep their minimum); the bottom-most open pane
 *  flexes to fill the remainder. Never mutates the inputs. */
export function layoutPanes(panes: PaneInput[], avail: number, opts: Opts = {}): PaneLayout[] {
  const min = opts.min ?? RAIL_PANE_MIN
  const header = opts.header ?? RAIL_PANE_HEADER
  const gutter = opts.gutter ?? RAIL_GUTTER

  const present = panes.filter((p) => p.present)
  const open = present.filter((p) => p.open)
  const flexId = open.length ? open[open.length - 1].id : null // bottom-most open pane
  const numDividers = Math.max(0, open.length - 1) // one below each open pane except the flex
  const availForPanes = Math.max(0, Math.max(0, avail) - numDividers * gutter)
  const stripsTotal = present.filter((p) => !p.open).length * header
  const fixed = open.filter((p) => p.id !== flexId) // open, non-flex → resizable fixed height

  // Assign fixed heights left→right, each clamped to leave every later pane its min.
  const heights = new Map<PaneId, number>()
  let used = 0
  fixed.forEach((p, i) => {
    const reserveAfter = (fixed.length - 1 - i) * min + min // later fixed panes + the flex pane
    const maxThis = availForPanes - stripsTotal - used - reserveAfter
    const h = clamp(p.height, min, Math.max(min, maxThis))
    heights.set(p.id, h)
    used += h
  })
  const flexHeight = flexId ? Math.max(min, availForPanes - stripsTotal - used) : 0

  return present.map((p) => {
    const folded = !p.open
    const flex = p.id === flexId
    const height = folded ? header : flex ? flexHeight : (heights.get(p.id) ?? min)
    return { id: p.id, open: p.open, height, flex, folded, divider: p.open && !flex }
  })
}

/** The ceiling open, non-flex pane `id` can grow to right now: the space left after
 *  the folded strips, the OTHER fixed panes' EFFECTIVE heights, and the flex pane's
 *  reserved minimum. Never below `min` (a degenerate short rail pins the range to
 *  [min, min]). Shared by `dragPane`'s clamp and the divider's `aria-valuemax`, so
 *  the announced range can't drift from the enforced one. */
export function paneMax(id: PaneId, panes: PaneInput[], avail: number, opts: Opts = {}): number {
  const min = opts.min ?? RAIL_PANE_MIN
  const header = opts.header ?? RAIL_PANE_HEADER
  const gutter = opts.gutter ?? RAIL_GUTTER

  const layout = layoutPanes(panes, avail, opts)
  const numDividers = layout.filter((p) => p.divider).length
  const availForPanes = Math.max(0, Math.max(0, avail) - numDividers * gutter)
  const stripsTotal = layout.filter((p) => p.folded).length * header
  const otherFixed = layout
    .filter((p) => p.open && !p.flex && p.id !== id)
    .reduce((sum, p) => sum + p.height, 0)
  return Math.max(min, availForPanes - stripsTotal - otherFixed - min) // reserve the flex pane's min
}

/** New stored height for open, non-flex pane `id` whose bottom edge is dragged to
 *  `target` px below the pane's top. Clamped so the flex pane keeps its minimum; the
 *  clamp is computed from the OTHER panes' EFFECTIVE heights (`paneMax`), so the
 *  returned value maps 1:1 to the cursor and only this pane's stored height changes. */
export function dragPane(
  id: PaneId,
  target: number,
  panes: PaneInput[],
  avail: number,
  opts: Opts = {},
): number {
  const min = opts.min ?? RAIL_PANE_MIN
  return clamp(target, min, paneMax(id, panes, avail, opts))
}
