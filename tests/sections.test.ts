/** The left-panel sections are table-driven (contract/entities.ts SectionId →
 *  src/lib/sections.tsx SECTION_META + SECTION_ORDER → src/lib/nav.ts SECTION_LABELS →
 *  the SectionView switch). These lock that the Agents hub (docs/agent-commons.md) is
 *  registered across every table, so a new section can't half-land (in the union but not
 *  the nav, or rendered but unlabeled). SECTION_LABELS is imported (react-free); the rest
 *  are source-scanned, the repo's idiom for UI files the DOM-less runner can't mount. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { ROOT, read, stripComments } from './helpers/source.ts'
import { SECTION_LABELS } from '../src/lib/nav.ts'

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
