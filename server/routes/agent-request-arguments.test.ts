import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { afterEach, test, type TestContext } from 'node:test'
import { signSession, SESSION_COOKIE } from '../auth.ts'
import { agentCreationId } from '../agentCreationIdentity.ts'
import { MCP_MODERN_VERSION } from '../mcpProtocol.ts'
import { MCP_SCHEMA_ADMISSION_VERSION, mcpToolSchemaHash } from '../mcpToolAdmission.ts'
import { configureMcpRuntime, initializeMcpRuntime } from '../mcpRuntime.ts'
import { store } from '../store/index.ts'
import { call } from '../testkit/http.ts'

const KEY_ENV = 'PROVIDER_AGENT_REQUEST_ARGUMENT_TEST'
const TOOL = { name: 'write_private_note', description: 'Write one note.', inputSchema: {
  type: 'object', properties: { value: { type: 'string' } }, required: ['value'], additionalProperties: false,
} }
let sequence = 0
const next = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${++sequence}`
const headers = (userId: string, tenantId: string) => ({
  cookie: `${SESSION_COOKIE}=${signSession({ userId, tenantId, iat: Date.now() })}`,
  'x-account-transition-source': `session:${userId}`,
})

afterEach(() => {
  configureMcpRuntime({ deviceBearerAvailable: false, allowLoopback: false })
  delete process.env[KEY_ENV]
})

async function localModel(t: TestContext, options: { response?: string; gate?: Promise<void> } = {}) {
  const received: Array<{ path?: string; body: any }> = []
  let releaseRequested!: () => void
  const requested = new Promise<void>(resolve => { releaseRequested = resolve })
  const server = createServer(async (req, res) => {
    const chunks: Buffer[] = []
    for await (const chunk of req) chunks.push(Buffer.from(chunk))
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    received.push({ path: req.url, body })
    releaseRequested()
    if (options.gate) await options.gate
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ id: 'msg-local-draft', type: 'message', role: 'assistant', model: 'local-draft-model',
      stop_reason: 'end_turn', content: [{ type: 'text', text: options.response ?? JSON.stringify({
        toolName: TOOL.name, arguments: { value: 'suggested but not yet approved' },
      }) }], usage: { input_tokens: 137, output_tokens: 29 } }))
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  t.after(async () => {
    server.closeAllConnections()
    await new Promise<void>(resolve => server.close(() => resolve()))
  })
  const address = server.address()
  assert.ok(address && typeof address === 'object')
  return { baseURL: `http://127.0.0.1:${address.port}`, received, requested }
}

async function fixture(t: TestContext, options: { response?: string; gate?: Promise<void> } = {}) {
  const suffix = next('agent-request-arguments')
  const requester = await call('POST', '/auth/signup', { name: 'Requester', email: `${suffix}-requester@test.invalid`, password: `${suffix}-password` })
  const owner = await call('POST', '/auth/signup', { name: 'Owner', email: `${suffix}-owner@test.invalid`, password: `${suffix}-password` })
  assert.equal(requester.status, 200, JSON.stringify(requester.json))
  assert.equal(owner.status, 200, JSON.stringify(owner.json))
  const people = [requester.json, owner.json].map(row => ({ userId: row.user.id as string, tenantId: row.tenant.id as string }))
  const [from, to] = people
  const requesterHeaders = headers(from.userId, from.tenantId), ownerHeaders = headers(to.userId, to.tenantId)
  process.env[KEY_ENV] = 'local-test-only'
  const model = await localModel(t, options)

  const methods: string[] = []
  const mcp = createServer(async (req, res) => {
    const chunks: Buffer[] = []
    for await (const chunk of req) chunks.push(Buffer.from(chunk))
    const rpc = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    methods.push(rpc.method)
    const result = rpc.method === 'server/discover' ? { resultType: 'complete', supportedVersions: [MCP_MODERN_VERSION], capabilities: { tools: {} },
      _meta: { 'io.modelcontextprotocol/serverInfo': { name: 'Agent request argument fixture', version: '1' } } } :
      rpc.method === 'tools/list' ? { resultType: 'complete', tools: [TOOL] } :
      { resultType: 'complete', content: [], isError: false }
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ jsonrpc: '2.0', id: rpc.id, result }))
  })
  mcp.listen(0, '127.0.0.1')
  await once(mcp, 'listening')
  t.after(async () => {
    mcp.closeAllConnections()
    await new Promise<void>(resolve => mcp.close(() => resolve()))
  })
  const address = mcp.address()
  assert.ok(address && typeof address === 'object')
  configureMcpRuntime({ deviceBearerAvailable: false, allowLoopback: true })
  await initializeMcpRuntime([])

  const connectionId = `mcp-connection-${(++sequence).toString(16).padStart(32, '0')}`
  store.createMcpConnection({ id: connectionId, label: 'Private note server', endpoint: `http://127.0.0.1:${address.port}/mcp`, authentication: 'none' }, to.tenantId, true, to.userId)
  store.commitMcpInspection(connectionId, to.tenantId, 0, { protocolVersion: MCP_MODERN_VERSION, cleanup: 'not-needed', tools: [TOOL],
    schemaAdmission: { version: MCP_SCHEMA_ADMISSION_VERSION, hashes: [mcpToolSchemaHash(TOOL)] } }, Date.now(), undefined, undefined, to.userId)
  const provider = store.createProvider({ label: `Local argument model ${suffix}`, modelFamily: 'claude', effortLevels: ['Low'],
    models: [{ id: 'local-draft-model', label: 'Local draft model' }] }, {
    baseURL: model.baseURL, apiKeyEnv: KEY_ENV, model: 'local-draft-model', capabilities: { toolUse: true },
  }, to.tenantId)
  const fromAgentId = agentCreationId(from.tenantId, next('from-agent'))
  const toAgentId = agentCreationId(to.tenantId, next('to-agent'))
  store.createAgent({ label: 'Requesting Agent', systemPrompt: 'requester fixture', instructions: '', tools: [] }, from.tenantId,
    { logicalId: fromAgentId, ownerUserId: from.userId })
  store.createAgent({ label: 'Receiving Agent', systemPrompt: 'Only write the requested private note.', instructions: 'Use the supplied note value.', tools: [],
    published: true, providerId: provider.id, authority: { connectors: [connectionId] } }, to.tenantId,
  { logicalId: toAgentId, ownerUserId: to.userId })
  const created = await call('POST', '/agent-requests', { fromAgentId, toAgentId, task: 'Write a note with the requested value.' },
    { ...requesterHeaders, 'idempotency-key': next('request') })
  assert.equal(created.status, 200, JSON.stringify(created.json))
  const id = created.json.id as string
  const path = `/agent-requests/${id}`
  const review = () => call('GET', `${path}/review`, undefined, ownerHeaders)
  const decide = (body: unknown) => call('POST', `${path}/decision`, body, ownerHeaders)
  const ownerRead = () => call('GET', path, undefined, ownerHeaders)
  const requesterRead = () => call('GET', path, undefined, requesterHeaders)
  const bindingFor = (snapshot: any) => ({ agentRevision: snapshot.draftModel.agentRevision,
    providerId: snapshot.draftModel.providerId, providerRevision: snapshot.draftModel.providerRevision,
    providerConnectionRevision: snapshot.draftModel.providerConnectionRevision, model: snapshot.draftModel.model, connectionId,
    connectionRevision: snapshot.tools[0].connectionRevision, toolName: TOOL.name,
    schemaHash: snapshot.tools[0].schemaHash, transport: 'http' })
  return { from, to, requesterHeaders, ownerHeaders, model, methods, connectionId, id, path, review, decide, ownerRead, requesterRead, bindingFor }
}

async function settled(read: () => Promise<{ status: number; json: any }>, status: string) {
  for (let attempt = 0; attempt < 200; attempt++) {
    const response = await read()
    assert.equal(response.status, 200, JSON.stringify(response.json))
    if (response.json.argumentDraft?.status === status || response.json.status === status) return response.json
    await new Promise(resolve => setTimeout(resolve, 10))
  }
  assert.fail(`Agent request did not settle as ${status}`)
}
async function settledDraft(read: () => Promise<{ status: number; json: any }>, statuses: string[]) {
  for (let attempt = 0; attempt < 200; attempt++) {
    const response = await read()
    assert.equal(response.status, 200, JSON.stringify(response.json))
    if (statuses.includes(response.json.argumentDraft?.status)) return response.json
    await new Promise(resolve => setTimeout(resolve, 10))
  }
  assert.fail(`Agent request draft did not settle as ${statuses.join(' or ')}`)
}

test('owner explicitly requests one private tool-free argument draft; only Use/Run can apply its suggestion', async t => {
  const f = await fixture(t)
  const review = await f.review()
  assert.equal(review.status, 200, JSON.stringify(review.json))
  assert.equal(review.json.draftModel?.model, 'local-draft-model')
  assert.equal(review.json.tools.length, 1)
  const binding = f.bindingFor(review.json)
  const acknowledged = await f.decide({ action: 'draft-arguments', expectedRevision: review.json.request.revision, binding })
  assert.equal(acknowledged.status, 200, JSON.stringify(acknowledged.json))
  assert.equal(acknowledged.json.argumentDraft.status, 'pending')
  assert.equal(acknowledged.json.revision, review.json.request.revision + 1)
  const requester = await f.requesterRead()
  assert.equal(JSON.stringify(requester.json).includes('argumentDraft'), false)
  assert.equal((await call('GET', '/agent-requests', undefined, f.ownerHeaders)).json.some((row: any) => JSON.stringify(row).includes('argumentDraft')), false)

  const completed = await settled(f.ownerRead, 'done')
  assert.deepEqual(completed.argumentDraft.arguments, { value: 'suggested but not yet approved' })
  assert.equal(completed.revision, acknowledged.json.revision + 1)
  assert.equal(f.model.received.length, 1, 'one explicit draft action makes one model request')
  assert.equal(f.model.received[0].path, '/v1/messages')
  assert.equal('tools' in f.model.received[0].body, false, 'the model receives no executable tool interface')
  const modelInput = `${f.model.received[0].body.system}\n${JSON.stringify(f.model.received[0].body.messages)}`
  for (const included of ['Write a note with the requested value.', 'Only write the requested private note.', 'Use the supplied note value.', TOOL.name, 'inputSchema']) assert.ok(modelInput.includes(included))
  for (const excluded of [f.from.userId, f.to.userId, f.id, f.model.baseURL, 'local-test-only']) assert.equal(modelInput.includes(excluded), false)
  assert.deepEqual(f.methods, [], 'drafting never discovers or executes an MCP tool')

  const retried = await f.decide({ action: 'draft-arguments', expectedRevision: acknowledged.json.revision, binding })
  assert.equal(retried.status, 409, 'a completed draft cannot be requested a second time')
  assert.equal(f.model.received.length, 1)
  const run = await f.decide({ action: 'run', expectedRevision: completed.revision,
    approval: { transport: 'http', call: { connectionId: f.connectionId, connectionRevision: binding.connectionRevision,
      toolName: TOOL.name, schemaHash: binding.schemaHash, arguments: { value: 'human-edited final value' } } } })
  assert.equal(run.status, 200, JSON.stringify(run.json))
  const executed = await settled(f.ownerRead, 'awaiting-reply')
  assert.deepEqual(executed.execution.approval.call.arguments, { value: 'human-edited final value' })
  assert.equal(executed.execution.status, 'done')
  assert.deepEqual(f.methods, ['server/discover', 'tools/call'])
})

test('stale draft binding refuses before the configured model endpoint is contacted', async t => {
  const f = await fixture(t)
  const review = await f.review()
  const binding = f.bindingFor(review.json)
  const stale = await f.decide({ action: 'draft-arguments', expectedRevision: 1,
    binding: { ...binding, providerConnectionRevision: binding.providerConnectionRevision + 1 } })
  assert.equal(stale.status, 404, JSON.stringify(stale.json))
  assert.equal(f.model.received.length, 0)
  assert.equal((await f.ownerRead()).json.argumentDraft, undefined)
  assert.deepEqual(f.methods, [])
})

test('pending model response blocks Run, remains one-shot, and cancellation never creates a tool effect', async t => {
  let release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  const f = await fixture(t, { gate })
  const review = await f.review(), binding = f.bindingFor(review.json)
  const ack = await f.decide({ action: 'draft-arguments', expectedRevision: 1, binding })
  assert.equal(ack.status, 200, JSON.stringify(ack.json))
  await f.model.requested
  const run = await f.decide({ action: 'run', expectedRevision: ack.json.revision,
    approval: { transport: 'http', call: { connectionId: f.connectionId, connectionRevision: binding.connectionRevision,
      toolName: TOOL.name, schemaHash: binding.schemaHash, arguments: { value: 'must not run' } } } })
  assert.equal(run.status, 409, 'Run is refused with a conflict while the one-shot draft is pending')
  assert.equal((await f.ownerRead()).json.argumentDraft.status, 'pending')
  assert.equal((await f.decide({ action: 'draft-arguments', expectedRevision: ack.json.revision, binding })).status, 409)
  const cancel = await f.decide({ action: 'cancel', expectedRevision: ack.json.revision })
  assert.equal(cancel.status, 200, JSON.stringify(cancel.json))
  release()
  const owner = await settledDraft(f.ownerRead, ['failed', 'uncertain'])
  assert.equal(owner.status, 'cancelled')
  assert.equal(f.model.received.length, 1)
  assert.deepEqual(f.methods, [])
})

test('schema-invalid model output settles failed with accounted usage and requester never sees the draft', async t => {
  const f = await fixture(t, { response: JSON.stringify({ toolName: TOOL.name, arguments: { wrong: true } }) })
  const review = await f.review(), binding = f.bindingFor(review.json)
  const ack = await f.decide({ action: 'draft-arguments', expectedRevision: 1, binding })
  assert.equal(ack.status, 200, JSON.stringify(ack.json))
  const failed = await settled(f.ownerRead, 'failed')
  assert.equal(failed.argumentDraft.arguments, undefined)
  assert.equal(failed.revision, ack.json.revision + 1)
  assert.equal(JSON.stringify((await f.requesterRead()).json).includes('argumentDraft'), false)
  assert.equal(f.model.received.length, 1)
  assert.deepEqual(f.methods, [])
})
