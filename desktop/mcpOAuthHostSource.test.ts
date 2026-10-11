import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createMcpOAuthHost } from './mcpOAuthHost.mjs'
import { createMcpOAuthSource } from './mcpOAuthSource.mjs'

const connectionId = 'mcp-owner-source-composition'
const ownerId = 'user-source-owner'
const tenantId = 'tenant-source-owner'
const endpoint = 'https://private-mcp.example.test/agent'
const issuer = 'https://login.example.test/tenant'
const reference = `MCP_DESKTOP_${'A'.repeat(32)}`
const binding = { tenantId, connectionId, endpoint }
const metadata = Object.freeze({ issuer, authorization_endpoint: `${issuer}/authorize`, token_endpoint: `${issuer}/token`,
  response_types_supported: ['code'], grant_types_supported: ['authorization_code'],
  token_endpoint_auth_methods_supported: ['none'], code_challenge_methods_supported: ['S256'] })

function fixture({ loseInspectionResponse = false } = {}) {
  const session = { origin: 'http://127.0.0.1:8787', cookie: 'uw_session=composition-cookie', stamp: 'window:owner:1' }
  let currentConnection = { id: connectionId, authentication: 'device-oauth', revision: 7, status: 'unverified', inspectionOperationId: null }
  let currentOwner = ownerId
  let currentBinding = { ...binding }
  let sourceCurrent = true
  let requestId = 0
  const calls: Array<{ url: string; init: RequestInit }> = []
  const discarded: string[] = []
  const source = createMcpOAuthSource({
    readSession: () => session,
    isSessionCurrent: (stamp: string) => sourceCurrent && stamp === session.stamp,
    fetch: async (url: string, init: any) => {
      calls.push({ url, init })
      if (init.method === 'POST') {
        const posted = JSON.parse(String(init.body))
        currentConnection = { ...currentConnection, revision: currentConnection.revision + 1,
          status: 'connected', inspectionOperationId: posted.operationId }
        if (loseInspectionResponse) throw new Error('response lost after server commit')
        return new Response(JSON.stringify({ connection: currentConnection, tools: [{ name: 'private-tool' }] }),
          { headers: { 'Content-Type': 'application/json' } })
      }
      return new Response(JSON.stringify({ ownerUserId: currentOwner, binding: currentBinding, connection: currentConnection }),
        { headers: { 'Content-Type': 'application/json' } })
    },
  })
  const signIns: Array<{ input: any; options: any }> = []
  const host = createMcpOAuthHost({
    assertCaller: () => undefined,
    resolveSource: (id: string) => source.resolveSource(id),
    isSourceCurrent: (stamp: string) => source.isSourceCurrent(stamp),
    discovery: {
      async discoverResource(resource: string) {
        assert.equal(resource, endpoint)
        return { resource, authorizationServers: [issuer], scopesSupported: ['files:read'] }
      },
      async discoverServer(resource: unknown, selectedIssuer: string) {
        return { issuer: selectedIssuer, resource, metadata }
      },
    },
    signIn: { async authorize(input: any, options: any) {
      signIns.push({ input, options })
      return { reference }
    } },
    inspect: (trusted: any, request: any) => source.inspect(trusted, request),
    discard: async (discardedReference: string) => { discarded.push(discardedReference) },
    randomUUID: () => `composition-operation-${++requestId}`,
  })
  const startAndReview = async () => {
    const started = await host.start({}, { connectionId, expectedRevision: 7, source: { tenantId, userId: ownerId } })
    const reviewed = await host.review({}, { flowId: started.flowId, issuer })
    return { started, reviewed }
  }
  return { host, source, session, calls, signIns, discarded, startAndReview,
    switchSource() { sourceCurrent = false },
    get currentConnection() { return currentConnection },
  }
}

test('host and cookie source compose across lost inspection response without exposing native authority', async () => {
  const f = fixture({ loseInspectionResponse: true })
  try {
    const { started, reviewed } = await f.startAndReview()
    const pending = await f.host.authorize({}, { flowId: started.flowId, scopes: ['files:read'] })
    assert.deepEqual(pending, { status: 'inspection-pending', flowId: started.flowId })
    assert.equal(f.signIns.length, 1)
    assert.deepEqual(f.signIns[0].input, { binding, ownerId, issuer, metadata, scopes: ['files:read'] })
    assert.equal(f.signIns[0].options.isCurrent(), true)

    const postsBeforeRecovery = f.calls.filter(call => call.init.method === 'POST')
    assert.equal(postsBeforeRecovery.length, 1)
    assert.deepEqual(JSON.parse(String(postsBeforeRecovery[0].init.body)), {
      operationId: 'composition-operation-2', expectedRevision: 7, credentialReference: reference,
    })
    assert.equal(postsBeforeRecovery[0].init.headers && (postsBeforeRecovery[0].init.headers as Record<string, string>).Cookie,
      'uw_session=composition-cookie', 'the cookie is used only by the native local adapter')

    const complete = await f.host.reconcile({}, { flowId: started.flowId })
    assert.deepEqual(complete, { status: 'complete', connection: { id: connectionId, revision: 8, status: 'connected' } })
    assert.equal(f.signIns.length, 1, 'recovery never repeats sign-in or token exchange')
    assert.equal(f.calls.filter(call => call.init.method === 'POST').length, 1, 'recovery never repeats committed inspection')
    assert.deepEqual(f.discarded, [], 'a committed credential reference is not cleaned up during receipt recovery')

    const rendererProjection = JSON.stringify({ started, reviewed, pending, complete })
    for (const secret of [f.session.cookie, reference, endpoint, `${issuer}/authorize`, `${issuer}/token`, 'private-tool']) {
      assert.equal(rendererProjection.includes(secret), false, `renderer projection must not include ${secret}`)
    }
    assert.deepEqual(f.calls.filter(call => call.init.method === 'POST').map(call => call.url),
      [`${f.session.origin}/api/v1/mcp-connections/${connectionId}/inspect`])
  } finally {
    f.host.close()
    f.source.close()
  }
})

test('a switched owner source cannot reach sign-in or inspection', async () => {
  const f = fixture()
  try {
    const { started } = await f.startAndReview()
    f.switchSource()
    await assert.rejects(f.host.authorize({}, { flowId: started.flowId, scopes: ['files:read'] }), /stale|cancelled/)
    assert.equal(f.signIns.length, 0)
    assert.equal(f.calls.some(call => call.init.method === 'POST'), false)
  } finally {
    f.host.close()
    f.source.close()
  }
})
