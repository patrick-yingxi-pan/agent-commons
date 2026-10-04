/** Artifact Trash preserves the exact saved row and body across real JSON and
 * SQLite restarts while closing ordinary reads until an owner restores it. */
import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { hasCorePersistedShape } from './format.ts'

const ROOT = mkdtempSync(join(tmpdir(), `agent-commons-artifact-trash-${process.pid}-`))
const storeModule = new URL('../store/index.ts', import.meta.url).href
const persistenceModule = new URL('./persist.ts', import.meta.url).href
const identityModule = new URL('../artifactCreationIdentity.ts', import.meta.url).href

after(() => rmSync(ROOT, { recursive: true, force: true }))

function boot(file: string, backend: 'json' | 'sqlite', work = '') {
  const script = `
    const { store } = await import(${JSON.stringify(storeModule)});
    const { loadState, closePersistence } = await import(${JSON.stringify(persistenceModule)});
    const { artifactCreationId } = await import(${JSON.stringify(identityModule)});
    store.initPersistence();
    ${work}
    closePersistence();
  `
  return spawnSync(process.execPath, ['--input-type=module', '--eval', script], {
    encoding: 'utf8', timeout: 20_000,
    env: { ...process.env, INITIAL_WORLD: 'clean', BACKEND: 'mock', PERSIST_BACKEND: backend, DATA_FILE: file, DATABASE_PATH: file },
  })
}

function ok(result: ReturnType<typeof boot>): Record<string, any> {
  assert.equal(result.status, 0, result.stderr || result.stdout)
  return result.stdout.trim() ? JSON.parse(result.stdout) : {}
}

function rewriteSlice(file: string, backend: 'json' | 'sqlite', mutation: string) {
  const script = `
    const { JsonFileBackend } = await import(${JSON.stringify(new URL('./json.ts', import.meta.url).href)});
    const { SqliteBackend } = await import(${JSON.stringify(new URL('./sqlite.ts', import.meta.url).href)});
    const storage = ${JSON.stringify(backend)} === 'json' ? new JsonFileBackend() : new SqliteBackend(${JSON.stringify(file)});
    const state = storage.load();
    ${mutation}
    storage.save(state);
    storage.close();
  `
  return spawnSync(process.execPath, ['--input-type=module', '--eval', script], {
    encoding: 'utf8', timeout: 20_000,
    env: { ...process.env, PERSIST_BACKEND: backend, DATA_FILE: file, DATABASE_PATH: file },
  })
}

for (const backend of ['json', 'sqlite'] as const) {
  test(`${backend}: Trash, exact retry, restore, grants, body, metadata, and replay survive restart`, () => {
    const file = join(ROOT, `round-trip-${backend}`)
    const owner = 'tenant-acme'
    const audience = `tenant-trash-reader-${backend}`
    const originalName = `trash-original-${backend}.md`
    const displayName = `trash-renamed-${backend}.md`
    const saveOp = {
      kind: 'save-artifact',
      artifact: { name: originalName, kind: 'doc', meta: 'Document', body: 'Original saved body.\n\nSecond saved paragraph.' },
      sessionTitle: `Trash source ${backend}`,
      projectId: undefined,
    }
    const saved = ok(boot(file, backend, `
      const owner = ${JSON.stringify(owner)};
      const audience = ${JSON.stringify(audience)};
      const saveOp = ${JSON.stringify(saveOp)};
      const project = store.createProject({ name: 'Trash filing ${backend}' }, owner).project;
      saveOp.projectId = project.id;
      store.applyRelationOp(saveOp, owner);
      const artifact = store.listArtifacts(owner).find(row => row.saveOrigin?.name === ${JSON.stringify(originalName)});
      if (!artifact) throw new Error('saved artifact fixture was not created');
      const renamed = store.renameArtifact(artifact.id, ${JSON.stringify(displayName)}, artifact.metadataRevision ?? 0, owner);
      const body = store.updateArtifactBlock(artifact.id, 0, 'Edited durable body.', 0);
      store.applyRelationOp({ kind: 'refile-artifact', artifactId: artifact.id, artifactName: renamed.name, projectId: project.id, projectName: project.name }, owner);
      const grant = store.createGrant({ subject: { kind: 'artifact', id: artifact.id }, audience: { kind: 'link' }, tier: 'view' }, owner);
      if (!grant || typeof grant !== 'object' || grant.audience.kind !== 'link') throw new Error('link grant setup failed: ' + String(grant));
      if (!store.redeemGrant(grant.audience.token, audience)) throw new Error('link redemption setup failed');
      const directId = artifactCreationId(owner, 'direct-trash-replay');
      const direct = store.createArtifact({ name: 'direct-trash.md', kind: 'doc', body: 'Direct durable body.' }, owner, directId);
      if (!direct || direct === 'invalid') throw new Error('direct creation setup failed');
      const savedTrash = store.setArtifactLifecycle(artifact.id, 'trashed', 0, owner);
      const directTrash = store.setArtifactLifecycle(directId, 'trashed', 0, owner);
      console.log(JSON.stringify({
        id: artifact.id, directId, projectId: project.id, grantId: grant.id, source: renamed.source,
        saveOrigin: renamed.saveOrigin, renamed, body,
        savedTrash, directTrash, state: loadState(),
      }));
    `))

    assert.ok(saved.id)
    assert.ok(saved.directId)
    assert.ok(saved.grantId)
    assert.equal(saved.renamed.name, displayName)
    assert.equal(saved.renamed.metadataRevision, 1)
    assert.equal(saved.body.revision, 1)
    assert.equal(saved.body.blocks[0].p, 'Edited durable body.')
    assert.equal(saved.saveOrigin.name, originalName)
    assert.equal(saved.source, `Trash source ${backend}`)
    assert.equal(saved.savedTrash.lifecycle.state, 'trashed')
    assert.equal(saved.savedTrash.lifecycle.revision, 1)
    assert.equal(saved.directTrash.lifecycle.revision, 1)
    assert.ok(saved.state.artifactLifecycle.some(([id, lifecycle]: [string, any]) => id === saved.id && lifecycle.state === 'trashed'))
    assert.ok(saved.state.grants.some((grant: any) => grant.id === saved.grantId))
    assert.equal(hasCorePersistedShape(saved.state), true)

    const retryAndRestore = ok(boot(file, backend, `
      const owner = ${JSON.stringify(owner)};
      const audience = ${JSON.stringify(audience)};
      const id = ${JSON.stringify(saved.id)};
      const directId = ${JSON.stringify(saved.directId)};
      const saveOp = { ...${JSON.stringify(saveOp)}, projectId: ${JSON.stringify(saved.projectId)} };
      const events = [];
      const off = store.subscribe(event => { if (event.type === 'artifact.changed') events.push(event); });
      const retry = store.setArtifactLifecycle(id, 'trashed', 0, owner);
      const beforeReplayCount = store.relationGraph().extraArtifacts.filter(row => row.saveOrigin?.name === ${JSON.stringify(originalName)}).length;
      let savedReplayRefused = false;
      try { store.applyRelationOp(saveOp, owner); } catch { savedReplayRefused = true; }
      const afterSaveReplayCount = store.relationGraph().extraArtifacts.filter(row => row.saveOrigin?.name === ${JSON.stringify(originalName)}).length;
      const directReplay = store.createArtifact({ name: 'changed retry', kind: 'doc', body: 'Changed.' }, owner, directId);
      const trashedReads = {
        ownerRows: store.listArtifacts(owner).filter(row => row.id === id || row.id === directId),
        readerRows: store.listArtifacts(audience).filter(row => row.id === id),
        ownerBody: store.artifactContent(owner)[id], readerBody: store.artifactContent(audience)[id],
        ownerExport: store.exportArtifactDocument(id, owner), readerExport: store.exportArtifactDocument(id, audience),
        ownerDocx: await store.exportArtifactWord(id, owner), ownerXlsx: await store.exportArtifactSpreadsheet(id, owner),
        ownerPptx: await store.exportArtifactPresentation(id, owner),
        ownerById: store.artifactById(id), readerGraph: store.relationGraph(audience).extraArtifacts.some(row => row.id === id),
        ownerGraph: store.relationGraph(owner).extraArtifacts.some(row => row.id === id),
        ownerTrash: store.listTrashedArtifacts(owner), readerTrash: store.listTrashedArtifacts(audience),
      };
      const persistedBeforeRestore = loadState();
      const eventsBeforeRestore = events.slice();
      const restored = store.setArtifactLifecycle(id, 'active', 1, owner);
      off();
      console.log(JSON.stringify({ retry, directReplay, savedReplayRefused, beforeReplayCount, afterSaveReplayCount, trashedReads,
        persistedBeforeRestore, restored, eventsBeforeRestore, events }));
    `))

    assert.equal(retryAndRestore.retry.lifecycle.state, 'trashed')
    assert.equal(retryAndRestore.retry.lifecycle.revision, 1)
    assert.equal(retryAndRestore.retry.lifecycle.changedAt, saved.savedTrash.lifecycle.changedAt, `${backend}: lost-ack retry keeps the original lifecycle receipt`)
    assert.equal(retryAndRestore.directReplay, 'invalid', `${backend}: direct keyed retry cannot resurrect the trashed exact identity`)
    assert.equal(retryAndRestore.savedReplayRefused, true, `${backend}: stale save replay refuses rather than replacing the edited trashed body`)
    assert.equal(retryAndRestore.beforeReplayCount, 1)
    assert.equal(retryAndRestore.afterSaveReplayCount, 1, `${backend}: saved-operation replay cannot mint a replacement row`)
    assert.deepEqual(retryAndRestore.trashedReads.ownerRows, [])
    assert.deepEqual(retryAndRestore.trashedReads.readerRows, [])
    assert.equal(retryAndRestore.trashedReads.ownerBody, undefined)
    assert.equal(retryAndRestore.trashedReads.readerBody, undefined)
    assert.equal(retryAndRestore.trashedReads.ownerExport, undefined)
    assert.equal(retryAndRestore.trashedReads.readerExport, undefined)
    assert.equal(retryAndRestore.trashedReads.ownerDocx, undefined)
    assert.equal(retryAndRestore.trashedReads.ownerXlsx, undefined)
    assert.equal(retryAndRestore.trashedReads.ownerPptx, undefined)
    assert.equal(retryAndRestore.trashedReads.ownerById, undefined)
    assert.equal(retryAndRestore.trashedReads.ownerGraph, false)
    assert.equal(retryAndRestore.trashedReads.readerGraph, false)
    assert.deepEqual(retryAndRestore.trashedReads.readerTrash, [])
    assert.equal(retryAndRestore.trashedReads.ownerTrash.length, 2)
    assert.deepEqual(retryAndRestore.eventsBeforeRestore, [], `${backend}: exact lifecycle retry and graph-save replay publish no duplicate artifact event`)
    assert.equal(retryAndRestore.events.length, 1, `${backend}: restore publishes its one lifecycle invalidation`)
    const trashedSnapshot = retryAndRestore.persistedBeforeRestore
    assert.ok(trashedSnapshot.grants.some((grant: any) => grant.id === saved.grantId), `${backend}: grant is retained while access is suspended`)
    assert.deepEqual(trashedSnapshot.artifactBodies.find(([id]: [string]) => id === saved.id)?.[1], saved.body)
    assert.equal(trashedSnapshot.artifactMetadata.find(([id]: [string]) => id === saved.id)?.[1].name, displayName)
    assert.equal(trashedSnapshot.graph.artifactProject[saved.id], saved.projectId)

    const restoredAfterRestart = ok(boot(file, backend, `
      const owner = ${JSON.stringify(owner)};
      const audience = ${JSON.stringify(audience)};
      const id = ${JSON.stringify(saved.id)};
      const restoreRetry = store.setArtifactLifecycle(id, 'active', 1, owner);
      let oldTrashConflict = false;
      try { store.setArtifactLifecycle(id, 'trashed', 0, owner); } catch (error) { oldTrashConflict = /changed|conflict|Trash/i.test(String(error)); }
      const row = store.listArtifacts(owner).find(candidate => candidate.id === id);
      const reader = store.listArtifacts(audience).find(candidate => candidate.id === id);
      console.log(JSON.stringify({ restoreRetry, oldTrashConflict, row, reader, ownerBody: store.artifactContent(owner)[id],
        readerBody: store.artifactContent(audience)[id], ownerTrash: store.listTrashedArtifacts(owner), state: loadState() }));
    `))

    assert.equal(restoredAfterRestart.restoreRetry.lifecycle.state, 'active')
    assert.equal(restoredAfterRestart.restoreRetry.lifecycle.revision, 2)
    assert.equal(restoredAfterRestart.restoreRetry.lifecycle.changedAt, retryAndRestore.restored.lifecycle.changedAt)
    assert.equal(restoredAfterRestart.oldTrashConflict, true, `${backend}: an old trash retry cannot undo restoration`)
    assert.equal(restoredAfterRestart.row.id, saved.id)
    assert.equal(restoredAfterRestart.row.name, displayName)
    assert.equal(restoredAfterRestart.row.metadataRevision, 1)
    assert.equal(restoredAfterRestart.row.projectId, saved.projectId)
    assert.equal(restoredAfterRestart.row.source, `Trash source ${backend}`)
    assert.deepEqual(restoredAfterRestart.row.saveOrigin, saved.saveOrigin)
    assert.equal(restoredAfterRestart.reader.id, saved.id, `${backend}: current grant reads reopen after restore`)
    assert.deepEqual(restoredAfterRestart.ownerBody, saved.body)
    assert.deepEqual(restoredAfterRestart.readerBody, saved.body)
    assert.deepEqual(restoredAfterRestart.ownerTrash.map((entry: any) => entry.artifact.id), [saved.directId],
      `${backend}: the independent direct Artifact remains in Trash`)
    assert.equal(restoredAfterRestart.state.artifactLifecycle.find(([id]: [string]) => id === saved.id)?.[1].revision, 2)
  })

  test(`${backend}: absent legacy lifecycle is active; malformed present lifecycle refuses restart`, () => {
    const file = join(ROOT, `legacy-and-malformed-${backend}`)
    const owner = `tenant-trash-legacy-${backend}`
    const seeded = ok(boot(file, backend, `
      const owner = ${JSON.stringify(owner)};
      store.applyRelationOp({ kind: 'save-artifact', artifact: { name: 'legacy-trash-row.md', kind: 'doc', meta: 'Document', body: 'Still active.' } }, owner);
      console.log(JSON.stringify(loadState()));
    `))
    const absent = { ...seeded }
    delete absent.artifactLifecycle
    assert.equal(hasCorePersistedShape(absent), true, `${backend}: pre-lifecycle snapshots remain admissible`)
    const absentWrite = rewriteSlice(file, backend, 'delete state.artifactLifecycle;')
    assert.equal(absentWrite.status, 0, absentWrite.stderr || absentWrite.stdout)
    const legacyRestart = ok(boot(file, backend, `
      const owner = ${JSON.stringify(owner)};
      console.log(JSON.stringify({ rows: store.listArtifacts(owner), trashed: store.listTrashedArtifacts(owner), state: loadState() }));
    `))
    assert.ok(legacyRestart.rows.some((row: any) => row.name === 'legacy-trash-row.md'))
    assert.deepEqual(legacyRestart.trashed, [])
    assert.equal(legacyRestart.state.artifactLifecycle, undefined)

    const malformedWrite = rewriteSlice(file, backend, `
      state.artifactLifecycle = [
        ['bad-state', { state: 'trashed', revision: 2, changedAt: 1 }],
      ];
    `)
    assert.equal(malformedWrite.status, 0, malformedWrite.stderr || malformedWrite.stdout)
    const refused = boot(file, backend)
    assert.notEqual(refused.status, 0)
    assert.match(refused.stderr, /unreadable or incompatible|invalid|required core slices/i)
  })
}

test('a failed JSON Trash commit publishes no event and preserves the prior durable snapshot', () => {
  const file = join(ROOT, 'failed-commit.json')
  const blocked = join(ROOT, 'prior-durable-trash-state')
  const owner = 'tenant-trash-failure-owner'
  const created = ok(boot(file, 'json', `
    const owner = ${JSON.stringify(owner)};
    store.applyRelationOp({ kind: 'save-artifact', artifact: { name: 'failure-trash.md', kind: 'doc', meta: 'Document', body: 'Keep prior state.' } }, owner);
    const artifact = store.listArtifacts(owner).find(row => row.name === 'failure-trash.md');
    console.log(JSON.stringify({ id: artifact.id, before: loadState() }));
  `))
  const failed = boot(file, 'json', `
    const { renameSync, mkdirSync } = await import('node:fs');
    const owner = ${JSON.stringify(owner)};
    const id = ${JSON.stringify(created.id)};
    const events = [];
    const off = store.subscribe(event => { if (event.type === 'artifact.changed' && event.artifactId === id) events.push(event); });
    renameSync(process.env.DATA_FILE, ${JSON.stringify(blocked)});
    mkdirSync(process.env.DATA_FILE);
    let rejected = false;
    try { store.setArtifactLifecycle(id, 'trashed', 0, owner); } catch { rejected = true; }
    off();
    console.log(JSON.stringify({ rejected, events, healthy: store.persistenceHealthy(), trashed: store.listTrashedArtifacts(owner) }));
  `)
  assert.equal(failed.status, 0, failed.stderr || failed.stdout)
  const report = JSON.parse(failed.stdout)
  assert.equal(report.rejected, true)
  assert.deepEqual(report.events, [])
  assert.equal(report.healthy, false)
  const durable = JSON.parse(readFileSync(blocked, 'utf8'))
  assert.deepEqual(durable.artifactLifecycle, created.before.artifactLifecycle)
  assert.ok(durable.graph.extraArtifacts.some((row: any) => row.id === created.id))
  assert.deepEqual(durable.artifactBodies, created.before.artifactBodies)
})
