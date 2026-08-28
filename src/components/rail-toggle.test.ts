/** The rail-reopen control is IN-FLOW on every tier (UI-3, strengthened
 *  2026-07-21). The wide/medium spelling used to float the control absolutely
 *  over the content area, exempted by a convention that the primary surface
 *  indented its title (`pl-14`) to reserve the spot — and when the equal-panes
 *  model made every surface a homogeneous pane, the convention silently died
 *  and the button overlapped every page title. The rule is now absolute:
 *  layout RESERVES chrome's spot structurally (a gutter column, an inline
 *  `leading` slot); an indent convention in a component that might stop being
 *  rendered is not reservation. This lock scans the source; the rendered
 *  geometry is locked in e2e/responsive.spec.ts (narrow) and the wide-tier
 *  collapse case there. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { ROOT, read as readAbs } from '../../tests/helpers/source.ts'

// Repo-relative paths, so the prefix counts THIS file's depth (src/components/).
const read = (p: string) => readAbs(join(ROOT, p))

test('the collapsed-rail reopen control occupies layout — never absolutely positioned (UI-3)', () => {
  const app = read('src/App.tsx')
  // Isolate each "Expand sidebar" control's JSX block and assert none of them
  // carries an absolute/fixed position class.
  const blocks = app.split(/(?=<button)/).filter((b) => b.includes('Expand sidebar'))
  assert.ok(blocks.length >= 1, 'App.tsx renders the reopen control')
  for (const b of blocks) {
    const cls = b.match(/className="([^"]*)"/)?.[1] ?? ''
    assert.ok(
      !/\b(absolute|fixed)\b/.test(cls),
      `the reopen control must be in-flow, got: ${cls}`,
    )
  }
})

test('the organize/split/close cluster has one home — both rail hosts render PaneActionButtons', () => {
  // The expanded rail's header and the collapsed MiniRail offer the focused-
  // pane acts through ONE shared component, gated by the SAME hoisted handlers
  // (split: wide tier; close: split panes exist) — so the two hosts can't
  // drift in when they offer them, and neither re-hardcodes the buttons.
  const app = read('src/App.tsx')
  const sidebar = read('src/components/Sidebar.tsx')
  assert.ok(app.includes('<PaneActionButtons'), 'MiniRail renders the shared cluster')
  assert.ok(sidebar.includes('<PaneActionButtons'), 'the rail header renders the shared cluster')
  // The data stamps live only inside the one component (Sidebar.tsx defines
  // it) — App.tsx re-hardcoding a split/close button would carry them here.
  assert.ok(!app.includes('data-split-view'), 'App.tsx does not re-hardcode a split button')
  assert.ok(!app.includes('data-close-view'), 'App.tsx does not re-hardcode a close button')
  assert.match(sidebar, /ariaLabel="Organize pane"[\s\S]*?items=\{organizeItems\}/)
  assert.doesNotMatch(app, /ariaLabel="Organize pane"/, 'App does not redraw the shared menu')
})

test('the expanded rail groups split directions but keeps Close pane direct', () => {
  const sidebar = read('src/components/Sidebar.tsx')
  assert.match(sidebar, /<PaneActionButtons[\s\S]*?compact/, 'the width-constrained host requests compact form')
  assert.match(sidebar, /ariaLabel="Split pane"[\s\S]*?items=\{splitItems\}/, 'directions share one menu')
  const compactStart = sidebar.indexOf('if (compact)')
  const directStart = sidebar.indexOf('return (', compactStart)
  const directEnd = sidebar.indexOf('\n  return (', directStart + 1)
  const compactBody = sidebar.slice(compactStart, directEnd)
  assert.match(compactBody, /aria-label="Close pane"/, 'Close remains directly discoverable')
  assert.match(compactBody, /data-close-view/, 'the direct Close action keeps its shared behavior stamp')
})

test('Close pane carries an exact target and the controller closes that path, not later focus', () => {
  const app = read('src/App.tsx')
  const sidebar = read('src/components/Sidebar.tsx')
  const mainController = read('src/controller/useMainSplit.ts')
  const railController = read('src/controller/useRailSplit.ts')
  assert.equal(
    (sidebar.match(/data-close-target=\{closeTarget\}/g) ?? []).length,
    2,
    'both density variants stamp the action target',
  )
  assert.ok(app.includes('paneCloseTarget={paneCloseTarget}'), 'expanded rail receives the exact target')
  assert.ok(app.includes('closeTarget={mainCloseTarget}'), 'mini rail receives the exact main-pane target')
  const mainCloseBody = mainController.slice(
    mainController.indexOf('const closePaneFromAction'),
    mainController.indexOf('// Whether the rail', mainController.indexOf('const closePaneFromAction')),
  )
  assert.ok(mainCloseBody.includes('nodeAt(t, path)'), 'the main action resolves its captured path')
  assert.ok(!mainCloseBody.includes('focusedRef.current'), 'later main focus cannot redirect the close')
  const railCloseBody = railController.slice(
    railController.indexOf('const closeRailFromAction'),
    railController.indexOf('const setRailRatio'),
  )
  assert.ok(railCloseBody.includes('canCloseRailView(tree, path)'), 'the rail action validates its captured path')
  assert.ok(railCloseBody.includes('closeRailView(tree, path)'), 'the rail action closes its captured path')
  assert.ok(!railCloseBody.includes('focusedRef.current'), 'later rail focus cannot redirect the close')
})

test('no surface indents for floating chrome — the pl-14 convention stays dead', async () => {
  // The old exemption: a title indented `pl-14` so a floating control could sit
  // in the gap. Reservation now lives in the shell's gutter column; any pl-14
  // reappearing in src/ is the convention creeping back.
  const { concatSource } = await import('../../tests/helpers/source.ts')
  const src = concatSource('src')
  assert.ok(
    !/\bpl-14\b/.test(src),
    'pl-14 (the floating-chrome indent convention) must not return — reserve layout structurally',
  )
})
