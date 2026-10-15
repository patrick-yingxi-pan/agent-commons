import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync, mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { after, test } from 'node:test'
import { ROOT } from '../../tests/helpers/source.ts'

const root = mkdtempSync(join(tmpdir(), 'ac-agent-requests-'))
after(() => rmSync(root, { recursive: true, force: true }))
const href = (name: string) => JSON.stringify(new URL(name, import.meta.url).href)

function run(file: string, backend: 'json' | 'sqlite', source: string) {
  return spawnSync(process.execPath, ['--input-type=module', '--eval', source], {
    cwd: ROOT, encoding: 'utf8', timeout: 20_000,
    env: { ...process.env, BACKEND: 'mock', INITIAL_WORLD: 'demo', PERSIST_BACKEND: backend,
      DATA_FILE: file, DATABASE_PATH: file, IDENTITY_HEADERS: 'deny', AUTH_GATE: 'off',
      AUTH_SECRET: 'agent-requests-disposable-test-signing-secret' },
  })
}
function boot(file: string, backend: 'json' | 'sqlite', action: string) {
  return run(file, backend, `
    import { store } from ${href('../store/index.ts')}
    import { loadState, closePersistence } from ${href('./persist.ts')}
    store.initPersistence()
    ${action}
    closePersistence()
  `)
}
function result(value: ReturnType<typeof run>) {
  assert.equal(value.status, 0, value.stderr || value.stdout)
  return JSON.parse(value.stdout.trim())
}
function digest(file: string, backend: 'json' | 'sqlite') {
  const bytes = readFileSync(file)
  return createHash('sha256').update(bytes).digest('hex')
}
const create = `
  const { agentCreationId } = await import(${href('../agentCreationIdentity.ts')})
  const sourceId = agentCreationId('tenant-acme', 'agent-request-persist-source')
  const targetId = agentCreationId('tenant-beta', 'agent-request-persist-target')
  store.createAgent({ label: 'Private source', systemPrompt: 'Test.', tools: [], instructions: '' },
    'tenant-acme', { logicalId: sourceId, ownerUserId: 'user-ada' })
  store.createAgent({ label: 'Published receiver', systemPrompt: 'Test.', tools: [], instructions: '', published: true },
    'tenant-beta', { logicalId: targetId, ownerUserId: 'user-grace' })
  const actor = { tenantId: 'tenant-acme', userId: 'user-ada' }
  const request = store.createAgentRequest(actor, 'durable-private-history', {
    fromAgentId: sourceId, toAgentId: targetId, task: 'A private task that survives restart.' })
`

for (const backend of ['json', 'sqlite'] as const) {
  test(`${backend}: Agent request history survives restart and exact keyed replay without losing its private joins`, () => {
    const file = join(root, `roundtrip-${backend}${backend === 'json' ? '.json' : '.sqlite'}`)
    const first = result(boot(file, backend, `${create}
      console.log(JSON.stringify({ request, rows: loadState().agentRequests }))
    `))
    assert.equal(first.request.status, 'waiting')
    assert.equal(first.rows.length, 1)
    assert.equal(JSON.stringify(first.rows).includes('A private task'), true,
      'the strict private slice owns history, independently of public event payloads')
    const id = JSON.stringify(first.request.id)
    const second = result(boot(file, backend, `
      const { agentCreationId } = await import(${href('../agentCreationIdentity.ts')})
      const actor = { tenantId: 'tenant-acme', userId: 'user-ada' }
      const replay = store.createAgentRequest(actor, 'durable-private-history', {
        fromAgentId: agentCreationId('tenant-acme', 'agent-request-persist-source'),
        toAgentId: agentCreationId('tenant-beta', 'agent-request-persist-target'),
        task: 'A private task that survives restart.' })
      const other = store.agentRequest(${id}, { tenantId: 'tenant-beta', userId: 'user-grace' })
      console.log(JSON.stringify({ replay, other, rows: loadState().agentRequests }))
    `))
    assert.deepEqual(second.replay, first.request)
    assert.equal(second.other?.role, 'owner')
    assert.equal(second.rows.length, 1, 'replay cannot append a duplicate durable row')
    result(boot(file, backend, `
      const row = loadState().agentRequests[0]
      store.deleteAgent(row.intent.requester.agentId, 0)
      store.deleteAgent(row.intent.owner.agentId, 0)
      console.log(JSON.stringify(loadState().agentOwnership))
    `))
    const afterRemoval = result(boot(file, backend, `
      const view = store.agentRequest(${id}, { tenantId: 'tenant-acme', userId: 'user-ada' })
      console.log(JSON.stringify({ view, joins: loadState().agentOwnership }))
    `))
    assert.equal(afterRemoval.view?.id, first.request.id)
    assert.equal(afterRemoval.view?.fromAgentAvailable, false)
    assert.equal(afterRemoval.view?.toAgentAvailable, false)
    assert.equal(afterRemoval.joins.filter(row => row.retired).length, 2)
  })

  test(`${backend}: missing exact ownership join refuses startup and preserves the existing store bytes`, () => {
    const file = join(root, `join-${backend}${backend === 'json' ? '.json' : '.sqlite'}`)
    const baseline = result(boot(file, backend, `${create}; console.log(JSON.stringify(loadState()))`))
    const corrupted = run(file, backend, `
      import { JsonFileBackend } from ${href('./json.ts')}
      import { SqliteBackend } from ${href('./sqlite.ts')}
      const storage = ${JSON.stringify(backend)} === 'json' ? new JsonFileBackend() : new SqliteBackend(${JSON.stringify(file)})
      const state = ${JSON.stringify(baseline)}
      const sourceId = state.agentRequests[0].intent.requester.agentId
      state.agentOwnership = state.agentOwnership.filter(row => row.agentId !== sourceId)
      storage.save(state)
      storage.close()
      console.log('corrupted')
    `)
    assert.equal(corrupted.status, 0, corrupted.stderr || corrupted.stdout)
    const before = digest(file, backend)
    const refused = boot(file, backend, '')
    assert.notEqual(refused.status, 0)
    assert.match(refused.stderr, /unreadable or incompatible|missing required core slices/)
    assert.equal(digest(file, backend), before, 'failed admission cannot seed or replace the stored bytes')

    const legacyFile = join(root, `legacy-${backend}${backend === 'json' ? '.json' : '.sqlite'}`)
    const legacy = run(legacyFile, backend, `
      import { JsonFileBackend } from ${href('./json.ts')}
      import { SqliteBackend } from ${href('./sqlite.ts')}
      const storage = ${JSON.stringify(backend)} === 'json' ? new JsonFileBackend() : new SqliteBackend(${JSON.stringify(legacyFile)})
      const state = ${JSON.stringify(baseline)}
      delete state.agentRequests
      storage.save(state)
      storage.close()
      console.log('legacy')
    `)
    assert.equal(legacy.status, 0, legacy.stderr || legacy.stdout)
    const admitted = result(boot(legacyFile, backend, `console.log(JSON.stringify(store.agentRequests({ tenantId: 'tenant-acme', userId: 'user-ada' })))`))
    assert.deepEqual(admitted, [], 'an absent additive request-history slice is a valid old snapshot')
  })
}

test('failed Agent request commit publishes no private invalidation and returns no acknowledgement', () => {
  const file = join(root, 'failed-commit.json')
  const blocked = join(root, 'blocked')
  const observed = result(boot(file, 'json', `
    import { mkdirSync } from 'node:fs'
    ${create}
    const events = []
    const stop = store.subscribe(event => { if (event.type === 'agent-request.changed') events.push(event) })
    mkdirSync(${JSON.stringify(blocked)})
    process.env.DATA_FILE = ${JSON.stringify(blocked)}
    let refused = false
    try { store.createAgentRequest(actor, 'failed-durable-request', {
      fromAgentId: sourceId, toAgentId: targetId, task: 'Must not be acknowledged.' }) } catch { refused = true }
    process.env.DATA_FILE = ${JSON.stringify(file)}
    stop()
    console.log(JSON.stringify({ refused, healthy: store.persistenceHealthy(), events,
      count: loadState().agentRequests.length }))
  `))
  assert.deepEqual(observed, { refused: true, healthy: false, events: [], count: 1 })
})
