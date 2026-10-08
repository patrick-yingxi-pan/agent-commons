import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import type { Server } from 'node:http'
import type { RealDispatchInput } from '../../contract/dispatchExecution.ts'
import { startModelServer } from '../model/index.ts'
import { turns } from '../turns.ts'
import { store } from '../store/index.ts'
import { manualDispatchRunId } from '../dispatchIdentity.ts'
import { call, callFresh } from '../testkit/http.ts'

const MODEL_ID = 'claude-opus-4-8'
let modelServer: Server
let modelBaseUrl = ''
let modelCalls = 0
let sequence = 0
const originalEnv = new Map<string, string | undefined>()

function scopedEnv(name: string, value: string | undefined): void {
  if (!originalEnv.has(name)) originalEnv.set(name, process.env[name])
  if (value === undefined) delete process.env[name]
  else process.env[name] = value
}

before(async () => {
  scopedEnv('AUTH_GATE', 'off')
  scopedEnv('IDENTITY_HEADERS', 'allow')
  scopedEnv('MODEL_PACE_MS', '180')
  modelServer = startModelServer(0, '127.0.0.1')
  await new Promise<void>((resolve) => modelServer.once('listening', resolve))
  const address = modelServer.address()
  assert.ok(address && typeof address === 'object')
  modelBaseUrl = `http://127.0.0.1:${address.port}`
  modelServer.on('request', (request) => {
    if (request.method === 'POST' && request.url?.split('?')[0] === '/v1/messages') modelCalls += 1
  })
})

after(async () => {
  await new Promise<void>((resolve) => modelServer.close(() => resolve()))
  for (const [name, value] of originalEnv) {
    if (value === undefined) delete process.env[name]
    else process.env[name] = value
  }
})

interface Actor {
  tenantId: string
  agentId: string
  providerId: string
  modelId: string
}

function actor(tenantId: string): Actor {
  const suffix = `${Date.now().toString(36)}-${++sequence}`
  const provider = store.createProvider({
    label: `Route Dispatch provider ${suffix}`,
    modelFamily: 'claude',
    effortLevels: ['Low', 'Medium', 'High'],
    models: [{ id: MODEL_ID, label: 'Claude Opus fixture' }],
  }, {
    baseURL: modelBaseUrl,
    model: MODEL_ID,
    capabilities: { toolUse: true },
  }, tenantId)
  const agent = store.createAgent({
    label: `Route Dispatch Agent ${suffix}`,
    systemPrompt: 'Complete the user task clearly.',
    instructions: '',
    tools: [],
    providerId: provider.id,
  }, tenantId)
  return { tenantId, agentId: agent.id, providerId: provider.id, modelId: MODEL_ID }
}

function input(binding: Actor, title = 'Summarize the task neutrally.', detail = 'Keep the response concise.'): RealDispatchInput {
  return { title, detail, execution: {
    agentId: binding.agentId, providerId: binding.providerId, modelId: binding.modelId,
  } }
}

function headers(tenantId: string, key?: string): Record<string, string> {
  return { 'x-tenant-id': tenantId, ...(key === undefined ? {} : { 'idempotency-key': key }) }
}

function logicalId(tenantId: string, key: string): string {
  return manualDispatchRunId(tenantId, key)
}

async function waitForTerminal(id: string, tenantId: string, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const run = store.getRealDispatch(id, tenantId)
    if (run && run !== 'retired' && run.execution?.state !== 'running') return run
    assert.ok(Date.now() < deadline, `real Dispatch ${id} did not settle`)
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
}

async function waitForTurn(sessionId: string, timeoutMs = 2_000) {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const turn = turns.bySession(sessionId)
    if (turn) return turn
    assert.ok(Date.now() < deadline, `no model turn started for ${sessionId}`)
    await new Promise((resolve) => setTimeout(resolve, 2))
  }
}

async function cleanupDispatch(id: string, tenantId: string, actorRow: Actor): Promise<void> {
  const run = store.getRealDispatch(id, tenantId)
  if (run && run !== 'retired' && run.execution) {
    const active = turns.bySession(run.execution.sessionId)
    if (active) {
      turns.cancel(active.id)
      await waitForTerminal(id, tenantId)
    }
    store.removeSession(run.execution.sessionId)
  }
  store.deleteAgent(actorRow.agentId)
  store.deleteProvider(actorRow.providerId)
}

function sessionAndFeedCounts(tenantId: string) {
  return {
    sessions: store.listSessions(tenantId).length,
    dispatch: store.listDispatch(tenantId).length,
  }
}

test('keyed POST /dispatch runs once through the local model, persists a private conversation, and replays without another call', async () => {
  const tenant = `tenant-real-dispatch-route-${++sequence}`
  const binding = actor(tenant)
  const key = `route-real-dispatch-${Date.now().toString(36)}-${sequence}`
  const id = logicalId(tenant, key)
  const callsBefore = modelCalls
  try {
    const started = await call('POST', '/dispatch', input(binding), headers(tenant, key))
    assert.equal(started.status, 200)
    assert.equal(started.json.id, id)
    assert.equal(started.json.status, 'running')
    assert.deepEqual(started.json.execution, {
      agentId: binding.agentId,
      providerId: binding.providerId,
      modelId: binding.modelId,
      kind: 'conversation',
      sessionId: `sess-dispatch-${id.slice('d-new-'.length)}`,
      state: 'running',
    })

    const sessionId = started.json.execution.sessionId
    const session = store.getSession(sessionId)
    assert.ok(session, 'the real Dispatch has an ordinary persisted Session')
    assert.equal(session.tenantId, tenant)
    assert.equal(session.agentId, binding.agentId)
    assert.equal(session.providerId, binding.providerId)
    assert.equal(session.modelId, binding.modelId)
    assert.equal(session.messages?.[0]?.role, 'user')
    assert.equal(session.messages?.[0]?.content, 'Summarize the task neutrally.\n\nKeep the response concise.')

    const terminal = await waitForTerminal(id, tenant)
    assert.equal(terminal.execution?.state, 'replied')
    assert.equal(terminal.status, 'done')
    assert.equal(store.getSession(sessionId)?.messages?.filter((message) => message.role === 'assistant').length, 1)
    assert.equal(modelCalls, callsBefore + 1, 'the local Messages fixture received exactly one model call')

    const sessionBeforeReplay = structuredClone(store.getSession(sessionId)?.messages)
    const replay = await callFresh('POST', '/dispatch', input(binding, 'Changed retry title', 'Must not replace or resend.'), headers(tenant, key))
    assert.equal(replay.status, 200)
    assert.equal(replay.json.id, id)
    assert.equal(replay.json.execution.sessionId, sessionId)
    assert.equal(replay.json.execution.state, 'replied')
    await new Promise((resolve) => setTimeout(resolve, 40))
    assert.equal(modelCalls, callsBefore + 1, 'same-key retry is a receipt read, not another model request')
    assert.deepEqual(store.getSession(sessionId)?.messages, sessionBeforeReplay)
  } finally {
    await cleanupDispatch(id, tenant, binding)
  }
})

test('Dispatch conversations and keyed receipts remain invisible to a foreign tenant', async () => {
  const owner = `tenant-real-dispatch-owner-${++sequence}`
  const foreign = `tenant-real-dispatch-foreign-${++sequence}`
  const binding = actor(owner)
  const key = `route-foreign-${Date.now().toString(36)}-${sequence}`
  const id = logicalId(owner, key)
  try {
    const created = await call('POST', '/dispatch', input(binding), headers(owner, key))
    assert.equal(created.status, 200)
    const terminal = await waitForTerminal(id, owner)
    assert.equal(terminal.execution?.state, 'replied')

    const foreignSession = await callFresh('GET', `/sessions/${terminal.execution!.sessionId}`, undefined, headers(foreign))
    assert.equal(foreignSession.status, 404)
    const foreignFeed = await callFresh('GET', '/dispatch', undefined, headers(foreign))
    assert.equal(foreignFeed.status, 200)
    assert.equal(foreignFeed.json.some((run: { id: string }) => run.id === id), false)

    const replay = await callFresh('POST', '/dispatch', input(binding), headers(foreign, key))
    assert.equal(replay.status, 404, 'tenant-derived identity does not reveal the owner’s replay receipt')
    assert.notEqual(replay.json.id, id)
  } finally {
    await cleanupDispatch(id, owner, binding)
  }
})

test('invalid explicit model binding fails before a conversation or Dispatch row is created', async () => {
  const tenant = `tenant-real-dispatch-invalid-${++sequence}`
  const binding = actor(tenant)
  const key = `route-invalid-${Date.now().toString(36)}-${sequence}`
  const id = logicalId(tenant, key)
  const before = sessionAndFeedCounts(tenant)
  try {
    const response = await call('POST', '/dispatch', {
      ...input(binding),
      execution: { ...input(binding).execution, modelId: 'not-in-the-provider-catalog' },
    }, headers(tenant, key))
    assert.equal(response.status, 400)
    assert.equal(response.json.error.code, 'bad_request')
    assert.deepEqual(sessionAndFeedCounts(tenant), before)
    assert.equal(store.getRealDispatch(id, tenant), undefined)
  } finally {
    await cleanupDispatch(id, tenant, binding)
  }
})

test('release profile accepts explicitly bound Dispatch, but refuses the legacy title-only fixture before mutation', async () => {
  const tenant = `tenant-real-dispatch-release-${++sequence}`
  const binding = actor(tenant)
  const key = `route-release-${Date.now().toString(36)}-${sequence}`
  const id = logicalId(tenant, key)
  const before = sessionAndFeedCounts(tenant)
  const oldProfile = process.env.DEPLOYMENT_PROFILE
  try {
    process.env.DEPLOYMENT_PROFILE = 'desktop'
    const legacy = await call('POST', '/dispatch', { title: 'Legacy simulated request' }, headers(tenant))
    assert.equal(legacy.status, 409)
    assert.equal(legacy.json.error.code, 'capability_unavailable')
    assert.deepEqual(sessionAndFeedCounts(tenant), before)

    const explicit = await call('POST', '/dispatch', input(binding), headers(tenant, key))
    assert.equal(explicit.status, 200)
    assert.equal(explicit.json.id, id)
    const terminal = await waitForTerminal(id, tenant)
    assert.equal(terminal.execution?.state, 'replied')
    assert.equal(store.getSession(terminal.execution!.sessionId)?.tenantId, tenant)
  } finally {
    if (oldProfile === undefined) delete process.env.DEPLOYMENT_PROFILE
    else process.env.DEPLOYMENT_PROFILE = oldProfile
    await cleanupDispatch(id, tenant, binding)
  }
})

test('the normal Session cancellation route settles a running Dispatch as cancelled', async () => {
  const tenant = `tenant-real-dispatch-cancel-${++sequence}`
  const binding = actor(tenant)
  const key = `route-cancel-${Date.now().toString(36)}-${sequence}`
  const id = logicalId(tenant, key)
  try {
    const started = await call('POST', '/dispatch', input(binding, 'Provide a neutral task summary.', 'paced'), headers(tenant, key))
    assert.equal(started.status, 200)
    const sessionId = started.json.execution.sessionId
    const activeTurn = await waitForTurn(sessionId)
    const cancelled = await call('POST', `/sessions/${sessionId}/turns/${activeTurn.id}/cancel`, {}, headers(tenant))
    assert.equal(cancelled.status, 200)
    const terminal = await waitForTerminal(id, tenant)
    assert.equal(terminal.execution?.state, 'cancelled')
    assert.equal(terminal.status, 'failed')
    assert.equal(store.getSession(sessionId)?.messages?.filter((message) => message.role === 'assistant').length ?? 0, 0)
  } finally {
    await cleanupDispatch(id, tenant, binding)
  }
})
