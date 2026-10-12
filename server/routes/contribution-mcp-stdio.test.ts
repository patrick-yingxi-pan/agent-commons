/** Authenticated Contribution MCP acceptance for person-owned local stdio. */
import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import type { McpStdioConnection } from '../mcpStdioClient.ts'
import { MCP_MODERN_VERSION } from '../mcpProtocol.ts'
import { MCP_SCHEMA_ADMISSION_VERSION } from '../mcpToolAdmission.ts'
import { accounts } from '../accounts.ts'
import { signSession } from '../auth.ts'
import { call, callFresh } from '../testkit/http.ts'
import { configureMcpRuntime, initializeMcpRuntime, mcpRuntimeConfiguration } from '../mcpRuntime.ts'
import { store } from '../store/index.ts'

let sequence = 0
const ownerName = 'Local Contribution Owner'
const tool = { name: 'write', inputSchema: {
  type: 'object', properties: { value: { type: 'string' } }, required: ['value'], additionalProperties: false,
} }
const cookieOf = (response: { headers: Record<string, string> }) => response.headers['set-cookie']?.split(';')[0] ?? ''

afterEach(() => configureMcpRuntime({ deviceBearerAvailable: false, allowLoopback: false }))

async function account(label: string) {
  const tag = `${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${++sequence}`
  const email = `${tag}@contribution-stdio.example`
  const response = await call('POST', '/auth/signup', { name: label, email, password: `${tag}-password` })
  assert.equal(response.status, 200, JSON.stringify(response.json))
  return { userId: response.json.user.id as string, email, cookie: cookieOf(response) }
}

function headers(userId: string, tenantId: string, key?: string) {
  return { cookie: `uw_session=${signSession({ userId, tenantId, iat: Date.now() })}`,
    'x-account-transition-source': `session:${userId}`, ...(key ? { 'idempotency-key': key } : {}) }
}

async function sharedTenant() {
  const owner = await account(ownerName)
  const peer = await account('Local Contribution Peer')
  const org = await call('POST', '/orgs', { name: `Local Contribution ${sequence}` }, { cookie: owner.cookie })
  assert.equal(org.status, 201, JSON.stringify(org.json))
  const invite = await call('POST', `/orgs/${org.json.id}/invites`, { email: peer.email }, { cookie: owner.cookie })
  assert.equal(invite.status, 201, JSON.stringify(invite.json))
  assert.equal((await call('POST', `/me/invites/${invite.json.id}/accept`, undefined, { cookie: peer.cookie })).status, 200)
  assert.ok(accounts.identityFor(owner.userId, org.json.id))
  assert.ok(accounts.identityFor(peer.userId, org.json.id))
  return { owner, peer, tenantId: org.json.id, ownerHeaders: headers(owner.userId, org.json.id), peerHeaders: headers(peer.userId, org.json.id) }
}

function peer(counters: { calls: number; mode: 'success' | 'refuse' | 'uncertain' }, onCall?: () => void): McpStdioConnection {
  return {
    request: async (method, params, { beforeDispatch }) => {
      if (method === 'tools/call') {
        assert.equal(beforeDispatch?.(), true, 'the persisted owner/work fence runs immediately before local dispatch')
        counters.calls++
        onCall?.()
        assert.equal(params.name, 'write')
        assert.deepEqual(params.arguments, { value: 'once' })
        if (counters.mode === 'refuse') throw Object.assign(new Error('private child diagnostic'), { code: 'unavailable', mayHaveSubmitted: false })
        if (counters.mode === 'uncertain') throw new Error('private child diagnostic after possible submission')
        return { jsonrpc: '2.0', id: 'call', result: { resultType: 'complete', content: [{ type: 'text', text: 'saved locally' }], isError: false } }
      }
      if (method === 'server/discover') return { jsonrpc: '2.0', id: 'discover', result: {
        resultType: 'complete', supportedVersions: [MCP_MODERN_VERSION], capabilities: { tools: {} },
        _meta: { 'io.modelcontextprotocol/serverInfo': { name: 'authored-local-peer', version: '1' } },
      } }
      if (method === 'tools/list') return { jsonrpc: '2.0', id: 'list', result: { resultType: 'complete', tools: [tool] } }
      throw new Error(`unexpected ${method}`)
    },
    initialized: async () => undefined,
    close: async () => ({ code: 'released' }),
    closed: Promise.resolve({ code: 'released' }),
  }
}

async function bindLocal(tenantId: string, ownerUserId: string, counters: { calls: number; mode: 'success' | 'refuse' | 'uncertain' }) {
  const runtime = mcpRuntimeConfiguration()
  configureMcpRuntime({ ...runtime, deviceBearerAvailable: false, deviceOAuthAvailable: false,
    localProcessesAvailable: true, synchronizeStdioBindings: async () => ({ available: true }),
    openStdio: () => peer(counters) })
  await initializeMcpRuntime(store.mcpCredentialBindings(), store.mcpStdioBindings())
  const setupKey = `stdio-contribution-${sequence}`
  const created = await call('POST', '/mcp-connections', { transport: 'stdio', creationId: setupKey, label: 'Local writer' },
    headers(ownerUserId, tenantId))
  assert.equal(created.status, 200, JSON.stringify(created.json))
  const connectionId = created.json.connection.id as string
  const inspected = await call('POST', `/mcp-connections/${connectionId}/inspect`, {
    operationId: `stdio-inspect-${sequence}`, expectedRevision: 0,
    grantReference: `MCP_STDIO_${sequence.toString(16).toUpperCase().padStart(32, '0')}`,
  }, headers(ownerUserId, tenantId))
  assert.equal(inspected.status, 200, JSON.stringify(inspected.json))
  return connectionId
}

function project(tenantId: string) {
  const id = `p-contribution-stdio-${++sequence}`
  store.applyRelationOp({ kind: 'create-project', projectId: id, projectName: 'Local Contribution boundary', projectDescription: '' }, tenantId)
  store.applyRelationOp({ kind: 'share-project', projectId: id, projectName: 'Local Contribution boundary', shared: true }, tenantId)
  return id
}

function proposal(connectionId: string) {
  return { expectedVersion: 0, lines: [{ type: 'mcp.mutate', target: 'write', cardinality: 2, harness: 'explicit-call',
    note: 'One separately approved local call.', mcp: { connectionId, connectionRevision: 1, toolName: 'write', arguments: { value: 'once' } } }] }
}

test('local Contribution is owner-only, separately approved, labeled in public receipts, and exact replay never respawns', { timeout: 30_000 }, async (t) => {
  const prior = mcpRuntimeConfiguration()
  t.after(() => configureMcpRuntime({ ...prior }))
  const { owner, peer: member, tenantId, ownerHeaders, peerHeaders } = await sharedTenant()
  const counts = { calls: 0, mode: 'success' as const }
  const connectionId = await bindLocal(tenantId, owner.userId, counts)
  const projectId = project(tenantId)
  const opened = await call('POST', `/projects/${projectId}/contributions`, { title: 'Local work' },
    { ...ownerHeaders, 'idempotency-key': `contribution-${sequence}` })
  assert.equal(opened.status, 200, JSON.stringify(opened.json))
  const contributionId = opened.json.id
  const path = `/projects/${projectId}/contributions/${contributionId}`

  const peerProposal = await call('POST', `${path}/envelope`, proposal(connectionId), { ...peerHeaders, 'idempotency-key': `peer-proposal-${sequence}` })
  assert.notEqual(peerProposal.status, 200, 'membership does not expose another person’s local connection')
  assert.equal(counts.calls, 0)
  const proposed = await call('POST', `${path}/envelope`, proposal(connectionId), { ...ownerHeaders, 'idempotency-key': `owner-proposal-${sequence}` })
  assert.equal(proposed.status, 200, JSON.stringify(proposed.json))
  const lineId = proposed.json.envelope.lines[0].id
  assert.equal(proposed.json.envelope.lines[0].mcp.transport, 'stdio')
  assert.equal(proposed.json.envelope.lines[0].mcp.canRun, undefined)
  assert.doesNotMatch(JSON.stringify(proposed.json), /MCP_STDIO_|ownerUserId|grantReference|endpoint|mcpAuthority/)
  const approval = await call('POST', `${path}/envelope/approve`, { expectedVersion: 1 },
    { ...ownerHeaders, 'idempotency-key': `approval-${sequence}` })
  assert.equal(approval.status, 200, JSON.stringify(approval.json))
  assert.equal(approval.json.envelope.lines[0].mcp.canRun, true)
  const shared = await call('GET', `/projects/${projectId}/contributions`, undefined, peerHeaders)
  assert.equal(shared.status, 200)
  const sharedRow = shared.json.find((row: any) => row.id === contributionId)
  assert.equal(sharedRow.envelope.lines[0].mcp.transport, 'stdio')
  assert.equal(sharedRow.envelope.lines[0].mcp.canRun, undefined)

  const runBody = { lineId, expectedVersion: 1 }
  const receiptKey = `owner-run-${sequence}`
  const peerRun = await callFresh('POST', `${path}/effects`, runBody, { ...peerHeaders, 'idempotency-key': receiptKey })
  assert.notEqual(peerRun.status, 200)
  assert.equal(counts.calls, 0)
  const completed = await call('POST', `${path}/effects`, runBody, { ...ownerHeaders, 'idempotency-key': receiptKey })
  assert.equal(completed.status, 200, JSON.stringify(completed.json))
  assert.equal(completed.json.effects.at(-1).status, 'done')
  assert.equal(completed.json.effects.at(-1).transport, 'stdio')
  assert.equal(completed.json.effects.at(-1).connectionLabel, 'Local writer')
  assert.match(completed.json.effects.at(-1).result.content[0].text, /saved locally/)
  assert.doesNotMatch(JSON.stringify(completed.json.effects.at(-1)), /MCP_STDIO_|ownerUserId|grantReference|endpoint|mcpAuthority|schemaHash/)
  assert.equal(counts.calls, 1)
  const replay = await callFresh('POST', `${path}/effects`, runBody, { ...ownerHeaders, 'idempotency-key': receiptKey })
  assert.equal(replay.status, 200, JSON.stringify(replay.json))
  assert.equal(replay.json.effects.at(-1).status, 'done')
  assert.equal(counts.calls, 1, 'a settled same-key receipt is represented without a second local spawn/call')
  const disconnected = await call('POST', `/mcp-connections/${connectionId}/disconnect`, { expectedRevision: 1 }, ownerHeaders)
  assert.equal(disconnected.status, 200, JSON.stringify(disconnected.json))
  const afterDisconnect = await callFresh('POST', `${path}/effects`, runBody, { ...ownerHeaders, 'idempotency-key': receiptKey })
  assert.equal(afterDisconnect.status, 200, JSON.stringify(afterDisconnect.json))
  assert.equal(afterDisconnect.json.effects.at(-1).status, 'done', 'retained owner receipt remains readable after grant revocation')
  assert.equal(afterDisconnect.json.envelope.lines[0].mcp.canRun, undefined)
  assert.equal(counts.calls, 1, 'revocation fences new calls while retaining receipt-only replay')
  assert.ok(accounts.identityFor(member.userId, tenantId))
})

test('known local pre-dispatch refusal does not claim that launching the program was effect-free', { timeout: 30_000 }, async (t) => {
  const prior = mcpRuntimeConfiguration()
  t.after(() => configureMcpRuntime({ ...prior }))
  const { owner, tenantId, ownerHeaders } = await sharedTenant()
  const counts = { calls: 0, mode: 'refuse' as const }
  const connectionId = await bindLocal(tenantId, owner.userId, counts)
  const projectId = project(tenantId)
  const opened = await call('POST', `/projects/${projectId}/contributions`, { title: 'Local refusal' },
    { ...ownerHeaders, 'idempotency-key': `contribution-${sequence}` })
  assert.equal(opened.status, 200)
  const path = `/projects/${projectId}/contributions/${opened.json.id}`
  const proposed = await call('POST', `${path}/envelope`, proposal(connectionId), { ...ownerHeaders, 'idempotency-key': `proposal-${sequence}` })
  assert.equal(proposed.status, 200, JSON.stringify(proposed.json))
  const lineId = proposed.json.envelope.lines[0].id
  assert.equal((await call('POST', `${path}/envelope/approve`, { expectedVersion: 1 }, { ...ownerHeaders, 'idempotency-key': `approval-${sequence}` })).status, 200)
  const failed = await call('POST', `${path}/effects`, { lineId, expectedVersion: 1 },
    { ...ownerHeaders, 'idempotency-key': `run-${sequence}` })
  assert.equal(failed.status, 200, JSON.stringify(failed.json))
  assert.equal(failed.json.effects.at(-1).status, 'failed')
  assert.match(failed.json.effects.at(-1).summary, /tool call was refused before execution/i)
  assert.match(failed.json.effects.at(-1).summary, /starting the local program may already have had effects/i)
  assert.equal(counts.calls, 1, 'the native peer was already started and received the one call attempt')
})

test('possible local submission becomes uncertain and keyed replay never launches a second process', { timeout: 30_000 }, async (t) => {
  const prior = mcpRuntimeConfiguration()
  t.after(() => configureMcpRuntime({ ...prior }))
  const { owner, tenantId, ownerHeaders } = await sharedTenant()
  const counts = { calls: 0, mode: 'uncertain' as const }
  const connectionId = await bindLocal(tenantId, owner.userId, counts)
  const projectId = project(tenantId)
  const opened = await call('POST', `/projects/${projectId}/contributions`, { title: 'Local uncertainty' },
    { ...ownerHeaders, 'idempotency-key': `contribution-${sequence}` })
  assert.equal(opened.status, 200)
  const path = `/projects/${projectId}/contributions/${opened.json.id}`
  const proposed = await call('POST', `${path}/envelope`, proposal(connectionId), { ...ownerHeaders, 'idempotency-key': `proposal-${sequence}` })
  assert.equal(proposed.status, 200, JSON.stringify(proposed.json))
  const lineId = proposed.json.envelope.lines[0].id
  assert.equal((await call('POST', `${path}/envelope/approve`, { expectedVersion: 1 }, { ...ownerHeaders, 'idempotency-key': `approval-${sequence}` })).status, 200)
  const body = { lineId, expectedVersion: 1 }
  const key = `run-${sequence}`
  const uncertain = await call('POST', `${path}/effects`, body, { ...ownerHeaders, 'idempotency-key': key })
  assert.equal(uncertain.status, 200, JSON.stringify(uncertain.json))
  assert.equal(uncertain.json.effects.at(-1).status, 'uncertain')
  assert.equal(counts.calls, 1)
  const replay = await callFresh('POST', `${path}/effects`, body, { ...ownerHeaders, 'idempotency-key': key })
  assert.equal(replay.status, 200)
  assert.equal(replay.json.effects.at(-1).status, 'uncertain')
  assert.equal(counts.calls, 1, 'possibly submitted local work is not replayed')
})
