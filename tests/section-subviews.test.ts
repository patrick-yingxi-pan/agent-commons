/** Rail sub-navigation is an inline disclosure tree (VSCode-explorer style): a section
 *  with sub-nodes carries a chevron and expands IN PLACE — no push, no back button. The
 *  ONE registry `src/lib/subviews.ts` is the source of truth both the rail (Sidebar) and
 *  the section body (SectionView) read. Filtering (a list narrowed by a facet) is NOT
 *  navigation — it never becomes an ad-hoc in-page dropdown. These lock the shape. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { ROOT, read, concatSource } from './helpers/source.ts'
import { SECTION_SUBVIEWS } from '../src/lib/subviews.ts'

test('the rail registry holds only the Agents hub sub-navigation', () => {
  assert.deepEqual(Object.keys(SECTION_SUBVIEWS), ['agents'])
})

test('the Agents hub children are its four NON-default surfaces', () => {
  const subs = SECTION_SUBVIEWS.agents
  // The worker-agents list is the section row itself; listing it again as a child would
  // duplicate "Agents" (and make the rail nav ambiguous).
  assert.deepEqual(subs.map((s) => s.id), ['prompts', 'commissions', 'discover', 'audit'])
  assert.ok(!subs.some((s) => s.id === 'agents'), 'the worker-agents surface is the section, not a child')
  const ids = subs.map((s) => s.id)
  assert.equal(new Set(ids).size, ids.length, 'ids unique')
  for (const s of subs) assert.ok(s.label.trim(), `${s.id} needs a label`)
})

test('the rail is an inline disclosure tree, not a drill-in push', () => {
  const sidebar = read(join(ROOT, 'src', 'components', 'Sidebar.tsx'))
  assert.match(sidebar, /SECTION_SUBVIEWS/, 'the rail reads the registry to build its tree')
  assert.match(sidebar, /function SectionTreeRow/, 'sections render as disclosure-tree rows')
  assert.match(sidebar, /toggleExpand/, 'nodes expand/collapse in place')
  assert.doesNotMatch(sidebar, /SectionSubmenu/, 'the drill-in sub-menu is gone')
  assert.doesNotMatch(sidebar, /ChevronLeft/, 'the "‹ Sections" back chip is gone — no push')
})

test('the body + controller route through the registry; a section lands on its default', () => {
  const sectionView = read(join(ROOT, 'src', 'components', 'SectionView.tsx'))
  assert.match(sectionView, /subview \?\? 'agents'/, 'the Agents hub maps the null default to its worker-list surface')
  const controller = read(join(ROOT, 'src', 'controller', 'useSessionWorkspace.ts'))
  assert.match(controller, /setActiveSubview\(null\)/, 'opening a section lands on its default (null) sub-view')
})

test('the old ad-hoc filter dropdowns never return', () => {
  const components = concatSource('src/components') // comment-stripped
  assert.doesNotMatch(components, /label="Show"/, 'no Contexts/Scheduled "Show" dropdown')
  assert.doesNotMatch(components, /label="Filter by"/, 'no Artifacts "Filter by" dropdown')
  assert.doesNotMatch(components, /COMMONS_TABS/, 'the Agents hub has no in-page tab array')
})
