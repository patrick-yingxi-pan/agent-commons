import assert from 'node:assert/strict'
import test from 'node:test'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { CommissionMcpReview } from '../../contract/commissionMcpApi.ts'
import type { McpDiscoveredTool } from '../../contract/mcpConnections.ts'
import { accounts } from '../accounts.ts'
import { configureMcpRuntime, mcpRuntimeConfiguration } from '../mcpRuntime.ts'
import { MCP_MODERN_VERSION } from '../mcpProtocol.ts'
import { MCP_SCHEMA_ADMISSION_VERSION, mcpToolSchemaHash } from '../mcpToolAdmission.ts'
import { manualDispatchRunId } from '../dispatchIdentity.ts'
import { store } from './index.ts'

const TOOL: McpDiscoveredTool = { name: 'search', description: 'Search the fixture source.', inputSchema: {
  type: 'object', properties: { query: { type: 'string' } }, required: ['query'], additionalProperties: false,
}, outputSchema: { type: 'object', properties: { status: { type: 'string' } }, required: ['status'], additionalProperties: false } }
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

function reply(response: ServerResponse, id: unknown, result: unknown) {
  response.writeHead(200, { 'content-type': 'application/json' })
  response.end(JSON.stringify({ jsonrpc: '2.0', id, result }))
}

function modelReply(text: string, usage = { input_tokens: 17, output_tokens: 9 }) {
  return { id: 'msg_fixture', type: 'message', role: 'assistant', model: 'fixture-model', content: [{ type: 'text', text }],
    stop_reason: 'end_turn', stop_sequence: null, usage }
}

function modelPeer(onMessage: (request: Record<string, unknown>) => Promise<unknown> | unknown) {
  return peer((request, response) => {
    const chunks: Buffer[] = []
    request.on('data', chunk => chunks.push(Buffer.from(chunk)))
    request.on('end', async () => {
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>
      try {
        const result = await onMessage(body)
        response.writeHead(200, { 'content-type': 'application/json' })
        response.end(JSON.stringify(result))
      } catch {
        response.writeHead(500)
        response.end()
      }
    })
  })
}

function mcpPeer(onCall: () => unknown = () => ({ resultType: 'complete', content: [{ type: 'text', text: 'Fixture result.' }],
  structuredContent: { status: 'found' }, isError: false })) {
  const methods: string[] = []
  return peer((request, response) => {
    const chunks: Buffer[] = []
    request.on('data', chunk => chunks.push(Buffer.from(chunk)))
    request.on('end', () => {
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, any>
      methods.push(String(body.method))
      if (body.method === 'server/discover') {
        reply(response, body.id, { supportedVersions: [MCP_MODERN_VERSION], capabilities: { tools: {} } })
      } else if (body.method === 'tools/call') {
        reply(response, body.id, onCall())
      } else {
        response.writeHead(400)
        response.end()
      }
    })
  }).then(row => ({ ...row, methods }))
}

function hangingCallMcpPeer() {
  const methods: string[] = []
  const callStarted = deferred<void>()
  const responseClosed = deferred<void>()
  return peer((request, response) => {
    const chunks: Buffer[] = []
    request.on('data', chunk => chunks.push(Buffer.from(chunk)))
    request.on('end', () => {
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, any>
      methods.push(String(body.method))
      if (body.method === 'server/discover') {
        reply(response, body.id, { supportedVersions: [MCP_MODERN_VERSION], capabilities: { tools: {} } })
      } else if (body.method === 'tools/call') {
        response.on('close', () => responseClosed.resolve())
        callStarted.resolve()
        // Hold this response open until the client aborts its in-flight request.
      } else {
        response.writeHead(400)
        response.end()
      }
    })
  }).then(row => ({ ...row, methods, callStarted: callStarted.promise, responseClosed: responseClosed.promise }))
}

async function within<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([promise, new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error(message)), timeoutMs)
    })])
  } finally { if (timer !== undefined) clearTimeout(timer) }
}

function fixture(modelURL: string, mcpURL: string, opts: { tenantId?: string; ownerUserId?: string; sharedProject?: boolean;
  projectOwnerTenant?: string; projectId?: string; legacyStanding?: boolean; postAfterApproval?: boolean;
  beforePost?: (input: { tenantId: string; providerId: string; modelId: string; agentId: string }) => void } = {}) {
  const n = ++sequence
  const ownerUserId = opts.ownerUserId ?? 'user-ada'
  const tenantId = opts.tenantId ?? accounts.createOrg(ownerUserId, `Store Commission MCP ${n}`)!.id
  const suffix = `${Date.now().toString(36)}-${n}`
  const providerId = `commission-work-provider-${suffix}`
  const modelId = `commission-work-model-${suffix}`
  const provider = store.createProvider({ id: providerId, label: `Fixture provider ${suffix}`, modelFamily: 'claude', effortLevels: ['Low'],
    models: [{ id: modelId, label: 'Local fixture model' }], authority: { tools: ['*'], connectors: ['*'], scopes: ['*'] } } as any,
  { baseURL: `${modelURL}/v1`, model: modelId, capabilities: { toolUse: true } }, tenantId)
  const agent = store.createAgent({ label: `Fixture Agent ${suffix}`, systemPrompt: 'Use the reviewed work only.', instructions: '', tools: [],
    providerId: provider.id, authority: { tools: ['*'], connectors: ['*'], scopes: ['*'] } }, tenantId)
  const projectOwnerTenant = opts.projectOwnerTenant ?? tenantId
  const projectId = opts.projectId ?? `commission-work-project-${suffix}`
  const projectName = `Fixture Project ${suffix}`
  if (!opts.projectId) store.applyRelationOp({ kind: 'create-project', projectId, projectName, projectDescription: 'Local-only execution fixture.' }, projectOwnerTenant)
  if (opts.sharedProject) store.applyRelationOp({ kind: 'share-project', projectId, projectName, shared: true }, projectOwnerTenant)
  store.applyRelationOp({ kind: 'scope-context', projectId, projectName: `Fixture Project ${suffix}`,
    context: { kind: 'connector', label: TOOL.name, meta: 'Fixture admitted tool.' } }, projectOwnerTenant)
  const commission = store.createCommission({ agentId: agent.id, projectId, role: 'writer', ...(opts.legacyStanding ? { standing: true } : {}) }, tenantId)
  const connectionId = `mcp-connection-${n.toString(16).padStart(32, '0')}`
  store.createMcpConnection({ id: connectionId, label: `Fixture MCP ${suffix}`, endpoint: `${mcpURL}/mcp`, authentication: 'none' }, tenantId, true, ownerUserId)
  store.commitMcpInspection(connectionId, tenantId, 0, { protocolVersion: MCP_MODERN_VERSION, cleanup: 'not-needed', tools: [TOOL],
    schemaAdmission: { version: MCP_SCHEMA_ADMISSION_VERSION, hashes: [mcpToolSchemaHash(TOOL)] } }, Date.now(), undefined, undefined, ownerUserId)
  const post = () => store.postOpenSubGoal(projectId, { subGoal: `Search fixture ${suffix}`, type: 'mcp.mutate', target: TOOL.name,
    note: 'Find the requested fact.' }, projectOwnerTenant, undefined)
  let item: ReturnType<typeof post>
  if (!opts.postAfterApproval) item = post()
  const review = store.commissionMcpReview(commission.id, tenantId, ownerUserId, { providerId: provider.id, modelId })
  assert.ok(review)
  const decision = store.decideCommissionMcp(commission.id, tenantId, { requestId: `fixture-approval-${suffix}`, action: 'approve', approval: {
    expectedRevision: review.policy.revision, expectedConfigurationRevision: review.configurationRevision, reviewHash: review.reviewHash,
    execution: review.execution!, expiresAt: Date.now() + 60_000, maxWorkItems: 5,
    tools: review.tools.map(row => ({ connectionId: row.connectionId, connectionRevision: row.connectionRevision,
      toolName: row.tool.name, schemaHash: row.schemaHash, fixedArguments: {} })),
  } }, ownerUserId)
  assert.ok(decision)
  if (opts.postAfterApproval) {
    opts.beforePost?.({ tenantId, providerId: provider.id, modelId, agentId: agent.id })
    item = post()
  }
  assert.ok(typeof item === 'object')
  return { tenantId, ownerUserId, provider, agent, projectId, commission, connectionId, item, review: review as CommissionMcpReview }
}

const textArguments = '{"toolName":"search","arguments":{"query":"otters"}}'

test('legacy standing dispatch cannot steal current explicitly approved MCP work before queue claim', async () => {
  const oldRuntime = mcpRuntimeConfiguration()
  configureMcpRuntime({ ...oldRuntime, allowLoopback: true })
  const model = await modelPeer(() => modelReply(textArguments))
  const mcp = await mcpPeer()
  try {
    const f = fixture(model.url, mcp.url, { legacyStanding: true, postAfterApproval: true })
    assert.equal(store.listOpenSubGoals(f.projectId, f.tenantId).find(row => row.id === f.item.id)?.status, 'open')
    assert.deepEqual(store.commissionMcpWorkCandidates().filter(row => row.itemId === f.item.id), [{
      commissionId: f.commission.id, tenantId: f.tenantId, userId: f.ownerUserId,
      projectId: f.projectId, agentId: f.agent.id, itemId: f.item.id,
    }])
    assert.deepEqual(mcp.methods, [], 'posting only queues the work; the runner owns later execution')
  } finally {
    model.server.closeAllConnections?.(); mcp.server.closeAllConnections?.()
    await Promise.all([model.server, mcp.server].map(server => new Promise<void>(resolve => server.close(() => resolve()))))
    configureMcpRuntime(oldRuntime)
  }
})

test('legacy standing dispatch leaves approved work open when process, tenant and Agent capacity are saturated', async () => {
  const oldRuntime = mcpRuntimeConfiguration()
  configureMcpRuntime({ ...oldRuntime, allowLoopback: true })
  const model = await modelPeer(() => modelReply(textArguments))
  const mcp = await mcpPeer()
  const dispatchIds: Array<{ id: string; tenant: string }> = []
  try {
    const f = fixture(model.url, mcp.url, { legacyStanding: true, postAfterApproval: true, beforePost: ({ tenantId, providerId, modelId, agentId }) => {
      const start = (tenant: string, agent: { id: string }, provider: { id: string; model: string }) => {
        const id = manualDispatchRunId(tenant, `legacy-capacity-${sequence}-${dispatchIds.length}`)
        store.startRealDispatch({ title: 'Occupy background model capacity', execution: {
          agentId: agent.id, providerId: provider.id, modelId: provider.model,
        } }, tenant, id)
        dispatchIds.push({ id, tenant })
      }
      const primary = store.listAgents(tenantId).find(row => row.id === agentId)!
      start(tenantId, primary, { id: providerId, model: modelId })
      // A second Agent fills this tenant's limit while the target Agent is also busy.
      const second = store.createAgent({ label: `Busy tenant Agent ${sequence}`, systemPrompt: 'Fixture.', instructions: '', tools: [],
        providerId, authority: { tools: ['*'], connectors: ['*'], scopes: ['*'] } }, tenantId)
      start(tenantId, second, { id: providerId, model: modelId })

      // Two more active Dispatches in another tenant fill the process-wide four slots.
      const otherTenant = accounts.createOrg('user-ada', `Commission MCP busy tenant ${sequence}`)!.id
      const otherModelId = `commission-busy-model-${sequence}`
      const otherProvider = store.createProvider({ label: `Busy provider ${sequence}`, modelFamily: 'claude', effortLevels: ['Low'],
        models: [{ id: otherModelId, label: 'Local fixture model' }], authority: { tools: ['*'], connectors: ['*'], scopes: ['*'] } } as any,
      { baseURL: `${model.url}/v1`, model: otherModelId, capabilities: { toolUse: true } }, otherTenant)
      for (let index = 0; index < 2; index++) {
        const otherAgent = store.createAgent({ label: `Busy other Agent ${sequence}-${index}`, systemPrompt: 'Fixture.', instructions: '', tools: [],
          providerId: otherProvider.id, authority: { tools: ['*'], connectors: ['*'], scopes: ['*'] } }, otherTenant)
        start(otherTenant, otherAgent, { id: otherProvider.id, model: otherModelId })
      }
    } })
    assert.equal(dispatchIds.length, 4)
    assert.equal(store.commissionMcpWorkCandidates().some(row => row.itemId === f.item.id), false,
      'all shared model slots are occupied, so the approved item waits for capacity')
    const work = store.listOpenSubGoals(f.projectId, f.tenantId).find(row => row.id === f.item.id)!
    assert.equal(work.status, 'open', 'legacy standing must not convert a capacity wait into simulated completion')
    assert.equal(work.commissionResolution, undefined)
  } finally {
    for (const row of dispatchIds) {
      const run = store.getRealDispatch(row.id, row.tenant)
      if (run && run !== 'retired' && run.execution?.state === 'running') {
        store.settleRealDispatch(row.id, row.tenant, 'error')
        if (run.execution.sessionId) store.removeSession(run.execution.sessionId)
      }
    }
    model.server.closeAllConnections?.(); mcp.server.closeAllConnections?.()
    await Promise.all([model.server, mcp.server].map(server => new Promise<void>(resolve => server.close(() => resolve()))))
    configureMcpRuntime(oldRuntime)
  }
})

test('legacy fixture completion does not claim real MCP provenance', async () => {
  const oldRuntime = mcpRuntimeConfiguration()
  configureMcpRuntime({ ...oldRuntime, allowLoopback: true })
  const model = await modelPeer(() => modelReply(textArguments))
  const mcp = await mcpPeer()
  try {
    const f = fixture(model.url, mcp.url, { legacyStanding: true })
    const resolved = store.listOpenSubGoals(f.projectId, f.tenantId).find(row => row.id === f.item.id)!
    assert.equal(resolved.status, 'done')
    assert.ok(resolved.resolvedBy, 'legacy fixture completion has Commission attribution')
    assert.equal(resolved.commissionResolution, undefined, 'a resolvedBy label alone is not proof of real MCP execution')
  } finally {
    model.server.closeAllConnections?.(); mcp.server.closeAllConnections?.()
    await Promise.all([model.server, mcp.server].map(server => new Promise<void>(resolve => server.close(() => resolve()))))
    configureMcpRuntime(oldRuntime)
  }
})

test('store host runner generates once, executes one admitted tool, records a private receipt, and resolves/credits once', async () => {
  const oldRuntime = mcpRuntimeConfiguration()
  configureMcpRuntime({ ...oldRuntime, allowLoopback: true })
  let modelCalls = 0
  const model = await modelPeer(() => { modelCalls++; return modelReply(textArguments) })
  const mcp = await mcpPeer()
  try {
    const f = fixture(model.url, mcp.url)
    assert.deepEqual(store.commissionMcpWorkCandidates().filter(row => row.itemId === f.item.id), [{
      commissionId: f.commission.id, tenantId: f.tenantId, userId: f.ownerUserId,
      projectId: f.projectId, agentId: f.agent.id, itemId: f.item.id,
    }], 'the queue projects the exact current private approval and work target')
    const beforeCredit = store.getAgent(f.agent.id)!.contributions ?? 0
    const result = await store.runCommissionMcpWork(f.commission.id, f.tenantId, f.ownerUserId, f.item.id)
    assert.equal(result.phase, 'effect')
    assert.equal(result.phase === 'effect' && result.attempt.status, 'done')
    assert.equal(modelCalls, 1)
    assert.deepEqual(mcp.methods, ['server/discover', 'tools/call'])
    const work = store.listOpenSubGoals(f.projectId, f.tenantId).find(row => row.id === f.item.id)!
    assert.equal(work.status, 'done')
    assert.equal(work.resolvedBy, f.commission.id)
    assert.equal(work.commissionResolution, 'mcp')
    assert.equal(store.getAgent(f.agent.id)!.contributions, beforeCredit + 1)
    const receipt = store.commissionMcpReview(f.commission.id, f.tenantId, f.ownerUserId)!.claims[0]!
    assert.equal(receipt.status, 'done')
    assert.deepEqual(receipt.result?.content, [{ type: 'text', text: 'Fixture result.' }])
    assert.equal(store.commissionMcpWorkCandidates().some(row => row.itemId === f.item.id), false,
      'a represented success is never retried by the unattended queue')
    await store.runCommissionMcpWork(f.commission.id, f.tenantId, f.ownerUserId, f.item.id)
    assert.equal(modelCalls, 1, 'represented work replays without another model call')
    assert.deepEqual(mcp.methods, ['server/discover', 'tools/call'], 'represented work replays without another MCP call')
    assert.equal(store.getAgent(f.agent.id)!.contributions, beforeCredit + 1)
  } finally {
    model.server.closeAllConnections?.(); mcp.server.closeAllConnections?.()
    await Promise.all([model.server, mcp.server].map(server => new Promise<void>(resolve => server.close(() => resolve()))))
    configureMcpRuntime(oldRuntime)
  }
})

test('Commission shutdown aborts the live HTTP MCP call, records uncertainty, and never replays it', { timeout: 10_000 }, async () => {
  const oldRuntime = mcpRuntimeConfiguration()
  configureMcpRuntime({ ...oldRuntime, allowLoopback: true })
  let modelCalls = 0
  const model = await modelPeer(() => { modelCalls++; return modelReply(textArguments, { input_tokens: 17_000, output_tokens: 9_000 }) })
  const mcp = await hangingCallMcpPeer()
  let running: Promise<Awaited<ReturnType<typeof store.runCommissionMcpWork>>> | undefined
  try {
    const f = fixture(model.url, mcp.url)
    const beforeCredit = store.getAgent(f.agent.id)!.contributions ?? 0
    const beforeUsage = store.usage(undefined, f.tenantId).limits.find(row => row.label === '5-hour limit')!.pct
    const controller = new AbortController()
    running = store.runCommissionMcpWork(f.commission.id, f.tenantId, f.ownerUserId, f.item.id, controller.signal)
    await within(mcp.callStarted, 5_000, 'the real tools/call request never reached the local MCP peer')

    const abortedAt = Date.now()
    controller.abort()
    await within(mcp.responseClosed, 2_000, 'aborting Commission work did not close the outstanding HTTP response')
    assert.ok(Date.now() - abortedAt < 2_000, 'the HTTP response closes promptly after shutdown abort')
    const result = await within(running, 2_000, 'the interrupted Commission execution did not settle promptly')
    assert.equal(result.phase, 'effect')
    assert.equal(result.phase === 'effect' && result.attempt.status, 'uncertain', 'a submitted call without a response has an unknown result')
    assert.equal(modelCalls, 1)
    assert.equal(mcp.methods.filter(method => method === 'tools/call').length, 1)

    const review = store.commissionMcpReview(f.commission.id, f.tenantId, f.ownerUserId)!
    assert.equal(review.policy.approval, null, 'uncertainty withdraws this exact approval')
    const receipt = review.claims.find(row => row.work.itemId === f.item.id)!
    assert.equal(receipt.status, 'uncertain')
    const work = store.listOpenSubGoals(f.projectId, f.tenantId).find(row => row.id === f.item.id)!
    assert.equal(work.status, 'open')
    assert.equal(work.commissionResolution, undefined)
    assert.equal(store.getAgent(f.agent.id)!.contributions ?? 0, beforeCredit)
    const afterUsage = store.usage(undefined, f.tenantId).limits.find(row => row.label === '5-hour limit')!.pct
    assert.ok(afterUsage > beforeUsage, 'settled model usage remains metered after the MCP call is interrupted')

    const replay = await store.runCommissionMcpWork(f.commission.id, f.tenantId, f.ownerUserId, f.item.id)
    assert.equal(replay.phase, 'effect')
    assert.equal(replay.phase === 'effect' && replay.attempt.status, 'uncertain')
    assert.equal(modelCalls, 1, 'represented uncertain work does not prepare again')
    assert.equal(mcp.methods.filter(method => method === 'tools/call').length, 1, 'represented uncertain work does not call MCP again')
  } finally {
    try {
      model.server.closeAllConnections?.(); mcp.server.closeAllConnections?.()
      await Promise.all([model.server, mcp.server].map(server => new Promise<void>(resolve => server.close(() => resolve()))))
      if (running) await within(running.catch(() => undefined), 2_000, 'cleanup did not settle the interrupted Commission execution').catch(() => {})
    } finally { configureMcpRuntime(oldRuntime) }
  }
})

test('schema-invalid model arguments close privately without external tool I/O or credit', async () => {
  const oldRuntime = mcpRuntimeConfiguration()
  configureMcpRuntime({ ...oldRuntime, allowLoopback: true })
  const model = await modelPeer(() => modelReply('{"toolName":"search","arguments":{"query":7}}'))
  const mcp = await mcpPeer()
  try {
    const f = fixture(model.url, mcp.url)
    const beforeCredit = store.getAgent(f.agent.id)!.contributions ?? 0
    const result = await store.runCommissionMcpWork(f.commission.id, f.tenantId, f.ownerUserId, f.item.id)
    assert.equal(result.phase, 'effect')
    assert.equal(result.phase === 'effect' && result.attempt.status, 'failed')
    assert.equal(mcp.methods.includes('tools/call'), false)
    const work = store.listOpenSubGoals(f.projectId, f.tenantId).find(row => row.id === f.item.id)!
    assert.equal(work.status, 'open')
    assert.equal(work.commissionResolution, undefined)
    assert.equal(store.getAgent(f.agent.id)!.contributions ?? 0, beforeCredit)
    const receipt = store.commissionMcpReview(f.commission.id, f.tenantId, f.ownerUserId)!.claims[0]!
    assert.equal(receipt.status, 'failed')
  } finally {
    model.server.closeAllConnections?.(); mcp.server.closeAllConnections?.()
    await Promise.all([model.server, mcp.server].map(server => new Promise<void>(resolve => server.close(() => resolve()))))
    configureMcpRuntime(oldRuntime)
  }
})

test('schema-invalid MCP output is kept as a failed receipt without resolving or crediting work', async () => {
  const oldRuntime = mcpRuntimeConfiguration()
  configureMcpRuntime({ ...oldRuntime, allowLoopback: true })
  const model = await modelPeer(() => modelReply(textArguments))
  const mcp = await mcpPeer(() => ({ resultType: 'complete', content: [{ type: 'text', text: 'Fixture result.' }],
    structuredContent: { status: 17 }, isError: false }))
  try {
    const f = fixture(model.url, mcp.url)
    const beforeCredit = store.getAgent(f.agent.id)!.contributions ?? 0
    const result = await store.runCommissionMcpWork(f.commission.id, f.tenantId, f.ownerUserId, f.item.id)
    assert.equal(result.phase, 'effect')
    assert.equal(result.phase === 'effect' && result.attempt.status, 'uncertain', 'the remote call may have completed, but its output did not satisfy the admitted schema')
    assert.ok(mcp.methods.includes('tools/call'))
    assert.equal(store.listOpenSubGoals(f.projectId, f.tenantId).find(row => row.id === f.item.id)?.status, 'open')
    assert.equal(store.getAgent(f.agent.id)!.contributions ?? 0, beforeCredit)
  } finally {
    model.server.closeAllConnections?.(); mcp.server.closeAllConnections?.()
    await Promise.all([model.server, mcp.server].map(server => new Promise<void>(resolve => server.close(() => resolve()))))
    configureMcpRuntime(oldRuntime)
  }
})

test('shared Project execution keeps the Commission payer tenant distinct from the Project owner', async () => {
  const oldRuntime = mcpRuntimeConfiguration()
  configureMcpRuntime({ ...oldRuntime, allowLoopback: true })
  const model = await modelPeer(() => modelReply(textArguments))
  const mcp = await mcpPeer()
  try {
    const projectOwner = accounts.createOrg('user-ada', `Commission MCP project owner ${sequence + 1}`)!
    const payer = accounts.createOrg('user-ada', `Commission MCP payer ${sequence + 1}`)!
    const f = fixture(model.url, mcp.url, { tenantId: payer.id, projectOwnerTenant: projectOwner.id, sharedProject: true })
    assert.notEqual(f.tenantId, projectOwner.id)
    const result = await store.runCommissionMcpWork(f.commission.id, f.tenantId, f.ownerUserId, f.item.id)
    assert.equal(result.phase, 'effect')
    assert.equal(result.phase === 'effect' && result.attempt.status, 'done')
    const work = store.listOpenSubGoals(f.projectId, projectOwner.id).find(row => row.id === f.item.id)!
    assert.equal(work.status, 'done')
    assert.equal(work.commissionResolution, 'mcp', 'a shared Project reader gets public provenance')
    assert.equal('claims' in work, false, 'the public work row never carries private receipt history')
    assert.equal('result' in work, false, 'the public work row never carries private MCP output')
    assert.equal(store.getAgent(f.agent.id)!.contributions, 1)
  } finally {
    model.server.closeAllConnections?.(); mcp.server.closeAllConnections?.()
    await Promise.all([model.server, mcp.server].map(server => new Promise<void>(resolve => server.close(() => resolve()))))
    configureMcpRuntime(oldRuntime)
  }
})

test('Commission MCP holds the Project Guardian during asynchronous model preparation', async () => {
  const oldRuntime = mcpRuntimeConfiguration()
  configureMcpRuntime({ ...oldRuntime, allowLoopback: true })
  const started = deferred<void>()
  const held = deferred<unknown>()
  const model = await modelPeer(async () => { started.resolve(); return held.promise })
  const mcp = await mcpPeer()
  try {
    const f = fixture(model.url, mcp.url, { tenantId: 'tenant-personal', ownerUserId: 'user-local', projectOwnerTenant: 'tenant-personal', projectId: 'p-insights' })
    const running = store.runCommissionMcpWork(f.commission.id, f.tenantId, f.ownerUserId, f.item.id)
    await started.promise
    assert.throws(() => store.reserveSubGoal(f.projectId, 'other-fixture-holder', f.item.subGoal, f.tenantId),
      { code: 'conflict' }, 'a competing holder cannot reserve the work while the model is waiting')
    held.resolve(modelReply(textArguments))
    const result = await running
    assert.equal(result.phase === 'effect' && result.attempt.status, 'done')
    assert.deepEqual(mcp.methods, ['server/discover', 'tools/call'])
  } finally {
    held.resolve(modelReply(textArguments))
    model.server.closeAllConnections?.(); mcp.server.closeAllConnections?.()
    await Promise.all([model.server, mcp.server].map(server => new Promise<void>(resolve => server.close(() => resolve()))))
    configureMcpRuntime(oldRuntime)
  }
})

test('Commission model preparation and real Dispatch share capacity in both directions', async () => {
  const oldRuntime = mcpRuntimeConfiguration()
  configureMcpRuntime({ ...oldRuntime, allowLoopback: true })
  const started = deferred<void>()
  const held = deferred<unknown>()
  let modelCalls = 0
  const model = await modelPeer(async () => { modelCalls++; started.resolve(); return held.promise })
  const mcp = await mcpPeer()
  const dispatchIds: Array<{ id: string; tenant: string }> = []
  try {
    const f = fixture(model.url, mcp.url)
    const running = store.runCommissionMcpWork(f.commission.id, f.tenantId, f.ownerUserId, f.item.id)
    await started.promise
    const blockedId = manualDispatchRunId(f.tenantId, `commission-cap-blocked-${sequence}`)
    assert.throws(() => store.startRealDispatch({ title: 'Must wait', execution: {
      agentId: f.agent.id, providerId: f.provider.id, modelId: f.review.execution!.modelId,
    } }, f.tenantId, blockedId))
    held.resolve(modelReply(textArguments))
    await running

    const dispatchId = manualDispatchRunId(f.tenantId, `commission-cap-dispatch-${sequence}`)
    const dispatch = store.startRealDispatch({ title: 'Occupy shared model capacity', execution: {
      agentId: f.agent.id, providerId: f.provider.id, modelId: f.review.execution!.modelId,
    } }, f.tenantId, dispatchId)
    dispatchIds.push({ id: dispatchId, tenant: f.tenantId })
    const secondWork = store.postOpenSubGoal(f.projectId, { subGoal: 'Second capacity item', type: 'mcp.mutate', target: TOOL.name }, f.tenantId, undefined)
    assert.ok(typeof secondWork === 'object')
    assert.equal(store.commissionMcpWorkCandidates().some(row => row.itemId === secondWork.id), false,
      'a running Dispatch occupies the tenant-Agent slot before the queue reviews this approval')
    const before = modelCalls
    await assert.rejects(store.runCommissionMcpWork(f.commission.id, f.tenantId, f.ownerUserId, secondWork.id))
    assert.equal(modelCalls, before, 'Dispatch occupancy denies Commission model I/O')
    assert.equal(dispatch.execution?.state, 'running')
  } finally {
    held.resolve(modelReply(textArguments))
    for (const row of dispatchIds) {
      const run = store.getRealDispatch(row.id, row.tenant)
      if (run && run !== 'retired' && run.execution?.state === 'running') {
        store.settleRealDispatch(row.id, row.tenant, 'error')
        if (run.execution.sessionId) store.removeSession(run.execution.sessionId)
      }
    }
    model.server.closeAllConnections?.(); mcp.server.closeAllConnections?.()
    await Promise.all([model.server, mcp.server].map(server => new Promise<void>(resolve => server.close(() => resolve()))))
    configureMcpRuntime(oldRuntime)
  }
})

test('revocation or work retraction while the model is waiting blocks the later MCP call', async t => {
  for (const change of ['revoke', 'retract', 'role'] as const) await t.test(change, async () => {
    const oldRuntime = mcpRuntimeConfiguration()
    configureMcpRuntime({ ...oldRuntime, allowLoopback: true })
    const started = deferred<void>()
    const held = deferred<unknown>()
    const model = await modelPeer(async () => { started.resolve(); return held.promise })
    const mcp = await mcpPeer()
    try {
      const f = fixture(model.url, mcp.url)
      const running = store.runCommissionMcpWork(f.commission.id, f.tenantId, f.ownerUserId, f.item.id)
      await started.promise
      if (change === 'revoke') {
        store.decideCommissionMcp(f.commission.id, f.tenantId, { requestId: `fixture-revoke-${sequence}`, action: 'revoke', expectedRevision: 1 }, f.ownerUserId)
      } else if (change === 'retract') {
        assert.ok(typeof store.retractOpenSubGoal(f.projectId, f.item.id, f.tenantId, undefined) === 'object')
      } else {
        store.updateCommission(f.commission.id, { role: 'reader' }, f.commission.configurationRevision ?? 0)
      }
      held.resolve(modelReply(textArguments))
      const result = await running
      assert.equal(result.phase, 'closed')
      assert.deepEqual(mcp.methods, [])
      assert.notEqual(store.listOpenSubGoals(f.projectId, f.tenantId).find(row => row.id === f.item.id)?.status, 'done')
      assert.equal(store.getAgent(f.agent.id)!.contributions ?? 0, 0)
    } finally {
      held.resolve(modelReply(textArguments))
      model.server.closeAllConnections?.(); mcp.server.closeAllConnections?.()
      await Promise.all([model.server, mcp.server].map(server => new Promise<void>(resolve => server.close(() => resolve()))))
      configureMcpRuntime(oldRuntime)
    }
  })
})

