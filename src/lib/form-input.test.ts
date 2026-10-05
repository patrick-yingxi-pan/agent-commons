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
import { filesUnder, read, stripComments } from '../../tests/helpers/source.ts'
import { composerRows, FIELD_BARE_CLASS, FIELD_SHELL_CLASS, FORM_INPUT_CLASS } from './formInput.ts'
import { FOCUS_FLASH_CLASS } from './focusContext.ts'

test('the shared input cue carries the whole field look, tokens only', () => {
  // focus:border-co since the Bindery duet — field focus is a PLACE cue, so it
  // answers in the co-color (src/index.css seat law).
  for (const piece of ['border-line', 'bg-surface', 'text-ink', 'placeholder:text-ink-faint', 'focus:border-co']) {
    assert.ok(FORM_INPUT_CLASS.includes(piece), `the field cue owns ${piece}`)
  }
  // INV-1: semantic tokens, never a raw Tailwind palette class.
  assert.ok(!/\b(?:bg|text|border)-(?:gray|zinc|slate|neutral|stone|blue|red|green)-\d/.test(FORM_INPUT_CLASS))
})

/** ── The composer shape: same field, frame moved outward ─────────────────────
 *  A composer's submit belongs INSIDE the box (owner directive 2026-08-08), and
 *  a field can't host a button while wearing its own border — that draws a box
 *  inside the box. So the cue splits: the shell takes the frame, the control
 *  keeps the type. Two ways for that split to produce a field that no longer
 *  behaves like one, and both are locked:
 *
 *  · the frame moves but the FOCUS ANSWER doesn't. `focus:` fires on the element
 *    that takes the caret; once the frame is on a wrapper, only `focus-within:`
 *    reaches it, and a field that stops lighting on focus is a WCAG 2.4.7 fault
 *    nothing else in the tree would catch.
 *  · the two shapes drift into two different-looking fields — the exact decay
 *    this module was created to prevent, now with twice the surface. */
test('the composer shell is the same field with its frame moved outward', () => {
  for (const piece of ['border-line', 'bg-surface', 'rounded-md']) {
    assert.ok(FIELD_SHELL_CLASS.includes(piece), `the shell carries the field's ${piece}`)
    assert.ok(FORM_INPUT_CLASS.includes(piece), `…the same piece the plain field carries`)
  }
  assert.ok(
    FIELD_SHELL_CLASS.includes('focus-within:border-co'),
    'the shell answers focus for the control it wraps — `focus:` would never fire on it',
  )
  assert.ok(!FIELD_SHELL_CLASS.includes('focus:border'), 'and not by the plain field’s route, which cannot reach it here')

  // The control keeps type and loses chrome — a border or ground here is the
  // box-inside-a-box this split exists to remove.
  for (const piece of ['text-[13px]', 'text-ink', 'placeholder:text-ink-faint', 'outline-none']) {
    assert.ok(FIELD_BARE_CLASS.includes(piece), `the bare control still reads as a field (${piece})`)
    assert.ok(FORM_INPUT_CLASS.includes(piece), `…identically to the plain one`)
  }
  assert.ok(!/\bborder\b|bg-surface|rounded/.test(FIELD_BARE_CLASS), 'the bare control carries no chrome of its own')
  assert.ok(FIELD_BARE_CLASS.includes('bg-transparent'), 'it sits on the shell’s ground')

  // The submit pins to the bottom-right as the box grows — `items-start` would
  // park it beside the FIRST line of a field that grows downward.
  assert.ok(FIELD_SHELL_CLASS.includes('items-end'), 'the shell keeps its verbs on the field’s baseline')

  // Text lands in the same place in both shapes: the plain field's px-3 (12px)
  // versus the shell's p-1.5 (6px) plus the control's px-1.5 (6px). Stated as
  // arithmetic so a future tweak to either number has to face the other.
  const px = (cue: string, prop: 'p' | 'px') => Number(cue.match(new RegExp(`\\b${prop}-([\\d.]+)`))?.[1] ?? 0) * 4
  assert.equal(
    px(FIELD_SHELL_CLASS, 'p') + px(FIELD_BARE_CLASS, 'px'),
    px(FORM_INPUT_CLASS, 'px'),
    'a composer’s text must start where every other field’s text starts',
  )
})

/** A composer's HEIGHT is part of the shape the shell promises. The square's
 *  box opened at two rows while every other opened at one, so `items-end` put
 *  its Post on a second line and the same component read as two different
 *  controls (owner report, 2026-08-08: "the first post button can sit at the
 *  same line as the box, much like the second"). One rule, one funnel. */
test('every composer opens on ONE line, then grows by line breaks', () => {
  // The claim the layout rests on: empty ⇒ one row ⇒ the submit sits ON the
  // field's line, not under it.
  assert.equal(composerRows('', 8), 1, 'an empty composer is a single line')
  assert.equal(composerRows('a sentence with no breaks at all', 8), 1, 'and wrapping does not grow it')
  assert.equal(composerRows('one\ntwo', 8), 2, 'a line break does')
  assert.equal(composerRows('one\ntwo\nthree', 2), 2, 'growth stops at max — past it the box scrolls')
  assert.equal(composerRows('\n'.repeat(50), 6), 6, 'a paste of many lines cannot swallow the page')
})

test('the Commons composer keeps mention guidance outside the one-row field', () => {
  const source = stripComments(read('src/components/SectionView.tsx'))
  const start = source.indexOf('function PostComposer()')
  const end = source.indexOf('function CommonsSection', start)
  assert.ok(start >= 0 && end > start, 'the Commons composer has a bounded source body')
  const composer = source.slice(start, end)
  assert.match(composer, /const helpId = useId\(\)/)
  assert.match(composer, /placeholder="Say something…"/)
  assert.match(composer, /aria-describedby=\{helpId\}/)
  assert.match(composer, /<p id=\{helpId\} data-composer-help[^>]*>[\s\S]*?Type @ to mention someone\./)
  assert.match(composer, /<textarea[\s\S]*?\.\.\.mention\.fieldProps[\s\S]*?aria-describedby=\{helpId\}/)
})

test('no composer hand-rolls its own row count', () => {
  const offenders: string[] = []
  for (const file of filesUnder('src')) {
    if (file.replace(/\\/g, '/').endsWith('lib/formInput.ts')) continue
    const rel = file.replace(/\\/g, '/').split('/src/')[1]
    for (const m of stripComments(read(file)).matchAll(/rows=\{([^}]*)\}/g)) {
      // A literal (`rows={2}`) is a fixed-height field, not a growing composer.
      if (!/\\n|split|includes/.test(m[1])) continue
      if (!m[1].includes('composerRows(')) offenders.push(`${rel}: rows={${m[1].trim()}}`)
    }
  }
  assert.deepEqual(
    offenders,
    [],
    'a composer computed its own height — use composerRows() from src/lib/formInput.ts, or the boxes drift apart again',
  )
})

test('the focus flash is one cue: tint + ring, tokens only', () => {
  // The co-tint since the Bindery duet — "you were brought here" is a PLACE.
  assert.ok(FOCUS_FLASH_CLASS.includes('bg-co-tint'), 'the arrival tint wears the co-color')
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
  // Out of scope, deliberately: ContextBrowseDialog paints the SELECTED
  // row with the same tint+ring. Same look, different role — persistent
  // selection state rather than "a door brought you here" — and the rule is
  // same-role-same-look, not same-look-same-name. Conflating them would make
  // one component import a constant called FOCUS_FLASH for something no focus
  // target ever consumes.
  const owners = ['lib/formInput.ts', 'lib/focusContext.ts', 'components/ContextBrowseDialog.tsx']
  for (const file of filesUnder('src')) {
    const rel = file.replace(/\\/g, '/')
    if (owners.some((o) => rel.endsWith(o))) continue
    const src = stripComments(read(file))
    // All THREE shapes of the one cue. The shell and the bare control joined
    // the scan the day they existed: a second shape is a second thing to
    // hand-roll, and the whole point of splitting the cue was that the split
    // could not produce two different-looking fields.
    for (const [name, cue] of [
      ['FORM_INPUT_CLASS', FORM_INPUT_CLASS],
      ['FIELD_SHELL_CLASS', FIELD_SHELL_CLASS],
      ['FIELD_BARE_CLASS', FIELD_BARE_CLASS],
    ] as const) {
      assert.ok(!src.includes(cue), `${rel} hand-rolls the field cue — import ${name} from src/lib/formInput.ts`)
    }
    // The flash's exact pairing. A `bg-accent-tint` on its own is a legitimate
    // resting surface (a selected picker row); it is the tint-plus-ring
    // combination that means "a door brought you here".
    assert.ok(
      !src.includes(FOCUS_FLASH_CLASS),
      `${rel} hand-rolls the focus flash — import FOCUS_FLASH_CLASS from src/lib/focusContext.ts`,
    )
  }
})
