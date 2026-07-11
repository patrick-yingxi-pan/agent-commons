/** ── Locking tests: the session-level model pick (`session.providerId`) ───────
 *  The composer's model selector is WIRING, not preference: picking a model sets
 *  the session's `providerId`, and the turn genuinely routes through that provider
 *  — `session.providerId ?? agent.providerId` (the session pick wins). This locks:
 *  the create/patch surface (validation, tenant scoping, empty-string clear), the
 *  routing resolution (a pick of a Session provider hits the relay gates and the
 *  relay round-trip without any Agent re-binding), per-turn provider provenance on
 *  messages, delete-time pick cleanup, and the registry→selector projection
 *  (`providerModelOptions` — the sync whose absence hard-coded the old list). */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { call, callRaw } from './helpers/http.ts'
import { store } from '../server/store.ts'
import { DEFAULT_PROVIDER_ID, type ModelProvider } from '../contract/index.ts'
import { parseModelChoice, providerModelOptions } from '../src/lib/models.ts'
import { parseModelPrefs } from '../src/lib/modelPrefs.ts'

const auth = (secret: string) => ({ authorization: `Bearer ${secret}` })
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function mintSessionProvider(label: string) {
  const created = await call('POST', '/providers', { label, modelFamily: 'claude', effortLevels: ['Default'], kind: 'session' })
  assert.equal(created.status, 200)
  return created.json as { id: string; secret: string }
}

function frames(body: string): Array<Record<string, any>> {
  return body
    .split('\n\n')
    .filter(Boolean)
    .map((f) => f.split('\n').find((l) => l.startsWith('data:')))
    .filter((l): l is string => !!l)
    .map((l) => JSON.parse(l.slice(5).trim()))
}

// ── The create / patch surface ────────────────────────────────────────────────

test('POST /sessions carries the draft’s model pick; the list row ships it back', async () => {
  const p = await mintSessionProvider('Pick at create')
  const created = await call('POST', '/sessions', { firstMessage: 'hello', providerId: p.id })
  assert.equal(created.status, 200)
  assert.equal(created.json.providerId, p.id)
  const row = (await call('GET', '/sessions')).json.find((s: any) => s.id === created.json.id)
  assert.equal(row.providerId, p.id, 'the composer reads its current pick from the list row')
})

test('an unknown providerId is refused at create and at patch (404, nothing half-writes)', async () => {
  const bad = await call('POST', '/sessions', { firstMessage: 'x', providerId: 'provider-ghost' })
  assert.equal(bad.status, 404)
  const ok = await call('POST', '/sessions', { firstMessage: 'x' })
  const patched = await call('PATCH', `/sessions/${ok.json.id}`, { providerId: 'provider-ghost' })
  assert.equal(patched.status, 404)
  assert.equal(store.getSession(ok.json.id)?.providerId, undefined)
})

test('PATCH sets the pick mid-thread; empty string clears back to the Agent’s provider', async () => {
  const p = await mintSessionProvider('Pick mid-thread')
  const { json: session } = await call('POST', '/sessions', { firstMessage: 'x' })
  const set = await call('PATCH', `/sessions/${session.id}`, { providerId: p.id })
  assert.equal(set.status, 200)
  assert.equal(set.json.providerId, p.id)
  const cleared = await call('PATCH', `/sessions/${session.id}`, { providerId: '' })
  assert.equal(cleared.status, 200)
  assert.equal(cleared.json.providerId, undefined, 'the empty-string clear (the registry convention)')
  assert.equal(store.getSession(session.id)?.providerId, undefined)
})

test('a JSON null clears the pick — the falsy path can never store a non-string', async () => {
  const p = await mintSessionProvider('Null clear')
  const { json: session } = await call('POST', '/sessions', { firstMessage: 'x', providerId: p.id })
  const cleared = await call('PATCH', `/sessions/${session.id}`, { providerId: null })
  assert.equal(cleared.status, 200)
  assert.equal(store.getSession(session.id)?.providerId, undefined, 'null cleared; never assigned')
})

test('the one-seat wall: a flagship (unstamped) session cannot be picked onto a face-private relay', async () => {
  // tenant-acme SEES the unstamped flagship seeds (the same seat's other face), but a
  // model pick is routing, not display chrome: the provider must also be visible to
  // the session's OWNER (the default tenant), or the other face's turns would egress
  // to a drain loop it never chose.
  const acme = { 'x-tenant-id': 'tenant-acme' }
  const minted = await call('POST', '/providers', { label: 'Acme’s relay', modelFamily: 'claude', effortLevels: ['Default'], kind: 'session' }, acme)
  assert.equal(minted.status, 200)
  const refused = await call('PATCH', '/sessions/auth-refactor', { providerId: minted.json.id }, acme)
  assert.equal(refused.status, 404, 'acme’s private relay is refused on the shared seed session')
  assert.equal(store.getSession('auth-refactor')?.providerId, undefined)
  // Non-routing edits keep the demo affordance: the same face can still rename it.
  const renamed = await call('PATCH', '/sessions/auth-refactor', { title: 'Insights dashboard launch' }, acme)
  assert.equal(renamed.status, 200)
})

test('a tenant cannot pick another tenant’s private provider (no cross-tenant routing)', async () => {
  // A session-kind provider is force-stamped with its creator tenant — private.
  const foreign = await call('POST', '/providers', { label: 'Zeta’s relay', modelFamily: 'claude', effortLevels: ['Default'], kind: 'session' }, { 'x-tenant-id': 'tenant-zeta' })
  assert.equal(foreign.status, 200)
  const refused = await call('POST', '/sessions', { firstMessage: 'x', providerId: foreign.json.id }, { 'x-tenant-id': 'tenant-omega' })
  assert.equal(refused.status, 404, 'invisible ⇒ unpickable (no existence leak)')
  const { json: mine } = await call('POST', '/sessions', { firstMessage: 'x' }, { 'x-tenant-id': 'tenant-omega' })
  const patched = await call('PATCH', `/sessions/${mine.id}`, { providerId: foreign.json.id }, { 'x-tenant-id': 'tenant-omega' })
  assert.equal(patched.status, 404)
})

// ── The routing resolution (the pick actually drives the turn) ────────────────

test('a pick of an offline Session provider hits the relay gate — no Agent re-binding involved', async () => {
  const p = await mintSessionProvider('Offline pick')
  const { json: session } = await call('POST', '/sessions', { firstMessage: 'x', providerId: p.id })
  // The session still runs the DEFAULT agent (whose provider resolves to the endpoint
  // default): only the session-level pick routes it to the relay. The wiring under test.
  const agent = store.getAgent(store.getSession(session.id)?.agentId)
  assert.equal(agent.id, 'agent-default')
  assert.equal(agent.providerId ?? DEFAULT_PROVIDER_ID, DEFAULT_PROVIDER_ID)
  const send = await callRaw('POST', `/sessions/${session.id}/messages`, { text: 'hello?' })
  assert.equal(send.status, 503)
  assert.match(send.body, /relay_offline/, 'the session pick — not the agent — chose the transport')
})

test('the full relay round-trip through a session pick; the turn is stamped with the provider', async () => {
  const p = await mintSessionProvider('Round trip via pick')
  const { json: session } = await call('POST', '/sessions', { firstMessage: 'x', providerId: p.id })
  const parked = call('GET', '/relay/poll', undefined, auth(p.secret))
  await sleep(10)
  const send = callRaw('POST', `/sessions/${session.id}/messages`, { text: 'What is our Q3 focus?' })
  const pulled = await parked
  assert.equal(pulled.status, 200)
  assert.equal(pulled.json.prompt.messages.at(-1).text, 'What is our Q3 focus?')
  const replied = await call('POST', '/relay/reply', { entryId: pulled.json.entryId, completion: 'Ship the unified workspace.' }, auth(p.secret))
  assert.equal(replied.status, 200)
  const result = await send
  assert.equal(result.status, 200)
  const end = frames(result.body).find((f) => f.type === 'message.end')
  assert.equal(end?.message.content, 'Ship the unified workspace.')
  // Per-turn provenance: the message records the provider that answered (the pick),
  // alongside the driving agent — so a later model switch can't relabel this turn.
  assert.equal(end?.message.providerId, p.id)
  const persisted = store.getSession(session.id)?.messages?.at(-1)
  assert.equal(persisted?.providerId, p.id, 'the provenance persists with the turn')
})

test('a turn WITHOUT a pick still stamps the resolved (agent’s) provider', async () => {
  const { json: session } = await call('POST', '/sessions', { firstMessage: 'x' })
  const send = await callRaw('POST', `/sessions/${session.id}/messages`, { text: 'plain turn' })
  assert.equal(send.status, 200)
  const persisted = store.getSession(session.id)?.messages?.at(-1)
  assert.equal(persisted?.providerId, DEFAULT_PROVIDER_ID, 'unpicked = the default provider, stamped explicitly')
})

// ── Lifecycle: a deleted provider releases its picks ──────────────────────────

test('deleting a provider clears session picks of it (fallback to the Agent’s provider)', async () => {
  const p = await mintSessionProvider('Delete releases picks')
  const { json: session } = await call('POST', '/sessions', { firstMessage: 'x', providerId: p.id })
  const del = await call('DELETE', `/providers/${p.id}`)
  assert.equal(del.status, 200, 'a pick never wedges a delete (unlike an Agent binding)')
  assert.equal(store.getSession(session.id)?.providerId, undefined, 'the stale pick was cleared')
  const send = await callRaw('POST', `/sessions/${session.id}/messages`, { text: 'still works?' })
  assert.equal(send.status, 200, 'the session routes on the default provider again')
})

// ── The registry → selector projection (the sync that was missing) ────────────

test('parseModelChoice bridges both label kinds; the default-model pref tolerates the new field', () => {
  const options = providerModelOptions([
    { id: 'provider-relay', label: 'My laptop’s Claude', modelFamily: 'claude', effortLevels: ['Default'], kind: 'session' },
  ] as ModelProvider[])
  assert.deepEqual(parseModelChoice('My laptop’s Claude', options), { kind: 'provider', providerId: 'provider-relay' },
    'a provider’s label names that provider')
  assert.deepEqual(parseModelChoice('Claude Haiku 4.5 · Low', options), { kind: 'builtin', modelId: 'haiku', effort: 'low' })
  assert.deepEqual(parseModelChoice('My laptop’s Claude', []), { kind: 'builtin', modelId: 'opus', effort: 'high' },
    'a deleted/renamed provider degrades to the default, never throws')
  // The Customize default: a registered provider persists in ModelPrefs and a
  // legacy blob without the field parses unchanged.
  assert.equal(parseModelPrefs(JSON.stringify({ defaultProviderId: 'provider-relay' })).defaultProviderId, 'provider-relay')
  assert.equal(parseModelPrefs(JSON.stringify({ modelId: 'sonnet' })).defaultProviderId, undefined)
})

test('providerModelOptions projects every registered provider except the built-in default', () => {
  const providers: ModelProvider[] = [
    { id: DEFAULT_PROVIDER_ID, label: 'Anthropic', modelFamily: 'claude', effortLevels: ['Low', 'Medium', 'High'] },
    { id: 'provider-gw', label: 'Corp gateway', modelFamily: 'claude', effortLevels: ['Standard'] },
    { id: 'provider-relay', label: 'My laptop’s Claude', modelFamily: 'claude', effortLevels: ['Default'], kind: 'session', online: true },
  ]
  const options = providerModelOptions(providers)
  assert.deepEqual(options.map((o) => o.providerId), ['provider-gw', 'provider-relay'],
    'the default provider is the built-in Claude trio, never a duplicate row')
  assert.equal(options[0]!.kind, 'endpoint', 'unset kind normalizes to endpoint')
  assert.equal(options[1]!.kind, 'session')
  assert.equal(options[1]!.online, true, 'the selector shows the relay liveness dot')
  assert.deepEqual(options[1]!.effortLevels, ['Default'], 'provider-local effort vocabulary rides along')
  assert.match(options[1]!.blurb, /prose only/i, 'a Session provider declares its limitation in the list')
})
