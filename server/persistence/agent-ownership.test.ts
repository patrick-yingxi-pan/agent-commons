import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { test, after } from 'node:test'
import { ROOT } from '../../tests/helpers/source.ts'

const root = mkdtempSync(join(tmpdir(), 'ac-agent-ownership-'))
after(() => rmSync(root, { recursive: true, force: true }))
const href = (name: string) => JSON.stringify(new URL(name, import.meta.url).href)
function run(file: string, backend: 'json' | 'sqlite', source: string) {
  return spawnSync(process.execPath, ['--input-type=module', '--eval', source], {
    cwd: ROOT, encoding: 'utf8', timeout: 20_000,
    env: { ...process.env, BACKEND: 'mock', INITIAL_WORLD: 'clean', PERSIST_BACKEND: backend,
      DATA_FILE: file, DATABASE_PATH: file, IDENTITY_HEADERS: 'deny', AUTH_GATE: 'off',
      AUTH_SECRET: 'agent-ownership-disposable-test-signing-secret' },
  })
}
function boot(file: string, backend: 'json' | 'sqlite', action: string) {
  return run(file, backend, `
    import { store } from ${href('../store/index.ts')}
    import { accounts } from ${href('../accounts.ts')}
    import { loadState, closePersistence } from ${href('./persist.ts')}
    import { agentCreationId } from ${href('../agentCreationIdentity.ts')}
    store.initPersistence()
    ${action}
    closePersistence()
  `)
}
function result(value: ReturnType<typeof run>) {
  assert.equal(value.status, 0, value.stderr || value.stdout)
  return JSON.parse(value.stdout.trim())
}
const create = `
  const who = store.identity({})
  const id = agentCreationId(who.tenant.id, 'private-owner')
  const agent = store.createAgent({ label: 'Private provenance', systemPrompt: 'x', tools: [], instructions: '' },
    who.tenant.id, { logicalId: id, ownerUserId: who.user.id })
`

for (const backend of ['json', 'sqlite'] as const) {
  test(`${backend}: private live and retired Agent provenance survives real process restarts and portable export`, () => {
    const file = join(root, `roundtrip-${backend}`)
    const first = result(boot(file, backend, `${create}
      console.log(JSON.stringify({ id, provenance: store.agentProvenance(id), saved: loadState().agentOwnership,
        agent, seedBound: store.agentProvenance(store.getAgent().id) ?? null }))
    `))
    assert.deepEqual(first.provenance, { agentId: first.id, tenantId: 'tenant-personal', ownerUserId: 'user-local' })
    assert.deepEqual(first.saved, [first.provenance])
    assert.equal(first.seedBound, null)
    assert.equal(Object.hasOwn(first.agent, 'ownerUserId'), false)
    const idLiteral = JSON.stringify(first.id)
    const second = result(boot(file, backend, `
      const id = ${idLiteral}
      const owner = store.agentProvenance(id)
      store.updateAgentFromRequest(id, { instructions: 'Edited configuration.' }, 0)
      const replay = store.createAgent({label:'must not overwrite',systemPrompt:'x',tools:[],instructions:''},
        owner.tenantId, {logicalId:id, ownerUserId:'not-the-creator'})
      console.log(JSON.stringify({ owner, replay, saved: loadState().agentOwnership }))
    `))
    assert.deepEqual(second.owner, first.provenance)
    assert.deepEqual(second.saved, first.saved)
    assert.equal(second.replay.instructions, 'Edited configuration.')
    const portable = join(root, `portable-${backend}.json`)
    const exported = result(boot(file, backend, `
      const { writePortableSnapshot, readPortableSnapshot } = await import(${href('./portable.ts')})
      writePortableSnapshot(${JSON.stringify(portable)}, loadState())
      console.log(JSON.stringify(readPortableSnapshot(${JSON.stringify(portable)}).agentOwnership))
    `))
    assert.deepEqual(exported, first.saved)
    result(boot(file, backend, `store.deleteAgent(${idLiteral}, 1); console.log(JSON.stringify(loadState().agentOwnership))`))
    const retired = result(boot(file, backend, `
      const provenance = store.agentProvenance(${idLiteral})
      let refused = false
      try { store.createAgent({label:'resurrect',systemPrompt:'x',tools:[],instructions:''}, provenance.tenantId,
        {logicalId:${idLiteral},ownerUserId:provenance.ownerUserId}) } catch { refused = true }
      console.log(JSON.stringify({provenance,refused,live:store.listAgents().some(row=>row.id===${idLiteral})}))
    `))
    assert.deepEqual(retired, { provenance: { ...first.provenance, retired: true }, refused: true, live: false })
  })

  test(`${backend}: legacy absence stays unbound; malformed present joins fail without replacing stored state`, () => {
    const file = join(root, `admission-${backend}`)
    const baseline = result(boot(file, backend, `${create}; console.log(JSON.stringify(loadState()))`))
    const mutate = (action: string) => run(file, backend, `
      import { JsonFileBackend } from ${href('./json.ts')}
      import { SqliteBackend } from ${href('./sqlite.ts')}
      const storage = ${JSON.stringify(backend)} === 'json' ? new JsonFileBackend() : new SqliteBackend(${JSON.stringify(file)})
      const state = ${JSON.stringify(baseline)}
      ${action}
      storage.save(state)
      storage.close()
      console.log(JSON.stringify(state.agentOwnership ?? null))
    `)
    result(mutate('delete state.agentOwnership'))
    assert.equal(result(boot(file, backend, `console.log(JSON.stringify(store.agentProvenance(${JSON.stringify(baseline.agentOwnership[0].agentId)}) ?? null))`)), null)
    for (const action of [
      'state.agentOwnership = [null]',
      'state.agentOwnership.push({...state.agentOwnership[0]})',
      'state.agentOwnership[0].ownerUserId = "missing-person"',
      'state.agentOwnership[0].tenantId = "missing-tenant"',
      'state.agentOwnership[0].retired = true',
      'state.agentOwnership[0].extra = "not admitted"',
      'state.agents = state.agents.filter(([id]) => id !== state.agentOwnership[0].agentId)',
    ]) {
      result(mutate(action))
      const before = result(run(file, backend, `
        import { createHash } from 'node:crypto'
        import { readFileSync } from 'node:fs'
        console.log(JSON.stringify(createHash('sha256').update(readFileSync(${JSON.stringify(file)})).digest('hex')))
      `))
      const refused = boot(file, backend, '')
      assert.notEqual(refused.status, 0, action)
      assert.match(refused.stderr, /unreadable or incompatible|missing required core slices/, action)
      const after = result(run(file, backend, `
        import { createHash } from 'node:crypto'
        import { readFileSync } from 'node:fs'
        console.log(JSON.stringify(createHash('sha256').update(readFileSync(${JSON.stringify(file)})).digest('hex')))
      `))
      assert.equal(after, before, 'refused startup cannot seed or replace the main store')
    }
  })
}

test('failed Agent creation commit emits no acknowledgement/event and retains prior durable provenance', () => {
  const file = join(root, 'failed-commit.json')
  const blocked = join(root, 'blocked')
  const observed = result(boot(file, 'json', `
    import { mkdirSync } from 'node:fs'
    const before = loadState()
    mkdirSync(${JSON.stringify(blocked)})
    process.env.DATA_FILE = ${JSON.stringify(blocked)}
    const events = []
    const stop = store.subscribe(event => { if (event.type === 'agent.changed') events.push(event) })
    let refused = false
    try { ${create} } catch { refused = true }
    process.env.DATA_FILE = ${JSON.stringify(file)}
    stop()
    console.log(JSON.stringify({refused,healthy:store.persistenceHealthy(),events,
      unchanged:JSON.stringify(loadState().agentOwnership)===JSON.stringify(before.agentOwnership)}))
  `))
  assert.deepEqual(observed, { refused: true, healthy: false, events: [], unchanged: true })
})
