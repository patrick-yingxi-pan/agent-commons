/** One ordered resource forest may be projected into one or two scroll panes.
 * The split boundary is presentation-only; these tests lock order, identity,
 * fit-to-available, minimums, divider ownership, and drag math. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  dragPane,
  layoutPanes,
  paneMax,
  RAIL_GUTTER,
  RAIL_PANE_MIN,
  splitRailSections,
  type PaneInput,
} from './railPanes.ts'

const AVAIL = 900
const panes = (lowerHeight = 240, lowerPresent = true): PaneInput[] => [
  { id: 'upper', present: true, height: 0 },
  { id: 'lower', present: lowerPresent, height: lowerHeight },
]
const byId = (ls: ReturnType<typeof layoutPanes>, id: string) => ls.find((l) => l.id === id)!

test('one pane fills the rail and owns no divider', () => {
  const layout = layoutPanes(panes(240, false), AVAIL)
  assert.deepEqual(layout, [{ id: 'upper', height: AVAIL, flex: true, divider: false }])
})

test('a split keeps the lower stored height while the upper pane flexes', () => {
  const layout = layoutPanes(panes(), AVAIL)
  assert.equal(byId(layout, 'upper').height, AVAIL - RAIL_GUTTER - 240)
  assert.equal(byId(layout, 'upper').flex, true)
  assert.equal(byId(layout, 'lower').height, 240)
  assert.equal(byId(layout, 'lower').divider, true)
})

test('a short rail clamps the lower pane while preserving both minimums', () => {
  const layout = layoutPanes(panes(), 250)
  assert.ok(layout.every((item) => item.height >= RAIL_PANE_MIN))
  assert.equal(byId(layout, 'upper').height + byId(layout, 'lower').height + RAIL_GUTTER, 250)
  assert.ok(byId(layout, 'lower').height < 240)
})

test('dragging the lower pane grows it while the upper pane absorbs the difference', () => {
  const before = layoutPanes(panes(), AVAIL)
  const height = dragPane('lower', 380, panes(), AVAIL)
  const after = layoutPanes(panes(height), AVAIL)
  assert.equal(height, 380)
  assert.ok(byId(after, 'upper').height < byId(before, 'upper').height)
  assert.equal(byId(after, 'lower').height, 380)
})

test('the lower divider cannot shrink below its minimum or starve the upper pane', () => {
  assert.equal(dragPane('lower', 10, panes(), AVAIL), RAIL_PANE_MIN)
  const maximum = dragPane('lower', 9999, panes(), AVAIL)
  const layout = layoutPanes(panes(maximum), AVAIL)
  assert.equal(byId(layout, 'upper').height, RAIL_PANE_MIN)
  assert.equal(paneMax('lower', panes(), AVAIL), maximum)
})

test('a drag in a clamped state maps to the rendered edge, never stale storage', () => {
  const clamped = panes(500)
  const rendered = byId(layoutPanes(clamped, 260), 'lower').height
  assert.ok(rendered < 500)
  assert.equal(dragPane('lower', rendered, clamped, 260), rendered)
})

test('a split isolates an ordered suffix without creating another hierarchy', () => {
  const sections = ['projects', 'artifacts', 'contexts', 'sessions'] as const
  assert.deepEqual(splitRailSections(sections, 'sessions'), [
    ['projects', 'artifacts', 'contexts'],
    ['sessions'],
  ])
  assert.deepEqual(splitRailSections(sections, 'contexts'), [
    ['projects', 'artifacts'],
    ['contexts', 'sessions'],
  ])
  assert.deepEqual(splitRailSections(sections, 'none'), [sections])
  assert.deepEqual(splitRailSections(sections, 'missing'), [sections])
  assert.deepEqual(splitRailSections(sections, 'projects'), [sections])
})
