/** Direct keyed Artifact creation is one durable graph/body/filing act. This
 * suite boots both real persistence backends in fresh processes and exercises
 * durable identity recovery rather than the HTTP response cache. */
import { after, test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const ROOT = mkdtempSync(join(tmpdir(), `agent-commons-artifact-creation-${process.pid}-`))
const storeModule = new URL('../store/index.ts', import.meta.url).href
const persistenceModule = new URL('./persist.ts', import.meta.url).href
const identityModule = new URL('../artifactCreationIdentity.ts', import.meta.url).href
const testkitModule = new URL('../testkit/http.ts', import.meta.url).href

after(() => rmSync(ROOT, { recursive: true, force: true }))

function boot(file: string, backend: 'json' | 'sqlite', work: string) {
  const script = `
    const { store } = await import(${JSON.stringify(storeModule)});
    const { loadState, closePersistence } = await import(${JSON.stringify(persistenceModule)});
    const { artifactCreationId } = await import(${JSON.stringify(identityModule)});
    store.initPersistence();
    ${work}
    closePersistence();
  `
  return spawnSync(process.execPath, ['--input-type=module', '--eval', script], {
    encoding: 'utf8',
    timeout: 20_000,
    env: {
      ...process.env,
      INITIAL_WORLD: 'clean',
      BACKEND: 'mock',
      PERSIST_BACKEND: backend,
      DATA_FILE: file,
      DATABASE_PATH: file,
    },
  })
}

function ok(result: ReturnType<typeof boot>): Record<string, any> {
  assert.equal(result.status, 0, result.stderr)
  return JSON.parse(result.stdout)
}

for (const backend of ['json', 'sqlite'] as const) {
  test(`${backend}: keyed document, sheet, and slides round-trip with exact ID bodies and filing`, () => {
    const file = join(ROOT, `direct-artifacts-${backend}`)
    const first = ok(boot(file, backend, `
      const tenant = 'tenant-durable-direct-artifacts';
      const project = store.createProject({ name: 'Durable artifact project' }, tenant).project;
      const inputs = [
        { key: 'durable-doc', request: { name: 'durable.md', kind: 'doc', body: 'Durable document body.', projectId: project.id } },
        { key: 'durable-sheet', request: { name: 'durable.sheet', kind: 'sheet', body: { type: 'sheet', columns: ['Metric', 'Value'], rows: [['Revenue', '=SUM(B2:B3)']], note: 'Literal formula.' }, projectId: project.id } },
        { key: 'durable-slides', request: { name: 'durable.slides', kind: 'slide', body: { type: 'slides', slides: [{ title: 'Launch', bullets: ['Ready', 'Ship'] }] }, projectId: null } },
      ];
      const created = inputs.map(({ key, request }) => store.createArtifact(request, tenant, artifactCreationId(tenant, key)));
      console.log(JSON.stringify({ project, created, state: loadState() }));
    `))
    assert.equal(first.created.length, 3)
    for (const created of first.created) {
      assert.match(created.artifact.id, /^artifact-new-[a-f0-9]{24}$/)
      assert.equal(created.artifact.tenantId, 'tenant-durable-direct-artifacts')
      assert.ok(first.state.graph.extraArtifacts.some((row: any) => row.id === created.artifact.id))
      assert.ok(first.state.artifactBodies.some(([id]: [string, unknown]) => id === created.artifact.id))
    }
    assert.equal(first.state.graph.artifactProject[first.created[0].artifact.id], first.project.id)
    assert.equal(first.state.graph.artifactProject[first.created[1].artifact.id], first.project.id)
    assert.equal(first.state.graph.artifactProject[first.created[2].artifact.id], undefined)

    const second = ok(boot(file, backend, `
      const tenant = 'tenant-durable-direct-artifacts';
      const ids = ['durable-doc', 'durable-sheet', 'durable-slides'].map(key => artifactCreationId(tenant, key));
      const rows = ids.map(id => store.listArtifacts(tenant).find(row => row.id === id));
      const bodies = ids.map(id => store.artifactContent(tenant)[id]);
      const replay = store.createArtifact(
        { name: 42, kind: 'image', body: null, projectId: 'unavailable-project' },
        tenant,
        ids[1],
      );
      console.log(JSON.stringify({ rows, bodies, replay, state: loadState() }));
    `))
    assert.deepEqual(second.rows.map((row: any) => row.id), first.created.map((created: any) => created.artifact.id))
    assert.deepEqual(second.bodies.map((body: any) => body.type), ['doc', 'sheet', 'slides'])
    assert.equal(second.bodies[0].blocks[0].p, 'Durable document body.')
    assert.equal(second.bodies[1].rows[0][1], '=SUM(B2:B3)')
    assert.equal(second.bodies[2].slides[0].title, 'Launch')
    assert.equal(second.replay.artifact.id, first.created[1].artifact.id, 'restart replay precedes changed input parsing')
    assert.equal(second.state.graph.extraArtifacts.filter((row: any) => /^artifact-new-/.test(row.id)).length, 3)
  })
}

test('a failed Artifact snapshot publishes no creation event and walls exact HTTP replay', () => {
  const file = join(ROOT, 'direct-artifact-failed-commit.json')
  const blocked = join(ROOT, 'blocked-artifact-store')
  const result = ok(boot(file, 'json', `
    const { mkdirSync } = await import('node:fs');
    const { call } = await import(${JSON.stringify(testkitModule)});
    const tenant = 'tenant-direct-artifact-failed-commit';
    const key = 'failed-commit-key';
    const id = artifactCreationId(tenant, key);
    const events = [];
    const unsubscribe = store.subscribe(event => events.push(event));
    mkdirSync(${JSON.stringify(blocked)});
    process.env.DATA_FILE = ${JSON.stringify(blocked)};
    const report = console.error;
    console.error = () => {};
    let failed;
    try {
      failed = await call('POST', '/artifacts',
        { name: 'not-durable.md', kind: 'doc', body: 'Never acknowledge this body.' },
        { 'x-tenant-id': tenant, 'idempotency-key': key });
    } finally {
      console.error = report;
    }
    process.env.DATA_FILE = ${JSON.stringify(file)};
    const replay = await call('POST', '/artifacts',
      { name: 'changed.md', kind: 'doc', body: 'Changed retry.' },
      { 'x-tenant-id': tenant, 'idempotency-key': key });
    unsubscribe();
    const durable = loadState();
    console.log(JSON.stringify({
      failedStatus: failed.status,
      replayStatus: replay.status,
      healthy: store.persistenceHealthy(),
      creationEvents: events.filter(event => event.type === 'artifact.changed' && event.artifactId === id),
      durableHasRow: durable.graph.extraArtifacts.some(row => row.id === id),
      durableHasBody: durable.artifactBodies.some(([artifactId]) => artifactId === id),
    }));
  `))
  assert.equal(result.failedStatus, 503)
  assert.equal(result.replayStatus, 503, 'poisoned memory cannot become a later HTTP acknowledgement')
  assert.equal(result.healthy, false)
  assert.deepEqual(result.creationEvents, [])
  assert.equal(result.durableHasRow, false)
  assert.equal(result.durableHasBody, false)
})
