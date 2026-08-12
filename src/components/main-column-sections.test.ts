/** Lock: main-column sections on detail pages use the BARE-heading idiom (S17,
 *  docs/design/surface-audit.md) — a PanelLabel-style uppercase heading with the
 *  LIST carded below (<MainSection> + <CardList>), never the boxed <SidePanel>
 *  chrome, which is the RAIL panel's cue (heading inside the box). The project
 *  page once rendered Contributors/Coordination as SidePanels beside the bare
 *  "Recent sessions" heading — same role, two looks. Source-level greps, like the
 *  other cue locks (src/lib/addTrigger.test.ts, src/lib/public-face.test.ts). */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const src = readFileSync(
  fileURLToPath(new URL('./SectionView.tsx', import.meta.url)),
  'utf8',
)

/** The source of one top-level function — from its `function Name` to the next
 *  top-level `function `/`const ` declaration (column-0 anchored). */
const fn = (name: string): string => {
  const start = src.indexOf(`function ${name}`)
  assert.ok(start >= 0, `function ${name} exists in SectionView`)
  const rest = src.slice(start + 1)
  const next = rest.search(/\n(?:export )?(?:function|const) /)
  return src.slice(start, next >= 0 ? start + 1 + next : undefined)
}

test('S17 — the project page main-column sections are bare headings, not boxed SidePanels', () => {
  for (const name of ['ContributorsPanel', 'CoordinationPanel', 'OpenWorkList']) {
    const body = fn(name)
    assert.ok(!body.includes('<SidePanel'), `${name} must not wear the rail-panel box (SidePanel)`)
  }
  // Contributors and Coordination route through the one main-column section primitive…
  assert.ok(fn('ContributorsPanel').includes('<MainSection'), 'ContributorsPanel uses MainSection')
  assert.ok(fn('CoordinationPanel').includes('<MainSection'), 'CoordinationPanel uses MainSection')
  // …and their lists card through the one list container.
  assert.ok(fn('ContributorsPanel').includes('<CardList'), 'contributor rows are carded via CardList')
  assert.ok(fn('CoordinationPanel').includes('<CardList'), 'sub-goal rows are carded via CardList')
  assert.ok(fn('OpenWorkList').includes('<CardList'), 'work items are carded via CardList')
})

test('S17 — MainSection is the one bare-heading primitive (renders PanelLabel, no box)', () => {
  const main = fn('MainSection')
  assert.ok(main.includes('<PanelLabel'), 'MainSection heads with the shared PanelLabel')
  assert.ok(
    !/className="[^"]*(?:border|shadow)/.test(main),
    'MainSection itself draws no box — the LIST cards, not the section',
  )
})

test('S17 — owner config (share switch, default role) lives in the rail, not the Contributors payload', () => {
  const contributors = fn('ContributorsPanel')
  assert.ok(!contributors.includes('ShareToggle'), 'ShareToggle moved to the rail Sharing panel')
  assert.ok(!contributors.includes('DefaultRolePicker'), 'DefaultRolePicker moved to the rail Sharing panel')
  assert.ok(
    /<SidePanel title="Sharing"[\s\S]{0,400}<ShareToggle[\s\S]{0,400}<DefaultRolePicker/.test(src),
    'the rail has a Sharing panel carrying both controls',
  )
})
