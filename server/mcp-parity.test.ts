/** ── Access-parity (INV-11): the MCP door equals the other doors ─────────────
 *  The rule: all access interfaces to this product — the browser UI (a client
 *  of the HTTP API), the in-app session (model tool-calls landing behind the
 *  same consent-gated routes), and the MCP door — may differ in FORM but never
 *  in capability or in the authentication/authorization policy that gates
 *  them. This suite locks the two halves that make the rule structural:
 *   1. CAPABILITY — the tool catalog is exactly the route-owned remote
 *      projection (every product operation plus declared remote auth forms;
 *      names are unique);
 *   2. POLICY — the same request through either door meets the same wall:
 *      the auth gate's 401s, the front door's openness, the bearer credential
 *      minted by the same login, and the tenancy 404s all answer identically. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { call } from './testkit/http.ts'
import { buildRouter } from './routes/index.ts'
import { catalogOf } from './apiSurface.ts'
import { mcpToolRoutes, toolNameFor } from './mcp.ts'

let seq = 0
const rpc = async (method: string, params?: unknown, headers?: Record<string, string>) =>
  await call('POST', '/mcp', { jsonrpc: '2.0', id: ++seq, method, ...(params === undefined ? {} : { params }) }, headers)
const toolCall = async (name: string, args?: Record<string, unknown>, headers?: Record<string, string>) => {
  const r = await rpc('tools/call', { name, arguments: args ?? {} }, headers)
  const result = r.json.result
  return { isError: result.isError === true, ...(JSON.parse(result.content[0].text) as { status: number; body: any }) }
}

const gated = async <T>(fn: () => Promise<T>): Promise<T> => {
  process.env.AUTH_GATE = 'require'
  try {
    return await fn()
  } finally {
    delete process.env.AUTH_GATE
  }
}

test('CAPABILITY: the tool catalog is a bijection with the route table', async () => {
  const router = buildRouter()
  const expected = mcpToolRoutes(router)
  // Every authenticated product operation plus the explicitly remote-MCP
  // authentication bootstrap is generated; form-only routes stay out because
  // the classification lives on the route itself, not in an exclusion list.
  const { json } = await rpc('tools/list')
  const toolNames = new Set<string>(json.result.tools.map((t: any) => t.name))
  assert.equal(toolNames.size, json.result.tools.length, 'tool names are unique')
  assert.equal(json.result.tools.length, expected.length, 'tool count = the route-owned remote projection, exactly')
  for (const r of expected) {
    assert.ok(toolNames.has(toolNameFor(r.method, r.pattern)), `route ${r.method} ${r.pattern} is reachable as a tool`)
  }
})

test('POLICY: the auth gate walls both doors identically, and the front door opens both', async () => {
  await gated(async () => {
    const direct = await call('GET', '/sessions')
    assert.equal(direct.status, 401)
    const viaMcp = await toolCall('get_sessions')
    assert.equal(viaMcp.isError, true)
    assert.equal(viaMcp.status, 401, 'the SAME wall answers the MCP door')
    assert.deepEqual(viaMcp.body, direct.json, 'same error envelope, byte for byte')

    const front = await toolCall('get_capabilities')
    assert.equal(front.status, 200, 'the front door is as open over MCP as over HTTP')
    const me = await toolCall('get_me')
    assert.equal(me.body.user.id, 'user-anonymous', 'and it names NOBODY pre-sign-in, exactly like the browser')
  })
})

test('POLICY: the same login mints the same credential through either door', async () => {
  await gated(async () => {
    // Sign in THROUGH the MCP door (the same front-door route, as a tool).
    const login = await toolCall('post_auth_login', {
      body: { email: 'ada@acme.example', password: 'ada-demo-password', transport: 'bearer' },
    })
    assert.equal(login.status, 200)
    const token = login.body.token
    assert.ok(token, 'the login tool mints the same bearer credential the HTTP route does')
    const auth = { authorization: `Bearer ${token}` }
    const viaMcp = await toolCall('get_sessions', undefined, auth)
    assert.equal(viaMcp.status, 200, 'the minted credential opens the wall over MCP')
    const direct = await call('GET', '/sessions', undefined, auth)
    assert.deepEqual(viaMcp.body, direct.json, 'both doors serve the identical signed-in world')
  })
})

test('POLICY: tenancy answers identically — a foreign read 404s through both doors', async () => {
  // Create a session as the default tenant, then read it as another tenant
  // through both doors: existence-hiding 404 either way.
  const created = await call('POST', '/sessions', { firstMessage: 'tenant wall probe' })
  const id = created.json.id
  const foreign = { 'x-user-id': 'user-grace', 'x-tenant-id': 'tenant-beta' }
  const direct = await call('GET', `/sessions/${id}`, undefined, foreign)
  assert.equal(direct.status, 404)
  const viaMcp = await toolCall('get_sessions_by_id', { id }, foreign)
  assert.equal(viaMcp.status, 404, 'the dev identity seam forwards through the MCP door and meets the same wall')
  assert.deepEqual(viaMcp.body, direct.json)
})

test('POLICY: authored artifact listing has identical HTTP and remote-MCP tenancy/grant projections', async () => {
  const stamp = Date.now().toString(36)
  const owner = 'tenant-personal'
  const audience = 'tenant-beta'
  const name = `mcp-listed-${stamp}.md`
  const saved = await call('POST', '/relations/ops', {
    op: {
      kind: 'save-artifact',
      artifact: { name, kind: 'doc', meta: 'Document', body: 'A strict authored body for list parity.' },
      projectId: 'p-insights',
      projectName: 'Insights dashboard',
    },
  }, { 'x-tenant-id': owner, 'idempotency-key': `mcp-listed-${stamp}` })
  assert.equal(saved.status, 200)
  const created = saved.json.extraArtifacts.find((artifact: { name: string }) => artifact.name === name)
  assert.ok(created, 'the strict authored save returned its graph row')

  const beforeDirect = await call('GET', '/artifacts', undefined, { 'x-tenant-id': audience })
  const beforeMcp = await toolCall('get_artifacts', undefined, { 'x-tenant-id': audience })
  assert.equal(beforeDirect.status, 200)
  assert.equal(beforeMcp.status, 200)
  assert.equal((beforeDirect.json as { id: string }[]).some((artifact) => artifact.id === created.id), false, 'an ungranted foreign artifact stays hidden over HTTP')
  assert.equal((beforeMcp.body as { id: string }[]).some((artifact) => artifact.id === created.id), false, 'an ungranted foreign artifact stays hidden over MCP')

  const grant = await call('POST', '/grants', {
    subject: { kind: 'artifact', id: created.id },
    audience: { kind: 'org', orgId: audience },
    tier: 'view',
  }, { 'x-tenant-id': owner })
  assert.equal(grant.status, 200)

  const grantedDirect = await call('GET', '/artifacts', undefined, { 'x-tenant-id': audience })
  const grantedMcp = await toolCall('get_artifacts', undefined, { 'x-tenant-id': audience })
  type ArtifactRow = { id: string; own?: boolean; tenantId?: string; projectId?: string }
  const directRow = (grantedDirect.json as ArtifactRow[]).find((artifact) => artifact.id === created.id)
  const mcpRow = (grantedMcp.body as ArtifactRow[]).find((artifact) => artifact.id === created.id)
  assert.ok(directRow, 'the granted artifact appears over HTTP')
  assert.ok(mcpRow, 'the granted artifact appears over MCP')
  assert.deepEqual(mcpRow, directRow, 'HTTP and MCP expose the same granted artifact row')
  assert.equal(directRow?.own, false, 'a granted reader is not an owner')
  assert.equal(directRow?.tenantId, undefined, 'a grant-only HTTP row redacts the owner tenant stamp')
  assert.equal(mcpRow?.tenantId, undefined, 'a grant-only MCP row redacts the owner tenant stamp')

  const exportDirect = await call('GET', `/artifacts/${created.id}/export`, undefined, { 'x-tenant-id': audience })
  const exportMcp = await toolCall('get_artifacts_by_id_export', { id: created.id }, { 'x-tenant-id': audience })
  assert.equal(exportDirect.status, 200)
  assert.equal(exportMcp.status, 200)
  assert.deepEqual(exportMcp.body, exportDirect.json, 'all read doors return the same saved Markdown projection')
  const renamed = await toolCall('patch_artifacts_by_id', {
    id: created.id, body: { name: `renamed-${created.name}`, expectedRevision: 0 },
  }, { 'x-tenant-id': owner })
  assert.equal(renamed.status, 200)
  const namedDirect = await call('GET', `/artifacts/${created.id}`, undefined, { 'x-tenant-id': audience })
  const namedMcp = await toolCall('get_artifacts_by_id', { id: created.id }, { 'x-tenant-id': audience })
  assert.deepEqual(namedMcp.body, namedDirect.json)
  assert.equal(namedMcp.body.name, `renamed-${created.name}`)
  assert.equal((await toolCall('patch_artifacts_by_id', {
    id: created.id, body: { name: 'reader-change.md', expectedRevision: 1 },
  }, { 'x-tenant-id': audience })).status, 404)
  const hiddenExport = await toolCall('get_artifacts_by_id_export', { id: created.id }, { 'x-tenant-id': 'tenant-growthworks' })
  assert.equal(hiddenExport.status, 404)

  const moved = await call('POST', '/relations/ops', {
    op: {
      kind: 'refile-artifact', artifactId: created.id, artifactName: name,
      projectId: 'p-infra', projectName: 'Platform hardening',
    },
  }, { 'x-tenant-id': owner, 'idempotency-key': `mcp-listed-refile-${stamp}` })
  assert.equal(moved.status, 200)
  const movedDirect = (await call('GET', '/artifacts', undefined, { 'x-tenant-id': owner })).json.find((artifact: { id: string }) => artifact.id === created.id)
  const movedMcp = (await toolCall('get_artifacts', undefined, { 'x-tenant-id': owner })).body.find((artifact: { id: string }) => artifact.id === created.id)
  assert.equal(movedDirect?.projectId, 'p-infra', 'HTTP follows current filing')
  assert.equal(movedMcp?.projectId, 'p-infra', 'MCP follows current filing')

  const unfiled = await call('POST', '/relations/ops', {
    op: {
      kind: 'refile-artifact', artifactId: created.id, artifactName: name,
      projectId: null, projectName: 'Platform hardening',
    },
  }, { 'x-tenant-id': owner, 'idempotency-key': `mcp-listed-unfile-${stamp}` })
  assert.equal(unfiled.status, 200)
  const unfiledDirect = (await call('GET', '/artifacts', undefined, { 'x-tenant-id': owner })).json.find((artifact: { id: string }) => artifact.id === created.id)
  const unfiledMcp = (await toolCall('get_artifacts', undefined, { 'x-tenant-id': owner })).body.find((artifact: { id: string }) => artifact.id === created.id)
  assert.equal(unfiledDirect?.projectId, '', 'HTTP preserves explicit unfiled state')
  assert.equal(unfiledMcp?.projectId, '', 'MCP preserves explicit unfiled state')

  const grantedBody = await toolCall('get_artifact_content', undefined, { 'x-tenant-id': audience })
  assert.ok(grantedBody.body[created.id], 'MCP grants the authored body before revocation')

  const revoked = await call('DELETE', `/grants/${grant.json.id}`, undefined, { 'x-tenant-id': owner })
  assert.equal(revoked.status, 200)
  const afterDirect = await call('GET', '/artifacts', undefined, { 'x-tenant-id': audience })
  const afterMcp = await toolCall('get_artifacts', undefined, { 'x-tenant-id': audience })
  assert.equal((afterDirect.json as { id: string }[]).some((artifact) => artifact.id === created.id), false, 'revoked access disappears over HTTP')
  assert.equal((afterMcp.body as { id: string }[]).some((artifact) => artifact.id === created.id), false, 'revoked access disappears over MCP')
  const revokedBody = await toolCall('get_artifact_content', undefined, { 'x-tenant-id': audience })
  assert.equal(revokedBody.body[created.id], undefined, 'MCP revocation removes the authored body projection')
})

test('POLICY: authored projects are discoverable identically through HTTP and remote MCP', async () => {
  const tenant = 'tenant-mcp-project-registry'
  const name = `MCP canonical project ${Date.now()}`
  const created = await call('POST', '/projects', { name, description: '' }, { 'x-tenant-id': tenant })
  assert.equal(created.status, 201)
  const id = created.json.project.id as string

  const direct = await call('GET', '/projects', undefined, { 'x-tenant-id': tenant })
  const viaMcp = await toolCall('get_projects', undefined, { 'x-tenant-id': tenant })
  assert.equal(direct.status, 200)
  assert.equal(viaMcp.status, 200)
  const directRows = (direct.json as { id: string }[]).filter((project) => project.id === id)
  const mcpRows = (viaMcp.body as { id: string }[]).filter((project) => project.id === id)
  assert.equal(directRows.length, 1, 'HTTP exposes the authored project exactly once')
  assert.equal(mcpRows.length, 1, 'MCP exposes the authored project exactly once')
  assert.deepEqual(mcpRows[0], directRows[0], 'HTTP and MCP expose the same canonical project row')
})

test('POLICY: the maintainer wall is identical through MCP — included capability does not widen authority', async () => {
  const login = await toolCall('post_auth_login', {
    body: { email: 'ada@acme.example', password: 'ada-demo-password', transport: 'bearer' },
  })
  const auth = { authorization: `Bearer ${login.body.token}` }
  const hiddenDirect = await call('GET', '/admin/users', undefined, auth)
  const hiddenMcp = await toolCall('get_admin_users', undefined, auth)
  assert.equal(hiddenDirect.status, 404)
  assert.equal(hiddenMcp.status, 404)
  assert.deepEqual(hiddenMcp.body, hiddenDirect.json)

  process.env.MAINTAINERS = 'user-ada'
  try {
    const direct = await call('GET', '/admin/users', undefined, auth)
    const viaMcp = await toolCall('get_admin_users', undefined, auth)
    assert.equal(direct.status, 200)
    assert.equal(viaMcp.status, 200)
    assert.deepEqual(viaMcp.body, direct.json, 'the same maintainer grant opens the same cross-tenant projection')
  } finally {
    delete process.env.MAINTAINERS
  }
})

test('form-only routes carry their reason at registration; the maintainer plane is product capability', () => {
  const catalog = catalogOf(buildRouter())
  const forms = catalog.filter((op) => op.access.kind === 'form')
  assert.ok(forms.length > 20, 'the protocol/authentication forms are explicitly classified')
  for (const op of forms) assert.ok(op.access.reason.length > 24, `${op.method} ${op.pattern} explains its form`)
  for (const op of catalog.filter((op) => op.pattern.startsWith('/admin/'))) {
    assert.equal(op.access.kind, 'product', `${op.method} ${op.pattern} stays in every authenticated capability surface`)
  }
})
