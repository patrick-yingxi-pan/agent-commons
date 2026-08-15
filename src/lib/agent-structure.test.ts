/** Agents is a composite account resource (UI-28): one declaration projects
 * into the rail forest and the main-page overview. Structural nodes remain
 * pages; live ready-agent, prompt, and tool resources remain canonical leaves.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { ROOT, read, stripComments } from '../../tests/helpers/source.ts'
import { AGENT_SECTIONS, AGENT_SUBVIEWS, agentSectionForSubview, agentToolLabel } from './agentStructure.ts'

test('the Agents hierarchy separates built agents, reusable materials, coordination, discovery, and audit', () => {
  assert.deepEqual(AGENT_SECTIONS.map((section) => section.id), [
    'ready-agents',
    'building-blocks',
    'coordination',
    'discover',
    'audit',
  ])
  assert.deepEqual(agentSectionForSubview('building-blocks')?.children.map((child) => child.id), ['prompts', 'tools'])
  assert.deepEqual(agentSectionForSubview('coordination')?.children.map((child) => child.id), ['work', 'commissions'])
  assert.equal(agentSectionForSubview('prompts')?.id, 'building-blocks')
  assert.equal(agentSectionForSubview('commissions')?.id, 'coordination')
  assert.equal(agentToolLabel('read_project_files'), 'Read Project Files')
})

test('the flattened address registry is derived from the visible hierarchy', () => {
  const expected = AGENT_SECTIONS.flatMap((section) => [
    { id: section.id, label: section.label },
    ...section.children.map((child) => ({ id: child.id, label: child.label })),
  ])
  assert.deepEqual(AGENT_SUBVIEWS, expected)
  assert.equal(new Set(AGENT_SUBVIEWS.map((entry) => entry.id)).size, AGENT_SUBVIEWS.length, 'every structural page id is unique')
  for (const section of AGENT_SECTIONS) {
    assert.ok(section.summary.trim(), `${section.id} has an honest folded-page summary`)
    for (const child of section.children) assert.ok(child.summary.trim(), `${child.id} has an honest folded-page summary`)
  }
})

test('the rail and main page project the same declaration and give every live material a page', () => {
  const rail = stripComments(read(join(ROOT, 'src', 'components', 'SectionTreeChildren.tsx')))
  const page = stripComments(read(join(ROOT, 'src', 'components', 'SectionView.tsx')))
  const addresses = stripComments(read(join(ROOT, 'src', 'lib', 'subviews.ts')))

  assert.match(rail, /AGENT_SECTIONS\.map/, 'the rail projects the shared hierarchy')
  assert.match(page, /AGENT_SECTIONS\.map/, 'the root main page projects the shared hierarchy')
  assert.match(addresses, /agents: AGENT_SUBVIEWS/, 'reserved structural URLs derive from the same hierarchy')

  for (const hook of ['useAgents', 'useSystemPrompts', 'useAgentToolCatalog']) {
    assert.match(rail, new RegExp(`${hook}\\(\\)`), `rail leaves read ${hook}`)
  }
  assert.match(rail, /onOpenDetail\('agents', \{ agentId: id \}\)/)
  assert.match(rail, /onOpenDetail\('agents', \{ promptId: id \}\)/)
  assert.match(rail, /onOpenDetail\('agents', \{ toolId: id \}\)/)
  assert.match(page, /function AgentPublicPage\(/, 'ready-agent leaves resolve to the shared owner/visitor page')
  assert.match(page, /function PromptDetailPage\(/, 'prompt leaves resolve to main pages')
  assert.match(page, /function ToolDetailPage\(/, 'tool leaves resolve to main pages')
})
