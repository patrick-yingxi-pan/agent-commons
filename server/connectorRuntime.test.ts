import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { ToolActivity } from '../contract/index.ts'
import {
  connectorRuntimeMode,
  connectorToolRuntime,
  executeConnectorActivity,
  fixtureConnectorRuntime,
  invokeConnectorRuntime,
  MAX_CONNECTOR_INPUT_CHARS,
  MAX_CONNECTOR_RESULT_CHARS,
  type ConnectorToolRuntime,
} from './connectorRuntime.ts'

test('development is explicitly fixture-backed while every release-shaped boot fails closed', () => {
  assert.equal(connectorRuntimeMode({}), 'fixture')
  assert.equal(connectorRuntimeMode({ DEPLOYMENT_PROFILE: 'desktop' }), 'unconfigured')
  assert.equal(connectorRuntimeMode({ DEPLOYMENT_PROFILE: 'web' }), 'unconfigured')
  assert.equal(connectorRuntimeMode({ DEPLOYMENT_PROFILE: 'desktop', CONNECTOR_RUNTIME: 'fixture' }), 'unconfigured')
  assert.equal(connectorToolRuntime({ CONNECTOR_RUNTIME: 'unconfigured' }).mode, 'unconfigured')
  assert.throws(() => connectorRuntimeMode({ CONNECTOR_RUNTIME: 'magic' }), /must be fixture or unconfigured/)
})

test('fixture fulfilment stays visibly mock and release fulfilment never reports success', async () => {
  const invocation = {
    invocationId: 'act-read',
    tool: 'connector__slack__list',
    connectorId: 'slack',
    connector: 'Slack',
    kind: 'read' as const,
    input: {},
    developmentFixtureSummary: '(mock) Channels: #launch.',
  }
  assert.deepEqual(await fixtureConnectorRuntime.execute(invocation), { ok: true, summary: '(mock) Channels: #launch.' })
  const release = await connectorToolRuntime({ DEPLOYMENT_PROFILE: 'desktop' }).execute(invocation)
  assert.equal(release.ok, false)
  if (!release.ok) assert.equal(release.failure.code, 'connector_unconfigured')
})

test('consent execution forwards the exact persisted tool input to the adapter', async () => {
  let seen: Parameters<ConnectorToolRuntime['execute']>[0] | undefined
  const adapter: ConnectorToolRuntime = {
    mode: 'adapter',
    async execute(invocation) {
      seen = invocation
      return { ok: true, summary: 'saved' }
    },
  }
  const activity: ToolActivity = {
    id: 'act-1',
    tool: 'mcp__filesystem__write_file',
    connectorId: 'filesystem',
    connector: 'MCP · filesystem',
    kind: 'action',
    status: 'proposed',
    summary: 'Proposed write',
    input: { path: 'notes/launch.md', content: 'Ship it' },
  }

  assert.deepEqual(await executeConnectorActivity(activity, adapter), { ok: true, summary: 'saved' })
  assert.equal(seen?.invocationId, activity.id, 'consent retries reuse the persisted idempotency identity')
  assert.equal(seen?.tool, activity.tool)
  assert.equal(seen?.connectorId, activity.connectorId)
  assert.equal(seen?.connector, activity.connector)
  assert.equal(seen?.kind, activity.kind)
  assert.deepEqual(seen?.input, activity.input)
  assert.ok(seen?.signal instanceof AbortSignal)
})

test('consent execution bounds a hung adapter and aborts its in-flight work', async () => {
  let signal: AbortSignal | undefined
  const hung: ConnectorToolRuntime = {
    mode: 'adapter',
    async execute(invocation) {
      signal = invocation.signal
      return await new Promise(() => {})
    },
  }
  const activity: ToolActivity = {
    id: 'act-hung',
    tool: 'mcp__filesystem__write_file',
    connectorId: 'filesystem',
    connector: 'MCP · filesystem',
    kind: 'action',
    status: 'proposed',
    summary: 'Proposed write',
  }

  const result = await executeConnectorActivity(activity, hung, { timeoutMs: 5 })
  assert.equal(result.ok, false)
  if (!result.ok) {
    assert.equal(result.failure.code, 'connector_unavailable')
    assert.equal(result.failure.retryable, true)
  }
  assert.equal(signal?.aborted, true, 'deadline cancellation reaches the adapter')
})

test('an adapter that rejects on abort still reports the stable timeout failure', async () => {
  const aborting: ConnectorToolRuntime = {
    mode: 'adapter',
    async execute(invocation) {
      return await new Promise((_, reject) => {
        invocation.signal?.addEventListener('abort', () => reject(new Error('adapter observed abort')), { once: true })
      })
    },
  }
  const activity: ToolActivity = {
    id: 'act-abort-reject',
    tool: 'mcp__filesystem__write_file',
    connectorId: 'filesystem',
    connector: 'MCP · filesystem',
    kind: 'action',
    status: 'proposed',
    summary: 'Proposed write',
  }

  const result = await executeConnectorActivity(activity, aborting, { timeoutMs: 5 })
  assert.equal(result.ok, false)
  if (!result.ok) assert.equal(result.failure.code, 'connector_unavailable')
})

test('adapter exceptions become stable non-secret failures', async () => {
  const throwing: ConnectorToolRuntime = {
    mode: 'adapter',
    async execute() {
      throw new Error('credential=do-not-leak')
    },
  }
  const activity: ToolActivity = {
    id: 'act-throw',
    tool: 'connector__slack__post',
    connectorId: 'slack',
    connector: 'Slack',
    kind: 'action',
    status: 'proposed',
    summary: 'Proposed post',
  }
  const result = await executeConnectorActivity(activity, throwing, { timeoutMs: 50 })
  assert.equal(result.ok, false)
  if (!result.ok) {
    assert.equal(result.failure.code, 'connector_failed')
    assert.doesNotMatch(result.message, /credential|do-not-leak/)
  }
})

test('untrusted adapter output is bounded and stripped of null bytes before publication', async () => {
  const adapter: ConnectorToolRuntime = {
    mode: 'adapter',
    async execute() {
      return { ok: true, summary: `  useful\u0000${'x'.repeat(MAX_CONNECTOR_RESULT_CHARS + 50)}  ` }
    },
  }
  const result = await invokeConnectorRuntime(adapter, {
    invocationId: 'act-output',
    tool: 'connector__slack__list',
    connectorId: 'slack',
    connector: 'Slack',
    kind: 'read',
    input: {},
  })
  assert.equal(result.ok, true)
  if (result.ok) {
    assert.equal(result.summary.length, MAX_CONNECTOR_RESULT_CHARS)
    assert.doesNotMatch(result.summary, /\u0000/)
    assert.match(result.summary, /…$/)
  }
})

test('oversized consent input is refused before an adapter runs', async () => {
  let calls = 0
  const adapter: ConnectorToolRuntime = {
    mode: 'adapter',
    async execute() {
      calls += 1
      return { ok: true, summary: 'should not run' }
    },
  }
  const activity: ToolActivity = {
    id: 'act-oversized',
    tool: 'mcp__filesystem__write_file',
    connectorId: 'filesystem',
    connector: 'MCP · filesystem',
    kind: 'action',
    status: 'proposed',
    summary: 'Proposed write',
    input: { content: 'x'.repeat(MAX_CONNECTOR_INPUT_CHARS + 1) },
  }
  const result = await executeConnectorActivity(activity, adapter)
  assert.equal(result.ok, false)
  if (!result.ok) assert.match(result.message, /safety limit/i)
  assert.equal(calls, 0)
})
