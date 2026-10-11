/** A cached mutation receipt is not cached Project visibility or MCP authority. */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { store } from '../store/index.ts'
import { call } from '../testkit/http.ts'
import { MCP_MODERN_VERSION } from '../mcpProtocol.ts'
import { MCP_SCHEMA_ADMISSION_VERSION, mcpToolSchemaHash } from '../mcpToolAdmission.ts'

let sequence = 0

async function account(label: string) {
  const tag = `${label}-${++sequence}`
  const response = await call('POST', '/auth/signup', {
    name: label, email: `${tag}@contribution-projection.example`, password: `${tag}-password`,
  })
  assert.equal(response.status, 200, JSON.stringify(response.json))
  return { userId: response.json.user.id as string, tenantId: response.json.tenant.id as string,
    headers: { cookie: response.headers['set-cookie'].split(';')[0],
      'x-account-transition-source': `session:${response.json.user.id}` } }
}

async function fixture(operation: 'create' | 'changeset') {
  const owner = await account('project-owner')
  const contributor = await account('oauth-contributor')
  const projectId = `projection-project-${++sequence}`
  const projectName = 'Projection fixture'
  store.applyRelationOp({ kind: 'create-project', projectId, projectName, projectDescription: '' }, owner.tenantId)
  store.applyRelationOp({ kind: 'share-project', projectId, projectName, shared: true }, owner.tenantId)
  const createPath = `/projects/${projectId}/contributions`
  const createBody = { title: 'OAuth projection work' }
  const createHeaders = { ...contributor.headers, 'idempotency-key': `create-${sequence}` }
  const opened = await call('POST', createPath, createBody, createHeaders)
  assert.equal(opened.status, 200, JSON.stringify(opened.json))
  const contributionPath = `${createPath}/${opened.json.id}`
  const connectionId = `mcp-connection-${(++sequence).toString(16).padStart(32, '0')}`
  const tool = { name: 'write', inputSchema: { type: 'object', properties: {}, additionalProperties: false } }
  store.createMcpConnection({ id: connectionId, label: 'Personal MCP', endpoint: 'https://8.8.8.8/mcp',
    authentication: 'device-oauth' }, contributor.tenantId, false, contributor.userId)
  store.commitMcpInspection(connectionId, contributor.tenantId, 0, {
    protocolVersion: MCP_MODERN_VERSION, cleanup: 'not-needed', tools: [tool],
    schemaAdmission: { version: MCP_SCHEMA_ADMISSION_VERSION, hashes: [mcpToolSchemaHash(tool)] },
  }, Date.now(), `MCP_DESKTOP_${sequence.toString(16).toUpperCase().padStart(32, '0')}`, undefined, contributor.userId)
  const proposed = await call('POST', `${contributionPath}/envelope`, {
    expectedVersion: 0, lines: [{ type: 'mcp.mutate', target: 'write', cardinality: 1, harness: 'explicit-call', note: '',
      mcp: { connectionId, connectionRevision: 1, toolName: 'write', arguments: {} } }],
  }, { ...contributor.headers, 'idempotency-key': `proposal-${sequence}` })
  assert.equal(proposed.status, 200, JSON.stringify(proposed.json))
  const approved = await call('POST', `${contributionPath}/envelope/approve`, { expectedVersion: 1 }, {
    ...owner.headers, 'idempotency-key': `approval-${sequence}`,
  })
  assert.equal(approved.status, 200, JSON.stringify(approved.json))
  const changesetBody = { entries: [{ kind: 'note', target: 'review', after: 'Reviewed work' }] }
  const changesetHeaders = { ...contributor.headers, 'idempotency-key': `changeset-${sequence}` }
  const changeset = await call('POST', `${contributionPath}/changeset`, changesetBody, changesetHeaders)
  assert.equal(changeset.status, 200, JSON.stringify(changeset.json))
  assert.equal(changeset.json.envelope.lines[0].mcp.canRun, true)
  const path = operation === 'create' ? createPath : `${contributionPath}/changeset`
  const body = operation === 'create' ? createBody : changesetBody
  const headers = operation === 'create' ? createHeaders : changesetHeaders
  return { owner, contributor, projectId, projectName, connectionId, contributionId: opened.json.id,
    replay: () => call('POST', path, body, headers) }
}

for (const operation of ['create', 'changeset'] as const) {
  test(`${operation}: cached Contribution acknowledgement reprojects current OAuth Run authority`, async () => {
    const prepared = await fixture(operation)
    const before = await prepared.replay()
    assert.equal(before.status, 200, JSON.stringify(before.json))
    assert.equal(before.json.envelope?.lines[0].mcp.canRun, true,
      'a replay returns the current approved envelope, not the original response body')
    store.disconnectMcpConnection(prepared.connectionId, prepared.contributor.tenantId, 1, prepared.contributor.userId)
    const after = await prepared.replay()
    assert.equal(after.status, 200, JSON.stringify(after.json))
    assert.equal(after.headers['idempotency-replayed'], 'true', 'the current projection still acknowledges the existing receipt')
    assert.equal(after.json.envelope.lines[0].mcp.canRun, undefined,
      'disconnect invalidates the Run projection even when its mutation receipt is cached')
    assert.equal(after.json.id, prepared.contributionId)
    assert.equal(after.json.changeset.length, 1, 'projection replay cannot repeat the mutation')
    assert.doesNotMatch(JSON.stringify(after.json), /ownerUserId|mcpAuthority|credentialReference/)
  })

  test(`${operation}: cached Contribution acknowledgement obeys lost Project visibility`, async () => {
    const prepared = await fixture(operation)
    store.applyRelationOp({ kind: 'share-project', projectId: prepared.projectId,
      projectName: prepared.projectName, shared: false }, prepared.owner.tenantId)
    const current = await call('GET', `/projects/${prepared.projectId}/contributions`, undefined, prepared.contributor.headers)
    assert.equal(current.status, 404, 'the contributor lost Project visibility before replay')
    const replay = await prepared.replay()
    assert.equal(replay.status, 404, 'the cached acknowledgement cannot retain access to the hidden ledger')
    assert.equal(replay.json.envelope, undefined)
  })
}
