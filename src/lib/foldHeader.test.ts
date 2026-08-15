/** Foldable list-section headers share one styling source (src/lib/foldHeader.ts)
 *  so the "this header is clickable" hover cue stays identical across them. Since
 *  the rail went FLUSH (owner directive 2026-08-10) the page and the rail share
 *  one ground, so they share one cue — see the foldHeader.ts header for the rule
 *  this replaced. These lock that:
 *    1. every fold-header surface carries a visible hover background,
 *    2. the page class composes the page hover and stays layout-stable,
 *    3. the page hover and the rail's are the SAME step off that one ground, and
 *       neither is painted in the ground's own colour,
 *    4. the cue is defined once — no component re-hardcodes it,
 *    5. the consumers source their styling from the shared module. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { ROOT, read, concatSource, stripComments } from '../../tests/helpers/source.ts'
import { FOLD_HOVER, FOLD_HEADER_CLASS, FOLD_HEADER_ORDER } from './foldHeader.ts'
import { SIDEBAR_HOVER } from './sidebar.ts'

test('every fold-header surface carries a visible hover affordance', () => {
  const variants = Object.entries(FOLD_HOVER)
  assert.ok(variants.length > 0, 'there is at least one surface variant')
  for (const [surface, cls] of variants) {
    assert.match(cls, /\btransition\b/, `FOLD_HOVER.${surface} animates the change`)
    assert.match(cls, /\bhover:bg-/, `FOLD_HOVER.${surface} highlights the background on hover`)
  }
})

test('the page section-header class composes the page hover and stays layout-stable', () => {
  assert.ok(FOLD_HEADER_CLASS.includes(FOLD_HOVER.page), 'composes the page hover')
  // content-width + left-aligned (negative margin cancels padding) = a highlight
  // with breathing room and no resting-state layout shift; `group` drives the
  // chevron's group-hover tint.
  for (const piece of ['group', 'w-fit', '-ml-1.5', 'rounded-md']) {
    assert.ok(FOLD_HEADER_CLASS.includes(piece), `keeps "${piece}"`)
  }
  // …and owns no BOTTOM margin, which is the `POST_ACT_CLASS` rule (a shared
  // primitive must not own a property its callers vary) arrived at the same way.
  // It carried `mb-1.5`; `FoldSection` appended `mb-0` to cancel it and did not,
  // because two `margin-bottom` utilities in one class attribute are resolved by
  // the generated CSS order, not the string order — 6px where 0 was intended, on
  // every section header on every entity page. Stated as an ABSENCE because the
  // failure is silent: nothing breaks, the rows are just wrong by 6px.
  assert.doesNotMatch(
    FOLD_HEADER_CLASS,
    /(^|\s)mb-/,
    `the callers own their bottom margin — one wants 1.5, one wants none: "${FOLD_HEADER_CLASS}"`,
  )
})

test('the rail and the page share one ground, so both hovers step OFF it', () => {
  // This lock used to assert the opposite: that the page hover must NOT be the
  // rail hover. That rule held while the rail sat a step darker than the page —
  // one tint cannot read on two different grounds, so the rail lightened and the
  // page darkened.
  //
  // The FLUSH rail (owner directive 2026-08-10) killed the premise:
  // `--color-sidebar` IS `--color-canvas`, so there is exactly one ground and a
  // `surface` tint paints either surface in its own colour. Both cues are
  // `panel-2` — the neutral one step off the canvas — and the lock moves with
  // the rule rather than outliving it.
  //
  // Deliberately NOT phrased as "darkens": panel-2 is darker in light mode and
  // LIGHTER in dark (#352d2e on #272122). The promise is separation from the
  // ground, not a direction.
  assert.match(FOLD_HOVER.page, /hover:bg-panel-2/, 'the page hover steps off the ground (panel-2)')
  assert.match(SIDEBAR_HOVER, /hover:bg-panel-2/, 'and so does the rail — one ground, one cue')
  // The regression this guards: a cue painted in the ground's own colour.
  for (const [name, cue] of [['page', FOLD_HOVER.page], ['rail', SIDEBAR_HOVER]] as const) {
    assert.ok(!cue.includes('hover:bg-surface'), `the ${name} hover must not use surface — it IS the canvas now`)
  }
})

test('the page hover cue is defined once — no component re-hardcodes it', () => {
  const moduleSrc = read(join(ROOT, 'src', 'lib', 'foldHeader.ts'))
  assert.ok(moduleSrc.includes('hover:bg-panel-2/70'), 'the shared module owns the page hover literal')
  // Everywhere else under src/components/ references the constant, never the raw
  // class — so re-introducing a copy-pasted fold header fails this test.
  const components = concatSource('src/components')
  assert.ok(
    !components.includes('hover:bg-panel-2/70'),
    'no component re-hardcodes the page fold-header hover — it must come from lib/foldHeader',
  )
})

test('the fold-header consumers source their styling from the shared module', () => {
  const consumers = {
    'src/components/ResourcePage.tsx': 'FOLD_HEADER_CLASS',
    'src/components/panels/ArtifactPanel.tsx': 'FOLD_HOVER',
  }
  for (const [rel, symbol] of Object.entries(consumers)) {
    const src = read(join(ROOT, ...rel.split('/')))
    assert.match(src, /from\s+'(\.\.\/)+lib\/foldHeader'/, `${rel} imports the shared fold-header module`)
    assert.ok(src.includes(symbol), `${rel} uses ${symbol}`)
  }
})

test('a fold header reads LABEL first, chevron last — one left edge down the page', () => {
  // Measured, not preferred (owner report 2026-08-13: *"the layout is still
  // visually messy"*). With the chevron leading, a section's label rendered 19px
  // right of its own rule AND its own content, so a page of twelve sections
  // tracked 0 · 19 · 0 · 19 all the way down — the rule spanned the column, the
  // content started at the column, and the only thing that did not was the word
  // naming them.
  //
  // A leading chevron cannot be rescued by hanging it in the margin: at 375px
  // the container has 16px of padding, so a −19px hang puts the glyph outside
  // the viewport, which is UI-2. Trailing costs nothing and buys one left edge.
  //
  // The old hub-group consumer was retired when collection roots adopted
  // FoldSection itself. The one primitive still needs a source-order lock:
  // `FOLD_HEADER_CLASS` is a string and cannot express child order.
  assert.equal(FOLD_HEADER_ORDER, 'label, then chevron', 'the rule is stated where the cue lives')
  const src = stripComments(read(join(ROOT, 'src', 'components', 'ResourcePage.tsx')))
  for (const [name, marker] of [['FoldSection', 'data-section-title']] as const) {
    const at = src.indexOf(marker)
    assert.ok(at > 0, `${name}'s label is in the source`)
    // The chevron that belongs to THIS header is the first one after its label,
    // and there must be none between the button's start and the label.
    const buttonStart = src.lastIndexOf('FOLD_HEADER_CLASS', at)
    assert.ok(buttonStart > 0, `${name} wears the shared class`)
    const before = src.slice(buttonStart, at)
    assert.ok(!before.includes('<ChevronDown'), `${name} puts its label before the chevron, not after`)
    assert.ok(src.slice(at, at + 700).includes('<ChevronDown'), `${name} still HAS a chevron — the fold state stays visible`)
  }
})
