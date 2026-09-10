import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { test } from 'node:test'
import { ROOT } from '../../tests/helpers/source.ts'

const root = mkdtempSync(join(tmpdir(), 'agent-commons-model-preferences-'))
process.on('exit', () => rmSync(root, { recursive: true, force: true }))

function boot(file: string, backend: 'json' | 'sqlite', action: string) {
  const source = `
    import { store } from ${JSON.stringify(new URL('../store/index.ts', import.meta.url).href)}
    store.initPersistence()
    ${action}
  `
  return spawnSync(process.execPath, ['--input-type=module', '--eval', source], {
    cwd: ROOT, encoding: 'utf8', timeout: 20_000,
    env: {
      ...process.env,
      INITIAL_WORLD: 'clean', BACKEND: 'mock', PERSIST_BACKEND: backend,
      DATA_FILE: file, DATABASE_PATH: file,
    },
  })
}

function json(result: ReturnType<typeof boot>) {
  assert.equal(result.status, 0, result.stderr || result.stdout)
  return JSON.parse(result.stdout.trim())
}

function corrupt(file: string, backend: 'json' | 'sqlite') {
  const source = `
    import { JsonFileBackend } from ${JSON.stringify(new URL('./json.ts', import.meta.url).href)}
    import { SqliteBackend } from ${JSON.stringify(new URL('./sqlite.ts', import.meta.url).href)}
    const storage = ${JSON.stringify(backend)} === 'json' ? new JsonFileBackend() : new SqliteBackend(${JSON.stringify(file)})
    const state = storage.load()
    state.modelPreferences = [['tenant-a', [['user-a', { revision: 0, preferences: { ultracode: false, fast: false } }]]]]
    storage.save(state)
    storage.close()
  `
  return spawnSync(process.execPath, ['--input-type=module', '--eval', source], {
    cwd: ROOT, encoding: 'utf8', timeout: 20_000,
    env: { ...process.env, PERSIST_BACKEND: backend, DATA_FILE: file, DATABASE_PATH: file },
  })
}

for (const backend of ['json', 'sqlite'] as const) {
  test(`${backend}: exact tenant and user model preferences survive a process restart`, () => {
    const file = join(root, `restart-${backend}`)
    const first = json(boot(file, backend, `
      store.setModelPreferences('tenant-a', 'user-a', 'tenant-a', 'user-a', 0,
        { providerId: 'provider-stale', modelId: 'model-stale', effort: 'Custom', ultracode: true, fast: false })
      store.setModelPreferences('tenant-a', 'user-b', 'tenant-a', 'user-b', 0,
        { effort: 'Low', ultracode: false, fast: true })
      store.setModelPreferences('tenant-b', 'user-a', 'tenant-b', 'user-a', 0,
        { effort: 'High', ultracode: false, fast: true })
      console.log(JSON.stringify([
        store.modelPreferences('tenant-a', 'user-a'),
        store.modelPreferences('tenant-a', 'user-b'),
        store.modelPreferences('tenant-b', 'user-a'),
      ]))
    `))
    const second = json(boot(file, backend, `
      console.log(JSON.stringify([
        store.modelPreferences('tenant-a', 'user-a'),
        store.modelPreferences('tenant-a', 'user-b'),
        store.modelPreferences('tenant-b', 'user-a'),
        store.modelPreferences('tenant-missing', 'user-a'),
      ]))
    `))
    assert.deepEqual(second.slice(0, 3), first)
    assert.deepEqual(second[3], {
      tenantId: 'tenant-missing', userId: 'user-a', revision: 0,
      preferences: { effort: 'High', ultracode: false, fast: false },
    })
  })

  test(`${backend}: malformed present model preferences refuse restart`, () => {
    const file = join(root, `malformed-${backend}`)
    assert.equal(boot(file, backend, '').status, 0)
    const changed = corrupt(file, backend)
    assert.equal(changed.status, 0, changed.stderr || changed.stdout)
    const refused = boot(file, backend, '')
    assert.notEqual(refused.status, 0)
    assert.match(refused.stderr, /unreadable or incompatible|missing required core slices/)
  })
}
