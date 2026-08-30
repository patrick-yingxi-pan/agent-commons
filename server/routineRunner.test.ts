import { test } from 'node:test'
import assert from 'node:assert/strict'
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
import { createRoutineRunner, type RoutineGenerate, type RoutineRunStore } from './routineRunner.ts'
import type { RoutineExecutionContext } from './store/index.ts'

const agent: Agent = {
  id: 'agent-routine',
  label: 'Routine Agent',
  systemPrompt: 'Complete the routine.',
  tools: ['create_project'],
  instructions: 'Stay concise.',
  providerId: DEFAULT_PROVIDER_ID,
}
const provider: ModelProvider = {
  id: DEFAULT_PROVIDER_ID,
  label: 'Anthropic',
  modelFamily: 'claude',
  effortLevels: ['High'],
  models: [{ id: 'claude-opus-4-8', label: 'Claude Opus 4.8' }],
}
const task = (): ScheduledTask => ({
  id: 'routine-1',
  tenantId: 'tenant-1',
  name: 'Morning brief',
  cadence: 'Daily at 09:00',
  next: 'tomorrow',
  enabled: true,
  lastStatus: 'pending',
  subtitle: 'A briefing',
  trigger: 'Every day at 09:00',
  prompt: 'Prepare the briefing.',
  steps: [{ id: 'step-1', action: 'Read updates', tool: { id: 'slack', label: 'Slack', tone: 'connector' } }],
  delivery: { tool: { id: 'slack', label: 'Slack', tone: 'connector' }, target: '#briefing' },
  runs: [],
  model: 'Claude Opus 4.8 · High',
  agentId: agent.id,
  providerId: provider.id,
  modelId: 'claude-opus-4-8',
  effort: 'High',
})

interface FakeState {
  context: RoutineExecutionContext
  deferrals: number[]
  completions: Message[]
  failures: Array<{ code: NonNullable<ScheduledRun['failureCode']>; detail: string }>
  usage: Array<[number, number, string | undefined]>
  outcomes: string[]
  overBudget: boolean
}

function fakeState(blocked?: RoutineExecutionContext['blocked']): FakeState {
  const routine = task()
  const run: ScheduledRun = {
    id: 'run-1', status: 'running', duration: '—', reachedStep: 0,
    summary: 'Queued', at: 1_000, attempts: 0, maxAttempts: 3, nextAttemptAt: 1_000,
  }
  routine.runs = [run]
  const contexts: SessionContext[] = [{ id: 'slack', type: 'connector', label: 'Slack', scope: '*' }]
  return {
    context: {
      task: routine,
      run,
      sessionId: 'srun-routine-1-run-1',
      tenantId: 'tenant-1',
      agent,
      provider,
      providerConfig: {},
      modelId: 'claude-opus-4-8',
      contexts,
      approvedContextIds: new Set(['slack']),
      ...(blocked ? { blocked } : {}),
    },
    deferrals: [],
    completions: [],
    failures: [],
    usage: [],
    outcomes: [],
    overBudget: false,
  }
}

function fakeStore(state: FakeState): RoutineRunStore {
  const { context } = state
  return {
    pendingScheduleRuns: () => context.run.status === 'running'
      ? [{ taskId: context.task.id, runId: context.run.id, nextAttemptAt: context.run.nextAttemptAt ?? 1_000 }]
      : [],
    routineExecutionContext: (taskId, runId) =>
      context.task.id === taskId && context.run.id === runId && context.run.status === 'running' ? context : undefined,
    markScheduleRunAttempt: (_taskId, _runId, attempt, at = 1_000) => {
      context.run.attempts = attempt
      context.run.nextAttemptAt = at
      return context.run
    },
    deferScheduleRun: (_taskId, _runId, nextAttemptAt) => {
      context.run.nextAttemptAt = nextAttemptAt
      state.deferrals.push(nextAttemptAt)
      return context.run
    },
    completeScheduleRun: (_taskId, _runId, message) => {
      context.run.status = 'ok'
      state.completions.push(message)
      return context.run
    },
    failScheduleRun: (_taskId, _runId, code, detail) => {
      context.run.status = 'failed'
      context.run.failureCode = code
      state.failures.push({ code, detail })
      return context.run
    },
    overSpendLimit: () => state.overBudget ? { label: 'Agent monthly', ceiling: 100 } : null,
    recordUsage: (input, output, tenantId) => state.usage.push([input, output, tenantId]),
    recordGenerationOutcome: (outcome) => state.outcomes.push(outcome),
  }
}

function generated(overrides: Partial<ReplyResult> = {}): ReplyResult {
  return {
    message: { id: 'm-routine', role: 'assistant', content: 'The briefing is ready.' },
    usage: { inputTokens: 12, outputTokens: 8 },
    outcome: 'ok',
    ...overrides,
  }
}

async function settle(state: FakeState, timeoutMs = 250): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (state.context.run.status === 'running' && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 2))
  }
  assert.notEqual(state.context.run.status, 'running', 'the routine settled before the test deadline')
}

test('a recovered durable row executes one model turn with its exact standing contexts and provenance', async () => {
  const state = fakeState()
  let call: Parameters<RoutineGenerate> | undefined
  const generate = (async (...args: Parameters<RoutineGenerate>) => {
    call = args
    return generated()
  }) as RoutineGenerate
  const runner = createRoutineRunner(fakeStore(state), generate, { now: () => 1_000, retryBaseMs: 1 })
  runner.start()
  await settle(state)
  runner.stop()

  assert.equal(state.context.run.attempts, 1)
  assert.equal(state.completions[0]?.content, 'The briefing is ready.')
  assert.deepEqual(state.usage, [[12, 8, 'tenant-1']])
  assert.deepEqual(state.outcomes, ['ok'])
  assert.equal(call?.[5]?.model, 'claude-opus-4-8', 'the persisted model id overrides endpoint inheritance')
  assert.deepEqual(call?.[7], state.context.contexts)
  assert.equal(call?.[9]?.standingApprovedContextIds?.has('slack'), true)
  assert.equal(call?.[9]?.effort, 'High')
  assert.deepEqual(call?.[1].tools, [], 'interactive proposal tools are withheld from a headless turn')
  assert.match(call?.[1].instructions ?? '', /unattended scheduled run/i)
})

test('transient endpoint loss persists a retry cursor, then succeeds on the next attempt', async () => {
  const state = fakeState()
  let calls = 0
  const generate = (async () => {
    calls += 1
    return calls === 1
      ? generated({ outcome: 'fallback', failure: 'endpoint_unavailable' })
      : generated()
  }) as RoutineGenerate
  const runner = createRoutineRunner(fakeStore(state), generate, { now: () => 1_000, retryBaseMs: 1 })
  runner.start()
  await settle(state)
  runner.stop()

  assert.equal(calls, 2)
  assert.equal(state.context.run.attempts, 2)
  assert.deepEqual(state.deferrals, [1_001])
  assert.deepEqual(state.outcomes, ['fallback', 'ok'])
  assert.equal(state.completions.length, 1)
})

test('a deterministic tool-loop limit fails once and is never retried', async () => {
  const state = fakeState()
  let calls = 0
  const generate = (async () => {
    calls += 1
    return generated({ outcome: 'fallback', failure: 'tool_loop_limit' })
  }) as RoutineGenerate
  const runner = createRoutineRunner(fakeStore(state), generate, { now: () => 1_000, retryBaseMs: 1 })
  runner.start()
  await settle(state)
  runner.stop()

  assert.equal(calls, 1)
  assert.deepEqual(state.deferrals, [])
  assert.equal(state.failures[0]?.code, 'model_loop_limit')
})

test('a failed connector effect cannot complete a routine from the model prose', async () => {
  const state = fakeState()
  let calls = 0
  const generate = (async () => {
    calls += 1
    return generated({
      message: {
        id: 'm-connector-failed',
        role: 'assistant',
        content: 'The briefing is ready.',
        toolActivities: [{
          id: 'act-failed',
          tool: 'connector__slack__list',
          connector: 'Slack',
          connectorId: 'slack',
          kind: 'read',
          status: 'failed',
          summary: 'Connector execution is not configured in this release.',
          failure: { code: 'connector_unconfigured', retryable: false },
        }],
      },
    })
  }) as RoutineGenerate
  const runner = createRoutineRunner(fakeStore(state), generate, { now: () => 1_000, retryBaseMs: 1 })
  runner.start()
  await settle(state)
  runner.stop()

  assert.equal(calls, 1)
  assert.equal(state.completions.length, 0, 'model prose cannot overrule a failed effect')
  assert.deepEqual(state.deferrals, [], 'an unconfigured runtime is deterministic, so it is not hot-loop retried')
  assert.equal(state.failures[0]?.code, 'context_unavailable')
  assert.match(state.failures[0]?.detail ?? '', /not configured/i)
})

test('context/authority refusal and budget exhaustion fail before model I/O', async () => {
  for (const scenario of ['context', 'budget'] as const) {
    const state = fakeState(scenario === 'context'
      ? { code: 'context_unavailable', detail: 'Connect Slack before this routine can run.' }
      : undefined)
    state.overBudget = scenario === 'budget'
    let calls = 0
    const generate = (async () => {
      calls += 1
      return generated()
    }) as RoutineGenerate
    const runner = createRoutineRunner(fakeStore(state), generate, { now: () => 1_000, retryBaseMs: 1 })
    runner.start()
    await settle(state)
    runner.stop()

    assert.equal(calls, 0, `${scenario} is checked before dialing the endpoint`)
    assert.equal(state.failures[0]?.code, scenario === 'context' ? 'context_unavailable' : 'budget_exceeded')
  }
})

test('stopping during model I/O leaves the durable row running for restart recovery', async () => {
  const state = fakeState()
  let started!: () => void
  const entered = new Promise<void>((resolve) => { started = resolve })
  let release!: () => void
  const held = new Promise<void>((resolve) => { release = resolve })
  const generate = (async () => {
    started()
    await held // deliberately ignores AbortSignal: the worker must still fence it
    return generated()
  }) as RoutineGenerate
  const runner = createRoutineRunner(fakeStore(state), generate, { now: () => 1_000, retryBaseMs: 1 })
  runner.start()
  await new Promise((resolve) => setTimeout(resolve, 2))
  await entered
  runner.stop()
  release()
  await new Promise((resolve) => setTimeout(resolve, 2))

  assert.equal(state.context.run.status, 'running')
  assert.equal(state.failures.length, 0)
  assert.equal(state.completions.length, 0)
})
