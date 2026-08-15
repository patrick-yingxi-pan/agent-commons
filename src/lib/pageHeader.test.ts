/** Page-title headers share one styling source (src/lib/pageHeader.ts): every
 *  full page — hub pages and detail pages alike — opens with the SAME title
 *  look and container rhythm (form follows function: one role ⇒ one look).
 *  Before the module, the one role wore four title spellings (a dropped
 *  font-semibold, a stray text-[24px]) and three margins — copy-paste drift.
 *  These lock:
 *    1. the title class carries the full look (family/size/weight/color),
 *    2. the container wraps (a header must survive a half-width pane, UI-9)
 *       and keeps one bottom rhythm,
 *    3. the look is defined once — no component re-hardcodes or re-drifts it,
 *    4. the consumers source their styling from the shared module.
 *  Out of scope BY DESIGN: SessionTitleBar and PanelShell are compact chrome
 *  BARS (border-b, fixed height, sans) — a different role from a page's title
 *  block; don't sweep them into this primitive. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { ROOT, read, concatSource } from '../../tests/helpers/source.ts'
import { PAGE_BACK_CLASS, PAGE_HEADER_CLASS, PAGE_TITLE_CLASS } from './pageHeader.ts'

test('the page title class carries the one full look', () => {
  for (const piece of ['font-serif', 'text-2xl', 'font-semibold', 'leading-tight', 'text-ink']) {
    assert.ok(PAGE_TITLE_CLASS.includes(piece), `the title look keeps "${piece}"`)
  }
})

test('the page header container wraps (pane-safe, UI-9) and keeps one rhythm', () => {
  for (const piece of ['flex-wrap', 'items-start', 'justify-between', 'mb-6', 'max-sm:mb-3']) {
    assert.ok(PAGE_HEADER_CLASS.includes(piece), `the container keeps "${piece}"`)
  }
})

test('the page-title look is defined once — no component re-hardcodes or re-drifts it', () => {
  const moduleSrc = read(join(ROOT, 'src', 'lib', 'pageHeader.ts'))
  assert.ok(moduleSrc.includes('font-serif text-2xl'), 'the shared module owns the title literal')
  const components = concatSource('src/components')
  // The canonical spelling must come from the constant, never inline…
  assert.ok(
    !components.includes('font-serif text-2xl'),
    'no component re-hardcodes the page-title look — it must come from lib/pageHeader',
  )
  // …and the drift spellings that motivated the module stay dead (the work-item
  // page once shipped text-[24px] with the weight silently dropped).
  assert.ok(!components.includes('text-[24px]'), 'the text-[24px] drift spelling stays dead')
})

test('the back control is an inline round arrow ON the title line — never a floating eyebrow', () => {
  // The one look: a circular ghost icon-button sized to the title line, hanging
  // into the gutter so the title keeps the content edge.
  for (const piece of ['rounded-full', 'h-8 w-8', 'shrink-0', '-ml-2']) {
    assert.ok(PAGE_BACK_CLASS.includes(piece), `the back control keeps "${piece}"`)
  }
  // The shared BackButton (its own module since ADAPT-18 — the conversation
  // title bar wears the same control) consumes the primitive and NAMES its
  // destination (the arrow alone must still announce where it goes).
  const src = read(join(ROOT, 'src', 'components', 'BackButton.tsx'))
  assert.ok(src.includes('PAGE_BACK_CLASS'), 'the shared BackButton consumes the primitive')
  assert.match(src, /aria-label=\{`Back to \$\{label\}`\}/, 'the arrow announces its destination')
  // Every surface that shows a back affordance renders the ONE component —
  // the section pages (details + the hub PageHeader) and the conversation
  // title bar alike (ADAPT-18: a session opened from a page goes back too).
  for (const consumer of ['SectionView.tsx', 'SessionTitleBar.tsx']) {
    const c = read(join(ROOT, 'src', 'components', consumer))
    assert.match(c, /from\s+'\.\/BackButton'/, `${consumer} imports the shared BackButton`)
    assert.ok(c.includes('<BackButton'), `${consumer} renders <BackButton>`)
  }
  // The retired stacked-eyebrow spelling (a small "← Label" line floating a
  // margin above the title) stays dead across components.
  const components = concatSource('src/components')
  assert.ok(
    !components.includes('mb-4 inline-flex max-w-full items-center gap-1.5'),
    'no component re-hardcodes the floating-eyebrow back button',
  )
})

test('the page-header consumers source their styling from the shared module', () => {
  const src = read(join(ROOT, 'src', 'components', 'SectionView.tsx'))
  const template = read(join(ROOT, 'src', 'components', 'ResourcePage.tsx'))
  assert.match(src, /from\s+'(\.\.\/)+lib\/pageHeader'/, 'SectionView imports the shared page-header module')
  assert.match(template, /from\s+'(\.\.\/)+lib\/pageHeader'/, 'the page templates import the shared page-header module')
  assert.match(template, /function ResourcePageHeader/, 'both templates expose the one standard header')
  for (const symbol of ['PAGE_TITLE_CLASS', 'PAGE_HEADER_CLASS']) {
    assert.ok(src.includes(symbol), `SectionView uses ${symbol}`)
    assert.ok(template.includes(symbol), `ResourcePageHeader uses ${symbol}`)
  }
  // Every page header consumes the shared container: the hub PageHeader, the
  // detail pages (project / context / schedule / owner profile / agent). A new
  // page that hand-rolls its header shows up as a missing consumption here
  // only if it also inlines the title look — which the grep above catches.
  const uses = src.match(/PAGE_TITLE_CLASS/g)?.length ?? 0
  assert.ok(uses >= 8, `the title constant is consumed across the pages (${uses} uses)`)
})
