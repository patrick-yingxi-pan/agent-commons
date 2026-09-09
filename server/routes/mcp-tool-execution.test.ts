/** Route-level external MCP consent locks: the approval receipt lands before
 * network I/O, concurrent/restarted acknowledgements never dispatch twice,
 * and account/tenant authority is checked before the peer is contacted. */
import assert from 'node:assert/strict'
import { once } from 'node:events'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { test } from 'node:test'
import type { ToolActivity } from '../../contract/index.ts'
import { configureMcpRuntime, mcpRuntimeConfiguration } from '../mcpRuntime.ts'
import { MCP_SCHEMA_ADMISSION_VERSION, mcpToolSchemaHash } from '../mcpToolAdmission.ts'
import { MCP_MODERN_VERSION } from '../mcpProtocol.ts'
import { store } from '../store/index.ts'
import { call, callFresh } from '../testkit/http.ts'
import { toolActivityDecisionId } from '../toolActivityDecisionIdentity.ts'

async function requestBody(req: IncomingMessage): Promise<Record<string, any>> {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(chunk as Buffer)
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

function send(res: ServerResponse, value: unknown): void {
  res.writeHead(200, { 'content-type': 'application/json' })
  res.end(JSON.stringify(value))
}

test('the consent route durably coalesces one external attempt and replays known and uncertain outcomes', async (t) => {
  const previousRuntime = mcpRuntimeConfiguration()
  configureMcpRuntime({ deviceBearerAvailable: false, allowLoopback: true })
  t.after(() => configureMcpRuntime({ ...previousRuntime }))

  let releaseFirst = () => {}
  const held = new Promise<void>((resolve) => { releaseFirst = resolve })
  let announceFirst = () => {}
  const firstReached = new Promise<void>((resolve) => { announceFirst = resolve })
  let calls = 0
  const peer = createServer(async (req, res) => {
    const body = await requestBody(req)
    if (body.method === 'server/discover') {
      return send(res, { jsonrpc: '2.0', id: body.id, result: {
        resultType: 'complete', supportedVersions: [MCP_MODERN_VERSION], capabilities: { tools: {} },
        _meta: { 'io.modelcontextprotocol/serverInfo': { name: 'route-lock', version: '1' } },
      } })
    }
    assert.equal(body.method, 'tools/call')
    calls += 1
    if (calls === 1) {
      announceFirst()
      await held
      return send(res, { jsonrpc: '2.0', id: body.id, result: {
        resultType: 'complete', content: [{ type: 'text', text: 'accepted once' }], isError: false,
      } })
    }
    // A complete HTTP response with an invalid MCP result is post-submission
    // uncertainty, not a known failure and never retry authority.
    return send(res, { jsonrpc: '2.0', id: body.id, result: { resultType: 'unsupported' } })
  })
  peer.listen(0, '127.0.0.1')
  await once(peer, 'listening')
  t.after(async () => {
    peer.closeAllConnections()
    await new Promise<void>((resolve) => peer.close(() => resolve()))
  })
  const address = peer.address()
  assert.ok(address && typeof address === 'object')

  const tenantId = store.defaultTenantId()
  const connectionId = 'mcp-connection-34343434343434343434343434343434'
  const tool = { name: 'write', inputSchema: {
    type: 'object', properties: { value: { type: 'string' } }, required: ['value'], additionalProperties: false,
  } }
  const schemaHash = mcpToolSchemaHash(tool)
  store.createMcpConnection({ id: connectionId, label: 'Route MCP', endpoint: `http://127.0.0.1:${address.port}/mcp`, authentication: 'none' }, tenantId, true)
  store.commitMcpInspection(connectionId, tenantId, 0, {
    protocolVersion: MCP_MODERN_VERSION, cleanup: 'not-needed', tools: [tool],
    schemaAdmission: { version: MCP_SCHEMA_ADMISSION_VERSION, hashes: [schemaHash] },
  }, 1)
  const session = store.createSession('External route approval', tenantId)
  store.attachContext(session.id, { id: connectionId, type: 'mcp', label: 'Route MCP', scope: '*' })
  const proposal = (id: string): ToolActivity => ({
    id, tool: 'mcp__route__write', connector: 'Route MCP', connectorId: connectionId,
    kind: 'action', status: 'proposed', summary: 'Write once', input: { value: id },
    mcp: { connectionRevision: 1, toolName: 'write', schemaHash },
  })
  store.appendMessage(session.id, { id: store.mintMessageId('assistant'), role: 'assistant', content: 'Approve?', toolActivities: [proposal('route-call-known')] })

  const path = `/sessions/${session.id}/tool-activities/route-call-known`
  const key = 'route-call-known-key'
  const headers = { 'idempotency-key': key }
  const first = call('POST', path, { decision: 'confirm' }, headers)
  await firstReached
  const receipt = toolActivityDecisionId(tenantId, session.id, 'route-call-known', key)
  assert.equal(store.getToolActivity(session.id, 'route-call-known')?.status, 'running')
  assert.equal(store.getToolActivity(session.id, 'route-call-known')?.decisionId, receipt)

  const deletion = await call('DELETE', `/sessions/${session.id}`, {})
  assert.equal(deletion.status, 409)
  assert.match(deletion.json.error.message, /running MCP tool/i)
  const compaction = await call('POST', `/sessions/${session.id}/compact`, {}, { 'idempotency-key': 'held-mcp-compaction' })
  assert.equal(compaction.status, 409)
  assert.match(compaction.json.error.message, /MCP tool request/i)
  const fork = await call('POST', `/sessions/${session.id}/fork`, { atMessageId: store.getSession(session.id)!.messages!.at(-1)!.id })
  assert.equal(fork.status, 409)
  assert.match(fork.json.error.message, /MCP tool request/i)
  assert.equal(store.getToolActivity(session.id, 'route-call-known')?.decisionId, receipt,
    'lifecycle refusals retain the exact running receipt')

  const concurrent = await call('POST', path, { decision: 'confirm' }, headers)
  assert.equal(concurrent.status, 200)
  assert.equal(concurrent.json.status, 'running')
  assert.equal(calls, 1)
  assert.equal((await call('POST', path, { decision: 'decline' }, headers)).status, 400)
  assert.equal((await call('POST', path, { decision: 'confirm' }, { 'idempotency-key': `${key}-different` })).status, 400)
  assert.equal((await call('POST', path, { decision: 'confirm' }, { ...headers, 'x-tenant-id': `${tenantId}-foreign` })).status, 404)
  assert.equal((await call('POST', path, { decision: 'confirm' }, { ...headers, 'x-account-transition-source': 'session:not-the-current-account' })).status, 409)
  assert.equal(calls, 1, 'authority failures perform no peer I/O')

  releaseFirst()
  const completed = await first
  assert.equal(completed.status, 200)
  assert.equal(completed.json.status, 'done')
  assert.equal(completed.json.mcpResult.content[0].text, 'accepted once')
  assert.equal((await callFresh('POST', path, { decision: 'confirm' }, headers)).json.status, 'done')
  assert.equal(calls, 1, 'a fresh route table still recovers the durable receipt')
  assert.equal((await call('POST', `/sessions/${session.id}/fork`, {
    atMessageId: store.getSession(session.id)!.messages!.at(-1)!.id,
  })).status, 200, 'terminal MCP history remains forkable')
  for (let index = 0; index < 6; index += 1) {
    store.appendMessage(session.id, { id: store.mintMessageId('user'), role: 'user', content: `Later route turn ${index}` })
  }
  const compactionPlan = store.prepareSessionCompaction(session.id)
  assert.ok(compactionPlan && compactionPlan.kind === 'ready')
  store.applySessionCompaction(compactionPlan, 'The approved external call completed.')
  assert.equal(store.getToolActivity(session.id, 'route-call-known'), undefined,
    'ordinary activity lookup cannot execute archived history')
  assert.equal((await callFresh('POST', path, { decision: 'confirm' }, headers)).json.decisionId, receipt,
    'the exact archived terminal receipt still acknowledges a lost response')
  assert.equal(calls, 1, 'archived receipt replay performs no peer I/O')
  store.appendMessage(session.id, {
    id: store.mintMessageId('assistant'), role: 'assistant', content: 'A later ambiguous proposal.',
    toolActivities: [{ ...proposal('route-call-known'), input: { value: 'changed-after-compaction' } }],
  })
  const archivedReplay = await callFresh('POST', path, { decision: 'confirm' }, headers)
  assert.equal(archivedReplay.status, 200)
  assert.equal(archivedReplay.json.decisionId, receipt,
    'the old receipt resolves its archived terminal row despite the reused active id')
  assert.equal((await callFresh('POST', path, { decision: 'confirm' }, {
    'idempotency-key': 'route-call-known-new-key',
  })).status, 400, 'a fresh key cannot ambiguously approve changed arguments under a reused id')
  assert.equal(calls, 1, 'neither replay nor ambiguous fresh approval contacts the peer')
  const unkeyedCollision = store.createSession('Ambiguous unkeyed activities', tenantId)
  for (const value of ['first', 'second']) {
    store.appendMessage(unkeyedCollision.id, {
      id: store.mintMessageId('assistant'), role: 'assistant', content: `Proposal ${value}.`,
      toolActivities: [{ ...proposal('route-unkeyed-duplicate'), input: { value } }],
    })
  }
  assert.equal((await callFresh('POST', `/sessions/${unkeyedCollision.id}/tool-activities/route-unkeyed-duplicate`, {
    decision: 'decline',
  })).status, 400, 'an unkeyed verdict cannot select the first of two active rows sharing an id')
  assert.equal(calls, 1)

  store.appendMessage(session.id, { id: store.mintMessageId('assistant'), role: 'assistant', content: 'Approve another?', toolActivities: [proposal('route-call-uncertain')] })
  const uncertainPath = `/sessions/${session.id}/tool-activities/route-call-uncertain`
  const uncertainHeaders = { 'idempotency-key': 'route-call-uncertain-key' }
  const uncertain = await call('POST', uncertainPath, { decision: 'confirm' }, uncertainHeaders)
  assert.equal(uncertain.status, 200)
  assert.equal(uncertain.json.status, 'uncertain')
  assert.equal(uncertain.json.mcpResult, undefined)
  assert.equal((await callFresh('POST', uncertainPath, { decision: 'confirm' }, uncertainHeaders)).json.status, 'uncertain')
  assert.equal(calls, 2)
  assert.equal((await call('DELETE', `/sessions/${session.id}`, {})).status, 200,
    'reviewed deletion is available after every MCP call is terminal')
})
