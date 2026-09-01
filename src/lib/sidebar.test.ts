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
import { ROOT, read, stripComments } from '../../tests/helpers/source.ts'
import {
  SIDEBAR_ACTIVE,
  SIDEBAR_BRANCH,
  SIDEBAR_CREATE_BUTTON,
  SIDEBAR_ENTRY_LEAD,
  SIDEBAR_FOCUS_WITHIN,
  SIDEBAR_HOVER,
  SIDEBAR_NESTED_ENTRY_LAYOUT,
  SIDEBAR_TOOLBAR_BUTTON,
  sidebarEntryClass,
} from './sidebar.ts'

const sidebarSrc = () => stripComments(read(join(ROOT, 'src', 'components', 'Sidebar.tsx')))
const componentSrc = (name: string) => stripComments(read(join(ROOT, 'src', 'components', name)))

test('the sidebar hover token is a real hover-background utility', () => {
  assert.match(SIDEBAR_HOVER, /\bhover:bg-/, 'SIDEBAR_HOVER highlights the background on hover')
})

test('the expanded rail toolbar has one compact, keyboard-visible button funnel', () => {
  assert.match(SIDEBAR_TOOLBAR_BUTTON, /\bh-7\b/, 'the constrained header uses a 28px rhythm')
  assert.match(SIDEBAR_TOOLBAR_BUTTON, /\bw-7\b/, 'each control has one fixed compact width')
  assert.match(SIDEBAR_TOOLBAR_BUTTON, /\bshrink-0\b/, 'icons never compress into misaligned shapes')
  assert.match(SIDEBAR_TOOLBAR_BUTTON, /focus-visible:ring-2/, 'keyboard focus remains visible')
  assert.match(SIDEBAR_TOOLBAR_BUTTON, /data-\[open=true\]:bg-/, 'an open grouped menu retains its cue')
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

test('contextual rail-row buttons share one enforced resting-display funnel', () => {
  const filter = componentSrc('FilterMenu.tsx')
  assert.match(filter, /placement === 'rail' \? HOVER_REVEAL/, 'every rail filter hides at rest, regardless of state')
  assert.doesNotMatch(filter, /placement === 'rail' && !active/, 'active state cannot opt a rail filter out of the funnel')
  assert.match(filter, /has-\[\[data-open=true\]\]:opacity-100/, 'an open filter remains visible')
  assert.match(filter, /focus-within:opacity-100/, 'a keyboard-focused filter remains visible')
  assert.match(filter, /data-contextual-action=\{placement === 'rail'/, 'rail filters identify the governed role')

  const rowMenu = componentSrc('RowMenu.tsx')
  assert.match(rowMenu, /data-contextual-action=\{triggerClassName == null/, 'default row menus identify the same role')
  assert.match(rowMenu, /\$\{HOVER_REVEAL\}/, 'default row menus use the shared resting-display cue')

  const sidebar = sidebarSrc()
  const start = sidebar.indexOf('trailing={')
  const end = sidebar.indexOf('\n              />', start)
  assert.ok(start >= 0 && end > start, 'the root-row trailing action cluster is enumerable')
  const trailing = sidebar.slice(start, end)
  const allowed = ['CompositeRailControls', 'ScheduledFilterMenu', 'SectionFilterMenu', 'SessionFilterMenu']
  const rendered = [...trailing.matchAll(/<([A-Z][A-Za-z0-9]*)\b/g)].map((match) => match[1]).sort()
  assert.deepEqual(rendered, allowed, 'the complete root action cluster uses only the governed components')
  for (const component of allowed) {
    assert.ok(trailing.includes(`<${component}`), `${component} is routed through an enforced action primitive`)
  }
  assert.doesNotMatch(trailing, /<button\b|<FilterMenu\b|<RowMenu\b/, 'the rail root cannot hand-roll a trailing button')
})

test('the sidebar imports the shared hover module', () => {
  assert.match(sidebarSrc(), /from\s+'\.\.\/lib\/sidebar'/, 'Sidebar.tsx imports the shared sidebar module')
})

test('the create action is an aligned rail row without ornamental icon chrome', () => {
  assert.match(SIDEBAR_CREATE_BUTTON, /min-h-8/, 'the action follows the shared 32px rhythm')
  assert.match(SIDEBAR_CREATE_BUTTON, /items-center/, 'the glyph and type share one vertical centre')
  assert.match(SIDEBAR_CREATE_BUTTON, /rounded-lg/, 'it shares the rail row radius')
  const source = sidebarSrc()
  const start = source.indexOf('data-rail-create')
  const end = source.indexOf('</button>', start)
  assert.ok(start >= 0 && end > start, 'the create action has an enumerable source body')
  const create = source.slice(start, end)
  assert.match(create, /<Plus[^>]*\/>\s*<span>New session<\/span>/, 'icon and label are direct siblings')
  assert.doesNotMatch(create, /rounded-full|ring-1/, 'the plus has no decorative container')
})

test('the rail marks WHERE YOU ARE without hue — one active look, no co-color', () => {
  // Owner directive 2026-08-10. The Bindery duet gave "places" the co seat, which
  // put a Prussian-blue pill in the rail — making a NAVIGATION marker the most
  // saturated element in the panel that had just surrendered its solid so it
  // would stop shouting. Standing location is fill + marker; co is kept for the
  // system's transient answers (focus flash, field focus, a checked box), which
  // is the sharper line the duet was reaching for.
  assert.ok(!/\bco\b|-co(?![\w])|co-/.test(SIDEBAR_ACTIVE), `the active row wears no co-color: "${SIDEBAR_ACTIVE}"`)
  assert.match(SIDEBAR_ACTIVE, /\bbg-/, 'it still fills, so "here" reads at a glance')
  assert.doesNotMatch(SIDEBAR_ACTIVE, /\bfont-/, 'selection does not break the resting weight shared at one depth')
  assert.match(SIDEBAR_ACTIVE, /before:left-0/, 'the persistent location marker is distinct from keyboard focus')

  // The whole rail, not just the token: no element may reintroduce the tint by
  // hand. This is the half that actually regresses — the pill was spelled inline
  // at two sites and the session rows at two more, each its own copy.
  const src = sidebarSrc()
  for (const banned of ['co-tint', 'text-co-strong']) {
    assert.ok(!src.includes(banned), `no rail element hardcodes ${banned} — standing location is neutral`)
  }
  // ONE active look across row kinds: the section pill and the Sessions
  // rows had drifted into two (a tinted pill vs a ringed fill) in one panel.
  assert.ok(!src.includes("'bg-panel-2 ring-1 ring-line-strong'"), 'the ringed active fill folded into SIDEBAR_ACTIVE')
  assert.ok(src.includes('SIDEBAR_ACTIVE'), 'Sidebar.tsx applies the shared active cue')
})

test('focus and tree depth each have one rail-wide cue', () => {
  assert.match(SIDEBAR_FOCUS_WITHIN, /focus-within:bg-/, 'focus washes the containing row')
  assert.doesNotMatch(SIDEBAR_FOCUS_WITHIN, /before:/, 'focus never impersonates the standing location marker')
  assert.match(SIDEBAR_BRANCH, /border-l/, 'a disclosed branch carries one visible guide')
  const src = sidebarSrc()
  assert.ok(sidebarEntryClass('item', false).includes(SIDEBAR_FOCUS_WITHIN), 'the shared row funnel owns focus')
  assert.ok(src.includes('sidebarEntryClass'), 'Sidebar rows use the shared row funnel')
})

test('every non-root entry reserves one fixed lead column', () => {
  assert.match(SIDEBAR_ENTRY_LEAD, /\bh-6\b/, 'the lead seat meets the 24px disclosure target floor')
  assert.match(SIDEBAR_ENTRY_LEAD, /\bw-6\b/, 'the lead seat has one fixed, touch-safe width')
  assert.match(SIDEBAR_ENTRY_LEAD, /\bshrink-0\b/, 'long labels cannot consume the hierarchy column')
  assert.match(SIDEBAR_ENTRY_LEAD, /items-center/, 'a caret and an empty seat share one centre')
})

test('semantic role never restyles entries at the same nested depth', () => {
  const group = sidebarEntryClass('group', false)
  const item = sidebarEntryClass('item', false)
  const view = sidebarEntryClass('view', false)
  assert.equal(group, item, 'a structural group and canonical item share one nested-row class')
  assert.equal(item, view, 'a standing view cannot invent a quieter same-depth row')
  assert.match(SIDEBAR_NESTED_ENTRY_LAYOUT, /\bgap-2\b/, 'every nested identity follows the same lead gap')
  assert.match(SIDEBAR_NESTED_ENTRY_LAYOUT, /\bpx-2\b/, 'every nested row uses one horizontal inset')
  assert.match(SIDEBAR_NESTED_ENTRY_LAYOUT, /text-\[13px\]/, 'every nested row uses one readable type scale')
  assert.doesNotMatch(SIDEBAR_NESTED_ENTRY_LAYOUT, /font-/, 'semantic kind does not change resting weight')
})
