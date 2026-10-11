/** Authenticated Contribution MCP acceptance for person-owned OAuth bindings. */
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import https from 'node:https'
import { syncBuiltinESMExports } from 'node:module'
import { after, before, test } from 'node:test'
import { accounts } from '../accounts.ts'
import { signSession } from '../auth.ts'
import { configureMcpRuntime, initializeMcpRuntime, mcpRuntimeConfiguration } from '../mcpRuntime.ts'
import { MCP_MODERN_VERSION } from '../mcpProtocol.ts'
import { MCP_SCHEMA_ADMISSION_VERSION, mcpToolSchemaHash } from '../mcpToolAdmission.ts'

let sequence = 0
const endpoint = 'https://8.8.8.8/mcp'
const tool = { name: 'write', inputSchema: {
  type: 'object', properties: { value: { type: 'string' } }, required: ['value'], additionalProperties: false,
} }
const schemaHash = mcpToolSchemaHash(tool)
const cookieOf = (response: { headers: Record<string, string> }) => response.headers['set-cookie']?.split(';')[0] ?? ''
let store: typeof import('../store/index.ts').store
let call: typeof import('../testkit/http.ts').call
let callFresh: typeof import('../testkit/http.ts').callFresh
let protocolCall: (body: any) => Promise<any> | any = () => ({ resultType: 'complete', content: [], isError: false })
let protocolCalls = 0
let protocolRequests = 0
let originalHttpsRequest: typeof https.request

before(async () => {
  originalHttpsRequest = https.request
  https.request = ((url: URL, _options: unknown, callback: (response: any) => void) => {
    protocolRequests++
    const request = new EventEmitter() as EventEmitter & { end: (body?: Uint8Array) => void; destroy: () => void }
    request.destroy = () => request
    request.end = (encoded?: Uint8Array) => {
      void (async () => {
        const body = JSON.parse(Buffer.from(encoded ?? []).toString('utf8'))
        assert.equal(url.hostname, new URL(endpoint).hostname)
        let result: unknown
        if (body.method === 'server/discover') {
          result = { resultType: 'complete', supportedVersions: [MCP_MODERN_VERSION], capabilities: { tools: {} },
            _meta: { 'io.modelcontextprotocol/serverInfo': { name: 'local-oauth-peer', version: '1' } } }
        } else {
          assert.equal(body.method, 'tools/call')
          protocolCalls++
          result = await protocolCall(body)
        }
        const response = new PassThrough() as PassThrough & { statusCode: number; headers: Record<string, string>; complete: boolean }
        response.statusCode = 200
        response.headers = { 'content-type': 'application/json' }
        response.complete = true
        callback(response)
        response.end(JSON.stringify({ jsonrpc: '2.0', id: body.id, result }))
      })().catch((error) => request.emit('error', error))
    }
    return request
  }) as typeof https.request
  syncBuiltinESMExports()
  const [storeModule, httpModule] = await Promise.all([import('../store/index.ts'), import('../testkit/http.ts')])
  store = storeModule.store
  call = httpModule.call
  callFresh = httpModule.callFresh
})

after(() => {
  https.request = originalHttpsRequest
  syncBuiltinESMExports()
})

async function account(label: string) {
  const tag = `${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${++sequence}`
  const response = await call('POST', '/auth/signup', { name: label, email: `${tag}@contribution-oauth.example`, password: `${tag}-password` })
  assert.equal(response.status, 200, JSON.stringify(response.json))
  return { userId: response.json.user.id as string, email: `${tag}@contribution-oauth.example`, cookie: cookieOf(response) }
}

function headers(userId: string, tenantId: string, key?: string) {
  return { cookie: `uw_session=${signSession({ userId, tenantId, iat: Date.now() })}`,
    'x-account-transition-source': `session:${userId}`, ...(key ? { 'idempotency-key': key } : {}) }
}

async function sharedTenant() {
  const owner = await account('Contribution OAuth Owner')
  const peer = await account('Contribution OAuth Peer')
  const org = await call('POST', '/orgs', { name: `Contribution OAuth ${sequence}` }, { cookie: owner.cookie })
  assert.equal(org.status, 201, JSON.stringify(org.json))
  const invite = await call('POST', `/orgs/${org.json.id}/invites`, { email: peer.email }, { cookie: owner.cookie })
  assert.equal(invite.status, 201, JSON.stringify(invite.json))
  assert.equal((await call('POST', `/me/invites/${invite.json.id}/accept`, undefined, { cookie: peer.cookie })).status, 200)
  assert.ok(accounts.identityFor(owner.userId, org.json.id))
  assert.ok(accounts.identityFor(peer.userId, org.json.id))
  return { owner, peer, tenantId: org.json.id, ownerHeaders: headers(owner.userId, org.json.id), peerHeaders: headers(peer.userId, org.json.id) }
}

function installLocalProtocolPeer(onCall: (body: any) => Promise<any> | any) {
  protocolCall = onCall
  protocolCalls = 0
  protocolRequests = 0
  return { get calls() { return protocolCalls }, get requests() { return protocolRequests } }
}

async function bindOwnerOAuth(tenantId: string, ownerUserId: string) {
  const id = `mcp-connection-${(++sequence).toString(16).padStart(32, '0')}`
  const credentialReference = `MCP_DESKTOP_${sequence.toString(16).toUpperCase().padStart(32, '0')}`
  store.createMcpConnection({ id, label: 'Owner private MCP', endpoint, authentication: 'device-oauth' }, tenantId, false, ownerUserId)
  store.commitMcpInspection(id, tenantId, 0, {
    protocolVersion: MCP_MODERN_VERSION, cleanup: 'not-needed', tools: [tool],
    schemaAdmission: { version: MCP_SCHEMA_ADMISSION_VERSION, hashes: [schemaHash] },
  }, Date.now(), credentialReference, undefined, ownerUserId)
  return id
}

function project(tenantId: string) {
  const id = `p-contribution-oauth-${++sequence}`
  store.applyRelationOp({ kind: 'create-project', projectId: id, projectName: 'OAuth Contribution boundary', projectDescription: '' }, tenantId)
  store.applyRelationOp({ kind: 'share-project', projectId: id, projectName: 'OAuth Contribution boundary', shared: true }, tenantId)
  return id
}

function proposal(connectionId: string, value: string) {
  return { expectedVersion: 0, lines: [{ type: 'mcp.mutate', target: 'write', cardinality: 3,
    harness: 'explicit-call', note: 'A separately confirmed OAuth call.',
    mcp: { connectionId, connectionRevision: 1, toolName: 'write', arguments: { value } },
  }] }
}

test('real owner and same-tenant peer keep Contribution OAuth authority, acknowledgement, and replay actor-bound', { timeout: 30_000 }, async (t) => {
  const previousRuntime = mcpRuntimeConfiguration()
  t.after(() => configureMcpRuntime({ ...previousRuntime }))
  const { owner, peer, tenantId, ownerHeaders, peerHeaders } = await sharedTenant()
  let resolverCalls = 0
  configureMcpRuntime({ deviceBearerAvailable: false, deviceOAuthAvailable: true, allowLoopback: false,
    resolveOAuthCredential: async (_reference, binding, options) => {
      resolverCalls++
      assert.equal(binding.ownerUserId, owner.userId, 'the authenticated OAuth owner reaches the dedicated credential resolver')
      assert.equal(binding.tenantId, tenantId)
      assert.equal(binding.connectionId, connectionId)
      assert.equal(options.isCurrent(), true, 'the executor retains the owner-bound live connection during credential resolution')
      return 'local-test-oauth-token'
    }, synchronizeBindings: async () => ({ available: true }) })
  await initializeMcpRuntime(store.mcpCredentialBindings())
  const connectionId = await bindOwnerOAuth(tenantId, owner.userId)
  const peerTransport = installLocalProtocolPeer(async (body) => {
    assert.equal(body.params.name, 'write')
    assert.deepEqual(body.params.arguments, { value: 'once' })
    return { resultType: 'complete', content: [{ type: 'text', text: 'written once' }], isError: false }
  })
  const projectId = project(tenantId)
  const opened = await call('POST', `/projects/${projectId}/contributions`, { title: 'OAuth write' }, { ...ownerHeaders, 'idempotency-key': `contribution-${sequence}` })
  assert.equal(opened.status, 200, JSON.stringify(opened.json))
  const contributionId = opened.json.id
  const path = `/projects/${projectId}/contributions/${contributionId}`

  const peerProposal = await call('POST', `${path}/envelope`, proposal(connectionId, 'peer-attempt'), { ...peerHeaders, 'idempotency-key': `peer-proposal-${sequence}` })
  assert.notEqual(peerProposal.status, 200, 'same-tenant membership cannot bind another person’s OAuth connection')
  assert.equal(peerTransport.calls, 0)

  const proposed = await call('POST', `${path}/envelope`, proposal(connectionId, 'once'), { ...ownerHeaders, 'idempotency-key': `owner-proposal-${sequence}` })
  assert.equal(proposed.status, 200, JSON.stringify(proposed.json))
  const ownerProposalKey = `owner-proposal-${sequence}`
  const peerProposalReplay = await callFresh('POST', `${path}/envelope`, proposal(connectionId, 'once'), { ...peerHeaders, 'idempotency-key': ownerProposalKey })
  assert.notEqual(peerProposalReplay.status, 200, 'a same-tenant peer cannot replay the owner’s exact proposal receipt')
  const lineId = proposed.json.envelope.lines[0].id
  assert.doesNotMatch(JSON.stringify(proposed.json), new RegExp(owner.userId))
  assert.doesNotMatch(JSON.stringify(proposed.json), /credentialReference|mcpAuthority|schemaHash|endpoint/)

  const approved = await call('POST', `${path}/envelope/approve`, { expectedVersion: 1 }, { ...ownerHeaders, 'idempotency-key': `owner-approval-${sequence}` })
  assert.equal(approved.status, 200, JSON.stringify(approved.json))
  assert.equal(approved.json.envelope.lines[0].mcp.canRun, true, 'the owner sees current Run authority in the approval acknowledgement')
  const ownerProjection = await call('GET', `/projects/${projectId}/contributions`, undefined, ownerHeaders)
  const ownerRow = ownerProjection.json.find((row: any) => row.id === contributionId)
  assert.equal(ownerRow.envelope.lines[0].mcp.canRun, true)
  const peerProjection = await call('GET', `/projects/${projectId}/contributions`, undefined, peerHeaders)
  const peerRow = peerProjection.json.find((row: any) => row.id === contributionId)
  assert.equal(peerProjection.status, 200)
  assert.equal(peerRow.envelope.lines[0].mcp.canRun, undefined, 'shared readers see results without a private Run control')
  const commentAck = await call('POST', `${path}/comments`, { body: 'The reviewed OAuth action looks ready.' }, { ...ownerHeaders, 'idempotency-key': `comment-${sequence}` })
  assert.equal(commentAck.status, 200, JSON.stringify(commentAck.json))
  assert.equal(commentAck.json.envelope.lines[0].mcp.canRun, true, 'comment acknowledgement preserves the owner’s current Run control')

  const runBody = { lineId, expectedVersion: 1 }
  const receiptKey = `owner-run-${sequence}`
  const peerRun = await callFresh('POST', `${path}/effects`, runBody, { ...peerHeaders, 'idempotency-key': receiptKey })
  assert.notEqual(peerRun.status, 200, 'peer cannot claim or replay an owner-bound receipt')
  assert.equal(peerTransport.calls, 0)
  const completed = await call('POST', `${path}/effects`, runBody, { ...ownerHeaders, 'idempotency-key': receiptKey })
  assert.equal(completed.status, 200, JSON.stringify(completed.json))
  const acknowledgement = completed.json
  assert.equal(acknowledgement.id, contributionId)
  assert.equal(acknowledgement.envelope.lines[0].mcp.canRun, true)
  assert.equal(acknowledgement.effects.at(-1).status, 'done', JSON.stringify({ effect: acknowledgement.effects.at(-1), resolverCalls, transportCalls: peerTransport.calls, requests: peerTransport.requests }))
  assert.doesNotMatch(JSON.stringify(acknowledgement.effects.at(-1)), new RegExp(owner.userId))
  assert.doesNotMatch(JSON.stringify(acknowledgement.effects.at(-1)), /credentialReference|mcpAuthority|schemaHash|endpoint/)
  assert.equal(resolverCalls, 1, 'one Run resolves the credential once for its actual person owner')
  assert.equal(peerTransport.calls, 1, 'one explicit Run dispatches one MCP tools/call')

  const ownerReplay = await callFresh('POST', `${path}/effects`, runBody, { ...ownerHeaders, 'idempotency-key': receiptKey })
  assert.equal(ownerReplay.status, 200)
  assert.equal(ownerReplay.json.id, contributionId)
  assert.equal(peerTransport.calls, 1, 'exact receipt replay returns settled truth without another call')
  const peerReplay = await callFresh('POST', `${path}/effects`, runBody, { ...peerHeaders, 'idempotency-key': receiptKey })
  assert.notEqual(peerReplay.status, 200, 'a same-tenant peer cannot replay the owner’s settled receipt')
  assert.equal(peerTransport.calls, 1)
  const disconnected = await call('POST', `/mcp-connections/${connectionId}/disconnect`, { expectedRevision: 1 }, ownerHeaders)
  assert.equal(disconnected.status, 200, JSON.stringify(disconnected.json))
  const ownerReplayAfterDisconnect = await callFresh('POST', `${path}/effects`, runBody, { ...ownerHeaders, 'idempotency-key': receiptKey })
  assert.equal(ownerReplayAfterDisconnect.status, 200, JSON.stringify(ownerReplayAfterDisconnect.json))
  assert.equal(ownerReplayAfterDisconnect.json.effects.at(-1).status, 'done')
  assert.equal(ownerReplayAfterDisconnect.json.envelope.lines[0].mcp.canRun, undefined, 'disconnect removes current Run authority but preserves the exact owner receipt')
  assert.equal(peerTransport.calls, 1, 'post-disconnect receipt replay never dispatches again')
  const sharedAfter = await callFresh('GET', `/projects/${projectId}/contributions`, undefined, peerHeaders)
  const sharedRow = sharedAfter.json.find((row: any) => row.id === contributionId)
  assert.equal(sharedRow.effects.at(-1).status, 'done', 'same-tenant peer can read the shared result')
  assert.equal(sharedRow.envelope.lines[0].mcp.canRun, undefined)
  assert.doesNotMatch(JSON.stringify(sharedRow), new RegExp(owner.userId))
  assert.ok(accounts.identityFor(peer.userId, tenantId), 'the peer is an actual org member, not a forged tenant header')
})

test('OAuth revocation while credentials are pending refuses before MCP I/O and settles the known receipt', { timeout: 30_000 }, async (t) => {
  const previousRuntime = mcpRuntimeConfiguration()
  t.after(() => configureMcpRuntime({ ...previousRuntime }))
  const { owner, peer, tenantId, ownerHeaders, peerHeaders } = await sharedTenant()
  let resolveCredential!: (token: string) => void
  let enteredResolver!: () => void
  const resolverEntered = new Promise<void>((resolve) => { enteredResolver = resolve })
  const credential = new Promise<string>((resolve) => { resolveCredential = resolve })
  let resolverCurrentAtRelease: boolean | undefined
  let announceToolCall!: () => void
  const toolCallStarted = new Promise<void>((resolve) => { announceToolCall = resolve })
  let releaseToolResult!: () => void
  const toolResult = new Promise<void>((resolve) => { releaseToolResult = resolve })
  const connectionId = await bindOwnerOAuth(tenantId, owner.userId)
  const localPeer = installLocalProtocolPeer(async () => {
    announceToolCall()
    await toolResult
    return { resultType: 'complete', content: [{ type: 'text', text: 'settled after owner loss' }], isError: false }
  })
  configureMcpRuntime({ deviceBearerAvailable: false, deviceOAuthAvailable: true, allowLoopback: false,
    resolveOAuthCredential: async (_reference, _binding, options) => {
      enteredResolver()
      const token = await credential
      resolverCurrentAtRelease = options.isCurrent()
      return token
    }, synchronizeBindings: async () => ({ available: true }) })
  await initializeMcpRuntime(store.mcpCredentialBindings())
  const projectId = project(tenantId)
  const opened = await call('POST', `/projects/${projectId}/contributions`, { title: 'Revoke during OAuth wait' }, { ...ownerHeaders, 'idempotency-key': `contribution-${sequence}` })
  assert.equal(opened.status, 200)
  const contributionId = opened.json.id
  const path = `/projects/${projectId}/contributions/${contributionId}`
  const proposed = await call('POST', `${path}/envelope`, proposal(connectionId, 'pending-credential'), { ...ownerHeaders, 'idempotency-key': `proposal-${sequence}` })
  assert.equal(proposed.status, 200, JSON.stringify(proposed.json))
  const lineId = proposed.json.envelope.lines[0].id
  assert.equal((await call('POST', `${path}/envelope/approve`, { expectedVersion: 1 }, { ...ownerHeaders, 'idempotency-key': `approval-${sequence}` })).status, 200)
  const beforeMemberships = accounts.memberships.slice()
  t.after(() => {
    accounts.memberships = beforeMemberships
    resolveCredential('local-test-oauth-token')
    releaseToolResult()
  })
  const run = call('POST', `${path}/effects`, { lineId, expectedVersion: 1 }, { ...ownerHeaders, 'idempotency-key': `run-${sequence}` })
  await resolverEntered
  accounts.memberships = accounts.memberships.filter((row) => !(row.userId === owner.userId && row.tenantId === tenantId))
  resolveCredential('local-test-oauth-token')
  const ownerResponse = await run
  assert.notEqual(ownerResponse.status, 200, 'revoked owner receives no fresh shared receipt acknowledgement')
  assert.equal(resolverCurrentAtRelease, false, 'the native resolver observes current ownership after suspension')
  assert.equal(localPeer.calls, 0, 'credential resolution after revocation refuses before TLS/MCP transport')
  accounts.memberships = beforeMemberships

  const knownResultRun = call('POST', `${path}/effects`, { lineId, expectedVersion: 1 }, { ...ownerHeaders, 'idempotency-key': `known-result-${sequence}` })
  await toolCallStarted
  accounts.memberships = accounts.memberships.filter((row) => !(row.userId === owner.userId && row.tenantId === tenantId))
  releaseToolResult()
  assert.notEqual((await knownResultRun).status, 200, 'post-dispatch revocation saves the known outcome without disclosing it to the revoked caller')
  assert.equal(localPeer.calls, 1, 'the admitted call was submitted once before membership loss')

  const peerProjection = await callFresh('GET', `/projects/${projectId}/contributions`, undefined, peerHeaders)
  const peerRow = peerProjection.json.find((row: any) => row.id === contributionId)
  assert.equal(peerRow.effects.at(-1)?.status, 'done', 'a known peer result settles after the owner loses membership')
  assert.equal(peerRow.effects.at(-1)?.result.content[0].text, 'settled after owner loss')
  assert.equal(peerRow.envelope.lines[0].mcp.canRun, undefined)
  assert.doesNotMatch(JSON.stringify(peerRow), new RegExp(owner.userId))
  accounts.memberships = beforeMemberships
})
