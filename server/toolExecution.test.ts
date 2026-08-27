/** ── Shared tool-execution guard ────────────────────────────────────────────
 *  Both model transports execute through this seam. These tests lock the
 *  production-safety properties at the seam itself: a non-conformant endpoint
 *  cannot fan out an unbounded batch, one failed/hung tool cannot collapse or
 *  monopolize the rest of the batch, and caller cancellation still stops the
 *  turn instead of being converted into a model-visible tool error. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { RelationOp, ToolActivity } from '../contract/index.ts'
import type { ApiOperation } from './apiSurface.ts'
import type { ApiToolRuntime } from './model/apiTools.ts'
import type { ToolContext } from './model/tools.ts'
import { executeToolBatch, toolExecutionLimits, toolLoopLimits } from './toolExecution.ts'

const READ_USAGE: ApiOperation = {
  method: 'GET',
  pattern: '/usage',
  name: 'get_usage',
  params: [],
  access: { kind: 'product', session: 'tool' },
}

const ok = () => ({
  status: 200,
  headers: { 'content-type': 'application/json; charset=utf-8' },
  body: Buffer.from('{"ok":true}'),
})

function harness(dispatch: ApiToolRuntime['dispatch']) {
  const context: ToolContext = { session: { id: 'sess-guard', title: 'Guard' } }
  const relationOps: RelationOp[] = []
  const toolActivities: ToolActivity[] = []
  return {
    context,
    relationOps,
    toolActivities,
    options: {
      declaredNames: new Set(['api__get_usage']),
      connectorBindings: new Map(),
      api: { catalog: [READ_USAGE], dispatch },
      context,
      relationOps,
      toolActivities,
    },
  }
}

const calls = [
  { id: 'tc-1', name: 'api__get_usage', input: {} },
  { id: 'tc-2', name: 'api__get_usage', input: {} },
]

test('a tool batch executes only its admitted prefix and returns a structured error for every excess call', async () => {
  const ran: string[] = []
  const h = harness(async (_method, path) => {
    ran.push(path)
    return ok()
  })
  const out = await executeToolBatch(calls, { ...h.options, limits: { maxCalls: 1, timeoutMs: 100 } })

  assert.deepEqual(ran, ['/usage'], 'the excess call never reached an executor')
  assert.equal(out.results.length, calls.length, 'every tool_use receives a matching tool_result')
  assert.equal(out.results[0].isError, undefined)
  assert.equal(out.results[1].isError, true)
  assert.match(out.results[1].content, /batch limit/i)
})

test('a thrown executor error is isolated and the next call still runs', async () => {
  let attempts = 0
  const h = harness(async () => {
    attempts += 1
    if (attempts === 1) throw new Error('internal credential detail must not leak')
    return ok()
  })
  const out = await executeToolBatch(calls, { ...h.options, limits: { maxCalls: 2, timeoutMs: 100 } })

  assert.equal(attempts, 2, 'the batch continued after the first executor failed')
  assert.equal(out.results[0].isError, true)
  assert.match(out.results[0].content, /failed/i)
  assert.doesNotMatch(out.results[0].content, /credential detail/, 'raw executor errors stay server-side')
  assert.equal(out.results[1].isError, undefined)
  assert.deepEqual(h.toolActivities.map((a) => a.id), ['tc-2'], 'only the completed read commits provenance')
})

test('a hung executor is timed out and cannot monopolize the remaining batch', async () => {
  let attempts = 0
  const h = harness(async () => {
    attempts += 1
    if (attempts === 1) return await new Promise<ReturnType<typeof ok>>(() => {})
    return ok()
  })
  const started = Date.now()
  const out = await executeToolBatch(calls, { ...h.options, limits: { maxCalls: 2, timeoutMs: 20 } })

  assert.ok(Date.now() - started < 500, 'the hung read was bounded by the per-tool deadline')
  assert.equal(attempts, 2)
  assert.equal(out.results[0].isError, true)
  assert.match(out.results[0].content, /deadline/i)
  assert.equal(out.results[1].isError, undefined)
})

test('caller cancellation stops a hung tool batch instead of becoming a recoverable tool error', async () => {
  const h = harness(async () => await new Promise<ReturnType<typeof ok>>(() => {}))
  const controller = new AbortController()
  setTimeout(() => controller.abort(), 20)
  await assert.rejects(
    executeToolBatch(calls.slice(0, 1), {
      ...h.options,
      limits: { maxCalls: 1, timeoutMs: 1_000 },
      signal: controller.signal,
    }),
    /cancelled/i,
  )
})

test('operator limits are safe by default and a batch-count misconfiguration cannot remove the hard ceiling', () => {
  assert.deepEqual(toolExecutionLimits({}), { maxCalls: 16, timeoutMs: 10_000 })
  assert.deepEqual(toolExecutionLimits({ MODEL_MAX_TOOL_CALLS: '999', MODEL_TOOL_TIMEOUT_MS: '25' }), {
    maxCalls: 64,
    timeoutMs: 25,
  })
  assert.equal(toolExecutionLimits({ MODEL_MAX_TOOL_CALLS: '0' }).maxCalls, 0, 'operators may fail closed without hiding tools')
  assert.deepEqual(toolLoopLimits({}), { maxBatches: 4 })
  assert.deepEqual(toolLoopLimits({ MODEL_MAX_TOOL_ROUNDS: '999' }), { maxBatches: 8 })
  assert.equal(toolLoopLimits({ MODEL_MAX_TOOL_ROUNDS: '0' }).maxBatches, 0, 'operators may fail closed before any tool batch executes')
})
