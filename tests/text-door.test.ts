/** The text door (src/lib/textDoor.ts) — the one cue for "this word opens a page":
 *  a row's title fronting its entity, a name inside a metadata line, an owner /
 *  source byline underlined at rest. Form follows function, like lib/inlineAction
 *  and lib/copyButton. These lock that:
 *    1. each constant is a real door cue,
 *    2. NO file under src/ re-hardcodes either spelling — the tree-wide scan,
 *    3. the consumers source the cue from the module,
 *    4. the deliberate non-door exceptions stay both justified and ALIVE.
 *
 *  Scope matters here. The lock this funnel replaces (tests/public-face.test.ts)
 *  greped `SectionView.tsx` alone while the rule it enforced was tree-wide, so two
 *  strays walked straight past it: a verbatim retype of OWNER_LINK_CLASS inside
 *  PublicFace.tsx itself, and a third spelling in artifactPreview.tsx. Every scan
 *  below reads `filesUnder('src')` for that reason. (docs/ui-invariants.md UI-16.) */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { ROOT, read, filesUnder, stripComments } from './helpers/source.ts'
import { DOOR_CLASS, STANDING_DOOR_CLASS } from '../src/lib/textDoor.ts'

const FUNNEL = join('src', 'lib', 'textDoor.ts')

test('the door cues carry door-ness — weight + underline, no color and no size', () => {
  // The cue owns what must not fork; the caller owns what legitimately varies.
  for (const piece of ['font-medium', 'transition', 'hover:underline']) {
    assert.ok(DOOR_CLASS.includes(piece), `the hover door keeps "${piece}"`)
  }
  for (const piece of ['underline', 'decoration-line-strong', 'underline-offset-2']) {
    assert.ok(STANDING_DOOR_CLASS.includes(piece), `the standing door keeps "${piece}"`)
  }
  // A standing door is underlined AT REST — it must not degrade into the hover cue.
  assert.ok(!STANDING_DOOR_CLASS.includes('hover:underline'), 'the standing door underlines at rest')
  // Size and color stay with the caller (a door matches the type scale of its own
  // non-door sibling; a retracted item's door is faint + struck). Baking either in
  // would fork the first pair it met, or collide with the ternary that owns color.
  for (const cue of [DOOR_CLASS, STANDING_DOOR_CLASS]) {
    assert.ok(!/\btext-\[|\btext-ink|\btext-accent/.test(cue), `the cue carries no color or size: "${cue}"`)
  }
})

test('no file under src/ re-hardcodes a door cue', () => {
  // The exact spellings live only in lib/textDoor; a component that retypes one
  // (the PublicFace + artifactPreview strays this funnel closed) fails here.
  // Comment-stripped, so the module's own prose can neither satisfy nor trip it.
  for (const file of filesUnder('src')) {
    if (file.endsWith(FUNNEL)) continue
    const src = stripComments(read(file))
    assert.ok(!src.includes(DOOR_CLASS), `${file} must take the door cue from lib/textDoor, not re-hardcode it`)
    assert.ok(
      !src.includes('decoration-line-strong'),
      `${file} must take the standing-door cue from lib/textDoor, not re-hardcode it`,
    )
  }
})

/** The roles that legitimately wear a hover underline WITHOUT being in-app doors,
 *  as the markers that identify them ON THE LINE that wears the cue.
 *
 *  Per-ELEMENT, not per-file, and that distinction is load-bearing: SectionView.tsx
 *  holds three external links, so a file-level exemption would have blanket-cleared
 *  the very file that held eleven of the drifted doors — a new hand-rolled door
 *  there would then sail through the ban it exists to enforce. A marker must appear
 *  within `MARKER_WINDOW` lines of the `hover:underline` it excuses, because JSX
 *  splits one element across lines: AccountMenu's `data-testid` sits two lines above
 *  its `className`. The window is small on purpose — wide enough to span an element,
 *  far too narrow to clear a file. */
const MARKER_WINDOW = 3
const NON_DOORS: Record<string, string[]> = {
  'src/components/SectionView.tsx': [
    // Leaving the app is a different promise from opening a page in it — and these
    // say so in `text-accent`. Structurally distinct too: anchors, not buttons.
    '<a ',
    // The system-prompt probe — an ACTION (it can be disabled mid-run), not a door.
    'disabled:opacity-50',
  ],
  // The sign-in flow's own cue set; lib/authFlow owns the auth screens entire.
  'src/lib/authFlow.ts': ['AUTH_LINK_CLASS'],
  // An org invite's Accept — a verdict ACTION paired with Decline, not a door. Its
  // class happens to match AUTH_LINK_CLASS character for character; that is a string
  // collision, not a shared role, and funnelling it there would couple the account
  // menu to the auth screens.
  'src/components/AccountMenu.tsx': ['org-invite-accept'],
}

test('every remaining hand-rolled hover-underline is a declared non-door — and still exists', () => {
  const offenders: string[] = []
  const usedMarkers = new Set<string>()
  for (const file of filesUnder('src')) {
    if (file.endsWith(FUNNEL)) continue
    const rel = file.slice(ROOT.length + 1).split('\\').join('/')
    const markers = NON_DOORS[rel] ?? []
    const lines = stripComments(read(file)).split('\n')
    lines.forEach((line, i) => {
      if (!line.includes('hover:underline')) return
      const near = lines.slice(Math.max(0, i - MARKER_WINDOW), i + MARKER_WINDOW + 1).join('\n')
      const excuse = markers.find((m) => near.includes(m))
      if (excuse) usedMarkers.add(`${rel}::${excuse}`)
      else offenders.push(`${rel}:${i + 1}`)
    })
  }
  assert.deepEqual(
    offenders,
    [],
    'a door was spelled by hand — route it through DOOR_CLASS (src/lib/textDoor.ts), or declare its non-door role in NON_DOORS',
  )

  // No dead exemptions: every declared marker must still excuse a real line. One
  // that stops matching (the role was funnelled, the markup moved) fails here
  // rather than keeping a permanent hole open — the vacuity lesson in
  // tests/CLAUDE.md: an allowlist nobody re-checks is a hole with a comment.
  for (const [rel, markers] of Object.entries(NON_DOORS)) {
    for (const m of markers) {
      assert.ok(
        usedMarkers.has(`${rel}::${m}`),
        `${rel}'s exemption "${m}" no longer excuses any hover:underline line — drop it`,
      )
    }
  }
})

test('the door consumers source the cue from the module', () => {
  // SectionView holds the title + metadata doors; PublicFace the owner byline and
  // the CreditLine lineage counts; artifactPreview the "From ‹source›" door.
  const consumers: Array<[string, string, number]> = [
    ['src/components/SectionView.tsx', 'DOOR_CLASS', 15],
    ['src/components/PublicFace.tsx', 'STANDING_DOOR_CLASS', 1],
    ['src/components/artifactPreview.tsx', 'STANDING_DOOR_CLASS', 1],
  ]
  for (const [rel, symbol, least] of consumers) {
    const src = read(join(ROOT, ...rel.split('/')))
    assert.match(src, /from\s+'(\.\.\/)*lib\/textDoor'/, `${rel} imports the shared cue`)
    const uses = (src.match(new RegExp(`\\$\\{${symbol}\\}`, 'g')) ?? []).length
    assert.ok(uses >= least, `${rel} wears ${symbol} at ${least}+ doors (found ${uses})`)
  }
})
