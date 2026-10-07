/** Artifact body history and exact restore receipts survive real backend restart. */
import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { hasCorePersistedShape } from './format.ts'
import { readPortableSnapshot, restoreBackendState, writePortableSnapshot } from './portable.ts'

const ROOT = mkdtempSync(join(tmpdir(), `agent-commons-artifact-history-${process.pid}-`))
const storeModule = new URL('../store/index.ts', import.meta.url).href
const persistenceModule = new URL('./persist.ts', import.meta.url).href
const persistenceIndexModule = new URL('./index.ts', import.meta.url).href
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

function restorePortable(file: string, backend: 'json' | 'sqlite', portable: string) {
  const script = `
    const { selectBackend } = await import(${JSON.stringify(persistenceIndexModule)});
    const { restoreBackendSnapshot } = await import(${JSON.stringify(new URL('./portable.ts', import.meta.url).href)});
    const backend = selectBackend(${JSON.stringify(backend)});
    const restored = restoreBackendSnapshot(backend, ${JSON.stringify(portable)});
    backend.close();
    console.log(JSON.stringify({ version: restored.version }));
  `
  return spawnSync(process.execPath, ['--input-type=module', '--eval', script], {
    encoding: 'utf8', timeout: 20_000,
    env: { ...process.env, INITIAL_WORLD: 'clean', BACKEND: 'mock', PERSIST_BACKEND: backend, DATA_FILE: file, DATABASE_PATH: file },
  })
}

function identifiedFixture(state: any, artifactId: string, suffix: string) {
  const identified = structuredClone(state)
  const currentEntry = identified.artifactBodies.find(([id]: [string]) => id === artifactId)
  const historyEntry = identified.artifactHistory.find(([id]: [string]) => id === artifactId)
  assert.ok(currentEntry, 'test-created Artifact has an exact current body row')
  assert.ok(historyEntry, 'test-created Artifact has retained history')
  const identifyBlocks = (body: any) => {
    assert.equal(body.type, 'doc')
    body.blocks = body.blocks.map((block: any, index: number) => ({ ...block, id: `test-${suffix}-block-${index}` }))
  }
  identifyBlocks(currentEntry[1])
  for (const version of historyEntry[1]) identifyBlocks(version.body)
  return identified
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

    const legacyIdentityHistory = structuredClone(replay)
    const current = legacyIdentityHistory.artifactBodies.find(([id]: [string]) => id === artifactId)?.[1]
    const history = legacyIdentityHistory.artifactHistory.find(([id]: [string]) => id === artifactId)?.[1]
    assert.ok(current?.type === 'doc' && history?.length)
    for (const block of current.blocks) delete block.id
    for (const version of history) {
      if (version.body.type === 'doc') {
        for (const block of version.body.blocks) delete block.id
      }
    }
    assert.equal(hasCorePersistedShape(legacyIdentityHistory), false,
      'v6 cannot admit ID-less retained Document history when current reads would mint IDs only for current')
    let saves = 0
    assert.throws(() => restoreBackendState({
      name: `${backend}-unidentified-history-spy`,
      load: () => replay,
      save: () => { saves += 1 },
      close: () => {},
    }, legacyIdentityHistory), /invalid|incompatible/i)
    assert.equal(saves, 0, 'portable admission refuses mismatched identity state before backend save')
  })

  test(`${backend}: reviewed Document block IDs survive portable restore, patch, history restore, and two restarts`, () => {
    const file = join(ROOT, `identified-history-${backend}`)
    const portable = join(ROOT, `identified-history-${backend}.portable.json`)
    const owner = `tenant-identified-history-${backend}`
    const key = `identified-history-${backend}`
    const initial = stateOf(boot(file, backend, `
      const owner = ${JSON.stringify(owner)};
      const id = artifactCreationId(owner, ${JSON.stringify(key)});
      const created = store.createArtifact({ name: 'identified-history.md', kind: 'doc', body: 'Original first paragraph.\\n\\nOriginal second paragraph.' }, owner, id);
      if (!created || created === 'invalid') throw new Error('Artifact fixture creation failed');
      store.updateArtifactBlock(id, 0, 'Edited first paragraph.', 0);
      const restored = await call('POST', '/artifacts/' + id + '/history/0/restore', { expectedRevision: 1 }, { 'x-tenant-id': owner, 'idempotency-key': 'initial-restore-' + id });
      if (restored.status !== 200) throw new Error('Initial history restore failed: ' + JSON.stringify(restored));
    `))
    const artifact = initial.graph.extraArtifacts.find((row: { name: string }) => row.name === 'identified-history.md')
    assert.ok(artifact, `${backend}: process one created the known test Artifact`)
    const artifactId = artifact.id
    const expectedIds = ['test-known-provenance-block-0', 'test-known-provenance-block-1']
    const identified = identifiedFixture(initial, artifactId, 'known-provenance')
    const identifiedCurrent = identified.artifactBodies.find(([id]: [string]) => id === artifactId)?.[1]
    const identifiedHistory = identified.artifactHistory.find(([id]: [string]) => id === artifactId)?.[1]
    assert.deepEqual(identifiedCurrent.blocks.map((block: { id?: string }) => block.id), expectedIds)
    assert.ok(identifiedHistory.every((version: any) =>
      version.body.blocks.map((block: { id?: string }) => block.id).join(',') === expectedIds.join(',')),
    'fixture assigns IDs consistently only because this test knows the exact creation→single-block patch→restore provenance')
    assert.equal(hasCorePersistedShape(identified), true)

    writePortableSnapshot(portable, identified)
    const portableCopy = readPortableSnapshot(portable)
    assert.deepEqual(portableCopy.artifactBodies?.find(([id]) => id === artifactId)?.[1], identifiedCurrent,
      'portable serialization preserves the exact current ID-bearing body')
    assert.deepEqual(portableCopy.artifactHistory?.find(([id]) => id === artifactId)?.[1], identifiedHistory,
      'portable serialization preserves every explicitly reviewed history identity')
    const imported = restorePortable(file, backend, portable)
    assert.equal(imported.status, 0, imported.stderr || imported.stdout)

    const afterFirstRestart = stateOf(boot(file, backend, `
      const owner = ${JSON.stringify(owner)};
      const id = ${JSON.stringify(artifactId)};
      const current = store.artifactContent(owner)[id];
      if (current?.revision !== 2) throw new Error('Portable body did not rehydrate at the expected revision');
      const patched = store.updateArtifactBlock(id, 0, 'Second edit after restart.', 2);
      if (!patched || patched.revision !== 3) throw new Error('Post-restart ID-bearing block patch failed');
      const restored = await call('POST', '/artifacts/' + id + '/history/2/restore', { expectedRevision: 3 }, { 'x-tenant-id': owner, 'idempotency-key': 'second-restore-' + id });
      if (restored.status !== 200 || restored.json.version.revision !== 4) throw new Error('Post-restart history restore failed: ' + JSON.stringify(restored));
    `))
    const bodyAfterMutation = afterFirstRestart.artifactBodies.find(([id]: [string]) => id === artifactId)?.[1]
    assert.deepEqual(bodyAfterMutation.blocks.map((block: { id?: string }) => block.id), expectedIds,
      'the real post-restart text patch and history restore retain both IDs')
    assert.deepEqual(afterFirstRestart.artifactHistory.find(([id]: [string]) => id === artifactId)?.[1].at(-1).body.blocks.map((block: { id?: string }) => block.id), expectedIds,
      'the appended restore version copies exact source identities')

    const afterSecondRestart = stateOf(boot(file, backend, ''))
    const finalCurrent = afterSecondRestart.artifactBodies.find(([id]: [string]) => id === artifactId)?.[1]
    const finalHistory = afterSecondRestart.artifactHistory.find(([id]: [string]) => id === artifactId)?.[1]
    assert.deepEqual(finalCurrent.blocks.map((block: { id?: string }) => block.id), expectedIds)
    assert.ok(finalHistory.every((version: any) =>
      version.body.blocks.map((block: { id?: string }) => block.id).join(',') === expectedIds.join(',')),
    'a second process restart preserves the current body and all history identities exactly')

    const malformedCases = [
      ['malformed current ID', (candidate: any) => { candidate.artifactBodies.find(([id]: [string]) => id === artifactId)[1].blocks[0].id = 'bad-id!' }],
      ['malformed latest-history ID', (candidate: any) => { candidate.artifactHistory.find(([id]: [string]) => id === artifactId)[1].at(-1).body.blocks[0].id = 'bad-id!' }],
      ['duplicate current/latest IDs', (candidate: any) => {
        candidate.artifactBodies.find(([id]: [string]) => id === artifactId)[1].blocks[1].id = expectedIds[0];
        candidate.artifactHistory.find(([id]: [string]) => id === artifactId)[1].at(-1).body.blocks[1].id = expectedIds[0];
      }],
      ['mixed current/latest IDs', (candidate: any) => {
        delete candidate.artifactBodies.find(([id]: [string]) => id === artifactId)[1].blocks[1].id;
        delete candidate.artifactHistory.find(([id]: [string]) => id === artifactId)[1].at(-1).body.blocks[1].id;
      }],
    ] as const
    for (const [label, corrupt] of malformedCases) {
      const malformed = structuredClone(afterSecondRestart)
      corrupt(malformed)
      let saves = 0
      assert.throws(() => restoreBackendState({
        name: `${backend}-identified-history-spy`,
        load: () => afterSecondRestart,
        save: () => { saves += 1 },
        close: () => {},
      }, malformed), /invalid|incompatible/i, `${backend}: ${label} is refused at portable admission`)
      assert.equal(saves, 0, `${backend}: ${label} does not reach backend save`)
    }
  })

  test(`${backend}: no-history current Document admission validates present stable IDs without changing legacy acceptance`, () => {
    const file = join(ROOT, `identified-current-no-history-${backend}`)
    const owner = `tenant-identified-current-${backend}`
    const key = `identified-current-${backend}`
    const source = stateOf(boot(file, backend, `
      const owner = ${JSON.stringify(owner)};
      const id = artifactCreationId(owner, ${JSON.stringify(key)});
      const created = store.createArtifact({ name: 'no-history.md', kind: 'doc', body: 'First paragraph.\\n\\nSecond paragraph.' }, owner, id);
      if (!created || created === 'invalid') throw new Error('Artifact fixture creation failed');
    `))
    const row = source.graph.extraArtifacts.find((artifact: { name: string }) => artifact.name === 'no-history.md')
    assert.ok(row)
    const artifactId = row.id
    const bodyEntry = source.artifactBodies.find(([id]: [string]) => id === artifactId)
    assert.ok(bodyEntry)
    assert.equal(bodyEntry[1].type, 'doc')
    assert.equal(bodyEntry[1].blocks.length, 2)
    assert.equal(source.artifactHistory?.some(([id]: [string]) => id === artifactId), false,
      'the generated two-block Document has no prior body edit/history')

    const identified = (suffix: string) => {
      const candidate = structuredClone(source)
      const body = candidate.artifactBodies.find(([id]: [string]) => id === artifactId)[1]
      body.blocks = body.blocks.map((block: any, index: number) => ({ ...block, id: `current-${suffix}-${index}` }))
      return candidate
    }
    const importThroughPortableSeam = (candidate: any) => {
      let saves = 0
      let stored: any
      const backendPort = {
        name: `${backend}-no-history-doc-admission-spy`,
        load: () => stored ?? source,
        save: (state: any) => { saves += 1; stored = state },
        close: () => {},
      }
      const restored = restoreBackendState(backendPort, candidate)
      return { restored, saves }
    }

    const validIdentified = identified('valid')
    assert.equal(hasCorePersistedShape(validIdentified), true, 'a wholly identified no-history body is admitted')
    assert.equal(importThroughPortableSeam(validIdentified).saves, 1)
    assert.equal(hasCorePersistedShape(source), true, 'a wholly legacy no-history body remains admitted')
    assert.equal(importThroughPortableSeam(source).saves, 1)

    const malformedCases = [
      ['duplicate IDs', (candidate: any) => {
        const body = candidate.artifactBodies.find(([id]: [string]) => id === artifactId)[1]
        body.blocks[1].id = body.blocks[0].id
      }],
      ['mixed identified and legacy blocks', (candidate: any) => {
        delete candidate.artifactBodies.find(([id]: [string]) => id === artifactId)[1].blocks[1].id
      }],
      ['malformed ID', (candidate: any) => {
        candidate.artifactBodies.find(([id]: [string]) => id === artifactId)[1].blocks[0].id = 'not-valid!'
      }],
      ['present undefined ID', (candidate: any) => {
        candidate.artifactBodies.find(([id]: [string]) => id === artifactId)[1].blocks[0].id = undefined
      }],
      ['invalid revision on an ID-bearing body', (candidate: any) => {
        candidate.artifactBodies.find(([id]: [string]) => id === artifactId)[1].revision = -1
      }],
    ] as const
    for (const [label, corrupt] of malformedCases) {
      const candidate = identified(label.replaceAll(' ', '-'))
      corrupt(candidate)
      assert.equal(hasCorePersistedShape(candidate), false, `${backend}: ${label} fails in-memory admission`)
      let saves = 0
      assert.throws(() => restoreBackendState({
        name: `${backend}-${label}-spy`,
        load: () => source,
        save: () => { saves += 1 },
        close: () => {},
      }, candidate), /invalid|incompatible/i, `${backend}: ${label} is refused by portable restore`)
      assert.equal(saves, 0, `${backend}: ${label} fails before backend save`)
    }
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
