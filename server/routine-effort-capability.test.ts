/** Real Routine admission and execution against authored local provider wires. */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createServer } from 'node:http'
import { store } from './store/index.ts'
import { createRoutineRunner, type RoutineRunStore } from './routineRunner.ts'
import { generateReply } from './generate.ts'
import type { EndpointProtocol } from '../contract/providers.ts'

let sequence = 0
const MODEL = 'inherited-routine-effort-model'
function setup(effortLevels: string[] | undefined, effort: string | undefined, config: Record<string, unknown> = {}) {
  const provider = store.createProvider({ label: `Routine capability ${++sequence}`, modelFamily: 'custom', effortLevels: ['High'],
    models: [{ id: MODEL, label: 'Routine model', ...(effortLevels === undefined ? {} : { effortLevels }) }] },
  { protocol: 'anthropic-messages', model: MODEL, ...config })
  const agent = store.createAgent({ label: `Routine capability Agent ${sequence}`, systemPrompt: 'Complete the reviewed task.', instructions: '', tools: [], providerId: provider.id })
  const { id: _id, tenantId: _tenantId, modelId: _modelId, effort: _effort, ...seed } = structuredClone(store.listSchedules()[0]!)
  let task: typeof seed & { id: string }
  try { task = store.addSchedule({ ...seed, name: `Routine capability task ${sequence}`,
    enabled: false, runs: [], steps: [], agentId: agent.id, providerId: provider.id, model: provider.label,
    ...(effort === undefined ? {} : { effort }),
    delivery: { tool: { id: 'claude', label: 'Claude', tone: 'claude' }, target: 'Run conversation' },
  }) } catch (error) { store.deleteAgent(agent.id); store.deleteProvider(provider.id); throw error }
  return { provider, agent, task, close() {
    for (const run of task.runs) if (run.status === 'running') store.failScheduleRun(task.id, run.id, 'execution_error', 'Fixture cleanup.')
    store.removeSchedule(task.id); store.deleteAgent(agent.id); store.deleteProvider(provider.id)
  } }
}

test('Routine admission suppresses effort for an inherited explicitly unsupported private default', () => {
  const fixture = setup([], 'High')
  try {
    assert.equal(fixture.provider.defaultModelId, undefined, 'the raw registry does not carry the served-only default annotation')
    assert.equal(fixture.task.modelId, undefined, 'the authored Routine still inherits its model')
    assert.equal(fixture.task.effort, undefined)
    assert.equal(Object.hasOwn(fixture.task, 'effort'), false, 'discarded seed effort cannot survive the binding normalization')
    const run = store.runSchedule(fixture.task.id)!
    assert.equal(run.execution?.effort, undefined)
    assert.equal(store.routineExecutionContext(fixture.task.id, run.id)?.task.effort, undefined)
  } finally { fixture.close() }
})

test('Routine admission preserves explicit effort for unknown metadata and never invents an absent setting', () => {
  for (const [levels, effort] of [[undefined, 'High'], [undefined, undefined], [['Low', 'High'], 'High'], [['Low'], undefined]] as const) {
    const fixture = setup(levels as string[] | undefined, effort)
    try {
      assert.equal(fixture.task.effort, effort)
      const run = store.runSchedule(fixture.task.id)!
      assert.equal(run.execution?.effort, effort)
      assert.equal(store.routineExecutionContext(fixture.task.id, run.id)?.task.effort, effort)
    } finally { fixture.close() }
  }
})

test('Routine admission validates an explicit effort against the inherited default supported subset', () => {
  assert.throws(() => setup(['Low'], 'High'), /does not offer effort 'High'/)
})

for (const levels of [[], ['Low']] as string[][]) {
  test(`queued inherited Routine rechecks changed effort capability ${JSON.stringify(levels)} without rewriting frozen intent`, () => {
    const fixture = setup(undefined, 'High')
    try {
      const run = store.runSchedule(fixture.task.id)!
      const frozen = structuredClone(run.execution)
      store.replaceStaticProviderModels(fixture.provider.id, [{ id: MODEL, label: 'Routine model', effortLevels: levels }])
      const context = store.routineExecutionContext(fixture.task.id, run.id)!
      assert.equal(context.modelId, MODEL)
      if (levels.length === 0) {
        assert.equal(context.blocked, undefined)
        assert.equal(context.task.effort, undefined, 'execution omits newly unsupported effort')
      } else {
        assert.equal(context.blocked?.code, 'model_unavailable', 'a removed explicit subset choice must not silently become Low')
        assert.match(context.blocked?.detail ?? '', /effort 'High'/)
      }
      assert.deepEqual(run.execution, frozen)
      assert.equal(fixture.task.effort, 'High', 'the current Routine definition and queued reviewed intent stay authored')
    } finally { fixture.close() }
  })
}

async function peer(protocol: EndpointProtocol) {
  const bodies: any[] = []
  const server = createServer(async (request, response) => {
    if (request.method !== 'POST' || request.url !== (protocol === 'openai-responses' ? '/v1/responses' : '/v1/messages')) {
      response.writeHead(404).end(); return
    }
    const chunks: Buffer[] = []
    for await (const chunk of request) chunks.push(Buffer.from(chunk))
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    bodies.push(body)
    if (body.output_config !== undefined || body.reasoning?.effort !== undefined) {
      response.writeHead(400, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ error: { type: 'invalid_request_error', message: 'Authored unsupported effort refusal.' } }))
      return
    }
    response.writeHead(200, { 'content-type': 'text/event-stream' })
    const text = 'The Routine completed without unsupported effort.'
    const events = protocol === 'openai-responses' ? [
      { type: 'response.created', response: { id: 'routine-effort-response', status: 'in_progress', output: [], usage: null } },
      { type: 'response.completed', response: { id: 'routine-effort-response', object: 'response', status: 'completed', model: body.model,
        output: [{ id: 'routine-effort-message', type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text, annotations: [] }] }],
        usage: { input_tokens: 3, output_tokens: 2 } } },
    ] : [
      { type: 'message_start', message: { id: 'routine-effort-message', type: 'message', role: 'assistant', model: body.model, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 3, output_tokens: 0 } } },
      { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } },
      { type: 'content_block_stop', index: 0 },
      { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 2 } },
      { type: 'message_stop' },
    ]
    response.end(events.map(event => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(''))
  })
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
  const address = server.address()
  assert.ok(address && typeof address === 'object')
  return { bodies, baseURL: `http://127.0.0.1:${address.port}${protocol === 'openai-responses' ? '/v1' : ''}`,
    async close() { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())) } }
}

for (const protocol of ['anthropic-messages', 'openai-responses'] as const) {
  for (const change of ['none', 'unsupported', 'subset'] as const) {
    const changesBeforeExecution = change !== 'none'
    test(`${protocol} inherited Routine honors effort at execution; queued capability change ${change}`, async () => {
      const wire = await peer(protocol)
      const fixture = setup(changesBeforeExecution ? undefined : [], 'High', { protocol, baseURL: wire.baseURL, capabilities: { toolUse: false } })
      let stop = () => {}
      let timeout: ReturnType<typeof setTimeout> | undefined
      try {
        const run = store.runSchedule(fixture.task.id)!
        const frozen = structuredClone(run.execution)
        if (changesBeforeExecution) store.replaceStaticProviderModels(fixture.provider.id, [{ id: MODEL, label: 'Routine model', effortLevels: change === 'subset' ? ['Low'] : [] }])
        let settled!: () => void
        const terminal = new Promise<void>(resolve => { settled = resolve })
        const runStore: RoutineRunStore = {
          pendingScheduleRuns: () => run.status === 'running' ? [{ taskId: fixture.task.id, runId: run.id, nextAttemptAt: run.nextAttemptAt ?? run.at }] : [],
          routineExecutionContext: () => store.routineExecutionContext(fixture.task.id, run.id),
          markScheduleRunAttempt: (...args) => store.markScheduleRunAttempt(...args),
          deferScheduleRun: (...args) => { const result = store.deferScheduleRun(...args); settled(); return result },
          completeScheduleRun: (...args) => { const result = store.completeScheduleRun(...args); settled(); return result },
          failScheduleRun: (...args) => { const result = store.failScheduleRun(...args); settled(); return result },
          modelSpendLimit: (...args) => store.modelSpendLimit(...args),
          recordUsage: (...args) => store.recordUsage(...args),
          recordGenerationOutcome: (...args) => store.recordGenerationOutcome(...args),
        }
        const runner = createRoutineRunner(runStore, generateReply)
        stop = () => runner.stop()
        runner.start()
        await Promise.race([terminal, new Promise<never>((_, reject) => { timeout = setTimeout(() => reject(new Error('Routine did not settle')), 2_000) })])
        stop()
        assert.equal(run.status, change === 'subset' ? 'failed' : 'ok', run.detail)
        assert.equal(run.attempts, 1)
        if (change === 'subset') {
          assert.equal(run.failureCode, 'model_unavailable')
          assert.match(run.detail ?? '', /effort 'High'/)
          assert.equal(wire.bodies.length, 0, 'a removed explicit choice fails before provider I/O and is not silently replaced')
        } else {
          assert.equal(wire.bodies.length, 1)
          assert.equal(wire.bodies[0].model, MODEL)
          assert.equal(Object.hasOwn(wire.bodies[0], 'output_config'), false)
          assert.equal(wire.bodies[0].reasoning?.effort, undefined)
        }
        assert.deepEqual(run.execution, frozen, 'execution-time capability suppression never rewrites the queued reviewed settings')
      } finally { stop(); if (timeout) clearTimeout(timeout); fixture.close(); await wire.close() }
    })
  }
}
