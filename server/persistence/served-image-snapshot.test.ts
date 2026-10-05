/** Served image receipts survive JSON/SQLite restart beside tenant-scoped asset rows. */
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'

const directory = mkdtempSync(join(tmpdir(), `agent-commons-served-image-${process.pid}-`))
const storeModule = new URL('../store/index.ts', import.meta.url).href
const persistenceModule = new URL('./persist.ts', import.meta.url).href
const testkitModule = new URL('../testkit/http.ts', import.meta.url).href
const REQUEST_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const RETRY_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const tenant = 'served-image-snapshot-persist-owner'
const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='

after(() => rmSync(directory, { recursive: true, force: true }))

function boot(file: string, cloudRoot: string, backend: 'json' | 'sqlite', mode: 'create' | 'create-default' | 'replay' | 'corrupt' | 'unstamp' | 'load' | 'invalid-load') {
  const work = mode === 'create' ? `
    const { call } = await import(${JSON.stringify(testkitModule)});
    const ownerTenant = ${JSON.stringify(tenant)};
    const ownerHeaders = { 'x-tenant-id': ownerTenant };
    const session = store.createSession('served image snapshot persistence', ownerTenant);
    const source = { id: 'cloud', kind: 'cloud', label: 'Cloud storage' };
    const attachment = { id: 'cloud::photos/cover.png', label: 'cover.png', kind: 'photo', source };
    const workspace = { workspaces: [], repos: [], connectors: [], attachments: [attachment] };
    const attached = await call('PATCH', '/sessions/' + session.id + '/context-state', { operations: [], workspace }, ownerHeaders);
    if (attached.status !== 200) throw new Error('photo attach failed: ' + JSON.stringify(attached));
    const image = { mimeType: 'image/png', data: ${JSON.stringify(png)}, width: 1, height: 1, byteLength: Buffer.from(${JSON.stringify(png)}, 'base64').byteLength };
    const uploaded = await call('POST', '/image-assets', image, ownerHeaders);
    if (uploaded.status !== 200) throw new Error('image asset upload failed: ' + JSON.stringify(uploaded));
    const imageSnapshot = { version: 1, snapshotId: ${JSON.stringify(REQUEST_ID)}, capturedAt: '2026-10-04T12:00:00.000Z', sourceId: 'cloud', path: 'photos/cover.png', image: uploaded.json };
    const saved = await call('POST', '/sessions/' + session.id + '/attachments/cloud%3A%3Aphotos%2Fcover.png/refresh', {
      expectedSnapshotId: null, requestId: imageSnapshot.snapshotId, imageSnapshot
    }, ownerHeaders);
    if (saved.status !== 200) throw new Error('served image save failed: ' + JSON.stringify(saved));
    const state = loadState();
    const workspaceRow = state.workspaces.find(([id]) => id === session.id)?.[1];
    console.log(JSON.stringify({ sessionId: session.id, ownerTenant, saved, workspaceRow, imageAssets: state.imageAssets }));
  ` : mode === 'create-default' ? `
    const { call } = await import(${JSON.stringify(testkitModule)});
    const ownerTenant = store.defaultTenantId();
    const ownerHeaders = { 'x-tenant-id': ownerTenant };
    const session = store.createSession('served image snapshot default-owner persistence', ownerTenant);
    const source = { id: 'cloud', kind: 'cloud', label: 'Cloud storage' };
    const attachment = { id: 'cloud::photos/cover.png', label: 'cover.png', kind: 'photo', source };
    const workspace = { workspaces: [], repos: [], connectors: [], attachments: [attachment] };
    const attached = await call('PATCH', '/sessions/' + session.id + '/context-state', { operations: [], workspace }, ownerHeaders);
    if (attached.status !== 200) throw new Error('photo attach failed: ' + JSON.stringify(attached));
    const image = { mimeType: 'image/png', data: ${JSON.stringify(png)}, width: 1, height: 1, byteLength: Buffer.from(${JSON.stringify(png)}, 'base64').byteLength };
    const uploaded = await call('POST', '/image-assets', image, ownerHeaders);
    if (uploaded.status !== 200) throw new Error('image asset upload failed: ' + JSON.stringify(uploaded));
    const imageSnapshot = { version: 1, snapshotId: ${JSON.stringify(REQUEST_ID)}, capturedAt: '2026-10-04T12:00:00.000Z', sourceId: 'cloud', path: 'photos/cover.png', image: uploaded.json };
    const saved = await call('POST', '/sessions/' + session.id + '/attachments/cloud%3A%3Aphotos%2Fcover.png/refresh', {
      expectedSnapshotId: null, requestId: imageSnapshot.snapshotId, imageSnapshot
    }, ownerHeaders);
    if (saved.status !== 200) throw new Error('served image save failed: ' + JSON.stringify(saved));
    console.log(JSON.stringify({ sessionId: session.id, ownerTenant }));
  ` : mode === 'replay' ? `
    const sessionId = process.env.SERVED_IMAGE_SESSION_ID;
    const { call } = await import(${JSON.stringify(testkitModule)});
    let checks = 0;
    store.fsReadPermitted = () => { checks += 1; throw new Error('exact replay must not recheck source authority'); };
    const imageRef = loadState().imageAssets[0];
    const imageSnapshot = { version: 1, snapshotId: ${JSON.stringify(REQUEST_ID)}, capturedAt: '2026-10-04T12:00:00.000Z', sourceId: 'cloud', path: 'photos/cover.png', image: {
      id: imageRef.id, mimeType: imageRef.image.mimeType, width: imageRef.image.width, height: imageRef.image.height, byteLength: imageRef.image.byteLength
    } };
    const response = await call('POST', '/sessions/' + sessionId + '/attachments/cloud%3A%3Aphotos%2Fcover.png/refresh', {
      expectedSnapshotId: null, requestId: imageSnapshot.snapshotId, imageSnapshot
    }, { 'x-tenant-id': ${JSON.stringify(tenant)} });
    const changed = await call('POST', '/sessions/' + sessionId + '/attachments/cloud%3A%3Aphotos%2Fcover.png/refresh', {
      expectedSnapshotId: null, requestId: imageSnapshot.snapshotId,
      imageSnapshot: { ...imageSnapshot, capturedAt: '2026-10-04T12:01:00.000Z' }
    }, { 'x-tenant-id': ${JSON.stringify(tenant)} });
    store.fsReadPermitted = () => false;
    const fresh = await call('POST', '/sessions/' + sessionId + '/attachments/cloud%3A%3Aphotos%2Fcover.png/refresh', {
      expectedSnapshotId: ${JSON.stringify(REQUEST_ID)}, requestId: ${JSON.stringify(RETRY_ID)},
      imageSnapshot: { ...imageSnapshot, snapshotId: ${JSON.stringify(RETRY_ID)}, capturedAt: '2026-10-04T12:02:00.000Z' }
    }, { 'x-tenant-id': ${JSON.stringify(tenant)} });
    console.log(JSON.stringify({ response, changed, fresh, checks, workspaceRow: loadState().workspaces.find(([id]) => id === sessionId)?.[1] }));
  ` : mode === 'corrupt' ? `
    const state = loadState();
    const sessionId = process.env.SERVED_IMAGE_SESSION_ID;
    const workspace = state?.workspaces?.find(([id]) => id === sessionId)?.[1];
    const attachment = workspace?.attachments?.[0];
    if (!attachment?.imageSnapshot) throw new Error('saved served image receipt missing before corruption');
    const corruption = process.env.SERVED_IMAGE_CORRUPTION;
    if (corruption === 'missing-asset') state.imageAssets = state.imageAssets.filter((row) => row.id !== attachment.imageSnapshot.image.id);
    else if (corruption === 'mismatched-metadata') attachment.imageSnapshot.image.width = 2;
    else if (corruption === 'malformed-path') attachment.imageSnapshot.path = 'photos/other.png';
    else if (corruption === 'foreign-owner') state.sessions.find((row) => row.id === sessionId).tenantId = 'served-image-snapshot-foreign-owner';
    else if (corruption === 'orphan-session') state.sessions = state.sessions.filter((row) => row.id !== sessionId);
    else if (corruption === 'unstamped-foreign') delete state.sessions.find((row) => row.id === sessionId).tenantId;
    else throw new Error('unknown corruption case: ' + corruption);
    saveState(state);
    console.log('corrupted');
  ` : mode === 'unstamp' ? `
    const state = loadState();
    const sessionId = process.env.SERVED_IMAGE_SESSION_ID;
    delete state.sessions.find((row) => row.id === sessionId).tenantId;
    saveState(state);
    console.log('unstamped');
  ` : mode === 'load' ? `
    console.log(JSON.stringify({ sessions: loadState().sessions.length }));
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
  return (sessionId?: string, corruption?: string) => spawnSync(process.execPath, ['--input-type=module', '--eval', script], {
    encoding: 'utf8', timeout: 20_000,
    env: {
      ...process.env,
      INITIAL_WORLD: 'clean', BACKEND: 'mock', PERSIST_BACKEND: backend,
      DATA_FILE: file, DATABASE_PATH: file, CONTEXT_CLOUD_ROOT: cloudRoot,
      SERVED_IMAGE_SESSION_ID: sessionId ?? '',
      SERVED_IMAGE_CORRUPTION: corruption ?? '',
    },
  })
}

for (const backend of ['json', 'sqlite'] as const) {
  test(`${backend}: served image receipt and tenant asset replay survive restart after source removal`, () => {
    const fixture = join(directory, backend)
    const cloudRoot = join(fixture, 'cloud')
    mkdirSync(cloudRoot, { recursive: true })
    const file = join(fixture, `store-${backend}`)

    const create = boot(file, cloudRoot, backend, 'create')()
    assert.equal(create.status, 0, create.stderr)
    const created = JSON.parse(create.stdout.trim())
    const sessionId = created.sessionId as string
    const savedAttachment = created.workspaceRow.attachments[0]
    assert.equal(savedAttachment.image, undefined, 'served image references are not duplicated at the attachment root')
    assert.equal(savedAttachment.imageSnapshot.snapshotId, REQUEST_ID)
    assert.equal(savedAttachment.imageSnapshot.image.id, created.imageAssets[0].id)
    assert.equal('data' in savedAttachment.imageSnapshot.image, false, 'raw image bytes do not live in the saved workspace projection')
    assert.equal(created.imageAssets.length, 1, 'the normalized tenant asset remains in the existing durable image slice')

    rmSync(cloudRoot, { recursive: true, force: true })
    const replay = boot(file, cloudRoot, backend, 'replay')(sessionId)
    assert.equal(replay.status, 0, replay.stderr)
    const recovered = JSON.parse(replay.stdout.trim())
    assert.equal(recovered.response.status, 200)
    assert.deepEqual(recovered.response.json.workspace.attachments[0].imageSnapshot, savedAttachment.imageSnapshot)
    assert.equal(recovered.changed.status, 409, 'a changed receipt cannot reuse the durable request ID')
    assert.equal(recovered.fresh.status, 409, 'source authority is required again for a new Refresh')
    assert.equal(recovered.checks, 0, 'exact replay succeeds without reading or rechecking the source')

  })

  for (const corruption of ['missing-asset', 'mismatched-metadata', 'malformed-path', 'foreign-owner', 'orphan-session', 'unstamped-foreign']) {
    test(`${backend}: served image persistence refuses ${corruption} receipts`, () => {
      const fixture = join(directory, `${backend}-${corruption}`)
      const cloudRoot = join(fixture, 'cloud')
      mkdirSync(cloudRoot, { recursive: true })
      const file = join(fixture, `store-${backend}`)
      const created = boot(file, cloudRoot, backend, 'create')()
      assert.equal(created.status, 0, created.stderr)
      const sessionId = (JSON.parse(created.stdout.trim())).sessionId as string
      const corrupted = boot(file, cloudRoot, backend, 'corrupt')(sessionId, corruption)
      assert.equal(corrupted.status, 0, corrupted.stderr)
      const rejected = boot(file, cloudRoot, backend, 'invalid-load')(sessionId)
      assert.notEqual(rejected.status, 0, `${corruption} receipt must refuse startup`)
      assert.doesNotMatch(rejected.stderr, /INVALID_LOAD_SHOULD_NOT_REACH_TEST_BODY/, `${corruption} must be rejected before test code runs`)
    })
  }

  test(`${backend}: an unstamped served-image owner uses the store default tenant`, () => {
    const fixture = join(directory, `${backend}-unstamped-default`)
    const cloudRoot = join(fixture, 'cloud')
    mkdirSync(cloudRoot, { recursive: true })
    const file = join(fixture, `store-${backend}`)
    const created = boot(file, cloudRoot, backend, 'create-default')()
    assert.equal(created.status, 0, created.stderr)
    const sessionId = (JSON.parse(created.stdout.trim())).sessionId as string
    const unstamped = boot(file, cloudRoot, backend, 'unstamp')(sessionId)
    assert.equal(unstamped.status, 0, unstamped.stderr)
    const accepted = boot(file, cloudRoot, backend, 'load')(sessionId)
    assert.equal(accepted.status, 0, accepted.stderr)
  })
}
