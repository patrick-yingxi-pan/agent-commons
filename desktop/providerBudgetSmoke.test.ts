import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { patchProviderSmokeCeiling, assertProviderSmokeBudget, assertProviderSmokeBudgetRefusal } from './providerBudgetSmoke.mjs'
import { ignoreFromPackage } from './packager.config.mjs'

const source = (name: string) => readFileSync(new URL(name, import.meta.url), 'utf8')

test('the provider budget acceptance helper never ships or writes through its SQLite observer', () => {
  assert.equal(ignoreFromPackage('/desktop/providerBudgetSmoke.mjs'), true)
  assert.doesNotMatch(source('./providerBudgetSmoke.mjs'), /node:sqlite|store\.\w+\(/)
})

test('budget setup patches the exact provider under its fresh revision, preserving other windows', async t => {
  const calls: Array<{ path: string; init?: RequestInit }> = []
  const provider = { id: 'provider-budget', definitionRevision: 4,
    plan: { windows: [{ label: 'Weekly · all models', ceiling: 5000 }, { label: '5-hour limit', ceiling: 1000 }] } }
  t.mock.method(globalThis, 'fetch', async (path, init) => {
    calls.push({ path: String(path), init })
    if (!init) return Response.json(provider)
    const body = JSON.parse(String(init.body))
    return Response.json({ ...provider, definitionRevision: 5, plan: body.plan })
  })
  const page = { evaluate: (fn: any, input: any) => fn(input) }
  const saved = await patchProviderSmokeCeiling(page, provider.id, 60)
  assert.equal(calls.length, 2)
  assert.ok(calls.every(call => call.path === '/api/v1/providers/provider-budget'))
  assert.equal(calls[1].init?.method, 'PATCH')
  const headers = new Headers(calls[1].init?.headers)
  assert.match(headers.get('idempotency-key')!, /^[0-9a-f-]{36}$/)
  assert.deepEqual(JSON.parse(String(calls[1].init?.body)), { expectedRevision: 4,
    plan: { windows: [{ label: 'Weekly · all models', ceiling: 5000 }, { label: '5-hour limit', ceiling: 60 }] } })
  assert.deepEqual(saved.plan.windows, [{ label: 'Weekly · all models', ceiling: 5000 }, { label: '5-hour limit', ceiling: 60 }])
})

test('budget setup refuses missing providers, revision conflicts and false acknowledgements', async t => {
  const provider = { id: 'provider-budget', definitionRevision: 4 }
  const page = { evaluate: (fn: any, input: any) => fn(input) }
  for (const scenario of ['missing', 'conflict', 'unchanged-revision', 'wrong-plan', 'wrong-provider']) {
    let calls = 0
    const mock = t.mock.method(globalThis, 'fetch', async (_path, init) => {
      calls++
      if (!init) return Response.json(provider, { status: scenario === 'missing' ? 404 : 200 })
      const body = JSON.parse(String(init.body))
      return Response.json({ ...provider, id: scenario === 'wrong-provider' ? 'another-provider' : provider.id,
        definitionRevision: scenario === 'unchanged-revision' ? 4 : 5,
        plan: scenario === 'wrong-plan' ? { windows: [] } : body.plan }, { status: scenario === 'conflict' ? 409 : 200 })
    })
    await assert.rejects(patchProviderSmokeCeiling(page, provider.id, 60), assert.AssertionError)
    assert.equal(calls, scenario === 'missing' ? 1 : 2)
    mock.mock.restore()
  }
})

test('restored-budget and refusal assertions reject lost policy, effects, spend and outbound calls', () => {
  const before = { provider: { id: 'provider-budget', definitionRevision: 5, plan: { windows: [{ label: '5-hour limit', ceiling: 60 }] } },
    config: { apiKeyEnv: 'PROVIDER_TEST_REFERENCE' }, session: { id: 'session-budget', messages: [{ role: 'user', content: 'Existing row' }] },
    usage: { fiveHour: { consumed: 60 }, weekly: { consumed: 60 } } }
  const response = { status: 429, body: { error: { code: 'limit_exceeded' } } }
  assertProviderSmokeBudget(before, before.provider)
  assertProviderSmokeBudgetRefusal(response, before, structuredClone(before), 5, 5)
  const lost = structuredClone(before)
  lost.provider.plan.windows[0].ceiling = 1000
  assert.throws(() => assertProviderSmokeBudget(lost, before.provider), assert.AssertionError)
  for (const field of ['session', 'usage', 'provider', 'config']) {
    const changed = structuredClone(before)
    Object.assign(changed[field], { unexpectedMutation: true })
    assert.throws(() => assertProviderSmokeBudgetRefusal(response, before, changed, 5, 5), assert.AssertionError)
  }
  assert.throws(() => assertProviderSmokeBudgetRefusal(response, before, before, 5, 6), assert.AssertionError)
  assert.throws(() => assertProviderSmokeBudgetRefusal({ ...response, status: 200 }, before, before, 5, 5), assert.AssertionError)
  assert.throws(() => assertProviderSmokeBudgetRefusal({ status: 429, body: { error: { code: 'different_refusal' } } }, before, before, 5, 5), assert.AssertionError)
})

test('both packaged provider workflows persist a narrowed plan before relaunch and assert a real refused user action', () => {
  for (const [name, ceiling] of [['./openaiResponsesSmoke.mjs', 60], ['./messagesSmoke.mjs', 40]] as const) {
    const smoke = source(name)
    const save = smoke.indexOf(`patchProviderSmokeCeiling(page, provider.id, ${ceiling})`)
    assert.ok(save > 0, `${name} saves its consumed provider ceiling`)
    const close = smoke.indexOf('await close(run)', save)
    const restored = smoke.indexOf('assertProviderSmokeBudget(', close)
    const refusal = smoke.indexOf('assertProviderSmokeBudgetRefusal(', restored)
    const repair = smoke.indexOf('patchProviderSmokeCeiling(page, provider.id, 1000)', refusal)
    assert.ok(close > save && restored > close && refusal > restored && repair > refusal, `${name} keeps native relaunch, real refusal and explicit repair in order`)
    assert.ok(smoke.includes("const budgetRefusal = page.waitForResponse(response => response.request().method() === 'POST'"))
  }
})
