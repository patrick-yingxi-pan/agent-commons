/** The rail body is an accordion of foldable, resizable panes — Sections, Scheduled,
 *  Recents. Folded panes are header strips; open non-flex panes hold a persisted FIXED
 *  height; the TOP-most open pane (normally Sections, the pane with the most rows)
 *  flexes to fill the remainder — so folding Scheduled/Recents drops their headers
 *  downward and hands the space to Sections. These lock the pure math (railPanes.ts):
 *  the fit-to-avail clamp (never mutating storage), the min floors, which pane flexes /
 *  carries a divider (dividers ride ABOVE the pane they resize), and the drag arithmetic
 *  that anchors on the EFFECTIVE heights so the clamp can never leak into an untouched
 *  pane's stored value. */
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
} from './railPanes.ts'

const AVAIL = 900
const panes = (over: Partial<Record<string, Partial<PaneInput>>> = {}): PaneInput[] => [
  { id: 'sections', present: true, open: true, height: 0, ...over.sections },
  { id: 'scheduled', present: true, open: true, height: 160, ...over.scheduled },
  { id: 'recents', present: true, open: true, height: 240, ...over.recents },
]
const byId = (ls: ReturnType<typeof layoutPanes>, id: string) => ls.find((l) => l.id === id)!
const sum = (ls: ReturnType<typeof layoutPanes>) => ls.reduce((s, l) => s + l.height, 0)

test('all open: Sections flexes on top; Scheduled/Recents take stored heights below', () => {
  const ls = layoutPanes(panes(), AVAIL)
  assert.equal(byId(ls, 'sections').flex, true)
  assert.equal(byId(ls, 'scheduled').height, 160)
  assert.equal(byId(ls, 'recents').height, 240)
  // Two dividers (above Scheduled, above Recents); the flex pane absorbs their gutters.
  assert.equal(ls.filter((l) => l.divider).length, 2)
  assert.equal(byId(ls, 'sections').divider, false)
  assert.equal(byId(ls, 'scheduled').divider, true)
  assert.equal(byId(ls, 'recents').divider, true)
  // Panes + gutters fill avail exactly (fit invariant — no overflow, no gap).
  assert.equal(sum(ls) + 2 * RAIL_GUTTER, AVAIL)
})

test('folding Scheduled makes it a header strip; Sections (flex) absorbs the space', () => {
  const open = layoutPanes(panes(), AVAIL)
  const ls = layoutPanes(panes({ scheduled: { open: false } }), AVAIL)
  assert.equal(byId(ls, 'scheduled').folded, true)
  assert.equal(byId(ls, 'scheduled').height, RAIL_PANE_HEADER)
  assert.equal(byId(ls, 'scheduled').divider, false) // a folded pane has no divider
  assert.equal(byId(ls, 'sections').flex, true)
  assert.ok(byId(ls, 'sections').height > byId(open, 'sections').height, 'Sections grew')
  assert.equal(byId(ls, 'recents').height, 240, 'Recents untouched by the fold')
  assert.equal(ls.filter((l) => l.divider).length, 1) // only above Recents now
  assert.equal(sum(ls) + 1 * RAIL_GUTTER, AVAIL)
})

test('folding both Scheduled and Recents gives Sections everything above two bottom strips', () => {
  const ls = layoutPanes(panes({ scheduled: { open: false }, recents: { open: false } }), AVAIL)
  assert.equal(byId(ls, 'sections').flex, true)
  assert.equal(byId(ls, 'sections').height, AVAIL - 2 * RAIL_PANE_HEADER)
  assert.ok(ls.every((l) => !l.divider), 'a lone open pane has no dividers')
})

test('folding Sections promotes the next open pane (Scheduled) to flex', () => {
  const ls = layoutPanes(panes({ sections: { open: false } }), AVAIL)
  assert.equal(byId(ls, 'sections').folded, true)
  assert.equal(byId(ls, 'sections').height, RAIL_PANE_HEADER)
  assert.equal(byId(ls, 'scheduled').flex, true) // top-most OPEN pane
  assert.equal(byId(ls, 'scheduled').divider, false) // the flex pane has no divider
  assert.equal(byId(ls, 'recents').flex, false)
  assert.equal(byId(ls, 'recents').divider, true) // Recents still resizable
})

test('all folded: every pane is a strip, none flexes, nothing overflows', () => {
  const ls = layoutPanes(
    panes({ sections: { open: false }, scheduled: { open: false }, recents: { open: false } }),
    AVAIL,
  )
  assert.ok(ls.every((l) => l.folded && l.height === RAIL_PANE_HEADER && !l.flex && !l.divider))
})

test('no routines → Scheduled absent; Sections flex over Recents fixed', () => {
  const ls = layoutPanes(panes({ scheduled: { present: false } }), AVAIL)
  assert.equal(ls.length, 2)
  assert.equal(ls.find((l) => l.id === 'scheduled'), undefined)
  assert.equal(byId(ls, 'sections').flex, true)
  assert.equal(byId(ls, 'recents').height, 240)
})

test('short rail clamps to fit exactly; every pane keeps its min (all three open)', () => {
  // avail above the 3*min + 2*gutter floor but below the stored sum + flex min → clamps.
  const ls = layoutPanes(panes(), 500)
  assert.ok(ls.every((l) => l.height >= RAIL_PANE_MIN), 'no pane below min')
  assert.equal(sum(ls) + 2 * RAIL_GUTTER, 500, 'panes + gutters fill avail exactly — no overflow, no gap')
  assert.ok(byId(ls, 'recents').height < 240, 'Recents was clamped down, not overflowed')
})

test('short rail clamps the folded branch too (folded strip preserved, others fit)', () => {
  const ls = layoutPanes(panes({ scheduled: { open: false } }), 220)
  assert.equal(byId(ls, 'scheduled').height, RAIL_PANE_HEADER)
  assert.ok(byId(ls, 'sections').height >= RAIL_PANE_MIN)
  assert.ok(byId(ls, 'recents').height >= RAIL_PANE_MIN)
  assert.ok(byId(ls, 'recents').height < 240, 'Recents clamped on the short rail')
})

test('short rail clamps the absent branch too', () => {
  const ls = layoutPanes(panes({ scheduled: { present: false } }), 200)
  assert.ok(byId(ls, 'sections').height >= RAIL_PANE_MIN)
  assert.ok(byId(ls, 'recents').height >= RAIL_PANE_MIN)
  assert.ok(byId(ls, 'recents').height < 240, 'Recents clamped on the short rail')
})

test('dragging a pane grows it and the flex pane absorbs; other stored panes are untouched', () => {
  const before = layoutPanes(panes(), AVAIL)
  const newRecents = dragPane('recents', 380, panes(), AVAIL)
  assert.equal(newRecents, 380)
  // Re-layout with the new Recents height: Scheduled unchanged, Sections (flex) shrank.
  const after = layoutPanes(panes({ recents: { height: newRecents } }), AVAIL)
  assert.equal(byId(after, 'scheduled').height, byId(before, 'scheduled').height, 'Scheduled untouched')
  assert.ok(byId(after, 'sections').height < byId(before, 'sections').height, 'Sections absorbed the growth')
})

test('a divider can never be dragged below its own min (shrink floors at RAIL_PANE_MIN)', () => {
  assert.equal(dragPane('scheduled', 10, panes(), AVAIL), RAIL_PANE_MIN)
  assert.equal(dragPane('recents', 10, panes(), AVAIL), RAIL_PANE_MIN)
})

test('a divider can never starve the flex pane below its min (grow ceiling)', () => {
  const maxRecents = dragPane('recents', 9999, panes(), AVAIL)
  // Rebuild the layout at that height: Sections (flex) must still be >= min.
  const ls = layoutPanes(panes({ recents: { height: maxRecents } }), AVAIL)
  assert.ok(byId(ls, 'sections').height >= RAIL_PANE_MIN)
  assert.equal(byId(ls, 'sections').height, RAIL_PANE_MIN, 'flex pane sits exactly at its floor')
})

test('paneMax IS dragPane’s ceiling, and floors at min on a degenerate short rail', () => {
  // The exported ceiling exists so the divider can announce (aria-valuemax) the same
  // range the drag enforces — these two must never drift.
  assert.equal(paneMax('scheduled', panes(), AVAIL), dragPane('scheduled', 9999, panes(), AVAIL))
  assert.equal(paneMax('recents', panes(), AVAIL), dragPane('recents', 9999, panes(), AVAIL))
  // A rail too short for even the minimums pins the range to [min, min].
  assert.equal(paneMax('recents', panes(), 100), RAIL_PANE_MIN)
})

test('the clamp never leaks into storage: a drag in a clamped state maps to the cursor, not the stored sum', () => {
  // Recents stored huge (500) on a rail too short to show it → it renders clamped.
  const clamped = panes({ recents: { height: 500 } })
  const rendered = byId(layoutPanes(clamped, 470), 'recents').height
  assert.ok(rendered < 500, 'Recents renders clamped below its stored 500')
  // A nudge to the rendered edge returns ~the rendered height (not 500), and leaves
  // Scheduled's stored value entirely out of it — dragPane returns only Recents.
  const dragged = dragPane('recents', rendered, clamped, 470)
  assert.ok(Math.abs(dragged - rendered) <= 1, 'drag maps to the on-screen edge, no leap toward 500')
  assert.ok(dragged >= RAIL_PANE_MIN)
})
