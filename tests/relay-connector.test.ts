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
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { API_BASE_PATH } from '../contract/index.ts'

const CONNECTOR = new URL('../connector/relay-connector.ts', import.meta.url).pathname

test('the connector default URL matches where the backend actually mounts its API', () => {
  // Regression: the backend serves everything under API_BASE_PATH (`/api/v1`);
  // a default of bare `/v1` shipped once and 404'd on first real use.
  const source = readFileSync(CONNECTOR, 'utf8')
  assert.match(source, new RegExp(`DEFAULT_URL = 'http://127\\.0\\.0\\.1:8787${API_BASE_PATH.replaceAll('/', '\\/')}'`))
})

/** A minimal relay backend: records every request, serves poll results from a
 *  queue (default idle) and accepts replies. */
interface Seen {
  method: string
  path: string
  auth: string | undefined
  body: string
}
interface RelayStub {
  url: string
  seen: Seen[]
  pollQueue: unknown[]
  close: () => Promise<void>
}

async function startRelayStub(): Promise<RelayStub> {
  const seen: Seen[] = []
  const pollQueue: unknown[] = []
  const server: Server = createServer((req, res) => {
    let body = ''
    req.on('data', (c) => (body += String(c)))
    req.on('end', () => {
      seen.push({ method: req.method ?? '', path: req.url ?? '', auth: req.headers.authorization, body })
      res.setHeader('content-type', 'application/json')
      if (req.url?.endsWith('/relay/poll')) res.end(JSON.stringify(pollQueue.shift() ?? { idle: true }))
      else if (req.url?.endsWith('/relay/reply')) res.end(JSON.stringify({ ok: true }))
      else {
        res.statusCode = 404
        res.end('{}')
      }
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  return {
    url: `http://127.0.0.1:${port}/v1`,
    seen,
    pollQueue,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  }
}

/** Spawn the connector and speak newline-delimited JSON-RPC to it. */
interface Connector {
  rpc: (method: string, params?: unknown) => Promise<{ result?: { content?: { text: string }[]; instructions?: string }; error?: unknown }>
  close: () => void
}

function spawnConnector(env: Record<string, string> = {}): Connector {
  const cleanEnv: Record<string, string | undefined> = { ...process.env }
  delete cleanEnv.RELAY_SECRET
  delete cleanEnv.RELAY_URL
  const child: ChildProcessWithoutNullStreams = spawn(process.execPath, [CONNECTOR], {
    env: { ...cleanEnv, ...env },
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  child.stderr.resume() // drain the log lines
  const pending = new Map<number, (message: never) => void>()
  let buffer = ''
  child.stdout.on('data', (chunk) => {
    buffer += String(chunk)
    let newline = buffer.indexOf('\n')
    while (newline !== -1) {
      const line = buffer.slice(0, newline).trim()
      buffer = buffer.slice(newline + 1)
      if (line) {
        const message = JSON.parse(line) as { id?: number }
        if (message.id !== undefined && pending.has(message.id)) {
          const resolve = pending.get(message.id)!
          pending.delete(message.id)
          resolve(message as never)
        }
      }
      newline = buffer.indexOf('\n')
    }
  })
  let nextId = 1
  return {
    rpc: (method, params) =>
      new Promise((resolve) => {
        const id = nextId++
        pending.set(id, resolve)
        child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`)
      }),
    close: () => child.kill(),
  }
}

const toolText = (reply: { result?: { content?: { text: string }[] } }): string => reply.result?.content?.[0]?.text ?? ''

const callTool = (c: Connector, name: string, args?: Record<string, unknown>) =>
  c.rpc('tools/call', { name, arguments: args }).then(toolText)

test('the connector boots unbound and refuses to drain before the first start latches it', async () => {
  const stub = await startRelayStub()
  const c = spawnConnector()
  try {
    const init = await c.rpc('initialize', {})
    const instructions = (init.result as { instructions?: string })?.instructions ?? ''
    assert.match(instructions, /prose only/i, 'the standing instruction ships through MCP initialize')
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
    assert.equal(stub.seen.length, 1)
    assert.equal(stub.seen[0]!.path, '/v1/relay/poll')
    assert.equal(stub.seen[0]!.auth, 'Bearer rv_live_first', 'the typed secret is the bearer')

    assert.match(await callTool(c, 'start', { secret: 'rv_live_evil' }), /already bound/, 'a different secret is refused')
    assert.match(await callTool(c, 'start', { url: 'http://attacker.example/v1', secret: 'rv_live_first' }), /already bound/, 'a different URL is refused')
    assert.equal(stub.seen.length, 1, 'neither refusal produced a network request')

    assert.match(await callTool(c, 'start', { url: stub.url, secret: 'rv_live_first' }), /Nothing pending/, 'matching credentials drain again')
    assert.equal(stub.seen.length, 2)
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
    assert.equal(stub.seen.length, 1)
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
    assert.match(document, /prose only/i, 'the wall frames every relayed prompt')

    assert.match(await callTool(c, 'respond_and_wait', { entryId: 'rve-7', answer: 'hi there' }), /Nothing pending/, 'submit-and-re-block returns idle')
    const reply = stub.seen.find((s) => s.path === '/v1/relay/reply')
    assert.ok(reply, 'the answer reached the relay')
    assert.deepEqual(JSON.parse(reply.body), { entryId: 'rve-7', completion: 'hi there' }, 'the answer is entry-keyed on the wire')
  } finally {
    c.close()
    await stub.close()
  }
})
