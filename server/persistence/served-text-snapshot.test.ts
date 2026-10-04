/** Served attachment refresh is durable input state. Fresh processes prove
 * both backend round-trips and exact-request replay without source I/O. */
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'

const directory = mkdtempSync(join(tmpdir(), `agent-commons-served-snapshot-${process.pid}-`))
const storeModule = new URL('../store/index.ts', import.meta.url).href
const persistenceModule = new URL('./persist.ts', import.meta.url).href
const testkitModule = new URL('../testkit/http.ts', import.meta.url).href
const FIRST_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const REQUEST_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'

after(() => rmSync(directory, { recursive: true, force: true }))

function boot(file: string, backend: 'json' | 'sqlite', source: 'create' | 'replay') {
  const work = source === 'create' ? `
    const owner = 'served-snapshot-persist-owner';
    const headers = { 'x-tenant-id': owner };
    store.fsSnapshot = (_source, path, snapshotId) => ({
      version: 1, snapshotId: snapshotId || ${JSON.stringify(FIRST_ID)},
      capturedAt: '2026-10-04T12:00:00.000Z', sourceId: 'cloud', path, text: snapshotId ? 'refreshed durable copy' : 'initial durable copy'
    });
    const { call } = await import(${JSON.stringify(testkitModule)});
    const session = store.createSession('served snapshot persistence', owner);
    const intake = await call('GET', '/fs/snapshot?source=cloud&path=notes.md', undefined, headers);
    if (intake.status !== 200) throw new Error('snapshot intake failed: ' + JSON.stringify(intake));
    const workspace = { workspaces: [], repos: [], connectors: [], attachments: [{
      id: 'cloud::notes.md', label: 'notes.md', kind: 'file', source: { id: 'cloud', kind: 'cloud', label: 'Cloud storage' }, textSnapshot: intake.json
    }] };
    const attached = await call('PATCH', '/sessions/' + session.id + '/context-state', { operations: [], workspace }, headers);
    if (attached.status !== 200) throw new Error('attachment failed: ' + JSON.stringify(attached));
    const refreshed = await call('POST', '/sessions/' + session.id + '/attachments/cloud%3A%3Anotes.md/refresh', {
      expectedSnapshotId: ${JSON.stringify(FIRST_ID)}, requestId: ${JSON.stringify(REQUEST_ID)}
    }, headers);
    if (refreshed.status !== 200) throw new Error('refresh failed: ' + JSON.stringify(refreshed));
    console.log(JSON.stringify({ sessionId: session.id, refreshed, saved: loadState().workspaces.find(([id]) => id === session.id)?.[1] }));
  ` : `
    const sessionId = process.env.SERVED_SNAPSHOT_SESSION_ID;
    if (!sessionId) throw new Error('missing persisted Session identity');
    let reads = 0;
    store.fsSnapshot = () => { reads += 1; throw new Error('source read after restart'); };
    const { call } = await import(${JSON.stringify(testkitModule)});
    const headers = { 'x-tenant-id': 'served-snapshot-persist-owner' };
    const opened = await call('GET', '/sessions/' + sessionId, undefined, headers);
    if (opened.status !== 200 || opened.json.workspace.attachments[0]?.textSnapshot?.snapshotId !== ${JSON.stringify(REQUEST_ID)}) {
      throw new Error('rehydrated session did not reopen with its saved attachment snapshot');
    }
    const response = await call('POST', '/sessions/' + sessionId + '/attachments/cloud%3A%3Anotes.md/refresh', {
      expectedSnapshotId: ${JSON.stringify(FIRST_ID)}, requestId: ${JSON.stringify(REQUEST_ID)}
    }, headers);
    console.log(JSON.stringify({ opened, response, reads, workspace: store.sessionWorkspace(sessionId), saved: loadState().workspaces.find(([id]) => id === sessionId)?.[1] }));
  `
  const script = `
    const { store } = await import(${JSON.stringify(storeModule)});
    const { loadState, closePersistence } = await import(${JSON.stringify(persistenceModule)});
    store.initPersistence();
    ${work}
    closePersistence();
  `
  return (sessionId?: string) => spawnSync(process.execPath, ['--input-type=module', '--eval', script], {
    encoding: 'utf8', timeout: 20_000,
    env: { ...process.env, INITIAL_WORLD: 'clean', BACKEND: 'mock', PERSIST_BACKEND: backend, DATA_FILE: file, DATABASE_PATH: file, SERVED_SNAPSHOT_SESSION_ID: sessionId ?? '' },
  })
}

for (const backend of ['json', 'sqlite'] as const) {
  test(`${backend}: refreshed served attachment and exact request replay survive a real process restart`, () => {
    const file = join(directory, `served-${backend}`)
    const create = boot(file, backend, 'create')()
    assert.equal(create.status, 0, create.stderr)
    const created = JSON.parse(create.stdout.trim())
    const sessionId = created.sessionId as string
    assert.equal(created.refreshed.json.workspace.attachments[0].textSnapshot.snapshotId, REQUEST_ID)
    assert.equal(created.refreshed.json.workspace.attachments[0].textSnapshot.text, 'refreshed durable copy')
    assert.equal(created.saved.attachments[0].textSnapshot.snapshotId, REQUEST_ID)

    const replay = boot(file, backend, 'replay')(sessionId)
    assert.equal(replay.status, 0, replay.stderr)
    const recovered = JSON.parse(replay.stdout.trim())
    assert.equal(recovered.opened.status, 200)
    assert.equal(recovered.opened.json.workspace.attachments[0].textSnapshot.snapshotId, REQUEST_ID)
    assert.equal(recovered.response.status, 200)
    assert.equal(recovered.response.json.workspace.attachments[0].textSnapshot.snapshotId, REQUEST_ID)
    assert.equal(recovered.response.json.workspace.attachments[0].textSnapshot.text, 'refreshed durable copy')
    assert.deepEqual(recovered.workspace, created.saved, 'rehydrated workspace is the exact current stored representation')
    assert.equal(recovered.reads, 0, 'replaying a durable requestId does not touch the source after restart')
  })
}
