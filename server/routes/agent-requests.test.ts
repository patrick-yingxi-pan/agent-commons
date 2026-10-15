import assert from 'node:assert/strict'
import { test } from 'node:test'
import { SESSION_COOKIE, signSession } from '../auth.ts'
import { accounts } from '../accounts.ts'
import { agentCreationId } from '../agentCreationIdentity.ts'
import { catalogOf } from '../apiSurface.ts'
import { deriveApiTools } from '../model/apiTools.ts'
import { mcpToolRoutes, toolNameFor } from '../mcp.ts'
import { store } from '../store/index.ts'
import { buildRouter } from './index.ts'
import { call, callFresh } from '../testkit/http.ts'

let sequence = 0
const next = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${++sequence}`
const cookieOf = (response: { headers: Record<string, string> }) => response.headers['set-cookie']?.split(';')[0] ?? ''
const headers = (cookie: string, extra: Record<string, string> = {}) => ({ cookie, ...extra })

async function signup(name: string) {
  const tag = next('agent-requests-route')
  const response = await call('POST', '/auth/signup', { name, email: `${tag}@agent-requests.test`, password: `${tag}-password` })
  assert.equal(response.status, 200, JSON.stringify(response.json))
  assert.ok(cookieOf(response))
  return { userId: response.json.user.id as string, email: response.json.user.email as string, cookie: cookieOf(response) }
}

async function invite(orgId: string, inviter: { userId: string; cookie: string }, invitee: { userId: string; email: string; cookie: string }) {
  const issued = await call('POST', `/orgs/${orgId}/invites`, { email: invitee.email }, { cookie: inviter.cookie })
  assert.equal(issued.status, 201, JSON.stringify(issued.json))
  const accepted = await call('POST', `/me/invites/${issued.json.id}/accept`, undefined, { cookie: invitee.cookie })
  assert.equal(accepted.status, 200, JSON.stringify(accepted.json))
}

function makeAgent(label: string, tenantId: string, userId: string, published = false) {
  const id = agentCreationId(tenantId, next('route-agent'))
  store.createAgent({ label, systemPrompt: 'Route fixture.', tools: [], instructions: '', published }, tenantId,
    { logicalId: id, ownerUserId: userId })
  return id
}

async function sameOrgFixture() {
  const owner = await signup('Agent request receiver')
  const requester = await signup('Agent request requester')
  const peer = await signup('Agent request same-org peer')
  const createdOrg = await call('POST', '/orgs', { name: next('Agent request org') }, { cookie: owner.cookie })
  assert.equal(createdOrg.status, 201, JSON.stringify(createdOrg.json))
  const tenantId = createdOrg.json.id as string
  await invite(tenantId, owner, requester)
  await invite(tenantId, owner, peer)
  const sourceId = makeAgent('Requester Agent', tenantId, requester.userId)
  const targetId = makeAgent('Owner Agent', tenantId, owner.userId)
  const headersFor = (person: { cookie: string; userId: string }) => headers(
    `${SESSION_COOKIE}=${signSession({ userId: person.userId, tenantId, iat: Date.now() })}`,
    { 'x-account-transition-source': `session:${person.userId}` })
  return { owner, requester, peer, tenantId, sourceId, targetId,
    ownerHeaders: headersFor(owner), requesterHeaders: headersFor(requester), peerHeaders: headersFor(peer) }
}

test('authenticated Agent request routes enforce exact-person visibility within the same organization', async () => {
  const f = await sameOrgFixture()
  const key = next('same-org-request')
  const body = { fromAgentId: f.sourceId, toAgentId: f.targetId, task: 'Prepare a private handoff.' }
  const options = await call('GET', '/agent-request-options', undefined, f.requesterHeaders)
  assert.equal(options.status, 200)
  assert.equal(options.headers['cache-control'], 'no-store')
  assert.deepEqual(options.json.sourceAgents.map((row: { id: string }) => row.id), [f.sourceId])
  assert.ok(options.json.targetAgents.some((row: { id: string }) => row.id === f.targetId))
  const peerOptions = await call('GET', '/agent-request-options', undefined, f.peerHeaders)
  assert.deepEqual(peerOptions.json.sourceAgents, [], 'same-org membership cannot claim another person’s Agent')
  const created = await call('POST', '/agent-requests', body, { ...f.requesterHeaders, 'idempotency-key': key })
  assert.equal(created.status, 200, JSON.stringify(created.json))
  assert.equal(created.json.role, 'requester')
  assert.equal(created.headers['cache-control'], 'no-store')

  const ownerRead = await call('GET', `/agent-requests/${created.json.id}`, undefined, f.ownerHeaders)
  assert.equal(ownerRead.status, 200)
  assert.equal(ownerRead.json.role, 'owner')
  const requesterRead = await call('GET', '/agent-requests', undefined, f.requesterHeaders)
  assert.equal(requesterRead.json.some((row: { id: string }) => row.id === created.json.id), true)

  const peerDetail = await call('GET', `/agent-requests/${created.json.id}`, undefined, f.peerHeaders)
  const peerCreate = await call('POST', '/agent-requests', {
    fromAgentId: f.sourceId, toAgentId: f.targetId, task: 'Borrow another person’s Agent.' },
    { ...f.peerHeaders, 'idempotency-key': next('peer-request') })
  assert.equal(peerDetail.status, 404)
  assert.equal(peerCreate.status, 404)
  assert.deepEqual(await call('GET', '/agent-requests', undefined, f.peerHeaders).then(r => r.json), [])

  const forgedRequester = await call('GET', `/agent-requests/${created.json.id}`, undefined, {
    ...f.requesterHeaders, 'x-user-id': f.owner.userId, 'x-tenant-id': f.tenantId,
  })
  assert.equal(forgedRequester.status, 200)
  assert.equal(forgedRequester.json.role, 'requester', 'cookie identity wins over forged identity headers')
  const forgedOwner = await call('GET', `/agent-requests/${created.json.id}`, undefined, {
    ...f.ownerHeaders, 'x-user-id': f.requester.userId,
  })
  assert.equal(forgedOwner.json.role, 'owner')

  const missingCookie = await call('GET', '/agent-requests', undefined, { 'x-user-id': f.owner.userId, 'x-tenant-id': f.tenantId })
  assert.notEqual(missingCookie.status, 200, 'identity headers alone cannot authenticate this private capability')
})

test('visible published targets can cross namespaces while unpublished foreign targets stay hidden', async () => {
  const requester = await signup('Cross-namespace requester')
  const owner = await signup('Cross-namespace receiver')
  const requesterHome = accounts.homeOf(requester.userId)!.tenant.id
  const ownerHome = accounts.homeOf(owner.userId)!.tenant.id
  const sourceId = makeAgent('Private requester source', requesterHome, requester.userId)
  const publicId = makeAgent('Published receiver', ownerHome, owner.userId, true)
  const hiddenId = makeAgent('Unpublished receiver', ownerHome, owner.userId)
  const actor = headers(requester.cookie, { 'x-account-transition-source': `session:${requester.userId}` })
  const created = await call('POST', '/agent-requests', {
    fromAgentId: sourceId, toAgentId: publicId, task: 'Ask a published Agent across namespaces.' },
    { ...actor, 'idempotency-key': next('cross-namespace') })
  assert.equal(created.status, 200, JSON.stringify(created.json))
  const targetView = await call('GET', `/agent-requests/${created.json.id}`, undefined, headers(owner.cookie))
  assert.equal(targetView.status, 200)
  assert.equal(targetView.json.role, 'owner')
  const hidden = await call('POST', '/agent-requests', {
    fromAgentId: sourceId, toAgentId: hiddenId, task: 'Guess a hidden target.' },
    { ...actor, 'idempotency-key': next('hidden-foreign') })
  assert.equal(hidden.status, 404)
})

test('account-source preflight precedes body validation and membership loss during body wait stops creation', async () => {
  const f = await sameOrgFixture()
  const before = store.agentRequests({ tenantId: f.tenantId, userId: f.requester.userId }).length
  const stale = await call('POST', '/agent-requests', { malformed: true }, {
    ...f.requesterHeaders,
    'x-account-transition-source': `session:${f.owner.userId}`,
    'idempotency-key': next('stale-source'),
  })
  assert.equal(stale.status, 409)
  assert.equal(stale.json.error.code, 'conflict')
  assert.equal(store.agentRequests({ tenantId: f.tenantId, userId: f.requester.userId }).length, before)

  const router = buildRouter()
  const listeners: Record<string, (chunk?: Buffer) => void> = {}
  let bodyReady!: () => void
  const ready = new Promise<void>(resolve => { bodyReady = resolve })
  let status = 0
  let output = ''
  let ended = false
  const req: any = {
    method: 'POST',
    headers: { ...f.requesterHeaders, 'idempotency-key': next('revoked-during-body') },
    on(event: string, listener: (chunk?: Buffer) => void) {
      listeners[event] = listener
      if (event === 'end') bodyReady()
      return req
    },
  }
  const res: any = {
    writeHead(code: number) { status = code; return res },
    setHeader() {},
    write(chunk: string) { output += chunk; return true },
    end(chunk?: string) { if (chunk) output += chunk; ended = true },
    flushHeaders() {}, on() {},
    get writableEnded() { return ended },
  }
  const pending = router.handle(req, res, new URL('http://test/agent-requests'))
  await ready
  const membership = accounts.membership(f.requester.userId, f.tenantId)!
  accounts.memberships = accounts.memberships.filter(row => row !== membership)
  try {
    listeners.data!(Buffer.from(JSON.stringify({ fromAgentId: f.sourceId, toAgentId: f.targetId, task: 'No longer authorized.' })))
    listeners.end!()
    await pending
    assert.equal(status, 409, 'a revoked session no longer matches the source selected when the body wait began')
    assert.equal(JSON.parse(output).error.code, 'conflict')
    assert.equal(store.agentRequests({ tenantId: f.tenantId, userId: f.owner.userId }).length, 0)
  } finally { accounts.memberships.push(membership) }
})

test('keyed creation survives router cache reset; decisions are intrinsic, stale-safe and catalogued correctly', async () => {
  const f = await sameOrgFixture()
  const key = next('router-reset-request')
  const body = { fromAgentId: f.sourceId, toAgentId: f.targetId, task: 'One keyed route request.' }
  const created = await call('POST', '/agent-requests', body, { ...f.requesterHeaders, 'idempotency-key': key })
  assert.equal(created.status, 200)
  const freshReplay = await callFresh('POST', '/agent-requests', body, { ...f.requesterHeaders, 'idempotency-key': key })
  assert.equal(freshReplay.status, 200)
  assert.equal(freshReplay.json.id, created.json.id)
  const changedReplay = await callFresh('POST', '/agent-requests', { ...body, task: 'Changed intent.' }, {
    ...f.requesterHeaders, 'idempotency-key': key,
  })
  assert.equal(changedReplay.status, 409)

  const route = buildRouter().list().find(row => row.method === 'POST' && row.pattern === '/agent-requests/:id/decision')!
  assert.equal(route.access.kind, 'product')
  assert.equal(route.access.session, 'intrinsic')
  const catalog = catalogOf(buildRouter())
  const definition = catalog.find(row => row.method === route.method && row.pattern === route.pattern)!
  assert.ok(mcpToolRoutes(buildRouter()).some(row => row.name === definition.name), 'the receiving human can use the remote MCP capability')
  const inSession = deriveApiTools(catalog)
  assert.equal(inSession.byName.has(`api__${toolNameFor(route.method, route.pattern)}`), false,
    'the model cannot recursively approve its own private request')
  assert.ok(inSession.byName.has('api__get_agent_requests'))

  const remoteCatalog = await call('POST', '/mcp', { jsonrpc: '2.0', id: ++sequence, method: 'tools/list' }, f.requesterHeaders)
  const createTool = toolNameFor('POST', '/agent-requests')
  const decisionTool = toolNameFor(route.method, route.pattern)
  assert.ok(remoteCatalog.json.result.tools.some((tool: { name: string }) => tool.name === createTool))
  assert.ok(remoteCatalog.json.result.tools.some((tool: { name: string }) => tool.name === decisionTool))
  const remoteCreate = await call('POST', '/mcp', { jsonrpc: '2.0', id: ++sequence, method: 'tools/call', params: {
    name: createTool,
    arguments: { idempotencyKey: next('remote-request'), body: {
      fromAgentId: f.sourceId, toAgentId: f.targetId, task: 'Review a remote MCP request.' } },
  } }, f.requesterHeaders)
  assert.equal(remoteCreate.status, 200)
  const remoteCreated = JSON.parse(remoteCreate.json.result.content[0].text)
  assert.equal(remoteCreated.status, 200)
  const remoteDecision = await call('POST', '/mcp', { jsonrpc: '2.0', id: ++sequence, method: 'tools/call', params: {
    name: decisionTool,
    arguments: { id: remoteCreated.body.id, body: { action: 'deny', expectedRevision: 1 } },
  } }, f.ownerHeaders)
  assert.equal(remoteDecision.status, 200)
  assert.equal(JSON.parse(remoteDecision.json.result.content[0].text).body.status, 'denied')

  const staleDecision = await call('POST', `/agent-requests/${created.json.id}/decision`, {
    action: 'deny', expectedRevision: 2,
  }, f.ownerHeaders)
  assert.equal(staleDecision.status, 409)
  const decision = await call('POST', `/agent-requests/${created.json.id}/decision`, {
    action: 'deny', expectedRevision: 1,
  }, f.ownerHeaders)
  assert.equal(decision.status, 200)
  assert.equal(decision.json.status, 'denied')
  const repeated = await callFresh('POST', `/agent-requests/${created.json.id}/decision`, {
    action: 'deny', expectedRevision: 1,
  }, f.ownerHeaders)
  assert.equal(repeated.status, 409, 'a new router cannot turn a stale decision into a second application')
})
