/** The identity surface on the wire (multi-account design §5.5, invariant I5):
 *  every matched response carries the `x-resolved-tenant` echo; `/v1/events`
 *  accepts query identity (the EventSource header stand-in), names the
 *  resolved identity in its hello, and scopes the live fan-out by it. Also the
 *  P9 tombstone: the old dev enumeration directory (`GET /v1/identities`) is
 *  GONE — identities are never enumerable; accounts sign in (the seeds carry
 *  demo credentials for exactly that, locked in tests/auth-accounts.test.ts).
 *  Runs the router as the REMOTE variant (BACKEND is read once at store load →
 *  dynamic imports, like tests/capability-remote.test.ts). */
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

test('the switch capability is advertised; the old enumeration directory is GONE (P9)', async () => {
  const { buildRouter } = await import('../server/routes/index.ts')
  const call = caller(buildRouter())

  const caps = await call('GET', '/capabilities')
  assert.equal(caps.status, 200)
  assert.equal(caps.json().features.identitySwitch, true, 'the remote backend advertises the switcher')

  // P9: `GET /v1/identities` retired with the dev switcher — no backend
  // enumerates identities anymore (a seed signs in with its demo credential,
  // like every other account). Unmatched at the router (status stays 0 in this
  // handler-level harness; the entry server answers the real 404).
  const ids = await call('GET', '/identities')
  assert.equal(ids.status, 0, 'no route matches — the enumeration surface no longer exists')
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
