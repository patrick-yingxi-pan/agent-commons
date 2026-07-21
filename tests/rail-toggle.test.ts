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
import { readFileSync } from 'node:fs'

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')

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

test('no surface indents for floating chrome — the pl-14 convention stays dead', async () => {
  // The old exemption: a title indented `pl-14` so a floating control could sit
  // in the gap. Reservation now lives in the shell's gutter column; any pl-14
  // reappearing in src/ is the convention creeping back.
  const { concatSource } = await import('./helpers/source.ts')
  const src = concatSource('src')
  assert.ok(
    !/\bpl-14\b/.test(src),
    'pl-14 (the floating-chrome indent convention) must not return — reserve layout structurally',
  )
})
