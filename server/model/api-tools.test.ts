/** ── Access-parity, the in-app leg (INV-11): generated API tools ──────────────
 *  The model serving a conversation is declared one tool per HTTP operation,
 *  derived from the SAME catalog as the MCP door. This suite locks the three
 *  halves that make the leg equal-and-gated:
 *   1. DERIVATION — every route is a generated tool or carries an argued
 *      exclusion (the model leg's own list — the conversation plane, the
 *      identity/credential plane, machine edges); names collide with nothing;
 *   2. SEMANTICS — a read executes NOW (as the user, provenance row on the
 *      message); a mutation only PROPOSES (a `proposed` activity carrying the
 *      exact operation + its consent-card family);
 *   3. THE CONFIRM — the user's confirm executes the operation through the
 *      router as the confirmer (walls included); an inner refusal keeps the
 *      proposal open; decline executes nothing. */
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import type { Server } from 'node:http'
import { call, callRaw } from '../testkit/http.ts'
import { store } from '../store/index.ts'
import { startModelServer } from './index.ts'
import { buildRouter } from '../routes/index.ts'
import { catalogOf } from '../apiSurface.ts'
import { dispatch } from '../http/dispatch.ts'
import { MODEL_API_EXCLUDED, deriveApiTools, familyFor, runApiTool, API_TOOL_PREFIX } from './apiTools.ts'
import { TOOL_NAMES } from './tools.ts'

// ── 1. Derivation ────────────────────────────────────────────────────────────

test('every route is a generated model tool or an argued exclusion — and every exclusion is a real route', () => {
  const catalog = catalogOf(buildRouter())
  const routeKeys = new Set(catalog.map((op) => `${op.method} ${op.pattern}`))
  for (const key of MODEL_API_EXCLUDED.keys()) {
    assert.ok(routeKeys.has(key), `MODEL_API_EXCLUDED names a real route: ${key}`)
  }
  for (const reason of MODEL_API_EXCLUDED.values()) {
    assert.ok(reason.length > 20, 'every exclusion carries its argument')
  }
  const { definitions, byName } = deriveApiTools(catalog)
  const expected = catalog.filter((op) => !MODEL_API_EXCLUDED.has(`${op.method} ${op.pattern}`))
  assert.equal(definitions.length, expected.length, 'tool count = routes − argued exclusions, exactly')
  assert.equal(byName.size, definitions.length, 'names are unique')
  for (const d of definitions) {
    assert.ok(d.name.startsWith(API_TOOL_PREFIX), 'generated tools wear the api__ namespace')
    assert.ok(!(TOOL_NAMES as string[]).includes(d.name), 'and collide with no curated tool')
  }
})

test('the model-leg exclusions are exactly the three argued planes + the stream forms', () => {
  const keys = [...MODEL_API_EXCLUDED.keys()]
  // Spot-lock the load-bearing members — the consent-resolution edge above all:
  // a model that could confirm its own proposals would dissolve the entire gate.
  for (const mustExclude of [
    'POST /sessions/:id/tool-activities/:activityId',
    'POST /sessions/:id/messages',
    'POST /relations/ops',
    'POST /auth/login',
    'POST /a2a/peers',
    'POST /providers/:id/rotate',
    'POST /runners',
    'GET /events',
    'POST /admin/users/:id/deactivate',
  ]) {
    assert.ok(keys.includes(mustExclude), `${mustExclude} must stay non-model-proposable`)
  }
  // And reads are NEVER excluded beyond the stream forms and the maintainer
  // plane — the model may read whatever its user may read (the granted
  // read-access policy); the `/admin/*` reads are the one argued exception
  // (cross-tenant instance administration is the maintainer's own act).
  const excludedReads = keys.filter((k) => k.startsWith('GET '))
  assert.deepEqual(excludedReads.sort(), [
    'GET /admin/audit',
    'GET /admin/invites',
    'GET /admin/ops',
    'GET /admin/tenants',
    'GET /admin/tokens',
    'GET /admin/users',
    'GET /events',
    'GET /mcp',
    'GET /relay/poll',
    'GET /sessions/:id/turns/:turnId/stream',
  ])
})

test('the card family is chosen mechanically from the operation shape, total over the surface', () => {
  const catalog = catalogOf(buildRouter())
  const included = catalog.filter((op) => !MODEL_API_EXCLUDED.has(`${op.method} ${op.pattern}`) && op.method !== 'GET')
  for (const op of included) {
    const family = familyFor(op)
    assert.ok(['create', 'edit', 'danger', 'action', 'post'].includes(family), `${op.method} ${op.pattern} classifies`)
  }
  // Spot-lock the shape rules.
  assert.equal(familyFor({ method: 'PATCH', pattern: '/sessions/:id' }), 'edit')
  assert.equal(familyFor({ method: 'DELETE', pattern: '/schedules/:id' }), 'danger')
  assert.equal(familyFor({ method: 'POST', pattern: '/sessions' }), 'create')
  assert.equal(familyFor({ method: 'POST', pattern: '/agents/:id/proposals/:pid/comments' }), 'post')
  assert.equal(familyFor({ method: 'POST', pattern: '/schedules/:id/run' }), 'action')
})

// ── 2. Semantics (unit level — a fake dispatch shows exactly what ran) ───────

const fakeRuntime = (record: Array<{ method: string; path: string; body?: unknown }>) => ({
  catalog: catalogOf(buildRouter()),
  dispatch: async (method: string, path: string, body?: unknown) => {
    record.push({ method, path, body })
    return { status: 200, headers: { 'content-type': 'application/json; charset=utf-8' }, body: Buffer.from('{"ok":true}') }
  },
})

test('a read executes immediately and lands as a done provenance activity; nothing else dispatches', async () => {
  const ran: Array<{ method: string; path: string }> = []
  const out = await runApiTool('api__get_usage', {}, 'tc-1', fakeRuntime(ran))
  assert.ok(out?.activity)
  assert.equal(out.activity.kind, 'read')
  assert.equal(out.activity.status, 'done')
  assert.match(out.activity.summary, /GET \/api\/v1\/usage → 200/)
  assert.deepEqual(ran, [{ method: 'GET', path: '/usage', body: undefined }], 'the read ran through dispatch — once')
  assert.match(out.content, /"ok":true/, 'the result feeds back to the model')
})

test('a mutation dispatches NOTHING — it mints a proposed activity carrying the exact operation + family', async () => {
  const ran: Array<{ method: string; path: string }> = []
  const out = await runApiTool('api__patch_sessions_by_id', { id: 'sess-1', body: { status: 'archived' } }, 'tc-2', fakeRuntime(ran))
  assert.deepEqual(ran, [], 'no side effect at generation time')
  assert.equal(out?.activity?.status, 'proposed')
  assert.equal(out.activity.family, 'edit')
  assert.deepEqual(out.activity.op, { method: 'PATCH', path: '/sessions/sess-1', body: { status: 'archived' } })
  assert.match(out.content, /awaiting their confirmation/i)
})

test('missing path params and unknown tools are refused loudly; query rides inside op.path', async () => {
  const missing = await runApiTool('api__patch_sessions_by_id', {}, 'tc-3', fakeRuntime([]))
  assert.equal(missing?.isError, true)
  assert.match(missing.content, /path parameter 'id'/)
  const unknown = await runApiTool('api__post_no_such_thing', {}, 'tc-4', fakeRuntime([]))
  assert.equal(unknown?.isError, true)
  const excluded = await runApiTool('api__post_auth_login', { body: {} }, 'tc-5', fakeRuntime([]))
  assert.equal(excluded?.isError, true, 'an excluded route is not a tool, even addressed directly')
  const withQuery = await runApiTool('api__delete_saved_contexts_by_id', { id: 'ctx-1', query: { force: 'yes' } }, 'tc-6', fakeRuntime([]))
  assert.equal(withQuery?.activity?.op?.path, '/saved-contexts/ctx-1?force=yes', 'the card shows exactly what confirm will send')
})

// ── 3. End-to-end through the mock model: read now, propose, confirm/decline ─

let server: Server
before(async () => {
  server = startModelServer(0, '127.0.0.1')
  await new Promise<void>((r) => server.on('listening', () => r()))
  const addr = server.address()
  const port = typeof addr === 'object' && addr ? addr.port : 0
  process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${port}`
})
after(() => {
  delete process.env.ANTHROPIC_BASE_URL
  server.close()
})

const lastActivity = (sessionId: string) => {
  const session = store.getSession(sessionId)
  const acts = (session?.messages ?? []).flatMap((m) => m.toolActivities ?? [])
  return acts.at(-1)
}

test('E2E: "check my usage" reads through the router NOW and the message carries the provenance row', async () => {
  const s = store.createSession('api read round-trip')
  const { status, body } = await callRaw('POST', `/sessions/${s.id}/messages`, { text: 'Check my usage please.' })
  assert.equal(status, 200)
  assert.match(body, /api__get_usage/, 'the activity streams with the message')
  const act = lastActivity(s.id)
  assert.equal(act?.kind, 'read')
  assert.equal(act?.status, 'done')
  assert.match(act!.summary, /GET \/api\/v1\/usage → 200/)
})

test('E2E: "archive session X" proposes an edit; CONFIRM executes it as the confirmer through the wall', async () => {
  const s = store.createSession('to be archived')
  const driver = store.createSession('api mutation round-trip')
  await callRaw('POST', `/sessions/${driver.id}/messages`, { text: `Please archive session ${s.id}.` })
  const act = lastActivity(driver.id)
  assert.equal(act?.status, 'proposed')
  assert.equal(act?.family, 'edit')
  assert.deepEqual(act?.op, { method: 'PATCH', path: `/sessions/${s.id}`, body: { status: 'archived' } })
  assert.equal(store.getSession(s.id)?.status ?? 'active', 'active', 'NOTHING executed at generation time')

  const confirmed = await call('POST', `/sessions/${driver.id}/tool-activities/${act!.id}`, { decision: 'confirm' })
  assert.equal(confirmed.status, 200)
  assert.equal(confirmed.json.status, 'done')
  assert.match(confirmed.json.summary, /PATCH \/api\/v1\/sessions\/.* → 200/)
  assert.equal(store.getSession(s.id)?.status, 'archived', 'the confirm executed the operation')
})

test('E2E: DECLINE executes nothing; a declined proposal cannot be re-confirmed into effect', async () => {
  const s = store.createSession('decline target')
  const driver = store.createSession('decline round-trip')
  await callRaw('POST', `/sessions/${driver.id}/messages`, { text: `Please archive session ${s.id}.` })
  const act = lastActivity(driver.id)
  const declined = await call('POST', `/sessions/${driver.id}/tool-activities/${act!.id}`, { decision: 'decline' })
  assert.equal(declined.json.status, 'declined')
  assert.equal(store.getSession(s.id)?.status ?? 'active', 'active', 'decline executed nothing')
  const again = await call('POST', `/sessions/${driver.id}/tool-activities/${act!.id}`, { decision: 'confirm' })
  assert.equal(again.json.status, 'declined', 'the verdict is final — no post-decline execution')
  assert.equal(store.getSession(s.id)?.status ?? 'active', 'active')
})

test('E2E: an inner refusal on confirm keeps the proposal OPEN and surfaces the real reason (409)', async () => {
  const driver = store.createSession('refused confirm')
  await callRaw('POST', `/sessions/${driver.id}/messages`, { text: 'Please archive session no-such-session.' })
  const act = lastActivity(driver.id)
  assert.equal(act?.family, 'edit')
  const confirm = await call('POST', `/sessions/${driver.id}/tool-activities/${act!.id}`, { decision: 'confirm' })
  assert.equal(confirm.status, 409, 'the inner refusal surfaces honestly')
  assert.match(confirm.json.error.message, /refused \(404\)/)
  assert.equal(store.getToolActivity(driver.id, act!.id)?.status, 'proposed', 'the proposal stays open — retry and decline both remain')
})

test('E2E: the confirm meets the tenancy wall — a foreign tenant cannot confirm another tenant\'s proposal', async () => {
  const s = store.createSession('foreign target')
  const driver = store.createSession('foreign confirm')
  await callRaw('POST', `/sessions/${driver.id}/messages`, { text: `Please archive session ${s.id}.` })
  const act = lastActivity(driver.id)
  const foreign = await call('POST', `/sessions/${driver.id}/tool-activities/${act!.id}`, { decision: 'confirm' }, { 'x-user-id': 'user-grace', 'x-tenant-id': 'tenant-beta' })
  assert.equal(foreign.status, 404, 'existence-hiding, same as every by-id session route')
  assert.equal(store.getToolActivity(driver.id, act!.id)?.status, 'proposed')
})

test('the read runs as the SENDER: a runtime bound to a foreign tenant reads THAT tenant\'s world through the tool', async () => {
  // Drive the ACTUAL model-tool runtime: a dispatch closed over one tenant's
  // headers (exactly how generate.ts binds it to the sending request), then
  // assert the tool's read equals that tenant's plain-HTTP read and differs
  // from the default tenant's — the wall is live INSIDE the tool path.
  const beta = { 'x-user-id': 'user-grace', 'x-tenant-id': 'tenant-beta' }
  const router = buildRouter()
  const runtimeAs = (headers: Record<string, string>) => ({
    catalog: catalogOf(router),
    dispatch: (method: string, path: string, body?: unknown) =>
      dispatch(router, method, new URL(`http://model${path}`), headers, body),
  })
  const viaTool = await runApiTool('api__get_sessions', {}, 'tc-sender', runtimeAs(beta))
  assert.equal(viaTool?.activity?.kind, 'read')
  assert.equal(viaTool?.activity?.status, 'done')
  const { status, body } = JSON.parse(viaTool!.content)
  assert.equal(status, 200)
  const direct = await call('GET', '/sessions', undefined, beta)
  assert.deepEqual(body, direct.json, "the tool read IS the sender's read — the same world, byte for byte")
  const viaDefault = await call('GET', '/sessions')
  assert.notDeepEqual(body, viaDefault.json, "and NOT the default tenant's (the walls are live)")
})

test('E2E: two parallel confirms of ONE proposal execute the operation exactly once (the claim gate)', async () => {
  const s = store.createSession('double-confirm target')
  const driver = store.createSession('double-confirm race')
  await callRaw('POST', `/sessions/${driver.id}/messages`, { text: `Please archive session ${s.id}.` })
  const act = lastActivity(driver.id)
  assert.equal(act?.status, 'proposed')
  // The route awaits the inner dispatch between reading `proposed` and resolving
  // — without a synchronous claim both racers would read `proposed` and dispatch.
  const [a, b] = await Promise.all([
    call('POST', `/sessions/${driver.id}/tool-activities/${act!.id}`, { decision: 'confirm' }),
    call('POST', `/sessions/${driver.id}/tool-activities/${act!.id}`, { decision: 'confirm' }),
  ])
  assert.deepEqual([a.status, b.status].sort(), [200, 409], 'one confirm wins; the other is refused BEFORE it can dispatch')
  const loser = a.status === 409 ? a : b
  assert.match(loser.json.error.message, /already being processed/)
  const winner = a.status === 200 ? a : b
  assert.equal(winner.json.status, 'done')
  assert.equal(store.getSession(s.id)?.status, 'archived')
  // And after the verdict lands, a late confirm is the idempotent no-op path.
  const late = await call('POST', `/sessions/${driver.id}/tool-activities/${act!.id}`, { decision: 'confirm' })
  assert.equal(late.status, 200)
  assert.equal(late.json.status, 'done', 'already resolved — returned unchanged, nothing re-executed')
})

test('E2E: a DECLINE racing a confirm cannot flip the record while the operation executes — one verdict wins, coherently', async () => {
  const s = store.createSession('race-decline target')
  const driver = store.createSession('confirm-vs-decline race')
  await callRaw('POST', `/sessions/${driver.id}/messages`, { text: `Please archive session ${s.id}.` })
  const act = lastActivity(driver.id)
  assert.equal(act?.status, 'proposed')
  const [c, d] = await Promise.all([
    call('POST', `/sessions/${driver.id}/tool-activities/${act!.id}`, { decision: 'confirm' }),
    call('POST', `/sessions/${driver.id}/tool-activities/${act!.id}`, { decision: 'decline' }),
  ])
  // Whichever verdict wins the claim, the OTHER is refused — never a record
  // that says "declined" while the confirmed operation ran to completion.
  assert.deepEqual([c.status, d.status].sort(), [200, 409], 'exactly one verdict lands')
  if (c.status === 200) {
    assert.equal(c.json.status, 'done')
    assert.equal(store.getSession(s.id)?.status, 'archived', 'confirm won — it executed')
  } else {
    assert.equal(d.json.status, 'declined')
    assert.equal(store.getSession(s.id)?.status ?? 'active', 'active', 'decline won — NOTHING executed')
  }
})
