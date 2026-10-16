import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { afterEach, test, type TestContext } from 'node:test'
import { signSession, SESSION_COOKIE } from '../auth.ts'
import { agentCreationId } from '../agentCreationIdentity.ts'
import { store } from '../store/index.ts'
import { call } from '../testkit/http.ts'

const KEY_ENV = 'PROVIDER_AGENT_REQUEST_REPLY_TEST'
let sequence = 0
const next = (prefix: string) => prefix + '-' + Date.now().toString(36) + '-' + ++sequence
type Person = { userId: string; tenantId: string }
const headers = (person: Person) => ({
  cookie: SESSION_COOKIE + '=' + signSession({ userId: person.userId, tenantId: person.tenantId, iat: Date.now() }),
  'x-account-transition-source': 'session:' + person.userId,
})

afterEach(() => { delete process.env[KEY_ENV] })

async function localMessages(t: TestContext, gate?: Promise<void>) {
  const received: Array<{ path?: string; headers: Record<string, string | string[] | undefined>; body: any }> = []
  let notifyRequest!: () => void
  const requested = new Promise<void>(resolve => { notifyRequest = resolve })
  const server = createServer(async (req, res) => {
    const chunks: Buffer[] = []
    for await (const chunk of req) chunks.push(Buffer.from(chunk))
    received.push({ path: req.url, headers: req.headers, body: JSON.parse(Buffer.concat(chunks).toString('utf8')) })
    notifyRequest()
    if (gate) await gate
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ id: 'reply-local', type: 'message', role: 'assistant', model: 'local-reply-model',
      stop_reason: 'end_turn', content: [{ type: 'text', text: 'A concise private suggestion.' }],
      usage: { input_tokens: 61, output_tokens: 12 } }))
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  t.after(async () => {
    server.closeAllConnections()
    await new Promise<void>(resolve => server.close(() => resolve()))
  })
  const address = server.address()
  assert.ok(address && typeof address === 'object')
  return { baseURL: 'http://127.0.0.1:' + address.port, received, requested }
}

async function fixture(t: TestContext, options: { gate?: Promise<void> } = {}) {
  const suffix = next('agent-request-reply')
  const signUp = async (name: string): Promise<Person> => {
    const response = await call('POST', '/auth/signup', { name, email: suffix + '-' + name.toLowerCase().replaceAll(' ', '-') + '@test.invalid', password: suffix + '-password' })
    assert.equal(response.status, 200, JSON.stringify(response.json))
    return { userId: response.json.user.id as string, tenantId: response.json.tenant.id as string }
  }
  const requester = await signUp('Requester'), owner = await signUp('Owner'), third = await signUp('Third party')
  const requesterHeaders = headers(requester), ownerHeaders = headers(owner), thirdHeaders = headers(third)
  process.env[KEY_ENV] = 'local-secret-' + suffix
  const model = await localMessages(t, options.gate)
  const provider = store.createProvider({ label: 'Local reply provider ' + suffix, modelFamily: 'claude', effortLevels: ['Low'],
    models: [{ id: 'local-reply-model', label: 'Local reply model' }] }, {
    baseURL: model.baseURL, apiKeyEnv: KEY_ENV, model: 'local-reply-model', capabilities: { toolUse: false },
  }, owner.tenantId)
  const fromAgentId = agentCreationId(requester.tenantId, next('requesting-agent'))
  const toAgentId = agentCreationId(owner.tenantId, next('receiving-agent'))
  store.createAgent({ label: 'Requesting Agent', systemPrompt: 'requester-only system prompt', instructions: '', tools: [] }, requester.tenantId,
    { logicalId: fromAgentId, ownerUserId: requester.userId })
  const agent = store.createAgent({ label: 'Receiving Agent', systemPrompt: 'Use only the supplied task and owner notes.',
    instructions: 'Keep suggestions brief.', tools: [], published: true, providerId: provider.id }, owner.tenantId,
  { logicalId: toAgentId, ownerUserId: owner.userId })
  const created = await call('POST', '/agent-requests', { fromAgentId, toAgentId, task: 'Please provide a private answer to this task.' },
    { ...requesterHeaders, 'idempotency-key': next('request') })
  assert.equal(created.status, 200, JSON.stringify(created.json))
  const id = created.json.id as string
  const path = '/agent-requests/' + id
  const read = (personHeaders = ownerHeaders) => call('GET', path, undefined, personHeaders)
  const replyReview = (personHeaders = ownerHeaders) => call('GET', path + '/reply-review', undefined, personHeaders)
  const decision = (body: unknown, personHeaders = ownerHeaders) => call('POST', path + '/decision', body, personHeaders)
  const binding = (snapshot: any) => ({ agentRevision: snapshot.draftModel.agentRevision, providerId: snapshot.draftModel.providerId,
    providerRevision: snapshot.draftModel.providerRevision, providerConnectionRevision: snapshot.draftModel.providerConnectionRevision,
    model: snapshot.draftModel.model })
  return { requester, owner, third, requesterHeaders, ownerHeaders, thirdHeaders, model, provider, agent, id, path, read,
    replyReview, decision, binding }
}

async function settled(read: () => Promise<{ status: number; json: any }>, statuses: string[]) {
  for (let attempt = 0; attempt < 200; attempt++) {
    const response = await read()
    assert.equal(response.status, 200, JSON.stringify(response.json))
    if (statuses.includes(response.json.replyDraft?.status)) return response.json
    await new Promise(resolve => setTimeout(resolve, 10))
  }
  assert.fail('reply draft did not settle as ' + statuses.join(' or '))
}

test('reply review and durable draft are owner-private, no-store, tool-free and one-shot', async t => {
  let release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  const f = await fixture(t, { gate })
  const initial = await f.replyReview()
  assert.equal(initial.status, 200)
  assert.equal(initial.headers['cache-control'], 'no-store')
  assert.equal(initial.json.request.id, f.id)
  assert.equal(initial.json.draftModel.model, 'local-reply-model')
  for (const outsider of [f.requesterHeaders, f.thirdHeaders, {}]) {
    const refused = await f.replyReview(outsider)
    assert.equal(refused.status, 404)
    assert.equal(refused.headers['cache-control'], 'no-store')
  }
  assert.equal((await f.replyReview({ ...f.ownerHeaders, 'x-account-transition-source': 'session:someone-else' })).status, 409,
    'the account-source preflight conflicts before any private read')
  const staleModel = await f.decision({ action: 'draft-reply', expectedRevision: initial.json.request.revision,
    binding: { ...f.binding(initial.json), providerConnectionRevision: initial.json.draftModel.providerConnectionRevision + 1 }, notes: 'do not send' })
  assert.equal(staleModel.status, 404, 'stale model binding is refused before contacting the configured endpoint')
  assert.equal(f.model.received.length, 0)
  const staleRevision = await f.decision({ action: 'draft-reply', expectedRevision: initial.json.request.revision + 1,
    binding: f.binding(initial.json), notes: '' })
  assert.equal(staleRevision.status, 409)

  const notes = 'Owner-only notes ' + next('private-note')
  const action = { action: 'draft-reply', expectedRevision: initial.json.request.revision, binding: f.binding(initial.json), notes }
  const acknowledged = await f.decision(action)
  assert.equal(acknowledged.status, 200, JSON.stringify(acknowledged.json))
  assert.equal(acknowledged.json.replyDraft.status, 'pending')
  assert.equal(acknowledged.json.replyDraft.revision, 1)
  assert.equal(JSON.stringify(acknowledged.json).includes(notes), false)
  assert.equal(JSON.stringify((await f.read(f.requesterHeaders)).json).includes('replyDraft'), false)
  assert.equal(JSON.stringify((await call('GET', '/agent-requests', undefined, f.ownerHeaders)).json).includes('replyDraft'), false)
  await f.model.requested
  assert.equal(f.model.received.length, 1)
  const payload = f.model.received[0]
  assert.equal(payload.path, '/v1/messages')
  assert.equal('tools' in payload.body, false)
  const modelInput = payload.body.system + '\n' + JSON.stringify(payload.body.messages)
  for (const included of ['Please provide a private answer to this task.', 'Use only the supplied task and owner notes.', 'Keep suggestions brief.', notes]) {
    assert.ok(modelInput.includes(included), 'model input includes reviewed source: ' + included)
  }
  for (const excluded of [f.id, f.requester.userId, f.owner.userId, f.third.userId, f.provider.id, f.model.baseURL,
    process.env[KEY_ENV]!, 'requester-only system prompt']) assert.equal(modelInput.includes(excluded), false)
  assert.equal(JSON.stringify(payload.body).includes(KEY_ENV), false)
  assert.equal(JSON.stringify(payload.body).includes(process.env[KEY_ENV]!), false)
  // Simulate the caller losing the successful POST acknowledgement: recovery
  // reads the durable pending receipt and never repeats the one-shot effect.
  const recoveredPending = await f.read()
  assert.equal(recoveredPending.json.replyDraft.status, 'pending')
  assert.equal(f.model.received.length, 1)
  const retry = await f.decision(action)
  assert.equal(retry.status, 409)
  assert.equal(f.model.received.length, 1)

  for (const blocked of [
    { action: 'share', expectedRevision: acknowledged.json.revision, reply: 'not yet' },
    { action: 'deny', expectedRevision: acknowledged.json.revision },
    { action: 'run', expectedRevision: acknowledged.json.revision, approval: {} },
    { action: 'draft-arguments', expectedRevision: acknowledged.json.revision, binding: {
      agentRevision: 1, providerId: 'provider', providerRevision: 1, providerConnectionRevision: 1, model: 'model',
      connectionId: 'connection', connectionRevision: 1, toolName: 'tool', schemaHash: 'hash', transport: 'http',
    } },
  ]) {
    const response = await f.decision(blocked)
    assert.equal(response.status, 409, blocked.action + ' is blocked while model reply is pending')
  }
  release()
  const completed = await settled(f.read, ['done'])
  assert.equal(completed.replyDraft.text, 'A concise private suggestion.')
  assert.equal(completed.replyDraft.revision, 2)
  assert.equal(f.model.received.length, 1)
  assert.equal(JSON.stringify((await f.read(f.requesterHeaders)).json).includes('replyDraft'), false)
})

test('cancel remains available while drafting and a model binding change withholds late output', async t => {
  let release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  const f = await fixture(t, { gate })
  const review = await f.replyReview()
  const body = { action: 'draft-reply', expectedRevision: review.json.request.revision, binding: f.binding(review.json), notes: '' }
  const acknowledged = await f.decision(body)
  assert.equal(acknowledged.status, 200, JSON.stringify(acknowledged.json))
  await f.model.requested
  const cancel = await f.decision({ action: 'cancel', expectedRevision: acknowledged.json.revision })
  assert.equal(cancel.status, 200, JSON.stringify(cancel.json))
  assert.equal(cancel.json.status, 'cancelled')
  release()
  const cancelled = await settled(f.read, ['done', 'failed', 'uncertain'])
  assert.equal(cancelled.status, 'cancelled')
  assert.equal(f.model.received.length, 1)

  // A second isolated request proves the live-worker binding check: changing
  // the receiving Agent while a response is in flight cannot publish stale text.
  let releaseSecond!: () => void
  const gateSecond = new Promise<void>(resolve => { releaseSecond = resolve })
  const second = await fixture(t, { gate: gateSecond })
  const secondReview = await second.replyReview()
  const secondAck = await second.decision({ action: 'draft-reply', expectedRevision: secondReview.json.request.revision,
    binding: second.binding(secondReview.json), notes: '' })
  assert.equal(secondAck.status, 200, JSON.stringify(secondAck.json))
  await second.model.requested
  store.updateAgentFromRequest(second.agent.id, { instructions: 'Changed while the model was responding.' }, second.agent.revision)
  releaseSecond()
  const changed = await settled(second.read, ['failed', 'uncertain'])
  assert.equal(changed.replyDraft.text, undefined)
  assert.equal(second.model.received.length, 1)
})
