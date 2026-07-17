/** UI-15 — **a chooser is chrome, never a pane** (docs/ui-invariants.md).
 *  A control whose job is NAVIGATION — picking among sibling entities (the
 *  scheduled-run switcher) or choosing what a surface should show (the old
 *  empty-pane picker) — floats as a transient click-down through the shared
 *  popover funnel, never as a persistent pane/panel splitting the layout.
 *  Earned 2026-07-17: opening a scheduled run tiled the run-history LIST as a
 *  pane beside the thread — every run session read as "two split windows".
 *
 *  The ratchet:
 *    1. the pane vocabularies hold CONTENT kinds only — no 'runs', no
 *       'picker'/'mpicker' (a new chooser kind fails here);
 *    2. the retired chooser components stay deleted;
 *    3. the run switcher is the title bar's floating click-down, wearing the
 *       popover funnel (surface + dismiss + shift);
 *    4. legacy persisted trees migrate their chooser leaves away
 *       (tests/main-split.test.ts locks the migration itself). */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p: string) => readFileSync(p, 'utf8')
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

test('the pane vocabularies hold CONTENT kinds only — no chooser/switcher kind', () => {
  const frame = stripComments(read(join(ROOT, 'src', 'lib', 'splitFrame.ts')))
  for (const banned of ["'runs'", "'picker'"]) {
    assert.ok(!frame.includes(banned), `PaneContent must not carry the ${banned} chooser kind`)
  }
  const main = stripComments(read(join(ROOT, 'src', 'lib', 'mainSplit.ts')))
  // The migration FUNCTION is the ONE place allowed to name the retired kinds
  // — cut out exactly its span (declaration → its top-level closing brace) so
  // code before AND after it stays scanned.
  const migStart = main.indexOf('export function migrateMainSplit')
  const migEnd = main.indexOf('\n}', migStart)
  assert.ok(migStart >= 0 && migEnd > migStart, 'the migration function exists (the exemption has a subject)')
  const outsideMigration = main.slice(0, migStart) + main.slice(migEnd + 2)
  for (const banned of ["'mpicker'", "'runs'", "'picker'"]) {
    assert.ok(
      !outsideMigration.includes(banned),
      `MainPaneContent must not carry the ${banned} chooser kind (only migrateMainSplit may name it)`,
    )
  }
})

test('the retired chooser components stay deleted', () => {
  assert.ok(!existsSync(join(ROOT, 'src', 'components', 'RunsPanel.tsx')), 'the runs PANE is retired')
  assert.ok(!existsSync(join(ROOT, 'src', 'components', 'MainPicker.tsx')), 'the empty-pane PICKER is retired')
})

test('the run switcher is a floating click-down in the session title bar, on the popover funnel', () => {
  const menu = read(join(ROOT, 'src', 'components', 'RunHistoryMenu.tsx'))
  assert.ok(menu.includes('POPOVER_SURFACE'), 'wears the shared popover chrome (UI-1)')
  assert.ok(menu.includes('usePopoverShift'), 'self-corrects into the viewport (UI-1)')
  assert.ok(menu.includes('useDismissable'), 'dismisses on outside-click + Escape (UI-5)')
  assert.ok(menu.includes('data-run-history'), 'stamps the enumeration handle for browser sweeps')
  const bar = stripComments(read(join(ROOT, 'src', 'components', 'SessionTitleBar.tsx')))
  assert.match(bar, /<RunHistoryMenu/, "the click-down lives in the run session's title bar")
  const pane = stripComments(read(join(ROOT, 'src', 'components', 'ConversationPane.tsx')))
  assert.match(pane, /onSelectRun=\{nav\.onOpenSession\}/, 'selecting a run is the ONE session door (retargets in place)')
})
