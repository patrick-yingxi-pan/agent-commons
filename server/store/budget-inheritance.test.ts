/** Mint-time inheritance and transitive narrowing through the real in-memory
 * store. Sparse definitions stay sparse; only explicit child grants clamp. */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Budget, ServerEvent } from '../../contract/index.ts'
import { BudgetError } from '../usage.ts'
import { store } from './index.ts'

const FIVE = '5-hour limit'
const WEEK = 'Weekly · all models'
let sequence = 0
const budget = (five?: number, weekly?: number): Budget => ({ windows: [
  ...(five === undefined ? [] : [{ label: FIVE, ceiling: five }]),
  ...(weekly === undefined ? [] : [{ label: WEEK, ceiling: weekly }]),
] })

function fixture(plan: Budget = budget(500, 1_000)) {
  const tenantId = `tenant-budget-inheritance-${++sequence}`
  const projectId = store.listProjects()[0]!.id
  const provider = (nextPlan: Budget) => store.createProvider({ label: `Sparse provider ${sequence}`,
    modelFamily: 'custom', effortLevels: [], plan: nextPlan }, {}, tenantId)
  const parent = provider(plan)
  const agent = (nextBudget?: Budget) => store.createAgent({ label: `Sparse Agent ${sequence}`,
    systemPrompt: 'Keep the explicit grants.', instructions: '', tools: [], providerId: parent.id,
    ...(nextBudget === undefined ? {} : { budget: nextBudget }),
  }, tenantId)
  const commission = (agentId: string, grant?: Budget) => store.createCommission({ agentId, projectId, role: 'writer',
    ...(grant === undefined ? {} : { grant }) }, tenantId)
  const snapshot = () => structuredClone({ agents: store.listAgents(tenantId), providers: store.listProviders(tenantId),
    commissions: store.listCommissions(undefined, tenantId), usage: store.usage(undefined, tenantId).limits })
  return { tenantId, parent, projectId, provider, agent, commission, snapshot, close() {
    for (const row of store.listCommissions(undefined, tenantId)) if (row.tenantId === tenantId) store.deleteCommission(row.id)
    for (const row of store.listAgents(tenantId)) if (row.tenantId === tenantId) store.deleteAgent(row.id)
    for (const row of store.listProviders(tenantId)) if (row.tenantId === tenantId) store.deleteProvider(row.id)
  } }
}

function observed<T>(act: () => T): { result: T; events: ServerEvent[] } {
  const events: ServerEvent[] = []
  const unsubscribe = store.subscribe(event => { events.push(event) })
  try { return { result: act(), events } } finally { unsubscribe() }
}

test('Agent create and update can tighten a window omitted by a sparse provider without materializing inheritance', () => {
  const f = fixture(budget(100))
  try {
    const created = f.agent(budget(undefined, 500))
    assert.deepEqual(created.budget, budget(undefined, 500))
    const empty = f.agent(budget())
    assert.deepEqual(empty.budget, budget())
    const updated = store.updateAgentFromRequest(empty.id, { budget: budget(undefined, 400) }, empty.revision)!
    assert.deepEqual(updated.budget, budget(undefined, 400))
    assert.equal(updated.revision, (empty.revision ?? 0) + 1)
    const cleared = store.updateAgentFromRequest(updated.id, { budget: budget() }, updated.revision)!
    assert.deepEqual(cleared.budget, budget(), 'empty still means inherit, not zero and not an expanded copy')
  } finally { f.close() }
})

for (const mode of ['omitted', 'empty', 'sparse'] as const) {
  test(`Commission create/update inherits all omitted windows through an ${mode} Agent budget`, () => {
    const f = fixture(budget(100))
    try {
      // A partial Agent can add a weekly cap inherited from the account while
      // retaining the provider's five-hour cap on its omitted window.
      const agent = f.agent(mode === 'omitted' ? undefined : mode === 'empty' ? budget() : budget(undefined, 500))
      const created = f.commission(agent.id, budget(90, 400))
      assert.deepEqual(created.grant, budget(90, 400))
      const empty = f.commission(agent.id, budget())
      assert.deepEqual(empty.grant, budget())
      const updated = store.updateCommission(empty.id, { grant: budget(80, 300) }, empty.configurationRevision)!
      assert.deepEqual(updated.grant, budget(80, 300))
      assert.equal(updated.configurationRevision, (empty.configurationRevision ?? 0) + 1)
      const cleared = store.updateCommission(updated.id, { grant: budget() }, updated.configurationRevision)!
      assert.deepEqual(cleared.grant, budget())
    } finally { f.close() }
  })
}

for (const invalid of [budget(101), { windows: [{ label: 'unknown budget window', ceiling: 1 }] }]) {
  test(`excessive or unknown Agent/Commission child (${invalid.windows[0]!.label}:${invalid.windows[0]!.ceiling}) refuses before effects`, () => {
    const f = fixture(budget(100, 1_000))
    try {
      const agent = f.agent(budget(100))
      const commission = f.commission(agent.id, budget(50))
      const operations = [
        () => f.agent(invalid),
        () => store.updateAgentFromRequest(agent.id, { budget: invalid }, agent.revision),
        () => f.commission(agent.id, invalid),
        () => store.updateCommission(commission.id, { grant: invalid }, commission.configurationRevision),
      ]
      for (const operation of operations) {
        const before = f.snapshot()
        const events: ServerEvent[] = []
        const unsubscribe = store.subscribe(event => { events.push(event) })
        try { assert.throws(operation, BudgetError) } finally { unsubscribe() }
        assert.deepEqual(f.snapshot(), before, 'refusal changes no row, revision, grant or usage')
        assert.deepEqual(events, [], 'an impossible child publishes no registry or Commission event')
      }
    } finally { f.close() }
  })
}

for (const mode of ['omitted', 'empty', 'sparse'] as const) {
  for (const change of ['provider shrink', 'provider rebind'] as const) {
    test(`${change} clamps Commission windows through unchanged ${mode} Agent inheritance exactly once`, () => {
      const f = fixture()
      try {
        // The old runtime can construct this valid state through normal writes,
        // allowing the propagation regression to fail independently of minting.
        const originalAgent = f.agent(mode === 'omitted' ? undefined : budget(100, 1_000))
        const changed = f.commission(originalAgent.id, budget(50, 800))
        const unchanged = f.commission(originalAgent.id, budget(20, 100))
        const inheriting = f.commission(originalAgent.id)
        const agent = mode === 'omitted' ? originalAgent : store.updateAgentFromRequest(originalAgent.id,
          { budget: mode === 'empty' ? budget() : budget(100) }, originalAgent.revision)!
        const beforeAgent = structuredClone(agent)
        const beforeChanged = structuredClone(store.getCommission(changed.id)!)
        const beforeUnchanged = structuredClone(store.getCommission(unchanged.id)!)
        const beforeInheriting = structuredClone(store.getCommission(inheriting.id)!)
        const selected = change === 'provider rebind' ? f.provider(budget(500, 200)) : f.parent
        const result = observed(() => change === 'provider shrink'
          ? store.updateProvider(f.parent.id, { plan: budget(500, 200) }, f.parent.definitionRevision)
          : store.updateAgentFromRequest(agent.id, { providerId: selected.id }, agent.revision))

        const currentAgent = store.listAgents(f.tenantId).find(row => row.id === agent.id)!
        assert.deepEqual(currentAgent.budget, beforeAgent.budget, 'a changed inherited ceiling does not expand or rewrite the Agent budget')
        assert.equal(currentAgent.revision, (beforeAgent.revision ?? 0) + (change === 'provider rebind' ? 1 : 0),
          'only an actual Agent binding change advances its definition')
        const current = store.getCommission(changed.id)!
        assert.deepEqual(current.grant, budget(50, 200), 'the omitted Agent weekly window cannot hide its narrower provider parent')
        assert.equal(current.configurationRevision, (beforeChanged.configurationRevision ?? 0) + 1)
        assert.deepEqual(store.getCommission(unchanged.id), beforeUnchanged)
        assert.deepEqual(store.getCommission(inheriting.id), beforeInheriting, 'an inherited Commission remains absent instead of storing a synthetic grant')
        assert.equal(result.events.filter(event => event.type === 'commission.changed').length, 1)
        assert.equal(result.events.filter(event => event.type === 'agent.changed').length, change === 'provider rebind' ? 1 : 0)
        assert.equal(result.events.filter(event => event.type === 'provider.changed').length, change === 'provider shrink' ? 1 : 0)

        const beforeExpansion = structuredClone(store.getCommission(changed.id))
        const expansion = observed(() => store.updateProvider(selected.id, { plan: budget(500, 1_000) }))
        assert.deepEqual(store.getCommission(changed.id), beforeExpansion, 'later parent expansion never widens an already attenuated explicit child')
        assert.deepEqual(store.getCommission(unchanged.id), beforeUnchanged)
        assert.equal(expansion.events.filter(event => event.type === 'commission.changed' || event.type === 'agent.changed').length, 0,
          'unmodified children gain no revision or invalidation on parent expansion')
      } finally { f.close() }
    })
  }
}
