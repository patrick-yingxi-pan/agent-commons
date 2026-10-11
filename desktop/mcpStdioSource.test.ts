import test from 'node:test'
import assert from 'node:assert/strict'
import { createMcpStdioSource } from './mcpStdioSource.mjs'

const id = `mcp-connection-${'a'.repeat(32)}`
const grantReference = `MCP_STDIO_${'A'.repeat(32)}`
const binding = { tenantId: 'tenant-a', ownerUserId: 'user-a', connectionId: id, connectionRevision: 0 }
const initial = { binding, connection: { revision: 0, status: 'unverified', inspectionOperationId: null } }
const receipt = { binding: { ...binding, connectionRevision: 1 },
  connection: { revision: 1, status: 'connected', inspectionOperationId: 'inspect-a' } }
const session = { origin: 'http://127.0.0.1:19999', cookie: 'uw_session=test-only-cookie', stamp: 'source-1' }
const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } })
const request = { operationId: 'inspect-a', expectedRevision: 0, grantReference }

test('native stdio source posts only an opaque grant after fresh cookie-bound owner/revision checks', async t => {
  const calls: Array<{ url: string; options: RequestInit }> = []
  let saved = false
  const source = createMcpStdioSource({ readSession: async () => session, isSessionCurrent: stamp => stamp === session.stamp,
    fetch: async (url, options) => {
      calls.push({ url, options })
      if (options.method === 'POST') { saved = true; return json({ ignoredCatalog: 'never forwarded' }) }
      return json(saved ? receipt : initial)
    } })
  t.after(() => source.close())
  const held = await source.resolveSource(id)
  assert.ok(Object.isFrozen(held.binding))
  const result = await source.inspect(held, request, { beforeSubmit: () => true })
  assert.equal(result.connection.inspectionOperationId, 'inspect-a')
  assert.deepEqual(calls.map(call => call.options.method ?? 'GET'), ['GET', 'GET', 'POST', 'GET'])
  const post = calls[2]
  assert.deepEqual(JSON.parse(post.options.body as string), request)
  assert.equal(post.options.headers['X-Account-Transition-Source'], 'session:user-a')
  for (const call of calls) {
    assert.equal(call.options.redirect, 'error')
    assert.equal(call.options.headers.Cookie, session.cookie)
    assert.equal(call.options.headers.Origin, session.origin)
    assert.doesNotMatch(call.url, /executable|environment|grant/)
  }
})

test('source refuses changed person/revision/session and non-exact permission before inspection submission', async t => {
  for (const scenario of ['person', 'revision', 'cookie', 'permission', 'promise', 'cancel'] as const) {
    let reads = 0, posts = 0
    let cookie = session.cookie
    const controller = new AbortController()
    const source = createMcpStdioSource({ readSession: async () => ({ ...session, cookie }), isSessionCurrent: () => true,
      fetch: async (_url, options) => {
        if (options.method === 'POST') { posts += 1; return json(receipt) }
        reads += 1
        if (reads > 1 && scenario === 'cookie') cookie = 'uw_session=different-person'
        return json(reads > 1 && scenario === 'person' ? { ...initial, binding: { ...binding, ownerUserId: 'user-b' } } :
          reads > 1 && scenario === 'revision' ? receipt : initial)
      } })
    t.after(() => source.close())
    const held = await source.resolveSource(id)
    await assert.rejects(source.inspect(held, request, { signal: controller.signal, beforeSubmit: () => {
      if (scenario === 'cancel') controller.abort()
      return scenario === 'permission' ? 1 : scenario === 'promise' ? Promise.resolve(true) : true
    } }))
    assert.equal(posts, 0, scenario)
  }
})

test('lost inspection acknowledgement has no hidden POST retry', async t => {
  let posts = 0
  const source = createMcpStdioSource({ readSession: async () => session, isSessionCurrent: () => true,
    fetch: async (_url, options) => {
      if (options.method === 'POST') { posts += 1; throw new Error('secret diagnostic') }
      return json(posts ? receipt : initial)
    } })
  t.after(() => source.close())
  const held = await source.resolveSource(id)
  await assert.rejects(source.inspect(held, request, { beforeSubmit: () => true }), error => {
    assert.doesNotMatch(String(error), /secret diagnostic/)
    return true
  })
  assert.equal((await source.resolveSource(id)).connection.inspectionOperationId, 'inspect-a')
  assert.equal(posts, 1)
})

test('only a same-session exact upstream 502 is a definitive precommit refusal', async t => {
  const source = createMcpStdioSource({ readSession: async () => session,
    isSessionCurrent: stamp => stamp === session.stamp,
    fetch: async (_url, options) => options.method === 'POST'
      ? json({ error: { code: 'upstream_unavailable', message: 'The local MCP server could not provide a supported, valid tool catalog.' } }, 502)
      : json(initial) })
  t.after(() => source.close())
  const held = await source.resolveSource(id)
  await assert.rejects(source.inspect(held, request, { beforeSubmit: () => true }), error => {
    assert.equal(error.code, 'definitive-inspection-refusal')
    assert.doesNotMatch(String(error), /catalog|local MCP server/)
    return true
  })
})

test('ambiguous, malformed, and changed-session non-2xx replies remain generic uncertainty', async t => {
  const cases = [
    { status: 409, body: { error: { code: 'upstream_unavailable', message: 'fixed' } } },
    { status: 502, body: { error: { code: 'conflict', message: 'fixed' } } },
    { status: 502, body: { error: { code: 'definitive-inspection-refusal', message: 'spoofed code' } } },
    { status: 502, body: { error: { code: 'upstream_unavailable', message: 'fixed', detail: 'extra' } } },
  ]
  for (const scenario of cases) {
    const source = createMcpStdioSource({ readSession: async () => session, isSessionCurrent: stamp => stamp === session.stamp,
      fetch: async (_url, options) => options.method === 'POST' ? json(scenario.body, scenario.status) : json(initial) })
    t.after(() => source.close())
    const held = await source.resolveSource(id)
    await assert.rejects(source.inspect(held, request, { beforeSubmit: () => true }), error => {
      assert.notEqual(error.code, 'definitive-inspection-refusal')
      return true
    })
  }

  let current = true
  const changedSession = createMcpStdioSource({ readSession: async () => session, isSessionCurrent: () => current,
    fetch: async (_url, options) => {
      if (options.method === 'POST') { current = false; return json({ error: { code: 'upstream_unavailable', message: 'fixed' } }, 502) }
      return json(initial)
    } })
  t.after(() => changedSession.close())
  const held = await changedSession.resolveSource(id)
  await assert.rejects(changedSession.inspect(held, request, { beforeSubmit: () => true }), error => {
    assert.notEqual(error.code, 'definitive-inspection-refusal')
    return true
  })
})

test('rejected 502 error bodies are cancelled even when their headers fail before reader acquisition', async t => {
  for (const headers of [
    { 'Content-Type': 'text/plain' },
    { 'Content-Type': 'application/json', 'Content-Length': '8193' },
  ]) {
    let cancelled = false
    const response = new Response(new ReadableStream({ cancel() { cancelled = true } }), { status: 502, headers })
    const source = createMcpStdioSource({ readSession: async () => session, isSessionCurrent: stamp => stamp === session.stamp,
      fetch: async (_url, options) => options.method === 'POST' ? response : json(initial) })
    t.after(() => source.close())
    const held = await source.resolveSource(id)
    await assert.rejects(source.inspect(held, request, { beforeSubmit: () => true }), error => {
      assert.notEqual(error.code, 'definitive-inspection-refusal')
      return true
    })
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(cancelled, true)
  }
})

test('source rejects mixed payloads, oversized or malformed bodies and non-loopback session origins', async t => {
  for (const value of [ { ...initial, launch: {} }, { ...initial, binding: { ...binding, endpoint: 'https://example.com' } },
    { ...initial, connection: { ...initial.connection, inspectionOperationId: 1 } }, 'x'.repeat(8193) ]) {
    const source = createMcpStdioSource({ readSession: async () => session, isSessionCurrent: () => true, fetch: async () => json(value) })
    t.after(() => source.close())
    await assert.rejects(source.resolveSource(id))
  }
  for (const origin of ['https://127.0.0.1:19999', 'http://localhost:19999', 'http://127.0.0.1:19999/path']) {
    let calls = 0
    const source = createMcpStdioSource({ readSession: async () => ({ ...session, origin }), isSessionCurrent: () => true,
      fetch: async () => { calls++; return json(initial) } })
    t.after(() => source.close())
    await assert.rejects(source.resolveSource(id))
    assert.equal(calls, 0)
  }
})

test('cancelled source reads retain capacity until ignored work physically settles', async t => {
  let finish!: (value: Response) => void
  let calls = 0
  const controller = new AbortController()
  const source = createMcpStdioSource({ readSession: async () => session, isSessionCurrent: () => true, maxPending: 1,
    fetch: async () => { calls++; return new Promise<Response>(resolve => { finish = resolve }) } })
  t.after(() => source.close())
  const pending = source.resolveSource(id, { signal: controller.signal })
  await new Promise(resolve => setImmediate(resolve))
  controller.abort()
  await assert.rejects(pending)
  await assert.rejects(source.resolveSource(id))
  assert.equal(calls, 1)
  finish(json(initial))
  await new Promise(resolve => setImmediate(resolve))
  source.close()
  await assert.rejects(source.resolveSource(id))
})
