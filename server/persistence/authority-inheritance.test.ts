/** Sparse per-dimension authority, transitive attenuation and runtime inherited
 * walls survive real JSON/SQLite restarts without widening saved child intent. */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'

const root = mkdtempSync(join(tmpdir(), 'agent-commons-authority-inheritance-'))
const storeModule = new URL('../store/index.ts', import.meta.url).href
const persistModule = new URL('./persist.ts', import.meta.url).href
const contractModule = new URL('../../contract/index.ts', import.meta.url).href
const identityModule = new URL('../commissionCreationIdentity.ts', import.meta.url).href
after(() => rmSync(root, { recursive: true, force: true }))

function child(script: string, file: string, backend: 'json' | 'sqlite') {
  return JSON.parse(execFileSync(process.execPath, ['--input-type=module', '--eval', script], {
    encoding: 'utf8', timeout: 30_000,
    env: { ...process.env, INITIAL_WORLD: 'clean', DEPLOYMENT_PROFILE: '', BACKEND: 'mock',
      PERSIST_BACKEND: backend, DATA_FILE: file, DATABASE_PATH: file },
  })) as any
}

const prelude = `
  const { store } = await import(${JSON.stringify(storeModule)});
  const { loadState, closePersistence } = await import(${JSON.stringify(persistModule)});
  const { DEFAULT_PROVIDER_ID } = await import(${JSON.stringify(contractModule)});
  const { commissionCreationId } = await import(${JSON.stringify(identityModule)});
  const owner = 'tenant-personal';
  const broad = { tools: ['read', 'write'], connectors: ['GitHub', 'Salesforce'], scopes: ['/repo', '/private'] };
  const narrow = { tools: ['read'], connectors: ['GitHub'], scopes: ['/repo'] };
  let calls = 0;
  globalThis.fetch = async () => { calls++; throw new Error('Authority definitions must never perform network I/O.'); };
  store.initPersistence();
  const owned = state => ({
    agents: state.agents.filter(([, row]) => row.tenantId === owner),
    commissions: state.commissions.filter(([, row]) => row.tenantId === owner),
  });
  const replay = group => store.createCommission({ agentId: group.agentId, projectId: group.projectId,
    role: 'writer', authority: { [group.dimension]: broad[group.dimension] } }, owner, { logicalId: group.logicalId });
  const reach = groups => groups.map(group => ({
    explicitDenied: !store.commissionCanReach(group.changedId, group.dimension, broad[group.dimension][1]),
    partialDenied: !store.commissionCanReach(group.partialId, group.dimension, broad[group.dimension][1]),
    emptyDenied: !store.commissionCanReach(group.emptyId, group.dimension, broad[group.dimension][1]),
    allowed: store.commissionCanReach(group.partialId, group.dimension, narrow[group.dimension][0]),
  }));
`

for (const backend of ['json', 'sqlite'] as const) {
  test(`${backend}: dimension-wise ancestor authority survives restart, exact replay and later expansion`, () => {
    const file = join(root, `authority.${backend === 'json' ? 'json' : 'db'}`)
    const created = child(`${prelude}
      const originalDefault = structuredClone(store.listProviders().find(row => row.id === DEFAULT_PROVIDER_ID));
      store.updateProvider(DEFAULT_PROVIDER_ID, { authority: broad });
      const explicit = store.createProvider({ label: 'Durable authority parent', modelFamily: 'custom',
        effortLevels: [], authority: broad }, {}, owner);
      const project = store.createProject({ name: 'Durable authority inheritance' }, owner).project;
      for (const [kind, labels] of [['connector', broad.connectors], ['folder', broad.scopes]]) {
        for (const label of labels) store.applyRelationOp({ kind: 'scope-context', projectId: project.id,
          projectName: project.name, context: { kind, label, meta: '' } }, owner);
      }
      const groups = [];
      for (const binding of ['default', 'explicit']) for (const dimension of ['tools', 'connectors', 'scopes']) {
        const other = dimension === 'tools' ? 'connectors' : 'tools';
        let agent = binding === 'default'
          ? store.importAgentFromCard({ name: 'Durable unbound partial definition' }, 'https://cards.invalid/sparse', owner)
          : store.createAgent({ label: 'Durable explicit partial definition', systemPrompt: 'No calls.', instructions: '',
              tools: [], providerId: explicit.id }, owner);
        agent = store.updateAgentFromRequest(agent.id, { authority: { [other]: narrow[other] } });
        const group = { binding, dimension, other, agentId: agent.id, projectId: project.id,
          logicalId: commissionCreationId(owner, binding + '-' + dimension) };
        group.changedId = replay(group).id;
        group.partialId = store.createCommission({ agentId: agent.id, projectId: project.id, role: 'writer',
          authority: { [other]: narrow[other] } }, owner).id;
        group.emptyId = store.createCommission({ agentId: agent.id, projectId: project.id, role: 'writer', authority: {} }, owner).id;
        groups.push(group);
      }
      const before = owned(loadState()), usageBefore = loadState().usageMeters;
      const events = [];
      const unsubscribe = store.subscribe(event => { events.push(event.type); });
      store.updateProvider(DEFAULT_PROVIDER_ID, { authority: narrow });
      store.updateProvider(explicit.id, { authority: narrow });
      unsubscribe();
      const state = loadState();
      const report = { groups, originalDefault, explicitId: explicit.id, before, after: owned(state), events,
        reach: reach(groups), calls, pending: store.pendingScheduleRuns(),
        usageUnchanged: JSON.stringify(state.usageMeters) === JSON.stringify(usageBefore) };
      closePersistence();
      console.log(JSON.stringify(report));
    `, file, backend)
    const row = (entries: any[], id: string) => entries.find(([key]) => key === id)?.[1]
    const expected: Record<string, string[]> = { tools: ['read'], connectors: ['GitHub'], scopes: ['/repo'] }
    assert.deepEqual(created.after.agents, created.before.agents, 'unchanged partial Agent shapes acquire no synthetic revisions')
    for (const group of created.groups) {
      const agent = row(created.after.agents, group.agentId)
      assert.deepEqual(agent.authority, { [group.other]: expected[group.other] })
      assert.equal(agent.providerId, group.binding === 'default' ? undefined : created.explicitId)
      const changed = row(created.after.commissions, group.changedId)
      assert.deepEqual(changed.authority, { [group.dimension]: expected[group.dimension] },
        `${group.binding}/${group.dimension}: an omitted Agent axis retains its provider wall`)
      assert.equal(changed.configurationRevision, (row(created.before.commissions, group.changedId).configurationRevision ?? 0) + 1)
      for (const id of [group.partialId, group.emptyId]) assert.deepEqual(row(created.after.commissions, id), row(created.before.commissions, id))
    }
    assert.deepEqual(created.reach, created.groups.map(() => ({ explicitDenied: true, partialDenied: true, emptyDenied: true, allowed: true })))
    assert.equal(created.events.filter((type: string) => type === 'agent.changed').length, 0)
    assert.equal(created.events.filter((type: string) => type === 'commission.changed').length, created.groups.length)
    assert.equal(created.events.filter((type: string) => type === 'provider.changed').length, 2)
    assert.equal(created.calls, 0)
    assert.equal(created.usageUnchanged, true)
    assert.deepEqual(created.pending, [])

    const expanded = child(`${prelude}
      const groups = ${JSON.stringify(created.groups)};
      const before = owned(loadState()), usageBefore = loadState().usageMeters;
      const inheritedReach = reach(groups), replayEvents = [], expansionEvents = [];
      let unsubscribe = store.subscribe(event => { replayEvents.push(event.type); });
      const represented = groups.map(group => replay(group));
      unsubscribe();
      const afterReplay = owned(loadState());
      unsubscribe = store.subscribe(event => { expansionEvents.push(event.type); });
      store.updateProvider(DEFAULT_PROVIDER_ID, { authority: broad });
      store.updateProvider(${JSON.stringify(created.explicitId)}, { authority: broad });
      unsubscribe();
      const afterExpansion = owned(loadState());
      const original = ${JSON.stringify(created.originalDefault)};
      store.updateProvider(DEFAULT_PROVIDER_ID, { authority: original.authority });
      const state = loadState();
      const report = { before, inheritedReach, represented, replayEvents, afterReplay, afterExpansion,
        afterRestore: owned(state), expansionEvents, calls,
        restoredDefault: state.providers.find(([id]) => id === DEFAULT_PROVIDER_ID)[1],
        usageUnchanged: JSON.stringify(state.usageMeters) === JSON.stringify(usageBefore) };
      closePersistence();
      console.log(JSON.stringify(report));
    `, file, backend)
    assert.deepEqual(expanded.before, created.after, 'restart retains exact sparse objects and attenuated revisions')
    assert.deepEqual(expanded.inheritedReach, created.reach, 'restart does not drop inherited runtime walls')
    assert.deepEqual(expanded.afterReplay, created.after)
    assert.deepEqual(expanded.replayEvents, [])
    for (const [index, represented] of expanded.represented.entries()) {
      assert.deepEqual(represented, row(created.after.commissions, created.groups[index].changedId),
        'exact keyed creation returns current attenuated truth before rechecking old broader input')
    }
    assert.deepEqual(expanded.afterExpansion, created.after, 'later parent expansion never widens an explicit attenuated grant')
    assert.deepEqual(expanded.afterRestore, created.after)
    assert.deepEqual(expanded.restoredDefault.authority, created.originalDefault.authority)
    assert.equal(expanded.expansionEvents.filter((type: string) => type === 'agent.changed' || type === 'commission.changed').length, 0)
    assert.equal(expanded.calls, 0)
    assert.equal(expanded.usageUnchanged, true)

    const reboot = child(`${prelude}
      console.log(JSON.stringify({ persisted: owned(loadState()), calls, pending: store.pendingScheduleRuns() }));
      closePersistence();
    `, file, backend)
    assert.deepEqual(reboot.persisted, expanded.afterRestore)
    assert.equal(reboot.calls, 0)
    assert.deepEqual(reboot.pending, [])
  })
}
