/** Route acceptance for the separate person-approved local Commission path.
 * Only the in-memory route/store and native boot acknowledgement are driven. */
import assert from 'node:assert/strict'
import test from 'node:test'
import type { CommissionMcpApprovalIntent } from '../../contract/commissionMcp.ts'
import type { CommissionMcpReview } from '../../contract/commissionMcpApi.ts'
import { accounts } from '../accounts.ts'
import { SESSION_COOKIE, signSession } from '../auth.ts'
import { MCP_MODERN_VERSION } from '../mcpProtocol.ts'
import { MCP_SCHEMA_ADMISSION_VERSION, mcpToolSchemaHash } from '../mcpToolAdmission.ts'
import { configureMcpRuntime, initializeMcpRuntime, mcpRuntimeConfiguration, type McpRuntimeConfiguration } from '../mcpRuntime.ts'
import { store } from '../store/index.ts'
import { call } from '../testkit/http.ts'

const TOOL = { name: 'route_local_write', description: 'Write the reviewed local record.', inputSchema: {
  type: 'object', properties: { value: { type: 'string' } }, required: ['value'], additionalProperties: false,
} }
const HASH = mcpToolSchemaHash(TOOL)
let sequence = 0

const cookie = (userId: string, tenantId: string) => ({
  cookie: `${SESSION_COOKIE}=${signSession({ userId, tenantId, iat: Date.now() })}`,
  'x-account-transition-source': `session:${userId}`,
})

function fixture() {
  const n = ++sequence
  const org = accounts.createOrg('user-ada', `Commission local route ${n}`)!
  const invite = accounts.createInvite(org.id, 'grace@acme.example', 'Ada')!
  assert.equal(accounts.resolveInvite(invite.id, 'user-grace', 'accept')?.kind, 'accepted')
  const foreign = accounts.createOrg('user-grace', `Commission local route foreign ${n}`)!
  const suffix = `${Date.now().toString(36)}-${n}`
  const project = store.createProject({ name: `Local route Project ${suffix}`, description: 'Review local work.' }, org.id)!
  store.applyRelationOp({ kind: 'scope-context', projectId: project.project.id, projectName: project.project.name,
    context: { kind: 'connector', label: TOOL.name, meta: 'Local tool review.' } }, org.id)
  const modelId = `commission-local-route-model-${n}`
  const provider = store.createProvider({ label: `Local route provider ${suffix}`, modelFamily: 'claude', effortLevels: ['Low'],
    models: [{ id: modelId, label: 'Fixture model' }], authority: { tools: ['*'], connectors: ['*'], scopes: ['*'] } } as any,
  { baseURL: 'https://model.example.test', model: modelId, capabilities: { toolUse: true } }, org.id)
  const agent = store.createAgent({ label: `Local route Agent ${suffix}`, systemPrompt: 'Use reviewed work.', instructions: '', tools: [],
    providerId: provider.id, authority: { tools: ['*'], connectors: ['*'], scopes: ['*'] } }, org.id)
  const commission = store.createCommission({ agentId: agent.id, projectId: project.project.id, role: 'writer' }, org.id)
  const bind = (person: string, discriminator: number) => {
    const id = `mcp-connection-${(n + discriminator).toString(16).padStart(32, '0')}`
    const reference = `MCP_STDIO_${(n + discriminator).toString(16).toUpperCase().padStart(32, '0')}`
    store.createMcpConnection({ transport: 'stdio', id, label: `Local connection ${discriminator}` }, org.id, false, person)
    store.commitMcpInspection(id, org.id, 0, { protocolVersion: MCP_MODERN_VERSION, cleanup: 'released', tools: [TOOL],
      schemaAdmission: { version: MCP_SCHEMA_ADMISSION_VERSION, hashes: [HASH] } }, Date.now(), undefined, undefined, person, reference)
    return { id, reference }
  }
  const ownerConnection = bind('user-ada', 0x1000)
  const peerConnection = bind('user-grace', 0x2000)
  const path = `/commissions/${commission.id}/mcp-permission`
  const selection = `?providerId=${provider.id}&modelId=${modelId}`
  const review = (actor = 'user-ada', tenant = org.id) => call('GET', `${path}${selection}`, undefined, cookie(actor, tenant))
  const approval = (current: CommissionMcpReview, connectionId = ownerConnection.id, localPrograms?: true): CommissionMcpApprovalIntent => ({
    expectedRevision: current.policy.revision, expectedConfigurationRevision: current.configurationRevision,
    reviewHash: current.reviewHash, execution: current.execution!, expiresAt: Date.now() + 60_000, maxWorkItems: 2,
    tools: current.tools.filter(row => row.connectionId === connectionId).map(row => ({ connectionId: row.connectionId,
      connectionRevision: row.connectionRevision, toolName: row.tool.name, schemaHash: row.schemaHash, fixedArguments: {} })),
    ...(localPrograms === true ? { localPrograms: true } : {}),
  })
  return { tenantId: org.id, foreignTenantId: foreign.id, path, selection, provider, modelId,
    ownerConnection, peerConnection, review, approval }
}

test('Commission local route requires native readiness, person binding and explicit local-program approval', async t => {
  const prior = mcpRuntimeConfiguration()
  t.after(() => configureMcpRuntime({ ...prior }))
  const f = fixture()
  const runtime: McpRuntimeConfiguration = { deviceBearerAvailable: false, allowLoopback: false, localProcessesAvailable: true,
    synchronizeStdioBindings: async () => ({ available: true }), openStdio: () => { throw new Error('review must not launch') } }
  const ownerHeaders = cookie('user-ada', f.tenantId)
  const configurationOnly = await f.review()
  assert.equal(configurationOnly.status, 200)
  assert.deepEqual(configurationOnly.json.tools.filter((row: any) => row.transport === 'stdio'), [],
    'the default-off runtime hides persisted local connection catalogs')

  configureMcpRuntime(runtime)
  const beforeNativeBoot = await f.review()
  assert.deepEqual(beforeNativeBoot.json.tools.filter((row: any) => row.transport === 'stdio'), [],
    'deployment configuration alone is not native capability acknowledgement')
  await initializeMcpRuntime(store.mcpCredentialBindings(), store.mcpStdioBindings())

  const ownerReview = await f.review()
  assert.equal(ownerReview.status, 200)
  assert.deepEqual(ownerReview.json.tools.filter((row: any) => row.transport === 'stdio').map((row: any) => row.connectionId), [f.ownerConnection.id])
  const memberReview = await f.review('user-grace')
  assert.equal(memberReview.status, 200)
  assert.equal(memberReview.json.policy.approval, null)
  assert.deepEqual(memberReview.json.tools.filter((row: any) => row.transport === 'stdio').map((row: any) => row.connectionId), [f.peerConnection.id])
  assert.deepEqual(store.mcpConnections(f.tenantId, 'user-grace').filter(row => row.transport === 'stdio').map(row => row.id), [f.peerConnection.id])
  assert.deepEqual(store.mcpConnections(f.tenantId, 'user-ada').filter(row => row.transport === 'stdio').map(row => row.id), [f.ownerConnection.id])
  assert.doesNotMatch(JSON.stringify(memberReview.json), new RegExp(f.ownerConnection.reference), 'same-org people do not receive another person’s native authority')
  assert.equal((await f.review('user-grace', f.foreignTenantId)).status, 404, 'foreign tenant remains behind the Commission wall')

  const post = (body: unknown) => call('POST', f.path, body, ownerHeaders)
  const withoutOptIn = await post({ requestId: `local-no-opt-${++sequence}`, action: 'approve', approval: f.approval(ownerReview.json) })
  assert.equal(withoutOptIn.status, 404, JSON.stringify(withoutOptIn.json))
  assert.equal((await f.review()).json.policy.revision, 0)
  const falseOptIn = await post({ requestId: `local-false-opt-${++sequence}`, action: 'approve', approval: {
    ...f.approval(ownerReview.json), localPrograms: false,
  } })
  assert.equal(falseOptIn.status, 400, JSON.stringify(falseOptIn.json))
  assert.equal((await f.review()).json.policy.revision, 0)
  const peerTool = memberReview.json.tools.find((row: any) => row.transport === 'stdio' && row.connectionId === f.peerConnection.id)
  assert.ok(peerTool, 'the other same-org person has a real private local tool view')
  assert.equal(memberReview.json.tools.filter((row: any) => row.transport === 'stdio').length, 1)
  assert.equal(peerTool.connectionId, f.peerConnection.id, 'the refused payload names Grace’s actual private connection')
  assert.equal(peerTool.connectionRevision, 1)
  const wrongPerson = await post({ requestId: `local-wrong-person-${++sequence}`, action: 'approve', approval: {
    ...f.approval(ownerReview.json, f.ownerConnection.id, true),
    tools: [{ connectionId: peerTool.connectionId, connectionRevision: peerTool.connectionRevision,
      toolName: peerTool.tool.name, schemaHash: peerTool.schemaHash, fixedArguments: {} }],
  } })
  assert.equal(wrongPerson.status, 404, JSON.stringify(wrongPerson.json))
  assert.equal((await f.review()).json.policy.revision, 0)

  const acceptedRequest = { requestId: `local-opt-in-${++sequence}`, action: 'approve' as const,
    approval: f.approval(ownerReview.json, f.ownerConnection.id, true) }
  const accepted = await post(acceptedRequest)
  assert.equal(accepted.status, 200, JSON.stringify(accepted.json))
  assert.equal(accepted.json.review.policy.approval.localPrograms, true)
  assert.deepEqual(accepted.json.review.tools.filter((row: any) => row.transport === 'stdio').map((row: any) => row.connectionId), [f.ownerConnection.id])
  assert.doesNotMatch(JSON.stringify(accepted.json), /MCP_STDIO_|grantReference|localConnectionIds/)
  const replay = await post(acceptedRequest)
  assert.equal(replay.status, 200)
  assert.equal(replay.json.decisionId, accepted.json.decisionId, 'same keyed approval replays one owner decision')
})
