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
import { concatSource } from '../../tests/helpers/source.ts'
import { HOVER_CUE, HOVER_REVEAL, SECTION_REVEAL, SECTION_REVEAL_GROUP } from './hoverReveal.ts'

test('both cues reveal on hover and resolve the narrow tier explicitly', () => {
  for (const cue of [HOVER_REVEAL, HOVER_CUE]) {
    assert.ok(cue.includes('opacity-0'), 'hidden at rest')
    assert.ok(cue.includes('group-hover:opacity-100'), 'revealed on row hover')
  }
  assert.ok(HOVER_REVEAL.includes('max-sm:opacity-100'), 'controls persist below sm')
  assert.ok(HOVER_CUE.includes('max-sm:hidden'), 'cues drop below sm')
})

test('the section-scoped cue is a NAMED group that stays reachable and persists on narrow', () => {
  // A named group, so section hover can't light up nested row reveals.
  assert.equal(SECTION_REVEAL_GROUP, 'group/section')
  assert.ok(SECTION_REVEAL.includes('opacity-0'), 'hidden at rest')
  assert.ok(SECTION_REVEAL.includes('group-hover/section:opacity-100'), 'revealed on section hover')
  // Keyboard reach (WCAG 2.1.1) and an open popover both pin the cluster visible.
  assert.ok(SECTION_REVEAL.includes('focus-within:opacity-100'), 'revealed while focused')
  // The `data-open` variant carries more weight than it looks. Since 2026-08-13
  // it is the ONLY thing keeping a section's verbs on screen while the form one
  // of them opened is up — `FoldSection`'s `revealActions` pin, which used to
  // say `empty || composing`, was deleted when the owner reported the page still
  // showing buttons at rest, and the composing half of it turned out to be
  // redundant with this. `SectionAction` stamps `data-open` from `expanded`, so
  // a disclosed composer holds its own cluster lit. UI-18's "the verb must not
  // fade out from under the pointer" now rests here; if this line goes, the
  // pressed verb vanishes the moment the pointer leaves the header.
  assert.ok(SECTION_REVEAL.includes('has-[[data-open=true]]:opacity-100'), 'revealed while a popover or disclosed form is open')
  // Real controls (UI-7): persistent below sm, never invisible tap targets.
  assert.ok(SECTION_REVEAL.includes('max-sm:opacity-100'), 'controls persist below sm')
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
    (c) => c.includes('opacity-0') && /group-hover(\/section)?:opacity-100/.test(c),
  )
  assert.deepEqual(inline, [], 'take the reveal cue from lib/hoverReveal (HOVER_REVEAL / HOVER_CUE / SECTION_REVEAL)')
})
