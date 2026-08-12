/** ── The MCP door's stateful half (server/mcp.ts, PORT-9/INV-11) ──────────────
 *  Sessions (`Mcp-Session-Id` minted at initialize; DELETE ends one), the
 *  server→client GET stream that BRIDGES the ambient event log (tenant-gated
 *  with the same `eventVisibleToTenant` wall as `GET /events`), resources
 *  (mirrors of the GET surface — parameterless as static resources,
 *  parameterized as templates, read through the router as the caller), prompts
 *  (the system-prompt library), and the pinned-Origin refusal. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { call, callRaw } from '../testkit/http.ts'
import { buildRouter } from './index.ts'
import { store } from '../store/index.ts'

let seq = 0
const rpc = async (method: string, params?: unknown, headers?: Record<string, string>) =>
  await call('POST', '/mcp', { jsonrpc: '2.0', id: ++seq, method, ...(params === undefined ? {} : { params }) }, headers)

const initSession = async (): Promise<string> => {
  const r = await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '0' } })
  const sid = r.headers['mcp-session-id']
  assert.ok(sid, 'initialize mints an Mcp-Session-Id')
  return sid
}

test('initialize declares the stateful capabilities and mints a session id', async () => {
  const r = await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '0' } })
  assert.ok(r.headers['mcp-session-id'])
  const caps = r.json.result.capabilities
  assert.deepEqual(caps.resources, { subscribe: true, listChanged: false })
  assert.deepEqual(caps.prompts, { listChanged: false })
  assert.ok(caps.logging, 'the event bridge is declared as logging')
})

test('resources: parameterless reads are static resources, parameterized reads are templates; streams are neither', async () => {
  const list = await rpc('resources/list')
  const uris = list.json.result.resources.map((r: { uri: string }) => r.uri)
  assert.ok(uris.includes('workspace://sessions'))
  assert.ok(uris.includes('workspace://usage'))
  assert.ok(!uris.includes('workspace://events'), 'the SSE stream is an argued exclusion, not a resource')
  const templates = await rpc('resources/templates/list')
  const tpl = templates.json.result.resourceTemplates.map((t: { uriTemplate: string }) => t.uriTemplate)
  assert.ok(tpl.includes('workspace://sessions/{id}'), 'a :id read becomes a {id} template')
})

test('resources/read dispatches through the router as the caller — same wall, same tenancy', async () => {
  const ok = await rpc('resources/read', { uri: 'workspace://usage' })
  const content = ok.json.result.contents[0]
  assert.equal(content.uri, 'workspace://usage')
  assert.match(content.mimeType, /application\/json/)
  assert.ok(JSON.parse(content.text), 'the resource text is the route\'s JSON')
  // Tenancy: the same uri answers DIFFERENT worlds for different credentials.
  const mine = await rpc('resources/read', { uri: 'workspace://sessions' })
  const theirs = await rpc('resources/read', { uri: 'workspace://sessions' }, { 'x-user-id': 'user-grace', 'x-tenant-id': 'tenant-beta' })
  assert.notDeepEqual(JSON.parse(mine.json.result.contents[0].text), JSON.parse(theirs.json.result.contents[0].text))
  // A refused inner read surfaces as a resource error, not a fake empty.
  const bad = await rpc('resources/read', { uri: 'workspace://sessions/no-such-session' })
  assert.ok(bad.json.error, 'an inner 404 is an error result')
  const alien = await rpc('resources/read', { uri: 'file:///etc/passwd' })
  assert.equal(alien.json.error.code, -32602, 'only workspace:// uris exist')
})

test('subscriptions need a session; with one they register and unregister', async () => {
  const bare = await rpc('resources/subscribe', { uri: 'workspace://sessions' })
  assert.match(bare.json.error.message, /initialize first/i)
  const sid = await initSession()
  const sub = await rpc('resources/subscribe', { uri: 'workspace://sessions' }, { 'mcp-session-id': sid })
  assert.deepEqual(sub.json.result, {})
  const unsub = await rpc('resources/unsubscribe', { uri: 'workspace://sessions' }, { 'mcp-session-id': sid })
  assert.deepEqual(unsub.json.result, {})
})

test('prompts mirror the system-prompt library, tenant-scoped, with the body as the prompt text', async () => {
  const list = await rpc('prompts/list')
  const prompts = list.json.result.prompts
  assert.ok(prompts.length > 0, 'the seeded library serves')
  const one = await rpc('prompts/get', { name: prompts[0].name })
  const msg = one.json.result.messages[0]
  assert.equal(msg.role, 'user')
  assert.ok(msg.content.text.length > 0, 'the prompt body rides as text content')
  const unknown = await rpc('prompts/get', { name: 'no-such-prompt' })
  assert.equal(unknown.json.error.code, -32602)
})

test('DELETE /mcp ends the session: its id stops working', async () => {
  const sid = await initSession()
  const del = await callRaw('DELETE', '/mcp', undefined, { 'mcp-session-id': sid })
  assert.equal(del.status, 204)
  const again = await callRaw('DELETE', '/mcp', undefined, { 'mcp-session-id': sid })
  assert.equal(again.status, 404, 'a terminated session is gone')
})

test('the GET stream bridges the ambient event log with the same tenant gate as /events', async () => {
  const sid = await initSession()
  await rpc('resources/subscribe', { uri: 'workspace://sessions' }, { 'mcp-session-id': sid })

  // Hand-rolled req/res: the stream never ends, so the helpers' await-to-end
  // shape can't drive it — handle() resolves when the HANDLER returns (stream
  // wired), and the res keeps accumulating frames after.
  const router = buildRouter()
  const listeners: Record<string, () => void> = {}
  const req: any = {
    method: 'GET',
    headers: { 'mcp-session-id': sid },
    on(ev: string, cb: () => void) {
      listeners[ev] = cb
      if (ev === 'end') queueMicrotask(() => listeners.end?.())
      return req
    },
  }
  let body = ''
  let status = 0
  const res: any = {
    writeHead(s: number) {
      status = s
      return res
    },
    setHeader() {},
    write(chunk: unknown) {
      body += String(chunk)
      return true
    },
    end() {},
    flushHeaders() {},
    on() {},
    get writableEnded() {
      return false
    },
  }
  await router.handle(req, res, new URL('http://test/mcp'))
  assert.equal(status, 200, 'the stream opened')

  // A visible mutation → a notifications/message frame + the subscribed
  // resource's coarse updated hint.
  const s = store.createSession('stream probe')
  store.patchSession(s.id, { title: 'stream probe renamed' })
  await new Promise((r) => setTimeout(r, 20))
  assert.match(body, /notifications\/message/, 'the ambient event rode the stream')
  assert.match(body, /workspace\.events/, 'as the workspace.events logger')
  assert.match(body, /notifications\/resources\/updated/, 'and the subscription got its invalidation hint')
  assert.match(body, /workspace:\/\/sessions/)

  // ANOTHER tenant's mutation must NOT ride this tenant's stream.
  const before = body.length
  store.createSession('foreign probe', 'tenant-beta')
  await new Promise((r) => setTimeout(r, 20))
  const tail = body.slice(before)
  assert.ok(!tail.includes('foreign probe'), 'the tenant gate holds on the bridge — same wall as /events')

  listeners.close?.()
})

test('the session-cap eviction prefers STREAMLESS sessions — churn spares a LIVE stream but reclaims a disconnected one', async () => {
  // Open a real stream on a session (hand-rolled: the stream never ends, so the
  // await-to-end helpers can't drive it — handle() resolves once wired).
  // Returns the disconnect trigger (the req 'close' listener).
  const router = buildRouter()
  const openStream = async (sid: string): Promise<() => void> => {
    const listeners: Record<string, () => void> = {}
    const req: any = {
      method: 'GET',
      headers: { 'mcp-session-id': sid },
      on(ev: string, cb: () => void) {
        listeners[ev] = cb
        if (ev === 'end') queueMicrotask(() => listeners.end?.())
        return req
      },
    }
    let status = 0
    const res: any = {
      writeHead(s: number) {
        status = s
        return res
      },
      setHeader() {},
      write() {
        return true
      },
      end() {},
      flushHeaders() {},
      on() {},
      get writableEnded() {
        return false
      },
    }
    await router.handle(req, res, new URL('http://test/mcp'))
    assert.equal(status, 200, 'the stream opened')
    return () => listeners.close?.()
  }
  const sidLive = await initSession()
  await openStream(sidLive)
  const sidDead = await initSession()
  const disconnect = await openStream(sidDead)
  disconnect() // the client went away — this session must read as streamless again
  // Churn a full cap's worth of bare initializes: they must exhaust the
  // streamless kind (the disconnected session included) before any live stream.
  for (let i = 0; i < 512; i++) {
    await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'churn', version: '0' } })
  }
  const live = await callRaw('DELETE', '/mcp', undefined, { 'mcp-session-id': sidLive })
  assert.equal(live.status, 204, 'the live-stream session survived the churn — and tears down cleanly')
  const dead = await callRaw('DELETE', '/mcp', undefined, { 'mcp-session-id': sidDead })
  assert.equal(dead.status, 404, 'the disconnected-stream session was reclaimed by the churn')
})

test('resources/read refuses the excluded stream routes (-32602) instead of hanging on a never-ending dispatch', async () => {
  // `GET /events` / the relay poll / the live turn stream never end — a
  // resources/read that dispatched one would hang forever and leak the
  // subscription. They are MCP_EXCLUDED, so the read refuses them up front.
  for (const uri of ['workspace://events', 'workspace://relay/poll', 'workspace://sessions/s1/turns/t1/stream']) {
    const r = await rpc('resources/read', { uri })
    assert.equal(r.json.error?.code, -32602, `${uri} is not a readable resource`)
    assert.match(r.json.error.message, /streams and unknown paths/i)
  }
})

test('the GET stream and resources/subscribe refuse ANONYMOUS callers while the auth gate is on (the direct-served wall)', async () => {
  const sid = await initSession()
  process.env.AUTH_GATE = 'require'
  try {
    // The stream is served directly (it never re-enters the router), so the
    // module applies the gate itself: anonymous → 401, no frames, no leak of
    // the non-tenant-scoped event classes (recents/dispatch/runner…).
    const anon = await callRaw('GET', '/mcp', undefined, { 'mcp-session-id': sid })
    assert.equal(anon.status, 401)
    assert.match(anon.body, /sign in/i)
    // A subscription is a standing read authorization for that stream — same wall.
    const sub = await rpc('resources/subscribe', { uri: 'workspace://sessions' }, { 'mcp-session-id': sid })
    assert.equal(sub.json.error?.code, -32001)
    assert.match(sub.json.error.message, /sign in/i)
    // A verified principal (the dev identity seam, same as every data route) passes.
    const seam = await callRaw('GET', '/mcp', undefined, { 'mcp-session-id': sid, 'x-user-id': 'user-grace', 'x-tenant-id': 'tenant-beta' })
    assert.equal(seam.status, 200, 'the gate refuses anonymity, not the door')
    await callRaw('DELETE', '/mcp', undefined, { 'mcp-session-id': sid }) // tear the stream down
  } finally {
    delete process.env.AUTH_GATE
  }
})

test('a pinned CORS_ORIGIN refuses mismatched browser Origins on /mcp (403), and leaves matching/absent alone', async () => {
  process.env.CORS_ORIGIN = 'https://app.example'
  try {
    const evil = await callRaw('POST', '/mcp', { jsonrpc: '2.0', id: 1, method: 'ping' }, { origin: 'https://evil.example' })
    assert.equal(evil.status, 403)
    const good = await rpc('ping', undefined, { origin: 'https://app.example' })
    assert.deepEqual(good.json.result, {})
    const machine = await rpc('ping')
    assert.deepEqual(machine.json.result, {}, 'no Origin (a non-browser client) is untouched')
  } finally {
    delete process.env.CORS_ORIGIN
  }
})
