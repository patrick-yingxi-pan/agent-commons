import { test } from 'node:test'
import assert from 'node:assert/strict'
import { refreshAccount } from './account.ts'
import { desktopMcpCredentialsAvailable, getMcpConnectionCredentialBinding, provisionDesktopMcpCredential } from './desktopMcpCredentials.ts'

const binding = { tenantId: 'tenant-a', connectionId: 'mcp-connection-a', endpoint: 'https://mcp.example.test/mcp' }

test('credential binding reads reject another audience or malformed data before native provision', async t => {
  const originalFetch = globalThis.fetch
  t.after(() => { globalThis.fetch = originalFetch; refreshAccount(null) })
  refreshAccount({ userId: 'user-a', tenantId: binding.tenantId })
  let provisions = 0
  const scope = { agentCommonsDesktop: { mcpCredentials: {
    async provision() { provisions += 1; return 'MCP_DESKTOP_' + 'A'.repeat(32) },
  } } }
  for (const supplied of [
    { ...binding, connectionId: 'mcp-connection-other' },
    { ...binding, tenantId: 'tenant-other' },
    { ...binding, endpoint: 42 },
    { ...binding, endpoint: 'https://user:password@mcp.example.test/mcp' },
    { ...binding, endpoint: 'https://mcp.example.test/mcp#fragment' },
    { ...binding, extra: 'unexpected' },
    null,
  ]) {
    globalThis.fetch = async () => new Response(JSON.stringify({ binding: supplied }), {
      headers: { 'Content-Type': 'application/json', 'x-resolved-tenant': binding.tenantId },
    })
    await assert.rejects(async () => {
      const result = await getMcpConnectionCredentialBinding(binding.connectionId, binding.tenantId)
      await provisionDesktopMcpCredential(result.binding, 'token-value', scope)
    }, /credential binding/)
    assert.equal(provisions, 0, 'a malformed audience cannot receive the token')
  }
  globalThis.fetch = async () => new Response(JSON.stringify({ binding }), {
    headers: { 'Content-Type': 'application/json', 'x-resolved-tenant': binding.tenantId },
  })
  const result = await getMcpConnectionCredentialBinding(binding.connectionId, binding.tenantId)
  assert.deepEqual(result, { binding })
  await provisionDesktopMcpCredential(result.binding, 'token-value', scope)
  assert.equal(provisions, 1, 'the exact validated audience can be provisioned')
})

test('MCP desktop credential adapter exposes provision-only acknowledgement', async () => {
  const calls: unknown[] = []
  const scope = {
    agentCommonsDesktop: {
      mcpCredentials: {
        async provision(receivedBinding: typeof binding, secret: string) {
          calls.push([receivedBinding, secret])
          return 'MCP_DESKTOP_' + 'A'.repeat(32)
        },
      },
    },
  }
  assert.equal(desktopMcpCredentialsAvailable(scope), true)
  assert.equal(await provisionDesktopMcpCredential(binding, 'token-value', scope), 'MCP_DESKTOP_' + 'A'.repeat(32))
  assert.deepEqual(calls, [[binding, 'token-value']])
  assert.deepEqual(Object.keys(scope.agentCommonsDesktop.mcpCredentials), ['provision'])
})

test('web mode has no MCP credential authority', async () => {
  assert.equal(desktopMcpCredentialsAvailable({}), false)
  await assert.rejects(
    provisionDesktopMcpCredential(binding, 'token-value', {}),
    /unavailable/,
  )
})

test('native MCP provisioning has a bounded wait and generic timeout', async () => {
  const scope = {
    agentCommonsDesktop: {
      mcpCredentials: {
        provision: async () => new Promise<string>(() => {}),
      },
    },
  }
  await assert.rejects(
    provisionDesktopMcpCredential(binding, 'token-value', scope, 5),
    (error: unknown) => error instanceof Error && error.message === 'Secure MCP credential provisioning timed out.',
  )
})
