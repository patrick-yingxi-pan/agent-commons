import { test } from 'node:test'
import assert from 'node:assert/strict'
import { refreshAccount } from '../api/account.ts'
import {
  enqueueMcpConnectionMutation,
  mcpConnectionMutationResourceId,
} from './mcpConnectionMutations.ts'

test('MCP mutation resource IDs are tenant-fenced and creation IDs are stable', () => {
  assert.equal(
    mcpConnectionMutationResourceId({
      kind: 'create', tenantId: 'tenant-a',
      request: { creationId: 'creation-1', label: 'A', endpoint: 'https://mcp.example.test', authentication: 'none' },
    }),
    'tenant-a:create:creation-1',
  )
  assert.equal(
    mcpConnectionMutationResourceId({
      kind: 'remove', tenantId: 'tenant-a', id: 'mcp-connection-a', expectedRevision: 3,
    }),
    'tenant-a:mcp-connection-a',
  )
  assert.notEqual(
    mcpConnectionMutationResourceId({
      kind: 'remove', tenantId: 'tenant-b', id: 'mcp-connection-a', expectedRevision: 3,
    }),
    'tenant-a:mcp-connection-a',
  )
})

test('MCP lifecycle does not enqueue without an explicit or active account', () => {
  refreshAccount(null)
  assert.equal(enqueueMcpConnectionMutation({
    kind: 'create',
    request: { creationId: 'creation-no-account', label: 'A', endpoint: 'https://mcp.example.test', authentication: 'none' },
  }), null)
})

test('an account transition fences a held MCP intent before lazy runtime work starts', async (t) => {
  t.after(() => refreshAccount(null))
  refreshAccount({ userId: 'mcp-user-a', tenantId: 'tenant-a' })
  const result = enqueueMcpConnectionMutation({
    kind: 'create', tenantId: 'tenant-a',
    request: { creationId: 'creation-fenced', label: 'A', endpoint: 'https://mcp.example.test', authentication: 'none' },
  })
  assert.ok(result)
  refreshAccount({ userId: 'mcp-user-b', tenantId: 'tenant-b' })
  assert.equal(await result, 'discarded')
})

test('an already-stale account form cannot enqueue an MCP act into the current account', (t) => {
  t.after(() => refreshAccount(null))
  refreshAccount({ userId: 'mcp-user-b', tenantId: 'tenant-b' })
  assert.equal(enqueueMcpConnectionMutation({
    kind: 'create', tenantId: 'tenant-a',
    request: { creationId: 'stale-form', label: 'A', endpoint: 'https://mcp.example.test', authentication: 'none' },
  }), null)
})
