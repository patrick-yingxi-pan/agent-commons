import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import {
  DEFAULT_PROVIDER_ID,
  type Agent,
  type Message,
  type ModelProvider,
  type ScheduledRun,
  type ScheduledTask,
  type SessionContext,
} from '../contract/index.ts'
import type { ReplyResult } from './generate.ts'
import {
  createRoutineRunner,
  routineConcurrencyLimits,
  type RoutineGenerate,
  type RoutineRunStore,
} from './routineRunner.ts'
import type { RoutineExecutionContext } from './store/index.ts'
import { PersistenceWriteError } from './persistence/persist.ts'

const provider: ModelProvider = {
  id: DEFAULT_PROVIDER_ID,
  label: 'Anthropic',
  modelFamily: 'claude',
  effortLevels: ['High'],
  models: [{ id: 'claude-opus-4-8', label: 'Claude Opus 4.8' }],
}

function routineContext(
  id: string,
  tenantId = 'tenant-a',
  agentId = `agent-${id}`,
): RoutineExecutionContext {
  const agent: Agent = {
    id: `context-agent-${id}`,
    label: `Agent ${id}`,
    systemPrompt: 'Complete the routine.',
    tools: [],
    instructions: 'Stay concise.',
    providerId: DEFAULT_PROVIDER_ID,
  }
  const task: ScheduledTask = {
    id,
    tenantId,
    name: `Routine ${id}`,
    cadence: 'Daily at 09:00',
    next: 'tomorrow',
    enabled: true,
    lastStatus: 'pending',
    subtitle: 'A routine',
    trigger: 'Every day at 09:00',
    prompt: `Run ${id}.`,
    steps: [],
    delivery: { tool: { id: 'local', label: 'Local', tone: 'connector' }, target: 'local' },
    runs: [],
    model: 'Claude Opus 4.8 · High',
    // This persisted binding, not the ambient Agent object, defines the queue scope.
    agentId,
    providerId: provider.id,
    modelId: 'claude-opus-4-8',
    effort: 'High',
  }
  const run: ScheduledRun = {
    id: `run-${id}`,
    status: 'running',
    duration: '—',
    reachedStep: 0,
    summary: 'Queued',
    at: 1_000,
    attempts: 0,
    maxAttempts: 3,
    nextAttemptAt: 1_000,
  }
  task.runs = [run]
  const contexts: SessionContext[] = []
  return {
    task,
    run,
    sessionId: `srun-${id}-${run.id}`,
    tenantId,
    agent,
    provider,
    providerConfig: {},
    modelId: 'claude-opus-4-8',
    contexts,
    approvedContextIds: new Set(),
  }
}

interface Harness {
  rows: Map<string, RoutineExecutionContext>
  lookups: Map<string, number>
  usage: Array<[number, number, string | undefined]>
  outcomes: string[]
  completions: Message[]
  failures: Array<{ id: string; code: NonNullable<ScheduledRun['failureCode']>; detail: string }>
  deferrals: Array<{ id: string; nextAttemptAt: number }>
  pendingOverride?: Array<{ taskId: string; runId: string; nextAttemptAt: number }>
  blockedAtAdmission?: Set<string>
  overBudgetTenants?: Set<string>
  store: RoutineRunStore
}

function harness(contexts: RoutineExecutionContext[]): Harness {
  const state: Harness = {
    rows: new Map(contexts.map((ctx) => [ctx.task.id, ctx])),
    lookups: new Map(),
    usage: [],
    outcomes: [],
    completions: [],
    failures: [],
    deferrals: [],
    store: undefined as unknown as RoutineRunStore,
  }
  state.store = {
    pendingScheduleRuns: () => state.pendingOverride ?? [...state.rows.values()]
      .filter((ctx) => ctx.run.status === 'running')
      .map((ctx) => ({
        taskId: ctx.task.id,
        runId: ctx.run.id,
        nextAttemptAt: ctx.run.nextAttemptAt ?? 1_000,
      })),
    routineExecutionContext: (taskId, runId) => {
      state.lookups.set(taskId, (state.lookups.get(taskId) ?? 0) + 1)
      const ctx = state.rows.get(taskId)
      if (!ctx || ctx.run.id !== runId || ctx.run.status !== 'running') return undefined
      if (state.blockedAtAdmission?.has(taskId)) {
        ctx.blocked = { code: 'context_unavailable', detail: 'Standing context is no longer available.' }
      }
      return ctx
    },
    markScheduleRunAttempt: (taskId, runId, attempt, at = 1_000) => {
      const ctx = state.rows.get(taskId)
      if (!ctx || ctx.run.id !== runId || ctx.run.status !== 'running') return undefined
      ctx.run.attempts = attempt
      ctx.run.nextAttemptAt = at
      return ctx.run
    },
    deferScheduleRun: (taskId, runId, nextAttemptAt) => {
      const ctx = state.rows.get(taskId)
      if (!ctx || ctx.run.id !== runId || ctx.run.status !== 'running') return undefined
      ctx.run.nextAttemptAt = nextAttemptAt
      state.deferrals.push({ id: taskId, nextAttemptAt })
      return ctx.run
    },
    completeScheduleRun: (taskId, runId, message) => {
      const ctx = state.rows.get(taskId)
      if (!ctx || ctx.run.id !== runId || ctx.run.status !== 'running') return undefined
      ctx.run.status = 'ok'
      state.completions.push(message)
      return ctx.run
    },
    failScheduleRun: (taskId, runId, code, detail) => {
      const ctx = state.rows.get(taskId)
      if (!ctx || ctx.run.id !== runId || ctx.run.status !== 'running') return undefined
      ctx.run.status = 'failed'
      ctx.run.failureCode = code
      state.failures.push({ id: taskId, code, detail })
      return ctx.run
    },
    overSpendLimit: (_budget, tenantId) => state.overBudgetTenants?.has(tenantId)
      ? { label: `${tenantId} budget`, ceiling: 100 }
      : null,
    recordUsage: (input, output, tenantId) => state.usage.push([input, output, tenantId]),
    recordGenerationOutcome: (outcome) => state.outcomes.push(outcome),
  }
  return state
}

function result(overrides: Partial<ReplyResult> = {}): ReplyResult {
  return {
    message: { id: 'routine-reply', role: 'assistant', content: 'Done.' },
    usage: { inputTokens: 12, outputTokens: 8 },
    outcome: 'ok',
    ...overrides,
  }
}

interface Deferred<T = void> {
  promise: Promise<T>
  resolve(value: T): void
}

function deferred<T = void>(): Deferred<T> {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

/** Resolve when a predicate becomes true, with a hard ceiling on a broken lock. */
async function eventually(predicate: () => boolean, message: string, timeoutMs = 900): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!predicate() && Date.now() < deadline) {
    await new Promise<void>((resolve) => setTimeout(resolve, 1))
  }
  assert.ok(predicate(), message)
}

function within<T>(promise: Promise<T>, message: string, timeoutMs = 900): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(message)), timeoutMs)
    promise.then(
      (value) => { clearTimeout(timeout); resolve(value) },
      (error) => { clearTimeout(timeout); reject(error) },
    )
  })
}

function routineId(args: Parameters<RoutineGenerate>): string {
  return args[0].title.slice('Routine '.length)
}

test('routine concurrency limits use production defaults and reject invalid overrides', () => {
  assert.deepEqual(routineConcurrencyLimits({}), { global: 4, perTenant: 2, perAgent: 1 })
  assert.deepEqual(routineConcurrencyLimits({
    ROUTINE_MAX_CONCURRENT: '7',
    ROUTINE_MAX_CONCURRENT_PER_TENANT: '3',
    ROUTINE_MAX_CONCURRENT_PER_AGENT: '2',
  }), { global: 7, perTenant: 3, perAgent: 2 })
  for (const value of ['0', '-1', '1.5', '65', 'NaN', '']) {
    assert.deepEqual(routineConcurrencyLimits({
      ROUTINE_MAX_CONCURRENT: value,
      ROUTINE_MAX_CONCURRENT_PER_TENANT: value,
      ROUTINE_MAX_CONCURRENT_PER_AGENT: value,
    }), { global: 4, perTenant: 2, perAgent: 1 }, `invalid limit ${JSON.stringify(value)} falls back safely`)
  }
})

test('the queue enforces global, tenant, and frozen-agent caps without head-of-line blocking', async () => {
  const contexts = [
    routineContext('a1', 'tenant-a', 'frozen-agent-x'),
    routineContext('a2', 'tenant-a', 'frozen-agent-x'), // agent cap blocks this row first
    routineContext('a3', 'tenant-a', 'frozen-agent-y'),
    routineContext('a4', 'tenant-a', 'frozen-agent-z'), // tenant cap blocks this row
    routineContext('b1', 'tenant-b', 'frozen-agent-x'), // eligible despite a2/a4
    routineContext('c1', 'tenant-c', 'frozen-agent-z'), // global cap blocks this eligible scope
  ]
  // Ambient agents deliberately differ; the persisted task binding is authoritative.
  for (const ctx of contexts) ctx.agent.id = 'same-ambient-agent'
  const state = harness(contexts)
  const gates = new Map(contexts.map((ctx) => [ctx.task.id, deferred()]))
  const started: string[] = []
  const runner = createRoutineRunner(state.store, (async (...args: Parameters<RoutineGenerate>) => {
    const id = routineId(args)
    const context = contexts.find((ctx) => ctx.task.id === id)
    assert.ok(context)
    started.push(context.task.id)
    await gates.get(context.task.id)?.promise
    return result()
  }) as RoutineGenerate, {
    concurrency: { global: 3, perTenant: 2, perAgent: 1 },
  })

  try {
    runner.start()
    await eventually(() => started.length === 3, 'three eligible routine turns are admitted')
    assert.deepEqual(new Set(started), new Set(['a1', 'a3', 'b1']))
    assert.equal(state.rows.get('a2')?.run.attempts, 0, 'waiting rows do not consume a durable attempt')
    assert.equal(state.rows.get('a4')?.run.attempts, 0, 'tenant-queued rows do not consume a durable attempt')
    assert.equal(state.rows.get('c1')?.run.attempts, 0, 'global capacity also bounds otherwise eligible scopes')

    gates.get('a1')?.resolve()
    await eventually(() => started.includes('a2'), 'the same-agent row enters after its predecessor settles')
    assert.equal(state.rows.get('a4')?.run.attempts, 0, 'tenant cap still holds while two tenant-a turns run')
  } finally {
    for (const gate of gates.values()) gate.resolve()
    runner.stop()
  }
})

test('durability failure closes admission without treating a failed state commit as a model retry', async () => {
  for (const edge of ['admission', 'completion'] as const) {
    const contexts = [routineContext(`first-${edge}`), routineContext(`queued-${edge}`)]
    const state = harness(contexts)
    const failure = new PersistenceWriteError(new Error('private-storage-location'))
    if (edge === 'admission') state.store.markScheduleRunAttempt = () => { throw failure }
    else state.store.completeScheduleRun = () => { throw failure }
    let fatals = 0
    let calls = 0
    const runner = createRoutineRunner(state.store, (async () => {
      calls += 1
      return result()
    }) as RoutineGenerate, { concurrency: { global: 1 }, onFatal: () => { fatals += 1 } })
    runner.start()
    await eventually(() => fatals === 1, `${edge}: the supervisor receives one fatal state failure`)
    runner.start()
    runner.enqueue(contexts[1].task.id, contexts[1].run.id)
    await new Promise((resolve) => setTimeout(resolve, 5))
    runner.stop()
    assert.equal(calls, edge === 'admission' ? 0 : 1)
    assert.equal(contexts[1].run.attempts, 0, 'a fatal state transition cannot release capacity to later work')
    assert.deepEqual(state.deferrals, [], 'a durable commit failure never becomes a paid retry')
    assert.deepEqual(state.failures, [], 'no further terminal write is attempted against the faulted store')
    assert.equal(fatals, 1, 'restart of the same failed worker is refused')
  }
})

test('the default fatal supervisor exits with a generic message and hides the private store cause', () => {
  const runnerUrl = new URL('./routineRunner.ts', import.meta.url).href
  const persistenceUrl = new URL('./persistence/persist.ts', import.meta.url).href
  const script = `
    import { createRoutineRunner } from ${JSON.stringify(runnerUrl)};
    import { PersistenceWriteError } from ${JSON.stringify(persistenceUrl)};
    const ctx = {
      task: { id: 'fatal-task', name: 'Fatal routine', tenantId: 'tenant', agentId: 'agent',
        steps: [], prompt: 'Run', delivery: { target: 'local' } },
      run: { id: 'fatal-run', status: 'running', attempts: 0, nextAttemptAt: 1000 },
      sessionId: 'fatal-session', tenantId: 'tenant', agent: { id: 'agent' }, provider: { id: 'provider' },
      providerConfig: {}, modelId: 'model', contexts: [], approvedContextIds: new Set(),
    };
    const runStore = {
      pendingScheduleRuns: () => [{ taskId: 'fatal-task', runId: 'fatal-run', nextAttemptAt: 1000 }],
      routineExecutionContext: () => ctx,
      markScheduleRunAttempt: () => { throw new PersistenceWriteError(new Error('private store cause')); },
    };
    createRoutineRunner(runStore, async () => { throw new Error('generation should not run'); }, { now: () => 1000 }).start();
    // Admission timers are unref'd in production; keep this isolated child alive
    // long enough to reach the worker's default fatal path.
    setTimeout(() => {}, 750);
  `
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
    encoding: 'utf8',
    timeout: 5_000,
  })
  assert.equal(child.error, undefined, 'the child must reach the fatal path, not time out')
  assert.equal(child.status, 1, 'the default fatal supervisor terminates the worker process')
  const output = `${child.stdout ?? ''}\n${child.stderr ?? ''}`
  assert.match(output, /Routine worker state failed\. Restart is required before more work can run\./)
  assert.doesNotMatch(output, /private store cause/)
})

test('duplicate durable discovery and repeated start cannot duplicate a waiting or active run', async () => {
  const contexts = [routineContext('held'), routineContext('queued')]
  const state = harness(contexts)
  // A stale duplicate can be returned by recovery indexing; identity remains task/run.
  state.pendingOverride = [
    ...contexts.map((ctx) => ({ taskId: ctx.task.id, runId: ctx.run.id, nextAttemptAt: 1_000 })),
    { taskId: 'held', runId: 'run-held', nextAttemptAt: 1_000 },
    { taskId: 'queued', runId: 'run-queued', nextAttemptAt: 1_000 },
  ]
  const first = deferred()
  const started: string[] = []
  const runner = createRoutineRunner(state.store, (async (...args: Parameters<RoutineGenerate>) => {
    const id = routineId(args)
    const ctx = contexts.find((candidate) => candidate.task.id === id)
    assert.ok(ctx)
    started.push(ctx.task.id)
    if (ctx.task.id === 'held') await first.promise
    return result()
  }) as RoutineGenerate, { concurrency: { global: 1, perTenant: 1, perAgent: 1 } })

  try {
    runner.start()
    runner.start()
    await eventually(() => started.length === 1, 'the first unique run starts')
    runner.enqueue('held', 'run-held')
    runner.enqueue('held', 'run-held')
    runner.enqueue('queued', 'run-queued')
    runner.enqueue('queued', 'run-queued')
    assert.equal(started[0], 'held')
    assert.equal(state.rows.get('queued')?.run.attempts, 0)
    first.resolve()
    await eventually(() => state.rows.get('queued')?.run.status === 'ok', 'the waiting unique run completes')
    assert.deepEqual(started.sort(), ['held', 'queued'])
  } finally {
    first.resolve()
    runner.stop()
  }
})

test('retries release their slot before backoff and rejoin the queue later', async () => {
  const contexts = [routineContext('retry'), routineContext('other')]
  const state = harness(contexts)
  const otherStarted = deferred()
  const retrySecondStarted = deferred()
  const calls = new Map<string, number>()
  const runner = createRoutineRunner(state.store, (async (...args: Parameters<RoutineGenerate>) => {
    const id = routineId(args)
    const ctx = contexts.find((candidate) => candidate.task.id === id)
    assert.ok(ctx)
    const attempt = (calls.get(ctx.task.id) ?? 0) + 1
    calls.set(ctx.task.id, attempt)
    if (ctx.task.id === 'retry' && attempt === 1) {
      return result({ outcome: 'fallback', failure: 'endpoint_unavailable' })
    }
    if (ctx.task.id === 'other') otherStarted.resolve()
    if (ctx.task.id === 'retry' && attempt === 2) retrySecondStarted.resolve()
    return result()
  }) as RoutineGenerate, {
    concurrency: { global: 1, perTenant: 1, perAgent: 1 },
    retryBaseMs: 120,
  })

  runner.start()
  await within(otherStarted.promise, 'other run did not use the released slot')
  assert.equal(state.rows.get('retry')?.run.attempts, 1)
  assert.equal(state.rows.get('other')?.run.attempts, 1)
  await within(retrySecondStarted.promise, 'retry did not rejoin after backoff')
  await eventually(() => contexts.every((ctx) => ctx.run.status === 'ok'), 'both rows reach terminal success')
  runner.stop()
  assert.equal(calls.get('retry'), 2)
  assert.deepEqual(state.deferrals.map(({ id }) => id), ['retry'])
})

test('a rejected generation releases its slot after a terminal one-attempt failure', async () => {
  const contexts = [routineContext('rejecting'), routineContext('waiting')]
  contexts[0]!.run.maxAttempts = 1
  const state = harness(contexts)
  const calls: string[] = []
  const runner = createRoutineRunner(state.store, (async (...args: Parameters<RoutineGenerate>) => {
    const id = routineId(args)
    calls.push(id)
    if (id === 'rejecting') throw new Error('provider request failed')
    return result()
  }) as RoutineGenerate, { concurrency: { global: 1, perTenant: 1, perAgent: 1 } })

  runner.start()
  await eventually(() => contexts[0]!.run.status === 'failed', 'rejected work reaches its terminal attempt limit')
  await eventually(() => contexts[1]!.run.status === 'ok', 'the eligible queued run acquires the released slot')
  runner.stop()
  assert.deepEqual(calls, ['rejecting', 'waiting'])
  assert.equal(state.failures[0]?.code, 'execution_error')
  assert.deepEqual(state.deferrals, [], 'maxAttempts=1 fails terminally without a retry timer')
})

test('admission rechecks live context and budget, and ignores missing or terminal rows', async () => {
  const contexts = [
    routineContext('active'),
    routineContext('missing-queued'),
    routineContext('terminal-queued'),
  ]
  const state = harness(contexts)
  state.pendingOverride = contexts.map((ctx) => ({
    taskId: ctx.task.id,
    runId: ctx.run.id,
    nextAttemptAt: 1_000,
  }))
  const active = deferred()
  let calls = 0
  const runner = createRoutineRunner(state.store, (async () => {
    calls += 1
    await active.promise
    return result()
  }) as RoutineGenerate, { concurrency: { global: 1, perTenant: 1, perAgent: 1 } })

  runner.start()
  await eventually(() => calls === 1, 'one run takes the only slot')
  // Both rows were discovered while queued; one disappears and one becomes terminal.
  state.rows.delete('missing-queued')
  const terminal = state.rows.get('terminal-queued')!
  terminal.run.status = 'failed'
  active.resolve()
  await eventually(() => contexts[0].run.status === 'ok', 'active run settles')
  runner.stop()
  assert.equal(calls, 1, 'missing and terminal rows do not reach model I/O')
  assert.equal(state.rows.get('terminal-queued')?.run.status, 'failed')
})

test('a row queued behind active work uses current authority and budget at admission', async () => {
  for (const changed of ['context', 'budget'] as const) {
    const contexts = [routineContext(`active-${changed}`), routineContext(`queued-${changed}`)]
    const state = harness(contexts)
    if (changed === 'budget') {
      const queued = contexts[1]!
      queued.tenantId = 'tenant-over-budget'
      queued.task.tenantId = 'tenant-over-budget'
    }
    const gate = deferred()
    const calls: string[] = []
    const runner = createRoutineRunner(state.store, (async (...args: Parameters<RoutineGenerate>) => {
      const id = routineId(args)
      const ctx = contexts.find((candidate) => candidate.task.id === id)
      assert.ok(ctx)
      calls.push(ctx.task.id)
      if (ctx.task.id.startsWith('active')) await gate.promise
      return result()
    }) as RoutineGenerate, { concurrency: { global: 1, perTenant: 1, perAgent: 1 } })

    try {
      runner.start()
      await eventually(() => calls.length === 1, `${changed}: active row enters first`)
      assert.equal(contexts[1]?.run.attempts, 0, 'queued work has no attempt cursor yet')
      if (changed === 'context') state.blockedAtAdmission = new Set([`queued-${changed}`])
      else state.overBudgetTenants = new Set(['tenant-over-budget'])
      gate.resolve()
      await eventually(() => contexts[1]?.run.status === 'failed', `${changed}: changed admission state fails before generation`)
      assert.deepEqual(calls, [contexts[0]?.task.id])
      assert.ok((state.lookups.get(contexts[1]!.task.id) ?? 0) >= 2,
        'the queued row is re-resolved after it becomes eligible')
    } finally {
      gate.resolve()
      runner.stop()
    }
  }
})

test('stop clears a persisted retry wakeup before it can spend another attempt', async () => {
  const context = routineContext('stopped-retry')
  const state = harness([context])
  let calls = 0
  const runner = createRoutineRunner(state.store, (async () => {
    calls += 1
    return result({ outcome: 'fallback', failure: 'endpoint_unavailable' })
  }) as RoutineGenerate, { retryBaseMs: 40 })

  runner.start()
  await eventually(() => state.deferrals.length === 1, 'the retry is durably deferred')
  runner.stop()
  await new Promise<void>((resolve) => setTimeout(resolve, 60))
  assert.equal(calls, 1, 'a cleared retry timer does not fire after stop')
  assert.equal(context.run.attempts, 1)
  assert.equal(context.run.status, 'running', 'the row remains recoverable')
})

test('stop drops queued work and fences an abort-ignoring result until it settles', async () => {
  const contexts = [routineContext('held-stop'), routineContext('queued-stop')]
  const state = harness(contexts)
  const held = deferred()
  const entered = deferred()
  let calls = 0
  const runner = createRoutineRunner(state.store, (async (...args: Parameters<RoutineGenerate>) => {
    calls += 1
    entered.resolve()
    await held.promise // intentionally ignores AbortSignal
    return result()
  }) as RoutineGenerate, { concurrency: { global: 1, perTenant: 1, perAgent: 1 } })

  runner.start()
  await entered.promise
  runner.stop()
  assert.equal(contexts[1]?.run.attempts, 0, 'stop discards rows that never acquired a slot')
  held.resolve()
  // Let both the generator and worker promise continuations run. Polling for
  // the pre-existing `running` status could pass before the late result arrives.
  await new Promise<void>((resolve) => setImmediate(resolve))
  assert.equal(state.rows.get('held-stop')?.run.status, 'running', 'stopped work leaves durable recovery state running')
  assert.equal(calls, 1)
  assert.deepEqual(state.completions, [])
  assert.deepEqual(state.failures, [])
})

test('restart cannot overlap an abort-ignoring call or release its global capacity early', async () => {
  const contexts = [routineContext('same-run'), routineContext('next-run', 'tenant-b', 'agent-next')]
  const state = harness(contexts)
  const first = deferred()
  const second = deferred()
  let sameRunCalls = 0
  let nextRunCalls = 0
  const runner = createRoutineRunner(state.store, (async (...args: Parameters<RoutineGenerate>) => {
    const id = routineId(args)
    const ctx = contexts.find((candidate) => candidate.task.id === id)
    assert.ok(ctx)
    if (ctx.task.id === 'same-run') {
      sameRunCalls += 1
      await (sameRunCalls === 1 ? first.promise : second.promise)
    } else {
      nextRunCalls += 1
      await second.promise
    }
    return result()
  }) as RoutineGenerate, { concurrency: { global: 1, perTenant: 1, perAgent: 1 } })

  runner.start()
  await eventually(() => sameRunCalls === 1, 'original turn starts')
  runner.stop()
  runner.start()
  await new Promise<void>((resolve) => setTimeout(resolve, 20))
  assert.equal(sameRunCalls, 1, 'the in-flight durable row is not restarted on top of itself')
  assert.equal(nextRunCalls, 0, 'the occupied global slot is not transferred while old I/O is unresolved')

  first.resolve()
  await eventually(() => sameRunCalls === 2, 'the same durable row restarts only after old I/O settles')
  assert.equal(state.rows.get('same-run')?.run.status, 'running', 'the old result cannot settle after stop')
  second.resolve()
  await eventually(() => nextRunCalls === 1, 'the sibling receives capacity after the restarted row settles')
  await eventually(() => state.rows.get('next-run')?.run.status === 'ok', 'newly admitted work completes')
  runner.stop()
  assert.equal(sameRunCalls, 2)
  assert.equal(nextRunCalls, 1)
})
