/** Artifact display metadata is durable, portable state independent from the
 * authored body.  Each case uses an isolated fresh process and backend so the
 * assertions exercise the real rehydrate boundary rather than an in-memory map. */
import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { hasCorePersistedShape } from './format.ts'
import { docBlockId } from '../documentIdentity.ts'

const ROOT = mkdtempSync(join(tmpdir(), `agent-commons-artifact-metadata-${process.pid}-`))
const storeModule = new URL('../store/index.ts', import.meta.url).href
const persistenceModule = new URL('./persist.ts', import.meta.url).href

after(() => rmSync(ROOT, { recursive: true, force: true }))

function boot(file: string, backend: 'json' | 'sqlite', work = '') {
  const script = `
    const { store } = await import(${JSON.stringify(storeModule)});
    const { loadState, closePersistence } = await import(${JSON.stringify(persistenceModule)});
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
  assert.equal(result.status, 0, result.stderr)
  return result.stdout.trim() ? JSON.parse(result.stdout) : {}
}

for (const backend of ['json', 'sqlite'] as const) {
  test(`${backend}: renamed artifact, body, provenance, grant, and identity survive restart`, () => {
    const file = join(ROOT, `metadata-${backend}`)
    const first = ok(boot(file, backend, `
      const owner = 'tenant-metadata-persist-owner';
      const original = 'persisted-original-${backend}.md';
      const renamed = 'persisted-renamed-${backend}.md';
      const body = 'Durable first block.\\n\\nDurable second block.';
      const op = { kind: 'save-artifact', artifact: { name: original, kind: 'doc', meta: 'Document', body }, sessionTitle: 'Durable metadata source' };
      store.applyRelationOp(op, owner);
      const before = store.listArtifacts(owner).find(a => a.name === original);
      const grant = store.createGrant({ subject: { kind: 'artifact', id: before.id }, audience: { kind: 'link' }, tier: 'view' }, owner);
      const changed = store.renameArtifact(before.id, renamed, before.metadataRevision ?? 0, owner);
      const state = loadState();
      console.log(JSON.stringify({ id: before.id, changed, grantId: grant?.id, body: store.artifactContent(owner)[before.id], origin: changed.saveOrigin, source: changed.source, state }));
    `))
    assert.ok(first.id)
    assert.equal(first.changed.name, `persisted-renamed-${backend}.md`)
    assert.equal(first.changed.metadataRevision, 1)
    assert.deepEqual(first.body.blocks, [
      { id: docBlockId(first.id, 0, 0), p: 'Durable first block.' },
      { id: docBlockId(first.id, 0, 1), p: 'Durable second block.' },
    ])
    assert.equal(first.body.revision, 0)
    assert.deepEqual(first.origin, { name: `persisted-original-${backend}.md`, source: 'Durable metadata source' })
    assert.equal(first.source, 'Durable metadata source')
    assert.ok(first.grantId)
    assert.ok(first.state.artifactMetadata.some(([id, metadata]: [string, any]) => id === first.id && metadata.name === first.changed.name && metadata.revision === 1))
    assert.equal(hasCorePersistedShape(first.state), true, `${backend}: persisted snapshot remains portable/core-valid`)

    const second = ok(boot(file, backend, `
      const owner = 'tenant-metadata-persist-owner';
      const original = 'persisted-original-${backend}.md';
      const renamed = 'persisted-renamed-${backend}.md';
      const op = { kind: 'save-artifact', artifact: { name: original, kind: 'doc', meta: 'Document', body: 'Durable first block.\\n\\nDurable second block.' }, sessionTitle: 'Durable metadata source' };
      store.applyRelationOp(op, owner);
      const rows = store.listArtifacts(owner);
      const matching = rows.filter(a => a.saveOrigin?.name === original && a.saveOrigin?.source === 'Durable metadata source');
      const state = loadState();
      console.log(JSON.stringify({ count: matching.length, row: rows.find(a => a.id === ${JSON.stringify(first.id)}), oldNameRows: rows.filter(a => a.name === original), body: store.artifactContent(owner)[${JSON.stringify(first.id)}], grants: state.grants, state }));
    `))
    assert.equal(second.count, 1, `${backend}: replay remains one row`)
    assert.equal(second.row.name, `persisted-renamed-${backend}.md`, `${backend}: replay cannot overwrite display metadata`)
    assert.equal(second.row.id, first.id)
    assert.deepEqual(second.oldNameRows, [], `${backend}: replay leaves no display row under the historical name`)
    assert.deepEqual(second.body.blocks, first.body.blocks)
    assert.equal(second.body.revision, 0)
    assert.deepEqual(second.row.saveOrigin, first.origin)
    assert.ok(second.grants.some((grant: any) => grant.id === first.grantId), `${backend}: grant survives restart`)
  })
}

test('present malformed artifact metadata is rejected, while absent legacy metadata remains admissible', () => {
  const file = join(ROOT, 'metadata-malformed-json')
  ok(boot(file, 'json', `
    store.applyRelationOp({ kind: 'save-artifact', artifact: { name: 'origin-check.md', kind: 'doc', meta: 'Document', body: 'Origin.' } }, 'tenant-origin-check');
    console.log(JSON.stringify(loadState()));
  `))
  const state = JSON.parse(readFileSync(file, 'utf8'))
  const absent = { ...state }
  delete absent.artifactMetadata
  assert.equal(hasCorePersistedShape(absent), true, 'legacy snapshots may omit the additive slice')
  state.artifactMetadata = [['bad-id', { name: 'bad', revision: -1, editedAt: 0 }]]
  assert.equal(hasCorePersistedShape(state), false, 'a present malformed slice fails core validation')
  const malformedOrigin = JSON.parse(readFileSync(file, 'utf8'))
  malformedOrigin.graph.extraArtifacts[0].saveOrigin = { name: 'bad', source: 'bad', extra: true }
  assert.equal(hasCorePersistedShape(malformedOrigin), false, 'a malformed saveOrigin fails core validation')
  rmSync(file)
  const broken = join(ROOT, 'metadata-malformed-existing.json')
  writeFileSync(broken, JSON.stringify(state))
  const failed = boot(broken, 'json')
  assert.notEqual(failed.status, 0)
  assert.match(failed.stderr, /artifact metadata|invalid|persist/i)
})

test('a failed JSON metadata commit publishes no artifact event and preserves the prior durable snapshot', () => {
  const file = join(ROOT, 'metadata-failure-json')
  ok(boot(file, 'json', `
    const owner = 'tenant-metadata-failure-owner';
    store.applyRelationOp({ kind: 'save-artifact', artifact: { name: 'failure-original.md', kind: 'doc', meta: 'Document', body: 'Keep.' } }, owner);
    const row = store.listArtifacts().find(a => a.name === 'failure-original.md');
    store.renameArtifact(row.id, 'failure-renamed.md', 0, owner);
  `))
  const blocked = join(ROOT, 'metadata-blocked-directory')
  const result = boot(file, 'json', `
    const { renameSync, mkdirSync } = await import('node:fs');
    const owner = 'tenant-metadata-failure-owner';
    const row = store.listArtifacts().find(a => a.saveOrigin?.name === 'failure-original.md');
    const events = [];
    const off = store.subscribe(event => { if (event.type === 'artifact.changed') events.push(event); });
    renameSync(process.env.DATA_FILE, ${JSON.stringify(blocked)});
    mkdirSync(process.env.DATA_FILE);
    let failed = false;
    try { store.renameArtifact(row.id, 'must-not-commit.md', 1, owner); } catch { failed = true; }
    off();
    console.log(JSON.stringify({ failed, events, row: store.listArtifacts().find(a => a.id === row.id) }));
  `)
  assert.equal(result.status, 0, result.stderr)
  const report = JSON.parse(result.stdout)
  assert.equal(report.failed, true)
  assert.deepEqual(report.events, [])
  assert.equal(report.row.name, 'must-not-commit.md', 'the failed process may advance its in-memory projection before latching unhealthy')
  const durable = JSON.parse(readFileSync(blocked, 'utf8'))
  const raw = durable.graph.extraArtifacts.find((a: any) => a.name === 'failure-original.md')
  assert.ok(raw)
  assert.equal(durable.artifactMetadata.find(([id]: [string]) => id === raw.id)?.[1].name, 'failure-renamed.md')
  assert.equal(durable.artifactMetadata.some(([id, metadata]: [string, any]) => id === raw.id && metadata.name === 'must-not-commit.md'), false)
})
