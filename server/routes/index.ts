/** Route table for the mock backend. Each resource registers its endpoints here;
 *  Phase 1 wires capabilities, the ambient event stream, and sessions. The router
 *  is plain data — adding a resource is adding a `.get(...)` line. */
import type {
  ApplyOpRequest,
  AttachContextRequest,
  Message,
  ReplyStreamEvent,
  CreateCommissionRequest,
  CreateDispatchRequest,
  CreateProviderRequest,
  RelayReplyRequest,
  UpdateProviderRequest,
  CreateSystemPromptRequest,
  UpdateSystemPromptRequest,
  CreateAgentRequest,
  UpdateAgentRequest,
  UpdateCommissionRequest,
  ReserveSubGoalRequest,
  PostOpenSubGoalRequest,
  PushRecentRequest,
  RegisterRunnerRequest,
  SendMessageRequest,
  SetRunnerCapabilitiesRequest,
  SetConnectorStatusRequest,
  UpdateScheduleRequest,
} from '../../contract/index.ts'
import { timingSafeEqual } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { stripTypeScriptTypes } from 'node:module'
import { fileURLToPath } from 'node:url'
import { Router } from '../http/router.ts'
import { sendJson, sendError, sendBytes, sendJsonCached, sendText, headerValue, BASE_HEADERS, type Ctx } from '../http/respond.ts'
import {
  SESSION_COOKIE,
  STACK_COOKIE,
  identityHeadersAllowed,
  parseCookies,
  sessionClearCookie,
  sessionSetCookie,
  signSession,
  stackSetCookie,
  stackWith,
  stackWithout,
  verifyStack,
} from '../auth.ts'
import { accounts } from '../accounts.ts'
import { openSse } from '../http/sse.ts'
import { store, type GenerationOutcome } from '../store.ts'
import { IdempotencyCache, captureResponse, replayResponse } from '../idempotency.ts'
import { pageParams, paginate, MAX_PAGE_LIMIT } from '../pagination.ts'
import { RateLimiter } from '../ratelimit.ts'
import { generateReply, probeProviderEndpoint } from '../generate.ts'
import { relayReply, mintRelaySecret, hashRelaySecret, relaySecretHint, type RelayOutcome } from '../relay.ts'
import { platformCard, agentCard, taskFromOpenSubGoal, rejectedAgentTask, rpcResult, rpcError } from '../a2a.ts'
import { ProviderProbeError, type ProviderConfig } from '../data/providers.ts'
import { turns, type TurnFrame } from '../turns.ts'
import { eventlog } from '../eventlog.ts'
import { CapabilityError, runCapability, scopeMatches } from '../runner-runtime.ts'
import { GuardianError } from '../guardian.ts'
import { BudgetError } from '../usage.ts'
import { AuthorityError } from '../authority.ts'
import { ConflictError, ValidationError } from '../conflict.ts'
import { LimitError } from '../limit.ts'
import { TOOL_NAMES } from '../model/tools.ts'
import { A2A_ERROR, DEFAULT_PROVIDER_ID, isMonotonic, isProjectEffectMonotonic, PROJECT_EFFECT_TYPES, PROJECT_ROLES } from '../../contract/index.ts'
import type {
  A2aDataPart,
  A2aMessage,
  A2aRpcRequest,
  A2aTextPart,
  CreateA2aPeerRequest,
  DeclineProposalRequest,
  ImportAgentCardRequest,
  MarkNotificationsReadRequest,
  PostProposalCommentRequest,
  ProposeAgentChangeRequest,
  PostWorkItemCommentRequest,
  ProjectEffectType,
  SetWatchRequest,
  AuthAccount,
  CapabilityRequest,
  ProjectEffectRequest,
  PromptProbeRequest,
  ProxyRequest,
  SignUpRequest,
  LoginRequest,
  CreateWorkspaceRequest,
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

  // ── Identity echo (multi-account design §5.5, invariant I5) ─────────────────
  // Every matched response names the tenant the server resolved for it. A pure
  // tripwire: the client asserts it matches the account it believes it's acting
  // as, so an identity-routing bug becomes a loud, local error instead of silent
  // cross-account contamination. Costless on the native backend (always the one
  // local tenant). Exposed to browsers via Access-Control-Expose-Headers.
  r.use((ctx) => {
    ctx.res.setHeader('x-resolved-tenant', store.identity(ctx.req.headers).tenant.id)
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

  // Authorize a caller to ACT AS a commission on a cooperation route (P8 Phase 2b). Three walls:
  //  (0) project-binding — the commission must be a Contributor on the project being ACTED ON
  //      (`actedProjectId`, the URL `:id`), not merely some project the caller owns. Without this,
  //      the shared-gate/reach/role below (which all read the COMMISSION's own project) protect the
  //      wrong project: a caller could cite a self-owned commission on its OWN shared project to
  //      fire effects / hold sub-goals on a DIFFERENT tenant's guarded project (cross-tenant DoS +
  //      mis-attributed audit) — the Phase 2b review's HIGH. Omit `actedProjectId` for the invoke
  //      route (context-mediated, no URL project — the commission's own project is the reference).
  //  (1) caller-identity — you may act only as a commission whose AGENT you own
  //      (`commissionOwnerTenant` === caller); else the client-supplied commissionId is forgeable
  //      and reputation / audit / the D12 reach would be attributed to a commission the caller
  //      does not control (a confused-deputy across the tenant boundary).
  //  (2) shared-gate — a CROSS-TENANT commission (agent owner ≠ Project owner) may act only while
  //      its Project is still SHARED. Un-share revokes a foreign Contributor's effect access; the
  //      effect / sub-goal routes otherwise ignored the `shared` flag that POST /commissions and
  //      opDeniedForTenant enforce (P8 Phase 2a review — the un-share gap, test-plan A6).
  // A bare-string / unknown holder (not a commission) is UNGATED here — it carries no
  // role/reputation/attribution (the sub-goal route admits non-commission principals — the raw
  // holder is a documented prototype limitation, routes NOTE). 403 when denied. Backward-compatible
  // on the single-tenant mock (caller = the default tenant, whose seed commissions are default-owned
  // Contributors on their own default-owned Projects ⇒ all walls pass).
  const commissionActorDenied = (
    req: IncomingMessage,
    res: ServerResponse,
    holder: string,
    actedProjectId?: string,
  ): boolean => {
    const owner = store.commissionOwnerTenant(holder)
    if (owner === undefined) return false // not a commission → a bare principal, ungated here
    const commission = store.getCommission(holder)
    // (0) The commission must belong to the project being acted on — else all the project-scoped
    // checks below inspect the commission's OWN (attacker-controlled) project, not the URL project.
    if (actedProjectId !== undefined && commission?.projectId !== actedProjectId) {
      sendError(res, 'forbidden', `Commission '${holder}' is not a Contributor on this Project`)
      return true
    }
    const tenantId = store.identity(req.headers).tenant.id
    if (owner !== tenantId) {
      sendError(res, 'forbidden', `You may not act as commission '${holder}'`)
      return true
    }
    const project = commission?.projectId ? store.findProject(commission.projectId) : undefined
    const projectOwner = project?.tenantId ?? store.defaultTenantId()
    if (owner !== projectOwner && project?.shared !== true) {
      sendError(res, 'forbidden', `Commission '${holder}' may not act on this Project (it is not shared)`)
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

  // ── Verified sessions (multi-account P6 — the production identity seam) ─────
  // (P9: the dev enumeration directory — `GET /v1/identities` — is RETIRED.
  // Seeds are reachable the same way as any account: sign in with their demo
  // credential. Nothing on any backend enumerates identities anymore.)
  // POST validates a pick against the SAME directory the switcher lists and sets
  // an HttpOnly cookie carrying an HMAC-signed token; identity resolution reads
  // the cookie FIRST (server/identity.ts), so from here on the client's identity
  // is server-issued, not client-asserted. In a real deployment this endpoint is
  // where the IdP callback lands — the wire shape is already right. DELETE signs
  // out. Both respond with what /me would now say, so the client can confirm the
  // switch from the same response (one round-trip, and it's server truth).
  /** Mint the active session for (userId, tenantId) and answer with the resolved
   *  Identity. Resolution goes through the same path every future request takes
   *  (cookie-first), not by trusting the pick — the response IS the seam's
   *  answer; the echo is re-stamped for header/body coherence (the request
   *  arrived as the OLD account, the response is ABOUT the new one).
   *
   *  The account STACK (multi-account §12 — GitHub-style remembered accounts)
   *  rides a second signed cookie: `join` ADDS this account (a real sign-in /
   *  sign-up); otherwise only an account ALREADY remembered gets its entry
   *  refreshed (last-active tenant, fresh iat) — a seed/dev pick never leaks
   *  into the remembered-accounts list. */
  const mintSession = (req: IncomingMessage, res: ServerResponse, userId: string, tenantId: string, join: boolean) => {
    const token = signSession({ userId, tenantId, iat: Date.now() })
    const stack = verifyStack(parseCookies(headerValue(req.headers, 'cookie'))[STACK_COOKIE])
    const remembered = join || stack.some((e) => e.userId === userId)
    const cookies = [sessionSetCookie(token)]
    if (remembered) cookies.push(stackSetCookie(stackWith(stack, { userId, tenantId, iat: Date.now() })))
    res.setHeader('Set-Cookie', cookies)
    const minted = store.identity({ ...req.headers, cookie: `${SESSION_COOKIE}=${token}` })
    res.setHeader('x-resolved-tenant', minted.tenant.id)
    sendJson(res, minted)
  }
  r.post('/auth/session', async ({ req, res, body }) => {
    if (!store.capabilities().features.identitySwitch) {
      return sendError(res, 'capability_unavailable', 'Account switching is disabled on this backend.')
    }
    const { userId, tenantId } = await body<{ userId?: string; tenantId?: string }>()
    // Two mint paths, both registry-validated (role NEVER rides in the claims):
    //   • a WORKSPACE re-mint (P7): the currently-resolved user switching to
    //     another tenant they hold a real membership in — how an account moves
    //     between its workspaces (never a foreign one; enumeration stays
    //     impossible), or
    //   • an ACCOUNT-STACK pick (§12): a `userId` the signed stack cookie
    //     remembers — an account that signed in on this browser switches back
    //     WITHOUT re-entering its credential (GitHub-style). The registry still
    //     validates the landing tenant; the stack only proves "signed in here".
    // (The former SEED-pick path retired with the enumeration directory, P9 —
    // a seed identity signs in with its demo credential like everyone else.)
    let mint: { userId: string; tenantId: string } | null = null
    if (tenantId) {
      const current = store.identity(req.headers)
      const m = accounts.membership(current.user.id, tenantId)
      if (m && (!userId || userId === current.user.id)) mint = { userId: current.user.id, tenantId }
    }
    if (!mint && userId) {
      const stack = verifyStack(parseCookies(headerValue(req.headers, 'cookie'))[STACK_COOKIE])
      const entry = stack.find((e) => e.userId === userId)
      if (entry) {
        // The requested tenant if the membership holds, else where the account
        // left off, else its first workspace — strictly registry-validated.
        const valid = (t: string | undefined) => (t && accounts.membership(userId, t) ? t : undefined)
        const target = valid(tenantId) ?? valid(entry.tenantId) ?? accounts.workspacesOf(userId)[0]?.tenant.id
        if (target) mint = { userId, tenantId: target }
      }
    }
    if (!mint) {
      return sendError(
        res,
        'bad_request',
        'Unknown identity — pick a workspace you belong to, or an account signed in on this browser.',
      )
    }
    mintSession(req, res, mint.userId, mint.tenantId, false)
  })
  // DELETE signs the ACTIVE account out: the session cookie clears and that
  // account's stack entry is forgotten — the OTHER remembered accounts stay
  // (GitHub's "sign out of one account"; the client then offers the remaining
  // accounts on its picker). `?all=1` forgets every remembered account too.
  r.delete('/auth/session', ({ req, res, url }) => {
    const stack = verifyStack(parseCookies(headerValue(req.headers, 'cookie'))[STACK_COOKIE])
    const me = store.identity(req.headers)
    const next = url.searchParams.get('all') ? [] : me.via === 'session' ? stackWithout(stack, me.user.id) : stack
    res.setHeader('Set-Cookie', [sessionClearCookie(), stackSetCookie(next)])
    res.writeHead(204, BASE_HEADERS).end()
  })
  // The accounts signed in on THIS browser (§12) — the switcher's instant-hop
  // rows, resolved STRICTLY against the registry at read time: a stale entry
  // (deleted user) drops; a revoked last-active membership falls back to the
  // account's first remaining workspace. Never enumerates anything the stack
  // cookie doesn't already prove was signed in here.
  r.get('/auth/accounts', ({ req, res }) => {
    const entries = verifyStack(parseCookies(headerValue(req.headers, 'cookie'))[STACK_COOKIE])
    const me = store.identity(req.headers)
    const rows: AuthAccount[] = []
    for (const e of entries) {
      const home = accounts.workspacesOf(e.userId)[0]
      const resolved = accounts.identityFor(e.userId, e.tenantId) ?? (home ? accounts.identityFor(e.userId, home.tenant.id) : null)
      if (!resolved) continue
      rows.push({
        user: resolved.user,
        tenant: resolved.tenant,
        role: resolved.role,
        current: me.via === 'session' && me.user.id === e.userId,
      })
    }
    sendJson(res, rows)
  })

  // ── Onboarding (multi-account P7 — real, persisted accounts) ────────────────
  // Signup creates a user + their personal workspace in the ACCOUNT REGISTRY
  // (server/accounts.ts — scrypt credential, persisted across restarts) and signs
  // them in immediately (same P6 cookie; the response carries the resolved
  // Identity and re-stamps the echo, exactly like a switch). Login verifies the
  // credential constant-time; failure is ONE `unauthorized`, whatever the reason
  // — the response must not leak whether the email exists. Both JOIN the account
  // stack (§12): a credentialed sign-in is what makes an account "remembered on
  // this browser" for the switcher's instant hops.
  const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  r.post('/auth/signup', async ({ req, res, body }) => {
    const { name, email, password } = await body<SignUpRequest>()
    if (!name?.trim()) return sendError(res, 'bad_request', 'A display name is required.')
    if (!email || !EMAIL_SHAPE.test(email.trim())) return sendError(res, 'bad_request', 'A valid email is required.')
    // Bounded above too: scrypt cost scales with input length, so an unbounded
    // password is a cheap CPU-burn vector, not extra security.
    if (!password || password.length < 8 || password.length > 128) {
      return sendError(res, 'bad_request', 'Password must be 8–128 characters.')
    }
    const created = accounts.createUser(name, email, password)
    if (!created) return sendError(res, 'conflict', 'An account with this email already exists — sign in instead.')
    store.accountsMutated() // real accounts persist across restarts (P7)
    mintSession(req, res, created.user.id, created.tenant.id, true)
  })
  r.post('/auth/login', async ({ req, res, body }) => {
    const { email, password } = await body<LoginRequest>()
    // The same scrypt-cost bound as signup; no valid account exceeds it, so the
    // refusal is a plain (uniform) 401, not a distinguishable 400.
    const bounded = !!email && !!password && password.length <= 128
    const user = bounded ? accounts.verifyPassword(email, password) : null
    // One code for every failure mode — account existence must not leak.
    if (!user) return sendError(res, 'unauthorized', 'Invalid email or password.')
    const home = accounts.workspacesOf(user.id)[0]
    if (!home) return sendError(res, 'unauthorized', 'Invalid email or password.')
    mintSession(req, res, user.id, home.tenant.id, true)
  })

  // The signed-in account's workspaces (the chip menu's switch targets) + create.
  r.get('/me/workspaces', ({ req, res }) => {
    const me = store.identity(req.headers)
    sendJson(res, accounts.workspacesOf(me.user.id))
  })
  r.post('/workspaces', async ({ req, res, body }) => {
    const { name } = await body<CreateWorkspaceRequest>()
    if (!name?.trim()) return sendError(res, 'bad_request', 'A workspace name is required.')
    const me = store.identity(req.headers)
    const tenant = accounts.createWorkspace(me.user.id, name)
    if (!tenant) return sendError(res, 'bad_request', 'No such user.')
    store.accountsMutated()
    sendJson(res, tenant, 201)
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
    // Dispatch runs by status — a GAUGE of the live feed (like runners_total), derived at
    // scrape time, so a wave of failed one-off runs (P7) shows up in ops (F6 PD31). All three
    // series are always present (0 until seen) so a dashboard can chart them from the start.
    const runs = store.listDispatch()
    const dispatchByStatus = (s: 'running' | 'done' | 'failed') => runs.filter((r) => r.status === s).length
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
      '# HELP dispatch_runs Dispatch runs by status (P7 automation).',
      '# TYPE dispatch_runs gauge',
      `dispatch_runs{status="running"} ${dispatchByStatus('running')}`,
      `dispatch_runs{status="done"} ${dispatchByStatus('done')}`,
      `dispatch_runs{status="failed"} ${dispatchByStatus('failed')}`,
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
  r.post('/runners/:id/invoke', async ({ req, res, params, body }) => {
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
    // Caller-identity + shared-gate (P8 Phase 2b): a commissioned host effect may be attributed
    // only to a commission whose agent the caller owns, and a cross-tenant one only while its
    // Project is shared — so the D12/reputation/audit attribution below can't be forged by citing
    // another tenant's commissionId. (Absent commissionId ⇒ the legacy single-tenant path.)
    if (request.commissionId && commissionActorDenied(req, res, request.commissionId)) return
    // Owner-pays attribution (D13): a commissioned effect audits under the AGENT owner's tenant.
    const auditTenant = request.commissionId ? store.commissionOwnerTenant(request.commissionId) : undefined
    if (
      request.commissionId &&
      !store.commissionAdmitsTarget(request.commissionId, request.capability, request.target)
    ) {
      // Detective audit (D15/OQ7): the D12 isolation wall turned this commissioned effect
      // away — the highest-value entry in the trail (a Contributor reaching past its Project).
      store.recordAudit({ channel: 'host-invoke', commissionId: request.commissionId, capability: request.capability, target: request.target, outcome: 'denied', tenantId: auditTenant })
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
      store.recordAudit({ channel: 'host-invoke', commissionId: request.commissionId, capability: request.capability, target: request.target, outcome: 'denied', tenantId: auditTenant })
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
        store.recordAudit({ channel: 'host-invoke', commissionId: request.commissionId, capability: request.capability, target: request.target, outcome: 'fulfilled', tenantId: auditTenant })
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
    // A Session provider (docs/delegated-cognition-provider.md): nothing to dial, so no
    // endpoint config and no conformance probe — instead the server mints the rendezvous
    // secret here and answers with it EXACTLY ONCE (only its hash survives, on the
    // server-only config). The mint stamps `toolUse:false` (prose-only — inverting the
    // dangerous unset-means-tools default) and the caller's tenant (forced scoping; the
    // store's mint wall re-asserts both).
    if (input.kind === 'session') {
      if (input.config) return sendError(res, 'bad_request', 'A Session provider has no endpoint — omit `config`.')
      const secret = mintRelaySecret()
      try {
        const tenantId = store.identity(req.headers).tenant.id
        const provider = store.createProvider(
          {
            label: input.label,
            modelFamily: input.modelFamily,
            effortLevels: input.effortLevels,
            plan: input.plan,
            authority: input.authority,
            kind: 'session',
            secretHint: relaySecretHint(secret),
          },
          { kind: 'session', capabilities: { toolUse: false }, secretHash: hashRelaySecret(secret) },
          tenantId,
        )
        // The request flagged the new entry as the caller's default (the UI shortcut) —
        // one pointer move through the same seam the PATCH path uses.
        if (input.isDefault === true) store.setDefaultProvider(provider.id, tenantId)
        return sendJson(res, { ...provider, ...(input.isDefault === true ? { isDefault: true } : {}), secret })
      } catch (err) {
        if (err instanceof BudgetError || err instanceof ProviderProbeError) return sendError(res, 'bad_request', err.message)
        throw err
      }
    }
    // The write-only endpoint half (D9): split off the request so it never lands on
    // the `ModelProvider` the registry stores and echoes — the read type stays free
    // of endpoint/credential shape. A config that brings its own endpoint is probed
    // for Messages-protocol conformance *before* the mint; the probe's capability
    // record travels with the config, satisfying the funnel's unverified-endpoint
    // guard. A probe failure is a 400 — a non-conformant provider is never registered.
    // (`kind`/`secretHint`/`online` are server-stamped relay fields — stripped, so an
    // endpoint registration can't forge them. `isDefault` is split off too: it's the
    // per-tenant pointer move below, never a stored field.)
    const { config: endpoint, kind: _kind, secretHint: _hint, online: _online, isDefault, ...fields } = input
    // Pick the three known endpoint fields explicitly (strings only) — a raw spread
    // would let arbitrary unknown JSON ride into the persisted server-only config
    // (including a forged `capabilities` record).
    const str = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined)
    const config: ProviderConfig = { baseURL: str(endpoint?.baseURL), apiKeyEnv: str(endpoint?.apiKeyEnv), model: str(endpoint?.model) }
    if (config.baseURL) {
      try {
        config.capabilities = await probeProviderEndpoint(config)
      } catch (err) {
        if (err instanceof ProviderProbeError) return sendError(res, 'bad_request', err.message)
        throw err
      }
    }
    try {
      const tenantId = store.identity(req.headers).tenant.id
      const provider = store.createProvider(fields, config, tenantId)
      if (isDefault === true) store.setDefaultProvider(provider.id, tenantId)
      sendJson(res, { ...provider, ...(isDefault === true ? { isDefault: true } : {}) })
    } catch (err) {
      // An over-plan provider — the requested plan exceeds the account plan (the cascade root).
      if (err instanceof BudgetError) return sendError(res, 'bad_request', err.message)
      // An out-of-policy credential reference the probe never saw (no endpoint to
      // probe) — caught by the mint funnel's own wall.
      if (err instanceof ProviderProbeError) return sendError(res, 'bad_request', err.message)
      throw err
    }
  })
  r.patch('/providers/:id', async ({ req, res, params, body }) => {
    if (denyForeignEntry(req, res, params.id, (t) => store.listProviders(t), 'provider')) return
    const patch = await body<UpdateProviderRequest>()
    const tenantId = store.identity(req.headers).tenant.id
    try {
      const provider = store.updateProvider(params.id, patch)
      if (!provider) return sendError(res, 'not_found', `No provider '${params.id}'`)
      // The default flag (the UI shortcut): true moves the caller's pointer here;
      // false clears it when this entry holds it — no default left is a valid state.
      if (patch.isDefault === true) store.setDefaultProvider(params.id, tenantId)
      else if (patch.isDefault === false && store.listProviders(tenantId).some((p) => p.id === params.id && p.isDefault)) {
        store.setDefaultProvider(undefined, tenantId)
      }
      // Re-read so the response carries the serve-time stamps (isDefault, online).
      sendJson(res, store.listProviders(tenantId).find((p) => p.id === params.id) ?? provider)
    } catch (err) {
      if (err instanceof BudgetError || err instanceof ValidationError) return sendError(res, 'bad_request', err.message)
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
  // Rotate a Session provider's rendezvous secret — the kill switch (§7.5). The old
  // secret dies on the spot (a held connector meets 401; an in-flight turn falls back
  // immediately); the response carries the NEW secret exactly once, like the mint.
  r.post('/providers/:id/rotate', ({ req, res, params }) => {
    if (denyForeignEntry(req, res, params.id, (t) => store.listProviders(t), 'provider')) return
    const rotated = store.rotateProviderSecret(params.id)
    if (!rotated) return sendError(res, 'conflict', 'Only a Session provider has a rendezvous secret to rotate.')
    sendJson(res, { ...rotated.provider, secret: rotated.secret })
  })

  // ── The delegated-cognition relay (docs/delegated-cognition-provider.md) ────
  // The two wire shapes a Session provider's user-side connector speaks. Auth is the
  // rendezvous secret as a bearer token: hashed once, compared constant-time against
  // each session config's stored hash (store.relayProviderForSecret). Presenting the
  // secret IS the binding — no enrollment protocol, so a backend restart or laptop
  // sleep re-binds by the next poll alone (§7.3). No tenant headers here: the secret
  // maps to a provider row that is forced tenant-scoped at mint.
  const relayAuth = (req: IncomingMessage, res: ServerResponse): string | undefined => {
    const authz = headerValue(req.headers, 'authorization')
    const secret = authz ? /^Bearer\s+(.+)$/i.exec(authz)?.[1] : undefined
    const providerId = secret ? store.relayProviderForSecret(secret) : undefined
    if (!providerId) {
      sendError(res, 'unauthorized', 'Present a valid rendezvous secret as `Authorization: Bearer …`.')
      return undefined
    }
    return providerId
  }
  // The connector's bounded long-poll: the pending prompt (now or when one arrives),
  // `{idle:true}` after the window (re-call immediately — the §4.2 sentinel), or
  // `{superseded:true}` when a newer poll preempted this one (newest wins) or the
  // secret rotated away. A dropped socket unparks via `abandon`, so a zombie
  // connection neither wedges the slot nor leaks the handler.
  r.get('/relay/poll', async ({ req, res }) => {
    const providerId = relayAuth(req, res)
    if (!providerId) return
    const { result, abandon } = store.relay.poll(providerId)
    req.on('close', abandon)
    const outcome = await result
    // The long-poll's client may have vanished during the park (that's what
    // `abandon` handles server-side) — writing to its dead response must not
    // escape into the router (whose error path would write to it again).
    try {
      if (!res.writableEnded) sendJson(res, outcome)
    } catch {
      /* the connector disconnected mid-park — nothing left to tell it */
    }
  })
  // The connector's answer, keyed to its entry (§7.1): the live entry settles the
  // turn; anything else is 410 Gone — settled or gone, drop it and poll on. An
  // explicit `error` (or an empty completion, normalised in relayReply) fails the
  // turn to its fallback; a refusal from the far model is a *completion*.
  r.post('/relay/reply', async ({ req, res, body }) => {
    const providerId = relayAuth(req, res)
    if (!providerId) return
    const { entryId, completion, error } = await body<RelayReplyRequest>()
    if (!entryId || typeof entryId !== 'string') return sendError(res, 'bad_request', 'entryId is required')
    const outcome: RelayOutcome =
      typeof error === 'string' && error
        ? { kind: 'error', reason: error }
        : { kind: 'completion', text: typeof completion === 'string' ? completion : '' }
    if (store.relay.submit(providerId, entryId, outcome) === 'gone') {
      return sendError(res, 'gone', 'That prompt is settled or gone — drop this answer and poll again.')
    }
    sendJson(res, { ok: true })
  })
  // The user-side connector itself, served as ONE self-contained plain-JS module —
  // the public install path (docs/delegated-cognition-provider.md §4.2, spec
  // MODEL-14). A hosted user can't run a repo script, so the backend serves the
  // file the flow needs: the checked-in TypeScript source with its types erased at
  // request time by the runtime's own stripper (`node:module.stripTypeScriptTypes`
  // — no build step, no drift; the connector's only import is `import type`, which
  // erases, so the output runs on any Node ≥ 18 with plain `node file.mjs`).
  // Unauthenticated by design: the connector is a program, not a secret — the
  // rendezvous secret it later presents is the credential. Both backends serve it.
  let connectorJs: string | null = null
  r.get('/connector', ({ res }) => {
    connectorJs ??= stripTypeScriptTypes(
      readFileSync(fileURLToPath(new URL('../../connector/relay-connector.ts', import.meta.url)), 'utf8'),
    )
    res.setHeader('Content-Disposition', 'attachment; filename="session-relay.mjs"')
    sendText(res, connectorJs, 'text/javascript; charset=utf-8')
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
    // Strict bindings: an Agent is minted against a NAMED provider + prompt — the API
    // never resolves an absent one to a default (defaults are a UI pre-selection
    // shortcut only; a missing binding is a caller bug surfaced here, as a 400).
    if (!input?.label || !input.providerId || !input.systemPromptId) {
      return sendError(res, 'bad_request', 'label, providerId, and systemPromptId are required')
    }
    const tenantId = store.identity(req.headers).tenant.id
    const bad = badAgentRef(input, tenantId)
    if (bad) return sendError(res, 'not_found', bad)
    try {
      sendJson(res, store.createAgentFromRequest(input, tenantId))
    } catch (err) {
      // An over-grant on either cascade face — the request named an impossible grant —
      // or a binding the store's own strictness wall refused.
      if (err instanceof BudgetError || err instanceof AuthorityError || err instanceof ValidationError) {
        return sendError(res, 'bad_request', err.message)
      }
      throw err
    }
  })
  r.patch('/agents/:id', async ({ req, res, params, body }) => {
    if (denyForeignEntry(req, res, params.id, (t) => store.listAgents(t), 'agent')) return
    const patch = await body<UpdateAgentRequest>()
    // Strict like create: a PRESENT binding must name a registered entry — empty
    // string ("clear to default") no longer exists; omit the field to keep the
    // current binding (including a bespoke merged/forked prompt).
    if (('providerId' in patch && !patch.providerId) || ('systemPromptId' in patch && !patch.systemPromptId)) {
      return sendError(res, 'bad_request', 'providerId / systemPromptId must name a registered entry — omit the field to keep the current binding')
    }
    const bad = badAgentRef(patch, store.identity(req.headers).tenant.id)
    if (bad) return sendError(res, 'not_found', bad)
    try {
      const agent = store.updateAgentFromRequest(params.id, patch)
      if (!agent) return sendError(res, 'not_found', `No agent '${params.id}'`)
      sendJson(res, agent)
    } catch (err) {
      if (err instanceof BudgetError || err instanceof AuthorityError || err instanceof ValidationError) {
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
  // Fork a published Agent's definition into the caller's tenant (D18): a new private
  // Agent with capability UNBOUND (authority/budget dropped; provider/prompt bindings
  // survive only if the forker can see them) + lineage stamped; the source's fork
  // counter increments. An unknown id or a foreign UNPUBLISHED Agent is a 404
  // (existence-hiding); the caller's own Agents fork freely (duplicate).
  r.post('/agents/:id/fork', ({ req, res, params }) => {
    const fork = store.forkAgent(params.id, store.identity(req.headers).tenant.id)
    if (!fork) return sendError(res, 'not_found', `No agent '${params.id}'`)
    sendJson(res, fork)
  })

  // ── Discovery directories (docs/agent-commons.md, D17) ─────────────────────
  // Read-only, cross-tenant listings of what owners made public — shared Projects and
  // published Agents — each entry its existing public face plus public aggregates.
  // `?q=` is a case-insensitive substring over name/description; ranking is
  // deliberately absent (D17: a directory, not a feed).
  r.get('/directory/projects', ({ req, res, url }) => {
    sendJson(res, store.projectDirectory(store.identity(req.headers).tenant.id, url.searchParams.get('q') ?? undefined))
  })
  r.get('/directory/agents', ({ req, res, url }) => {
    sendJson(res, store.agentDirectory(store.identity(req.headers).tenant.id, url.searchParams.get('q') ?? undefined))
  })
  // The workspace profile (D21): a display name's one public face — its shared
  // Projects, published Agents, public stats, and recent public acts. The router
  // URL-decodes `:name`. 404 for a name with no public rows: a workspace that
  // shares nothing is indistinguishable from one that doesn't exist.
  r.get('/directory/owners/:name', ({ req, res, params }) => {
    const profile = store.ownerProfile(params.name, store.identity(req.headers).tenant.id)
    if (!profile) return sendError(res, 'not_found', `No public workspace '${params.name}'`)
    sendJson(res, profile)
  })

  // ── Global search (docs/agent-commons.md, D22) ──────────────────────────────
  // One route, typed grouped hits across everything the CALLER can see — private
  // workspace + the commons — composed exclusively from the same per-tenant reads
  // the pages use (search is a window, never a wall-breach). Empty q ⇒ no groups.
  r.get('/search', ({ req, res, url }) => {
    sendJson(res, store.searchAll(store.identity(req.headers).tenant.id, url.searchParams.get('q') ?? undefined))
  })

  // ── The Agent tool catalog ───────────────────────────────────────────────────
  // The names `server/model/tools.ts` declares — what an Agent's explicit tool grant
  // can name. Read-only and tenant-free (the catalog is shared infra, like the seeded
  // registries); the UI's "full tool catalog" grant reads it live instead of
  // hard-coding a mirror (UI-12) — an omitted grant is the EMPTY set (INV-9 minimal
  // risk), so the full grant must be spelled out by the caller.
  r.get('/agent-tools', ({ res }) => {
    sendJson(res, { tools: TOOL_NAMES })
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
    const tenantId = store.identity(req.headers).tenant.id
    const entry = store.createSystemPrompt(input, tenantId)
    // The request flagged the new entry as the caller's default (the UI shortcut).
    if (input.isDefault === true) store.setDefaultSystemPrompt(entry.id, tenantId)
    sendJson(res, { ...entry, ...(input.isDefault === true ? { isDefault: true } : {}) })
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
    const tenantId = store.identity(req.headers).tenant.id
    const entry = store.updateSystemPrompt(params.id, patch)
    if (!entry) return sendError(res, 'not_found', `No system prompt '${params.id}'`)
    // The default flag — same set/clear semantics as the provider PATCH.
    if (patch.isDefault === true) store.setDefaultSystemPrompt(params.id, tenantId)
    else if (patch.isDefault === false && store.listSystemPrompts(tenantId).some((p) => p.id === params.id && p.isDefault)) {
      store.setDefaultSystemPrompt(undefined, tenantId)
    }
    sendJson(res, store.listSystemPrompts(tenantId).find((p) => p.id === params.id) ?? entry)
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
    // Visible if it's the caller's own/seed (full) or a Contributor on a SHARED project
    // (redacted to public identity) — consistent with the shared-project list (P8), rather
    // than 404ing a Contributor the list shows.
    const commission = store.commissionVisibleToTenant(params.id, store.identity(req.headers).tenant.id)
    if (!commission) return sendError(res, 'not_found', `No commission '${params.id}'`)
    sendJson(res, commission)
  })
  // The commission's *effective* authority (D12): the agent's granted ceiling clamped
  // to what the Project admits — what the Contributor actually reaches, never the
  // owner's ambient set. Derived server-side (the single source); the UI shows it.
  r.get('/commissions/:id/authority', ({ req, res, params }) => {
    // Tenant-scoped (F2/PD9), and DELIBERATELY tighter than the sibling by-id GET: this uses
    // the no-projectId `listCommissions` (own/seed only, `registryVisible`), so a foreign
    // Contributor on a SHARED Project — which `GET /commissions/:id` and the list DO expose
    // (redacted to identity) — is 404 here. That asymmetry is the intended posture, not an
    // oversight (P8 BUG-5): a shared Project's contributor list is public *identity* ("who
    // contributes"), but the D12 *effective reach* is private to the commission owner, exactly
    // as `publicCommission` strips `authority`/`grant`. Effective reach never crosses the tenant
    // boundary. Locked by tests/cross-tenant-cooperation + capability-remote (who-not-what).
    if (!store.listCommissions(undefined, store.identity(req.headers).tenant.id).some((c) => c.id === params.id)) {
      return sendError(res, 'not_found', `No commission '${params.id}'`)
    }
    const authority = store.commissionAuthority(params.id)
    if (!authority) return sendError(res, 'not_found', `No commission '${params.id}'`)
    sendJson(res, authority)
  })
  r.post('/commissions', async ({ req, res, body }) => {
    const input = await body<CreateCommissionRequest>()
    // Strict role (INV-9): the API never picks a role for the caller — the
    // commissioning UI pre-selects the Project's defaultRole (else writer), visibly.
    if (!input?.agentId || !input?.projectId || !input?.role) {
      return sendError(res, 'bad_request', 'agentId, projectId, and role are required')
    }
    const tenantId = store.identity(req.headers).tenant.id
    // Scoped: a tenant may only commission an agent it can see (its own or the shared default),
    // not another tenant's private agent (F2/PD9).
    if (!store.listAgents(tenantId).some((a) => a.id === input.agentId)) {
      return sendError(res, 'not_found', `No agent '${input.agentId}'`)
    }
    // Resolve the Project across both homes (seed + created) — a shared *created* Project must
    // be reachable here, else this direct path 404s a legitimate cross-tenant commission the
    // `commission-agent` op path (which uses `findProject`) accepts (P8 BUG-1). Cross-tenant
    // authorization mirrors that op's carve-out: a non-owner may commission its own agent ONLY
    // onto a SHARED Project; a private/foreign Project is hidden (404, not 403). The own-agent
    // subject axis is already enforced by the `listAgents(tenant)` check above.
    const project = store.findProject(input.projectId)
    const projectOwner = project?.tenantId ?? store.defaultTenantId()
    if (!project || (projectOwner !== tenantId && project.shared !== true)) {
      return sendError(res, 'not_found', `No project '${input.projectId}'`)
    }
    if (!PROJECT_ROLES.includes(input.role)) {
      return sendError(res, 'bad_request', `Unknown role '${input.role}'`)
    }
    try {
      sendJson(res, store.createCommission(input, tenantId))
    } catch (err) {
      // An over-grant on either cascade face — the request named an impossible grant —
      // or the funnel's own strict-role wall (belt to the check above).
      if (err instanceof BudgetError || err instanceof AuthorityError || err instanceof ValidationError) {
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
  r.post('/projects/:id/subgoals', async ({ req, res, params, body }) => {
    const { holder, subGoal } = await body<ReserveSubGoalRequest>()
    if (!holder || !subGoal) return sendError(res, 'bad_request', 'holder and subGoal are required')
    // Project-binding + caller-identity + shared-gate (P8 Phase 2b): when the holder is a
    // Contributor (commission), it must be one on THIS project, whose agent you own, and
    // cross-tenant only while shared. A bare-string holder is ungated (as below).
    if (commissionActorDenied(req, res, holder, params.id)) return
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
  // ── Open work — the Project backlog (docs/agent-commons.md, D19) ───────────
  // The issues-tray analog: posted work items carrying the effect they need. POST is
  // the "open an issue" act — any tenant that can SEE the Project (owner, or anyone
  // while shared) may post; the server then dispatches the item synchronously to the
  // Project's `standing` Commissions (role-rank order) through the SAME walls the
  // prompted effect path enforces (role D14 / reach D12 / Guardian D11 / credit D13 /
  // audit D15). An item nothing can take stays open in the backlog. Visibility of the
  // backlog mirrors the Project's (owner or shared ⇒ readable; else 404, no leak).
  const projectHiddenFrom = (req: IncomingMessage, projectId: string): boolean => {
    const project = store.findProject(projectId)
    const owner = project?.tenantId ?? store.defaultTenantId()
    const tenantId = store.identity(req.headers).tenant.id
    return !project || (owner !== tenantId && project.shared !== true)
  }
  r.get('/projects/:id/open-subgoals', ({ req, res, params }) => {
    if (projectHiddenFrom(req, params.id)) return sendError(res, 'not_found', `No project '${params.id}'`)
    sendJson(res, store.listOpenSubGoals(params.id))
  })
  r.post('/projects/:id/open-subgoals', async ({ req, res, params, body }) => {
    const input = await body<PostOpenSubGoalRequest>()
    if (!input?.subGoal?.trim() || typeof input?.target !== 'string' || !PROJECT_EFFECT_TYPES.includes(input.type)) {
      return sendError(res, 'bad_request', 'subGoal, target, and a valid type are required')
    }
    if (projectHiddenFrom(req, params.id)) return sendError(res, 'not_found', `No project '${params.id}'`)
    sendJson(res, store.postOpenSubGoal(params.id, { ...input, subGoal: input.subGoal.trim() }, store.identity(req.headers).tenant.id))
  })
  // D23 — the item's flat discussion thread: anyone who can SEE the project may
  // comment (the same wall as reading the backlog); attribution is the display name.
  r.post('/projects/:id/open-subgoals/:itemId/comments', async ({ req, res, params, body }) => {
    const input = await body<PostWorkItemCommentRequest>()
    if (typeof input?.body !== 'string' || !input.body.trim()) {
      return sendError(res, 'bad_request', 'a non-empty comment body is required')
    }
    if (projectHiddenFrom(req, params.id)) return sendError(res, 'not_found', `No project '${params.id}'`)
    const out = store.commentOnOpenSubGoal(params.id, params.itemId, input.body, store.identity(req.headers).tenant.id)
    if (out === undefined) return sendError(res, 'not_found', `No work item '${params.itemId}'`)
    if (out === 'capped') return sendError(res, 'conflict', 'This item’s discussion is at its cap')
    sendJson(res, out)
  })
  // ── D25 — change proposals against published definitions (the PR analog) ────
  // Propose: the directory's wall (published-only ⇒ the identical 404). Review:
  // the owner sees all, a proposer sees their own. Verdicts are owner-only.
  r.post('/agents/:id/proposals', async ({ req, res, params, body }) => {
    const input = await body<ProposeAgentChangeRequest>()
    const f = input?.fields
    const hasField =
      !!f &&
      ((typeof f.label === 'string' && !!f.label.trim()) ||
        (typeof f.systemPrompt === 'string' && !!f.systemPrompt.trim()) ||
        typeof f.instructions === 'string' ||
        Array.isArray(f.tools))
    if (!hasField) return sendError(res, 'bad_request', 'at least one definition field is required')
    const out = store.proposeAgentChange(params.id, input!, store.identity(req.headers).tenant.id)
    if (out === undefined) return sendError(res, 'not_found', `No agent '${params.id}'`)
    if (out === 'capped') return sendError(res, 'conflict', 'This definition’s review queue is full')
    sendJson(res, out)
  })
  r.get('/agents/:id/proposals', ({ req, res, params }) => {
    const out = store.listAgentProposals(params.id, store.identity(req.headers).tenant.id)
    if (out === undefined) return sendError(res, 'not_found', `No agent '${params.id}'`)
    sendJson(res, out)
  })
  // S10 — the concrete work an Agent resolved (D13 track record); same existence-hiding
  // 404 as the proposal read, P8-redacted to shared-Project items only (in the store).
  r.get('/agents/:id/resolved-work', ({ req, res, params }) => {
    const out = store.agentResolvedWork(params.id, store.identity(req.headers).tenant.id)
    if (out === undefined) return sendError(res, 'not_found', `No agent '${params.id}'`)
    sendJson(res, out)
  })
  // D27 — the proposal's discussion thread: its two parties only (anyone else gets
  // the same 404 the list read gives); open proposals only.
  r.post('/agents/:id/proposals/:pid/comments', async ({ req, res, params, body }) => {
    const input = await body<PostProposalCommentRequest>()
    if (typeof input?.body !== 'string' || !input.body.trim()) {
      return sendError(res, 'bad_request', 'a non-empty comment body is required')
    }
    const out = store.commentOnAgentProposal(params.id, params.pid, input.body, store.identity(req.headers).tenant.id)
    if (out === undefined) return sendError(res, 'not_found', `No proposal '${params.pid}'`)
    if (out === 'closed') return sendError(res, 'conflict', 'This proposal was already resolved — the verdict ended the conversation')
    if (out === 'capped') return sendError(res, 'conflict', 'This proposal’s discussion is at its cap')
    sendJson(res, out)
  })
  r.post('/agents/:id/proposals/:pid/merge', ({ req, res, params }) => {
    const out = store.resolveAgentProposal(params.id, params.pid, store.identity(req.headers).tenant.id, 'merge')
    if (out === undefined) return sendError(res, 'not_found', `No proposal '${params.pid}'`)
    if (out === 'forbidden') return sendError(res, 'forbidden', 'Only the definition’s owner may merge a proposal')
    if (out === 'closed') return sendError(res, 'conflict', 'This proposal was already resolved')
    sendJson(res, out)
  })
  r.post('/agents/:id/proposals/:pid/decline', async ({ req, res, params, body }) => {
    const input = await body<DeclineProposalRequest>()
    const out = store.resolveAgentProposal(params.id, params.pid, store.identity(req.headers).tenant.id, 'decline', input?.note)
    if (out === undefined) return sendError(res, 'not_found', `No proposal '${params.pid}'`)
    if (out === 'forbidden') return sendError(res, 'forbidden', 'Only the definition’s owner may decline a proposal')
    if (out === 'closed') return sendError(res, 'conflict', 'This proposal was already resolved')
    sendJson(res, out)
  })

  // ── D24 — watching + the notification inbox ─────────────────────────────────
  // Watch a project you can see (the same wall as reading it); read/mark your inbox.
  r.get('/projects/:id/watch', ({ req, res, params }) => {
    if (projectHiddenFrom(req, params.id)) return sendError(res, 'not_found', `No project '${params.id}'`)
    sendJson(res, store.watchState(params.id, store.identity(req.headers).tenant.id))
  })
  r.post('/projects/:id/watch', async ({ req, res, params, body }) => {
    const input = await body<SetWatchRequest>()
    if (typeof input?.watching !== 'boolean') return sendError(res, 'bad_request', 'watching (boolean) is required')
    if (projectHiddenFrom(req, params.id)) return sendError(res, 'not_found', `No project '${params.id}'`)
    sendJson(res, store.setWatch(params.id, store.identity(req.headers).tenant.id, input.watching))
  })
  r.get('/notifications', ({ req, res }) => {
    sendJson(res, store.listNotifications(store.identity(req.headers).tenant.id))
  })
  r.post('/notifications/read', async ({ req, res, body }) => {
    const input = await body<MarkNotificationsReadRequest>()
    sendJson(res, store.markNotificationsRead(store.identity(req.headers).tenant.id, input?.ids))
  })

  // D23 — the honest close: poster-or-owner only, open items only (a done item is
  // immutable history). The same store method serves A2A tasks/cancel.
  r.post('/projects/:id/open-subgoals/:itemId/retract', ({ req, res, params }) => {
    if (projectHiddenFrom(req, params.id)) return sendError(res, 'not_found', `No project '${params.id}'`)
    const out = store.retractOpenSubGoal(params.id, params.itemId, store.identity(req.headers).tenant.id)
    if (out === undefined) return sendError(res, 'not_found', `No work item '${params.itemId}'`)
    if (out === 'forbidden') return sendError(res, 'forbidden', 'Only the poster or the project owner may retract an item')
    if (out === 'closed') return sendError(res, 'conflict', 'Only an open item can be retracted')
    sendJson(res, out)
  })

  // ── A2A: the protocol edge (docs/a2a-integration.md, D20) ──────────────────
  // The platform-shell objects re-served in the Agent2Agent wire format — pure
  // translation. Every handler lands on the SAME store reads/mutations behind the
  // same walls as the native routes: `projectHiddenFrom` fronts the Project
  // endpoint, the D17 directory redaction builds every card, `postOpenSubGoal`
  // runs the D19 dispatch. JSON-RPC errors ride HTTP 200 with an `error` member
  // (protocol convention); only a nonexistent ENDPOINT — an unknown/unpublished
  // Agent's — is an HTTP 404, mirroring its card (existence-hiding as everywhere).
  //
  // The platform's own card. Also mounted at the conventional server-root
  // `/.well-known/agent-card.json` (server/index.ts) on the deploy shape.
  r.get('/a2a/card', ({ res, url }) => sendJson(res, platformCard(url.origin)))
  // A published Agent's card, built from its DIRECTORY ENTRY — the same redaction
  // function the D17 directory read uses, so a card can never expose a field the
  // directory withholds. Unpublished or unknown ⇒ the identical 404.
  r.get('/a2a/agents/:id/card', ({ req, res, params, url }) => {
    const entry = store.agentDirectory(store.identity(req.headers).tenant.id).find((e) => e.id === params.id)
    if (!entry) return sendError(res, 'not_found', `No agent '${params.id}'`)
    sendJson(res, agentCard(entry, url.origin))
  })
  // Parse a JSON-RPC envelope; on failure the JSON-RPC error is already sent.
  const readRpc = async (ctx: Ctx): Promise<A2aRpcRequest | undefined> => {
    let rpc: unknown
    try {
      rpc = await ctx.body<unknown>()
    } catch {
      rpcError(ctx.res, null, A2A_ERROR.parse, 'Parse error')
      return undefined
    }
    const shaped = rpc as A2aRpcRequest
    if (!shaped || typeof shaped !== 'object' || typeof shaped.method !== 'string') {
      // Echo the request id when it is readable (JSON-RPC: a client correlates on it).
      const id = shaped && typeof shaped === 'object' && (typeof shaped.id === 'string' || typeof shaped.id === 'number') ? shaped.id : null
      rpcError(ctx.res, id, A2A_ERROR.invalidRequest, 'Invalid JSON-RPC request: an object with a method is required')
      return undefined
    }
    return shaped
  }
  // Pull the v1 message shape out of `message/send` params: one text part (the
  // sub-goal statement) + one data part (the effect descriptor).
  const messageParts = (rpc: A2aRpcRequest): { subGoal?: string; data?: Record<string, unknown> } => {
    const message = rpc.params?.message as A2aMessage | undefined
    const parts = Array.isArray(message?.parts) ? message.parts : []
    const text = parts.find((p) => p?.kind === 'text') as A2aTextPart | undefined
    const data = parts.find((p) => p?.kind === 'data') as A2aDataPart | undefined
    return {
      subGoal: typeof text?.text === 'string' ? text.text.trim() : undefined,
      data: data && typeof data.data === 'object' && data.data !== null ? data.data : undefined,
    }
  }
  // ── D28 — peer credentials (verified identity at the edge) ─────────────────
  // Owner-side registry: mint (token shown ONCE), list (hints only), revoke.
  r.post('/a2a/peers', async ({ res, body }) => {
    const input = await body<CreateA2aPeerRequest>()
    if (typeof input?.name !== 'string' || !input.name.trim()) {
      return sendError(res, 'bad_request', 'name is required')
    }
    sendJson(res, store.createA2aPeer(input.name))
  })
  r.get('/a2a/peers', ({ res }) => {
    sendJson(res, store.listA2aPeers())
  })
  r.delete('/a2a/peers/:id', ({ res, params }) => {
    if (!store.deleteA2aPeer(params.id)) return sendError(res, 'not_found', `No peer '${params.id}'`)
    sendJson(res, { ok: true })
  })

  /** Resolve the caller's peer credential; enforce when `A2A_REQUIRE_AUTH` is set
   *  (the runner-enrollment pattern: unset = the open dev seam, calls land
   *  unverified). Auth is TRANSPORT-level per A2A spec — a refusal is HTTP 401,
   *  not a JSON-RPC error. Returns the peer (or undefined) plus whether to abort. */
  const a2aCaller = (req: IncomingMessage, res: ServerResponse): { peer?: ReturnType<typeof store.resolveA2aPeer>; abort: boolean } => {
    const peer = store.resolveA2aPeer(req.headers.authorization as string | undefined)
    if (!peer && process.env.A2A_REQUIRE_AUTH) {
      sendError(res, 'unauthorized', 'This instance requires a peer credential (Authorization: Bearer …) — see the card’s securitySchemes')
      return { abort: true }
    }
    return { peer, abort: false }
  }

  // A shared Project's A2A endpoint: `message/send` posts open work (D19 via D20);
  // `tasks/get` re-reads the item's lifecycle (task id = item id). A Project the
  // caller cannot see answers exactly like a nonexistent one (TaskNotFound).
  r.post('/a2a/projects/:id', async (ctx) => {
    const { req, res, params } = ctx
    const { peer, abort } = a2aCaller(req, res)
    if (abort) return
    const rpc = await readRpc(ctx)
    if (!rpc) return
    const id = rpc.id ?? null
    if (projectHiddenFrom(req, params.id)) {
      return rpcError(res, id, A2A_ERROR.taskNotFound, `No Project '${params.id}'`)
    }
    if (rpc.method === 'message/send') {
      // A message carrying `taskId` CONTINUES that task (per spec): for this
      // platform, it appends to the work item's D23 discussion thread — the same
      // store method as the native comment route, same walls (D27's protocol
      // face). The thread rides back as the Task's `history`.
      const continueTaskId = (rpc.params?.message as { taskId?: unknown } | undefined)?.taskId
      if (typeof continueTaskId === 'string') {
        const { subGoal: text } = messageParts(rpc)
        if (!text) return rpcError(res, id, A2A_ERROR.invalidParams, 'continuing a task needs a text part (the comment body)')
        const out = store.commentOnOpenSubGoal(params.id, continueTaskId, text, store.identity(req.headers).tenant.id, peer?.name)
        if (out === undefined) return rpcError(res, id, A2A_ERROR.taskNotFound, `No task '${continueTaskId}'`)
        if (out === 'capped') return rpcError(res, id, A2A_ERROR.invalidParams, 'This task’s discussion is at its cap')
        return rpcResult(res, id, taskFromOpenSubGoal(out))
      }
      const { subGoal, data } = messageParts(rpc)
      const type = data?.type as ProjectEffectType | undefined
      const target = data?.target
      if (!subGoal || typeof target !== 'string' || !type || !PROJECT_EFFECT_TYPES.includes(type)) {
        return rpcError(res, id, A2A_ERROR.invalidParams,
          'message/send needs a text part (the sub-goal statement) and a data part {type, target, note?} with a valid effect type')
      }
      const note = typeof data?.note === 'string' ? data.note : undefined
      const item = store.postOpenSubGoal(params.id, { subGoal, type, target, note }, store.identity(req.headers).tenant.id, 'a2a', peer?.name)
      return rpcResult(res, id, taskFromOpenSubGoal(item))
    }
    if (rpc.method === 'tasks/get') {
      const taskId = rpc.params?.id
      const item = typeof taskId === 'string' ? store.listOpenSubGoals(params.id).find((o) => o.id === taskId) : undefined
      if (!item) return rpcError(res, id, A2A_ERROR.taskNotFound, `No task '${typeof taskId === 'string' ? taskId : ''}'`)
      return rpcResult(res, id, taskFromOpenSubGoal(item))
    }
    if (rpc.method === 'tasks/cancel') {
      // The native retract act (D23), spoken in protocol: same store method, same
      // authorization (the caller's identity must be the poster's — or the owner's).
      const taskId = rpc.params?.id
      const out = typeof taskId === 'string' ? store.retractOpenSubGoal(params.id, taskId, store.identity(req.headers).tenant.id) : undefined
      if (out === undefined) return rpcError(res, id, A2A_ERROR.taskNotFound, `No task '${typeof taskId === 'string' ? taskId : ''}'`)
      if (out === 'forbidden') return rpcError(res, id, A2A_ERROR.taskNotCancelable, 'Only the poster or the Project owner may cancel a task')
      if (out === 'closed') return rpcError(res, id, A2A_ERROR.taskNotCancelable, 'Only an open task can be canceled — this one already completed or was canceled')
      return rpcResult(res, id, taskFromOpenSubGoal(out))
    }
    rpcError(res, id, A2A_ERROR.methodNotFound, `Unknown method '${rpc.method}'`)
  })
  // A published Agent's A2A endpoint: `message/send` is REFUSED with a
  // spec-conformant `rejected` Task (D18 — a card advertises a definition; the
  // endpoint never leases its owner's capability; fork-and-bind instead).
  r.post('/a2a/agents/:id', async (ctx) => {
    const { req, res, params, url } = ctx
    const rpc = await readRpc(ctx)
    if (!rpc) return
    const id = rpc.id ?? null
    if (!store.agentDirectory(store.identity(req.headers).tenant.id).some((e) => e.id === params.id)) {
      return sendError(res, 'not_found', `No agent '${params.id}'`)
    }
    if (rpc.method === 'message/send') return rpcResult(res, id, rejectedAgentTask(params.id, url.origin))
    if (rpc.method === 'tasks/get') {
      return rpcError(res, id, A2A_ERROR.taskNotFound, 'This endpoint holds no tasks — it never accepts one (a capability never travels)')
    }
    rpcError(res, id, A2A_ERROR.methodNotFound, `Unknown method '${rpc.method}'`)
  })
  // The outbound half (the federation seed): fetch a REMOTE instance's Agent Card
  // and mint a private, unbound definition-stub Agent from it (D20 — the
  // cross-instance sibling of /agents/:id/fork; `importedFrom` lineage). The fetch
  // is bounded (http/https only, 5s timeout, size cap) — an SSRF-shaped primitive,
  // recorded in the design log; a production deployment adds an egress allowlist.
  // Read at most `cap` bytes of a fetched body; undefined = over cap. Reading the
  // stream chunk-by-chunk — instead of text()-then-measure — keeps a hostile or
  // hijacked card host from ballooning server memory with an unbounded chunked body.
  const MAX_CARD_BYTES = 256 * 1024
  const readCapped = async (bodyStream: ReadableStream<Uint8Array> | null, cap: number): Promise<string | undefined> => {
    if (!bodyStream) return ''
    const reader = bodyStream.getReader()
    const chunks: Uint8Array[] = []
    let size = 0
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.length
      if (size > cap) {
        await reader.cancel()
        return undefined
      }
      chunks.push(value)
    }
    return Buffer.concat(chunks).toString('utf8')
  }
  r.post('/agents/import-card', async ({ req, res, body }) => {
    const { url: cardUrl } = await body<ImportAgentCardRequest>()
    if (typeof cardUrl !== 'string' || !/^https?:\/\//i.test(cardUrl)) {
      return sendError(res, 'bad_request', 'url must be an http(s) Agent Card URL')
    }
    let card: unknown
    try {
      // `redirect: 'error'`: a redirect could hop the vetted URL to another
      // host/port — refuse it rather than widen the recorded SSRF-shaped surface.
      const resp = await fetch(cardUrl, { signal: AbortSignal.timeout(5_000), redirect: 'error' })
      if (!resp.ok) return sendError(res, 'bad_request', `Card fetch failed: HTTP ${resp.status} from ${cardUrl}`)
      const text = await readCapped(resp.body, MAX_CARD_BYTES)
      if (text === undefined) return sendError(res, 'bad_request', 'Agent Card too large')
      card = JSON.parse(text)
    } catch {
      return sendError(res, 'bad_request', `Could not fetch an Agent Card from ${cardUrl}`)
    }
    const name = (card as { name?: unknown } | null)?.name
    if (typeof name !== 'string' || !name.trim()) {
      return sendError(res, 'bad_request', 'Not an Agent Card: a string `name` is required')
    }
    const shaped = card as { name: string; description?: string; skills?: { id?: string; name?: string }[] }
    sendJson(res, store.importAgentFromCard(shaped, cardUrl, store.identity(req.headers).tenant.id))
  })

  // A Contributor fires an externally-effectful action on a shared Project (D11/D12, OQ3+OQ4):
  // the Commission's connector/MCP reach is the wall (D12), and a non-monotonic effect is
  // serialized on its sub-goal reservation at the Guardian (D11) — the slice-4 "forward" effect
  // now on a real path. Order: 400 fields → 404 project → 403 actor (caller-identity + shared-gate)
  // → 403 reach → 403 role → run (409 on a concurrent different principal). A charge has no
  // data-reach target, so it skips the reach check.
  r.post('/projects/:id/effects', async ({ req, res, params, body }) => {
    const { commissionId, subGoal, type, target } = await body<ProjectEffectRequest>()
    if (!commissionId || !subGoal || typeof target !== 'string' || !PROJECT_EFFECT_TYPES.includes(type)) {
      return sendError(res, 'bad_request', 'commissionId, subGoal, target, and a valid type are required')
    }
    // Resolve across both homes — a shared CREATED Project (P8) is guardable/cooperable now, so
    // its effects must be reachable here (was seed-only `listProjects()`, which 404'd them).
    if (!store.findProject(params.id)) {
      return sendError(res, 'not_found', `No project '${params.id}'`)
    }
    // Project-binding + caller-identity + shared-gate (P8 Phase 2b): the commission must be a
    // Contributor on THIS project, whose agent you own, and (cross-tenant) only while it is shared.
    if (commissionActorDenied(req, res, commissionId, params.id)) return
    // Owner-pays attribution (D13): a commissioned effect's audit lands in the AGENT owner's
    // trail (commissionOwnerTenant), not the caller/backend tenant — so on a shared Project a
    // cross-tenant Contributor's effects are accountable to the tenant that owns the agent.
    const auditTenant = store.commissionOwnerTenant(commissionId)
    const reaches = type.startsWith('connector.') || type.startsWith('mcp.')
    if (reaches && !store.commissionCanReach(commissionId, 'connectors', target)) {
      // Detective audit (D15/OQ7): the D12 connector wall refused this Project effect.
      store.recordAudit({ channel: 'project-effect', commissionId, capability: type, target, outcome: 'denied', tenantId: auditTenant })
      return sendError(res, 'forbidden', `Commission '${commissionId}' may not reach '${target}' on this Project`)
    }
    // D14 role permission: a non-monotonic Project effect requires the role to permit 'fire'.
    if (!isProjectEffectMonotonic(type) && !store.commissionRolePermits(commissionId, 'fire')) {
      store.recordAudit({ channel: 'project-effect', commissionId, capability: type, target, outcome: 'denied', tenantId: auditTenant })
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
  //
  // RESUMABLE (multi-account design §5.3, invariant I3): every event is stamped
  // with its global seq as the SSE `id:` field; a reconnecting EventSource
  // presents `Last-Event-ID` and the gap is REPLAYED from the ring buffer —
  // `hello.resumed: true`, no client cache reset. If the gap aged out (or the
  // epoch changed), `hello.resumed: false` tells a returning client to drop its
  // cache and refetch. Either way: no silent loss. Duplicates are harmless — the
  // events are idempotent invalidation hints.
  r.get('/events', ({ req, res, url }) => {
    const channel = openSse(res)
    // Tenant-filter the fan-out (F2/PD9): a subscriber only receives events for its own
    // tenant, so another tenant's session pushes don't leak down this channel. The
    // subscriber's tenant is resolved once, at subscribe time, from the request identity.
    //
    // The session COOKIE is the production identity for this stream (P6 —
    // `EventSource` can't set headers, but it carries cookies; identity.ts reads
    // the cookie first from the plain req.headers below). The `?user=&tenant=`
    // query params are the LEGACY dev stand-in, honoured only while the header
    // seam is (IDENTITY_HEADERS!=deny), same trust class; query wins over
    // headers when allowed, the cookie beats both.
    const idHeaders: Record<string, string | string[] | undefined> = { ...req.headers }
    if (identityHeadersAllowed()) {
      const qUser = url.searchParams.get('user')
      const qTenant = url.searchParams.get('tenant')
      if (qUser) idHeaders['x-user-id'] = qUser
      if (qTenant) idHeaders['x-tenant-id'] = qTenant
    }
    const identity = store.identity(idHeaders)
    const tenantId = identity.tenant.id
    // INVARIANT: no `await` may sit between the `since()` snapshot below and the
    // `store.subscribe` that follows — the whole subscribe path runs in one
    // synchronous slice, which is exactly what makes it gap-free (an event can't
    // land between "replayed tail" and "live fan-out"). An await here would
    // silently reintroduce the loss window this route exists to close.
    const lastId = Number(headerValue(req.headers, 'last-event-id'))
    const tail = Number.isFinite(lastId) && lastId >= 0 ? eventlog.since(lastId) : undefined
    const resumed = tail?.complete ?? false
    // The hello carries the stream's resolved identity — the SSE face of the
    // `x-resolved-tenant` echo (a browser can't read SSE response headers, so
    // the tripwire rides in-band here).
    channel.send({
      type: 'hello',
      epoch: store.epoch,
      seq: eventlog.seq(),
      resumed,
      identity: { userId: identity.user.id, tenantId },
    })
    // Replay is visibility-filtered with the SAME gate as the live fan-out, so a
    // reconnect can never widen what a tenant observes.
    if (resumed && tail) {
      for (const f of tail.events) {
        if (store.eventVisibleToTenant(f.event, tenantId)) channel.send(f.event, f.seq)
      }
    }
    const unsubscribe = store.subscribe((e, seq) => {
      if (store.eventVisibleToTenant(e, tenantId)) channel.send(e, seq)
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
    const session = store.getSession(id)
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
    // A scheduled run *is* a session — a persisted row minted through the same
    // funnel as a human one (`srun-*` ids resolve here like any other).
    const session = store.getSession(params.id)
    if (!session) return sendError(res, 'not_found', `No session '${params.id}'`)
    // Project the live turn (if any) onto the read — transient registry state,
    // never persisted (contract/turns.ts): a client arriving mid-generation sees
    // `activeTurnId` and reattaches instead of finding a silently stuck thread.
    const live = turns.bySession(params.id)
    sendJson(res, live ? { ...session, activeTurnId: live.id } : session)
  })
  // Materialize a new persisted session — a draft becomes real on its first send
  // (the client posts here, adopts the returned id, then streams the turn to it).
  // A session's `providerId` (the composer's model pick) must name a provider the
  // caller can see (own + shared seeds, F2/PD9) — same wall as an Agent's binding
  // (`badAgentRef`), so a session can't be routed through another tenant's provider.
  const badSessionProvider = (providerId: string | undefined, tenantId: string): string | null =>
    providerId && !store.listProviders(tenantId).some((p) => p.id === providerId)
      ? `No provider '${providerId}'`
      : null
  r.post('/sessions', idempotent(async ({ req, res, body }) => {
    const { firstMessage, providerId } = await body<import('../../contract/index.ts').CreateSessionRequest>()
    // Stamp the creating tenant so the scoped list/read above see it (F2/PD9).
    const tenantId = store.identity(req.headers).tenant.id
    const bad = badSessionProvider(providerId, tenantId)
    if (bad) return sendError(res, 'not_found', bad)
    sendJson(res, store.createSession(firstMessage, tenantId, providerId))
  }))
  // Edit a session's row fields (rename / pin / archive / model pick) from the
  // sidebar menu and the composer's model selector.
  r.patch('/sessions/:id', async ({ req, res, params, body }) => {
    if (denyForeignSession(req, res, params.id)) return
    const patch = await body<{ title?: string; status?: 'active' | 'archived'; pinned?: boolean; providerId?: string }>()
    // Empty string clears back to the Agent's provider — always a valid reference.
    const callerTenant = store.identity(req.headers).tenant.id
    const bad = badSessionProvider(patch?.providerId || undefined, callerTenant)
    if (bad) return sendError(res, 'not_found', bad)
    // A model pick is a ROUTING control, not display chrome — so unlike rename/pin
    // it must also be valid for the session's OWNER: the flagship seeds are visible
    // to two faces of one seat (the default principal and Ada/Acme), and without
    // this wall one face could point the shared session at its private relay,
    // silently egressing the other face's turns to a drain loop it never chose.
    // Decision: visibility stays the demo affordance; routing follows ownership.
    if (patch?.providerId) {
      const owner = store.getSession(params.id)?.tenantId ?? store.identity().tenant.id
      if (owner !== callerTenant && badSessionProvider(patch.providerId, owner)) {
        return sendError(res, 'not_found', `No provider '${patch.providerId}'`)
      }
    }
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

    // Idempotent send (design §5.4, invariant I4): a RETRY of the same logical
    // send — same session + `Idempotency-Key` — must never double-append the user
    // turn or start a second generation. Checked BEFORE the spend gate below:
    // recognizing a retry consumes no new tokens, so it must not be 429able.
    // Retransmission is attach/replay:
    //   • the turn is still live → this response becomes another VIEW of it,
    //     replaying from the top then following the live tail;
    //   • the turn finished and persisted → replay the terminal `message.end`
    //     with the recorded message (the record is the authority);
    //   • the turn finished WITHOUT persisting (error/ephemeral) → fall through
    //     and genuinely retry.
    const idemKey = headerValue(req.headers, 'idempotency-key')
    if (idemKey) {
      const liveTurn = turns.byIdempotencyKey(params.id, idemKey)
      if (liveTurn) {
        const channel = openSse(res)
        const sendFrame = (frame: TurnFrame) => {
          channel.send(frame.event.type === 'message.delta' ? { ...frame.event, seq: frame.seq } : frame.event)
        }
        const att = turns.attach(liveTurn.id, 0, (frame) => {
          if (frame) sendFrame(frame)
          else channel.close()
        })
        if (att) {
          for (const frame of att.replay) sendFrame(frame)
          req.on('close', () => {
            att.unsubscribe()
            channel.close()
          })
          return
        }
        channel.close() // finished between lookup and attach — the client refetches
        return
      }
      const doneMessageId = turns.completedByKey(params.id, idemKey)
      if (doneMessageId) {
        const recorded = (store.getSession(params.id)?.messages ?? []).find((m) => m.id === doneMessageId)
        if (recorded) {
          const channel = openSse(res)
          channel.send({ type: 'message.end', sessionId: params.id, message: recorded })
          channel.close()
          return
        }
      }
    }

    // An unknown id (a client-only draft that skipped materialization) gets a
    // generic shell and an ephemeral turn; every real session — run sessions
    // included, they're rows through the same mint funnel — persists below.
    const known = store.getSession(params.id)
    const session = known
      ? { id: known.id, title: known.title }
      : { id: params.id, title: 'New session' }
    // The worker Agent driving this Conversation (docs/agent-commons.md, D6) —
    // resolves to the seeded default until users create their own.
    const agent = store.getAgent(known?.agentId)
    // The endpoint + model this turn runs on: the session's own model pick (the
    // composer's selector — `session.providerId`) when set, else the Agent's Model
    // provider (D9). Resolved to server-only *data* (base URL, credential reference,
    // model id, probed capabilities), never provider-specific code. The default
    // provider's config is empty, so generation uses its env-configured defaults.
    // Resolved explicitly to the seeded default when both are unset, so the per-turn
    // provenance stamp below always names a real provider (never "implicit").
    const turnProviderId = known?.providerId ?? agent.providerId ?? DEFAULT_PROVIDER_ID
    const provider = store.providerConfig(turnProviderId)
    // The relay pre-turn gate (docs/delegated-cognition-provider.md §7.2): a turn on a
    // Session provider refuses BEFORE the user turn persists — the spend gate's shape —
    // when no drain loop is bound (offline) or another turn already holds the relay's
    // one-entry slot (busy). Nothing half-writes; retry is free; a dead relay never
    // wedges a turn to the deadline.
    if (provider.kind === 'session') {
      const relayId = turnProviderId
      if (!relayId || !store.relay.online(relayId)) {
        return sendError(res, 'relay_offline', 'Your session isn’t answering — start its drain loop and retry.')
      }
      if (store.relay.busy(relayId)) {
        return sendError(res, 'relay_busy', 'Your session is still answering another turn — retry when it finishes.')
      }
    }
    // Spend-time enforcement (D8): once a plan window is exhausted for this Agent's
    // effective budget, refuse the turn (429) until it resets — the per-turn gate the
    // mint-time funnel doesn't give. Checked before persisting the user turn or streaming.
    const over = store.overSpendLimit(agent.budget, tenantId)
    if (over) {
      return sendError(res, 'limit_exceeded', `Plan limit reached for '${over.label}' — this turn is refused until the window resets.`)
    }
    // `ephemeral` generates the full model + tool round-trip but persists
    // nothing. Persist otherwise — the conversation
    // is server-owned, so a sent turn survives a reload even if generation fails.
    const persist = !!known && !ephemeral

    // The turn is a server-owned resource (contract/turns.ts, design I1): registered
    // before anything is persisted, torn down in `finally`. One live turn per session
    // — a concurrent second send is refused, not silently interleaved.
    const ac = new AbortController()
    const active = turns.start(params.id, () => ac.abort(), idemKey)
    if (!active) {
      return sendError(res, 'conflict', 'A turn is already generating for this session — cancel it or wait for it to finish.')
    }

    // Persist the user's turn up front. (Drafts are materialized via POST
    // /sessions before they're sent to; run / unknown ids stay ephemeral —
    // appendMessage no-ops for them.) Anything that throws between the turn
    // registration above and the main try/finally below must release the registry
    // entry on its way out — a leaked entry would refuse this session's sends
    // (409) forever, since only `finish` clears the one-live-turn slot.
    const channel = (() => {
      try {
        if (persist) {
          store.appendMessage(params.id, {
            id: store.mintMessageId('user'),
            role: 'user',
            content: text ?? '',
          })
        }
        return openSse(res)
      } catch (err) {
        turns.finish(active.id)
        throw err
      }
    })()
    // Detach, don't abort (I1): a closed connection stops this *view* only — the
    // turn runs on under generateReply's own wall-clock timeout, and its completion
    // persists + broadcasts `session.updated` to the tenant's subscribers whether or
    // not anyone is watching. `ac` is tripped only by the explicit cancel route (or
    // never — the timeout uses its own signal), so `aborted` means "deliberately
    // cancelled", not "the viewer went away". (`channel.send` no-ops once closed.)

    let messageId = ''
    // Streamed text accumulated route-side, so an explicitly *cancelled* turn can
    // persist the partial it already produced (design §7).
    let streamedText = ''
    // Tee every reply-stream frame into the registry (the reattach/replay buffer),
    // stamping the frame seq onto deltas so a reattached viewer dedupes overlap (I4).
    const emit = (e: ReplyStreamEvent) => {
      const seq = turns.append(active.id, e)
      channel.send(e.type === 'message.delta' && seq !== undefined ? { ...e, seq } : e)
    }
    // The turn's outcome, recorded exactly once in `finally` (F6 PD31) so a mid-stream send
    // failure after a successful generation can't double-count. `error` until we know better.
    let turnOutcome: GenerationOutcome = 'error'
    // The streamed-reply seam both transports share (contract: ReplyHandlers in,
    // ReplyResult out) — the route around the dispatch below is transport-blind.
    const replyHandlers = {
      onStart: (id: string) => {
        messageId = id
        emit({ type: 'message.start', sessionId: session.id, turnId: active.id, message: { id, role: 'assistant', content: '' } })
      },
      onDelta: (delta: string) => {
        streamedText += delta
        emit({ type: 'message.delta', sessionId: session.id, messageId, text: delta })
      },
    }
    try {
      // The transport dispatch (docs/delegated-cognition-provider.md §6.5): dial-out
      // Messages (`generateReply`, N providers, zero provider code) vs the rendezvous
      // relay (`relayReply` — the user's own session answers; prose-only, its own
      // deadline, never `MODEL_TIMEOUT_MS`). One `if` where a loopback shim isn't.
      const { message, usage, outcome } =
        provider.kind === 'session'
          ? await relayReply(session, agent, text ?? '', replyHandlers, ac.signal, store.relay, turnProviderId!)
          : await generateReply(
              session,
              agent,
              text ?? '',
              replyHandlers,
              ac.signal,
              provider,
              // The live Agent Commons registries, so a confirmed "commission the agent I
              // just made" / "create an agent on <provider>" resolves the names the model
              // proposes against what currently exists (server/model/tools.ts). Tenant-scoped
              // (F2/PD9): the model only resolves against the caller's own + the shared seeds.
              (() => {
                return {
                  // isDefault rides along so create_agent can pre-select the caller's
                  // default-else-first binding when the model names none — the same
                  // shortcut the New-agent dialog applies (contract `defaultEntry`).
                  providers: store.listProviders(tenantId).map((p) => ({ id: p.id, label: p.label, isDefault: p.isDefault })),
                  systemPrompts: store.listSystemPrompts(tenantId).map((p) => ({ id: p.id, label: p.label, isDefault: p.isDefault })),
                  agents: store.listAgents(tenantId).map((a) => ({ id: a.id, label: a.label })),
                  commissions: store.listCommissions(undefined, tenantId).map((c) => ({ id: c.id, agentId: c.agentId, projectId: c.projectId })),
                }
              })(),
              // P6: the session's attached connector/MCP contexts become callable tools for
              // this turn (server/model/connectorTools.ts derives them; non-connector
              // contexts are ignored). Only what's attached is reachable.
              store.sessionContexts(params.id),
            )
      // Meter the real tokens this turn consumed (even ephemeral turns —
      // they hit the model too), so the composer's plan-usage rings reflect use.
      store.recordUsage(usage.inputTokens, usage.outputTokens, tenantId)
      // The model reported `ok` or `fallback` (endpoint degraded); recorded once in `finally`.
      turnOutcome = outcome
      if (message.relationActions?.length) {
        emit({
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
        emit({
          type: 'message.escalation',
          sessionId: session.id,
          messageId: message.id,
          escalation: message.escalation,
        })
      }
      // P6: connector/MCP tools the model called this turn + their (mock) results —
      // shown as activity under the message (a read needs no consent).
      if (message.toolActivities?.length) {
        emit({
          type: 'message.toolActivity',
          sessionId: session.id,
          messageId: message.id,
          toolActivities: message.toolActivities,
        })
      }
      // The model's reply text is canned (the mock model server) but its
      // *persistence* is real: record the assistant turn so the thread is the
      // system of record, then close the stream. An ephemeral turn skips this.
      // D16 per-turn provenance: stamp the turn with the Agent that drove it AND the
      // provider that supplied the cognition (as resolved — session pick or agent's), so
      // authorship, metering attribution, and the relayed-reply badge survive a
      // mid-thread hand-off or model switch — the binding is current-driver.
      const stamped = { ...message, agentId: agent.id, providerId: turnProviderId }
      if (persist) {
        store.appendMessage(params.id, stamped)
        turns.markPersisted(active.id, stamped.id) // gate for post-finish retry replay (§5.4)
      }
      emit({ type: 'message.end', sessionId: session.id, message: stamped })
    } catch {
      // `aborted` = the explicit cancel route tripped `ac` (a viewer disconnect no
      // longer aborts — design §5.2); anything else is a genuine turn error.
      turnOutcome = ac.signal.aborted ? 'aborted' : 'error'
      // A cancel keeps what the turn already produced (design §7): persist the
      // partial as the assistant turn and close the stream with it as authoritative.
      if (ac.signal.aborted && messageId) {
        const partial: Message = { id: messageId, role: 'assistant', content: streamedText, agentId: agent.id, providerId: turnProviderId }
        if (persist) {
          store.appendMessage(params.id, partial)
          turns.markPersisted(active.id, partial.id) // a cancelled partial is still the record
        }
        emit({ type: 'message.end', sessionId: session.id, message: partial })
      }
    } finally {
      // Record the outcome exactly once (F6 PD31), so a degraded/dropped turn is visible in
      // /metrics and a post-generation send failure can't double-count against a good turn.
      store.recordGenerationOutcome(turnOutcome)
      // The turn is over (persisted / cancelled / errored): notify any reattached
      // viewers and drop the registry entry — the persisted message is now the
      // authority, and a late reattach 404s into a session refetch.
      turns.finish(active.id)
      channel.close()
    }
  })

  // Cancel a live turn — the *deliberate* stop (design §5.2). Distinct from a viewer
  // disconnect, which merely detaches the view; only this route (bar the model
  // timeout) trips the turn's AbortController, so the `aborted` outcome metric now
  // means "a user chose to stop". The partial persists (see the send route's catch).
  r.post('/sessions/:id/turns/:turnId/cancel', ({ req, res, params }) => {
    if (denyForeignSession(req, res, params.id)) return
    const turn = turns.get(params.turnId)
    if (!turn || turn.sessionId !== params.id) {
      return sendError(res, 'not_found', `No live turn '${params.turnId}' on session '${params.id}'`)
    }
    turns.cancel(params.turnId)
    sendJson(res, { ok: true })
  })

  // Reattach to a live turn (design §5.2, invariants I1/I3/I4): replay the buffered
  // frames after `?after=<seq>`, then continue with the live tail, ending with the
  // same `message.end` the original stream carries. 404 once the turn is gone —
  // the persisted message is the authority and the client refetches the session.
  r.get('/sessions/:id/turns/:turnId/stream', ({ req, res, params, url }) => {
    if (denyForeignSession(req, res, params.id)) return
    const turn = turns.get(params.turnId)
    if (!turn || turn.sessionId !== params.id) {
      return sendError(res, 'not_found', `No live turn '${params.turnId}' on session '${params.id}'`)
    }
    const after = Math.max(0, Number(url.searchParams.get('after')) || 0)
    const channel = openSse(res)
    // Deltas are re-stamped with their frame seq on the way out, so replayed and
    // live frames carry the same dedupe key the original stream used.
    const sendFrame = (frame: TurnFrame) => {
      channel.send(frame.event.type === 'message.delta' ? { ...frame.event, seq: frame.seq } : frame.event)
    }
    const att = turns.attach(params.turnId, after, (frame) => {
      if (frame) sendFrame(frame)
      else channel.close() // the turn finished — `message.end` was the last frame
    })
    if (!att) return channel.close() // finished between the check and the attach
    for (const frame of att.replay) sendFrame(frame)
    req.on('close', () => {
      att.unsubscribe()
      channel.close()
    })
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
  r.get('/dispatch', ({ req, res, url }) => {
    sendList(res, url, store.listDispatch(store.identity(req.headers).tenant.id), (d) => d.id)
  })
  // Kick off a one-off dispatch (lands 'running', finishes 'done' a beat later). Refuses a
  // 429 when the in-flight cap (DISPATCH_MAX_CONCURRENT, P7) is reached, so the caller backs off.
  r.post('/dispatch', idempotent(async ({ req, res, body }) => {
    const { title, detail } = await body<CreateDispatchRequest>()
    if (!title || !title.trim()) return sendError(res, 'bad_request', 'title is required')
    try {
      sendJson(res, store.addDispatch(title.trim(), detail, store.identity(req.headers).tenant.id))
    } catch (err) {
      if (err instanceof LimitError) return sendError(res, err.code, err.message)
      throw err
    }
  }))

  // ── Contexts (set-up) + connector detail ──────────────────────────────────
  r.get('/saved-contexts', ({ res }) => {
    sendJson(res, store.savedContexts())
  })
  // Save a context to the set-up registry (the Contexts page's Add — server-owned,
  // so it survives navigation/reload and reaches every client). Idempotent by id.
  r.post('/saved-contexts', async ({ res, body }) => {
    const { context } = await body<{ context?: import('../../contract/index.ts').SavedContext }>()
    if (!context?.id || !context.label || !context.kind) {
      return sendError(res, 'bad_request', 'context with id, label and kind is required')
    }
    sendJson(res, store.addSavedContext(context))
  })
  // Remove a context from the set-up registry.
  r.delete('/saved-contexts/:id', ({ res, params }) => {
    if (!store.removeSavedContext(params.id)) {
      return sendError(res, 'not_found', `No saved context '${params.id}'`)
    }
    sendJson(res, { ok: true })
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
  // All tenant-scoped (F2/PD9): the six demo accounts each seed their own themed
  // slice (docs/demo-accounts.md), so every list answers as the caller's tenant.
  r.get('/projects', ({ req, res }) => {
    sendJson(res, store.listProjects(store.identity(req.headers).tenant.id))
  })
  r.get('/artifacts', ({ req, res, url }) => {
    sendList(res, url, store.listArtifacts(store.identity(req.headers).tenant.id), (a) => a.id)
  })
  r.get('/schedules', ({ req, res }) => {
    sendJson(res, store.listSchedules(store.identity(req.headers).tenant.id))
  })
  /** The by-id schedule wall (mirrors denyForeignSession): a foreign tenant's
   *  routine reads/mutates as 404 — indistinguishable from absent. */
  const foreignSchedule = (req: IncomingMessage, id: string): boolean => {
    const task = store.listSchedules().find((t) => t.id === id)
    return !!task && !store.scheduleVisibleToTenant(task, store.identity(req.headers).tenant.id)
  }
  // Run a routine now (server appends + broadcasts the run).
  r.post('/schedules/:id/run', ({ req, res, params }) => {
    if (foreignSchedule(req, params.id)) return sendError(res, 'not_found', `No schedule '${params.id}'`)
    const run = store.runSchedule(params.id)
    if (!run) return sendError(res, 'not_found', `No schedule '${params.id}'`)
    sendJson(res, run)
  })
  // Patch a routine's own fields — enabled, name, prompt, cadence, model, … (the
  // entity edits behind the detail page). Cross-entity bindings (deliver to an
  // artifact/session, add a tool) go through POST /relations/ops instead.
  r.patch('/schedules/:id', async ({ req, res, params, body }) => {
    if (foreignSchedule(req, params.id)) return sendError(res, 'not_found', `No schedule '${params.id}'`)
    const patch = await body<UpdateScheduleRequest>()
    const task = store.updateSchedule(params.id, patch)
    if (!task) return sendError(res, 'not_found', `No schedule '${params.id}'`)
    sendJson(res, task)
  })
  // Add a routine from a template's seed (lands paused, stamped with the caller's tenant).
  r.post('/schedules', idempotent(async ({ req, res, body }) => {
    const { seed } = await body<{ seed?: Omit<import('../../contract/index.ts').ScheduledTask, 'id'> }>()
    if (!seed) return sendError(res, 'bad_request', 'seed is required')
    sendJson(res, store.addSchedule({ ...seed, tenantId: store.identity(req.headers).tenant.id }))
  }))
  // Remove a routine.
  r.delete('/schedules/:id', ({ req, res, params }) => {
    if (foreignSchedule(req, params.id)) return sendError(res, 'not_found', `No schedule '${params.id}'`)
    store.removeSchedule(params.id)
    sendJson(res, { ok: true })
  })
  // The left rail's recent-runs feed (a single live source, the caller's routines only).
  r.get('/runs/recent', ({ req, res }) => {
    sendJson(res, store.recentRuns(store.identity(req.headers).tenant.id))
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
    // The one op field the SHARED reducer calls a method on (review finding): a
    // non-string readme would TypeError inside applyGraphOp → a 500 where every
    // sibling malformed input answers 400. Guard the shape here.
    if (op.kind === 'set-project-readme' && typeof op.readme !== 'string') {
      return sendError(res, 'bad_request', 'readme (string) is required')
    }
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
      // A create-agent op without concrete bindings (stale pre-strictness proposal, or
      // a binding removed since) — the store's strictness wall, surfaced as a 400.
      if (err instanceof ValidationError) return sendError(res, err.code, err.message)
      throw err
    }
  }))

  return r
}
