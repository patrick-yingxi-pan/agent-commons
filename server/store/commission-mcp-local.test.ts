/** Direct store acceptance for person-approved local Commission MCP.
 * The Messages endpoint and stdio host are authored peers; no user program is
 * launched and no external service is contacted. */
import assert from 'node:assert/strict'
import test, { type TestContext } from 'node:test'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { CommissionMcpApprovalIntent } from '../../contract/commissionMcp.ts'
import type { CommissionMcpReview } from '../../contract/commissionMcpApi.ts'
import type { McpStdioBinding, McpRuntimeConfiguration } from '../mcpRuntime.ts'
import type { McpStdioConnection } from '../mcpStdioClient.ts'
import { accounts } from '../accounts.ts'
import { configureMcpRuntime, initializeMcpRuntime, mcpRuntimeConfiguration } from '../mcpRuntime.ts'
import { MCP_MODERN_VERSION } from '../mcpProtocol.ts'
import { MCP_SCHEMA_ADMISSION_VERSION, mcpToolSchemaHash } from '../mcpToolAdmission.ts'
import { store } from './index.ts'

const TOOL = { name: 'local_write', description: 'Write the reviewed local record.', inputSchema: {
  type: 'object', properties: { value: { type: 'string' } }, required: ['value'], additionalProperties: false,
} }
const SCHEMA_HASH = mcpToolSchemaHash(TOOL)
const MODEL_REPLY = JSON.stringify({ toolName: TOOL.name, arguments: { value: 'once' } })
let sequence = 0

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}

async function peer(handler: (request: IncomingMessage, response: ServerResponse) => void) {
  const server: Server = createServer(handler)
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  assert.ok(address && typeof address === 'object')
  return { server, url: `http://127.0.0.1:${address.port}` }
}

function modelPeer(onRequest: (request: Record<string, unknown>) => Promise<void> | void = () => {}) {
  return peer((request, response) => {
    const chunks: Buffer[] = []
    request.on('data', chunk => chunks.push(Buffer.from(chunk)))
    request.on('end', async () => {
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>
      try {
        await onRequest(body)
        response.writeHead(200, { 'content-type': 'application/json' })
        response.end(JSON.stringify({ id: 'local-commission-model', type: 'message', role: 'assistant', model: 'fixture-model',
          content: [{ type: 'text', text: MODEL_REPLY }], stop_reason: 'end_turn', stop_sequence: null,
          usage: { input_tokens: 17_000, output_tokens: 900 } }))
      } catch {
        response.writeHead(500)
        response.end()
      }
    })
  })
}

function localHost(onCall?: (binding: McpStdioBinding) => void, options: { startupFailure?: boolean; beforeDispatch?: () => void } = {}) {
  const seen = { opens: 0, calls: 0, discoveries: 0, guards: [] as boolean[], bindings: [] as McpStdioBinding[] }
  const runtime: McpRuntimeConfiguration = {
    deviceBearerAvailable: false, allowLoopback: true, localProcessesAvailable: true,
    synchronizeStdioBindings: async () => ({ available: true }),
    openStdio: (_reference, binding, _options): McpStdioConnection => {
      seen.opens++
      seen.bindings.push(binding)
      if (options.startupFailure) throw Object.assign(new Error('private startup detail'), { code: 'unavailable', mayHaveSubmitted: false })
      return {
        request: async (method, _params, { beforeDispatch }) => {
          if (method === 'server/discover') {
            seen.discoveries++
            return { jsonrpc: '2.0', id: 'discover', result: { resultType: 'complete', supportedVersions: [MCP_MODERN_VERSION],
              capabilities: { tools: {} }, _meta: { 'io.modelcontextprotocol/serverInfo': { name: 'authored-commission-local-peer', version: '1' } } } }
          }
          assert.equal(method, 'tools/call')
          options.beforeDispatch?.()
          const allowed = beforeDispatch?.() === true
          seen.guards.push(allowed)
          if (!allowed) throw Object.assign(new Error('stale'), { code: 'stale', mayHaveSubmitted: false })
          seen.calls++
          onCall?.(binding)
          return { jsonrpc: '2.0', id: 'call', result: { resultType: 'complete',
            content: [{ type: 'text', text: 'Local Commission result.' }], isError: false } }
        },
        initialized: async () => undefined,
        close: async () => ({ code: 'released' }),
        closed: Promise.resolve({ code: 'released' }),
      }
    },
  }
  return { runtime, seen }
}

async function fixture(t: TestContext, modelURL: string) {
  const prior = mcpRuntimeConfiguration()
  const n = ++sequence
  const ownerUserId = 'user-ada'
  const tenant = accounts.createOrg(ownerUserId, `Commission local store ${n}`)!
  const invite = accounts.createInvite(tenant.id, 'grace@acme.example', 'Ada')!
  assert.equal(accounts.resolveInvite(invite.id, 'user-grace', 'accept')?.kind, 'accepted')
  const foreign = accounts.createOrg('user-grace', `Commission local foreign ${n}`)!
  const suffix = `${Date.now().toString(36)}-${n}`
  const providerId = `commission-local-provider-${suffix}`
  const modelId = `commission-local-model-${suffix}`
  const provider = store.createProvider({ label: `Local fixture provider ${suffix}`, modelFamily: 'claude', effortLevels: ['Low'],
    models: [{ id: modelId, label: 'Local model peer' }], authority: { tools: ['*'], connectors: ['*'], scopes: ['*'] } } as any,
  { baseURL: `${modelURL}/v1`, model: modelId, capabilities: { toolUse: true } }, tenant.id)
  const agent = store.createAgent({ label: `Local fixture Agent ${suffix}`, systemPrompt: 'Use the approved local tool only.', instructions: '', tools: [],
    providerId: provider.id, authority: { tools: ['*'], connectors: ['*'], scopes: ['*'] } }, tenant.id)
  const projectId = `commission-local-project-${suffix}`
  store.applyRelationOp({ kind: 'create-project', projectId, projectName: `Local project ${suffix}`, projectDescription: 'Local-only fixture.' }, tenant.id)
  store.applyRelationOp({ kind: 'scope-context', projectId, projectName: `Local project ${suffix}`,
    context: { kind: 'connector', label: TOOL.name, meta: 'Explicitly reviewed local program.' } }, tenant.id)
  const commission = store.createCommission({ agentId: agent.id, projectId, role: 'writer' }, tenant.id)
  const connectionId = `mcp-connection-${(n + 0x1000).toString(16).padStart(32, '0')}`
  const grantReference = `MCP_STDIO_${n.toString(16).toUpperCase().padStart(32, '0')}`
  store.createMcpConnection({ transport: 'stdio', id: connectionId, label: `Local writer ${suffix}` }, tenant.id, false, ownerUserId)
  store.commitMcpInspection(connectionId, tenant.id, 0, { protocolVersion: MCP_MODERN_VERSION, cleanup: 'released', tools: [TOOL],
    schemaAdmission: { version: MCP_SCHEMA_ADMISSION_VERSION, hashes: [SCHEMA_HASH] } }, Date.now(), undefined, undefined, ownerUserId, grantReference)
  const peerConnectionId = `mcp-connection-${(n + 0x2000).toString(16).padStart(32, '0')}`
  const peerGrant = `MCP_STDIO_${(n + 0x1000).toString(16).toUpperCase().padStart(32, '0')}`
  store.createMcpConnection({ transport: 'stdio', id: peerConnectionId, label: `Peer local writer ${suffix}` }, tenant.id, false, 'user-grace')
  store.commitMcpInspection(peerConnectionId, tenant.id, 0, { protocolVersion: MCP_MODERN_VERSION, cleanup: 'released', tools: [TOOL],
    schemaAdmission: { version: MCP_SCHEMA_ADMISSION_VERSION, hashes: [SCHEMA_HASH] } }, Date.now(), undefined, undefined, 'user-grace', peerGrant)
  const item = store.postOpenSubGoal(projectId, { subGoal: `Write ${suffix}`, type: 'mcp.mutate', target: TOOL.name, note: 'Use the selected local peer.' }, tenant.id, undefined)
  assert.ok(typeof item === 'object')
  const selection = { providerId: provider.id, modelId }
  const review = (person = ownerUserId) => store.commissionMcpReview(commission.id, tenant.id, person, selection)
  const approval = (person = ownerUserId, connection = connectionId, localPrograms?: true): CommissionMcpApprovalIntent => {
    const current = review(person)!
    return { expectedRevision: current.policy.revision, expectedConfigurationRevision: current.configurationRevision,
      reviewHash: current.reviewHash, execution: current.execution!, expiresAt: Date.now() + 60_000, maxWorkItems: 3,
      tools: current.tools.filter(row => row.connectionId === connection).map(row => ({ connectionId: row.connectionId,
        connectionRevision: row.connectionRevision, toolName: row.tool.name, schemaHash: row.schemaHash, fixedArguments: {} })),
      ...(localPrograms === true ? { localPrograms: true } : {}) }
  }
  const decide = (request: CommissionMcpApprovalIntent, person = ownerUserId, requestId = `local-decision-${n}-${sequence++}`) =>
    store.decideCommissionMcp(commission.id, tenant.id, { requestId, action: 'approve', approval: request }, person)
  const revoke = (person = ownerUserId) => {
    const current = review(person)!
    return store.decideCommissionMcp(commission.id, tenant.id,
      { requestId: `local-revoke-${n}-${sequence++}`, action: 'revoke', expectedRevision: current.policy.revision }, person)
  }
  t.after(() => configureMcpRuntime({ ...prior }))
  return { tenantId: tenant.id, ownerUserId, peerUserId: 'user-grace', foreignTenantId: foreign.id, provider, agent,
    projectId, commission, connectionId, grantReference, peerConnectionId, peerGrant, item, selection, review, approval, decide, revoke }
}

async function enableLocal(runtime: McpRuntimeConfiguration, f: Awaited<ReturnType<typeof fixture>>) {
  configureMcpRuntime(runtime)
  await initializeMcpRuntime(store.mcpCredentialBindings(), store.mcpStdioBindings())
  assert.equal(mcpRuntimeConfiguration().localProcessesAvailable, true)
}

test('Commission local review is native-gated, person-private, and requires literal owner opt-in', { timeout: 10_000 }, async t => {
  const model = await modelPeer()
  const f = await fixture(t, model.url)
  try {
    assert.ok(f.review())
    assert.equal(f.review()!.tools.some(row => row.transport === 'stdio'), false, 'the default-off host hides stored local tools')
    const native = localHost()
    configureMcpRuntime(native.runtime)
    assert.equal(f.review()!.tools.some(row => row.transport === 'stdio'), false, 'configuration is not native boot acknowledgement')
    await initializeMcpRuntime(store.mcpCredentialBindings(), store.mcpStdioBindings())
    assert.deepEqual(f.review()!.tools.filter(row => row.transport === 'stdio').map(row => row.connectionId), [f.connectionId])
    assert.deepEqual(f.review(f.peerUserId)!.tools.filter(row => row.transport === 'stdio').map(row => row.connectionId), [f.peerConnectionId])
    assert.equal(store.commissionMcpReview(f.commission.id, f.foreignTenantId, f.peerUserId, f.selection), undefined,
      'a foreign tenant cannot review the Commission')
    assert.throws(() => f.decide(f.approval()), /Commission MCP permission/)
    assert.throws(() => f.decide({ ...f.approval(), localPrograms: false } as CommissionMcpApprovalIntent), /Commission MCP permission/)
    const wrongPerson = {
      ...f.approval(f.ownerUserId, f.connectionId, true),
      tools: f.approval(f.peerUserId, f.peerConnectionId, true).tools,
    }
    assert.deepEqual(wrongPerson.tools.map(tool => tool.connectionId), [f.peerConnectionId],
      'the refused payload must name the other person’s actual local tool, not an empty selection')
    assert.throws(() => f.decide(wrongPerson), /Commission MCP permission/,
      'the owner cannot approve another same-org person’s local connection')
    assert.equal(f.review()!.policy.revision, 0, 'refused approvals never mutate the policy')
    const decision = f.decide(f.approval(f.ownerUserId, f.connectionId, true))!
    assert.equal(decision.review.policy.approval?.localPrograms, true)
    assert.deepEqual(decision.review.tools.filter(row => row.transport === 'stdio').map(row => row.connectionId), [f.connectionId])
    assert.equal(f.review(f.peerUserId)!.policy.approval, null)
    assert.doesNotMatch(JSON.stringify(decision.review), /MCP_STDIO_|grantReference|localConnectionIds/)
    assert.equal(native.seen.opens, 0, 'review and approval never launch the local program')
  } finally {
    model.server.closeAllConnections?.()
    await new Promise<void>(resolve => model.server.close(() => resolve()))
  }
})

test('Commission local execution prepares once, binds the person-owned stdio peer, and credits only known success', { timeout: 10_000 }, async t => {
  const model = await modelPeer()
  const native = localHost()
  const f = await fixture(t, model.url)
  try {
    await enableLocal(native.runtime, f)
    f.decide(f.approval(f.ownerUserId, f.connectionId, true))
    const beforeCredit = store.getAgent(f.agent.id)!.contributions ?? 0
    const result = await store.runCommissionMcpWork(f.commission.id, f.tenantId, f.ownerUserId, f.item.id)
    assert.equal(result.phase, 'effect')
    assert.equal(result.phase === 'effect' && result.attempt.status, 'done')
    assert.equal(native.seen.opens, 1)
    assert.equal(native.seen.discoveries, 1)
    assert.equal(native.seen.calls, 1)
    assert.deepEqual(native.seen.bindings, [{ tenantId: f.tenantId, ownerUserId: f.ownerUserId,
      connectionId: f.connectionId, connectionRevision: 1 }])
    assert.deepEqual(native.seen.guards, [true])
    const receipt = f.review()!.claims.find(row => row.work.itemId === f.item.id)!
    assert.equal(receipt.status, 'done')
    assert.equal(receipt.transport, 'stdio')
    assert.deepEqual(receipt.result?.content, [{ type: 'text', text: 'Local Commission result.' }])
    assert.equal(store.listOpenSubGoals(f.projectId, f.tenantId).find(row => row.id === f.item.id)?.commissionResolution, 'mcp')
    assert.equal(store.getAgent(f.agent.id)!.contributions, beforeCredit + 1)
    await store.runCommissionMcpWork(f.commission.id, f.tenantId, f.ownerUserId, f.item.id)
    assert.equal(native.seen.opens, 1, 'represented local receipt never starts another process')
    assert.equal(native.seen.calls, 1, 'represented local receipt never submits another tool call')
  } finally {
    model.server.closeAllConnections?.()
    await new Promise<void>(resolve => model.server.close(() => resolve()))
  }
})

test('Commission local startup refusal and changed authority across waits never launch another call', { timeout: 10_000 }, async t => {
  await t.test('startup failure is a terminal known refusal under the exact approval', async t => {
    let preparations = 0
    const model = await modelPeer(() => { preparations++ })
    const native = localHost(undefined, { startupFailure: true })
    const f = await fixture(t, model.url)
    try {
      await enableLocal(native.runtime, f)
      f.decide(f.approval(f.ownerUserId, f.connectionId, true))
      const result = await store.runCommissionMcpWork(f.commission.id, f.tenantId, f.ownerUserId, f.item.id)
      assert.equal(result.phase, 'effect')
      assert.equal(result.phase === 'effect' && result.attempt.status, 'failed')
      assert.equal(native.seen.opens, 1)
      assert.equal(native.seen.calls, 0)
      assert.equal(f.review()!.policy.approval, null)
      await store.runCommissionMcpWork(f.commission.id, f.tenantId, f.ownerUserId, f.item.id)
      assert.equal(preparations, 1, 'a represented failure never prepares the model again')
      assert.equal(native.seen.opens, 1, 'a represented failure never retries process startup')
    } finally {
      model.server.closeAllConnections?.()
      await new Promise<void>(resolve => model.server.close(() => resolve()))
    }
  })

  await t.test('a changed local catalog while model preparation waits closes before process launch', async t => {
    const entered = deferred<void>()
    const release = deferred<void>()
    const model = await modelPeer(async () => { entered.resolve(); await release.promise })
    const native = localHost()
    const f = await fixture(t, model.url)
    try {
      await enableLocal(native.runtime, f)
      f.decide(f.approval(f.ownerUserId, f.connectionId, true))
      const running = store.runCommissionMcpWork(f.commission.id, f.tenantId, f.ownerUserId, f.item.id)
      await entered.promise
      const changedTool = { ...TOOL, inputSchema: { type: 'object', properties: { value: { type: 'number' } },
        required: ['value'], additionalProperties: false } }
      store.commitMcpInspection(f.connectionId, f.tenantId, 1, { protocolVersion: MCP_MODERN_VERSION, cleanup: 'released',
        tools: [changedTool],
        schemaAdmission: { version: MCP_SCHEMA_ADMISSION_VERSION, hashes: [mcpToolSchemaHash(changedTool)] } }, Date.now(), undefined, undefined,
      f.ownerUserId, f.grantReference)
      release.resolve()
      const result = await running
      assert.equal(result.phase, 'closed')
      assert.equal(f.review()!.policy.approval, null, 'the exact local approval is withdrawn after its inspected schema changes')
      assert.equal(native.seen.opens, 0, 'stale local binding is rejected before native launch')
    } finally {
      release.resolve()
      model.server.closeAllConnections?.()
      await new Promise<void>(resolve => model.server.close(() => resolve()))
    }
  })

  await t.test('revocation immediately before native dispatch blocks the write edge', async t => {
    const model = await modelPeer()
    let f!: Awaited<ReturnType<typeof fixture>>
    const native = localHost(undefined, { beforeDispatch: () => { f.revoke() } })
    f = await fixture(t, model.url)
    try {
      await enableLocal(native.runtime, f)
      f.decide(f.approval(f.ownerUserId, f.connectionId, true))
      const result = await store.runCommissionMcpWork(f.commission.id, f.tenantId, f.ownerUserId, f.item.id)
      assert.equal(result.phase, 'effect')
      assert.equal(result.phase === 'effect' && result.attempt.status, 'failed')
      assert.deepEqual(native.seen.guards, [false])
      assert.equal(native.seen.calls, 0)
      assert.equal(f.review()!.policy.approval, null)
    } finally {
      model.server.closeAllConnections?.()
      await new Promise<void>(resolve => model.server.close(() => resolve()))
    }
  })
})
