/** The ledger (src/lib/ledger.ts) — the flat-collection recipe (owner directive
 *  2026-07-31, refined 2026-08-12): a collection renders as ONE frameless list
 *  of hairline-divided rows, never a pile of per-item cards. These lock that:
 *    1. the recipe carries the flat constraints — hairline dividers, small
 *       radius, and NO resting elevation (shadow means floating, lib/popover),
 *    2. no file under src/ re-hardcodes the container spelling — the tree-wide
 *       scan, the shape every one-home lock must have (the UI-16 lesson),
 *    3. the first converted surface (the Projects hub) still consumes the row
 *       and divider vocabulary INSIDE UI-30's shared `FoldSection` frame — and
 *       the card pile and parallel ledger-head grammar are both gone. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { ROOT, filesUnder, read, stripComments } from '../../tests/helpers/source.ts'
import {
  LEDGER_LIST_CLASS,
  LEDGER_RULE_CLASS,
  LEDGER_HEAD_CLASS,
  LEDGER_COUNT_CLASS,
  LEDGER_ROW_CLASS,
  QUIET_CARD_CLASS,
} from './ledger.ts'

const FUNNEL = join('src', 'lib', 'ledger.ts')

test('the ledger recipe is flat AND frameless — dividers only, no box, no resting elevation', () => {
  // The collection separates its rows and draws nothing around them (owner
  // directive 2026-08-12). Stated as a presence AND an absence, because the
  // absence is the whole revision: the 2026-07-31 pass had already asserted the
  // presences while a border was still there.
  for (const piece of ['divide-y', 'divide-line']) {
    assert.ok(LEDGER_LIST_CLASS.includes(piece), `the list keeps "${piece}"`)
  }
  for (const gone of [/border/, /border-/, /rounded-/, /overflow-hidden/]) {
    assert.doesNotMatch(LEDGER_LIST_CLASS, gone, `the list draws no frame: "${LEDGER_LIST_CLASS}"`)
  }
  // The structure moved UP to the section title, so the stroke that replaced the
  // box has to exist and has to be a single edge — a rule with four sides is the
  // box coming back under a new name.
  assert.match(LEDGER_RULE_CLASS, /border-b/, 'the boundary is one stroke')
  assert.doesNotMatch(LEDGER_RULE_CLASS, /rounded-|shadow|border-[tlr]/, 'and only one')
  // The sub-list head lost its panel FILL with the box: a filled band inside a
  // container is a header, and the same band with no container is a grey stripe
  // lying on the canvas — more chrome than the border it replaced, not less.
  assert.doesNotMatch(LEDGER_HEAD_CLASS, /bg-panel/, 'the head band is not a fill any more')
  assert.ok(LEDGER_HEAD_CLASS.includes(LEDGER_RULE_CLASS), 'it carries the same rule a section title does')
  // The quiet card — the gallery/feed item form — is just as flat: small radius,
  // hairline frame, and NO border color of its own (the flash arm owns color at
  // the call site; two border colors in one class attribute have no winner).
  assert.ok(QUIET_CARD_CLASS.includes('rounded-lg') && QUIET_CARD_CLASS.includes('border'))
  assert.ok(!/border-(line|accent|ink)/.test(QUIET_CARD_CLASS), 'the quiet card leaves border color to the caller')
  // Elevation means FLOATING (popovers, dialogs). A resting collection casting a
  // shadow, or wearing the old card radius, is the regression this direction ends.
  for (const cue of [LEDGER_LIST_CLASS, LEDGER_HEAD_CLASS, LEDGER_COUNT_CLASS, LEDGER_ROW_CLASS, QUIET_CARD_CLASS]) {
    assert.ok(!cue.includes('shadow'), `no resting shadow in "${cue}"`)
    assert.ok(!/rounded-(xl|2xl|3xl)/.test(cue), `no card radius in "${cue}"`)
  }
  // A row draws NO border of its own — the container's divide-y owns every
  // hairline, so rows can't double-rule against it.
  assert.ok(!LEDGER_ROW_CLASS.includes('border'), 'rows carry no border of their own')
  assert.doesNotMatch(LEDGER_ROW_CLASS, /\bpx-/, 'the hosting section, not each ledger row, owns the inset')
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
    'a bordered divider container was spelled by hand — and that shape is now doubly wrong: consume LEDGER_LIST_CLASS (src/lib/ledger.ts), which draws no frame at all',
  )
})

test('elevation means floating — resting chrome casts no shadow, tree-wide', () => {
  // The overlay tier: the ONLY files allowed a shadow, each a thing that FLOATS
  // above the page. Alive-checked below — an allowlist nobody re-checks is a
  // hole with a comment (the tests/CLAUDE.md vacuity lesson).
  const OVERLAYS = ['src/lib/popover.ts', 'src/lib/dialog.ts', 'src/components/Tooltip.tsx', 'src/components/AccountChip.tsx']
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

test('the Projects hub keeps ledger rows inside the shared page-section frame', () => {
  const rel = join('src', 'components', 'SectionView.tsx')
  const src = stripComments(read(join(ROOT, rel)))
  assert.match(src, /from\s+'\.\.\/lib\/ledger'/, 'SectionView imports the shared recipe')
  for (const symbol of ['LEDGER_LIST_CLASS', 'LEDGER_ROW_CLASS']) {
    assert.ok(src.includes(`{${symbol}}`), `SectionView renders with ${symbol}`)
  }
  assert.ok(!src.includes('{LEDGER_HEAD_CLASS}'), 'the old Projects-only group-head grammar is gone')
  assert.ok(!src.includes('{LEDGER_COUNT_CLASS}'), 'counts now ride FoldSection summaries')
  assert.match(src, /function ProjectsSection[\s\S]*?<FoldSection\b/, 'Projects groups are shared main-page sections')
  // The page-template synopsis row owns the skeleton + door pairing; Projects
  // consumes that one funnel instead of restating either class locally.
  assert.match(src, /function ProjectRow[\s\S]*?<SynopsisRow\b/, 'the Project row consumes the shared synopsis funnel')
  // The converted surface left no residue: the per-item card component is gone
  // (\b keeps similarly named resource-row helpers out of this assertion).
  assert.ok(!/\bProjectCard\b/.test(src), 'the ProjectCard card pile is fully replaced')
  // Quiet cards now survive only where containment communicates an independent
  // functional payload (today, the Ops metric-tile funnel). Synopsis lists are
  // enumerated by index-synopsis.test.ts instead of kept boxed to satisfy a floor.
  const quietUses = (src.match(/\$\{QUIET_CARD_CLASS\}/g) ?? []).length
  assert.ok(quietUses >= 1, `SectionView keeps QUIET_CARD_CLASS for a real contained payload (found ${quietUses})`)
})
