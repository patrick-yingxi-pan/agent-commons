/** Ordinary imported/forked unbound definitions inherit the live fixed default
 * through grant attenuation, keyed replay, and real JSON/SQLite restarts. */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'

const root = mkdtempSync(join(tmpdir(), 'agent-commons-default-provider-grants-'))
const storeModule = new URL('../store/index.ts', import.meta.url).href
const persistModule = new URL('./persist.ts', import.meta.url).href
const contractModule = new URL('../../contract/index.ts', import.meta.url).href
const agentIdentityModule = new URL('../agentCreationIdentity.ts', import.meta.url).href
const commissionIdentityModule = new URL('../commissionCreationIdentity.ts', import.meta.url).href
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
  const { agentForkCreationId, agentImportCreationId } = await import(${JSON.stringify(agentIdentityModule)});
  const { commissionCreationId } = await import(${JSON.stringify(commissionIdentityModule)});
  const owner = 'tenant-personal', sourceOwner = 'tenant-default-grants-source';
  const budget = (five, weekly) => ({ windows: [
    ...(five === undefined ? [] : [{ label: '5-hour limit', ceiling: five }]),
    ...(weekly === undefined ? [] : [{ label: 'Weekly · all models', ceiling: weekly }]),
  ] });
  let calls = 0;
  globalThis.fetch = async () => { calls++; throw new Error('Definition grants must never perform network I/O.'); };
  store.initPersistence();
  const owned = state => ({
    agents: state.agents.filter(([, row]) => row.tenantId === owner),
    commissions: state.commissions.filter(([, row]) => row.tenantId === owner),
  });
  const replayAgent = group => group.kind === 'import'
    ? store.importAgentFromCard({ name: 'Durable imported definition' }, 'https://cards.invalid/durable', owner,
        { logicalId: group.agentLogicalId })
    : store.forkAgent(group.sourceId, owner, { logicalId: group.agentLogicalId });
  const replayCommission = group => store.createCommission({ agentId: group.agentId, projectId: group.projectId,
    role: 'writer', grant: budget(undefined, 800), authority: { tools: ['read', 'write'] } }, owner,
    { logicalId: group.commissionLogicalId });
`

for (const backend of ['json', 'sqlite'] as const) {
  test(`${backend}: unbound import/fork grants narrow durably without false Agent revisions or replay widening`, () => {
    const file = join(root, `default-grants.${backend === 'json' ? 'json' : 'db'}`)
    const created = child(`${prelude}
      const original = structuredClone(store.listProviders().find(row => row.id === DEFAULT_PROVIDER_ID));
      store.updateProvider(DEFAULT_PROVIDER_ID, { plan: budget(500, 1000), authority: { tools: ['read', 'write'] } });
      const privateProvider = store.createProvider({ label: 'Foreign private cognition', modelFamily: 'custom',
        effortLevels: [] }, {}, sourceOwner);
      const source = store.createAgent({ label: 'Published foreign source', systemPrompt: 'A definition only.', tools: [],
        instructions: '', providerId: privateProvider.id }, sourceOwner);
      store.updateAgentFromRequest(source.id, { published: true });
      const project = store.createProject({ name: 'Durable unbound grants' }, owner).project;
      const groups = [];
      for (const kind of ['import', 'fork']) for (const mode of ['absent', 'empty', 'sparse']) {
        const key = kind + '-' + mode;
        const group = { kind, mode, projectId: project.id, sourceId: source.id,
          agentLogicalId: kind === 'import' ? agentImportCreationId(owner, key) : agentForkCreationId(owner, key),
          commissionLogicalId: commissionCreationId(owner, key) };
        const agent = replayAgent(group);
        group.agentId = agent.id;
        if (mode !== 'absent') store.updateAgentFromRequest(agent.id, { budget: mode === 'empty' ? budget() : budget(100) });
        group.changedId = replayCommission(group).id;
        const commission = grant => store.createCommission({ agentId: agent.id, projectId: project.id, role: 'writer',
          ...(grant === undefined ? {} : { grant }) }, owner);
        group.unchangedId = commission(budget(undefined, 100)).id;
        group.emptyId = commission(budget()).id;
        group.inheritedId = commission().id;
        groups.push(group);
      }
      const before = owned(loadState());
      const usageBefore = loadState().usageMeters;
      const events = [];
      const unsubscribe = store.subscribe(event => { events.push(event.type); });
      store.updateProvider(DEFAULT_PROVIDER_ID, { plan: budget(500, 200), authority: { tools: ['read'] } });
      unsubscribe();
      const state = loadState();
      const report = { groups, original, before, after: owned(state), events, calls,
        defaultProvider: state.providers.find(([id]) => id === DEFAULT_PROVIDER_ID)[1],
        usageUnchanged: JSON.stringify(state.usageMeters) === JSON.stringify(usageBefore),
        pending: store.pendingScheduleRuns() };
      closePersistence();
      console.log(JSON.stringify(report));
    `, file, backend)
    const row = (entries: any[], id: string) => entries.find(([key]) => key === id)?.[1]
    for (const group of created.groups) {
      const agent = row(created.after.agents, group.agentId)
      assert.deepEqual(agent, row(created.before.agents, group.agentId), `${group.kind}/${group.mode}: inherited shrink does not revise Agent`)
      assert.equal(agent.providerId, undefined, 'the current ordinary API created an unbound definition')
      assert.deepEqual(agent.budget, group.mode === 'absent' ? undefined : group.mode === 'empty' ? { windows: [] }
        : { windows: [{ label: '5-hour limit', ceiling: 100 }] })
      const changed = row(created.after.commissions, group.changedId)
      assert.deepEqual(changed.grant, { windows: [{ label: 'Weekly · all models', ceiling: 200 }] },
        `${group.kind}/${group.mode}: live default shrink reaches the persisted Commission`)
      assert.deepEqual(changed.authority, { tools: ['read'] })
      assert.equal(changed.configurationRevision, (row(created.before.commissions, group.changedId).configurationRevision ?? 0) + 1,
        'combined authority/budget attenuation is one configuration change')
      for (const id of [group.unchangedId, group.emptyId, group.inheritedId]) {
        assert.deepEqual(row(created.after.commissions, id), row(created.before.commissions, id))
      }
    }
    assert.equal(created.events.filter((type: string) => type === 'agent.changed').length, 0)
    assert.equal(created.events.filter((type: string) => type === 'commission.changed').length, created.groups.length)
    assert.equal(created.events.filter((type: string) => type === 'provider.changed').length, 1)
    assert.equal(created.calls, 0)
    assert.equal(created.usageUnchanged, true)
    assert.deepEqual(created.pending, [])

    const expanded = child(`${prelude}
      const groups = ${JSON.stringify(created.groups)};
      const before = owned(loadState());
      const defaultBefore = loadState().providers.find(([id]) => id === DEFAULT_PROVIDER_ID)[1];
      const usageBefore = loadState().usageMeters;
      const sourceBefore = store.listAgents(sourceOwner).find(row => row.id === groups[0].sourceId);
      const replayEvents = [], expansionEvents = [];
      let unsubscribe = store.subscribe(event => { replayEvents.push(event.type); });
      const replay = groups.map(group => ({ agent: replayAgent(group), commission: replayCommission(group),
        denied: !store.commissionCanReach(group.inheritedId, 'tools', 'write') }));
      unsubscribe();
      const afterReplay = owned(loadState());
      const sourceAfter = store.listAgents(sourceOwner).find(row => row.id === groups[0].sourceId);
      unsubscribe = store.subscribe(event => { expansionEvents.push(event.type); });
      store.updateProvider(DEFAULT_PROVIDER_ID, { plan: budget(500, 1000), authority: { tools: ['read', 'write'] } });
      unsubscribe();
      const afterExpansion = owned(loadState());
      const original = ${JSON.stringify(created.original)};
      store.updateProvider(DEFAULT_PROVIDER_ID, { plan: original.plan, authority: original.authority });
      const state = loadState();
      const report = { before, defaultBefore, afterReplay, replay, replayEvents, sourceBefore, sourceAfter,
        afterExpansion, afterRestore: owned(state), expansionEvents, calls,
        restoredDefault: state.providers.find(([id]) => id === DEFAULT_PROVIDER_ID)[1],
        usageUnchanged: JSON.stringify(state.usageMeters) === JSON.stringify(usageBefore) };
      closePersistence();
      console.log(JSON.stringify(report));
    `, file, backend)
    assert.deepEqual(expanded.before, created.after, 'a real restart preserves exact sparse shapes and clamped revisions')
    assert.deepEqual(expanded.defaultBefore, created.defaultProvider, 'the narrowed live default itself is durable')
    assert.deepEqual(expanded.afterReplay, created.after)
    assert.deepEqual(expanded.replayEvents, [])
    assert.deepEqual(expanded.sourceAfter, expanded.sourceBefore, 'fork replay awards no second source credit')
    for (const [index, replay] of expanded.replay.entries()) {
      assert.deepEqual(replay.agent, row(created.after.agents, created.groups[index].agentId))
      assert.deepEqual(replay.commission, row(created.after.commissions, created.groups[index].changedId))
      assert.equal(replay.denied, true, 'inheriting authority reads the narrowed default after restart')
    }
    assert.deepEqual(expanded.afterExpansion, created.after, 'later parent expansion cannot widen attenuated grants')
    assert.deepEqual(expanded.afterRestore, created.after, 'restoring fixture settings cannot widen saved child grants')
    assert.equal(expanded.expansionEvents.filter((type: string) => type === 'agent.changed' || type === 'commission.changed').length, 0)
    assert.deepEqual(expanded.restoredDefault.plan, created.original.plan)
    assert.deepEqual(expanded.restoredDefault.authority, created.original.authority)
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
