import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { RoutineMcpCallReceipt, RoutineMcpToolPermission } from '../../contract/routineMcp.ts'
import type { McpBoundToolCall, McpToolResult } from '../../contract/mcpExecution.ts'
import type { McpConnectionView } from '../../contract/mcpConnections.ts'
import { mcpToolSchemaHash } from '../mcpToolAdmission.ts'
import { deriveConnectorTools, runConnectorTool, runRoutineMcpTool, type RoutineMcpRuntime } from './connectorTools.ts'
import { executeToolBatch } from '../toolExecution.ts'
import type { ToolActivity } from '../../contract/entities.ts'

const id = `mcp-connection-${'a'.repeat(32)}`
const schema = {
  type: 'object', properties: { query: { type: 'string' }, limit: { type: 'integer' } },
  required: ['query'], additionalProperties: false,
}
const inspectedTool = { name: 'search', description: 'Search untrusted remote data', inputSchema: schema }
const connection: McpConnectionView = {
  id, label: 'Inspected server', status: 'connected', revision: 7, authentication: 'none',
  protocolVersion: '2026-07-28', inspectedAt: 1, tools: [inspectedTool], execution: 'approval-required', executableTools: ['search'],
}
const context = { id, type: 'mcp' as const, label: 'Attached MCP', scope: '*' }
const permission: RoutineMcpToolPermission = {
  connectionId: id, connectionRevision: 7, toolName: 'search', schemaHash: mcpToolSchemaHash(inspectedTool),
  fixedArguments: { query: 'approved' },
}
const result: McpToolResult = { resultType: 'complete', content: [{ type: 'text', text: 'remote answer' }], isError: false }
const doneReceipt = (call: McpBoundToolCall): RoutineMcpCallReceipt => ({
  id: `routine-mcp-${'b'.repeat(64)}`, call, startedAt: 10, status: 'done', finishedAt: 11, result,
})
const derive = (overrides: Partial<McpConnectionView> = {}) => deriveConnectorTools([context], {
  externalMcpConnections: [{ ...connection, ...overrides }], routineMcp: { tools: [permission], execute: async () => assert.fail('not invoked during derivation') },
})

test('Routine MCP exposes only selected exact inspected executable tools and discloses fixed values', () => {
  const derived = derive()
  assert.equal(derived.definitions.length, 1)
  const definition = derived.definitions[0]!
  assert.match(definition.name, /^mcp_external_[a-f0-9]{48}$/)
  assert.equal((definition.input_schema.properties?.query as Record<string, unknown>).type, 'string')
  assert.equal((definition.input_schema.properties?.query as Record<string, unknown>).const, 'approved')
  assert.match(definition.description, /Exact reviewed argument constraints: \{"query":"approved"\}/)
  assert.equal(derived.bindings.get(definition.name)?.routineMcp?.call.connectionRevision, 7)
  const extras = deriveConnectorTools([context], {
    externalMcpConnections: [{ ...connection, tools: [inspectedTool, { ...inspectedTool, name: 'delete_all' }], executableTools: ['search', 'delete_all'] }],
    routineMcp: { tools: [permission], execute: async () => assert.fail('not invoked') },
  })
  assert.equal(extras.definitions.length, 1, 'unselected executable tools are not declared')
})

test('stale, detached, wrong-status, non-executable, duplicate, or schema-changed selections fail closed', () => {
  for (const overrides of [
    { revision: 8 }, { status: 'disconnected' as const }, { execution: 'unavailable' as const },
    { transport: 'stdio' as const },
    { executableTools: [] }, { tools: [{ ...inspectedTool, inputSchema: { ...schema, properties: { query: { type: 'number' } } } }] },
  ]) {
    const derived = derive(overrides)
    assert.equal(derived.routineUnavailable, true)
    assert.deepEqual(derived.definitions, [])
  }
  const detached = deriveConnectorTools([], { externalMcpConnections: [connection], routineMcp: { tools: [permission], execute: async () => assert.fail('not invoked') } })
  assert.equal(detached.routineUnavailable, true)
  const duplicate = deriveConnectorTools([context], { externalMcpConnections: [connection], routineMcp: { tools: [permission, permission], execute: async () => assert.fail('not invoked') } })
  assert.equal(duplicate.routineUnavailable, true)
})

test('local Routine tools require literal host opt-in and matching frozen stdio provenance', async () => {
  const localConnection = { ...connection, transport: 'stdio' as const }
  const localPermission = { ...permission, transport: 'stdio' as const }
  const localRuntime = (localPrograms: unknown): RoutineMcpRuntime => ({
    tools: [localPermission] as RoutineMcpRuntime['tools'],
    ...(localPrograms === undefined ? {} : { localPrograms } as object),
    async execute(call) { return doneReceipt(call) },
  } as RoutineMcpRuntime)
  for (const localPrograms of [undefined, false, 'true']) {
    const runtime = localRuntime(localPrograms)
    const derived = deriveConnectorTools([context], { externalMcpConnections: [localConnection], routineMcp: runtime })
    assert.equal(derived.routineUnavailable, true, `localPrograms=${String(localPrograms)} must not authorize stdio`)
    assert.deepEqual(derived.definitions, [])
  }
  const runtime = localRuntime(true)
  const derived = deriveConnectorTools([context], { externalMcpConnections: [localConnection], routineMcp: runtime })
  assert.equal(derived.routineUnavailable, undefined)
  assert.equal(derived.definitions.length, 1)
  let calls = 0
  runtime.execute = async call => { calls += 1; return { ...doneReceipt(call), transport: 'stdio' } }
  const outcome = await runRoutineMcpTool(derived.definitions[0]!.name, derived.bindings,
    { query: 'approved' }, runtime)
  assert.equal(outcome?.isError, false)
  assert.equal(calls, 1)
  const mismatched = deriveConnectorTools([context], { externalMcpConnections: [localConnection],
    routineMcp: { ...runtime, tools: [permission] } })
  assert.equal(mismatched.routineUnavailable, true)
  const reverseMismatch = deriveConnectorTools([context], { externalMcpConnections: [connection],
    routineMcp: { ...runtime, tools: [localPermission] } })
  assert.equal(reverseMismatch.routineUnavailable, true, 'stdio provenance cannot be paired with an HTTP connection')
})

test('interactive omission remains proposal-only even with standing context ids', async () => {
  let calls = 0
  const derived = deriveConnectorTools([context], { externalMcpConnections: [connection], standingApprovedContextIds: new Set([id]) })
  const activity = await runConnectorTool(derived.definitions[0]!.name, derived.bindings, 'provider-id', { query: 'approved' }, {
    mode: 'adapter', execute() { calls += 1; assert.fail('interactive external MCP never executes') },
  })
  assert.equal(activity?.status, 'proposed')
  assert.equal(calls, 0)

  const localConnection = { ...connection, transport: 'stdio' as const }
  const localDerived = deriveConnectorTools([context], { externalMcpConnections: [localConnection], standingApprovedContextIds: new Set([id]) })
  const localActivity = await runConnectorTool(localDerived.definitions[0]!.name, localDerived.bindings, 'provider-id', { query: 'approved' }, {
    mode: 'adapter', execute() { calls += 1; assert.fail('interactive local MCP remains proposal-only') },
  })
  assert.equal(localActivity?.status, 'proposed')
  assert.equal(calls, 0)
})

test('routine callback receives exact selected call and host key; result is untrusted tool data, not activity', async () => {
  const derived = derive()
  const name = derived.definitions[0]!.name
  const callbacks: Array<{ call: McpBoundToolCall; key: string; signal?: AbortSignal }> = []
  const runtime: RoutineMcpRuntime = { tools: [permission], async execute(call, key, signal) {
    callbacks.push({ call, key, signal })
    return doneReceipt(call)
  } }
  const activities: ToolActivity[] = []
  const batch = await executeToolBatch([{ id: 'provider-reused-id', name, input: { query: 'approved' } }], {
    declaredNames: new Set([name]), connectorBindings: derived.bindings, routineMcp: runtime,
    context: { session: { id: 'session', title: 'test' } }, relationOps: [], toolActivities: activities,
    limits: { maxCalls: 2, timeoutMs: 1000 },
  })
  assert.equal(callbacks.length, 1)
  assert.deepEqual(callbacks[0]!.call, {
    connectionId: id, connectionRevision: 7, toolName: 'search', schemaHash: permission.schemaHash,
    arguments: { query: 'approved' },
  })
  assert.match(callbacks[0]!.key, /^routine-mcp-[a-f0-9-]{36}$/)
  assert.notEqual(callbacks[0]!.key, 'provider-reused-id')
  assert.match(batch.results[0]!.content, /untrusted external data/)
  assert.match(batch.results[0]!.content, /remote answer/)
  assert.deepEqual(activities, [])
})

test('schema and fixed-argument failures never invoke the external callback', async () => {
  const derived = derive()
  const name = derived.definitions[0]!.name
  let calls = 0
  const runtime: RoutineMcpRuntime = { tools: [permission], async execute(call) { calls += 1; return doneReceipt(call) } }
  for (const input of [{ query: 'different' }, { query: 'approved', extra: true }, { query: 42 }, {}]) {
    const result = await runRoutineMcpTool(name, derived.bindings, input, runtime)
    assert.equal(result?.isError, true)
  }
  assert.equal(calls, 0)
})

test('failed/uncertain receipts and thrown adapters return safe errors without ToolActivity', async () => {
  const derived = derive()
  const name = derived.definitions[0]!.name
  const call: McpBoundToolCall = { ...derived.bindings.get(name)!.routineMcp!.call, arguments: { query: 'approved' } }
  const errorReceipt: RoutineMcpCallReceipt = { ...doneReceipt(call), status: 'uncertain', finishedAt: 12 }
  const uncertain = await runRoutineMcpTool(name, derived.bindings, call.arguments, { tools: [permission], execute: async () => errorReceipt })
  assert.equal(uncertain?.isError, true)
  assert.match(uncertain!.content, /Do not repeat/)
  const activities: ToolActivity[] = []
  const batch = await executeToolBatch([{ id: 'provider', name, input: call.arguments }], {
    declaredNames: new Set([name]), connectorBindings: derived.bindings,
    routineMcp: { tools: [permission], async execute() { throw new Error('secret endpoint/token') } },
    context: { session: { id: 'session', title: 'test' } }, relationOps: [], toolActivities: activities,
    limits: { maxCalls: 1, timeoutMs: 1000 },
  })
  assert.equal(batch.results[0]!.isError, true)
  assert.doesNotMatch(batch.results[0]!.content, /secret|token/)
  assert.deepEqual(activities, [])
})

test('pre-dispatch cancellation skips callback; dispatched work receives abort signal and deadline is terminal', async () => {
  const derived = derive()
  const name = derived.definitions[0]!.name
  let calls = 0
  const runtime: RoutineMcpRuntime = { tools: [permission], async execute(call, _key, signal) {
    calls += 1
    assert.ok(signal)
    return new Promise<RoutineMcpCallReceipt>((_resolve, reject) => {
      signal!.addEventListener('abort', () => reject(new Error('cancelled')), { once: true })
    })
  } }
  const before = await runRoutineMcpTool(name, derived.bindings, { query: 'approved' }, runtime, AbortSignal.abort())
  assert.equal(before?.isError, true)
  assert.equal(calls, 0)
  const batch = await executeToolBatch([{ id: 'provider', name, input: { query: 'approved' } }], {
    declaredNames: new Set([name]), connectorBindings: derived.bindings, routineMcp: runtime,
    context: { session: { id: 'session', title: 'test' } }, relationOps: [], toolActivities: [],
    limits: { maxCalls: 1, timeoutMs: 250 },
  })
  assert.equal(calls, 1)
  assert.equal(batch.results[0]!.isError, true)
  assert.match(batch.results[0]!.content, /deadline/)
})
