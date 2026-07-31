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
import { ROOT, filesUnder, read, stripComments } from './helpers/source.ts'
import {
  LEDGER_BOX_CLASS,
  LEDGER_HEAD_CLASS,
  LEDGER_COUNT_CLASS,
  LEDGER_ROW_CLASS,
  QUIET_CARD_CLASS,
} from '../src/lib/ledger.ts'

const FUNNEL = join('src', 'lib', 'ledger.ts')

test('the ledger recipe is flat — dividers and a small radius, no resting elevation', () => {
  for (const piece of ['divide-y', 'divide-line', 'rounded-md', 'border-line']) {
    assert.ok(LEDGER_BOX_CLASS.includes(piece), `the box keeps "${piece}"`)
  }
  // The quiet card — the gallery/feed item form — is just as flat: small radius,
  // hairline frame, and NO border color of its own (the flash arm owns color at
  // the call site; two border colors in one class attribute have no winner).
  assert.ok(QUIET_CARD_CLASS.includes('rounded-lg') && QUIET_CARD_CLASS.includes('border'))
  assert.ok(!/border-(line|accent|ink)/.test(QUIET_CARD_CLASS), 'the quiet card leaves border color to the caller')
  // Elevation means FLOATING (popovers, dialogs). A resting collection casting a
  // shadow, or wearing the old card radius, is the regression this direction ends.
  for (const cue of [LEDGER_BOX_CLASS, LEDGER_HEAD_CLASS, LEDGER_COUNT_CLASS, LEDGER_ROW_CLASS, QUIET_CARD_CLASS]) {
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

test('elevation means floating — resting chrome casts no shadow, tree-wide', () => {
  // The overlay tier: the ONLY files allowed a shadow, each a thing that FLOATS
  // above the page. Alive-checked below — an allowlist nobody re-checks is a
  // hole with a comment (the tests/CLAUDE.md vacuity lesson).
  const OVERLAYS = ['src/lib/popover.ts', 'src/lib/dialog.ts', 'src/components/Tooltip.tsx', 'src/components/AccountMenu.tsx']
  const floating = new Set<string>()
  for (const file of filesUnder('src')) {
    const rel = file.slice(ROOT.length + 1).split('\\').join('/')
    const src = stripComments(read(file))
    // `drop-shadow-sm` is exempt by the lookbehind: a text-legibility filter on
    // thumbnail lettering, not box elevation.
    assert.ok(!/(?<!drop-)\bshadow-sm\b/.test(src), `${rel}: shadow-sm is the old resting-card language — nothing at rest casts a shadow`)
    // The BARE `shadow` utility too (the toggle knobs wore it) — matched inside a
    // class string, where it sits between spaces or quotes.
    assert.ok(!/["'` ]shadow["'` ]/.test(src), `${rel}: the bare shadow utility — knobs and chips take a ring, not a lift`)
    assert.ok(!src.includes('hover:shadow'), `${rel}: a hover lift is the old card cue — lib/cardDoor sharpens and tints instead`)
    assert.ok(!/\brounded-(2xl|3xl)/.test(src), `${rel}: rounded-2xl+ is the old card radius — the scale tops out at rounded-xl (lib/ledger)`)
    if (/\bshadow-(md|lg|xl|2xl)\b/.test(src)) {
      assert.ok(OVERLAYS.includes(rel), `${rel} casts an overlay shadow but is not a declared overlay`)
      floating.add(rel)
    }
  }
  for (const o of OVERLAYS) {
    assert.ok(floating.has(o), `${o} no longer floats — drop it from the overlay allowlist`)
  }
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
  // The quiet-card consumers: the artifact tile, the one Commons card funnel, and
  // the context detail frame all take the frame from the module.
  const quietUses = (src.match(/\$\{QUIET_CARD_CLASS\}/g) ?? []).length
  assert.ok(quietUses >= 3, `SectionView wears QUIET_CARD_CLASS at 3+ frames (found ${quietUses})`)
})
