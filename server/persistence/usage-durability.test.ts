/** Fresh processes and actual backend files: no in-memory meter can stand in
 * for restart evidence. Every path belongs to this isolated test directory. */
import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { SqliteBackend } from './sqlite.ts'
import { hasCorePersistedShape } from './format.ts'
import { readPortableSnapshot, restoreBackendSnapshot } from './portable.ts'

const directory = mkdtempSync(join(tmpdir(), 'agent-commons-usage-durability-'))
const storeModule = new URL('../store/index.ts', import.meta.url).href
const persistenceModule = new URL('./persist.ts', import.meta.url).href
const generationModule = new URL('../generate.ts', import.meta.url).href
const start = 1_800_000_000_000
const hour = 3_600_000
after(() => rmSync(directory, { recursive: true, force: true }))

function boot(file: string, backend: 'json' | 'sqlite', at: number, work = '', world = 'clean') {
  const script = `
    Date.now = () => ${at};
    const { store } = await import(${JSON.stringify(storeModule)});
    const { loadState, closePersistence } = await import(${JSON.stringify(persistenceModule)});
    store.initPersistence();
    ${work}
    console.log(JSON.stringify({
      saved: loadState(),
      defaultLimits: store.usage().limits,
      alpha: store.overSpendLimit(undefined, 'tenant-alpha'),
      beta: store.overSpendLimit(undefined, 'tenant-beta'),
      fresh: store.usage(undefined, 'tenant-fresh').limits,
    }));
    closePersistence();
  `
  return spawnSync(process.execPath, ['--input-type=module', '--eval', script], {
    encoding: 'utf8', timeout: 20_000,
    env: { ...process.env, INITIAL_WORLD: world, BACKEND: 'mock', PERSIST_BACKEND: backend, DATA_FILE: file, DATABASE_PATH: file },
  })
}

function success(result: ReturnType<typeof boot>) {
  assert.equal(result.status, 0, result.stderr)
  return JSON.parse(result.stdout)
}

for (const backend of ['json', 'sqlite'] as const) {
  test(`${backend}: a completed summary call remains metered after a later provider failure and restart`, () => {
    const file = join(directory, `interrupted-model-${backend}`)
    const first = success(boot(file, backend, start, `
      const { createServer } = await import('node:http');
      const { generateCompactionSummaryPart } = await import(${JSON.stringify(generationModule)});
      let requests = 0;
      const endpoint = createServer(async (req, res) => {
        for await (const chunk of req) {}
        requests += 1;
        res.writeHead(requests === 1 ? 200 : 400, { 'content-type': 'application/json' });
        res.end(JSON.stringify(requests === 1 ? {
          id: 'completed-part', type: 'message', role: 'assistant', model: 'fixture',
          content: [{ type: 'text', text: 'A complete first summary part.' }],
          stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 101, output_tokens: 23 }
        } : { type: 'error', error: { type: 'invalid_request_error', message: 'fixture refusal' } }));
      });
      await new Promise(resolve => endpoint.listen(0, '127.0.0.1', resolve));
      const provider = { baseURL: 'http://127.0.0.1:' + endpoint.address().port };
      const onUsage = usage => store.recordUsage(usage.inputTokens, usage.outputTokens, 'tenant-alpha');
      try {
        await generateCompactionSummaryPart('first', provider, undefined, onUsage);
        const afterFirst = loadState().usageMeters.find(([id]) => id === 'tenant-alpha');
        if (afterFirst?.[1].fiveHour.consumed !== 124) throw new Error('Completed call was not durable before continuation');
        let refused = false;
        try { await generateCompactionSummaryPart('second', provider, undefined, onUsage); }
        catch (error) { refused = error.name === 'CompactionGenerationError'; }
        if (!refused || requests !== 2) throw new Error('Expected one later provider refusal');
      } finally {
        endpoint.closeAllConnections();
        await new Promise(resolve => endpoint.close(resolve));
      }
    `))
    const meter = first.saved.usageMeters.find(([id]) => id === 'tenant-alpha')?.[1]
    assert.deepEqual(meter, { fiveHour: { start, consumed: 124 }, weekly: { start, consumed: 124 } })
    const restarted = success(boot(file, backend, start + hour))
    assert.deepEqual(restarted.saved.usageMeters, first.saved.usageMeters)
  })

  test(`${backend}: exact tenant spend and original window anchors survive full restarts`, () => {
    const file = join(directory, `restart-${backend}`)
    const first = success(boot(file, backend, start, `
      store.recordUsage(2_400_000, 0, 'tenant-alpha');
      store.recordUsage(24_000_000, 0, 'tenant-beta');
    `))
    const meter = (state, tenant) => {
      const entry = state.saved.usageMeters?.find(([id]) => id === tenant)
      assert.ok(entry, `The ${backend} snapshot must contain recorded usage for ${tenant}.`)
      return entry[1]
    }
    assert.equal(first.defaultLimits[0].pct, 0, 'clean first boot has no fictional spend')
    assert.equal(meter(first, 'tenant-alpha').fiveHour.consumed, 2_400_000)
    assert.equal(meter(first, 'tenant-beta').weekly.consumed, 24_000_000)
    const second = success(boot(file, backend, start + hour))
    assert.deepEqual(second.saved.usageMeters, first.saved.usageMeters)
    assert.equal(second.alpha.label, '5-hour limit')
    assert.equal(second.beta.label, '5-hour limit')
    assert.equal(second.fresh[0].pct, 0, 'another tenant cannot inherit recorded spend')
    const rolled = success(boot(file, backend, start + 5 * hour + 1, `store.recordUsage(10, 20, 'tenant-alpha');`))
    assert.equal(rolled.alpha, null)
    assert.equal(rolled.beta.label, 'Weekly · all models')
    assert.deepEqual(meter(rolled, 'tenant-alpha'), {
      fiveHour: { start: start + 5 * hour, consumed: 30 },
      weekly: { start, consumed: 2_400_030 },
    })
    const expired = success(boot(file, backend, start + 7 * 24 * hour, `store.recordUsage(1, 0, 'tenant-alpha');`))
    assert.equal(expired.beta, null)
    assert.equal(meter(expired, 'tenant-beta').weekly.consumed, 0)
    assert.equal(meter(expired, 'tenant-alpha').weekly.consumed, 1)
  })
}

test('store gauge and gate reads do not become durable tenant rows on the next write', () => {
  const file = join(directory, 'reads.json')
  const state = success(boot(file, 'json', start, `
    for (let index = 0; index < 2_000; index++) {
      store.usage(undefined, 'read-only-' + index);
      store.overSpendLimit(undefined, 'read-only-' + index);
    }
    store.recordUsage(1, 0, 'tenant-real');
  `))
  assert.deepEqual(state.saved.usageMeters.map(([id]) => id), ['tenant-real'])
})

test('rejected first-turn usage cannot leave a durable empty tenant behind', () => {
  const file = join(directory, 'invalid-first-turn.json')
  const state = success(boot(file, 'json', start, `
    for (const [input, output] of [[-1, 0], [Number.MAX_SAFE_INTEGER, 1]]) {
      let refused = false;
      try { store.recordUsage(input, output, 'invalid-tenant'); } catch { refused = true; }
      if (!refused) throw new Error('Invalid usage was accepted');
    }
    store.recordUsage(1, 0, 'tenant-real');
  `))
  assert.deepEqual(state.saved.usageMeters.map(([id]) => id), ['tenant-real'])
})

test('older snapshots acquire a world-appropriate usage baseline once, before another restart', () => {
  for (const world of ['clean', 'demo']) {
    const file = join(directory, `legacy-${world}.json`)
    const initial = success(boot(file, 'json', start, '', world)).saved
    delete initial.usageMeters
    writeFileSync(file, JSON.stringify(initial))
    const migrated = success(boot(file, 'json', start + 1, '', world))
    assert.equal(migrated.defaultLimits[0].pct, world === 'demo' ? 71 : 0)
    assert.ok(migrated.saved.usageMeters.length > 0, 'the additive baseline is actually persisted')
    const restarted = success(boot(file, 'json', start + hour, '', world))
    assert.deepEqual(restarted.saved.usageMeters, migrated.saved.usageMeters, 'no re-seeding or reset-anchor drift')
  }
})

test('invalid usage refuses JSON startup and canonical import without replacing recovery bytes', () => {
  const file = join(directory, 'invalid.json')
  const baseline = success(boot(file, 'json', start)).saved
  const valid = { fiveHour: { start, consumed: 1 }, weekly: { start, consumed: 2 } }
  for (const usageMeters of [
    null, {}, [['tenant-a', valid], ['tenant-a', valid]], [[' ', valid]],
    [['tenant-a', { ...valid, weekly: { start, consumed: -1 } }]],
    [['tenant-a', { ...valid, fiveHour: { start: Number.MAX_SAFE_INTEGER, consumed: 1 } }]],
    [['tenant-a', { ...valid, fiveHour: { start, consumed: 1, ceiling: 999 } }]],
  ]) {
    const candidate = { ...baseline, usageMeters }
    assert.equal(hasCorePersistedShape(candidate), false)
    const raw = JSON.stringify(candidate)
    writeFileSync(file, raw)
    assert.throws(() => readPortableSnapshot(file), /unsupported or invalid store version/)
    const result = boot(file, 'json', start)
    assert.notEqual(result.status, 0, 'malformed durable usage cannot silently become a fresh meter')
    assert.match(result.stderr, /unreadable or incompatible/)
    assert.equal(readFileSync(file, 'utf8'), raw)
  }
})

test('canonical usage survives JSON to SQLite transfer and explicit restore replaces later spend', () => {
  const file = join(directory, 'portable-source.json')
  const sqliteFile = join(directory, 'portable-destination.db')
  const original = success(boot(file, 'json', start, `store.recordUsage(80_000, 20_000, 'tenant-alpha');`)).saved
  const database = new SqliteBackend(sqliteFile)
  try { restoreBackendSnapshot(database, file) } finally { database.close() }
  const restored = success(boot(sqliteFile, 'sqlite', start + hour))
  assert.deepEqual(restored.saved.usageMeters, original.usageMeters)
  success(boot(sqliteFile, 'sqlite', start + hour, `store.recordUsage(2_400_000, 0, 'tenant-alpha');`))
  const restore = new SqliteBackend(sqliteFile)
  try { restoreBackendSnapshot(restore, file) } finally { restore.close() }
  assert.equal(success(boot(sqliteFile, 'sqlite', start + hour)).alpha, null, 'an explicit data restore restores its counters too; this is not a billing ledger')
})

test('a usage commit failure latches unready and cannot overwrite the last durable counters', () => {
  const file = join(directory, 'commit-failure.json')
  const baseline = success(boot(file, 'json', start, `store.recordUsage(100, 20, 'tenant-alpha');`)).saved
  const result = boot(file, 'json', start + 1, `
    const { mkdirSync } = await import('node:fs');
    const blocked = ${JSON.stringify(join(directory, 'blocked-usage-path'))};
    mkdirSync(blocked);
    process.env.DATA_FILE = blocked;
    let refused = false;
    try { store.recordUsage(300, 40, 'tenant-alpha'); } catch { refused = true; }
    if (!refused || store.persistenceHealthy()) throw new Error('Usage acknowledged a failed durable commit');
    process.env.DATA_FILE = ${JSON.stringify(file)};
    try { store.recordUsage(1, 0, 'tenant-alpha'); throw new Error('A faulted meter resumed writing'); }
    catch (error) { if (error.message === 'A faulted meter resumed writing') throw error; }
  `)
  success(result)
  assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')).usageMeters, baseline.usageMeters)
})
