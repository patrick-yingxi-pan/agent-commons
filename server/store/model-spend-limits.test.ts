/** Model admission intersects every applicable budget before a new Dispatch
 * writes history. All providers are inert fixtures; no model worker is started. */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Budget } from '../../contract/index.ts'
import type { RealDispatchInput } from '../../contract/dispatchExecution.ts'
import type { EndpointProtocol } from '../../contract/providers.ts'
import { ValidationError } from '../conflict.ts'
import { manualDispatchRunId } from '../dispatchIdentity.ts'
import { LimitError } from '../limit.ts'
import { store } from './index.ts'

const FIVE_HOUR = '5-hour limit'
const WEEKLY = 'Weekly · all models'
const MODEL = 'spend-admission-fixture-model'
let sequence = 0
const budget = (fiveHour?: number, weekly?: number): Budget => ({ windows: [
  ...(fiveHour === undefined ? [] : [{ label: FIVE_HOUR, ceiling: fiveHour }]),
  ...(weekly === undefined ? [] : [{ label: WEEKLY, ceiling: weekly }]),
] })

interface FixtureOptions {
  protocol?: EndpointProtocol
  parentPlan?: Budget
  selectedPlan?: Budget
  agentBudget?: Budget
}

function fixture(options: FixtureOptions = {}) {
  const tenantId = `tenant-model-spend-${++sequence}`
  const makeProvider = (label: string, plan?: Budget) => store.createProvider({
    label, modelFamily: 'custom', effortLevels: [], models: [{ id: MODEL, label: 'Spend admission model' }],
    ...(plan === undefined ? {} : { plan }),
  }, { protocol: options.protocol ?? 'anthropic-messages', baseURL: 'https://spend-fixture.invalid/v1',
    model: MODEL, capabilities: { toolUse: false } }, tenantId)
  const parent = makeProvider('Agent parent provider', options.parentPlan)
  const selected = makeProvider('Explicit selected provider', options.selectedPlan)
  const agent = store.createAgent({ label: 'Budget inheritance Agent', systemPrompt: 'Complete the reviewed task.',
    instructions: '', tools: [], providerId: parent.id,
    ...(options.agentBudget === undefined ? {} : { budget: options.agentBudget }),
  }, tenantId)
  const input: RealDispatchInput = { title: 'Budget admission regression', execution: {
    agentId: agent.id, providerId: selected.id, modelId: MODEL,
  } }
  const runId = manualDispatchRunId(tenantId, 'model-spend-fixture-request')
  return { tenantId, parent, selected, agent, input, runId, close() {
    for (const run of store.listDispatch(tenantId)) {
      if (run.execution?.state === 'running') store.settleRealDispatch(run.id, tenantId, 'error')
      if (run.execution?.sessionId) store.removeSession(run.execution.sessionId)
    }
    store.deleteAgent(agent.id)
    store.deleteProvider(parent.id)
    store.deleteProvider(selected.id)
  } }
}

const refusals: Array<{ name: string; options: FixtureOptions; expected: { label: string; ceiling: number } }> = [
  { name: 'omitted Agent budget retains its original parent cap under a looser provider override',
    options: { parentPlan: budget(100, 1_000), selectedPlan: budget(1_000, 1_000) },
    expected: { label: FIVE_HOUR, ceiling: 100 } },
  { name: 'omitted Agent budget retains the parent when the selected provider declares no plan',
    options: { parentPlan: budget(100, 1_000) }, expected: { label: FIVE_HOUR, ceiling: 100 } },
  { name: 'selected provider tightens the original parent and an omitted Agent budget',
    options: { parentPlan: budget(1_000, 1_000), selectedPlan: budget(100, 1_000) },
    expected: { label: FIVE_HOUR, ceiling: 100 } },
  { name: 'explicit Agent cap cannot be widened by either provider',
    options: { parentPlan: budget(1_000, 1_000), selectedPlan: budget(1_000, 1_000), agentBudget: budget(100) },
    expected: { label: FIVE_HOUR, ceiling: 100 } },
  { name: 'partial Agent budget inherits the omitted original-parent weekly window',
    options: { parentPlan: budget(1_000, 100), selectedPlan: budget(1_000, 1_000), agentBudget: budget(500) },
    expected: { label: WEEKLY, ceiling: 100 } },
  { name: 'partial Agent budget also inherits a tighter selected-provider weekly window',
    options: { parentPlan: budget(1_000, 1_000), selectedPlan: budget(1_000, 100), agentBudget: budget(500) },
    expected: { label: WEEKLY, ceiling: 100 } },
]

for (const protocol of ['anthropic-messages', 'openai-responses'] as const) {
  for (const scenario of refusals) {
    test(`${protocol} Dispatch refusal: ${scenario.name}`, () => {
      const f = fixture({ ...scenario.options, protocol })
      const originalFetch = globalThis.fetch
      let providerCalls = 0
      globalThis.fetch = async () => { providerCalls++; throw new Error('A refused Dispatch must not make a provider request.') }
      try {
        store.recordUsage(100, 0, f.tenantId)
        const before = { sessions: store.listSessions(f.tenantId).length, jobs: store.listDispatch(f.tenantId).length,
          providers: structuredClone(store.listProviders(f.tenantId)), usage: structuredClone(store.usage(undefined, f.tenantId).limits) }
        const events: string[] = []
        const unsubscribe = store.subscribe(event => { events.push(event.type) })
        try {
          assert.throws(() => store.startRealDispatch(f.input, f.tenantId, f.runId),
            error => error instanceof LimitError && /Plan limit reached/.test(error.message))
        } finally { unsubscribe() }
        assert.deepEqual(store.modelSpendLimit(f.agent, f.selected, f.tenantId), scenario.expected)
        assert.equal(store.getRealDispatch(f.runId, f.tenantId), undefined)
        assert.equal(store.listSessions(f.tenantId).length, before.sessions)
        assert.equal(store.listDispatch(f.tenantId).length, before.jobs)
        assert.deepEqual(store.listProviders(f.tenantId), before.providers)
        assert.deepEqual(store.usage(undefined, f.tenantId).limits, before.usage)
        assert.deepEqual(events, [], 'spend refusal precedes any durable or ambient mutation')
        assert.equal(providerCalls, 0)
      } finally { globalThis.fetch = originalFetch; f.close() }
    })
  }
}

test('modelSpendLimit includes additional grants in the same minimum and does not mutate inputs', () => {
  const f = fixture({ parentPlan: budget(300, 500), selectedPlan: budget(200, 400), agentBudget: budget(150) })
  try {
    const extra = [undefined, budget(100), budget(undefined, 250)] as const
    const before = structuredClone({ agent: f.agent, selected: f.selected, extra })
    store.recordUsage(99, 0, f.tenantId)
    assert.equal(store.modelSpendLimit(f.agent, f.selected, f.tenantId, extra), null)
    store.recordUsage(1, 0, f.tenantId)
    assert.deepEqual(store.modelSpendLimit(f.agent, f.selected, f.tenantId, extra), { label: FIVE_HOUR, ceiling: 100 })
    assert.equal(store.modelSpendLimit(f.agent, f.selected, f.tenantId), null, 'the extra grant is the only exhausted constraint')
    assert.deepEqual({ agent: f.agent, selected: f.selected, extra }, before)
  } finally { f.close() }
})

test('modelSpendLimit preserves the account ceiling when all optional grants are absent', () => {
  const f = fixture()
  try {
    const account = store.usage(undefined, f.tenantId).limits[0]!
    assert.equal(store.modelSpendLimit(f.agent, f.selected, f.tenantId), null)
    store.recordUsage(account.limitTokens!, 0, f.tenantId)
    assert.deepEqual(store.modelSpendLimit(f.agent, f.selected, f.tenantId), { label: account.label, ceiling: account.limitTokens })
  } finally { f.close() }
})

test('completed exact Dispatch replay precedes exhausted inherited limits and retains the original result', () => {
  const f = fixture({ parentPlan: budget(100, 1_000), selectedPlan: budget(1_000, 1_000) })
  try {
    store.recordUsage(99, 0, f.tenantId)
    const run = store.startRealDispatch(f.input, f.tenantId, f.runId)
    const result = { id: store.mintMessageId('assistant'), role: 'assistant' as const, content: 'The original saved result.' }
    assert.equal(store.settleRealDispatch(run.id, f.tenantId, 'ok', result), true)
    store.recordUsage(1, 0, f.tenantId)
    const before = { run: structuredClone(store.getRealDispatch(run.id, f.tenantId)),
      session: structuredClone(store.getSession(run.execution!.sessionId)),
      jobs: store.listDispatch(f.tenantId).length, usage: structuredClone(store.usage(undefined, f.tenantId).limits) }
    assert.deepEqual(store.modelSpendLimit(f.agent, f.selected, f.tenantId), { label: FIVE_HOUR, ceiling: 100 })
    const replay = store.startRealDispatch({ ...f.input, title: 'A retry cannot replace the saved intent.' }, f.tenantId, f.runId)
    assert.deepEqual(replay, before.run)
    assert.deepEqual(store.getSession(run.execution!.sessionId), before.session)
    assert.equal(store.listDispatch(f.tenantId).length, before.jobs)
    assert.deepEqual(store.usage(undefined, f.tenantId).limits, before.usage)
  } finally { f.close() }
})

test('modelSpendLimit refuses missing and foreign providers without default fallback, I/O or mutation', () => {
  for (const scenario of ['missing parent', 'foreign parent', 'missing selected', 'foreign selected', 'omitted selected'] as const) {
    const f = fixture({ parentPlan: budget(500), selectedPlan: budget(500) })
    const originalFetch = globalThis.fetch
    let providerCalls = 0
    let foreignProviderId: string | undefined
    globalThis.fetch = async () => { providerCalls++; throw new Error('Provider-scope refusal must precede I/O.') }
    try {
      let agent = f.agent
      let selected: typeof f.selected | undefined = f.selected
      if (scenario.startsWith('foreign')) {
        const foreign = store.createProvider({ label: 'Foreign budget provider', modelFamily: 'custom', effortLevels: [], plan: budget(500) },
          { model: MODEL }, `${f.tenantId}-foreign`)
        foreignProviderId = foreign.id
        if (scenario === 'foreign parent') agent = { ...f.agent, providerId: foreign.id }
        else selected = foreign
      } else if (scenario === 'missing parent') {
        store.deleteAgent(f.agent.id)
        store.deleteProvider(f.parent.id)
      } else if (scenario === 'missing selected') {
        store.deleteProvider(f.selected.id)
      } else selected = undefined

      const snapshot = () => ({ sessions: store.listSessions(f.tenantId), jobs: store.listDispatch(f.tenantId),
        agents: store.listAgents(f.tenantId), providers: store.listProviders(f.tenantId), usage: store.usage(undefined, f.tenantId).limits })
      const before = structuredClone(snapshot())
      const events: string[] = []
      const unsubscribe = store.subscribe(event => { events.push(event.type) })
      try {
        assert.throws(() => store.modelSpendLimit(agent, selected, f.tenantId),
          error => error instanceof ValidationError && /provider budget is unavailable/.test(error.message), scenario)
      } finally { unsubscribe() }
      assert.deepEqual(snapshot(), before, `${scenario}: refusal changes no registry, history or usage`)
      assert.deepEqual(events, [], `${scenario}: refusal publishes no mutation`)
      assert.equal(providerCalls, 0, `${scenario}: no provider request can escape`)
    } finally {
      globalThis.fetch = originalFetch
      f.close()
      if (foreignProviderId) store.deleteProvider(foreignProviderId)
    }
  }
})

test('modelSpendLimit uses the narrowed live selected-provider plan instead of a captured older face', () => {
  const f = fixture({ parentPlan: budget(500), selectedPlan: budget(200) })
  const originalFetch = globalThis.fetch
  let providerCalls = 0
  globalThis.fetch = async () => { providerCalls++; throw new Error('Budget admission must not probe the provider.') }
  try {
    const captured = structuredClone(f.selected)
    store.recordUsage(100, 0, f.tenantId)
    assert.equal(store.modelSpendLimit(f.agent, captured, f.tenantId), null)
    store.updateProvider(f.selected.id, { plan: budget(100) })
    assert.equal(captured.plan?.windows[0]?.ceiling, 200, 'the caller still holds the wider pre-edit face')
    const before = structuredClone({ sessionCount: store.listSessions(f.tenantId).length,
      jobs: store.listDispatch(f.tenantId), usage: store.usage(undefined, f.tenantId).limits })
    const events: string[] = []
    const unsubscribe = store.subscribe(event => { events.push(event.type) })
    try {
      assert.deepEqual(store.modelSpendLimit(f.agent, captured, f.tenantId), { label: FIVE_HOUR, ceiling: 100 },
        'the current registry plan remains authoritative despite the stale selected-provider argument')
    } finally { unsubscribe() }
    assert.deepEqual({ sessionCount: store.listSessions(f.tenantId).length,
      jobs: store.listDispatch(f.tenantId), usage: store.usage(undefined, f.tenantId).limits }, before)
    assert.deepEqual(events, [])
    assert.equal(providerCalls, 0)
  } finally { globalThis.fetch = originalFetch; f.close() }
})
