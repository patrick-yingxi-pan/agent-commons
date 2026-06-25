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
import { SIDEBAR_HOVER } from '../src/lib/sidebar.ts'

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
