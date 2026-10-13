/** The anchored-popover primitive (src/lib/popover.ts + src/lib/usePopoverShift.ts)
 *  — the invariant that a popover must lie fully inside the viewport, owned by one
 *  module. Form follows function: one chrome cue (POPOVER_SURFACE, carrying the
 *  width clamp) + one piece of containment math (shiftIntoSpan / clampLeft), worn
 *  by every anchored surface and every portal-positioned menu. These lock that:
 *    1. the containment math actually contains (unit cases at the boundaries),
 *    2. the surface cue carries the viewport width clamp, and the clamp's 16px
 *       stays equal to 2 × POPOVER_MARGIN (the two are one decision),
 *    3. every popover-bearing component sources the primitive from the module,
 *    4. nothing re-hardcodes the surface chrome or the clamp literal inline —
 *       a new anchored popover built by copy-paste fails here and is pushed to
 *       the funnel.
 *  Earned the ratchet way (docs/ui-invariants.md UI-1): containment had been
 *  applied per-instance (a one-off max-w in AddContextButton, hand-rolled clamp
 *  math in RowMenu / FilterMenu / RecentOverflowList) and the composer popovers
 *  truncated at extreme narrow viewports. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join, relative, sep } from 'node:path'
import { ROOT, read, stripComments, concatSource, filesUnder } from '../../tests/helpers/source.ts'
import { POPOVER_MARGIN, POPOVER_SURFACE, clampLeft, shiftIntoSpan } from './popover.ts'

/* ── 1 · the math contains ──────────────────────────────────────────────────── */

test('shiftIntoSpan: already inside → no shift', () => {
  assert.equal(shiftIntoSpan(100, 300, 400), 0)
  // Exactly on the margins is inside.
  assert.equal(shiftIntoSpan(POPOVER_MARGIN, 400 - POPOVER_MARGIN, 400), 0)
})

test('shiftIntoSpan: overflowing the far edge shifts back', () => {
  // A 256px popover whose left-0 anchor sits at x=200 in a 320px viewport:
  // right edge 456 → shift left to end at 312 (320 − margin).
  assert.equal(shiftIntoSpan(200, 456, 320), 312 - 456)
})

test('shiftIntoSpan: overflowing the near edge shifts forward', () => {
  // A right-0 anchored popover pushed past the left edge.
  assert.equal(shiftIntoSpan(-120, 180, 320), POPOVER_MARGIN - -120)
})

test('shiftIntoSpan: wider than the span pins the near margin', () => {
  // Both edges overflow: the near-edge floor wins, so the start lands on the
  // margin (the POPOVER_SURFACE width clamp prevents this case horizontally).
  const d = shiftIntoSpan(-50, 500, 320)
  assert.equal(-50 + d, POPOVER_MARGIN)
})

test('clampLeft mirrors shiftIntoSpan for self-positioned menus', () => {
  // Fits: unchanged.
  assert.equal(clampLeft(60, 208, 400), 60)
  // Trigger near the right edge: clamped so the menu ends at the margin.
  assert.equal(clampLeft(350, 208, 400), 400 - 208 - POPOVER_MARGIN)
  // Trigger near the left edge (right-aligned menu went negative): floored.
  assert.equal(clampLeft(-40, 208, 400), POPOVER_MARGIN)
})

test('anchored popovers reserve live workspace space below shell recovery notices', () => {
  const app = stripComments(read(join(ROOT, 'src/App.tsx')))
  const hook = stripComments(read(join(ROOT, 'src/lib/usePopoverShift.ts')))
  assert.match(app, /<ShellMutationNotices\s*\/>[\s\S]*<div data-popover-viewport/)
  assert.match(hook, /el\.closest<HTMLElement>\('\[data-popover-viewport\]'\)/)
  assert.match(hook, /Math\.max\(0, bounds\?\.top \?\? 0\)/)
  assert.match(hook, /shiftIntoSpan\(r\.top - top, r\.bottom - top, height\)/)
  assert.match(hook, /if \(viewport\) ro\.observe\(viewport\)/,
    'pending/error/cleared banners change available height while the menu stays open')
})

/* ── 2 · the cue carries the clamp, and the two constants agree ─────────────── */

test('POPOVER_SURFACE is the anchored-surface chrome with a viewport width clamp', () => {
  for (const piece of ['rounded-xl', 'border-line-strong', 'bg-surface', 'shadow-xl']) {
    assert.ok(POPOVER_SURFACE.includes(piece), `keeps "${piece}"`)
  }
  assert.ok(
    POPOVER_SURFACE.includes(`max-w-[calc(100vw-${2 * POPOVER_MARGIN}px)]`),
    'the width clamp is 2 × POPOVER_MARGIN — one decision, stated once',
  )
})

/* ── 3 · every popover-bearing component sources the primitive ──────────────── */

/** CSS-anchored surfaces: wear POPOVER_SURFACE and self-correct via the hook. */
const ANCHORED = [
  'src/components/AddContextButton.tsx',
  'src/components/PermissionModeControl.tsx',
  'src/components/AudioInputControl.tsx',
  'src/components/ModelEffortControl.tsx',
  'src/components/UsageControl.tsx',
  'src/components/UsageDetails.tsx',
  'src/components/GaugePopover.tsx',
  'src/components/Composer.tsx',
  'src/components/artifactPreview.tsx',
  'src/components/SectionView.tsx',
  'src/components/CommissionAdd.tsx',
  'src/components/RunHistoryMenu.tsx',
  'src/components/SessionShareButton.tsx',
  'src/components/MessageButton.tsx',
  'src/components/DeferredCadenceEditor.tsx',
]

/** Portal-fixed menus: position themselves, so they clamp via clampLeft. */
const PORTALED = [
  'src/components/RowMenu.tsx',
  'src/components/FilterMenu.tsx',
  'src/components/RecentOverflowList.tsx',
  // The @-mention completion list. It lives in the HOOK rather than in any one
  // composer (four composers offer it), and it PORTALS for a reason the other
  // three share: a composer is not always in an open box. The work-item field
  // sits inside a `CardList`, whose ledger recipe carries `overflow-hidden` for
  // its rounded corners — a CSS-anchored list was clipped by the very row it
  // belonged to, found in the running app.
  'src/lib/useMentionPicker.tsx',
]

/** The enumeration is DERIVED, not hand-listed: every file that wears the surface
 *  must be accounted for. A hand-maintained list only locks the consumers someone
 *  remembered to add — which is exactly how `SessionShareButton` shipped wearing
 *  POPOVER_SURFACE with no shift hook and put its left edge at x=0 on a 320px
 *  viewport (the /ui-review sweep, 2026-07-22). Same failure shape as UI-9's
 *  third escape, where the row lock enumerated only `ScheduledRow`. */
test('the consumer enumeration is COMPLETE — no popover escapes by not being listed', () => {
  const listed = new Set([...ANCHORED, ...PORTALED])
  const wearers = filesUnder('src')
    .filter((f) => stripComments(read(f)).includes('POPOVER_SURFACE'))
    .map((f) => relative(ROOT, f).split(sep).join('/'))
    .filter((rel) => rel !== 'src/lib/popover.ts')
  for (const rel of wearers) {
    assert.ok(
      listed.has(rel),
      `${rel} wears POPOVER_SURFACE but is in neither ANCHORED nor PORTALED — add it (and give it the shift hook or clampLeft)`,
    )
  }
})

/** The import path to a `src/lib` module from a consumer — either up out of
 *  `src/components` or, since the mention picker moved into `src/lib` itself,
 *  a sibling `./`. Both are the SAME module; only the depth differs. */
const fromLib = (mod: string) => new RegExp(String.raw`from\s+'(?:(?:\.\./)+lib|\.)/${mod}(?:\.tsx?)?'`)

test('every anchored popover wears the shared surface and the shift hook', () => {
  for (const rel of ANCHORED) {
    const src = read(join(ROOT, ...rel.split('/')))
    assert.match(src, fromLib('popover'), `${rel} imports the surface cue`)
    assert.match(src, fromLib('usePopoverShift'), `${rel} imports the shift hook`)
    assert.ok(src.includes('POPOVER_SURFACE'), `${rel} wears the shared surface`)
    assert.ok(src.includes('usePopoverShift'), `${rel} self-corrects into the viewport`)
  }
})

test('every portal-positioned menu clamps through the shared math', () => {
  for (const rel of PORTALED) {
    const src = read(join(ROOT, ...rel.split('/')))
    assert.match(src, fromLib('popover'), `${rel} imports the shared module`)
    assert.ok(src.includes('clampLeft('), `${rel} clamps via the shared math`)
    assert.ok(src.includes('POPOVER_SURFACE'), `${rel} wears the shared surface`)
  }
})

/* ── 4 · nothing re-hardcodes the primitive ─────────────────────────────────── */

test('the surface chrome is defined once — no anchored popover re-hardcodes it', () => {
  const components = concatSource('src/components')
  const app = stripComments(read(join(ROOT, 'src', 'App.tsx')))
  const src = components + '\n' + app
  // The full cue never appears inline…
  assert.ok(!src.includes(POPOVER_SURFACE), 'take the chrome from lib/popover, not a copy')
  // …and no trigger-anchored surface rebuilds it from parts: an element hung off
  // `bottom-full` / `top-full` carrying its own bg-surface chrome is a popover
  // that skipped the funnel (and with it the width clamp + shift containment).
  const rehardcoded = src.match(/className="[^"]*(?:bottom-full|top-full)[^"]*bg-surface[^"]*"/g) ?? []
  assert.deepEqual(rehardcoded, [], 'anchored surfaces must wear POPOVER_SURFACE')
})

test('no anchored surface carries its own viewport clamp', () => {
  // Centered dialogs (scrim + ring chrome, e.g. the add-context browse dialog)
  // clamp themselves — that's a different role. But an *absolutely positioned*
  // element with an inline viewport clamp is an anchored popover working around
  // the funnel instead of wearing POPOVER_SURFACE.
  const components = concatSource('src/components')
  const inline = components.match(/className="[^"]*absolute[^"]*max-w-\[calc\(100vw-[^"]*"/g) ?? []
  assert.deepEqual(inline, [], 'anchored surfaces take the clamp from POPOVER_SURFACE')
})
