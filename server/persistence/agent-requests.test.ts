import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync, mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { after, test } from 'node:test'
import { ROOT } from '../../tests/helpers/source.ts'
import { hasCorePersistedShape } from './format.ts'
import { settleProxyArgumentDraft } from '../proxyRequestState.ts'
import { proxyArgumentReservationId } from '../proxyArgumentDraftState.ts'
import { beginProxyReplyDraft, settleProxyReplyDraft } from '../proxyRequestState.ts'
import { proxyReplyReservationId } from '../proxyReplyDraftState.ts'

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

  test(`${backend}: private argument-draft receipt and exact usage reservation survive restart; pending becomes uncertain`, () => {
    const file = join(root, `argument-draft-${backend}${backend === 'json' ? '.json' : '.sqlite'}`)
    const initial = result(boot(file, backend, `${create}
      const { JsonFileBackend } = await import(${href('./json.ts')})
      const { SqliteBackend } = await import(${href('./sqlite.ts')})
      const { beginProxyArgumentDraft } = await import(${href('../proxyRequestState.ts')})
      const { proxyArgumentReservationId } = await import(${href('../proxyArgumentDraftState.ts')})
      store.createMcpConnection({ id: 'mcp-connection-${'c'.repeat(32)}', label: 'Retired historical endpoint',
        endpoint: 'https://mcp.example.invalid', authentication: 'none' }, 'tenant-beta', false, 'user-grace')
      const state = loadState()
      const row = state.agentRequests[0]
      const binding = { agentRevision: 0, providerId: 'provider-retired', providerRevision: 0,
        providerConnectionRevision: 0, model: 'model-retired', connectionId: 'mcp-connection-${'c'.repeat(32)}',
        connectionRevision: 0, toolName: 'historical_tool', schemaHash: '${'a'.repeat(64)}', transport: 'http' }
      const pending = beginProxyArgumentDraft(row, { tenantId: 'tenant-beta', userId: 'user-grace' }, 1,
        binding, '${'b'.repeat(64)}', Date.now())
      state.agentRequests[0] = pending
      state.usageReservations.push({ id: proxyArgumentReservationId(row.intent.id), tenantId: 'tenant-beta', allowance: 1000,
        fiveHourStart: 0, weeklyStart: 0, status: 'active', report: null })
      const storage = ${JSON.stringify(backend)} === 'json' ? new JsonFileBackend() : new SqliteBackend(${JSON.stringify(file)})
      storage.save(state); storage.close()
      console.log(JSON.stringify({ id: row.intent.id, state }))
    `))
    assert.equal(hasCorePersistedShape(initial.state), true)
    const reservationId = proxyArgumentReservationId(initial.id)
    const malformedStates = [
      { ...structuredClone(initial.state), usageReservations: [] },
      { ...structuredClone(initial.state), usageReservations: initial.state.usageReservations.map((item: any) =>
        item.id === reservationId ? { ...item, tenantId: 'tenant-acme' } : item) },
      { ...structuredClone(initial.state), usageReservations: initial.state.usageReservations.map((item: any) =>
        item.id === reservationId ? { ...item, id: `${reservationId}:orphan` } : item) },
    ]
    const completedDraftState = structuredClone(initial.state)
    completedDraftState.agentRequests[0] = settleProxyArgumentDraft(completedDraftState.agentRequests[0], 'b'.repeat(64),
      { status: 'done', arguments: { private: 'completed' } }, Date.now() + 1)
    malformedStates.push(completedDraftState)
    for (const invalid of malformedStates) assert.equal(hasCorePersistedShape(invalid), false,
      'draft reservation must join one exact owner request in the matching lifecycle state')
    const meteredPending = structuredClone(initial.state)
    meteredPending.usageReservations[0] = { ...meteredPending.usageReservations[0], status: 'settled',
      report: { inputTokens: 7, outputTokens: 4 } }
    assert.equal(hasCorePersistedShape(meteredPending), true,
      'usage may be durable before a pending response is validated and its private receipt settles')
    const id = JSON.stringify(initial.id)
    const recovered = result(boot(file, backend, `
      const state = loadState()
      console.log(JSON.stringify({ row: state.agentRequests[0], reservation: state.usageReservations.find(item => item.id === ${JSON.stringify(initial.id)} + ':arguments'),
        requester: store.agentRequest(${id}, { tenantId: 'tenant-acme', userId: 'user-ada' }),
        owner: store.agentRequest(${id}, { tenantId: 'tenant-beta', userId: 'user-grace' }) }))
    `))
    assert.equal(recovered.row.argumentDraft.status, 'uncertain')
    assert.equal(recovered.row.revision, 3)
    assert.equal(recovered.reservation.status, 'uncertain')
    assert.equal(recovered.reservation.report, null)
    assert.equal(Object.hasOwn(recovered.requester, 'argumentDraft'), false)
    assert.equal(recovered.owner.argumentDraft.status, 'uncertain')

    const terminalFile = join(root, `argument-draft-done-${backend}${backend === 'json' ? '.json' : '.sqlite'}`)
    const completed = result(boot(terminalFile, backend, `${create}
      const { JsonFileBackend } = await import(${href('./json.ts')})
      const { SqliteBackend } = await import(${href('./sqlite.ts')})
      const { beginProxyArgumentDraft, settleProxyArgumentDraft } = await import(${href('../proxyRequestState.ts')})
      const { proxyArgumentReservationId } = await import(${href('../proxyArgumentDraftState.ts')})
      store.createMcpConnection({ id: 'mcp-connection-${'d'.repeat(32)}', label: 'Known historical endpoint',
        endpoint: 'https://mcp.example.invalid', authentication: 'none' }, 'tenant-beta', false, 'user-grace')
      const state = loadState(), row = state.agentRequests[0]
      const binding = { agentRevision: 0, providerId: 'provider-removed', providerRevision: 0, providerConnectionRevision: 0,
        model: 'known-model', connectionId: 'mcp-connection-${'d'.repeat(32)}', connectionRevision: 0,
        toolName: 'historical_tool', schemaHash: '${'d'.repeat(64)}', transport: 'http' }
      const pending = beginProxyArgumentDraft(row, { tenantId: 'tenant-beta', userId: 'user-grace' }, 1,
        binding, '${'e'.repeat(64)}', Date.now())
      state.agentRequests[0] = settleProxyArgumentDraft(pending, '${'e'.repeat(64)}',
        { status: 'done', arguments: { private: 'known result' } }, Date.now() + 1)
      state.usageReservations.push({ id: proxyArgumentReservationId(row.intent.id), tenantId: 'tenant-beta', allowance: 1000,
        fiveHourStart: 0, weeklyStart: 0, status: 'settled', report: { inputTokens: 10, outputTokens: 5 } })
      const storage = ${JSON.stringify(backend)} === 'json' ? new JsonFileBackend() : new SqliteBackend(${JSON.stringify(terminalFile)})
      storage.save(state); storage.close()
      console.log(JSON.stringify({ id: row.intent.id, expected: state.agentRequests[0] }))
    `))
    const terminal = result(boot(terminalFile, backend, `console.log(JSON.stringify(loadState().agentRequests[0]))`))
    assert.deepEqual(terminal, completed.expected, 'terminal private arguments and their settled report remain exact across restart')
    assert.equal(JSON.stringify(terminal).includes('known result'), true, 'the canonical private state retains the validated receipt')
  })

  test(`${backend}: private reply-draft text and exact usage reservation survive restart; pending becomes uncertain`, () => {
    const file = join(root, `reply-draft-${backend}${backend === 'json' ? '.json' : '.sqlite'}`)
    const initial = result(boot(file, backend, `${create}
      const { JsonFileBackend } = await import(${href('./json.ts')})
      const { SqliteBackend } = await import(${href('./sqlite.ts')})
      const { beginProxyReplyDraft } = await import(${href('../proxyRequestState.ts')})
      const { proxyReplyReservationId } = await import(${href('../proxyReplyDraftState.ts')})
      const state = loadState(), row = state.agentRequests[0]
      const pending = beginProxyReplyDraft(row, { tenantId: 'tenant-beta', userId: 'user-grace' }, 1,
        { agentRevision: 0, providerId: 'provider-private', providerRevision: 0,
          providerConnectionRevision: 0, model: 'configured-model' }, '${'b'.repeat(64)}', 'private notes stay out of storage', Date.now())
      state.agentRequests[0] = pending
      state.usageReservations.push({ id: proxyReplyReservationId(row.intent.id), tenantId: 'tenant-beta', allowance: 1000,
        fiveHourStart: 0, weeklyStart: 0, status: 'active', report: null })
      const storage = ${JSON.stringify(backend)} === 'json' ? new JsonFileBackend() : new SqliteBackend(${JSON.stringify(file)})
      storage.save(state); storage.close()
      console.log(JSON.stringify({ id: row.intent.id, state }))
    `))
    assert.equal(hasCorePersistedShape(initial.state), true)
    const reservationId = proxyReplyReservationId(initial.id)
    assert.equal(JSON.stringify(initial.state).includes('private notes stay out of storage'), false)
    const malformedStates = [
      { ...structuredClone(initial.state), usageReservations: [] },
      { ...structuredClone(initial.state), usageReservations: initial.state.usageReservations.map((item: any) =>
        item.id === reservationId ? { ...item, tenantId: 'tenant-acme' } : item) },
      { ...structuredClone(initial.state), usageReservations: initial.state.usageReservations.map((item: any) =>
        item.id === reservationId ? { ...item, id: `${reservationId}:orphan` } : item) },
    ]
    const completedDraftState = structuredClone(initial.state)
    completedDraftState.agentRequests[0] = settleProxyReplyDraft(completedDraftState.agentRequests[0], 'b'.repeat(64),
      { status: 'done', text: 'completed private reply draft' }, Date.now() + 1)
    malformedStates.push(completedDraftState)
    for (const invalid of malformedStates) assert.equal(hasCorePersistedShape(invalid), false,
      'reply-draft reservation must join one exact owner request in the matching lifecycle state')
    const meteredPending = structuredClone(initial.state)
    meteredPending.usageReservations[0] = { ...meteredPending.usageReservations[0], status: 'settled',
      report: { inputTokens: 7, outputTokens: 4 } }
    assert.equal(hasCorePersistedShape(meteredPending), true,
      'usage can be durable before model output is validated and its private receipt settles')
    const id = JSON.stringify(initial.id)
    const recovered = result(boot(file, backend, `
      const state = loadState()
      console.log(JSON.stringify({ row: state.agentRequests[0], reservation: state.usageReservations.find(item => item.id === ${JSON.stringify(initial.id)} + ':reply'),
        requester: store.agentRequest(${id}, { tenantId: 'tenant-acme', userId: 'user-ada' }),
        owner: store.agentRequest(${id}, { tenantId: 'tenant-beta', userId: 'user-grace' }) }))
    `))
    assert.equal(recovered.row.replyDraft.status, 'uncertain')
    assert.equal(recovered.row.revision, 3)
    assert.equal(recovered.reservation.status, 'uncertain')
    assert.equal(recovered.reservation.report, null)
    assert.equal(Object.hasOwn(recovered.requester, 'replyDraft'), false)
    assert.equal(recovered.owner.replyDraft.status, 'uncertain')

    const terminalFile = join(root, `reply-draft-done-${backend}${backend === 'json' ? '.json' : '.sqlite'}`)
    const completed = result(boot(terminalFile, backend, `${create}
      const { JsonFileBackend } = await import(${href('./json.ts')})
      const { SqliteBackend } = await import(${href('./sqlite.ts')})
      const { beginProxyReplyDraft, settleProxyReplyDraft } = await import(${href('../proxyRequestState.ts')})
      const { proxyReplyReservationId } = await import(${href('../proxyReplyDraftState.ts')})
      const state = loadState(), row = state.agentRequests[0]
      const binding = { agentRevision: 0, providerId: 'provider-retired', providerRevision: 0,
        providerConnectionRevision: 0, model: 'known-model' }
      const pending = beginProxyReplyDraft(row, { tenantId: 'tenant-beta', userId: 'user-grace' }, 1,
        binding, '${'e'.repeat(64)}', '', Date.now())
      state.agentRequests[0] = settleProxyReplyDraft(pending, '${'e'.repeat(64)}',
        { status: 'done', text: 'known private reply suggestion' }, Date.now() + 1)
      state.usageReservations.push({ id: proxyReplyReservationId(row.intent.id), tenantId: 'tenant-beta', allowance: 1000,
        fiveHourStart: 0, weeklyStart: 0, status: 'settled', report: { inputTokens: 10, outputTokens: 5 } })
      const storage = ${JSON.stringify(backend)} === 'json' ? new JsonFileBackend() : new SqliteBackend(${JSON.stringify(terminalFile)})
      storage.save(state); storage.close()
      console.log(JSON.stringify({ id: row.intent.id, expected: state.agentRequests[0] }))
    `))
    const terminal = result(boot(terminalFile, backend, `console.log(JSON.stringify(loadState().agentRequests[0]))`))
    assert.deepEqual(terminal, completed.expected, 'terminal private draft text and binding remain exact across restart')
  })

  test(`${backend}: direct owner reply survives persistence and restart without an execution receipt`, () => {
    const file = join(root, `direct-reply-${backend}${backend === 'json' ? '.json' : '.sqlite'}`)
    const first = result(boot(file, backend, `${create}
      const shared = store.decideAgentRequest(request.id, { tenantId: 'tenant-beta', userId: 'user-grace' }, {
        action: 'share', expectedRevision: request.revision, reply: 'Please clarify which account you mean.' })
      console.log(JSON.stringify({ request, shared, rows: loadState().agentRequests }))
    `))
    assert.equal(first.shared.status, 'replied')
    assert.equal(first.shared.reply, 'Please clarify which account you mean.')
    assert.equal(first.shared.execution, undefined)
    assert.equal(first.rows[0].replySource, 'direct')
    assert.equal(first.rows[0].execution, undefined)

    const id = JSON.stringify(first.request.id)
    const restarted = result(boot(file, backend, `
      console.log(JSON.stringify({
        owner: store.agentRequest(${id}, { tenantId: 'tenant-beta', userId: 'user-grace' }),
        requester: store.agentRequest(${id}, { tenantId: 'tenant-acme', userId: 'user-ada' }),
        rows: loadState().agentRequests,
      }))
    `))
    assert.equal(restarted.owner.status, 'replied')
    assert.equal(restarted.owner.reply, first.shared.reply)
    assert.equal(restarted.owner.execution, undefined)
    assert.equal(restarted.requester.reply, first.shared.reply)
    assert.equal(restarted.rows[0].replySource, 'direct')
    assert.equal(restarted.rows[0].execution, undefined)
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
