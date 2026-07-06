/** ── Locking tests: the delegated-cognition relay (Session providers) ────────
 *  docs/delegated-cognition-provider.md §11. The whole v1 surface: the mint
 *  branch (probe skipped, toolUse:false stamped, forced tenant scoping, one-time
 *  secret), the slot round-trip through relayReply, the pre-persist gates
 *  (relay_offline / relay_busy), entry-keyed anti-poisoning (410), newest-wins
 *  preemption, socket-or-in-flight liveness, rotate/delete as a kill switch,
 *  degenerate completions, relayReply's own clock (MODEL_TIMEOUT_MS never governs
 *  a relay turn), binding-by-secret restart recovery, and the no-plaintext
 *  persistence invariant. Everything runs in-memory against the real router. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { call, callRaw } from './helpers/http.ts'
import { store } from '../server/store.ts'
import { hashRelaySecret } from '../server/relay.ts'

const PROVIDER_BODY = { label: 'My laptop’s Claude', modelFamily: 'claude', effortLevels: ['Default'], kind: 'session' }
const auth = (secret: string) => ({ authorization: `Bearer ${secret}` })

async function mintSessionProvider(label = PROVIDER_BODY.label) {
  const created = await call('POST', '/providers', { ...PROVIDER_BODY, label })
  assert.equal(created.status, 200)
  return created.json as { id: string; secret: string; secretHint: string; kind: string }
}

/** A session whose Agent runs on the given provider — the turn path's fixture. */
async function sessionOnProvider(providerId: string) {
  const agent = await call('POST', '/agents', { label: `relay-agent-${providerId}`, providerId })
  assert.equal(agent.status, 200)
  const session = await call('POST', '/sessions', { firstMessage: undefined })
  assert.equal(session.status, 200)
  store.setSessionAgent(session.json.id, agent.json.id)
  return { sessionId: session.json.id as string, agentId: agent.json.id as string }
}

function frames(body: string): Array<Record<string, any>> {
  return body
    .split('\n\n')
    .filter(Boolean)
    .map((f) => f.split('\n').find((l) => l.startsWith('data:')))
    .filter((l): l is string => !!l)
    .map((l) => JSON.parse(l.slice(5).trim()))
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Env override scoped to one test (values are read per call server-side). */
async function withEnv(vars: Record<string, string>, run: () => Promise<void>) {
  const prev = new Map(Object.keys(vars).map((k) => [k, process.env[k]] as const))
  Object.assign(process.env, vars)
  try {
    await run()
  } finally {
    for (const [k, v] of prev) {
      if (v === undefined) delete process.env[k]
      else process.env[k] = v
    }
  }
}

// ── The mint branch ───────────────────────────────────────────────────────────

test('minting a Session provider: one-time secret, masked hint, prose-only stamp, no probe', async () => {
  const p = await mintSessionProvider('Mint test')
  assert.ok(p.secret.startsWith('rv_live_'), 'the rendezvous secret is minted server-side')
  assert.equal(p.secretHint, p.secret.slice(-4), 'the row carries only the masked tail')
  assert.equal(p.kind, 'session')
  // The secret never rides a read again — only the hint does.
  const read = await call('GET', `/providers/${p.id}`)
  assert.equal(read.status, 200)
  assert.equal(read.json.secret, undefined, 'the secret is one-time-shown, never re-readable')
  assert.equal(read.json.secretHint, p.secretHint)
  assert.equal(read.json.online, false, 'a fresh relay is offline until its connector polls')
  // The default-inversion lock (§6.3): the server-only config is stamped prose-only.
  const config = store.providerConfig(p.id)
  assert.equal(config.kind, 'session')
  assert.equal(config.capabilities?.toolUse, false, 'toolUse:false is stamped explicitly, never left to the unset default')
})

test('a Session provider registration refuses an endpoint config (nothing to dial)', async () => {
  const r = await call('POST', '/providers', { ...PROVIDER_BODY, config: { baseURL: 'http://127.0.0.1:9' } })
  assert.equal(r.status, 400)
})

test('no plaintext secret persists — only its hash (restart-recovery key, §6.1)', async () => {
  const p = await mintSessionProvider('Hash test')
  const config = store.providerConfig(p.id)
  assert.equal(config.secretHash, hashRelaySecret(p.secret), 'the stored hash is SHA-256 of the shown secret')
  const persisted = JSON.stringify([...store.listProviders(), config])
  assert.ok(!persisted.includes(p.secret), 'the plaintext secret appears nowhere in persistable state')
})

test('PATCH cannot flip a provider’s kind or forge relay fields', async () => {
  const p = await mintSessionProvider('Patch test')
  const patched = await call('PATCH', `/providers/${p.id}`, { label: 'Renamed', kind: 'endpoint', secretHint: 'zzzz' })
  assert.equal(patched.status, 200)
  assert.equal(patched.json.label, 'Renamed')
  assert.equal(patched.json.kind, 'session', 'the transport identity is fixed at mint')
  assert.equal(patched.json.secretHint, p.secretHint, 'the fingerprint is server-stamped')
})

// ── The bearer wall + binding-by-secret ───────────────────────────────────────

test('the relay routes 401 without the (exact) secret; a poll with it IS the binding', async () => {
  const p = await mintSessionProvider('Bearer test')
  assert.equal((await callRaw('GET', '/relay/poll')).status, 401, 'no bearer → 401')
  const wrong = await call('GET', '/relay/poll', undefined, auth('rv_live_wrong'))
  assert.equal(wrong.status, 401, 'a wrong secret → 401')

  await withEnv({ RELAY_POLL_MS: '40' }, async () => {
    const poll = await call('GET', '/relay/poll', undefined, auth(p.secret))
    assert.equal(poll.status, 200)
    assert.deepEqual(poll.json, { idle: true }, 'an empty window returns the re-call sentinel')
  })
  const listed = store.listProviders().find((x) => x.id === p.id)
  assert.equal(listed?.online, true, 'presenting the secret on a poll flipped the relay online — no enrollment call exists')
})

test('binding survives a “restart” (transient state wiped): the held secret alone re-binds', async () => {
  const p = await mintSessionProvider('Restart test')
  await withEnv({ RELAY_POLL_MS: '30' }, async () => {
    await call('GET', '/relay/poll', undefined, auth(p.secret))
  })
  // Simulate the restart's transient amnesia: the relay runtime forgets everything
  // (the real store rebuilds it empty on boot; the provider row + hash rehydrate).
  store.relay.retire(p.id)
  assert.equal(store.listProviders().find((x) => x.id === p.id)?.online, false)
  await withEnv({ RELAY_POLL_MS: '30' }, async () => {
    const again = await call('GET', '/relay/poll', undefined, auth(p.secret))
    assert.equal(again.status, 200, 'the next poll re-binds from the persisted hash alone')
  })
  assert.equal(store.listProviders().find((x) => x.id === p.id)?.online, true)
})

// ── The pre-persist gates ─────────────────────────────────────────────────────

test('a turn on an offline relay refuses fast (relay_offline 503) and persists nothing', async () => {
  const p = await mintSessionProvider('Offline gate')
  const { sessionId } = await sessionOnProvider(p.id)
  const before = store.getSession(sessionId)?.messages?.length ?? 0
  const started = Date.now()
  const send = await callRaw('POST', `/sessions/${sessionId}/messages`, { text: 'hello?' })
  assert.equal(send.status, 503)
  assert.match(send.body, /relay_offline/)
  assert.ok(Date.now() - started < 1_000, 'refused in milliseconds, not at any deadline')
  assert.equal(store.getSession(sessionId)?.messages?.length ?? 0, before, 'the user turn did NOT persist — retry is free')
  // The one-live-turn slot was never taken: an immediate retry meets the same clean gate.
  assert.equal((await callRaw('POST', `/sessions/${sessionId}/messages`, { text: 'again' })).status, 503, 'not a 409 — the turn slot is free')
})

// ── The slot round-trip ───────────────────────────────────────────────────────

test('the round-trip: offer → poll → reply → streamed turn (prose-only, estimated usage)', async () => {
  const p = await mintSessionProvider('Round trip')
  const { sessionId } = await sessionOnProvider(p.id)
  await withEnv({ RELAY_POLL_MS: '2000', RELAY_TIMEOUT_MS: '3000', MODEL_TIMEOUT_MS: '50' }, async () => {
    // Park the puller first (the drain loop's steady state), THEN send.
    const parked = call('GET', '/relay/poll', undefined, auth(p.secret))
    await sleep(10)
    const send = callRaw('POST', `/sessions/${sessionId}/messages`, { text: 'What is our Q3 focus?' })
    const pulled = await parked
    assert.equal(pulled.status, 200)
    assert.ok(pulled.json.entryId, 'the prompt is entry-keyed')
    // The prompt survives as a document (§7.4): system apart from the turns — and
    // carries no tool surface whatsoever (the toolUse:false regression lock is
    // structural here: there is no `tools` field to even omit).
    assert.equal(typeof pulled.json.prompt.system, 'string')
    assert.deepEqual(Object.keys(pulled.json.prompt).sort(), ['messages', 'system'])
    assert.equal(pulled.json.prompt.messages[0].text, 'What is our Q3 focus?')

    // MODEL_TIMEOUT_MS (50ms) must NOT govern this turn — answer well past it.
    await sleep(120)
    const answer = 'Ship the unified workspace.'
    const replied = await call('POST', '/relay/reply', { entryId: pulled.json.entryId, completion: answer }, auth(p.secret))
    assert.equal(replied.status, 200)

    const result = await send
    assert.equal(result.status, 200)
    const fs = frames(result.body)
    const end = fs.find((f) => f.type === 'message.end')
    assert.equal(end?.message.content, answer, 'the far session’s words stream back as the reply')
    // relayReply owns its clock: the turn outlived MODEL_TIMEOUT_MS and was 'ok'.
    const persisted = store.getSession(sessionId)?.messages?.at(-1)
    assert.equal(persisted?.content, answer, 'the reply persisted as the assistant turn')
  })
})

test('a second concurrent turn on the relay refuses (relay_busy 503) while the first is unharmed', async () => {
  const p = await mintSessionProvider('Busy gate')
  const first = await sessionOnProvider(p.id)
  const second = await sessionOnProvider(p.id)
  await withEnv({ RELAY_POLL_MS: '2000', RELAY_TIMEOUT_MS: '3000' }, async () => {
    const parked = call('GET', '/relay/poll', undefined, auth(p.secret))
    await sleep(10)
    const sendA = callRaw('POST', `/sessions/${first.sessionId}/messages`, { text: 'turn A' })
    const pulled = await parked
    // While A is in flight, B refuses pre-persist.
    const sendB = await callRaw('POST', `/sessions/${second.sessionId}/messages`, { text: 'turn B' })
    assert.equal(sendB.status, 503)
    assert.match(sendB.body, /relay_busy/)
    assert.equal(store.getSession(second.sessionId)?.messages?.length ?? 0, 0, 'B persisted nothing')
    await call('POST', '/relay/reply', { entryId: pulled.json.entryId, completion: 'answer A' }, auth(p.secret))
    const a = await sendA
    assert.match(a.body, /answer A/, 'turn A was unharmed by B’s refusal')
  })
})

// ── Entry-keyed anti-poisoning + degenerate completions ──────────────────────

test('a reply naming anything but the live entry is 410 Gone and poisons nothing', async () => {
  const p = await mintSessionProvider('Anti-poison')
  const { sessionId } = await sessionOnProvider(p.id)
  await withEnv({ RELAY_POLL_MS: '2000', RELAY_TIMEOUT_MS: '3000' }, async () => {
    const parked = call('GET', '/relay/poll', undefined, auth(p.secret))
    await sleep(10)
    const send = callRaw('POST', `/sessions/${sessionId}/messages`, { text: 'real turn' })
    const pulled = await parked
    const stale = await call('POST', '/relay/reply', { entryId: 'rve-forged', completion: 'poison' }, auth(p.secret))
    assert.equal(stale.status, 410, 'a wrong entry is Gone — never matched to the live turn')
    const good = await call('POST', '/relay/reply', { entryId: pulled.json.entryId, completion: 'clean answer' }, auth(p.secret))
    assert.equal(good.status, 200)
    const dup = await call('POST', '/relay/reply', { entryId: pulled.json.entryId, completion: 'clean answer' }, auth(p.secret))
    assert.equal(dup.status, 410, 'a network-retry duplicate meets the same settled-or-gone answer')
    assert.match((await send).body, /clean answer/)
  })
})

test('silence falls back at relayReply’s own deadline; the late answer is 410; the slot is free after', async () => {
  const p = await mintSessionProvider('Deadline')
  const { sessionId } = await sessionOnProvider(p.id)
  await withEnv({ RELAY_POLL_MS: '2000', RELAY_TIMEOUT_MS: '150' }, async () => {
    const parked = call('GET', '/relay/poll', undefined, auth(p.secret))
    await sleep(10)
    const send = callRaw('POST', `/sessions/${sessionId}/messages`, { text: 'anyone home?' })
    const pulled = await parked
    const result = await send // no reply — the turn degrades at the relay deadline
    assert.match(result.body, /didn’t answer in time/, 'the relay-specific fallback copy, mid-turn')
    const late = await call('POST', '/relay/reply', { entryId: pulled.json.entryId, completion: 'too late' }, auth(p.secret))
    assert.equal(late.status, 410, 'the orphaned completion is acknowledged and discarded')
    // The one-live-turn slot released through the route's finally — no 409 wedge.
    assert.notEqual((await callRaw('POST', `/sessions/${sessionId}/messages`, { text: 'retry' })).status, 409)
  })
})

test('an explicit connector error and an empty completion both fall back, final (§7.6)', async () => {
  const p = await mintSessionProvider('Degenerate')
  const { sessionId } = await sessionOnProvider(p.id)
  await withEnv({ RELAY_POLL_MS: '2000', RELAY_TIMEOUT_MS: '3000' }, async () => {
    for (const reply of [{ error: 'sampling denied' }, { completion: '   ' }]) {
      const parked = call('GET', '/relay/poll', undefined, auth(p.secret))
      await sleep(10)
      const send = callRaw('POST', `/sessions/${sessionId}/messages`, { text: 'try' })
      const pulled = await parked
      const r = await call('POST', '/relay/reply', { entryId: pulled.json.entryId, ...reply }, auth(p.secret))
      assert.equal(r.status, 200, 'a deliberate answer is accepted — it settles the entry')
      assert.match((await send).body, /couldn’t produce a reply/, 'the turn fell back rather than streaming nothing')
    }
    // A refusal, by contrast, IS a reply — it streams as the turn's content.
    const parked = call('GET', '/relay/poll', undefined, auth(p.secret))
    await sleep(10)
    const send = callRaw('POST', `/sessions/${sessionId}/messages`, { text: 'do something dubious' })
    const pulled = await parked
    await call('POST', '/relay/reply', { entryId: pulled.json.entryId, completion: 'I can’t help with that.' }, auth(p.secret))
    assert.match((await send).body, /I can’t help with that\./)
  })
})

// ── Newest-wins preemption + liveness ────────────────────────────────────────

test('a second poll preempts the parked one (superseded sentinel) — never a 409 to the newcomer', async () => {
  const p = await mintSessionProvider('Newest wins')
  await withEnv({ RELAY_POLL_MS: '2000' }, async () => {
    const zombie = call('GET', '/relay/poll', undefined, auth(p.secret))
    await sleep(10)
    const fresh = call('GET', '/relay/poll', undefined, auth(p.secret))
    const old = await zombie
    assert.deepEqual(old.json, { superseded: true }, 'the zombie socket is told to stand down')
    // The fresh poll now holds the park; hand it a prompt to prove it's the live one.
    await sleep(10)
    const offer = store.relay.offer(p.id, { system: 's', messages: [{ role: 'user', text: 'hi' }] })
    assert.ok(offer)
    const got = await fresh
    assert.equal(got.json.entryId, offer!.entryId, 'the newcomer receives the work')
    store.relay.clear(p.id, offer!.entryId)
  })
})

test('liveness bridges the generation gap: no parked socket + an in-flight entry ≠ offline', async () => {
  const p = await mintSessionProvider('Gap liveness')
  await withEnv({ RELAY_POLL_MS: '50', RELAY_TTL_MS: '120' }, async () => {
    const parked = call('GET', '/relay/poll', undefined, auth(p.secret))
    await sleep(10)
    const offer = store.relay.offer(p.id, { system: 's', messages: [{ role: 'user', text: 'q' }] })
    await parked // the puller took the prompt and left — the generation gap begins
    await sleep(200) // well past the TTL
    assert.equal(store.relay.online(p.id), true, 'the in-flight entry is the proof-of-life (§7.3)')
    store.relay.submit(p.id, offer!.entryId, { kind: 'completion', text: 'done' })
  })
})

test('relay.connected / relay.disconnected fire on the liveness edges (TTL reap)', async () => {
  const p = await mintSessionProvider('Events')
  const seen: string[] = []
  const unsub = store.subscribe((e) => {
    if ((e.type === 'relay.connected' || e.type === 'relay.disconnected') && e.providerId === p.id) seen.push(e.type)
  })
  try {
    await withEnv({ RELAY_POLL_MS: '30', RELAY_TTL_MS: '80' }, async () => {
      await call('GET', '/relay/poll', undefined, auth(p.secret)) // idle after 30ms
      assert.deepEqual(seen, ['relay.connected'])
      await sleep(250) // no re-poll → the reap timer flips it offline
      assert.deepEqual(seen, ['relay.connected', 'relay.disconnected'])
    })
  } finally {
    unsub()
  }
})

// ── Rotate / delete as a kill switch ─────────────────────────────────────────

test('rotate: new one-time secret, old bearer dead instantly, in-flight turn falls back now', async () => {
  const p = await mintSessionProvider('Rotate')
  const { sessionId } = await sessionOnProvider(p.id)
  await withEnv({ RELAY_POLL_MS: '2000', RELAY_TIMEOUT_MS: '5000' }, async () => {
    const parked = call('GET', '/relay/poll', undefined, auth(p.secret))
    await sleep(10)
    const send = callRaw('POST', `/sessions/${sessionId}/messages`, { text: 'mid-flight' })
    const pulled = await parked
    const started = Date.now()
    const rotated = await call('POST', `/providers/${p.id}/rotate`)
    assert.equal(rotated.status, 200)
    assert.ok(rotated.json.secret.startsWith('rv_live_') && rotated.json.secret !== p.secret, 'a fresh secret, shown once')
    assert.equal(rotated.json.secretHint, rotated.json.secret.slice(-4), 'the fingerprint tracks the new secret')

    const result = await send
    assert.ok(Date.now() - started < 2_000, 'the in-flight turn degraded immediately, not at the 5s deadline')
    assert.match(result.body, /couldn’t produce a reply/, 'the kill switch fails the turn to its fallback')

    assert.equal((await call('GET', '/relay/poll', undefined, auth(p.secret))).status, 401, 'the old secret is dead — no grace')
    const lateSubmit = await call('POST', '/relay/reply', { entryId: pulled.json.entryId, completion: 'x' }, auth(p.secret))
    assert.equal(lateSubmit.status, 401, 'an old-secret submit is 401 (identity), not 410 (entry)')

    await withEnv({ RELAY_POLL_MS: '30' }, async () => {
      assert.equal((await call('GET', '/relay/poll', undefined, auth(rotated.json.secret))).status, 200, 'the new secret binds')
    })
  })
})

test('rotate refuses on an endpoint provider (nothing to rotate)', async () => {
  const endpoint = await call('POST', '/providers', { label: 'Plain endpoint', modelFamily: 'claude', effortLevels: ['Default'] })
  assert.equal((await call('POST', `/providers/${endpoint.json.id}/rotate`)).status, 409)
})

test('delete = rotate without a successor: the secret dies with the row', async () => {
  const foreign = { 'x-tenant-id': 'tenant-zeta', 'x-user-id': 'user-zeta' }
  const created = await call('POST', '/providers', { ...PROVIDER_BODY, label: 'Delete' }, foreign)
  const p = created.json as { id: string; secret: string }
  await withEnv({ RELAY_POLL_MS: '30' }, async () => {
    await call('GET', '/relay/poll', undefined, auth(p.secret))
  })
  // The retirement event must be routable to the OWNING tenant — i.e. emitted
  // while the provider row still exists (delete-then-emit would misroute it to
  // the default tenant, since the tenant gate resolves the row).
  const routed: boolean[] = []
  const unsub = store.subscribe((e) => {
    if (e.type === 'relay.disconnected' && e.providerId === p.id) routed.push(store.eventVisibleToTenant(e, 'tenant-zeta'))
  })
  try {
    const del = await call('DELETE', `/providers/${p.id}`, undefined, foreign)
    assert.equal(del.status, 200)
  } finally {
    unsub()
  }
  assert.deepEqual(routed, [true], 'relay.disconnected fired and was visible to the owning tenant at delivery time')
  assert.equal((await call('GET', '/relay/poll', undefined, auth(p.secret))).status, 401, 'a held connector is 401 from here on')
})

// ── Tenant walls ─────────────────────────────────────────────────────────────

test('a Session provider is tenant-scoped: invisible to another tenant, and its relay events are private', async () => {
  const p = await mintSessionProvider('Tenant wall') // created as the default tenant
  const foreign = { 'x-tenant-id': 'tenant-zeta', 'x-user-id': 'user-zeta' }
  const listed = await call('GET', '/providers', undefined, foreign)
  assert.ok(!listed.json.some((x: { id: string }) => x.id === p.id), 'another tenant cannot even see the relay provider')
  assert.equal((await call('GET', `/providers/${p.id}`, undefined, foreign)).status, 404, 'no existence leak')
  assert.equal((await call('POST', `/providers/${p.id}/rotate`, undefined, foreign)).status, 404, 'no foreign kill switch')
  // The liveness events are the owning tenant's private signal (F2/PD9).
  const defaultTenant = store.defaultTenantId()
  assert.equal(store.eventVisibleToTenant({ type: 'relay.connected', providerId: p.id }, defaultTenant), true)
  assert.equal(store.eventVisibleToTenant({ type: 'relay.connected', providerId: p.id }, 'tenant-zeta'), false)
})

// ── The shipped connector carries the outbound-injection wall (§7.9) ─────────

test('the user-side connector ships the prose-only / never-execute standing instruction', async () => {
  const { readFileSync } = await import('node:fs')
  const { fileURLToPath } = await import('node:url')
  // fileURLToPath, not `.pathname` (Windows: `/C:/…` resolves to a phantom `C:\C:\…`).
  const source = readFileSync(fileURLToPath(new URL('../connector/relay-connector.ts', import.meta.url)), 'utf8') as string
  assert.match(source, /prose only/i, 'the standing instruction names the prose-only wall')
  assert.match(source, /never execute/i, '…and the never-execute wall (outbound injection, §7.9)')
  assert.match(source, /respond_and_wait/, 'the blocking drain tool is the connector’s core')
})
