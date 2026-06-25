/** Foldable list-section headers share one styling source (src/lib/foldHeader.ts),
 *  and their hover cue is the same surface-lift the left rail uses — SIDEBAR_HOVER
 *  (src/lib/sidebar.ts) — so the whole app shares one hover. These tests lock that:
 *    1. every fold-header surface composes the shared sidebar hover,
 *    2. the page section-header class composes it and stays layout-stable,
 *    3. fold headers source the hover from the shared token — no hardcoded copy,
 *    4. the consumers source their styling from the shared module.
 *
 *  (A `:hover` rule can't be exercised by the DOM-less node:test runner; what IS
 *  testable — and what regresses if someone re-duplicates the header — is that the
 *  styling and its hover have a single owner.) */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { ROOT, read, stripComments } from './helpers/source.ts'
import { FOLD_HOVER, FOLD_HEADER_CLASS } from '../src/lib/foldHeader.ts'
import { SIDEBAR_HOVER } from '../src/lib/sidebar.ts'

test('every fold-header surface adopts the shared sidebar hover', () => {
  const variants = Object.entries(FOLD_HOVER)
  assert.ok(variants.length > 0, 'there is at least one surface variant')
  for (const [surface, cls] of variants) {
    assert.ok(cls.includes(SIDEBAR_HOVER), `FOLD_HOVER.${surface} uses the shared sidebar hover`)
    assert.match(cls, /\btransition\b/, `FOLD_HOVER.${surface} animates the change`)
  }
})

test('the page section-header class composes the shared hover and stays layout-stable', () => {
  assert.ok(FOLD_HEADER_CLASS.includes(SIDEBAR_HOVER), 'composes the shared sidebar hover')
  // content-width + left-aligned (negative margin cancels padding) = a highlight
  // with breathing room and no resting-state layout shift; `group` drives the
  // chevron's group-hover tint.
  for (const piece of ['group', 'w-fit', '-ml-1.5', 'rounded-md']) {
    assert.ok(FOLD_HEADER_CLASS.includes(piece), `keeps "${piece}"`)
  }
})

test('fold headers source the hover from the shared token — they hardcode no copy', () => {
  const moduleSrc = stripComments(read(join(ROOT, 'src', 'lib', 'foldHeader.ts')))
  assert.match(moduleSrc, /from\s+'\.\/sidebar/, 'foldHeader imports the shared hover token')
  assert.ok(moduleSrc.includes('SIDEBAR_HOVER'), 'foldHeader composes its class from SIDEBAR_HOVER')
  assert.ok(!moduleSrc.includes('hover:bg-'), 'foldHeader hardcodes no hover background of its own')

  // The fold-header components apply the unified hover via the constants — they
  // must not paste the literal, so a re-duplicated header fails here.
  for (const rel of ['src/components/SectionView.tsx', 'src/components/panels/ArtifactPanel.tsx']) {
    const src = stripComments(read(join(ROOT, ...rel.split('/'))))
    assert.ok(!src.includes(SIDEBAR_HOVER), `${rel} applies the hover via the shared token, not a hardcoded copy`)
  }
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
