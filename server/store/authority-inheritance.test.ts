/** Each authority dimension inherits independently through provider → Agent →
 * Commission. A sparse object must not erase an omitted ancestor restriction. */
import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { DEFAULT_PROVIDER_ID, type Authority, type ServerEvent } from '../../contract/index.ts'
import { AuthorityError } from '../authority.ts'
import { AutomationUnavailableError } from '../automationRuntime.ts'
import { store } from './index.ts'

const dimensions = ['tools', 'connectors', 'scopes'] as const
const broad: Authority = { tools: ['read', 'write'], connectors: ['GitHub', 'Salesforce'], scopes: ['/repo', '/private'] }
const narrow: Authority = { tools: ['read'], connectors: ['GitHub'], scopes: ['/repo'] }
const originalDefault = structuredClone(store.listProviders().find(row => row.id === DEFAULT_PROVIDER_ID)!)
const originalFetch = globalThis.fetch
let sequence = 0, calls = 0
before(() => { globalThis.fetch = async () => { calls++; throw new Error('Authority configuration must not perform I/O.') } })
after(() => {
  store.updateProvider(DEFAULT_PROVIDER_ID, { authority: originalDefault.authority })
  globalThis.fetch = originalFetch
  assert.equal(calls, 0)
})

function observed<T>(act: () => T) {
  const events: ServerEvent[] = []
  const unsubscribe = store.subscribe(event => { events.push(event) })
  try { return { result: act(), events } } finally { unsubscribe() }
}

function fixture(binding: 'default' | 'explicit', authority: Authority = structuredClone(broad)) {
  const tenantId = `tenant-authority-inheritance-${++sequence}`
  const parent = binding === 'default'
    ? store.updateProvider(DEFAULT_PROVIDER_ID, { authority })!
    : store.createProvider({ label: 'Partial authority parent', modelFamily: 'custom', effortLevels: [], authority }, {}, tenantId)
  const project = store.createProject({ name: 'Authority inheritance fixture' }, tenantId).project
  // Admit both alternatives at the Project wall, so a denied value really proves
  // ancestor attenuation rather than an unrelated Project default-deny.
  for (const [kind, labels] of [['connector', broad.connectors!], ['folder', broad.scopes!]] as const) {
    for (const label of labels) store.applyRelationOp({ kind: 'scope-context', projectId: project.id,
      projectName: project.name, context: { kind, label, meta: '' } }, tenantId)
  }
  const agent = (grant?: Authority) => {
    if (binding === 'explicit') return store.createAgent({ label: 'Sparse authority Agent', systemPrompt: 'No calls.',
      instructions: '', tools: [], providerId: parent.id, ...(grant === undefined ? {} : { authority: grant }) }, tenantId)
    const imported = store.importAgentFromCard({ name: 'Current unbound authority definition' }, 'https://cards.invalid/authority', tenantId)
    return grant === undefined ? imported : store.updateAgentFromRequest(imported.id, { authority: grant })!
  }
  const commission = (agentId: string, grant?: Authority) => store.createCommission({ agentId, projectId: project.id,
    role: 'writer', ...(grant === undefined ? {} : { authority: grant }) }, tenantId)
  const snapshot = () => structuredClone({ agents: store.listAgents(tenantId), commissions: store.listCommissions(project.id, tenantId),
    usage: store.usage(undefined, tenantId).limits })
  return { tenantId, parent, project, agent, commission, snapshot, close() {
    for (const row of store.listCommissions(project.id, tenantId)) store.deleteCommission(row.id)
    for (const row of store.listAgents(tenantId)) if (row.tenantId === tenantId) store.deleteAgent(row.id)
    if (binding === 'explicit') store.deleteProvider(parent.id)
    else store.updateProvider(DEFAULT_PROVIDER_ID, { authority: originalDefault.authority })
  } }
}

for (const binding of ['default', 'explicit'] as const) {
  test(`${binding}: fixture proxy cannot erase provider connector restrictions with tools-only Agent authority`, () => {
    const f = fixture(binding, structuredClone(narrow))
    const previousProfile = process.env.DEPLOYMENT_PROFILE
    try {
      process.env.DEPLOYMENT_PROFILE = ''
      const agent = f.agent({ tools: ['read'] })
      const requester = f.agent()
      const request = { fromAgentId: requester.id, capability: 'connector.read' as const, target: 'Salesforce' }
      const before = f.snapshot()
      const denied = observed(() => store.runAgentProxy(agent.id, request))
      assert.equal(denied.result?.status, 'denied')
      assert.equal(denied.result?.actedBy, agent.id)
      assert.equal(denied.result?.output, undefined)
      assert.match(denied.result?.reason ?? '', /Salesforce/)
      assert.deepEqual(f.snapshot(), before, 'fixture denial cannot alter grants, revisions or usage')
      const audit = denied.events.filter(event => event.type === 'audit.entry')
      assert.equal(audit.length, 1)
      assert.equal(audit[0]!.type, 'audit.entry')
      if (audit[0]!.type === 'audit.entry') assert.equal(audit[0]!.entry.outcome, 'denied')
      assert.equal(store.runAgentProxy(agent.id, { ...request, target: 'GitHub' })?.status, 'fulfilled',
        'the fixture still permits a connector admitted by every ancestor')
    } finally {
      if (previousProfile === undefined) delete process.env.DEPLOYMENT_PROFILE
      else process.env.DEPLOYMENT_PROFILE = previousProfile
      f.close()
    }
  })

  test(`${binding}: release proxy guard still refuses before authority evaluation or audit publication`, () => {
    const f = fixture(binding, structuredClone(narrow))
    const previousProfile = process.env.DEPLOYMENT_PROFILE
    try {
      const agent = f.agent({ tools: ['read'] })
      const requester = f.agent()
      for (const profile of ['desktop', 'web', 'unknown-release-profile']) {
        process.env.DEPLOYMENT_PROFILE = profile
        const before = f.snapshot(), auditBefore = structuredClone(store.listAuditLog())
        const events: ServerEvent[] = []
        const unsubscribe = store.subscribe(event => { events.push(event) })
        try {
          assert.throws(() => store.runAgentProxy(agent.id, { fromAgentId: requester.id,
            capability: 'connector.read', target: 'Salesforce' }), AutomationUnavailableError)
        } finally { unsubscribe() }
        assert.deepEqual(f.snapshot(), before)
        assert.deepEqual(store.listAuditLog(), auditBefore)
        assert.deepEqual(events, [])
      }
    } finally {
      if (previousProfile === undefined) delete process.env.DEPLOYMENT_PROFILE
      else process.env.DEPLOYMENT_PROFILE = previousProfile
      f.close()
    }
  })

  test(`${binding}: valid sparse Agent and Commission create/edit retain their explicit axes only`, () => {
    const f = fixture(binding, structuredClone(narrow))
    try {
      const agent = f.agent({ connectors: ['GitHub'] })
      assert.deepEqual(agent.authority, { connectors: ['GitHub'] })
      const edited = store.updateAgentFromRequest(agent.id, { authority: { scopes: ['/repo'] } }, agent.revision)!
      assert.deepEqual(edited.authority, { scopes: ['/repo'] })
      const commission = f.commission(agent.id, { tools: ['read'] })
      assert.deepEqual(commission.authority, { tools: ['read'] })
      const patched = store.updateCommission(commission.id, { authority: { connectors: ['GitHub'] } }, commission.configurationRevision)!
      assert.deepEqual(patched.authority, { tools: ['read'], connectors: ['GitHub'] })
      assert.equal(patched.configurationRevision, (commission.configurationRevision ?? 0) + 1)
      assert.equal(store.commissionCanReach(patched.id, 'tools', 'read'), true)
      assert.equal(store.commissionCanReach(patched.id, 'scopes', '/repo'), true)
    } finally { f.close() }
  })

  for (const dimension of dimensions) for (const mode of ['empty', 'partial'] as const) {
    for (const operation of ['mint', 'edit'] as const) {
      test(`${binding}: Commission ${operation} cannot over-grant ${dimension} omitted by ${mode} Agent authority`, () => {
        const f = fixture(binding, structuredClone(narrow))
        try {
          const other = dimension === 'tools' ? 'connectors' : 'tools'
          const agent = f.agent(mode === 'empty' ? {} : { [other]: narrow[other] })
          const commission = operation === 'edit' ? f.commission(agent.id, { [other]: narrow[other] }) : undefined
          const before = f.snapshot()
          const events: ServerEvent[] = []
          const unsubscribe = store.subscribe(event => { events.push(event) })
          try {
            assert.throws(() => operation === 'mint'
              ? f.commission(agent.id, { [dimension]: broad[dimension] })
              : store.updateCommission(commission!.id, { authority: { [dimension]: broad[dimension] } }, commission!.configurationRevision), AuthorityError)
          } finally { unsubscribe() }
          assert.deepEqual(f.snapshot(), before, 'refusal changes no row, revision, sparse shape or usage')
          assert.deepEqual(events, [])
        } finally { f.close() }
      })
    }
  }

  for (const dimension of dimensions) {
    test(`${binding}: provider ${dimension} shrink traverses unchanged partial Agent and attenuates only explicit Commission axes once`, () => {
      const f = fixture(binding)
      try {
        const other = dimension === 'tools' ? 'connectors' : 'tools'
        const agent = f.agent({ [other]: narrow[other] })
        const changed = f.commission(agent.id, { [dimension]: broad[dimension] })
        const unchanged = f.commission(agent.id, { [dimension]: narrow[dimension] })
        const inherited = f.commission(agent.id, { [other]: narrow[other] })
        const beforeAgent = structuredClone(agent), beforeChanged = structuredClone(changed)
        const beforeUnchanged = structuredClone(unchanged), beforeInherited = structuredClone(inherited)
        const shrink = observed(() => store.updateProvider(f.parent.id, { authority: { ...broad, [dimension]: narrow[dimension] } }))
        const current = structuredClone(store.getCommission(changed.id)!)
        assert.deepEqual(store.listAgents(f.tenantId).find(row => row.id === agent.id), beforeAgent,
          'an omitted axis follows the ancestor without materializing or revising the Agent')
        assert.deepEqual(current.authority, { [dimension]: narrow[dimension] })
        assert.equal(current.configurationRevision, (beforeChanged.configurationRevision ?? 0) + 1)
        assert.deepEqual(store.getCommission(unchanged.id), beforeUnchanged)
        assert.deepEqual(store.getCommission(inherited.id), beforeInherited)
        assert.equal(shrink.events.filter(event => event.type === 'agent.changed').length, 0)
        assert.equal(shrink.events.filter(event => event.type === 'commission.changed').length, 1)
        assert.equal(store.commissionCanReach(inherited.id, dimension, broad[dimension]![1]!), false,
          'a partial Commission cannot erase the inherited ancestor wall at runtime')
        assert.equal(store.commissionCanReach(inherited.id, dimension, narrow[dimension]![0]!), true)
        const expansion = observed(() => store.updateProvider(f.parent.id, { authority: structuredClone(broad) }))
        assert.deepEqual(store.getCommission(changed.id), current, 'expansion never widens an explicit attenuated grant')
        assert.deepEqual(store.listAgents(f.tenantId).find(row => row.id === agent.id), beforeAgent)
        assert.equal(expansion.events.filter(event => event.type === 'agent.changed' || event.type === 'commission.changed').length, 0)
      } finally { f.close() }
    })

    test(`${binding}: partial Commission runtime retains ${dimension} restrictions from every ancestor`, () => {
      const f = fixture(binding, structuredClone(narrow))
      try {
        const other = dimension === 'tools' ? 'connectors' : 'tools'
        const agent = f.agent({ [other]: narrow[other] })
        const commission = f.commission(agent.id, { [other]: narrow[other] })
        assert.equal(store.commissionCanReach(commission.id, dimension, broad[dimension]![1]!), false)
        assert.equal(store.commissionCanReach(commission.id, dimension, narrow[dimension]![0]!), true)
      } finally { f.close() }
    })
  }

  test(`${binding}: Agent shrink clamps explicit leaf once while an unchanged partial leaf inherits the new tool wall`, () => {
    const f = fixture(binding)
    try {
      const agent = f.agent({ tools: ['read', 'write'] })
      const explicit = f.commission(agent.id, { tools: ['read', 'write'] })
      const partial = f.commission(agent.id, { connectors: ['GitHub'] })
      const beforePartial = structuredClone(partial)
      const shrink = observed(() => store.updateAgentFromRequest(agent.id, { authority: { tools: ['read'] } }, agent.revision)!)
      assert.deepEqual(shrink.result.authority, { tools: ['read'] })
      assert.equal(shrink.result.revision, (agent.revision ?? 0) + 1)
      assert.deepEqual(store.getCommission(explicit.id)?.authority, { tools: ['read'] })
      assert.equal(store.getCommission(explicit.id)?.configurationRevision, (explicit.configurationRevision ?? 0) + 1)
      assert.deepEqual(store.getCommission(partial.id), beforePartial)
      assert.equal(store.commissionCanReach(partial.id, 'tools', 'write'), false)
      assert.equal(store.commissionCanReach(partial.id, 'tools', 'read'), true)
      assert.equal(shrink.events.filter(event => event.type === 'agent.changed').length, 1)
      assert.equal(shrink.events.filter(event => event.type === 'commission.changed').length, 1)
      store.updateAgentFromRequest(agent.id, { authority: { tools: ['read', 'write'] } })
      assert.deepEqual(store.getCommission(explicit.id)?.authority, { tools: ['read'] })
    } finally { f.close() }
  })
}
