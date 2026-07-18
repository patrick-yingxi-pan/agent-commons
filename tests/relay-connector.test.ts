/** ── Locking tests: the generic user-side connector and its first-call latch ──
 *  docs/delegated-cognition-provider.md §4.2. The connector is registered ONCE,
 *  generically; per-session the user types the relay URL + rendezvous secret and
 *  the model passes them to `start`. The security invariant under test: the
 *  FIRST credentials win — a later `start` with different credentials (the shape
 *  an injected relayed prompt would take to turn the connector into an egress
 *  channel) is refused without a single network request. Env vars pre-latch.
 *
 *  These tests spawn the REAL connector process (stdio JSON-RPC, Node's native
 *  TS) against a tiny in-test relay stub, so they lock the wire behavior, not a
 *  transcript of it. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { API_BASE_PATH } from '../contract/index.ts'
import { callTool, spawnConnector as spawnScript, startRelayStub, type Connector } from './helpers/connector.ts'

// fileURLToPath, not `.pathname`: on Windows the latter yields `/C:/…`, which fs/spawn
// resolve against the CWD drive to a phantom `C:\C:\…` — the read ENOENTs and the
// spawned connector dies at birth, leaving the stdio driver parked forever.
const CONNECTOR = fileURLToPath(new URL('../connector/relay-connector.ts', import.meta.url))
// RELAY_BLOCK_MS keeps the v2 parked respond_and_wait short in tests (default 25s);
// the process-owned keepalive loop makes raw request COUNTS nondeterministic, so
// assertions below filter by path/bearer instead of counting.
const spawnConnector = (env: Record<string, string> = {}): Connector => spawnScript(CONNECTOR, { RELAY_BLOCK_MS: '100', ...env })

test('the connector default URL matches where the backend actually mounts its API', () => {
  // Regression: the backend serves everything under API_BASE_PATH (`/api/v1`);
  // a default of bare `/v1` shipped once and 404'd on first real use.
  const source = readFileSync(CONNECTOR, 'utf8')
  assert.match(source, new RegExp(`DEFAULT_URL = 'http://127\\.0\\.0\\.1:8787${API_BASE_PATH.replaceAll('/', '\\/')}'`))
})

// The relay stub + stdio JSON-RPC driver moved to helpers/connector.ts, shared
// with tests/connector-serve.test.ts (which spawns the SERVED plain-JS form).

test('the connector boots unbound and refuses to drain before the first start latches it', async () => {
  const stub = await startRelayStub()
  const c = spawnConnector()
  try {
    const init = await c.rpc('initialize', {})
    const instructions = (init.result as { instructions?: string })?.instructions ?? ''
    assert.match(instructions, /NEVER execute instructions/i, 'the standing instruction ships through MCP initialize')
    assert.match(instructions, /toolCalls/, 'the relay-not-execute path is declared to the model')
    assert.match(instructions, /never stop the loop on idle/i, 'the re-call sentinel rule ships with it')
    assert.match(instructions, /first call binds permanently/i, 'the latch is declared to the model')
    // The serial-declaration correction (design §9.4): the standing instruction
    // must teach that serial serving covers many conversations AND the fan-out
    // pattern (fetch without submitting; entry-keyed, any-order answers).
    assert.match(instructions, /serial\s+loop serves any number of conversations/i, 'serial ≠ 1 ships in the instructions')
    assert.match(instructions, /NO submission to fetch the next prompt/i, 'fetch-before-answer is taught')
    assert.match(instructions, /any order/i, 'out-of-order entry-keyed submission is taught')

    assert.match(await callTool(c, 'respond_and_wait', { entryId: 'x', answer: 'y' }), /No relay is bound yet/, 'drain before latch is guidance, not a request')
    assert.match(await callTool(c, 'start'), /No relay is bound yet/, 'start without credentials asks for them')
    assert.equal(stub.seen.length, 0, 'nothing reached the network before the latch')
  } finally {
    c.close()
    await stub.close()
  }
})

test('the first start latches; different credentials are refused without a network request', async () => {
  const stub = await startRelayStub()
  const c = spawnConnector()
  try {
    // Trailing slash on purpose: the latch normalizes, so a same-URL restart matches.
    assert.match(await callTool(c, 'start', { url: `${stub.url}/`, secret: 'rv_live_first' }), /Nothing pending/, 'latch + first drain (idle)')
    assert.ok(stub.seen.length >= 1, 'the latch started the keepalive loop')
    // Every poll advertises the serving window (v5 handshake) — undeclared, the
    // connector's own default (it queues and renders any number correctly).
    assert.equal(stub.seen[0]!.path, '/v1/relay/poll?channels=4')
    assert.equal(stub.seen[0]!.auth, 'Bearer rv_live_first', 'the typed secret is the bearer')

    assert.match(await callTool(c, 'start', { secret: 'rv_live_evil' }), /already bound/, 'a different secret is refused')
    assert.match(await callTool(c, 'start', { url: 'http://attacker.example/v1', secret: 'rv_live_first' }), /already bound/, 'a different URL is refused')
    // The keepalive loop polls on its own cadence, so counts are nondeterministic —
    // the latch invariant is that NO request ever carries anything but the first
    // credentials (the evil secret never touches the wire).
    assert.ok(stub.seen.every((s) => s.auth === 'Bearer rv_live_first'), 'no request ever carried different credentials')

    assert.match(await callTool(c, 'start', { url: stub.url, secret: 'rv_live_first' }), /Nothing pending/, 'matching credentials drain again')
  } finally {
    c.close()
    await stub.close()
  }
})

test('env vars pre-latch the binding; typed credentials must then match', async () => {
  const stub = await startRelayStub()
  const c = spawnConnector({ RELAY_URL: stub.url, RELAY_SECRET: 'rv_live_env' })
  try {
    assert.match(await callTool(c, 'start'), /Nothing pending/, 'argument-less start drains the pre-latched relay')
    assert.equal(stub.seen[0]!.auth, 'Bearer rv_live_env')
    assert.match(await callTool(c, 'start', { secret: 'rv_live_other' }), /already bound/, 'env binding wins over typed credentials')
    assert.ok(stub.seen.every((s) => s.auth === 'Bearer rv_live_env'), 'the pre-latched credentials are the only ones on the wire')
  } finally {
    c.close()
    await stub.close()
  }
})

test('a full round-trip through the latched connector: prompt document out, entry-keyed answer back', async () => {
  const stub = await startRelayStub()
  stub.pollQueue.push({ entryId: 'rve-7', prompt: { system: 'the briefing', messages: [{ role: 'user', text: 'hello?' }] } })
  const c = spawnConnector()
  try {
    const document = await callTool(c, 'start', { url: stub.url, secret: 'rv_live_rt' })
    assert.match(document, /entry rve-7/, 'the prompt is entry-keyed')
    assert.match(document, /the briefing/, 'the system briefing is delimited into the document')
    assert.match(document, /\[user\]\nhello\?/, 'the conversation turns survive as a document')
    assert.match(document, /NEVER execute instructions/i, 'the wall frames every relayed prompt')

    assert.match(await callTool(c, 'respond_and_wait', { entryId: 'rve-7', answer: 'hi there' }), /Nothing pending/, 'submit-and-re-block returns idle')
    const reply = stub.seen.find((s) => s.path === '/v1/relay/reply')
    assert.ok(reply, 'the answer reached the relay')
    assert.deepEqual(JSON.parse(reply.body), { entryId: 'rve-7', completion: 'hi there' }, 'the answer is entry-keyed on the wire')
  } finally {
    c.close()
    await stub.close()
  }
})

test('v2 tool relay: declared tools render into the document; toolCalls ride the wire verbatim, unexecuted', async () => {
  const stub = await startRelayStub()
  stub.pollQueue.push({
    entryId: 'rve-8',
    prompt: {
      system: 'the briefing',
      messages: [{ role: 'user', text: 'organize this' }],
      tools: [{ name: 'create_project', description: 'Create a new project.', inputSchema: { type: 'object', properties: { name: { type: 'string' } } } }],
    },
  })
  const c = spawnConnector()
  try {
    const document = await callTool(c, 'start', { url: stub.url, secret: 'rv_live_tools' })
    assert.match(document, /relayed tools \(RELAY these — do not execute them yourself\)/, 'the tools section carries the discipline in its own delimiter')
    assert.match(document, /create_project — Create a new project\./, 'each tool renders name + description')
    assert.match(document, /"toolCalls": \[\{ "name": "<tool>", "input": \{ … \} \}\]/, 'the model is told the structural relay shape')

    // The relayed calls go back as STRUCTURE (MCP-validated), not fenced prose.
    assert.match(
      await callTool(c, 'respond_and_wait', { entryId: 'rve-8', toolCalls: [{ name: 'create_project', input: { name: 'Relay Proto' } }] }),
      /Nothing pending/,
    )
    const reply = stub.seen.find((s) => s.path === '/v1/relay/reply')
    assert.ok(reply, 'the relayed calls reached the relay')
    assert.deepEqual(
      JSON.parse(reply.body),
      { entryId: 'rve-8', toolCalls: [{ name: 'create_project', input: { name: 'Relay Proto' } }] },
      'toolCalls ride the wire verbatim — no completion, no execution',
    )
    // Passing both answer forms at once is refused connector-side, without a request.
    const before = stub.seen.filter((s) => s.path === '/v1/relay/reply').length
    assert.match(await callTool(c, 'respond_and_wait', { entryId: 'rve-8', answer: 'x', toolCalls: [{ name: 'create_project' }] }), /not both/)
    assert.equal(stub.seen.filter((s) => s.path === '/v1/relay/reply').length, before, 'the ambiguous submit never left the process')
  } finally {
    c.close()
    await stub.close()
  }
})

test('v3 framing dedupe: the connector caches by hash, advertises on the poll, and renders references not reprints', async () => {
  const stub = await startRelayStub()
  const TOOLS = [{ name: 'create_project', description: 'Create a new project.', inputSchema: { type: 'object' } }]
  stub.pollQueue.push({
    entryId: 'rve-a',
    prompt: { system: 'the long briefing text', systemHash: 'aaaa111122223333', messages: [{ role: 'user', text: 'first ask' }], tools: TOOLS, toolsHash: 'bbbb111122223333' },
  })
  const c = spawnConnector()
  try {
    const doc1 = await callTool(c, 'start', { url: stub.url, secret: 'rv_live_dedupe' })
    assert.match(doc1, /the long briefing text/, 'first contact renders the full framing')
    assert.match(doc1, /create_project — Create a new project\./, 'and the full tool schemas')

    // From now on every poll advertises the cached hashes.
    await callTool(c, 'respond_and_wait', { entryId: 'rve-a', answer: 'ok' })
    const advertisedPoll = stub.seen.filter((s) => s.path.includes('/relay/poll?') && s.path.includes('have=')).at(-1)
    assert.ok(advertisedPoll, 'the poll advertises the cache')
    assert.ok(advertisedPoll!.path.includes('aaaa111122223333') && advertisedPoll!.path.includes('bbbb111122223333'), 'both hashes ride the advertisement')

    // A pruned prompt (as the server sends once advertised) renders one-line
    // references to what the session already read — never a reprint.
    stub.pollQueue.push({
      entryId: 'rve-b',
      prompt: { systemHash: 'aaaa111122223333', messages: [{ role: 'user', text: 'second ask' }], toolsHash: 'bbbb111122223333' },
    })
    await new Promise((r) => setTimeout(r, 1_300)) // let the drain loop collect it
    const doc2 = await callTool(c, 'respond_and_wait', {})
    assert.match(doc2, /entry rve-b/)
    assert.match(doc2, /unchanged — identical to the briefing relayed with entry rve-a/, 'the framing is a reference')
    assert.match(doc2, /the same 1 tools declared with entry rve-a/, 'the tools are a reference')
    assert.ok(!doc2.includes('the long briefing text'), 'the briefing body is not reprinted')
    assert.ok(!doc2.includes('Create a new project.'), 'the schemas are not reprinted')
    assert.match(doc2, /"toolCalls": \[\{ "name": "<tool>", "input": \{ … \} \}\]/, 'the relay instructions still declare the tool path — the surface is unchanged, only its printing')
  } finally {
    c.close()
    await stub.close()
  }
})

test('v3 suffix rendering: a follow-up entry re-carrying the exchange prints only the new turns', async () => {
  const stub = await startRelayStub()
  const first = { role: 'user', text: 'organize this' }
  stub.pollQueue.push({
    entryId: 'rve-c',
    prompt: { system: 's', systemHash: 'cccc111122223333', messages: [first], tools: [{ name: 'create_project', description: 'd', inputSchema: {} }], toolsHash: 'dddd111122223333' },
  })
  const c = spawnConnector()
  try {
    const doc1 = await callTool(c, 'start', { url: stub.url, secret: 'rv_live_suffix' })
    assert.match(doc1, /organize this/)
    await callTool(c, 'respond_and_wait', { entryId: 'rve-c', toolCalls: [{ name: 'create_project', input: { name: 'X' } }] })
    // The platform's follow-up entry re-carries the WHOLE exchange (the mailbox is
    // stateless across entries) — the connector prints only the new suffix.
    stub.pollQueue.push({
      entryId: 'rve-d',
      prompt: {
        systemHash: 'cccc111122223333',
        toolsHash: 'dddd111122223333',
        messages: [
          first,
          { role: 'assistant', toolCalls: [{ id: 'rtc-1', name: 'create_project', input: { name: 'X' } }] },
          { role: 'user', toolResults: [{ toolCallId: 'rtc-1', content: 'Proposed to the user — awaiting confirmation.' }] },
        ],
      },
    })
    await new Promise((r) => setTimeout(r, 1_300)) // let the drain loop collect it
    const doc2 = await callTool(c, 'respond_and_wait', {})
    assert.match(doc2, /continuing the exchange of entry rve-c/, 'the follow-up names the exchange it continues')
    assert.match(doc2, /first 1 turn\(s\) are unchanged/, 'and how much is elided')
    assert.match(doc2, /new turns only/)
    assert.match(doc2, /awaiting confirmation/, 'the executed results — the actual news — are printed')
    assert.ok(!doc2.includes('organize this'), 'the already-read turn prefix is not reprinted')
  } finally {
    c.close()
    await stub.close()
  }
})

test('v4 channels: prompts name their conversation; suffix continuity is PER-CHANNEL across interleaving', async () => {
  const stub = await startRelayStub()
  const c = spawnConnector()
  try {
    stub.pollQueue.push({
      entryId: 'rve-a1',
      prompt: { system: 's', systemHash: 'eeee111122223333', channel: { id: 'sess-a', title: 'Alpha docs' }, messages: [{ role: 'user', text: 'alpha one' }] },
    })
    const docA1 = await callTool(c, 'start', { url: stub.url, secret: 'rv_live_chan' })
    assert.match(docA1, /for the conversation “Alpha docs” \[sess-a\]/, 'the prompt names its conversation')
    assert.match(docA1, /self-contained/, 'the model is told the document stands alone')
    assert.match(docA1, /sub-agent/, '…and that delegating it is fine')
    await callTool(c, 'respond_and_wait', { entryId: 'rve-a1', answer: 'A1' })

    // A DIFFERENT conversation interleaves — rendered in full (its own first
    // contact), without disturbing channel A's continuity state.
    stub.pollQueue.push({
      entryId: 'rve-b1',
      prompt: { systemHash: 'eeee111122223333', channel: { id: 'sess-b' }, messages: [{ role: 'user', text: 'beta one' }] },
    })
    await new Promise((r) => setTimeout(r, 1_300))
    const docB1 = await callTool(c, 'respond_and_wait', {})
    assert.match(docB1, /for the conversation sess-b \[sess-b\]/, 'a title-less channel falls back to its id')
    assert.match(docB1, /beta one/)
    await callTool(c, 'respond_and_wait', { entryId: 'rve-b1', answer: 'B1' })

    // Channel A's next turn re-carries its whole history (self-contained wire);
    // the connector still recognises it as a continuation OF A — B's interleaved
    // render didn't corrupt the per-channel prefix.
    stub.pollQueue.push({
      entryId: 'rve-a2',
      prompt: {
        systemHash: 'eeee111122223333',
        channel: { id: 'sess-a', title: 'Alpha docs' },
        messages: [
          { role: 'user', text: 'alpha one' },
          { role: 'assistant', text: 'A1' },
          { role: 'user', text: 'alpha two' },
        ],
      },
    })
    await new Promise((r) => setTimeout(r, 1_300))
    const docA2 = await callTool(c, 'respond_and_wait', {})
    assert.match(docA2, /continuing the exchange of entry rve-a1/, 'channel A continues from ITS last entry')
    assert.match(docA2, /alpha two/)
    assert.ok(!docA2.includes('alpha one'), 'the already-read prefix is not reprinted')
  } finally {
    c.close()
    await stub.close()
  }
})

test('v4 queue: prompts arriving while the model is away queue up and deliver one per call, in arrival order', async () => {
  const stub = await startRelayStub()
  const c = spawnConnector()
  try {
    await callTool(c, 'start', { url: stub.url, secret: 'rv_live_queue' })
    // Two concurrent channels' prompts land while no model call is parked.
    stub.pollQueue.push({ entryId: 'rve-q1', prompt: { system: 's', channel: { id: 'c1' }, messages: [{ role: 'user', text: 'first in' }] } })
    stub.pollQueue.push({ entryId: 'rve-q2', prompt: { system: 's', channel: { id: 'c2' }, messages: [{ role: 'user', text: 'second in' }] } })
    await new Promise((r) => setTimeout(r, 1_800)) // let the loop collect both
    const doc1 = await callTool(c, 'respond_and_wait', {})
    assert.match(doc1, /entry rve-q1/, 'the first arrival is delivered first')
    const doc2 = await callTool(c, 'respond_and_wait', { entryId: 'rve-q1', answer: 'one' })
    assert.match(doc2, /entry rve-q2/, 'the next call gets the next queued prompt — nothing dropped')
  } finally {
    c.close()
    await stub.close()
  }
})

test('v5 serving declaration: start(conversations) is advertised on every poll and LATCHES with the binding', async () => {
  const stub = await startRelayStub()
  const c = spawnConnector()
  try {
    assert.match(await callTool(c, 'start', { url: stub.url, secret: 'rv_live_decl', conversations: 2 }), /Nothing pending/)
    assert.ok(stub.seen.length >= 1)
    assert.ok(
      stub.seen.every((s) => s.path.startsWith('/v1/relay/poll?channels=2')),
      'the model’s declaration rides every poll — the backend never fans out beyond it',
    )
    // The declaration latches with the binding: a later differing value is the
    // shape an injected relayed prompt would use to throttle or overload the
    // relay — refused, and nothing changes on the wire.
    assert.match(await callTool(c, 'start', { url: stub.url, secret: 'rv_live_decl', conversations: 8 }), /already bound/)
    assert.ok(stub.seen.every((s) => s.path.startsWith('/v1/relay/poll?channels=2')), 'the wire still carries the latched declaration')
    // Re-stating the SAME declaration (or none) is a normal re-drain, not a redirect.
    assert.match(await callTool(c, 'start', { url: stub.url, secret: 'rv_live_decl', conversations: 2 }), /Nothing pending/)
    assert.match(await callTool(c, 'start', { url: stub.url, secret: 'rv_live_decl' }), /Nothing pending/)
  } finally {
    c.close()
    await stub.close()
  }
})

test('the keepalive loop is the process’s, not the model’s: polling continues with no tool call in flight', async () => {
  const stub = await startRelayStub()
  const c = spawnConnector()
  try {
    await callTool(c, 'start', { url: stub.url, secret: 'rv_live_alive' })
    // No further tool calls — the model has gone idle. The loop must keep polling
    // (throttled by the idle floor), because liveness is the CONNECTOR's job now.
    const after = stub.seen.length
    await new Promise((r) => setTimeout(r, 1_300))
    assert.ok(stub.seen.length > after, 'polls continued while no model call was parked (the process-owned keepalive)')
    assert.ok(stub.seen.every((s) => s.path.startsWith('/v1/relay/poll?channels=') && s.auth === 'Bearer rv_live_alive'))
  } finally {
    c.close()
    await stub.close()
  }
})

test('a prompt that arrives while no model call is parked is buffered and handed to the next call', async () => {
  const stub = await startRelayStub()
  const c = spawnConnector()
  try {
    await callTool(c, 'start', { url: stub.url, secret: 'rv_live_buf' })
    // The model is idle; the backend offers a turn — the loop takes it into the buffer.
    stub.pollQueue.push({ entryId: 'rve-9', prompt: { system: 's', messages: [{ role: 'user', text: 'late arrival' }] } })
    await new Promise((r) => setTimeout(r, 1_300)) // let the loop collect it
    const document = await callTool(c, 'respond_and_wait', {})
    assert.match(document, /entry rve-9/, 'the buffered prompt is delivered on the model’s next call')
    assert.match(document, /late arrival/)
  } finally {
    c.close()
    await stub.close()
  }
})
