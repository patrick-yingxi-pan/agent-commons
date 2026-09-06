/** The left-panel sections are table-driven (contract/entities.ts SectionId →
 *  src/lib/sections.tsx SECTION_META + SECTION_ORDER → src/lib/nav.ts SECTION_LABELS →
 *  the SectionView switch). These lock that the Agents hub (docs/agent-commons.md) is
 *  registered across every table, so a new section can't half-land (in the union but not
 *  the nav, or rendered but unlabeled). SECTION_LABELS is imported (react-free); the rest
 *  are source-scanned, the repo's idiom for UI files the DOM-less runner can't mount. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { ROOT, read, stripComments } from '../../tests/helpers/source.ts'
import { SECTION_LABELS } from './nav.ts'

test('the Agents hub has a navigation label', () => {
  assert.ok('agents' in SECTION_LABELS, 'nav SECTION_LABELS registers the Agents hub')
  assert.equal(SECTION_LABELS.agents, 'Agents')
})

test('the SectionId union includes the Agents hub', () => {
  const src = stripComments(read(join(ROOT, 'contract', 'entities.ts')))
  assert.match(src, /SectionId =[\s\S]*?'agents'/, "SectionId includes 'agents'")
})

test('section metadata + order register the Agents hub', () => {
  const src = stripComments(read(join(ROOT, 'src', 'lib', 'sections.tsx')))
  assert.match(src, /\bagents:\s*\{/, 'SECTION_META has an agents entry')
  assert.match(src, /SECTION_ORDER[\s\S]*?'agents'/, "SECTION_ORDER lists 'agents'")
})

test('the section router renders the Agents hub', () => {
  const src = stripComments(read(join(ROOT, 'src', 'components', 'SectionView.tsx')))
  assert.match(src, /section === 'agents'/, "SectionView handles section === 'agents'")
  assert.match(src, /<AgentCommonsSection\b/, 'SectionView renders AgentCommonsSection')
})

// ── The Models section (spec MODEL-13 — providers as first-class models) ───────

test('the Models section has a navigation label', () => {
  assert.ok('models' in SECTION_LABELS, 'nav SECTION_LABELS registers the Models section')
  assert.equal(SECTION_LABELS.models, 'Models')
})

test('the SectionId union includes the Models section', () => {
  const src = stripComments(read(join(ROOT, 'contract', 'entities.ts')))
  assert.match(src, /SectionId =[\s\S]*?'models'/, "SectionId includes 'models'")
})

test('section metadata + order register the Models section', () => {
  const src = stripComments(read(join(ROOT, 'src', 'lib', 'sections.tsx')))
  assert.match(src, /\bmodels:\s*\{/, 'SECTION_META has a models entry')
  assert.match(src, /SECTION_ORDER[\s\S]*?'models'/, "SECTION_ORDER lists 'models'")
})

test('the section router renders the Models section', () => {
  const src = stripComments(read(join(ROOT, 'src', 'components', 'SectionView.tsx')))
  assert.match(src, /section === 'models'/, "SectionView handles section === 'models'")
  assert.match(src, /<ModelsSection\b/, 'SectionView renders ModelsSection')
})

test('providers left the Agents hub for the Models section (no duplicate registry surface)', () => {
  const src = stripComments(read(join(ROOT, 'src', 'components', 'SectionView.tsx')))
  assert.ok(!/id:\s*'providers'/.test(src), 'the Agents hub sub-tabs no longer include Providers')
})

// ── Sessions as an ordinary account-resource root (ADAPT-13 / UI-39) ─────────

test('Sessions is registered from the contract through navigation and its main page', () => {
  assert.equal(SECTION_LABELS.sessions, 'Sessions')
  const contract = stripComments(read(join(ROOT, 'contract', 'entities.ts')))
  const registry = stripComments(read(join(ROOT, 'src', 'lib', 'sections.tsx')))
  const page = stripComments(read(join(ROOT, 'src', 'components', 'SectionView.tsx')))
  assert.match(contract, /SectionId =[\s\S]*?'sessions'/)
  assert.match(registry, /\bsessions:\s*\{/)
  assert.match(registry, /SECTION_ORDER[\s\S]*?'sessions'/)
  assert.match(page, /section === 'sessions'/)
  assert.match(page, /<SessionsSection\b/)
})

test('Sessions heads the resource forest immediately before Commons', () => {
  const registry = stripComments(read(join(ROOT, 'src', 'lib', 'sections.tsx')))
  const orderBody = registry.match(/SECTION_ORDER[^=]*=\s*\[([\s\S]*?)\]/)?.[1] ?? ''
  const order = [...orderBody.matchAll(/'([^']+)'/g)].map((match) => match[1])
  assert.deepEqual(order.slice(0, 2), ['sessions', 'commons'])
})

test('conditional section availability has one registry rule for rail chrome and restored panes', () => {
  const registry = stripComments(read(join(ROOT, 'src', 'lib', 'sections.tsx'))).replace(/\s+/g, ' ')
  const sidebar = stripComments(read(join(ROOT, 'src', 'components', 'Sidebar.tsx'))).replace(/\s+/g, ' ')
  const app = stripComments(read(join(ROOT, 'src', 'App.tsx'))).replace(/\s+/g, ' ')

  assert.ok(registry.includes("admin: { label: 'Maintain', subtitle: 'Instance administration for website maintainers.', Icon: Wrench, availability: 'instance-admin'"))
  assert.ok(registry.includes("export function sectionAvailable("), 'the section registry owns the availability predicate')
  assert.ok(sidebar.includes('SECTION_ORDER.filter((id) => sectionAvailable(id, { instanceAdmin }))'))
  assert.ok(app.includes("content.kind !== 'msection' || sectionAvailable(content.id, { instanceAdmin })"))
  assert.ok(app.includes('restoreKeep: restorePaneAvailable'), 'workspace restoration consumes the same predicate')
  assert.doesNotMatch(sidebar, /id !== 'admin'/, 'the rail does not keep a parallel admin-only condition')
})
