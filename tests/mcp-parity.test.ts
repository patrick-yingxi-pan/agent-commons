/** ── Access-parity (INV-11): the MCP door equals the other doors ─────────────
 *  The rule: all access interfaces to this product — the browser UI (a client
 *  of the HTTP API), the in-app session (model tool-calls landing behind the
 *  same consent-gated routes), and the MCP door — may differ in FORM but never
 *  in capability or in the authentication/authorization policy that gates
 *  them. This suite locks the two halves that make the rule structural:
 *   1. CAPABILITY — the tool catalog is a bijection with the route table
 *      (every route is a tool, or carries an argued exclusion; nothing is
 *      excluded that isn't a real route; names are unique);
 *   2. POLICY — the same request through either door meets the same wall:
 *      the auth gate's 401s, the front door's openness, the bearer credential
 *      minted by the same login, and the tenancy 404s all answer identically. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { call } from './helpers/http.ts'
import { buildRouter } from '../server/routes/index.ts'
import { MCP_EXCLUDED, toolNameFor } from '../server/mcp.ts'

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
  const routes = buildRouter().list()
  const routeKeys = new Set(routes.map((r) => `${r.method} ${r.pattern}`))
  // (b) nothing is excluded that isn't a real route — a stale exclusion would
  // silently shrink the surface the day the route is renamed.
  for (const key of MCP_EXCLUDED.keys()) {
    assert.ok(routeKeys.has(key), `MCP_EXCLUDED names a real route: ${key}`)
  }
  // (a) every route is a tool or an argued exclusion, and names are unique.
  const { json } = await rpc('tools/list')
  const toolNames = new Set<string>(json.result.tools.map((t: any) => t.name))
  assert.equal(toolNames.size, json.result.tools.length, 'tool names are unique')
  const expected = routes.filter((r) => !MCP_EXCLUDED.has(`${r.method} ${r.pattern}`))
  assert.equal(json.result.tools.length, expected.length, 'tool count = routes − argued exclusions, exactly')
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

test('the argued exclusions are exactly the stream-shaped routes and the endpoint itself', () => {
  const keys = [...MCP_EXCLUDED.keys()].sort()
  assert.deepEqual(keys, [
    'DELETE /mcp',
    'GET /events',
    'GET /mcp',
    'GET /relay/poll',
    'GET /sessions/:id/turns/:turnId/stream',
    'POST /mcp',
  ])
  for (const reason of MCP_EXCLUDED.values()) {
    assert.ok(reason.length > 20, 'every exclusion carries its argument')
  }
})
