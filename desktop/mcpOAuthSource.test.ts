import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createMcpOAuthSource } from './mcpOAuthSource.mjs'

const id = 'mcp-connection-owner'
const reference = `MCP_DESKTOP_${'A'.repeat(32)}`
const deferred = () => {
  let resolve
  const promise = new Promise(r => { resolve = r })
  return { promise, resolve }
}
const tick = () => new Promise(resolve => setImmediate(resolve))
const json = (body, options = {}) => new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' }, ...options })
function fixture(options = {}) {
  let session = { origin: 'http://127.0.0.1:8787', cookie: 'uw_session=private-cookie', stamp: 'window:1:backend:1:cookie:1' }
  let truth = { ownerUserId: 'ada', binding: { tenantId: 'org', connectionId: id, endpoint: 'https://mcp.example.com/mcp' },
    connection: { id, authentication: 'device-oauth', revision: 0, status: 'unverified', inspectionOperationId: null } }
  const calls = []
  const adapter = createMcpOAuthSource({
    readSession: () => session,
    isSessionCurrent: stamp => stamp === session.stamp,
    fetch: async (url, init) => {
      calls.push({ url, init })
      if (init.method === 'POST') {
        truth = { ...truth, connection: { ...truth.connection, revision: truth.connection.revision + 1,
          status: 'connected', inspectionOperationId: JSON.parse(init.body).operationId } }
        return json({ connection: { ...truth.connection, tools: [{ name: 'do-not-cross-native-boundary' }] }, credentialCleanup: 'complete' })
      }
      return json(truth)
    }, ...options,
  })
  return { adapter, calls, get truth() { return truth }, set truth(value) { truth = value },
    get session() { return session }, set session(value) { session = value } }
}
const inspectRequest = { operationId: 'operation-1', expectedRevision: 0, credentialReference: reference }

test('native OAuth source uses only the exact loopback session and returns detached bounded authority', async () => {
  const f = fixture()
  const source = await f.adapter.resolveSource(id)
  assert.deepEqual(source, { stamp: f.session.stamp, ...f.truth })
  assert.ok(Object.isFrozen(source) && Object.isFrozen(source.binding) && Object.isFrozen(source.connection))
  assert.equal(JSON.stringify(source).includes('private-cookie'), false)
  assert.deepEqual(f.calls[0].init.headers, { Accept: 'application/json', Origin: f.session.origin, Cookie: f.session.cookie })
  assert.equal(f.calls[0].url, `http://127.0.0.1:8787/api/v1/mcp-connections/${id}/oauth-source`)
  assert.equal(f.calls[0].init.redirect, 'error')
  assert.equal(f.calls[0].init.credentials, 'omit')
  f.truth.binding.endpoint = 'https://changed.example.com/mcp'
  assert.equal(source.binding.endpoint, 'https://mcp.example.com/mcp')
  f.adapter.close()
})

test('inspection freezes exact source and operation, posts once and returns fresh minimal receipt', async () => {
  const f = fixture()
  const source = await f.adapter.resolveSource(id)
  // The host snapshots its trusted source too; no WeakMap object identity is required.
  const result = await f.adapter.inspect(structuredClone(source), { ...inspectRequest })
  const posts = f.calls.filter(call => call.init.method === 'POST')
  assert.equal(posts.length, 1)
  assert.deepEqual(JSON.parse(posts[0].init.body), inspectRequest)
  assert.equal(posts[0].init.headers['X-Account-Transition-Source'], 'session:ada')
  assert.deepEqual(result, { connection: f.truth.connection })
  assert.equal(result.connection.revision, 1)
  assert.equal(JSON.stringify(result).includes('tools'), false)
  assert.equal(JSON.stringify(result).includes(reference), false)
  f.adapter.close()
})

test('changed account, tenant, endpoint and revision refuse before inspection POST', async () => {
  for (const change of [
    f => { f.session = { ...f.session, cookie: 'uw_session=other', stamp: 'changed' } },
    f => { f.truth.ownerUserId = 'other' },
    f => { f.truth.binding.tenantId = 'other' },
    f => { f.truth.binding.endpoint = 'https://other.example.com/mcp' },
    f => { f.truth.connection.revision++ },
  ]) {
    const f = fixture()
    const source = await f.adapter.resolveSource(id)
    change(f)
    await assert.rejects(f.adapter.inspect(source, inspectRequest), /unavailable or changed/)
    assert.equal(f.calls.some(call => call.init.method === 'POST'), false)
    f.adapter.close()
  }
})

test('cookie changes while an authenticated source read waits discard its result', async () => {
  const gate = deferred()
  let reads = 0
  const f = fixture({ fetch: async () => { reads++; await gate.promise; return json(f.truth) } })
  const pending = f.adapter.resolveSource(id)
  await tick()
  assert.equal(reads, 1)
  // Also detect the actual cookie differing even if event delivery has not yet
  // advanced its generation stamp.
  f.session = { ...f.session, cookie: 'uw_session=new-cookie' }
  gate.resolve()
  await assert.rejects(pending, /unavailable or changed/)
  f.adapter.close()
})

test('native source validates owner, target, OAuth type, public audience and closed response shapes', async () => {
  for (const change of [
    body => { body.ownerUserId = ' ' },
    body => { body.binding.connectionId = 'other' },
    body => { body.binding.endpoint = 'http://127.0.0.1:8000/mcp' },
    body => { body.binding.endpoint = 'https://user:secret@mcp.example.com/' },
    body => { body.connection.id = 'other' },
    body => { body.connection.authentication = 'device-bearer' },
    body => { body.connection.revision = -1 },
    body => { body.connection.status = 'ready' },
    body => { body.connection.credentialReference = reference },
    body => { body.cookie = 'private-cookie' },
  ]) {
    const f = fixture()
    change(f.truth)
    await assert.rejects(f.adapter.resolveSource(id), /unavailable or changed/)
    f.adapter.close()
  }
})

test('native session refuses remote origins, extra cookies, missing login and async currentness', async () => {
  for (const session of [
    { origin: 'https://attacker.example.com', cookie: 'uw_session=private', stamp: 'current' },
    { origin: 'http://localhost:8787', cookie: 'uw_session=private', stamp: 'current' },
    { origin: 'http://127.0.0.1:8787', cookie: 'uw_session=private; other=secret', stamp: 'current' },
    { origin: 'http://127.0.0.1:8787', cookie: '', stamp: 'current' },
  ]) {
    const f = fixture({ readSession: () => session, isSessionCurrent: () => true })
    await assert.rejects(f.adapter.resolveSource(id), /unavailable/)
    assert.equal(f.calls.length, 0)
    f.adapter.close()
  }
  const f = fixture({ isSessionCurrent: async () => true })
  await assert.rejects(f.adapter.resolveSource(id), /unavailable/)
  assert.equal(f.calls.length, 0)
  f.adapter.close()
})

test('bounded local JSON refuses HTTP errors, oversized bodies, invalid UTF-8 and malformed JSON', async () => {
  for (const response of [
    () => json({ private: 'do-not-reflect' }, { status: 403 }),
    () => new Response('x', { headers: { 'Content-Type': 'text/html' } }),
    () => new Response('x'.repeat(8193), { headers: { 'Content-Type': 'application/json' } }),
    () => new Response(new Uint8Array([0xc3, 0x28]), { headers: { 'Content-Type': 'application/json' } }),
    () => new Response('{"private":"do-not-reflect"', { headers: { 'Content-Type': 'application/json' } }),
  ]) {
    const f = fixture({ fetch: async () => response() })
    await assert.rejects(f.adapter.resolveSource(id), error => error.message === 'The MCP OAuth source is unavailable or changed.')
    f.adapter.close()
  }
})

test('abort and deadline wake callers but retain admission until ignored work drains', async () => {
  for (const timeout of [false, true]) {
    const gate = deferred()
    let requests = 0
    const f = fixture({ maxPending: 1, timeoutMs: timeout ? 20 : 1000,
      fetch: async () => { requests++; await gate.promise; return json(f.truth) } })
    const controller = new AbortController()
    const pending = f.adapter.resolveSource(id, { signal: controller.signal })
    const rejected = assert.rejects(pending, /unavailable/)
    await tick()
    assert.equal(requests, 1)
    if (!timeout) controller.abort()
    await rejected
    await assert.rejects(f.adapter.resolveSource(id), /unavailable/)
    assert.equal(requests, 1)
    gate.resolve()
    await tick()
    assert.equal((await f.adapter.resolveSource(id)).connection.id, id)
    f.adapter.close()
  }
})

test('close aborts held work, suppresses late publication and permanently stops admission', async () => {
  const gate = deferred()
  const f = fixture({ fetch: async () => { await gate.promise; return json(f.truth) } })
  const pending = f.adapter.resolveSource(id)
  const rejected = assert.rejects(pending, /unavailable/)
  await tick()
  f.adapter.close()
  await rejected
  gate.resolve()
  await tick()
  assert.equal(f.adapter.isSourceCurrent(f.session.stamp), false)
  await assert.rejects(f.adapter.resolveSource(id), /unavailable/)
})

test('post-commit response loss never causes adapter replay', async () => {
  let posts = 0
  const f = fixture({ fetch: async (_url, init) => {
    if (init.method === 'POST') { posts++; throw new Error('private provider detail') }
    return json(f.truth)
  } })
  const source = await f.adapter.resolveSource(id)
  await assert.rejects(f.adapter.inspect(source, inspectRequest), error => error.message === 'The MCP OAuth source is unavailable or changed.')
  assert.equal(posts, 1)
  f.adapter.close()
})

test('inspection requires an exact newer receipt even after a successful HTTP acknowledgement', async () => {
  for (const connection of [
    { revision: 0, inspectionOperationId: 'operation-1' },
    { revision: 1, inspectionOperationId: 'other-operation' },
  ]) {
    let posted = false
    const f = fixture({ fetch: async (_url, init) => {
      if (init.method === 'POST') { posted = true; return json({}) }
      return json(posted ? { ...f.truth, connection: { ...f.truth.connection, ...connection } } : f.truth)
    } })
    const source = await f.adapter.resolveSource(id)
    await assert.rejects(f.adapter.inspect(source, inspectRequest), /unavailable/)
    assert.equal(posted, true)
    f.adapter.close()
  }
})
