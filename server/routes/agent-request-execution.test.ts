import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { afterEach, test, type TestContext } from 'node:test'
import { accounts } from '../accounts.ts'
import { signSession } from '../auth.ts'
import { agentCreationId } from '../agentCreationIdentity.ts'
import { DEFAULT_PROVIDER } from '../data/providers.ts'
import { MCP_MODERN_VERSION } from '../mcpProtocol.ts'
import { MCP_SCHEMA_ADMISSION_VERSION, mcpToolSchemaHash } from '../mcpToolAdmission.ts'
import { configureMcpRuntime, initializeMcpRuntime } from '../mcpRuntime.ts'
import { store } from '../store/index.ts'
import { call } from '../testkit/http.ts'

let sequence = 0
const next = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${++sequence}`
const tool = { name: 'write_private_note', inputSchema: {
  type: 'object', properties: { value: { type: 'string' } }, required: ['value'], additionalProperties: false,
} }
const secretResult = 'PRIVATE_TOOL_RESULT_47f1'

afterEach(() => configureMcpRuntime({ deviceBearerAvailable: false, allowLoopback: false }))

async function account(label: string) {
  const suffix = next('agent-request-execution')
  const response = await call('POST', '/auth/signup', { name: label, email: `${suffix}@agent-request.test`, password: `${suffix}-password` })
  assert.equal(response.status, 200, JSON.stringify(response.json))
  return { userId: response.json.user.id as string, tenantId: response.json.tenant.id as string,
    cookie: response.headers['set-cookie']?.split(';')[0] ?? '' }
}

function scopedHeaders(userId: string, tenantId: string) {
  return { cookie: `uw_session=${signSession({ userId, tenantId, iat: Date.now() })}`,
    'x-account-transition-source': `session:${userId}` }
}

async function peer(t: TestContext, options: { gate?: Promise<void>; afterDiscovery?: () => void } = {}) {
  const methods: string[] = []
  let toolsCalls = 0
  let onToolsCall!: () => void
  const toolsCallArrived = new Promise<void>(resolve => { onToolsCall = resolve })
  let socketClosed!: () => void
  const disconnected = new Promise<void>(resolve => { socketClosed = resolve })
  const server = createServer(async (req, res) => {
    const chunks: Buffer[] = []
    for await (const chunk of req) chunks.push(Buffer.from(chunk))
    const request = JSON.parse(Buffer.concat(chunks).toString('utf8')) as any
    methods.push(request.method)
    if (request.method === 'server/discover') {
      options.afterDiscovery?.()
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ jsonrpc: '2.0', id: request.id, result: {
        resultType: 'complete', supportedVersions: [MCP_MODERN_VERSION], capabilities: { tools: {} },
        _meta: { 'io.modelcontextprotocol/serverInfo': { name: 'Agent request fixture', version: '1' } },
      } }))
      return
    }
    assert.equal(request.method, 'tools/call')
    toolsCalls++
    onToolsCall()
    if (options.gate) {
      req.socket.once('close', socketClosed)
      await options.gate
    }
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ jsonrpc: '2.0', id: request.id, result: {
      resultType: 'complete', content: [{ type: 'text', text: secretResult }], isError: false,
    } }))
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  t.after(async () => {
    server.closeAllConnections()
    await new Promise<void>(resolve => server.close(() => resolve()))
  })
  const address = server.address()
  assert.ok(address && typeof address === 'object')
  return { endpoint: `http://127.0.0.1:${address.port}/mcp`, methods, toolsCalls: () => toolsCalls, toolsCallArrived, disconnected }
}

async function fixture(t: TestContext, options: { gate?: Promise<void>; afterDiscovery?: () => void } = {}) {
  const requester = await account('Requesting Agent owner')
  const owner = await account('Receiving Agent owner')
  const http = await peer(t, options)
  configureMcpRuntime({ deviceBearerAvailable: false, allowLoopback: true })
  await initializeMcpRuntime([])

  const connectionId = `mcp-connection-${(++sequence).toString(16).padStart(32, '0')}`
  store.createMcpConnection({ id: connectionId, label: 'Private note server', endpoint: http.endpoint, authentication: 'none' },
    owner.tenantId, true, owner.userId)
  store.commitMcpInspection(connectionId, owner.tenantId, 0, {
    protocolVersion: MCP_MODERN_VERSION, cleanup: 'not-needed', tools: [tool],
    schemaAdmission: { version: MCP_SCHEMA_ADMISSION_VERSION, hashes: [mcpToolSchemaHash(tool)] },
  }, Date.now(), undefined, undefined, owner.userId)

  const requesterAgentId = agentCreationId(requester.tenantId, next('requester-agent'))
  const ownerAgentId = agentCreationId(owner.tenantId, next('owner-agent'))
  store.createAgent({ label: 'Requesting Agent', systemPrompt: 'Fixture.', tools: [], instructions: '' }, requester.tenantId,
    { logicalId: requesterAgentId, ownerUserId: requester.userId })
  store.createAgent({ label: 'Receiving Agent', systemPrompt: 'Fixture.', tools: [], instructions: '', published: true,
    providerId: DEFAULT_PROVIDER.id, authority: { connectors: [connectionId] } }, owner.tenantId,
    { logicalId: ownerAgentId, ownerUserId: owner.userId })
  const requesterHeaders = scopedHeaders(requester.userId, requester.tenantId)
  const ownerHeaders = scopedHeaders(owner.userId, owner.tenantId)
  const created = await call('POST', '/agent-requests', {
    fromAgentId: requesterAgentId, toAgentId: ownerAgentId, task: 'Write the reviewed private note.' },
    { ...requesterHeaders, 'idempotency-key': next('request') })
  assert.equal(created.status, 200, JSON.stringify(created.json))
  const id = created.json.id as string
  const review = () => call('GET', `/agent-requests/${id}/review`, undefined, ownerHeaders)
  const approval = (snapshot: any, overrides: Record<string, unknown> = {}) => ({
    transport: 'http', call: {
      connectionId, connectionRevision: snapshot.tools[0].connectionRevision, toolName: tool.name,
      schemaHash: snapshot.tools[0].schemaHash, arguments: { value: 'one exact human reviewed value' },
      ...overrides,
    },
  })
  const decide = (body: unknown) => call('POST', `/agent-requests/${id}/decision`, body, ownerHeaders)
  const getOwner = () => call('GET', `/agent-requests/${id}`, undefined, ownerHeaders)
  const getRequester = () => call('GET', `/agent-requests/${id}`, undefined, requesterHeaders)
  return { requester, owner, requesterHeaders, ownerHeaders, http, connectionId, requesterAgentId, ownerAgentId,
    id, review, approval, decide, getOwner, getRequester }
}

async function settled(get: () => Promise<{ status: number; json: any }>, predicate: (value: any) => boolean) {
  for (let attempt = 0; attempt < 200; attempt++) {
    const response = await get()
    assert.equal(response.status, 200)
    if (predicate(response.json)) return response.json
    await new Promise(resolve => setTimeout(resolve, 10))
  }
  assert.fail('Agent request did not settle within the bounded poll window')
}

test('an imported unbound Agent cannot borrow default-provider connection authority', async t => {
  const f = await fixture(t)
  const imported = store.importAgentFromCard({ name: 'Unbound imported Agent' }, 'https://agent.example.test/card',
    f.owner.tenantId, { logicalId: agentCreationId(f.owner.tenantId, next('imported')), ownerUserId: f.owner.userId })
  assert.equal(imported.providerId, undefined)
  assert.equal(imported.authority, undefined)
  store.updateAgentFromRequest(imported.id, { published: true }, imported.revision)
  const created = await call('POST', '/agent-requests', {
    fromAgentId: f.requesterAgentId, toAgentId: imported.id, task: 'Wait for explicit local provider binding.',
  }, { ...f.requesterHeaders, 'idempotency-key': next('unbound-request') })
  assert.equal(created.status, 200, JSON.stringify(created.json))
  const path = `/agent-requests/${created.json.id}`
  const reviewed = await call('GET', `${path}/review`, undefined, f.ownerHeaders)
  assert.equal(reviewed.status, 200)
  assert.deepEqual(reviewed.json.tools, [], 'an imported definition grants no default-provider tool reach')
  assert.match(reviewed.json.blockedReason, /Bind a model provider/)
  const boundReview = await f.review()
  assert.equal(boundReview.json.tools.length, 1, 'the same person already has an inspected usable private connection')
  const refused = await call('POST', `${path}/decision`, {
    action: 'run', expectedRevision: 1, approval: f.approval(boundReview.json),
  }, f.ownerHeaders)
  assert.equal(refused.status, 404, 'a forged Run cannot bypass the missing binding')
  assert.equal((await call('GET', path, undefined, f.ownerHeaders)).json.status, 'waiting')
  assert.deepEqual(f.http.methods, [], 'refusal precedes even discovery')

  store.updateAgentFromRequest(imported.id, { providerId: DEFAULT_PROVIDER.id,
    authority: { connectors: [f.connectionId] } }, 1)
  const rebound = await call('GET', `${path}/review`, undefined, f.ownerHeaders)
  assert.equal(rebound.status, 200)
  assert.deepEqual(rebound.json.tools.map((row: any) => row.connectionId), [f.connectionId])
  assert.equal(rebound.json.blockedReason, null)
  assert.equal((await call('POST', `${path}/decision`, {
    action: 'run', expectedRevision: 1, approval: f.approval(rebound.json),
  }, f.ownerHeaders)).status, 200)
  const complete = await settled(() => call('GET', path, undefined, f.ownerHeaders), row => row.status === 'awaiting-reply')
  assert.equal(complete.execution.status, 'done')
  assert.equal(f.http.toolsCalls(), 1)
})

test('review is owner-only; one explicit run stores the result privately until the owner shares reviewed prose', async t => {
  const f = await fixture(t)
  const reviewed = await f.review()
  assert.equal(reviewed.status, 200, JSON.stringify(reviewed.json))
  assert.equal(reviewed.headers['cache-control'], 'no-store')
  assert.deepEqual(reviewed.json.tools.map((row: any) => row.tool.name), [tool.name])
  assert.equal(reviewed.json.blockedReason, null)
  assert.equal((await call('GET', `/agent-requests/${f.id}/review`, undefined, f.requesterHeaders)).status, 404)
  assert.equal((await call('GET', `/agent-requests/${f.id}/review`, undefined, {})).status, 404)

  const ack = await f.decide({ action: 'run', expectedRevision: reviewed.json.request.revision,
    approval: f.approval(reviewed.json) })
  assert.equal(ack.status, 200, JSON.stringify(ack.json))
  assert.equal(ack.json.status, 'running', 'the route acknowledges only its durable pending receipt')
  const ownerPending = await f.getOwner()
  assert.equal(ownerPending.json.execution.status, 'pending')
  const complete = await settled(f.getOwner, (row: any) => row.status === 'awaiting-reply')
  assert.equal(complete.execution.status, 'done')
  assert.equal(complete.execution.result.content[0].text, secretResult)
  const requesterBeforeShare = await f.getRequester()
  assert.equal(requesterBeforeShare.json.execution, undefined)
  assert.equal(requesterBeforeShare.json.reply, undefined)
  assert.equal(JSON.stringify(requesterBeforeShare.json).includes(secretResult), false)
  assert.deepEqual(f.http.methods, ['server/discover', 'tools/call'])

  const share = await f.decide({ action: 'share', expectedRevision: complete.revision, reply: 'The owner reviewed and approved this short summary.' })
  assert.equal(share.status, 200)
  assert.equal(share.json.status, 'replied')
  const requesterAfterShare = await f.getRequester()
  assert.equal(requesterAfterShare.json.reply, 'The owner reviewed and approved this short summary.')
  assert.equal(requesterAfterShare.json.execution, undefined)
  assert.equal(JSON.stringify(requesterAfterShare.json).includes(secretResult), false)
  for (const headers of [f.ownerHeaders, f.requesterHeaders]) {
    const history = await call('GET', '/agent-requests', undefined, headers)
    assert.equal(history.status, 200)
    const summary = history.json.find((row: { id: string }) => row.id === f.id)
    assert.ok(summary)
    assert.equal(summary.execution, undefined, 'navigation does not fetch private receipts')
    assert.equal(summary.reply, undefined, 'large reply text is fetched only on the addressed detail')
    assert.equal(summary.status, 'replied')
  }
  assert.deepEqual((await f.review()).json.tools, [], 'terminal requests expose no executable choices')
})

test('maximum escaped task and reply cross the HTTP boundary without shrinking the prose limit', async t => {
  const f = await fixture(t)
  const task = '\\'.repeat(8_192)
  const created = await call('POST', '/agent-requests', {
    fromAgentId: f.requesterAgentId, toAgentId: f.ownerAgentId, task,
  }, { ...f.requesterHeaders, 'idempotency-key': next('escaped-task') })
  assert.equal(created.status, 200, JSON.stringify(created.json))
  assert.equal(created.json.task, task)
  const review = await f.review()
  assert.equal((await f.decide({ action: 'run', expectedRevision: 1, approval: f.approval(review.json) })).status, 200)
  const completed = await settled(f.getOwner, row => row.status === 'awaiting-reply')
  const reply = '\\'.repeat(65_536)
  const shared = await f.decide({ action: 'share', expectedRevision: completed.revision, reply })
  assert.equal(shared.status, 200, JSON.stringify(shared.json))
  assert.equal((await f.getRequester()).json.reply, reply)
})

test('stale connection intent and missing local-program consent refuse before any tool effect', async t => {
  const f = await fixture(t)
  const reviewed = await f.review()
  const stale = await f.decide({ action: 'run', expectedRevision: 1,
    approval: f.approval(reviewed.json, { connectionRevision: reviewed.json.tools[0].connectionRevision + 1 }) })
  assert.equal(stale.status, 404)
  assert.equal((await f.getOwner()).json.status, 'waiting')
  assert.equal(f.http.toolsCalls(), 0)

  const localId = `mcp-connection-${(++sequence).toString(16).padStart(32, '0')}`
  store.createMcpConnection({ transport: 'stdio', id: localId, label: 'Local note server' }, f.owner.tenantId, false, f.owner.userId)
  store.commitMcpInspection(localId, f.owner.tenantId, 0, {
    protocolVersion: MCP_MODERN_VERSION, cleanup: 'not-needed', tools: [tool],
    schemaAdmission: { version: MCP_SCHEMA_ADMISSION_VERSION, hashes: [mcpToolSchemaHash(tool)] },
  }, Date.now(), undefined, undefined, f.owner.userId, `MCP_STDIO_${(++sequence).toString(16).toUpperCase().padStart(32, '0')}`)
  // No native supervisor is installed for this fixture. Even a valid saved
  // stdio connection cannot appear as runnable without deployment capability.
  const noLocalRuntime = await f.review()
  assert.deepEqual(noLocalRuntime.json.tools.map((row: any) => row.connectionId), [f.connectionId])
  assert.equal(noLocalRuntime.json.tools.some((row: any) => row.connectionId === localId), false)
  const refusedLocal = await f.decide({ action: 'run', expectedRevision: 1, approval: {
    transport: 'stdio', call: { connectionId: localId, connectionRevision: 1, toolName: tool.name,
      schemaHash: mcpToolSchemaHash(tool), arguments: { value: 'do not launch' } },
  } })
  assert.equal(refusedLocal.status, 400, 'localPrograms:true is required before a local-program request can be admitted')
  assert.equal(f.http.toolsCalls(), 0)
})

test('permission revoked during MCP discovery prevents tools/call from being sent', async t => {
  let f: Awaited<ReturnType<typeof fixture>>
  f = await fixture(t, { afterDiscovery: () => { store.disconnectMcpConnection(f.connectionId, f.owner.tenantId, 1, f.owner.userId) } })
  const reviewed = await f.review()
  assert.equal(reviewed.json.tools.length, 1)
  const ack = await f.decide({ action: 'run', expectedRevision: 1, approval: f.approval(reviewed.json) })
  assert.equal(ack.status, 200)
  const result = await settled(f.getOwner, (row: any) => row.status === 'awaiting-reply')
  assert.equal(result.execution.status, 'failed')
  assert.deepEqual(f.http.methods, ['server/discover'])
  assert.equal(f.http.toolsCalls(), 0)
})

test('cancellation and a lost run acknowledgement cannot dispatch the same call again', { timeout: 10_000 }, async t => {
  let release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  const f = await fixture(t, { gate })
  try {
    const reviewed = await f.review()
    const body = { action: 'run', expectedRevision: 1, approval: f.approval(reviewed.json) }
    const ack = await f.decide(body)
    assert.equal(ack.status, 200)
    const started = await settled(f.getOwner, (row: any) => row.status === 'running')
    assert.equal(started.execution.status, 'pending')
    await f.http.toolsCallArrived
    assert.equal(f.http.toolsCalls(), 1)

    const cancelled = await f.decide({ action: 'cancel', expectedRevision: started.revision })
    assert.equal(cancelled.status, 200)
    assert.equal(cancelled.json.status, 'cancelled')
    const lostAckRetry = await f.decide(body)
    assert.equal(lostAckRetry.status, 409)
    await f.http.disconnected
    release()
    const terminal = await settled(f.getOwner, (row: any) => row.status === 'cancelled' && row.execution?.status !== 'pending')
    assert.equal(terminal.status, 'cancelled')
    assert.equal(f.http.toolsCalls(), 1)
    assert.deepEqual(f.http.methods, ['server/discover', 'tools/call'])
  } finally { release() }
})
