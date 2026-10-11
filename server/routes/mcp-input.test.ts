/** Person-owned modern MCP form consent: real route table, authenticated org
 * members, and one test-owned local HTTP peer. */
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { once } from 'node:events'
import { EventEmitter } from 'node:events'
import https from 'node:https'
import { syncBuiltinESMExports } from 'node:module'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { PassThrough } from 'node:stream'
import { after, before, test } from 'node:test'
import type { ToolActivity } from '../../contract/index.ts'
import { signSession } from '../auth.ts'
import { accounts } from '../accounts.ts'
import { configureMcpRuntime, initializeMcpRuntime, mcpRuntimeConfiguration } from '../mcpRuntime.ts'
import { MCP_MODERN_VERSION } from '../mcpProtocol.ts'
import { MCP_SCHEMA_ADMISSION_VERSION, mcpToolSchemaHash } from '../mcpToolAdmission.ts'
let store: typeof import('../store/index.ts').store
let call: typeof import('../testkit/http.ts').call
let callFresh: typeof import('../testkit/http.ts').callFresh
let originalHttpsRequest: typeof https.request
let mockHttpsResponse: (request: Record<string, any>) => unknown = request => ({
  resultType: 'complete', content: [{ type: 'text', text: 'done' }], isError: false,
})
const httpsRequests: Array<{ method: string; params: Record<string, any> }> = []
let httpsToolCalls = 0
import { toolActivityDecisionId } from '../toolActivityDecisionIdentity.ts'

let sequence = 0
const tool = { name: 'submit.application', inputSchema: {
  type: 'object', properties: { query: { type: 'string' } }, required: ['query'], additionalProperties: false,
} }
const oauthEndpoint = 'https://8.8.8.8/private-form-mcp'
const schemaHash = mcpToolSchemaHash(tool)
const firstForm = {
  resultType: 'input_required',
  inputRequests: { application: { method: 'elicitation/create', params: {
    mode: 'form', message: 'Which application should be submitted?',
    requestedSchema: { type: 'object', properties: { choice: { type: 'string', enum: ['one', 'two'] } }, required: ['choice'] },
  } } },
  requestState: 'opaque-private-state-1',
}
const secondForm = {
  resultType: 'input_required',
  inputRequests: { confirmation: { method: 'elicitation/create', params: {
    mode: 'form', message: 'Confirm the application reference.',
    requestedSchema: { type: 'object', properties: { reference: { type: 'string', minLength: 3 } }, required: ['reference'] },
  } } },
  requestState: 'opaque-private-state-2',
}

before(async () => {
  originalHttpsRequest = https.request
  https.request = ((url: URL, _options: unknown, callback: (response: any) => void) => {
    const request = new EventEmitter() as EventEmitter & { end: (body?: Uint8Array) => void; destroy: () => void }
    request.destroy = () => request
    request.end = (encoded?: Uint8Array) => {
      void (async () => {
        assert.equal(url.hostname, new URL(oauthEndpoint).hostname)
        const message = JSON.parse(Buffer.from(encoded ?? []).toString('utf8'))
        httpsRequests.push({ method: message.method, params: message.params ?? {} })
        let result: unknown
        if (message.method === 'server/discover') {
          result = { resultType: 'complete', supportedVersions: [MCP_MODERN_VERSION], capabilities: { tools: {} } }
        } else {
          assert.equal(message.method, 'tools/call')
          httpsToolCalls += 1
          result = mockHttpsResponse(message)
        }
        const response = new PassThrough() as PassThrough & { statusCode: number; headers: Record<string, string>; complete: boolean }
        response.statusCode = 200
        response.headers = { 'content-type': 'application/json' }
        response.complete = true
        callback(response)
        response.end(JSON.stringify({ jsonrpc: '2.0', id: message.id, result }))
      })().catch(error => request.emit('error', error))
    }
    return request
  }) as typeof https.request
  syncBuiltinESMExports()
  const [storeModule, httpModule] = await Promise.all([import('../store/index.ts'), import('../testkit/http.ts')])
  store = storeModule.store
  call = httpModule.call
  callFresh = httpModule.callFresh
})
after(() => {
  https.request = originalHttpsRequest
  syncBuiltinESMExports()
})

async function requestBody(req: IncomingMessage): Promise<Record<string, any>> {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(chunk as Buffer)
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}
function send(res: ServerResponse, value: unknown): void {
  res.writeHead(200, { 'content-type': 'application/json' })
  res.end(JSON.stringify(value))
}
const cookieOf = (response: { headers: Record<string, string> }) => response.headers['set-cookie']?.split(';')[0] ?? ''

async function account(label: string) {
  const tag = `${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${++sequence}`
  const email = `${tag}@mcp-input.example`
  const response = await call('POST', '/auth/signup', { name: label, email, password: `${tag}-password` })
  assert.equal(response.status, 200, JSON.stringify(response.json))
  return { userId: response.json.user.id as string, email, cookie: cookieOf(response) }
}
function headers(userId: string, tenantId: string) {
  return { cookie: `uw_session=${signSession({ userId, tenantId, iat: Date.now() })}`,
    'x-account-transition-source': `session:${userId}` }
}
async function sharedTenant() {
  const owner = await account('MCP Form Owner')
  const peer = await account('MCP Form Peer')
  const org = await call('POST', '/orgs', { name: `MCP form ${sequence}` }, { cookie: owner.cookie })
  assert.equal(org.status, 201, JSON.stringify(org.json))
  const invite = await call('POST', `/orgs/${org.json.id}/invites`, { email: peer.email }, { cookie: owner.cookie })
  assert.equal(invite.status, 201, JSON.stringify(invite.json))
  assert.equal((await call('POST', `/me/invites/${invite.json.id}/accept`, undefined, { cookie: peer.cookie })).status, 200)
  assert.ok(accounts.identityFor(owner.userId, org.json.id))
  assert.ok(accounts.identityFor(peer.userId, org.json.id))
  return { owner, peer, tenantId: org.json.id,
    ownerHeaders: headers(owner.userId, org.json.id), peerHeaders: headers(peer.userId, org.json.id) }
}

test('authenticated person privately reviews, responds once, recovers exact receipts, and can stop locally', async (t) => {
  const previousRuntime = mcpRuntimeConfiguration()
  configureMcpRuntime({ deviceBearerAvailable: false, allowLoopback: true })
  t.after(() => configureMcpRuntime({ ...previousRuntime }))
  const requests: Array<{ method: string; params: Record<string, any> }> = []
  let toolCalls = 0
  const peerServer = createServer(async (req, res) => {
    const body = await requestBody(req)
    requests.push({ method: body.method, params: body.params ?? {} })
    if (body.method === 'server/discover') return send(res, { jsonrpc: '2.0', id: body.id, result: {
      resultType: 'complete', supportedVersions: [MCP_MODERN_VERSION], capabilities: { tools: {} },
    } })
    assert.equal(body.method, 'tools/call')
    toolCalls += 1
    const result = toolCalls === 1 ? firstForm : toolCalls === 2 ? secondForm : {
      resultType: 'complete', content: [{ type: 'text', text: 'submitted privately' }], isError: false,
    }
    return send(res, { jsonrpc: '2.0', id: body.id, result })
  })
  peerServer.listen(0, '127.0.0.1')
  await once(peerServer, 'listening')
  t.after(async () => { peerServer.closeAllConnections(); await new Promise<void>(resolve => peerServer.close(() => resolve())) })
  const address = peerServer.address()
  assert.ok(address && typeof address === 'object')

  const { owner, peer, tenantId, ownerHeaders, peerHeaders } = await sharedTenant()
  const connectionId = `mcp-connection-${(++sequence).toString(16).padStart(32, '0')}`
  store.createMcpConnection({ id: connectionId, label: 'Private form peer', endpoint: `http://127.0.0.1:${address.port}/mcp`,
    authentication: 'none' }, tenantId, true, owner.userId)
  store.commitMcpInspection(connectionId, tenantId, 0, { protocolVersion: MCP_MODERN_VERSION,
    cleanup: 'not-needed', tools: [tool], schemaAdmission: { version: MCP_SCHEMA_ADMISSION_VERSION, hashes: [schemaHash] },
  }, Date.now(), undefined, undefined, owner.userId)

  const session = store.createSession('Private MCP form review', tenantId)
  assert.equal((await call('PATCH', `/sessions/${session.id}/context-state`, {
    operations: [{ action: 'attach', context: { id: connectionId, type: 'mcp', label: 'Private form peer', scope: '*' } }],
    workspace: { workspaces: [], repos: [], connectors: [], attachments: [] },
  }, ownerHeaders)).status, 200)
  const activityId = `mcp-input-${sequence}`
  const activity: ToolActivity = { id: activityId, tool: 'mcp__form__submit', connector: 'Private form peer', connectorId: connectionId,
    kind: 'action', status: 'proposed', summary: 'Submit the reviewed application', input: { query: 'application' },
    mcp: { connectionRevision: 1, toolName: tool.name, schemaHash },
  }
  assert.ok(store.appendMessage(session.id, { id: store.mintMessageId('assistant'), role: 'assistant',
    content: 'Review this application submission.', toolActivities: [activity] }, { actorUserId: owner.userId }))

  const emitted: unknown[] = []
  const unsubscribe = store.subscribe(event => emitted.push(event))
  t.after(unsubscribe)
  const activityPath = `/sessions/${session.id}/tool-activities/${activityId}`
  const decisionKey = `mcp-input-decision-${sequence}`
  const confirmed = await call('POST', activityPath, { decision: 'confirm' }, { ...ownerHeaders, 'idempotency-key': decisionKey })
  assert.equal(confirmed.status, 200, JSON.stringify(confirmed.json))
  assert.equal(confirmed.json.status, 'awaiting-input', JSON.stringify(confirmed.json))
  assert.equal(toolCalls, 1, 'initial modern call returns control; it does not answer or repeat the form')
  assert.deepEqual(requests.filter(row => row.method === 'tools/call')[0]?.params.inputResponses, undefined)
  const decisionId = toolActivityDecisionId(tenantId, session.id, activityId, decisionKey)

  const inputPath = `${activityPath}/input`
  const ownerReview = await call('GET', inputPath, undefined, ownerHeaders)
  assert.equal(ownerReview.status, 200)
  assert.equal(ownerReview.json.review.round, 1)
  assert.deepEqual(ownerReview.json.review.inputRequests, firstForm.inputRequests)
  assert.equal(JSON.stringify(ownerReview.json).includes('opaque-private-state-1'), false,
    'opaque continuation state remains private even in the owner-facing review projection')
  const peerReview = await call('GET', inputPath, undefined, peerHeaders)
  assert.equal(peerReview.status, 200)
  assert.equal(peerReview.json.review, null)
  assert.equal(JSON.stringify(peerReview.json).includes(JSON.stringify(firstForm.inputRequests)), false)
  assert.equal((await call('POST', inputPath, { decisionId, round: 1, responseId: randomUUID(), action: 'respond',
    responses: { application: { action: 'accept', content: { choice: 'one' } } },
  }, peerHeaders)).status, 404, 'same-tenant peer cannot submit private answers')
  const refusedSchema = await call('POST', inputPath, { decisionId, round: 1, responseId: randomUUID(), action: 'respond',
    responses: { application: { action: 'accept', content: { choice: 'not-reviewed', extra: 'unreviewed' } } },
  }, ownerHeaders)
  assert.equal(refusedSchema.status, 409, 'answers must validate against the exact privately reviewed schema')
  assert.equal(toolCalls, 1, 'invalid answers do not consume a response attempt or dispatch')

  const responseId1 = randomUUID()
  const response1 = { decisionId, round: 1, responseId: responseId1, action: 'respond',
    responses: { application: { action: 'accept', content: { choice: 'one' } } } }
  const receipt1 = await call('POST', inputPath, response1, ownerHeaders)
  assert.equal(receipt1.status, 200, JSON.stringify(receipt1.json))
  assert.equal(receipt1.json.activity.status, 'awaiting-input')
  assert.equal(toolCalls, 2)
  assert.deepEqual(requests.filter(row => row.method === 'tools/call')[1]?.params.inputResponses, response1.responses)
  assert.equal(requests.filter(row => row.method === 'tools/call')[1]?.params.requestState, 'opaque-private-state-1')
  const receiptReplay = await callFresh('POST', inputPath, response1, ownerHeaders)
  assert.deepEqual(receiptReplay.json, receipt1.json, 'same response UUID and body recover the exact receipt')
  assert.equal(toolCalls, 2, 'replay and a fresh route table never redispatch')
  const changedReplay = await call('POST', inputPath, { ...response1,
    responses: { application: { action: 'accept', content: { choice: 'two' } } },
  }, ownerHeaders)
  assert.equal(changedReplay.status, 409, 'the same UUID cannot be rebound to changed answers')
  assert.equal(toolCalls, 2)

  const ownerSecondReview = await call('GET', inputPath, undefined, ownerHeaders)
  assert.equal(ownerSecondReview.status, 200)
  assert.equal(ownerSecondReview.json.review.round, 2)
  assert.deepEqual(ownerSecondReview.json.review.inputRequests, secondForm.inputRequests)
  const responseId2 = randomUUID()
  const stopped = await call('POST', inputPath, { decisionId, round: 2, responseId: responseId2, action: 'stop' }, ownerHeaders)
  assert.equal(stopped.status, 200)
  assert.equal(stopped.json.activity.status, 'uncertain')
  assert.match(stopped.json.activity.summary, /Stopped locally.*No follow-up was sent/i)
  assert.equal(toolCalls, 2, 'Stop is local and cannot dispatch or imply rollback')
  const stopReplay = await call('POST', inputPath, { decisionId, round: 2, responseId: responseId2, action: 'stop' }, ownerHeaders)
  assert.deepEqual(stopReplay.json, stopped.json)
  assert.equal(toolCalls, 2)

  const receiptPath = `${activityPath}/input/receipts/${responseId1}?decisionId=${encodeURIComponent(decisionId)}`
  const beforeReceiptRead = requests.length
  const exactReceipt = await call('GET', receiptPath, undefined, ownerHeaders)
  assert.equal(exactReceipt.status, 200)
  assert.equal(exactReceipt.json.responseId, responseId1)
  assert.equal(exactReceipt.json.action, 'respond')
  assert.equal(exactReceipt.json.round, 1)
  assert.equal(exactReceipt.json.activity.status, 'uncertain', 'receipt joins current public status after a later local Stop')
  assert.equal(requests.length, beforeReceiptRead, 'receipt GET is read-only')
  assert.equal((await call('GET', receiptPath, undefined, peerHeaders)).status, 404,
    'a same-tenant peer cannot read another person’s answer receipt')

  const shared = await call('GET', `/sessions/${session.id}`, undefined, peerHeaders)
  assert.equal(shared.status, 200)
  const transcript = JSON.stringify(shared.json)
  assert.equal(transcript.includes('opaque-private-state-1'), false)
  assert.equal(transcript.includes('opaque-private-state-2'), false)
  assert.equal(transcript.includes('"choice":"one"'), false)
  assert.equal(transcript.includes('"reference"'), false)
  assert.equal(JSON.stringify(emitted).includes('opaque-private-state-1'), false)
  assert.equal(JSON.stringify(emitted).includes('"choice":"one"'), false)
  unsubscribe()

  for (let index = 0; index < 6; index++) store.appendMessage(session.id, {
    id: store.mintMessageId('user'), role: 'user', content: `Follow-up turn ${index}`,
  })
  const compaction = store.prepareSessionCompaction(session.id)
  assert.ok(compaction && compaction.kind === 'ready')
  store.applySessionCompaction(compaction, 'A privately reviewed MCP call stopped after its input rounds.')
  assert.equal(store.getToolActivity(session.id, activityId), undefined)
  const archivedReview = await callFresh('GET', `${inputPath}?decisionId=${encodeURIComponent(decisionId)}`, undefined, ownerHeaders)
  assert.equal(archivedReview.status, 200)
  assert.equal(archivedReview.json.activity.status, 'uncertain')
  assert.equal(archivedReview.json.review, null, 'archived terminal activity recovers status without reviving a form')
  const archivedReceipt = await callFresh('GET', receiptPath, undefined, ownerHeaders)
  assert.equal(archivedReceipt.status, 200)
  assert.equal(archivedReceipt.json.responseId, responseId1)
  const archivedReplay = await callFresh('POST', `${activityPath}/input`, response1, ownerHeaders)
  assert.equal(archivedReplay.status, 200)
  assert.equal(archivedReplay.json.responseId, responseId1)
  assert.equal(toolCalls, 2, 'archived GET/POST recovery cannot dispatch a continuation')
})

test('OAuth form route carries the real approving owner through credential resolution and receipt recovery', async (t) => {
  const previousRuntime = mcpRuntimeConfiguration()
  httpsRequests.length = 0
  httpsToolCalls = 0
  const requests = httpsRequests
  const resolverOwners: string[] = []
  mockHttpsResponse = () => httpsToolCalls === 1
    ? firstForm
    : { resultType: 'complete', content: [{ type: 'text', text: 'OAuth form completed' }], isError: false }
  configureMcpRuntime({ deviceBearerAvailable: false, deviceOAuthAvailable: true, allowLoopback: false,
    resolveOAuthCredential: async (_reference, binding) => {
      resolverOwners.push(binding.ownerUserId)
      return 'test-only-person-token'
    }, synchronizeBindings: async () => ({ available: true }) })
  t.after(() => {
    mockHttpsResponse = request => ({ resultType: 'complete', content: [{ type: 'text', text: 'done' }], isError: false })
    configureMcpRuntime({ ...previousRuntime })
  })

  const { owner, peer, tenantId, ownerHeaders, peerHeaders } = await sharedTenant()
  await initializeMcpRuntime(store.mcpCredentialBindings())
  const connectionId = `mcp-connection-${(++sequence).toString(16).padStart(32, '0')}`
  const credentialReference = `MCP_DESKTOP_${sequence.toString(16).toUpperCase().padStart(32, '0')}`
  store.createMcpConnection({ id: connectionId, label: 'Person-owned form OAuth', endpoint: oauthEndpoint,
    authentication: 'device-oauth' }, tenantId, false, owner.userId)
  store.commitMcpInspection(connectionId, tenantId, 0, { protocolVersion: MCP_MODERN_VERSION, cleanup: 'not-needed', tools: [tool],
    schemaAdmission: { version: MCP_SCHEMA_ADMISSION_VERSION, hashes: [schemaHash] },
  }, Date.now(), credentialReference, undefined, owner.userId)

  const session = store.createSession(`Person-owned OAuth form ${sequence}`, tenantId)
  const attached = await call('PATCH', `/sessions/${session.id}/context-state`, {
    operations: [{ action: 'attach', context: { id: connectionId, type: 'mcp', label: 'Person-owned form OAuth', scope: '*' } }],
    workspace: { workspaces: [], repos: [], connectors: [], attachments: [] },
  }, ownerHeaders)
  assert.equal(attached.status, 200, JSON.stringify(attached.json))
  const activityId = `mcp-input-oauth-${sequence}`
  const activity: ToolActivity = { id: activityId, tool: 'mcp__form__submit', connector: 'Person-owned form OAuth', connectorId: connectionId,
    kind: 'action', status: 'proposed', summary: 'Submit the reviewed application', input: { query: 'application' },
    mcp: { connectionRevision: 1, toolName: tool.name, schemaHash },
  }
  assert.ok(store.appendMessage(session.id, { id: store.mintMessageId('assistant'), role: 'assistant',
    content: 'Review this OAuth-backed application submission.', toolActivities: [activity] }, { actorUserId: owner.userId }))

  const activityPath = `/sessions/${session.id}/tool-activities/${activityId}`
  const decisionKey = `mcp-input-oauth-decision-${sequence}`
  const confirmed = await call('POST', activityPath, { decision: 'confirm' }, { ...ownerHeaders, 'idempotency-key': decisionKey })
  assert.equal(confirmed.status, 200, JSON.stringify(confirmed.json))
  assert.deepEqual({ resolverOwners, requests: requests.map(row => row.method), callCount: httpsToolCalls },
    { resolverOwners: [owner.userId], requests: ['server/discover', 'tools/call'], callCount: 1 },
    'OAuth fixture must reach one authorized modern form attempt')
  assert.equal(confirmed.json.status, 'awaiting-input', JSON.stringify(confirmed.json))
  const decisionId = toolActivityDecisionId(tenantId, session.id, activityId, decisionKey)
  const inputPath = `${activityPath}/input?decisionId=${encodeURIComponent(decisionId)}`
  const ownerReview = await call('GET', inputPath, undefined, ownerHeaders)
  assert.equal(ownerReview.status, 200)
  assert.equal(ownerReview.json.review.canContinue, true)
  assert.deepEqual(ownerReview.json.review.inputRequests, firstForm.inputRequests)
  const peerReview = await call('GET', inputPath, undefined, peerHeaders)
  assert.equal(peerReview.status, 200)
  assert.equal(peerReview.json.review, null)
  const answer = { decisionId, round: 1, responseId: randomUUID(), action: 'respond',
    responses: { application: { action: 'accept', content: { choice: 'one' } } } }
  assert.equal((await call('POST', `/sessions/${session.id}/tool-activities/${activityId}/input`, answer, peerHeaders)).status, 404)
  assert.equal(httpsToolCalls, 1, 'same-tenant peer rejection occurs before credential or peer I/O')

  const completed = await call('POST', `/sessions/${session.id}/tool-activities/${activityId}/input`, answer, ownerHeaders)
  assert.equal(completed.status, 200, JSON.stringify(completed.json))
  assert.equal(completed.json.activity.status, 'done')
  assert.deepEqual(requests.filter(row => row.method === 'tools/call')[1]?.params.inputResponses, answer.responses)
  assert.equal(requests.filter(row => row.method === 'tools/call')[1]?.params.requestState, 'opaque-private-state-1')
  assert.deepEqual(resolverOwners, [owner.userId, owner.userId], 'initial and continuation credential lookup remain owner-bound')
  assert.equal(httpsToolCalls, 2)
  const replay = await callFresh('POST', `/sessions/${session.id}/tool-activities/${activityId}/input`, answer, ownerHeaders)
  assert.deepEqual(replay.json, completed.json)
  assert.equal(httpsToolCalls, 2, 'exact OAuth response replay cannot redispatch')
  const receiptPath = `/sessions/${session.id}/tool-activities/${activityId}/input/receipts/${answer.responseId}?decisionId=${encodeURIComponent(decisionId)}`
  const receipt = await call('GET', receiptPath, undefined, ownerHeaders)
  assert.equal(receipt.status, 200)
  assert.equal(receipt.json.activity.status, 'done')
  assert.equal((await call('GET', receiptPath, undefined, peerHeaders)).status, 404)
})
