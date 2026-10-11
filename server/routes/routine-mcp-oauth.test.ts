/** Authenticated Routine MCP permissions for person-owned OAuth connections. */
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
const endpoint = 'https://8.8.8.8/routine-mcp'
const tool = { name: 'write', inputSchema: {
  type: 'object', properties: { value: { type: 'string' } }, required: ['value'], additionalProperties: false,
} }
const schemaHash = mcpToolSchemaHash(tool)
const cookieOf = (response: { headers: Record<string, string> }) => response.headers['set-cookie']?.split(';')[0] ?? ''
let store: typeof import('../store/index.ts').store
let call: typeof import('../testkit/http.ts').call
let callFresh: typeof import('../testkit/http.ts').callFresh
let originalHttpsRequest: typeof https.request
let protocolCalls = 0
let protocolRequests = 0
let protocolRequest: (body: any) => Promise<any> | any = () => ({
  resultType: 'complete', content: [{ type: 'text', text: 'written' }], isError: false,
})

before(async () => {
  originalHttpsRequest = https.request
  https.request = ((url: URL, _options: unknown, callback: (response: any) => void) => {
    const request = new EventEmitter() as EventEmitter & { end: (body?: Uint8Array) => void; destroy: () => void }
    request.destroy = () => request
    request.end = (encoded?: Uint8Array) => {
      void (async () => {
        protocolRequests++
        const body = JSON.parse(Buffer.from(encoded ?? []).toString('utf8'))
        assert.equal(url.hostname, new URL(endpoint).hostname)
        let result: unknown
        if (body.method === 'server/discover') {
          result = { resultType: 'complete', supportedVersions: [MCP_MODERN_VERSION], capabilities: { tools: {} },
            _meta: { 'io.modelcontextprotocol/serverInfo': { name: 'local-routine-oauth-peer', version: '1' } } }
        } else {
          assert.equal(body.method, 'tools/call')
          protocolCalls++
          result = await protocolRequest(body)
        }
        const response = new PassThrough() as PassThrough & { statusCode: number; headers: Record<string, string>; complete: boolean }
        response.statusCode = 200
        response.headers = { 'content-type': 'application/json' }
        response.complete = true
        callback(response)
        response.end(JSON.stringify({ jsonrpc: '2.0', id: body.id, result }))
      })().catch(error => request.emit('error', error))
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
  const email = `${tag}@routine-oauth.example`
  const response = await call('POST', '/auth/signup', { name: label, email, password: `${tag}-password` })
  assert.equal(response.status, 200, JSON.stringify(response.json))
  return { userId: response.json.user.id as string, email, cookie: cookieOf(response) }
}

function headers(userId: string, tenantId: string) {
  return { cookie: `uw_session=${signSession({ userId, tenantId, iat: Date.now() })}`,
    'x-account-transition-source': `session:${userId}` }
}

async function sharedTenant() {
  const owner = await account('Routine OAuth Owner')
  const peer = await account('Routine OAuth Peer')
  const org = await call('POST', '/orgs', { name: `Routine OAuth ${sequence}` }, { cookie: owner.cookie })
  assert.equal(org.status, 201, JSON.stringify(org.json))
  const invite = await call('POST', `/orgs/${org.json.id}/invites`, { email: peer.email }, { cookie: owner.cookie })
  assert.equal(invite.status, 201, JSON.stringify(invite.json))
  assert.equal((await call('POST', `/me/invites/${invite.json.id}/accept`, undefined, { cookie: peer.cookie })).status, 200)
  assert.ok(accounts.identityFor(owner.userId, org.json.id))
  assert.ok(accounts.identityFor(peer.userId, org.json.id))
  return { owner, peer, tenantId: org.json.id,
    ownerHeaders: headers(owner.userId, org.json.id), peerHeaders: headers(peer.userId, org.json.id) }
}

function provision(tenantId: string, label: string) {
  // A new organization has no seeded schedules; copy the fixture's neutral
  // Routine shape, then place the test-owned row in the real invited org.
  const source = store.listSchedules('tenant-personal')[0]!
  const { id: _id, tenantId: _tenantId, ...seed } = structuredClone(source)
  const task = store.addSchedule({ ...seed, tenantId, name: `${label} ${++sequence}`,
    runs: [], enabled: false, steps: [], delivery: { tool: { id: 'assistant', label: 'Assistant', tone: 'claude' }, target: 'Run conversation' } })
  return task
}

function bindOAuth(tenantId: string, ownerUserId: string, label: string) {
  const id = `mcp-connection-${(++sequence).toString(16).padStart(32, '0')}`
  const credentialReference = `MCP_DESKTOP_${sequence.toString(16).toUpperCase().padStart(32, '0')}`
  store.createMcpConnection({ id, label, endpoint, authentication: 'device-oauth' }, tenantId, false, ownerUserId)
  store.commitMcpInspection(id, tenantId, 0, {
    protocolVersion: MCP_MODERN_VERSION, cleanup: 'not-needed', tools: [tool],
    schemaAdmission: { version: MCP_SCHEMA_ADMISSION_VERSION, hashes: [schemaHash] },
  }, Date.now(), credentialReference, undefined, ownerUserId)
  return id
}

function approval(review: any, connectionId: string) {
  return { expectedRevision: review.policy.revision, expectedDefinitionRevision: review.definitionRevision,
    reviewHash: review.reviewHash, expiresAt: Date.now() + 24 * 60 * 60 * 1000, maxCallsPerRun: 2,
    tools: [{ connectionId, connectionRevision: 1, toolName: tool.name, schemaHash, fixedArguments: { value: 'from-policy' } }] }
}

function requestId(tag: string) { return `${tag}-${++sequence}` }

async function decisionWithHeldBody(path: string, body: unknown, requestHeaders: Record<string, string>) {
  const { buildRouter } = await import('./index.ts')
  let dataHandler: ((chunk: Uint8Array) => void) | undefined
  let endHandler: (() => void) | undefined
  let bodyRequested!: () => void
  const waitingForBody = new Promise<void>(resolve => { bodyRequested = resolve })
  let status = 0
  let responseBody = ''
  let ended = false
  let released = false
  const req: any = { method: 'POST', headers: requestHeaders,
    on(event: string, handler: (chunk?: Uint8Array) => void) {
      if (event === 'data') dataHandler = handler as (chunk: Uint8Array) => void
      if (event === 'end') { endHandler = handler as () => void; bodyRequested() }
      return req
    } }
  const res: any = {
    writeHead(code: number) { status = code; return res }, setHeader() {},
    write(chunk: string) { responseBody += chunk; return true },
    end(chunk?: string) { if (chunk) responseBody += chunk; ended = true },
    flushHeaders() {}, on() {}, get writableEnded() { return ended },
  }
  const dispatch = buildRouter().handle(req, res, new URL(`http://test${path}`))
  return { waitingForBody,
    release() {
      if (released) return
      released = true
      dataHandler?.(Buffer.from(JSON.stringify(body)))
      endHandler?.()
    },
    result: dispatch.then(() => ({ status, json: responseBody ? JSON.parse(responseBody) : undefined })),
  }
}

test('Routine MCP OAuth review and decision receipts are bound to the authenticated person', { timeout: 30_000 }, async (t) => {
  const { owner, peer, tenantId, ownerHeaders, peerHeaders } = await sharedTenant()
  const task = provision(tenantId, 'Person-owned Routine OAuth')
  const ownerConnection = bindOAuth(tenantId, owner.userId, 'Owner private OAuth')
  const peerConnection = bindOAuth(tenantId, peer.userId, 'Peer private OAuth')
  const path = `/schedules/${task.id}/mcp-permission`
  t.after(() => {
    try { store.removeSchedule(task.id) } catch {}
    try { store.removeMcpConnection(ownerConnection, tenantId, 1, owner.userId) } catch {}
    try { store.removeMcpConnection(peerConnection, tenantId, 1, peer.userId) } catch {}
  })

  const ownerReview = await call('GET', path, undefined, ownerHeaders)
  assert.equal(ownerReview.status, 200, JSON.stringify(ownerReview.json))
  assert.ok(ownerReview.json.tools.some((row: any) => row.connectionId === ownerConnection), 'owner sees the exact OAuth tool binding')
  const ownerDecision = { requestId: requestId('owner-oauth-approval'), action: 'approve',
    approval: approval(ownerReview.json, ownerConnection) }
  const approved = await call('POST', path, ownerDecision, ownerHeaders)
  assert.equal(approved.status, 200, JSON.stringify(approved.json))
  assert.equal(approved.json.review.policy.approval.tools[0].connectionId, ownerConnection)
  assert.doesNotMatch(JSON.stringify(approved.json), new RegExp(owner.userId), 'raw person id is private authority, not response data')
  assert.doesNotMatch(JSON.stringify(approved.json), /credentialReference|oauthAuthority|ownerUserId/)
  const queuedRun = store.runSchedule(task.id)!
  assert.equal(store.routineExecutionContext(task.id, queuedRun.id)?.blocked, undefined,
    'the original approving person’s exact permission is frozen when queued')

  const peerReview = await call('GET', path, undefined, peerHeaders)
  assert.equal(peerReview.status, 200, JSON.stringify(peerReview.json))
  assert.equal(peerReview.json.policy.approval, null, 'peer cannot inherit the other person’s approval')
  assert.equal(peerReview.json.policy.revision, approved.json.review.policy.revision, 'peer projection preserves the actual revision')
  assert.equal(peerReview.json.active, false)
  assert.equal(peerReview.json.otherPersonApproval?.active, true, 'peer gets only the additive status of the other person’s grant')
  assert.ok(peerReview.json.tools.some((row: any) => row.connectionId === peerConnection), 'peer sees their own exact OAuth catalog')
  assert.ok(!peerReview.json.tools.some((row: any) => row.connectionId === ownerConnection), 'peer never sees owner-private catalog IDs')
  assert.equal(peerReview.json.runs.length, 0, 'owner-private execution receipts are hidden from the peer')
  assert.doesNotMatch(JSON.stringify(peerReview.json), new RegExp(owner.userId))
  assert.doesNotMatch(JSON.stringify(peerReview.json), new RegExp(ownerConnection))

  const replayedByPeer = await callFresh('POST', path, ownerDecision, peerHeaders)
  assert.notEqual(replayedByPeer.status, 200, 'same request key cannot replay another person’s OAuth decision receipt')
  const forgedActor = await call('POST', path, { ...ownerDecision, requestId: requestId('forged-actor'), actorUserId: owner.userId }, peerHeaders)
  assert.equal(forgedActor.status, 400, 'request JSON cannot select the actor whose authority is used')

  const revoked = await call('POST', path, { requestId: requestId('peer-revoke-owner-grant'), action: 'revoke',
    expectedRevision: peerReview.json.policy.revision }, peerHeaders)
  assert.equal(revoked.status, 200, JSON.stringify(revoked.json))
  assert.equal(revoked.json.review.policy.approval, null)
  const afterRevoke = await call('GET', path, undefined, ownerHeaders)
  assert.equal(afterRevoke.json.policy.approval, null)

  const peerCurrent = await call('GET', path, undefined, peerHeaders)
  const ownApproval = { requestId: requestId('peer-oauth-approval'), action: 'approve',
    approval: approval(peerCurrent.json, peerConnection) }
  const peerApproved = await call('POST', path, ownApproval, peerHeaders)
  assert.equal(peerApproved.status, 200, JSON.stringify(peerApproved.json))
  assert.equal(peerApproved.json.review.policy.approval.tools[0].connectionId, peerConnection,
    'peer can replace the other person’s grant with the peer’s own connection')
  assert.doesNotMatch(JSON.stringify(peerApproved.json), new RegExp(peer.userId))
  const originalRun = store.routineExecutionContext(task.id, queuedRun.id)!
  assert.equal(originalRun.blocked?.code, 'authority_denied', 'replacement does not migrate a queued run to the peer’s authority')
  assert.equal(originalRun.routineMcp?.tools[0]?.connectionId, ownerConnection, 'the queued run retains the original connection')
  const requestsBefore = protocolRequests
  await assert.rejects(store.executeRoutineMcpCall(task.id, queuedRun.id, {
    connectionId: peerConnection, connectionRevision: 1, toolName: tool.name, schemaHash, arguments: { value: 'from-policy' },
  }, requestId('peer-cannot-adopt-queued-run')), (error: any) => error.code === 'denied')
  assert.equal(protocolRequests, requestsBefore, 'replacing approval cannot dispatch a peer connection from the old run')
  assert.ok(accounts.identityFor(peer.userId, tenantId))
})

test('disconnect while OAuth credentials are pending refuses before the MCP transport opens', { timeout: 30_000 }, async (t) => {
  const previousRuntime = mcpRuntimeConfiguration()
  t.after(() => configureMcpRuntime({ ...previousRuntime }))
  const { owner, peer, tenantId, ownerHeaders, peerHeaders } = await sharedTenant()
  const task = provision(tenantId, 'Routine OAuth credential wait')
  const connectionId = bindOAuth(tenantId, owner.userId, 'Waiting owner OAuth')
  const path = `/schedules/${task.id}/mcp-permission`
  t.after(() => {
    try { store.removeSchedule(task.id) } catch {}
    try { store.removeMcpConnection(connectionId, tenantId, 2, owner.userId) } catch {}
  })

  let releaseCredential!: (token: string) => void
  let announceResolver!: () => void
  const credential = new Promise<string>(resolve => { releaseCredential = resolve })
  const resolverEntered = new Promise<void>(resolve => { announceResolver = resolve })
  let isCurrentAfterDisconnect: boolean | undefined
  let resolverOwner: string | undefined
  protocolCalls = 0
  protocolRequest = async () => ({ resultType: 'complete', content: [{ type: 'text', text: 'must not be reached' }], isError: false })
  t.after(() => { releaseCredential('local-test-routine-oauth-token') })
  configureMcpRuntime({ deviceBearerAvailable: false, deviceOAuthAvailable: true, allowLoopback: false,
    resolveOAuthCredential: async (_reference, binding, options) => {
      resolverOwner = binding.ownerUserId
      announceResolver()
      const token = await credential
      isCurrentAfterDisconnect = options.isCurrent()
      return token
    }, synchronizeBindings: async () => ({ available: true }) })
  await initializeMcpRuntime(store.mcpCredentialBindings())

  const reviewed = await call('GET', path, undefined, ownerHeaders)
  const approved = await call('POST', path, { requestId: requestId('credential-wait-approval'), action: 'approve',
    approval: approval(reviewed.json, connectionId) }, ownerHeaders)
  assert.equal(approved.status, 200, JSON.stringify(approved.json))
  const run = store.runSchedule(task.id)!
  const callData = { connectionId, connectionRevision: 1, toolName: tool.name, schemaHash, arguments: { value: 'from-policy' } }
  const execution = store.executeRoutineMcpCall(task.id, run.id, callData, requestId('credential-wait-call'))
  await resolverEntered
  assert.equal(resolverOwner, owner.userId, 'queued person identity reaches the credential resolver')

  const disconnected = await call('POST', `/mcp-connections/${connectionId}/disconnect`, { expectedRevision: 1 }, ownerHeaders)
  assert.equal(disconnected.status, 200, JSON.stringify(disconnected.json))
  releaseCredential('local-test-routine-oauth-token')
  const receipt = await execution
  assert.equal(isCurrentAfterDisconnect, false, 'the resolver callback observes the disconnected binding')
  assert.equal(receipt.status, 'failed', 'the reserved call settles as a known pre-dispatch refusal')
  assert.equal(protocolCalls, 0, 'no MCP transport request is opened after the connection revision changes')
  assert.equal(store.routineMcpRunMayRetry(task.id, run.id), false, 'even a known refusal occupies its host call key')
  const peerReview = await call('GET', path, undefined, peerHeaders)
  assert.equal(peerReview.json.runs.length, 0, 'the private refusal receipt is not shared with the same-tenant peer')
})

test('Routine OAuth membership loss during POST body read cannot replace personal approval with legacy authority', { timeout: 30_000 }, async (t) => {
  const previousRuntime = mcpRuntimeConfiguration()
  const { owner: manager, peer: owner, tenantId, peerHeaders: ownerHeaders } = await sharedTenant()
  const task = provision(tenantId, 'Routine OAuth held approval body')
  const connectionId = bindOAuth(tenantId, owner.userId, 'Original member OAuth')
  const legacyConnectionId = `mcp-connection-${(++sequence).toString(16).padStart(32, '0')}`
  store.createMcpConnection({ id: legacyConnectionId, label: 'Workspace legacy connection', endpoint, authentication: 'none' }, tenantId)
  store.commitMcpInspection(legacyConnectionId, tenantId, 0, {
    protocolVersion: MCP_MODERN_VERSION, cleanup: 'not-needed', tools: [tool],
    schemaAdmission: { version: MCP_SCHEMA_ADMISSION_VERSION, hashes: [schemaHash] },
  }, Date.now())
  const membership = accounts.membership(owner.userId, tenantId)!
  assert.equal(membership.role, 'member')
  assert.equal(membership.home, undefined)
  let resolverCalls = 0
  protocolCalls = 0
  protocolRequests = 0
  configureMcpRuntime({ deviceBearerAvailable: false, deviceOAuthAvailable: true, allowLoopback: false,
    resolveOAuthCredential: async () => { resolverCalls++; return 'unused-routine-oauth-token' },
    synchronizeBindings: async () => ({ available: true }) })
  let pending: Awaited<ReturnType<typeof decisionWithHeldBody>> | undefined
  t.after(async () => {
    if (pending) { pending.release(); await pending.result }
    if (!accounts.membership(owner.userId, tenantId)) accounts.memberships.push(membership)
    try { store.removeSchedule(task.id) } catch {}
    try { store.removeMcpConnection(connectionId, tenantId, 1, owner.userId) } catch {}
    try { store.removeMcpConnection(legacyConnectionId, tenantId, 1) } catch {}
    configureMcpRuntime({ ...previousRuntime })
  })
  await initializeMcpRuntime(store.mcpCredentialBindings())
  const path = `/schedules/${task.id}/mcp-permission`
  const reviewed = await call('GET', path, undefined, ownerHeaders)
  assert.equal(reviewed.status, 200, JSON.stringify(reviewed.json))
  const approved = await call('POST', path, { requestId: requestId('held-body-original-approval'), action: 'approve',
    approval: approval(reviewed.json, connectionId) }, ownerHeaders)
  assert.equal(approved.status, 200, JSON.stringify(approved.json))
  const originalPolicy = structuredClone(approved.json.review.policy)
  assert.ok(approved.json.review.tools.some((row: any) => row.connectionId === legacyConnectionId),
    'the live member can review the legacy connection before their membership ends')
  pending = await decisionWithHeldBody(path, { requestId: requestId('held-body-legacy-replacement'), action: 'approve',
    approval: approval(approved.json.review, legacyConnectionId) }, ownerHeaders)
  const boundary = await Promise.race([
    pending.waitingForBody.then(() => 'body'), pending.result.then(result => `response:${result.status}`),
  ])
  assert.equal(boundary, 'body', 'real route captures a valid member before awaiting their request body')
  // No member-removal API exists yet. Remove only the accepted non-home seat;
  // the organization’s founder and both personal namespaces remain intact.
  accounts.memberships = accounts.memberships.filter(row => row !== membership)
  assert.equal(accounts.identityFor(owner.userId, tenantId), null)
  assert.ok(accounts.identityFor(manager.userId, tenantId))
  pending.release()
  const result = await pending.result
  assert.equal(resolverCalls, 0, 'permission changes do not consult the credential vault')
  assert.equal(protocolRequests, 0, 'the refused mutation performs no MCP discovery or call')
  assert.equal(protocolCalls, 0)
  assert.equal(result.status, 404, 'a captured actor who lost membership cannot replace OAuth permission through an ownerless legacy approval')
  accounts.memberships.push(membership)
  const restoredOwner = await call('GET', path, undefined, ownerHeaders)
  assert.equal(restoredOwner.status, 200)
  assert.deepEqual(restoredOwner.json.policy, originalPolicy, 'the refused POST leaves original personal approval and revision unchanged')
})

for (const timing of ['before-dispatch', 'credential-wait'] as const) {
  test(`Routine OAuth membership loss ${timing} prevents dispatch, output and peer receipt disclosure`, { timeout: 30_000 }, async (t) => {
    const previousRuntime = mcpRuntimeConfiguration()
    // The connection owner is the invited member, not the founding owner: their
    // removable non-home seat can disappear without leaving an ownerless org.
    const { owner: manager, peer: owner, tenantId, ownerHeaders: managerHeaders, peerHeaders: ownerHeaders } = await sharedTenant()
    const task = provision(tenantId, `Routine OAuth membership loss ${timing}`)
    const connectionId = bindOAuth(tenantId, owner.userId, 'Departing member OAuth')
    const path = `/schedules/${task.id}/mcp-permission`
    const membership = accounts.membership(owner.userId, tenantId)!
    assert.equal(membership.role, 'member')
    assert.equal(membership.home, undefined)
    let releaseCredential!: (token: string) => void
    let announceResolver!: () => void
    const credential = new Promise<string>(resolve => { releaseCredential = resolve })
    const resolverEntered = new Promise<void>(resolve => { announceResolver = resolve })
    let resolverCalls = 0
    let isCurrentAfterRemoval: boolean | undefined
    protocolCalls = 0
    protocolRequests = 0
    t.after(() => {
      releaseCredential('local-test-routine-oauth-token')
      if (!accounts.membership(owner.userId, tenantId)) accounts.memberships.push(membership)
      try { store.removeSchedule(task.id) } catch {}
      try { store.removeMcpConnection(connectionId, tenantId, 1, owner.userId) } catch {}
      configureMcpRuntime({ ...previousRuntime })
    })
    protocolRequest = async () => ({ resultType: 'complete', content: [{ type: 'text', text: 'must not dispatch' }], isError: false })
    configureMcpRuntime({ deviceBearerAvailable: false, deviceOAuthAvailable: true, allowLoopback: false,
      resolveOAuthCredential: async (_reference, binding, options) => {
        resolverCalls++
        assert.equal(binding.ownerUserId, owner.userId, 'credential lookup uses the frozen approving member')
        announceResolver()
        if (timing === 'credential-wait') await credential
        isCurrentAfterRemoval = options.isCurrent()
        return 'local-test-routine-oauth-token'
      }, synchronizeBindings: async () => ({ available: true }) })
    await initializeMcpRuntime(store.mcpCredentialBindings())

    const reviewed = await call('GET', path, undefined, ownerHeaders)
    assert.equal(reviewed.status, 200, JSON.stringify(reviewed.json))
    const approved = await call('POST', path, { requestId: requestId('membership-loss-approval'), action: 'approve',
      approval: approval(reviewed.json, connectionId) }, ownerHeaders)
    assert.equal(approved.status, 200, JSON.stringify(approved.json))
    const run = store.runSchedule(task.id)!
    const context = store.routineExecutionContext(task.id, run.id)!
    assert.ok(context.routineMcp)
    assert.equal(context.blocked, undefined, 'the actual invited member approval is executable before removal')
    const callData = { connectionId, connectionRevision: 1, toolName: tool.name, schemaHash, arguments: { value: 'from-policy' } }
    let execution: ReturnType<typeof store.executeRoutineMcpCall> | undefined
    if (timing === 'credential-wait') {
      execution = store.executeRoutineMcpCall(task.id, run.id, callData, requestId('membership-loss-call'))
      const entered = await Promise.race([
        resolverEntered.then(() => 'resolver'),
        execution.then(receipt => `settled:${receipt.status}`),
        new Promise<string>(resolve => setTimeout(() => resolve('timed-out'), 3_000)),
      ])
      assert.equal(entered, 'resolver', 'the live member reaches the credential await before losing their seat')
      assert.equal(protocolRequests, 0)
    }

    // There is no remove-member/leave-org route or registry method yet. Model
    // that lifecycle event by removing only this real, accepted non-home seat.
    accounts.memberships = accounts.memberships.filter(row => row !== membership)
    assert.equal(accounts.identityFor(owner.userId, tenantId), null)
    assert.ok(accounts.identityFor(manager.userId, tenantId), 'the organization still has its founding owner')
    assert.ok(accounts.homeOf(owner.userId), 'revocation does not remove the member’s personal namespace')
    if (execution) {
      releaseCredential('local-test-routine-oauth-token')
      const receipt = await execution
      assert.equal(isCurrentAfterRemoval, false, 'credential completion rechecks actual workspace membership')
      assert.equal(receipt.status, 'failed', 'the private reserved receipt settles as known pre-dispatch refusal')
      assert.equal(resolverCalls, 1)
      assert.equal(store.routineMcpRunMayRetry(task.id, run.id), false)
    } else {
      await assert.rejects(store.executeRoutineMcpCall(task.id, run.id, callData, requestId('membership-loss-call')),
        (error: any) => error.code === 'denied', 'a queued grant cannot survive the approving member’s departure')
      assert.equal(resolverCalls, 0, 'membership loss before dispatch does not consult the credential vault')
    }
    assert.equal(protocolRequests, 0, 'membership loss cannot open even an MCP discovery request')
    assert.equal(protocolCalls, 0)
    assert.equal(store.routineExecutionContext(task.id, run.id)?.blocked?.code, 'authority_denied')
    const completed = store.completeScheduleRun(task.id, run.id, {
      id: 'must-not-publish-membership-loss', role: 'assistant', content: 'PRIVATE: departed member model output',
    }, { agentId: context.agent.id, providerId: context.provider.id })
    assert.equal(completed?.status, 'failed', 'lost membership blocks output even if a worker tries to finish')
    assert.ok(!store.getSession(context.sessionId)?.messages.some(message => message.content.includes('PRIVATE: departed member')))
    assert.equal((await call('GET', path, undefined, ownerHeaders)).status, 404, 'a stale org session cannot recover private receipts')
    const peerReview = await call('GET', path, undefined, managerHeaders)
    assert.equal(peerReview.status, 200, JSON.stringify(peerReview.json))
    assert.equal(peerReview.json.runs.length, 0, 'remaining members cannot read another person’s frozen run or refusal')
    assert.doesNotMatch(JSON.stringify(peerReview.json), new RegExp(connectionId))
    assert.doesNotMatch(JSON.stringify(peerReview.json), /PRIVATE: departed member/)
  })
}

test('queued OAuth Routine call resolves as its frozen person, settles known output privately after revocation, and never republishes it', { timeout: 30_000 }, async (t) => {
  const previousRuntime = mcpRuntimeConfiguration()
  t.after(() => configureMcpRuntime({ ...previousRuntime }))
  const { owner, peer, tenantId, ownerHeaders, peerHeaders } = await sharedTenant()
  const task = provision(tenantId, 'Routine OAuth frozen actor')
  const connectionId = bindOAuth(tenantId, owner.userId, 'Frozen owner OAuth')
  const path = `/schedules/${task.id}/mcp-permission`
  t.after(() => {
    try { store.removeSchedule(task.id) } catch {}
    try { store.removeMcpConnection(connectionId, tenantId, 1, owner.userId) } catch {}
  })

  let releaseResult!: () => void
  let announceCall!: () => void
  const transportEntered = new Promise<void>(resolve => { announceCall = resolve })
  const heldResult = new Promise<void>(resolve => { releaseResult = resolve })
  protocolCalls = 0
  protocolRequest = async (body) => {
    assert.equal(body.params.name, 'write')
    assert.deepEqual(body.params.arguments, { value: 'from-policy' }, 'model arguments cannot override frozen fixed arguments')
    announceCall()
    await heldResult
    return { resultType: 'complete', content: [{ type: 'text', text: 'known result after revocation' }], isError: false }
  }
  t.after(() => { releaseResult() })

  let resolverOwner: string | undefined
  let resolverCurrent: boolean | undefined
  configureMcpRuntime({ deviceBearerAvailable: false, deviceOAuthAvailable: true, allowLoopback: false,
    resolveOAuthCredential: async (_reference, binding, options) => {
      resolverOwner = binding.ownerUserId
      resolverCurrent = options.isCurrent()
      return 'local-test-routine-oauth-token'
    }, synchronizeBindings: async () => ({ available: true }) })
  await initializeMcpRuntime(store.mcpCredentialBindings())

  const reviewed = await call('GET', path, undefined, ownerHeaders)
  assert.equal(reviewed.status, 200, JSON.stringify(reviewed.json))
  const approved = await call('POST', path, { requestId: requestId('frozen-owner-approval'), action: 'approve',
    approval: approval(reviewed.json, connectionId) }, ownerHeaders)
  assert.equal(approved.status, 200, JSON.stringify(approved.json))
  const run = store.runSchedule(task.id)!
  const context = store.routineExecutionContext(task.id, run.id)
  assert.ok(context?.routineMcp)
  const callData = { connectionId, connectionRevision: 1, toolName: tool.name, schemaHash, arguments: { value: 'from-policy' } }
  const execution = store.executeRoutineMcpCall(task.id, run.id, callData, requestId('host-call'))
  const entered = await Promise.race([
    transportEntered.then(() => 'transport'),
    execution.then(receipt => `settled:${receipt.status}:${receipt.summary}`),
    new Promise<string>(resolve => setTimeout(() => resolve('timed-out'), 3_000)),
  ])
  assert.equal(entered, 'transport', 'the queued person-owned permission admits its exact reviewed call')
  assert.equal(resolverOwner, owner.userId, 'OAuth resolver receives queued authority owner, not viewer/model data')
  assert.equal(resolverCurrent, true)

  const revoked = await call('POST', path, { requestId: requestId('owner-revoke-in-flight'), action: 'revoke',
    expectedRevision: approved.json.review.policy.revision }, ownerHeaders)
  assert.equal(revoked.status, 200, JSON.stringify(revoked.json))
  releaseResult()
  const receipt = await execution
  assert.equal(receipt.status, 'done')
  assert.equal(receipt.result?.content?.[0]?.text, 'known result after revocation')
  assert.equal(protocolCalls, 1, 'the already-dispatched call settles exactly once')

  const ownerLedger = await call('GET', path, undefined, ownerHeaders)
  assert.equal(ownerLedger.status, 200)
  const ownerRun = ownerLedger.json.runs.find((row: any) => row.runId === run.id)
  assert.equal(ownerRun.calls[0].status, 'done', 'the authenticated OAuth owner can recover the durable known receipt')
  assert.equal(ownerRun.calls[0].result.content[0].text, 'known result after revocation')
  const peerLedger = await call('GET', path, undefined, peerHeaders)
  assert.equal(peerLedger.json.runs.length, 0, 'same-tenant peer cannot read private OAuth result receipts')
  assert.doesNotMatch(JSON.stringify(peerLedger.json), /known result after revocation/)

  const completed = store.completeScheduleRun(task.id, run.id, {
    id: 'must-not-publish', role: 'assistant', content: 'The model saw a revoked OAuth result and must not publish.'
  }, { agentId: context!.agent.id, providerId: context!.provider.id })
  assert.equal(completed?.status, 'failed', 'revocation after a known external result blocks Routine output publication')
  const session = store.getSession(context!.sessionId)
  assert.ok(!session?.messages.some(message => message.content.includes('must not publish')),
    'the known result stays in the private ledger and no Routine model output is published')
  assert.equal(store.routineMcpRunMayRetry(task.id, run.id), false, 'a represented external call is never automatically retried')
})
