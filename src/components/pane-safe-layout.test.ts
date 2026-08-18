/** Page-INTERNAL layout switches gate on CONTAINER width, not viewport width
 *  (UI-9 generalized from list rows to page layouts). Every section page can
 *  render full-surface OR inside a half-width split pane, so a viewport
 *  breakpoint is the wrong variable for a page's own columns: at a 1280px
 *  window, `lg:flex-row` once held a context detail's two columns inside a 500px
 *  pane and squeezed both to unreadable widths, and the old artifact grid kept
 *  three columns of ~150px cards (the 2026-07-16 owner report). Context detail
 *  has since joined UI-30's one reading column; the artifact index joined it in
 *  UI-31 as a single preview list. Grids that still adapt remain container-
 *  gated. The page scroller (`Page`) is a `@container`; layout switches use
 *  `@`-variants.
 *
 *  Visibility gates (`max-sm:hidden` on a page title the NarrowBar already
 *  carries) are TIER rules — genuinely about the app viewport — and stay
 *  viewport-gated on purpose; only LAYOUT switches (row direction, grid
 *  column count) are banned from viewport prefixes here. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { ROOT, read, concatSource, resourcePageComponent, sectionViewComponent, stripComments } from '../../tests/helpers/source.ts'

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

test('list-row metadata is gated on the ROW container, not the viewport', () => {
  // UI-9's original row case, re-escaped 2026-07-21: ContextRow's meta cluster
  // ("N sessions / Last used …") was `sm:block` — in a ~380px split pane on a
  // wide window the viewport satisfies `sm:` but the row can't afford the
  // block, and the flex-1 identity column (the connector's NAME) collapsed to
  // zero width. Every @container list row is enumerated here: its function
  // body must carry the @container root and no viewport-prefixed visibility
  // gate on its fixed-width blocks.
  const src = stripComments(read(join(ROOT, 'src', 'components', 'SectionView.tsx')))
  const rows = ['ScheduledRow', 'ContextRow']
  for (const name of rows) {
    const start = src.indexOf(`function ${name}(`)
    assert.ok(start >= 0, `${name} exists in SectionView.tsx`)
    const body = src.slice(start, src.indexOf('\nfunction ', start + 1))
    assert.match(body, /group @container flex/, `${name}'s root is the @container its metadata gates on`)
    const viewportGated = body.match(/(?<![@:\w-])(?:max-)?(?:sm|md|lg|xl|2xl):(?:block|hidden|flex)/g) ?? []
    assert.deepEqual(
      viewportGated,
      [],
      `${name} gates row metadata on the viewport (use @-container variants — the row renders in panes): ${viewportGated.join(', ')}`,
    )
  }
})

test('the resource-page frame is the @container the page layouts key on', () => {
  const src = read(join(ROOT, 'src', 'components', 'SectionView.tsx'))
  const frame = stripComments(resourcePageComponent('ResourcePageFrame'))
  assert.match(frame, /flex-1 overflow-y-auto @container/, 'ResourcePageFrame carries the @container context')
  // Context detail deliberately has no switch now: UI-30 gives it the Project
  // reading column. UI-31 removes the Artifact grid entirely; one index cannot
  // promise the same reading order while changing from one to two columns.
  assert.ok(!src.includes('@3xl:flex-row'), 'Context detail no longer escapes into a side-column grammar')
  const artifacts = stripComments(sectionViewComponent('ArtifactsSection'))
  assert.match(artifacts, /<MainCollectionTemplate\b/, 'the Artifact index uses the one shared collection list template')
  assert.match(stripComments(resourcePageComponent('MainCollectionTemplate')), /<ResourcePageList\b/,
    'the shared template owns the one-column list')
  assert.doesNotMatch(artifacts, /grid-cols-/, 'the Artifact index never changes reading order by width')
})
