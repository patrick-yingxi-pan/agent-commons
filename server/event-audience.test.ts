import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { ServerEvent } from '../contract/events.ts'
import { signSession } from './auth.ts'
import { accounts } from './accounts.ts'
import { eventAudience } from './eventAudience.ts'
import { eventlog } from './eventlog.ts'
import { store } from './store/index.ts'
import { call } from './testkit/http.ts'
import { buildRouter } from './routes/index.ts'

let serial = 0

async function account(label: string) {
  const name = `${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${++serial}`
  const response = await call('POST', '/auth/signup', {
    name, email: `${name.toLowerCase()}@event-audience.example`, password: `${name}-password`,
  })
  assert.equal(response.status, 200, JSON.stringify(response.json))
  return { userId: response.json.user.id as string, home: response.json.tenant.id as string,
    email: response.json.user.email as string }
}

function signedHeaders(userId: string, tenantId: string) {
  return { cookie: `uw_session=${signSession({ userId, tenantId, iat: Date.now() })}` }
}

async function organization(owner: Awaited<ReturnType<typeof account>>, peers: Awaited<ReturnType<typeof account>>[]) {
  const created = await call('POST', '/orgs', { name: `Event audience ${serial}` }, signedHeaders(owner.userId, owner.home))
  assert.equal(created.status, 201, JSON.stringify(created.json))
  for (const peer of peers) {
    const invite = await call('POST', `/orgs/${created.json.id}/invites`, { email: peer.email }, signedHeaders(owner.userId, owner.home))
    assert.equal(invite.status, 201, JSON.stringify(invite.json))
    assert.equal((await call('POST', `/me/invites/${invite.json.id}/accept`, undefined,
      signedHeaders(peer.userId, peer.home))).status, 200)
  }
  return created.json.id as string
}

function ownedAgent(label: string, tenantId: string, userId: string, published = false) {
  const agent = store.createAgent({ label, systemPrompt: 'Event fixture.', tools: [], instructions: '', ...(published ? { published: true } : {}) },
    tenantId, { ownerUserId: userId })
  return agent
}

function changedEvent(id: string): ServerEvent {
  return { type: 'agent-request.changed', requestId: id }
}

function eventStream(path: '/events' | '/mcp', headers: Record<string, string>) {
  const router = buildRouter()
  let body = ''
  let ended = false
  const handlers = new Map<string, (arg?: unknown) => void>()
  const req: any = {
    method: 'GET', headers,
    on(name: string, handler: (arg?: unknown) => void) { handlers.set(name, handler); return req },
  }
  const res: any = {
    writeHead() { return res }, setHeader() {}, flushHeaders() {},
    write(chunk: string) { body += chunk; return true },
    end(chunk?: string) { if (chunk) body += chunk; ended = true },
    get writableEnded() { return ended },
  }
  return router.handle(req, res, new URL(`http://test${path}`)).then(() => ({
    body: () => body,
    close: () => handlers.get('close')?.(),
    events: (): ServerEvent[] => [...body.matchAll(/^data: (.+)$/gm)].flatMap(match => {
      const frame = JSON.parse(match[1]!)
      const event = path === '/mcp' ? frame.params?.data : frame
      return event?.type ? [event as ServerEvent] : []
    }),
  }))
}

async function mcpHeaders(base: Record<string, string>) {
  const initialized = await call('POST', '/mcp', { jsonrpc: '2.0', id: 1, method: 'initialize' }, base)
  assert.equal(initialized.status, 200, JSON.stringify(initialized.json))
  assert.ok(initialized.headers['mcp-session-id'])
  return { ...base, 'mcp-session-id': initialized.headers['mcp-session-id']! }
}

test('HTTP replay/live and MCP live request invalidations reach exactly the two signed parties', async () => {
  const requester = await account('Requester')
  const owner = await account('Owner')
  const other = await account('Other')
  const tenantId = await organization(owner, [requester, other])
  const requesterAgent = ownedAgent(`Requester Agent ${serial}`, tenantId, requester.userId)
  const ownerAgent = ownedAgent(`Owner Agent ${serial}`, tenantId, owner.userId)
  assert.ok(accounts.identityFor(requester.userId, tenantId))
  assert.ok(accounts.identityFor(owner.userId, tenantId))
  assert.ok(accounts.identityFor(other.userId, tenantId))
  const requesterHeaders = signedHeaders(requester.userId, tenantId)
  const ownerHeaders = signedHeaders(owner.userId, tenantId)
  const otherHeaders = signedHeaders(other.userId, tenantId)
  const actor = { tenantId, userId: requester.userId }
  const request = store.createAgentRequest(actor, `live-${serial}`, {
    fromAgentId: requesterAgent.id, toAgentId: ownerAgent.id, task: 'Review the quarterly invoice.',
  })
  const event = changedEvent(request.id)
  assert.deepEqual(Object.keys(event).sort(), ['requestId', 'type'])
  assert.equal(eventAudience(requesterHeaders)(event), true)
  assert.equal(eventAudience(ownerHeaders)(event), true)
  assert.equal(eventAudience(otherHeaders)(event), false, 'a third org seat is not a request participant')
  assert.equal(eventAudience({ 'x-user-id': requester.userId, 'x-tenant-id': tenantId })(event), false,
    'loose development identity headers cannot address person-private invalidations')

  const httpRequester = await eventStream('/events', requesterHeaders)
  const httpOwner = await eventStream('/events', ownerHeaders)
  const httpOther = await eventStream('/events', otherHeaders)
  const mcpRequester = await eventStream('/mcp', await mcpHeaders(requesterHeaders))
  const mcpOther = await eventStream('/mcp', await mcpHeaders(otherHeaders))
  const beforeDecision = eventlog.seq()
  try {
    const denied = store.decideAgentRequest(request.id, { tenantId, userId: owner.userId }, {
      action: 'deny', expectedRevision: request.revision,
    })
    assert.equal(denied.status, 'denied')
    const liveRequester = httpRequester.events().filter(value => value.type === 'agent-request.changed')
    const liveOwner = httpOwner.events().filter(value => value.type === 'agent-request.changed')
    const liveOther = httpOther.events().filter(value => value.type === 'agent-request.changed')
    assert.deepEqual(liveRequester, [event])
    assert.deepEqual(liveOwner, [event])
    assert.deepEqual(liveOther, [])
    assert.deepEqual(mcpRequester.events().filter(value => value.type === 'agent-request.changed'), [event])
    assert.deepEqual(mcpOther.events().filter(value => value.type === 'agent-request.changed'), [])

    const replay = await eventStream('/events', { ...requesterHeaders, 'last-event-id': String(beforeDecision) })
    try {
      assert.ok(replay.events().some(value => value.type === 'hello' && value.resumed))
      assert.deepEqual(replay.events().filter(value => value.type === 'agent-request.changed'), [event])
    } finally { replay.close() }
    const otherReplay = await eventStream('/events', { ...otherHeaders, 'last-event-id': String(beforeDecision) })
    try { assert.deepEqual(otherReplay.events().filter(value => value.type === 'agent-request.changed'), []) }
    finally { otherReplay.close() }
  } finally {
    httpRequester.close(); httpOwner.close(); httpOther.close(); mcpRequester.close(); mcpOther.close()
  }
})

test('published cross-namespace request invalidation matches each exact tenant-person pair and closes on token revocation', async () => {
  const requester = await account('Cross requester')
  const owner = await account('Cross owner')
  const bystander = await account('Cross bystander')
  const org = await organization(requester, [owner, bystander])
  const requesterAgent = ownedAgent(`Cross requester Agent ${serial}`, org, requester.userId)
  const targetAgent = ownedAgent(`Published target ${serial}`, owner.home, owner.userId, true)
  const beforeRequest = eventlog.seq()
  const request = store.createAgentRequest({ tenantId: org, userId: requester.userId }, `cross-${serial}`, {
    fromAgentId: requesterAgent.id, toAgentId: targetAgent.id, task: 'Ask the published Agent owner.',
  })
  const event = changedEvent(request.id)
  const requesterHeaders = signedHeaders(requester.userId, org)
  const ownerHeaders = signedHeaders(owner.userId, owner.home)
  const wrongNamespace = signedHeaders(owner.userId, org)
  const bystanderHeaders = signedHeaders(bystander.userId, org)
  assert.equal(eventAudience(requesterHeaders)(event), true)
  assert.equal(eventAudience(ownerHeaders)(event), true)
  assert.equal(eventAudience(wrongNamespace)(event), false, 'a matching person id in another tenant is not the owner identity')
  assert.equal(eventAudience(bystanderHeaders)(event), false)

  const requesterReplay = await eventStream('/events', { ...requesterHeaders, 'last-event-id': String(beforeRequest) })
  const ownerReplay = await eventStream('/events', { ...ownerHeaders, 'last-event-id': String(beforeRequest) })
  const wrongNamespaceReplay = await eventStream('/events', { ...wrongNamespace, 'last-event-id': String(beforeRequest) })
  const bystanderReplay = await eventStream('/events', { ...bystanderHeaders, 'last-event-id': String(beforeRequest) })
  try {
    assert.deepEqual(requesterReplay.events().filter(value => value.type === 'agent-request.changed'), [event])
    assert.deepEqual(ownerReplay.events().filter(value => value.type === 'agent-request.changed'), [event])
    assert.deepEqual(wrongNamespaceReplay.events().filter(value => value.type === 'agent-request.changed'), [])
    assert.deepEqual(bystanderReplay.events().filter(value => value.type === 'agent-request.changed'), [])
  } finally {
    requesterReplay.close(); ownerReplay.close(); wrongNamespaceReplay.close(); bystanderReplay.close()
  }

  const tokenRow = accounts.mintApiToken(requester.userId)
  const bearer = signSession({ userId: requester.userId, tenantId: org, iat: Date.now(), jti: tokenRow.id })
  const bearerHeaders = { authorization: `Bearer ${bearer}` }
  const audience = eventAudience(bearerHeaders)
  assert.equal(audience(event), true)
  assert.equal(accounts.revokeApiToken(requester.userId, tokenRow.id), true)
  assert.equal(audience(event), false, 'a later invalidation is suppressed after the captured credential is revoked')
})
