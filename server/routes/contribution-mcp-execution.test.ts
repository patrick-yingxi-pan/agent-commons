/** HTTP acceptance for explicit per-call MCP effects in Contribution
 * envelopes. Exercises the real route/store/executor against a local peer. */
import assert from 'node:assert/strict'
import { once } from 'node:events'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { test } from 'node:test'
import { store } from '../store/index.ts'
import { call, callFresh } from '../testkit/http.ts'
import { configureMcpRuntime, mcpRuntimeConfiguration } from '../mcpRuntime.ts'
import { MCP_SCHEMA_ADMISSION_VERSION, mcpToolSchemaHash } from '../mcpToolAdmission.ts'
import { MCP_MODERN_VERSION } from '../mcpProtocol.ts'

const PROJECT_OWNER = 'tenant-contribution-mcp-owner'
const CONTRIBUTOR = 'tenant-contribution-mcp-contributor'
const READER = 'tenant-contribution-mcp-reader'
let sequence = 0

async function readBody(req: IncomingMessage): Promise<Record<string, any>> {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(chunk as Buffer)
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

function send(res: ServerResponse, id: unknown, result: unknown): void {
  res.writeHead(200, { 'content-type': 'application/json' })
  res.end(JSON.stringify({ jsonrpc: '2.0', id, result }))
}

function headers(tenantId: string, key?: string): Record<string, string> {
  return { 'x-tenant-id': tenantId, ...(key ? { 'idempotency-key': key } : {}) }
}

async function registerConnection(tenantId: string, label: string, endpoint: string, tool: Record<string, unknown>): Promise<string> {
  const id = `mcp-connection-${(++sequence).toString(16).padStart(32, '0')}`
  store.createMcpConnection({ id, label, endpoint, authentication: 'none' }, tenantId, true)
  const schemaHash = mcpToolSchemaHash(tool as never)
  store.commitMcpInspection(id, tenantId, 0, {
    protocolVersion: MCP_MODERN_VERSION,
    cleanup: 'not-needed',
    tools: [tool as never],
    schemaAdmission: { version: MCP_SCHEMA_ADMISSION_VERSION, hashes: [schemaHash] },
  }, 1)
  return id
}

test('Contribution MCP envelope uses one exact owner-bound call per Run and durable, private receipts', async (t) => {
  const oldProfile = process.env.DEPLOYMENT_PROFILE
  process.env.DEPLOYMENT_PROFILE = 'desktop'
  t.after(() => {
    if (oldProfile === undefined) delete process.env.DEPLOYMENT_PROFILE
    else process.env.DEPLOYMENT_PROFILE = oldProfile
  })
  const oldRuntime = mcpRuntimeConfiguration()
  configureMcpRuntime({ deviceBearerAvailable: false, allowLoopback: true })
  t.after(() => configureMcpRuntime({ ...oldRuntime }))

  let calls = 0
  let releaseFirst!: () => void
  const firstHold = new Promise<void>((resolve) => { releaseFirst = resolve })
  let announceFirst!: () => void
  const firstReached = new Promise<void>((resolve) => { announceFirst = resolve })
  const peer = createServer((req, res) => {
    void (async () => {
      const body = await readBody(req)
      if (body.method === 'server/discover') {
        return send(res, body.id, {
          resultType: 'complete',
          supportedVersions: [MCP_MODERN_VERSION],
          capabilities: { tools: {} },
          _meta: { 'io.modelcontextprotocol/serverInfo': { name: 'contribution-peer', version: '1' } },
        })
      }
      assert.equal(body.method, 'tools/call')
      calls += 1
      assert.equal(body.params.name, 'write')
      assert.deepEqual(body.params.arguments, { value: 'effect-1' }, 'each separately confirmed Run uses the exact approved arguments')
      if (calls === 1) {
        announceFirst()
        await firstHold
        return send(res, body.id, { resultType: 'complete', content: [{ type: 'text', text: 'created once' }], isError: false })
      }
      if (calls === 2) {
        return send(res, body.id, { resultType: 'complete', content: [{ type: 'text', text: 'peer rejected this write' }], isError: true })
      }
      // A malformed post-submission result is uncertainty, not permission to retry.
      return send(res, body.id, { resultType: 'unsupported' })
    })().catch(() => res.destroy())
  })
  peer.listen(0, '127.0.0.1')
  await once(peer, 'listening')
  t.after(async () => {
    peer.closeAllConnections()
    await new Promise<void>((resolve) => peer.close(() => resolve()))
  })
  const address = peer.address()
  assert.ok(address && typeof address === 'object')
  const endpoint = `http://127.0.0.1:${address.port}/mcp`
  const tool = { name: 'write', inputSchema: {
    type: 'object', properties: { value: { type: 'string' } }, required: ['value'], additionalProperties: false,
  } }
  const contributorConnectionId = await registerConnection(CONTRIBUTOR, 'Contributor MCP', endpoint, tool)
  const foreignConnectionId = await registerConnection(READER, 'Reader MCP', endpoint, tool)

  const projectId = `p-contribution-mcp-${++sequence}`
  store.applyRelationOp({ kind: 'create-project', projectId, projectName: 'MCP effect boundary', projectDescription: '' }, PROJECT_OWNER)
  store.applyRelationOp({ kind: 'share-project', projectId, projectName: 'MCP effect boundary', shared: true }, PROJECT_OWNER)
  const opened = await call('POST', `/projects/${projectId}/contributions`, { title: 'Run one explicit tool' }, headers(CONTRIBUTOR))
  assert.equal(opened.status, 200)
  const contributionId = opened.json.id
  const path = `/projects/${projectId}/contributions/${contributionId}`
  const proposePath = `${path}/envelope`
  const staleSourceHeaders = (tenantId: string, key?: string) => ({
    ...headers(tenantId, key),
    'x-account-transition-source': 'session:not-the-current-account',
  })
  assert.equal((await call('GET', `/projects/${projectId}/contributions`, undefined, staleSourceHeaders(READER))).status, 409,
    'a stale signed-in account source cannot read a Project Contribution projection')
  const selection = (value: string, connectionId = contributorConnectionId) => ({
    connectionId, connectionRevision: 1, toolName: 'write', arguments: { value },
  })
  const bodyFor = (value: string, connectionId = contributorConnectionId) => ({ expectedVersion: 0, lines: [{
    type: 'mcp.mutate', target: 'write', cardinality: 3, harness: 'explicit-call', note: 'One call per confirmation.',
    mcp: selection(value, connectionId),
  }] })

  const borrowedProposal = await call('POST', proposePath, bodyFor('effect-borrowed', foreignConnectionId), headers(CONTRIBUTOR, 'mcp-envelope-foreign-selection'))
  assert.equal(borrowedProposal.status, 400, 'a shared Project does not let the contributor select a reader-owned connection')
  assert.equal(calls, 0)

  const staleProposal = await call('POST', proposePath, bodyFor('effect-1'), staleSourceHeaders(CONTRIBUTOR, 'mcp-envelope-proposal'))
  assert.equal(staleProposal.status, 409, 'a stale account source cannot create or replay a proposal')
  assert.equal(calls, 0)

  const proposed = await call('POST', proposePath, bodyFor('effect-1'), headers(CONTRIBUTOR, 'mcp-envelope-proposal'))
  assert.equal(proposed.status, 200)
  assert.equal(proposed.json.envelope.status, 'proposed')
  assert.equal(proposed.json.envelope.lines[0].target, 'write')
  assert.deepEqual({
    connectionLabel: proposed.json.envelope.lines[0].mcp.connectionLabel,
    toolName: proposed.json.envelope.lines[0].mcp.toolName,
    arguments: proposed.json.envelope.lines[0].mcp.arguments,
  }, { connectionLabel: 'Contributor MCP', toolName: 'write', arguments: { value: 'effect-1' } })
  assert.doesNotMatch(JSON.stringify(proposed.json.envelope.lines[0]), /mcp-connection-|schemaHash|endpoint|credentialReference|mcpAuthority/)
  const lineId = proposed.json.envelope.lines[0].id
  assert.equal((await call('POST', `${path}/envelope/approve`, { expectedVersion: 1 }, staleSourceHeaders(PROJECT_OWNER, 'mcp-envelope-approval'))).status, 409,
    'a stale account source cannot approve the reviewed version')
  const approved = await call('POST', `${path}/envelope/approve`, { expectedVersion: 1 }, headers(PROJECT_OWNER, 'mcp-envelope-approval'))
  assert.equal(approved.status, 200)
  assert.equal(approved.json.envelope.approvedVersion, 1)

  const effectsPath = `${path}/effects`
  const run1 = { lineId, expectedVersion: 1 }
  assert.equal((await call('POST', effectsPath, run1, headers(CONTRIBUTOR))).status, 400,
    'real MCP calls require both a fresh per-call key and the exact reviewed version')
  assert.equal((await call('POST', effectsPath, { lineId }, headers(CONTRIBUTOR, 'mcp-envelope-no-version'))).status, 409,
    'the compatibility door cannot run an explicit MCP line without its version precondition')
  const staleAccountSource = await call('POST', effectsPath, run1, {
    ...staleSourceHeaders(CONTRIBUTOR, 'mcp-envelope-stale-account-source'),
  })
  assert.equal(staleAccountSource.status, 409, 'stale account-source fence refuses before any MCP call')
  assert.equal(calls, 0)

  const ownerAttempt = await call('POST', effectsPath, run1, headers(PROJECT_OWNER, 'mcp-envelope-owner-borrow'))
  assert.notEqual(ownerAttempt.status, 200, 'the Project owner cannot borrow the contributor’s private MCP connection')
  assert.equal(calls, 0, 'source-owner denial happens before any peer request')

  const runKey = 'mcp-envelope-run-one'
  const firstRun = call('POST', effectsPath, run1, headers(CONTRIBUTOR, runKey))
  const firstSignal = await Promise.race([firstReached.then(() => 'peer'), firstRun])
  assert.equal(firstSignal, 'peer', `the explicit owner-bound Run reaches the configured MCP peer: ${JSON.stringify(firstSignal)}`)
  const pending = await call('GET', `/projects/${projectId}/contributions`, undefined, headers(READER))
  assert.equal(pending.status, 200)
  const pendingContribution = pending.json.find((row: any) => row.id === contributionId)
  assert.equal(pendingContribution.effects.at(-1).status, 'pending', 'durable receipt is visible before the peer completes')
  assert.equal(pendingContribution.effects.at(-1).arguments.value, 'effect-1')
  assert.doesNotMatch(JSON.stringify(pendingContribution.effects.at(-1)), /mcp-connection-|schemaHash|endpoint|credentialReference|mcpAuthority/)
  const concurrentReplay = await callFresh('POST', effectsPath, run1, headers(CONTRIBUTOR, runKey))
  assert.equal(concurrentReplay.status, 200)
  assert.equal(concurrentReplay.json.effects.at(-1).status, 'pending')
  assert.equal(calls, 1, 'pending replay attaches to the represented attempt')
  const changedIntent = await callFresh('POST', effectsPath, { ...run1, expectedVersion: 2 }, headers(CONTRIBUTOR, runKey))
  assert.equal(changedIntent.status, 409, 'one key cannot be redirected to another reviewed version')
  const staleVersion = await callFresh('POST', effectsPath, { ...run1, expectedVersion: 2 }, headers(CONTRIBUTOR, 'mcp-envelope-stale-version'))
  assert.equal(staleVersion.status, 409)
  assert.equal(calls, 1)

  const sharedReaderAttempt = await callFresh('POST', effectsPath, run1, headers(READER, runKey))
  assert.notEqual(sharedReaderAttempt.status, 200, 'Project read access does not grant execution or the contributor’s replay identity')
  assert.equal(calls, 1)

  releaseFirst()
  const completed = await firstRun
  assert.equal(completed.status, 200)
  assert.equal(completed.json.effects[0].status, 'done')
  assert.equal(completed.json.effects[0].result.content[0].text, 'created once')
  assert.doesNotMatch(JSON.stringify(completed.json.effects[0]), /mcp-connection-|schemaHash|endpoint|credentialReference|mcpAuthority/)
  const replay = await callFresh('POST', effectsPath, run1, headers(CONTRIBUTOR, runKey))
  assert.equal(replay.status, 200)
  assert.equal(replay.json.effects[0].status, 'done')
  assert.equal(calls, 1, 'response-loss replay returns current truth without another tools/call')

  const failed = await callFresh('POST', effectsPath, run1, headers(CONTRIBUTOR, 'mcp-envelope-run-two'))
  assert.equal(failed.status, 200)
  assert.ok(failed.json.effects.some((effect: any) => effect.status === 'failed' && /peer error|tool error/i.test(effect.summary)),
    JSON.stringify(failed.json.effects))
  const uncertain = await callFresh('POST', effectsPath, run1, headers(CONTRIBUTOR, 'mcp-envelope-run-three'))
  assert.equal(uncertain.status, 200)
  assert.ok(uncertain.json.effects.some((effect: any) => effect.status === 'uncertain'))
  const uncertainReplay = await callFresh('POST', effectsPath, run1, headers(CONTRIBUTOR, 'mcp-envelope-run-three'))
  assert.equal(uncertainReplay.status, 200)
  assert.ok(uncertainReplay.json.effects.some((effect: any) => effect.status === 'uncertain'))
  assert.equal(calls, 3, 'known errors and uncertain results consume distinct confirmed calls; replay never dispatches again')

  const readerProjection = await callFresh('GET', `/projects/${projectId}/contributions`, undefined, headers(READER))
  const visible = readerProjection.json.find((row: any) => row.id === contributionId)
  assert.equal(visible.envelope.lines[0].mcp.connectionLabel, 'Contributor MCP')
  assert.equal(visible.effects.length, 3)
  const attention = store.attentionLedger(projectId, PROJECT_OWNER)
  assert.equal(attention.machineActs, 3, 'real receipts join the existing ledger without fabricated timeline events')
  assert.equal(attention.humanActs, 4, 'one envelope approval and three separate Run confirmations are four human acts')
  assert.doesNotMatch(JSON.stringify(visible), /mcp-connection-|schemaHash|endpoint|credentialReference|mcpAuthority/)
})
