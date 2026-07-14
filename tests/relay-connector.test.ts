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
    assert.equal(stub.seen[0]!.path, '/v1/relay/poll')
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
    assert.ok(stub.seen.every((s) => s.path === '/v1/relay/poll' && s.auth === 'Bearer rv_live_alive'))
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
