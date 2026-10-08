/** D20 — the A2A protocol edge (docs/a2a-integration.md): the platform-shell objects
 *  re-served in the Agent2Agent wire format, with ZERO new authority paths. The
 *  invariants under test: a card is built from the SAME redaction the D17 directory
 *  uses (published-only; no capability field ever rides it); `message/send` to a
 *  shared Project lands on the SAME `postOpenSubGoal` + visibility wall as the native
 *  route (task id = item id; the D19 lifecycle mapped honestly); a hidden Project
 *  answers exactly like a nonexistent one; and an Agent endpoint REFUSES tasking with
 *  a spec-conformant `rejected` Task (a definition travels, a capability never does). */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { store } from '../store/index.ts'
import { call } from '../testkit/http.ts'

const A = 'tenant-a2a-A'
const B = 'tenant-a2a-B'
let n = 0

/** A fresh shared project owned by A with one of A's agents commissioned onto it. */
function arena(opts: { standing?: boolean } = {}) {
  const id = `p-a2a-${(n += 1)}`
  store.applyRelationOp({ kind: 'create-project', projectId: id, projectName: `A2A ${n}`, projectDescription: '' }, A)
  store.applyRelationOp({ kind: 'share-project', projectId: id, projectName: `A2A ${n}`, shared: true }, A)
  const agent = store.createAgent({ label: `A2A Worker ${n}`, systemPrompt: 'x', tools: [], instructions: '' }, A)
  const commission = store.createCommission({ role: 'writer', agentId: agent.id, projectId: id, standing: opts.standing }, A)
  return { id, agent, commission }
}

/** JSON-RPC envelope + the v1 message/send shape (text part = sub-goal, data part = effect). */
const rpc = (method: string, params?: Record<string, unknown>, id: string | number = 1) => ({ jsonrpc: '2.0', id, method, params })
const sendMsg = (subGoal: string | undefined, data?: Record<string, unknown>) =>
  rpc('message/send', {
    message: {
      kind: 'message',
      role: 'user',
      messageId: 'm-1',
      parts: [
        ...(subGoal !== undefined ? [{ kind: 'text', text: subGoal }] : []),
        ...(data ? [{ kind: 'data', data }] : []),
      ],
    },
  })

test('the platform card is served at /a2a/card and advertises the open-work skill', async () => {
  const { status, json } = await call('GET', '/a2a/card')
  assert.equal(status, 200)
  assert.equal(json.protocolVersion, '0.3.0')
  assert.equal(json.preferredTransport, 'JSONRPC')
  assert.equal(json.capabilities.streaming, false, 'dispatch is synchronous — streaming honestly declined')
  assert.match(json.description, /development simulation/i, 'the development card labels simulated standing completion')
  assert.match(json.description, /no Agent or external tool runs/i)
  const skill = json.skills.find((s: any) => s.id === 'open-work')
  assert.ok(skill, 'the one platform-level act a foreign agent may perform')
  assert.match(skill.description, /a2a\/projects\/\{projectId\}/, 'the skill names the project endpoint')
  assert.match(json.url, /^http:\/\/test\/api\/v1\/a2a$/, 'the card url is absolute, from the request origin')
})

test('release platform card says posted work stays pending instead of claiming standing execution', async () => {
  const previous = process.env.DEPLOYMENT_PROFILE
  process.env.DEPLOYMENT_PROFILE = 'desktop'
  try {
    const { status, json } = await call('GET', '/a2a/card')
    assert.equal(status, 200)
    assert.match(json.description, /posted work remains submitted/i)
    assert.match(json.description, /standing configuration does not execute/i)
    assert.doesNotMatch(json.description, /standing Contributors take (?:it|open work) unprompted/i)
  } finally {
    if (previous === undefined) delete process.env.DEPLOYMENT_PROFILE
    else process.env.DEPLOYMENT_PROFILE = previous
  }
})

test('a published Agent gets a card built from its directory face; no capability field ever rides it', async () => {
  const agent = store.createAgent(
    { label: 'Card Subject', systemPrompt: 'the public prompt', tools: ['create_artifact'], instructions: 'be thorough', authority: undefined, budget: undefined },
    A,
  )
  await call('PATCH', `/agents/${agent.id}`, { published: true }, { 'x-tenant-id': A })

  // Cross-tenant readable (published = public), like the directory.
  const { status, json } = await call('GET', `/a2a/agents/${agent.id}/card`, undefined, { 'x-tenant-id': B })
  assert.equal(status, 200)
  assert.equal(json.name, 'Card Subject')
  // tenantName falls back to the raw id for an unregistered dev-seam tenant — the
  // point under test is that the owner field is the directory's public identity.
  assert.equal(json.provider.organization, A)
  assert.deepEqual(json.skills.map((s: any) => s.id), ['create_artifact'], 'tools become skills')
  assert.equal(json.metadata.systemPrompt, 'the public prompt', 'the directory already exposes the prompt')
  // The D18 wall, serialized: no capability field anywhere in the card JSON.
  const raw = JSON.stringify(json)
  for (const leak of ['authority', 'budget', 'providerId', 'tenantId']) {
    assert.ok(!raw.includes(`"${leak}"`), `'${leak}' must not ride an Agent Card`)
  }
  assert.match(json.url, new RegExp(`/api/v1/a2a/agents/${agent.id}$`))
})

test('an UNPUBLISHED or unknown Agent has no card and no endpoint — the identical 404', async () => {
  const agent = store.createAgent({ label: 'Private', systemPrompt: 'x', tools: [], instructions: '' }, A)
  const priv = await call('GET', `/a2a/agents/${agent.id}/card`, undefined, { 'x-tenant-id': B })
  const ghost = await call('GET', '/a2a/agents/agent-no-such/card', undefined, { 'x-tenant-id': B })
  assert.equal(priv.status, 404)
  assert.equal(ghost.status, 404)
  assert.equal(priv.json.error.code, ghost.json.error.code, 'existence-hiding: unpublished ≡ nonexistent')
  // The JSON-RPC endpoint mirrors the card's existence.
  const post = await call('POST', `/a2a/agents/${agent.id}`, sendMsg('hi'), { 'x-tenant-id': B })
  assert.equal(post.status, 404)
})

test('message/send posts open work through the D19 dispatch: a standing taker ⇒ Task completed with the credit artifact', async () => {
  const { id, agent, commission } = arena({ standing: true })
  const res = await call('POST', `/a2a/projects/${id}`, sendMsg('a2a-ship-notes', { type: 'charge', target: 'budget:demo' }), { 'x-tenant-id': B })
  assert.equal(res.status, 200)
  const task = res.json.result
  assert.equal(task.kind, 'task')
  assert.equal(task.contextId, id)
  assert.equal(task.status.state, 'completed', 'the standing Contributor took it at post time — the same synchronous dispatch')
  const credit = task.artifacts?.[0]?.parts?.find((p: any) => p.kind === 'data')?.data
  assert.equal(credit.resolvedBy, commission.id, 'the D13 credit line rides the artifact')
  assert.equal(credit.resolvedByLabel, agent.label)

  // The SAME item is on the native backlog — one object, two dialects — stamped with provenance.
  const list = await call('GET', `/projects/${id}/open-subgoals`, undefined, { 'x-tenant-id': A })
  assert.equal(list.json.length, 1)
  assert.equal(list.json[0].id, task.id, 'task id = item id')
  assert.equal(list.json[0].via, 'a2a', 'provenance stamped')
  assert.equal(list.json[0].status, 'done')
})

test('no standing taker ⇒ Task submitted (not working: nothing executes); tasks/get tracks the flip to completed', async () => {
  const { id, commission } = arena({ standing: false })
  const posted = await call('POST', `/a2a/projects/${id}`, sendMsg('a2a-later', { type: 'charge', target: 'budget:demo' }), { 'x-tenant-id': B })
  const task = posted.json.result
  assert.equal(task.status.state, 'submitted', 'open = awaiting a taker')

  // The D19 re-dispatch moment (a commission newly flipped to standing) is visible through tasks/get.
  await call('PATCH', `/commissions/${commission.id}`, { standing: true }, { 'x-tenant-id': A })
  const read = await call('POST', `/a2a/projects/${id}`, rpc('tasks/get', { id: task.id }), { 'x-tenant-id': B })
  assert.equal(read.json.result.status.state, 'completed', 'the lifecycle image tracks the item')
})

test('a Project the caller cannot see answers exactly like a nonexistent one (TaskNotFound)', async () => {
  const id = `p-a2a-hidden-${(n += 1)}`
  store.applyRelationOp({ kind: 'create-project', projectId: id, projectName: 'Hidden', projectDescription: '' }, A)
  const hidden = await call('POST', `/a2a/projects/${id}`, sendMsg('x', { type: 'charge', target: 't' }), { 'x-tenant-id': B })
  const ghost = await call('POST', '/a2a/projects/p-no-such', sendMsg('x', { type: 'charge', target: 't' }), { 'x-tenant-id': B })
  assert.equal(hidden.json.error.code, -32001)
  assert.equal(ghost.json.error.code, -32001, 'existence-hiding: private ≡ nonexistent')
  // The owner, of course, can post to its own private project through A2A too.
  const own = await call('POST', `/a2a/projects/${id}`, sendMsg('own-item', { type: 'charge', target: 'budget:demo' }), { 'x-tenant-id': A })
  assert.equal(own.json.result.kind, 'task')
})

test('JSON-RPC error mapping: bad params, unknown method, uncancelable, invalid request', async () => {
  const { id } = arena()
  const noData = await call('POST', `/a2a/projects/${id}`, sendMsg('missing-descriptor'), { 'x-tenant-id': A })
  assert.equal(noData.json.error.code, -32602, 'message/send without the effect data part')
  const badType = await call('POST', `/a2a/projects/${id}`, sendMsg('bad-type', { type: 'nonsense', target: 't' }), { 'x-tenant-id': A })
  assert.equal(badType.json.error.code, -32602, 'an unknown effect type')
  const unknown = await call('POST', `/a2a/projects/${id}`, rpc('tasks/resubscribe'), { 'x-tenant-id': A })
  assert.equal(unknown.json.error.code, -32601)
  // tasks/cancel is now the D23 retract act (server/routes/work-discussion.test.ts locks the
  // lifecycle); at the error-mapping level, an UNKNOWN task id is TaskNotFound.
  const cancel = await call('POST', `/a2a/projects/${id}`, rpc('tasks/cancel', { id: 'work-no-such' }), { 'x-tenant-id': A })
  assert.equal(cancel.json.error.code, -32001, 'cancel of an unknown task ⇒ TaskNotFound')
  const shapeless = await call('POST', `/a2a/projects/${id}`, { hello: 'world' }, { 'x-tenant-id': A })
  assert.equal(shapeless.json.error.code, -32600, 'not a JSON-RPC request')
  assert.equal(shapeless.json.id, null, 'no readable id ⇒ null')
  const noMethod = await call('POST', `/a2a/projects/${id}`, { jsonrpc: '2.0', id: 7 }, { 'x-tenant-id': A })
  assert.equal(noMethod.json.error.code, -32600)
  assert.equal(noMethod.json.id, 7, 'a readable id is echoed so the client can correlate')
  const ghostTask = await call('POST', `/a2a/projects/${id}`, rpc('tasks/get', { id: 'work-no-such' }), { 'x-tenant-id': A })
  assert.equal(ghostTask.json.error.code, -32001)
})

test('message/send to a published Agent is REFUSED with a rejected Task naming fork-and-bind (D18)', async () => {
  const agent = store.createAgent({ label: 'Refuses Tasking', systemPrompt: 'x', tools: [], instructions: '' }, A)
  await call('PATCH', `/agents/${agent.id}`, { published: true }, { 'x-tenant-id': A })
  const res = await call('POST', `/a2a/agents/${agent.id}`, sendMsg('do my work'), { 'x-tenant-id': B })
  assert.equal(res.status, 200, 'a protocol-level refusal, not a transport error')
  const task = res.json.result
  assert.equal(task.status.state, 'rejected')
  const text = task.status.message.parts.find((p: any) => p.kind === 'text').text
  assert.match(text, /capability never/i, 'the D18 wall, spoken in protocol')
  assert.match(text, new RegExp(`/agents/${agent.id}/fork`), 'and the fork path is pointed to')
  // No open work landed anywhere as a side effect of the refusal.
  const tasksGet = await call('POST', `/a2a/agents/${agent.id}`, rpc('tasks/get', { id: task.id }), { 'x-tenant-id': B })
  assert.equal(tasksGet.json.error.code, -32001, 'the endpoint holds no tasks')
})
