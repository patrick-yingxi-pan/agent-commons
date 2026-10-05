/** Artifact body history and exact restore receipts survive real backend restart. */
import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { hasCorePersistedShape } from './format.ts'
import { restoreBackendState } from './portable.ts'

const ROOT = mkdtempSync(join(tmpdir(), `agent-commons-artifact-history-${process.pid}-`))
const storeModule = new URL('../store/index.ts', import.meta.url).href
const persistenceModule = new URL('./persist.ts', import.meta.url).href
const identityModule = new URL('../artifactCreationIdentity.ts', import.meta.url).href
const routesModule = new URL('../testkit/http.ts', import.meta.url).href
after(() => rmSync(ROOT, { recursive: true, force: true }))

function boot(file: string, backend: 'json' | 'sqlite', work: string) {
  const script = `
    const { store } = await import(${JSON.stringify(storeModule)});
    const { loadState, closePersistence } = await import(${JSON.stringify(persistenceModule)});
    const { artifactCreationId } = await import(${JSON.stringify(identityModule)});
    const { call } = await import(${JSON.stringify(routesModule)});
    store.initPersistence();
    ${work}
    console.log(JSON.stringify(loadState()));
    closePersistence();
  `
  return spawnSync(process.execPath, ['--input-type=module', '--eval', script], {
    encoding: 'utf8', timeout: 20_000,
    env: { ...process.env, INITIAL_WORLD: 'clean', BACKEND: 'mock', PERSIST_BACKEND: backend, DATA_FILE: file, DATABASE_PATH: file },
  })
}

function stateOf(result: ReturnType<typeof boot>): any {
  assert.equal(result.status, 0, result.stderr || result.stdout)
  return JSON.parse(result.stdout.trim())
}

for (const backend of ['json', 'sqlite'] as const) {
  test(`${backend}: Artifact history and exact restore receipt survive restart without a second version`, () => {
    const file = join(ROOT, `history-${backend}`)
    const owner = `tenant-history-${backend}`
    const key = `durable-restore-${backend}`
    const setup = stateOf(boot(file, backend, `
      const owner = ${JSON.stringify(owner)};
      const key = ${JSON.stringify(key)};
      const id = artifactCreationId(owner, key);
      const created = store.createArtifact({ name: 'durable-history.md', kind: 'doc', body: 'Original durable body.\\n\\nSecond paragraph.' }, owner, id);
      if (!created || created === 'invalid') throw new Error('Artifact fixture creation failed');
      store.updateArtifactBlock(id, 0, 'Edited durable body.', 0);
      const response = await call('POST', '/artifacts/' + id + '/history/0/restore', { expectedRevision: 1 }, { 'x-tenant-id': owner, 'idempotency-key': 'exact-restore-key-' + key });
      if (response.status !== 200) throw new Error('Restore route failed: ' + JSON.stringify(response));
    `))
    const artifactId = setup.artifactHistory[0][0]
    assert.ok(artifactId)
    assert.equal(setup.artifactHistory[0][1].length, 3)
    assert.equal(setup.artifactHistory[0][1].at(-1).reason, 'restore')
    assert.equal(setup.artifactHistoryRestoreReceipts.length, 1)
    assert.equal(JSON.stringify(setup.artifactHistoryRestoreReceipts).includes('exact-restore-key'), false, 'raw retry keys are not persisted')
    assert.equal(hasCorePersistedShape(setup), true)

    const replay = stateOf(boot(file, backend, `
      const response = await call('POST', ${JSON.stringify(`/artifacts/${artifactId}/history/0/restore`)}, { expectedRevision: 1 }, { 'x-tenant-id': ${JSON.stringify(owner)}, 'idempotency-key': ${JSON.stringify(`exact-restore-key-${key}`)} });
      if (response.status !== 200 || response.json.version.revision !== 2 || response.json.currentRevision !== 2) throw new Error('Restore replay failed: ' + JSON.stringify(response));
    `))
    assert.equal(replay.artifactHistory[0][1].length, 3, 'restart replay does not append another body version')
    assert.equal(replay.artifactHistoryRestoreReceipts.length, 1)
    assert.equal(hasCorePersistedShape(replay), true)

    const malformed = structuredClone(replay)
    malformed.artifactHistory[0][1].at(-1).body.blocks[0].p = 'tampered retained history'
    assert.equal(hasCorePersistedShape(malformed), false, 'present history diverging from canonical current body refuses admission')
  })
}

test('portable admission rejects orphan, wrong-kind, and foreign-owner retained history before save', () => {
  const file = join(ROOT, 'portable-admission-history')
  const setup = stateOf(boot(file, 'json', `
    const owner = 'tenant-portable-history';
    const id = artifactCreationId(owner, 'portable-admission-history');
    const created = store.createArtifact({ name: 'portable-history.md', kind: 'doc', body: 'Before.' }, owner, id);
    if (!created || created === 'invalid') throw new Error('Artifact fixture creation failed');
    store.updateArtifactBlock(id, 0, 'After.', 0);
    await call('POST', '/artifacts/' + id + '/history/0/restore', { expectedRevision: 1 }, { 'x-tenant-id': owner, 'idempotency-key': 'portable-history-restore-key' });
  `))
  const artifactId = setup.artifactHistory[0][0]
  const artifact = setup.graph.extraArtifacts.find((row: { id: string }) => row.id === artifactId)
  assert.ok(artifact)

  const seeded = structuredClone(setup)
  seeded.initialWorld = 'demo'
  seeded.graph.extraArtifacts = seeded.graph.extraArtifacts.filter((row: { id: string }) => row.id !== artifactId)
  seeded.artifactBodies = seeded.artifactBodies.map(([id, body]: [string, unknown]) => [id === artifactId ? 'a1' : id, body])
  seeded.artifactHistory = seeded.artifactHistory.map(([id, versions]: [string, unknown]) => [id === artifactId ? 'a1' : id, versions])
  seeded.artifactHistoryRestoreReceipts = []
  assert.doesNotThrow(() => restoreBackendState({
    name: 'seeded-history-admission',
    load: () => seeded,
    save: () => {},
    close: () => {},
  }, seeded), 'legacy demo seed identity remains canonical when history is portable')

  const malformedCases = [
    ['orphan', (candidate: any) => { candidate.graph.extraArtifacts = candidate.graph.extraArtifacts.filter((row: { id: string }) => row.id !== artifactId) }],
    ['mismatched kind', (candidate: any) => { candidate.graph.extraArtifacts.find((row: { id: string }) => row.id === artifactId).kind = 'slide' }],
    ['mismatched owner', (candidate: any) => {
      const [key, receipt] = candidate.artifactHistoryRestoreReceipts[0]
      receipt.tenantId = 'tenant-foreign'
      candidate.artifactHistoryRestoreReceipts[0][0] = JSON.stringify([receipt.tenantId, receipt.userId, receipt.keyHash])
    }],
  ] as const
  for (const [label, corrupt] of malformedCases) {
    const malformed = structuredClone(setup)
    corrupt(malformed)
    assert.equal(hasCorePersistedShape(malformed), true, `${label} is a graph-level admission invariant, not a slice-shape parse error`)
    let saves = 0
    assert.throws(() => restoreBackendState({
      name: 'portable-admission-spy',
      load: () => setup,
      save: () => { saves += 1 },
      close: () => {},
    }, malformed), /invalid|incompatible|owner/i, `${label} must fail before replacing saved data`)
    assert.equal(saves, 0, `${label} validation precedes backend mutation`)
  }
})
