/** Route table for the mock backend. Each resource registers its endpoints here;
 *  Phase 1 wires capabilities, the ambient event stream, and sessions. The router
 *  is plain data — adding a resource is adding a `.get(...)` line. */
import type {
  ApplyOpRequest,
  AttachContextRequest,
  CreateCommissionRequest,
  CreateDispatchRequest,
  CreateProviderRequest,
  UpdateProviderRequest,
  CreateSystemPromptRequest,
  UpdateSystemPromptRequest,
  CreateAgentRequest,
  UpdateAgentRequest,
  UpdateCommissionRequest,
  ReserveSubGoalRequest,
  PushRecentRequest,
  RegisterRunnerRequest,
  SendMessageRequest,
  SetRunnerCapabilitiesRequest,
  SetConnectorStatusRequest,
  UpdateScheduleRequest,
} from '../../contract/index.ts'
import { timingSafeEqual } from 'node:crypto'
import { Router } from '../http/router.ts'
import { sendJson, sendError, sendBytes, sendJsonCached, sendText, headerValue, type Ctx } from '../http/respond.ts'
import { openSse } from '../http/sse.ts'
import { store, type GenerationOutcome } from '../store.ts'
import { IdempotencyCache, captureResponse, replayResponse } from '../idempotency.ts'
import { pageParams, paginate, MAX_PAGE_LIMIT } from '../pagination.ts'
import { RateLimiter } from '../ratelimit.ts'
import { generateReply } from '../generate.ts'
import { CapabilityError, runCapability, scopeMatches } from '../runner-runtime.ts'
import { GuardianError } from '../guardian.ts'
import { BudgetError } from '../usage.ts'
import { AuthorityError } from '../authority.ts'
import { ConflictError } from '../conflict.ts'
import { LimitError } from '../limit.ts'
import { isMonotonic, isProjectEffectMonotonic, PROJECT_EFFECT_TYPES, PROJECT_ROLES } from '../../contract/index.ts'
import type {
  CapabilityRequest,
  ProjectEffectRequest,
  PromptProbeRequest,
  ProxyRequest,
  ReserveRequest,
  SetCapacityRequest,
  SyncEffectsRequest,
} from '../../contract/index.ts'
import type { ServerResponse, IncomingMessage } from 'node:http'

/** Gate a native route on a capability: 409 capability_unavailable when this
 *  backend (a remote web server) can't fulfill it. Returns whether to proceed. */
function gate(res: ServerResponse, feature: 'localFs' | 'localGit' | 'osPicker' | 'clipboard'): boolean {
  if (store.can(feature)) return true
  sendError(res, 'capability_unavailable', `'${feature}' needs the native backend; this is a remote web server.`)
  return false
}

/** Runner enrollment auth (F4): when `RUNNER_ENROLL_TOKEN` is set, every state-changing
 *  runner-lifecycle call — enroll, reconnect (heartbeat), re-advertise, deregister — must
 *  present it via `Authorization: Bearer <t>` (scheme case-insensitive) or `x-runner-token`.
 *  The compare is constant-time so the secret isn't recoverable byte-by-byte via timing.
 *  Unset ⇒ open enrollment (the loopback-sidecar default; the existing suite is unaffected).
 *  This is the shared-secret stand-in for the mTLS/token runner identity a real broker uses. */
function enrollmentAllowed(req: IncomingMessage): boolean {
  const token = process.env.RUNNER_ENROLL_TOKEN
  if (!token) return true
  const authz = headerValue(req.headers, 'authorization')
  const bearer = authz ? /^Bearer\s+(.+)$/i.exec(authz)?.[1] : undefined
  const supplied = bearer || headerValue(req.headers, 'x-runner-token') || ''
  const a = Buffer.from(supplied)
  const b = Buffer.from(token)
  return a.length === b.length && timingSafeEqual(a, b)
}

export function buildRouter(): Router {
  const r = new Router()

  // ── Request correlation id (design F3 / observability) ──────────────────────
  // Stamp every matched-route response with an `X-Request-Id` — the seam logs/traces
  // correlate on (F6 OpenTelemetry). Registered FIRST so even a short-circuited
  // response (a 429 from rate limiting below) carries one. (Router-boundary 404s and
  // OPTIONS/static responses are emitted before routing — see server/index.ts — so a
  // production deployment stamps at the edge to cover those too.)
  //
  // Honour an inbound `X-Request-Id` for trace propagation, but ONLY when it's a safe
  // bounded token — a client-supplied id flows into logs, so an unvalidated one is a
  // log-injection / unbounded-cardinality vector. Otherwise mint a per-process id.
  let requestSeq = 0
  const SAFE_REQUEST_ID = /^[A-Za-z0-9._-]{1,128}$/
  r.use((ctx) => {
    const inbound = headerValue(ctx.req.headers, 'x-request-id')
    const id = inbound && SAFE_REQUEST_ID.test(inbound) ? inbound : `req-${store.epoch}-${++requestSeq}`
    ctx.res.setHeader('X-Request-Id', id)
    return true
  })

  // ── Request metrics (design F6 PD31 — observability) ────────────────────────
  // A per-method counter over matched routes, exposed at `/metrics` in Prometheus
  // text format alongside process uptime/epoch. Counted in middleware (the method is
  // known pre-handler); router-boundary 404s aren't matched, so — like the correlation
  // id — a production deployment would meter at the edge for full coverage.
  const startedAt = Date.now()
  const requestsByMethod = new Map<string, number>()
  r.use((ctx) => {
    const m = ctx.req.method ?? 'UNKNOWN'
    requestsByMethod.set(m, (requestsByMethod.get(m) ?? 0) + 1)
    return true
  })

  // ── Idempotency (design F3 PD15) ────────────────────────────────────────────
  // Opt-in per route: a handler wrapped here replays the first response for a given
  // (tenant, `Idempotency-Key`) instead of running twice, so a retried create can't
  // duplicate. Transparent when the header is absent (the request runs normally),
  // and only applied to non-streaming create-mutations — never the SSE reply route.
  const idem = new IdempotencyCache()
  const idempotent =
    (handler: (ctx: Ctx) => void | Promise<void>) =>
    async (ctx: Ctx): Promise<void> => {
      const key = headerValue(ctx.req.headers, 'idempotency-key')
      if (!key) return handler(ctx)
      const cacheKey = `${store.identity(ctx.req.headers).tenant.id}:${key}`
      const hit = idem.get(cacheKey)
      if (hit) return replayResponse(ctx.res, hit)
      const cap = captureResponse(ctx.res)
      await handler({ ...ctx, res: cap.res })
      // Cache only a SUCCESS (2xx). A non-2xx created no resource, so there's nothing
      // to dedup — and caching it would trap a client who fixes a bad request and
      // retries under the same key (they'd get the stale error). A failure simply re-runs.
      const rec = cap.record()
      if (rec && rec.status >= 200 && rec.status < 300) idem.put(cacheKey, rec)
    }

  // ── Per-tenant rate limiting (design F3) ────────────────────────────────────
  // Opt-in via `RATE_LIMIT_PER_MIN` (read per request, so unset ⇒ disabled and the
  // existing suite is unaffected). Bounds *mutations* per tenant per minute; over the
  // limit replies 429 `limit_exceeded` with `Retry-After`. GETs are never limited.
  const limiter = new RateLimiter(60_000)
  r.use((ctx) => {
    const method = ctx.req.method
    if (method !== 'POST' && method !== 'PATCH' && method !== 'DELETE') return true
    const limit = Number(process.env.RATE_LIMIT_PER_MIN)
    if (!Number.isInteger(limit) || limit < 1) return true // not configured ⇒ disabled
    const result = limiter.check(store.identity(ctx.req.headers).tenant.id, limit)
    if (result.allowed) return true
    ctx.res.setHeader('Retry-After', String(Math.ceil(result.retryAfterMs / 1000)))
    sendError(ctx.res, 'limit_exceeded', 'Rate limit exceeded — retry shortly.')
    return false
  })

  // Send a list resource with opt-in cursor pagination (F3 PD14): `?limit[&cursor]`
  // returns a `Page<T>`; without `limit`, the full array (back-compat). One helper so
  // every paginated list endpoint reads + validates identically (form follows function).
  const sendList = <T>(res: Ctx['res'], url: URL, items: T[], keyOf: (item: T) => string): void => {
    const pp = pageParams(url)
    if (pp === 'invalid') {
      return sendError(res, 'bad_request', `limit must be an integer 1..${MAX_PAGE_LIMIT}`)
    }
    sendJson(res, pp ? paginate(items, keyOf, pp) : items)
  }

  // Refuse a by-id registry MUTATION the caller isn't authorized to make (F2/PD9). A registry
  // entry is INFRASTRUCTURE: read⊋write. It is READ by all tenants when *shared* (no
  // `tenantId`), but WRITTEN only by its owner — a *private* entry by its creating tenant, a
  // *shared* one by the default tenant that owns the seed infra. So the write set is stricter
  // than the read projection `visible`: from the caller's visible list we additionally require
  // ownership (own private, or shared-and-default). Anything else is 404 (existence-hiding —
  // never 403, which would confirm the id / distinguish "not yours" from "shared, not yours").
  // Backward-compatible on the single-tenant mock (caller is always the default ⇒ can write
  // shared + its own); only a non-default remote tenant is tightened off shared infra.
  const denyForeignEntry = <T extends { id: string; tenantId?: string }>(
    req: IncomingMessage,
    res: ServerResponse,
    id: string,
    visible: (tenantId: string) => T[],
    label: string,
  ): boolean => {
    const tenantId = store.identity(req.headers).tenant.id
    const entry = visible(tenantId).find((e) => e.id === id)
    const writable =
      entry !== undefined &&
      (entry.tenantId === tenantId ||
        (entry.tenantId === undefined && tenantId === store.defaultTenantId()))
    if (!writable) {
      sendError(res, 'not_found', `No ${label} '${id}'`)
      return true
    }
    return false
  }

  // ── Capabilities ────────────────────────────────────────────────────────
  // What this backend variant can do. The default mock behaves like a native
  // sidecar (local-* true); `BACKEND=remote` makes it a remote web server
  // (local-* false). The UI adapts off these flags, never off env-sniffing.
  r.get('/capabilities', (ctx) => {
    sendJsonCached(ctx, store.capabilities())
  })

  // ── Identity (who's talking + which tenant — design F2) ─────────────────────
  // The current principal the UI labels the account with (design P1 §4). Desktop is
  // the single local user; the remote web server resolves a tenant-scoped principal
  // from the auth seam (request headers stand in for verified IdP claims).
  r.get('/me', ({ req, res }) => {
    sendJson(res, store.identity(req.headers))
  })

  // ── Ops: liveness + readiness (design F6 — the autoscaled web tier) ──────────
  // `/healthz` — the process is up (load-balancer liveness). `/readyz` — the process
  // can serve: a cheap store probe stands in for the DB-connectivity check a real
  // deployment runs; a failure replies 503 so the LB drains this instance.
  r.get('/healthz', ({ res }) => {
    sendJson(res, { status: 'ok', epoch: store.epoch })
  })
  r.get('/readyz', ({ res }) => {
    // Draining (post-SIGTERM): report unready so the load balancer stops routing new
    // traffic here while in-flight work finishes — but the process stays alive (/healthz ok).
    if (store.isDraining()) return sendJson(res, { status: 'draining' }, 503)
    try {
      void store.listSessions().length // store responds ⇒ ready
      sendJson(res, { status: 'ready', backend: store.capabilities().backend })
    } catch {
      sendJson(res, { status: 'not_ready' }, 503)
    }
  })
  // `/metrics` — Prometheus text exposition (F6 PD31). Per-method request counts +
  // process uptime + the store epoch (as an info label). A real deployment adds
  // status-class + latency histograms metered at the edge.
  r.get('/metrics', ({ res }) => {
    const runners = store.registry.list()
    const onlineRunners = runners.filter((rn) => rn.status === 'online').length
    const gen = store.generationOutcomes()
    const lines = [
      '# HELP http_requests_total Matched-route requests by method.',
      '# TYPE http_requests_total counter',
      ...[...requestsByMethod].map(([m, n]) => `http_requests_total{method="${m}"} ${n}`),
      '# HELP runners_total Connected runners by status (F4 broker registry).',
      '# TYPE runners_total gauge',
      `runners_total{status="online"} ${onlineRunners}`,
      `runners_total{status="offline"} ${runners.length - onlineRunners}`,
      '# HELP model_turns_total Generation turns by outcome (P5 reliability / F6 observability).',
      '# TYPE model_turns_total counter',
      ...Object.entries(gen).map(([outcome, n]) => `model_turns_total{outcome="${outcome}"} ${n}`),
      '# HELP process_uptime_seconds Seconds since this router started.',
      '# TYPE process_uptime_seconds gauge',
      `process_uptime_seconds ${((Date.now() - startedAt) / 1000).toFixed(3)}`,
      '# HELP store_epoch_info The store epoch (changes on reseed); always 1.',
      '# TYPE store_epoch_info gauge',
      `store_epoch_info{epoch="${store.epoch}"} 1`,
    ]
    sendText(res, lines.join('\n') + '\n')
  })

  // ── Native-runner registry ─────────────────────────────────────────────────
  // The live set of connected runners (one per host) and the capabilities each
  // advertises. Runners enroll/reconnect via POST, keep alive via heartbeat,
  // re-advertise grants via PATCH, and disconnect via DELETE. Every change
  // broadcasts an ambient `runner.*` event over `/events`. Reads here are the
  // generalization of `/capabilities` from one static backend to a live registry.
  r.get('/runners', ({ res }) => {
    sendJson(res, store.registry.list())
  })
  r.get('/runners/:id', ({ res, params }) => {
    const runner = store.registry.get(params.id)
    if (!runner) return sendError(res, 'not_found', `No runner '${params.id}'`)
    sendJson(res, runner)
  })
  r.post('/runners', async ({ req, res, body }) => {
    if (!enrollmentAllowed(req)) return sendError(res, 'forbidden', 'runner enrollment requires a valid token')
    const input = await body<RegisterRunnerRequest>()
    if (!input?.label || !input?.host || !Array.isArray(input.capabilities)) {
      return sendError(res, 'bad_request', 'label, host, and capabilities are required')
    }
    // A client-supplied id becomes part of the runner source id (`runner:<id>`),
    // which the served-fs recents key splits on `::` (contract/fs.ts fsRecentKey).
    // Constrain it to a safe slug so it can't smuggle the delimiter (or other
    // separators) and corrupt that parse. Minted ids already fit this shape.
    if (input.id !== undefined && !/^[a-zA-Z0-9_-]+$/.test(input.id)) {
      return sendError(res, 'bad_request', 'runner id must be alphanumeric with dashes/underscores only')
    }
    sendJson(res, store.registry.register(input))
  })
  // Heartbeat reconnects an offline runner (durable-identity re-bind), so it's gated by
  // the same enrollment token as POST /runners — otherwise an unauthenticated caller could
  // resurrect a reaped runner and defeat liveness reaping.
  r.post('/runners/:id/heartbeat', ({ req, res, params }) => {
    if (!enrollmentAllowed(req)) return sendError(res, 'forbidden', 'runner enrollment requires a valid token')
    const runner = store.registry.heartbeat(params.id)
    if (!runner) return sendError(res, 'not_found', `No runner '${params.id}'`)
    sendJson(res, runner)
  })
  r.patch('/runners/:id/capabilities', async ({ req, res, params, body }) => {
    if (!enrollmentAllowed(req)) return sendError(res, 'forbidden', 'runner enrollment requires a valid token')
    const { capabilities } = await body<SetRunnerCapabilitiesRequest>()
    if (!Array.isArray(capabilities)) {
      return sendError(res, 'bad_request', 'capabilities is required')
    }
    const runner = store.registry.setCapabilities(params.id, capabilities)
    if (!runner) return sendError(res, 'not_found', `No runner '${params.id}'`)
    sendJson(res, runner)
  })
  r.delete('/runners/:id', ({ req, res, params }) => {
    if (!enrollmentAllowed(req)) return sendError(res, 'forbidden', 'runner enrollment requires a valid token')
    if (!store.registry.deregister(params.id)) {
      return sendError(res, 'not_found', `No online runner '${params.id}'`)
    }
    sendJson(res, { ok: true })
  })

  // Invoke a capability on a runner's host — the addressed + routed call. The
  // broker (here) resolves the runner and checks liveness; the runner runtime
  // enforces the scoped grant (D3) and fulfils. `capability_unavailable` when no
  // such online capability; `forbidden` when the target is outside the grant.
  //
  // Idempotent by `commandId` (D2): a retried call returns the recorded effect
  // without re-executing. On success the effect is recorded on the runner's
  // authoritative log and projected (the relay/online path), returning the effect.
  r.post('/runners/:id/invoke', async ({ res, params, body }) => {
    const runner = store.registry.get(params.id)
    if (!runner) return sendError(res, 'not_found', `No runner '${params.id}'`)
    const request = await body<CapabilityRequest>()
    if (!request?.capability || typeof request.target !== 'string') {
      return sendError(res, 'bad_request', 'capability and target are required')
    }
    if (typeof request.sessionId !== 'string' || typeof request.contextId !== 'string') {
      return sendError(res, 'bad_request', 'sessionId and contextId are required (context mediation)')
    }
    const commandId = request.commandId ?? store.journal.mintCommandId()
    // Idempotency: a retry of an already-recorded command replays the effect.
    const prior = store.journal.find(runner.id, commandId)
    if (prior) return sendJson(res, prior)
    if (runner.status !== 'online') {
      return sendError(res, 'capability_unavailable', `Runner '${runner.id}' is offline`)
    }
    // Context mediation (D5): the effect must name a context attached to this
    // session and act within that context's scope — the reference-monitor check,
    // enforced here at the broker (the resource authority), on top of the runner's
    // host grant (D3, enforced in the runtime). docs/shared-resource-coordination.md.
    const ctx = store.resolveSessionContext(request.sessionId, request.contextId)
    if (!ctx) {
      return sendError(
        res,
        'forbidden',
        `Context '${request.contextId}' is not attached to session '${request.sessionId}'`,
      )
    }
    if (!scopeMatches(ctx.scope, request.target)) {
      return sendError(
        res,
        'forbidden',
        `'${request.target}' is outside context '${ctx.id}' (scope '${ctx.scope}')`,
      )
    }
    // Effect-time cross-user enforcement (D12, OQ3): when the effect is attributed to a
    // Commission, it must *also* stay within that Contributor's Project-clamped reach —
    // the owner's ambient scopes, absent from the Project, are unreachable here even when
    // the context above would admit them. Refused before any reservation is acquired; an
    // unknown commission fails closed. Absent `commissionId` ⇒ the legacy single-tenant path.
    // (The commission is *attributed by the caller*, like the session+context handle above;
    // binding it server-side from the session — so it can't be omitted to bypass — is forward.)
    if (
      request.commissionId &&
      !store.commissionAdmitsTarget(request.commissionId, request.capability, request.target)
    ) {
      // Detective audit (D15/OQ7): the D12 isolation wall turned this commissioned effect
      // away — the highest-value entry in the trail (a Contributor reaching past its Project).
      store.recordAudit({ channel: 'host-invoke', commissionId: request.commissionId, capability: request.capability, target: request.target, outcome: 'denied' })
      return sendError(
        res,
        'forbidden',
        `Commission '${request.commissionId}' may not reach '${request.target}' on this Project`,
      )
    }
    // D14 role permission: firing an irreversible (non-monotonic) effect requires the
    // commission's role to permit 'fire' — a reader may read, but not write/terminal/process.
    if (
      request.commissionId &&
      !isMonotonic(request.capability) &&
      !store.commissionRolePermits(request.commissionId, 'fire')
    ) {
      store.recordAudit({ channel: 'host-invoke', commissionId: request.commissionId, capability: request.capability, target: request.target, outcome: 'denied' })
      return sendError(res, 'forbidden', `Commission '${request.commissionId}' (role) may not fire this effect`)
    }
    // Resource guardian (D5): a non-monotonic effect must hold a reservation on the
    // resource (the context element). Monotonic effects (fs.read) are
    // coordination-free and skip it (CALM). `reserve` is re-entrant for this
    // session; `conflict` (409) when another session holds the resource — the escrow
    // that refuses a concurrent irreversible writer up front. Held (TTL'd) on success
    // so the session keeps the resource; released if the effect itself fails.
    let reservation
    let acquiredHere = false
    if (!isMonotonic(request.capability)) {
      // Release on failure must free only what *this* invoke acquired — never a hold
      // the session already had (e.g. an explicit reservation kept across a consent gate).
      const heldBefore = store.guardian
        .status(ctx.id)
        .active.some((r) => r.holder === request.sessionId)
      try {
        reservation = store.guardian.reserve(ctx.id, request.sessionId)
      } catch (err) {
        if (err instanceof GuardianError) return sendError(res, err.code, err.message)
        throw err
      }
      acquiredHere = !heldBefore
    }
    try {
      const result = runCapability(runner, request)
      const { effect } = store.journal.append(runner.id, {
        commandId,
        capability: result.capability,
        target: result.target,
        output: result.output,
      })
      store.journal.reconcile(runner.id) // relay path: project synchronously
      if (reservation) store.guardian.commit(reservation.id)
      // D13 reputation + D15 audit: a successful *commissioned* host effect credits the
      // Contributor and lands in the detective trail (both no-ops for the legacy path).
      if (request.commissionId) {
        store.recordContribution(request.commissionId)
        store.recordAudit({ channel: 'host-invoke', commissionId: request.commissionId, capability: request.capability, target: request.target, outcome: 'fulfilled' })
      }
      sendJson(res, effect)
    } catch (err) {
      // The effect failed — free the lock only if this invoke is what acquired it.
      if (reservation && acquiredHere) store.guardian.release(reservation.id)
      if (err instanceof CapabilityError) return sendError(res, err.code, err.message)
      throw err
    }
  })

  // The runner's authoritative effect log (read-through). `?since=<seq>` returns
  // only the tail after a sequence number — the audit/projection read (D2/D3).
  r.get('/runners/:id/effects', ({ res, params, url }) => {
    if (!store.registry.get(params.id)) return sendError(res, 'not_found', `No runner '${params.id}'`)
    const since = Number(url.searchParams.get('since') ?? 0) || 0
    sendJson(res, store.journal.log(params.id, since))
  })

  // A runner replays its outbox — effects it executed out-of-band (via the
  // co-located fast path, or while the server was unreachable). Merged idempotently
  // by commandId, then projected; returns what was newly projected + the cursor.
  r.post('/runners/:id/sync', async ({ res, params, body }) => {
    if (!store.registry.get(params.id)) return sendError(res, 'not_found', `No runner '${params.id}'`)
    const { effects } = await body<SyncEffectsRequest>()
    if (!Array.isArray(effects)) return sendError(res, 'bad_request', 'effects is required')
    store.journal.merge(params.id, effects)
    const projected = store.journal.reconcile(params.id)
    sendJson(res, { projected, cursor: store.journal.cursor(params.id) })
  })

  // ── Model providers (the cognition source — docs/agent-commons.md, D9) ──────
  // The registered cognition sources an Agent's `providerId` binds — account-scoped
  // and referenceable by id, like a Runner, never attached per-thread. The Agents hub
  // manages them (create / patch / delete); the server-only credential/model config
  // never crosses this boundary. POST validates the plan against the account plan (the
  // cascade root, D8) — an over-plan request is a 400; DELETE refuses the default or a
  // provider an Agent still binds (409). In-memory for now (no cross-restart persistence).
  // Tenant-scoped (F2/PD9): the shared seeded provider(s) plus the caller's own created ones.
  r.get('/providers', ({ req, res }) => {
    sendJson(res, store.listProviders(store.identity(req.headers).tenant.id))
  })
  r.get('/providers/:id', ({ req, res, params }) => {
    // `listProviders(tenant).find`, not `store.getProvider` — the latter falls back to the
    // default for an unknown id (the resolve-for-a-turn contract), which would mask a
    // 404 here. The scoped read also makes another tenant's provider a 404 (no existence leak).
    const provider = store.listProviders(store.identity(req.headers).tenant.id).find((p) => p.id === params.id)
    if (!provider) return sendError(res, 'not_found', `No provider '${params.id}'`)
    sendJson(res, provider)
  })
  r.post('/providers', async ({ req, res, body }) => {
    const input = await body<CreateProviderRequest>()
    if (!input?.label || !input?.modelFamily || !Array.isArray(input.effortLevels)) {
      return sendError(res, 'bad_request', 'label, modelFamily, and effortLevels are required')
    }
    try {
      sendJson(res, store.createProvider(input, {}, store.identity(req.headers).tenant.id))
    } catch (err) {
      // An over-plan provider — the requested plan exceeds the account plan (the cascade root).
      if (err instanceof BudgetError) return sendError(res, 'bad_request', err.message)
      throw err
    }
  })
  r.patch('/providers/:id', async ({ req, res, params, body }) => {
    if (denyForeignEntry(req, res, params.id, (t) => store.listProviders(t), 'provider')) return
    const patch = await body<UpdateProviderRequest>()
    try {
      const provider = store.updateProvider(params.id, patch)
      if (!provider) return sendError(res, 'not_found', `No provider '${params.id}'`)
      sendJson(res, provider)
    } catch (err) {
      if (err instanceof BudgetError) return sendError(res, 'bad_request', err.message)
      throw err
    }
  })
  r.delete('/providers/:id', ({ req, res, params }) => {
    if (denyForeignEntry(req, res, params.id, (t) => store.listProviders(t), 'provider')) return
    try {
      if (!store.deleteProvider(params.id)) return sendError(res, 'not_found', `No provider '${params.id}'`)
      sendJson(res, { ok: true })
    } catch (err) {
      // Protected (the default) or still bound by an Agent — a 409 to re-target.
      if (err instanceof ConflictError) return sendError(res, err.code, err.message)
      throw err
    }
  })

  // ── Worker Agents (docs/agent-commons.md, D6) ──────────────────────────────
  // The user-created workers. `/agents` is the host-bound type's *former* route name,
  // freed by the D6 rename (host is now `/runners`), so the bare word goes to the worker.
  // The Agents hub manages them (create / patch / delete); the Contributor view +
  // commission picker read this to resolve labels and offer agents. POST resolves the
  // prompt body from `systemPromptId` and defaults tools to the full catalog, then runs
  // the D8 funnel (an over-grant is a 400); DELETE refuses the default or an Agent a
  // Commission still assigns (409). In-memory for now.
  // Tenant-scoped (F2/PD9): the shared default agent plus the caller's own created ones.
  r.get('/agents', ({ req, res }) => {
    sendJson(res, store.listAgents(store.identity(req.headers).tenant.id))
  })
  // The detective audit trail (D15/OQ7) — newest first; the Audit hub's read. Scoped
  // to the caller's tenant (F2/F5 — the RLS-equivalent boundary, PD9): a tenant only
  // ever sees its own trail. The append-only log grows unbounded, so it takes opt-in
  // cursor pagination too (F3 PD14).
  r.get('/audit', ({ req, res, url }) => {
    sendList(res, url, store.listAuditLog(store.identity(req.headers).tenant.id), (e) => e.id)
  })
  r.get('/agents/:id', ({ req, res, params }) => {
    // Like providers: the scoped `listAgents(tenant).find`, not `getAgent` (which falls back
    // to the default), so an unknown OR cross-tenant id is a real 404 (no existence leak).
    const agent = store.listAgents(store.identity(req.headers).tenant.id).find((a) => a.id === params.id)
    if (!agent) return sendError(res, 'not_found', `No agent '${params.id}'`)
    sendJson(res, agent)
  })
  // Validate the optional provider / prompt ids a create-or-patch names exist AND are the
  // caller's to reference (scoped to the tenant, F2/PD9 — so an Agent can't be minted
  // against another tenant's private provider/prompt). Returns an error message, else null.
  const badAgentRef = (input: { providerId?: string; systemPromptId?: string }, tenantId: string): string | null => {
    if (input.providerId && !store.listProviders(tenantId).some((p) => p.id === input.providerId)) {
      return `No provider '${input.providerId}'`
    }
    if (input.systemPromptId && !store.listSystemPrompts(tenantId).some((p) => p.id === input.systemPromptId)) {
      return `No system prompt '${input.systemPromptId}'`
    }
    return null
  }
  r.post('/agents', async ({ req, res, body }) => {
    const input = await body<CreateAgentRequest>()
    if (!input?.label) return sendError(res, 'bad_request', 'label is required')
    const tenantId = store.identity(req.headers).tenant.id
    const bad = badAgentRef(input, tenantId)
    if (bad) return sendError(res, 'not_found', bad)
    try {
      sendJson(res, store.createAgentFromRequest(input, tenantId))
    } catch (err) {
      // An over-grant on either cascade face — the request named an impossible grant.
      if (err instanceof BudgetError || err instanceof AuthorityError) {
        return sendError(res, 'bad_request', err.message)
      }
      throw err
    }
  })
  r.patch('/agents/:id', async ({ req, res, params, body }) => {
    if (denyForeignEntry(req, res, params.id, (t) => store.listAgents(t), 'agent')) return
    const patch = await body<UpdateAgentRequest>()
    const bad = badAgentRef(patch, store.identity(req.headers).tenant.id)
    if (bad) return sendError(res, 'not_found', bad)
    try {
      const agent = store.updateAgentFromRequest(params.id, patch)
      if (!agent) return sendError(res, 'not_found', `No agent '${params.id}'`)
      sendJson(res, agent)
    } catch (err) {
      if (err instanceof BudgetError || err instanceof AuthorityError) {
        return sendError(res, 'bad_request', err.message)
      }
      throw err
    }
  })
  r.delete('/agents/:id', ({ req, res, params }) => {
    if (denyForeignEntry(req, res, params.id, (t) => store.listAgents(t), 'agent')) return
    try {
      if (!store.deleteAgent(params.id)) return sendError(res, 'not_found', `No agent '${params.id}'`)
      sendJson(res, { ok: true })
    } catch (err) {
      // Protected (the default) or still assigned by a Commission — a 409 to re-target.
      if (err instanceof ConflictError) return sendError(res, err.code, err.message)
      throw err
    }
  })
  // Agent-to-agent proxy (D15): A's Agent (`fromAgentId`) asks B's Agent (`:id`) to act on B's
  // private resource. B acts under *its own* authority and returns only the result — the
  // requester never holds a B credential (the structural D12 wall). Mock fulfilment.
  r.post('/agents/:id/proxy', async ({ res, params, body }) => {
    const req = await body<ProxyRequest>()
    if (!req?.fromAgentId || typeof req?.target !== 'string' || !PROJECT_EFFECT_TYPES.includes(req.capability)) {
      return sendError(res, 'bad_request', 'fromAgentId, target, and a valid capability are required')
    }
    const result = store.runAgentProxy(params.id, req)
    if (!result) return sendError(res, 'not_found', `No agent '${params.id}' to proxy through`)
    sendJson(res, result)
  })

  // ── System-prompt library (the cognition half — docs/agent-commons.md, D10) ──
  // The reusable, target-family-tagged prompts a user picks for an Agent. The Agents hub
  // manages them (create / patch / delete); the (prompt × provider) fit warning is
  // computed client-side from the shared pure `promptFitWarning`, surfaced at selection
  // time. A plain registry (prompt text isn't a capability — no attenuation funnel);
  // DELETE refuses the default or a prompt an Agent still references (409). In-memory.
  // Tenant-scoped (F2/PD9): the shared seeded prompts plus the caller's own created ones.
  r.get('/system-prompts', ({ req, res }) => {
    sendJson(res, store.listSystemPrompts(store.identity(req.headers).tenant.id))
  })
  r.get('/system-prompts/:id', ({ req, res, params }) => {
    // Scoped list, so an unknown OR cross-tenant id is a real 404 (no existence leak).
    const entry = store.listSystemPrompts(store.identity(req.headers).tenant.id).find((p) => p.id === params.id)
    if (!entry) return sendError(res, 'not_found', `No system prompt '${params.id}'`)
    sendJson(res, entry)
  })
  r.post('/system-prompts', async ({ req, res, body }) => {
    const input = await body<CreateSystemPromptRequest>()
    if (!input?.label || !input?.body || !input?.targetFamily) {
      return sendError(res, 'bad_request', 'label, body, and targetFamily are required')
    }
    sendJson(res, store.createSystemPrompt(input, store.identity(req.headers).tenant.id))
  })
  // The opt-in prompt-fit probe (D10/OQ5) — the deeper, scored upgrade beside the static
  // tag. Scores the prompt against the chosen provider's model family (default if absent).
  r.post('/system-prompts/:id/probe', async ({ req, res, params, body }) => {
    // Tenant-scoped (F2/PD9): probing another tenant's PRIVATE prompt is a 404 (no leak).
    if (!store.listSystemPrompts(store.identity(req.headers).tenant.id).some((p) => p.id === params.id)) {
      return sendError(res, 'not_found', `No system prompt '${params.id}'`)
    }
    const { providerId } = await body<PromptProbeRequest>()
    const result = store.runProbe(params.id, providerId)
    if (!result) return sendError(res, 'not_found', `No system prompt '${params.id}'`)
    sendJson(res, result)
  })
  r.patch('/system-prompts/:id', async ({ req, res, params, body }) => {
    if (denyForeignEntry(req, res, params.id, (t) => store.listSystemPrompts(t), 'system prompt')) return
    const patch = await body<UpdateSystemPromptRequest>()
    const entry = store.updateSystemPrompt(params.id, patch)
    if (!entry) return sendError(res, 'not_found', `No system prompt '${params.id}'`)
    sendJson(res, entry)
  })
  r.delete('/system-prompts/:id', ({ req, res, params }) => {
    if (denyForeignEntry(req, res, params.id, (t) => store.listSystemPrompts(t), 'system prompt')) return
    try {
      if (!store.deleteSystemPrompt(params.id)) return sendError(res, 'not_found', `No system prompt '${params.id}'`)
      sendJson(res, { ok: true })
    } catch (err) {
      // Protected (the default) or still referenced by an Agent — a 409 to re-target.
      if (err instanceof ConflictError) return sendError(res, err.code, err.message)
      throw err
    }
  })

  // ── Commissions (the agent→Project assignment — docs/agent-commons.md, D7/D13) ──
  // A Project's Contributors. `GET /commissions?project=<id>` filters to one Project.
  // `POST` mints through the leaf of the D8 cascade (commission ⊆ agent ⊆ provider):
  // an over-grant on either face is a 400 (an impossible grant was named), an unknown
  // agent / project a 404.
  // Tenant-scoped (F2/PD9): the caller's own commissions (plus any shared seed).
  r.get('/commissions', ({ req, res, url }) => {
    sendJson(res, store.listCommissions(url.searchParams.get('project') ?? undefined, store.identity(req.headers).tenant.id))
  })
  r.get('/commissions/:id', ({ req, res, params }) => {
    const commission = store.listCommissions(undefined, store.identity(req.headers).tenant.id).find((c) => c.id === params.id)
    if (!commission) return sendError(res, 'not_found', `No commission '${params.id}'`)
    sendJson(res, commission)
  })
  // The commission's *effective* authority (D12): the agent's granted ceiling clamped
  // to what the Project admits — what the Contributor actually reaches, never the
  // owner's ambient set. Derived server-side (the single source); the UI shows it.
  r.get('/commissions/:id/authority', ({ req, res, params }) => {
    // Tenant-scoped (F2/PD9) like the sibling by-id GET: a foreign commission is 404 (no
    // leak of another tenant's Contributor's effective reach).
    if (!store.listCommissions(undefined, store.identity(req.headers).tenant.id).some((c) => c.id === params.id)) {
      return sendError(res, 'not_found', `No commission '${params.id}'`)
    }
    const authority = store.commissionAuthority(params.id)
    if (!authority) return sendError(res, 'not_found', `No commission '${params.id}'`)
    sendJson(res, authority)
  })
  r.post('/commissions', async ({ req, res, body }) => {
    const input = await body<CreateCommissionRequest>()
    if (!input?.agentId || !input?.projectId) {
      return sendError(res, 'bad_request', 'agentId and projectId are required')
    }
    const tenantId = store.identity(req.headers).tenant.id
    // Scoped: a tenant may only commission an agent it can see (its own or the shared default),
    // not another tenant's private agent (F2/PD9).
    if (!store.listAgents(tenantId).some((a) => a.id === input.agentId)) {
      return sendError(res, 'not_found', `No agent '${input.agentId}'`)
    }
    if (!store.listProjects().some((p) => p.id === input.projectId)) {
      return sendError(res, 'not_found', `No project '${input.projectId}'`)
    }
    if (input.role && !PROJECT_ROLES.includes(input.role)) {
      return sendError(res, 'bad_request', `Unknown role '${input.role}'`)
    }
    try {
      sendJson(res, store.createCommission(input, tenantId))
    } catch (err) {
      // An over-grant on either cascade face — the request named an impossible grant.
      if (err instanceof BudgetError || err instanceof AuthorityError) {
        return sendError(res, 'bad_request', err.message)
      }
      // The Project is at its D13 commission cap (fail-closed) → 429.
      if (err instanceof LimitError) return sendError(res, err.code, err.message)
      throw err
    }
  })
  // Re-grant (narrow / restore a Contributor's authority) or un-commission. PATCH re-runs
  // the leaf funnel, so an over-grant is a 400; DELETE cascade-releases the Contributor's
  // sub-goals. No protected default — a commission has no fallback role.
  r.patch('/commissions/:id', async ({ req, res, params, body }) => {
    if (denyForeignEntry(req, res, params.id, (t) => store.listCommissions(undefined, t), 'commission')) return
    const patch = await body<UpdateCommissionRequest>()
    if (patch.role && !PROJECT_ROLES.includes(patch.role)) {
      return sendError(res, 'bad_request', `Unknown role '${patch.role}'`)
    }
    try {
      const commission = store.updateCommission(params.id, patch)
      if (!commission) return sendError(res, 'not_found', `No commission '${params.id}'`)
      sendJson(res, commission)
    } catch (err) {
      if (err instanceof BudgetError || err instanceof AuthorityError) {
        return sendError(res, 'bad_request', err.message)
      }
      throw err
    }
  })
  r.delete('/commissions/:id', ({ req, res, params }) => {
    if (denyForeignEntry(req, res, params.id, (t) => store.listCommissions(undefined, t), 'commission')) return
    if (!store.deleteCommission(params.id)) return sendError(res, 'not_found', `No commission '${params.id}'`)
    sendJson(res, { ok: true })
  })

  // ── Multi-principal coordination — sub-goal reservation (D11) ──────────────
  // A guarded Project's in-flight sub-goals (who's handling what). `POST` claims one
  // for a Contributor; a *different* Contributor claiming the *same* sub-goal conflicts
  // (409 → re-reason). Release reuses POST /reservations/:id/release.
  // NOTE (prototype): `holder` is client-supplied and release is unauthenticated — fine
  // for this single-user mock, but a real deployment derives the holder from the
  // authenticated principal and authorizes who may release a claim.
  r.get('/projects/:id/subgoals', ({ res, params }) => {
    sendJson(res, store.projectSubGoals(params.id))
  })
  r.post('/projects/:id/subgoals', async ({ res, params, body }) => {
    const { holder, subGoal } = await body<ReserveSubGoalRequest>()
    if (!holder || !subGoal) return sendError(res, 'bad_request', 'holder and subGoal are required')
    // D14 role permission: when the holder is a Contributor (a known commission), reserving a
    // sub-goal requires its role to permit 'reserve' — a reader may not claim work. A
    // non-commission principal (no role) is ungated.
    if (store.getCommission(holder) && !store.commissionRolePermits(holder, 'reserve')) {
      return sendError(res, 'forbidden', `Contributor '${holder}' (role) may not reserve sub-goals`)
    }
    try {
      sendJson(res, store.reserveSubGoal(params.id, holder, subGoal))
    } catch (err) {
      if (err instanceof GuardianError) return sendError(res, err.code, err.message)
      throw err
    }
  })
  // A Contributor fires an externally-effectful action on a shared Project (D11/D12, OQ3+OQ4):
  // the Commission's connector/MCP reach is the wall (D12), and a non-monotonic effect is
  // serialized on its sub-goal reservation at the Guardian (D11) — the slice-4 "forward" effect
  // now on a real path. Order: 400 fields → 404 project → 403 reach → run (409 on a concurrent
  // different principal). A charge has no data-reach target, so it skips the reach check.
  r.post('/projects/:id/effects', async ({ res, params, body }) => {
    const { commissionId, subGoal, type, target } = await body<ProjectEffectRequest>()
    if (!commissionId || !subGoal || typeof target !== 'string' || !PROJECT_EFFECT_TYPES.includes(type)) {
      return sendError(res, 'bad_request', 'commissionId, subGoal, target, and a valid type are required')
    }
    if (!store.listProjects().some((p) => p.id === params.id)) {
      return sendError(res, 'not_found', `No project '${params.id}'`)
    }
    const reaches = type.startsWith('connector.') || type.startsWith('mcp.')
    if (reaches && !store.commissionCanReach(commissionId, 'connectors', target)) {
      // Detective audit (D15/OQ7): the D12 connector wall refused this Project effect.
      store.recordAudit({ channel: 'project-effect', commissionId, capability: type, target, outcome: 'denied' })
      return sendError(res, 'forbidden', `Commission '${commissionId}' may not reach '${target}' on this Project`)
    }
    // D14 role permission: a non-monotonic Project effect requires the role to permit 'fire'.
    if (!isProjectEffectMonotonic(type) && !store.commissionRolePermits(commissionId, 'fire')) {
      store.recordAudit({ channel: 'project-effect', commissionId, capability: type, target, outcome: 'denied' })
      return sendError(res, 'forbidden', `Commission '${commissionId}' (role) may not fire this effect`)
    }
    try {
      sendJson(res, store.runProjectEffect(params.id, commissionId, subGoal, type, target))
    } catch (err) {
      if (err instanceof GuardianError) return sendError(res, err.code, err.message)
      throw err
    }
  })

  // ── Resource guardians + reservations (D5) ────────────────────────────────
  // Per shared resource (a context element id), a reservation ledger enforcing a
  // capacity invariant — the escrow that lets the broker refuse a second session's
  // irreversible write up front (docs/shared-resource-coordination.md). `reserve`
  // is reversible (releasable, TTL'd); `commit` records the irreversible step.
  // `conflict` (409) when the resource is at capacity / held by another session.
  r.get('/resources/:key', ({ res, params }) => {
    sendJson(res, store.guardian.status(params.key))
  })
  r.patch('/resources/:key', async ({ res, params, body }) => {
    const { capacity } = await body<SetCapacityRequest>()
    if (typeof capacity !== 'number' || capacity < 1) {
      return sendError(res, 'bad_request', 'capacity must be a positive number')
    }
    sendJson(res, store.guardian.setCapacity(params.key, capacity))
  })
  r.post('/resources/:key/reserve', async ({ res, params, body }) => {
    const input = await body<ReserveRequest>()
    if (!input?.holder) return sendError(res, 'bad_request', 'holder is required')
    try {
      sendJson(res, store.guardian.reserve(params.key, input.holder, { ttlMs: input.ttlMs }))
    } catch (err) {
      if (err instanceof GuardianError) return sendError(res, err.code, err.message)
      throw err
    }
  })
  r.post('/reservations/:id/commit', ({ res, params }) => {
    try {
      sendJson(res, store.guardian.commit(params.id))
    } catch (err) {
      if (err instanceof GuardianError) return sendError(res, err.code, err.message)
      throw err
    }
  })
  r.post('/reservations/:id/release', ({ res, params }) => {
    try {
      sendJson(res, store.guardian.release(params.id))
    } catch (err) {
      if (err instanceof GuardianError) return sendError(res, err.code, err.message)
      throw err
    }
  })

  // ── Served filesystem sources (Files / Photos / Folder — contract/fs.ts) ──────
  // The three context types served from a REAL filesystem, addressed by `?source=`:
  // `cloud` (the web backend's storage) and `runner:<id>` (a runner's host, proxied
  // through the broker). UNGATED — they work on both backends (each reads its own
  // disk), unlike the native arbitrary-path seam below. The `ui-host` source is
  // client-side and is never served here. The bytes route backs `<img src>`.
  r.get('/fs/sources', ({ res }) => {
    sendJson(res, store.fsSources())
  })
  r.get('/fs/catalog', ({ res, url }) => {
    const source = url.searchParams.get('source')
    if (!source) return sendError(res, 'bad_request', 'source is required')
    const catalog = store.fsCatalog(source)
    if (!catalog) return sendError(res, 'not_found', `No filesystem source '${source}'`)
    sendJson(res, catalog)
  })
  r.get('/fs/folder', ({ res, url }) => {
    const source = url.searchParams.get('source')
    const path = url.searchParams.get('path')
    if (!source || !path) return sendError(res, 'bad_request', 'source and path are required')
    const contents = store.fsFolder(source, path)
    if (!contents) return sendError(res, 'not_found', `No folder '${path}' on source '${source}'`)
    sendJson(res, contents)
  })
  r.get('/fs/text', ({ res, url }) => {
    const source = url.searchParams.get('source')
    const path = url.searchParams.get('path')
    if (!source || !path) return sendError(res, 'bad_request', 'source and path are required')
    const content = store.fsText(source, path)
    if (!content) return sendError(res, 'not_found', `No file '${path}' on source '${source}'`)
    sendJson(res, content)
  })
  r.get('/fs/content', ({ res, url }) => {
    const source = url.searchParams.get('source')
    const path = url.searchParams.get('path')
    if (!source || !path) return sendError(res, 'bad_request', 'source and path are required')
    const bytes = store.fsBytes(source, path)
    if (!bytes) return sendError(res, 'not_found', `No file '${path}' on source '${source}'`)
    sendBytes(res, bytes.bytes, bytes.contentType)
  })

  // ── Native resources (a native sidecar fulfills these; a remote server 409s) ─
  // The arbitrary-path OS seam — distinct from the served sources above. The same
  // endpoints exist in both backends — only the fulfilment differs. This is what
  // lets ONE UI run as a native desktop app and as a web app unchanged.
  r.get('/fs/pick', ({ res, url }) => {
    if (!gate(res, 'osPicker')) return
    sendJson(res, store.fsPick(url.searchParams.get('kind') ?? 'folder'))
  })
  r.get('/fs/folders/:id', ({ res, params }) => {
    if (!gate(res, 'localFs')) return
    const scan = store.scanFolder(params.id)
    if (!scan) return sendError(res, 'not_found', `No folder '${params.id}'`)
    sendJson(res, scan)
  })
  r.get('/git/repos/:id/diff', ({ res, params }) => {
    if (!gate(res, 'localGit')) return
    const diff = store.repoDiff(params.id)
    if (!diff) return sendError(res, 'not_found', `No repo '${params.id}'`)
    sendJson(res, diff)
  })

  // ── Ambient event stream ────────────────────────────────────────────────
  // One long-lived SSE channel per client; the server pushes scheduled-run,
  // relation, connector, and session events down it (Phase 3+). It opens with a
  // `hello` carrying the epoch so a client can detect a server reseed.
  r.get('/events', ({ req, res }) => {
    const channel = openSse(res)
    channel.send({ type: 'hello', epoch: store.epoch })
    // Tenant-filter the fan-out (F2/PD9): a subscriber only receives events for its own
    // tenant, so another tenant's session pushes don't leak down this channel. The
    // subscriber's tenant is resolved once, at subscribe time, from the request identity.
    const tenantId = store.identity(req.headers).tenant.id
    const unsubscribe = store.subscribe((e) => {
      if (store.eventVisibleToTenant(e, tenantId)) channel.send(e)
    })
    req.on('close', () => {
      unsubscribe()
      channel.close()
    })
  })

  // ── Sessions ──────────────────────────────────────────────────────────────
  // The tenant boundary for an existing session addressed by id (F2/PD9), shared by
  // every by-id session route so reads and writes are isolated alike. If the session
  // exists but belongs to another tenant, 404 (not 403 — existence must not leak) and
  // return true so the caller bails. Unknown / unpersisted (draft) ids fall through to
  // each route's own not-found path; run/seed sessions (no tenantId) belong to the
  // default tenant.
  const denyForeignSession = (req: IncomingMessage, res: ServerResponse, id: string): boolean => {
    const session = store.getSession(id) ?? store.runSession(id)
    if (session && !store.sessionVisibleToTenant(session, store.identity(req.headers).tenant.id)) {
      sendError(res, 'not_found', `No session '${id}'`)
      return true
    }
    return false
  }

  // Opt-in cursor pagination (F3 PD14): `?limit=N[&cursor=C]` returns a `Page<Session>`;
  // without `limit`, the full array (the UI reads the array until it virtualizes, PD36).
  // Scoped to the caller's tenant (F2/PD9 — the RLS-equivalent boundary): a tenant
  // only ever lists its own sessions (seed/legacy rows belong to the default tenant).
  r.get('/sessions', ({ req, res, url }) => {
    sendList(res, url, store.listSessions(store.identity(req.headers).tenant.id), (s) => s.id)
  })
  r.get('/sessions/:id', ({ req, res, params }) => {
    if (denyForeignSession(req, res, params.id)) return
    // A scheduled run *is* a session — resolve `srun-*` ids to the synthesized run
    // session (which reflects the current, live runs).
    const session = store.getSession(params.id) ?? store.runSession(params.id)
    if (!session) return sendError(res, 'not_found', `No session '${params.id}'`)
    sendJson(res, session)
  })
  // Materialize a new persisted session — a draft becomes real on its first send
  // (the client posts here, adopts the returned id, then streams the turn to it).
  r.post('/sessions', idempotent(async ({ req, res, body }) => {
    const { firstMessage } = await body<import('../../contract/index.ts').CreateSessionRequest>()
    // Stamp the creating tenant so the scoped list/read above see it (F2/PD9).
    sendJson(res, store.createSession(firstMessage, store.identity(req.headers).tenant.id))
  }))
  // Edit a session's row fields (rename / pin / archive) from the sidebar menu.
  r.patch('/sessions/:id', async ({ req, res, params, body }) => {
    if (denyForeignSession(req, res, params.id)) return
    const patch = await body<{ title?: string; status?: 'active' | 'archived'; pinned?: boolean }>()
    const session = store.patchSession(params.id, patch)
    if (!session) return sendError(res, 'not_found', `No session '${params.id}'`)
    sendJson(res, session)
  })
  // Delete a session (the row menu's "Delete").
  r.delete('/sessions/:id', ({ req, res, params }) => {
    if (denyForeignSession(req, res, params.id)) return
    if (!store.removeSession(params.id)) return sendError(res, 'not_found', `No session '${params.id}'`)
    sendJson(res, { ok: true })
  })

  // Session ↔ context bindings — the attachment of record (Primitive 1 of
  // docs/shared-resource-coordination.md). Persisted server-side so every effect a
  // session initiates can be mediated by *naming* an attached context (Tiers A–C).
  // Attach/detach broadcast `session.contexts.changed`.
  r.get('/sessions/:id/contexts', ({ req, res, params }) => {
    if (denyForeignSession(req, res, params.id)) return
    sendJson(res, store.sessionContexts(params.id))
  })
  r.post('/sessions/:id/contexts', async ({ req, res, params, body }) => {
    if (denyForeignSession(req, res, params.id)) return
    const input = await body<AttachContextRequest>()
    if (!input?.id || !input?.type || !input?.label) {
      return sendError(res, 'bad_request', 'id, type, and label are required')
    }
    sendJson(res, store.attachContext(params.id, {
      id: input.id,
      type: input.type,
      label: input.label,
      scope: input.scope ?? '*',
      source: input.source,
    }))
  })
  r.delete('/sessions/:id/contexts/:contextId', ({ req, res, params }) => {
    if (denyForeignSession(req, res, params.id)) return
    const next = store.detachContext(params.id, params.contextId)
    if (!next) return sendError(res, 'not_found', `No context '${params.contextId}' on session '${params.id}'`)
    sendJson(res, next)
  })

  // The session's live workspace — its panels (workspaces / repos / connectors /
  // attachments). Server-owned so a runtime attach survives a reload, the way the
  // conversation does. The client write-throughs the merged panels it assembled
  // from the (server-owned) context catalogs; the server stores them as the system
  // of record and returns the full session. Broadcasts `session.updated`.
  r.patch('/sessions/:id/workspace', async ({ req, res, params, body }) => {
    if (denyForeignSession(req, res, params.id)) return
    const ws = await body<import('../../contract/index.ts').SessionWorkspace>()
    if (!ws || !Array.isArray(ws.workspaces) || !Array.isArray(ws.repos) || !Array.isArray(ws.connectors) || !Array.isArray(ws.attachments)) {
      return sendError(res, 'bad_request', 'workspaces, repos, connectors, and attachments arrays are required')
    }
    if (!store.getSession(params.id)) return sendError(res, 'not_found', `No session '${params.id}'`)
    store.setSessionWorkspace(params.id, ws)
    sendJson(res, store.getSession(params.id))
  })

  // Send a turn → stream the assistant reply as SSE (mirrors the Anthropic
  // Messages API). The body carries typed events, not just text: an assistant
  // turn can escalate the session or propose relation edits mid-stream.
  //
  // The reply text streams from the Anthropic Messages endpoint (the mock model
  // server in dev; api.anthropic.com in prod) via the SDK — see server/generate.
  // We relay the model's text deltas, then append the app-domain relation
  // proposals as `message.relations` before `message.end`.
  r.post('/sessions/:id/messages', async ({ req, res, params, body }) => {
    if (denyForeignSession(req, res, params.id)) return
    // The caller's tenant — usage is metered + budget-gated per tenant (F2/PD9), so one
    // tenant's spend neither 429s nor shows up in another's gauge. Resolved once for the turn.
    const tenantId = store.identity(req.headers).tenant.id
    const { text, ephemeral } = await body<SendMessageRequest>()
    // A draft / run session may not be persisted; reply with a generic shell.
    const known = store.getSession(params.id)
    const session = known
      ? { id: known.id, title: known.title, isDemo: known.isDemo }
      : { id: params.id, title: 'New session', isDemo: false }
    // The worker Agent driving this Conversation (docs/agent-commons.md, D6) —
    // resolves to the seeded default until users create their own.
    const agent = store.getAgent(known?.agentId)
    // The model this turn runs on is the Agent's Model provider's (D9) — the default
    // provider declares none, so this resolves to `undefined` and generation uses its
    // env-configured default. Multi-provider just makes this a non-default id.
    const model = store.providerModel(agent.providerId)
    // Spend-time enforcement (D8): once a plan window is exhausted for this Agent's
    // effective budget, refuse the turn (429) until it resets — the per-turn gate the
    // mint-time funnel doesn't give. Checked before persisting the user turn or streaming.
    const over = store.overSpendLimit(agent.budget, tenantId)
    if (over) {
      return sendError(res, 'limit_exceeded', `Plan limit reached for '${over.label}' — this turn is refused until the window resets.`)
    }
    // `ephemeral` (the guided tour) generates the full model + tool round-trip
    // but persists nothing, so the tour can replay against the demo session
    // without accumulating duplicate turns. Persist otherwise — the conversation
    // is server-owned, so a sent turn survives a reload even if generation fails.
    const persist = !!known && !ephemeral

    // Persist the user's turn up front. (Drafts are materialized via POST
    // /sessions before they're sent to; run / unknown ids stay ephemeral —
    // appendMessage no-ops for them.)
    if (persist) {
      store.appendMessage(params.id, {
        id: store.mintMessageId('user'),
        role: 'user',
        content: text ?? '',
      })
    }

    const channel = openSse(res)
    const ac = new AbortController()
    req.on('close', () => ac.abort())

    let messageId = ''
    // The turn's outcome, recorded exactly once in `finally` (F6 PD31) so a mid-stream send
    // failure after a successful generation can't double-count. `error` until we know better.
    let turnOutcome: GenerationOutcome = 'error'
    try {
      const { message, usage, outcome } = await generateReply(
        session,
        agent,
        text ?? '',
        {
          onStart: (id) => {
            messageId = id
            channel.send({ type: 'message.start', sessionId: session.id, message: { id, role: 'assistant', content: '' } })
          },
          onDelta: (delta) => {
            channel.send({ type: 'message.delta', sessionId: session.id, messageId, text: delta })
          },
        },
        ac.signal,
        model,
        // The live Agent Commons registries, so a confirmed "commission the agent I
        // just made" / "create an agent on <provider>" resolves the names the model
        // proposes against what currently exists (server/model/tools.ts). Tenant-scoped
        // (F2/PD9): the model only resolves against the caller's own + the shared seeds.
        (() => {
          return {
            providers: store.listProviders(tenantId).map((p) => ({ id: p.id, label: p.label })),
            systemPrompts: store.listSystemPrompts(tenantId).map((p) => ({ id: p.id, label: p.label })),
            agents: store.listAgents(tenantId).map((a) => ({ id: a.id, label: a.label })),
            commissions: store.listCommissions(undefined, tenantId).map((c) => ({ id: c.id, agentId: c.agentId, projectId: c.projectId })),
          }
        })(),
        // P6: the session's attached connector/MCP contexts become callable tools for
        // this turn (server/model/connectorTools.ts derives them; non-connector
        // contexts are ignored). Only what's attached is reachable.
        store.sessionContexts(params.id),
      )
      // Meter the real tokens this turn consumed (even ephemeral tour turns —
      // they hit the model too), so the composer's plan-usage rings reflect use.
      store.recordUsage(usage.inputTokens, usage.outputTokens, tenantId)
      // The model reported `ok` or `fallback` (endpoint degraded); recorded once in `finally`.
      turnOutcome = outcome
      if (message.relationActions?.length) {
        channel.send({
          type: 'message.relations',
          sessionId: session.id,
          messageId: message.id,
          relationActions: message.relationActions,
        })
      }
      // A panel escalation the model proposed via a tool call (open_workspace /
      // connect_repo / create_project) — the UI shows the consent prompt and
      // applies it only on approval.
      if (message.escalation) {
        channel.send({
          type: 'message.escalation',
          sessionId: session.id,
          messageId: message.id,
          escalation: message.escalation,
        })
      }
      // P6: connector/MCP tools the model called this turn + their (mock) results —
      // shown as activity under the message (a read needs no consent).
      if (message.toolActivities?.length) {
        channel.send({
          type: 'message.toolActivity',
          sessionId: session.id,
          messageId: message.id,
          toolActivities: message.toolActivities,
        })
      }
      // The model's reply text is canned (the mock model server) but its
      // *persistence* is real: record the assistant turn so the thread is the
      // system of record, then close the stream. The tour (ephemeral) skips this.
      // D16 per-turn provenance: stamp the turn with the Agent that drove it, so authorship
      // (and metering attribution) survive a mid-thread hand-off — the binding is current-driver.
      const stamped = { ...message, agentId: agent.id }
      if (persist) store.appendMessage(params.id, stamped)
      channel.send({ type: 'message.end', sessionId: session.id, message: stamped })
    } catch {
      // Aborted (client closed) or a fatal error — nothing more to send. Distinguish a client
      // disconnect (expected) from a genuine turn error via the abort signal.
      turnOutcome = ac.signal.aborted ? 'aborted' : 'error'
    } finally {
      // Record the outcome exactly once (F6 PD31), so a degraded/dropped turn is visible in
      // /metrics and a post-generation send failure can't double-count against a good turn.
      store.recordGenerationOutcome(turnOutcome)
      channel.close()
    }
  })

  // Confirm / decline a proposed connector ACTION (P6 §2.1, PD43 — the consent gate for
  // connector/MCP writes). A read ran at generation time; an action only takes effect
  // here, on the user's approval, and is audited. Tenant-guarded like the other by-id
  // session routes (a foreign tenant can't confirm another's pending write).
  r.post('/sessions/:id/tool-activities/:activityId', async ({ req, res, params, body }) => {
    if (denyForeignSession(req, res, params.id)) return
    const { decision } = await body<{ decision: 'confirm' | 'decline' }>()
    if (decision !== 'confirm' && decision !== 'decline') {
      return sendError(res, 'bad_request', "decision must be 'confirm' or 'decline'")
    }
    const activity = store.resolveToolActivity(params.id, params.activityId, decision)
    if (!activity) return sendError(res, 'not_found', `No tool activity '${params.activityId}' on session '${params.id}'`)
    sendJson(res, activity)
  })
  // Compact a session's context (P5 / BROKER-EXP-3) — server-owned; archives older
  // messages behind a summary marker so the token count (and the usage gauge) drops back.
  // Tenant-guarded like the other by-id session routes.
  r.post('/sessions/:id/compact', ({ req, res, params }) => {
    if (denyForeignSession(req, res, params.id)) return
    const session = store.compactSession(params.id)
    if (!session) return sendError(res, 'not_found', `No session '${params.id}'`)
    sendJson(res, session)
  })

  // ── Dispatch ──────────────────────────────────────────────────────────────
  r.get('/dispatch', ({ res, url }) => {
    sendList(res, url, store.listDispatch(), (d) => d.id)
  })
  // Kick off a one-off dispatch (lands 'running', finishes 'done' a beat later).
  r.post('/dispatch', idempotent(async ({ res, body }) => {
    const { title, detail } = await body<CreateDispatchRequest>()
    if (!title || !title.trim()) return sendError(res, 'bad_request', 'title is required')
    sendJson(res, store.addDispatch(title.trim(), detail))
  }))

  // ── Contexts (set-up) + connector detail ──────────────────────────────────
  r.get('/saved-contexts', ({ res }) => {
    sendJson(res, store.savedContexts())
  })
  // Set a saved connector / MCP server's auth status (connect / disconnect; the
  // OAuth-callback / token-expiry seam). Broadcasts `connector.status` and returns
  // the updated snapshot so the originating client reconciles immediately.
  r.patch('/saved-contexts/:id', async ({ res, params, body }) => {
    const { status } = await body<SetConnectorStatusRequest>()
    if (status !== 'connected' && status !== 'needs-auth') {
      return sendError(res, 'bad_request', "status must be 'connected' or 'needs-auth'")
    }
    const snapshot = store.setConnectorStatus(params.id, status)
    if (!snapshot) return sendError(res, 'not_found', `No saved context '${params.id}'`)
    sendJson(res, snapshot)
  })
  r.get('/connectors/detail', ({ res, url }) => {
    const label = url.searchParams.get('label')
    if (!label) return sendError(res, 'bad_request', 'label is required')
    const kind = (url.searchParams.get('kind') ?? undefined) as
      | 'github'
      | 'connector'
      | 'mcp'
      | undefined
    sendJson(res, store.connectorDetail({ id: url.searchParams.get('id') ?? label, label, kind }))
  })

  // ── Usage (composer gauge: context window + plan limit windows) ────────────
  r.get('/usage', ({ req, res, url }) => {
    // Per-tenant plan windows (F2/PD9): the gauge shows the caller's own usage, not a
    // global aggregate. The context breakdown is session-scoped as before.
    const tenantId = store.identity(req.headers).tenant.id
    sendJson(res, store.usage(url.searchParams.get('session') ?? undefined, tenantId))
  })

  // ── Artifact bodies + schedule templates ──────────────────────────────────
  r.get('/artifact-content', ({ res }) => {
    sendJson(res, store.artifactContent())
  })
  r.get('/schedule-templates', ({ res }) => {
    sendJson(res, store.scheduleTemplates())
  })

  // ── Entity graph (Projects / Artifacts / Schedules) + the relationship graph ─
  r.get('/projects', ({ res }) => {
    sendJson(res, store.listProjects())
  })
  r.get('/artifacts', ({ res, url }) => {
    sendList(res, url, store.listArtifacts(), (a) => a.id)
  })
  r.get('/schedules', ({ res }) => {
    sendJson(res, store.listSchedules())
  })
  // Run a routine now (server appends + broadcasts the run).
  r.post('/schedules/:id/run', ({ res, params }) => {
    const run = store.runSchedule(params.id)
    if (!run) return sendError(res, 'not_found', `No schedule '${params.id}'`)
    sendJson(res, run)
  })
  // Patch a routine's own fields — enabled, name, prompt, cadence, model, … (the
  // entity edits behind the detail page). Cross-entity bindings (deliver to an
  // artifact/session, add a tool) go through POST /relations/ops instead.
  r.patch('/schedules/:id', async ({ res, params, body }) => {
    const patch = await body<UpdateScheduleRequest>()
    const task = store.updateSchedule(params.id, patch)
    if (!task) return sendError(res, 'not_found', `No schedule '${params.id}'`)
    sendJson(res, task)
  })
  // Add a routine from a template's seed (lands paused).
  r.post('/schedules', idempotent(async ({ res, body }) => {
    const { seed } = await body<{ seed?: Omit<import('../../contract/index.ts').ScheduledTask, 'id'> }>()
    if (!seed) return sendError(res, 'bad_request', 'seed is required')
    sendJson(res, store.addSchedule(seed))
  }))
  // Remove a routine.
  r.delete('/schedules/:id', ({ res, params }) => {
    store.removeSchedule(params.id)
    sendJson(res, { ok: true })
  })
  // The left rail's recent-runs feed (a single live source).
  r.get('/runs/recent', ({ res }) => {
    sendJson(res, store.recentRuns())
  })
  // ETag/If-None-Match (F3): the graph changes only on a confirmed op, so a 304 saves
  // re-sending it on the client's frequent re-reads.
  r.get('/relations', (ctx) => {
    // Projected to the caller's tenant (F2/PD9): a tenant sees only its own created
    // projects + the joins referencing them. The default tenant's projection is the full
    // graph, so desktop / the mock backend are unaffected.
    sendJsonCached(ctx, store.relationGraph(store.identity(ctx.req.headers).tenant.id))
  })

  // ── Recents (per-user shortcut lists) ──────────────────────────────────────
  r.get('/recents', ({ res }) => {
    sendJson(res, store.recents())
  })
  r.post('/recents/:type', async ({ res, params, body }) => {
    const { id } = await body<PushRecentRequest>()
    if (!id) return sendError(res, 'bad_request', 'id is required')
    sendJson(res, store.pushRecent(params.type as import('../../contract/index.ts').ContextTypeId, id))
  })
  // Apply a confirmed relation edit — the privileged write (a standing op
  // authorizes the schedule daemon). Returns the updated graph + broadcasts it.
  r.post('/relations/ops', idempotent(async ({ req, res, body }) => {
    const { op } = await body<ApplyOpRequest>()
    if (!op || typeof op.kind !== 'string') return sendError(res, 'bad_request', 'op is required')
    // Pass the caller's tenant so a created project is stamped with it (F2/PD9); the
    // returned graph is projected to that tenant too (applyRelationOp handles both).
    const tenantId = store.identity(req.headers).tenant.id
    // Authorize the op against the caller's tenant (F2/PD9): its target project AND its
    // subject session must both be the caller's. Refuse a cross-tenant op 404 (existence-
    // hiding) BEFORE the shared reducer runs, so a guessed id can't file/scope/refile into —
    // or unfile a session out of — another tenant's project.
    if (store.opDeniedForTenant(op, tenantId)) {
      return sendError(res, 'not_found', 'No such project')
    }
    try {
      sendJson(res, store.applyRelationOp(op, tenantId))
    } catch (err) {
      // An Agent Commons CRUD op (commission-agent) confirmed against a now-removed
      // agent hits the same guard the hub's CRUD routes surface — a 409 to re-propose.
      if (err instanceof ConflictError) return sendError(res, err.code, err.message)
      // A commission-agent op confirmed against an at-cap Project (D13) → 429.
      if (err instanceof LimitError) return sendError(res, err.code, err.message)
      throw err
    }
  }))

  return r
}
