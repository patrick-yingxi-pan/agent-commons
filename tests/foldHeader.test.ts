/** Foldable list-section headers share one styling source (src/lib/foldHeader.ts)
 *  so the "this header is clickable" hover cue stays identical across them. Their
 *  hover INTENTIONALLY differs from the left rail's — each surface gets the tint
 *  that reads on its own background (see the foldHeader.ts header). These lock that:
 *    1. every fold-header surface carries a visible hover background,
 *    2. the page class composes the page hover and stays layout-stable,
 *    3. the page hover DARKENS (it must, on the near-white canvas) and so differs
 *       from the rail's lightening hover — they are deliberately not one token,
 *    4. the cue is defined once — no component re-hardcodes it,
 *    5. the consumers source their styling from the shared module. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { ROOT, read, concatSource } from './helpers/source.ts'
import { FOLD_HOVER, FOLD_HEADER_CLASS } from '../src/lib/foldHeader.ts'
import { SIDEBAR_HOVER } from '../src/lib/sidebar.ts'

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
})

test('the page hover darkens and so deliberately differs from the rail hover', () => {
  // The canvas is near-white, so the page header hover must DARKEN to read; the rail
  // lightens. Sharing one token makes the page hover near-invisible — locked here so
  // it is not "helpfully" re-unified. See src/lib/foldHeader.ts for the rationale.
  assert.match(FOLD_HOVER.page, /hover:bg-panel-2/, 'the page hover uses a darkening tint (panel-2)')
  assert.ok(!FOLD_HOVER.page.includes(SIDEBAR_HOVER), 'the page hover is NOT the rail hover')
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
    'src/components/SectionView.tsx': 'FOLD_HEADER_CLASS',
    'src/components/panels/ArtifactPanel.tsx': 'FOLD_HOVER',
  }
  for (const [rel, symbol] of Object.entries(consumers)) {
    const src = read(join(ROOT, ...rel.split('/')))
    assert.match(src, /from\s+'(\.\.\/)+lib\/foldHeader'/, `${rel} imports the shared fold-header module`)
    assert.ok(src.includes(symbol), `${rel} uses ${symbol}`)
  }
})
