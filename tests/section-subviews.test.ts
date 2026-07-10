/** Rail sub-navigation is an inline disclosure tree (VSCode-explorer style): a section
 *  with sub-nodes carries a chevron and expands IN PLACE — children indented, siblings
 *  staying put, no push, no back button. ONE registry `src/lib/subviews.ts` is the source
 *  of truth the rail (Sidebar) reads; content-section grouping is driven by the same
 *  sub-view the tree selects (SectionView), so a facet is chosen in ONE place — the tree —
 *  never a duplicated in-page filter bar. These lock the shape. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { ROOT, read, concatSource } from './helpers/source.ts'
import { SECTION_SUBVIEWS } from '../src/lib/subviews.ts'

test('every section with real sub-structure is in the registry; leaf sections are not', () => {
  assert.deepEqual(
    Object.keys(SECTION_SUBVIEWS).sort(),
    ['agents', 'artifacts', 'contexts', 'models', 'projects', 'scheduled'],
  )
  // Dispatch (a flat feed) and Customize (a settings stack) have no sub-nodes.
  assert.equal(SECTION_SUBVIEWS.dispatch, undefined)
  assert.equal(SECTION_SUBVIEWS.customize, undefined)
})

test('each section’s child ids ARE its own switch keys (the body filters on them directly)', () => {
  // Content sections: a facet partition (the group nodes) — NO 'all'/default child, since
  // the section row itself is the "all" view.
  assert.deepEqual(SECTION_SUBVIEWS.contexts.map((s) => s.id), ['connector', 'mcp', 'repo'])
  assert.deepEqual(SECTION_SUBVIEWS.artifacts.map((s) => s.id), ['doc', 'image', 'sheet', 'slide', 'email'])
  assert.deepEqual(SECTION_SUBVIEWS.scheduled.map((s) => s.id), ['active', 'paused'])
  assert.deepEqual(SECTION_SUBVIEWS.models.map((s) => s.id), ['builtin', 'registered', 'session'])
  assert.deepEqual(SECTION_SUBVIEWS.projects.map((s) => s.id), ['mine', 'shared'])
  // Agents: its NON-default surfaces — the worker list is the section row, not a child.
  assert.deepEqual(SECTION_SUBVIEWS.agents.map((s) => s.id), ['prompts', 'commissions', 'discover', 'audit'])
  for (const subs of Object.values(SECTION_SUBVIEWS)) {
    const ids = subs.map((s) => s.id)
    assert.equal(new Set(ids).size, ids.length, 'child ids unique per section')
    for (const s of subs) assert.ok(s.label.trim(), `${s.id} needs a label`)
    assert.ok(!ids.includes('all'), 'no "all" child — the section row is the all view')
  }
})

test('the rail is an inline disclosure tree, not a drill-in push', () => {
  const sidebar = read(join(ROOT, 'src', 'components', 'Sidebar.tsx'))
  assert.match(sidebar, /SECTION_SUBVIEWS/, 'the rail reads the registry to build its tree')
  assert.match(sidebar, /function SectionTreeRow/, 'sections render as disclosure-tree rows')
  assert.match(sidebar, /toggleExpand/, 'nodes expand/collapse in place')
  assert.doesNotMatch(sidebar, /SectionSubmenu/, 'the drill-in sub-menu is gone')
  assert.doesNotMatch(sidebar, /ChevronLeft/, 'the "‹ Sections" back chip is gone — no push')
})

test('the rail has one fold/unfold-all control that toggles the whole tree', () => {
  const sidebar = read(join(ROOT, 'src', 'components', 'Sidebar.tsx'))
  // A single toggle whose label reflects the action either way.
  assert.match(sidebar, /aria-label=\{allExpanded \? 'Collapse all sections' : 'Expand all sections'\}/)
  assert.match(sidebar, /toggleAll/, 'a fold/unfold-all handler exists')
  // "All expanded" is measured over the sections that actually HAVE children, and the
  // toggle sets the whole set to none or all — not a per-section op.
  assert.match(sidebar, /expandableIds\s*=\s*useMemo\(\(\)\s*=>\s*SECTION_ORDER\.filter/)
  assert.match(sidebar, /setExpanded\(allExpanded \? new Set\(\) : new Set\(expandableIds\)\)/)
})

test('the rail body is an accordion of foldable, resizable panes with draggable dividers', () => {
  const sidebar = read(join(ROOT, 'src', 'components', 'Sidebar.tsx'))
  // Two landmark-unique rail navs (WCAG): New session ("Create") and the Sections tree.
  assert.match(sidebar, /<nav aria-label="Create" className="mt-3 shrink-0 px-2">/)
  assert.match(sidebar, /aria-label="Sections"/, 'the Sections pane nav is labeled')
  assert.match(sidebar, /ref=\{stackRef\}/, 'the pane stack is a measured region')
  // Every pane folds like Scheduled (symmetry): one PaneFoldHeader each, and all three
  // fold states persist (only a manual toggle changes them).
  for (const label of ['Sections', 'Scheduled', 'Recents'])
    assert.match(sidebar, new RegExp(`PaneFoldHeader label="${label}"`), `${label} pane folds`)
  assert.match(sidebar, /setLayout\('railSectionsOpen'/)
  assert.match(sidebar, /setLayout\('railRecentsOpen'/)
  assert.match(sidebar, /setLayout\('schedOpen'/)
  // Dividers are in-flow gutters (PaneDivider), gated on the pane's own layout.divider so
  // a folded/flex pane has none; dropped entirely on the narrow tier (ADAPT-11).
  assert.match(sidebar, /<PaneDivider/, 'dividers are the in-flow gutter primitive')
  assert.match(sidebar, /paneOf\('sections'\)\?\.divider/)
  assert.match(sidebar, /paneOf\('scheduled'\)\?\.divider/)
  // Heights come from the accordion reducer; fixed heights persist only on drag.
  assert.match(sidebar, /layoutPanes/, 'pane heights come from the accordion reducer')
  assert.match(sidebar, /setLayout\('railSectionsH'/)
  assert.match(sidebar, /setLayout\('railScheduledH'/)
  // The old fixed 2-divider model + auto-sizing/floor are gone.
  assert.doesNotMatch(sidebar, /railPaneHeights/)
  assert.doesNotMatch(sidebar, /flex-auto overflow-y-auto/)
  assert.doesNotMatch(sidebar, /min-h-\[9rem\]/)
})

test('the section body + controller route through the registry; a section lands on its default', () => {
  const sectionView = read(join(ROOT, 'src', 'components', 'SectionView.tsx'))
  assert.match(sectionView, /subview \?\? 'agents'/, 'the Agents hub maps the null default to its worker-list surface')
  assert.match(sectionView, /ContextsSection subview=\{subview\}/, 'content sections filter on the tree-selected sub-view')
  const controller = read(join(ROOT, 'src', 'controller', 'useSessionWorkspace.ts'))
  assert.match(controller, /setActiveSubview\(null\)/, 'opening a section lands on its default (null) sub-view')
})

test('facet grouping lives in the rail tree, NOT a duplicated in-page filter bar', () => {
  const components = concatSource('src/components') // comment-stripped
  assert.doesNotMatch(components, /SectionFilter/, 'the in-page filter bar is gone — the tree owns the facet')
  assert.doesNotMatch(components, /_FILTER_TABS/, 'no per-section in-page filter option arrays')
  assert.doesNotMatch(components, /label="Show"/, 'no Contexts/Scheduled "Show" dropdown')
  assert.doesNotMatch(components, /label="Filter by"/, 'no Artifacts "Filter by" dropdown')
})
