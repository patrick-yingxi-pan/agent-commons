/** Saved served-folder snapshots survive JSON/SQLite restarts and exact replay. */
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'

const directory = mkdtempSync(join(tmpdir(), `agent-commons-served-folder-${process.pid}-`))
const storeModule = new URL('../store/index.ts', import.meta.url).href
const persistenceModule = new URL('./persist.ts', import.meta.url).href
const testkitModule = new URL('../testkit/http.ts', import.meta.url).href
const REQUEST_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const tenant = 'served-folder-snapshot-persist-owner'
const headers = { 'x-tenant-id': tenant }

after(() => rmSync(directory, { recursive: true, force: true }))

function boot(file: string, cloudRoot: string, backend: 'json' | 'sqlite', mode: 'create' | 'replay' | 'corrupt-snapshot' | 'corrupt-identity' | 'invalid-load', scope: 'flat' | 'recursive' = 'flat') {
  const work = mode === 'create' ? `
    const { call } = await import(${JSON.stringify(testkitModule)});
    const session = store.createSession('served folder snapshot persistence', ${JSON.stringify(tenant)});
    const initialSnapshot = ${scope === 'recursive' ? "await store.fsFolderSnapshot('cloud', 'research', undefined, 'recursive')" : 'undefined'};
    if (${scope === 'recursive'} && initialSnapshot?.version !== 2) throw new Error('recursive intake unavailable');
    const workspace = {
      workspaces: [{ id: 'workspace-main', label: 'Workspace', artifacts: [
        { id: 'authored-doc', name: 'authored.md', kind: 'doc', meta: 'kept' }
      ], folders: [{ id: 'cloud::research', label: 'research', ...(initialSnapshot ? { snapshot: initialSnapshot } : {}) }] }],
      repos: [], connectors: [], attachments: []
    };
    const attached = await call('PATCH', '/sessions/' + session.id + '/context-state', {
      operations: [{ action: 'attach', context: { id: 'cloud::research', type: 'folder', label: 'research', scope: 'research', source: { id: 'cloud', kind: 'cloud', label: 'Cloud storage' } } }],
      workspace
    }, ${JSON.stringify(headers)});
    if (attached.status !== 200) throw new Error('folder attach failed: ' + JSON.stringify(attached));
    const refreshed = await call('POST', '/sessions/' + session.id + '/folders/cloud%3A%3Aresearch/refresh', {
      expectedSnapshotId: initialSnapshot?.snapshotId ?? null, requestId: ${JSON.stringify(REQUEST_ID)}
    }, ${JSON.stringify(headers)});
    if (refreshed.status !== 200) throw new Error('initial folder save failed: ' + JSON.stringify(refreshed));
    const saved = loadState().workspaces.find(([id]) => id === session.id)?.[1];
    console.log(JSON.stringify({ sessionId: session.id, refreshed, saved }));
  ` : mode === 'replay' ? `
    const sessionId = process.env.SERVED_FOLDER_SESSION_ID;
    if (!sessionId) throw new Error('missing persisted Session identity');
    let reads = 0;
    store.fsFolderSnapshot = () => { reads += 1; throw new Error('source read after restart'); };
    const { call } = await import(${JSON.stringify(testkitModule)});
    const opened = await call('GET', '/sessions/' + sessionId, undefined, ${JSON.stringify(headers)});
    const savedFolder = opened.json?.workspace?.workspaces?.[0]?.folders?.[0];
    if (opened.status !== 200 || savedFolder?.snapshot?.snapshotId !== ${JSON.stringify(REQUEST_ID)}) {
      throw new Error('rehydrated Session did not reopen with its saved folder snapshot');
    }
    const response = await call('POST', '/sessions/' + sessionId + '/folders/cloud%3A%3Aresearch/refresh', {
      expectedSnapshotId: null, requestId: ${JSON.stringify(REQUEST_ID)}
    }, ${JSON.stringify(headers)});
    console.log(JSON.stringify({ opened, response, reads, workspace: store.sessionWorkspace(sessionId), saved: loadState().workspaces.find(([id]) => id === sessionId)?.[1] }));
  ` : mode.startsWith('corrupt-') ? `
    const sessionId = process.env.SERVED_FOLDER_SESSION_ID;
    const state = loadState();
    const row = state?.workspaces?.find(([id]) => id === sessionId)?.[1]?.workspaces?.[0]?.folders?.[0];
    if (!row?.snapshot) throw new Error('saved folder snapshot missing before corruption attempt');
    ${mode === 'corrupt-snapshot'
      ? "row.snapshot.files[0].snapshot = { unexpected: 'malformed persisted snapshot' };"
      : `state.workspaces.find(([id]) => id === sessionId)[1].workspaces.push({
          id: 'duplicate-container', label: 'Duplicate', artifacts: [{
            id: 'duplicate-file', name: 'notes.md', kind: 'doc', meta: '', source: { id: row.id, label: row.label }
          }]
        });`}
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
      SERVED_FOLDER_SESSION_ID: sessionId ?? '',
    },
  })
}

for (const backend of ['json', 'sqlite'] as const) for (const scope of ['flat', 'recursive'] as const) for (const corruption of ['snapshot', 'identity'] as const) {
  test(`${backend}: ${scope} saved folder snapshot and exact refresh replay survive restart; ${corruption} corruption refuses`, () => {
    const fixture = join(directory, `${backend}-${scope}-${corruption}`)
    const cloudRoot = join(fixture, 'cloud')
    const research = join(cloudRoot, 'research')
    mkdirSync(research, { recursive: true })
    mkdirSync(join(research, 'nested'))
    writeFileSync(join(research, 'notes.md'), 'durable folder text')
    writeFileSync(join(research, '.hidden.md'), 'private hidden text')
    writeFileSync(join(research, 'nested', 'child.md'), 'nested text')
    writeFileSync(join(research, 'image.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]))
    const file = join(fixture, `store-${backend}`)

    const create = boot(file, cloudRoot, backend, 'create', scope)()
    assert.equal(create.status, 0, create.stderr)
    const created = JSON.parse(create.stdout.trim())
    const sessionId = created.sessionId as string
    const savedFolder = created.refreshed.json.workspace.workspaces[0].folders[0]
    assert.equal(savedFolder.snapshot.snapshotId, REQUEST_ID)
    assert.equal(savedFolder.snapshot.sourceId, 'cloud')
    assert.equal(savedFolder.snapshot.path, 'research')
    assert.equal(savedFolder.snapshot.version, scope === 'recursive' ? 2 : 1)
    assert.equal(savedFolder.snapshot.scope, scope === 'recursive' ? 'recursive' : undefined)
    assert.deepEqual(savedFolder.snapshot.files.map((entry: any) => [entry.name, entry.snapshot]), [
      ['image.png', { omitted: 'unsupported' }],
      ...(scope === 'recursive' ? [['nested/child.md', { text: 'nested text' }]] : []),
      ['notes.md', { text: 'durable folder text' }],
    ])
    assert.deepEqual(savedFolder.snapshot, created.saved.workspaces[0].folders[0].snapshot)
    assert.deepEqual(created.saved.workspaces[0].artifacts.map((artifact: any) => artifact.id), ['authored-doc'],
      'captured files remain derived from the folder snapshot, not duplicated as workspace artifacts')

    rmSync(research, { recursive: true, force: true })
    const replay = boot(file, cloudRoot, backend, 'replay')(sessionId)
    assert.equal(replay.status, 0, replay.stderr)
    const recovered = JSON.parse(replay.stdout.trim())
    assert.equal(recovered.opened.status, 200)
    assert.equal(recovered.response.status, 200)
    assert.deepEqual(recovered.response.json.workspace, created.refreshed.json.workspace)
    assert.deepEqual(recovered.workspace, created.saved)
    assert.equal(recovered.reads, 0, 'exact replay after restart does not reread changed source files')

    const corrupt = boot(file, cloudRoot, backend, `corrupt-${corruption}`)(sessionId)
    assert.equal(corrupt.status, 0, corrupt.stderr)
    const invalidLoad = boot(file, cloudRoot, backend, 'invalid-load')(sessionId)
    assert.notEqual(invalidLoad.status, 0, 'a malformed persisted folder snapshot refuses process admission')
    assert.match(invalidLoad.stderr, /could not be loaded|missing required core slices/i)
  })
}
