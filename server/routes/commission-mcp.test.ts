import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { CommissionMcpApprovalIntent } from '../../contract/commissionMcp.ts'
import type { CommissionMcpReview } from '../../contract/commissionMcpApi.ts'
import { accounts } from '../accounts.ts'
import { SESSION_COOKIE, signSession } from '../auth.ts'
import { MCP_SCHEMA_ADMISSION_VERSION, mcpToolSchemaHash } from '../mcpToolAdmission.ts'
import { MCP_MODERN_VERSION } from '../mcpProtocol.ts'
import { store } from '../store/index.ts'
import { call } from '../testkit/http.ts'
import { buildRouter } from './index.ts'

const TOOL = { name: 'commission_write', description: 'Write one reviewed record.', inputSchema: {
  type: 'object', properties: { value: { type: 'string' } }, required: ['value'], additionalProperties: false,
} }
const HIDDEN_TOOL = { name: 'hidden_sibling', description: 'A sibling not admitted by this Project.', inputSchema: {
  type: 'object', properties: {}, additionalProperties: false,
} }
let sequence = 0

const cookie = (userId: string, tenantId: string) => ({
  cookie: `${SESSION_COOKIE}=${signSession({ userId, tenantId, iat: Date.now() })}`,
  'x-account-transition-source': `session:${userId}`,
})

function fixture() {
  const suffix = `${Date.now().toString(36)}-${++sequence}`
  const org = accounts.createOrg('user-ada', `Commission MCP route ${suffix}`)
  assert.ok(org)
  const invite = accounts.createInvite(org.id, 'grace@acme.example', 'Ada')
  assert.ok(invite)
  assert.equal(accounts.resolveInvite(invite.id, 'user-grace', 'accept')?.kind, 'accepted')
  const tenantId = org.id
  const project = store.createProject({ name: `Commission MCP project ${suffix}`, description: 'Reviewed work only.' }, tenantId)
  assert.ok(project)
  store.applyRelationOp({ kind: 'scope-context', projectId: project.project.id, projectName: project.project.name,
    context: { kind: 'connector', label: TOOL.name, meta: 'Reviewed Commission MCP tool.' } }, tenantId)

  const modelId = `commission-model-${sequence}`
  const provider = store.createProvider({ label: `Commission MCP provider ${suffix}`, modelFamily: 'claude',
    effortLevels: ['Low'], models: [{ id: modelId, label: 'Fixture model' }],
    authority: { tools: ['*'], connectors: ['*'], scopes: ['*'] } },
  { baseURL: 'https://model.example.test', model: modelId, capabilities: { toolUse: true } }, tenantId)
  const agent = store.createAgent({ label: `Commission MCP agent ${suffix}`, systemPrompt: 'Draft carefully.',
    instructions: 'Use only the reviewed Project work.', tools: [], providerId: provider.id,
    authority: { tools: ['*'], connectors: ['*'], scopes: ['*'] } }, tenantId)
  const commission = store.createCommission({ agentId: agent.id, projectId: project.project.id, role: 'writer' }, tenantId)
  const connectionId = `mcp-connection-${(++sequence).toString(16).padStart(32, '0')}`
  store.createMcpConnection({ id: connectionId, label: `Commission peer ${suffix}`,
    endpoint: 'https://mcp.example.test/tools', authentication: 'none' }, tenantId, false, 'user-ada')
  const tools = [TOOL, HIDDEN_TOOL]
  store.commitMcpInspection(connectionId, tenantId, 0, {
    protocolVersion: MCP_MODERN_VERSION, cleanup: 'not-needed', tools,
    schemaAdmission: { version: MCP_SCHEMA_ADMISSION_VERSION, hashes: tools.map(tool => mcpToolSchemaHash(tool)) },
  }, Date.now())

  const path = `/commissions/${commission.id}/mcp-permission`
  const ada = cookie('user-ada', tenantId)
  const grace = cookie('user-grace', tenantId)
  const review = async (headers = ada, selection = true) => call('GET', `${path}${selection ? `?providerId=${provider.id}&modelId=${modelId}` : ''}`, undefined, headers)
  const request = (current: CommissionMcpReview, requestId: string, overrides: Partial<CommissionMcpApprovalIntent> = {}) => ({
    requestId, action: 'approve' as const, approval: {
      expectedRevision: current.policy.revision,
      expectedConfigurationRevision: current.configurationRevision,
      reviewHash: current.reviewHash,
      execution: current.execution!,
      expiresAt: Date.now() + 60_000,
      maxWorkItems: 2,
      tools: current.tools.map(row => ({ connectionId: row.connectionId, connectionRevision: row.connectionRevision,
        toolName: row.tool.name, schemaHash: row.schemaHash, fixedArguments: {} })),
      ...overrides,
    },
  })
  return { tenantId, projectId: project.project.id, commissionId: commission.id, providerId: provider.id,
    modelId, path, ada, grace, review, request, commission, project, provider, connectionId }
}

test('Commission MCP review is person-private, detached, owner-hidden and query-pair strict', async () => {
  const f = fixture()
  const first = await f.review()
  assert.equal(first.status, 200)
  assert.deepEqual(first.json.tools.map((row: any) => row.tool.name), [TOOL.name], 'Project connector context admits only its matching tool')
  assert.equal(first.json.policy.revision, 0)
  const approval = await call('POST', f.path, f.request(first.json as CommissionMcpReview, `private-${sequence}`), f.ada)
  assert.equal(approval.status, 200)
  assert.equal(approval.json.review.policy.revision, 1)

  const otherPerson = await f.review(f.grace)
  assert.equal(otherPerson.status, 200, 'another active same-tenant person may review the shared Commission')
  assert.equal(otherPerson.json.policy.revision, 0, 'that person sees their own empty private decision scope')
  assert.equal(otherPerson.json.policy.approval, null)

  const detached = first.json as CommissionMcpReview
  ;(detached.policy as any).approval = { forged: true }
  detached.tools[0]!.tool.name = 'mutated'
  const reread = await f.review()
  assert.equal(reread.json.policy.approval.reviewHash, approval.json.review.policy.approval.reviewHash)
  assert.equal(reread.json.tools[0].tool.name, TOOL.name)

  assert.equal((await call('GET', `${f.path}?providerId=${f.providerId}`, undefined, f.ada)).status, 400)
  assert.equal((await call('GET', `${f.path}?modelId=${f.modelId}`, undefined, f.ada)).status, 400)
  assert.equal((await call('GET', `${f.path}?providerId=${f.providerId}&modelId=${f.modelId}&extra=1`, undefined, f.ada)).status, 400)
  assert.equal((await call('GET', `${f.path}?providerId=${f.providerId}&providerId=${f.providerId}&modelId=${f.modelId}`, undefined, f.ada)).status, 400)
  assert.equal((await call('GET', '/commissions/no-such-commission/mcp-permission?bad=1', undefined, f.ada)).status, 404)
})

test('Commission MCP approval binds the reviewed tool; stale model, role, reach and audience require fresh review', async () => {
  const f = fixture()
  const current = (await f.review()).json as CommissionMcpReview
  const hidden = { ...f.request(current, `hidden-${sequence}`), approval: {
    ...f.request(current, `hidden-${sequence}`).approval,
    tools: [{ connectionId: f.connectionId, connectionRevision: current.tools[0]!.connectionRevision,
      toolName: HIDDEN_TOOL.name, schemaHash: mcpToolSchemaHash(HIDDEN_TOOL), fixedArguments: {} }],
  } }
  const hiddenResponse = await call('POST', f.path, hidden, f.ada)
  assert.equal(hiddenResponse.status, 404, 'a POST cannot name an admitted connection’s hidden sibling tool')
  assert.equal((await f.review()).json.policy.revision, 0, 'the hidden sibling request commits no permission')

  const acceptedRequest = f.request(current, `stale-replay-${sequence}`)
  const accepted = await call('POST', f.path, acceptedRequest, f.ada)
  assert.equal(accepted.status, 200)
  const decisionId = accepted.json.decisionId

  // Removing the selected model makes the live review blocked, but an exact
  // durable receipt remains replayable without re-authorizing new work.
  store.updateProvider(f.providerId, { models: [] }, f.provider.definitionRevision ?? 0)
  const replay = await call('POST', f.path, acceptedRequest, f.ada)
  assert.equal(replay.status, 200)
  assert.equal(replay.json.decisionId, decisionId)
  assert.equal(replay.json.review.active, false)
  const freshKeyStaleModel = await call('POST', f.path, f.request(current, `new-after-model-removal-${sequence}`, { expectedRevision: 1 }), f.ada)
  assert.equal(freshKeyStaleModel.status, 409)

  // Role, effective connector reach and Project audience are all review facts;
  // each mutation makes an old approval intent conflict without adding policy.
  store.updateCommission(f.commissionId, { role: 'reader' }, f.commission.configurationRevision ?? 0)
  assert.equal((await call('POST', f.path, f.request(current, `role-stale-${sequence}`, { expectedRevision: 1 }), f.ada)).status, 409)
  store.updateCommission(f.commissionId, { role: 'writer', authority: { connectors: [] } }, 1)
  assert.equal((await call('POST', f.path, f.request(current, `reach-stale-${sequence}`, { expectedRevision: 1 }), f.ada)).status, 409)
  store.updateCommission(f.commissionId, { authority: { connectors: ['*'] } }, 2)
  const share = accounts.createOrg('user-ada', `Commission MCP audience ${sequence}`)
  assert.ok(share)
  const grant = store.createGrant({ subject: { kind: 'project', id: f.projectId },
    audience: { kind: 'org', orgId: share.id }, tier: 'view' }, f.tenantId)
  assert.ok(grant && typeof grant === 'object')
  assert.equal((await call('POST', f.path, f.request(current, `audience-stale-${sequence}`, { expectedRevision: 1 }), f.ada)).status, 409)
})

test('POST rechecks current person membership after body parsing before committing a decision', async () => {
  const f = fixture()
  const current = (await f.review()).json as CommissionMcpReview
  const request = f.request(current, `membership-race-${sequence}`)
  const member = accounts.membership('user-ada', f.tenantId)
  assert.ok(member)
  const index = accounts.memberships.indexOf(member)
  const router = buildRouter()
  let status = 0
  let responseBody = ''
  const response: any = {
    writeHead(code: number) { status = code; return response }, setHeader() {}, write(chunk: string) { responseBody += chunk; return true },
    end(chunk?: string) { if (chunk) responseBody += chunk }, flushHeaders() {}, on() {}, get writableEnded() { return true },
  }
  const listeners: Record<string, (value?: Buffer) => void> = {}
  const req: any = { method: 'POST', headers: f.ada, on(event: string, listener: (value?: Buffer) => void) {
    listeners[event] = listener
    if (event === 'end') queueMicrotask(() => {
      accounts.memberships.splice(index, 1)
      listeners.data?.(Buffer.from(JSON.stringify(request)))
      listeners.end?.()
    })
    return req
  } }
  try {
    await router.handle(req, response, new URL(`http://test${f.path}`))
    assert.equal(status, 404)
    assert.equal(JSON.parse(responseBody).error.code, 'not_found')
    const after = await f.review()
    assert.equal(after.status, 404, 'membership removal was effective before the post-await store recheck')
  } finally {
    if (!accounts.membership('user-ada', f.tenantId)) accounts.memberships.splice(index, 0, member)
  }
})
