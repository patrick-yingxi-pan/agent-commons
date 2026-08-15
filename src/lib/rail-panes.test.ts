/** The rail body has two responsibilities: the canonical Sections resource
 * tree and the Recents utility history. Folded panes are header strips; the
 * top-most open pane flexes; Recents is fixed/resizable when Sections is open.
 * These lock fit-to-available, minimums, divider ownership, and drag math. */
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
  { id: 'recents', present: true, open: true, height: 240, ...over.recents },
]
const byId = (ls: ReturnType<typeof layoutPanes>, id: string) => ls.find((l) => l.id === id)!
const sum = (ls: ReturnType<typeof layoutPanes>) => ls.reduce((total, item) => total + item.height, 0)

test('both open: Sections flexes and Recents keeps its stored height', () => {
  const layout = layoutPanes(panes(), AVAIL)
  assert.equal(byId(layout, 'sections').flex, true)
  assert.equal(byId(layout, 'sections').divider, false)
  assert.equal(byId(layout, 'recents').height, 240)
  assert.equal(byId(layout, 'recents').divider, true)
  assert.equal(sum(layout) + RAIL_GUTTER, AVAIL)
})

test('folding Recents gives the resource tree every pixel above its utility strip', () => {
  const open = layoutPanes(panes(), AVAIL)
  const folded = layoutPanes(panes({ recents: { open: false } }), AVAIL)
  assert.equal(byId(folded, 'recents').height, RAIL_PANE_HEADER)
  assert.equal(byId(folded, 'recents').folded, true)
  assert.equal(byId(folded, 'recents').divider, false)
  assert.ok(byId(folded, 'sections').height > byId(open, 'sections').height)
  assert.equal(sum(folded), AVAIL)
})

test('folding Sections promotes Recents to the flex pane', () => {
  const layout = layoutPanes(panes({ sections: { open: false } }), AVAIL)
  assert.equal(byId(layout, 'sections').height, RAIL_PANE_HEADER)
  assert.equal(byId(layout, 'sections').folded, true)
  assert.equal(byId(layout, 'recents').flex, true)
  assert.equal(byId(layout, 'recents').divider, false)
})

test('both folded: two strips, no flex pane and no divider', () => {
  const layout = layoutPanes(panes({ sections: { open: false }, recents: { open: false } }), AVAIL)
  assert.ok(layout.every((item) => item.folded && item.height === RAIL_PANE_HEADER && !item.flex && !item.divider))
})

test('a short rail clamps Recents while preserving both minimums', () => {
  const layout = layoutPanes(panes(), 250)
  assert.ok(layout.every((item) => item.height >= RAIL_PANE_MIN))
  assert.equal(sum(layout) + RAIL_GUTTER, 250)
  assert.ok(byId(layout, 'recents').height < 240)
})

test('dragging Recents grows it while Sections absorbs the difference', () => {
  const before = layoutPanes(panes(), AVAIL)
  const height = dragPane('recents', 380, panes(), AVAIL)
  assert.equal(height, 380)
  const after = layoutPanes(panes({ recents: { height } }), AVAIL)
  assert.ok(byId(after, 'sections').height < byId(before, 'sections').height)
  assert.equal(byId(after, 'recents').height, 380)
})

test('the Recents divider cannot shrink below its minimum or starve Sections', () => {
  assert.equal(dragPane('recents', 10, panes(), AVAIL), RAIL_PANE_MIN)
  const maximum = dragPane('recents', 9999, panes(), AVAIL)
  const layout = layoutPanes(panes({ recents: { height: maximum } }), AVAIL)
  assert.equal(byId(layout, 'sections').height, RAIL_PANE_MIN)
  assert.equal(paneMax('recents', panes(), AVAIL), maximum)
  assert.equal(paneMax('recents', panes(), 100), RAIL_PANE_MIN)
})

test('a drag in a clamped state maps to the rendered edge, never stale storage', () => {
  const clamped = panes({ recents: { height: 500 } })
  const rendered = byId(layoutPanes(clamped, 260), 'recents').height
  assert.ok(rendered < 500)
  const dragged = dragPane('recents', rendered, clamped, 260)
  assert.ok(Math.abs(dragged - rendered) <= 1)
  assert.ok(dragged >= RAIL_PANE_MIN)
})
