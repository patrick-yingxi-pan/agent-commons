/** The ledger (src/lib/ledger.ts) — the flat-collection recipe (owner directive
 *  2026-07-31): a collection renders as ONE bordered container with hairline-
 *  divided rows, never a pile of per-item cards. These lock that:
 *    1. the recipe carries the flat constraints — hairline dividers, small
 *       radius, and NO resting elevation (shadow means floating, lib/popover),
 *    2. no file under src/ re-hardcodes the container spelling — the tree-wide
 *       scan, the shape every one-home lock must have (the UI-16 lesson),
 *    3. the first converted surface (the Projects hub) consumes the primitive:
 *       ledger boxes with heads, rows wearing the shared skeleton + the row
 *       door cue from lib/cardDoor — and the card pile it replaced is gone. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { filesUnder, read, stripComments } from './helpers/source.ts'
import {
  LEDGER_BOX_CLASS,
  LEDGER_HEAD_CLASS,
  LEDGER_COUNT_CLASS,
  LEDGER_ROW_CLASS,
} from '../src/lib/ledger.ts'

const FUNNEL = join('src', 'lib', 'ledger.ts')

test('the ledger recipe is flat — dividers and a small radius, no resting elevation', () => {
  for (const piece of ['divide-y', 'divide-line', 'rounded-md', 'border-line']) {
    assert.ok(LEDGER_BOX_CLASS.includes(piece), `the box keeps "${piece}"`)
  }
  // Elevation means FLOATING (popovers, dialogs). A resting collection casting a
  // shadow, or wearing the old card radius, is the regression this direction ends.
  for (const cue of [LEDGER_BOX_CLASS, LEDGER_HEAD_CLASS, LEDGER_COUNT_CLASS, LEDGER_ROW_CLASS]) {
    assert.ok(!cue.includes('shadow'), `no resting shadow in "${cue}"`)
    assert.ok(!/rounded-(xl|2xl|3xl)/.test(cue), `no card radius in "${cue}"`)
  }
  // A row draws NO border of its own — the container's divide-y owns every
  // hairline, so rows can't double-rule against it.
  assert.ok(!LEDGER_ROW_CLASS.includes('border'), 'rows carry no border of their own')
})

test('no file under src/ re-hardcodes a bordered divider container', () => {
  // The ledger ROLE is "a bordered, rounded container whose children divide with
  // hairlines" — any class line pairing all three has hand-rolled the recipe
  // (CardList wore exactly that spelling, plus the old card shadow, until this
  // funnel closed over it). A BARE `divide-y` stays legal: interior row dividers
  // inside a standalone card (RelationActionCard's proposed-ops rows, the tool
  // activity card) are a different role — objects that stand alone keep their
  // own chrome, and their dividers are not a collection container.
  const offenders: string[] = []
  for (const file of filesUnder('src')) {
    if (file.endsWith(FUNNEL)) continue
    stripComments(read(file))
      .split('\n')
      .forEach((line, i) => {
        if (/divide-y/.test(line) && /\bborder\b/.test(line) && /rounded-/.test(line)) {
          offenders.push(`${file}:${i + 1}`)
        }
      })
  }
  assert.deepEqual(
    offenders,
    [],
    'a bordered divider container was spelled by hand — consume LEDGER_BOX_CLASS (src/lib/ledger.ts)',
  )
})

test('the Projects hub consumes the ledger — and the card pile is gone', () => {
  const rel = join('src', 'components', 'SectionView.tsx')
  const src = stripComments(read(join(import.meta.dirname, '..', rel)))
  assert.match(src, /from\s+'\.\.\/lib\/ledger'/, 'SectionView imports the shared recipe')
  for (const symbol of ['LEDGER_BOX_CLASS', 'LEDGER_HEAD_CLASS', 'LEDGER_COUNT_CLASS']) {
    assert.ok(src.includes(`{${symbol}}`), `SectionView renders with ${symbol}`)
  }
  // The row wears the shared skeleton AND the door cue — one template literal,
  // so the pairing can't drift apart silently.
  assert.ok(
    src.includes('${LEDGER_ROW_CLASS} ${ROW_DOOR_CLASS}'),
    'the project row pairs the ledger skeleton with the row door cue',
  )
  // The converted surface left no residue: the per-item card component is gone
  // (\b keeps SharedProjectCard — Discover's card, a later conversion — out of
  // this assertion's reach).
  assert.ok(!/\bProjectCard\b/.test(src), 'the ProjectCard card pile is fully replaced')
})
