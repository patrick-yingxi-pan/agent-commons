/** Section sub-navigation — the rail's drill-in secondary menu (src/lib/subviews.ts).
 *  The classification each section carried in-page (the Agents hub's tabs, the
 *  Contexts/Artifacts/Scheduled filter dropdowns, the Projects yours/shared bands)
 *  moved into ONE registry that BOTH the rail (Sidebar) and the section body
 *  (SectionView) read, so the nav and the content can't drift. These lock:
 *    1. the registry's shape — a density-preserving 'all' default on the filter-style
 *       sections, and ids that ARE each section's own switch keys (so a section can
 *       switch on `subview` directly, with no separate lookup table),
 *    2. that the rail, the body, and the controller all route through the one registry,
 *    3. that the old in-page classifiers are gone (responsibility moved to the rail). */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { ROOT, read, concatSource } from './helpers/source.ts'
import { SECTION_SUBVIEWS, firstSubview } from '../src/lib/subviews.ts'

test('every listed section has ≥2 uniquely-id’d, labelled sub-views', () => {
  const entries = Object.entries(SECTION_SUBVIEWS)
  assert.ok(entries.length > 0, 'the registry is not empty')
  for (const [section, subs] of entries) {
    assert.ok(subs.length >= 2, `${section} needs ≥2 sub-views (a single one is no drill-in)`)
    const ids = subs.map((s) => s.id)
    assert.equal(new Set(ids).size, ids.length, `${section} sub-view ids must be unique`)
    for (const s of subs) assert.ok(s.label.trim(), `${section}/${s.id} needs a label`)
  }
})

test('firstSubview lands on the first entry; a section with no sub-views is null', () => {
  assert.equal(firstSubview('agents'), 'agents')
  assert.equal(firstSubview('contexts'), 'all')
  // dispatch + customize have no real internal grouping — their rail row opens the
  // page directly, with no drill-in.
  assert.equal(firstSubview('dispatch'), null)
  assert.equal(firstSubview('customize'), null)
})

test('filter-style sections default to an "all" sub-view (density preserved)', () => {
  for (const section of ['projects', 'artifacts', 'contexts', 'models', 'scheduled']) {
    assert.equal(SECTION_SUBVIEWS[section][0].id, 'all', `${section} must land on the full "All" view`)
  }
})

test('sub-view ids ARE each section’s own switch keys (no separate lookup table)', () => {
  // Contexts: 'all' + the SavedContextKind values (contract/contexts.ts).
  assert.deepEqual(SECTION_SUBVIEWS.contexts.map((s) => s.id), ['all', 'connector', 'mcp', 'repo'])
  // Artifacts: 'all' + the ArtifactKind values.
  assert.deepEqual(SECTION_SUBVIEWS.artifacts.map((s) => s.id), ['all', 'doc', 'image', 'sheet', 'slide', 'email'])
  // Agents: the five interdependent hub tabs (the CommonsTab union).
  assert.deepEqual(SECTION_SUBVIEWS.agents.map((s) => s.id), ['agents', 'prompts', 'commissions', 'discover', 'audit'])
  // Scheduled: the enabled states. Models: the provider classes.
  assert.deepEqual(SECTION_SUBVIEWS.scheduled.map((s) => s.id), ['all', 'active', 'paused'])
  assert.deepEqual(SECTION_SUBVIEWS.models.map((s) => s.id), ['all', 'builtin', 'registered', 'session'])
})

test('the rail, the section body, and the controller all route through the ONE registry', () => {
  const sidebar = read(join(ROOT, 'src', 'components', 'Sidebar.tsx'))
  assert.match(sidebar, /SECTION_SUBVIEWS/, 'the rail reads the registry to build its drill-in menu')
  const sectionView = read(join(ROOT, 'src', 'components', 'SectionView.tsx'))
  assert.match(sectionView, /subview=\{/, 'SectionView threads the sub-view into its section bodies')
  const controller = read(join(ROOT, 'src', 'controller', 'useSessionWorkspace.ts'))
  assert.match(controller, /firstSubview/, 'the controller lands a freshly-opened section on its first sub-view')
})

test('the old in-page classifiers are gone — the responsibility moved to the rail', () => {
  const components = concatSource('src/components') // comment-stripped
  // The Agents hub's segmented tab array + the Contexts/Artifacts filter option lists.
  assert.doesNotMatch(components, /COMMONS_TABS/, 'the Agents hub reads the rail registry, not an in-page tab array')
  assert.doesNotMatch(components, /CONTEXT_FILTERS/, 'Contexts classification moved to the rail')
  assert.doesNotMatch(components, /ARTIFACT_FILTERS/, 'Artifacts classification moved to the rail')
  // The filter dropdowns those fed (Contexts/Scheduled "Show", Artifacts "Filter by").
  assert.doesNotMatch(components, /label="Show"/, 'the Contexts/Scheduled "Show" dropdown is gone')
  assert.doesNotMatch(components, /label="Filter by"/, 'the Artifacts "Filter by" dropdown is gone')
})
