/** Foldable list-section headers share one styling source (src/lib/foldHeader.ts)
 *  so the "this header is clickable" hover cue stays identical across every
 *  disclosure header. These tests lock that unification:
 *    1. every surface variant actually carries a hover background + transition,
 *    2. the page section-header class composes that cue and stays layout-stable,
 *    3. the cue is defined ONCE — no component re-hardcodes the page hover, and the
 *       consumers source their styling from this module (no drift back to copies).
 *
 *  (A `:hover` rule can't be exercised by the DOM-less node:test runner; what IS
 *  testable — and what regresses if someone re-duplicates the header — is that the
 *  styling has a single owner. That is what these assert.) */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { ROOT, read, concatSource } from './helpers/source.ts'
import { FOLD_HOVER, FOLD_HEADER_CLASS } from '../src/lib/foldHeader.ts'

test('every fold-header surface variant carries a visible hover affordance', () => {
  const variants = Object.entries(FOLD_HOVER)
  assert.ok(variants.length > 0, 'there is at least one surface variant')
  for (const [surface, cls] of variants) {
    assert.match(cls, /\btransition\b/, `FOLD_HOVER.${surface} animates the change`)
    assert.match(cls, /\bhover:bg-/, `FOLD_HOVER.${surface} highlights the background on hover`)
  }
})

test('the page section-header class composes the shared hover cue and stays layout-stable', () => {
  assert.ok(FOLD_HEADER_CLASS.includes(FOLD_HOVER.page), 'composes the shared page hover cue')
  // content-width + left-aligned (negative margin cancels padding) = a highlight
  // with breathing room and no resting-state layout shift; `group` drives the
  // chevron's group-hover tint.
  for (const piece of ['group', 'w-fit', '-ml-1.5', 'rounded-md']) {
    assert.ok(FOLD_HEADER_CLASS.includes(piece), `keeps "${piece}"`)
  }
})

test('the page hover cue is defined once — no component re-hardcodes it', () => {
  const moduleSrc = read(join(ROOT, 'src', 'lib', 'foldHeader.ts'))
  assert.ok(moduleSrc.includes('hover:bg-panel-2/70'), 'the shared module owns the page hover literal')

  // Everywhere else under src/components/ must reference the constant, never the
  // raw class — so re-introducing a copy-pasted fold header fails this test.
  const components = concatSource('src/components')
  assert.ok(
    !components.includes('hover:bg-panel-2/70'),
    'no component re-hardcodes the page fold-header hover — it must come from lib/foldHeader',
  )
})

test('the fold-header consumers source their styling from the shared module', () => {
  const consumers = {
    'src/components/SectionView.tsx': 'FOLD_HEADER_CLASS',
    'src/components/Sidebar.tsx': 'FOLD_HOVER',
    'src/components/panels/ArtifactPanel.tsx': 'FOLD_HOVER',
  }
  for (const [rel, symbol] of Object.entries(consumers)) {
    const src = read(join(ROOT, ...rel.split('/')))
    assert.match(src, /from\s+'(\.\.\/)+lib\/foldHeader'/, `${rel} imports the shared fold-header module`)
    assert.ok(src.includes(symbol), `${rel} uses ${symbol}`)
  }
})
