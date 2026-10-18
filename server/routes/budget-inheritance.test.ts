/** Mint/regrant inheritance over the normal signed-cookie APIs. These operations
 * configure sparse budgets only; an I/O sentinel forbids any model request. */
import { after, afterEach, before, mock, test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import type { Agent, Budget, Commission, ModelProvider } from '../../contract/index.ts'
import { accounts } from '../accounts.ts'
import { SESSION_COOKIE, signSession } from '../auth.ts'
import { store } from '../store/index.ts'
import { call, callFresh } from '../testkit/http.ts'

const FIVE_HOUR = '5-hour limit'
const WEEKLY = 'Weekly · all models'
const sparse = (label: string, ceiling: number): Budget => ({ windows: [{ label, ceiling }] })
const full = (fiveHour: number, weekly: number): Budget => ({ windows: [
  { label: FIVE_HOUR, ceiling: fiveHour }, { label: WEEKLY, ceiling: weekly },
] })
let modelRequests = 0
before(() => {
  mock.method(globalThis, 'fetch', async () => {
    modelRequests += 1
    throw new Error('Budget configuration must never perform model I/O.')
  })
})
afterEach(() => assert.equal(modelRequests, 0, 'budget configuration performs no model I/O'))
after(() => mock.restoreAll())

async function fixture(plan: Budget) {
  const stamp = randomUUID()
  const org = accounts.createOrg('user-ada', `Sparse budget ${stamp}`)
  assert.ok(org)
  const headers = { cookie: `${SESSION_COOKIE}=${signSession({ userId: 'user-ada', tenantId: org.id, iat: Date.now() })}` }
  const providerResponse = await call('POST', '/providers', {
    label: `Budget provider ${stamp}`, modelFamily: 'claude', effortLevels: [], plan,
  }, headers)
  assert.equal(providerResponse.status, 200)
  const provider = providerResponse.json as ModelProvider
  assert.deepEqual(provider.plan, plan, 'provider definition itself stays sparse')
  const prompt = await call('POST', '/system-prompts', {
    label: `Budget prompt ${stamp}`, body: 'Answer briefly.', targetFamily: 'claude',
  }, headers)
  assert.equal(prompt.status, 200)
  const project = await call('POST', '/projects', { name: `Budget Project ${stamp}` }, headers)
  assert.equal(project.status, 201)
  return { headers, tenantId: org.id, provider, promptId: prompt.json.id as string, projectId: project.json.project.id as string }
}
type Fixture = Awaited<ReturnType<typeof fixture>>

function agentRequest(f: Fixture, budget?: Budget) {
  return { label: `Sparse Agent ${randomUUID()}`, providerId: f.provider.id, systemPromptId: f.promptId,
    tools: [], ...(budget === undefined ? {} : { budget }) }
}

async function agent(f: Fixture, budget?: Budget): Promise<Agent> {
  const response = await call('POST', '/agents', agentRequest(f, budget), f.headers)
  assert.equal(response.status, 200, `fixture Agent: ${JSON.stringify(response.json)}`)
  assert.deepEqual(response.json.budget, budget)
  return response.json
}

function commissionRequest(f: Fixture, agentId: string, grant?: Budget) {
  return { agentId, projectId: f.projectId, role: 'writer', ...(grant === undefined ? {} : { grant }) }
}

async function commission(f: Fixture, agentId: string): Promise<Commission> {
  const response = await call('POST', '/commissions', commissionRequest(f, agentId), f.headers)
  assert.equal(response.status, 200)
  return response.json
}

async function state(f: Fixture) {
  const paths = ['/agents', `/commissions?project=${f.projectId}`, `/providers/${f.provider.id}`, '/projects', '/usage']
  const responses = await Promise.all(paths.map(path => call('GET', path, undefined, f.headers)))
  for (const response of responses) assert.equal(response.status, 200)
  return responses.map(response => response.json)
}

async function quietRefusal(f: Fixture, method: 'POST' | 'PATCH', path: string, body: unknown, status: number) {
  const before = await state(f)
  const events: unknown[] = []
  const unsubscribe = store.subscribe(event => events.push(event))
  try {
    const response = await call(method, path, body, { ...f.headers, 'idempotency-key': randomUUID() })
    assert.equal(response.status, status, JSON.stringify(response.json))
    assert.equal(response.json.error.code, status === 409 ? 'conflict' : 'bad_request')
    assert.deepEqual(await state(f), before, 'refusal preserves rows, revisions, grants, Project and usage')
    assert.deepEqual(events, [], 'refusal publishes no mutation event')
  } finally {
    unsubscribe()
  }
}

for (const method of ['POST', 'PATCH'] as const) {
  test(`Agent ${method} inherits an omitted provider window, stores sparse intent and preserves replay/CAS`, async () => {
    const f = await fixture(sparse(FIVE_HOUR, 1_000))
    const requested = sparse(WEEKLY, 10_000)
    const initial = method === 'PATCH' ? await agent(f) : undefined
    const path = initial ? `/agents/${initial.id}` : '/agents'
    const body = initial ? { budget: requested, expectedRevision: 0 } : agentRequest(f, requested)
    const headers = { ...f.headers, 'idempotency-key': randomUUID() }
    const events: unknown[] = []
    const unsubscribe = store.subscribe(event => events.push(event))
    try {
      const response = await call(method, path, body, headers)
      assert.equal(response.status, 200, 'weekly budget inherits the omitted provider window from the account')
      assert.deepEqual(response.json.budget, requested, 'inherited windows are not materialized into saved intent')
      assert.equal(response.json.revision, initial ? 1 : 0)
      assert.deepEqual((await call('GET', `/agents/${response.json.id}`, undefined, f.headers)).json.budget, requested)
      const after = await state(f)
      const eventCount = events.length
      assert.ok(eventCount > 0, 'the first successful configuration emits its mutation')
      const cached = await call(method, path, body, headers)
      assert.equal(cached.status, 200)
      assert.equal(cached.headers['idempotency-replayed'], 'true')
      assert.deepEqual(cached.json, response.json)
      if (method === 'POST') {
        const durable = await callFresh('POST', path, { ...body, label: 'Changed replay must not mint again' }, headers)
        assert.equal(durable.status, 200)
        assert.deepEqual(durable.json, response.json)
      }
      assert.deepEqual(await state(f), after)
      assert.equal(events.length, eventCount, 'keyed replay publishes nothing and advances no revision')
      const ownAgents = (await call('GET', '/agents', undefined, f.headers)).json as Agent[]
      assert.equal(ownAgents.filter(row => row.tenantId === f.tenantId).length, 1, 'one logical Agent exists')
    } finally {
      unsubscribe()
    }
    if (initial) await quietRefusal(f, 'PATCH', path, { budget: sparse(WEEKLY, 9_000), expectedRevision: 0 }, 409)
  })
}

const commissionCases = [
  { label: 'omitted Agent window', plan: full(1_000, 10_000), budget: sparse(FIVE_HOUR, 500), grant: sparse(WEEKLY, 5_000) },
  { label: 'omitted provider window with absent Agent budget', plan: sparse(FIVE_HOUR, 1_000), budget: undefined, grant: sparse(WEEKLY, 10_000) },
  { label: 'window omitted by both partial parents', plan: sparse(FIVE_HOUR, 1_000), budget: sparse(FIVE_HOUR, 500), grant: sparse(WEEKLY, 10_000) },
] satisfies Array<{ label: string; plan: Budget; budget?: Budget; grant: Budget }>

for (const method of ['POST', 'PATCH'] as const) {
  for (const scenario of commissionCases) {
    test(`Commission ${method} inherits ${scenario.label} without widening stored grant`, async () => {
      const f = await fixture(scenario.plan)
      const ownerAgent = await agent(f, scenario.budget)
      const initial = method === 'PATCH' ? await commission(f, ownerAgent.id) : undefined
      const path = initial ? `/commissions/${initial.id}` : '/commissions'
      const body = initial ? { grant: scenario.grant, expectedRevision: 0 } : commissionRequest(f, ownerAgent.id, scenario.grant)
      const headers = { ...f.headers, 'idempotency-key': randomUUID() }
      const events: unknown[] = []
      const unsubscribe = store.subscribe(event => events.push(event))
      try {
        const response = await call(method, path, body, headers)
        assert.equal(response.status, 200, 'the valid grant attenuates the complete inherited parent ceilings')
        assert.deepEqual(response.json.grant, scenario.grant)
        assert.equal(response.json.configurationRevision, initial ? 1 : 0)
        const saved = await call('GET', `/commissions/${response.json.id}`, undefined, f.headers)
        assert.equal(saved.status, 200)
        assert.deepEqual(saved.json.grant, scenario.grant)
        const after = await state(f)
        const eventCount = events.length
        assert.ok(eventCount > 0)
        const replay = await call(method, path, body, headers)
        assert.equal(replay.status, 200)
        assert.equal(replay.headers['idempotency-replayed'], 'true')
        assert.deepEqual(replay.json, response.json)
        if (method === 'POST') {
          const durable = await callFresh('POST', path, { ...body, role: 'reader' }, headers)
          assert.equal(durable.status, 200)
          assert.equal(durable.json.mine, true, 'durable lookup stamps its existing owner-relative projection')
          assert.deepEqual(durable.json, { ...response.json, mine: true }, 'durable create replay preserves the exact identity, role, grant and revision')
        }
        assert.deepEqual(await state(f), after)
        assert.equal(events.length, eventCount)
        const owned = await call('GET', `/commissions?project=${f.projectId}`, undefined, f.headers)
        assert.equal(owned.json.length, 1, 'one logical Commission exists')
      } finally {
        unsubscribe()
      }
      if (initial) await quietRefusal(f, 'PATCH', path, { grant: scenario.grant, expectedRevision: 0 }, 409)
    })
  }
}

for (const method of ['POST', 'PATCH'] as const) {
  test(`Agent ${method} treats an empty provider plan as inheritance, retaining a sparse child`, async () => {
    const f = await fixture({ windows: [] })
    const requested = sparse(FIVE_HOUR, 1_000)
    const initial = method === 'PATCH' ? await agent(f) : undefined
    const response = initial
      ? await call('PATCH', `/agents/${initial.id}`, { budget: requested, expectedRevision: 0 }, f.headers)
      : await call('POST', '/agents', agentRequest(f, requested), f.headers)
    assert.equal(response.status, 200)
    assert.deepEqual(response.json.budget, requested)
    assert.deepEqual((await call('GET', `/providers/${f.provider.id}`, undefined, f.headers)).json.plan, { windows: [] })
  })

  test(`Commission ${method} treats an empty Agent budget as inheritance`, async () => {
    const f = await fixture(full(1_000, 10_000))
    const ownerAgent = await agent(f, { windows: [] })
    const requested = sparse(WEEKLY, 5_000)
    const initial = method === 'PATCH' ? await commission(f, ownerAgent.id) : undefined
    const response = initial
      ? await call('PATCH', `/commissions/${initial.id}`, { grant: requested, expectedRevision: 0 }, f.headers)
      : await call('POST', '/commissions', commissionRequest(f, ownerAgent.id, requested), f.headers)
    assert.equal(response.status, 200)
    assert.deepEqual(response.json.grant, requested)
    assert.deepEqual((await call('GET', `/agents/${ownerAgent.id}`, undefined, f.headers)).json.budget, { windows: [] })
  })
}

for (const method of ['POST', 'PATCH'] as const) {
  test(`Agent ${method} rejects unknown and excessive inherited windows without state, revision or event changes`, async () => {
    const f = await fixture(sparse(FIVE_HOUR, 1_000))
    const initial = method === 'PATCH' ? await agent(f) : undefined
    for (const invalid of [sparse('Unrecognized window', 1), sparse(FIVE_HOUR, 1_001), sparse(WEEKLY, 24_000_001)]) {
      await quietRefusal(f, method, initial ? `/agents/${initial.id}` : '/agents',
        initial ? { budget: invalid, expectedRevision: 0 } : agentRequest(f, invalid), 400)
    }
  })

  test(`Commission ${method} rejects unknown and parent/Agent over-grants without mutation`, async () => {
    const f = await fixture(full(1_000, 10_000))
    const ownerAgent = await agent(f, sparse(FIVE_HOUR, 500))
    const initial = method === 'PATCH' ? await commission(f, ownerAgent.id) : undefined
    for (const invalid of [sparse('Unrecognized window', 1), sparse(FIVE_HOUR, 501), sparse(WEEKLY, 10_001)]) {
      await quietRefusal(f, method, initial ? `/commissions/${initial.id}` : '/commissions',
        initial ? { grant: invalid, expectedRevision: 0 } : commissionRequest(f, ownerAgent.id, invalid), 400)
    }
  })
}
