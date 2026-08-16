/** The card door (src/lib/cardDoor.ts) — the one behaviour + cue for "this whole
 *  CARD opens a page", the container-level companion to lib/textDoor's "this WORD
 *  opens a page". These lock that:
 *    1. each cue is a real hover cue and the two stay distinguishable,
 *    2. the pairing holds BOTH WAYS across the whole tree — a card wearing the cue
 *       is clickable, and a clickable card wears the cue,
 *    3. no file re-hardcodes either cue,
 *    4. the nested-control guard actually spares the controls inside a card.
 *
 *  Direction (2) is the point. The bug this funnel closed was not "no cue" — it
 *  was a cue that LIED: ContextRow and ScheduledRow washed the whole row on hover
 *  while only the left ⅔ was a button, so the gap beside the status pill ate the
 *  click. A one-way scan ("every door has a cue") would have passed that row
 *  forever. (docs/ui-invariants.md UI-17.) */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { ROOT, read, filesUnder, stripComments } from '../../tests/helpers/source.ts'
import {
  CARD_DOOR_CLASS,
  ROW_DOOR_CLASS,
  CARD_CONTROL_SELECTOR,
  CARD_DOOR_OPT_OUT,
  isCardControlClick,
} from './cardDoor.ts'

const FUNNEL = join('src', 'lib', 'cardDoor.ts')

/** A card's `onClick` and its `className` are adjacent in JSX but not neighbours —
 *  a prop or two, and the flash ternary, sit between them. Wide enough to span one
 *  element's props, far too narrow to pair two different cards. */
const PAIR_WINDOW = 10

/** Every subject the funnel has today. Not the enumeration the scans use — those
 *  are derived, per UI-1's lesson that hand-maintained lists are how escapes
 *  happen — but a FLOOR, so deleting the funnel's every call site can't leave the
 *  two-way scan passing over nothing. */
const SUBJECT_FLOOR = 6

test('the card cues are hover cues, and the two containers stay distinct', () => {
  for (const cue of [CARD_DOOR_CLASS, ROW_DOOR_CLASS]) {
    assert.ok(cue.includes('cursor-pointer'), `"${cue}" says it is clickable before the click`)
    assert.ok(cue.includes('transition'), `"${cue}" eases rather than snaps`)
    assert.ok(/\bhover:/.test(cue), `"${cue}" carries an actual hover cue`)
  }
  // A bordered CARD sharpens its border and tints; a ROW inside a divider list
  // has no border of its own to sharpen, so it only washes. Same role, different
  // container — if these ever converge, one of them is styling the wrong thing.
  // Neither cue may LIFT: elevation means floating (lib/ledger's flat direction),
  // so a hover shadow is the old card language creeping back.
  assert.ok(CARD_DOOR_CLASS.includes('hover:border-line-strong') && CARD_DOOR_CLASS.includes('hover:bg-'))
  assert.ok(ROW_DOOR_CLASS.includes('hover:bg-'))
  for (const cue of [CARD_DOOR_CLASS, ROW_DOOR_CLASS]) {
    assert.ok(!cue.includes('shadow'), `the cue does not lift: "${cue}"`)
  }
  assert.notEqual(CARD_DOOR_CLASS, ROW_DOOR_CLASS)
  // The cue is a cue, not a layout: padding, radius and the RESTING border /
  // background belong to the card (a rounded-2xl project card and a flush list
  // row wear the same cue). Only the non-hover half is checked — the cue's whole
  // job is to restate a border and a background under `hover:`.
  for (const cue of [CARD_DOOR_CLASS, ROW_DOOR_CLASS]) {
    const resting = cue.split(/\s+/).filter((c) => !c.startsWith('hover:')).join(' ')
    assert.ok(!/\bp-|\brounded-|\bborder-|\bbg-/.test(resting), `the cue carries no layout: "${resting}"`)
  }
})

test('no file re-hardcodes a card cue', () => {
  // The full spellings only — `hover:border-line-strong` on its own is the
  // secondary BUTTON cue (a dozen live call sites) and is a different role.
  for (const file of filesUnder('src')) {
    if (file.endsWith(FUNNEL)) continue
    const src = stripComments(read(file))
    assert.ok(
      !src.includes('hover:border-line-strong hover:bg-'),
      `${file} must take the card cue from lib/cardDoor, not re-hardcode it`,
    )
    assert.ok(
      !src.includes('hover:bg-panel-2/50'),
      `${file} must take the row cue from lib/cardDoor, not re-hardcode it`,
    )
  }
})

/** Both scans below walk the same lines; collected once. */
function cardDoorSites() {
  const opens: string[] = []
  const cues: string[] = []
  for (const file of filesUnder('src')) {
    if (file.endsWith(FUNNEL)) continue
    const rel = file.slice(ROOT.length + 1).split('\\').join('/')
    const lines = stripComments(read(file)).split('\n')
    const near = (i: number) => lines.slice(Math.max(0, i - PAIR_WINDOW), i + PAIR_WINDOW + 1).join('\n')
    lines.forEach((line, i) => {
      // The import line names both symbols without wearing or firing either.
      if (line.includes("from '../lib/cardDoor'")) return
      const where = `${rel} — ${line.trim().slice(0, 90)}`
      if (line.includes('cardDoorClick(')) opens.push(near(i).includes('_DOOR_CLASS') ? '' : where)
      if (/\b(CARD|ROW)_DOOR_CLASS\b/.test(line)) cues.push(near(i).includes('cardDoorClick(') ? '' : where)
    })
  }
  return { opens: opens.filter(Boolean), cues: cues.filter(Boolean), total: opens.length + cues.length }
}

test('a clickable card wears the cue — and a card wearing the cue is clickable', () => {
  const { opens, cues, total } = cardDoorSites()
  assert.deepEqual(
    opens,
    [],
    'a card takes the click but shows no hover cue — an invisible affordance; add CARD_DOOR_CLASS / ROW_DOOR_CLASS',
  )
  assert.deepEqual(
    cues,
    [],
    'a card LOOKS clickable but takes no click — the ContextRow / ScheduledRow bug; add cardDoorClick(onOpen)',
  )
  assert.ok(total >= SUBJECT_FLOOR, `the funnel still has its subjects (found ${total}, expected ≥ ${SUBJECT_FLOOR})`)
})

test('the guard spares every control inside a card, and the card itself is not one', () => {
  // Faked DOM: `closest` walks the chain the selector would, `contains` the tree.
  const make = (matches: boolean, inside = true) => {
    const hit = { tag: 'control' }
    return {
      target: { closest: (sel: string) => (matches && sel === CARD_CONTROL_SELECTOR ? hit : null) },
      hit,
      card: { contains: () => inside },
    }
  }
  const onControl = make(true)
  assert.equal(isCardControlClick(onControl.target as never, onControl.card as never), true, 'a nested control wins')

  const onBody = make(false)
  assert.equal(isCardControlClick(onBody.target as never, onBody.card as never), false, 'plain card body opens')

  // A control in a PORTAL (a dialog opened from the card) is not inside it — the
  // card must not swallow, nor be reopened by, a click that escaped its subtree.
  const portaled = make(true, false)
  assert.equal(isCardControlClick(portaled.target as never, portaled.card as never), false, 'outside the card, not ours')

  // The card element itself may match the selector (a legacy whole-card button);
  // that must not count as "a control inside", or the door could never fire.
  const self = { contains: () => true } as never
  const selfTarget = { closest: () => self } as never
  assert.equal(isCardControlClick(selfTarget, self), false, 'the card is never its own nested control')

  assert.equal(isCardControlClick(null, self), false, 'a click with no element target is inert, not a navigation')
})

test('the guard covers every interactive tag a card actually nests', () => {
  // The cards' real children: owner bylines and credit counts (button), external
  // links (a), the enabled switch (button + role=switch), search fields (input),
  // the inline composers (textarea), the sort dropdown (select).
  for (const tag of ['a', 'button', 'input', 'select', 'textarea', '[role="switch"]']) {
    assert.ok(CARD_CONTROL_SELECTOR.includes(tag), `the guard spares ${tag}`)
  }
  // …plus the REGION opt-out, for nested interaction areas whose inert pixels
  // still aren't card body.
  assert.ok(CARD_CONTROL_SELECTOR.includes(`[${CARD_DOOR_OPT_OUT}]`), 'the guard honours the region opt-out')
})

test('the region opt-out is worn where a card door encloses a composer', () => {
  // LocusGutter rides inside RunRow, which IS a card door: a click on the inline
  // composer's padding would navigate to the run and drop the unsent draft.
  const gutter = stripComments(read(join(ROOT, 'src', 'components', 'LocusGutter.tsx')))
  assert.ok(gutter.includes(CARD_DOOR_OPT_OUT), 'the locus gutter opts its whole region out of the card door')
  // The opt-out must stay rare and deliberate — a card whose every region opted
  // out would be a card door in name only. Raise this only with a reason.
  const worn = filesUnder('src').filter((f) => stripComments(read(f)).includes(`${CARD_DOOR_OPT_OUT}`) && !f.endsWith(FUNNEL))
  assert.ok(worn.length <= 2, `the opt-out stays exceptional (worn in ${worn.length} files)`)
})

test('the two door funnels stay separate concerns', () => {
  const src = read(join(ROOT, ...FUNNEL.split(/[\\/]/)))
  // The card door must not restate the word door's cue — a card that underlines
  // its title on card-hover is the drift UI-16 closed, one level up.
  assert.ok(!src.includes('hover:underline'), 'the card cue leaves the title cue to lib/textDoor')
  // …and it must say WHY it is not a button, because that is the reviewable half.
  assert.match(src, /role="button"/, 'the module records the deliberate non-use of role=button')
})
