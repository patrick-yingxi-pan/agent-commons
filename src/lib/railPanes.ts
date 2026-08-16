/** ── Generic split layout for the account-resource rail (ADAPT-13) ───────────
 *
 * The rail contains ONE ordered resource forest. A split is presentation-only:
 * it places an ordered suffix of ordinary top-level sections in an independently
 * scrolling lower pane. It never names a second hierarchy and never changes
 * which section owns a resource.
 *
 * The upper pane flexes; the lower pane keeps a persisted height and is resized
 * from the divider above it. Stored height is clamped only at render, never
 * rewritten by a resize of the host. The pure helpers make both the hierarchy
 * boundary and the layout math testable without React or the DOM.
 */

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n))

export const RAIL_PANE_MIN = 96
export const RAIL_SPLIT_DEFAULT = 176
export const RAIL_GUTTER = 8
export const NO_RAIL_SPLIT = 'none'

export type PaneId = 'upper' | 'lower'

export type PaneInput = {
  id: PaneId
  present: boolean
  /** Stored height. Used by the lower fixed pane; the upper pane flexes. */
  height: number
}

export type PaneLayout = {
  id: PaneId
  height: number
  flex: boolean
  /** A draggable divider sits above this pane. */
  divider: boolean
}

type Opts = { min?: number; gutter?: number }

/** Split an ordered section list before `splitStart`. Missing, `none`, and the
 * first item all mean one pane. No item is duplicated or reordered. */
export function splitRailSections<T extends string>(
  sections: readonly T[],
  splitStart: string,
): readonly [readonly T[]] | readonly [readonly T[], readonly T[]] {
  const index = splitStart === NO_RAIL_SPLIT ? -1 : sections.indexOf(splitStart as T)
  return index > 0 ? [sections.slice(0, index), sections.slice(index)] : [sections]
}

/** Resolve the one- or two-pane layout for the available height. */
export function layoutPanes(panes: PaneInput[], avail: number, opts: Opts = {}): PaneLayout[] {
  const min = opts.min ?? RAIL_PANE_MIN
  const gutter = opts.gutter ?? RAIL_GUTTER
  const present = panes.filter((pane) => pane.present)
  if (present.length === 0) return []
  if (present.length === 1)
    return [{ id: present[0].id, height: Math.max(min, avail), flex: true, divider: false }]

  const upper = present[0]
  const lower = present[1]
  const usable = Math.max(min * 2, Math.max(0, avail) - gutter)
  const lowerHeight = clamp(lower.height, min, Math.max(min, usable - min))
  return [
    { id: upper.id, height: Math.max(min, usable - lowerHeight), flex: true, divider: false },
    { id: lower.id, height: lowerHeight, flex: false, divider: true },
  ]
}

/** The lower pane's current ceiling, reserving the upper pane's minimum. */
export function paneMax(id: PaneId, panes: PaneInput[], avail: number, opts: Opts = {}): number {
  const min = opts.min ?? RAIL_PANE_MIN
  const gutter = opts.gutter ?? RAIL_GUTTER
  if (id !== 'lower' || panes.filter((pane) => pane.present).length < 2) return min
  return Math.max(min, Math.max(0, avail) - gutter - min)
}

/** New stored height for the lower pane after dragging its top edge. */
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
