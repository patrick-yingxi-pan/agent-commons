/** Durable body-derived artifact excerpts retain explicit-synopsis provenance. */
import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { hasCorePersistedShape } from './format.ts'

const ROOT = mkdtempSync(join(tmpdir(), `agent-commons-artifact-excerpts-${process.pid}-`))
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
    encoding: 'utf8',
    timeout: 20_000,
    env: {
      ...process.env,
      INITIAL_WORLD: 'clean',
      BACKEND: 'mock',
      PERSIST_BACKEND: backend,
      DATA_FILE: file,
      DATABASE_PATH: file,
    },
  })
}

function ok(result: ReturnType<typeof boot>): Record<string, any> {
  assert.equal(result.status, 0, result.stderr)
  return result.stdout.trim() ? JSON.parse(result.stdout) : {}
}

for (const backend of ['json', 'sqlite'] as const) {
  test(`${backend}: body-derived excerpts follow edits across restart while an explicit synopsis stays fixed`, () => {
    const file = join(ROOT, `new-excerpts-${backend}`)
    const first = ok(boot(file, backend, `
      const tenant = 'tenant-artifact-excerpt-persist';
      const directId = 'artifact-new-${'a'.repeat(24)}';
      store.createArtifact({ name: 'direct-excerpt.md', kind: 'doc', body: 'Direct original body.' }, tenant, directId);
      store.applyRelationOp({ kind: 'save-artifact', artifact: { name: 'automatic-excerpt.md', kind: 'doc', meta: 'Document', body: 'Automatic original body.' } }, tenant);
      store.applyRelationOp({ kind: 'save-artifact', artifact: { name: 'explicit-excerpt.md', kind: 'doc', meta: 'Document', body: 'Explicit original body.', excerpt: 'Hand-written synopsis.' } }, tenant);
      const rows = store.listArtifacts(tenant);
      const direct = rows.find(row => row.id === directId);
      const automatic = rows.find(row => row.name === 'automatic-excerpt.md');
      const explicit = rows.find(row => row.name === 'explicit-excerpt.md');
      store.updateArtifactBlock(direct.id, 0, 'Direct edited body.');
      store.updateArtifactBlock(automatic.id, 0, 'Automatic edited body.');
      store.updateArtifactBlock(explicit.id, 0, 'Explicit edited body.');
      console.log(JSON.stringify({ ids: { direct: direct.id, automatic: automatic.id, explicit: explicit.id } }));
    `))

    const ids = first.ids
    const second = ok(boot(file, backend, `
      const ids = ${JSON.stringify(ids)};
      const rows = store.listArtifacts('tenant-artifact-excerpt-persist');
      const find = id => rows.find(row => row.id === id);
      console.log(JSON.stringify({ rows: ids, artifacts: Object.fromEntries(Object.entries(ids).map(([key, id]) => [key, find(id)])), state: loadState() }));
    `))

    assert.equal(second.artifacts.direct.excerpt, 'Direct edited body.', `${backend}: direct artifact excerpt follows its edited body`)
    assert.equal(second.artifacts.automatic.excerpt, 'Automatic edited body.', `${backend}: absent save synopsis follows its edited body`)
    assert.equal(second.artifacts.explicit.excerpt, 'Hand-written synopsis.', `${backend}: explicit synopsis remains independent`)
    for (const key of ['direct', 'automatic']) {
      const row = second.state.graph.extraArtifacts.find((artifact: any) => artifact.id === ids[key])
      assert.equal(row.excerptSource, 'body', `${backend}: ${key} persists body-derived provenance`)
    }
    const explicit = second.state.graph.extraArtifacts.find((artifact: any) => artifact.id === ids.explicit)
    assert.notEqual(explicit.excerptSource, 'body', `${backend}: explicit synopsis is never relabeled as body-derived`)
    assert.equal(hasCorePersistedShape(second.state), true, `${backend}: current provenance remains portable/core-valid`)
  })
}

test('unknown present excerpt provenance refuses snapshot admission', () => {
  const source = join(ROOT, 'unknown-excerpt-source.json')
  ok(boot(source, 'json', `
    store.createArtifact({ name: 'unknown-marker.md', kind: 'doc', body: 'Body.' }, 'tenant-artifact-excerpt-persist', 'artifact-new-${'b'.repeat(24)}');
  `))
  const state = JSON.parse(readFileSync(source, 'utf8'))
  const row = state.graph.extraArtifacts.find((artifact: any) => artifact.id === `artifact-new-${'b'.repeat(24)}`)
  assert.ok(row, 'fixture contains the direct-created artifact')
  row.excerptSource = 'synopsis'
  assert.equal(hasCorePersistedShape(state), false, 'an unknown present provenance marker is invalid')

  const malformed = join(ROOT, 'unknown-excerpt-marker.json')
  writeFileSync(malformed, JSON.stringify(state))
  const refused = boot(malformed, 'json')
  assert.notEqual(refused.status, 0, 'startup refuses an existing snapshot with an unknown marker')
})

test('legacy direct creation migrates by opaque ID at startup; ambiguous save synopsis is preserved', () => {
  const file = join(ROOT, 'legacy-excerpts.json')
  const directId = `artifact-new-${'c'.repeat(24)}`
  const oldSaveName = 'legacy-consent-save.md'
  ok(boot(file, 'json', `
    const tenant = 'tenant-artifact-excerpt-persist';
    store.createArtifact({ name: 'legacy-direct.md', kind: 'doc', body: 'Legacy current body.' }, tenant, ${JSON.stringify(directId)});
    store.applyRelationOp({ kind: 'save-artifact', artifact: { name: ${JSON.stringify(oldSaveName)}, kind: 'doc', meta: 'Document', body: 'Legacy saved body.', excerpt: 'Legacy consent synopsis.' } }, tenant);
    const saved = store.listArtifacts(tenant).find(row => row.name === ${JSON.stringify(oldSaveName)});
    store.updateArtifactBlock(saved.id, 0, 'Legacy saved body changed later.');
  `))

  const legacy = JSON.parse(readFileSync(file, 'utf8'))
  const direct = legacy.graph.extraArtifacts.find((artifact: any) => artifact.id === directId)
  const saved = legacy.graph.extraArtifacts.find((artifact: any) => artifact.name === oldSaveName)
  assert.ok(direct)
  assert.ok(saved)
  delete direct.excerptSource
  direct.excerpt = 'Stale legacy direct excerpt.'
  delete saved.excerptSource
  writeFileSync(file, JSON.stringify(legacy))

  const migrated = ok(boot(file, 'json', `
    const tenant = 'tenant-artifact-excerpt-persist';
    console.log(JSON.stringify({ state: loadState(), rows: store.listArtifacts(tenant), graph: store.relationGraph(tenant) }));
  `))
  const directRow = migrated.state.graph.extraArtifacts.find((artifact: any) => artifact.id === directId)
  const savedRow = migrated.state.graph.extraArtifacts.find((artifact: any) => artifact.name === oldSaveName)
  assert.equal(directRow.excerptSource, 'body', 'the recognized direct-create identity is migrated deterministically')
  assert.equal(
    migrated.rows.find((artifact: any) => artifact.id === directId)?.excerpt,
    'Legacy current body.',
    'the public artifact projection derives the excerpt from the current authored body',
  )
  assert.equal(
    migrated.graph.extraArtifacts.find((artifact: any) => artifact.id === directId)?.excerpt,
    'Legacy current body.',
    'the relation graph uses the same body-derived excerpt',
  )
  assert.equal(savedRow.excerptSource, undefined, 'an old consent save has no inferred provenance')
  assert.equal(savedRow.excerpt, 'Legacy consent synopsis.', 'startup preserves ambiguous legacy synopsis text')

  const published = JSON.parse(readFileSync(file, 'utf8'))
  const publishedDirect = published.graph.extraArtifacts.find((artifact: any) => artifact.id === directId)
  assert.equal(publishedDirect?.excerptSource, 'body', 'startup persists the migration before admitting the store')
  assert.equal(
    published.graph.extraArtifacts.find((artifact: any) => artifact.name === oldSaveName)?.excerpt,
    'Legacy consent synopsis.',
    'the durable migration leaves ambiguous legacy save text untouched',
  )
})
