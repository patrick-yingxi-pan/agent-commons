/** Commission MCP durable state is a strict private slice. Boot transitions are
 * exercised through real JSON/SQLite startup in child processes so no singleton
 * store state or backend handles leak between cases. */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'
import type { PersistedState } from './persist.ts'
import { validateCommissionMcpRegistryJoins } from '../commissionMcpAuthority.ts'
import { createMcpConnectionRegistry, parseMcpConnectionState } from '../mcpConnections.ts'
import { parseCommissionMcpRegistryState } from '../commissionMcpRegistry.ts'
import { addCommissionMcpSnapshotFixture } from '../../scripts/snapshotCommissionMcp.ts'

const ROOT = mkdtempSync(join(tmpdir(), `agent-commons-commission-mcp-${process.pid}-`))
const storeModule = new URL('../store/index.ts', import.meta.url).href
const persistModule = new URL('./persist.ts', import.meta.url).href
const helperModule = new URL('../../scripts/snapshotCommissionMcp.ts', import.meta.url).href
const COMMISSION_ID = 'commission-mcp-snapshot'
const AGENT_ID = 'agent-commission-mcp-snapshot'
const ITEM_ID = 'work-commission-mcp-snapshot'

after(() => rmSync(ROOT, { recursive: true, force: true }))

function run(file: string, backend: 'json' | 'sqlite', code: string) {
  return spawnSync(process.execPath, ['--input-type=module', '--eval', code], {
    encoding: 'utf8', timeout: 90_000,
    env: { ...process.env, INITIAL_WORLD: 'demo', BACKEND: 'mock', PERSIST_BACKEND: backend,
      DATA_FILE: file, DATABASE_PATH: file },
  })
}

function output(file: string, backend: 'json' | 'sqlite', code: string): Record<string, any> {
  const result = run(file, backend, code)
  assert.equal(result.status, 0, result.stderr)
  return JSON.parse(result.stdout)
}

function makeFixture(file: string, backend: 'json' | 'sqlite', phase: 'done' | 'preparing' | 'effect-pending' = 'done') {
  const result = run(file, backend, `
    const { store } = await import(${JSON.stringify(storeModule)});
    const { loadState, saveState, closePersistence } = await import(${JSON.stringify(persistModule)});
    const { addCommissionMcpSnapshotFixture } = await import(${JSON.stringify(helperModule)});
    store.initPersistence();
    const state = addCommissionMcpSnapshotFixture(loadState(), ${JSON.stringify(phase)});
    saveState(state);
    closePersistence();
  `)
  assert.equal(result.status, 0, result.stderr)
}

function stateFor(file: string): PersistedState {
  return JSON.parse(readFileSync(file, 'utf8')) as PersistedState
}

for (const backend of ['json', 'sqlite'] as const) {
  for (const phase of ['preparing', 'effect-pending'] as const) {
    test(`${backend}: ${phase} Commission MCP work is made uncertain and its grant revoked before admission`, () => {
      const file = join(ROOT, `${backend}-${phase}`)
      makeFixture(file, backend, phase)
      const recovered = output(file, backend, `
        const { store } = await import(${JSON.stringify(storeModule)});
        const { loadState, closePersistence } = await import(${JSON.stringify(persistModule)});
        store.initPersistence();
        const state = loadState();
        const claim = state.commissionMcp.claims[0];
        const work = state.openSubGoals.find(row => row.id === ${JSON.stringify(ITEM_ID)});
        const commission = state.commissions.find(([id]) => id === ${JSON.stringify(COMMISSION_ID)})[1];
        const control = { ...work, id: 'work-commission-mcp-unclaimed-control', subGoal: 'unclaimed control dispatch' };
        const dispatch = store.dispatchOpenSubGoal(work);
        const controlDispatch = store.dispatchOpenSubGoal(control);
        console.log(JSON.stringify({ claim, policy: state.commissionMcp.policies.at(-1),
          policies: state.commissionMcp.policies, claims: state.commissionMcp.claims.length,
          standing: commission.standing, canReserve: store.commissionRolePermits(${JSON.stringify(COMMISSION_ID)}, 'reserve'),
          canFire: store.commissionRolePermits(${JSON.stringify(COMMISSION_ID)}, 'fire'),
          canReach: store.commissionCanReach(${JSON.stringify(COMMISSION_ID)}, 'connectors', work.target), dispatch, controlDispatch }));
        closePersistence();
      `)
      assert.equal(recovered.claims, 1)
      assert.equal(recovered.standing, true)
      assert.equal(recovered.canReserve, true, 'the retained standing Contributor is otherwise eligible')
      assert.equal(recovered.canFire, true)
      assert.equal(recovered.canReach, true)
      assert.equal(recovered.dispatch, false, 'a claimed work item is not synthetically dispatched after recovery')
      assert.equal(recovered.controlDispatch, true, 'the same standing Contributor can dispatch an otherwise identical unclaimed item')
      assert.equal(recovered.policy.policy.approval, null, 'startup withdraws fresh authority before returning')
      if (phase === 'preparing') {
        assert.equal(recovered.claim.phase, 'closed')
        assert.equal(recovered.claim.status, 'uncertain')
      } else {
        assert.equal(recovered.claim.phase, 'effect')
        assert.equal(recovered.claim.attempt.status, 'uncertain')
      }

      const second = output(file, backend, `
        const { store } = await import(${JSON.stringify(storeModule)});
        const { loadState, closePersistence } = await import(${JSON.stringify(persistModule)});
        store.initPersistence();
        const state = loadState();
        console.log(JSON.stringify({ claim: state.commissionMcp.claims[0], policies: state.commissionMcp.policies }));
        closePersistence();
      `)
      assert.deepEqual(second.claim, recovered.claim, 'second boot is idempotent')
      assert.deepEqual(second.policies, recovered.policies, 'the persisted recovery history remains stable on another boot')
    })
  }

  test(`${backend}: known Commission MCP receipt stays done and legacy absence stays empty`, () => {
    const file = join(ROOT, `${backend}-terminal`)
    makeFixture(file, backend, 'done')
    const recovered = output(file, backend, `
      const { store } = await import(${JSON.stringify(storeModule)});
      const { loadState, closePersistence } = await import(${JSON.stringify(persistModule)});
      store.initPersistence();
      const state = loadState();
      console.log(JSON.stringify({ claim: state.commissionMcp.claims[0], policy: state.commissionMcp.policies.at(-1) }));
      closePersistence();
    `)
    assert.equal(recovered.claim.phase, 'effect')
    assert.equal(recovered.claim.attempt.status, 'done')
    assert.equal(recovered.claim.attempt.result.content[0].text, 'Known offline fixture result.')
    assert.ok(recovered.policy.policy.approval, 'a settled claim does not need restart uncertainty recovery')

    const legacyFile = join(ROOT, `${backend}-legacy`)
    makeFixture(legacyFile, backend)
    const removeSlice = run(legacyFile, backend, `
      const { loadState, saveState, closePersistence } = await import(${JSON.stringify(persistModule)});
      const state = loadState(); delete state.commissionMcp; saveState(state); closePersistence();
    `)
    assert.equal(removeSlice.status, 0, removeSlice.stderr)
    const legacy = output(legacyFile, backend, `
      const { store } = await import(${JSON.stringify(storeModule)});
      const { loadState, closePersistence } = await import(${JSON.stringify(persistModule)});
      store.initPersistence();
      console.log(JSON.stringify({ commissionMcp: loadState().commissionMcp }));
      closePersistence();
    `)
    assert.equal(legacy.commissionMcp, undefined, 'legacy bytes remain absent while startup uses an empty in-memory registry')
  })
}

for (const backend of ['json', 'sqlite'] as const) {
  test(`${backend}: present malformed Commission MCP state refuses startup instead of reseeding`, () => {
    const file = join(ROOT, `malformed-present-${backend}`)
    makeFixture(file, backend)
    const tamper = run(file, backend, `
      const { loadState, saveState, closePersistence } = await import(${JSON.stringify(persistModule)});
      const state = loadState();
      state.commissionMcp = { policies: [], claims: [], retired: [], ignored: true };
      saveState(state); closePersistence();
    `)
    assert.equal(tamper.status, 0, tamper.stderr)
    const before = readFileSync(file)
    const rejected = run(file, backend, `const { store } = await import(${JSON.stringify(storeModule)}); store.initPersistence();`)
    assert.notEqual(rejected.status, 0)
    assert.match(rejected.stderr, /Refusing to replace existing data/)
    assert.deepEqual(readFileSync(file), before, 'failed startup leaves the malformed recovery bytes in place')
  })
}

test('Commission MCP snapshot joins reject wrong ownership, work, connection, and policy history', () => {
  const file = join(ROOT, 'joins')
  makeFixture(file, 'json')
  const state = stateFor(file)
  const valid = state.commissionMcp!
  assert.doesNotThrow(() => parseCommissionMcpRegistryState(valid), 'the fixture itself has a valid canonical registry shape')
  const cleanFixtureBase = structuredClone(state)
  cleanFixtureBase.agents = cleanFixtureBase.agents.filter(([id]) => id !== AGENT_ID)
  cleanFixtureBase.commissions = cleanFixtureBase.commissions.filter(([id]) => id !== COMMISSION_ID)
  cleanFixtureBase.openSubGoals = cleanFixtureBase.openSubGoals.filter(row => row.id !== ITEM_ID)
  cleanFixtureBase.commissionMcp = { policies: [], claims: [], retired: [] }
  const existingConnectionCount = cleanFixtureBase.mcpConnections.connections.length
  const reusedCatalog = addCommissionMcpSnapshotFixture(cleanFixtureBase)
  assert.equal(reusedCatalog.mcpConnections.connections.length, existingConnectionCount,
    'the comprehensive-style tenant-zeta fixture is reused without expanding its connection count')
  const connections = createMcpConnectionRegistry()
  connections.rehydrate(state.mcpConnections)
  const base = { commissions: state.commissions.map(([, row]) => row), agents: state.agents.map(([, row]) => row),
    work: state.openSubGoals, connections: connections.snapshot(), projectIds: new Set(['p-playground', 'p-insights']) }
  assert.equal(validateCommissionMcpRegistryJoins(valid, base), true)
  const copy = () => structuredClone(valid)

  const commissionId = valid.policies[0].commissionId
  const agentId = valid.policies[0].agentId
  const itemId = valid.claims[0].work.itemId
  const wrongAgent = { ...base, commissions: base.commissions.map(row => row.id === commissionId ? { ...row, agentId: 'agent-default' } : row) }
  const wrongProject = { ...base, commissions: base.commissions.map(row => row.id === commissionId ? { ...row, projectId: 'p-no-such-project' } : row) }
  const wrongTenant = { ...base, commissions: base.commissions.map(row => row.id === commissionId ? { ...row, tenantId: 'tenant-acme' } : row) }
  const wrongWork = { ...base, work: base.work.map(row => row.id === itemId ? { ...row, note: 'Changed in the canonical Project backlog.' } : row) }
  assert.equal(validateCommissionMcpRegistryJoins(copy(), wrongAgent), false, 'canonical Commission Agent mismatch is refused')
  assert.equal(validateCommissionMcpRegistryJoins(copy(), wrongProject), false, 'canonical Commission Project mismatch is refused')
  assert.equal(validateCommissionMcpRegistryJoins(copy(), wrongTenant), false, 'canonical Commission tenant mismatch is refused')
  assert.equal(validateCommissionMcpRegistryJoins(copy(), wrongWork), false, 'canonical Project work mismatch is refused')
  assert.equal(validateCommissionMcpRegistryJoins(copy(), { ...base, agents: base.agents.filter(row => row.id !== agentId) }), false,
    'missing canonical Agent is refused')
  assert.equal(validateCommissionMcpRegistryJoins(copy(), { ...base, commissions: base.commissions.filter(row => row.id !== commissionId) }), false,
    'missing canonical Commission is refused')
  assert.equal(validateCommissionMcpRegistryJoins(copy(), { ...base, work: base.work.filter(row => row.id !== itemId) }), false,
    'missing canonical work is refused')

  const missingHistory = copy()
  missingHistory.policies = []
  assert.throws(() => parseCommissionMcpRegistryState(missingHistory), /Commission MCP permission/)
  const duplicateHistory = copy()
  duplicateHistory.policies.push(structuredClone(duplicateHistory.policies[0]))
  assert.throws(() => parseCommissionMcpRegistryState(duplicateHistory), /Commission MCP permission/)

  const wrongOAuthOwner = copy()
  const connectionId = wrongOAuthOwner.policies[0].policy.approval.tools[0].connectionId
  const noLiveConnection = connections.snapshot().connections.filter(row => row.id !== connectionId)
  const retiredOAuthIdentity = parseMcpConnectionState({ connections: noLiveConnection,
    retired: [...connections.snapshot().retired, { tenantId: 'tenant-zeta', id: connectionId, ownerUserId: 'user-other' }] })
  assert.equal(validateCommissionMcpRegistryJoins(wrongOAuthOwner, { ...base, connections: retiredOAuthIdentity }), false,
    'a parsed retired OAuth identity must retain the exact approving person')

  const missingConnection = copy()
  const missingId = missingConnection.policies[0].policy.approval.tools[0].connectionId
  assert.equal(validateCommissionMcpRegistryJoins(missingConnection, { ...base,
    connections: { ...base.connections, connections: base.connections.connections.filter(row => row.id !== missingId) } }), false,
  'a removed connection without its retained identity cannot satisfy policy history')

  const stdio = copy()
  const selected = stdio.policies[0].policy.approval.tools[0].connectionId
  const source = connections.snapshot().connections.find(row => row.id === selected)!
  const stdioRegistry = createMcpConnectionRegistry()
  stdioRegistry.create({ transport: 'stdio', id: selected, label: source.label }, 'tenant-zeta', false, 'user-zeta')
  stdioRegistry.commitInspection(selected, 'tenant-zeta', 0, { protocolVersion: '2026-07-28', cleanup: 'not-needed',
    tools: source.inspection!.tools, schemaAdmission: source.inspection!.schemaAdmission }, 1800000000000,
  undefined, undefined, 'user-zeta', `MCP_STDIO_${'A'.repeat(32)}`)
  const stdioConnections = parseMcpConnectionState(stdioRegistry.snapshot())
  assert.equal(validateCommissionMcpRegistryJoins(stdio, { ...base, connections: stdioConnections }), false,
    'stdio identities cannot satisfy an HTTP-only Commission approval')
  const noProject = { ...base, projectIds: new Set(['p-playground']) }
  assert.equal(validateCommissionMcpRegistryJoins(valid, noProject), false, 'the assignment Project must be present')
})

test('store startup rejects a structurally consistent Commission MCP assignment to a missing Project', () => {
  const file = join(ROOT, 'orphan-project')
  makeFixture(file, 'json')
  const tamper = run(file, 'json', `
    const { loadState, saveState, closePersistence } = await import(${JSON.stringify(persistModule)});
    const { addCommissionMcpSnapshotFixture } = await import(${JSON.stringify(helperModule)});
    const state = loadState();
    state.agents = state.agents.filter(([id]) => id !== ${JSON.stringify(AGENT_ID)});
    state.commissions = state.commissions.filter(([id]) => id !== ${JSON.stringify(COMMISSION_ID)});
    state.openSubGoals = state.openSubGoals.filter(row => row.id !== ${JSON.stringify(ITEM_ID)});
    state.commissionMcp = { policies: [], claims: [], retired: [] };
    saveState(addCommissionMcpSnapshotFixture(state, 'done', 'project-mcp-missing'));
    closePersistence();
  `)
  assert.equal(tamper.status, 0, tamper.stderr)
  const rejected = run(file, 'json', `const { store } = await import(${JSON.stringify(storeModule)}); store.initPersistence();`)
  assert.notEqual(rejected.status, 0)
  assert.match(rejected.stderr, /invalid owner, work or connection bindings/)
})

for (const backend of ['json', 'sqlite'] as const) {
  test(`store deletion retires Commission authority and survives Agent deletion and restart (${backend})`, () => {
    const file = join(ROOT, `deletion-${backend}`)
    makeFixture(file, backend)
    const deleted = output(file, backend, `
      const { store } = await import(${JSON.stringify(storeModule)});
      const { loadState, closePersistence } = await import(${JSON.stringify(persistModule)});
      store.initPersistence();
      store.deleteCommission(${JSON.stringify(COMMISSION_ID)}, 0);
      let retiredKeyRejected = false;
      try {
        store.createCommission({ agentId: ${JSON.stringify(AGENT_ID)}, projectId: 'p-insights', role: 'writer' },
          'tenant-zeta', { logicalId: ${JSON.stringify(COMMISSION_ID)} });
      } catch (error) {
        retiredKeyRejected = /retired Contributor identity/.test(error.message);
      }
      store.deleteAgent(${JSON.stringify(AGENT_ID)}, 0);
      const state = loadState();
      console.log(JSON.stringify({ agents: state.agents.some(([id]) => id === ${JSON.stringify(AGENT_ID)}),
        commissions: state.commissions.some(([id]) => id === ${JSON.stringify(COMMISSION_ID)}),
        retired: state.commissionMcp.retired, claim: state.commissionMcp.claims[0],
        policies: state.commissionMcp.policies, retiredKeyRejected }));
      closePersistence();
    `)
    assert.equal(deleted.agents, false)
    assert.equal(deleted.commissions, false)
    assert.equal(deleted.retired.length, 1)
    assert.equal(deleted.retired[0].commissionId, COMMISSION_ID)
    assert.equal(deleted.claim.attempt.status, 'done', 'Agent removal preserves a settled exact receipt')
    assert.equal(deleted.policies.at(-1).policy.approval, null)
    assert.ok(deleted.policies.length >= 2, 'retirement appends policy history instead of erasing it')
    assert.equal(deleted.policies.at(-2).ownerUserId, 'user-zeta')
    assert.ok(deleted.policies.at(-2).policy.approval, 'history retains the prior explicit grant')
    assert.equal(deleted.retiredKeyRejected, true, 'a retired keyed Commission identity cannot be recreated')

    const restarted = output(file, backend, `
      const { store } = await import(${JSON.stringify(storeModule)});
      const { loadState, closePersistence } = await import(${JSON.stringify(persistModule)});
      store.initPersistence();
      const state = loadState();
      console.log(JSON.stringify({ agents: state.agents.some(([id]) => id === ${JSON.stringify(AGENT_ID)}),
        commissions: state.commissions.some(([id]) => id === ${JSON.stringify(COMMISSION_ID)}),
        retired: state.commissionMcp.retired, claim: state.commissionMcp.claims[0],
        policies: state.commissionMcp.policies }));
      closePersistence();
    `)
    assert.equal(restarted.agents, false, 'restart must not resurrect the deleted Agent')
    assert.equal(restarted.commissions, false, 'restart must not resurrect the deleted Commission')
    assert.deepEqual(restarted.retired, deleted.retired, 'the retirement anchor survives restart')
    assert.deepEqual(restarted.policies, deleted.policies, 'retirement policy history survives restart')
    assert.deepEqual(restarted.claim, deleted.claim, 'the known terminal claim result survives restart unchanged')
  })
}
