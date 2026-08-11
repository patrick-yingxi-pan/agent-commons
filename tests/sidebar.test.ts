/** The left panel (sidebar) shares one hover cue across all its clickable elements
 *  — sourced from src/lib/sidebar.ts so it can't drift between the header icon
 *  buttons, nav rows, list rows, and the Scheduled fold header. These lock that:
 *    1. the token is a real hover-background utility,
 *    2. the sidebar sources its hover from the token — it hardcodes no copy,
 *    3. it imports the shared module.
 *
 *  (As with the fold headers, a real :hover can't run under the DOM-less node:test
 *  runner; the single-owner invariant is the thing that regresses on a re-copy.) */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { ROOT, read, stripComments } from './helpers/source.ts'
import { SIDEBAR_ACTIVE, SIDEBAR_HOVER } from '../src/lib/sidebar.ts'

const sidebarSrc = () => stripComments(read(join(ROOT, 'src', 'components', 'Sidebar.tsx')))

test('the sidebar hover token is a real hover-background utility', () => {
  assert.match(SIDEBAR_HOVER, /\bhover:bg-/, 'SIDEBAR_HOVER highlights the background on hover')
})

test('the left panel sources its hover from the shared token — no element re-hardcodes it', () => {
  const src = sidebarSrc()
  assert.ok(src.includes('SIDEBAR_HOVER'), 'Sidebar.tsx applies SIDEBAR_HOVER')
  // No interactive element in the left panel may hardcode a surface-hover
  // background — it must come from the token, so a re-pasted copy fails here.
  assert.ok(
    !src.includes('hover:bg-surface'),
    'no sidebar element hardcodes hover:bg-surface — it must come from lib/sidebar',
  )
})

test('the sidebar imports the shared hover module', () => {
  assert.match(sidebarSrc(), /from\s+'\.\.\/lib\/sidebar'/, 'Sidebar.tsx imports the shared sidebar module')
})

test('the rail marks WHERE YOU ARE without hue — one active look, no co-color', () => {
  // Owner directive 2026-08-10. The Bindery duet gave "places" the co seat, which
  // put a Prussian-blue pill in the rail — making a NAVIGATION marker the most
  // saturated element in the panel that had just surrendered its solid so it
  // would stop shouting. Standing location is fill + weight; co is kept for the
  // system's transient answers (focus flash, field focus, a checked box), which
  // is the sharper line the duet was reaching for.
  assert.ok(!/\bco\b|-co(?![\w])|co-/.test(SIDEBAR_ACTIVE), `the active row wears no co-color: "${SIDEBAR_ACTIVE}"`)
  assert.match(SIDEBAR_ACTIVE, /\bbg-/, 'it still fills, so "here" reads at a glance')
  assert.match(SIDEBAR_ACTIVE, /\bfont-medium\b/, 'and carries the weight bump that replaces the hue')

  // The whole rail, not just the token: no element may reintroduce the tint by
  // hand. This is the half that actually regresses — the pill was spelled inline
  // at two sites and the session rows at two more, each its own copy.
  const src = sidebarSrc()
  for (const banned of ['co-tint', 'text-co-strong']) {
    assert.ok(!src.includes(banned), `no rail element hardcodes ${banned} — standing location is neutral`)
  }
  // ONE active look across row kinds: the section pill and the session/recents
  // rows had drifted into two (a tinted pill vs a ringed fill) in one panel.
  assert.ok(!src.includes("'bg-panel-2 ring-1 ring-line-strong'"), 'the ringed active fill folded into SIDEBAR_ACTIVE')
  assert.ok(src.includes('SIDEBAR_ACTIVE'), 'Sidebar.tsx applies the shared active cue')
})
