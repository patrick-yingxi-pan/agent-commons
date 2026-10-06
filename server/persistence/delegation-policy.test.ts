/** Delegation policy history must round-trip through both durable backends,
 * while malformed retained versions fail startup closed. */
import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { hasCorePersistedShape } from './format.ts'
import { delegationRevocationId } from '../delegationRevocationIdentity.ts'

const ROOT = mkdtempSync(join(tmpdir(), `agent-commons-delegation-policy-${process.pid}-`))
const storeModule = new URL('../store/index.ts', import.meta.url).href
const persistenceModule = new URL('./persist.ts', import.meta.url).href
const jsonModule = new URL('./json.ts', import.meta.url).href
const sqliteModule = new URL('./sqlite.ts', import.meta.url).href

after(() => rmSync(ROOT, { recursive: true, force: true }))

function run(file: string, backend: 'json' | 'sqlite', work: string) {
  return spawnSync(process.execPath, ['--input-type=module', '--eval', work], {
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

function ok(result: ReturnType<typeof run>): Record<string, any> {
  assert.equal(result.status, 0, result.stderr || result.stdout)
  return JSON.parse(result.stdout.trim())
}

for (const backend of ['json', 'sqlite'] as const) {
  test(`${backend}: Delegation policy versions survive restart; corrupt history refuses startup`, () => {
    const file = join(ROOT, `policy-${backend}`)
    const setup = ok(run(file, backend, `
      const { store } = await import(${JSON.stringify(storeModule)});
      const { loadState, closePersistence } = await import(${JSON.stringify(persistenceModule)});
      store.initPersistence();
      const owner = 'tenant-policy-persist-${backend}';
      const project = store.createProject({ name: 'Persistent policy ${backend}' }, owner).project;
      const agent = store.createAgent({ label: 'Persistent delegate', providerId: 'provider-claude', tools: [] }, owner);
      const created = store.createDelegation(project.id, {
        agentId: agent.id, actKind: 'land', policy: 'Original retained policy.', mode: 'draft',
        escalation: [], expiresAt: Date.now() + 60_000,
      }, owner);
      if (!created || typeof created !== 'object') throw new Error('Delegation creation failed: ' + String(created));
      const expiry = Date.now() + 120_000;
      const edited = store.patchDelegation(project.id, created.id, {
        expectedRevision: 0, policy: 'Reviewed retained policy.', mode: 'decide',
        escalation: ['stranger'], expiresAt: expiry,
      }, owner);
      if (!edited || typeof edited !== 'object') throw new Error('Delegation edit failed: ' + String(edited));
      console.log(JSON.stringify({ projectId: project.id, id: created.id, row: edited, state: loadState() }));
      closePersistence();
    `))

    assert.equal(setup.row.revision, 1)
    assert.equal(setup.row.policy, 'Reviewed retained policy.')
    assert.ok(setup.row.expiresAt > Date.now(), `${backend}: current expiry remains present`)
    assert.deepEqual(setup.row.versions.map((version: any) => version.revision), [0, 1])
    assert.equal(setup.row.versions.at(-1).expiresAt, setup.row.expiresAt)
    assert.deepEqual(setup.state.delegations.find((row: any) => row.id === setup.id).versions, setup.row.versions)

    const unknownField = structuredClone(setup.state)
    unknownField.delegations.find((row: any) => row.id === setup.id).privateCanary = 'must never reach a shared roster'
    assert.equal(hasCorePersistedShape(unknownField), false,
      `${backend}: an unknown stored Delegation field fails admission before projection can leak it`)

    const collision = structuredClone(setup.state)
    collision.delegationRetirements ??= []
    collision.delegationRetirements.push({
      delegationId: setup.id,
      projectId: setup.projectId,
      createdAt: setup.row.createdAt,
      revocationId: delegationRevocationId(`tenant-policy-persist-${backend}`, setup.projectId, setup.id, `forged-revoke-${backend}`),
      revokedByTenant: `tenant-policy-persist-${backend}`,
      expectedCreatedAt: setup.row.createdAt,
      expectedRevision: setup.row.revision,
    })
    assert.equal(hasCorePersistedShape(collision), false,
      `${backend}: an active authority row cannot also appear in its retirement receipts`)

    const restarted = ok(run(file, backend, `
      const { store } = await import(${JSON.stringify(storeModule)});
      const { closePersistence } = await import(${JSON.stringify(persistenceModule)});
      store.initPersistence();
      const row = store.listDelegations(${JSON.stringify(setup.projectId)}, ${JSON.stringify(`tenant-policy-persist-${backend}`)})[0];
      console.log(JSON.stringify({ row }));
      closePersistence();
    `))
    assert.deepEqual(restarted.row, setup.row, `${backend}: restart returns current policy and its full owner history`)

    const corrupt = run(file, backend, `
      const { JsonFileBackend } = await import(${JSON.stringify(jsonModule)});
      const { SqliteBackend } = await import(${JSON.stringify(sqliteModule)});
      const storage = ${JSON.stringify(backend)} === 'json' ? new JsonFileBackend() : new SqliteBackend(${JSON.stringify(file)});
      const state = storage.load();
      const row = state?.delegations?.find((entry) => entry.id === ${JSON.stringify(setup.id)});
      if (!row?.versions?.[1]) throw new Error('retained history was not persisted');
      row.versions[1].policy = '';
      storage.save(state);
      storage.close();
    `)
    assert.equal(corrupt.status, 0, corrupt.stderr || corrupt.stdout)
    const corruptBytes = readFileSync(file)

    const refused = run(file, backend, `
      const { store } = await import(${JSON.stringify(storeModule)});
      store.initPersistence();
      throw new Error('invalid Delegation policy history was admitted');
    `)
    assert.notEqual(refused.status, 0, `${backend}: malformed policy history must refuse startup`)
    assert.match(`${refused.stderr}\n${refused.stdout}`, /invalid|incompatible|unsupported|refusing/i)
    assert.deepEqual(readFileSync(file), corruptBytes, `${backend}: startup refusal leaves the recoverable bytes untouched`)
  })
}
