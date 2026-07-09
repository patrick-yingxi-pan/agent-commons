/** Section sub-navigation vs. in-page filtering — the two are deliberately kept apart
 *  (spec ADAPT-13, form follows function):
 *
 *   - **Navigation** (genuinely distinct surfaces) lives in the rail's drill-in menu,
 *     driven by ONE registry `src/lib/subviews.ts` that both the rail (Sidebar) and the
 *     body (SectionView) read. Today exactly the Agents hub qualifies.
 *   - **Filtering** (one list narrowed by a facet: kind / type / status / ownership) is
 *     NOT navigation — it's an in-page control, the shared `SectionFilter` primitive, so a
 *     filter never masquerades as a nav destination and opening a section never reshuffles
 *     the rail.
 *
 *  These lock: the registry holds only true sub-navigation; the rail/body/controller
 *  route through it; and the five filter sections drive their lists through the shared
 *  in-page filter, not the rail (and not an ad-hoc dropdown). */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { ROOT, read, concatSource } from './helpers/source.ts'
import { SECTION_SUBVIEWS, firstSubview } from '../src/lib/subviews.ts'

test('the rail registry holds only TRUE sub-navigation (the Agents hub)', () => {
  // Reserved for genuinely distinct surfaces. Filter-style sections must NOT be here —
  // that conflation (a filter wearing a nav row) is exactly what this separation fixes.
  assert.deepEqual(Object.keys(SECTION_SUBVIEWS), ['agents'])
  for (const section of ['contexts', 'artifacts', 'scheduled', 'models', 'projects']) {
    assert.equal(SECTION_SUBVIEWS[section], undefined, `${section} filters in-page, not in the rail`)
  }
})

test('the Agents hub sub-views are its five distinct surfaces, uniquely id’d and labelled', () => {
  const subs = SECTION_SUBVIEWS.agents
  assert.deepEqual(subs.map((s) => s.id), ['agents', 'prompts', 'commissions', 'discover', 'audit'])
  const ids = subs.map((s) => s.id)
  assert.equal(new Set(ids).size, ids.length, 'ids unique')
  for (const s of subs) assert.ok(s.label.trim(), `${s.id} needs a label`)
})

test('firstSubview: the Agents hub lands on its first tab; every other section is null', () => {
  assert.equal(firstSubview('agents'), 'agents')
  for (const section of ['contexts', 'artifacts', 'scheduled', 'models', 'projects', 'dispatch', 'customize']) {
    assert.equal(firstSubview(section), null, `${section} has no rail sub-nav`)
  }
})

test('the rail, the section body, and the controller all route through the ONE registry', () => {
  const sidebar = read(join(ROOT, 'src', 'components', 'Sidebar.tsx'))
  assert.match(sidebar, /SECTION_SUBVIEWS/, 'the rail reads the registry to build its drill-in menu')
  const sectionView = read(join(ROOT, 'src', 'components', 'SectionView.tsx'))
  assert.match(sectionView, /subview=\{subview \?\? 'agents'\}/, 'SectionView threads the sub-view into the Agents hub')
  const controller = read(join(ROOT, 'src', 'controller', 'useSessionWorkspace.ts'))
  assert.match(controller, /firstSubview/, 'the controller lands a freshly-opened section on its first sub-view')
})

test('filtering is an in-page control (the shared SectionFilter), not the rail', () => {
  const sectionView = read(join(ROOT, 'src', 'components', 'SectionView.tsx'))
  // The one shared filter primitive is defined once…
  assert.match(sectionView, /function SectionFilter</, 'the shared in-page filter primitive exists')
  // …and the five filter sections each drive their list through it.
  const uses = (sectionView.match(/<SectionFilter\b/g) ?? []).length
  assert.ok(uses >= 5, `every filter section routes through SectionFilter (found ${uses}, want ≥5)`)
})

test('the old ad-hoc filter dropdowns are gone — the responsibility moved to SectionFilter', () => {
  const components = concatSource('src/components') // comment-stripped
  assert.doesNotMatch(components, /label="Show"/, 'the Contexts/Scheduled "Show" dropdown is gone')
  assert.doesNotMatch(components, /label="Filter by"/, 'the Artifacts "Filter by" dropdown is gone')
  // The Agents hub reads the rail registry, never an in-page tab array.
  assert.doesNotMatch(components, /COMMONS_TABS/, 'the Agents hub has no in-page tab array')
})
