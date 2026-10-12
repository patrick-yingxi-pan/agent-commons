/** Direct store acceptance for private, explicitly approved local Routine work.
 * Only account/org setup uses HTTP. Execution uses the real shared executor
 * with an injected protocol peer; no process, network or credential is used. */
import assert from 'node:assert/strict'
import { test, type TestContext } from 'node:test'
import type { McpBoundToolCall } from '../../contract/mcpExecution.ts'
import type { RoutineMcpApprovalIntent } from '../../contract/routineMcp.ts'
import type { RoutineMcpReview } from '../../contract/routineMcpApi.ts'
import { accounts } from '../accounts.ts'
import { call as accountCall } from '../testkit/http.ts'
import { MCP_MODERN_VERSION } from '../mcpProtocol.ts'
import { MCP_SCHEMA_ADMISSION_VERSION, mcpToolSchemaHash } from '../mcpToolAdmission.ts'
import { configureMcpRuntime, initializeMcpRuntime, mcpRuntimeConfiguration, type McpStdioBinding } from '../mcpRuntime.ts'
import type { McpStdioConnection } from '../mcpStdioClient.ts'
import { RoutineMcpPolicyError } from '../routineMcpPolicy.ts'
import { store } from './index.ts'

let sequence = 0
const nextId = (prefix: string) => `${prefix}-${++sequence}`
const tool = { name: 'write', inputSchema: {
  type: 'object', properties: { value: { type: 'string' } }, required: ['value'], additionalProperties: false,
} }
const schemaHash = mcpToolSchemaHash(tool)
const privateOutput = 'Private local Routine result'

async function account(name: string) {
  const tag = nextId('routine-local')
  const email = `${tag}@routine-local.example`
  const response = await accountCall('POST', '/auth/signup', { name, email, password: `${tag}-password` })
  assert.equal(response.status, 200, JSON.stringify(response.json))
  return { userId: response.json.user.id as string, email, cookie: response.headers['set-cookie']?.split(';')[0] ?? '' }
}

async function fixture(t: TestContext) {
  const prior = mcpRuntimeConfiguration()
  configureMcpRuntime({ deviceBearerAvailable: false, allowLoopback: false })
  // The approving person is the invited member, not the organization's owner.
  // This catches accidental attribution to a stronger workspace principal.
  const peer = await account('Routine workspace owner')
  const owner = await account('Routine local program owner')
  const org = await accountCall('POST', '/orgs', { name: nextId('Routine local workspace') }, { cookie: peer.cookie })
  assert.equal(org.status, 201, JSON.stringify(org.json))
  const tenantId = org.json.id as string
  const invite = await accountCall('POST', `/orgs/${tenantId}/invites`, { email: owner.email }, { cookie: peer.cookie })
  assert.equal(invite.status, 201, JSON.stringify(invite.json))
  assert.equal((await accountCall('POST', `/me/invites/${invite.json.id}/accept`, undefined, { cookie: owner.cookie })).status, 200)
  assert.equal(accounts.membership(owner.userId, tenantId)?.role, 'member')
  assert.ok(accounts.identityFor(peer.userId, tenantId))

  const source = store.listSchedules('tenant-personal')[0]!
  const { id: _id, tenantId: _tenantId, ...seed } = structuredClone(source)
  const task = store.addSchedule({ ...seed, tenantId, name: nextId('Local Routine'), runs: [], enabled: false, steps: [],
    delivery: { tool: { id: 'assistant', label: 'Assistant', tone: 'claude' }, target: 'Run conversation' } })
  const connections: Array<{ id: string; person: string; reference: string }> = []
  function bind(person = owner.userId) {
    const id = `mcp-connection-${(++sequence).toString(16).padStart(32, '0')}`
    const reference = `MCP_STDIO_${sequence.toString(16).toUpperCase().padStart(32, '0')}`
    store.createMcpConnection({ transport: 'stdio', id, label: person === owner.userId ? 'Private local writer' : 'Peer local writer' }, tenantId, false, person)
    store.commitMcpInspection(id, tenantId, 0, {
      protocolVersion: MCP_MODERN_VERSION, cleanup: 'released', tools: [tool],
      schemaAdmission: { version: MCP_SCHEMA_ADMISSION_VERSION, hashes: [schemaHash] },
    }, Date.now(), undefined, undefined, person, reference)
    const connection = { id, person, reference }
    connections.push(connection)
    return connection
  }
  const connection = bind()
  const review = (person = owner.userId): RoutineMcpReview => {
    const value = store.routineMcpReview(task.id, tenantId, person)
    assert.ok(value)
    return value
  }
  const intent = (person = owner.userId, connectionId = connection.id): RoutineMcpApprovalIntent => {
    const current = review(person)
    return { expectedRevision: current.policy.revision, expectedDefinitionRevision: current.definitionRevision,
      reviewHash: current.reviewHash, expiresAt: Date.now() + 24 * 60 * 60 * 1000, maxCallsPerRun: 2, localPrograms: true,
      tools: [{ connectionId, connectionRevision: 1, toolName: tool.name, schemaHash, fixedArguments: { value: 'once' } }] }
  }
  const approve = (person = owner.userId, connectionId = connection.id) => {
    const decision = store.decideRoutineMcp(task.id, tenantId,
      { requestId: nextId('approval'), action: 'approve', approval: intent(person, connectionId) }, person)
    assert.ok(decision)
    assert.equal(decision.review.active, true)
    return decision
  }
  const revoke = (person = owner.userId) => {
    const decision = store.decideRoutineMcp(task.id, tenantId,
      { requestId: nextId('revoke'), action: 'revoke', expectedRevision: review(person).policy.revision }, person)
    assert.ok(decision)
    return decision
  }
  const call: McpBoundToolCall = { connectionId: connection.id, connectionRevision: 1, toolName: tool.name, schemaHash, arguments: { value: 'once' } }
  t.after(() => {
    for (const run of task.runs) if (run.status === 'running') store.failScheduleRun(task.id, run.id, 'execution_error', 'Test cleanup.')
    store.removeSchedule(task.id)
    for (const row of connections) {
      const current = store.mcpConnection(row.id, tenantId, row.person)
      if (current) store.removeMcpConnection(row.id, tenantId, current.revision, row.person)
    }
    configureMcpRuntime({ ...prior })
  })
  return { task, tenantId, owner, peer, connection, bind, review, intent, approve, revoke, call }
}
type Fixture = Awaited<ReturnType<typeof fixture>>

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>(done => { resolve = done })
  return { promise, resolve }
}

function nativePeer(f: Fixture, options: {
  startupFailure?: boolean
  discover?: () => Promise<void>
  dispatched?: () => Promise<void>
} = {}) {
  const seen = { opens: [] as Array<{ reference: string; binding: McpStdioBinding; purpose: string }>,
    calls: 0, discoveries: 0, closes: 0, pendingBeforeOpen: false, dispatchGuards: [] as boolean[] }
  configureMcpRuntime({ deviceBearerAvailable: false, allowLoopback: false,
    localProcessesAvailable: true, synchronizeStdioBindings: async () => ({ available: true }),
    openStdio: (reference, binding, input): McpStdioConnection => {
      seen.opens.push({ reference, binding, purpose: input.purpose })
      seen.pendingBeforeOpen = f.review().runs.some(run => run.calls.some(call => call.status === 'pending' && call.transport === 'stdio'))
      if (options.startupFailure) throw Object.assign(new Error('private startup diagnostic'), { code: 'unavailable', mayHaveSubmitted: false })
      return {
        request: async (method, params, { beforeDispatch }) => {
          if (method === 'server/discover') {
            seen.discoveries++
            await options.discover?.()
            return { jsonrpc: '2.0', id: 'discover', result: {
              resultType: 'complete', supportedVersions: [MCP_MODERN_VERSION], capabilities: { tools: {} },
              _meta: { 'io.modelcontextprotocol/serverInfo': { name: 'authored-routine-local-peer', version: '1' } },
            } }
          }
          assert.equal(method, 'tools/call')
          const allowed = beforeDispatch?.() === true
          seen.dispatchGuards.push(allowed)
          assert.equal(allowed, true, 'the actual native write edge must recheck current authority')
          seen.calls++
          assert.equal(params.name, tool.name)
          assert.deepEqual(params.arguments, { value: 'once' })
          await options.dispatched?.()
          return { jsonrpc: '2.0', id: 'call', result: {
            resultType: 'complete', content: [{ type: 'text', text: privateOutput }], isError: false,
          } }
        },
        initialized: async () => undefined,
        close: async () => { seen.closes++; return { code: 'released' } },
        closed: Promise.resolve({ code: 'released' }),
      }
    },
  })
  const ready = () => initializeMcpRuntime(store.mcpCredentialBindings(), store.mcpStdioBindings())
  return { seen, ready }
}

function assertPrivate(f: Fixture) {
  const peer = f.review(f.peer.userId)
  assert.equal(peer.policy.approval, null)
  assert.deepEqual(peer.runs, [])
  assert.ok(!JSON.stringify(peer).includes(f.connection.id), 'even the organization owner cannot see another person’s local binding')
  assert.ok(!JSON.stringify(peer).includes(privateOutput))
  const shared = store.listSchedules(f.tenantId).find(row => row.id === f.task.id)!
  assert.ok(!JSON.stringify(shared).includes(f.connection.id), 'ordinary Routine rows contain no private connection or ledger')
  assert.ok(!JSON.stringify(shared).includes(privateOutput))
}

function finish(f: Fixture, runId: string, content = 'Done.') {
  const context = store.routineExecutionContext(f.task.id, runId)!
  return store.completeScheduleRun(f.task.id, runId, { id: nextId('finish'), role: 'assistant', content },
    { agentId: context.agent.id, providerId: context.provider.id })
}

test('local Routine approval requires a ready native host, literal opt-in and a fresh person-specific review', { timeout: 30_000 }, async t => {
  const f = await fixture(t)
  const peerConnection = f.bind(f.peer.userId)
  const submit = (approval: RoutineMcpApprovalIntent) => store.decideRoutineMcp(f.task.id, f.tenantId,
    { requestId: nextId('candidate'), action: 'approve', approval }, f.owner.userId)
  assert.deepEqual(f.review().tools, [])
  assert.throws(() => submit(f.intent()), RoutineMcpPolicyError, 'stored local bindings do not enable a default-off host')
  const native = nativePeer(f)
  assert.deepEqual(f.review().tools, [], 'configuration alone is not the native boot acknowledgement')
  assert.throws(() => submit(f.intent()), RoutineMcpPolicyError)
  await native.ready()
  assert.deepEqual(f.review().tools.map(row => [row.connectionId, row.transport]), [[f.connection.id, 'stdio']])
  assert.deepEqual(f.review(f.peer.userId).tools.map(row => row.connectionId), [peerConnection.id])
  const { localPrograms: _localPrograms, ...absent } = f.intent()
  for (const candidate of [absent, { ...absent, localPrograms: false }, { ...absent, localPrograms: null }]) {
    assert.throws(() => submit(candidate as RoutineMcpApprovalIntent), RoutineMcpPolicyError)
    assert.equal(f.review().policy.revision, 0, 'refused consent must not advance policy state')
  }
  assert.throws(() => submit(f.intent(f.owner.userId, peerConnection.id)), RoutineMcpPolicyError)
  const stale = f.intent()
  store.updateSchedule(f.task.id, { prompt: 'New reviewed local Routine instructions.' })
  assert.throws(() => submit(stale), RoutineMcpPolicyError)
  const approved = f.approve()
  assert.equal(approved.review.policy.approval?.localPrograms, true)
  assert.deepEqual(f.review(f.peer.userId).otherPersonApproval, { active: true })
  assert.doesNotMatch(JSON.stringify(approved.review), /MCP_STDIO_|ownerUserId|localAuthority|grantReference/)
  assertPrivate(f)
  assert.equal(native.seen.opens.length, 0, 'review and approval do not launch a local program')

  const run = store.runSchedule(f.task.id)!
  configureMcpRuntime({ deviceBearerAvailable: false, allowLoopback: false })
  assert.equal(f.review().active, false)
  assert.equal(store.routineExecutionContext(f.task.id, run.id)?.blocked?.code, 'authority_denied')
  await assert.rejects(store.executeRoutineMcpCall(f.task.id, run.id, f.call, nextId('host-off-call')), RoutineMcpPolicyError)
  assert.equal(native.seen.opens.length, 0, 'a formerly approved saved grant cannot restore host execution capability')
})

test('local Routine execution uses its frozen member, commits before I/O and retains private history after revoke and retirement', { timeout: 30_000 }, async t => {
  const f = await fixture(t)
  const native = nativePeer(f)
  await native.ready()
  f.approve()
  const run = store.runSchedule(f.task.id)!
  const context = store.routineExecutionContext(f.task.id, run.id)!
  assert.equal(context.blocked, undefined)
  assert.deepEqual(context.externalMcpConnections?.map(row => row.id), [f.connection.id])
  assertPrivate(f)
  const key = nextId('frozen-owner-call')
  const receipt = await store.executeRoutineMcpCall(f.task.id, run.id, f.call, key)
  assert.equal(receipt.status, 'done')
  assert.equal(receipt.transport, 'stdio')
  assert.equal(receipt.result?.content[0]?.text, privateOutput)
  assert.equal(native.seen.pendingBeforeOpen, true)
  assert.deepEqual(native.seen.opens, [{ reference: f.connection.reference, purpose: 'call', binding: {
    tenantId: f.tenantId, ownerUserId: f.owner.userId, connectionId: f.connection.id, connectionRevision: 1,
  } }])
  assert.equal(native.seen.calls, 1)
  assert.equal(native.seen.closes, 1)
  assert.deepEqual(native.seen.dispatchGuards, [true])
  assert.deepEqual(await store.executeRoutineMcpCall(f.task.id, run.id, f.call, key), receipt)
  assert.equal(native.seen.opens.length, 1, 'exact receipt replay cannot respawn the program')
  assertPrivate(f)

  f.revoke(f.peer.userId)
  store.removeMcpConnection(f.connection.id, f.tenantId, 1, f.owner.userId)
  configureMcpRuntime({ deviceBearerAvailable: false, allowLoopback: false })
  assert.equal(f.review().policy.approval, null)
  assert.deepEqual(f.review().runs[0]?.calls, [receipt], 'known personal history survives revocation, retirement and an incapable host')
  assertPrivate(f)
  assert.equal(finish(f, run.id, 'PRIVATE: should never publish')?.status, 'failed')
  assert.ok(!store.getSession(context.sessionId)?.messages.some(message => message.content.includes('PRIVATE: should never publish')))
  assert.deepEqual(f.review().runs[0]?.calls, [receipt])
  assert.equal(native.seen.opens.length, 1)
})

test('a local grant cannot enter a previously queued job or replace its frozen approving person', { timeout: 30_000 }, async t => {
  const f = await fixture(t)
  const otherConnection = f.bind(f.peer.userId)
  const native = nativePeer(f)
  await native.ready()
  const unapproved = store.runSchedule(f.task.id)!
  f.approve()
  assert.equal(store.routineExecutionContext(f.task.id, unapproved.id)?.routineMcp, undefined)
  await assert.rejects(store.executeRoutineMcpCall(f.task.id, unapproved.id, f.call, nextId('late-approval')), RoutineMcpPolicyError)
  assert.equal(finish(f, unapproved.id)?.status, 'ok')

  const frozen = store.runSchedule(f.task.id)!
  assert.ok(store.routineExecutionContext(f.task.id, frozen.id)?.routineMcp)
  f.approve(f.peer.userId, otherConnection.id)
  assert.equal(store.routineExecutionContext(f.task.id, frozen.id)?.blocked?.code, 'authority_denied')
  for (const call of [f.call, { ...f.call, connectionId: otherConnection.id }]) {
    await assert.rejects(store.executeRoutineMcpCall(f.task.id, frozen.id, call, nextId('replacement-person')), RoutineMcpPolicyError)
  }
  assert.equal(native.seen.opens.length, 0, 'neither person’s native grant repairs an older queued policy')
  assert.equal(f.review().runs.some(run => run.runId === frozen.id), true)
  assert.equal(f.review(f.peer.userId).runs.some(run => run.runId === frozen.id), false, 'even an empty frozen ledger keeps the original person')
})

test('local startup failure with no result pauses, revokes and fences future cadence until a new review', { timeout: 30_000 }, async t => {
  const f = await fixture(t)
  const native = nativePeer(f, { startupFailure: true })
  await native.ready()
  store.updateSchedule(f.task.id, { enabled: true })
  const approved = f.approve()
  const run = store.runSchedule(f.task.id)!
  const receipt = await store.executeRoutineMcpCall(f.task.id, run.id, f.call, nextId('startup-failed'))
  assert.equal(receipt.status, 'failed')
  assert.equal(receipt.transport, 'stdio')
  assert.equal(receipt.result, undefined)
  assert.equal(native.seen.opens.length, 1)
  assert.equal(native.seen.calls, 0)
  assert.equal(native.seen.pendingBeforeOpen, true)
  const current = store.listSchedules(f.tenantId).find(row => row.id === f.task.id)!
  assert.equal(current.enabled, false, 'a program may have effects before tools/call begins')
  assert.equal(current.nextFireAt, undefined)
  assert.equal(current.runs.find(row => row.id === run.id)?.status, 'failed')
  assert.equal(f.review().runs[0]?.phase, 'interrupted')
  assert.equal(f.review().policy.approval, null)
  assert.ok(f.review().policy.revision > approved.review.policy.revision)
  assert.equal(store.routineMcpRunMayRetry(f.task.id, run.id), false)
  assertPrivate(f)
  const next = store.runSchedule(f.task.id)!
  assert.notEqual(next.id, run.id)
  assert.equal(store.routineExecutionContext(f.task.id, next.id)?.blocked?.code, 'authority_denied')
  await assert.rejects(store.executeRoutineMcpCall(f.task.id, next.id, f.call, nextId('unreviewed-cadence')), RoutineMcpPolicyError)
  assert.equal(native.seen.opens.length, 1)
  store.failScheduleRun(f.task.id, next.id, 'authority_denied', 'Review required.')
  f.approve()
  const reviewed = store.runSchedule(f.task.id)!
  const context = store.routineExecutionContext(f.task.id, reviewed.id)
  assert.ok(context)
  assert.equal(context.blocked, undefined, 'fresh review can authorize a new run, not replay the failed one')
  assert.deepEqual(f.review().runs.find(row => row.runId === run.id)?.calls, [receipt])
})

test('local Routine membership loss during discovery prevents tool dispatch and does not disclose the refusal to peers', { timeout: 30_000 }, async t => {
  const f = await fixture(t)
  const entered = deferred()
  const release = deferred()
  t.after(release.resolve)
  const native = nativePeer(f, { discover: async () => { entered.resolve(); await release.promise } })
  await native.ready()
  f.approve()
  const run = store.runSchedule(f.task.id)!
  const execution = store.executeRoutineMcpCall(f.task.id, run.id, f.call, nextId('departing-member'))
  await Promise.race([entered.promise, execution.then(() => assert.fail('execution settled before reaching the native discovery barrier'))])
  const membership = accounts.membership(f.owner.userId, f.tenantId)!
  assert.equal(membership.home, undefined)
  accounts.memberships = accounts.memberships.filter(row => row !== membership)
  try {
    assert.equal(accounts.identityFor(f.owner.userId, f.tenantId), null)
    assert.ok(accounts.identityFor(f.peer.userId, f.tenantId))
    release.resolve()
    const receipt = await execution
    assert.equal(receipt.status, 'failed')
    assert.equal(receipt.transport, 'stdio')
    assert.equal(native.seen.calls, 0, 'a live workspace owner cannot substitute for the departed approving member')
    assert.equal(native.seen.closes, 1)
    assert.equal(f.review().active, false)
    assert.deepEqual(f.review().runs, [], 'a former member cannot recover personal receipts through the old workspace')
    assertPrivate(f)
    assert.equal(run.status, 'failed', 'the native-started refusal terminalizes rather than allowing model work to continue')
    assert.equal(store.routineExecutionContext(f.task.id, run.id), undefined)
  } finally { accounts.memberships.push(membership) }
  assert.equal(f.review().runs[0]?.calls[0]?.status, 'failed', 'the restored exact member can still inspect the retained outcome')
})

test('a known late local result settles privately after peer revocation without publishing or permitting another call', { timeout: 30_000 }, async t => {
  const f = await fixture(t)
  const entered = deferred()
  const release = deferred()
  t.after(release.resolve)
  const native = nativePeer(f, { dispatched: async () => { entered.resolve(); await release.promise } })
  await native.ready()
  f.approve()
  const run = store.runSchedule(f.task.id)!
  const context = store.routineExecutionContext(f.task.id, run.id)!
  const execution = store.executeRoutineMcpCall(f.task.id, run.id, f.call, nextId('late-known-result'))
  await Promise.race([entered.promise, execution.then(() => assert.fail('execution settled before dispatch'))])
  assert.equal(f.review().runs[0]?.calls[0]?.status, 'pending')
  f.revoke(f.peer.userId)
  assertPrivate(f)
  release.resolve()
  const receipt = await execution
  assert.equal(receipt.status, 'done', 'revocation cannot rewrite a known successful external result as uncertainty')
  assert.equal(receipt.transport, 'stdio')
  assert.equal(receipt.result?.content[0]?.text, privateOutput)
  assert.equal(native.seen.calls, 1)
  assert.deepEqual(f.review().runs[0]?.calls, [receipt])
  assertPrivate(f)
  await assert.rejects(store.executeRoutineMcpCall(f.task.id, run.id, f.call, nextId('after-revocation')), RoutineMcpPolicyError)
  assert.equal(finish(f, run.id, 'PRIVATE: revoked Routine model output')?.status, 'failed')
  assert.ok(!store.getSession(context.sessionId)?.messages.some(message => message.content.includes('PRIVATE: revoked Routine')))
  store.removeMcpConnection(f.connection.id, f.tenantId, 1, f.owner.userId)
  assert.deepEqual(f.review().runs[0]?.calls, [receipt])
  assertPrivate(f)
  assert.equal(native.seen.opens.length, 1)
})
