import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Message, ScheduledRun, ScheduledTask } from '../contract/index.ts'
import type { McpBoundToolCall } from '../contract/mcpExecution.ts'
import type { McpConnectionView } from '../contract/mcpConnections.ts'
import type { RoutineMcpCallReceipt, RoutineMcpToolPermission } from '../contract/routineMcp.ts'
import type { ReplyResult } from './generate.ts'
import { createRoutineRunner, type RoutineGenerate, type RoutineRunStore } from './routineRunner.ts'
import type { RoutineExecutionContext } from './store/index.ts'
import type { RoutineMcpRuntime } from './model/connectorTools.ts'

const connectionId = `mcp-connection-${'a'.repeat(32)}`
const permission: RoutineMcpToolPermission = {
  connectionId, connectionRevision: 4, toolName: 'search', schemaHash: 'a'.repeat(64), fixedArguments: {},
}
const connection: McpConnectionView = {
  id: connectionId, label: 'Search', status: 'connected', revision: 4, authentication: 'none',
  protocolVersion: '2026-07-28', inspectedAt: 1, tools: [{ name: 'search', inputSchema: { type: 'object' } }],
  execution: 'approval-required', executableTools: ['search'],
}

function setup() {
  const run: ScheduledRun = {
    id: 'run-1', status: 'running', duration: '—', reachedStep: 0, summary: 'Queued', at: 1,
    attempts: 0, maxAttempts: 3, nextAttemptAt: Date.now(),
  }
  const task = {
    id: 'routine-1', name: 'Brief', enabled: true, runs: [run],
    steps: [], delivery: { target: 'owner' }, effort: 'medium',
  } as unknown as ScheduledTask
  let reserved = false
  let calls = 0
  const runtime: RoutineMcpRuntime = {
    tools: [permission],
    async execute(call: McpBoundToolCall): Promise<RoutineMcpCallReceipt> {
      reserved = true
      calls += 1
      return { id: 'receipt-1', call, startedAt: 1, status: 'pending' }
    },
  }
  const context = {
    task, run, sessionId: 'routine-session', tenantId: 'tenant-1',
    agent: { id: 'agent-1', budget: {} }, provider: { id: 'provider-1' }, providerConfig: {},
    contexts: [{ id: connectionId, type: 'mcp', label: 'Search', scope: '*' }],
    approvedContextIds: new Set([connectionId]),
    externalMcpConnections: [connection], routineMcp: runtime,
  } as unknown as RoutineExecutionContext
  const state = { reserved, calls, deferrals: 0, failures: [] as string[], completed: false, context }
  const runStore: RoutineRunStore = {
    pendingScheduleRuns: () => run.status === 'running' ? [{ taskId: task.id, runId: run.id, nextAttemptAt: run.nextAttemptAt ?? Date.now() }] : [],
    routineExecutionContext: (taskId, runId) => taskId === task.id && runId === run.id && run.status === 'running' ? context : undefined,
    routineMcpRunMayRetry: () => !reserved,
    markScheduleRunAttempt: (_taskId, _runId, attempt, at = Date.now()) => {
      run.attempts = attempt; run.nextAttemptAt = at; return run
    },
    deferScheduleRun: (_taskId, _runId, at) => { run.nextAttemptAt = at; state.deferrals += 1; return run },
    completeScheduleRun: (_taskId, _runId, _message, _provenance, _at) => { run.status = 'ok'; state.completed = true; return run },
    failScheduleRun: (_taskId, _runId, code) => { run.status = 'failed'; state.failures.push(code); return run },
    overSpendLimit: () => null,
    recordUsage: () => {},
    recordGenerationOutcome: () => {},
  }
  return { state, runStore, runtime, context, getCalls: () => calls, setReserved: (value: boolean) => { reserved = value } }
}

const generated = (): ReplyResult => ({
  message: { id: 'm', role: 'assistant', content: 'done' } as Message,
  usage: { inputTokens: 0, outputTokens: 0 }, outcome: 'ok',
})

async function waitForTerminal(context: RoutineExecutionContext): Promise<void> {
  const deadline = Date.now() + 1000
  while (context.run.status === 'running' && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 2))
  assert.notEqual(context.run.status, 'running', 'run reaches a terminal state')
}

test('runner forwards explicit Routine MCP runtime and does not retry a thrown generation after reservation', async () => {
  const { state, runStore, runtime, context, getCalls } = setup()
  let generationCalls = 0
  const generate = (async (...args: Parameters<RoutineGenerate>) => {
    generationCalls += 1
    assert.equal(args[9]?.routineMcp, runtime)
    assert.deepEqual(args[9]?.externalMcpConnections, [connection])
    await args[9]!.routineMcp!.execute({
      connectionId, connectionRevision: 4, toolName: 'search', schemaHash: permission.schemaHash, arguments: {},
    }, 'host-owned-key')
    throw new Error('model endpoint disconnected after MCP reservation')
  }) as RoutineGenerate
  const runner = createRoutineRunner(runStore, generate, { retryBaseMs: 1 })
  runner.start()
  await waitForTerminal(context)
  runner.stop()
  assert.equal(getCalls(), 1)
  assert.equal(generationCalls, 1, 'reserved external work blocks prompt replay')
  assert.equal(state.deferrals, 0)
  assert.deepEqual(state.failures, ['execution_error'])
})

test('model failure remains retryable while the durable MCP ledger is empty', async () => {
  const { state, runStore, context } = setup()
  runStore.routineMcpRunMayRetry = () => true
  let generationCalls = 0
  const generate = (async () => {
    generationCalls += 1
    if (generationCalls === 1) throw new Error('temporary model failure before any MCP reservation')
    return generated()
  }) as RoutineGenerate
  const runner = createRoutineRunner(runStore, generate, { retryBaseMs: 1 })
  runner.start()
  await waitForTerminal(context)
  runner.stop()
  assert.equal(generationCalls, 2)
  assert.equal(state.deferrals, 1)
  assert.equal(state.completed, true)
})

test('recovered run with a prior reservation does not re-enter model generation', async () => {
  const { state, runStore, context, setReserved } = setup()
  setReserved(true)
  let generationCalls = 0
  const runner = createRoutineRunner(runStore, (async () => {
    generationCalls += 1
    return generated()
  }) as RoutineGenerate)
  runner.start()
  await waitForTerminal(context)
  runner.stop()
  assert.equal(generationCalls, 0)
  assert.deepEqual(state.failures, ['execution_error'])
  assert.equal(state.deferrals, 0)
})
