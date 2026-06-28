/** Unit tests for the resource-manipulation tool interface (server/model/tools.ts)
 *  — the catalog the backend declares to the model, and the executor that turns a
 *  tool call into a consent-gated proposal. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { TOOL_DEFINITIONS, TOOL_NAMES, executeTool, type ToolContext } from '../server/model/tools.ts'
import type { RelationOp } from '../contract/index.ts'

const ctx: ToolContext = { session: { id: 'insights-launch', title: 'Insights dashboard launch' } }

test('TOOL_DEFINITIONS: every tool has a name, description, and object input_schema', () => {
  assert.equal(TOOL_DEFINITIONS.length, TOOL_NAMES.length)
  for (const t of TOOL_DEFINITIONS) {
    assert.ok(t.name && typeof t.name === 'string', `tool name: ${t.name}`)
    assert.ok(t.description.length > 10, `${t.name} description`)
    assert.equal(t.input_schema.type, 'object')
    assert.ok(Array.isArray(t.input_schema.required))
  }
  // The 3 escalations + 12 relation-op kinds + 5 Agent Commons CRUD tools = 20 tools.
  assert.equal(TOOL_NAMES.length, 20)
})

test('open_workspace builds a workspace escalation with drafted artifacts', () => {
  const e = executeTool('open_workspace', { sources: ['brand-kit/'] }, ctx)
  assert.equal(e.escalation?.kind, 'workspace')
  assert.ok(e.escalation?.kind === 'workspace' && e.escalation.artifacts.length >= 3)
  assert.ok(e.escalation?.kind === 'workspace' && e.escalation.rootChoices.length >= 1)
  assert.match(e.summary, /workspace/i)
})

test('connect_repo builds a repo escalation carrying the diff/terminal + GitHub connector', () => {
  const e = executeTool('connect_repo', { branch: 'feat/x', remote: 'me/app' }, ctx)
  assert.equal(e.escalation?.kind, 'repo')
  if (e.escalation?.kind !== 'repo') return
  assert.equal(e.escalation.branch, 'feat/x')
  assert.equal(e.escalation.remote, 'me/app')
  assert.ok(e.escalation.diff.length > 0 && e.escalation.terminal.length > 0)
  assert.ok(e.escalation.connectors.some((c) => c.kind === 'github'))
})

test('create_project: file_session "false" creates an empty (unfiled) project escalation with the tour id', () => {
  const e = executeTool('create_project', { name: 'Insights dashboard launch', file_session: 'false' }, ctx)
  assert.equal(e.escalation?.kind, 'project')
  if (e.escalation?.kind !== 'project') return
  assert.equal(e.escalation.project.id, 'p-insights-launch')
  assert.equal(e.escalation.fileSession, false)
  assert.ok(e.escalation.visitCaption) // the tour project carries its visit caption
})

test('create_project: defaults to filing the session, and mints an id for a free-typed name', () => {
  const e = executeTool('create_project', { name: 'My New Thing' }, ctx)
  assert.equal(e.escalation?.kind, 'project')
  if (e.escalation?.kind !== 'project') return
  assert.equal(e.escalation.fileSession, true)
  assert.equal(e.escalation.project.id, 'p-my-new-thing')
})

// Each relation-op tool resolves its named args to the right RelationOp kind.
const RELATION_CASES: Array<{ tool: string; input: Record<string, unknown>; kind: RelationOp['kind']; check?: (op: RelationOp) => void }> = [
  { tool: 'file_session', input: { project: 'Insights dashboard' }, kind: 'file-session', check: (op) => assert.equal((op as any).projectId, 'p-insights') },
  { tool: 'save_artifact', input: { name: 'r.md', project: 'Insights dashboard' }, kind: 'save-artifact', check: (op) => assert.equal((op as any).projectName, 'Insights dashboard') },
  { tool: 'refile_artifact', input: { artifact: 'insights-onepager.md', project: 'Insights dashboard' }, kind: 'refile-artifact' },
  { tool: 'attach_context', input: { connector: 'Linear' }, kind: 'attach-context', check: (op) => assert.equal((op as any).connectorLabel, 'Linear') },
  { tool: 'scope_context', input: { connector: 'Figma', project: 'Insights dashboard' }, kind: 'scope-context' },
  { tool: 'unscope_context', input: { context: 'Figma', project: 'Insights dashboard' }, kind: 'unscope-context' },
  { tool: 'set_project_instructions', input: { project: 'Insights dashboard', instructions: 'Be brief.' }, kind: 'set-project-instructions' },
  { tool: 'link_schedule_project', input: { schedule: 'Triage new GitHub issues', project: 'Insights dashboard' }, kind: 'link-schedule-project' },
  { tool: 'set_artifact_source', input: { artifact: 'insights-onepager.md', context: 'brand-kit/' }, kind: 'set-artifact-source' },
  { tool: 'set_schedule_session', input: { schedule: 'Daily AI news briefing' }, kind: 'set-schedule-session' },
  { tool: 'set_schedule_artifact', input: { schedule: 'Triage new GitHub issues', artifact: 'd.md' }, kind: 'set-schedule-artifact' },
  { tool: 'schedule_add_tool', input: { schedule: 'Daily AI news briefing', tool: 'Slack' }, kind: 'schedule-add-tool' },
]

for (const c of RELATION_CASES) {
  test(`${c.tool} → a ${c.kind} relation op (resolved against the real catalogs)`, () => {
    const e = executeTool(c.tool, c.input, ctx)
    assert.equal(e.escalation, undefined)
    assert.ok(e.relationOps && e.relationOps.length === 1, `${c.tool} produced one op`)
    const op = e.relationOps![0]
    assert.equal(op.kind, c.kind)
    c.check?.(op)
  })
}

test('an unknown tool degrades gracefully (no throw, no effect)', () => {
  const e = executeTool('nonexistent_tool', {}, ctx)
  assert.equal(e.relationOps, undefined)
  assert.equal(e.escalation, undefined)
  assert.match(e.summary, /unknown/i)
})

// ── Agent Commons CRUD tools (D6/D9/D10/D7) — resolve the model's named provider /
//    prompt / agent against the LIVE registries the route passes in (ctx.commons). ──
const ctxCommons: ToolContext = {
  session: ctx.session,
  commons: {
    providers: [{ id: 'provider-anthropic', label: 'Anthropic' }, { id: 'provider-9', label: 'Local Llama' }],
    systemPrompts: [{ id: 'sp-1', label: 'Deep research' }],
    agents: [{ id: 'agent-7', label: 'Scout' }, { id: 'agent-8', label: 'Loner' }],
    commissions: [{ id: 'commission-3', agentId: 'agent-7', projectId: 'p-insights' }],
  },
}

test('create_provider → a create-provider op carrying the label + family', () => {
  const e = executeTool('create_provider', { label: 'Local Llama', model_family: 'llama' }, ctxCommons)
  assert.equal(e.relationOps?.length, 1)
  const op = e.relationOps![0]
  assert.equal(op.kind, 'create-provider')
  assert.equal((op as any).label, 'Local Llama')
  assert.equal((op as any).modelFamily, 'llama')
})

test('create_system_prompt → a create-prompt op with body + default family', () => {
  const e = executeTool('create_system_prompt', { label: 'Deep research', body: 'Cite primary sources.' }, ctxCommons)
  const op = e.relationOps![0]
  assert.equal(op.kind, 'create-prompt')
  assert.equal((op as any).body, 'Cite primary sources.')
  assert.equal((op as any).targetFamily, 'claude', 'family defaults to claude')
})

test('create_agent → a create-agent op binding the named provider + prompt (resolved live)', () => {
  const e = executeTool('create_agent', { label: 'Scout', provider: 'Anthropic', system_prompt: 'Deep research', instructions: 'Stay terse.' }, ctxCommons)
  const op = e.relationOps![0]
  assert.equal(op.kind, 'create-agent')
  assert.equal((op as any).providerId, 'provider-anthropic')
  assert.equal((op as any).providerLabel, 'Anthropic')
  assert.equal((op as any).systemPromptId, 'sp-1')
  assert.equal((op as any).instructions, 'Stay terse.')
})

test('create_agent with no provider/prompt → an unbound agent op (no ids)', () => {
  const e = executeTool('create_agent', { label: 'Solo' }, ctxCommons)
  const op = e.relationOps![0]
  assert.equal(op.kind, 'create-agent')
  assert.equal((op as any).providerId, undefined)
  assert.equal((op as any).systemPromptId, undefined)
})

test('commission_agent → a commission-agent op resolving the agent (live) + project (seed)', () => {
  const e = executeTool('commission_agent', { agent: 'Scout', project: 'Insights dashboard' }, ctxCommons)
  const op = e.relationOps![0]
  assert.equal(op.kind, 'commission-agent')
  assert.equal((op as any).agentId, 'agent-7')
  assert.equal((op as any).projectId, 'p-insights')
})

test('commission_agent with an unknown agent proposes nothing (no op, just a summary)', () => {
  const e = executeTool('commission_agent', { agent: 'Nobody', project: 'Insights dashboard' }, ctxCommons)
  assert.equal(e.relationOps, undefined)
  assert.match(e.summary, /no worker agent/i)
})

test('commission_agent carries a valid role onto the op (D14); an invalid role is dropped', () => {
  const withRole = executeTool('commission_agent', { agent: 'Scout', project: 'Insights dashboard', role: 'Reader' }, ctxCommons)
  assert.equal((withRole.relationOps![0] as any).role, 'reader') // case-normalized
  assert.match(withRole.summary, /as reader/i)
  // An unrecognized role is ignored (the op defaults to writer server-side).
  const bogus = executeTool('commission_agent', { agent: 'Scout', project: 'Insights dashboard', role: 'admin' }, ctxCommons)
  assert.equal((bogus.relationOps![0] as any).role, undefined)
})

test('uncommission_agent → an uncommission-agent op resolving the live commission by (agent, project)', () => {
  const e = executeTool('uncommission_agent', { agent: 'Scout', project: 'Insights dashboard' }, ctxCommons)
  const op = e.relationOps![0]
  assert.equal(op.kind, 'uncommission-agent')
  assert.equal((op as any).commissionId, 'commission-3')
  assert.equal((op as any).projectId, 'p-insights')
})

test('uncommission_agent for an agent with no commission on that project proposes nothing', () => {
  // Loner is a known agent but holds no commission, so there's nothing to remove.
  const e = executeTool('uncommission_agent', { agent: 'Loner', project: 'Insights dashboard' }, ctxCommons)
  assert.equal(e.relationOps, undefined)
  assert.match(e.summary, /to remove/i)
})
