/** Sparse budget definitions and transitively attenuated grants survive actual
 * JSON/SQLite process restarts without widening or synthetic Agent revisions. */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'

const root = mkdtempSync(join(tmpdir(), 'agent-commons-budget-inheritance-'))
const storeModule = new URL('../store/index.ts', import.meta.url).href
const persistModule = new URL('./persist.ts', import.meta.url).href
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
  const FIVE = '5-hour limit', WEEK = 'Weekly · all models';
  const owner = 'tenant-personal';
  const budget = (five, weekly) => ({ windows: [
    ...(five === undefined ? [] : [{ label: FIVE, ceiling: five }]),
    ...(weekly === undefined ? [] : [{ label: WEEK, ceiling: weekly }]),
  ] });
  let calls = 0;
  globalThis.fetch = async () => { calls++; throw new Error('Budget persistence must never call a provider.'); };
  store.initPersistence();
  const owned = state => ({
    agents: state.agents.filter(([, row]) => row.tenantId === owner),
    commissions: state.commissions.filter(([, row]) => row.tenantId === owner),
    providers: state.providers.filter(([, row]) => row.tenantId === owner),
  });
`

for (const backend of ['json', 'sqlite'] as const) {
  test(`${backend}: sparse inherited budgets and narrowed Commission revisions survive restart and later parent expansion`, () => {
    const file = join(root, `inheritance.${backend === 'json' ? 'json' : 'db'}`)
    const created = child(`${prelude}
      const parent = store.createProvider({ label: 'Durable sparse provider', modelFamily: 'custom',
        effortLevels: [], plan: budget(500, 1000) }, {}, owner);
      const project = store.createProject({ name: 'Durable sparse grants' }, owner).project;
      const groups = [];
      for (const mode of ['omitted', 'empty', 'sparse']) {
        const initial = store.createAgent({ label: 'Durable ' + mode + ' Agent', systemPrompt: 'Keep explicit grants.',
          tools: [], instructions: '', providerId: parent.id,
          ...(mode === 'omitted' ? {} : { budget: budget(100, 1000) }) }, owner);
        const commission = grant => store.createCommission({ agentId: initial.id, projectId: project.id,
          role: 'writer', ...(grant === undefined ? {} : { grant }) }, owner);
        const changed = commission(budget(undefined, 800));
        const unchanged = commission(budget(20));
        const empty = commission(budget());
        const inherited = commission();
        if (mode !== 'omitted') store.updateAgentFromRequest(initial.id,
          { budget: mode === 'empty' ? budget() : budget(100) }, initial.revision);
        groups.push({ mode, agentId: initial.id, changedId: changed.id, unchangedId: unchanged.id,
          emptyId: empty.id, inheritedId: inherited.id });
      }
      const before = owned(loadState());
      const usageBefore = loadState().usageMeters;
      store.updateProvider(parent.id, { plan: budget(500, 200) }, parent.definitionRevision);
      const state = loadState();
      const report = { groups, parentId: parent.id, before, after: owned(state), calls,
        usageUnchanged: JSON.stringify(state.usageMeters) === JSON.stringify(usageBefore),
        pending: store.pendingScheduleRuns() };
      closePersistence();
      console.log(JSON.stringify(report));
    `, file, backend)
    const row = (entries: any[], id: string) => entries.find(([key]) => key === id)?.[1]
    for (const group of created.groups) {
      const beforeAgent = row(created.before.agents, group.agentId)
      const afterAgent = row(created.after.agents, group.agentId)
      assert.deepEqual(afterAgent, beforeAgent, `${group.mode}: inherited parent narrowing does not falsely revise the Agent`)
      assert.deepEqual(afterAgent.budget, group.mode === 'omitted' ? undefined : group.mode === 'empty'
        ? { windows: [] } : { windows: [{ label: '5-hour limit', ceiling: 100 }] })
      const beforeChanged = row(created.before.commissions, group.changedId)
      const changed = row(created.after.commissions, group.changedId)
      assert.deepEqual(changed.grant, { windows: [{ label: 'Weekly · all models', ceiling: 200 }] },
        `${group.mode}: the inherited weekly ceiling must reach the saved sparse Commission`)
      assert.equal(changed.configurationRevision, (beforeChanged.configurationRevision ?? 0) + 1)
      for (const id of [group.unchangedId, group.emptyId, group.inheritedId]) {
        assert.deepEqual(row(created.after.commissions, id), row(created.before.commissions, id),
          'unchanged sparse, empty and absent grants retain exact shape and revision')
      }
    }
    assert.equal(created.calls, 0)
    assert.equal(created.usageUnchanged, true)
    assert.deepEqual(created.pending, [])

    const expanded = child(`${prelude}
      const before = owned(loadState());
      const usageBefore = loadState().usageMeters;
      const events = [];
      const unsubscribe = store.subscribe(event => { events.push(event.type); });
      store.updateProvider(${JSON.stringify(created.parentId)}, { plan: budget(500, 1000) });
      unsubscribe();
      const state = loadState();
      const report = { before, after: owned(state), events, calls,
        usageUnchanged: JSON.stringify(state.usageMeters) === JSON.stringify(usageBefore) };
      closePersistence();
      console.log(JSON.stringify(report));
    `, file, backend)
    assert.deepEqual(expanded.before, created.after, 'fresh-process admission retains the exact narrowed persisted rows')
    assert.deepEqual(expanded.after.agents, created.after.agents)
    assert.deepEqual(expanded.after.commissions, created.after.commissions, 'expansion cannot widen a previously attenuated Commission')
    assert.equal(expanded.events.filter((type: string) => type === 'provider.changed').length, 1)
    assert.equal(expanded.events.filter((type: string) => type === 'agent.changed' || type === 'commission.changed').length, 0)
    assert.equal(expanded.calls, 0)
    assert.equal(expanded.usageUnchanged, true)

    const reboot = child(`${prelude}
      const report = { persisted: owned(loadState()), calls, pending: store.pendingScheduleRuns() };
      closePersistence();
      console.log(JSON.stringify(report));
    `, file, backend)
    assert.deepEqual(reboot.persisted, expanded.after, 'another restart preserves the attenuated child after parent expansion')
    assert.equal(reboot.calls, 0)
    assert.deepEqual(reboot.pending, [])
  })
}
