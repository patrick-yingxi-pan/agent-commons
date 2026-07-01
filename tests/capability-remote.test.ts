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
  return async function call(method, path, headers = {}, bodyObj) {
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
    const handlers = {}
    let emitted = false
    const req = {
      method,
      headers,
      on(ev, cb) {
        handlers[ev] = cb
        // Deliver a JSON body the way node's IncomingMessage would (mirrors
        // tests/helpers/http.ts): emit `data` then `end` once the route attaches its
        // `end` listener, so a handler that reads `body()` resolves.
        if (ev === 'end' && !emitted) {
          emitted = true
          queueMicrotask(() => {
            if (bodyObj !== undefined) handlers.data?.(Buffer.from(JSON.stringify(bodyObj)))
            handlers.end?.()
          })
        }
        return req
      },
    }
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

  // A session owned by tenant-zeta, seeded directly through the store; here the focus is
  // the header-driven READ boundary. The isolation-*establishing* write path (POST
  // /sessions stamping the caller-resolved tenant) is proven by the next test.
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

  // Write-side isolation: a foreign tenant can neither delete nor patch it (404, no effect).
  // The guard short-circuits before the body is read, so these need no request body.
  const delOmega = await call('DELETE', `/sessions/${zeta.id}`, { 'x-tenant-id': 'tenant-omega' })
  assert.equal(delOmega.status, 404, 'a foreign tenant cannot delete the session')
  const patchOmega = await call('PATCH', `/sessions/${zeta.id}`, { 'x-tenant-id': 'tenant-omega' })
  assert.equal(patchOmega.status, 404, 'a foreign tenant cannot patch the session')
  const survived = await call('GET', '/sessions', { 'x-tenant-id': 'tenant-zeta' })
  assert.ok(survived.json.some((s) => s.id === zeta.id), 'the session survived the cross-tenant delete attempt')

  // The default (no-header) reader is the web tenant; seed sessions default to it and stay visible.
  const listDefault = await call('GET', '/sessions')
  assert.ok(listDefault.json.some((s) => s.isDemo), 'the default tenant still sees the seed demo')
})

test('POST /sessions stamps the caller-resolved tenant on a remote backend (request identity → scoped read)', async () => {
  const { buildRouter } = await import('../server/routes/index.ts')
  const call = caller(buildRouter())

  // Create THROUGH the public route as tenant-zeta. The owner tenant is derived from the
  // request identity (store.identity(headers)), NOT a client-supplied body field — this is
  // the isolation-*establishing* link. (The in-process suite can't prove it: on the mock
  // backend store.identity is hard-wired to tenant-personal regardless of headers, so it
  // couldn't tell a correct stamp from a hardcoded/omitted one — only a multi-tenant
  // backend driven through the route can.)
  const created = await call('POST', '/sessions', { 'x-tenant-id': 'tenant-zeta' }, { firstMessage: 'created via the route' })
  assert.equal(created.status, 200, 'the route creates the session')
  const id = created.json.id
  assert.ok(id, 'the route returns the new session id')

  // Close the loop: request identity → stamped tenant → scoped read, via public routes only.
  const listZeta = await call('GET', '/sessions', { 'x-tenant-id': 'tenant-zeta' })
  assert.ok(listZeta.json.some((s) => s.id === id), 'the creating tenant lists its route-created session')
  const listOmega = await call('GET', '/sessions', { 'x-tenant-id': 'tenant-omega' })
  assert.ok(!listOmega.json.some((s) => s.id === id), 'another tenant cannot see it')
  const getOmega = await call('GET', `/sessions/${id}`, { 'x-tenant-id': 'tenant-omega' })
  assert.equal(getOmega.status, 404, 'another tenant gets 404 opening it by id')
})

test('the connector-action confirm route is tenant-isolated (a foreign tenant cannot confirm/execute another’s write)', async () => {
  const { store } = await import('../server/store.ts')
  const { buildRouter } = await import('../server/routes/index.ts')
  const call = caller(buildRouter())

  // A tenant-zeta session carrying a PROPOSED connector write (P6 slice 1b) on an
  // assistant message.
  const s = store.createSession('zeta pending write', 'tenant-zeta')
  store.appendMessage(s.id, {
    id: 'm-zeta-write',
    role: 'assistant',
    content: '',
    toolActivities: [
      {
        id: 'act-zeta',
        tool: 'mcp__filesystem__write_file',
        connector: 'MCP · filesystem',
        connectorId: 'mcp-fs',
        kind: 'action',
        status: 'proposed',
        summary: 'Proposed: write_file on MCP · filesystem — confirm to run.',
      },
    ],
  })
  const writeAudits = () => store.listAuditLog().filter((e) => e.capability === 'connector.write').length
  const auditBefore = writeAudits()

  // A foreign tenant cannot confirm it — 404 (not 403), no execution, no audit. This is
  // the consent+audit gate the route's denyForeignSession guard exists to enforce.
  const omega = await call('POST', `/sessions/${s.id}/tool-activities/act-zeta`, { 'x-tenant-id': 'tenant-omega' }, { decision: 'confirm' })
  assert.equal(omega.status, 404, 'a foreign tenant gets 404 confirming another tenant’s pending write')
  const afterOmega = store.getSession(s.id)?.messages?.find((m) => m.id === 'm-zeta-write')?.toolActivities?.[0]
  assert.equal(afterOmega?.status, 'proposed', 'the write stayed proposed — the foreign tenant did not execute it')
  assert.equal(writeAudits(), auditBefore, 'the blocked confirm recorded no connector.write audit')

  // The owning tenant CAN confirm through the route — 200, executed + done + audited.
  const zetaConfirm = await call('POST', `/sessions/${s.id}/tool-activities/act-zeta`, { 'x-tenant-id': 'tenant-zeta' }, { decision: 'confirm' })
  assert.equal(zetaConfirm.status, 200, 'the owning tenant confirms through the route')
  assert.equal(zetaConfirm.json.status, 'done', 'the write executed on the owner’s confirm')
  assert.equal(writeAudits(), auditBefore + 1, 'the owner’s confirm recorded exactly one connector.write audit')
})

test('project relations are tenant-isolated on a remote backend (projection + foreign-target refusal)', async () => {
  const { buildRouter } = await import('../server/routes/index.ts')
  const call = caller(buildRouter())

  // tenant-zeta creates a project THROUGH the route (op stamped with the caller's tenant).
  const create = await call('POST', '/relations/ops', { 'x-tenant-id': 'tenant-zeta' }, {
    op: { kind: 'create-project', projectId: 'proj-zeta', projectName: 'Zeta Only', projectDescription: '' },
  })
  assert.equal(create.status, 200, 'the create-project op applies')

  // The projected graph: tenant-zeta sees it, tenant-omega does not.
  const gZeta = await call('GET', '/relations', { 'x-tenant-id': 'tenant-zeta' })
  assert.ok(gZeta.json.extraProjects.some((p) => p.id === 'proj-zeta'), 'the creating tenant sees its project')
  const gOmega = await call('GET', '/relations', { 'x-tenant-id': 'tenant-omega' })
  assert.ok(!gOmega.json.extraProjects.some((p) => p.id === 'proj-zeta'), 'another tenant does not see it')

  // tenant-omega cannot file a session into tenant-zeta's project — 404 (existence-hiding),
  // refused before the shared reducer runs.
  const foreign = await call('POST', '/relations/ops', { 'x-tenant-id': 'tenant-omega' }, {
    op: { kind: 'file-session', sessionId: 'sess-omega', sessionTitle: 'S', projectId: 'proj-zeta', projectName: 'Zeta Only' },
  })
  assert.equal(foreign.status, 404, 'a cross-tenant project target is refused 404')

  // …nor via a create-project COLLIDING with zeta's id (the reducer's re-file path would
  // otherwise inject omega's session into zeta's project) — refused 404, and zeta's graph
  // never gains the omega join.
  const collide = await call('POST', '/relations/ops', { 'x-tenant-id': 'tenant-omega' }, {
    op: { kind: 'create-project', projectId: 'proj-zeta', projectName: 'Hijack', projectDescription: '', sessionId: 'sess-omega', sessionTitle: 'S' },
  })
  assert.equal(collide.status, 404, 'a colliding-id create-project is refused 404')
  const gZeta2 = await call('GET', '/relations', { 'x-tenant-id': 'tenant-zeta' })
  assert.ok(!('sess-omega' in gZeta2.json.sessionProject), 'omega’s session was NOT injected into zeta’s project')
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
