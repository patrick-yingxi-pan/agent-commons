/** Local-wire regression tests for terminal provider rejection in unattended runs. */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { DEFAULT_PROVIDER_ID, type ModelProvider, type ScheduledRun, type ScheduledTask } from '../contract/index.ts'
import { generateReply } from './generate.ts'
import { DEFAULT_AGENT } from './data/workers.ts'
import type { ProviderConfig } from './data/providers.ts'
import { createRoutineRunner, type RoutineRunStore } from './routineRunner.ts'
import type { RoutineExecutionContext } from './store/index.ts'

const privateKey = 'provider-private-test-key'
const privateBody = 'provider-private-error-body'

function makeProvider(protocol: 'anthropic-messages' | 'openai-responses', baseURL: string): ProviderConfig {
  return {
    protocol,
    baseURL,
    apiKeyEnv: 'PROVIDER_ROUTINE_REJECTION_TEST_KEY',
    model: protocol === 'openai-responses' ? 'gpt-test' : 'claude-test',
    capabilities: { toolUse: true },
  }
}

function fakeContext(config: ProviderConfig): { context: RoutineExecutionContext; run: ScheduledRun } {
  const run: ScheduledRun = {
    id: 'run-provider-rejected', status: 'running', duration: '—', reachedStep: 0,
    summary: 'Queued', at: 1_000, attempts: 0, maxAttempts: 3, nextAttemptAt: 1_000,
  }
  const task: ScheduledTask = {
    id: 'routine-provider-rejected', tenantId: 'tenant-1', name: 'Provider rejection check',
    cadence: 'Daily at 09:00', next: 'tomorrow', enabled: true, lastStatus: 'pending',
    subtitle: 'Provider rejection check', trigger: 'Every day at 09:00', prompt: 'Prepare a short status.',
    steps: [], delivery: { tool: { id: 'none', label: 'None', tone: 'connector' }, target: '' },
    runs: [run], model: 'Test model', agentId: DEFAULT_AGENT.id, providerId: DEFAULT_PROVIDER_ID,
    modelId: config.model,
  }
  const provider: ModelProvider = {
    id: DEFAULT_PROVIDER_ID, label: 'Test provider', modelFamily: 'claude', effortLevels: [], models: [],
  }
  return {
    run,
    context: {
      task, run, sessionId: 'session-provider-rejected', tenantId: 'tenant-1', agent: DEFAULT_AGENT,
      provider, providerConfig: config, modelId: config.model, contexts: [], approvedContextIds: new Set(),
    },
  }
}

function runStore(context: RoutineExecutionContext, onSettled: () => void, result: {
  deferrals: number[]; completions: number; failures: Array<{ code: string; detail: string }>
}): RoutineRunStore {
  return {
    pendingScheduleRuns: () => context.run.status === 'running'
      ? [{ taskId: context.task.id, runId: context.run.id, nextAttemptAt: context.run.nextAttemptAt ?? 1_000 }]
      : [],
    routineExecutionContext: () => context.run.status === 'running' ? context : undefined,
    markScheduleRunAttempt: (_taskId, _runId, attempt) => { context.run.attempts = attempt; return context.run },
    deferScheduleRun: (_taskId, _runId, nextAttemptAt) => {
      context.run.nextAttemptAt = nextAttemptAt
      result.deferrals.push(nextAttemptAt)
      onSettled()
      return context.run
    },
    completeScheduleRun: () => {
      context.run.status = 'ok'
      result.completions += 1
      onSettled()
      return context.run
    },
    failScheduleRun: (_taskId, _runId, code, detail) => {
      context.run.status = 'failed'
      result.failures.push({ code, detail })
      onSettled()
      return context.run
    },
    overSpendLimit: () => null,
    recordUsage: () => {},
    recordGenerationOutcome: () => {},
  }
}

async function readRequest(request: IncomingMessage): Promise<{ path: string; apiKey?: string; authorization?: string }> {
  for await (const _chunk of request) { /* drain the SDK request body */ }
  return {
    path: new URL(request.url ?? '/', 'http://127.0.0.1').pathname,
    apiKey: request.headers['x-api-key'] as string | undefined,
    authorization: request.headers.authorization,
  }
}

for (const protocol of ['anthropic-messages', 'openai-responses'] as const) {
  test(`Routine treats ${protocol} HTTP 401 as terminal and keeps provider diagnostics private`, async () => {
    let wireRequests = 0
    let seenCredential: string | undefined
    let seenPath: string | undefined
    const server = createServer(async (request, response: ServerResponse) => {
      const seen = await readRequest(request)
      wireRequests += 1
      seenCredential = seen.apiKey ?? seen.authorization
      seenPath = seen.path
      response.writeHead(401, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ error: { message: privateBody } }))
    })
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', resolve)
    })
    const address = server.address()
    assert.ok(address && typeof address === 'object')
    const baseURL = `http://127.0.0.1:${address.port}${protocol === 'openai-responses' ? '/v1' : ''}`
    const previous = process.env.PROVIDER_ROUTINE_REJECTION_TEST_KEY
    process.env.PROVIDER_ROUTINE_REJECTION_TEST_KEY = privateKey
    let stopRunner = () => {}
    try {
      const { context, run } = fakeContext(makeProvider(protocol, baseURL))
      const result = { deferrals: [] as number[], completions: 0, failures: [] as Array<{ code: string; detail: string }> }
      let settled!: () => void
      const terminal = new Promise<void>(resolve => { settled = resolve })
      const runner = createRoutineRunner(runStore(context, settled, result), generateReply, {
        now: () => 1_000,
        retryBaseMs: 100_000,
      })
      stopRunner = () => runner.stop()
      runner.start()
      let timeout: ReturnType<typeof setTimeout> | undefined
      try {
        await Promise.race([
          terminal,
          new Promise<never>((_, reject) => { timeout = setTimeout(() => reject(new Error('Routine did not settle')), 5_000) }),
        ])
      } finally {
        if (timeout) clearTimeout(timeout)
      }
      stopRunner()

      assert.equal(wireRequests, 1, 'known authorization rejection is not resent')
      assert.equal(seenPath, protocol === 'anthropic-messages' ? '/v1/messages' : '/v1/responses')
      assert.equal(seenCredential, protocol === 'anthropic-messages' ? privateKey : `Bearer ${privateKey}`)
      assert.equal(run.attempts, 1)
      assert.deepEqual(result.deferrals, [])
      assert.equal(result.completions, 0)
      assert.equal(result.failures[0]?.code, 'model_unavailable')
      assert.match(result.failures[0]?.detail ?? '', /401/)
      assert.match(result.failures[0]?.detail ?? '', /key|credential|authorization|endpoint|provider/i)
      assert.doesNotMatch(result.failures[0]?.detail ?? '', new RegExp(privateBody))
      assert.doesNotMatch(result.failures[0]?.detail ?? '', new RegExp(privateKey))
    } finally {
      stopRunner()
      if (previous === undefined) delete process.env.PROVIDER_ROUTINE_REJECTION_TEST_KEY
      else process.env.PROVIDER_ROUTINE_REJECTION_TEST_KEY = previous
      server.closeAllConnections?.()
      await new Promise<void>(resolve => server.close(() => resolve()))
    }
  })
}
