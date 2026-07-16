/** Page-INTERNAL layout switches gate on CONTAINER width, not viewport width
 *  (UI-9 generalized from list rows to page layouts). Every section page can
 *  render full-surface OR inside a half-width split pane, so a viewport
 *  breakpoint is the wrong variable for a page's own columns: at a 1280px
 *  window, `lg:flex-row` held a context detail's two columns inside a 500px
 *  pane and squeezed both to unreadable widths, and the artifact grid kept
 *  three columns of ~150px cards (the 2026-07-16 owner report). The page
 *  scroller (`Page`) is a `@container`; layout switches use `@`-variants.
 *
 *  Visibility gates (`max-sm:hidden` on a page title the NarrowBar already
 *  carries) are TIER rules — genuinely about the app viewport — and stay
 *  viewport-gated on purpose; only LAYOUT switches (row direction, grid
 *  column count) are banned from viewport prefixes here. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { ROOT, read, concatSource } from './helpers/source.ts'

test('no page-level layout switch is viewport-gated — pane-hosted pages must gate on the container', () => {
  const components = concatSource('src/components')
  // The lookbehind excludes container variants (`@2xl:grid-cols-2` is the FIX,
  // not a violation).
  const banned = components.match(/(?<!@)\b(?:sm|md|lg|xl|2xl):(?:flex-row|flex-col|grid-cols-\d)/g) ?? []
  assert.deepEqual(
    banned,
    [],
    `viewport-gated layout switches found (use @-container variants — the page renders in panes): ${banned.join(', ')}`,
  )
})

test('the Page scroller is the @container the page layouts key on', () => {
  const src = read(join(ROOT, 'src', 'components', 'SectionView.tsx'))
  assert.match(src, /flex-1 overflow-y-auto @container/, 'Page carries the @container context')
  // The converted switches exist and are container-gated (the escape sites).
  assert.ok(src.includes('@3xl:flex-row'), 'detail side-columns gate on the container')
  assert.ok(src.includes('@2xl:grid-cols-2'), 'the artifact grid gates on the container')
})
