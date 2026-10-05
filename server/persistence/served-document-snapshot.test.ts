/** Renderer-extracted served-document snapshots survive JSON/SQLite restart. */
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'

const directory = mkdtempSync(join(tmpdir(), `agent-commons-served-document-${process.pid}-`))
const storeModule = new URL('../store/index.ts', import.meta.url).href
const persistenceModule = new URL('./persist.ts', import.meta.url).href
const testkitModule = new URL('../testkit/http.ts', import.meta.url).href
const REQUEST_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const tenant = 'served-document-snapshot-persist-owner'
const headers = { 'x-tenant-id': tenant }
const savedDocument = {
  version: 2,
  snapshotId: REQUEST_ID,
  capturedAt: '2026-10-04T12:00:00.000Z',
  sourceId: 'cloud',
  path: 'brief.pdf',
  text: 'renderer extracted text',
  documentImport: { format: 'pdf', status: 'ready', pages: 2, textPages: 2 },
}

after(() => rmSync(directory, { recursive: true, force: true }))

function boot(file: string, cloudRoot: string, backend: 'json' | 'sqlite', mode: 'create' | 'replay' | 'corrupt' | 'invalid-load') {
  const work = mode === 'create' ? `
    const { call } = await import(${JSON.stringify(testkitModule)});
    const session = store.createSession('served document snapshot persistence', ${JSON.stringify(tenant)});
    const attachment = { id: 'cloud::brief.pdf', label: 'brief.pdf', kind: 'file', source: { id: 'cloud', kind: 'cloud', label: 'Cloud storage' }, previewText: 'temporary preview' };
    const attached = await call('PATCH', '/sessions/' + session.id + '/context-state', {
      operations: [], workspace: { workspaces: [], repos: [], connectors: [], attachments: [attachment] }
    }, ${JSON.stringify(headers)});
    if (attached.status !== 200) throw new Error('attachment failed: ' + JSON.stringify(attached));
    let reads = 0;
    store.fsSnapshot = () => { reads += 1; throw new Error('document Refresh must not reread source content'); };
    const request = { expectedSnapshotId: null, requestId: ${JSON.stringify(REQUEST_ID)}, snapshot: ${JSON.stringify(savedDocument)} };
    const refreshed = await call('POST', '/sessions/' + session.id + '/attachments/cloud%3A%3Abrief.pdf/refresh', request, ${JSON.stringify(headers)});
    if (refreshed.status !== 200) throw new Error('document save failed: ' + JSON.stringify(refreshed));
    const saved = loadState().workspaces.find(([id]) => id === session.id)?.[1];
    console.log(JSON.stringify({ sessionId: session.id, refreshed, saved, reads }));
  ` : mode === 'replay' ? `
    const sessionId = process.env.SERVED_DOCUMENT_SESSION_ID;
    store.fsSnapshot = () => { throw new Error('source content must stay unread during exact replay'); };
    const { call } = await import(${JSON.stringify(testkitModule)});
    const request = { expectedSnapshotId: null, requestId: ${JSON.stringify(REQUEST_ID)}, snapshot: ${JSON.stringify(savedDocument)} };
    const response = await call('POST', '/sessions/' + sessionId + '/attachments/cloud%3A%3Abrief.pdf/refresh', request, ${JSON.stringify(headers)});
    const changed = await call('POST', '/sessions/' + sessionId + '/attachments/cloud%3A%3Abrief.pdf/refresh', {
      ...request, snapshot: { ...request.snapshot, text: 'changed retry bytes' }
    }, ${JSON.stringify(headers)});
    console.log(JSON.stringify({ response, changed, saved: loadState().workspaces.find(([id]) => id === sessionId)?.[1] }));
  ` : mode === 'corrupt' ? `
    const sessionId = process.env.SERVED_DOCUMENT_SESSION_ID;
    const state = loadState();
    const attachment = state?.workspaces?.find(([id]) => id === sessionId)?.[1]?.attachments?.[0];
    if (!attachment?.textSnapshot) throw new Error('saved document snapshot missing before corruption');
    attachment.textSnapshot.documentImport.status = 'invalid';
    saveState(state);
    console.log('corrupted');
  ` : `
    throw new Error('INVALID_LOAD_SHOULD_NOT_REACH_TEST_BODY');
  `
  const script = `
    const { store } = await import(${JSON.stringify(storeModule)});
    const { loadState, saveState, closePersistence } = await import(${JSON.stringify(persistenceModule)});
    store.initPersistence();
    ${work}
    closePersistence();
  `
  return (sessionId?: string) => spawnSync(process.execPath, ['--input-type=module', '--eval', script], {
    encoding: 'utf8', timeout: 20_000,
    env: {
      ...process.env,
      INITIAL_WORLD: 'clean', BACKEND: 'mock', PERSIST_BACKEND: backend,
      DATA_FILE: file, DATABASE_PATH: file, CONTEXT_CLOUD_ROOT: cloudRoot,
      SERVED_DOCUMENT_SESSION_ID: sessionId ?? '',
    },
  })
}

for (const backend of ['json', 'sqlite'] as const) {
  test(`${backend}: saved document text and exact Refresh replay survive restart without source reads`, () => {
    const fixture = join(directory, backend)
    const cloudRoot = join(fixture, 'cloud')
    mkdirSync(cloudRoot, { recursive: true })
    const file = join(fixture, `store-${backend}`)

    const create = boot(file, cloudRoot, backend, 'create')()
    assert.equal(create.status, 0, create.stderr)
    const created = JSON.parse(create.stdout.trim())
    const sessionId = created.sessionId as string
    assert.equal(created.reads, 0)
    assert.deepEqual(created.refreshed.json.workspace.attachments[0].textSnapshot, savedDocument)
    assert.deepEqual(created.saved.attachments[0].textSnapshot, savedDocument)
    assert.equal(JSON.stringify(created.saved).includes('rawBytes'), false)
    assert.equal(JSON.stringify(created.saved).includes('bytes'), false)

    rmSync(cloudRoot, { recursive: true, force: true })
    const replay = boot(file, cloudRoot, backend, 'replay')(sessionId)
    assert.equal(replay.status, 0, replay.stderr)
    const recovered = JSON.parse(replay.stdout.trim())
    assert.equal(recovered.response.status, 200)
    assert.equal(recovered.changed.status, 409, 'a used key cannot be replayed with different extracted text')
    assert.deepEqual(recovered.response.json.workspace, created.refreshed.json.workspace)
    assert.deepEqual(recovered.saved, created.saved)

    const corrupt = boot(file, cloudRoot, backend, 'corrupt')(sessionId)
    assert.equal(corrupt.status, 0, corrupt.stderr)
    const invalidLoad = boot(file, cloudRoot, backend, 'invalid-load')(sessionId)
    assert.notEqual(invalidLoad.status, 0, 'malformed persisted document projection refuses process admission')
    assert.match(invalidLoad.stderr, /could not be loaded|missing required core slices/i)
  })
}
