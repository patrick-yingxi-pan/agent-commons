import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { DesktopBridge } from './desktopCredentials.ts'
import { authorizeDesktopMcpOAuth, cancelDesktopMcpOAuth, clearHeldDesktopMcpOAuthFlow, desktopMcpOAuthAvailable, getHeldDesktopMcpOAuthFlow, holdDesktopMcpOAuthFlow, reconcileDesktopMcpOAuth, reviewDesktopMcpOAuth, settleHeldDesktopMcpOAuthCancellation, startDesktopMcpOAuth } from './desktopMcpOAuth.ts'

function fixture() {
  const calls: unknown[][] = []
  const agentCommonsDesktop: DesktopBridge = { mcpOAuth: {
    async start(request) { calls.push(['start', request]); return { flowId: 'flow-safe', connectionId: 'mcp-1', revision: 3, authorizationServers: ['https://issuer.example'] } },
    async review(request) { calls.push(['review', request]); return { ...request, scopesSupported: ['read'], suggestedScopes: [] } },
    async authorize(request) { calls.push(['authorize', request]); return { status: 'inspection-pending', flowId: request.flowId } },
    async reconcile(request) { calls.push(['reconcile', request]); return { status: 'complete', connection: { id: 'mcp-1', revision: 4, status: 'connected' }, credentialCleanup: 'complete' } },
    async cancel(request) { calls.push(['cancel', request]); return { status: 'cancelled' } },
  } }
  return { scope: { agentCommonsDesktop }, calls }
}

test('native OAuth bridge supports explicit discovery review, authorize, reconcile and cancel with minimal public replies', async () => {
  const { scope, calls } = fixture()
  assert.equal(desktopMcpOAuthAvailable(scope), true)
  const source = { tenantId: 'tenant-a', userId: 'user-a' }
  assert.deepEqual(await startDesktopMcpOAuth({ connectionId: 'mcp-1', expectedRevision: 3, source }, scope), {
    flowId: 'flow-safe', connectionId: 'mcp-1', revision: 3, authorizationServers: ['https://issuer.example'],
  })
  assert.deepEqual(await reviewDesktopMcpOAuth({ flowId: 'flow-safe', issuer: 'https://issuer.example' }, scope), {
    flowId: 'flow-safe', issuer: 'https://issuer.example', scopesSupported: ['read'], suggestedScopes: [],
  })
  assert.deepEqual(await authorizeDesktopMcpOAuth({ flowId: 'flow-safe', scopes: ['read'] }, scope), { status: 'inspection-pending', flowId: 'flow-safe' })
  assert.deepEqual(await reconcileDesktopMcpOAuth({ flowId: 'flow-safe' }, scope), {
    status: 'complete', connection: { id: 'mcp-1', revision: 4, status: 'connected' }, credentialCleanup: 'complete',
  })
  assert.deepEqual(await cancelDesktopMcpOAuth({ flowId: 'flow-safe' }, scope), { status: 'cancelled' })
  assert.deepEqual(calls.map(call => call[0]), ['start', 'review', 'authorize', 'reconcile', 'cancel'])
})

test('web mode has no native OAuth controls or bridge calls', async () => {
  assert.equal(desktopMcpOAuthAvailable({}), false)
  await assert.rejects(startDesktopMcpOAuth({ connectionId: 'mcp-1', expectedRevision: 0, source: { tenantId: 't', userId: 'u' } }, {}), /unavailable/)
})

test('pending recovery handles survive UI navigation in memory but remain account- and connection-scoped', () => {
  const source = { tenantId: 'tenant-a', userId: 'user-a' }
  const flow = { flowId: 'flow-safe', connectionId: 'mcp-1', revision: 3, authorizationServers: ['https://issuer.example'] }
  holdDesktopMcpOAuthFlow('mcp-1', source, flow)
  assert.deepEqual(getHeldDesktopMcpOAuthFlow('mcp-1', source), flow)
  assert.equal(getHeldDesktopMcpOAuthFlow('mcp-1', { tenantId: 'tenant-b', userId: 'user-b' }), undefined)
  assert.equal(getHeldDesktopMcpOAuthFlow('mcp-2', source), undefined)
  clearHeldDesktopMcpOAuthFlow('mcp-1', source)
  assert.equal(getHeldDesktopMcpOAuthFlow('mcp-1', source), undefined)
})

test('late OAuth cancel settlements cannot clear, replace, or resurrect a different flow', () => {
  const source = { tenantId: 'tenant-a', userId: 'user-a' }
  const first = { flowId: 'flow-first', connectionId: 'mcp-1', revision: 3, authorizationServers: ['https://issuer.example'] }
  const later = { flowId: 'flow-later', connectionId: 'mcp-1', revision: 4, authorizationServers: ['https://new-issuer.example'] }
  holdDesktopMcpOAuthFlow('mcp-1', source, first)
  assert.equal(settleHeldDesktopMcpOAuthCancellation('mcp-1', source, first, 'inspection-pending'), true)
  assert.equal(getHeldDesktopMcpOAuthFlow('mcp-1', source)?.flowId, first.flowId)

  holdDesktopMcpOAuthFlow('mcp-1', source, later)
  assert.equal(settleHeldDesktopMcpOAuthCancellation('mcp-1', source, first, 'cancelled'), false,
    'an earlier cancellation cannot clear a newer recovery flow')
  assert.equal(clearHeldDesktopMcpOAuthFlow('mcp-1', source, first.flowId), false,
    'a stale completion cannot clear a newer recovery flow')
  assert.equal(getHeldDesktopMcpOAuthFlow('mcp-1', source)?.flowId, later.flowId)

  assert.equal(clearHeldDesktopMcpOAuthFlow('mcp-1', source, later.flowId), true)
  assert.equal(settleHeldDesktopMcpOAuthCancellation('mcp-1', source, later, 'inspection-pending'), false,
    'a late pending receipt cannot resurrect a flow after exact reconciliation cleared it')
  assert.equal(getHeldDesktopMcpOAuthFlow('mcp-1', source), undefined)

  assert.equal(settleHeldDesktopMcpOAuthCancellation('mcp-1', source, first, 'inspection-pending', true), true,
    'a late start that had not yet been held may preserve uncertainty if no newer flow exists')
  holdDesktopMcpOAuthFlow('mcp-1', source, later)
  assert.equal(settleHeldDesktopMcpOAuthCancellation('mcp-1', source, first, 'unknown', true), false,
    'late-start recovery cannot overwrite a newer handle')
  clearHeldDesktopMcpOAuthFlow('mcp-1', source)
})

test('bridge requests and replies are bounded and fixed error codes are sanitized', async () => {
  const { scope } = fixture()
  await assert.rejects(startDesktopMcpOAuth({ connectionId: 'mcp-1', expectedRevision: -1, source: { tenantId: 't', userId: 'u' } }, scope), /unavailable/)
  await assert.rejects(startDesktopMcpOAuth({ connectionId: 'mcp-1', expectedRevision: 3, source: { tenantId: 't', userId: 'u' }, endpoint: 'https://untrusted.example' } as never, scope), /unavailable/)
  await assert.rejects(authorizeDesktopMcpOAuth({ flowId: 'flow-safe', scopes: Array(33).fill('read') }, scope), /unavailable/)
  scope.agentCommonsDesktop!.mcpOAuth!.start = async () => ({ flowId: 'f', connectionId: 'mcp-1', revision: 3, authorizationServers: [], credentialReference: 'SECRET' } as never)
  await assert.rejects(startDesktopMcpOAuth({ connectionId: 'mcp-1', expectedRevision: 3, source: { tenantId: 't', userId: 'u' } }, scope), error => {
    assert.equal((error as Error).message.includes('SECRET'), false)
    assert.equal((error as Error & { code?: string }).code, 'unavailable')
    return true
  })
  scope.agentCommonsDesktop!.mcpOAuth!.start = async () => { throw Object.assign(new Error('raw token secret'), { code: 'conflict' }) }
  await assert.rejects(startDesktopMcpOAuth({ connectionId: 'mcp-1', expectedRevision: 3, source: { tenantId: 't', userId: 'u' } }, scope), error => {
    assert.equal((error as Error).message.includes('raw token secret'), false)
    assert.equal((error as Error & { code?: string }).code, 'conflict')
    return true
  })
})
