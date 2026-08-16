/** Viewport tiers (src/lib/viewport.ts) — the pure breakpoint rules behind the FWD-3
 *  responsive layout ladder. Locks the boundaries so a future tweak to the layout can't
 *  silently shift where the panel switches from side-by-side to an overlay drawer, and
 *  locks the render-time width clamps (panel takeover / rail drawer cap) plus the
 *  CSS `short:` variant's literal against SHORT_MAX so the JS and CSS height axes
 *  can't drift apart. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  tierFor,
  isShort,
  canSplitRow,
  canSplitCol,
  canSplitRailCol,
  panelWidthFor,
  railWidthCss,
  WIDE_MIN,
  MEDIUM_MIN,
  SHORT_MAX,
  SPLIT_COL_MIN_H,
  PANEL_MIN,
  PANEL_MAX,
  PANEL_GUTTER,
  RAIL_SCRIM_SLIVER,
} from './viewport.ts'

test('tierFor: wide at/above 1024, medium 640..1023, narrow below 640', () => {
  assert.equal(tierFor(1440), 'wide')
  assert.equal(tierFor(WIDE_MIN), 'wide', 'exactly 1024 is wide')
  assert.equal(tierFor(WIDE_MIN - 1), 'medium', 'just under 1024 is medium')
  assert.equal(tierFor(800), 'medium')
  assert.equal(tierFor(MEDIUM_MIN), 'medium', 'exactly 640 is medium')
  assert.equal(tierFor(MEDIUM_MIN - 1), 'narrow', 'just under 640 is narrow')
  assert.equal(tierFor(375), 'narrow')
})

test('isShort: short strictly below 480', () => {
  assert.equal(isShort(SHORT_MAX - 1), true, 'just under 480 is short')
  assert.equal(isShort(SHORT_MAX), false, 'exactly 480 is not short')
  assert.equal(isShort(390), true, 'landscape phone is short')
  assert.equal(isShort(812), false, 'portrait phone is not short')
})

test('split offers gate per axis: row on width (the wide tier), col on height on top of it', () => {
  // Row (side by side) consumes WIDTH: exactly the wide tier — tiling only
  // exists there; the overlay tiers render one pane at a time.
  assert.equal(canSplitRow('wide'), true)
  assert.equal(canSplitRow('medium'), false)
  assert.equal(canSplitRow('narrow'), false)
  // Col (stacked) consumes HEIGHT — offered only with room for two usable
  // bands, and never below the wide tier (no tiling to stack into).
  assert.equal(canSplitCol('wide', SPLIT_COL_MIN_H), true, 'exactly the floor is enough')
  assert.equal(canSplitCol('wide', SPLIT_COL_MIN_H - 1), false, 'one short of the floor is not')
  assert.equal(canSplitCol('medium', 2000), false, 'height alone never unlocks stacking below wide')
  assert.equal(canSplitCol('narrow', 2000), false)
  // The rail is already a narrow column: its one available direction consumes
  // height only, even when the main workspace is in overlay mode.
  assert.equal(canSplitRailCol(SPLIT_COL_MIN_H), true)
  assert.equal(canSplitRailCol(SPLIT_COL_MIN_H - 1), false)
})

test('panelWidthFor: full takeover on narrow, gutter-clamped elsewhere', () => {
  // Narrow: the panel IS the viewport, whatever the stored preference says.
  assert.equal(panelWidthFor('narrow', 375, 640), 375)
  assert.equal(panelWidthFor('narrow', 430, 300), 430)
  // Wide with room: the preference passes through.
  assert.equal(panelWidthFor('wide', 1440, 388), 388)
  // Preference below the floor comes back up to PANEL_MIN.
  assert.equal(panelWidthFor('wide', 1440, 100), PANEL_MIN)
  // Preference above the cap clamps to PANEL_MAX even on a huge window.
  assert.equal(panelWidthFor('wide', 2560, 9999), PANEL_MAX)
  // Medium: the ceiling keeps PANEL_GUTTER for the thread…
  assert.equal(panelWidthFor('medium', 800, 640), 800 - PANEL_GUTTER)
  // …but never squeezes the panel below its own floor.
  assert.equal(panelWidthFor('medium', 650, 640), PANEL_MIN)
})

test('railWidthCss: drawer capped to leave a tappable scrim sliver on narrow', () => {
  // A stored desktop width (up to 420) can't cover a phone: the CSS min() keeps
  // the clamp live as the viewport changes, without a resize listener.
  assert.equal(
    railWidthCss('narrow', 420),
    `min(420px, calc(100vw - ${RAIL_SCRIM_SLIVER}px))`,
  )
  // Wide/medium never clamp — the preference is the width.
  assert.equal(railWidthCss('wide', 420), '420px')
  assert.equal(railWidthCss('medium', 272), '272px')
})

test('the CSS short: variant and SHORT_MAX are the same breakpoint', () => {
  const css = readFileSync(new URL('../index.css', import.meta.url), 'utf8')
  assert.match(
    css,
    new RegExp(`@custom-variant short \\(@media \\(max-height: ${SHORT_MAX}px\\)\\);`),
    'src/index.css must define the short: variant at exactly SHORT_MAX',
  )
})

test('viewport-relative units are dvh, never vh/h-screen (UI-6, docs/ui-invariants.md)', async () => {
  // iOS Safari's collapsing URL bar makes `vh` overshoot the visible viewport —
  // a `vh`-positioned dialog or `h-screen` shell hides chrome behind it. The
  // dynamic unit tracks the real viewport, so the rule is absolute: any new
  // `NNvh` or `h-screen` in the UI fails here and switches to `dvh`.
  const { concatSource } = await import('../../tests/helpers/source.ts')
  const src = concatSource('src')
  const plainVh = src.match(/\d+vh\b/g) ?? []
  assert.deepEqual(plainVh, [], 'use dvh — vh overshoots under the iOS URL bar')
  assert.ok(!/\bmin-h-screen|\bh-screen/.test(src), 'use h-dvh/min-h-dvh, not h-screen')
})
