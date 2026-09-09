/** ── Access-parity, the in-app leg (INV-11): generated API tools ──────────────
 *  The model serving a conversation is declared one tool per HTTP operation,
 *  derived from the SAME catalog as the MCP door. This suite locks the three
 *  halves that make the leg equal-and-gated:
 *   1. DERIVATION — every product route is a generated tool or carries a
 *      route-owned intrinsic realization (conversation recursion and consent
 *      stay in the host); protocol/credential forms are not capabilities;
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
import { apiDispatch, catalogOf } from '../apiSurface.ts'
import { dispatch } from '../http/dispatch.ts'
import { deriveApiTools, familyFor, runApiTool, API_TOOL_PREFIX } from './apiTools.ts'
import { TOOL_NAMES } from './tools.ts'
import { toolActivityDecisionId } from '../toolActivityDecisionIdentity.ts'

// ── 1. Derivation ────────────────────────────────────────────────────────────

test('every product route is a generated model tool or a route-declared intrinsic realization', () => {
  const catalog = catalogOf(buildRouter())
  const { definitions, byName } = deriveApiTools(catalog)
  const expected = catalog.filter((op) => op.access.kind === 'product' && op.access.session !== 'intrinsic')
  assert.equal(definitions.length, expected.length, 'tool count = the route-owned in-session projection, exactly')
  assert.equal(byName.size, definitions.length, 'names are unique')
  for (const d of definitions) {
    assert.ok(d.name.startsWith(API_TOOL_PREFIX), 'generated tools wear the api__ namespace')
    assert.ok(!(TOOL_NAMES as string[]).includes(d.name), 'and collide with no curated tool')
  }
})

test('the route-owned form and intrinsic classifications preserve the recursion and self-consent walls', () => {
  const catalog = catalogOf(buildRouter())
  const intrinsic = catalog
    .filter((op) => op.access.kind === 'product' && op.access.session === 'intrinsic')
    .map((op) => `${op.method} ${op.pattern}`)
    .sort()
  assert.deepEqual(intrinsic, [
    'POST /artifacts',
    'POST /image-assets',
    'POST /projects',
    'POST /relations/ops',
    'POST /sessions/:id/messages',
    'POST /sessions/:id/messages/:messageId/relations',
    'POST /sessions/:id/tool-activities/:activityId',
    'POST /sessions/:id/turns/:turnId/cancel',
  ])
  for (const mustBeForm of [
    'POST /auth/login',
    'POST /a2a/peers',
    'POST /providers/:id/rotate',
    'POST /runners',
    'GET /events',
  ]) {
    const op = catalog.find((candidate) => `${candidate.method} ${candidate.pattern}` === mustBeForm)
    assert.equal(op?.access.kind, 'form', `${mustBeForm} stays form-only`)
  }
  const { byName } = deriveApiTools(catalog)
  assert.ok(!byName.has('api__post_artifacts'), 'the in-app model cannot self-authorize direct Artifact creation')
  assert.ok(byName.has('api__get_admin_users'), 'maintainer reads are present and rely on the same route wall')
  assert.ok(byName.has('api__post_admin_users_by_id_deactivate'), 'maintainer mutations are consent-gated, not hidden')
})

test('the card family is chosen mechanically from the operation shape, total over the surface', () => {
  const catalog = catalogOf(buildRouter())
  const included = catalog.filter((op) => op.access.kind === 'product' && op.access.session !== 'intrinsic' && op.method !== 'GET')
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

  const key = `archive-confirm-${driver.id}`
  const confirmed = await call(
    'POST',
    `/sessions/${driver.id}/tool-activities/${act!.id}`,
    { decision: 'confirm' },
    { 'idempotency-key': key },
  )
  assert.equal(confirmed.status, 200)
  assert.equal(confirmed.json.status, 'done')
  assert.equal(
    confirmed.json.decisionId,
    toolActivityDecisionId(store.defaultTenantId(), driver.id, act!.id, key),
  )
  assert.match(confirmed.json.summary, /PATCH \/api\/v1\/sessions\/.* → 200/)
  assert.equal(store.getSession(s.id)?.status, 'archived', 'the confirm executed the operation')
  const revision = store.getSession(s.id)?.metadataRevision
  const innerReplay = await apiDispatch(
    'PATCH',
    `/sessions/${s.id}`,
    {},
    { status: 'archived' },
    { idempotencyKey: confirmed.json.decisionId },
  )
  assert.equal(innerReplay.headers['idempotency-replayed'], 'true', 'the generated write received its derived decision key')
  assert.equal(store.getSession(s.id)?.metadataRevision, revision, 'inner replay does not revise twice')
  const replay = await call(
    'POST',
    `/sessions/${driver.id}/tool-activities/${act!.id}`,
    { decision: 'confirm' },
    { 'idempotency-key': key },
  )
  assert.equal(replay.json.decisionId, confirmed.json.decisionId)
  assert.equal(store.getSession(s.id)?.metadataRevision, revision, 'lost-response Retry neither re-dispatches nor revises twice')
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

test('tool consent accepts only its exact decision body', async () => {
  const target = store.createSession('strict-consent target')
  const driver = store.createSession('strict-consent driver')
  await callRaw('POST', `/sessions/${driver.id}/messages`, { text: `Please archive session ${target.id}.` })
  const act = lastActivity(driver.id)
  const malformed = await call(
    'POST',
    `/sessions/${driver.id}/tool-activities/${act!.id}`,
    { decision: 'decline', activityId: 'redirected' },
  )
  assert.equal(malformed.status, 400)
  assert.equal(store.getToolActivity(driver.id, act!.id)?.status, 'proposed')
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

test('a granted conversation reader cannot decide its owner\'s proposed tool action', async () => {
  const target = store.createSession('shared-reader target')
  const driver = store.createSession('shared-reader consent')
  await callRaw('POST', `/sessions/${driver.id}/messages`, { text: `Please archive session ${target.id}.` })
  const act = lastActivity(driver.id)
  const grant = store.createGrant(
    {
      subject: { kind: 'session', id: driver.id },
      audience: { kind: 'org', orgId: 'tenant-beta' },
      tier: 'co-own',
    },
    store.defaultTenantId(),
  )
  assert.equal(typeof grant, 'object')
  const reader = await call(
    'POST',
    `/sessions/${driver.id}/tool-activities/${act!.id}`,
    { decision: 'confirm' },
    { 'x-user-id': 'user-grace', 'x-tenant-id': 'tenant-beta', 'idempotency-key': 'reader-cannot-confirm' },
  )
  assert.equal(reader.status, 403, 'visibility never widens effect consent')
  assert.equal(store.getToolActivity(driver.id, act!.id)?.status, 'proposed')
  assert.equal(store.getSession(target.id)?.status ?? 'active', 'active')
})

test('a generated tool proposal cannot erase the conversation carrying its consent record', async () => {
  const driver = store.createSession('self-erasing consent')
  const activityId = `tc-self-delete-${driver.id}`
  store.appendMessage(driver.id, {
    id: store.mintMessageId('assistant'),
    role: 'assistant',
    content: 'I can remove this conversation after review.',
    toolActivities: [{
      id: activityId,
      tool: 'api__delete_sessions_by_id',
      connector: 'Agent Commons API',
      connectorId: 'api',
      kind: 'action',
      status: 'proposed',
      summary: 'Delete this conversation.',
      op: { method: 'DELETE', path: `/sessions/${driver.id}` },
      family: 'danger',
    }],
  })
  const refused = await call(
    'POST',
    `/sessions/${driver.id}/tool-activities/${activityId}`,
    { decision: 'confirm' },
    { 'idempotency-key': `self-delete-${driver.id}` },
  )
  assert.equal(refused.status, 409)
  assert.match(refused.json.error.message, /cannot delete the consent record/i)
  assert.equal(store.getToolActivity(driver.id, activityId)?.status, 'proposed')
  assert.ok(store.getSession(driver.id), 'the dedicated conversation deletion workflow remains the only erase path')
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
