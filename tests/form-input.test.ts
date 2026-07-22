/** Two shared cues that grew a second home when the turn gutter arrived
 *  (SOCIAL-6b) — form follows function (src/CLAUDE.md): same role ⇒ same look,
 *  from one source, asserted by a test that fails if a component re-hardcodes
 *  it.
 *
 *    • FORM_INPUT_CLASS (src/lib/formInput.ts) — every text field. It used to
 *      live inside SectionView, which put it out of reach of components outside
 *      the section tree; the conversation's turn composer is the first such
 *      caller.
 *    • FOCUS_FLASH_CLASS (src/lib/focusContext.ts) — the lit highlight a door's
 *      target wears on arrival. Five copies of the literal had accumulated
 *      before a sixth (the conversation turn) was due. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { filesUnder, read, stripComments } from './helpers/source.ts'
import { FORM_INPUT_CLASS } from '../src/lib/formInput.ts'
import { FOCUS_FLASH_CLASS } from '../src/lib/focusContext.ts'

test('the shared input cue carries the whole field look, tokens only', () => {
  for (const piece of ['border-line', 'bg-surface', 'text-ink', 'placeholder:text-ink-faint', 'focus:border-accent']) {
    assert.ok(FORM_INPUT_CLASS.includes(piece), `the field cue owns ${piece}`)
  }
  // INV-1: semantic tokens, never a raw Tailwind palette class.
  assert.ok(!/\b(?:bg|text|border)-(?:gray|zinc|slate|neutral|stone|blue|red|green)-\d/.test(FORM_INPUT_CLASS))
})

test('the focus flash is one cue: tint + ring, tokens only', () => {
  assert.ok(FOCUS_FLASH_CLASS.includes('bg-accent-tint'), 'the arrival tint')
  assert.ok(FOCUS_FLASH_CLASS.includes('ring-'), 'and its ring')
  assert.ok(!/\b(?:bg|text|border|ring)-(?:gray|zinc|slate|neutral|stone|blue|red|green)-\d/.test(FOCUS_FLASH_CLASS))
})

/** KNOWN, UNCLAIMED: seven fields in SectionView hand-roll the same CHROME
 *  (border-line · bg-surface · outline-none · placeholder:text-ink-faint ·
 *  focus:border-accent) at four different densities. They predate this module
 *  and unifying them means touching hand-tuned padding on seven surfaces — a
 *  refactor, not a side effect of the turn gutter. These lock the exact shared
 *  string only; the density sprawl is recorded in docs/design/social-layer.md's
 *  backlog rather than silently asserted away. */
test('no component re-hardcodes either cue', () => {
  // Out of scope, deliberately: AddContextButton's picker paints the SELECTED
  // row with the same tint+ring. Same look, different role — persistent
  // selection state rather than "a door brought you here" — and the rule is
  // same-role-same-look, not same-look-same-name. Conflating them would make
  // one component import a constant called FOCUS_FLASH for something no focus
  // target ever consumes.
  const owners = ['lib/formInput.ts', 'lib/focusContext.ts', 'components/AddContextButton.tsx']
  for (const file of filesUnder('src')) {
    const rel = file.replace(/\\/g, '/')
    if (owners.some((o) => rel.endsWith(o))) continue
    const src = stripComments(read(file))
    assert.ok(
      !src.includes(FORM_INPUT_CLASS),
      `${rel} hand-rolls the field cue — import FORM_INPUT_CLASS from src/lib/formInput.ts`,
    )
    // The flash's exact pairing. A `bg-accent-tint` on its own is a legitimate
    // resting surface (a selected picker row); it is the tint-plus-ring
    // combination that means "a door brought you here".
    assert.ok(
      !src.includes(FOCUS_FLASH_CLASS),
      `${rel} hand-rolls the focus flash — import FOCUS_FLASH_CLASS from src/lib/focusContext.ts`,
    )
  }
})
