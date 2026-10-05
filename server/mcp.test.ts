/** The MCP door's protocol behavior (server/mcp.ts, access-parity INV-11):
 *  `POST /mcp` speaks stateless Streamable-HTTP JSON-RPC — initialize / ping /
 *  tools/list / tools/call — and every tool is one HTTP operation dispatched
 *  back through the real router. Parity itself (route↔tool bijection, the
 *  shared auth wall, tenancy) is locked by server/mcp-parity.test.ts; this
 *  suite locks the endpoint's own protocol contract. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { call, callRaw } from './testkit/http.ts'
import { MCP_PROTOCOL_VERSION } from './mcp.ts'

let seq = 0
const rpc = async (method: string, params?: unknown, headers?: Record<string, string>) =>
  await call('POST', '/mcp', { jsonrpc: '2.0', id: ++seq, method, ...(params === undefined ? {} : { params }) }, headers)

/** Call a tool and parse the `{status, body}` envelope out of the result text. */
const toolCall = async (name: string, args?: Record<string, unknown>, headers?: Record<string, string>) => {
  const r = await rpc('tools/call', { name, arguments: args ?? {} }, headers)
  assert.equal(r.status, 200, `tools/call ${name} answers 200 at the JSON-RPC layer`)
  if (r.json.error) return { rpcError: r.json.error }
  const result = r.json.result
  const text = result.content?.[0]?.text
  return { isError: result.isError === true, ...(JSON.parse(text) as { status: number; body: any }) }
}

test('hosted initialize: protocol version, tools capability, and instructions that teach the auth flow', async () => {
  const previous = process.env.AUTH_GATE
  process.env.AUTH_GATE = 'require'
  try {
    const r = await rpc('initialize', { protocolVersion: MCP_PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: 't', version: '0' } })
    assert.equal(r.status, 200)
    const result = r.json.result
    assert.equal(result.protocolVersion, MCP_PROTOCOL_VERSION)
    assert.equal(result.serverInfo.name, 'universal-workspace')
    assert.ok(result.capabilities.tools, 'tools are the advertised capability')
    assert.match(result.instructions, /post_auth_login/, 'the instructions teach signing in through the same front door')
    assert.match(result.instructions, /Bearer/, '…and presenting the credential as a bearer header')
  } finally {
    if (previous === undefined) delete process.env.AUTH_GATE
    else process.env.AUTH_GATE = previous
  }
})

test('notifications are accepted with 202 and no body', async () => {
  const r = await call('POST', '/mcp', { jsonrpc: '2.0', method: 'notifications/initialized' })
  assert.equal(r.status, 202)
  assert.equal(r.json, undefined)
})

test('ping answers an empty result; unknown methods answer -32601; non-JSON-RPC bodies answer -32600', async () => {
  const ping = await rpc('ping')
  assert.deepEqual(ping.json.result, {})
  const unknown = await rpc('no/such-method')
  assert.equal(unknown.json.error.code, -32601)
  const invalid = await call('POST', '/mcp', { hello: 'world' })
  assert.equal(invalid.status, 400)
  assert.equal(invalid.json.error.code, -32600)
})

test('tools/list: generated from the route table, with path params as required string inputs', async () => {
  const r = await rpc('tools/list')
  const tools: any[] = r.json.result.tools
  assert.ok(tools.length > 100, `the whole API surface is exposed (${tools.length} tools)`)
  const byName = new Map(tools.map((t) => [t.name, t]))
  assert.ok(byName.has('get_capabilities'))
  assert.ok(byName.has('post_sessions'))
  const bySession = byName.get('get_sessions_by_id')
  assert.ok(bySession, 'a :id route becomes a by_id tool')
  assert.deepEqual(bySession.inputSchema.required, ['id'])
  assert.equal(bySession.inputSchema.properties.id.type, 'string')
  assert.ok(!byName.has('get_events'), 'the endless SSE stream is a route-declared transport form')
  assert.ok(!byName.has('post_mcp'), 'the endpoint does not expose itself')
})

test('tools/call: mutation retry identities are bounded and invalid values fail at the MCP protocol door', async () => {
  const listed = await rpc('tools/list')
  const edit = listed.json.result.tools.find((tool: any) => tool.name === 'patch_artifacts_by_id_content')
  assert.equal(edit.inputSchema.properties.idempotencyKey.type, 'string')
  const create = listed.json.result.tools.find((tool: any) => tool.name === 'post_artifacts')
  assert.ok(create.inputSchema.required.includes('idempotencyKey'), 'intrinsic Artifact creation advertises its mandatory logical identity')
  assert.equal(create.annotations.idempotentHint, true, 'its mandatory stable key makes exact retries safe')
  const missingCreateKey = await rpc('tools/call', {
    name: 'post_artifacts',
    arguments: { body: { name: 'missing-key.md', kind: 'doc', body: 'Must not create.' } },
  })
  assert.equal(missingCreateKey.json.error.code, -32602)
  const invalidType = await rpc('tools/call', {
    name: 'patch_artifacts_by_id_content',
    arguments: { id: 'missing', body: {}, idempotencyKey: 7 },
  })
  assert.equal(invalidType.json.error.code, -32602)
  const blank = await rpc('tools/call', {
    name: 'patch_artifacts_by_id_content',
    arguments: { id: 'missing', body: {}, idempotencyKey: '   ' },
  })
  assert.equal(blank.json.error.code, -32602)
  const oversized = await rpc('tools/call', {
    name: 'patch_artifacts_by_id_content',
    arguments: { id: 'missing', body: {}, idempotencyKey: 'x'.repeat(201) },
  })
  assert.equal(oversized.json.error.code, -32602)
})

test('tool annotations derive mechanically from the operation shape (read-only / destructive / closed-world)', async () => {
  const r = await rpc('tools/list')
  const byName = new Map<string, any>(r.json.result.tools.map((t: any) => [t.name, t]))
  const read = byName.get('get_usage').annotations
  assert.equal(read.readOnlyHint, true)
  assert.equal(read.destructiveHint, false)
  const del = byName.get('delete_sessions_by_id').annotations
  assert.equal(del.readOnlyHint, false)
  assert.equal(del.destructiveHint, true)
  assert.equal(del.idempotentHint, true)
  const post = byName.get('post_sessions').annotations
  assert.equal(post.destructiveHint, false, 'a create is not destructive (the MCP default would say it is)')
  assert.equal(post.idempotentHint, false)
  for (const t of r.json.result.tools) {
    assert.equal(t.annotations.openWorldHint, false, `${t.name}: every tool acts on this workspace only`)
    assert.equal(t.annotations.readOnlyHint, t.name.startsWith('get_'), `${t.name}: readOnly ⇔ GET, mechanically`)
  }
})

test('the CORE toolset: ?toolset=core narrows the LIST, never the callable surface (presentation, not policy)', async () => {
  const { MCP_CORE_TOOLS } = await import('./mcp.ts')
  const full = await rpc('tools/list')
  const fullNames = new Set<string>(full.json.result.tools.map((t: any) => t.name))
  for (const name of MCP_CORE_TOOLS) {
    assert.ok(fullNames.has(name), `core name '${name}' exists in the generated catalog (no hand-invented tools)`)
  }
  const core = await call('POST', '/mcp?toolset=core', { jsonrpc: '2.0', id: ++seq, method: 'tools/list' })
  const coreNames = core.json.result.tools.map((t: any) => t.name).sort()
  assert.deepEqual(coreNames, [...MCP_CORE_TOOLS].sort(), 'the core list is exactly the curated subset')
  assert.ok(coreNames.length < 30, `the core surface stays small (${coreNames.length} tools)`)
  // Capability parity: a NON-core tool still calls fine through the core URL.
  assert.ok(!MCP_CORE_TOOLS.includes('get_audit'))
  const r = await call('POST', '/mcp?toolset=core', {
    jsonrpc: '2.0',
    id: ++seq,
    method: 'tools/call',
    params: { name: 'get_audit', arguments: {} },
  })
  const out = JSON.parse(r.json.result.content[0].text)
  assert.equal(out.status, 200, 'tools/call ignores the toolset — the wall is auth, not the list')
})

test('curated body examples: every key is a real mutation route, the spine is covered, and each example passes its own route\'s validation', async () => {
  const { API_BODY_EXAMPLES } = await import('./apiSurface.ts')
  const { buildRouter } = await import('./routes/index.ts')
  const { catalogOf } = await import('./apiSurface.ts')
  const routes = new Map(catalogOf(buildRouter()).map((op) => [`${op.method} ${op.pattern}`, op]))
  for (const key of API_BODY_EXAMPLES.keys()) {
    const op = routes.get(key)
    assert.ok(op, `example key names a real route: ${key}`)
    assert.notEqual(op!.method, 'GET', `examples are for mutations only: ${key}`)
  }
  // The conversational spine is self-describing.
  for (const key of ['POST /sessions', 'POST /sessions/:id/messages', 'PATCH /sessions/:id']) {
    assert.ok(API_BODY_EXAMPLES.has(key), `${key} carries an example`)
  }
  // …and each example rides the tool schema.
  const list = await rpc('tools/list')
  const byName = new Map<string, any>(list.json.result.tools.map((t: any) => [t.name, t]))
  for (const [key, example] of API_BODY_EXAMPLES) {
    const op = routes.get(key)!
    const def = byName.get(op.name)
    if (def) assert.deepEqual(def.inputSchema.properties.body.examples, [example], `${op.name} surfaces its example`)
  }

  // Each example must be accepted on its route's SUCCESS path — real ids, a real
  // credential, expecting 2xx. (An earlier form asserted only `not 400` against
  // placeholder ids, which a 401/404 short-circuit satisfies for ANY body — a
  // drifted example would have kept passing. This form fails on drift.)
  const seam = { 'x-user-id': 'user-ada', 'x-tenant-id': 'tenant-acme' }
  const ex = (key: string) => ({ body: API_BODY_EXAMPLES.get(key)! }) as Record<string, unknown>

  // The uniform-refusal exception: the login example deliberately carries a
  // placeholder password ('…' — an example must not teach a real credential),
  // so its success is the route CONSUMING the shape and answering the single
  // uniform 401 (never a 400/500 — shape trouble would surface as either).
  const login = await toolCall('post_auth_login', ex('POST /auth/login'))
  assert.equal(login.status, 401, 'the login example reaches credential verification (shape accepted)')

  // A real bearer session for the session-verified mint.
  const signIn = await toolCall('post_auth_login', {
    body: { email: 'ada@acme.example', password: 'ada-demo-password', transport: 'bearer' },
  })
  const auth = { authorization: `Bearer ${signIn.body.token}` }
  assert.equal((await toolCall('post_auth_token', ex('POST /auth/token'), auth)).status, 200, 'POST /auth/token example mints')

  const created = await toolCall('post_sessions', ex('POST /sessions'), seam)
  assert.equal(created.status, 200, 'POST /sessions example creates')
  const sid = created.body.id
  const localConnectionId = 'LOCAL_0123456789ABCDEF0123456789ABCDEF'
  const localFolderId = `ui-host::${localConnectionId}`
  assert.equal((await toolCall('patch_sessions_by_id_context_state', {
    id: sid,
    body: {
      operations: [{ action: 'attach', context: {
        id: localFolderId, type: 'folder', label: 'Local notes', scope: localConnectionId,
        source: { id: 'ui-host', kind: 'ui-host', label: 'This computer' },
      } }],
      workspace: { workspaces: [{ id: 'w', label: 'Workspace', artifacts: [], folders: [{ id: localFolderId, label: 'Local notes' }] }], repos: [], connectors: [], attachments: [] },
    },
  }, seam)).status, 200, 'a local-folder refresh example has an existing attached target')
  assert.equal((await toolCall('post_sessions_by_id_local_folders_by_folder_id_refresh', {
    id: sid, folderId: localFolderId, ...ex('POST /sessions/:id/local-folders/:folderId/refresh'),
  }, seam)).status, 200, 'local-folder refresh accepts its frozen empty-capture example')
  assert.equal(
    (await toolCall('post_sessions_by_id_messages', { id: sid, ...ex('POST /sessions/:id/messages') }, seam)).status,
    200,
    'POST /sessions/:id/messages example sends',
  )
  assert.equal(
    (await toolCall('patch_sessions_by_id', { id: sid, ...ex('PATCH /sessions/:id') }, seam)).status,
    200,
    'PATCH /sessions/:id example applies',
  )
  assert.equal(
    (await toolCall('patch_sessions_by_id_context_state', { id: sid, ...ex('PATCH /sessions/:id/context-state') }, seam)).status,
    200,
    'PATCH /sessions/:id/context-state example applies atomically',
  )

  // Contexts setup is viewer-owned, so provision this tenant's fixture instead
  // of borrowing a globally seeded row (which would mask a tenant leak).
  const ctxId = `mcp-example-${Date.now().toString(36)}`
  assert.equal(
    (await toolCall('post_saved_contexts', {
      body: {
        context: {
          id: ctxId,
          label: 'MCP example connector',
          kind: 'connector',
          status: 'needs-auth',
          detail: 'Tenant-owned route-example fixture',
          lastUsedAt: null,
          sessions: 0,
        },
      },
    }, seam)).status,
    200,
    'the mutation fixture is created inside the same tenant wall',
  )
  assert.equal(
    (await toolCall('patch_saved_contexts_by_id', { id: ctxId, ...ex('PATCH /saved-contexts/:id') }, seam)).status,
    200,
    'PATCH /saved-contexts/:id example applies',
  )
  const deleteCtxId = `${ctxId}-delete`
  assert.equal(
    (await toolCall('post_saved_contexts', {
      body: {
        context: {
          id: deleteCtxId,
          label: 'MCP delete example connector',
          kind: 'connector',
          status: 'needs-auth',
          detail: 'Revision-zero deletion fixture',
          lastUsedAt: null,
          sessions: 0,
        },
      },
    }, seam)).status,
    200,
    'the delete example gets its own revision-zero fixture',
  )
  assert.equal(
    (await toolCall('delete_saved_contexts_by_id', { id: deleteCtxId, ...ex('DELETE /saved-contexts/:id') }, seam)).status,
    200,
    'DELETE /saved-contexts/:id example applies',
  )

  const newSchedule = await toolCall('post_schedules', ex('POST /schedules'), seam)
  assert.equal(newSchedule.status, 200, 'POST /schedules example creates')
  assert.equal(
    (await toolCall('patch_schedules_by_id', { id: newSchedule.body.id, ...ex('PATCH /schedules/:id') }, seam)).status,
    200,
    'PATCH /schedules/:id example applies',
  )
  const deleteSchedule = await toolCall('post_schedules', ex('POST /schedules'), seam)
  assert.equal(deleteSchedule.status, 200, 'the routine delete example gets its own revision-zero fixture')
  assert.equal(
    (await toolCall('delete_schedules_by_id', { id: deleteSchedule.body.id, ...ex('DELETE /schedules/:id') }, seam)).status,
    200,
    'DELETE /schedules/:id example applies',
  )
  const artifactExample = await toolCall('post_artifacts', {
      ...ex('POST /artifacts'),
      idempotencyKey: `mcp-direct-artifact-example-${Date.now()}`,
    }, seam)
  assert.equal(artifactExample.status, 201, 'POST /artifacts example creates under its required logical identity')
  assert.equal(
    (await toolCall('patch_artifacts_by_id_lifecycle', {
      id: artifactExample.body.artifact.id,
      ...ex('PATCH /artifacts/:id/lifecycle'),
    }, seam)).status,
    200,
    'PATCH /artifacts/:id/lifecycle example moves the created row to Trash',
  )
  assert.equal(
    (await toolCall('patch_artifacts_by_id_content', { id: 'a1', ...ex('PATCH /artifacts/:id/content') }, seam)).status,
    200,
    'PATCH /artifacts/:id/content example applies',
  )
  assert.equal((await toolCall('post_notifications_read', ex('POST /notifications/read'), seam)).status, 200, 'POST /notifications/read example applies')

  // The coverage ratchet: a NEW example key must be added to the success-path
  // drive above — this count pins the two lists together.
  assert.equal(API_BODY_EXAMPLES.size, 16, 'every example key is driven through its success path above (update both together)')
})

test('a malformed schedule seed is refused with a descriptive 400, not a crash (INV-9 — the shape the examples teach is guarded)', async () => {
  const seam = { 'x-user-id': 'user-ada', 'x-tenant-id': 'tenant-acme' }
  const bad = await toolCall('post_schedules', { body: { seed: { name: 42 } } }, seam)
  assert.equal(bad.status, 400, 'a drifted seed meets a refusal, never a 500')
  assert.match(JSON.stringify(bad.body), /seed needs/i)
})

test('tools/call: a create → read round-trip through the real routes', async () => {
  const created = await toolCall('post_sessions', { body: { firstMessage: 'Born over MCP' } })
  assert.equal(created.isError, false)
  assert.equal(created.status, 200)
  assert.ok(created.body.id, 'the created Session comes back through the tool envelope')
  const read = await toolCall('get_sessions_by_id', { id: created.body.id })
  assert.equal(read.status, 200)
  assert.equal(read.body.id, created.body.id)
  const list = await toolCall('get_sessions', { query: { limit: 1 } })
  assert.equal(list.status, 200)
  assert.ok(Array.isArray(list.body.items), 'query params flow through (paginated shape)')
})

test('tools/call: a non-2xx inner response is isError with the same error envelope', async () => {
  const r = await toolCall('get_sessions_by_id', { id: 'no-such-session' })
  assert.equal(r.isError, true)
  assert.equal(r.status, 404)
  assert.equal(r.body.error.code, 'not_found', 'the HTTP error envelope is preserved verbatim')
})

test('tools/call: unknown tools and missing path params are JSON-RPC -32602', async () => {
  const unknown = await toolCall('no_such_tool')
  assert.equal(unknown.rpcError?.code, -32602)
  const missing = await rpc('tools/call', { name: 'get_sessions_by_id', arguments: {} })
  assert.equal(missing.json.error.code, -32602)
  assert.match(missing.json.error.message, /path parameter/)
})

test('tools/call: served image bytes ride as first-class MCP image content (no UTF-8 mangling)', async () => {
  const r = await rpc('tools/call', { name: 'get_fs_content', arguments: { query: { source: 'cloud', path: 'mockup.svg' } } })
  const item = r.json.result.content[0]
  assert.equal(item.type, 'image', 'binary responses become image content, not mangled text')
  assert.match(item.mimeType, /^image\//)
  const decoded = Buffer.from(item.data, 'base64').toString('utf8')
  assert.match(decoded, /<svg/, 'the bytes round-trip exactly')
})

test('GET and DELETE without a session are refused honestly (400 absent, 404 unknown)', async () => {
  for (const method of ['GET', 'DELETE']) {
    const absent = await callRaw(method, '/mcp')
    assert.equal(absent.status, 400, `${method} /mcp without Mcp-Session-Id`)
  }
  const del = await callRaw('DELETE', '/mcp', undefined, { 'mcp-session-id': 'no-such-session' })
  assert.equal(del.status, 404, 'an unknown session id is an honest 404')
})
