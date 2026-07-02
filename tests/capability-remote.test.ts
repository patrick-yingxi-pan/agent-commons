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

  // …nor via a GHOST projectId: an id with no Project buckets to the DEFAULT tenant on read,
  // so a non-default tenant keying a row under it would inject into the default view. Refused.
  const ghost = await call('POST', '/relations/ops', { 'x-tenant-id': 'tenant-omega' }, {
    op: { kind: 'scope-context', projectId: 'ghost-omega', projectName: 'x', context: { id: 'c', label: 'omega-secret', kind: 'connector' } },
  })
  assert.equal(ghost.status, 404, 'a ghost-projectId op from a non-default tenant is refused 404')
  const gDefault = await call('GET', '/relations') // the default (web) principal
  assert.ok(!('ghost-omega' in gDefault.json.projectContexts), 'the ghost row did not inject into the default tenant’s view')
})

test('Agent-Commons registries are tenant-scoped on a remote backend (created private, seed shared)', async () => {
  const { buildRouter } = await import('../server/routes/index.ts')
  const call = caller(buildRouter())

  // tenant-zeta creates an agent through the route (stamped with its tenant).
  const created = await call('POST', '/agents', { 'x-tenant-id': 'tenant-zeta' }, { label: 'Zeta agent' })
  assert.equal(created.status, 200, 'the agent is created')
  const id = created.json.id

  const zeta = await call('GET', '/agents', { 'x-tenant-id': 'tenant-zeta' })
  assert.ok(zeta.json.some((a) => a.id === id), 'the creating tenant lists its agent')
  const omega = await call('GET', '/agents', { 'x-tenant-id': 'tenant-omega' })
  assert.ok(!omega.json.some((a) => a.id === id), 'another tenant does not list it')
  // …but the shared seeded default agent is visible to BOTH (infrastructure, not content).
  assert.ok(zeta.json.some((a) => !a.tenantId) && omega.json.some((a) => !a.tenantId), 'the seeded default is shared')

  // Cross-tenant get-by-id is 404 (no existence leak).
  const getOmega = await call('GET', `/agents/${id}`, { 'x-tenant-id': 'tenant-omega' })
  assert.equal(getOmega.status, 404, 'a cross-tenant agent id is 404')
})

test('Agent-Commons by-id MUTATIONS are tenant-isolated on a remote backend (foreign PATCH/DELETE → 404, entry survives)', async () => {
  const { store } = await import('../server/store.ts')
  const { buildRouter } = await import('../server/routes/index.ts')
  const call = caller(buildRouter())

  // tenant-zeta owns one PRIVATE (created) entry of each registry family. Ids are sequential
  // and guessable, so the by-id mutation routes must authorize the caller's tenant — not just
  // exist-check — before writing. (Created directly through the store with an explicit tenant;
  // the create path itself is covered by the sibling registries test.)
  const prov = store.createProvider({ label: 'Zeta prov', modelFamily: 'claude', effortLevels: ['Low'] }, {}, 'tenant-zeta')
  const agent = store.createAgent({ label: 'Zeta agent', systemPrompt: 'x', tools: [], instructions: '' }, 'tenant-zeta')
  const prompt = store.createSystemPrompt({ label: 'Zeta prompt', body: 'b', targetFamily: 'claude' }, 'tenant-zeta')
  const proj = store.listProjects()[0]
  const commission = store.createCommission({ agentId: agent.id, projectId: proj.id }, 'tenant-zeta')

  // Every by-id mutation from a FOREIGN tenant is 404 (existence-hiding), never a 403 that
  // would confirm the id. The guard short-circuits before the body is read.
  const cases = [
    ['PATCH', `/providers/${prov.id}`, { label: 'hijack' }],
    ['DELETE', `/providers/${prov.id}`, undefined],
    ['PATCH', `/agents/${agent.id}`, { label: 'hijack' }],
    ['DELETE', `/agents/${agent.id}`, undefined],
    ['PATCH', `/system-prompts/${prompt.id}`, { label: 'hijack' }],
    ['DELETE', `/system-prompts/${prompt.id}`, undefined],
    ['PATCH', `/commissions/${commission.id}`, { role: 'reader' }],
    ['DELETE', `/commissions/${commission.id}`, undefined],
  ]
  for (const [method, path, bodyObj] of cases) {
    const r = await call(method, path, { 'x-tenant-id': 'tenant-omega' }, bodyObj)
    assert.equal(r.status, 404, `a foreign ${method} ${path} must be 404`)
  }

  // Nothing was mutated or deleted — the owner still lists each entry, label intact.
  assert.ok(store.listProviders('tenant-zeta').some((p) => p.id === prov.id && p.label === 'Zeta prov'), 'provider survived unchanged')
  assert.ok(store.listAgents('tenant-zeta').some((a) => a.id === agent.id && a.label === 'Zeta agent'), 'agent survived unchanged')
  assert.ok(store.listSystemPrompts('tenant-zeta').some((p) => p.id === prompt.id && p.label === 'Zeta prompt'), 'prompt survived unchanged')
  assert.ok(store.listCommissions(undefined, 'tenant-zeta').some((c) => c.id === commission.id), 'commission survived')

  // Positive control: the OWNING tenant patches its own agent through the same route.
  const own = await call('PATCH', `/agents/${agent.id}`, { 'x-tenant-id': 'tenant-zeta' }, { label: 'renamed by owner' })
  assert.equal(own.status, 200, 'the owner patches its own agent')
  assert.equal(own.json.label, 'renamed by owner')
})

test('shared/seeded registry infra is read-by-all but written-by-owner on a remote backend (non-default tenant can’t mutate it)', async () => {
  const { store } = await import('../server/store.ts')
  const { buildRouter } = await import('../server/routes/index.ts')
  const call = caller(buildRouter())

  // The seeded default provider is SHARED infra (no tenantId) — visible to every tenant, but
  // owned (writable) only by the default tenant. A non-default tenant seeing it in its list
  // must still not be able to reconfigure it for everyone.
  const shared = store.listProviders().find((p) => p.tenantId === undefined)
  assert.ok(shared, 'there is a shared seeded provider')
  const originalLabel = shared.label

  // It IS visible to a non-default tenant (read model — infra).
  const omegaList = await call('GET', '/providers', { 'x-tenant-id': 'tenant-omega' })
  assert.ok(omegaList.json.some((p) => p.id === shared.id), 'the shared provider is visible to a non-default tenant')

  // …but a non-default tenant cannot PATCH or DELETE it — 404 (existence-hiding), no effect.
  const omegaPatch = await call('PATCH', `/providers/${shared.id}`, { 'x-tenant-id': 'tenant-omega' }, { label: 'hijack' })
  assert.equal(omegaPatch.status, 404, 'a non-default tenant cannot PATCH shared infra')
  const omegaDelete = await call('DELETE', `/providers/${shared.id}`, { 'x-tenant-id': 'tenant-omega' })
  assert.equal(omegaDelete.status, 404, 'a non-default tenant cannot DELETE shared infra')
  assert.equal(store.listProviders().find((p) => p.id === shared.id)?.label, originalLabel, 'the shared provider was not mutated')

  // Positive control: the DEFAULT tenant (no header ⇒ the backend's owning tenant) gets PAST
  // the write guard — DELETE reaches the protected-default check (409), not the 404 guard.
  const ownerDelete = await call('DELETE', `/providers/${shared.id}`)
  assert.equal(ownerDelete.status, 409, 'the owning (default) tenant reaches the protected-default guard, proving it owns shared infra')
})

test('registry by-id READS are tenant-isolated on a remote backend (prompt probe + commission authority → 404)', async () => {
  const { store } = await import('../server/store.ts')
  const { buildRouter } = await import('../server/routes/index.ts')
  const call = caller(buildRouter())

  const prompt = store.createSystemPrompt({ label: 'Zeta prompt', body: 'b', targetFamily: 'claude' }, 'tenant-zeta')
  const agent = store.createAgent({ label: 'Zeta agent', systemPrompt: 'x', tools: [], instructions: '' }, 'tenant-zeta')
  const proj = store.listProjects()[0]
  const commission = store.createCommission({ agentId: agent.id, projectId: proj.id }, 'tenant-zeta')

  // Both by-id READS that derive from a private entry must scope to the caller: a foreign
  // tenant probing zeta's prompt, or reading its commission's effective authority, is 404.
  const providerId = store.listProviders('tenant-zeta')[0].id
  const probeOmega = await call('POST', `/system-prompts/${prompt.id}/probe`, { 'x-tenant-id': 'tenant-omega' }, { providerId })
  assert.equal(probeOmega.status, 404, 'a foreign tenant cannot probe another tenant’s prompt')
  const authOmega = await call('GET', `/commissions/${commission.id}/authority`, { 'x-tenant-id': 'tenant-omega' })
  assert.equal(authOmega.status, 404, 'a foreign tenant cannot read another tenant’s commission authority')

  // Positive controls: the owner reads both.
  const authZeta = await call('GET', `/commissions/${commission.id}/authority`, { 'x-tenant-id': 'tenant-zeta' })
  assert.equal(authZeta.status, 200, 'the owner reads its own commission authority')
})

test('relation ops with a foreign AGENT/COMMISSION subject are refused on a remote backend (opDeniedForTenant axes)', async () => {
  const { store } = await import('../server/store.ts')
  const { buildRouter } = await import('../server/routes/index.ts')
  const call = caller(buildRouter())

  // tenant-zeta owns a private agent + a commission of it.
  const agent = store.createAgent({ label: 'Zeta agent', systemPrompt: 'x', tools: [], instructions: '' }, 'tenant-zeta')
  const seedProj = store.listProjects()[0]
  const commission = store.createCommission({ agentId: agent.id, projectId: seedProj.id }, 'tenant-zeta')

  // tenant-omega owns a project, so the op's PROJECT axis passes — isolating the subject axis.
  const mk = await call('POST', '/relations/ops', { 'x-tenant-id': 'tenant-omega' }, {
    op: { kind: 'create-project', projectId: 'proj-omega', projectName: 'Omega Only', projectDescription: '' },
  })
  assert.equal(mk.status, 200, 'omega creates its own project')

  // Commissioning zeta's PRIVATE agent into omega's own project is refused by the AGENT axis.
  const commOmega = await call('POST', '/relations/ops', { 'x-tenant-id': 'tenant-omega' }, {
    op: { kind: 'commission-agent', agentId: agent.id, agentLabel: 'Zeta agent', projectId: 'proj-omega', projectName: 'Omega Only' },
  })
  assert.equal(commOmega.status, 404, 'a foreign agent subject is refused 404')

  // Uncommissioning zeta's PRIVATE commission is refused by the COMMISSION axis.
  const unOmega = await call('POST', '/relations/ops', { 'x-tenant-id': 'tenant-omega' }, {
    op: { kind: 'uncommission-agent', commissionId: commission.id, agentLabel: 'Zeta agent', projectId: 'proj-omega', projectName: 'Omega Only' },
  })
  assert.equal(unOmega.status, 404, 'a foreign commission subject is refused 404')
  assert.ok(store.listCommissions(undefined, 'tenant-zeta').some((c) => c.id === commission.id), 'zeta’s commission survived the foreign uncommission')
})

test('the usage gauge is tenant-scoped on a remote backend (a fresh tenant sees its own empty windows)', async () => {
  const { buildRouter } = await import('../server/routes/index.ts')
  const call = caller(buildRouter())

  // The default (no-header) principal is the web tenant that owns the seeded demo meter —
  // its 5-hour window reads a real mid-period baseline.
  const def = await call('GET', '/usage')
  assert.equal(def.status, 200)
  const defWin = def.json.limits.find((w) => w.label === '5-hour limit')
  assert.ok(defWin && defWin.pct > 0, 'the default tenant’s gauge shows the seeded baseline')

  // A different tenant sees its OWN (fresh) windows — not the default's aggregate.
  const omega = await call('GET', '/usage', { 'x-tenant-id': 'tenant-omega' })
  assert.equal(omega.status, 200)
  const omegaWin = omega.json.limits.find((w) => w.label === '5-hour limit')
  assert.ok(omegaWin && omegaWin.pct === 0, 'a fresh tenant’s gauge starts empty, isolated from the default')
})

test('a shared Project admits a cross-tenant Contributor on a remote backend (P8 cooperation), while a private one refuses it', async () => {
  const { buildRouter } = await import('../server/routes/index.ts')
  const call = caller(buildRouter())

  // tenant-zeta creates a project and SHARES it (owner-only ops).
  await call('POST', '/relations/ops', { 'x-tenant-id': 'tenant-zeta' }, {
    op: { kind: 'create-project', projectId: 'proj-shared', projectName: 'Shared', projectDescription: '' },
  })
  const share = await call('POST', '/relations/ops', { 'x-tenant-id': 'tenant-zeta' }, {
    op: { kind: 'share-project', projectId: 'proj-shared', projectName: 'Shared', shared: true },
  })
  assert.equal(share.status, 200, 'the owner shares its project')

  // A non-owner cannot share it.
  const foreignShare = await call('POST', '/relations/ops', { 'x-tenant-id': 'tenant-omega' }, {
    op: { kind: 'share-project', projectId: 'proj-shared', projectName: 'Shared', shared: false },
  })
  assert.equal(foreignShare.status, 404, 'only the owner may (un)share a project')

  // tenant-omega owns an agent (created through the route → stamped omega).
  const created = await call('POST', '/agents', { 'x-tenant-id': 'tenant-omega' }, { label: 'Omega worker' })
  const omegaAgentId = created.json.id

  // omega commissions ITS OWN agent onto zeta's SHARED project — ALLOWED (200).
  const commission = await call('POST', '/relations/ops', { 'x-tenant-id': 'tenant-omega' }, {
    op: { kind: 'commission-agent', agentId: omegaAgentId, agentLabel: 'Omega worker', projectId: 'proj-shared', projectName: 'Shared' },
  })
  assert.equal(commission.status, 200, 'a cross-tenant commission onto a shared project succeeds')

  // The shared Contributor list shows omega's commission to BOTH tenants (public contributors).
  const listZeta = await call('GET', '/commissions?project=proj-shared', { 'x-tenant-id': 'tenant-zeta' })
  assert.ok(listZeta.json.some((c) => c.agentId === omegaAgentId), 'the owner sees the cross-tenant Contributor')
  const listOmega = await call('GET', '/commissions?project=proj-shared', { 'x-tenant-id': 'tenant-omega' })
  assert.ok(listOmega.json.some((c) => c.agentId === omegaAgentId), 'the contributor sees its own commission')

  // Isolation control: the SAME commission onto a PRIVATE zeta project is refused 404.
  await call('POST', '/relations/ops', { 'x-tenant-id': 'tenant-zeta' }, {
    op: { kind: 'create-project', projectId: 'proj-priv', projectName: 'Priv', projectDescription: '' },
  })
  const refused = await call('POST', '/relations/ops', { 'x-tenant-id': 'tenant-omega' }, {
    op: { kind: 'commission-agent', agentId: omegaAgentId, agentLabel: 'Omega worker', projectId: 'proj-priv', projectName: 'Priv' },
  })
  assert.equal(refused.status, 404, 'a private project still refuses the cross-tenant commission (isolation intact)')
})

test('P8 BUG-1 — POST /commissions (direct REST) reaches a shared CREATED project cross-tenant, and 404s a private one', async () => {
  const { buildRouter } = await import('../server/routes/index.ts')
  const call = caller(buildRouter())

  await call('POST', '/relations/ops', { 'x-tenant-id': 'tenant-zeta2' }, {
    op: { kind: 'create-project', projectId: 'proj-rest-shared', projectName: 'RestShared', projectDescription: '' },
  })
  await call('POST', '/relations/ops', { 'x-tenant-id': 'tenant-zeta2' }, {
    op: { kind: 'share-project', projectId: 'proj-rest-shared', projectName: 'RestShared', shared: true },
  })
  const created = await call('POST', '/agents', { 'x-tenant-id': 'tenant-omega2' }, { label: 'Omega2 worker' })
  const omegaAgentId = created.json.id

  // The DIRECT REST path (not the op path) onto the shared CREATED project — must succeed now
  // (before BUG-1 it 404'd because the guard used seed-only `listProjects()`).
  const commission = await call('POST', '/commissions', { 'x-tenant-id': 'tenant-omega2' }, {
    agentId: omegaAgentId, projectId: 'proj-rest-shared',
  })
  assert.equal(commission.status, 200, 'POST /commissions reaches a shared created project cross-tenant (BUG-1 fixed)')

  // A PRIVATE created project refuses the same direct REST commission (404, existence-hiding).
  await call('POST', '/relations/ops', { 'x-tenant-id': 'tenant-zeta2' }, {
    op: { kind: 'create-project', projectId: 'proj-rest-priv', projectName: 'RestPriv', projectDescription: '' },
  })
  const refused = await call('POST', '/commissions', { 'x-tenant-id': 'tenant-omega2' }, {
    agentId: omegaAgentId, projectId: 'proj-rest-priv',
  })
  assert.equal(refused.status, 404, 'a private created project refuses the direct REST cross-tenant commission')
})

test('P8 BUG-5 — a shared Project exposes a foreign Contributor’s IDENTITY but not its effective REACH (who, not what-they-reach)', async () => {
  const { buildRouter } = await import('../server/routes/index.ts')
  const call = caller(buildRouter())

  await call('POST', '/relations/ops', { 'x-tenant-id': 'tenant-owner5' }, {
    op: { kind: 'create-project', projectId: 'proj-who', projectName: 'Who', projectDescription: '' },
  })
  await call('POST', '/relations/ops', { 'x-tenant-id': 'tenant-owner5' }, {
    op: { kind: 'share-project', projectId: 'proj-who', projectName: 'Who', shared: true },
  })
  const created = await call('POST', '/agents', { 'x-tenant-id': 'tenant-contrib5' }, { label: 'Contrib5' })
  const comm = await call('POST', '/commissions', { 'x-tenant-id': 'tenant-contrib5' }, { agentId: created.json.id, projectId: 'proj-who' })
  assert.equal(comm.status, 200)
  const commissionId = comm.json.id

  // An uninvolved THIRD tenant can see WHO contributes (identity, redacted) …
  const byId = await call('GET', `/commissions/${commissionId}`, { 'x-tenant-id': 'tenant-third5' })
  assert.equal(byId.status, 200, 'a shared project’s contributor identity is public across tenants')
  assert.equal(byId.json.authority, undefined, 'identity only — the D12 authority is redacted')
  // … but NOT what it can reach: the effective D12 authority stays private to the commission owner.
  const authority = await call('GET', `/commissions/${commissionId}/authority`, { 'x-tenant-id': 'tenant-third5' })
  assert.equal(authority.status, 404, 'effective reach is not exposed cross-tenant (intended tighter redaction)')
})

test('P8 B8 — a cross-tenant self-commission cannot self-assign an elevated role over HTTP (clamped to writer)', async () => {
  const { buildRouter } = await import('../server/routes/index.ts')
  const call = caller(buildRouter())

  await call('POST', '/relations/ops', { 'x-tenant-id': 'tenant-o8' }, {
    op: { kind: 'create-project', projectId: 'proj-r8', projectName: 'R8', projectDescription: '' },
  })
  await call('POST', '/relations/ops', { 'x-tenant-id': 'tenant-o8' }, {
    op: { kind: 'share-project', projectId: 'proj-r8', projectName: 'R8', shared: true },
  })
  const created = await call('POST', '/agents', { 'x-tenant-id': 'tenant-c8' }, { label: 'C8' })
  const agentId = created.json.id
  await call('POST', '/relations/ops', { 'x-tenant-id': 'tenant-c8' }, {
    op: { kind: 'commission-agent', agentId, agentLabel: 'C8', projectId: 'proj-r8', projectName: 'R8', role: 'owner' },
  })
  const list = await call('GET', '/commissions?project=proj-r8', { 'x-tenant-id': 'tenant-c8' })
  assert.equal(list.json.find((c) => c.agentId === agentId)?.role, 'writer', 'the self-assigned owner role is clamped to writer cross-tenant')
})

test('P8 Phase 2b — effect-route authorization: own-commission fires; a foreign caller cannot act as it; un-share revokes cross-tenant effects', async () => {
  const { buildRouter } = await import('../server/routes/index.ts')
  const call = caller(buildRouter())

  // Owner A creates + shares a project, scopes a connector; B commissions its OWN agent onto it.
  await call('POST', '/relations/ops', { 'x-tenant-id': 'tenant-eff-a' }, { op: { kind: 'create-project', projectId: 'proj-eff', projectName: 'Eff', projectDescription: '' } })
  await call('POST', '/relations/ops', { 'x-tenant-id': 'tenant-eff-a' }, { op: { kind: 'share-project', projectId: 'proj-eff', projectName: 'Eff', shared: true } })
  await call('POST', '/relations/ops', { 'x-tenant-id': 'tenant-eff-a' }, { op: { kind: 'scope-context', projectId: 'proj-eff', projectName: 'Eff', context: { kind: 'connector', label: 'Linear', meta: '' } } })
  const bAgent = await call('POST', '/agents', { 'x-tenant-id': 'tenant-eff-b' }, { label: 'B eff worker' })
  const commission = await call('POST', '/commissions', { 'x-tenant-id': 'tenant-eff-b' }, { agentId: bAgent.json.id, projectId: 'proj-eff' })
  const commId = commission.json.id

  // B fires an effect as ITS OWN commission on the shared project → allowed (writer, admitted Linear).
  const okB = await call('POST', '/projects/proj-eff/effects', { 'x-tenant-id': 'tenant-eff-b' }, { commissionId: commId, subGoal: 'sg-b', type: 'connector.write', target: 'Linear' })
  assert.equal(okB.status, 200, 'B fires an effect as its own commission on the shared project')

  // A THIRD tenant citing B's commissionId → 403 (caller-identity: act only as your own commission).
  const forge = await call('POST', '/projects/proj-eff/effects', { 'x-tenant-id': 'tenant-eff-c' }, { commissionId: commId, subGoal: 'sg-c', type: 'connector.write', target: 'Linear' })
  assert.equal(forge.status, 403, 'a foreign tenant cannot forge-act as another tenant’s commission')

  // Owner A UN-shares → B's effect is REVOKED (403); the effect route now honors the shared flag.
  await call('POST', '/relations/ops', { 'x-tenant-id': 'tenant-eff-a' }, { op: { kind: 'share-project', projectId: 'proj-eff', projectName: 'Eff', shared: false } })
  const revoked = await call('POST', '/projects/proj-eff/effects', { 'x-tenant-id': 'tenant-eff-b' }, { commissionId: commId, subGoal: 'sg-b2', type: 'connector.write', target: 'Linear' })
  assert.equal(revoked.status, 403, 'after un-share, the cross-tenant Contributor’s effects are revoked')

  // Control: a SAME-tenant commission on a PRIVATE project is unaffected by the shared-gate.
  await call('POST', '/relations/ops', { 'x-tenant-id': 'tenant-eff-a' }, { op: { kind: 'create-project', projectId: 'proj-priv-eff', projectName: 'PrivEff', projectDescription: '' } })
  await call('POST', '/relations/ops', { 'x-tenant-id': 'tenant-eff-a' }, { op: { kind: 'scope-context', projectId: 'proj-priv-eff', projectName: 'PrivEff', context: { kind: 'connector', label: 'Linear', meta: '' } } })
  const aAgent = await call('POST', '/agents', { 'x-tenant-id': 'tenant-eff-a' }, { label: 'A eff worker' })
  const aComm = await call('POST', '/commissions', { 'x-tenant-id': 'tenant-eff-a' }, { agentId: aAgent.json.id, projectId: 'proj-priv-eff' })
  const okA = await call('POST', '/projects/proj-priv-eff/effects', { 'x-tenant-id': 'tenant-eff-a' }, { commissionId: aComm.json.id, subGoal: 'sg-a', type: 'connector.write', target: 'Linear' })
  assert.equal(okA.status, 200, 'a same-tenant commission on a private project is unaffected by the shared-gate')
})

test('P8 Phase 2b review — project-binding: a self-owned commission cannot act on a DIFFERENT project (cross-tenant guardian DoS + mis-attribution closed)', async () => {
  const { buildRouter } = await import('../server/routes/index.ts')
  const call = caller(buildRouter())

  // Victim creates + shares + scopes a project, then UN-shares it (guardianId is retained).
  await call('POST', '/relations/ops', { 'x-tenant-id': 'tenant-vic' }, { op: { kind: 'create-project', projectId: 'proj-vic', projectName: 'Vic', projectDescription: '' } })
  await call('POST', '/relations/ops', { 'x-tenant-id': 'tenant-vic' }, { op: { kind: 'share-project', projectId: 'proj-vic', projectName: 'Vic', shared: true } })
  await call('POST', '/relations/ops', { 'x-tenant-id': 'tenant-vic' }, { op: { kind: 'scope-context', projectId: 'proj-vic', projectName: 'Vic', context: { kind: 'connector', label: 'Linear', meta: '' } } })
  await call('POST', '/relations/ops', { 'x-tenant-id': 'tenant-vic' }, { op: { kind: 'share-project', projectId: 'proj-vic', projectName: 'Vic', shared: false } })

  // Attacker creates its OWN project, scopes a connector, and commissions its own agent ON IT
  // (so its commission's own project is attacker-controlled and shared-gate-passing).
  await call('POST', '/relations/ops', { 'x-tenant-id': 'tenant-atk' }, { op: { kind: 'create-project', projectId: 'proj-atk', projectName: 'Atk', projectDescription: '' } })
  await call('POST', '/relations/ops', { 'x-tenant-id': 'tenant-atk' }, { op: { kind: 'scope-context', projectId: 'proj-atk', projectName: 'Atk', context: { kind: 'connector', label: 'Linear', meta: '' } } })
  const atkAgent = await call('POST', '/agents', { 'x-tenant-id': 'tenant-atk' }, { label: 'Atk worker' })
  const atkComm = await call('POST', '/commissions', { 'x-tenant-id': 'tenant-atk' }, { agentId: atkAgent.json.id, projectId: 'proj-atk' })

  // The exploit: attacker cites its OWN commission to fire an effect on the VICTIM's project.
  // Blocked 403 — the commission is not a Contributor on proj-vic (project-binding).
  const effect = await call('POST', '/projects/proj-vic/effects', { 'x-tenant-id': 'tenant-atk' }, { commissionId: atkComm.json.id, subGoal: 'sg-atk', type: 'connector.write', target: 'Linear' })
  assert.equal(effect.status, 403, 'a self-owned commission cannot fire on a different tenant’s project')

  // Same wall on the guardian-DoS vector: holding a sub-goal on the victim's guardian.
  const reserve = await call('POST', '/projects/proj-vic/subgoals', { 'x-tenant-id': 'tenant-atk' }, { holder: atkComm.json.id, subGoal: 'sg-steal' })
  assert.equal(reserve.status, 403, 'a self-owned commission cannot hold a sub-goal on a different project’s guardian')

  // Control: the commission works on its OWN project (private, same-tenant) — binding passes.
  const own = await call('POST', '/projects/proj-atk/effects', { 'x-tenant-id': 'tenant-atk' }, { commissionId: atkComm.json.id, subGoal: 'sg-own', type: 'connector.write', target: 'Linear' })
  assert.equal(own.status, 200, 'the commission works on its own project')
})

test('P8 review — commission-agent hides agent existence uniformly cross-tenant (ghost id → 404, not a 409 oracle), while the owner’s own removed-agent still 409s', async () => {
  const { buildRouter } = await import('../server/routes/index.ts')
  const call = caller(buildRouter())

  await call('POST', '/relations/ops', { 'x-tenant-id': 'tenant-ownerG' }, {
    op: { kind: 'create-project', projectId: 'proj-ghost', projectName: 'Ghost', projectDescription: '' },
  })
  await call('POST', '/relations/ops', { 'x-tenant-id': 'tenant-ownerG' }, {
    op: { kind: 'share-project', projectId: 'proj-ghost', projectName: 'Ghost', shared: true },
  })

  // A FOREIGN tenant committing a NONEXISTENT agent onto the shared project gets 404 — matching
  // the 404 a real foreign PRIVATE agent gets, so the two can't be distinguished (no existence
  // oracle over the private-agent registry, which has no cross-tenant read projection).
  const ghostForeign = await call('POST', '/relations/ops', { 'x-tenant-id': 'tenant-probeG' }, {
    op: { kind: 'commission-agent', agentId: 'agent-does-not-exist', agentLabel: 'x', projectId: 'proj-ghost', projectName: 'Ghost' },
  })
  assert.equal(ghostForeign.status, 404, 'a ghost agent on the cross-tenant carve-out is a uniform 404, not a 409 oracle')

  // Control: the OWNER (same tenant) committing an unknown agent id onto its OWN project still gets
  // the helpful 409 (agent removed → re-propose) — the fix is scoped to the cross-tenant path.
  const ghostOwner = await call('POST', '/relations/ops', { 'x-tenant-id': 'tenant-ownerG' }, {
    op: { kind: 'commission-agent', agentId: 'agent-does-not-exist', agentLabel: 'x', projectId: 'proj-ghost', projectName: 'Ghost' },
  })
  assert.equal(ghostOwner.status, 409, 'the owner’s own removed-agent commission still returns 409 (preserved)')
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
