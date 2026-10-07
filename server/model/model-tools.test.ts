/** Unit tests for the resource-manipulation tool interface (server/model/tools.ts)
 *  — the catalog the backend declares to the model, and the executor that turns a
 *  tool call into a consent-gated proposal. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { TOOL_DEFINITIONS, TOOL_NAMES, executeTool, type ToolContext } from './tools.ts'
import { MAX_AUTHORED_DOCUMENT_CHARS, authoredDocument, describeOp, type RelationOp } from '../../contract/index.ts'

const ctx: ToolContext = { session: { id: 'auth-refactor', title: 'Refactor auth middleware' } }

test('TOOL_DEFINITIONS: every tool has a name, description, and object input_schema', () => {
  assert.equal(TOOL_DEFINITIONS.length, TOOL_NAMES.length)
  for (const t of TOOL_DEFINITIONS) {
    assert.ok(t.name && typeof t.name === 'string', `tool name: ${t.name}`)
    assert.ok(t.description.length > 10, `${t.name} description`)
    assert.equal(t.input_schema.type, 'object')
    assert.ok(Array.isArray(t.input_schema.required))
  }
  // The 3 escalations + 14 relation-op kinds (incl. D26) + Agent Commons CRUD
  // tools (incl. hand-off, commission cap, and consent-gated project sharing).
  assert.equal(TOOL_NAMES.length, 24)
})

test('save_artifact advertises a document-or-structured-body union', () => {
  const save = TOOL_DEFINITIONS.find((tool) => tool.name === 'save_artifact')
  assert.ok(save)
  assert.equal(save.input_schema.properties.kind.enum?.join(','), 'doc,sheet,slide')
  assert.equal(save.input_schema.properties.body.oneOf?.length, 3)
  const spreadsheet = save.input_schema.properties.body.oneOf?.[1]
  assert.equal(spreadsheet?.oneOf?.length, 2)
  const sheet = spreadsheet?.oneOf?.[0]
  const workbook = spreadsheet?.oneOf?.[1]
  assert.equal(sheet?.properties?.type.enum?.[0], 'sheet')
  assert.equal(sheet?.properties?.columns.maxItems, 32)
  assert.equal(sheet?.properties?.rows.maxItems, 200)
  assert.equal(workbook?.properties?.type.enum?.[0], 'workbook')
  assert.equal(workbook?.properties?.sheets.maxItems, 20)
  assert.equal(save.input_schema.properties.body.oneOf?.[2]?.properties?.type.enum?.[0], 'slides')
  assert.equal(save.input_schema.properties.body.oneOf?.[2]?.properties?.slides.maxItems, 40)
})

test('set_schedule_artifact requires an explicit output name and kind', () => {
  const tool = TOOL_DEFINITIONS.find((row) => row.name === 'set_schedule_artifact')
  assert.ok(tool)
  assert.deepEqual(tool.input_schema.required, ['schedule', 'artifact', 'artifactKind'])
  assert.deepEqual(tool.input_schema.properties.artifactKind.enum, ['doc', 'sheet', 'slide'])
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

test('create_project: file_session "false" creates an empty (unfiled) project escalation', () => {
  const e = executeTool('create_project', { name: 'Insights dashboard launch', file_session: 'false' }, ctx)
  assert.equal(e.escalation?.kind, 'project')
  if (e.escalation?.kind !== 'project') return
  assert.equal(e.escalation.project.id, 'p-insights-dashboard-launch')
  assert.equal(e.escalation.fileSession, false)
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
  {
    tool: 'save_artifact',
    input: { name: 'r.md', body: 'The actual recap.', project: 'Insights dashboard' },
    kind: 'save-artifact',
    check: (op) => {
      assert.equal((op as any).projectName, 'Insights dashboard')
      assert.equal((op as any).artifact.body, 'The actual recap.')
      assert.equal((op as any).artifact.kind, 'doc')
    },
  },
  { tool: 'refile_artifact', input: { artifact: 'insights-onepager.md', project: 'Insights dashboard' }, kind: 'refile-artifact' },
  { tool: 'attach_context', input: { connector: 'Linear' }, kind: 'attach-context', check: (op) => assert.equal((op as any).connectorLabel, 'Linear') },
  { tool: 'scope_context', input: { connector: 'Figma', project: 'Insights dashboard' }, kind: 'scope-context' },
  { tool: 'unscope_context', input: { context: 'Figma', project: 'Insights dashboard' }, kind: 'unscope-context' },
  { tool: 'set_project_instructions', input: { project: 'Insights dashboard', instructions: 'Be brief.' }, kind: 'set-project-instructions' },
  { tool: 'set_project_description', input: { project: 'Insights dashboard', description: 'What this is.' }, kind: 'set-project-description', check: (op) => assert.equal((op as any).description, 'What this is.') },
  { tool: 'link_schedule_project', input: { schedule: 'Triage new GitHub issues', project: 'Insights dashboard' }, kind: 'link-schedule-project' },
  { tool: 'set_artifact_source', input: { artifact: 'insights-onepager.md', context: 'brand-kit/' }, kind: 'set-artifact-source' },
  { tool: 'set_schedule_session', input: { schedule: 'Daily AI news briefing' }, kind: 'set-schedule-session' },
  { tool: 'set_schedule_artifact', input: { schedule: 'Triage new GitHub issues', artifact: 'd.md', artifactKind: 'doc' }, kind: 'set-schedule-artifact', check: (op) => assert.equal((op as any).artifactKind, 'doc') },
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

test('Project prose proposals freeze the exact live text reviewed by the model', () => {
  const live: ToolContext = {
    session: ctx.session,
    commons: {
      providers: [],
      systemPrompts: [],
      agents: [],
      commissions: [],
      projects: [{
        id: 'p-live',
        name: 'Live Project',
        description: 'Current public text',
        instructions: 'Current private guidance',
      }],
    },
  }
  const description = executeTool(
    'set_project_description',
    { project: 'Live Project', description: 'Proposed public text' },
    live,
  ).relationOps?.[0]
  assert.equal(description?.kind, 'set-project-description')
  if (description?.kind === 'set-project-description') {
    assert.equal(description.expectedDescription, 'Current public text')
    assert.equal(description.description, 'Proposed public text')
  }

  const instructions = executeTool(
    'set_project_instructions',
    { project: 'Live Project', instructions: 'Proposed private guidance' },
    live,
  ).relationOps?.[0]
  assert.equal(instructions?.kind, 'set-project-instructions')
  if (instructions?.kind === 'set-project-instructions') {
    assert.equal(instructions.expectedInstructions, 'Current private guidance')
    assert.equal(instructions.instructions, 'Proposed private guidance')
  }
})

test('save_artifact refuses blank content and bounds proposal text before it reaches consent history', () => {
  const blank = executeTool('save_artifact', { name: 'blank.md', body: ' \n ' }, ctx)
  assert.equal(blank.relationOps, undefined)
  assert.match(blank.summary, /proposed nothing/i)

  const raw = `${'a'.repeat(MAX_AUTHORED_DOCUMENT_CHARS)}\n\nnever reaches consent`
  const bounded = authoredDocument('bounded.md', raw)
  assert.ok(bounded)
  const effect = executeTool('save_artifact', { name: 'bounded.md', body: raw }, ctx)
  const op = effect.relationOps?.[0]
  assert.equal(op?.kind, 'save-artifact')
  if (op?.kind !== 'save-artifact') return
  assert.equal(op.artifact.body, bounded.text)
  assert.ok((op.artifact.body?.length ?? Infinity) <= MAX_AUTHORED_DOCUMENT_CHARS)
})

test('save_artifact proposes bounded structured sheet and slide bodies without applying them', () => {
  const sheet = executeTool('save_artifact', {
    name: 'metrics.sheet',
    kind: 'sheet',
    body: { type: 'sheet', columns: ['Metric', 'Value'], rows: [['Retention', '42%']] },
  }, ctx)
  const sheetOp = sheet.relationOps?.[0]
  assert.equal(sheetOp?.kind, 'save-artifact')
  if (sheetOp?.kind === 'save-artifact') {
    assert.equal(sheetOp.artifact.kind, 'sheet')
    assert.deepEqual(sheetOp.artifact.body, { type: 'sheet', columns: ['Metric', 'Value'], rows: [['Retention', '42%']] })
  }

  const slides = executeTool('save_artifact', {
    name: 'metrics.slides',
    kind: 'slide',
    body: { type: 'slides', slides: [{ title: 'Overview', bullets: ['Retention rose'] }] },
  }, ctx)
  const slideOp = slides.relationOps?.[0]
  assert.equal(slideOp?.kind, 'save-artifact')
  if (slideOp?.kind === 'save-artifact') {
    assert.equal(slideOp.artifact.kind, 'slide')
    assert.deepEqual(slideOp.artifact.body, { type: 'slides', slides: [{ title: 'Overview', bullets: ['Retention rose'] }] })
  }
})

test('save_artifact does not infer a structured body kind when kind is omitted', () => {
  const effect = executeTool('save_artifact', {
    name: 'metrics.sheet',
    body: { type: 'sheet', columns: ['Metric'], rows: [['Retention']] },
  }, ctx)
  assert.equal(effect.relationOps, undefined)
  assert.match(effect.summary, /proposed nothing/i)
})

test('save_artifact refuses any supplied kind that is not an exact supported value', () => {
  const body = { type: 'sheet', columns: ['Metric'], rows: [['Retention']] }
  for (const kind of [null, 42, '', ' Sheet ', 'spreadsheet', 'slides']) {
    const effect = executeTool('save_artifact', { name: 'bad-kind.sheet', kind, body }, ctx)
    assert.equal(effect.relationOps, undefined, `kind ${String(kind)} must not default or alias to a proposal`)
  }
})

test('set_schedule_artifact never defaults or infers output authority', () => {
  for (const input of [
    { schedule: 'Triage new GitHub issues' },
    { schedule: 'Triage new GitHub issues', artifact: 'metrics.sheet' },
    { schedule: 'Triage new GitHub issues', artifact: 'metrics.sheet', artifactKind: 'spreadsheet' },
  ]) {
    const effect = executeTool('set_schedule_artifact', input, ctx)
    assert.equal(effect.relationOps, undefined)
    assert.match(effect.summary, /proposed nothing/i)
  }
})

test('an unknown tool degrades gracefully (no throw, no effect)', () => {
  const e = executeTool('nonexistent_tool', {}, ctx)
  assert.equal(e.relationOps, undefined)
  assert.equal(e.escalation, undefined)
  assert.match(e.summary, /unknown/i)
})

test('share_project requires an explicit boolean and advertises the exact schema', () => {
  const definition = TOOL_DEFINITIONS.find((tool) => tool.name === 'share_project')
  assert.ok(definition)
  assert.deepEqual(definition.input_schema.required, ['project', 'shared'])
  assert.equal(definition.input_schema.properties.project.type, 'string')
  assert.equal(definition.input_schema.properties.shared.type, 'boolean')
  assert.equal(Object.hasOwn(definition.input_schema.properties.shared, 'default'), false)
  assert.equal(TOOL_NAMES.length, 24)

  const live: ToolContext = {
    session: ctx.session,
    commons: {
      providers: [], systemPrompts: [], agents: [], commissions: [],
      projects: [{ id: 'p-owned-share', name: 'Launch Plan', own: true, shareable: true, shared: false }],
    },
  }
  for (const input of [
    { project: 'p-owned-share' },
    { project: 'p-owned-share', shared: 'true' },
    { project: 'p-owned-share', shared: 'false' },
    { project: 'p-owned-share', shared: 1 },
    { project: 'p-owned-share', shared: null },
  ]) {
    const effect = executeTool('share_project', input, live)
    assert.equal(effect.relationOps, undefined, `malformed input ${JSON.stringify(input)} proposed nothing`)
    assert.match(effect.summary, /proposed nothing/i)
  }
})

test('share_project resolves only an exact owned and explicitly shareable project', () => {
  const live: ToolContext = {
    session: ctx.session,
    commons: {
      providers: [], systemPrompts: [], agents: [], commissions: [],
      projects: [
        { id: 'p-own', name: 'Launch Plan', own: true, shareable: true, shared: false },
        { id: 'p-foreign', name: 'Foreign Plan', own: false, shareable: true, shared: false },
        { id: 'p-no-share', name: 'Not Shareable', own: true, shareable: false, shared: false },
      ],
    },
  }
  for (const target of ['p-own', 'launch plan']) {
    const effect = executeTool('share_project', { project: target, shared: true }, live)
    assert.equal(effect.relationOps?.length, 1, target)
    assert.deepEqual(effect.relationOps?.[0], {
      kind: 'share-project', projectId: 'p-own', projectName: 'Launch Plan', shared: true,
    })
  }
  for (const input of [
    { project: 'Launch', shared: true }, // no substring fallback
    { project: 'Missing Project', shared: true },
    { project: 'Foreign Plan', shared: true },
    { project: 'Not Shareable', shared: true },
  ]) {
    const effect = executeTool('share_project', input, live)
    assert.equal(effect.relationOps, undefined, JSON.stringify(input))
    assert.match(effect.summary, /proposed nothing/i)
  }
  const privateAgain = executeTool('share_project', { project: 'p-own', shared: false }, live)
  assert.deepEqual(privateAgain.relationOps?.[0], {
    kind: 'share-project', projectId: 'p-own', projectName: 'Launch Plan', shared: false,
  })
})

test('share_project refuses ambiguous names and metadata-free seed or legacy targets', () => {
  const live: ToolContext = {
    session: ctx.session,
    commons: {
      providers: [], systemPrompts: [], agents: [], commissions: [],
      projects: [
        { id: 'p-one', name: 'Roadmap', own: true, shareable: true },
        { id: 'p-two', name: 'ROADMAP', own: true, shareable: true },
        { id: 'p-seed', name: 'Seed Project' },
      ],
    },
  }
  for (const project of ['Roadmap', 'Seed Project', 'Insights dashboard']) {
    const effect = executeTool('share_project', { project, shared: true }, live)
    assert.equal(effect.relationOps, undefined, project)
    assert.match(effect.summary, /proposed nothing/i)
  }
  const absent = executeTool('share_project', { project: 'Insights dashboard', shared: true }, ctx)
  assert.equal(absent.relationOps, undefined, 'seed fallback cannot create sharing authority')
})

test('share-project consent copy states the public and private consequences', () => {
  const shared = describeOp({ kind: 'share-project', projectId: 'p-share-copy', projectName: 'Launch Plan', shared: true })
  assert.equal(shared.text, 'Share **Launch Plan** with everyone on Agent Commons. Others can discover this Project and contribute their own agents; private conversations and context stay private.')
  assert.equal(shared.done, 'Shared Launch Plan')

  const privateAgain = describeOp({ kind: 'share-project', projectId: 'p-share-copy', projectName: 'Launch Plan', shared: false })
  assert.equal(privateAgain.text, 'Stop sharing **Launch Plan** with the Commons. Public discovery and cross-account contributions stop; existing audience grants and their permissions stay unchanged.')
  assert.equal(privateAgain.done, 'Stopped public sharing of Launch Plan')
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

test('create_agent with no provider/prompt → CONCRETE bindings (default-else-first), never an unbound op', () => {
  // The apply path refuses an op without bindings (the strict-API rule), so the
  // builder resolves the shortcut BEFORE the consent card: unnamed → the first entry
  // when nothing is flagged default. The card therefore always names the pairing.
  const e = executeTool('create_agent', { label: 'Solo' }, ctxCommons)
  const op = e.relationOps![0]
  assert.equal(op.kind, 'create-agent')
  assert.equal((op as any).providerId, 'provider-anthropic')
  assert.equal((op as any).providerLabel, 'Anthropic')
  assert.equal((op as any).systemPromptId, 'sp-1')
  assert.equal((op as any).systemPromptLabel, 'Deep research')
})

test('create_agent honors the default-flagged entries over list order', () => {
  const flagged: ToolContext = {
    ...ctxCommons,
    commons: {
      ...ctxCommons.commons!,
      providers: [
        { id: 'provider-anthropic', label: 'Anthropic' },
        { id: 'provider-9', label: 'Local Llama', isDefault: true },
      ],
      systemPrompts: [
        { id: 'sp-1', label: 'Deep research' },
        { id: 'sp-2', label: 'Terse helper', isDefault: true },
      ],
    },
  }
  const e = executeTool('create_agent', { label: 'Solo' }, flagged)
  const op = e.relationOps![0]
  assert.equal((op as any).providerId, 'provider-9')
  assert.equal((op as any).systemPromptId, 'sp-2')
})

test('create_agent with a NAMED-but-unknown provider/prompt proposes nothing (no silent default swap)', () => {
  const badProvider = executeTool('create_agent', { label: 'Solo', provider: 'No Such Provider' }, ctxCommons)
  assert.equal(badProvider.relationOps, undefined)
  assert.match(badProvider.summary, /no model provider matching/i)

  const badPrompt = executeTool('create_agent', { label: 'Solo', system_prompt: 'No Such Prompt' }, ctxCommons)
  assert.equal(badPrompt.relationOps, undefined)
  assert.match(badPrompt.summary, /no library system prompt matching/i)
})

// ── Same-turn chaining: create_system_prompt → create_agent in ONE turn ───────
// A just-proposed prompt has no library id (ids mint at apply), so the agent
// proposal BUNDLES it as `newPrompt` and consumes the stand-alone prompt card —
// one confirm creates both. This is the "patrick's assistant" relay regression:
// the agent proposal used to vanish ("proposed nothing") whenever the model
// chained the two tools in the same turn.
test('create_agent bundles a same-turn pending create-prompt named by label', () => {
  const pending: RelationOp[] = [{ kind: 'create-prompt', label: "Patrick's helper", body: 'Help Patrick.', targetFamily: 'claude' }]
  const e = executeTool('create_agent', { label: "patrick's assistant", system_prompt: "Patrick's helper" }, { ...ctxCommons, pending })
  const op = e.relationOps![0] as Extract<RelationOp, { kind: 'create-agent' }>
  assert.equal(op.kind, 'create-agent')
  assert.equal(op.systemPromptId, undefined, 'no library id exists yet')
  assert.deepEqual(op.newPrompt, { label: "Patrick's helper", body: 'Help Patrick.', targetFamily: 'claude' })
  assert.equal(pending.length, 0, 'the stand-alone prompt proposal was consumed into the agent card')
  assert.match(e.summary, /bundling/i)
})

test('create_agent with no named prompt prefers the turn-pending prompt over the standing default', () => {
  const pending: RelationOp[] = [{ kind: 'create-prompt', label: 'Fresh prompt', body: 'B.', targetFamily: 'claude' }]
  const e = executeTool('create_agent', { label: 'Solo' }, { ...ctxCommons, pending })
  const op = e.relationOps![0] as Extract<RelationOp, { kind: 'create-agent' }>
  assert.deepEqual(op.newPrompt, { label: 'Fresh prompt', body: 'B.', targetFamily: 'claude' })
  assert.equal(op.systemPromptId, undefined)
  assert.equal(pending.length, 0)
})

test('create_agent still refuses a NAMED prompt that matches neither library nor pending', () => {
  const pending: RelationOp[] = [{ kind: 'create-prompt', label: 'Unrelated', body: 'B.', targetFamily: 'claude' }]
  const e = executeTool('create_agent', { label: 'Solo', system_prompt: 'No Such Prompt' }, { ...ctxCommons, pending })
  assert.equal(e.relationOps, undefined)
  assert.match(e.summary, /no library system prompt matching/i)
  assert.equal(pending.length, 1, 'an unrelated pending proposal is left alone')
})

test('create_agent with an EMPTY library bundles the same-turn prompt (the chained-create flow)', () => {
  const emptyLib: ToolContext = {
    ...ctxCommons,
    commons: { ...ctxCommons.commons!, systemPrompts: [] },
    pending: [{ kind: 'create-prompt', label: 'Bootstrap', body: 'Start here.', targetFamily: 'claude' }],
  }
  const e = executeTool('create_agent', { label: 'First agent' }, emptyLib)
  const op = e.relationOps![0] as Extract<RelationOp, { kind: 'create-agent' }>
  assert.equal(op.newPrompt?.label, 'Bootstrap')
})

test('commission_agent → a commission-agent op resolving the agent (live) + project (seed)', () => {
  const e = executeTool('commission_agent', { agent: 'Scout', project: 'Insights dashboard' }, ctxCommons)
  const op = e.relationOps![0]
  assert.equal(op.kind, 'commission-agent')
  assert.equal((op as any).agentId, 'agent-7')
  assert.equal((op as any).projectId, 'p-insights')
})

test('project writes refuse foreign projects, while commission_agent admits an explicitly shared foreign project', () => {
  const ownership: ToolContext = {
    ...ctxCommons,
    commons: {
      ...ctxCommons.commons!,
      projects: [
        { id: 'p-owned', name: 'Owned Project', own: true, shared: false, defaultRole: 'maintainer' },
        { id: 'p-shared', name: 'Shared Project', own: false, shared: true, defaultRole: 'reader' },
        { id: 'p-private', name: 'Private Foreign Project', own: false, shared: false },
      ],
    },
  }

  const file = executeTool('file_session', { project: 'Shared Project' }, ownership)
  assert.equal(file.relationOps, undefined)
  assert.match(file.summary, /no project matching/i)

  const commission = executeTool('commission_agent', { agent: 'Scout', project: 'Shared Project' }, ownership)
  assert.equal(commission.relationOps?.[0]?.kind, 'commission-agent')
  assert.equal((commission.relationOps?.[0] as any).projectId, 'p-shared')
  assert.equal((commission.relationOps?.[0] as any).role, 'reader')

  const privateCommission = executeTool('commission_agent', { agent: 'Scout', project: 'Private Foreign Project' }, ownership)
  assert.equal(privateCommission.relationOps, undefined)
  assert.match(privateCommission.summary, /no project matching/i)
})

test('project metadata absent remains compatible with seed and unit-call project resolution', () => {
  const e = executeTool('file_session', { project: 'Insights dashboard' }, ctxCommons)
  assert.equal(e.relationOps?.[0]?.kind, 'file-session')
})

test('an exact foreign project name cannot fall through to an owned contains-match', () => {
  const collision: ToolContext = {
    ...ctxCommons,
    commons: {
      ...ctxCommons.commons!,
      projects: [
        { id: 'p-foreign-exact', name: 'Shared Project', own: false, shared: false },
        { id: 'p-owned-contains', name: 'Shared Project Archive', own: true },
      ],
    },
  }

  const write = executeTool('set_project_description', { project: 'Shared Project', description: 'No redirect.' }, collision)
  assert.equal(write.relationOps, undefined)
  assert.match(write.summary, /no project matching/i)

  const commission = executeTool('commission_agent', { agent: 'Scout', project: 'Shared Project' }, collision)
  assert.equal(commission.relationOps, undefined)
  assert.match(commission.summary, /no project matching/i)
})

test('commission_agent with an unknown agent proposes nothing (no op, just a summary)', () => {
  const e = executeTool('commission_agent', { agent: 'Nobody', project: 'Insights dashboard' }, ctxCommons)
  assert.equal(e.relationOps, undefined)
  assert.match(e.summary, /no worker agent/i)
})

test('commission_agent stamps a CONCRETE role onto the op (D14/INV-9) — named, else default-else-writer', () => {
  const withRole = executeTool('commission_agent', { agent: 'Scout', project: 'Insights dashboard', role: 'Reader' }, ctxCommons)
  assert.equal((withRole.relationOps![0] as any).role, 'reader') // case-normalized
  assert.match(withRole.summary, /as reader/i)
  // An unrecognized (or absent) role resolves BEFORE the consent card — to the
  // Project's defaultRole when set, else the writer baseline — never rides undefined
  // (the apply funnel refuses a role-less commission).
  const bogus = executeTool('commission_agent', { agent: 'Scout', project: 'Insights dashboard', role: 'admin' }, ctxCommons)
  assert.equal((bogus.relationOps![0] as any).role, 'writer')
  assert.match(bogus.summary, /as writer/i)
  const unnamed = executeTool('commission_agent', { agent: 'Scout', project: 'Insights dashboard' }, ctxCommons)
  assert.equal((unnamed.relationOps![0] as any).role, 'writer')
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

test('handoff_agent → a handoff-agent op re-binding the session to the resolved Agent (D16)', () => {
  const e = executeTool('handoff_agent', { agent: 'Scout' }, ctxCommons)
  const op = e.relationOps![0]
  assert.equal(op.kind, 'handoff-agent')
  assert.equal((op as any).sessionId, 'auth-refactor') // from ctx.session
  assert.equal((op as any).agentId, 'agent-7')
})

test('handoff_agent with an unknown agent proposes nothing', () => {
  const e = executeTool('handoff_agent', { agent: 'Nobody' }, ctxCommons)
  assert.equal(e.relationOps, undefined)
})

test('set_commission_cap → a set-commission-cap op resolving the project (seed) + the integer cap (D13)', () => {
  const e = executeTool('set_commission_cap', { project: 'Insights dashboard', cap: 3 }, ctxCommons)
  const op = e.relationOps![0]
  assert.equal(op.kind, 'set-commission-cap')
  assert.equal((op as any).projectId, 'p-insights')
  assert.equal((op as any).cap, 3)
  assert.match(e.summary, /capping Insights dashboard at 3/i)
})

test('set_commission_cap accepts a numeric string but rejects a non-integer / negative cap', () => {
  assert.equal((executeTool('set_commission_cap', { project: 'Insights dashboard', cap: '5' }, ctxCommons).relationOps![0] as any).cap, 5)
  for (const bad of [-1, 2.5, 'lots']) {
    const e = executeTool('set_commission_cap', { project: 'Insights dashboard', cap: bad }, ctxCommons)
    assert.equal(e.relationOps, undefined, `cap ${bad} proposes nothing`)
    assert.match(e.summary, /not a valid commission cap/i)
  }
})
