import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { after, before, test } from 'node:test'
import type { Server } from 'node:http'
import { turns } from '../turns.ts'
import { store } from '../store/index.ts'
import { manualDispatchRunId } from '../dispatchIdentity.ts'
import { call, callFresh } from '../testkit/http.ts'
import { accounts } from '../accounts.ts'
import { MCP_MODERN_VERSION } from '../mcpProtocol.ts'
import { MCP_SCHEMA_ADMISSION_VERSION, mcpToolSchemaHash } from '../mcpToolAdmission.ts'
import { signSession } from '../auth.ts'

const MODEL_ID = 'claude-opus-4-8'
let modelServer: Server
let modelBaseUrl = ''
let modelCalls = 0
const messagesRequests: Record<string, any>[] = []
let sequence = 0
const originalEnv = new Map<string, string | undefined>()

function scopedEnv(name: string, value: string | undefined): void {
  if (!originalEnv.has(name)) originalEnv.set(name, process.env[name])
  if (value === undefined) delete process.env[name]
  else process.env[name] = value
}

before(async () => {
  scopedEnv('AUTH_GATE', 'off')
  scopedEnv('IDENTITY_HEADERS', 'allow')
  scopedEnv('MODEL_PACE_MS', '30')
  modelServer = createServer(async (request, response) => {
    const chunks: Buffer[] = []
    for await (const chunk of request) chunks.push(Buffer.from(chunk))
    const path = (request.url ?? '').split('?')[0]
    if (request.method === 'GET' && path === '/v1/models') {
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ data: [{ id: MODEL_ID, display_name: 'Project draft fixture model' }] }))
      return
    }
    if (request.method !== 'POST' || path !== '/v1/messages') {
      response.writeHead(404).end()
      return
    }
    let body: Record<string, any>
    try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')) } catch {
      response.writeHead(400).end()
      return
    }
    messagesRequests.push(body)
    modelCalls += 1
    const id = `msg_project_work_draft_${modelCalls}`
    const prompt = body.messages?.at(-1)?.content ?? ''
    const requestsTool = typeof prompt === 'string' && prompt.includes('Draft Must Not Create')
    const requestsMcpArguments = typeof prompt === 'string' && prompt.includes('Draft arguments for the selected MCP tool')
    response.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', connection: 'keep-alive' })
    const sse = (event: string, data: unknown) => response.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
    const pause = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds))
    sse('message_start', { type: 'message_start', message: {
      id, type: 'message', role: 'assistant', model: MODEL_ID, content: [], stop_reason: null,
      usage: { input_tokens: 12_000, output_tokens: 0 },
    } })
    if (requestsTool) {
      await pause(30)
      sse('content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: `toolu_${id}`, name: 'create_project', input: {} } })
      await pause(30)
      sse('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{"name":"Draft Must Not Create"}' } })
      sse('content_block_stop', { type: 'content_block_stop', index: 0 })
      sse('message_delta', { type: 'message_delta', delta: { stop_reason: 'tool_use', stop_sequence: null }, usage: { output_tokens: 9_000 } })
    } else {
      await pause(30)
      sse('content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } })
      await pause(30)
      sse('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: requestsMcpArguments
        ? JSON.stringify({ toolName: 'write_record', arguments: { query: 'drafted safely' } })
        : 'A private draft for the owner to review before sharing.' } })
      sse('content_block_stop', { type: 'content_block_stop', index: 0 })
      sse('message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 9_000 } })
    }
    sse('message_stop', { type: 'message_stop' })
    response.end()
  })
  modelServer.listen(0, '127.0.0.1')
  await new Promise<void>((resolve) => modelServer.once('listening', resolve))
  const address = modelServer.address()
  assert.ok(address && typeof address === 'object')
  modelBaseUrl = `http://127.0.0.1:${address.port}`
})

after(async () => {
  await new Promise<void>((resolve) => modelServer.close(() => resolve()))
  for (const [name, value] of originalEnv) {
    if (value === undefined) delete process.env[name]
    else process.env[name] = value
  }
})

interface Actor {
  tenantId: string
  agentId: string
  providerId: string
  modelId: string
}

function actor(tenantId: string, options: { agentBudget?: unknown; providerPlan?: unknown; label?: string } = {}): Actor {
  const suffix = `${Date.now().toString(36)}-${++sequence}`
  const provider = store.createProvider({
    label: `Project draft provider ${suffix}`,
    modelFamily: 'claude',
    effortLevels: ['Low', 'Medium', 'High'],
    models: [{ id: MODEL_ID, label: 'Claude Opus fixture' }],
    ...(options.providerPlan ? { plan: options.providerPlan as any } : {}),
  }, {
    baseURL: modelBaseUrl,
    model: MODEL_ID,
    capabilities: { toolUse: true },
  }, tenantId)
  const agent = store.createAgent({
    label: options.label ?? `Project draft Agent ${suffix}`,
    systemPrompt: 'Draft a concise, useful answer.',
    instructions: '',
    tools: ['create_project', 'save_artifact'],
    providerId: provider.id,
    ...(options.agentBudget ? { budget: options.agentBudget as any } : {}),
  }, tenantId)
  return { tenantId, agentId: agent.id, providerId: provider.id, modelId: MODEL_ID }
}

const selectedTool = { name: 'write_record', description: 'Write one reviewed record.', inputSchema: {
  type: 'object', properties: { query: { type: 'string' } }, required: ['query'], additionalProperties: false,
} }

function inspectedMcp(tenantId: string, userId: string, transport: 'http' | 'stdio') {
  const id = `mcp-connection-${(++sequence).toString(16).padStart(32, '0')}`
  if (transport === 'stdio') {
    store.createMcpConnection({ transport: 'stdio', id, label: 'Local reviewed writer' }, tenantId, false, userId)
    store.commitMcpInspection(id, tenantId, 0, {
      protocolVersion: MCP_MODERN_VERSION, cleanup: 'not-needed', tools: [selectedTool],
      schemaAdmission: { version: MCP_SCHEMA_ADMISSION_VERSION, hashes: [mcpToolSchemaHash(selectedTool)] },
    }, Date.now(), undefined, undefined, userId, `MCP_STDIO_${sequence.toString(16).toUpperCase().padStart(32, '0')}`)
  } else {
    store.createMcpConnection({ id, label: 'Owner reviewed HTTP writer', endpoint: 'https://mcp.example.test/tools', authentication: 'device-oauth' }, tenantId, false, userId)
    store.commitMcpInspection(id, tenantId, 0, {
      protocolVersion: MCP_MODERN_VERSION, cleanup: 'not-needed', tools: [selectedTool],
      schemaAdmission: { version: MCP_SCHEMA_ADMISSION_VERSION, hashes: [mcpToolSchemaHash(selectedTool)] },
    }, Date.now(), `MCP_DESKTOP_${sequence.toString(16).toUpperCase().padStart(32, '0')}`, undefined, userId)
  }
  return { connectionId: id, selection: { connectionId: id, connectionRevision: 1, toolName: selectedTool.name } }
}

function sharedProject(owner: string, name: string, subGoal = 'Summarize the migration plan', workType = 'charge', target = 'billing') {
  const projectId = `project-work-draft-${++sequence}`
  store.applyRelationOp({
    kind: 'create-project', projectId, projectName: name,
    projectDescription: 'A viewer-readable overview of the work.',
  }, owner)
  store.applyRelationOp({
    kind: 'set-project-instructions', projectId, projectName: name,
    instructions: 'OWNER_ONLY_INSTRUCTIONS: do not disclose this sentence.',
  }, owner)
  store.applyRelationOp({ kind: 'share-project', projectId, projectName: name, shared: true }, owner)
  const item = store.postOpenSubGoal(projectId, {
    subGoal, type: workType, target, note: 'Do not spend or execute anything.',
  }, owner)
  assert.ok(typeof item === 'object' && item !== null)
  return { projectId, item }
}

function source(projectId: string, itemId: string, commissionId: string, expectedRevision: number) {
  return { projectId, itemId, commissionId, expectedRevision }
}

function draftInput(binding: Actor, projectWork: ReturnType<typeof source>, mcpProposal?: unknown) {
  return { projectWork, ...(mcpProposal === undefined ? {} : { mcpProposal }), execution: { agentId: binding.agentId, providerId: binding.providerId, modelId: binding.modelId } }
}

const headers = (tenantId: string, key?: string, userId?: string) => ({
  'x-tenant-id': tenantId,
  ...(userId === undefined ? {} : {
    cookie: `uw_session=${signSession({ userId, tenantId, iat: Date.now() })}`,
    'x-account-transition-source': `session:${userId}`,
  }),
  ...(key === undefined ? {} : { 'idempotency-key': key }),
})
const logicalId = (tenantId: string, key: string) => manualDispatchRunId(tenantId, key)

async function waitForTerminal(id: string, tenantId: string, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const run = store.getRealDispatch(id, tenantId)
    if (run && run !== 'retired' && run.execution?.state !== 'running') return run
    assert.ok(Date.now() < deadline, `Project-work Dispatch ${id} did not settle`)
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
}

async function waitForTurn(sessionId: string, timeoutMs = 2_000) {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const turn = turns.bySession(sessionId)
    if (turn) return turn
    assert.ok(Date.now() < deadline, `no model turn started for ${sessionId}`)
    await new Promise((resolve) => setTimeout(resolve, 2))
  }
}

async function cleanup(id: string, tenantId: string, actors: Actor[]): Promise<void> {
  const run = id ? store.getRealDispatch(id, tenantId) : undefined
  if (run && run !== 'retired' && run.execution) {
    const active = turns.bySession(run.execution.sessionId)
    if (active) {
      turns.cancel(active.id)
      await waitForTerminal(id, tenantId)
    }
    store.removeSession(run.execution.sessionId)
  }
  for (const row of actors) {
    for (const commission of store.listCommissions(undefined, row.tenantId).filter((candidate) => candidate.agentId === row.agentId)) {
      store.deleteCommission(commission.id)
    }
    store.deleteAgent(row.agentId)
    store.deleteProvider(row.providerId)
  }
}

test('owner and shared visitor get one frozen, private, tool-free Project-work draft with durable result and usage', async () => {
  const ownerTenant = `project-draft-owner-${++sequence}`
  const visitorTenant = `project-draft-visitor-${++sequence}`
  const owner = actor(ownerTenant)
  const visitor = actor(visitorTenant)
  const project = sharedProject(ownerTenant, 'Shared Project', 'Summarize the migration plan')
  const ownerCommission = store.createCommission({ role: 'writer', agentId: owner.agentId, projectId: project.projectId }, ownerTenant)
  const visitorCommission = store.createCommission({ role: 'reader', agentId: visitor.agentId, projectId: project.projectId }, visitorTenant)
  const ownerKey = `project-draft-owner-${sequence}`
  const visitorKey = `project-draft-visitor-${sequence}`
  const ownerId = logicalId(ownerTenant, ownerKey)
  const visitorId = logicalId(visitorTenant, visitorKey)
  const callsBefore = modelCalls
  const requestIndex = messagesRequests.length
  try {
    for (const [tenant, key, binding, commission] of [
      [ownerTenant, ownerKey, owner, ownerCommission],
      [visitorTenant, visitorKey, visitor, visitorCommission],
    ] as const) {
      const currentSource = source(project.projectId, project.item.id, commission.id, commission.configurationRevision ?? 0)
      const beforeUsage = store.usage(undefined, tenant).limits.map((limit) => limit.pct)
      assert.ok(beforeUsage.every((pct) => pct === 0), 'new tenant begins without inherited usage')
      const started = await call('POST', '/dispatch', draftInput(binding, currentSource), headers(tenant, key))
      assert.equal(started.status, 200)
      assert.deepEqual(started.json.execution.projectWork, currentSource)
      assert.equal(started.json.execution.state, 'running')
      assert.equal(started.json.execution.kind, 'conversation')
      const terminal = await waitForTerminal(started.json.id, tenant)
      assert.equal(terminal.execution?.state, 'replied', JSON.stringify({ terminal, messagesRequest: messagesRequests.at(-1) }))
      assert.equal(terminal.status, 'done')
      assert.deepEqual(terminal.execution?.projectWork, currentSource)
      const session = store.getSession(terminal.execution!.sessionId)
      assert.ok(session)
      assert.equal(session.messages?.[0]?.role, 'user')
      assert.equal(session.messages?.[0]?.content, `${terminal.title}\n\n${terminal.detail}`)
      assert.equal(session.messages?.filter((message) => message.role === 'assistant').length, 1)
      assert.ok(session.messages?.find((message) => message.role === 'assistant')?.content.length)
      assert.equal(store.listOpenSubGoals(project.projectId, ownerTenant).find((item) => item.id === project.item.id)?.status, 'open', 'drafting leaves work open')
      assert.ok(store.usage(undefined, tenant).limits.some((limit) => limit.pct > 0), JSON.stringify(store.usage(undefined, tenant)))
    }

    const requests = messagesRequests.slice(requestIndex)
    assert.equal(requests.length, 2)
    for (const request of requests) {
      assert.equal(Object.hasOwn(request, 'tools'), false, 'the exact Messages wire request omits tool declarations')
      assert.equal(request.messages.length, 1, 'no prior or ambient conversation is supplied')
      assert.equal(request.messages[0].role, 'user')
      assert.match(request.messages[0].content, /A viewer-readable overview/)
      assert.match(request.messages[0].content, /Do not spend or execute anything/)
    }
    assert.match(requests[0].messages[0].content, /OWNER_ONLY_INSTRUCTIONS/, 'the Project owner receives its own visible instructions')
    assert.doesNotMatch(requests[1].messages[0].content, /OWNER_ONLY_INSTRUCTIONS/, 'the shared visitor receives the redacted Project face')
    assert.equal(modelCalls, callsBefore + 2)
    const visitorRun = store.getRealDispatch(visitorId, visitorTenant)
    assert.ok(visitorRun && visitorRun !== 'retired')
    const sessionId = visitorRun.execution!.sessionId
    const savedMessages = structuredClone(store.getSession(sessionId)?.messages)
    const beforeReplayCalls = modelCalls
    const replay = await callFresh('POST', '/dispatch', {
      projectWork: { ...source(project.projectId, project.item.id, 'wrong-after-response-loss', 999) },
      execution: { agentId: 'deleted-agent', providerId: 'deleted-provider', modelId: 'changed' },
    }, headers(visitorTenant, visitorKey))
    assert.equal(replay.status, 200)
    assert.equal(replay.json.id, visitorId)
    assert.deepEqual(replay.json.execution.projectWork, visitorRun.execution!.projectWork)
    assert.equal(modelCalls, beforeReplayCalls, 'durable same-key replay does not dispatch another Messages request')
    assert.deepEqual(store.getSession(sessionId)?.messages, savedMessages, 'replay preserves first prompt and saved result')
    assert.equal(store.listDispatch(visitorTenant).filter((row) => row.id === visitorId).length, 1)
    const foreignRun = await callFresh('GET', '/dispatch', undefined, headers(ownerTenant))
    assert.equal(foreignRun.json.some((row: { id: string }) => row.id === visitorId), false, 'private draft receipt is hidden from the Project owner')
    assert.equal((await callFresh('GET', `/sessions/${sessionId}`, undefined, headers(ownerTenant))).status, 404)
  } finally {
    await cleanup(ownerId, ownerTenant, [owner])
    await cleanup(visitorId, visitorTenant, [visitor])
  }
})

test('foreign Project and Commission walls return the same not-found without creating a run', async () => {
  const ownerTenant = `project-draft-wall-owner-${++sequence}`
  const visitorTenant = `project-draft-wall-visitor-${++sequence}`
  const foreignTenant = `project-draft-wall-foreign-${++sequence}`
  const owner = actor(ownerTenant)
  const visitor = actor(visitorTenant)
  const foreign = actor(foreignTenant)
  const project = sharedProject(ownerTenant, 'Private Project')
  const commission = store.createCommission({ role: 'reader', agentId: owner.agentId, projectId: project.projectId }, ownerTenant)
  const key = `wall-${sequence}`
  const before = { sessions: store.listSessions(foreignTenant).length, runs: store.listDispatch(foreignTenant).length }
  try {
    const input = draftInput(foreign, source(project.projectId, project.item.id, commission.id, commission.configurationRevision ?? 0))
    const denied = await call('POST', '/dispatch', input, headers(foreignTenant, key))
    assert.equal(denied.status, 404)
    assert.equal(denied.json.error.code, 'not_found')
    assert.deepEqual({ sessions: store.listSessions(foreignTenant).length, runs: store.listDispatch(foreignTenant).length }, before)

    const badBinding = await callFresh('POST', '/dispatch', draftInput(visitor,
      source(project.projectId, project.item.id, commission.id, commission.configurationRevision ?? 0)),
    headers(visitorTenant, `wrong-commission-owner-${sequence}`))
    assert.equal(badBinding.status, 404, 'a shared Project does not disclose or adopt another tenant’s Commission')
    assert.equal(store.listSessions(visitorTenant).length, 0)
  } finally {
    await cleanup(logicalId(foreignTenant, key), foreignTenant, [foreign])
    await cleanup(logicalId(visitorTenant, `wrong-commission-owner-${sequence}`), visitorTenant, [visitor])
    await cleanup('', ownerTenant, [owner])
  }
})

test('Project-work parser is the only admitted request shape and stale/closed source gates precede model I/O', async () => {
  const tenant = `project-draft-validation-${++sequence}`
  const binding = actor(tenant)
  const project = sharedProject(tenant, 'Validation Project')
  const commission = store.createCommission({ role: 'reader', agentId: binding.agentId, projectId: project.projectId }, tenant)
  const key = `validation-${sequence}`
  const runId = logicalId(tenant, key)
  const counts = { sessions: store.listSessions(tenant).length, runs: store.listDispatch(tenant).length }
  const callsBefore = modelCalls
  try {
    const validSource = source(project.projectId, project.item.id, commission.id, commission.configurationRevision ?? 0)
    for (const malformed of [
      { ...draftInput(binding, validSource), title: 'not accepted' },
      { ...draftInput(binding, validSource), detail: 'not accepted' },
      { ...draftInput(binding, validSource), unknown: true },
      { projectWork: { ...validSource, expectedRevision: -1 }, execution: { agentId: binding.agentId, providerId: binding.providerId, modelId: binding.modelId } },
    ]) {
      const response = await call('POST', '/dispatch', malformed, headers(tenant, key))
      assert.equal(response.status, 400)
      assert.equal(response.json.error.code, 'bad_request')
    }
    const stale = await callFresh('POST', '/dispatch', draftInput(binding,
      source(project.projectId, project.item.id, commission.id, (commission.configurationRevision ?? 0) + 1)),
    headers(tenant, key))
    assert.equal(stale.status, 409)
    assert.equal(stale.json.error.code, 'conflict')
    assert.equal(store.getRealDispatch(runId, tenant), undefined)
    assert.deepEqual({ sessions: store.listSessions(tenant).length, runs: store.listDispatch(tenant).length }, counts)
    assert.equal(modelCalls, callsBefore)

    store.retractOpenSubGoal(project.projectId, project.item.id, tenant, undefined)
    const closedKey = `closed-${sequence}`
    const closed = await callFresh('POST', '/dispatch', draftInput(binding,
      source(project.projectId, project.item.id, commission.id, commission.configurationRevision ?? 0)),
    headers(tenant, closedKey))
    assert.equal(closed.status, 409)
    assert.equal(closed.json.error.code, 'conflict')
    assert.equal(store.getRealDispatch(logicalId(tenant, closedKey), tenant), undefined)
    assert.equal(modelCalls, callsBefore)
  } finally {
    await cleanup(runId, tenant, [binding])
  }
})

test('account, Commission, Agent, bound-provider, and selected-provider budget walls refuse before Messages I/O', async () => {
  const labels = ['account', 'commission', 'agent', 'bound-provider', 'selected-provider'] as const
  const callsBefore = modelCalls
  const requestCountBefore = messagesRequests.length
  for (const label of labels) {
    const tenant = `project-draft-budget-${label}-${++sequence}`
    const oneTokenBudget = { windows: [{ label: '5-hour limit', ceiling: 1 }] }
    const binding = actor(tenant, {
      ...(label === 'agent' ? { agentBudget: oneTokenBudget } : {}),
      ...(label === 'bound-provider' ? { providerPlan: oneTokenBudget } : {}),
    })
    const projectId = `budget-project-${sequence}`
    store.applyRelationOp({ kind: 'create-project', projectId, projectName: `Budget ${label}`, projectDescription: '' }, tenant)
    const item = store.postOpenSubGoal(projectId, {
      subGoal: `Budget refusal ${label}`, type: 'charge', target: 'test', note: '',
    }, tenant)
    assert.ok(typeof item === 'object' && item !== null)
    const commission = store.createCommission({
      role: 'reader', agentId: binding.agentId, projectId,
      ...(label === 'commission' ? { grant: oneTokenBudget } : {}),
    }, tenant)
    let selectedProviderId = binding.providerId
    if (label === 'selected-provider' || label === 'bound-provider') {
      const selected = store.createProvider({
        label: `Selected provider ${label} ${sequence}`,
        modelFamily: 'claude', effortLevels: ['Low'],
        models: [{ id: MODEL_ID, label: 'Claude Opus fixture' }],
        ...(label === 'selected-provider' ? { plan: oneTokenBudget } : {}),
      }, { baseURL: modelBaseUrl, model: MODEL_ID, capabilities: { toolUse: true } }, tenant)
      selectedProviderId = selected.id
    }
    if (label === 'account') store.recordUsage(2_400_000, 0, tenant)
    else store.recordUsage(1, 0, tenant)
    const key = `budget-${label}-${sequence}`
    try {
      const response = await call('POST', '/dispatch', {
        projectWork: source(projectId, item.id, commission.id, commission.configurationRevision ?? 0),
        execution: { agentId: binding.agentId, providerId: selectedProviderId, modelId: MODEL_ID },
      }, headers(tenant, key))
      assert.equal(response.status, 429, `${label} budget must refuse the draft`)
      assert.equal(response.json.error.code, 'limit_exceeded')
      assert.equal(store.getRealDispatch(logicalId(tenant, key), tenant), undefined)
      assert.equal(store.listSessions(tenant).length, 0)
      assert.equal(store.listDispatch(tenant).some((row) => row.id === logicalId(tenant, key)), false)
    } finally {
      await cleanup('', tenant, [binding])
    }
  }
  assert.equal(modelCalls, callsBefore, 'a budget refusal never submits to the model')
  assert.equal(messagesRequests.length, requestCountBefore, 'no rejected budget draft reaches Messages')
})

test('a model tool request fails closed, and Stop/retry never duplicates a Project draft', async () => {
  const tenant = `project-draft-stop-${++sequence}`
  const binding = actor(tenant)
  const project = sharedProject(tenant, 'No Side Effects', 'Create a project called Draft Must Not Create')
  const commission = store.createCommission({ role: 'writer', agentId: binding.agentId, projectId: project.projectId }, tenant)
  const sourceRow = source(project.projectId, project.item.id, commission.id, commission.configurationRevision ?? 0)
  const key = `no-tools-${sequence}`
  const id = logicalId(tenant, key)
  const callsBefore = modelCalls
  const requestIndex = messagesRequests.length
  try {
    const started = await call('POST', '/dispatch', draftInput(binding, sourceRow), headers(tenant, key))
    assert.equal(started.status, 200)
    const terminal = await waitForTerminal(id, tenant)
    assert.equal(terminal.execution?.state, 'failed', 'the fixture’s tool-use response is a typed terminal draft failure')
    assert.equal(terminal.status, 'failed')
    assert.equal(modelCalls, callsBefore + 1, 'the unknown tool request does not trigger another model continuation')
    const request = messagesRequests[requestIndex]
    assert.ok(request)
    assert.equal(Object.hasOwn(request, 'tools'), false)
    assert.equal(store.listProjects(tenant).some((row) => row.name === 'Draft Must Not Create'), false, 'no proposed tool effect ran')
    const sessionId = terminal.execution!.sessionId
    const saved = structuredClone(store.getSession(sessionId)?.messages)
    const retry = await callFresh('POST', '/dispatch', draftInput(binding,
      sourceRow), headers(tenant, key))
    assert.equal(retry.status, 200)
    assert.equal(retry.json.execution.state, 'failed')
    assert.equal(modelCalls, callsBefore + 1)
    assert.deepEqual(store.getSession(sessionId)?.messages, saved)

    const stopKey = `stop-${sequence}`
    const stopId = logicalId(tenant, stopKey)
    const stopped = await callFresh('POST', '/dispatch', draftInput(binding,
      source(project.projectId, project.item.id, commission.id, commission.configurationRevision ?? 0)), headers(tenant, stopKey))
    assert.equal(stopped.status, 200)
    const turn = await waitForTurn(stopped.json.execution.sessionId)
    const cancel = await callFresh('POST', `/sessions/${stopped.json.execution.sessionId}/turns/${turn.id}/cancel`, {}, headers(tenant))
    assert.equal(cancel.status, 200)
    const cancelled = await waitForTerminal(stopId, tenant)
    assert.equal(cancelled.execution?.state, 'cancelled')
    const beforeRetry = modelCalls
    const stoppedReplay = await callFresh('POST', '/dispatch', { malformed: true }, headers(tenant, stopKey))
    assert.equal(stoppedReplay.status, 200)
    assert.equal(stoppedReplay.json.execution.state, 'cancelled')
    assert.equal(modelCalls, beforeRetry, 'Stop truth is durable and never retried')
  } finally {
    await cleanup(id, tenant, [binding])
    await cleanup(logicalId(tenant, `stop-${sequence}`), tenant, [])
  }
})

test('inspected HTTP and owner-bound stdio selections produce tool-free argument drafts and survive exact replay', async () => {
  const ownerId = `project-draft-person-${sequence}`
  const peerId = `project-draft-peer-${sequence}`
  assert.ok(accounts.createUser(`Draft Person ${sequence}`, `${ownerId}@example.test`, 'fixture-password', { userId: ownerId, tenantId: `${ownerId}-home` }))
  const organization = accounts.createOrg(ownerId, `Project draft MCP org ${sequence}`)
  assert.ok(organization)
  const tenant = organization.id
  assert.ok(accounts.createUser(`Draft peer ${sequence}`, `${peerId}@example.test`, 'fixture-password', { userId: peerId, tenantId: `${peerId}-home` }))
  const invite = accounts.issueInvite(tenant, `${peerId}@example.test`, `Draft Person ${sequence}`)
  assert.ok(invite.kind === 'represented')
  assert.equal(accounts.resolveInvite(invite.invite.id, peerId, 'accept')?.kind, 'accepted')
  const binding = actor(tenant)
  const project = sharedProject(tenant, 'MCP Draft Project', 'Draft an exact record call', 'mcp.mutate', selectedTool.name)
  const commission = store.createCommission({ role: 'reader', agentId: binding.agentId, projectId: project.projectId }, tenant)
  const sourceRow = source(project.projectId, project.item.id, commission.id, commission.configurationRevision ?? 0)
  const httpConnection = inspectedMcp(tenant, ownerId, 'http')
  const stdioConnection = inspectedMcp(tenant, ownerId, 'stdio')
  assert.ok(store.mcpConnection(httpConnection.selection.connectionId, tenant, ownerId)?.executableTools?.includes(selectedTool.name))
  assert.ok(store.mcpConnection(stdioConnection.selection.connectionId, tenant, ownerId)?.executableTools?.includes(selectedTool.name))
  const callsBefore = modelCalls
  const requestIndex = messagesRequests.length
  const startedRuns: string[] = []
  try {
    const staleKey = `mcp-stale-${sequence}`
    const stale = await call('POST', '/dispatch', draftInput(binding, sourceRow, {
      ...httpConnection.selection, connectionRevision: 0,
    }), headers(tenant, staleKey, ownerId))
    assert.equal(stale.status, 400, 'a stale inspected revision refuses before Dispatch admission')
    assert.equal(store.getRealDispatch(logicalId(tenant, staleKey), tenant), undefined)

    const wrongActorKey = `mcp-wrong-actor-${sequence}`
    const wrongActor = await callFresh('POST', '/dispatch', draftInput(binding, sourceRow, stdioConnection.selection),
      headers(tenant, wrongActorKey, peerId))
    assert.notEqual(wrongActor.status, 200, 'a same-tenant caller cannot borrow a person-owned local connection')
    assert.equal(wrongActor.json.error.code, 'bad_request')
    assert.match(wrongActor.json.error.message, /selected MCP tool is no longer available/)
    assert.equal(store.getRealDispatch(logicalId(tenant, wrongActorKey), tenant), undefined)
    assert.equal(modelCalls, callsBefore, 'a legitimate peer refusal never reaches Messages')

    for (const [label, connection] of [['http', httpConnection], ['stdio', stdioConnection]] as const) {
      const key = `mcp-${label}-${sequence}`
      const id = logicalId(tenant, key)
      startedRuns.push(id)
      const response = await call('POST', '/dispatch', draftInput(binding, sourceRow, connection.selection), headers(tenant, key, ownerId))
      assert.equal(response.status, 200, JSON.stringify(response.json))
      const terminal = await waitForTerminal(id, tenant)
      assert.equal(terminal.execution?.state, 'replied')
      assert.deepEqual(terminal.execution?.mcpProposal?.toolName, selectedTool.name)
      assert.equal(terminal.execution?.mcpProposal?.transport, label === 'stdio' ? 'stdio' : undefined)
      const assistant = store.getSession(terminal.execution!.sessionId)?.messages?.find(message => message.role === 'assistant')
      assert.ok(assistant)
      assert.deepEqual(JSON.parse(assistant.content), { toolName: selectedTool.name, arguments: { query: 'drafted safely' } })
      assert.equal(store.listContributions(project.projectId, tenant).length, 0, 'model arguments create no proposal or effect')
      assert.equal(store.listOpenSubGoals(project.projectId, tenant).find(item => item.id === project.item.id)?.status, 'open')

      const peerFeed = await callFresh('GET', '/dispatch', undefined, headers(tenant, undefined, peerId))
      assert.equal(peerFeed.status, 200)
      const peerRun = peerFeed.json.find((candidate: any) => candidate.id === id)
      assert.ok(peerRun, 'same-tenant peer may read this tenant-private Dispatch')
      assert.equal(peerRun.execution.mcpProposal.toolName, selectedTool.name)
      const peerSession = await callFresh('GET', `/sessions/${terminal.execution!.sessionId}`, undefined, headers(tenant, undefined, peerId))
      assert.equal(peerSession.status, 200, 'same-tenant peer may read the tenant-private result Session')
      assert.match(JSON.stringify(peerSession.json.messages), /drafted safely/)

      const runMessages = structuredClone(store.getSession(terminal.execution!.sessionId)?.messages)
      const beforeReplayCalls = modelCalls
      store.removeMcpConnection(connection.selection.connectionId, tenant, 1, ownerId)
      const replay = await callFresh('POST', '/dispatch', draftInput(binding,
        { ...sourceRow, itemId: 'changed-after-loss', expectedRevision: 999 },
        { ...connection.selection, connectionRevision: 999 }), headers(tenant, key, ownerId))
      assert.equal(replay.status, 200, 'same-key receipt wins over revoked MCP source and changed request')
      assert.equal(replay.json.id, id)
      assert.equal(modelCalls, beforeReplayCalls)
      assert.deepEqual(store.getSession(terminal.execution!.sessionId)?.messages, runMessages)
    }
    const requests = messagesRequests.slice(requestIndex)
    assert.equal(requests.length, 2)
    for (const request of requests) {
      assert.equal(Object.hasOwn(request, 'tools'), false, 'drafting never sends tool declarations to Messages')
      assert.equal(request.messages.length, 1)
      assert.match(request.messages[0].content, /"name":\s*"write_record"/)
      assert.doesNotMatch(request.messages[0].content, /connectionId|bindingHash|MCP_STDIO_|grantReference/)
    }
    assert.equal(modelCalls, callsBefore + 2)
  } finally {
    for (const id of startedRuns) await cleanup(id, tenant, [])
    for (const connection of [httpConnection, stdioConnection]) {
      const row = store.privateMcpConnection(connection.selection.connectionId, tenant, ownerId)
      if (row) store.removeMcpConnection(row.id, tenant, row.revision, ownerId)
    }
    await cleanup('', tenant, [binding])
    accounts.deactivateUser(ownerId)
    accounts.deactivateUser(peerId)
  }
})
