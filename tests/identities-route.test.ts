/** The identity surface for the account switcher (multi-account design §5.5–5.6):
 *  `GET /v1/identities` lists the seeded accounts on the REMOTE backend and 409s
 *  elsewhere (capability-gated, not env-sniffed); `capabilities.identitySwitch`
 *  is the flag the UI gates on; every matched response carries the
 *  `x-resolved-tenant` echo; and `/v1/events` accepts query identity (the
 *  EventSource header stand-in), naming the resolved identity in its hello.
 *  Runs the router as the REMOTE variant (BACKEND is read once at store load →
 *  dynamic imports, like tests/capability-remote.test.ts). The default-backend
 *  face — the local user's WORKSPACE directory (uniform switcher, build log
 *  row 51) — lives in tests/identities-default.test.ts (its own process). */
import { test } from 'node:test'
import assert from 'node:assert/strict'

process.env.BACKEND = 'remote'

function caller(router: any) {
  return async function call(method: string, path: string, headers: Record<string, string> = {}) {
    let status = 0
    let body = ''
    const resHeaders: Record<string, string> = {}
    let ended = false
    const res: any = {
      writeHead(s: number, hdrs?: Record<string, string>) {
        status = s
        if (hdrs) for (const [k, v] of Object.entries(hdrs)) resHeaders[k.toLowerCase()] = String(v)
        return res
      },
      setHeader(name: string, value: string) {
        resHeaders[name.toLowerCase()] = String(value)
      },
      write(chunk: string) {
        body += chunk
        return true
      },
      end(chunk?: string) {
        if (chunk) body += chunk
        ended = true
      },
      flushHeaders() {},
      on() {},
      get writableEnded() {
        return ended
      },
    }
    const req: any = { method, headers, on: () => req }
    await router.handle(req, res, new URL(`http://test${path}`))
    return { status, body, headers: resHeaders, json: () => JSON.parse(body) }
  }
}

test('GET /identities lists the seeded accounts on the remote backend; capabilities advertise the switch', async () => {
  const { buildRouter } = await import('../server/routes/index.ts')
  const call = caller(buildRouter())

  const caps = await call('GET', '/capabilities')
  assert.equal(caps.status, 200)
  assert.equal(caps.json().features.identitySwitch, true, 'the remote backend advertises the switcher')

  const ids = await call('GET', '/identities')
  assert.equal(ids.status, 200)
  const list = ids.json() as Array<{ userId: string; tenantId: string; role: string; userLabel: string }>
  assert.ok(list.length >= 3, 'the seeded directory is enumerated')
  assert.ok(list.some((i) => i.userId === 'user-ada' && i.tenantId === 'tenant-acme' && i.role === 'owner'), 'the default owner is listed')
  assert.ok(list.some((i) => i.userId === 'user-grace' && i.tenantId === 'tenant-beta'), 'the cross-tenant identity (the co-authoring E2E’s Bo) is listed')
  for (const row of list) {
    assert.ok(row.userId && row.userLabel && row.tenantId, 'every row is a complete, labelled identity')
  }
})

test('every matched response carries the x-resolved-tenant echo (invariant I5)', async () => {
  const { buildRouter } = await import('../server/routes/index.ts')
  const call = caller(buildRouter())

  const asDefault = await call('GET', '/me')
  assert.equal(asDefault.headers['x-resolved-tenant'], 'tenant-acme', 'the default web identity echoes its tenant')

  const asBeta = await call('GET', '/me', { 'x-user-id': 'user-grace', 'x-tenant-id': 'tenant-beta' })
  assert.equal(asBeta.headers['x-resolved-tenant'], 'tenant-beta', 'the echo names the RESOLVED tenant, not a default')
  assert.equal(asBeta.json().tenant.id, 'tenant-beta', 'echo and body agree')
})

test('/events accepts query identity (the EventSource stand-in) and names it in the hello', async () => {
  const { buildRouter } = await import('../server/routes/index.ts')
  const call = caller(buildRouter())

  const stream = await call('GET', '/events?user=user-grace&tenant=tenant-beta')
  const hello = JSON.parse(stream.body.split('\n\n')[0].split('\n').find((l: string) => l.startsWith('data:'))!.slice(5))
  assert.equal(hello.type, 'hello')
  assert.deepEqual(hello.identity, { userId: 'user-grace', tenantId: 'tenant-beta' }, 'the stream binds and names the query identity')

  const plain = await call('GET', '/events')
  const plainHello = JSON.parse(plain.body.split('\n\n')[0].split('\n').find((l: string) => l.startsWith('data:'))!.slice(5))
  assert.deepEqual(plainHello.identity, { userId: 'user-ada', tenantId: 'tenant-acme' }, 'no query → the header/default identity, as before')
})

test('query identity scopes the live fan-out: tenant-beta’s stream does not receive acme session pushes', async () => {
  const { buildRouter } = await import('../server/routes/index.ts')
  const { store } = await import('../server/store.ts')
  const call = caller(buildRouter())

  const beta = await call('GET', '/events?user=user-grace&tenant=tenant-beta')
  store.createSession('acme-only thread', 'tenant-acme') // broadcasts session.updated for acme
  assert.ok(
    !beta.body.includes('acme-only thread'),
    'the beta-bound stream never sees the acme session push (subscribe-time identity, F2/PD9)',
  )
})
