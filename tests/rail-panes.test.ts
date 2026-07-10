/** The rail body is an accordion of foldable, resizable panes — Sections, Scheduled,
 *  Recents. Folded panes are header strips; open non-flex panes hold a persisted FIXED
 *  height; the bottom-most open pane flexes to fill the remainder. These lock the pure
 *  math (railPanes.ts): the fit-to-avail clamp (never mutating storage), the min floors,
 *  which pane flexes / carries a divider, and the drag arithmetic that anchors on the
 *  EFFECTIVE heights so the clamp can never leak into an untouched pane's stored value. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  dragPane,
  layoutPanes,
  paneMax,
  RAIL_GUTTER,
  RAIL_PANE_HEADER,
  RAIL_PANE_MIN,
  type PaneInput,
} from '../src/lib/railPanes.ts'

const AVAIL = 900
const panes = (over: Partial<Record<string, Partial<PaneInput>>> = {}): PaneInput[] => [
  { id: 'sections', present: true, open: true, height: 300, ...over.sections },
  { id: 'scheduled', present: true, open: true, height: 160, ...over.scheduled },
  { id: 'recents', present: true, open: true, height: 0, ...over.recents },
]
const byId = (ls: ReturnType<typeof layoutPanes>, id: string) => ls.find((l) => l.id === id)!
const sum = (ls: ReturnType<typeof layoutPanes>) => ls.reduce((s, l) => s + l.height, 0)

test('all open: Sections/Scheduled take stored heights, Recents flexes, dividers fit avail', () => {
  const ls = layoutPanes(panes(), AVAIL)
  assert.equal(byId(ls, 'sections').height, 300)
  assert.equal(byId(ls, 'scheduled').height, 160)
  assert.equal(byId(ls, 'recents').flex, true)
  // Two dividers (below Sections, below Scheduled); the flex pane absorbs their gutters.
  assert.equal(ls.filter((l) => l.divider).length, 2)
  assert.equal(byId(ls, 'sections').divider, true)
  assert.equal(byId(ls, 'scheduled').divider, true)
  assert.equal(byId(ls, 'recents').divider, false)
  // Panes + gutters fill avail exactly (fit invariant — no overflow, no gap).
  assert.equal(sum(ls) + 2 * RAIL_GUTTER, AVAIL)
})

test('folding Scheduled makes it a header strip; Recents stays the flex pane', () => {
  const ls = layoutPanes(panes({ scheduled: { open: false } }), AVAIL)
  assert.equal(byId(ls, 'scheduled').folded, true)
  assert.equal(byId(ls, 'scheduled').height, RAIL_PANE_HEADER)
  assert.equal(byId(ls, 'scheduled').divider, false) // a folded pane has no divider
  assert.equal(byId(ls, 'recents').flex, true)
  assert.equal(ls.filter((l) => l.divider).length, 1) // only below Sections now
  assert.equal(sum(ls) + 1 * RAIL_GUTTER, AVAIL)
})

test('folding Recents promotes the next open pane (Scheduled) to flex', () => {
  const ls = layoutPanes(panes({ recents: { open: false } }), AVAIL)
  assert.equal(byId(ls, 'recents').folded, true)
  assert.equal(byId(ls, 'recents').height, RAIL_PANE_HEADER)
  assert.equal(byId(ls, 'scheduled').flex, true) // bottom-most OPEN pane
  assert.equal(byId(ls, 'sections').flex, false)
  assert.equal(byId(ls, 'sections').divider, true) // Sections still resizable
  assert.equal(byId(ls, 'scheduled').divider, false) // the flex pane has no divider
})

test('all folded: every pane is a strip, none flexes, nothing overflows', () => {
  const ls = layoutPanes(
    panes({ sections: { open: false }, scheduled: { open: false }, recents: { open: false } }),
    AVAIL,
  )
  assert.ok(ls.every((l) => l.folded && l.height === RAIL_PANE_HEADER && !l.flex && !l.divider))
})

test('no routines → Scheduled absent; Sections fixed over Recents flex', () => {
  const ls = layoutPanes(panes({ scheduled: { present: false } }), AVAIL)
  assert.equal(ls.length, 2)
  assert.equal(ls.find((l) => l.id === 'scheduled'), undefined)
  assert.equal(byId(ls, 'sections').height, 300)
  assert.equal(byId(ls, 'recents').flex, true)
})

test('short rail clamps to fit exactly; every pane keeps its min (all three open)', () => {
  // avail above the 3*min + 2*gutter floor but below the stored sum → clamps to fit.
  const ls = layoutPanes(panes(), 500)
  assert.ok(ls.every((l) => l.height >= RAIL_PANE_MIN), 'no pane below min')
  assert.equal(sum(ls) + 2 * RAIL_GUTTER, 500, 'panes + gutters fill avail exactly — no overflow, no gap')
  assert.ok(byId(ls, 'sections').height < 300, 'Sections was clamped down, not overflowed')
})

test('short rail clamps the folded branch too (folded strip preserved, others fit)', () => {
  const ls = layoutPanes(panes({ scheduled: { open: false } }), 220)
  assert.equal(byId(ls, 'scheduled').height, RAIL_PANE_HEADER)
  assert.ok(byId(ls, 'sections').height >= RAIL_PANE_MIN)
  assert.ok(byId(ls, 'recents').height >= RAIL_PANE_MIN)
  assert.ok(byId(ls, 'sections').height < 300, 'Sections clamped on the short rail')
})

test('short rail clamps the absent branch too', () => {
  const ls = layoutPanes(panes({ scheduled: { present: false } }), 200)
  assert.ok(byId(ls, 'sections').height >= RAIL_PANE_MIN)
  assert.ok(byId(ls, 'recents').height >= RAIL_PANE_MIN)
  assert.ok(byId(ls, 'sections').height < 300, 'Sections clamped on the short rail')
})

test('dragging a pane grows it and the flex pane absorbs; other stored panes are untouched', () => {
  const before = layoutPanes(panes(), AVAIL)
  const newSections = dragPane('sections', 380, panes(), AVAIL)
  assert.equal(newSections, 380)
  // Re-layout with the new Sections height: Scheduled unchanged, Recents (flex) shrank.
  const after = layoutPanes(panes({ sections: { height: newSections } }), AVAIL)
  assert.equal(byId(after, 'scheduled').height, byId(before, 'scheduled').height, 'Scheduled untouched')
  assert.ok(byId(after, 'recents').height < byId(before, 'recents').height, 'Recents absorbed the growth')
})

test('a divider can never be dragged below its own min (down-drag floors at RAIL_PANE_MIN)', () => {
  assert.equal(dragPane('sections', 10, panes(), AVAIL), RAIL_PANE_MIN)
  assert.equal(dragPane('scheduled', 10, panes(), AVAIL), RAIL_PANE_MIN)
})

test('a divider can never starve the flex pane below its min (up-drag ceiling)', () => {
  const maxSections = dragPane('sections', 9999, panes(), AVAIL)
  // Rebuild the layout at that height: Recents (flex) must still be >= min.
  const ls = layoutPanes(panes({ sections: { height: maxSections } }), AVAIL)
  assert.ok(byId(ls, 'recents').height >= RAIL_PANE_MIN)
  assert.equal(byId(ls, 'recents').height, RAIL_PANE_MIN, 'flex pane sits exactly at its floor')
})

test('paneMax IS dragPane’s ceiling, and floors at min on a degenerate short rail', () => {
  // The exported ceiling exists so the divider can announce (aria-valuemax) the same
  // range the drag enforces — these two must never drift.
  assert.equal(paneMax('sections', panes(), AVAIL), dragPane('sections', 9999, panes(), AVAIL))
  assert.equal(paneMax('scheduled', panes(), AVAIL), dragPane('scheduled', 9999, panes(), AVAIL))
  // A rail too short for even the minimums pins the range to [min, min].
  assert.equal(paneMax('sections', panes(), 100), RAIL_PANE_MIN)
})

test('the clamp never leaks into storage: a drag in a clamped state maps to the cursor, not the stored sum', () => {
  // Sections stored huge (500) on a rail too short to show it → it renders clamped.
  const clamped = panes({ sections: { height: 500 } })
  const rendered = byId(layoutPanes(clamped, 470), 'sections').height
  assert.ok(rendered < 500, 'Sections renders clamped below its stored 500')
  // A nudge to the rendered edge returns ~the rendered height (not 500), and leaves
  // Scheduled's stored value entirely out of it — dragPane returns only Sections.
  const dragged = dragPane('sections', rendered, clamped, 470)
  assert.ok(Math.abs(dragged - rendered) <= 1, 'drag maps to the on-screen edge, no leap toward 500')
  assert.ok(dragged >= RAIL_PANE_MIN)
})
