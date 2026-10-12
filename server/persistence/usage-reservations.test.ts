/** Commission model-usage holds are durable private rows joined to exact claims. */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'
import { addCommissionMcpSnapshotFixture } from '../../scripts/snapshotCommissionMcp.ts'
import { migrateState } from './migrate.ts'
import type { PersistedState } from './persist.ts'
import { hasCorePersistedShape, SLICE_KIND } from './format.ts'
import { parseUsageReservations } from '../usageRegistry.ts'

const ROOT = mkdtempSync(join(tmpdir(), `agent-commons-usage-reservations-${process.pid}-`))
const storeModule = new URL('../store/index.ts', import.meta.url).href
const persistModule = new URL('./persist.ts', import.meta.url).href
const helperModule = new URL('../../scripts/snapshotCommissionMcp.ts', import.meta.url).href
after(() => rmSync(ROOT, { recursive: true, force: true }))

function run(file: string, backend: 'json' | 'sqlite', code: string) {
  return spawnSync(process.execPath, ['--input-type=module', '--eval', code], {
    encoding: 'utf8', timeout: 90_000,
    env: { ...process.env, INITIAL_WORLD: 'demo', BACKEND: 'mock', PERSIST_BACKEND: backend,
      DATA_FILE: file, DATABASE_PATH: file },
  })
}

function fixture(file: string, backend: 'json' | 'sqlite', status: 'active' | 'settled' = 'active') {
  const result = run(file, backend, `
    const { store } = await import(${JSON.stringify(storeModule)});
    const { loadState, saveState, closePersistence } = await import(${JSON.stringify(persistModule)});
    const { addCommissionUsageReservationSnapshotFixture } = await import(${JSON.stringify(helperModule)});
    store.initPersistence();
    saveState(addCommissionUsageReservationSnapshotFixture(loadState(), ${JSON.stringify(status)}));
    closePersistence();
  `)
  assert.equal(result.status, 0, result.stderr)
}

function cleanSnapshot(file: string, backend: 'json' | 'sqlite' = 'json') {
  const result = run(file, backend, `
    const { store } = await import(${JSON.stringify(storeModule)});
    const { closePersistence } = await import(${JSON.stringify(persistModule)});
    store.initPersistence(); closePersistence();
  `)
  assert.equal(result.status, 0, result.stderr)
}

function stateFor(file: string, backend: 'json' | 'sqlite' = 'json'): PersistedState {
  if (backend === 'json') return JSON.parse(readFileSync(file, 'utf8')) as PersistedState
  const result = run(file, backend, `
    const { loadState, closePersistence } = await import(${JSON.stringify(persistModule)});
    console.log(JSON.stringify(loadState())); closePersistence();
  `)
  assert.equal(result.status, 0, result.stderr)
  return JSON.parse(result.stdout) as PersistedState
}

test('usage reservation parser is exact, bounded and duplicate rejecting', () => {
  const row = { id: 'claim-1', tenantId: 'tenant-zeta', allowance: 10, fiveHourStart: 1,
    weeklyStart: 1, status: 'active', report: null }
  assert.deepEqual(parseUsageReservations([row]), [row])
  for (const invalid of [
    [{ ...row, extra: true }], [{ ...row, allowance: 0 }], [{ ...row, status: 'unknown' }],
    [{ ...row, report: { inputTokens: 1, outputTokens: 2, extra: 3 } }], [row, row],
  ]) assert.throws(() => parseUsageReservations(invalid))
  assert.equal(SLICE_KIND.usageReservations, 'array')
})

test('usage reservation slice rejects orphan, tenant-mismatched, closed and effect active holds', () => {
  const baseFile = join(ROOT, 'shape-base')
  fixture(baseFile, 'json')
  const base = stateFor(baseFile)
  const active = structuredClone(base)
  assert.equal(hasCorePersistedShape(active), true)
  const orphan = structuredClone(active)
  orphan.usageReservations![0]!.id = 'orphan'
  assert.equal(hasCorePersistedShape(orphan), false)
  const wrongTenant = structuredClone(active)
  wrongTenant.usageReservations![0]!.tenantId = 'tenant-other'
  assert.equal(hasCorePersistedShape(wrongTenant), false)
  const closed = structuredClone(active)
  const claim = closed.commissionMcp!.claims[0]!
  closed.commissionMcp!.claims[0] = { ...claim, phase: 'closed', status: 'uncertain', finishedAt: claim.startedAt }
  assert.equal(hasCorePersistedShape(closed), false)
  const settledFile = join(ROOT, 'shape-settled')
  fixture(settledFile, 'json', 'settled')
  const effect = stateFor(settledFile)
  effect.usageReservations![0]!.status = 'active'
  effect.usageReservations![0]!.report = null
  assert.equal(hasCorePersistedShape(effect), false)
})

test('current snapshots cannot omit or drop a claim reservation', () => {
  const file = join(ROOT, 'required-reservation')
  fixture(file, 'json')
  const base = stateFor(file)
  assert.equal(hasCorePersistedShape(base), true)

  const omitted = structuredClone(base)
  delete omitted.usageReservations
  assert.equal(hasCorePersistedShape(omitted), false)

  const empty = structuredClone(base)
  empty.usageReservations = []
  assert.equal(hasCorePersistedShape(empty), false)

  const dropped = structuredClone(base)
  dropped.usageReservations!.splice(0, 1)
  assert.equal(hasCorePersistedShape(dropped), false)
})

test('v6 claim snapshots migrate only an absent legacy slice to zero-usage terminal receipts', () => {
  const file = join(ROOT, 'legacy-v6')
  cleanSnapshot(file)
  const v6 = addCommissionMcpSnapshotFixture(stateFor(file))
  v6.version = 6
  delete v6.usageReservations

  const migrated = migrateState(v6)
  assert.ok(migrated)
  assert.equal(migrated.version, 7)
  assert.equal(migrated.usageReservations?.length, migrated.commissionMcp?.claims.length)
  assert.ok(migrated.usageReservations?.every(row => row.status === 'settled' &&
    row.report?.inputTokens === 0 && row.report.outputTokens === 0))
  assert.equal(hasCorePersistedShape(migrated), true)

  // A present but partial legacy slice is not repaired by migration.
  const partial = structuredClone(v6)
  partial.usageReservations = []
  const preserved = migrateState(partial)
  assert.ok(preserved)
  assert.deepEqual(preserved.usageReservations, [])
  assert.equal(hasCorePersistedShape(preserved), false)
})

for (const backend of ['json', 'sqlite'] as const) {
  test(`${backend}: active hold and pending claim recover durably without losing settled usage`, () => {
    const file = join(ROOT, `recover-${backend}`)
    fixture(file, backend)
    const recovered = run(file, backend, `
      const { store } = await import(${JSON.stringify(storeModule)});
      const { loadState, closePersistence } = await import(${JSON.stringify(persistModule)});
      store.initPersistence();
      const state = loadState();
      console.log(JSON.stringify({ claim: state.commissionMcp.claims[0], reservation: state.usageReservations[0] }));
      closePersistence();
    `)
    assert.equal(recovered.status, 0, recovered.stderr)
    const value = JSON.parse(recovered.stdout)
    assert.equal(value.claim.phase, 'closed')
    assert.equal(value.claim.status, 'uncertain')
    assert.equal(value.reservation.status, 'uncertain')

    const settledFile = join(ROOT, `settled-${backend}`)
    fixture(settledFile, backend, 'settled')
    const settled = stateFor(settledFile, backend)
    assert.equal(settled.usageReservations?.[0]?.status, 'settled')
    assert.deepEqual(settled.usageReservations?.[0]?.report, { inputTokens: 23, outputTokens: 9 })

    const deleteFile = join(ROOT, `delete-${backend}`)
    fixture(deleteFile, backend)
    const deleted = run(deleteFile, backend, `
      const { store } = await import(${JSON.stringify(storeModule)});
      const { loadState, closePersistence } = await import(${JSON.stringify(persistModule)});
      store.initPersistence(); store.deleteCommission('commission-mcp-snapshot', 0);
      const state = loadState();
      console.log(JSON.stringify({ commission: state.commissions.some(([id]) => id === 'commission-mcp-snapshot'),
        reservation: state.usageReservations[0] }));
      closePersistence();
    `)
    assert.equal(deleted.status, 0, deleted.stderr)
    const deletion = JSON.parse(deleted.stdout)
    assert.equal(deletion.commission, false)
    assert.equal(deletion.reservation.status, 'uncertain', 'deleting a Commission cannot leave an active capacity hold')
  })

  test(`${backend}: malformed present hold refuses startup without overwriting authored data`, () => {
    const file = join(ROOT, `malformed-${backend}`)
    fixture(file, backend)
    const tamper = run(file, backend, `
      const { loadState, saveState, closePersistence } = await import(${JSON.stringify(persistModule)});
      const state = loadState(); state.usageReservations[0].tenantId = 'tenant-other';
      saveState(state); closePersistence();
    `)
    assert.equal(tamper.status, 0, tamper.stderr)
    const before = readFileSync(file)
    const rejected = run(file, backend, `const { store } = await import(${JSON.stringify(storeModule)}); store.initPersistence();`)
    assert.notEqual(rejected.status, 0)
    assert.match(rejected.stderr, /Refusing to replace existing data/)
    assert.deepEqual(readFileSync(file), before)

    for (const mode of ['omit', 'drop'] as const) {
      const missing = join(ROOT, `missing-${mode}-${backend}`)
      fixture(missing, backend)
      const damage = run(missing, backend, `
        const { loadState, saveState, closePersistence } = await import(${JSON.stringify(persistModule)});
        const state = loadState();
        ${mode === 'omit' ? 'delete state.usageReservations;' : 'state.usageReservations.splice(0, 1);'}
        saveState(state); closePersistence();
      `)
      assert.equal(damage.status, 0, damage.stderr)
      const missingBefore = readFileSync(missing)
      const refused = run(missing, backend, `const { store } = await import(${JSON.stringify(storeModule)}); store.initPersistence();`)
      assert.notEqual(refused.status, 0)
      assert.match(refused.stderr, /Refusing to replace existing data/)
      assert.deepEqual(readFileSync(missing), missingBefore)
    }
  })
}
