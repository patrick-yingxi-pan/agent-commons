/** Hover-revealed affordances (src/lib/hoverReveal.ts) — UI-7 in
 *  docs/ui-invariants.md: touch has no hover, so below `sm` a hover-revealed
 *  element must be PERSISTENT (HOVER_REVEAL, a real control) or GONE
 *  (HOVER_CUE, a decorative hint) — never `opacity-0`-but-space-reserving,
 *  which starves the row's flex-1 identity column on phones (the first
 *  /ui-review sweep found Scheduled and Contexts rows with ~0px names at
 *  320px). These lock that:
 *    1. both cues resolve the narrow tier explicitly and share the reveal core,
 *    2. no component hand-rolls the reveal idiom outside the module. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { concatSource } from './helpers/source.ts'
import { HOVER_CUE, HOVER_REVEAL } from '../src/lib/hoverReveal.ts'

test('both cues reveal on hover and resolve the narrow tier explicitly', () => {
  for (const cue of [HOVER_REVEAL, HOVER_CUE]) {
    assert.ok(cue.includes('opacity-0'), 'hidden at rest')
    assert.ok(cue.includes('group-hover:opacity-100'), 'revealed on row hover')
  }
  assert.ok(HOVER_REVEAL.includes('max-sm:opacity-100'), 'controls persist below sm')
  assert.ok(HOVER_CUE.includes('max-sm:hidden'), 'cues drop below sm')
})

test('no component hand-rolls the hover-reveal idiom', () => {
  // A hidden-at-rest element revealed by row hover (`opacity-0` +
  // `group-hover:opacity-100` in one class string) must come from the module —
  // an inline copy is a reveal with an unresolved narrow tier (the exact bug:
  // invisible controls reserving width on touch). Out of scope, deliberately:
  // hover *emphasis* (opacity-60 → 100, always visible) and named-group
  // variants (`group-hover/chip:`) on absolutely-positioned badges, which
  // reserve no row width.
  const src = concatSource('src/components')
  const inline = (src.match(/className="[^"]*"/g) ?? []).filter(
    (c) => c.includes('opacity-0') && c.includes('group-hover:opacity-100'),
  )
  assert.deepEqual(inline, [], 'take the reveal cue from lib/hoverReveal (HOVER_REVEAL or HOVER_CUE)')
})
