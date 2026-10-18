/** Current import/fork stubs keep providerId absent, but their grants inherit
 * the live fixed default provider rather than its original seed definition. */
import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { DEFAULT_PROVIDER_ID, type Authority, type Budget, type ServerEvent } from '../../contract/index.ts'
import { agentForkCreationId, agentImportCreationId } from '../agentCreationIdentity.ts'
import { commissionCreationId } from '../commissionCreationIdentity.ts'
import { BudgetError } from '../usage.ts'
import { AuthorityError } from '../authority.ts'
import { store } from './index.ts'

const FIVE = '5-hour limit', WEEK = 'Weekly · all models'
const budget = (five?: number, weekly?: number): Budget => ({ windows: [
  ...(five === undefined ? [] : [{ label: FIVE, ceiling: five }]),
  ...(weekly === undefined ? [] : [{ label: WEEK, ceiling: weekly }]),
] })
const originalDefault = structuredClone(store.listProviders().find(row => row.id === DEFAULT_PROVIDER_ID)!)
const originalFetch = globalThis.fetch
let calls = 0
let sequence = 0
before(() => { globalThis.fetch = async () => { calls++; throw new Error('Grant configuration must never perform I/O.') } })
after(() => {
  store.updateProvider(DEFAULT_PROVIDER_ID, { plan: originalDefault.plan, authority: originalDefault.authority })
  globalThis.fetch = originalFetch
  assert.equal(calls, 0)
})

function fixture(kind: 'import' | 'fork', plan = budget(500, 1_000)) {
  const tenantId = `tenant-default-grants-${++sequence}`
  const sourceTenant = `${tenantId}-source`
  store.updateProvider(DEFAULT_PROVIDER_ID, { plan })
  let sourceId: string | undefined
  let privateProviderId: string | undefined
  const logicalId = kind === 'import' ? agentImportCreationId(tenantId, 'current-stub') : agentForkCreationId(tenantId, 'current-stub')
  if (kind === 'fork') {
    const provider = store.createProvider({ label: 'Foreign private cognition', modelFamily: 'custom', effortLevels: [] }, {}, sourceTenant)
    privateProviderId = provider.id
    const source = store.createAgent({ label: 'Published source', systemPrompt: 'An ordinary definition.', tools: [],
      instructions: '', providerId: provider.id }, sourceTenant)
    sourceId = source.id
    store.updateAgentFromRequest(source.id, { published: true }, source.revision)
  }
  const replay = () => kind === 'import'
    ? store.importAgentFromCard({ name: 'Current imported definition' }, 'https://cards.invalid/fixture', tenantId, { logicalId })
    : store.forkAgent(sourceId!, tenantId, { logicalId })!
  const agent = replay()
  assert.equal(agent.providerId, undefined, 'the current import/fork API produces a genuinely unbound definition')
  const projectId = store.listProjects()[0]!.id
  const commission = (grant?: Budget, key?: string) => store.createCommission({ agentId: agent.id, projectId, role: 'writer',
    ...(grant === undefined ? {} : { grant }) }, tenantId,
  key ? { logicalId: commissionCreationId(tenantId, key) } : undefined)
  const state = () => structuredClone({ agents: store.listAgents(tenantId), commissions: store.listCommissions(undefined, tenantId),
    usage: store.usage(undefined, tenantId).limits })
  return { tenantId, agent, projectId, replay, commission, state, close() {
    for (const row of store.listCommissions(undefined, tenantId)) if (row.tenantId === tenantId) store.deleteCommission(row.id)
    store.deleteAgent(agent.id)
    if (sourceId) store.deleteAgent(sourceId)
    if (privateProviderId) store.deleteProvider(privateProviderId)
    store.updateProvider(DEFAULT_PROVIDER_ID, { plan: originalDefault.plan, authority: originalDefault.authority })
  } }
}

function observe<T>(act: () => T) {
  const events: ServerEvent[] = []
  const unsubscribe = store.subscribe(event => { events.push(event) })
  try { return { result: act(), events } } finally { unsubscribe() }
}

for (const kind of ['import', 'fork'] as const) {
  test(`${kind}: absent Agent authority inherits the live default for Agent and Commission edits and mint`, () => {
    const f = fixture(kind)
    try {
      store.updateProvider(DEFAULT_PROVIDER_ID, { authority: { tools: ['read'] } })
      const commission = store.createCommission({ agentId: f.agent.id, projectId: f.projectId, role: 'writer',
        authority: { tools: ['read'] } }, f.tenantId)
      for (const act of [
        () => store.updateAgentFromRequest(f.agent.id, { authority: { tools: ['write'] } }),
        () => store.createCommission({ agentId: f.agent.id, projectId: f.projectId, role: 'writer',
          authority: { tools: ['write'] } }, f.tenantId),
        () => store.updateCommission(commission.id, { authority: { tools: ['write'] } }),
      ]) {
        const before = f.state()
        const events: ServerEvent[] = []
        const unsubscribe = store.subscribe(event => { events.push(event) })
        try { assert.throws(act, AuthorityError) } finally { unsubscribe() }
        assert.deepEqual(f.state(), before)
        assert.deepEqual(events, [])
      }
    } finally { f.close() }
  })

  for (const explicit of [false, true]) {
    test(`${kind}: default authority shrink reaches ${explicit ? 'explicit' : 'inheriting'} unbound Agent and its Commission once`, () => {
      const f = fixture(kind)
      try {
        store.updateProvider(DEFAULT_PROVIDER_ID, { authority: { tools: ['read', 'write'] } })
        if (explicit) store.updateAgentFromRequest(f.agent.id, { authority: { tools: ['read', 'write'] } })
        const beforeAgent = structuredClone(store.listAgents(f.tenantId).find(row => row.id === f.agent.id)!)
        const commission = store.createCommission({ agentId: f.agent.id, projectId: f.projectId, role: 'writer',
          authority: { tools: ['read', 'write'] } }, f.tenantId)
        const inherited = f.commission()
        const shrink = observe(() => store.updateProvider(DEFAULT_PROVIDER_ID, { authority: { tools: ['read'] } }))
        const agent = structuredClone(store.listAgents(f.tenantId).find(row => row.id === f.agent.id)!)
        const current = structuredClone(store.getCommission(commission.id)!)
        assert.equal(agent.providerId, undefined)
        assert.deepEqual(agent.authority, explicit ? { tools: ['read'] } : undefined)
        assert.equal(agent.revision, (beforeAgent.revision ?? 0) + (explicit ? 1 : 0))
        assert.deepEqual(current.authority, { tools: ['read'] })
        assert.equal(store.commissionCanReach(commission.id, 'tools', 'write'), false)
        assert.equal(store.commissionCanReach(inherited.id, 'tools', 'write'), false,
          'an entirely inheriting Commission uses the live default at the runtime projection too')
        assert.equal(store.commissionCanReach(inherited.id, 'tools', 'read'), true)
        assert.equal(current.configurationRevision, (commission.configurationRevision ?? 0) + 1)
        assert.equal(shrink.events.filter(event => event.type === 'agent.changed').length, explicit ? 1 : 0)
        assert.equal(shrink.events.filter(event => event.type === 'commission.changed').length, 1)
        const expansion = observe(() => store.updateProvider(DEFAULT_PROVIDER_ID, { authority: { tools: ['read', 'write'] } }))
        assert.deepEqual(store.listAgents(f.tenantId).find(row => row.id === f.agent.id), agent)
        assert.deepEqual(store.getCommission(commission.id), current)
        assert.equal(expansion.events.filter(event => event.type === 'agent.changed' || event.type === 'commission.changed').length, 0)
      } finally { f.close() }
    })
  }

  for (const operation of ['Agent edit', 'Commission mint', 'Commission edit'] as const) {
    test(`${kind}: ${operation} refuses a grant above the live fixed default plan before effects`, () => {
      const f = fixture(kind, budget(100, 500))
      try {
        const commission = operation === 'Commission edit' ? f.commission(budget(50)) : undefined
        const before = f.state()
        const events: ServerEvent[] = []
        const unsubscribe = store.subscribe(event => { events.push(event) })
        try {
          assert.throws(() => operation === 'Agent edit'
            ? store.updateAgentFromRequest(f.agent.id, { budget: budget(101) }, f.agent.revision)
            : operation === 'Commission mint' ? f.commission(budget(101))
              : store.updateCommission(commission!.id, { grant: budget(101) }, commission!.configurationRevision), BudgetError)
        } finally { unsubscribe() }
        assert.deepEqual(f.state(), before)
        assert.deepEqual(events, [])
      } finally { f.close() }
    })
  }

  for (const mode of ['absent', 'empty', 'sparse'] as const) {
    test(`${kind}: default shrink traverses absent providerId and ${mode} Agent budget without false revision or later widening`, () => {
      const f = fixture(kind)
      try {
        if (mode !== 'absent') store.updateAgentFromRequest(f.agent.id, { budget: mode === 'empty' ? budget() : budget(100) })
        const changed = f.commission(budget(undefined, 800), 'changed-grant')
        const unchanged = f.commission(budget(undefined, 100))
        const inherited = f.commission()
        const beforeAgent = structuredClone(store.listAgents(f.tenantId).find(row => row.id === f.agent.id)!)
        const beforeChanged = structuredClone(changed)
        const beforeUnchanged = structuredClone(unchanged)
        const beforeInherited = structuredClone(inherited)
        const shrink = observe(() => store.updateProvider(DEFAULT_PROVIDER_ID, { plan: budget(500, 200) }))
        assert.deepEqual(store.listAgents(f.tenantId).find(row => row.id === f.agent.id), beforeAgent)
        const current = store.getCommission(changed.id)!
        assert.deepEqual(current.grant, budget(undefined, 200))
        assert.equal(current.configurationRevision, (beforeChanged.configurationRevision ?? 0) + 1)
        assert.deepEqual(store.getCommission(unchanged.id), beforeUnchanged)
        assert.deepEqual(store.getCommission(inherited.id), beforeInherited)
        assert.equal(shrink.events.filter(event => event.type === 'commission.changed').length, 1)
        assert.equal(shrink.events.filter(event => event.type === 'agent.changed').length, 0)

        const beforeReplay = f.state()
        const replay = observe(() => ({ agent: f.replay(), commission: f.commission(budget(undefined, 800), 'changed-grant') }))
        assert.equal(replay.result.agent.id, f.agent.id)
        assert.equal(replay.result.agent.providerId, undefined)
        assert.deepEqual(replay.result.commission, current, 'represented creation replays its narrowed current grant before validating old input')
        assert.deepEqual(f.state(), beforeReplay)
        assert.deepEqual(replay.events, [])
        const expansion = observe(() => store.updateProvider(DEFAULT_PROVIDER_ID, { plan: budget(500, 1_000) }))
        assert.deepEqual(store.getCommission(changed.id), current)
        assert.deepEqual(store.listAgents(f.tenantId).find(row => row.id === f.agent.id), beforeAgent)
        assert.equal(expansion.events.filter(event => event.type === 'agent.changed' || event.type === 'commission.changed').length, 0)
      } finally { f.close() }
    })
  }

  test(`${kind}: default shrink revises an explicit sparse Agent cap once and transitively narrows its Commission`, () => {
    const f = fixture(kind)
    try {
      const agent = store.updateAgentFromRequest(f.agent.id, { budget: budget(400) })!
      const commission = f.commission(budget(300))
      const shrink = observe(() => store.updateProvider(DEFAULT_PROVIDER_ID, { plan: budget(100, 1_000) }))
      const currentAgent = store.listAgents(f.tenantId).find(row => row.id === agent.id)!
      assert.equal(currentAgent.providerId, undefined)
      assert.deepEqual(currentAgent.budget, budget(100))
      assert.equal(currentAgent.revision, (agent.revision ?? 0) + 1)
      assert.deepEqual(store.getCommission(commission.id)?.grant, budget(100))
      assert.equal(store.getCommission(commission.id)?.configurationRevision, (commission.configurationRevision ?? 0) + 1)
      assert.equal(shrink.events.filter(event => event.type === 'agent.changed').length, 1)
      assert.equal(shrink.events.filter(event => event.type === 'commission.changed').length, 1)
    } finally { f.close() }
  })
}

test('direct unbound Agent mint checks live fixed-default budgets and authority before any effect', () => {
  const f = fixture('import', budget(100, 500))
  try {
    store.updateProvider(DEFAULT_PROVIDER_ID, { authority: { tools: ['read'] } })
    const input = { label: 'Unbound direct definition', systemPrompt: 'No calls.', tools: [], instructions: '' }
    const refusals: Array<[{ budget?: Budget; authority?: Authority }, typeof BudgetError | typeof AuthorityError]> = [
      [{ budget: budget(101) }, BudgetError],
      [{ authority: { tools: ['write'] } }, AuthorityError],
    ]
    for (const [patch, ErrorType] of refusals) {
      const before = f.state()
      const events: ServerEvent[] = []
      const unsubscribe = store.subscribe(event => { events.push(event) })
      try { assert.throws(() => store.createAgent({ ...input, ...patch }, f.tenantId), ErrorType) } finally { unsubscribe() }
      assert.deepEqual(f.state(), before)
      assert.deepEqual(events, [])
    }
  } finally { f.close() }
})

test('default provider lookup reads the live fixed definition, not a tenant preference or seed face', () => {
  const f = fixture('import', budget(100, 500))
  const preferred = store.createProvider({ label: 'A different preferred provider', modelFamily: 'custom', effortLevels: [],
    plan: budget(900, 900) }, {}, f.tenantId)
  try {
    store.setDefaultProvider(preferred.id, f.tenantId)
    store.updateProvider(DEFAULT_PROVIDER_ID, { authority: { tools: ['read'] } })
    assert.deepEqual(store.getProvider().plan, budget(100, 500))
    assert.deepEqual(store.getProvider().authority, { tools: ['read'] })
    assert.equal(store.getProvider().id, DEFAULT_PROVIDER_ID)
    assert.deepEqual(store.getProvider(preferred.id), preferred, 'an explicit id keeps its exact stored definition, not the decorated list projection')
    assert.equal(store.listAgents(f.tenantId).find(row => row.id === f.agent.id)?.providerId, undefined)
    assert.throws(() => store.updateAgentFromRequest(f.agent.id, { budget: budget(101) }), BudgetError,
      'the more permissive tenant preference is not the parent of an unbound definition')
  } finally {
    store.setDefaultProvider(undefined, f.tenantId)
    store.deleteProvider(preferred.id)
    f.close()
  }
})
