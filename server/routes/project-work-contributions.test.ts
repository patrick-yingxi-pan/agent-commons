/** Project-work contributions bind one declared Contribution to one exact open
 * work item. Resolution requires the Project owner's human landing act and a
 * saved successful real MCP mutation for that item's exact target. */
import assert from 'node:assert/strict'
import { once } from 'node:events'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { test } from 'node:test'
import { store } from '../store/index.ts'
import { call, callFresh } from '../testkit/http.ts'
import { configureMcpRuntime, mcpRuntimeConfiguration } from '../mcpRuntime.ts'
import { MCP_SCHEMA_ADMISSION_VERSION, mcpToolSchemaHash } from '../mcpToolAdmission.ts'
import { MCP_MODERN_VERSION } from '../mcpProtocol.ts'

const OWNER = 'tenant-project-work-contribution-owner'
const WORKER = 'tenant-project-work-contribution-worker'
const READER = 'tenant-project-work-contribution-reader'
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

async function registerConnection(tenantId: string, endpoint: string, tool: Record<string, unknown>): Promise<string> {
  const id = `mcp-connection-${(++sequence).toString(16).padStart(32, '0')}`
  store.createMcpConnection({ id, label: 'Work completion peer', endpoint, authentication: 'none' }, tenantId, true)
  const schemaHash = mcpToolSchemaHash(tool as never)
  store.commitMcpInspection(id, tenantId, 0, {
    protocolVersion: MCP_MODERN_VERSION,
    cleanup: 'not-needed',
    tools: [tool as never],
    schemaAdmission: { version: MCP_SCHEMA_ADMISSION_VERSION, hashes: [schemaHash] },
  }, 1)
  return id
}

async function projectAndWork(type: 'mcp.mutate' | 'mcp.query' = 'mcp.mutate', target = 'write') {
  const projectId = `p-project-work-contribution-${++sequence}`
  store.applyRelationOp({ kind: 'create-project', projectId, projectName: 'Work completion', projectDescription: '' }, OWNER)
  store.applyRelationOp({ kind: 'share-project', projectId, projectName: 'Work completion', shared: true }, OWNER)
  const item = await call('POST', `/projects/${projectId}/open-subgoals`, {
    subGoal: `Reconcile order ${sequence}`, type, target, note: 'The exact requested result.',
  }, headers(OWNER))
  assert.equal(item.status, 200)
  return { projectId, item: item.json }
}

test('linked Contribution validates and freezes the exact visible open work item; keyed replay keeps its original link', async () => {
  const first = await projectAndWork()
  const second = await projectAndWork()
  const unsupported = await projectAndWork('mcp.query')

  const foreignProject = `p-project-work-private-${++sequence}`
  store.applyRelationOp({ kind: 'create-project', projectId: foreignProject, projectName: 'Private', projectDescription: '' }, OWNER)
  const privateItem = await call('POST', `/projects/${foreignProject}/open-subgoals`, {
    subGoal: 'Private task', type: 'mcp.mutate', target: 'write',
  }, headers(OWNER))
  assert.equal(privateItem.status, 200)

  const invalidId = await call('POST', `/projects/${first.projectId}/contributions`, {
    title: 'Unknown work', workItemId: 'work-no-such-item',
  }, headers(WORKER, 'work-contrib-unknown'))
  assert.equal(invalidId.status, 400, 'an unknown work link is invalid, not an unlinked contribution')

  const privateLink = await call('POST', `/projects/${first.projectId}/contributions`, {
    title: 'Cross-Project work', workItemId: second.item.id,
  }, headers(WORKER, 'work-contrib-private'))
  assert.equal(privateLink.status, 400, 'cross-Project links fail closed even when both Projects are visible')
  assert.equal((await call('GET', `/projects/${foreignProject}/open-subgoals`, undefined, headers(WORKER))).status, 404,
    'the ordinary Project visibility wall still hides private work')

  const unsupportedLink = await call('POST', `/projects/${unsupported.projectId}/contributions`, {
    title: 'Read-only work', workItemId: unsupported.item.id,
  }, headers(WORKER, 'work-contrib-query'))
  assert.equal(unsupportedLink.status, 400, 'only an explicit mcp.mutate work item may be linked')

  const key = `work-contrib-replay-${sequence}`
  const stale = await call('POST', `/projects/${first.projectId}/contributions`, {
    title: 'Stale source', workItemId: first.item.id,
  }, { ...headers(WORKER, 'work-contrib-stale-source'), 'x-account-transition-source': 'session:not-current' })
  assert.equal(stale.status, 409, 'a stale account source cannot create or replay a linked Contribution')

  const opened = await call('POST', `/projects/${first.projectId}/contributions`, {
    title: '  Resolve the work  ', workItemId: first.item.id,
  }, headers(WORKER, key))
  assert.equal(opened.status, 200)
  assert.equal(opened.json.title, 'Resolve the work')
  assert.equal(opened.json.workItemId, first.item.id)
  assert.equal(opened.json.subGoal, first.item.subGoal, "the linked item's frozen subGoal is server copied")
  assert.equal(opened.json.workItemResolution, 'needs-result')
  assert.equal(opened.json.contributorTenant, undefined)
  assert.doesNotMatch(JSON.stringify(opened.json), /postedByTenant|contributionResolution|mcpAuthority|endpoint|schemaHash/,
    'public linked references do not reveal private authority anchors')

  const replay = await callFresh('POST', `/projects/${first.projectId}/contributions`, {
    title: 'Changed retry body', workItemId: second.item.id,
  }, headers(WORKER, key))
  assert.equal(replay.status, 200)
  assert.equal(replay.json.id, opened.json.id, 'response-cache loss replays the durable contribution')
  assert.equal(replay.json.workItemId, first.item.id, 'changed retry input cannot redirect a durable work link')

  const closedItem = await call('POST', `/projects/${first.projectId}/open-subgoals/${first.item.id}/retract`, undefined, headers(OWNER))
  assert.equal(closedItem.status, 200)
  const closedLink = await call('POST', `/projects/${first.projectId}/contributions`, {
    title: 'Closed work', workItemId: first.item.id,
  }, headers(WORKER, 'work-contrib-closed'))
  assert.equal(closedLink.status, 409, 'a valid same-Project but closed work item has a distinct conflict')
  assert.equal((await call('POST', `/projects/${foreignProject}/contributions`, {
    title: 'Foreign project', workItemId: privateItem.json.id,
  }, headers(WORKER))).status, 404, 'a foreign private Project hides its work item before link validation')
})

test('explicit item-first MCP publication atomically returns a linked Contribution with one unapproved exact-call line', async (t) => {
  const oldProfile = process.env.DEPLOYMENT_PROFILE
  process.env.DEPLOYMENT_PROFILE = 'desktop'
  t.after(() => {
    if (oldProfile === undefined) delete process.env.DEPLOYMENT_PROFILE
    else process.env.DEPLOYMENT_PROFILE = oldProfile
  })
  const oldRuntime = mcpRuntimeConfiguration()
  configureMcpRuntime({ deviceBearerAvailable: false, allowLoopback: true })
  t.after(() => configureMcpRuntime({ ...oldRuntime }))
  const { projectId, item } = await projectAndWork('mcp.mutate', 'write')
  const tool = { name: 'write', inputSchema: {
    type: 'object', properties: { value: { type: 'string' } }, required: ['value'], additionalProperties: false,
  } }
  const connectionId = await registerConnection(WORKER, 'https://mcp.example.com/mcp', tool)
  const key = `work-initial-proposal-${sequence}`
  const request = {
    title: 'Reviewed item-first contribution', workItemId: item.id,
    initialMcpProposal: { connectionId, connectionRevision: 1, toolName: 'write', arguments: { value: 'reviewed value' } },
  }
  const opened = await call('POST', `/projects/${projectId}/contributions`, request, headers(WORKER, key))
  assert.equal(opened.status, 200, JSON.stringify(opened.json))
  assert.equal(opened.json.workItemId, item.id)
  assert.equal(opened.json.envelope.version, 1)
  assert.equal(opened.json.envelope.status, 'proposed')
  assert.equal(opened.json.envelope.lines.length, 1)
  assert.deepEqual({
    type: opened.json.envelope.lines[0].type,
    target: opened.json.envelope.lines[0].target,
    cardinality: opened.json.envelope.lines[0].cardinality,
    harness: opened.json.envelope.lines[0].harness,
    used: opened.json.envelope.lines[0].used,
    mcp: opened.json.envelope.lines[0].mcp,
  }, {
    type: 'mcp.mutate', target: 'write', cardinality: 1, harness: 'explicit-call', used: 0,
    mcp: { connectionLabel: 'Work completion peer', toolName: 'write', arguments: { value: 'reviewed value' } },
  })
  assert.equal((opened.json.effects ?? []).length, 0)
  assert.equal(opened.json.events.filter((event: any) => event.kind === 'envelope-approved').length, 0)

  const replay = await callFresh('POST', `/projects/${projectId}/contributions`, {
    title: 'Changed retry', workItemId: 'different-item',
    initialMcpProposal: { connectionId: 'mcp-connection-not-real', connectionRevision: 1, toolName: 'wrong', arguments: {} },
  }, headers(WORKER, key))
  assert.equal(replay.status, 200)
  assert.equal(replay.json.id, opened.json.id)
  assert.equal(replay.json.envelope.lines[0].mcp.arguments.value, 'reviewed value',
    'keyed replay returns the represented creation without re-resolving the connection or changed body')
})

test('item-first publication refuses malformed or stale selections without leaving an empty linked row', async (t) => {
  const oldProfile = process.env.DEPLOYMENT_PROFILE
  process.env.DEPLOYMENT_PROFILE = 'desktop'
  t.after(() => {
    if (oldProfile === undefined) delete process.env.DEPLOYMENT_PROFILE
    else process.env.DEPLOYMENT_PROFILE = oldProfile
  })
  const oldRuntime = mcpRuntimeConfiguration()
  configureMcpRuntime({ deviceBearerAvailable: false, allowLoopback: true })
  t.after(() => configureMcpRuntime({ ...oldRuntime }))
  const { projectId, item } = await projectAndWork('mcp.mutate', 'write')
  const tool = { name: 'write', inputSchema: {
    type: 'object', properties: { value: { type: 'string' } }, required: ['value'], additionalProperties: false,
  } }
  const connectionId = await registerConnection(WORKER, 'https://mcp.example.com/mcp', tool)
  const path = `/projects/${projectId}/contributions`
  const base = { title: 'Must refuse safely', workItemId: item.id }
  const attempts = [
    { initialMcpProposal: { connectionId, connectionRevision: 0, toolName: 'write', arguments: { value: 'stale' } } },
    { initialMcpProposal: { connectionId, connectionRevision: 1, toolName: 'another-tool', arguments: { value: 'wrong target' } } },
    { initialMcpProposal: { connectionId, connectionRevision: 1, toolName: 'write', arguments: { extra: true } } },
    { initialMcpProposal: { connectionId, connectionRevision: 1, toolName: 'write', arguments: { value: 'valid', extra: true } } },
  ]
  for (const [index, proposal] of attempts.entries()) {
    const refused = await call('POST', path, { ...base, ...proposal }, headers(WORKER, `work-initial-invalid-${sequence}-${index}`))
    assert.equal(refused.status, 400, JSON.stringify(refused.json))
  }
  const missingItem = await call('POST', path, {
    title: 'Must be linked', initialMcpProposal: { connectionId, connectionRevision: 1, toolName: 'write', arguments: { value: 'valid' } },
  }, headers(WORKER, `work-initial-unlinked-${sequence}`))
  assert.equal(missingItem.status, 400)
  const unkeyed = await call('POST', path, {
    ...base, initialMcpProposal: { connectionId, connectionRevision: 1, toolName: 'write', arguments: { value: 'valid' } },
  }, headers(WORKER))
  assert.equal(unkeyed.status, 400, 'publication cannot enter the unkeyed best-effort creation path')
  const rows = await call('GET', path, undefined, headers(OWNER))
  assert.equal(rows.status, 200)
  assert.equal(rows.json.length, 0, 'refused proposals leave neither empty Contributions nor partial envelopes')
})

test('work closing during asynchronous item-first preparation wins before the atomic publish', async (t) => {
  const oldProfile = process.env.DEPLOYMENT_PROFILE
  process.env.DEPLOYMENT_PROFILE = 'desktop'
  t.after(() => {
    if (oldProfile === undefined) delete process.env.DEPLOYMENT_PROFILE
    else process.env.DEPLOYMENT_PROFILE = oldProfile
  })
  const oldRuntime = mcpRuntimeConfiguration()
  configureMcpRuntime({ deviceBearerAvailable: false, allowLoopback: true })
  t.after(() => configureMcpRuntime({ ...oldRuntime }))
  const { projectId, item } = await projectAndWork('mcp.mutate', 'write')
  const tool = { name: 'write', inputSchema: {
    type: 'object', properties: { value: { type: 'string' } }, required: ['value'], additionalProperties: false,
  } }
  const connectionId = await registerConnection(WORKER, 'https://mcp.example.com/mcp', tool)
  const logicalId = `contrib-${sequence}-closed-during-prepare`
  const publishing = store.openContributionWithInitialMcpProposal(projectId, {
    title: 'Close wins', workItemId: item.id,
    initialMcpProposal: { connectionId, connectionRevision: 1, toolName: 'write', arguments: { value: 'draft' } },
  }, WORKER, { kind: 'user', id: `user-${WORKER}` }, { logicalId, actorUserId: `user-${WORKER}` })
  const retracted = store.retractOpenSubGoal(projectId, item.id, OWNER, undefined)
  assert.equal(typeof retracted, 'object', 'the item is synchronously retracted while local schema admission yields')
  assert.equal(await publishing, 'closed-work')
  const rows = store.listContributions(projectId, OWNER)
  assert.equal(rows.some((row) => row.id === logicalId), false, 'the atomic commit does not publish an orphan linked row')
})

test('concurrent same-key item-first publication converges on one exact v1 proposal', async (t) => {
  const oldProfile = process.env.DEPLOYMENT_PROFILE
  process.env.DEPLOYMENT_PROFILE = 'desktop'
  t.after(() => {
    if (oldProfile === undefined) delete process.env.DEPLOYMENT_PROFILE
    else process.env.DEPLOYMENT_PROFILE = oldProfile
  })
  const oldRuntime = mcpRuntimeConfiguration()
  configureMcpRuntime({ deviceBearerAvailable: false, allowLoopback: true })
  t.after(() => configureMcpRuntime({ ...oldRuntime }))
  const { projectId, item } = await projectAndWork('mcp.mutate', 'write')
  const tool = { name: 'write', inputSchema: {
    type: 'object', properties: { value: { type: 'string' } }, required: ['value'], additionalProperties: false,
  } }
  const connectionId = await registerConnection(WORKER, 'https://mcp.example.com/mcp', tool)
  const logicalId = `contrib-${sequence}-concurrent-item-first`
  const request = { title: 'Concurrent publish', workItemId: item.id,
    initialMcpProposal: { connectionId, connectionRevision: 1, toolName: 'write', arguments: { value: 'once' } } }
  const principal = { kind: 'user' as const, id: `user-${WORKER}` }
  let sourceChecks = 0
  const current = () => {
    sourceChecks += 1
    if (sourceChecks === 2) {
      const closed = store.retractOpenSubGoal(projectId, item.id, OWNER, undefined)
      assert.equal(typeof closed, 'object', 'the first keyed create has committed before the second settles')
      store.disconnectMcpConnection(connectionId, WORKER, 1)
    }
    return true
  }
  const results = await Promise.all([
    store.openContributionWithInitialMcpProposal(projectId, request, WORKER, principal,
      { logicalId, actorUserId: principal.id, isCurrent: current }),
    store.openContributionWithInitialMcpProposal(projectId, request, WORKER, principal,
      { logicalId, actorUserId: principal.id, isCurrent: current }),
  ])
  assert.ok(results.every((result) => typeof result === 'object'))
  assert.equal(results[0].id, results[1].id)
  assert.equal(results[0].id, logicalId)
  assert.equal(results[0].envelope?.version, 1)
  assert.equal(results[0].envelope?.status, 'proposed')
  assert.equal(results[0].envelope?.lines.length, 1)
  assert.equal(sourceChecks, 2)
  assert.equal(store.listOpenSubGoals(projectId, OWNER).find((row) => row.id === item.id)?.status, 'retracted')
  assert.equal(store.listContributions(projectId, OWNER).filter((row) => row.id === logicalId).length, 1)
})

test('post-await account/project source fence refuses before publishing', async (t) => {
  const oldProfile = process.env.DEPLOYMENT_PROFILE
  process.env.DEPLOYMENT_PROFILE = 'desktop'
  t.after(() => {
    if (oldProfile === undefined) delete process.env.DEPLOYMENT_PROFILE
    else process.env.DEPLOYMENT_PROFILE = oldProfile
  })
  const oldRuntime = mcpRuntimeConfiguration()
  configureMcpRuntime({ deviceBearerAvailable: false, allowLoopback: true })
  t.after(() => configureMcpRuntime({ ...oldRuntime }))
  const { projectId, item } = await projectAndWork('mcp.mutate', 'write')
  const tool = { name: 'write', inputSchema: {
    type: 'object', properties: { value: { type: 'string' } }, required: ['value'], additionalProperties: false,
  } }
  const connectionId = await registerConnection(WORKER, 'https://mcp.example.com/mcp', tool)
  const logicalId = `contrib-${sequence}-post-await-fence`
  const result = await store.openContributionWithInitialMcpProposal(projectId, {
    title: 'Must fail the final source fence', workItemId: item.id,
    initialMcpProposal: { connectionId, connectionRevision: 1, toolName: 'write', arguments: { value: 'draft' } },
  }, WORKER, { kind: 'user', id: `user-${WORKER}` }, {
    logicalId, actorUserId: `user-${WORKER}`, isCurrent: () => false,
  })
  assert.equal(result, 'conflict')
  assert.equal(store.listContributions(projectId, OWNER).some((row) => row.id === logicalId), false)
})

test('only the Project owner can resolve linked work after a tool error and pending receipt are followed by a successful exact-target Run', async (t) => {
  const oldProfile = process.env.DEPLOYMENT_PROFILE
  process.env.DEPLOYMENT_PROFILE = 'desktop'
  t.after(() => {
    if (oldProfile === undefined) delete process.env.DEPLOYMENT_PROFILE
    else process.env.DEPLOYMENT_PROFILE = oldProfile
  })
  const oldRuntime = mcpRuntimeConfiguration()
  configureMcpRuntime({ deviceBearerAvailable: false, allowLoopback: true })
  t.after(() => configureMcpRuntime({ ...oldRuntime }))

  let callCount = 0
  let releaseFirst!: () => void
  let announceFirst!: () => void
  const firstHold = new Promise<void>((resolve) => { releaseFirst = resolve })
  const firstReached = new Promise<void>((resolve) => { announceFirst = resolve })
  const peer = createServer((req, res) => {
    void (async () => {
      const body = await readBody(req)
      if (body.method === 'server/discover') {
        return send(res, body.id, {
          resultType: 'complete', supportedVersions: [MCP_MODERN_VERSION], capabilities: { tools: {} },
          _meta: { 'io.modelcontextprotocol/serverInfo': { name: 'project-work-peer', version: '1' } },
        })
      }
      assert.equal(body.method, 'tools/call')
      assert.equal(body.params.name, 'write')
      callCount += 1
      if (callCount === 1) {
        return send(res, body.id, { resultType: 'complete', content: [{ type: 'text', text: 'peer tool error' }], isError: true })
      }
      if (callCount === 2) {
        return send(res, body.id, { resultType: 'complete', content: [{ type: 'text', text: 'later success cannot erase error history' }], isError: false })
      }
      if (callCount === 3) {
        announceFirst()
        await firstHold
        return send(res, body.id, { resultType: 'complete', content: [{ type: 'text', text: 'completed exact work' }], isError: false })
      }
      return send(res, body.id, { resultType: 'unsupported' })
    })().catch(() => res.destroy())
  })
  peer.listen(0, '127.0.0.1')
  await once(peer, 'listening')
  t.after(async () => {
    releaseFirst()
    peer.closeAllConnections()
    await new Promise<void>((resolve) => peer.close(() => resolve()))
  })
  const address = peer.address()
  assert.ok(address && typeof address === 'object')
  const tool = { name: 'write', inputSchema: {
    type: 'object', properties: { value: { type: 'string' } }, required: ['value'], additionalProperties: false,
  } }
  const connectionId = await registerConnection(WORKER, `http://127.0.0.1:${address.port}/mcp`, tool)

  const selection = { connectionId, connectionRevision: 1, toolName: 'write', arguments: { value: 'exact-item-result' } }
  const prepare = async (projectId: string, item: any, label: string) => {
    const opened = await call('POST', `/projects/${projectId}/contributions`, {
      title: 'Complete the exact write', workItemId: item.id,
    }, headers(WORKER))
    assert.equal(opened.status, 200)
    const contributionPath = `/projects/${projectId}/contributions/${opened.json.id}`
    const proposal = await call('POST', `${contributionPath}/envelope`, {
      expectedVersion: 0, lines: [{ type: 'mcp.mutate', target: 'write', cardinality: 3,
        harness: 'explicit-call', note: 'One call per explicit approval.', mcp: selection }],
    }, headers(WORKER, `${label}-envelope`))
    assert.equal(proposal.status, 200)
    const lineId = proposal.json.envelope.lines[0].id
    const approval = await call('POST', `${contributionPath}/envelope/approve`, { expectedVersion: 1 }, headers(OWNER, `${label}-approval`))
    assert.equal(approval.status, 200)
    return { opened: opened.json, contributionPath, lineId }
  }

  const errorWork = await projectAndWork()
  const errorContribution = await prepare(errorWork.projectId, errorWork.item, 'work-result-tool-error')
  const errorRun = await call('POST', `${errorContribution.contributionPath}/effects`,
    { lineId: errorContribution.lineId, expectedVersion: 1 }, headers(WORKER, 'work-result-run-tool-error'))
  assert.equal(errorRun.status, 200)
  assert.equal(errorRun.json.effects.at(-1).status, 'failed')
  assert.ok(errorRun.json.effects.at(-1).result?.isError)
  const toolErrorLand = await call('POST', `${errorContribution.contributionPath}/land`, undefined,
    headers(OWNER, 'work-result-tool-error-land'))
  assert.equal(toolErrorLand.status, 409, 'a returned tool error may have partially applied and cannot resolve work')
  const successAfterError = await call('POST', `${errorContribution.contributionPath}/effects`,
    { lineId: errorContribution.lineId, expectedVersion: 1 }, headers(WORKER, 'work-result-after-error'))
  assert.equal(successAfterError.status, 200)
  assert.equal(successAfterError.json.effects.at(-1).status, 'done')
  assert.equal((await call('POST', `${errorContribution.contributionPath}/land`, undefined,
    headers(OWNER, 'work-result-error-history-land'))).status, 409,
  'a later success does not erase the earlier returned-tool-error uncertainty')

  const { projectId, item } = await projectAndWork()
  const prepared = await prepare(projectId, item, 'work-result-success')
  const { opened, contributionPath, lineId } = prepared
  const cid = opened.id

  const selfLand = await call('POST', `${contributionPath}/land`, undefined, headers(WORKER))
  assert.equal(selfLand.status, 403, 'the contributor cannot self-resolve linked work, even with a trusted tier')
  const foreignLand = await call('POST', `${contributionPath}/land`, undefined, headers(READER))
  assert.equal(foreignLand.status, 403, 'a shared reader can see but cannot land the linked Contribution')
  const emptyLand = await call('POST', `${contributionPath}/land`, undefined, headers(OWNER, 'work-result-empty-land'))
  assert.equal(emptyLand.status, 409, 'an owner cannot resolve linked work without a successful saved MCP result')

  const runPath = `${contributionPath}/effects`
  const firstRun = call('POST', runPath, { lineId, expectedVersion: 1 }, headers(WORKER, 'work-result-run-pending'))
  assert.equal(await Promise.race([firstReached.then(() => 'peer'), firstRun]), 'peer', 'first approved Run reaches only the local peer')

  const pending = await call('POST', `${contributionPath}/land`, undefined, headers(OWNER, 'work-result-pending-land'))
  assert.equal(pending.status, 409, 'a pending external attempt cannot resolve the work')
  assert.equal(store.listOpenSubGoals(projectId, OWNER).find((row) => row.id === item.id)?.status, 'open')

  releaseFirst()
  const completed = await firstRun
  assert.equal(completed.status, 200)
  assert.equal(completed.json.effects[0].status, 'done')
  const landed = await callFresh('POST', `${contributionPath}/land`, undefined, headers(OWNER, 'work-result-land'))
  assert.equal(landed.status, 200)
  assert.equal(landed.json.status, 'landed')
  assert.equal(landed.json.workItemResolution, 'closed')
  assert.equal(landed.json.workItemId, item.id)
  assert.equal(landed.json.landingNumber, 1)
  const resolved = store.listOpenSubGoals(projectId, OWNER).find((row) => row.id === item.id)
  assert.equal(resolved?.status, 'done')
  assert.equal(resolved?.contributionResolution?.contributionId, cid)
  assert.equal(resolved?.contributionResolution?.effectId, completed.json.effects[0].id)
  assert.equal(resolved?.contributionResolution?.by, OWNER)
  assert.equal(resolved?.resolvedBy, undefined, 'this is a human Contribution resolution, not agent credit')

  const uncertainWork = await projectAndWork()
  const uncertainContribution = await prepare(uncertainWork.projectId, uncertainWork.item, 'work-result-uncertain')
  const uncertain = await call('POST', `${uncertainContribution.contributionPath}/effects`,
    { lineId: uncertainContribution.lineId, expectedVersion: 1 }, headers(WORKER, 'work-result-uncertain-run'))
  assert.equal(uncertain.status, 200)
  assert.equal(uncertain.json.effects.at(-1).status, 'uncertain')
  assert.equal((await call('POST', `${uncertainContribution.contributionPath}/land`, undefined,
    headers(OWNER, 'work-result-uncertain-land'))).status, 409,
  'an uncertain post-submission receipt blocks linked resolution')
  assert.equal(callCount, 4, 'each separately confirmed Run reaches the local peer once')
})

test('retracting linked work during MCP discovery blocks the not-yet-submitted tools/call and preserves a replay-only receipt', { timeout: 15_000 }, async (t) => {
  const oldProfile = process.env.DEPLOYMENT_PROFILE
  process.env.DEPLOYMENT_PROFILE = 'desktop'
  t.after(() => {
    if (oldProfile === undefined) delete process.env.DEPLOYMENT_PROFILE
    else process.env.DEPLOYMENT_PROFILE = oldProfile
  })
  const oldRuntime = mcpRuntimeConfiguration()
  configureMcpRuntime({ deviceBearerAvailable: false, allowLoopback: true })
  t.after(() => configureMcpRuntime({ ...oldRuntime }))

  let toolsCalls = 0
  let releaseDiscovery!: () => void
  let announceDiscovery!: () => void
  const discoveryHold = new Promise<void>((resolve) => { releaseDiscovery = resolve })
  const discoveryReached = new Promise<void>((resolve) => { announceDiscovery = resolve })
  const tool = { name: 'write', inputSchema: {
    type: 'object', properties: { value: { type: 'string' } }, required: ['value'], additionalProperties: false,
  } }
  const peer = createServer((req, res) => {
    void (async () => {
      const body = await readBody(req)
      if (body.method === 'server/discover') {
        announceDiscovery()
        await discoveryHold
        return send(res, body.id, {
          resultType: 'complete', supportedVersions: [MCP_MODERN_VERSION], capabilities: { tools: {} },
          _meta: { 'io.modelcontextprotocol/serverInfo': { name: 'linked-work-retraction-peer', version: '1' } },
        })
      }
      if (body.method === 'tools/list') return send(res, body.id, { resultType: 'complete', tools: [tool] })
      if (body.method === 'initialize') return send(res, body.id, {
        protocolVersion: MCP_MODERN_VERSION, capabilities: { tools: {} }, serverInfo: { name: 'linked-work-retraction-peer', version: '1' },
      })
      if (body.method === 'notifications/initialized') {
        res.writeHead(202)
        return res.end()
      }
      if (body.method === 'tools/call') {
        toolsCalls += 1
        return send(res, body.id, { resultType: 'complete', content: [{ type: 'text', text: 'Should not execute.' }], isError: false })
      }
      res.writeHead(400)
      res.end()
    })().catch(() => res.destroy())
  })
  peer.listen(0, '127.0.0.1')
  await once(peer, 'listening')
  t.after(async () => {
    releaseDiscovery()
    peer.closeAllConnections()
    await new Promise<void>((resolve) => peer.close(() => resolve()))
  })
  const address = peer.address()
  assert.ok(address && typeof address === 'object')
  const connectionId = await registerConnection(WORKER, `http://127.0.0.1:${address.port}/mcp`, tool)
  const { projectId, item } = await projectAndWork()
  const opened = await call('POST', `/projects/${projectId}/contributions`, {
    title: 'Complete work before it is retracted', workItemId: item.id,
  }, headers(WORKER, 'work-retract-before-call-open'))
  assert.equal(opened.status, 200)
  const contributionPath = `/projects/${projectId}/contributions/${opened.json.id}`
  const selection = { connectionId, connectionRevision: 1, toolName: 'write', arguments: { value: 'hold-before-submit' } }
  const proposal = await call('POST', `${contributionPath}/envelope`, {
    expectedVersion: 0,
    lines: [{ type: 'mcp.mutate', target: 'write', cardinality: 1, harness: 'explicit-call', note: 'Exact item target.', mcp: selection }],
  }, headers(WORKER, 'work-retract-before-call-envelope'))
  assert.equal(proposal.status, 200)
  const lineId = proposal.json.envelope.lines[0].id
  const approval = await call('POST', `${contributionPath}/envelope/approve`, { expectedVersion: 1 },
    headers(OWNER, 'work-retract-before-call-approval'))
  assert.equal(approval.status, 200)

  const runKey = 'work-retract-before-call-run'
  const runBody = { lineId, expectedVersion: 1 }
  const runPromise = call('POST', `${contributionPath}/effects`, runBody, headers(WORKER, runKey))
  await discoveryReached
  const pending = store.listContributions(projectId, WORKER).find((row) => row.id === opened.json.id)
  assert.equal(pending?.effects.at(-1)?.status, 'pending', 'the durable attempt is reserved before external discovery')

  const retracted = await call('POST', `/projects/${projectId}/open-subgoals/${item.id}/retract`, undefined,
    headers(OWNER, 'work-retract-before-call-item'))
  assert.equal(retracted.status, 200)
  assert.equal(retracted.json.status, 'retracted')
  releaseDiscovery()

  const completed = await runPromise
  assert.equal(completed.status, 200)
  assert.equal(completed.json.effects.at(-1).status, 'failed', 'retraction before tools/call is a known non-submission')
  assert.equal(completed.json.effects.at(-1).result, undefined)
  assert.equal(toolsCalls, 0, 'the peer receives no external mutation after work was retracted')
  assert.equal(store.listOpenSubGoals(projectId, OWNER).find((row) => row.id === item.id)?.status, 'retracted')
  assert.equal(store.listContributions(projectId, OWNER).find((row) => row.id === opened.json.id)?.status, 'open')
  const refusedLand = await call('POST', `${contributionPath}/land`, undefined, headers(OWNER, 'work-retract-before-call-land'))
  assert.equal(refusedLand.status, 409, 'a retracted item cannot be resolved by landing its linked Contribution')

  const replay = await callFresh('POST', `${contributionPath}/effects`, runBody, headers(WORKER, runKey))
  assert.equal(replay.status, 200)
  assert.equal(replay.json.effects.at(-1).status, 'failed', 'same-key retry only reads the pre-submit receipt')
  assert.equal(toolsCalls, 0, 'same-key receipt replay never reaches the peer')
  const newKey = await callFresh('POST', `${contributionPath}/effects`, runBody, headers(WORKER, 'work-retract-before-call-new-key'))
  assert.equal(newKey.status, 409, 'a new Run is refused after retraction rather than reusing the old key')
  assert.equal(toolsCalls, 0, 'a new-key refusal also has no external mutation')
})
