/** The portability boundary: ONE UI, two backends, gated by capability — not by
 *  env-sniffing. This file builds the router as the REMOTE web-server variant
 *  (BACKEND=remote) and asserts the native endpoints report unavailable (409) and
 *  the capability descriptor advertises the local-* features as false. The default
 *  (mock = native-like) side is covered by tests/capabilities.test.ts.
 *
 *  BACKEND is read once at store load, so we set it BEFORE importing the router
 *  (dynamically, inside the test). `node --test` runs each file in its own process,
 *  so this never leaks into the other suites' mock store. */
import { test } from 'node:test'
import assert from 'node:assert/strict'

process.env.BACKEND = 'remote'

/** Drive the given router at the handler level (mirrors tests/helpers/http.ts, but
 *  against a router we built ourselves so it picks up BACKEND=remote). */
function caller(router) {
  return async function call(method, path, headers = {}) {
    let status = 0
    let body = ''
    let ended = false
    const res = {
      writeHead(s) {
        status = s
        return res
      },
      setHeader() {},
      write(chunk) {
        body += chunk
        return true
      },
      end(chunk) {
        if (chunk) body += chunk
        ended = true
      },
      flushHeaders() {},
      on() {},
      get writableEnded() {
        return ended
      },
    }
    const req = { method, headers, on: () => req }
    await router.handle(req, res, new URL(`http://test${path}`))
    return { status, json: body ? JSON.parse(body) : undefined }
  }
}

test('a remote backend reports the local-* capabilities as false', async () => {
  const { buildRouter } = await import('../server/routes/index.ts')
  const call = caller(buildRouter())

  const caps = await call('GET', '/capabilities')
  assert.equal(caps.status, 200)
  assert.equal(caps.json.backend, 'remote')
  assert.equal(caps.json.features.localFs, false)
  assert.equal(caps.json.features.localGit, false)
  assert.equal(caps.json.features.osPicker, false)
  assert.equal(caps.json.features.clipboard, false)
  // A remote server still streams + runs schedules.
  assert.equal(caps.json.features.streaming, true)
  assert.equal(caps.json.features.scheduledExecution, true)
})

test('a remote backend 409s every native-only endpoint with capability_unavailable', async () => {
  const { buildRouter } = await import('../server/routes/index.ts')
  const call = caller(buildRouter())

  for (const path of ['/fs/pick?kind=folder', '/fs/folders/insights', '/git/repos/repo-insights/diff']) {
    const r = await call('GET', path)
    assert.equal(r.status, 409, `${path} should be gated on a remote backend`)
    assert.equal(r.json.error.code, 'capability_unavailable', `${path} should report capability_unavailable`)
  }
})

test('the audit trail is visible on a remote backend (write tenant matches read tenant)', async () => {
  const { store } = await import('../server/store.ts')
  const { buildRouter } = await import('../server/routes/index.ts')
  const call = caller(buildRouter())

  // A production-style record (no explicit tenantId) must default to the SAME tenant the
  // GET /audit read scopes to on this backend — otherwise the remote Audit hub is empty.
  store.recordAudit({ channel: 'proxy', actorAgentId: 'agent-x', capability: 'connector.read', target: 'remote-audit-probe', outcome: 'fulfilled' })
  const r = await call('GET', '/audit')
  assert.equal(r.status, 200)
  assert.ok(
    r.json.some((e) => e.target === 'remote-audit-probe'),
    'a recorded effect is visible to the same-tenant reader on the remote backend',
  )
})

test('sessions are tenant-isolated on a remote backend (list + read-by-id, 404 not 403)', async () => {
  const { store } = await import('../server/store.ts')
  const { buildRouter } = await import('../server/routes/index.ts')
  const call = caller(buildRouter())

  // A session owned by tenant-zeta (the POST-body path is covered by the in-process suite;
  // here the focus is the header-driven read boundary on the multi-tenant backend).
  const zeta = store.createSession('zeta-only thread', 'tenant-zeta')

  // The owning tenant lists + opens it.
  const listZeta = await call('GET', '/sessions', { 'x-tenant-id': 'tenant-zeta' })
  assert.equal(listZeta.status, 200)
  assert.ok(listZeta.json.some((s) => s.id === zeta.id), 'tenant-zeta lists its own session')
  const getZeta = await call('GET', `/sessions/${zeta.id}`, { 'x-tenant-id': 'tenant-zeta' })
  assert.equal(getZeta.status, 200, 'tenant-zeta can open its own session by id')

  // Another tenant neither lists it nor can open it — 404 (not 403) so existence can't leak.
  const listOmega = await call('GET', '/sessions', { 'x-tenant-id': 'tenant-omega' })
  assert.ok(!listOmega.json.some((s) => s.id === zeta.id), 'tenant-omega cannot see it in the list')
  const getOmega = await call('GET', `/sessions/${zeta.id}`, { 'x-tenant-id': 'tenant-omega' })
  assert.equal(getOmega.status, 404, 'a cross-tenant id is 404, not 403')

  // The default (no-header) reader is the web tenant; seed sessions default to it and stay visible.
  const listDefault = await call('GET', '/sessions')
  assert.ok(listDefault.json.some((s) => s.isDemo), 'the default tenant still sees the seed demo')
})

test('the served cloud filesystem source works on a remote backend (it reads the web backend’s own storage)', async () => {
  const { buildRouter } = await import('../server/routes/index.ts')
  const call = caller(buildRouter())

  // The cloud source is the web backend's own storage — served on both backends,
  // unlike the native arbitrary-path seam above. (A remote backend seeds no runner,
  // so the runner sources simply aren't present until one connects.)
  const cat = await call('GET', '/fs/catalog?source=cloud')
  assert.equal(cat.status, 200, 'the cloud catalog is served on a remote backend')
  assert.ok(cat.json.files.length + cat.json.photos.length + cat.json.folders.length > 0)

  const sources = await call('GET', '/fs/sources')
  assert.ok(sources.json.some((s) => s.id === 'cloud'), 'cloud is listed')
  assert.ok(!sources.json.some((s) => s.kind === 'runner'), 'no runner source on a bare remote backend')
})
