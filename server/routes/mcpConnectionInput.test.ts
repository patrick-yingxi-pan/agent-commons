import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ValidationError } from '../conflict.ts'
import {
  parseMcpConnectionCreate,
  parseMcpConnectionInspection,
  parseMcpConnectionLifecycle,
} from './mcpConnectionInput.ts'

const ref = `MCP_DESKTOP_${'A'.repeat(32)}`
const noSecret = (value: unknown, secret: string) => (error: unknown) =>
  error instanceof ValidationError && !error.message.includes(secret)

test('normalizes create input and delegates endpoint canonicalization to deployment scope', () => {
  assert.deepEqual(parseMcpConnectionCreate({
    creationId: 'research-1', label: '  Research  ', endpoint: 'https://MCP.example:443/tools', authentication: 'none',
  }), {
    creationId: 'research-1', label: 'Research', endpoint: 'https://mcp.example/tools', authentication: 'none',
  })
  assert.deepEqual(parseMcpConnectionCreate({
    creationId: 'local-1', label: 'Local', endpoint: 'http://127.0.0.1:8787/mcp', authentication: 'device-bearer',
  }, true).endpoint, 'http://127.0.0.1:8787/mcp')
  assert.throws(() => parseMcpConnectionCreate({
    creationId: 'local-1', label: 'Local', endpoint: 'http://127.0.0.1:8787/mcp', authentication: 'none',
  }), ValidationError)
})

test('normalizes inspection and lifecycle preconditions with optional opaque reference', () => {
  assert.deepEqual(parseMcpConnectionInspection({ operationId: 'inspect-1', expectedRevision: 0, credentialReference: ref }), {
    operationId: 'inspect-1', expectedRevision: 0, credentialReference: ref,
  })
  assert.deepEqual(parseMcpConnectionInspection({ operationId: 'inspect-2', expectedRevision: 4 }), {
    operationId: 'inspect-2', expectedRevision: 4,
  })
  assert.deepEqual(parseMcpConnectionLifecycle({ expectedRevision: 7 }), { expectedRevision: 7 })
})

test('rejects non-records, unknown fields, raw secrets, tenant ids, and scope flags without reflection', () => {
  const secret = 'super-secret-value'
  const invalidCreates = [
    null, [], new String('create'),
    { creationId: 'x', label: 'x', endpoint: 'https://mcp.example', authentication: 'none', secret },
    { creationId: 'x', label: 'x', endpoint: 'https://mcp.example', authentication: 'none', tenantId: 'tenant-alpha' },
    { creationId: 'x', label: 'x', endpoint: 'https://mcp.example', authentication: 'none', allowLoopback: true },
    { creationId: 'x', label: 'x', endpoint: 'https://mcp.example', authentication: 'none', scope: 'loopback' },
  ]
  for (const input of invalidCreates) assert.throws(() => parseMcpConnectionCreate(input), noSecret(input, secret))
  for (const input of [null, [], new String('inspect'), { operationId: 'x', expectedRevision: 0, secret }, { operationId: 'x', expectedRevision: 0, tenantId: 'tenant-alpha' }]) {
    assert.throws(() => parseMcpConnectionInspection(input), noSecret(input, secret))
  }
  for (const input of [null, [], new Number(1), { expectedRevision: 0, scope: 'public' }, { expectedRevision: 0, tenantId: 'tenant-alpha' }]) {
    assert.throws(() => parseMcpConnectionLifecycle(input), noSecret(input, secret))
  }
})

test('rejects boxed and non-scalar fields, invalid logical keys, labels, endpoints, refs, and revisions', () => {
  const validCreate = { creationId: 'x', label: 'Label', endpoint: 'https://mcp.example', authentication: 'none' }
  for (const patch of [
    { creationId: ['x'] }, { creationId: new String('x') }, { creationId: '' }, { creationId: '   ' },
    { creationId: 'x'.repeat(129) }, { creationId: 'x\n' }, { creationId: 'é' },
    { label: '' }, { label: ' \t ' }, { label: 'x'.repeat(257) }, { label: 'bad\u0000label' }, { label: new String('Label') },
    { endpoint: ['https://mcp.example'] }, { endpoint: new String('https://mcp.example') }, { endpoint: 'https://mcp.example#' },
    { endpoint: 'https://user:pass@mcp.example' }, { endpoint: 'x'.repeat(2049) },
    { authentication: ['none'] }, { authentication: new String('none') },
  ]) assert.throws(() => parseMcpConnectionCreate({ ...validCreate, ...patch }), ValidationError)
  for (const patch of [
    { operationId: ['x'] }, { operationId: new String('x') }, { operationId: '' }, { operationId: '   ' },
    { expectedRevision: -1 }, { expectedRevision: 1.5 }, { expectedRevision: new Number(1) }, { expectedRevision: Number.MAX_SAFE_INTEGER + 1 },
    { credentialReference: null }, { credentialReference: ['x'] }, { credentialReference: new String(ref) }, { credentialReference: 'raw-secret' },
  ]) assert.throws(() => parseMcpConnectionInspection({ operationId: 'x', expectedRevision: 0, ...patch }), ValidationError)
  for (const value of [-1, 1.5, new Number(1), Number.MAX_SAFE_INTEGER + 1, null, [], undefined]) {
    assert.throws(() => parseMcpConnectionLifecycle({ expectedRevision: value }), ValidationError)
  }
})
