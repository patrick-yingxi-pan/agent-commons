/** An endpoint override changes model routing, never the bound Agent's parent
 * authority. Fixtures are authored in-memory; neither model nor MCP I/O occurs. */
import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { DEFAULT_PROVIDER_ID, type Authority } from '../../contract/index.ts'
import type { McpBoundToolCall, McpToolResult } from '../../contract/mcpExecution.ts'
import { store } from './index.ts'
import { MCP_SCHEMA_ADMISSION_VERSION, mcpToolSchemaHash } from '../mcpToolAdmission.ts'
import { MCP_MODERN_VERSION } from '../mcpProtocol.ts'
import { routineMcpJsonText, RoutineMcpPolicyError } from '../routineMcpPolicy.ts'

const tenant = 'tenant-personal'
const tool = { name: 'search', inputSchema: { type: 'object', properties: {}, additionalProperties: false } }
const schemaHash = mcpToolSchemaHash(tool)
const result: McpToolResult = { resultType: 'complete', content: [{ type: 'text', text: 'Allowed.' }], isError: false }
const originalFetch = globalThis.fetch
let outboundCalls = 0
before(() => { globalThis.fetch = async () => { outboundCalls++; throw new Error('No outbound I/O in authority fixtures.') } })
after(() => { globalThis.fetch = originalFetch; assert.equal(outboundCalls, 0) })

type Binding = 'inherited' | 'same-provider' | 'override'
const sparseAuthorities: [string, Authority | undefined][] = [
  ['absent', undefined], ['empty', {}], ['tools-only', { tools: ['read'] }], ['scopes-only', { scopes: ['/repo'] }],
]

function fixture(binding: Binding, allowed: boolean, authority: Authority | undefined = undefined, connector = false) {
  const id = randomUUID().replaceAll('-', '')
  const connectionId = `mcp-connection-${id}`
  const connectorId = `routine-parent-connector-${id}`
  const config = { baseURL: 'http://127.0.0.1:1', model: 'local-authority-fixture', capabilities: { toolUse: true } }
  const parent = store.createProvider({ label: 'Agent authority parent', modelFamily: 'custom', effortLevels: [],
    authority: { connectors: allowed ? [connectionId, connectorId] : [] } }, config, tenant)
  const override = store.createProvider({ label: 'Routine routing override', modelFamily: 'custom', effortLevels: [],
    authority: {} }, config, tenant)
  const agent = store.createAgent({ label: 'Sparse Routine Agent', systemPrompt: 'No model request.', instructions: '',
    tools: [], providerId: parent.id, ...(authority === undefined ? {} : { authority }) }, tenant)
  store.createMcpConnection({ id: connectionId, label: 'Authored authority search', endpoint: 'https://8.8.8.8/mcp', authentication: 'none' }, tenant)
  store.commitMcpInspection(connectionId, tenant, 0, { protocolVersion: MCP_MODERN_VERSION, cleanup: 'not-needed', tools: [tool],
    schemaAdmission: { version: MCP_SCHEMA_ADMISSION_VERSION, hashes: [schemaHash] } }, Date.now())
  store.addSavedContext({ id: connectorId, label: 'Authored connector', kind: 'connector', status: 'connected', detail: '/repo',
    lastUsedAt: null, sessions: 0 }, tenant)
  const source = store.listSchedules(tenant)[0]!
  assert.ok(source, 'the fixture clones only a valid Routine shape')
  const { id: _id, tenantId: _tenantId, modelId: _modelId, effort: _effort, providerId: _providerId, ...seed } = structuredClone(source)
  const task = store.addSchedule({ ...seed, tenantId: tenant, name: `Routine parent authority ${id}`, agentId: agent.id,
    ...(binding === 'inherited' ? {} : { providerId: binding === 'override' ? override.id : parent.id }),
    runs: [], enabled: false,
    steps: connector ? [{ id: `step-${id}`, tool: { id: connectorId, label: 'Authored connector', tone: 'connector' }, action: 'Read' }] : [],
    delivery: { tool: { id: 'assistant', label: 'Assistant', tone: 'claude' }, target: 'Run conversation' } })
  assert.equal(task.providerId, binding === 'override' ? override.id : parent.id,
    'Routine creation resolves the requested routing choice, including inherited selection')
  assert.equal(store.mcpConnection(connectionId, tenant)?.execution, 'approval-required', 'the inspected fixture tool is executable')
  assert.equal(store.getAgent(agent.id).providerId, parent.id, 'routing does not rebind the Agent parent')
  const review = () => {
    const current = store.routineMcpReview(task.id, tenant)
    assert.ok(current, 'owner can review this authored Routine')
    return current
  }
  const approve = () => {
    const current = review()
    const decision = store.decideRoutineMcp(task.id, tenant, { requestId: `approval-${randomUUID()}`, action: 'approve', approval: {
      expectedRevision: current.policy.revision, expectedDefinitionRevision: current.definitionRevision, reviewHash: current.reviewHash,
      expiresAt: Date.now() + 60_000, maxCallsPerRun: 2,
      tools: [{ connectionId, connectionRevision: 1, toolName: tool.name, schemaHash, fixedArguments: {} }],
    } })
    assert.ok(decision)
    return decision.review
  }
  const call: McpBoundToolCall = { connectionId, connectionRevision: 1, toolName: tool.name, schemaHash, arguments: {} }
  const narrow = () => {
    const before = structuredClone(store.getAgent(agent.id))
    store.updateProvider(parent.id, { authority: { connectors: [] } })
    assert.deepEqual(store.getAgent(agent.id), before,
      'sparse Agent definition and revision stay unchanged, so invalidation must observe the parent')
  }
  const close = () => {
    store.removeSchedule(task.id)
    store.removeMcpConnection(connectionId, tenant, 1)
    store.removeSavedContext(connectorId, tenant)
    assert.equal(store.deleteAgent(agent.id), true)
    assert.equal(store.deleteProvider(override.id), true)
    assert.equal(store.deleteProvider(parent.id), true)
  }
  return { parent, override, agent, task, connectionId, connectorId, review, approve, call, narrow, close }
}

for (const binding of ['inherited', 'same-provider', 'override'] as const) {
  test(`${binding}: a connector admitted by the Agent parent and selected provider still executes`, async () => {
    const f = fixture(binding, true, { scopes: ['/repo'] }, true)
    try {
      assert.equal(f.review().tools.some(row => row.connectionId === f.connectionId), true)
      assert.equal(f.approve().active, true)
      const run = store.runSchedule(f.task.id)!
      const context = store.routineExecutionContext(f.task.id, run.id)!
      assert.equal(context.blocked, undefined)
      assert.ok(context.contexts.some(row => row.id === f.connectorId))
      assert.deepEqual(context.externalMcpConnections?.map(row => row.id), [f.connectionId])
      let effects = 0
      const receipt = await store.executeRoutineMcpCall(f.task.id, run.id, f.call, 'allowed-call', undefined,
        async (_store, owner, call, authorize) => {
          assert.equal(owner, tenant); assert.deepEqual(call, f.call); assert.equal(authorize(), true)
          effects++
          return { status: 'done', summary: 'Allowed.', result }
        })
      assert.equal(receipt.status, 'done')
      assert.equal(effects, 1)
    } finally { f.close() }
  })
}

test('same-provider: the historical reviewed preimage keeps existing consent hashes', () => {
  const f = fixture('same-provider', true)
  try {
    const agent = f.agent, provider = f.parent
    // This is the pre-override-fix consent preimage. An unconditional added
    // parent field would revoke ordinary approvals despite unchanged facts.
    const historicalHash = createHash('sha256').update(routineMcpJsonText({
      owner: tenant, routineId: f.task.id, definitionRevision: f.task.revision ?? 0,
      artifact: null, projectId: null, sessionLabel: null, extraTools: [],
      agent: {
        id: agent.id, revision: agent.revision ?? 0, tenantId: agent.tenantId ?? null,
        label: agent.label, systemPrompt: agent.systemPrompt, instructions: agent.instructions,
        tools: agent.tools, providerId: agent.providerId ?? null,
        authority: agent.authority ?? null, budget: agent.budget ?? null,
      },
      provider: {
        id: provider.id, tenantId: provider.tenantId ?? null, kind: provider.kind ?? 'endpoint',
        definitionRevision: provider.definitionRevision ?? 0, connectionRevision: provider.connectionRevision ?? 0,
        label: provider.label, modelFamily: provider.modelFamily, effortLevels: provider.effortLevels,
        models: provider.models ?? null, catalogSource: provider.catalogSource ?? null,
        plan: provider.plan ?? null, authority: provider.authority ?? null, defaultModelId: provider.defaultModelId ?? null,
      },
      project: null, audience: [],
    })).digest('hex')
    assert.equal(f.review().reviewHash, historicalHash)
  } finally { f.close() }
})

for (const [mode, authority] of sparseAuthorities) {
  for (const binding of ['inherited', 'same-provider', 'override'] as const) {
    test(`${binding}, ${mode} Agent authority: parent connector denial hides MCP tools`, () => {
      const f = fixture(binding, false, authority)
      try { assert.equal(f.review().tools.some(row => row.connectionId === f.connectionId), false) }
      finally { f.close() }
    })
    test(`${binding}, ${mode} Agent authority: parent connector denial blocks saved connector context`, () => {
      const f = fixture(binding, false, authority, true)
      try {
        const run = store.runSchedule(f.task.id)!
        const context = store.routineExecutionContext(f.task.id, run.id)!
        assert.equal(context.blocked?.code, 'authority_denied')
        assert.equal(context.contexts.some(row => row.id === f.connectorId), false)
      } finally { f.close() }
    })
  }
  test(`override, ${mode} Agent authority: approval POST cannot grant a parent-denied tool`, () => {
    const f = fixture('override', false, authority)
    try {
      assert.throws(() => f.approve(), RoutineMcpPolicyError)
      assert.equal(f.review().policy.approval, null)
    } finally { f.close() }
  })
  test(`override, ${mode} Agent authority: parent narrowing changes the represented review hash`, () => {
    const f = fixture('override', true, authority)
    try {
      const approved = f.approve()
      assert.equal(approved.active, true)
      f.narrow()
      assert.notEqual(f.review().reviewHash, approved.reviewHash)
      assert.equal(f.review().active, false)
    } finally { f.close() }
  })
  test(`override, ${mode} Agent authority: parent narrowing refuses queued MCP dispatch`, async () => {
    const f = fixture('override', true, authority)
    try {
      assert.equal(f.approve().active, true)
      const run = store.runSchedule(f.task.id)!
      assert.equal(store.routineExecutionContext(f.task.id, run.id)?.blocked, undefined,
        'the queued run is executable before the parent changes')
      f.narrow()
      let effects = 0
      await assert.rejects(store.executeRoutineMcpCall(f.task.id, run.id, f.call, 'after-parent-shrink', undefined,
        async (_store, _owner, _call, authorize) => {
          if (!authorize()) return { status: 'denied', summary: 'Authority changed.' }
          effects++
          return { status: 'done', summary: 'Must not happen.', result }
        }), RoutineMcpPolicyError)
      assert.equal(effects, 0)
    } finally { f.close() }
  })
  test(`override, ${mode} Agent authority: parent narrowing blocks runtime context`, () => {
    const f = fixture('override', true, authority)
    try {
      assert.equal(f.approve().active, true)
      const run = store.runSchedule(f.task.id)!
      f.narrow()
      assert.equal(store.routineExecutionContext(f.task.id, run.id)?.blocked?.code, 'authority_denied')
    } finally { f.close() }
  })
  test(`override, ${mode} Agent authority: parent narrowing prevents output publication`, () => {
    const f = fixture('override', true, authority)
    try {
      assert.equal(f.approve().active, true)
      const run = store.runSchedule(f.task.id)!
      f.narrow()
      store.completeScheduleRun(f.task.id, run.id, { id: 'forbidden-output', role: 'assistant', content: 'Must not publish.' },
        { agentId: f.agent.id, providerId: f.override.id })
      assert.equal(run.status, 'failed')
      assert.equal(run.failureCode, 'authority_denied')
      assert.notEqual(run.detail, 'Must not publish.')
    } finally { f.close() }
  })
}

test('override: an Agent with no provider binding retains default-parent authority', () => {
  const original = structuredClone(store.listProviders().find(row => row.id === DEFAULT_PROVIDER_ID)!)
  const f = fixture('override', true)
  const unbound = store.importAgentFromCard({ name: 'Authored unbound Routine Agent' }, 'https://cards.invalid/no-request', tenant)
  try {
    assert.equal(unbound.providerId, undefined, 'the authored import has the contract default parent')
    store.updateSchedule(f.task.id, { agentId: unbound.id })
    assert.equal(f.review().tools.some(row => row.connectionId === f.connectionId), true)
    assert.equal(f.approve().active, true)
    const run = store.runSchedule(f.task.id)!
    const before = f.review()
    const beforeAgent = structuredClone(store.getAgent(unbound.id))
    store.updateProvider(DEFAULT_PROVIDER_ID, { authority: { connectors: [] } })
    assert.deepEqual(store.getAgent(unbound.id), beforeAgent)
    assert.notEqual(f.review().reviewHash, before.reviewHash)
    assert.equal(f.review().active, false)
    assert.equal(f.review().tools.some(row => row.connectionId === f.connectionId), false)
    assert.equal(store.routineExecutionContext(f.task.id, run.id)?.blocked?.code, 'authority_denied')
  } finally {
    store.updateProvider(DEFAULT_PROVIDER_ID, { authority: original.authority })
    f.close()
    assert.equal(store.deleteAgent(unbound.id), true)
  }
})

for (const parent of ['missing', 'foreign'] as const) {
  test(`override: an unavailable ${parent} Agent parent fails closed`, () => {
    const f = fixture('override', true, undefined, true)
    const foreign = parent === 'foreign'
      ? store.createProvider({ label: 'Foreign parent', modelFamily: 'custom', effortLevels: [] }, {}, 'tenant-routine-foreign-parent')
      : undefined
    // Legacy/internal rows can retain an unavailable binding. Exercise that
    // defensive read directly, without manufacturing a public write bypass.
    const legacy = store.createAgent({ label: 'Authored unavailable parent Agent', tools: [], instructions: '', systemPrompt: 'No I/O.',
      providerId: foreign?.id ?? 'provider-routine-parent-does-not-exist' }, tenant)
    try {
      store.updateSchedule(f.task.id, { agentId: legacy.id })
      assert.equal(store.listProviders(tenant).some(row => row.id === legacy.providerId), false)
      assert.equal(f.review().tools.some(row => row.connectionId === f.connectionId), false)
      const run = store.runSchedule(f.task.id)!
      assert.equal(store.routineExecutionContext(f.task.id, run.id)?.blocked?.code, 'authority_denied')
      assert.throws(() => f.approve(), RoutineMcpPolicyError)
    } finally {
      f.close()
      assert.equal(store.deleteAgent(legacy.id), true)
      if (foreign) assert.equal(store.deleteProvider(foreign.id), true)
    }
  })
}
