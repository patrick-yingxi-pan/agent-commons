import assert from 'node:assert/strict'
import test from 'node:test'
import type { McpConnectionView } from '../contract/mcpConnections.ts'
import type { McpFormInputRequired } from '../contract/mcpElicitation.ts'
import type { McpBoundToolCall, McpToolResult } from '../contract/mcpExecution.ts'
import { createBoundMcpFormExecutor } from './mcpBoundExecution.ts'
import { createApprovedMcpFormExecutor } from './mcpExecution.ts'
import { McpToolCallError } from './mcpToolCall.ts'
import { MCP_LEGACY_VERSIONS, MCP_MODERN_VERSION } from './mcpProtocol.ts'
import { mcpToolSchemaHash } from './mcpToolAdmission.ts'
import type { PrivateMcpConnection } from './mcpConnections.ts'

const tenantId = 'tenant-person-form'
const ownerUserId = 'user-person-form'
const connectionId = 'mcp-connection-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
const endpoint = 'https://forms.example.test/mcp'
const credentialReference = `MCP_DESKTOP_${'A'.repeat(32)}`
const tool = {
  name: 'submit.application',
  inputSchema: { type: 'object', properties: { q: { type: 'string' } }, required: ['q'], additionalProperties: false },
  outputSchema: { type: 'object', properties: { accepted: { type: 'boolean' } }, required: ['accepted'], additionalProperties: false },
}
const schemaHash = mcpToolSchemaHash(tool)
const pending: McpFormInputRequired = {
  resultType: 'input_required',
  inputRequests: { question: { method: 'elicitation/create', params: {
    mode: 'form', message: 'Which option should be used?',
    requestedSchema: { type: 'object', properties: { option: { type: 'string', enum: ['a', 'b'] } }, required: ['option'] },
  } } },
  requestState: 'opaque-private-state',
}
const continuation = { pending, responses: { question: { action: 'accept' as const, content: { option: 'a' } } } }
const done: McpToolResult = { resultType: 'complete', content: [{ type: 'text', text: 'Accepted.' }],
  structuredContent: { accepted: true }, isError: false }
const binding = (): McpBoundToolCall => ({ connectionId, connectionRevision: 7, toolName: tool.name, schemaHash, arguments: { q: 'application' } })
function row(version: string = MCP_MODERN_VERSION, authentication: PrivateMcpConnection['authentication'] = 'none'): PrivateMcpConnection {
  return { tenantId, id: connectionId, label: 'Application MCP', endpoint, authentication,
    ...(authentication === 'device-oauth' ? { ownerUserId, credentialReference } : {}),
    revision: 7, connected: true,
    inspection: { protocolVersion: version, cleanup: 'not-needed', inspectedAt: 10, tools: [tool],
      schemaAdmission: { version: 1, hashes: [schemaHash] } },
  }
}
function harness(initial = row()) {
  let current = initial
  let permitted = true
  const store = {
    privateMcpConnection: () => current,
    mcpConnection: (): McpConnectionView => ({ id: connectionId, label: 'Application MCP', status: current.connected ? 'connected' : 'disconnected',
      revision: current.revision, authentication: current.authentication, protocolVersion: current.inspection?.protocolVersion ?? null,
      inspectedAt: 10, tools: [tool], execution: current.connected ? 'approval-required' : 'unavailable',
      executableTools: current.connected ? [tool.name] : [] }),
    sessionContexts: () => [{ id: connectionId, type: 'mcp' as const, label: 'Application MCP', scope: '*' }],
    mcpInputExecutionPermitted: () => permitted,
  }
  return { store, replace(next: PrivateMcpConnection) { current = next }, permit(value: boolean) { permitted = value } }
}
const runtime = (extra: Record<string, unknown> = {}) => ({ deviceBearerAvailable: false, allowLoopback: false, ...extra }) as any
const callResult = (result: McpToolResult) => ({ protocolVersion: MCP_MODERN_VERSION, cleanup: 'not-needed' as const, result })
const formResult = (result: McpFormInputRequired | McpToolResult) => ({ protocolVersion: MCP_MODERN_VERSION, cleanup: 'not-needed' as const, result })
const activity = () => ({ id: 'activity-form', tool: 'mcp__application__submit', connector: 'Application MCP', connectorId: connectionId,
  kind: 'action' as const, status: 'running' as const, decisionId: `tool-activity-decision-${'1'.repeat(24)}`,
  summary: 'Running', input: { q: 'application' }, mcp: { connectionRevision: 7, toolName: tool.name, schemaHash } })

test('modern initial call can return a private form request without validating it as final output', async () => {
  const h = harness()
  let ordinary = 0, forms = 0
  const execute = createBoundMcpFormExecutor({ runtimeConfiguration: () => runtime(),
    call: async () => { ordinary++; throw new Error('modern form path expected') },
    callWithForms: async (_endpoint, invocation, options) => {
      forms++
      assert.deepEqual(invocation, { tool: { name: tool.name, inputSchema: tool.inputSchema }, arguments: { q: 'application' } })
      await options.beforeCall?.()
      return formResult(pending)
    },
  })
  const result = await execute(h.store as any, tenantId, binding(), () => true)
  assert.deepEqual(result, { status: 'awaiting-input', summary: 'The MCP server needs input before it can finish this call.', pending })
  assert.equal(ordinary, 0)
  assert.equal(forms, 1)
  assert.equal(JSON.stringify(result).includes(credentialReference), false)
})

test('form continuations are one explicit modern call and final output validation happens only after a complete result', async () => {
  const h = harness()
  let forms = 0
  const execute = createBoundMcpFormExecutor({ runtimeConfiguration: () => runtime(),
    callWithForms: async (_endpoint, invocation, options) => {
      forms++
      assert.deepEqual(invocation.continuation, continuation)
      await options.beforeCall?.()
      return formResult({ ...done, structuredContent: { wrong: true } })
    },
  })
  const result = await execute(h.store as any, tenantId, binding(), () => true, undefined, continuation)
  assert.equal(result.status, 'uncertain', 'a final response violating the reviewed output schema is not success')
  assert.equal(forms, 1, 'a continuation never loops or retries automatically')
})

test('an explicit continuation may return the next validated form round without dispatching another call', async () => {
  const h = harness()
  const next = { ...pending, requestState: 'next opaque round', inputRequests: { followup: {
    method: 'elicitation/create' as const,
    params: { mode: 'form' as const, message: 'One more detail?',
      requestedSchema: { type: 'object' as const, properties: { detail: { type: 'string' as const } } } },
  } } }
  let forms = 0
  const execute = createBoundMcpFormExecutor({ runtimeConfiguration: () => runtime(),
    callWithForms: async (_endpoint, invocation, options) => {
      forms++
      assert.deepEqual(invocation.continuation, continuation)
      await options.beforeCall?.()
      return formResult(next)
    },
  })
  const result = await execute(h.store as any, tenantId, binding(), () => true, undefined, continuation)
  assert.equal(result.status, 'awaiting-input')
  if (result.status === 'awaiting-input') assert.deepEqual(result.pending, next)
  assert.equal(forms, 1)
})

test('opaque requestState is not searched as display text, while prompt and schema reject endpoint/credential literals', async () => {
  const h = harness(row(MCP_MODERN_VERSION, 'device-oauth'))
  let forms = 0
  const execute = createBoundMcpFormExecutor({ runtimeConfiguration: () => runtime({ deviceOAuthAvailable: true,
    resolveOAuthCredential: async () => 'private-oauth-token' }),
    callWithForms: async (_endpoint, _invocation, options) => {
      forms++
      await options.beforeCall?.()
      return formResult({ ...pending, requestState: `opaque ${endpoint} private-oauth-token` })
    },
  })
  const safe = await execute(h.store as any, tenantId, binding(), () => true, ownerUserId)
  assert.equal(safe.status, 'awaiting-input')
  if (safe.status === 'awaiting-input') assert.equal(safe.pending.requestState, `opaque ${endpoint} private-oauth-token`)
  assert.equal(forms, 1)
  const reflected = { ...pending, inputRequests: { question: { ...pending.inputRequests.question,
    params: { ...pending.inputRequests.question.params, message: `Do not show ${credentialReference}` } } } }
  const second = createBoundMcpFormExecutor({ runtimeConfiguration: () => runtime({ deviceOAuthAvailable: true,
    resolveOAuthCredential: async () => credentialReference }),
    callWithForms: async (_endpoint, _invocation, options) => { await options.beforeCall?.(); return formResult(reflected) },
  })
  const blocked = await second(h.store as any, tenantId, binding(), () => true, ownerUserId)
  assert.equal(blocked.status, 'uncertain')
  assert.notEqual(JSON.stringify(blocked).includes(credentialReference), true)
  const reflectedSchema = { ...pending, inputRequests: { question: { ...pending.inputRequests.question,
    params: { ...pending.inputRequests.question.params,
      requestedSchema: { ...pending.inputRequests.question.params.requestedSchema,
        properties: { option: { type: 'string' as const, description: `credential ${credentialReference}` } } },
    } },
  } }
  const third = createBoundMcpFormExecutor({ runtimeConfiguration: () => runtime({ deviceOAuthAvailable: true,
    resolveOAuthCredential: async () => 'private-oauth-token' }),
    callWithForms: async (_endpoint, _invocation, options) => { await options.beforeCall?.(); return formResult(reflectedSchema) },
  })
  assert.equal((await third(h.store as any, tenantId, binding(), () => true, ownerUserId)).status, 'uncertain')
})

test('OAuth authority changing during continuation credential resolution prevents dispatch and yields overall uncertainty', async () => {
  const h = harness(row(MCP_MODERN_VERSION, 'device-oauth'))
  let release!: (token: string) => void
  let started!: () => void
  const waiting = new Promise<void>(resolve => { started = resolve })
  const token = new Promise<string>(resolve => { release = resolve })
  let calls = 0
  const execute = createBoundMcpFormExecutor({ runtimeConfiguration: () => runtime({ deviceOAuthAvailable: true,
    resolveOAuthCredential: async () => { started(); return token },
  }), callWithForms: async () => { calls++; return formResult(done) } })
  const work = execute(h.store as any, tenantId, binding(), () => true, ownerUserId, continuation)
  await waiting
  h.replace({ ...row(MCP_MODERN_VERSION, 'device-oauth'), revision: 8 })
  release('late-token')
  const result = await work
  assert.equal(result.status, 'uncertain')
  assert.match(result.summary, /already submitted/)
  assert.equal(calls, 0)
})

test('continuation form and response are detached before the credential resolver can yield', async () => {
  const h = harness(row(MCP_MODERN_VERSION, 'device-oauth'))
  let release!: (token: string) => void
  let started!: () => void
  const waiting = new Promise<void>(resolve => { started = resolve })
  const token = new Promise<string>(resolve => { release = resolve })
  const submitted = structuredClone(continuation)
  const mutable = structuredClone(continuation)
  const execute = createBoundMcpFormExecutor({ runtimeConfiguration: () => runtime({ deviceOAuthAvailable: true,
    resolveOAuthCredential: async () => { started(); return token },
  }), callWithForms: async (_endpoint, invocation, options) => {
    assert.deepEqual(invocation.continuation, submitted)
    await options.beforeCall?.()
    return formResult(done)
  } })
  const work = execute(h.store as any, tenantId, binding(), () => true, ownerUserId, mutable)
  await waiting
  mutable.pending.requestState = 'retargeted state'
  mutable.responses.question.content.option = 'b'
  release('private-token')
  assert.equal((await work).status, 'done')
})

test('legacy first-round form-capable execution keeps ordinary call behavior, but a continuation never falls back', async () => {
  const h = harness(row(MCP_LEGACY_VERSIONS[0]))
  let ordinary = 0, forms = 0
  const execute = createBoundMcpFormExecutor({ runtimeConfiguration: () => runtime(),
    call: async (_endpoint, invocation, options) => {
      ordinary++
      assert.equal(options.expectedProtocolVersion, MCP_LEGACY_VERSIONS[0])
      assert.deepEqual(invocation.arguments, { q: 'application' })
      return { protocolVersion: MCP_LEGACY_VERSIONS[0], cleanup: 'not-needed', result: done }
    },
    callWithForms: async () => { forms++; return formResult(pending) },
  })
  const first = await execute(h.store as any, tenantId, binding(), () => true)
  assert.equal(first.status, 'done')
  assert.equal(ordinary, 1)
  assert.equal(forms, 0)
  const next = await execute(h.store as any, tenantId, binding(), () => true, undefined, continuation)
  assert.equal(next.status, 'uncertain')
  assert.equal(ordinary, 1)
  assert.equal(forms, 0)
})

test('approved form executor retains the ordinary durable activity binding and never exposes raw owner data', async () => {
  const h = harness(row(MCP_MODERN_VERSION, 'device-oauth'))
  let calls = 0
  const execute = createApprovedMcpFormExecutor({ runtimeConfiguration: () => runtime({ deviceOAuthAvailable: true,
    resolveOAuthCredential: async () => 'oauth-token' }),
    callWithForms: async (_endpoint, _invocation, options) => { calls++; await options.beforeCall?.(); return formResult(pending) },
  })
  const result = await execute({ ...h.store, sessionContexts: () => [{ id: connectionId, type: 'mcp', label: 'Application MCP', scope: '*' }] } as any,
    'session-form', tenantId, activity(), ownerUserId)
  assert.equal(result.status, 'awaiting-input')
  assert.equal(calls, 1)
  assert.equal(JSON.stringify(result).includes(ownerUserId), false)
})

test('approved form execution rechecks the private person-bound receipt after credential resolution', async () => {
  const h = harness(row(MCP_MODERN_VERSION, 'device-oauth'))
  let release!: (token: string) => void
  let started!: () => void
  const waiting = new Promise<void>(resolve => { started = resolve })
  const token = new Promise<string>(resolve => { release = resolve })
  let calls = 0
  const execute = createApprovedMcpFormExecutor({ runtimeConfiguration: () => runtime({ deviceOAuthAvailable: true,
    resolveOAuthCredential: async () => { started(); return token },
  }),
  callWithForms: async (_endpoint, _invocation, options) => { calls++; await options.beforeCall?.(); return formResult(done) },
  })
  const activityRow = activity()
  const work = execute({ ...h.store, sessionContexts: () => [{ id: connectionId, type: 'mcp', label: 'Application MCP', scope: '*' }] } as any,
    'session-form', tenantId, activityRow, ownerUserId, continuation)
  await waiting
  h.permit(false)
  release('late-token')
  const result = await work
  assert.equal(result.status, 'uncertain', 'loss of host permission before follow-up submission preserves prior uncertainty')
  assert.equal(calls, 0)
})
