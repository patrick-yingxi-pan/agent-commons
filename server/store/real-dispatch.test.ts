import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Message } from '../../contract/index.ts'
import { dispatchPrompt, type RealDispatchInput } from '../../contract/dispatchExecution.ts'
import { CapabilityUnavailableError, NotFoundError, ValidationError } from '../conflict.ts'
import { LimitError } from '../limit.ts'
import { manualDispatchRunId } from '../dispatchIdentity.ts'
import { store } from './index.ts'

const DEFAULT_TENANT = store.defaultTenantId()
const DEFAULT_AGENT = store.listAgents(DEFAULT_TENANT).find((agent) => agent.tenantId === undefined)!
const DEFAULT_PROVIDER = store.listProviders(DEFAULT_TENANT).find((provider) => provider.id === DEFAULT_AGENT.providerId)!
const DEFAULT_MODEL = DEFAULT_PROVIDER.models?.[0]?.id!

interface Actor {
  tenantId: string
  agentId: string
  providerId: string
  modelId: string
  ownedAgent: boolean
  ownedProvider: boolean
}

function makeInput(actor: Actor, title = 'Dispatch task', detail?: string): RealDispatchInput {
  return { title, ...(detail === undefined ? {} : { detail }), execution: {
    agentId: actor.agentId, providerId: actor.providerId, modelId: actor.modelId,
  } }
}

function defaultActor(tenantId: string, options: { newAgent?: boolean } = {}): Actor {
  const agent = options.newAgent
    ? store.createAgent({
      label: `Dispatch fixture Agent ${Date.now().toString(36)} ${Math.random().toString(36).slice(2)}`,
      systemPrompt: 'A bounded store-test Agent.',
      instructions: '',
      tools: [],
      providerId: DEFAULT_PROVIDER.id,
    }, tenantId)
    : DEFAULT_AGENT
  return {
    tenantId,
    agentId: agent.id,
    providerId: DEFAULT_PROVIDER.id,
    modelId: DEFAULT_MODEL,
    ownedAgent: options.newAgent === true,
    ownedProvider: false,
  }
}

function configuredActor(tenantId: string, label: string): Actor {
  const modelId = `dispatch-model-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
  const provider = store.createProvider({
    label: `${label} provider`,
    modelFamily: 'claude',
    effortLevels: ['Low'],
    models: [{ id: modelId, label: 'Dispatch fixture model' }],
  }, {
    baseURL: 'https://dispatch-fixture.invalid/v1',
    model: modelId,
    capabilities: { toolUse: false },
  }, tenantId)
  const agent = store.createAgent({
    label: `${label} Agent`,
    systemPrompt: 'A bounded store-test Agent.',
    instructions: '',
    tools: [],
    providerId: provider.id,
  }, tenantId)
  return {
    tenantId, agentId: agent.id, providerId: provider.id, modelId,
    ownedAgent: true, ownedProvider: true,
  }
}

function cleanupActor(actor: Actor): void {
  if (actor.ownedAgent) store.deleteAgent(actor.agentId)
  if (actor.ownedProvider) store.deleteProvider(actor.providerId)
}

function key(label: string): string {
  return `real-dispatch-${label}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
}

function runId(tenantId: string, label: string): string {
  return manualDispatchRunId(tenantId, key(label))
}

function cleanupRun(id: string, tenantId: string): void {
  const run = store.getRealDispatch(id, tenantId)
  if (!run || run === 'retired') return
  if (run.execution?.state === 'running') store.settleRealDispatch(id, tenantId, 'error')
  const sessionId = run.execution?.sessionId
  if (sessionId) store.removeSession(sessionId)
}

function runCounts(tenantId: string) {
  return {
    sessions: store.listSessions(tenantId).length,
    dispatch: store.listDispatch(tenantId).length,
  }
}

test('real Dispatch uses visible live Agent/provider/catalog references and refuses before mutation', () => {
  const tenant = `tenant-real-dispatch-reader-${Date.now().toString(36)}`
  const actor = defaultActor(tenant)
  const foreignAgent = store.createAgent({
    label: 'Foreign Dispatch Agent', systemPrompt: 'x', instructions: '', tools: [], providerId: DEFAULT_PROVIDER.id,
  }, `tenant-real-dispatch-foreign-${Date.now().toString(36)}`)
  const privateProviderActor = configuredActor(`tenant-real-dispatch-provider-owner-${Date.now().toString(36)}`, 'Private')
  const ids = [runId(tenant, 'foreign-agent'), runId(tenant, 'foreign-provider'), runId(tenant, 'missing-model')]
  const before = runCounts(tenant)
  try {
    assert.throws(() => store.startRealDispatch({
      ...makeInput(actor), execution: { ...makeInput(actor).execution, agentId: foreignAgent.id },
    }, tenant, ids[0]!), (error: unknown) => error instanceof NotFoundError)
    assert.throws(() => store.startRealDispatch({
      ...makeInput(actor), execution: {
        agentId: DEFAULT_AGENT.id, providerId: privateProviderActor.providerId,
        modelId: privateProviderActor.modelId,
      },
    }, tenant, ids[1]!), (error: unknown) => error instanceof NotFoundError)
    assert.throws(() => store.startRealDispatch({
      ...makeInput(actor), execution: { ...makeInput(actor).execution, modelId: 'not-in-the-live-catalog' },
    }, tenant, ids[2]!), (error: unknown) => error instanceof ValidationError)
    assert.deepEqual(runCounts(tenant), before, 'foreign or stale references do not create a Session or feed row')
    for (const id of ids) assert.equal(store.getSession(`sess-dispatch-${id.slice('d-new-'.length)}`), undefined)
  } finally {
    for (const id of ids) cleanupRun(id, tenant)
    cleanupActor(privateProviderActor)
    store.deleteAgent(foreignAgent.id)
  }
})

test('a Session provider and an unconfigured release endpoint fail before any Session/feed mutation', () => {
  const tenant = `tenant-real-dispatch-closed-${Date.now().toString(36)}`
  const sessionProvider = store.createProvider({
    label: 'Dispatch refusal Session provider', modelFamily: 'claude', effortLevels: ['Default'], kind: 'session',
  }, { kind: 'session', capabilities: { toolUse: false }, secretHash: '1'.repeat(64) }, tenant)
  const sessionAgent = store.createAgent({
    label: 'Dispatch refusal Session Agent', systemPrompt: 'x', instructions: '', tools: [], providerId: sessionProvider.id,
  }, tenant)
  const sessionModelInput: RealDispatchInput = {
    title: 'Should not start', execution: { agentId: sessionAgent.id, providerId: sessionProvider.id, modelId: 'no-session-model' },
  }
  const sessionRunId = runId(tenant, 'session-provider')
  const releaseTenant = `${tenant}-release`
  const releaseActor = defaultActor(releaseTenant)
  const releaseRunId = runId(releaseTenant, 'unconfigured')
  const beforeSession = runCounts(tenant)
  const beforeRelease = runCounts(releaseTenant)
  const oldInline = process.env.MODEL_INLINE
  const oldUrl = process.env.ANTHROPIC_BASE_URL
  const oldKey = process.env.ANTHROPIC_API_KEY
  try {
    assert.throws(() => store.startRealDispatch(sessionModelInput, tenant, sessionRunId),
      (error: unknown) => error instanceof ValidationError)
    assert.deepEqual(runCounts(tenant), beforeSession)

    process.env.MODEL_INLINE = '0'
    delete process.env.ANTHROPIC_BASE_URL
    delete process.env.ANTHROPIC_API_KEY
    assert.throws(() => store.startRealDispatch(makeInput(releaseActor), releaseTenant, releaseRunId),
      (error: unknown) => error instanceof CapabilityUnavailableError)
    assert.deepEqual(runCounts(releaseTenant), beforeRelease,
      'an unavailable release endpoint is refused before Session or Dispatch creation')
  } finally {
    if (oldInline === undefined) delete process.env.MODEL_INLINE
    else process.env.MODEL_INLINE = oldInline
    if (oldUrl === undefined) delete process.env.ANTHROPIC_BASE_URL
    else process.env.ANTHROPIC_BASE_URL = oldUrl
    if (oldKey === undefined) delete process.env.ANTHROPIC_API_KEY
    else process.env.ANTHROPIC_API_KEY = oldKey
    cleanupRun(sessionRunId, tenant)
    cleanupRun(releaseRunId, releaseTenant)
    store.deleteAgent(sessionAgent.id)
    store.deleteProvider(sessionProvider.id)
  }
})

test('a real Dispatch atomically creates one private bound Session with the exact first prompt and replays identity', () => {
  const tenant = `tenant-real-dispatch-start-${Date.now().toString(36)}`
  const actor = defaultActor(tenant)
  const id = runId(tenant, 'replay')
  const input = makeInput(actor, '  Review the current plan  ', '  Check compatibility and recovery.  ')
  const before = runCounts(tenant)
  try {
    const run = store.startRealDispatch(input, tenant, id)
    assert.equal(run.id, id)
    assert.equal(run.status, 'running')
    assert.deepEqual(run.execution, {
      agentId: actor.agentId,
      providerId: actor.providerId,
      modelId: actor.modelId,
      kind: 'conversation',
      sessionId: `sess-dispatch-${id.slice('d-new-'.length)}`,
      state: 'running',
    })
    const session = store.getSession(run.execution!.sessionId)
    assert.ok(session)
    assert.equal(session.tenantId, tenant)
    assert.equal(session.agentId, actor.agentId)
    assert.equal(session.providerId, actor.providerId)
    assert.equal(session.modelId, actor.modelId)
    assert.deepEqual(session.messages?.map(({ role, content }) => ({ role, content })), [{
      role: 'user', content: dispatchPrompt(input.title, input.detail),
    }])
    assert.deepEqual(runCounts(tenant), { sessions: before.sessions + 1, dispatch: before.dispatch + 1 })

    const replay = store.startRealDispatch(makeInput(actor, 'Changed retry body', 'Must not replace first intent.'), tenant, id)
    assert.equal(replay.id, run.id)
    assert.equal(replay.execution?.sessionId, run.execution?.sessionId)
    assert.equal(replay.title, 'Review the current plan')
    assert.equal(store.getSession(run.execution!.sessionId)?.messages?.length, 1)
    assert.deepEqual(runCounts(tenant), { sessions: before.sessions + 1, dispatch: before.dispatch + 1 })
  } finally {
    cleanupRun(id, tenant)
  }
})

test('terminal outcomes save at most one assistant result and preserve binding provenance', () => {
  const tenant = `tenant-real-dispatch-terminal-${Date.now().toString(36)}`
  const actor = defaultActor(tenant)
  const id = runId(tenant, 'terminal')
  try {
    const run = store.startRealDispatch(makeInput(actor), tenant, id)
    const assistant: Message = {
      id: store.mintMessageId('assistant'), role: 'assistant', content: 'Model-authored result.',
    }
    assert.equal(store.settleRealDispatch(id, tenant, 'ok', assistant), true)
    const settled = store.getRealDispatch(id, tenant)
    assert.notEqual(settled, 'retired')
    assert.ok(settled && settled !== 'retired')
    assert.equal(settled.status, 'done')
    assert.equal(settled.execution?.state, 'replied')
    assert.equal(settled.execution?.messageId, assistant.id)
    assert.deepEqual(
      [settled.execution?.agentId, settled.execution?.providerId, settled.execution?.modelId],
      [actor.agentId, actor.providerId, actor.modelId],
    )
    const session = store.getSession(run.execution!.sessionId)!
    assert.equal(session.messages?.filter((message) => message.role === 'assistant' && message.id === assistant.id).length, 1)
    assert.equal(session.messages?.at(-1)?.content, assistant.content)
    assert.equal(store.settleRealDispatch(id, tenant, 'ok', { ...assistant, content: 'Duplicate terminal result.' }), false)
    assert.equal(store.getSession(run.execution!.sessionId)?.messages?.filter((message) => message.id === assistant.id).length, 1)
  } finally {
    cleanupRun(id, tenant)
  }
})

test('known model failure and cancellation settle terminally without fabricated assistant output', () => {
  const tenant = `tenant-real-dispatch-fail-${Date.now().toString(36)}`
  const actor = defaultActor(tenant)
  const failedId = runId(tenant, 'failed')
  const cancelledId = runId(tenant, 'cancelled')
  try {
    store.startRealDispatch(makeInput(actor), tenant, failedId)
    assert.equal(store.settleRealDispatch(failedId, tenant, 'error'), true)
    const failed = store.getRealDispatch(failedId, tenant)
    assert.ok(failed && failed !== 'retired')
    assert.equal(failed.status, 'failed')
    assert.equal(failed.execution?.state, 'failed')
    assert.equal(store.getSession(failed.execution!.sessionId)?.messages?.length, 1)

    store.startRealDispatch(makeInput(actor), tenant, cancelledId)
    assert.equal(store.settleRealDispatch(cancelledId, tenant, 'aborted'), true)
    const cancelled = store.getRealDispatch(cancelledId, tenant)
    assert.ok(cancelled && cancelled !== 'retired')
    assert.equal(cancelled.status, 'failed')
    assert.equal(cancelled.execution?.state, 'cancelled')
    assert.equal(store.getSession(cancelled.execution!.sessionId)?.messages?.length, 1)
  } finally {
    cleanupRun(failedId, tenant)
    cleanupRun(cancelledId, tenant)
  }
})

test('real Dispatch enforces one per Agent, two per tenant, and four per process', () => {
  const tenantA = `tenant-real-dispatch-cap-a-${Date.now().toString(36)}`
  const tenantB = `${tenantA}-b`
  const tenantC = `${tenantA}-c`
  const actors = [
    defaultActor(tenantA, { newAgent: true }),
    defaultActor(tenantA, { newAgent: true }),
    defaultActor(tenantA, { newAgent: true }),
    defaultActor(tenantB, { newAgent: true }),
    defaultActor(tenantB, { newAgent: true }),
    defaultActor(tenantC, { newAgent: true }),
  ]
  const ids = actors.map((actor, index) => runId(actor.tenantId, `capacity-${index}`))
  try {
    store.startRealDispatch(makeInput(actors[0]!), tenantA, ids[0]!)
    assert.throws(() => store.startRealDispatch(makeInput(actors[0]!), tenantA, ids[1]!),
      (error: unknown) => error instanceof LimitError, 'a second active run on the same Agent is refused')
    store.startRealDispatch(makeInput(actors[1]!), tenantA, ids[1]!)
    assert.throws(() => store.startRealDispatch(makeInput(actors[2]!), tenantA, ids[2]!),
      (error: unknown) => error instanceof LimitError, 'a third active run for one tenant is refused')
    store.startRealDispatch(makeInput(actors[3]!), tenantB, ids[3]!)
    store.startRealDispatch(makeInput(actors[4]!), tenantB, ids[4]!)
    assert.throws(() => store.startRealDispatch(makeInput(actors[5]!), tenantC, ids[5]!),
      (error: unknown) => error instanceof LimitError, 'a fifth process-wide active run is refused')
  } finally {
    for (let index = 0; index < ids.length; index += 1) cleanupRun(ids[index]!, actors[index]!.tenantId)
    for (const actor of actors) cleanupActor(actor)
  }
})

test('removing a real Dispatch Session removes its feed job and permanently retires the logical key', () => {
  const tenant = `tenant-real-dispatch-retired-${Date.now().toString(36)}`
  const actor = defaultActor(tenant)
  const id = runId(tenant, 'retired')
  const before = runCounts(tenant)
  try {
    const run = store.startRealDispatch(makeInput(actor), tenant, id)
    assert.equal(store.removeSession(run.execution!.sessionId), true)
    assert.equal(store.getSession(run.execution!.sessionId), undefined)
    assert.equal(store.listDispatch(tenant).some((candidate) => candidate.id === id), false)
    assert.equal(store.getRealDispatch(id, tenant), 'retired')
    assert.equal(store.settleRealDispatch(id, tenant, 'ok', {
      id: store.mintMessageId('assistant'), role: 'assistant', content: 'Late result must not resurrect.',
    }), false)
    assert.throws(() => store.startRealDispatch(makeInput(actor), tenant, id),
      (error: unknown) => error instanceof NotFoundError)
    assert.deepEqual(runCounts(tenant), before, 'the retired logical identity cannot mint another Session or feed row')
  } finally {
    cleanupRun(id, tenant)
  }
})
