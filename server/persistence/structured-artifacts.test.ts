import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { hasCorePersistedShape } from './format.ts'

const ROOT = mkdtempSync(join(tmpdir(), `agent-commons-structured-${process.pid}-`))
const storeModule = new URL('../store/index.ts', import.meta.url).href
const persistenceModule = new URL('./persist.ts', import.meta.url).href
after(() => rmSync(ROOT, { recursive: true, force: true }))

function boot(file: string, backend: 'json' | 'sqlite', work: string) {
  const script = `
    const { store } = await import(${JSON.stringify(storeModule)});
    const { loadState, closePersistence } = await import(${JSON.stringify(persistenceModule)});
    store.initPersistence();
    ${work}
    closePersistence();
  `
  return spawnSync(process.execPath, ['--input-type=module', '--eval', script], { encoding: 'utf8', timeout: 20_000, env: { ...process.env, INITIAL_WORLD: 'clean', BACKEND: 'mock', PERSIST_BACKEND: backend, DATA_FILE: file, DATABASE_PATH: file } })
}

function ok(result: ReturnType<typeof boot>): Record<string, any> {
  assert.equal(result.status, 0, result.stderr)
  return JSON.parse(result.stdout)
}

for (const backend of ['json', 'sqlite'] as const) {
  test(`${backend}: structured artifact body, rename, grant, and original-save replay survive restart`, () => {
    const file = join(ROOT, `structured-${backend}`)
    const first = ok(boot(file, backend, `
      const owner = 'tenant-structured-persist';
      const body = { type: 'sheet', columns: ['Name', 'Amount'], rows: [['Ada', '=SUM(A1:A2)']], note: 'Persisted.' };
      const op = { kind: 'save-artifact', artifact: { name: 'persisted-sheet.csv', kind: 'sheet', meta: 'Sheet', body }, sessionTitle: 'Structured source' };
      store.applyRelationOp(op, owner);
      const row = store.listArtifacts().find(a => a.name === 'persisted-sheet.csv');
      const grant = store.createGrant({ subject: { kind: 'artifact', id: row.id }, audience: { kind: 'link' }, tier: 'view' }, owner);
      store.redeemGrant(grant.audience.token, 'tenant-structured-reader');
      const renamed = store.renameArtifact(row.id, 'persisted-sheet-renamed.csv', 0, owner);
      console.log(JSON.stringify({ id: row.id, origin: renamed.saveOrigin, body: store.artifactContent(owner)[row.id], grantId: grant.id }));
    `))
    assert.equal(first.body.type, 'sheet')
    assert.equal(first.body.revision, 0)
    assert.equal(first.body.rows[0][1], '=SUM(A1:A2)')
    assert.deepEqual(first.origin, { name: 'persisted-sheet.csv', source: 'Structured source' })
    const second = ok(boot(file, backend, `
      const owner = 'tenant-structured-persist';
      store.applyRelationOp({ kind: 'save-artifact', artifact: { name: 'persisted-sheet.csv', kind: 'sheet', meta: 'Sheet', body: { type: 'sheet', columns: ['Name', 'Amount'], rows: [['Ada', '=SUM(A1:A2)']], note: 'Persisted.' } }, sessionTitle: 'Structured source' }, owner);
      const rows = store.listArtifacts(owner).filter(a => a.saveOrigin?.name === 'persisted-sheet.csv');
      const row = rows.find(a => a.id === ${JSON.stringify(first.id)});
      console.log(JSON.stringify({ count: rows.length, row, body: store.artifactContent(owner)[${JSON.stringify(first.id)}], reader: store.listArtifacts('tenant-structured-reader').find(a => a.id === ${JSON.stringify(first.id)}), readerBody: store.artifactContent('tenant-structured-reader')[${JSON.stringify(first.id)}], state: loadState() }));
    `))
    assert.equal(second.count, 1)
    assert.equal(second.row.name, 'persisted-sheet-renamed.csv')
    assert.deepEqual(second.body, first.body)
    assert.ok(second.state.grants.some((grant: any) => grant.id === first.grantId))
    assert.equal(second.reader.name, 'persisted-sheet-renamed.csv')
    assert.deepEqual(second.readerBody, first.body)
  })
}

test('structured body snapshot validation allows legacy missing revision but rejects invalid revision and unknown fields', () => {
  const source = join(ROOT, 'structured-shape-source')
  ok(boot(source, 'json', `
    store.applyRelationOp({ kind: 'save-artifact', artifact: { name: 'shape.csv', kind: 'sheet', meta: 'Sheet', body: { type: 'sheet', columns: ['A'], rows: [['x']] } } }, 'tenant-shape');
    console.log(JSON.stringify(loadState()));
  `))
  const baseline = JSON.parse(readFileSync(source, 'utf8'))
  const index = baseline.artifactBodies.findIndex(([id]: [string, any]) => baseline.graph.extraArtifacts.some((artifact: any) => artifact.id === id && artifact.name === 'shape.csv'))
  assert.ok(index >= 0)
  const legacy = structuredClone(baseline)
  delete legacy.artifactBodies[index][1].revision
  assert.equal(hasCorePersistedShape(legacy), true, 'missing body revision remains a supported legacy snapshot')
  for (const [label, revision] of [['negative', -1], ['fractional', 0.5]] as const) {
    const invalid = structuredClone(baseline)
    invalid.artifactBodies[index][1].revision = revision
    assert.equal(hasCorePersistedShape(invalid), false, `${label} body revision is rejected`)
  }
  const unknown = structuredClone(baseline)
  unknown.artifactBodies[index][1].extra = true
  assert.equal(hasCorePersistedShape(unknown), false, 'unknown structured body fields are rejected')
  for (const [label, state] of [['negative', (() => { const x = structuredClone(baseline); x.artifactBodies[index][1].revision = -1; return x })()], ['unknown', unknown]] as const) {
    const file = join(ROOT, `structured-invalid-${label}.json`)
    writeFileSync(file, JSON.stringify(state))
    const failed = boot(file, 'json')
    assert.notEqual(failed.status, 0, `${label} snapshot must fail startup admission`)
  }
})
