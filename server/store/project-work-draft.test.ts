import assert from 'node:assert/strict'
import { test } from 'node:test'
import { store } from './index.ts'
import { manualDispatchRunId } from '../dispatchIdentity.ts'
import { ConflictError, NotFoundError, ValidationError } from '../conflict.ts'
import { accounts } from '../accounts.ts'
import { MCP_MODERN_VERSION } from '../mcpProtocol.ts'
import { MCP_SCHEMA_ADMISSION_VERSION, mcpToolSchemaHash } from '../mcpToolAdmission.ts'

let sequence = 0
function arena() {
  const tenantId = `project-draft-store-${++sequence}`
  const provider = store.createProvider({ label: 'Draft provider', modelFamily: 'claude', effortLevels: ['Low'],
    models: [{ id: 'draft-model', label: 'Draft model' }] }, { baseURL: 'https://draft.invalid', model: 'draft-model', capabilities: { toolUse: true } }, tenantId)
  const agent = store.createAgent({ label: 'Draft Agent', systemPrompt: 'Be useful.', instructions: '', tools: [], providerId: provider.id }, tenantId)
  const projectId = `p-${tenantId}`
  store.applyRelationOp({ kind: 'create-project', projectId, projectName: 'Project source', projectDescription: 'Exact Project description.' }, tenantId)
  const commission = store.createCommission({ agentId: agent.id, projectId, role: 'reader', standing: false }, tenantId)
  const item = store.postOpenSubGoal(projectId, { subGoal: 'Prepare the migration', type: 'charge', target: 'billing', note: 'Do not spend anything.' }, tenantId)
  assert.notEqual(item, 'capped')
  assert.ok(typeof item === 'object')
  const input = { projectWork: { projectId, itemId: item.id, commissionId: commission.id, expectedRevision: commission.configurationRevision ?? 0 },
    execution: { agentId: agent.id, providerId: provider.id, modelId: 'draft-model' } }
  const runId = manualDispatchRunId(tenantId, `draft-${sequence}`)
  return { tenantId, provider, agent, projectId, commission, item, input, runId }
}

function finish(a: ReturnType<typeof arena>) {
  const run = store.getRealDispatch(a.runId, a.tenantId)
  if (run && run !== 'retired') store.removeSession(run.execution!.sessionId)
}

test('Project drafting freezes only selected source facts, stays private, and never resolves or credits the item', () => {
  const a = arena()
  try {
    const beforeItem = structuredClone(store.listOpenSubGoals(a.projectId, a.tenantId))
    const credit = store.getAgent(a.agent.id).contributions
    const run = store.startProjectWorkDraft(a.input, a.tenantId, a.runId)
    assert.deepEqual(run.execution!.projectWork, a.input.projectWork)
    assert.equal(run.tenantId, a.tenantId)
    assert.match(run.detail, /Exact Project description/)
    assert.match(run.detail, /Do not spend anything/)
    assert.match(run.detail, /billing/)
    assert.equal(store.listDispatch('foreign-draft-reader').some(row => row.id === run.id), false)
    assert.deepEqual(store.listOpenSubGoals(a.projectId, a.tenantId), beforeItem)
    store.settleRealDispatch(run.id, a.tenantId, 'ok', { id: 'draft-answer', role: 'assistant', content: 'Here is a proposed plan.' })
    assert.deepEqual(store.listOpenSubGoals(a.projectId, a.tenantId), beforeItem)
    assert.equal(store.getAgent(a.agent.id).contributions, credit)
    assert.equal(store.getSession(run.execution!.sessionId)!.messages![0]!.content, `${run.title}\n\n${run.detail}`)
    store.deleteCommission(a.commission.id)
    assert.equal(store.startProjectWorkDraft(a.input, a.tenantId, a.runId).id, run.id, 'represented keyed work survives later source revocation')
  } finally { finish(a) }
})

test('Project draft refuses missing, foreign, cross-Project and stale Commission sources before mutation', () => {
  const a = arena()
  const b = arena()
  const before = store.listDispatch(a.tenantId).length
  try {
    for (const projectWork of [
      { ...a.input.projectWork, commissionId: 'unknown' },
      { ...a.input.projectWork, commissionId: b.commission.id },
      { ...a.input.projectWork, projectId: b.projectId },
      { ...a.input.projectWork, itemId: b.item.id },
    ]) assert.throws(() => store.startProjectWorkDraft({ ...a.input, projectWork }, a.tenantId, a.runId), NotFoundError)
    assert.throws(() => store.startProjectWorkDraft({ ...a.input, projectWork: { ...a.input.projectWork, expectedRevision: a.input.projectWork.expectedRevision + 1 } }, a.tenantId, a.runId), ConflictError)
    assert.throws(() => store.startProjectWorkDraft(a.input, b.tenantId, b.runId), NotFoundError)
    assert.throws(() => store.startProjectWorkDraft({ ...a.input, execution: { ...a.input.execution, agentId: b.agent.id } }, a.tenantId, a.runId), ValidationError)
    assert.equal(store.listDispatch(a.tenantId).length, before)
  } finally { finish(a); finish(b) }
})

test('a full-length work label is retained in the prompt while only its conversation label is abbreviated', () => {
  const a = arena()
  try {
    const label = `Migration ${'x'.repeat(1990)}`
    const item = store.postOpenSubGoal(a.projectId, { subGoal: label, type: 'read', target: 'source', note: 'Full source.' }, a.tenantId, undefined)
    assert.ok(typeof item === 'object')
    const run = store.startProjectWorkDraft({ ...a.input, projectWork: { ...a.input.projectWork, itemId: item.id } }, a.tenantId, a.runId)
    assert.equal(run.title.length, 200)
    assert.ok(run.detail.includes(label))
  } finally { finish(a) }
})

test('MCP argument drafts require the exact inspected selection and person authority without creating a tool execution', () => {
  const a = arena()
  const ownerId = `project-draft-mcp-store-owner-${sequence}`
  const peerId = `project-draft-mcp-store-peer-${sequence}`
  assert.ok(accounts.createUser('MCP draft store owner', `${ownerId}@example.test`, 'fixture-password', { userId: ownerId, tenantId: `${ownerId}-home` }))
  assert.ok(accounts.createOrg(ownerId, `MCP draft store org ${sequence}`, { logicalId: a.tenantId }))
  assert.ok(accounts.createUser('MCP draft store peer', `${peerId}@example.test`, 'fixture-password', { userId: peerId, tenantId: `${peerId}-home` }))
  const invite = accounts.issueInvite(a.tenantId, `${peerId}@example.test`, 'MCP draft store owner')
  assert.ok(invite.kind === 'represented')
  assert.equal(accounts.resolveInvite(invite.invite.id, peerId, 'accept')?.kind, 'accepted')
  const item = store.postOpenSubGoal(a.projectId, { subGoal: 'Draft a reviewed tool call', type: 'mcp.mutate', target: 'write_record', note: 'Do not execute.' }, a.tenantId)
  assert.ok(typeof item === 'object')
  const tool = { name: 'write_record', inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'], additionalProperties: false } }
  const connectionId = `mcp-connection-${sequence.toString(16).padStart(32, '0')}`
  store.createMcpConnection({ transport: 'stdio', id: connectionId, label: 'Store local writer' }, a.tenantId, false, ownerId)
  store.commitMcpInspection(connectionId, a.tenantId, 0, { protocolVersion: MCP_MODERN_VERSION, cleanup: 'not-needed', tools: [tool],
    schemaAdmission: { version: MCP_SCHEMA_ADMISSION_VERSION, hashes: [mcpToolSchemaHash(tool)] } }, Date.now(), undefined, undefined,
    ownerId, `MCP_STDIO_${sequence.toString(16).toUpperCase().padStart(32, '0')}`)
  const projectWork = { ...a.input.projectWork, itemId: item.id }
  const selection = { connectionId, connectionRevision: 1, toolName: tool.name }
  const runId = manualDispatchRunId(a.tenantId, `mcp-draft-${sequence}`)
  let createdRun: ReturnType<typeof store.startProjectWorkDraft> | undefined
  try {
    const before = { runs: store.listDispatch(a.tenantId).length, sessions: store.listSessions(a.tenantId).length }
    assert.throws(() => store.startProjectWorkDraft({ ...a.input, projectWork, mcpProposal: { ...selection, connectionRevision: 0 } }, a.tenantId, runId, ownerId), ValidationError)
    assert.throws(() => store.startProjectWorkDraft({ ...a.input, projectWork, mcpProposal: selection }, a.tenantId, runId, peerId), ValidationError,
      'a registered same-org member cannot borrow another person’s local binding')
    assert.deepEqual({ runs: store.listDispatch(a.tenantId).length, sessions: store.listSessions(a.tenantId).length }, before)

    const run = store.startProjectWorkDraft({ ...a.input, projectWork, mcpProposal: selection }, a.tenantId, runId, ownerId)
    createdRun = run
    assert.equal(run.execution?.mcpProposal?.toolName, tool.name)
    assert.equal(run.execution?.mcpProposal?.transport, 'stdio')
    assert.equal(run.execution?.state, 'running')
    assert.equal(store.getSession(run.execution!.sessionId)?.messages?.length, 1)
    assert.doesNotMatch(JSON.stringify(run.execution?.mcpProposal), /connectionId|ownerUserId|grantReference|MCP_STDIO_/)
    assert.equal(store.listContributions(a.projectId, a.tenantId).length, 0)
    assert.equal(store.listOpenSubGoals(a.projectId, a.tenantId).find(row => row.id === item.id)?.status, 'open')
  } finally {
    if (createdRun?.execution) store.removeSession(createdRun.execution.sessionId)
    finish(a)
    const connection = store.privateMcpConnection(connectionId, a.tenantId, ownerId)
    if (connection) store.removeMcpConnection(connection.id, a.tenantId, connection.revision, ownerId)
    accounts.deactivateUser(ownerId)
    accounts.deactivateUser(peerId)
  }
})
