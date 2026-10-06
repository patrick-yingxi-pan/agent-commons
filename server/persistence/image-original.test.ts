/** Private image originals remain durable beside normalized-only projections. */
import { after, test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { readPortableSnapshot } from './portable.ts'

const directory = mkdtempSync(join(tmpdir(), `agent-commons-image-original-${process.pid}-`))
const storeModule = new URL('../store/index.ts', import.meta.url).href
const persistenceModule = new URL('./persist.ts', import.meta.url).href
const portableModule = new URL('./portable.ts', import.meta.url).href
const testkitModule = new URL('../testkit/http.ts', import.meta.url).href
const tenant = 'image-original-restart-owner'
const sharedTenant = 'tenant-beta'
const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='
const original = { name: 'diagram-original.svg', data: Buffer.from('<svg>source-original</svg>').toString('base64'), byteLength: Buffer.byteLength('<svg>source-original</svg>') }

after(() => rmSync(directory, { recursive: true, force: true }))

function boot(file: string, portableFile: string, backend: 'json' | 'sqlite', mode: 'create' | 'restart') {
  const work = mode === 'create' ? `
    const session = (await call('POST', '/sessions', { firstMessage: 'private image original' }, ownerHeaders)).json;
    const normalized = { mimeType: 'image/png', data: ${JSON.stringify(png)}, width: 1, height: 1, byteLength: Buffer.from(${JSON.stringify(png)}, 'base64').byteLength };
    const uploaded = await call('POST', '/image-assets', { image: normalized, original: ${JSON.stringify(original)} }, ownerHeaders);
    const legacy = await call('POST', '/image-assets', normalized, ownerHeaders);
    const workspace = { workspaces: [], repos: [], connectors: [], attachments: [{ id: 'local-original', label: 'diagram-original.svg', kind: 'photo', image: uploaded.json }] };
    const attached = await call('PATCH', '/sessions/' + session.id + '/context-state', { operations: [], workspace }, ownerHeaders);
    const granted = await call('POST', '/grants', { subject: { kind: 'session', id: session.id }, audience: { kind: 'org', orgId: sharedTenant }, tier: 'view' }, ownerHeaders);
    const sharedSession = await call('GET', '/sessions/' + session.id, undefined, sharedHeaders);
    const sharedContent = await callRaw('GET', '/image-assets/' + uploaded.json.id + '/content', undefined, sharedHeaders);
    const privateFromViewer = await call('GET', '/image-assets/' + uploaded.json.id + '/original', undefined, sharedHeaders);
    writePortableSnapshot(process.env.IMAGE_ORIGINAL_PORTABLE_FILE, loadState());
    console.log(JSON.stringify({ sessionId: session.id, uploaded, legacy, attached, granted, sharedSession, sharedContentStatus: sharedContent.status, privateFromViewerStatus: privateFromViewer.status, modelImages: store.sessionImageInput(session.id) }));
  ` : `
    const sessionId = process.env.IMAGE_ORIGINAL_SESSION_ID;
    const id = process.env.IMAGE_ORIGINAL_ASSET_ID;
    const legacyId = process.env.IMAGE_ORIGINAL_LEGACY_ID;
    const ownerOriginal = await call('GET', '/image-assets/' + id + '/original', undefined, ownerHeaders);
    const sharedOriginal = await call('GET', '/image-assets/' + id + '/original', undefined, sharedHeaders);
    const sharedContent = await callRaw('GET', '/image-assets/' + id + '/content', undefined, sharedHeaders);
    const visibleSession = await call('GET', '/sessions/' + sessionId, undefined, sharedHeaders);
    const legacyOriginal = await call('GET', '/image-assets/' + legacyId + '/original', undefined, ownerHeaders);
    console.log(JSON.stringify({ ownerOriginal, sharedOriginalStatus: sharedOriginal.status, sharedContentStatus: sharedContent.status, visibleSession, legacyOriginalStatus: legacyOriginal.status, modelImages: store.sessionImageInput(sessionId) }));
  `
  const script = `
    const { store } = await import(${JSON.stringify(storeModule)});
    const { loadState, closePersistence } = await import(${JSON.stringify(persistenceModule)});
    const { writePortableSnapshot } = await import(${JSON.stringify(portableModule)});
    const { call } = await import(${JSON.stringify(testkitModule)});
    const { callRaw } = await import(${JSON.stringify(testkitModule)});
    const ownerHeaders = { 'x-tenant-id': ${JSON.stringify(tenant)} };
    const sharedTenant = ${JSON.stringify(sharedTenant)};
    const sharedHeaders = { 'x-tenant-id': sharedTenant };
    store.initPersistence();
    ${work}
    closePersistence();
  `
  return (sessionId = '', assetId = '', legacyId = '') => spawnSync(process.execPath, ['--input-type=module', '--eval', script], {
    encoding: 'utf8', timeout: 20_000,
    env: {
      ...process.env,
      INITIAL_WORLD: 'demo', BACKEND: 'mock', PERSIST_BACKEND: backend,
      DATA_FILE: file, DATABASE_PATH: file,
      IMAGE_ORIGINAL_PORTABLE_FILE: portableFile,
      IMAGE_ORIGINAL_SESSION_ID: sessionId,
      IMAGE_ORIGINAL_ASSET_ID: assetId,
      IMAGE_ORIGINAL_LEGACY_ID: legacyId,
    },
  })
}

for (const backend of ['json', 'sqlite'] as const) {
  test(`${backend}: private image original survives attachment restart and portable export`, () => {
    const fixture = join(directory, backend)
    mkdirSync(fixture, { recursive: true })
    const file = join(fixture, backend === 'json' ? 'store.json' : 'store.sqlite')
    const portableFile = join(fixture, 'portable.json')
    const created = boot(file, portableFile, backend, 'create')()
    assert.equal(created.status, 0, created.stderr)
    const saved = JSON.parse(created.stdout.trim())
    assert.equal(saved.uploaded.status, 200)
    assert.equal(saved.legacy.status, 200)
    assert.equal(saved.attached.status, 200)
    assert.equal(saved.granted.status, 200)
    assert.equal(saved.sharedContentStatus, 200, 'the shared session can still read the normalized image')
    assert.equal(saved.privateFromViewerStatus, 404, 'sharing never grants access to original bytes')
    assert.equal(JSON.stringify(saved.sharedSession.json).includes(original.data), false)
    assert.equal(JSON.stringify(saved.sharedSession.json).includes('source-original'), false)
    assert.deepEqual(saved.modelImages, {
      [saved.uploaded.json.id]: { mimeType: 'image/png', data: png, width: 1, height: 1, byteLength: Buffer.from(png, 'base64').byteLength },
    }, 'model input contains the normalized snapshot only')

    const portable = readPortableSnapshot(portableFile)
    const durable = portable.imageAssets?.find((row) => row.id === saved.uploaded.json.id)
    assert.deepEqual(durable?.original, original, 'portable state includes the exact private original')
    assert.equal(portable.imageAssets?.find((row) => row.id === saved.legacy.json.id)?.original, undefined,
      'legacy normalized-only rows remain valid in portable state')

    const restarted = boot(file, portableFile, backend, 'restart')(
      saved.sessionId, saved.uploaded.json.id, saved.legacy.json.id,
    )
    assert.equal(restarted.status, 0, restarted.stderr)
    const recovered = JSON.parse(restarted.stdout.trim())
    assert.deepEqual(recovered.ownerOriginal.json, { id: saved.uploaded.json.id, original })
    assert.equal(recovered.sharedOriginalStatus, 404)
    assert.equal(recovered.sharedContentStatus, 200)
    assert.equal(recovered.legacyOriginalStatus, 404)
    assert.equal(JSON.stringify(recovered.visibleSession.json).includes(original.data), false)
    assert.deepEqual(recovered.modelImages, saved.modelImages)
  })
}
