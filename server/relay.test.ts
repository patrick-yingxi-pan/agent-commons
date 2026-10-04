/** ── Locking tests: the delegated-cognition relay (Session providers) ────────
 *  docs/delegated-cognition-provider.md §11. The v1 surface: the mint branch
 *  (probe skipped, explicit capability stamp, forced tenant scoping, one-time
 *  secret), the slot round-trip through relayReply, the pre-persist gates
 *  (relay_offline / relay_busy), entry-keyed anti-poisoning (410), newest-wins
 *  preemption, socket-or-in-flight liveness, rotate/delete as a kill switch,
 *  degenerate completions, relayReply's own clock (MODEL_TIMEOUT_MS never governs
 *  a relay turn), binding-by-secret restart recovery, and the no-plaintext
 *  persistence invariant. Plus the v2 framed mailbox: the declared tool surface,
 *  the relayed-unexecuted tool-call loop (executed into the same consent-gated
 *  proposals a dial-out turn produces), the strict reply validation, the round
 *  cap, and the toolUse:true capability normalisation. Everything runs in-memory
 *  against the real router. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { call, callRaw } from './testkit/http.ts'
import { store } from './store/index.ts'
import { DEFAULT_AGENT } from './data/workers.ts'
import { deriveRelayCreationSecret, deriveRelayRotationSecret, hashRelaySecret, relayReply, RelayRuntime } from './relay.ts'
import { UsageRecordingError } from './modelUsage.ts'
import { messageHistoryText, TOOL_RECEIPT_SYSTEM_ADDITION } from './toolActivityHistory.ts'

const PROVIDER_BODY = { label: 'My laptop’s Claude', modelFamily: 'claude', effortLevels: ['Default'], kind: 'session' }
const auth = (secret: string) => ({ authorization: `Bearer ${secret}` })

async function mintSessionProvider(label = PROVIDER_BODY.label) {
  const created = await call('POST', '/providers', { ...PROVIDER_BODY, label })
  assert.equal(created.status, 200)
  return created.json as { id: string; secret: string; secretHint: string; kind: string }
}

/** A session whose Agent runs on the given provider — the turn path's fixture. */
async function sessionOnProvider(providerId: string) {
  const agent = await call('POST', '/agents', { label: `relay-agent-${providerId}`, providerId, systemPromptId: 'sp-default' })
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

test('Session transport shares exact external-tool approval and durable outcome framing', async () => {
  const relay = new RelayRuntime(() => {})
  const providerId = 'external-mcp-relay-provider'
  const id = `mcp-connection-${'d'.repeat(32)}`
  const tool = { name: 'lookup', inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] } }
  const connection = { id, label: 'External review', revision: 2, status: 'connected', authentication: 'none', inspectedAt: 1, protocolVersion: '2026-07-28', tools: [tool], execution: 'approval-required', executableTools: ['lookup'] }
  const history = [{ role: 'assistant', text: messageHistoryText({ id: 'earlier', role: 'assistant', content: 'Earlier proposal.', toolActivities: [{ id: 'earlier-call', tool: 'lookup', connector: 'External review', connectorId: id, kind: 'action', status: 'uncertain', summary: 'No trustworthy result.', decisionId: 'earlier-receipt' }] }) }]
  const reply = relayReply({ id: 'external-mcp-session', title: 'External MCP' }, DEFAULT_AGENT, 'Use the attached tool.',
    { onStart() {}, onDelta() {} }, undefined, relay, providerId, undefined,
    [{ id, type: 'mcp', label: 'External review', scope: '*' }], history, undefined, [connection])
  const first = await relay.poll(providerId).result
  assert.ok('entryId' in first)
  assert.ok(first.prompt.system.includes(TOOL_RECEIPT_SYSTEM_ADDITION))
  assert.equal(first.prompt.messages[0].text, history[0].text)
  const declaration = first.prompt.tools.find(entry => entry.name.startsWith('mcp_external_'))
  assert.ok(declaration)
  assert.deepEqual(declaration.inputSchema, tool.inputSchema)
  relay.submit(providerId, first.entryId, { kind: 'toolCalls', calls: [{ id: 'external-relayed-call', name: declaration.name, input: { query: 'relay-exact' } }] })
  const second = await relay.poll(providerId).result
  assert.ok('entryId' in second)
  const result = second.prompt.messages.find(turn => turn.toolResults)?.toolResults[0]
  assert.ok(result)
  assert.equal(result.toolCallId, 'external-relayed-call', 'relay correlation retains its wire call id')
  assert.match(result.content, /awaiting their confirmation; not executed yet/)
  relay.submit(providerId, second.entryId, { kind: 'completion', text: 'Approval is required.' })
  const completed = await reply
  assert.equal(completed.outcome, 'ok')
  assert.equal(completed.message.toolActivities[0].status, 'proposed')
  assert.match(completed.message.toolActivities[0].id, /^mcp-activity-[a-f0-9-]{36}$/)
  assert.notEqual(completed.message.toolActivities[0].id, 'external-relayed-call')
  assert.deepEqual(completed.message.toolActivities[0].input, { query: 'relay-exact' })
})

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

test('minting a Session provider: one-time secret, masked hint, explicit capability stamp, no probe', async () => {
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
  // The explicit-stamp lock (§6.3): the capability is the MAILBOX's, code-owned —
  // the v2 framed mailbox relays tool calls, so the mint stamps `toolUse:true`
  // EXPLICITLY (never left to the unset default, which would silently mean the
  // same thing — the dangerous inversion the wall refuses).
  const config = store.providerConfig(p.id)
  assert.equal(config.kind, 'session')
  assert.equal(config.capabilities?.toolUse, true, 'toolUse:true is stamped explicitly, never left to the unset default')
})

test('a keyed relay mint derives stable, tenant-separated bearer material', () => {
  const first = deriveRelayCreationSecret('tenant-relay-a', 'logical-create')
  assert.equal(first, deriveRelayCreationSecret('tenant-relay-a', 'logical-create'))
  assert.notEqual(first, deriveRelayCreationSecret('tenant-relay-b', 'logical-create'))
  assert.match(first, /^rv_live_[A-Za-z0-9_-]{43}$/)
  assert.doesNotMatch(first, /tenant-relay|logical-create/)
})

test('a keyed relay rotation derives stable bearer material separated by tenant and provider', () => {
  const first = deriveRelayRotationSecret('tenant-relay-a', 'provider-a', 'logical-rotation')
  assert.equal(first, deriveRelayRotationSecret('tenant-relay-a', 'provider-a', 'logical-rotation'))
  assert.notEqual(first, deriveRelayRotationSecret('tenant-relay-b', 'provider-a', 'logical-rotation'))
  assert.notEqual(first, deriveRelayRotationSecret('tenant-relay-a', 'provider-b', 'logical-rotation'))
  assert.notEqual(first, deriveRelayCreationSecret('tenant-relay-a', 'logical-rotation'))
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

test('PATCH rejects transport identity and relay fields outside the definition domain', async () => {
  const p = await mintSessionProvider('Patch test')
  const patched = await call('PATCH', `/providers/${p.id}`, { label: 'Renamed', kind: 'endpoint', secretHint: 'zzzz' })
  assert.equal(patched.status, 400)
  const current = store.listProviders().find((provider) => provider.id === p.id)!
  assert.equal(current.label, 'Patch test', 'an invalid mixed patch changes no definition field')
  assert.equal(current.kind, 'session', 'the transport identity is fixed at mint')
  assert.equal(current.secretHint, p.secretHint, 'the fingerprint is server-stamped')
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

test('the round-trip: offer → poll → reply → streamed turn (estimated usage)', async () => {
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
    // The prompt survives as a document (§7.4): system apart from the turns. THIS
    // Agent grants no curated tools (the fixture omits `tools` ⇒ the minimal-risk
    // empty set, INV-9) — what IS declared is exactly the structural generated API
    // surface (access-parity INV-11): every session's assistant can read as the
    // user and PROPOSE any operation, whichever provider serves it.
    assert.equal(typeof pulled.json.prompt.system, 'string')
    // …plus the framing content hashes (v3 dedupe) and the channel naming this
    // conversation (v4 multi-session).
    assert.deepEqual(Object.keys(pulled.json.prompt).sort(), ['channel', 'messages', 'system', 'systemHash', 'tools', 'toolsHash'])
    assert.ok(pulled.json.prompt.tools.length > 50, 'the generated API surface is declared')
    assert.ok(
      pulled.json.prompt.tools.every((t: { name: string }) => t.name.startsWith('api__')),
      'and ONLY it — the empty curated grant stays empty (nothing widened)',
    )
    assert.equal(pulled.json.prompt.channel.id, sessionId, 'the prompt names its conversation')
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

test('a persisted local text attachment reaches relay prompts, then disappears after detach', async () => {
  const p = await mintSessionProvider('Attachment relay')
  const { sessionId } = await sessionOnProvider(p.id)
  const session = (await call('GET', `/sessions/${sessionId}`)).json
  const attachment = {
    id: 'ui-attachment-relay',
    label: 'relay-notes.md',
    kind: 'file',
    source: { id: 'ui-host', kind: 'ui-host', label: 'This computer' },
    previewText: 'RELAY_ATTACHMENT_SENTINEL_91a2: ship the signed release.',
  }
  const workspace = { ...session.workspace, attachments: [attachment] }
  const attached = await call('PATCH', `/sessions/${sessionId}/context-state`, {
    operations: [{ action: 'attach', context: { id: attachment.id, type: 'files', label: attachment.label, scope: '*', source: attachment.source } }],
    workspace,
  })
  assert.equal(attached.status, 200)
  const stored = (await call('GET', `/sessions/${sessionId}`)).json
  assert.equal(stored.workspace.attachments[0].previewText, attachment.previewText, 'the local preview persisted with the workspace')

  await withEnv({ RELAY_POLL_MS: '2000', RELAY_TIMEOUT_MS: '3000' }, async () => {
    const parked = call('GET', '/relay/poll', undefined, auth(p.secret))
    await sleep(10)
    const send = callRaw('POST', `/sessions/${sessionId}/messages`, { text: 'Read the attached note.' })
    const pulled = await parked
    assert.equal(pulled.status, 200)
    const firstText = pulled.json.prompt.messages[0].text as string
    assert.match(firstText, /RELAY_ATTACHMENT_SENTINEL_91a2/)
    assert.match(firstText, /"name":"relay-notes\.md","status":"ready"/)
    await call('POST', '/relay/reply', { entryId: pulled.json.entryId, completion: 'I read the attached note.' }, auth(p.secret))
    assert.equal((await send).status, 200)

    const detached = await call('PATCH', `/sessions/${sessionId}/context-state`, {
      operations: [{ action: 'detach', contextId: attachment.id }],
      workspace: { ...stored.workspace, attachments: [] },
    })
    assert.equal(detached.status, 200)
    const parkedAgain = call('GET', '/relay/poll', undefined, auth(p.secret))
    await sleep(10)
    const sendAgain = callRaw('POST', `/sessions/${sessionId}/messages`, { text: 'What remains attached?' })
    const pulledAgain = await parkedAgain
    assert.equal(pulledAgain.status, 200)
    const secondText = pulledAgain.json.prompt.messages[0].text as string
    assert.doesNotMatch(secondText, /RELAY_ATTACHMENT_SENTINEL_91a2/)
    assert.doesNotMatch(secondText, /attached_files/)
    await call('POST', '/relay/reply', { entryId: pulledAgain.json.entryId, completion: 'Nothing remains attached.' }, auth(p.secret))
    assert.equal((await sendAgain).status, 200)
  })
})

test('one channel admits one turn at a time (relay_busy 503, pre-persist) while the first is unharmed', async () => {
  const p = await mintSessionProvider('Busy gate')
  const { sessionId } = await sessionOnProvider(p.id)
  await withEnv({ RELAY_POLL_MS: '2000', RELAY_TIMEOUT_MS: '3000' }, async () => {
    const parked = call('GET', '/relay/poll', undefined, auth(p.secret))
    await sleep(10)
    const sendA = callRaw('POST', `/sessions/${sessionId}/messages`, { text: 'turn A' })
    const pulled = await parked
    const persisted = store.getSession(sessionId)?.messages?.length ?? 0
    // While A is in flight, a second turn on the SAME conversation refuses pre-persist.
    const sendB = await callRaw('POST', `/sessions/${sessionId}/messages`, { text: 'turn B' })
    assert.equal(sendB.status, 503)
    assert.match(sendB.body, /relay_busy/)
    assert.match(sendB.body, /previous turn/, 'the refusal names the same-conversation cause')
    assert.equal(store.getSession(sessionId)?.messages?.length ?? 0, persisted, 'B persisted nothing')
    await call('POST', '/relay/reply', { entryId: pulled.json.entryId, completion: 'answer A' }, auth(p.secret))
    const a = await sendA
    assert.match(a.body, /answer A/, 'turn A was unharmed by B’s refusal')
  })
})

// ── v4: multi-session relays (channels) ──────────────────────────────────────

test('two conversations run CONCURRENTLY over one relay; entry keys route each answer home', async () => {
  const p = await mintSessionProvider('Concurrent channels')
  const a = await sessionOnProvider(p.id)
  const b = await sessionOnProvider(p.id)
  await withEnv({ RELAY_POLL_MS: '2000', RELAY_TIMEOUT_MS: '5000' }, async () => {
    // The polls ADVERTISE multi-conversation serving (v5 handshake) — without
    // `?channels=` the backend treats the binding as serial and refuses B.
    const parkedA = call('GET', '/relay/poll?channels=4', undefined, auth(p.secret))
    await sleep(10)
    const sendA = callRaw('POST', `/sessions/${a.sessionId}/messages`, { text: 'turn A' })
    const pulledA = await parkedA
    assert.equal(pulledA.json.prompt.channel.id, a.sessionId)

    // B is NOT refused while A is in flight (the v1 relay-wide busy is gone) —
    // its prompt is delivered to the next poll, tagged with ITS channel.
    const parkedB = call('GET', '/relay/poll?channels=4', undefined, auth(p.secret))
    await sleep(10)
    const sendB = callRaw('POST', `/sessions/${b.sessionId}/messages`, { text: 'turn B' })
    const pulledB = await parkedB
    assert.equal(pulledB.json.prompt.channel.id, b.sessionId)
    assert.notEqual(pulledB.json.entryId, pulledA.json.entryId)

    // Answer OUT OF ORDER (B first) — each completion settles only its own entry.
    await call('POST', '/relay/reply', { entryId: pulledB.json.entryId, completion: 'answer B' }, auth(p.secret))
    await call('POST', '/relay/reply', { entryId: pulledA.json.entryId, completion: 'answer A' }, auth(p.secret))
    const [resA, resB] = await Promise.all([sendA, sendB])
    assert.match(resA.body, /answer A/, 'A got A’s answer')
    assert.ok(!resA.body.includes('answer B'), 'no cross-channel leak into A')
    assert.match(resB.body, /answer B/, 'B got B’s answer')
  })
})

test('the concurrency ceiling refuses a NEW conversation pre-persist (RELAY_MAX_INFLIGHT)', async () => {
  const p = await mintSessionProvider('Capacity gate')
  const a = await sessionOnProvider(p.id)
  const b = await sessionOnProvider(p.id)
  await withEnv({ RELAY_POLL_MS: '2000', RELAY_TIMEOUT_MS: '3000', RELAY_MAX_INFLIGHT: '1' }, async () => {
    // The binding advertises 4 — the SERVER cap still bounds the negotiation.
    const parked = call('GET', '/relay/poll?channels=4', undefined, auth(p.secret))
    await sleep(10)
    const sendA = callRaw('POST', `/sessions/${a.sessionId}/messages`, { text: 'turn A' })
    const pulled = await parked
    const sendB = await callRaw('POST', `/sessions/${b.sessionId}/messages`, { text: 'turn B' })
    assert.equal(sendB.status, 503)
    assert.match(sendB.body, /relay_busy/)
    assert.match(sendB.body, /maximum number of conversations \(limit 1\)/, 'the refusal names the NEGOTIATED ceiling')
    assert.equal(store.getSession(b.sessionId)?.messages?.length ?? 0, 0, 'B persisted nothing')
    await call('POST', '/relay/reply', { entryId: pulled.json.entryId, completion: 'answer A' }, auth(p.secret))
    assert.match((await sendA).body, /answer A/)
  })
})

test('a continuation round bypasses the ceiling — a rival channel cannot fail a mid-flight tool loop', async () => {
  const p = await mintSessionProvider('Continuation bypass')
  const promptFor = (ch: string) => ({ system: 's', systemHash: 'a1b2c3d4e5f60718', channel: { id: ch }, messages: [{ role: 'user' as const, text: 'q' }] })
  await withEnv({ RELAY_MAX_INFLIGHT: '1' }, async () => {
    // Channel A's round 1 holds the only slot, settles (as between tool rounds)…
    const round1 = store.relay.offer(p.id, promptFor('chan-a'))
    assert.ok(round1)
    store.relay.submit(p.id, round1!.entryId, { kind: 'completion', text: 'round 1' })
    // …and a rival channel grabs it before round 2 is offered.
    const rival = store.relay.offer(p.id, promptFor('chan-b'))
    assert.ok(rival, 'the freed slot admits the rival')
    assert.equal(store.relay.offer(p.id, promptFor('chan-a')), undefined, 'a NEW offer is refused at the ceiling')
    const round2 = store.relay.offer(p.id, promptFor('chan-a'), true)
    assert.ok(round2, 'the continuation round is admitted — the conversation already underway must finish')
    // The per-channel wall is NOT bypassed: a continuation for a busy channel still refuses.
    assert.equal(store.relay.offer(p.id, promptFor('chan-b'), true), undefined, 'continuation never doubles up a channel')
    store.relay.clear(p.id, rival!.entryId)
    store.relay.clear(p.id, round2!.entryId)
  })
})

// ── v5: the serving handshake ────────────────────────────────────────────────

test('no advertisement = SERIAL: a silent binding is never fanned out to (window 1)', async () => {
  const p = await mintSessionProvider('Silent binding')
  const a = await sessionOnProvider(p.id)
  const b = await sessionOnProvider(p.id)
  await withEnv({ RELAY_POLL_MS: '2000', RELAY_TIMEOUT_MS: '3000' }, async () => {
    // A bare poll (a pre-v4 connector, whose depth-1 buffer would DROP a second
    // undelivered prompt) advertises nothing — the negotiated window is 1.
    const parked = call('GET', '/relay/poll', undefined, auth(p.secret))
    await sleep(10)
    const sendA = callRaw('POST', `/sessions/${a.sessionId}/messages`, { text: 'turn A' })
    const pulled = await parked
    const sendB = await callRaw('POST', `/sessions/${b.sessionId}/messages`, { text: 'turn B' })
    assert.equal(sendB.status, 503, 'a second conversation refuses — nothing is sent the far side never confirmed it can hold')
    assert.match(sendB.body, /limit 1/)
    await call('POST', '/relay/reply', { entryId: pulled.json.entryId, completion: 'answer A' }, auth(p.secret))
    assert.match((await sendA).body, /answer A/)
  })
})

test('the negotiated window = min(server cap, advertisement); re-stated per poll; garbage reads as serial', async () => {
  const p = await mintSessionProvider('Window negotiation')
  await withEnv({ RELAY_POLL_MS: '40', RELAY_MAX_INFLIGHT: '4' }, async () => {
    await call('GET', '/relay/poll?channels=2', undefined, auth(p.secret))
    assert.equal(store.relay.window(p.id), 2, 'the declaration bounds the server cap')
    await call('GET', '/relay/poll?channels=99', undefined, auth(p.secret))
    assert.equal(store.relay.window(p.id), 4, 'the server cap bounds the declaration')
    await call('GET', '/relay/poll?channels=bogus', undefined, auth(p.secret))
    assert.equal(store.relay.window(p.id), 1, 'a malformed advertisement is serial, never widened')
    await call('GET', '/relay/poll?channels=3', undefined, auth(p.secret))
    assert.equal(store.relay.window(p.id), 3, 'the advertisement is stateless — every poll re-states it')
  })
  // The DEFAULT server cap is 8 (the serial-declaration correction, §9.4): at 4
  // it quietly nullified any ambitious declaration; the advertisement clamp is 16.
  await withEnv({ RELAY_POLL_MS: '40' }, async () => {
    await call('GET', '/relay/poll?channels=99', undefined, auth(p.secret))
    assert.equal(store.relay.window(p.id), 8, 'an un-tuned server admits up to 8 declared conversations')
  })
})

test('the observed serving picture: provider reads stamp window + active count; PATCH cannot forge them', async () => {
  const p = await mintSessionProvider('Serving picture')
  const { sessionId } = await sessionOnProvider(p.id)
  await withEnv({ RELAY_POLL_MS: '2000', RELAY_TIMEOUT_MS: '3000' }, async () => {
    const parked = call('GET', '/relay/poll?channels=3', undefined, auth(p.secret))
    await sleep(10)
    const idle = store.listProviders().find((x) => x.id === p.id)!
    assert.equal(idle.conversationWindow, 3, 'the negotiated window is stamped at read time')
    assert.equal(idle.activeConversations, 0, 'nothing in flight yet')

    const send = callRaw('POST', `/sessions/${sessionId}/messages`, { text: 'observe me' })
    const pulled = await parked
    const busy = store.listProviders().find((x) => x.id === p.id)!
    assert.equal(busy.activeConversations, 1, 'the in-flight turn is visible — observed, not attested')

    // Server-stamped means outside this strict write domain.
    const patched = await call('PATCH', `/providers/${p.id}`, { activeConversations: 9, conversationWindow: 99 })
    assert.equal(patched.status, 400)
    const after = store.listProviders().find((x) => x.id === p.id)!
    assert.equal(after.activeConversations, 1, 'the count stays computed')
    assert.equal(after.conversationWindow, 3, 'the window stays negotiated')

    await call('POST', '/relay/reply', { entryId: pulled.json.entryId, completion: 'seen' }, auth(p.secret))
    await send
    assert.equal(store.listProviders().find((x) => x.id === p.id)!.activeConversations, 0, 'settling drains the count')
  })
})

test('relay.activity fires on delivery and settle, and is the owning tenant’s private signal', async () => {
  const p = await mintSessionProvider('Activity events')
  const { sessionId } = await sessionOnProvider(p.id)
  const seen: string[] = []
  const unsub = store.subscribe((e) => {
    if (e.type === 'relay.activity' && e.providerId === p.id) seen.push(e.type)
  })
  try {
    await withEnv({ RELAY_POLL_MS: '2000', RELAY_TIMEOUT_MS: '3000' }, async () => {
      const parked = call('GET', '/relay/poll?channels=2', undefined, auth(p.secret))
      await sleep(10)
      const send = callRaw('POST', `/sessions/${sessionId}/messages`, { text: 'signal' })
      const pulled = await parked
      assert.equal(seen.length, 1, 'delivery emitted one activity signal')
      await call('POST', '/relay/reply', { entryId: pulled.json.entryId, completion: 'done' }, auth(p.secret))
      await send
      assert.equal(seen.length, 2, 'settling emitted the second')
    })
  } finally {
    unsub()
  }
  // Tenant privacy: routed like relay.connected — how busy someone's delegated
  // session is must not be observable across the wall.
  assert.equal(store.eventVisibleToTenant({ type: 'relay.activity', providerId: p.id }, store.defaultTenantId()), true)
  assert.equal(store.eventVisibleToTenant({ type: 'relay.activity', providerId: p.id }, 'tenant-zeta'), false)
})

test('every relayed prompt is SELF-CONTAINED: it carries its conversation’s full prior history', async () => {
  const p = await mintSessionProvider('Self-contained')
  const { sessionId } = await sessionOnProvider(p.id)
  await withEnv({ RELAY_POLL_MS: '2000', RELAY_TIMEOUT_MS: '3000' }, async () => {
    // Turn 1 — no history yet.
    const parked1 = call('GET', '/relay/poll', undefined, auth(p.secret))
    await sleep(10)
    const send1 = callRaw('POST', `/sessions/${sessionId}/messages`, { text: 'first question' })
    const r1 = await parked1
    assert.equal(r1.json.prompt.messages.length, 1, 'a fresh conversation has no history to carry')
    await call('POST', '/relay/reply', { entryId: r1.json.entryId, completion: 'first answer' }, auth(p.secret))
    await send1

    // Turn 2 — the document re-carries the whole exchange, so ANY executor (a
    // fresh sub-agent included) can answer it without per-channel memory.
    const parked2 = call('GET', '/relay/poll', undefined, auth(p.secret))
    await sleep(10)
    const send2 = callRaw('POST', `/sessions/${sessionId}/messages`, { text: 'second question' })
    const r2 = await parked2
    const texts = (r2.json.prompt.messages as Array<{ role: string; text?: string }>).map((m) => `${m.role}:${m.text}`)
    assert.deepEqual(texts, ['user:first question', 'assistant:first answer', 'user:second question'])
    await call('POST', '/relay/reply', { entryId: r2.json.entryId, completion: 'second answer' }, auth(p.secret))
    await send2
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
  // The retirement event must be routable to the OWNING tenant. Atomic deletion
  // publishes only after the row is gone, so emission freezes that routing fact.
  const routed: boolean[] = []
  const unsub = store.subscribe((e) => {
    if (e.type === 'relay.disconnected' && e.providerId === p.id) {
      routed.push(e.tenantId === 'tenant-zeta' && store.eventVisibleToTenant(e, 'tenant-zeta'))
    }
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

// ── v2: structured tool-use over the mailbox ─────────────────────────────────

/** A session whose Agent carries an EXPLICIT tool grant (INV-9: unset = none),
 *  so the relayed prompt declares a callable surface. */
async function sessionWithTools(providerId: string, tools: string[]) {
  const agent = await call('POST', '/agents', { label: `relay-tools-${providerId}`, providerId, systemPromptId: 'sp-default', tools })
  assert.equal(agent.status, 200)
  const session = await call('POST', '/sessions', { firstMessage: undefined })
  assert.equal(session.status, 200)
  store.setSessionAgent(session.json.id, agent.json.id)
  return { sessionId: session.json.id as string }
}

test('the tool-use loop over the mailbox: declared tools → relayed calls → executed results → prose + consent proposals', async () => {
  const p = await mintSessionProvider('Tool loop')
  const { sessionId } = await sessionWithTools(p.id, ['create_project', 'save_artifact'])
  await withEnv({ RELAY_POLL_MS: '2000', RELAY_TIMEOUT_MS: '5000' }, async () => {
    const parked = call('GET', '/relay/poll', undefined, auth(p.secret))
    await sleep(10)
    const send = callRaw('POST', `/sessions/${sessionId}/messages`, { text: 'Create a project called Relay Proto' })
    const round1 = await parked
    // The prompt declares the turn's callable surface — the Agent's explicit grant,
    // renamed to the wire's `inputSchema` (the contract stays SDK-shape-free).
    assert.ok(Array.isArray(round1.json.prompt.tools), 'the prompt document declares the tools')
    const declaredNames = round1.json.prompt.tools.map((t: { name: string }) => t.name)
    assert.deepEqual(
      declaredNames.filter((n: string) => !n.startsWith('api__')).sort(),
      ['create_project', 'save_artifact'],
      'exactly the Agent’s curated grant — nothing widened',
    )
    assert.ok(declaredNames.some((n: string) => n.startsWith('api__')), 'plus the structural generated API surface (INV-11)')
    assert.equal(round1.json.prompt.tools[0].inputSchema.type, 'object', 'each tool carries its input schema')

    // The far session RELAYS a call back, unexecuted; the platform executes it and
    // offers a follow-up entry carrying the result.
    const relayed = await call(
      'POST',
      '/relay/reply',
      { entryId: round1.json.entryId, toolCalls: [{ name: 'create_project', input: { name: 'Relay Proto' } }] },
      auth(p.secret),
    )
    assert.equal(relayed.status, 200)
    const round2 = await call('GET', '/relay/poll', undefined, auth(p.secret))
    assert.equal(round2.status, 200)
    assert.ok(round2.json.entryId, 'the follow-up is a fresh entry through the same slot protocol')
    assert.notEqual(round2.json.entryId, round1.json.entryId)
    const msgs = round2.json.prompt.messages as Array<Record<string, any>>
    const callsTurn = msgs.find((m) => m.toolCalls)
    const resultsTurn = msgs.find((m) => m.toolResults)
    assert.ok(callsTurn && resultsTurn, 'the follow-up document carries the relayed calls AND the executed results')
    assert.equal(callsTurn!.toolCalls[0].name, 'create_project')
    assert.match(callsTurn!.toolCalls[0].id, /^rtc-/, 'call ids are server-minted, never trusted from the wire')
    assert.equal(resultsTurn!.toolResults[0].toolCallId, callsTurn!.toolCalls[0].id, 'the result keys back to the minted id')
    assert.match(resultsTurn!.toolResults[0].content, /awaiting the user/i, 'the result is honest — proposed, not done')

    // Conclude with prose; the turn lands with the SAME consent-gated escalation a
    // dial-out create_project produces.
    await call('POST', '/relay/reply', { entryId: round2.json.entryId, completion: 'Proposed the Relay Proto project — confirm to create it.' }, auth(p.secret))
    const result = await send
    const fs = frames(result.body)
    const escalation = fs.find((f) => f.type === 'message.escalation')
    assert.ok(escalation, 'the relayed tool call landed as a consent-gated escalation')
    assert.equal(escalation!.escalation.kind, 'project')
    assert.equal(escalation!.escalation.project.name, 'Relay Proto')
    const end = fs.find((f) => f.type === 'message.end')
    assert.equal(end?.message.content, 'Proposed the Relay Proto project — confirm to create it.')
  })
})

test('the relay path enforces the shared batch ceiling and marks excess results as errors', async () => {
  const p = await mintSessionProvider('Bounded tool batch')
  const { sessionId } = await sessionWithTools(p.id, ['create_project', 'save_artifact'])
  await withEnv({ RELAY_POLL_MS: '2000', RELAY_TIMEOUT_MS: '5000', MODEL_MAX_TOOL_CALLS: '1' }, async () => {
    const parked = call('GET', '/relay/poll', undefined, auth(p.secret))
    await sleep(10)
    const send = callRaw('POST', `/sessions/${sessionId}/messages`, { text: 'bounded batch' })
    const round1 = await parked
    await call(
      'POST',
      '/relay/reply',
      {
        entryId: round1.json.entryId,
        toolCalls: [
          { name: 'create_project', input: { name: 'Admitted project' } },
          { name: 'save_artifact', input: { name: 'must-not-land.md' } },
        ],
      },
      auth(p.secret),
    )
    const round2 = await call('GET', '/relay/poll', undefined, auth(p.secret))
    const results = (round2.json.prompt.messages as Array<Record<string, any>>).find((m) => m.toolResults)!.toolResults
    assert.equal(results.length, 2, 'the follow-up keys one result to every relayed call')
    assert.equal(results[0].isError, undefined)
    assert.equal(results[1].isError, true)
    assert.match(results[1].content, /batch limit/i)

    await call('POST', '/relay/reply', { entryId: round2.json.entryId, completion: 'The first proposal is ready.' }, auth(p.secret))
    const fs = frames((await send).body)
    assert.equal(fs.find((f) => f.type === 'message.escalation')?.escalation.project.name, 'Admitted project')
    assert.equal(fs.find((f) => f.type === 'message.relations'), undefined, 'the excess save call never executed')
  })
})

for (const clock of ['wall clock', 'lagging wall clock'] as const) {
  test(`a tool consuming the whole relay deadline cannot offer a doomed continuation entry (${clock})`, async (t) => {
    let now = 1_000
    if (clock === 'lagging wall clock') t.mock.method(Date, 'now', () => now)
    await withEnv({ RELAY_POLL_MS: '120', RELAY_TIMEOUT_MS: '50', MODEL_TOOL_TIMEOUT_MS: '500' }, async () => {
      const relay = new RelayRuntime(() => {})
      const providerId = 'provider-deadline-guard'
      const reply = relayReply(
        { id: 'session-deadline-guard', title: 'Deadline guard' },
        DEFAULT_AGENT,
        'read usage',
        { onStart: () => {}, onDelta: () => {} },
        undefined,
        relay,
        providerId,
        undefined,
        [],
        [],
        {
          catalog: [{ method: 'GET', pattern: '/usage', name: 'get_usage', params: [], access: { kind: 'product', session: 'tool' } }],
          dispatch: async () => {
            now = 1_049 // Deliberately leave 1ms when the real clamped timer expires.
            return await new Promise(() => {})
          },
        },
      )
      const first = await relay.poll(providerId).result
      assert.ok('entryId' in first)
      if (!('entryId' in first)) return
      relay.submit(providerId, first.entryId, {
        kind: 'toolCalls',
        calls: [{ id: 'rtc-deadline', name: 'api__get_usage', input: {} }],
      })
      // Park the connector while the API read consumes the remaining turn budget.
      // A continuation offered after expiry would wake this poll with a doomed id.
      const continuation = relay.poll(providerId).result
      const result = await reply
      assert.equal(result.outcome, 'fallback')
      assert.match(result.message.content, /didn’t answer in time/)
      assert.deepEqual(await continuation, { idle: true }, 'no post-deadline continuation reached the far side')
      assert.equal(relay.activeConversations(providerId), 0)
    })
  })
}

test('a shorter tool timeout still permits a relay continuation and preserves completed proposals', async (t) => {
  t.mock.method(Date, 'now', () => 1_000)
  await withEnv({ RELAY_POLL_MS: '120', RELAY_TIMEOUT_MS: '500', MODEL_TOOL_TIMEOUT_MS: '20' }, async () => {
    const relay = new RelayRuntime(() => {})
    const providerId = 'provider-local-timeout'
    const reply = relayReply(
      { id: 'session-local-timeout', title: 'Recoverable tool timeout' },
      { ...DEFAULT_AGENT, tools: ['create_project'] },
      'propose a project and read usage',
      { onStart: () => {}, onDelta: () => {} },
      undefined,
      relay,
      providerId,
      undefined,
      [],
      [],
      {
        catalog: [{ method: 'GET', pattern: '/usage', name: 'get_usage', params: [], access: { kind: 'product', session: 'tool' } }],
        dispatch: async () => await new Promise(() => {}),
      },
    )
    const first = await relay.poll(providerId).result
    assert.ok('entryId' in first)
    if (!('entryId' in first)) return
    relay.submit(providerId, first.entryId, {
      kind: 'toolCalls',
      calls: [
        { id: 'rtc-project', name: 'create_project', input: { name: 'Retained proposal' } },
        { id: 'rtc-local-timeout', name: 'api__get_usage', input: {} },
      ],
    })
    const continuation = await relay.poll(providerId).result
    assert.ok('entryId' in continuation, 'a local timeout does not terminate the whole turn')
    const results = continuation.prompt.messages.find((turn) => turn.toolResults)?.toolResults
    assert.equal(results?.[0].isError, undefined)
    assert.equal(results?.[1].isError, true)
    assert.match(results[1].content, /deadline/)
    relay.submit(providerId, continuation.entryId, { kind: 'completion', text: 'Project proposed; usage unavailable.' })
    const result = await reply
    assert.equal(result.outcome, 'ok')
    assert.equal(result.message.escalation?.project.name, 'Retained proposal')
  })
})

test('relay meters each accepted response before tool effects and aggregates without double-counting', async () => {
  await withEnv({ RELAY_TIMEOUT_MS: '1000' }, async () => {
    const relay = new RelayRuntime(() => {})
    const usage: Array<{ inputTokens: number; outputTokens: number }> = []
    const effects: string[] = []
    const reply = relayReply(
      { id: 'usage-order-session', title: 'Usage order' },
      { ...DEFAULT_AGENT, tools: [] },
      'read usage',
      { onStart: () => {}, onDelta: () => {}, onUsage: (u) => { usage.push(u); effects.push('usage') } },
      undefined,
      relay,
      'usage-order-provider',
      undefined,
      [],
      [],
      {
        catalog: [{ method: 'GET', pattern: '/usage', name: 'get_usage', params: [], access: { kind: 'product', session: 'tool' } }],
        dispatch: async () => {
          effects.push('effect')
          return { status: 200, body: { ok: true } }
        },
      },
    )
    const first = await relay.poll('usage-order-provider').result
    assert.ok('entryId' in first)
    if (!('entryId' in first)) return
    relay.submit('usage-order-provider', first.entryId, {
      kind: 'toolCalls',
      calls: [{ id: 'rtc-usage', name: 'api__get_usage', input: {} }],
    })
    // The callback is synchronous and precedes the dispatch effect.
    const continuation = await relay.poll('usage-order-provider').result
    assert.ok('entryId' in continuation)
    assert.deepEqual(usage.length, 1)
    assert.deepEqual(effects, ['usage', 'effect'])
    if (!('entryId' in continuation)) return
    relay.submit('usage-order-provider', continuation.entryId, { kind: 'completion', text: 'done' })
    const result = await reply
    assert.equal(usage.length, 2)
    assert.deepEqual(result.usage, {
      inputTokens: usage[0].inputTokens + usage[1].inputTokens,
      outputTokens: usage[0].outputTokens + usage[1].outputTokens,
    })
  })
})

test('relay fallback preserves completed tool-call usage after a later timeout', async () => {
  await withEnv({ RELAY_TIMEOUT_MS: '35' }, async () => {
    const relay = new RelayRuntime(() => {})
    const usage: Array<{ inputTokens: number; outputTokens: number }> = []
    const reply = relayReply(
      { id: 'usage-timeout-session', title: 'Usage timeout' },
      { ...DEFAULT_AGENT, tools: [] },
      'read usage',
      { onStart: () => {}, onDelta: () => {}, onUsage: (u) => usage.push(u) },
      undefined,
      relay,
      'usage-timeout-provider',
      undefined,
      [],
      [],
      {
        catalog: [{ method: 'GET', pattern: '/usage', name: 'get_usage', params: [], access: { kind: 'product', session: 'tool' } }],
        dispatch: async () => ({ status: 200, body: { ok: true } }),
      },
    )
    const first = await relay.poll('usage-timeout-provider').result
    assert.ok('entryId' in first)
    if (!('entryId' in first)) return
    // This completed response executes, then the unanswered continuation times
    // out. The first round's usage must remain visible in the fallback.
    relay.submit('usage-timeout-provider', first.entryId, {
      kind: 'toolCalls',
      calls: [{ id: 'rtc-usage-timeout', name: 'api__get_usage', input: {} }],
    })
    const result = await reply
    assert.equal(result.outcome, 'fallback')
    assert.equal(usage.length, 1)
    assert.ok(usage[0].inputTokens > 0)
    assert.ok(usage[0].outputTokens > 0)
    assert.deepEqual(result.usage, usage[0])
  })
})

test('usage recorder failure is terminal before relay tool effects or continuation', async () => {
  await withEnv({ RELAY_POLL_MS: '20', RELAY_TIMEOUT_MS: '1000' }, async () => {
    const relay = new RelayRuntime(() => {})
    let dispatched = 0
    const reply = relayReply(
      { id: 'usage-failure-session', title: 'Usage failure' },
      { ...DEFAULT_AGENT, tools: [] },
      'read usage',
      { onStart: () => {}, onDelta: () => {}, onUsage: () => { throw new Error('meter unavailable') } },
      undefined,
      relay,
      'usage-failure-provider',
      undefined,
      [],
      [],
      {
        catalog: [{ method: 'GET', pattern: '/usage', name: 'get_usage', params: [], access: { kind: 'product', session: 'tool' } }],
        dispatch: async () => { dispatched += 1; return { status: 200, body: {} } },
      },
    )
    const first = await relay.poll('usage-failure-provider').result
    assert.ok('entryId' in first)
    if (!('entryId' in first)) return
    relay.submit('usage-failure-provider', first.entryId, {
      kind: 'toolCalls',
      calls: [{ id: 'rtc-usage-failure', name: 'api__get_usage', input: {} }],
    })
    await assert.rejects(reply, (error: unknown) => error instanceof UsageRecordingError)
    assert.equal(dispatched, 0)
    assert.deepEqual(await relay.poll('usage-failure-provider').result, { idle: true })
  })
})

test('cancellation after a completed relay tool-call preserves its usage report', async () => {
  const relay = new RelayRuntime(() => {})
  const usage: Array<{ inputTokens: number; outputTokens: number }> = []
  const controller = new AbortController()
  const reply = relayReply(
    { id: 'usage-cancel-session', title: 'Usage cancel' },
    { ...DEFAULT_AGENT, tools: [] },
    'read usage',
    { onStart: () => {}, onDelta: () => {}, onUsage: (u) => usage.push(u) },
    controller.signal,
    relay,
    'usage-cancel-provider',
    undefined,
    [],
    [],
    {
      catalog: [{ method: 'GET', pattern: '/usage', name: 'get_usage', params: [], access: { kind: 'product', session: 'tool' } }],
      dispatch: async () => await new Promise(() => {}),
    },
  )
  const first = await relay.poll('usage-cancel-provider').result
  assert.ok('entryId' in first)
  if (!('entryId' in first)) return
  relay.submit('usage-cancel-provider', first.entryId, {
    kind: 'toolCalls',
    calls: [{ id: 'rtc-usage-cancel', name: 'api__get_usage', input: {} }],
  })
  for (let i = 0; i < 20 && usage.length === 0; i += 1) await new Promise<void>((resolve) => setImmediate(resolve))
  assert.equal(usage.length, 1)
  assert.ok(usage[0].inputTokens > 0)
  assert.ok(usage[0].outputTokens > 0)
  controller.abort()
  await assert.rejects(reply)
})

// ── v3: the framing dedupe (context-window economy) ───────────────────────────

test('v3 framing dedupe: a poll advertising cached hashes gets pruned bodies; a fresh poll gets full ones', async () => {
  const p = await mintSessionProvider('Framing dedupe')
  const { sessionId } = await sessionWithTools(p.id, ['create_project'])
  await withEnv({ RELAY_POLL_MS: '2000', RELAY_TIMEOUT_MS: '3000' }, async () => {
    // Turn 1 — a fresh connector advertises nothing: full bodies + content hashes.
    const parked1 = call('GET', '/relay/poll', undefined, auth(p.secret))
    await sleep(10)
    const send1 = callRaw('POST', `/sessions/${sessionId}/messages`, { text: 'turn one' })
    const r1 = await parked1
    const prompt1 = r1.json.prompt
    assert.equal(typeof prompt1.system, 'string', 'full framing on first contact')
    assert.match(prompt1.systemHash, /^[0-9a-f]{16}$/, 'the framing is content-addressed')
    assert.ok(Array.isArray(prompt1.tools))
    assert.match(prompt1.toolsHash, /^[0-9a-f]{16}$/)
    await call('POST', '/relay/reply', { entryId: r1.json.entryId, completion: 'one' }, auth(p.secret))
    await send1

    // Turn 2 — the poll advertises both hashes (the connector's cache): the bodies
    // are stripped at delivery; the hashes always ride.
    const parked2 = call('GET', `/relay/poll?have=${prompt1.systemHash},${prompt1.toolsHash}`, undefined, auth(p.secret))
    await sleep(10)
    const send2 = callRaw('POST', `/sessions/${sessionId}/messages`, { text: 'turn two' })
    const r2 = await parked2
    assert.equal(r2.json.prompt.system, undefined, 'the advertised system body is omitted')
    assert.equal(r2.json.prompt.tools, undefined, 'the advertised tool schemas are omitted')
    assert.equal(r2.json.prompt.systemHash, prompt1.systemHash)
    assert.equal(r2.json.prompt.toolsHash, prompt1.toolsHash)
    await call('POST', '/relay/reply', { entryId: r2.json.entryId, completion: 'two' }, auth(p.secret))
    await send2

    // Turn 3 — a RESTARTED connector (empty cache, no `have`), through the
    // poll-after-offer delivery path this time: full bodies again. Both
    // reconnection cases degrade to resend, never to a hole.
    const send3 = callRaw('POST', `/sessions/${sessionId}/messages`, { text: 'turn three' })
    await sleep(30)
    const r3 = await call('GET', '/relay/poll', undefined, auth(p.secret))
    assert.equal(typeof r3.json.prompt.system, 'string', 'a fresh connector gets the full framing back')
    assert.ok(Array.isArray(r3.json.prompt.tools))
    await call('POST', '/relay/reply', { entryId: r3.json.entryId, completion: 'three' }, auth(p.secret))
    await send3
  })
})

// ── Same-turn chaining over the mailbox (MODEL-20 × the framed relay) ─────────

test('a far session chaining create_system_prompt + create_agent lands ONE bundled agent proposal', async () => {
  const p = await mintSessionProvider('Chained create')
  const { sessionId } = await sessionWithTools(p.id, ['create_system_prompt', 'create_agent'])
  await withEnv({ RELAY_POLL_MS: '2000', RELAY_TIMEOUT_MS: '5000' }, async () => {
    const parked = call('GET', '/relay/poll', undefined, auth(p.secret))
    await sleep(10)
    const send = callRaw('POST', `/sessions/${sessionId}/messages`, { text: "Create an agent called patrick's assistant" })
    const round1 = await parked
    // The far session chains the two creates in one relayed reply — the exact
    // shape that used to strand the agent ("no library prompt — proposed nothing").
    await call(
      'POST',
      '/relay/reply',
      {
        entryId: round1.json.entryId,
        toolCalls: [
          { name: 'create_system_prompt', input: { label: "Patrick's helper", body: 'Help Patrick.' } },
          { name: 'create_agent', input: { label: "patrick's assistant", system_prompt: "Patrick's helper" } },
        ],
      },
      auth(p.secret),
    )
    const round2 = await call('GET', '/relay/poll', undefined, auth(p.secret))
    const results = (round2.json.prompt.messages as Array<Record<string, any>>).find((m) => m.toolResults)!.toolResults
    assert.match(results[1].content, /bundling/i, 'the agent tool reports the fold-in to the far model')
    await call('POST', '/relay/reply', { entryId: round2.json.entryId, completion: 'Proposed the agent — confirm to create it.' }, auth(p.secret))
    const fs = frames((await send).body)
    const relations = fs.find((f) => f.type === 'message.relations')
    assert.ok(relations, 'the turn carries relation proposals')
    assert.equal(relations!.relationActions.length, 1, 'ONE card — the stand-alone prompt proposal was consumed')
    const op = relations!.relationActions[0]
    assert.equal(op.kind, 'create-agent')
    assert.equal(op.label, "patrick's assistant")
    assert.deepEqual(op.newPrompt, { label: "Patrick's helper", body: 'Help Patrick.', targetFamily: 'claude' })
  })
})

test('an ambiguous or malformed reply is refused loudly (400) and settles nothing', async () => {
  const p = await mintSessionProvider('Reply validation')
  const { sessionId } = await sessionWithTools(p.id, ['create_project'])
  await withEnv({ RELAY_POLL_MS: '2000', RELAY_TIMEOUT_MS: '3000' }, async () => {
    const parked = call('GET', '/relay/poll', undefined, auth(p.secret))
    await sleep(10)
    const send = callRaw('POST', `/sessions/${sessionId}/messages`, { text: 'go' })
    const pulled = await parked
    for (const bad of [
      { completion: 'x', toolCalls: [{ name: 'create_project' }] }, // ambiguous — two answer forms
      { toolCalls: [] }, // an empty relay answers nothing
      { toolCalls: [{ name: '' }] },
      { toolCalls: [{ name: 'create_project', input: [1, 2] }] }, // input must be an object
      { toolCalls: 'create_project' }, // not an array
    ]) {
      const r = await call('POST', '/relay/reply', { entryId: pulled.json.entryId, ...bad }, auth(p.secret))
      assert.equal(r.status, 400, `refused: ${JSON.stringify(bad)}`)
    }
    // Nothing settled — the entry is still live; a clean prose reply lands.
    const good = await call('POST', '/relay/reply', { entryId: pulled.json.entryId, completion: 'fine' }, auth(p.secret))
    assert.equal(good.status, 200)
    assert.match((await send).body, /fine/)
  })
})

test('a far session that never concludes is stopped at the shared tool-batch cap — honest fallback, slot freed', async () => {
  const p = await mintSessionProvider('Round cap')
  const { sessionId } = await sessionWithTools(p.id, ['create_project'])
  await withEnv({ RELAY_POLL_MS: '2000', RELAY_TIMEOUT_MS: '5000', MODEL_MAX_TOOL_ROUNDS: '2' }, async () => {
    const parked = call('GET', '/relay/poll', undefined, auth(p.secret))
    await sleep(10)
    const send = callRaw('POST', `/sessions/${sessionId}/messages`, { text: 'loop forever' })
    let pulled = await parked
    // Two batches execute and re-offer; the third relayed batch trips the cap.
    for (let i = 0; i < 3; i += 1) {
      const r = await call('POST', '/relay/reply', { entryId: pulled.json.entryId, toolCalls: [{ name: 'create_project', input: { name: `P${i}` } }] }, auth(p.secret))
      assert.equal(r.status, 200)
      if (i < 2) {
        pulled = await call('GET', '/relay/poll', undefined, auth(p.secret))
        assert.ok(pulled.json.entryId, `round ${i + 1} re-offered`)
      }
    }
    const stopped = frames((await send).body)
    const fallbackText = stopped.filter((f) => f.type === 'message.delta').map((f) => f.text).join('')
    assert.match(fallbackText, /kept relaying tool calls/, 'the runaway loop degrades to the specific fallback')
    const partial = stopped.find((f) => f.type === 'message.escalation')?.escalation
    assert.equal(partial?.project.name, 'P1', 'two completed proposal batches survive; the over-budget P2 batch ran nothing')
    // The one-live-turn slot released — settle a retry through that same slot
    // instead of waiting out the test's whole relay deadline merely to inspect 409.
    const retry = callRaw('POST', `/sessions/${sessionId}/messages`, { text: 'retry' })
    const retried = await call('GET', '/relay/poll', undefined, auth(p.secret))
    assert.ok(retried.json.entryId, 'the retry reached the now-free slot')
    await call('POST', '/relay/reply', { entryId: retried.json.entryId, completion: 'Recovered.' }, auth(p.secret))
    assert.notEqual((await retry).status, 409)
  })
})

test('a relayed call to a tool that was never offered is refused, not executed (grant stays a wall)', async () => {
  const p = await mintSessionProvider('No surface')
  const { sessionId } = await sessionOnProvider(p.id) // no curated grant ⇒ only api__ tools declared
  await withEnv({ RELAY_POLL_MS: '2000', RELAY_TIMEOUT_MS: '3000' }, async () => {
    const parked = call('GET', '/relay/poll', undefined, auth(p.secret))
    await sleep(10)
    const send = callRaw('POST', `/sessions/${sessionId}/messages`, { text: 'try tools' })
    const pulled = await parked
    assert.ok(
      (pulled.json.prompt.tools as Array<{ name: string }>).every((t) => t.name.startsWith('api__')),
      'no curated tool was declared (only the structural API surface)',
    )
    // The far session relays a CURATED tool the Agent never granted: mailbox text
    // is untrusted, so the declared-names wall refuses it — same as generateReply's.
    const r = await call('POST', '/relay/reply', { entryId: pulled.json.entryId, toolCalls: [{ name: 'create_project', input: { name: 'X' } }] }, auth(p.secret))
    assert.equal(r.status, 200, 'the submit is accepted — it settles the entry')
    const round2 = await call('GET', '/relay/poll', undefined, auth(p.secret))
    const resultsTurn = (round2.json.prompt.messages as Array<Record<string, any>>).find((m) => m.toolResults)
    assert.match(resultsTurn!.toolResults[0].content, /not offered this turn/, 'the refusal is fed back, honest and loud')
    await call('POST', '/relay/reply', { entryId: round2.json.entryId, completion: 'Understood.' }, auth(p.secret))
    const fs = (await send).body
    assert.ok(!fs.includes('message.escalation'), 'and nothing executed — no proposal was minted')
  })
})

// (The pre-v2 capability normalisation on rehydrate is locked by
// server/persistence/relay-migrate.test.ts — it needs the real boot path in its own process.)

// ── The shipped connector carries the outbound-injection wall (§7.9) ─────────

test('the user-side connector ships the relay-not-execute standing instruction + the process-owned keepalive', async () => {
  const { readFileSync } = await import('node:fs')
  const { fileURLToPath } = await import('node:url')
  // fileURLToPath, not `.pathname` (Windows: `/C:/…` resolves to a phantom `C:\C:\…`).
  const source = readFileSync(fileURLToPath(new URL('../connector/relay-connector.ts', import.meta.url)), 'utf8') as string
  assert.match(source, /never execute/i, 'the never-execute wall (outbound injection, §7.9)')
  assert.match(source, /unexecuted/i, '…and the v2 relay-not-execute discipline (calls pass through, never run or fabricated)')
  assert.match(source, /respond_and_wait/, 'the blocking drain tool is the connector’s core')
  assert.match(source, /drainLoop/, 'the process-owned keepalive loop exists — liveness no longer rides the model’s calls')
  assert.match(source, /process\.stdin\.on\('end', \(\) => process\.exit/, 'and dies with its host, so an orphan never polls forever')
})
test('relay image capability is opt-in per poll and resets for legacy polls', () => {
  const relay = new RelayRuntime(() => {})
  assert.equal(relay.supportsImages('image-cap'), false)
  relay.poll('image-cap', new Set(), 1, true).abandon()
  assert.equal(relay.supportsImages('image-cap'), true)
  relay.poll('image-cap').abandon()
  assert.equal(relay.supportsImages('image-cap'), false)
})

test('image delivery rechecks the receiving connector capability for queued and parked prompts', async () => {
  for (const parkedFirst of [false, true]) {
    const relay = new RelayRuntime(() => {})
    relay.poll('replace-image-connector', new Set(), 1, true).abandon()
    const prompt = {
      system: 'Reference image', systemHash: 'image-frame',
      messages: [{ role: 'user', text: 'describe', images: [{ mimeType: 'image/png', data: 'private-image-bytes' }] }],
    } as never
    const parked = parkedFirst ? relay.poll('replace-image-connector') : undefined
    const offered = relay.offer('replace-image-connector', prompt)!
    assert.ok(offered)
    const receiving = parked ?? relay.poll('replace-image-connector')
    assert.deepEqual(await receiving.result, { idle: true }, 'legacy connector must not receive image-bearing input')
    assert.deepEqual(await offered.completion, { kind: 'error', reason: 'The connected session no longer supports images. Reconnect with the current connector and try again.' })
    assert.equal(relay.busy('replace-image-connector'), false, 'rejected delivery releases its turn')
  }
})

test('relayReply only delivers captured image blocks to connectors advertising image support', async () => {
  const image = {
    mimeType: 'image/png' as const,
    data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
    width: 1,
    height: 1,
    byteLength: 68,
  }
  const imageId = `img-${'a'.repeat(64)}`
  const session = {
    id: 'relay-image-session',
    title: 'Image relay',
    attachments: [{
      id: 'photo', label: 'photo.png', kind: 'photo' as const,
      source: { id: 'ui-host', kind: 'ui-host' as const, label: 'This computer' },
      image: { id: imageId, mimeType: image.mimeType, width: image.width, height: image.height, byteLength: image.byteLength },
    }],
    images: { [imageId]: image },
  }
  const handlers = { onStart: () => {}, onDelta: () => {} }
  const run = async (images: boolean) => {
    const relay = new RelayRuntime(() => {})
    if (images) relay.poll('image-provider', new Set(), undefined, true).abandon()
    const reply = relayReply(session, DEFAULT_AGENT, 'describe', handlers, undefined, relay, 'image-provider')
    const parked = relay.poll('image-provider', new Set(), undefined, images)
    const entry = await parked.result
    assert.ok('entryId' in entry)
    if (!('entryId' in entry)) return undefined
    const user = entry.prompt.messages.at(-1)
    relay.submit('image-provider', entry.entryId, { kind: 'completion', text: 'done' })
    await reply
    return user?.images
  }

  assert.equal((await run(true))?.[0]?.data, image.data)
  assert.equal(await run(false), undefined)
})

test('relay tool continuation preserves the captured image turn', async () => {
  const image = {
    mimeType: 'image/png' as const,
    data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
    width: 1, height: 1, byteLength: 68,
  }
  const imageId = `img-${'b'.repeat(64)}`
  const session = {
    id: 'relay-image-tool-session', title: 'Image tool round',
    attachments: [{ id: 'photo', label: 'photo.png', kind: 'photo' as const, image: { id: imageId, mimeType: image.mimeType, width: 1, height: 1, byteLength: image.byteLength } }],
    images: { [imageId]: image },
  }
  const relay = new RelayRuntime(() => {})
  relay.poll('image-tool-provider', new Set(), undefined, true).abandon()
  const reply = relayReply(session, { ...DEFAULT_AGENT, tools: ['create_project'] }, 'describe', { onStart: () => {}, onDelta: () => {} }, undefined, relay, 'image-tool-provider')
  const firstPark = relay.poll('image-tool-provider', new Set(), undefined, true)
  const first = await firstPark.result
  assert.ok('entryId' in first)
  if (!('entryId' in first)) return
  relay.submit('image-tool-provider', first.entryId, { kind: 'toolCalls', calls: [{ name: 'create_project', input: { name: 'Image project' } }] })
  const continuation = await relay.poll('image-tool-provider', new Set(), undefined, true).result
  assert.ok('entryId' in continuation)
  if (!('entryId' in continuation)) return
  const user = continuation.prompt.messages.find((turn) => turn.role === 'user' && turn.images?.length)
  assert.equal(user?.images?.[0]?.data, image.data)
  relay.submit('image-tool-provider', continuation.entryId, { kind: 'completion', text: 'done' })
  await reply
})
