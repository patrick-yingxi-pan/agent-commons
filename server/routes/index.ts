/** Route table for the mock backend. Each resource registers its endpoints here;
 *  Phase 1 wires capabilities, the ambient event stream, and sessions. The router
 *  is plain data — adding a resource is adding a `.get(...)` line. */
import type {
  ApplyOpRequest,
  DeleteSavedContextRequest,
  Message,
  ReplyStreamEvent,
  CreateCommissionRequest,
  DeleteCommissionRequest,
  CreateProjectRequest,
  CreateGrantRequest,
  OpenDiscussionRequest,
  OpenProposalRequest,
  PostToDiscussionRequest,
  SocialEntityKind,
  SocialEntityRef,
  SetCommonsLikeRequest,
  SetFollowRequest,
  MarkDiscussionReadRequest,
  SetSocialWatchRequest,
  RecordViewRequest,
  CreateDispatchRequest,
  CreateScheduleRequest,
  DeleteScheduleRequest,
  CreateProviderRequest,
  ModelProvider,
  RelayReplyRequest,
  UpdateProviderConnectionRequest,
  DeleteProviderRequest,
  CreateAgentRequest,
  DeleteAgentRequest,
  UpdateAgentRequest,
  ReserveSubGoalRequest,
  PostOpenSubGoalRequest,
  OpenContributionRequest,
  PostContributionNoteRequest,
  ProposeEnvelopeRequest,
  ApproveEnvelopeRequest,
  ReviewContributionRequest,
  RunEnvelopeEffectRequest,
  CrystallizeRequest,
  CreateDelegationRequest,
  DeleteDelegationRequest,
  PushRecentRequest,
  RegisterRunnerRequest,
  SendMessageRequest,
  ResolveMessageRelationRequest,
  ResolveToolActivityRequest,
  ForkSessionRequest,
  SetRunnerCapabilitiesRequest,
  SetConnectorStatusRequest,
  UpdateArtifactContentRequest,
  UpdateScheduleRequest,
  UpdateSessionRequest,
  DeleteSessionRequest,
  DeleteSystemPromptRequest,
  UpdateSessionPreferencesRequest,
  UpdateSessionContextStateRequest,
  OpsSummary,
  TokenMintRecovery,
  TokenMintRequest,
} from '../../contract/index.ts'
import { CONTEXT_TYPE_IDS, SOCIAL_ENTITY_KINDS, isAnchorLocus, isPanelFocus } from '../../contract/index.ts'
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
import { userPrincipal } from '../identity.ts'
import { accounts } from '../accounts.ts'
import { openSse } from '../http/sse.ts'
import { store, type GenerationOutcome } from '../store/index.ts'
import {
  IDEMPOTENCY_KEY_MAX_LENGTH,
  IdempotencyCache,
  IdempotencyCapacityError,
  IdempotencyConflictError,
  captureResponse,
  idempotencyPrincipalKey,
  idempotencyRequestFingerprint,
  idempotencyRequestScope,
  replayResponse,
} from '../idempotency.ts'
import { pageParams, paginate, MAX_PAGE_LIMIT } from '../pagination.ts'
import { RateLimiter } from '../ratelimit.ts'
import { generateReply, generateCompactionSummaryPart, probeProviderEndpoint, fetchProviderModels, resolvedModelId } from '../generate.ts'
import {
  deriveRelayCreationSecret,
  relayReply,
  mintRelaySecret,
  hashRelaySecret,
  relaySecretHint,
  type RelayOutcome,
} from '../relay.ts'
import { COMPACTION_SYSTEM_PROMPT, CompactionGenerationError, summarizeConversation } from '../compaction.ts'
import { manualScheduleRunId } from '../scheduleRunIdentity.ts'
import { manualDispatchRunId } from '../dispatchIdentity.ts'
import { scheduleCreationId } from '../scheduleCreationIdentity.ts'
import { discussionPostId } from '../discussionPostIdentity.ts'
import { providerCreationId } from '../providerCreationIdentity.ts'
import { orgCreationId } from '../orgCreationIdentity.ts'
import {
  agentCreationId,
  agentForkCreationId,
  agentImportCreationId,
} from '../agentCreationIdentity.ts'
import { agentProposalCreationId } from '../agentProposalCreationIdentity.ts'
import { agentProposalCommentCreationId } from '../agentProposalCommentCreationIdentity.ts'
import { agentProposalVerdictId } from '../agentProposalVerdictIdentity.ts'
import { toolActivityDecisionId } from '../toolActivityDecisionIdentity.ts'
import { relationActionDecisionId } from '../relationActionDecisionIdentity.ts'
import { systemPromptCreationId } from '../systemPromptCreationIdentity.ts'
import { commissionCreationId } from '../commissionCreationIdentity.ts'
import { delegationCreationId } from '../delegationCreationIdentity.ts'
import { delegationRevocationId } from '../delegationRevocationIdentity.ts'
import { contributionCreationId } from '../contributionCreationIdentity.ts'
import { openWorkCreationId } from '../openWorkCreationIdentity.ts'
import { workItemCommentCreationId } from '../workItemCommentCreationIdentity.ts'
import { workItemRetractionId } from '../workItemRetractionIdentity.ts'
import { contributionLandingId } from '../contributionLandingIdentity.ts'
import { contributionEffectExecutionId } from '../contributionEffectExecutionIdentity.ts'
import { contributionCrystallizationId } from '../contributionCrystallizationIdentity.ts'
import { contributionEnvelopeApprovalId } from '../contributionEnvelopeApprovalIdentity.ts'
import { contributionEnvelopeProposalId } from '../contributionEnvelopeProposalIdentity.ts'
import { contributionCommentCreationId } from '../contributionCommentCreationIdentity.ts'
import { contributionReviewId } from '../contributionReviewIdentity.ts'
import { contributionReviewRequirementId } from '../contributionReviewRequirementIdentity.ts'
import { socialProposalCreationId } from '../socialProposalCreationIdentity.ts'
import { sessionCreationId, sessionForkCreationId } from '../sessionCreationIdentity.ts'
import { registerMcp } from '../mcp.ts'
import { apiCatalog, apiDispatch, bindApiSurface } from '../apiSurface.ts'
import { renderConnectorSetup } from '../connectorSetup.ts'
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
import { enforceOrigin } from '../http/origin.ts'
import { TOOL_CATALOG, TOOL_NAMES } from '../model/tools.ts'
import { executeConnectorActivity } from '../connectorRuntime.ts'
import { CONNECTOR_OPTIONS } from '../data/contextOptions.ts'
import { A2A_ERROR, API_BASE_PATH, DEFAULT_PROVIDER_ID, SELF_PROJECT_HOLDER, isMonotonic, isProjectEffectMonotonic, PROJECT_EFFECT_TYPES, PROJECT_ROLES } from '../../contract/index.ts'
import { projectSessionHistory, sessionWithoutHistory } from './sessionHistory.ts'
import { providerConnectionUpdate } from './providerConnection.ts'
import { providerDefinitionUpdate } from './providerDefinition.ts'
import { providerDelete } from './providerDeletion.ts'
import { providerCatalogModels, providerCatalogUpdate } from './providerCatalog.ts'
import { systemPromptCreate, systemPromptDefinitionUpdate } from './systemPromptDefinition.ts'
import { commissionConfigurationUpdate, commissionCreate, commissionDelete } from './commissionConfiguration.ts'
import { revisionedDelete } from './revisionedDeletion.ts'
import { delegationRevocation } from './delegationRevocation.ts'
import { savedContextFrom } from '../contextRegistry.ts'
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
  SessionTransport,
  BearerSession,
  CreateOrgRequest,
  InviteToOrgRequest,
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

/** A social subject from an untrusted body — `undefined` unless it is exactly a
 *  declared kind plus a non-empty id (INV-9's strict core: the server refuses
 *  what isn't a declared shape rather than storing whatever arrived). */
function socialRef(v: unknown): SocialEntityRef | undefined {
  const o = v as { kind?: unknown; id?: unknown } | null | undefined
  if (!o || typeof o.id !== 'string' || !o.id) return undefined
  if (typeof o.kind !== 'string' || !(SOCIAL_ENTITY_KINDS as readonly string[]).includes(o.kind)) return undefined
  return { kind: o.kind as SocialEntityKind, id: o.id }
}

/** The same subject from `?kind=&id=` — the query half, so the six social reads
 *  that take a subject parse it one way. */
function socialRefFromQuery(url: URL): SocialEntityRef | undefined {
  return socialRef({ kind: url.searchParams.get('kind') ?? '', id: url.searchParams.get('id') ?? '' })
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
  /** A compaction and a turn both rewrite one conversation's active context. This
   * process-local gate makes them mutually exclusive before either spends or
   * persists; the store's compare-before-commit remains the durable race wall. */
  const activeCompactions = new Set<string>()

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
  // The real socket applies this before preflight/static routing; keep it in the
  // router as well so every re-entry door and handler-level test traverses the
  // same browser-origin wall. No Origin means a native/machine caller.
  r.use((ctx) => enforceOrigin(ctx.req, ctx.res))
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

  // ── Durable-storage fault wall ────────────────────────────────────────────
  // A failed commit means memory may have advanced past the last durable state.
  // The originating handler throws (Router maps it to storage_unavailable); every
  // later product request is refused until process restart so a recovered disk
  // path cannot make the divergent process start acknowledging work again. Keep
  // only the three operator probes open: liveness, the failing readiness reason,
  // and the persistence-health metric needed to diagnose/restart the sidecar.
  const STORAGE_FAULT_OPEN = new Set(['/healthz', '/readyz', '/metrics'])
  r.use((ctx) => {
    if (store.persistenceHealthy() || STORAGE_FAULT_OPEN.has(ctx.url.pathname)) return true
    sendError(ctx.res, 'storage_unavailable', 'Durable storage is unavailable. Restart the app after checking disk access.')
    return false
  })

  // ── The auth gate as a WALL (multi-account §12, hardened 2026-07) ───────────
  // When the gate applies (`features.authGate`), an ANONYMOUS request — no
  // verified session, no dev-seam header assertion (store.identity already
  // resolved it to the anonymous principal) — reaches only the FRONT DOOR:
  // boot identity (`/capabilities`, `/me`), the auth routes, the ops probes,
  // and the MACHINE edges that carry their own authentication (A2A's peer
  // credential; the relay's rendezvous secret; the connector download, a
  // public artifact like the well-known card). Everything else refuses with a
  // loud 401 — the client-side gate (App.tsx) is chrome; this is the wall.
  // "Meaningful data before sign-in" is the failure this exists to prevent.
  // `/mcp` is open like `/capabilities`: the JSON-RPC handshake (initialize,
  // tools/list) is DISCOVERY; every tools/call re-enters this router and meets
  // the wall on the inner path — an anonymous MCP caller can reach exactly the
  // front door the anonymous browser can (access-parity INV-11). The MCP door's
  // DIRECT-SERVED surfaces (the GET /mcp event stream, resources/subscribe)
  // never re-enter, so server/mcp.ts gates them itself (gateRefusesStream).
  const GATE_OPEN_EXACT = new Set(['/capabilities', '/me', '/healthz', '/readyz', '/metrics', '/connector', '/connector/setup', '/mcp'])
  const GATE_OPEN_PREFIX = ['/auth/', '/a2a/', '/relay/']
  // Owner-admin routes that sit UNDER an open machine-edge prefix but are NOT part
  // of the machine edge, so the coarse prefix must not open them. The D28
  // peer-credential registry (mint / list / revoke — POST·GET·DELETE /a2a/peers)
  // is an INSTANCE-OWNER operation, not a discovery read (the card) or a
  // peer-authenticated act (the JSON-RPC /a2a/agents|projects endpoints, which
  // carry their own bearer): left open, anonymous callers could mint a "verified"
  // peer under any name (defeating the very attribution A2A_REQUIRE_AUTH buys),
  // enumerate the owner's peer roster, or revoke a live peer by id. So it stays
  // behind the wall — a signed-in principal only — even though /a2a/ is open.
  const GATE_CLOSED_PREFIX = ['/a2a/peers']
  const underClosed = (path: string): boolean => GATE_CLOSED_PREFIX.some((p) => path === p || path.startsWith(`${p}/`))
  r.use((ctx) => {
    if (!store.capabilities().features.authGate) return true
    if (store.identity(ctx.req.headers).via !== 'default') return true
    const path = ctx.url.pathname
    const open = (GATE_OPEN_EXACT.has(path) || GATE_OPEN_PREFIX.some((p) => path.startsWith(p))) && !underClosed(path)
    if (open) return true
    sendError(ctx.res, 'unauthorized', 'Sign in to use this backend (AUTH_GATE is on).')
    return false
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
  // Opt-in per route: one (actor, tenant, Idempotency-Key, method + target) owns the
  // logical operation. Concurrent exact bodies wait for one handler; changed
  // concurrent bodies or targets conflict. Completed truth replays BEFORE body
  // parsing so a revisioned controller may rebase its precondition under the
  // same key. The process-local coordinator is bounded by entry count, bytes,
  // and in-flight work. Transparent without the header; never applied to SSE.
  const idem = new IdempotencyCache()
  const idempotent =
    (handler: (ctx: Ctx) => void | Promise<void>) =>
    async (ctx: Ctx): Promise<void> => {
      const key = headerValue(ctx.req.headers, 'idempotency-key')
      if (!key) return handler(ctx)
      if (key.length > IDEMPOTENCY_KEY_MAX_LENGTH) {
        return sendError(ctx.res, 'bad_request', `Idempotency-Key must be at most ${IDEMPOTENCY_KEY_MAX_LENGTH} characters.`)
      }
      const identity = store.identity(ctx.req.headers)
      const cacheKey = idempotencyPrincipalKey(identity.user.id, identity.tenant.id, key)
      const method = ctx.req.method ?? ''
      const target = `${ctx.url.pathname}${ctx.url.search}`
      const scope = idempotencyRequestScope(method, target)
      try {
        const completed = idem.replay(cacheKey, scope)
        if (completed) return replayResponse(ctx.res, completed)
        const parsedBody = await ctx.body<unknown>()
        const bufferedBody = async <T>(): Promise<T> => parsedBody as T
        const fingerprint = idempotencyRequestFingerprint(method, target, parsedBody)
        const result = await idem.execute(cacheKey, scope, fingerprint, async () => {
          const cap = captureResponse(ctx.res)
          await handler({ ...ctx, res: cap.res, body: bufferedBody })
          return cap.record()
        })
        if (result.replayed && result.response) replayResponse(ctx.res, result.response)
      } catch (error) {
        if (error instanceof IdempotencyConflictError) {
          return sendError(ctx.res, 'conflict', error.message)
        }
        if (error instanceof IdempotencyCapacityError) {
          ctx.res.setHeader('Retry-After', '1')
          return sendError(ctx.res, 'limit_exceeded', 'Too many idempotent requests are in flight. Retry shortly.')
        }
        throw error
      }
    }

  // ── Per-tenant rate limiting (design F3) ────────────────────────────────────
  // Opt-in via `RATE_LIMIT_PER_MIN` (read per request, so unset ⇒ disabled and the
  // existing suite is unaffected). Bounds *mutations* per tenant per minute; over the
  // limit replies 429 `limit_exceeded` with `Retry-After`. GETs are never limited.
  const limiter = new RateLimiter(60_000)
  r.use((ctx) => {
    const method = ctx.req.method
    if (method !== 'POST' && method !== 'PATCH' && method !== 'DELETE') return true
    // The MCP endpoint is a TRANSPORT wrapper: its tools/call re-enters this
    // router, where the inner (real) method+path is metered exactly like a UI
    // call. Metering the wrapper too would double-charge an MCP mutation —
    // a capability asymmetry between access methods (INV-11).
    if (ctx.url.pathname === '/mcp') return true
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
  const mintSession = (req: IncomingMessage, res: ServerResponse, userId: string, tenantId: string, join: boolean, transport: SessionTransport = 'cookie') => {
    // `transport: 'bearer'` (access-parity INV-11) delivers the SAME signed
    // token in the body for machine callers (the MCP door, scripts) that will
    // present it as `Authorization: Bearer` — no cookies: the account stack is
    // a browser concept, and a bearer client holds its own credential. The
    // identity in the response is resolved through the same path a bearer
    // request will take, so the answer is the seam's truth, not the pick's.
    // Every bearer mint is REGISTRY-BACKED (`jti` → an ApiToken row): the row
    // is what GET /auth/tokens lists and DELETE /auth/tokens/:id revokes.
    if (transport === 'bearer') {
      const row = accounts.mintApiToken(userId, 'sign-in')
      store.accountsMutated()
      const token = signSession({ userId, tenantId, iat: Date.now(), jti: row.id })
      const identity = store.identity({ ...req.headers, cookie: undefined, authorization: `Bearer ${token}` })
      res.setHeader('x-resolved-tenant', identity.tenant.id)
      const session: BearerSession = { token, identity, tokenId: row.id }
      sendJson(res, session)
      return
    }
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
  /** Validate a request's `transport` pick (INV-9: absent = cookie, a fixed
   *  meaning; an INVALID value is refused, never normalized). Returns null
   *  after refusing. */
  const transportPick = (res: ServerResponse, transport: unknown): SessionTransport | null => {
    if (transport === undefined || transport === 'cookie') return 'cookie'
    if (transport === 'bearer') return 'bearer'
    sendError(res, 'bad_request', "transport must be 'cookie' or 'bearer' (absent = cookie).")
    return null
  }
  r.uiFormPost('/auth/session', 'browser account-stack switching — identity ceremony before workspace capability use', async ({ req, res, body }) => {
    if (!store.capabilities().features.identitySwitch) {
      return sendError(res, 'capability_unavailable', 'Account switching is disabled on this backend.')
    }
    const { userId, tenantId } = await body<{ userId?: string; tenantId?: string }>()
    // ONE mint path (FWD-5 Phase 2 — the workspace collapse): an ACCOUNT-STACK
    // pick (§12) — a `userId` the signed stack cookie remembers, i.e. an account
    // that signed in on this browser switching back WITHOUT re-entering its
    // credential (GitHub-style). It always lands in the account's single
    // namespace, registry-validated; the stack only proves "signed in here".
    // The former WORKSPACE re-mint arm (P7) is gone with workspace multiplicity;
    // a request still naming a tenantId is a caller bug, refused loudly (INV-9 —
    // never silently normalized to the namespace it would have meant).
    if (tenantId !== undefined) {
      return sendError(res, 'bad_request', 'Workspace re-mints are gone (FWD-5): an account has exactly one namespace — omit tenantId.')
    }
    let mint: { userId: string; tenantId: string } | null = null
    if (userId) {
      const stack = verifyStack(parseCookies(headerValue(req.headers, 'cookie'))[STACK_COOKIE])
      const entry = stack.find((e) => e.userId === userId)
      const home = entry && accounts.homeOf(userId)
      if (home) mint = { userId, tenantId: home.tenant.id }
    }
    if (!mint) {
      return sendError(res, 'bad_request', 'Unknown identity — pick an account signed in on this browser.')
    }
    mintSession(req, res, mint.userId, mint.tenantId, false)
  })
  // DELETE signs the ACTIVE account out: the session cookie clears and that
  // account's stack entry is forgotten — the OTHER remembered accounts stay
  // (GitHub's "sign out of one account"; the client then offers the remaining
  // accounts on its picker). `?all=1` forgets every remembered account too.
  r.uiFormDelete('/auth/session', 'browser sign-out and account-stack cookie ceremony', ({ req, res, url }) => {
    const stack = verifyStack(parseCookies(headerValue(req.headers, 'cookie'))[STACK_COOKIE])
    const me = store.identity(req.headers)
    const next = url.searchParams.get('all') ? [] : me.via === 'session' ? stackWithout(stack, me.user.id) : stack
    res.setHeader('Set-Cookie', [sessionClearCookie(), stackSetCookie(next)])
    res.writeHead(204, BASE_HEADERS).end()
  })
  // Forget ONE remembered account by id (the switcher rows' per-account
  // sign-out): its stack entry drops, the others keep their sign-in order.
  // Forgetting the ACTIVE account is a full sign-out (the session clears with
  // it — a remembered-list can't outlive the session that proves it). The
  // stack cookie itself is the authorization (it's this browser's own memory);
  // an id it doesn't hold is a no-op, answered identically (idempotent 204).
  r.uiFormDelete('/auth/accounts/:id', 'browser-local remembered-account ceremony', ({ req, res, params }) => {
    const stack = verifyStack(parseCookies(headerValue(req.headers, 'cookie'))[STACK_COOKIE])
    const me = store.identity(req.headers)
    const cookies = [stackSetCookie(stackWithout(stack, params.id))]
    if (me.via === 'session' && me.user.id === params.id) cookies.unshift(sessionClearCookie())
    res.setHeader('Set-Cookie', cookies)
    res.writeHead(204, BASE_HEADERS).end()
  })
  // The accounts signed in on THIS browser (§12) — the switcher's instant-hop
  // rows, resolved STRICTLY against the registry at read time: a stale entry
  // (deleted user) drops. Each account resolves to its ONE namespace (FWD-5
  // Phase 2); a pre-collapse stack cookie's `tenantId` is ignored, not trusted.
  // Never enumerates anything the stack cookie doesn't already prove was
  // signed in here.
  r.uiFormGet('/auth/accounts', 'browser-local remembered-account projection', ({ req, res }) => {
    const entries = verifyStack(parseCookies(headerValue(req.headers, 'cookie'))[STACK_COOKIE])
    const me = store.identity(req.headers)
    const rows: AuthAccount[] = []
    for (const e of entries) {
      const home = accounts.homeOf(e.userId)
      const resolved = home ? accounts.identityFor(e.userId, home.tenant.id) : null
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
  r.uiRemoteMcpFormPost('/auth/signup', 'credential entry and account creation occur before an authenticated product session', async ({ req, res, body }) => {
    const { name, email, password, transport: transportRaw } = await body<SignUpRequest>()
    const transport = transportPick(res, transportRaw)
    if (!transport) return
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
    mintSession(req, res, created.user.id, created.tenant.id, true, transport)
  })
  // Mint a bearer credential for the CURRENT verified session — the MCP connect
  // panel's one click (INV-11's machine transport for an already-signed-in
  // user; the same signed token a bearer login returns). STRICTLY
  // session-verified: the dev header seam and the default principal never
  // proved a credential, so they must not mint one.
  const verifiedTokenMintIdentity = (req: IncomingMessage, res: ServerResponse) => {
    const me = store.identity(req.headers)
    if (me.via !== 'session') {
      sendError(res, 'unauthorized', 'Sign in first — a token is minted from a verified session.')
      return null
    }
    return me
  }
  const tokenMintKey = (
    req: IncomingMessage,
    res: ServerResponse,
    required: boolean,
  ): string | null | undefined => {
    const key = headerValue(req.headers, 'idempotency-key')
    if (!key) {
      if (required) sendError(res, 'bad_request', 'Idempotency-Key is required for token mint recovery or cancellation.')
      return required ? null : undefined
    }
    if (key.length > IDEMPOTENCY_KEY_MAX_LENGTH) {
      sendError(res, 'bad_request', `Idempotency-Key must be at most ${IDEMPOTENCY_KEY_MAX_LENGTH} characters.`)
      return null
    }
    return key
  }
  const tokenMintSession = (
    me: ReturnType<typeof store.identity>,
    row: import('../../contract/index.ts').ApiToken,
  ): BearerSession => ({
    token: signSession({ userId: me.user.id, tenantId: me.tenant.id, iat: row.createdAt, jti: row.id }),
    identity: me,
    tokenId: row.id,
  })

  r.uiRemoteMcpFormPost('/auth/token', 'one-time bearer credential minting is authentication ceremony, not a workspace capability', async ({ req, res, body }) => {
    const me = verifiedTokenMintIdentity(req, res)
    if (!me) return
    const key = tokenMintKey(req, res, false)
    if (key === null) return
    const { label } = (await body<TokenMintRequest>()) ?? {}
    if (label !== undefined && (typeof label !== 'string' || label.length > 80)) {
      return sendError(res, 'bad_request', 'label must be a string of at most 80 characters')
    }
    const normalizedLabel = label?.trim() || undefined
    if (!key) {
      const row = accounts.mintApiToken(me.user.id, normalizedLabel)
      store.accountsMutated()
      return sendJson(res, tokenMintSession(me, row))
    }
    const result = accounts.mintApiTokenWithReceipt(me.user.id, normalizedLabel, key)
    if (result.kind === 'conflict') {
      return sendError(res, 'conflict', 'This token request key is already bound to a different label.')
    }
    if (result.kind === 'cancelled') {
      if (result.changed) store.accountsMutated()
      return sendError(res, 'conflict', 'This token request was cancelled and cannot create access.')
    }
    if (result.created) store.accountsMutated()
    sendJson(res, tokenMintSession(me, result.row))
  })
  // A lost mint response is recoverable without another creation POST: the
  // receipt yields the same deterministic signature from persisted metadata.
  // DELETE is the honest Dismiss — it writes a tombstone first and revokes any
  // represented row, so even a late POST cannot orphan live access.
  r.uiFormGet('/auth/token', 'one-time bearer credential recovery is authentication ceremony', ({ req, res }) => {
    const me = verifiedTokenMintIdentity(req, res)
    if (!me) return
    const key = tokenMintKey(req, res, true)
    if (!key) return
    const result = accounts.recoverApiTokenMint(me.user.id, key)
    if (result.kind === 'active') {
      const recovery: TokenMintRecovery = { state: 'active', session: tokenMintSession(me, result.row) }
      return sendJson(res, recovery)
    }
    if (result.changed) store.accountsMutated()
    const recovery: TokenMintRecovery = { state: result.kind }
    sendJson(res, recovery)
  })
  r.uiFormDelete('/auth/token', 'one-time bearer credential cancellation is authentication ceremony', ({ req, res }) => {
    const me = verifiedTokenMintIdentity(req, res)
    if (!me) return
    const key = tokenMintKey(req, res, true)
    if (!key) return
    if (accounts.cancelApiTokenMint(me.user.id, key)) store.accountsMutated()
    sendJson(res, { ok: true })
  })
  // The minted-token REGISTRY (metadata only — the token value is shown once,
  // at mint): list your rows, revoke one by id. The registry is the revocation
  // authority (identity.ts refuses a jti whose row is gone), so DELETE here
  // kills the credential immediately. Session-verified like the mint — and the
  // Credential registry administration belongs to the authenticated browser
  // ceremony, not to the workspace capability catalog.
  r.uiFormGet('/auth/tokens', 'bearer credential registry administration is authentication ceremony', ({ req, res }) => {
    const me = store.identity(req.headers)
    if (me.via !== 'session') {
      return sendError(res, 'unauthorized', 'Sign in first — the token registry belongs to a verified session.')
    }
    sendJson(res, accounts.listApiTokens(me.user.id))
  })
  r.uiFormDelete('/auth/tokens/:id', 'bearer credential revocation is authentication ceremony', ({ req, res, params }) => {
    const me = store.identity(req.headers)
    if (me.via !== 'session') {
      return sendError(res, 'unauthorized', 'Sign in first — the token registry belongs to a verified session.')
    }
    // Revocation is a desired-state DELETE: the exact random row id can never
    // be reused, so already-absent means already safe. This makes a lost
    // acknowledgement retry converge after restart and gives unknown/foreign
    // ids the same non-leaking response.
    if (accounts.revokeApiToken(me.user.id, params.id)) store.accountsMutated()
    sendJson(res, { ok: true })
  })
  r.uiRemoteMcpFormPost('/auth/login', 'credential entry occurs before a properly authenticated product session', async ({ req, res, body }) => {
    const { email, password, transport: transportRaw } = await body<LoginRequest>()
    const transport = transportPick(res, transportRaw)
    if (!transport) return
    // The same scrypt-cost bound as signup; no valid account exceeds it, so the
    // refusal is a plain (uniform) 401, not a distinguishable 400.
    const bounded = !!email && !!password && password.length <= 128
    const user = bounded ? accounts.verifyPassword(email, password) : null
    // One code for every failure mode — account existence must not leak.
    if (!user) return sendError(res, 'unauthorized', 'Invalid email or password.')
    const home = accounts.homeOf(user.id)
    if (!home) return sendError(res, 'unauthorized', 'Invalid email or password.')
    mintSession(req, res, user.id, home.tenant.id, true, transport)
  })
  // (The workspace routes — `GET /me/workspaces`, `POST /workspaces` — are gone:
  // FWD-5 Phase 2, the workspace collapse. An account IS its one namespace; the
  // switcher switches ACCOUNTS (the stack above), and grouping is projects.)

  // ── FWD-6 — organizations: namespaces with members, never worlds (§8) ────────
  // Founding is open to any resolved identity; JOINING is a consent act — an
  // email-keyed, existence-hidden invitation the invitee accepts. Nothing here
  // switches anything: an org's one surface is its namespace page. Org machinery
  // is walled out of person namespaces (`isNamespace`) with the same
  // existence-hiding 404 an unknown org gets; a member who isn't an owner gets
  // an honest 403 (they already know the org exists — they're in it).
  const orgWall = (headers: Ctx['req']['headers'], orgId: string): { role?: import('../../contract/index.ts').TenantRole; deny?: true } => {
    const t = accounts.tenants.get(orgId)
    if (!t || t.kind !== 'org' || accounts.isNamespace(orgId)) return { deny: true }
    const me = store.identity(headers)
    return { role: accounts.membership(me.user.id, orgId)?.role }
  }
  r.post('/orgs', idempotent(async ({ req, res, body }) => {
    const me = store.identity(req.headers)
    const idempotencyKey = headerValue(req.headers, 'idempotency-key')
    const logicalOrgId = idempotencyKey
      ? orgCreationId(me.tenant.id, idempotencyKey)
      : undefined
    const represented = logicalOrgId
      ? accounts.getOrgCreation(me.user.id, logicalOrgId)
      : undefined
    // Persisted tenant + founder seat are the recovery receipt. They survive
    // the process-local response cache and return the exact original namespace
    // before changed Retry input can found another one.
    if (typeof represented === 'object') {
      return sendJson(res, { id: represented.id, name: represented.name, kind: represented.kind })
    }
    if (represented === 'invalid') {
      return sendError(res, 'bad_request', 'This organization creation identity is not valid for this account.')
    }
    const { name } = await body<CreateOrgRequest>()
    if (!name?.trim() || name.trim().length > 120) {
      return sendError(res, 'bad_request', 'An organization name (1–120 chars) is required.')
    }
    const tenant = accounts.createOrg(me.user.id, name, { logicalId: logicalOrgId })
    if (!tenant) return sendError(res, 'bad_request', 'No such user.')
    store.accountsMutated()
    sendJson(res, { id: tenant.id, name: tenant.name, kind: tenant.kind }, 201)
  }))
  r.get('/me/orgs', ({ req, res }) => {
    sendJson(res, accounts.orgsOf(store.identity(req.headers).user.id))
  })
  // "Your work" (COMMONS-25) — the caller's coordination dashboard: items THEY
  // posted + proposals THEY authored. No parameters: tenancy IS the filter, so
  // there is nothing here a caller could widen.
  r.get('/me/work', ({ req, res }) => {
    sendJson(res, store.myWork(store.identity(req.headers).tenant.id))
  })
  r.get('/me/invites', ({ req, res }) => {
    sendJson(res, accounts.myInvites(store.identity(req.headers).user.email))
  })
  // The invitee's verdict (O-D3). An invite that isn't pending-and-addressed-to-
  // the-caller does not exist (404 — indistinguishable from a wrong guess).
  const inviteVerdict = (action: 'accept' | 'decline') => ({ req, res, params }: Ctx) => {
    const me = store.identity(req.headers)
    const out = accounts.resolveInvite(params.id, me.user.id, action)
    if (out === undefined) return sendError(res, 'not_found', `No invite '${params.id}'`)
    store.accountsMutated()
    sendJson(res, out === 'declined' ? { declined: true } : out)
  }
  r.post('/me/invites/:id/accept', inviteVerdict('accept'))
  r.post('/me/invites/:id/decline', inviteVerdict('decline'))
  // The roster (O3): any SEAT may read it — the org page's member panel; an
  // outsider gets the existence-hiding 404.
  r.get('/orgs/:id/members', ({ req, res, params }) => {
    const wall = orgWall(req.headers, params.id)
    if (wall.deny || wall.role === undefined) return sendError(res, 'not_found', `No organization '${params.id}'`)
    sendJson(res, accounts.membersOf(params.id))
  })
  r.get('/orgs/:id/invites', ({ req, res, params }) => {
    const wall = orgWall(req.headers, params.id)
    // A non-member never learns the org exists (404); a member who isn't an
    // owner gets the honest 403 — they're already inside the wall.
    if (wall.deny || wall.role === undefined) return sendError(res, 'not_found', `No organization '${params.id}'`)
    if (wall.role !== 'owner') return sendError(res, 'forbidden', 'Only an organization owner may manage invitations.')
    sendJson(res, accounts.invitesOfOrg(params.id))
  })
  r.post('/orgs/:id/invites', async ({ req, res, params, body }) => {
    const wall = orgWall(req.headers, params.id)
    // A non-member never learns the org exists (404); a member who isn't an
    // owner gets the honest 403 — they're already inside the wall.
    if (wall.deny || wall.role === undefined) return sendError(res, 'not_found', `No organization '${params.id}'`)
    if (wall.role !== 'owner') return sendError(res, 'forbidden', 'Only an organization owner may manage invitations.')
    const { email } = await body<InviteToOrgRequest>()
    if (!email || !EMAIL_SHAPE.test(email.trim()) || email.trim().length > 254) {
      return sendError(res, 'bad_request', 'A valid email is required.')
    }
    const me = store.identity(req.headers)
    // Uniform whether or not an account bears the email (existence-hiding) —
    // a duplicate pending invite returns the SAME row, signalling nothing.
    const invite = accounts.createInvite(params.id, email, me.user.name)
    if (!invite) return sendError(res, 'conflict', 'This organization’s pending invitations are at their cap.')
    store.accountsMutated()
    const { orgId: _org, ...row } = invite
    sendJson(res, row, 201)
  })
  r.delete('/orgs/:id/invites/:iid', ({ req, res, params }) => {
    const wall = orgWall(req.headers, params.id)
    // A non-member never learns the org exists (404); a member who isn't an
    // owner gets the honest 403 — they're already inside the wall.
    if (wall.deny || wall.role === undefined) return sendError(res, 'not_found', `No organization '${params.id}'`)
    if (wall.role !== 'owner') return sendError(res, 'forbidden', 'Only an organization owner may manage invitations.')
    const out = accounts.revokeInvite(params.id, params.iid)
    if (out === undefined) return sendError(res, 'not_found', `No invite '${params.iid}'`)
    if (out === 'closed') return sendError(res, 'conflict', 'This invitation was already resolved.')
    store.accountsMutated()
    sendJson(res, out)
  })

  // ── Ops: liveness + readiness (design F6 — the autoscaled web tier) ──────────
  // `/healthz` — the process is up (load-balancer liveness). `/readyz` — the process
  // can serve: a cheap store probe stands in for the DB-connectivity check a real
  // deployment runs; a failure replies 503 so the LB drains this instance.
  r.formGet('/healthz', 'deployment liveness probe — transport operations, not workspace capability', ({ res }) => {
    sendJson(res, { status: 'ok', epoch: store.epoch })
  })
  r.formGet('/readyz', 'deployment readiness probe — transport operations, not workspace capability', ({ res }) => {
    if (!store.persistenceHealthy()) return sendJson(res, { status: 'storage_unavailable' }, 503)
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
  // The ONE ops derivation, shared by `/metrics` (Prometheus text) and the
  // maintainer console's `GET /admin/ops` (JSON) so the two faces cannot drift.
  // Dispatch runs and runners are GAUGES of the live feed, derived at read time,
  // with every series present (0 until seen) so a dashboard charts from the start.
  const opsSnapshot = (): OpsSummary => {
    const runners = store.registry.list()
    const onlineRunners = runners.filter((rn) => rn.status === 'online').length
    const runs = store.listDispatch()
    const byStatus = (s: 'running' | 'done' | 'failed') => runs.filter((run) => run.status === s).length
    return {
      uptimeSeconds: (Date.now() - startedAt) / 1000,
      epoch: store.epoch,
      backend: store.capabilities().backend,
      draining: store.isDraining(),
      runnersByStatus: { online: onlineRunners, offline: runners.length - onlineRunners },
      dispatchByStatus: { running: byStatus('running'), done: byStatus('done'), failed: byStatus('failed') },
      turnsByOutcome: { ...store.generationOutcomes() },
      requestsByMethod: Object.fromEntries(requestsByMethod),
    }
  }
  // `/metrics` — Prometheus text exposition (F6 PD31). Per-method request counts +
  // process uptime + the store epoch (as an info label). A real deployment adds
  // status-class + latency histograms metered at the edge.
  r.formGet('/metrics', 'Prometheus scrape endpoint — deployment transport, not workspace capability', ({ res }) => {
    const ops = opsSnapshot()
    const lines = [
      '# HELP http_requests_total Matched-route requests by method.',
      '# TYPE http_requests_total counter',
      ...Object.entries(ops.requestsByMethod).map(([m, n]) => `http_requests_total{method="${m}"} ${n}`),
      '# HELP runners_total Connected runners by status (F4 broker registry).',
      '# TYPE runners_total gauge',
      ...Object.entries(ops.runnersByStatus).map(([s, n]) => `runners_total{status="${s}"} ${n}`),
      '# HELP model_turns_total Generation turns by outcome (P5 reliability / F6 observability).',
      '# TYPE model_turns_total counter',
      ...Object.entries(ops.turnsByOutcome).map(([outcome, n]) => `model_turns_total{outcome="${outcome}"} ${n}`),
      '# HELP dispatch_runs Dispatch runs by status (P7 automation).',
      '# TYPE dispatch_runs gauge',
      ...Object.entries(ops.dispatchByStatus).map(([s, n]) => `dispatch_runs{status="${s}"} ${n}`),
      '# HELP process_uptime_seconds Seconds since this router started.',
      '# TYPE process_uptime_seconds gauge',
      `process_uptime_seconds ${ops.uptimeSeconds.toFixed(3)}`,
      '# HELP store_epoch_info The store epoch (changes on reseed); always 1.',
      '# TYPE store_epoch_info gauge',
      `store_epoch_info{epoch="${ops.epoch}"} 1`,
      '# HELP persistence_healthy Whether durable storage can still acknowledge mutations.',
      '# TYPE persistence_healthy gauge',
      `persistence_healthy ${store.persistenceHealthy() ? 1 : 0}`,
    ]
    sendText(res, lines.join('\n') + '\n')
  })

  // ── The maintainer console (`/admin/*` — contract/admin.ts) ─────────────────
  // The INTERNAL instance-operator plane: cross-tenant reads plus a deliberately
  // small mutation set, for principals on the `MAINTAINERS` env allowlist
  // (identity.ts stamps `instanceAdmin`). The wall answers 404 — existence-
  // hiding, the same posture as foreign-row reads — and sits BEHIND the auth
  // gate (this prefix is not in GATE_OPEN_*), so anonymous callers still meet
  // the 401 first. These remain product capabilities in every access surface;
  // the shared maintainer wall, not a transport-specific omission, decides who
  // may use them.
  const maintainerDenied = (req: IncomingMessage, res: ServerResponse): boolean => {
    if (store.identity(req.headers).instanceAdmin) return false
    sendError(res, 'not_found', 'Not found')
    return true
  }
  r.get('/admin/users', ({ req, res }) => {
    if (maintainerDenied(req, res)) return
    sendJson(res, accounts.adminListUsers())
  })
  r.get('/admin/tenants', ({ req, res }) => {
    if (maintainerDenied(req, res)) return
    sendJson(res, accounts.adminListTenants())
  })
  r.get('/admin/invites', ({ req, res }) => {
    if (maintainerDenied(req, res)) return
    sendJson(res, accounts.adminListInvites())
  })
  r.get('/admin/tokens', ({ req, res }) => {
    if (maintainerDenied(req, res)) return
    sendJson(res, accounts.adminListTokens())
  })
  // The instance-wide audit read — the ONE unscoped caller of listAuditLog
  // (every tenant-facing read stays scoped); newest-first like the scoped face.
  r.get('/admin/audit', ({ req, res, url }) => {
    if (maintainerDenied(req, res)) return
    sendList(res, url, store.listAuditLog(), (e) => e.id)
  })
  r.get('/admin/ops', ({ req, res }) => {
    if (maintainerDenied(req, res)) return
    sendJson(res, opsSnapshot())
  })
  // Disable an account's sign-in (v1 "delete" — no ownership cascade; the
  // stale-credential fall-through in identity.ts does the lockout). Seeded
  // demo accounts are code-owned and refuse with an honest 409.
  r.post('/admin/users/:id/deactivate', ({ req, res, params }) => {
    if (maintainerDenied(req, res)) return
    const out = accounts.deactivateUser(params.id)
    if (out === undefined) return sendError(res, 'not_found', `No user '${params.id}'`)
    if (out === 'seeded') return sendError(res, 'conflict', 'Seeded demo accounts cannot be deactivated.')
    store.accountsMutated()
    sendJson(res, { ok: true })
  })
  // Revoke ANY user's bearer token (the per-user face is DELETE /auth/tokens/:id).
  r.delete('/admin/tokens/:userId/:id', ({ req, res, params }) => {
    if (maintainerDenied(req, res)) return
    if (!accounts.revokeApiToken(params.userId, params.id)) {
      return sendError(res, 'not_found', `No token '${params.id}' on user '${params.userId}'`)
    }
    store.accountsMutated()
    sendJson(res, { ok: true })
  })
  // Revoke a pending org invite from the instance view (the org face is
  // DELETE /orgs/:id/invites/:iid, owner-only; this one crosses orgs).
  r.delete('/admin/invites/:id', ({ req, res, params }) => {
    if (maintainerDenied(req, res)) return
    const stored = accounts.orgInvites.find((i) => i.id === params.id)
    const out = stored && accounts.revokeInvite(stored.orgId, params.id)
    if (!out) return sendError(res, 'not_found', `No invitation '${params.id}'`)
    if (out === 'closed') return sendError(res, 'conflict', 'This invitation was already resolved.')
    store.accountsMutated()
    sendJson(res, { ok: true })
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
  r.aliasGet('/runners/:id', 'GET /runners', 'the by-id runner read is a focused projection of the runner collection visible in the UI', ({ res, params }) => {
    const runner = store.registry.get(params.id)
    if (!runner) return sendError(res, 'not_found', `No runner '${params.id}'`)
    sendJson(res, runner)
  })
  r.formPost('/runners', 'runner enrollment is a machine callback authenticated by the host enrollment credential', async ({ req, res, body }) => {
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
  r.formPost('/runners/:id/heartbeat', 'runner liveness is a machine callback, not an interactive workspace capability', ({ req, res, params }) => {
    if (!enrollmentAllowed(req)) return sendError(res, 'forbidden', 'runner enrollment requires a valid token')
    const runner = store.registry.heartbeat(params.id)
    if (!runner) return sendError(res, 'not_found', `No runner '${params.id}'`)
    sendJson(res, runner)
  })
  r.formPatch('/runners/:id/capabilities', 'runner capability advertisement is a machine callback', async ({ req, res, params, body }) => {
    if (!enrollmentAllowed(req)) return sendError(res, 'forbidden', 'runner enrollment requires a valid token')
    const { capabilities } = await body<SetRunnerCapabilitiesRequest>()
    if (!Array.isArray(capabilities)) {
      return sendError(res, 'bad_request', 'capabilities is required')
    }
    const runner = store.registry.setCapabilities(params.id, capabilities)
    if (!runner) return sendError(res, 'not_found', `No runner '${params.id}'`)
    sendJson(res, runner)
  })
  r.formDelete('/runners/:id', 'runner deregistration is a machine callback authenticated by the host enrollment credential', ({ req, res, params }) => {
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
  r.formPost('/runners/:id/invoke', 'capability-broker execution edge; excluded until a direct UI control exposes the same scoped act', async ({ req, res, params, body }) => {
    const runner = store.registry.get(params.id)
    if (!runner) return sendError(res, 'not_found', `No runner '${params.id}'`)
    const request = await body<CapabilityRequest>()
    if (!request?.capability || typeof request.target !== 'string') {
      return sendError(res, 'bad_request', 'capability and target are required')
    }
    if (typeof request.sessionId !== 'string' || typeof request.contextId !== 'string') {
      return sendError(res, 'bad_request', 'sessionId and contextId are required (context mediation)')
    }
    // The caller must OWN the named session before we resolve its context bindings
    // and execute a real capability in that context's scope — otherwise a tenant
    // that learns another tenant's (sessionId, contextId) is a confused deputy on
    // that context's host. The commissioned path adds `commissionActorDenied`
    // below; this closes the legacy single-tenant path (same wall every by-id
    // session route runs).
    if (denyForeignSession(req, res, request.sessionId)) return
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
    // authenticated tenant + session; `conflict` (409) when another principal
    // holds the resource — the escrow
    // that refuses a concurrent irreversible writer up front. Held (TTL'd) on success
    // so the session keeps the resource; released if the effect itself fails.
    let reservation
    let acquiredHere = false
    if (!isMonotonic(request.capability)) {
      // Release on failure must free only what *this* invoke acquired — never a hold
      // the session already had (e.g. an explicit reservation kept across a consent gate).
      const reservationOwnerTenant = store.identity(req.headers).tenant.id
      const heldBefore = store.guardian.heldBy(ctx.id, request.sessionId, reservationOwnerTenant)
      try {
        reservation = store.guardian.reserve(ctx.id, request.sessionId, {
          ownerTenant: reservationOwnerTenant,
        })
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
  r.formGet('/runners/:id/effects', 'runner-authoritative machine log authenticated by the enrollment credential', ({ req, res, params, url }) => {
    // The authoritative effect log (every host op's target + output) is runner-
    // identity data, not tenant-scoped — gated by the SAME enrollment token as the
    // lifecycle routes, or any signed-in tenant could read another's host activity.
    if (!enrollmentAllowed(req)) return sendError(res, 'forbidden', 'runner enrollment requires a valid token')
    if (!store.registry.get(params.id)) return sendError(res, 'not_found', `No runner '${params.id}'`)
    const since = Number(url.searchParams.get('since') ?? 0) || 0
    sendJson(res, store.journal.log(params.id, since))
  })

  // A runner replays its outbox — effects it executed out-of-band (via the
  // co-located fast path, or while the server was unreachable). Merged idempotently
  // by commandId, then projected; returns what was newly projected + the cursor.
  r.formPost('/runners/:id/sync', 'runner outbox reconciliation is machine self-service, not an interactive workspace capability', async ({ req, res, params, body }) => {
    // Merging into the runner's AUTHORITATIVE log (the D2/D3 system of record audit
    // and projection trust) is a runner-identity write — the same enrollment gate
    // as heartbeat, or any signed-in tenant could inject fabricated effects.
    if (!enrollmentAllowed(req)) return sendError(res, 'forbidden', 'runner enrollment requires a valid token')
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
  r.aliasGet('/providers/:id', 'GET /providers', 'the by-id provider read is a focused projection of the provider collection visible in the UI', ({ req, res, params }) => {
    // `listProviders(tenant).find`, not `store.getProvider` — the latter falls back to the
    // default for an unknown id (the resolve-for-a-turn contract), which would mask a
    // 404 here. The scoped read also makes another tenant's provider a 404 (no existence leak).
    const provider = store.listProviders(store.identity(req.headers).tenant.id).find((p) => p.id === params.id)
    if (!provider) return sendError(res, 'not_found', `No provider '${params.id}'`)
    sendJson(res, provider)
  })
  r.post('/providers', idempotent(async ({ req, res, body }) => {
    const tenantId = store.identity(req.headers).tenant.id
    const idempotencyKey = headerValue(req.headers, 'idempotency-key')
    const logicalProviderId = idempotencyKey
      ? providerCreationId(tenantId, idempotencyKey)
      : undefined
    const represented = logicalProviderId
      ? store.listProviders(tenantId).find((provider) => provider.id === logicalProviderId)
      : undefined
    if (represented) {
      // A Session provider's one-time bearer can be reconstructed only for the
      // same logical create and only while it still matches durable truth (a
      // later rotation must make the create key powerless).
      if (represented.kind === 'session' && idempotencyKey) {
        const secret = deriveRelayCreationSecret(tenantId, idempotencyKey)
        if (!store.providerAcceptsRelaySecret(represented.id, secret)) {
          return sendError(res, 'conflict', 'This Session provider exists, but its enrollment secret changed. Rotate it from the provider page.')
        }
        return sendJson(res, { ...represented, secret })
      }
      return sendJson(res, represented)
    }
    const input = await body<CreateProviderRequest>()
    if (!input?.label || !input?.modelFamily || !Array.isArray(input.effortLevels)) {
      return sendError(res, 'bad_request', 'label, modelFamily, and effortLevels are required')
    }
    // A Session provider (docs/delegated-cognition-provider.md): nothing to dial, so no
    // endpoint config and no conformance probe — instead the server mints the rendezvous
    // secret here and exposes it only in this creation ceremony (including an exact
    // same-key recovery while its hash still matches). Only its hash survives in the
    // server-only config. The mint stamps the capability EXPLICITLY (never left to the
    // unset default): `toolUse:true` since the v2 framed mailbox — the relay's tool-use
    // capability is the MAILBOX's, code-owned, not probed — plus the caller's tenant
    // (forced scoping; the store's mint wall re-asserts both).
    if (input.kind === 'session') {
      if (input.config) return sendError(res, 'bad_request', 'A Session provider has no endpoint — omit `config`.')
      if (input.models) return sendError(res, 'bad_request', 'A Session provider has no model catalog — omit `models`.')
      const secret = idempotencyKey
        ? deriveRelayCreationSecret(tenantId, idempotencyKey)
        : mintRelaySecret()
      try {
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
          { kind: 'session', capabilities: { toolUse: true }, secretHash: hashRelaySecret(secret) },
          tenantId,
          { logicalId: logicalProviderId, isDefault: input.isDefault },
        )
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
    // per-tenant pointer intent, never a stored field.)
    // (`catalogSource` is server-derived too — stripped so a request can't claim a
    // 'listed' catalog it declared by hand; the mint funnel stamps 'static'.)
    const endpoint = input.config
    const isDefault = input.isDefault
    let declaredModels
    try {
      declaredModels = input.models === undefined ? undefined : providerCatalogModels(input.models)
    } catch (err) {
      if (err instanceof ValidationError) return sendError(res, 'bad_request', err.message)
      throw err
    }
    // Copy only the declared public registration fields. JSON bodies are not
    // made safe by their TypeScript annotation; an open spread here would make
    // unknown or ownership-shaped fields durable.
    const fields: Omit<ModelProvider, 'id'> = {
      label: input.label,
      modelFamily: input.modelFamily,
      effortLevels: input.effortLevels,
      ...(input.plan ? { plan: input.plan } : {}),
      ...(input.authority ? { authority: input.authority } : {}),
      ...(declaredModels ? { models: declaredModels } : {}),
    }
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
      // The model catalog (D9's flexible half): an explicit static declaration on the
      // request wins; otherwise ask the just-probed endpoint for its own list — an
      // endpoint with no list API simply yields no catalog (absence = can't
      // enumerate, shown honestly by the picker; never an error).
      if (!fields.models) {
        const listed = await fetchProviderModels(config)
        if (listed) Object.assign(fields, { models: listed, catalogSource: 'listed' as const })
      }
    }
    try {
      const provider = store.createProvider(fields, config, tenantId, {
        logicalId: logicalProviderId,
        isDefault,
      })
      // Re-read so the response carries the serve-time stamps (isDefault,
      // defaultModelId) — the same projection every later GET serves.
      sendJson(res, store.listProviders(tenantId).find((p) => p.id === provider.id) ?? provider)
    } catch (err) {
      // An over-plan provider — the requested plan exceeds the account plan (the cascade root).
      if (err instanceof BudgetError) return sendError(res, 'bad_request', err.message)
      // An out-of-policy credential reference the probe never saw (no endpoint to
      // probe) — caught by the mint funnel's own wall.
      if (err instanceof ProviderProbeError) return sendError(res, 'bad_request', err.message)
      // A malformed static model catalog (the funnel's shape wall).
      if (err instanceof ValidationError) return sendError(res, 'bad_request', err.message)
      throw err
    }
  }))
  // Re-fetch a provider's model catalog from its endpoint's own list API — the
  // 'listed' source stamp is earned only by this funnel (and the registration-time
  // fetch), never claimable on a request. A Session provider has no endpoint to
  // list from (409); an endpoint that doesn't answer a model list is a 400 and the
  // existing catalog stays untouched.
  r.post('/providers/:id/models/refresh', async ({ req, res, params }) => {
    if (denyForeignEntry(req, res, params.id, (t) => store.listProviders(t), 'provider')) return
    const tenantId = store.identity(req.headers).tenant.id
    const expectedRevision = store.listProviders(tenantId)
      .find((provider) => provider.id === params.id)?.connectionRevision ?? 0
    const config = store.providerConfig(params.id)
    if (config.kind === 'session') {
      return sendError(res, 'conflict', 'A Session provider has no endpoint to list models from.')
    }
    const models = await fetchProviderModels(config)
    if (!models) return sendError(res, 'bad_request', 'The provider’s endpoint didn’t answer a model list.')
    try {
      const provider = store.refreshProviderModels(params.id, models, expectedRevision)
      if (!provider) return sendError(res, 'not_found', `No provider '${params.id}'`)
      // Re-read so the response carries the serve-time stamps (isDefault, online).
      sendJson(res, store.listProviders(tenantId).find((p) => p.id === params.id) ?? provider)
    } catch (err) {
      if (err instanceof ConflictError) return sendError(res, err.code, err.message)
      throw err
    }
  })
  // A caller-authored static catalog has its own strict door. It shares the
  // connection revision because replacing an endpoint can replace this same
  // model namespace; it never rides the human-authored definition PATCH.
  r.formPatch(
    '/providers/:id/models',
    'Static catalog declaration is a registration protocol form; interactive catalogs come from endpoint refresh.',
    idempotent(async ({ req, res, params, body }) => {
      if (denyForeignEntry(req, res, params.id, (t) => store.listProviders(t), 'provider')) return
      try {
        const input = providerCatalogUpdate(await body<unknown>())
        if (store.providerConfig(params.id).kind === 'session') {
          return sendError(res, 'conflict', 'A Session provider has no model catalog.')
        }
        const provider = store.replaceStaticProviderModels(params.id, input.models, input.expectedRevision)
        if (!provider) return sendError(res, 'not_found', `No provider '${params.id}'`)
        const tenantId = store.identity(req.headers).tenant.id
        sendJson(res, store.listProviders(tenantId).find((row) => row.id === params.id) ?? provider)
      } catch (err) {
        if (err instanceof ValidationError) return sendError(res, 'bad_request', err.message)
        if (err instanceof ConflictError) return sendError(res, err.code, err.message)
        throw err
      }
    }),
  )
  // Replace selected fields of the server-only endpoint connection. The route
  // merges against the hidden current config, validates the effective reference,
  // and proves the effective endpoint before ONE store commit. A failed probe
  // therefore leaves the previously working endpoint/key/model intact. Reads
  // continue to return only the public provider row.
  r.patch('/providers/:id/connection', idempotent(async ({ req, res, params, body }) => {
    if (denyForeignEntry(req, res, params.id, (t) => store.listProviders(t), 'provider')) return
    try {
      const input = await body<UpdateProviderConnectionRequest>()
      const { expectedRevision, ...patch } = input ?? {}
      if (
        expectedRevision !== undefined &&
        (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0)
      ) {
        return sendError(res, 'bad_request', 'expectedRevision must be a non-negative safe integer')
      }
      // Refuse an already-stale request before probing its caller-supplied
      // endpoint. The store repeats this comparison at commit time to close a
      // race while the network probe is in flight.
      const tenantId = store.identity(req.headers).tenant.id
      const publicProvider = store.listProviders(tenantId).find((provider) => provider.id === params.id)
      const currentRevision = publicProvider?.connectionRevision ?? 0
      if (expectedRevision !== undefined && expectedRevision !== currentRevision) {
        return sendError(
          res,
          'conflict',
          `This provider connection changed elsewhere (expected revision ${expectedRevision}, current revision ${currentRevision}).`,
        )
      }
      // Read the hidden connection only after the request/precondition. Another
      // route can run while body parsing awaits; capturing it earlier would let
      // a current revision merge against a stale hidden base.
      const current = store.providerConfig(params.id)
      if (current.kind === 'session') {
        return sendError(res, 'conflict', 'A Session provider has no endpoint connection to update.')
      }
      const update = providerConnectionUpdate(current, patch)
      const next = update.config
      if (next.baseURL) next.capabilities = await probeProviderEndpoint(next)
      else delete next.capabilities

      // A different endpoint owns a different model namespace. Refresh it when
      // possible; if it has no list API, clear the old listed/static rows rather
      // than presenting stale models from the previous server. Credential- or
      // model-only rotations preserve the existing catalog.
      const catalog = update.endpointChanged
        ? next.baseURL
          ? await fetchProviderModels(next) ?? null
          : null
        : undefined
      const provider = store.replaceProviderConnection(params.id, next, catalog, expectedRevision)
      if (!provider) return sendError(res, 'not_found', `No provider '${params.id}'`)
      sendJson(res, store.listProviders(tenantId).find((p) => p.id === params.id) ?? provider)
    } catch (err) {
      if (err instanceof ProviderProbeError || err instanceof ValidationError) {
        return sendError(res, 'bad_request', err.message)
      }
      if (err instanceof ConflictError) return sendError(res, err.code, err.message)
      throw err
    }
  }))
  r.patch('/providers/:id', idempotent(async ({ req, res, params, body }) => {
    if (denyForeignEntry(req, res, params.id, (t) => store.listProviders(t), 'provider')) return
    const tenantId = store.identity(req.headers).tenant.id
    try {
      const input = providerDefinitionUpdate(await body<unknown>())
      const provider = store.updateProvider(params.id, input.patch, input.expectedRevision)
      if (!provider) return sendError(res, 'not_found', `No provider '${params.id}'`)
      // The default flag (the UI shortcut): true moves the caller's pointer here;
      // false clears it when this entry holds it — no default left is a valid state.
      if (input.isDefault === true) store.setDefaultProvider(params.id, tenantId)
      else if (input.isDefault === false && store.listProviders(tenantId).some((p) => p.id === params.id && p.isDefault)) {
        store.setDefaultProvider(undefined, tenantId)
      }
      // Re-read so the response carries the serve-time stamps (isDefault, online).
      sendJson(res, store.listProviders(tenantId).find((p) => p.id === params.id) ?? provider)
    } catch (err) {
      if (err instanceof BudgetError || err instanceof ValidationError) return sendError(res, 'bad_request', err.message)
      if (err instanceof ConflictError) return sendError(res, err.code, err.message)
      throw err
    }
  }))
  r.delete('/providers/:id', idempotent(async ({ req, res, params, body }) => {
    if (denyForeignEntry(req, res, params.id, (t) => store.listProviders(t), 'provider')) return
    let input: DeleteProviderRequest
    try {
      input = providerDelete(await body<unknown>())
    } catch (err) {
      if (err instanceof ValidationError) return sendError(res, err.code, err.message)
      throw err
    }
    try {
      const expected = input.expectedDefinitionRevision === undefined
        ? undefined
        : {
            definitionRevision: input.expectedDefinitionRevision,
            connectionRevision: input.expectedConnectionRevision,
          }
      if (!store.deleteProvider(params.id, expected)) return sendError(res, 'not_found', `No provider '${params.id}'`)
      sendJson(res, { ok: true })
    } catch (err) {
      // Protected (the default) or still bound by an Agent — a 409 to re-target.
      if (err instanceof ConflictError) return sendError(res, err.code, err.message)
      throw err
    }
  }))
  // Rotate a Session provider's rendezvous secret — the kill switch (§7.5). The old
  // secret dies on the spot (a held connector meets 401; an in-flight turn falls back
  // immediately); the response carries the NEW secret exactly once, like the mint.
  r.uiFormPost('/providers/:id/rotate', 'one-time rendezvous-secret rotation is credential ceremony', ({ req, res, params }) => {
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
  r.formGet('/relay/poll', 'session-relay long-poll authenticated by its rendezvous credential', async ({ req, res, url }) => {
    const providerId = relayAuth(req, res)
    if (!providerId) return
    // `have` advertises the framing/tool hashes the connector holds cached (v3
    // dedupe) — a delivered prompt omits exactly those bodies. Absent (a fresh
    // or restarted connector) ⇒ full bodies; malformed entries are just hashes
    // that will never match, so no validation wall is needed here.
    const have = new Set((url.searchParams.get('have') ?? '').split(',').map((h) => h.trim()).filter(Boolean))
    // `channels` is the v5 serving-handshake advertisement: how many concurrent
    // conversations the far side is prepared to serve. Absent/malformed ⇒ serial
    // (window 1) — the runtime never fans out beyond what was confirmed.
    const channelsRaw = url.searchParams.get('channels')
    const { result, abandon } = store.relay.poll(providerId, have, channelsRaw === null ? undefined : Number(channelsRaw))
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
  // turn to its fallback; a refusal from the far model is a *completion*; relayed
  // `toolCalls` continue the tool-use loop (v2) — validated for shape here, ids
  // minted server-side (never trusted from the wire), and exactly ONE of the three
  // answer forms is accepted (strict core: an ambiguous reply is refused loudly,
  // never resolved by precedence).
  r.formPost('/relay/reply', 'session-relay model callback authenticated by its rendezvous credential', async ({ req, res, body }) => {
    const providerId = relayAuth(req, res)
    if (!providerId) return
    const { entryId, completion, toolCalls, error } = await body<RelayReplyRequest>()
    if (!entryId || typeof entryId !== 'string') return sendError(res, 'bad_request', 'entryId is required')
    const forms = [typeof completion === 'string', toolCalls !== undefined, typeof error === 'string' && !!error]
    if (forms.filter(Boolean).length > 1) {
      return sendError(res, 'bad_request', 'Send exactly one of completion, toolCalls, or error.')
    }
    let outcome: RelayOutcome
    if (toolCalls !== undefined) {
      const MAX_CALLS = 8
      const valid =
        Array.isArray(toolCalls) &&
        toolCalls.length > 0 &&
        toolCalls.length <= MAX_CALLS &&
        toolCalls.every(
          (c) =>
            c &&
            typeof c === 'object' &&
            typeof (c as { name?: unknown }).name === 'string' &&
            (c as { name: string }).name.length > 0 &&
            ((c as { input?: unknown }).input === undefined ||
              (typeof (c as { input?: unknown }).input === 'object' && !Array.isArray((c as { input?: unknown }).input) && (c as { input?: unknown }).input !== null)),
        )
      if (!valid) {
        return sendError(res, 'bad_request', `toolCalls must be 1–${MAX_CALLS} entries of { name, input? } — relay the prompt's calls verbatim.`)
      }
      outcome = {
        kind: 'toolCalls',
        calls: toolCalls.map((c, i) => ({ id: `rtc-${entryId}-${i}`, name: c.name, input: (c.input as Record<string, unknown>) ?? {} })),
      }
    } else if (typeof error === 'string' && error) {
      outcome = { kind: 'error', reason: error }
    } else {
      outcome = { kind: 'completion', text: typeof completion === 'string' ? completion : '' }
    }
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
  r.formGet('/connector', 'downloadable relay connector program — installation transport, not workspace capability', ({ res }) => {
    connectorJs ??= stripTypeScriptTypes(
      readFileSync(fileURLToPath(new URL('../../connector/relay-connector.ts', import.meta.url)), 'utf8'),
    )
    res.setHeader('Content-Disposition', 'attachment; filename="session-relay.mjs"')
    sendText(res, connectorJs, 'text/javascript; charset=utf-8')
  })
  // The agent-facing SETUP GUIDE (spec MODEL-22): the far model fetches this and
  // onboards ITSELF — install the connector into whatever harness it runs in
  // (any standard stdio MCP registration), or drive the relay protocol directly
  // when its harness speaks no MCP. All harness-specific instruction lives here,
  // behind the mint panel's one bootstrap prompt, so the UI never enumerates
  // coding tools and a harness we've never heard of still onboards. Same
  // unauthenticated stance as `/connector`: a manual is not a secret.
  r.formGet('/connector/setup', 'agent-facing relay installation guide — setup transport, not workspace capability', ({ res, url }) => {
    sendText(res, renderConnectorSetup(`${url.origin}${API_BASE_PATH}`), 'text/markdown; charset=utf-8')
  })

  // ── Worker Agents (docs/agent-commons.md, D6) ──────────────────────────────
  // The user-created workers. `/agents` is the host-bound type's *former* route name,
  // freed by the D6 rename (host is now `/runners`), so the bare word goes to the worker.
  // The Agents hub manages them (create / patch / delete); the Contributor view +
  // commission picker read this to resolve labels and offer agents. POST resolves the
  // prompt body from `systemPromptId` and treats an omitted tool grant as empty, then runs
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
  r.aliasGet('/agents/:id', 'GET /agents', 'the by-id agent read is a focused projection of the agent collection visible in the UI', ({ req, res, params }) => {
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
  r.post('/agents', idempotent(async ({ req, res, body }) => {
    const tenantId = store.identity(req.headers).tenant.id
    const idempotencyKey = headerValue(req.headers, 'idempotency-key')
    const logicalAgentId = idempotencyKey
      ? agentCreationId(tenantId, idempotencyKey)
      : undefined
    const represented = logicalAgentId
      ? store.getAgentCreation(logicalAgentId, tenantId)
      : undefined
    // Durable row identity survives the process-local response cache. Return
    // that exact original row before parsing a changed Retry body.
    if (typeof represented === 'object') return sendJson(res, represented)
    if (represented === 'invalid') return sendError(res, 'bad_request', 'This Agent creation identity is not valid for this account')
    if (represented === 'retired') return sendError(res, 'not_found', 'This Agent was already removed')
    const input = await body<CreateAgentRequest>()
    // Strict bindings: an Agent is minted against a NAMED provider + prompt — the API
    // never resolves an absent one to a default (defaults are a UI pre-selection
    // shortcut only; a missing binding is a caller bug surfaced here, as a 400).
    if (!input?.label || !input.providerId || !input.systemPromptId) {
      return sendError(res, 'bad_request', 'label, providerId, and systemPromptId are required')
    }
    const bad = badAgentRef(input, tenantId)
    if (bad) return sendError(res, 'not_found', bad)
    try {
      sendJson(res, store.createAgentFromRequest(input, tenantId, { logicalId: logicalAgentId }))
    } catch (err) {
      // An over-grant on either cascade face — the request named an impossible grant —
      // or a binding the store's own strictness wall refused.
      if (err instanceof BudgetError || err instanceof AuthorityError || err instanceof ValidationError) {
        return sendError(res, 'bad_request', err.message)
      }
      throw err
    }
  }))
  r.patch('/agents/:id', idempotent(async ({ req, res, params, body }) => {
    if (denyForeignEntry(req, res, params.id, (t) => store.listAgents(t), 'agent')) return
    const input = await body<UpdateAgentRequest>()
    const { expectedRevision, ...patch } = input ?? {}
    if (
      expectedRevision !== undefined &&
      (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0)
    ) {
      return sendError(res, 'bad_request', 'expectedRevision must be a non-negative safe integer')
    }
    // Strict like create: a PRESENT binding must name a registered entry — empty
    // string ("clear to default") no longer exists; omit the field to keep the
    // current binding (including a bespoke merged/forked prompt).
    if (('providerId' in patch && !patch.providerId) || ('systemPromptId' in patch && !patch.systemPromptId)) {
      return sendError(res, 'bad_request', 'providerId / systemPromptId must name a registered entry — omit the field to keep the current binding')
    }
    const bad = badAgentRef(patch, store.identity(req.headers).tenant.id)
    if (bad) return sendError(res, 'not_found', bad)
    try {
      const agent = store.updateAgentFromRequest(params.id, patch, expectedRevision)
      if (!agent) return sendError(res, 'not_found', `No agent '${params.id}'`)
      sendJson(res, agent)
    } catch (err) {
      if (err instanceof BudgetError || err instanceof AuthorityError || err instanceof ValidationError) {
        return sendError(res, 'bad_request', err.message)
      }
      if (err instanceof ConflictError) return sendError(res, err.code, err.message)
      throw err
    }
  }))
  r.delete('/agents/:id', idempotent(async ({ req, res, params, body }) => {
    if (denyForeignEntry(req, res, params.id, (t) => store.listAgents(t), 'agent')) return
    let input: DeleteAgentRequest
    try {
      input = revisionedDelete(await body<unknown>(), 'agent')
    } catch (err) {
      if (err instanceof ValidationError) return sendError(res, err.code, err.message)
      throw err
    }
    try {
      if (!store.deleteAgent(params.id, input.expectedRevision)) {
        return sendError(res, 'not_found', `No agent '${params.id}'`)
      }
      sendJson(res, { ok: true })
    } catch (err) {
      // Protected (the default) or still assigned by a Commission — a 409 to re-target.
      if (err instanceof ConflictError) return sendError(res, err.code, err.message)
      throw err
    }
  }))
  // Agent-to-agent proxy (D15): A's Agent (`fromAgentId`) asks B's Agent (`:id`) to act on B's
  // private resource. B acts under *its own* authority and returns only the result — the
  // requester never holds a B credential (the structural D12 wall). Mock fulfilment.
  r.formPost('/agents/:id/proxy', 'agent-to-agent execution edge — machine coordination, not a human workspace act', async ({ res, params, body }) => {
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
    const tenantId = store.identity(req.headers).tenant.id
    const idempotencyKey = headerValue(req.headers, 'idempotency-key')
    const logicalAgentId = idempotencyKey
      ? agentForkCreationId(tenantId, idempotencyKey)
      : undefined
    // A fork owns current durable representation rather than a cached response:
    // after acknowledgement loss, retry returns the original private copy even
    // if its source was subsequently edited, unpublished, or removed.
    const represented = logicalAgentId
      ? store.getAgentCreation(logicalAgentId, tenantId)
      : undefined
    if (typeof represented === 'object') return sendJson(res, represented)
    if (represented === 'invalid') return sendError(res, 'bad_request', 'This Agent fork identity is not valid for this account')
    if (represented === 'retired') return sendError(res, 'not_found', 'This Agent fork was already removed')
    try {
      const fork = store.forkAgent(params.id, tenantId, { logicalId: logicalAgentId })
      if (!fork) return sendError(res, 'not_found', `No agent '${params.id}'`)
      sendJson(res, fork)
    } catch (error) {
      if (error instanceof ValidationError) return sendError(res, 'bad_request', error.message)
      throw error
    }
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
    sendJson(res, { tools: TOOL_NAMES, entries: TOOL_CATALOG })
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
  r.aliasGet('/system-prompts/:id', 'GET /system-prompts', 'the by-id prompt read is a focused projection of the prompt collection visible in the UI', ({ req, res, params }) => {
    // Scoped list, so an unknown OR cross-tenant id is a real 404 (no existence leak).
    const entry = store.listSystemPrompts(store.identity(req.headers).tenant.id).find((p) => p.id === params.id)
    if (!entry) return sendError(res, 'not_found', `No system prompt '${params.id}'`)
    sendJson(res, entry)
  })
  r.post('/system-prompts', idempotent(async ({ req, res, body }) => {
    const tenantId = store.identity(req.headers).tenant.id
    const idempotencyKey = headerValue(req.headers, 'idempotency-key')
    const logicalPromptId = idempotencyKey
      ? systemPromptCreationId(tenantId, idempotencyKey)
      : undefined
    const represented = logicalPromptId
      ? store.listSystemPrompts(tenantId).find((prompt) => prompt.id === logicalPromptId)
      : undefined
    // Durable identity survives response-cache loss. Do not parse or apply a
    // changed Retry body when this exact logical prompt is already represented.
    if (represented) return sendJson(res, represented)
    try {
      const input = systemPromptCreate(await body<unknown>())
      const entry = store.createSystemPrompt({
        label: input.label,
        body: input.body,
        targetFamily: input.targetFamily,
      }, tenantId, { logicalId: logicalPromptId, isDefault: input.isDefault })
      sendJson(res, store.listSystemPrompts(tenantId).find((prompt) => prompt.id === entry.id) ?? entry)
    } catch (err) {
      if (err instanceof ValidationError) return sendError(res, 'bad_request', err.message)
      throw err
    }
  }))
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
  r.patch('/system-prompts/:id', idempotent(async ({ req, res, params, body }) => {
    if (denyForeignEntry(req, res, params.id, (t) => store.listSystemPrompts(t), 'system prompt')) return
    const tenantId = store.identity(req.headers).tenant.id
    try {
      const input = systemPromptDefinitionUpdate(await body<unknown>())
      const entry = store.updateSystemPrompt(params.id, input.patch, input.expectedRevision)
      if (!entry) return sendError(res, 'not_found', `No system prompt '${params.id}'`)
      // The default flag — same set/clear semantics as the provider PATCH.
      if (input.isDefault === true) store.setDefaultSystemPrompt(params.id, tenantId)
      else if (input.isDefault === false && store.listSystemPrompts(tenantId).some((p) => p.id === params.id && p.isDefault)) {
        store.setDefaultSystemPrompt(undefined, tenantId)
      }
      sendJson(res, store.listSystemPrompts(tenantId).find((p) => p.id === params.id) ?? entry)
    } catch (err) {
      if (err instanceof ValidationError) return sendError(res, 'bad_request', err.message)
      if (err instanceof ConflictError) return sendError(res, err.code, err.message)
      throw err
    }
  }))
  r.delete('/system-prompts/:id', idempotent(async ({ req, res, params, body }) => {
    if (denyForeignEntry(req, res, params.id, (t) => store.listSystemPrompts(t), 'system prompt')) return
    let input: DeleteSystemPromptRequest
    try {
      input = revisionedDelete(await body<unknown>(), 'system prompt')
    } catch (err) {
      if (err instanceof ValidationError) return sendError(res, err.code, err.message)
      throw err
    }
    try {
      if (!store.deleteSystemPrompt(params.id, input.expectedRevision)) {
        return sendError(res, 'not_found', `No system prompt '${params.id}'`)
      }
      sendJson(res, { ok: true })
    } catch (err) {
      // Protected (the default) or still referenced by an Agent — a 409 to re-target.
      if (err instanceof ConflictError) return sendError(res, err.code, err.message)
      throw err
    }
  }))

  // ── Commissions (the agent→Project assignment — docs/agent-commons.md, D7/D13) ──
  // A Project's Contributors. `GET /commissions?project=<id>` filters to one Project.
  // `POST` mints through the leaf of the D8 cascade (commission ⊆ agent ⊆ provider):
  // an over-grant on either face is a 400 (an impossible grant was named), an unknown
  // agent / project a 404.
  // Tenant-scoped (F2/PD9): the caller's own commissions (plus any shared seed).
  r.get('/commissions', ({ req, res, url }) => {
    sendJson(res, store.listCommissions(url.searchParams.get('project') ?? undefined, store.identity(req.headers).tenant.id))
  })
  r.aliasGet('/commissions/:id', 'GET /commissions', 'the by-id commission read is a focused projection of the commission collection visible in the UI', ({ req, res, params }) => {
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
  r.post('/commissions', idempotent(async ({ req, res, body }) => {
    const tenantId = store.identity(req.headers).tenant.id
    const idempotencyKey = headerValue(req.headers, 'idempotency-key')
    const logicalCommissionId = idempotencyKey
      ? commissionCreationId(tenantId, idempotencyKey)
      : undefined
    const represented = logicalCommissionId
      ? store.listCommissions(undefined, tenantId).find((commission) => commission.id === logicalCommissionId)
      : undefined
    // Durable identity survives response-cache loss. A changed Retry cannot
    // re-run the cap/authority funnel or overwrite a newer configuration.
    if (represented) return sendJson(res, represented)
    let input: CreateCommissionRequest
    try {
      input = commissionCreate(await body<unknown>())
    } catch (err) {
      if (err instanceof ValidationError) return sendError(res, 'bad_request', err.message)
      throw err
    }
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
    try {
      sendJson(res, store.createCommission(input, tenantId, { logicalId: logicalCommissionId }))
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
  }))
  // Re-grant (narrow / restore a Contributor's authority) or un-commission. PATCH re-runs
  // the leaf funnel, so an over-grant is a 400; DELETE cascade-releases the Contributor's
  // sub-goals. No protected default — a commission has no fallback role.
  r.patch('/commissions/:id', idempotent(async ({ req, res, params, body }) => {
    if (denyForeignEntry(req, res, params.id, (t) => store.listCommissions(undefined, t), 'commission')) return
    try {
      const input = commissionConfigurationUpdate(await body<unknown>())
      const commission = store.updateCommission(params.id, input.patch, input.expectedRevision)
      if (!commission) return sendError(res, 'not_found', `No commission '${params.id}'`)
      sendJson(res, commission)
    } catch (err) {
      if (err instanceof BudgetError || err instanceof AuthorityError || err instanceof ValidationError) {
        return sendError(res, 'bad_request', err.message)
      }
      if (err instanceof ConflictError) return sendError(res, err.code, err.message)
      throw err
    }
  }))
  r.delete('/commissions/:id', idempotent(async ({ req, res, params, body }) => {
    if (denyForeignEntry(req, res, params.id, (t) => store.listCommissions(undefined, t), 'commission')) return
    let input: DeleteCommissionRequest
    try {
      input = commissionDelete(await body<unknown>())
    } catch (error) {
      if (error instanceof ValidationError) return sendError(res, error.code, error.message)
      throw error
    }
    try {
      if (!store.deleteCommission(params.id, input.expectedRevision)) {
        return sendError(res, 'not_found', `No commission '${params.id}'`)
      }
    } catch (error) {
      if (error instanceof ConflictError) return sendError(res, error.code, error.message)
      throw error
    }
    sendJson(res, { ok: true })
  }))

  // The ONE social Project wall, shared by coordination, open work, changes,
  // and every other Project-scoped public capability below.
  const projectHiddenFrom = (req: IncomingMessage, projectId: string): boolean => {
    const tenantId = store.identity(req.headers).tenant.id
    return !store.grantSubjectVisible({ kind: 'project', id: projectId }, tenantId)
  }

  // ── Multi-principal coordination — sub-goal reservation (D11) ──────────────
  // A guarded Project's in-flight sub-goals (who's handling what). `POST` claims one
  // for a Contributor; a *different* Contributor claiming the *same* sub-goal conflicts
  // (409 → re-reason). Release reuses POST /reservations/:id/release.
  // The only person-shaped holder input is the explicit `you` sentinel. The
  // server stamps its authenticated tenant privately; any other id must resolve
  // to a Commission whose Agent that tenant owns.
  r.get('/projects/:id/subgoals', ({ req, res, params }) => {
    if (projectHiddenFrom(req, params.id)) return sendError(res, 'not_found', `No project '${params.id}'`)
    const tenantId = store.identity(req.headers).tenant.id
    sendJson(res, store.projectSubGoals(params.id, tenantId))
  })
  r.post('/projects/:id/subgoals', async ({ req, res, params, body }) => {
    if (projectHiddenFrom(req, params.id)) return sendError(res, 'not_found', `No project '${params.id}'`)
    const { holder, subGoal } = await body<ReserveSubGoalRequest>()
    if (!holder || !subGoal) return sendError(res, 'bad_request', 'holder and subGoal are required')
    // Project-binding + caller-identity + shared-gate (P8 Phase 2b): when the holder is a
    // Contributor (commission), it must be one on THIS project, whose agent you own, and
    // cross-tenant only while shared. No other caller-invented holder is accepted.
    const commission = store.getCommission(holder)
    if (!commission && holder !== SELF_PROJECT_HOLDER) {
      return sendError(res, 'bad_request', `holder must be '${SELF_PROJECT_HOLDER}' or an owned Contributor`)
    }
    if (commission && commissionActorDenied(req, res, holder, params.id)) return
    // D14 role permission: when the holder is a Contributor (a known commission), reserving a
    // sub-goal requires its role to permit 'reserve' — a reader may not claim work. A
    // An authenticated self principal has no Contributor role to check.
    if (commission && !store.commissionRolePermits(holder, 'reserve')) {
      return sendError(res, 'forbidden', `Contributor '${holder}' (role) may not reserve sub-goals`)
    }
    try {
      sendJson(res, store.reserveSubGoal(
        params.id,
        holder,
        subGoal,
        store.identity(req.headers).tenant.id,
      ))
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
  r.get('/projects/:id/open-subgoals', ({ req, res, params }) => {
    if (projectHiddenFrom(req, params.id)) return sendError(res, 'not_found', `No project '${params.id}'`)
    sendJson(res, store.listOpenSubGoals(params.id, store.identity(req.headers).tenant.id))
  })
  r.post('/projects/:id/open-subgoals', async ({ req, res, params, body }) => {
    if (projectHiddenFrom(req, params.id)) return sendError(res, 'not_found', `No project '${params.id}'`)
    const who = store.identity(req.headers)
    const idempotencyKey = headerValue(req.headers, 'idempotency-key')
    const logicalWorkId = idempotencyKey
      ? openWorkCreationId(who.tenant.id, params.id, idempotencyKey)
      : undefined
    // The work item is the durable acknowledgement. A lost-response Retry
    // returns its CURRENT lifecycle before parsing changed input or dispatching
    // the effect again.
    const represented = logicalWorkId
      ? store.getOpenWorkCreation(logicalWorkId, params.id, who.tenant.id)
      : undefined
    if (typeof represented === 'object') return sendJson(res, represented)
    if (represented === 'invalid') {
      return sendError(res, 'bad_request', 'This open-work identity is not valid for this account and Project')
    }
    const input = await body<PostOpenSubGoalRequest>()
    if (
      typeof input?.subGoal !== 'string' || !input.subGoal.trim() ||
      typeof input?.target !== 'string' || !input.target.trim() ||
      (input.note !== undefined && typeof input.note !== 'string') ||
      !PROJECT_EFFECT_TYPES.includes(input.type)
    ) {
      return sendError(res, 'bad_request', 'subGoal, target, and a valid type are required')
    }
    const out = store.postOpenSubGoal(
      params.id,
      {
        ...input,
        subGoal: input.subGoal.trim(),
        target: input.target.trim(),
        ...(input.note !== undefined ? { note: input.note.trim() } : {}),
      },
      who.tenant.id,
      userPrincipal(who),
      undefined,
      undefined,
      { logicalId: logicalWorkId },
    )
    if (out === 'capped') return sendError(res, 'conflict', 'This project’s backlog is at its open-item cap')
    sendJson(res, out)
  })
  // D23 — the item's flat discussion thread: anyone who can SEE the project may
  // comment (the same wall as reading the backlog); attribution is the display name.
  r.post('/projects/:id/open-subgoals/:itemId/comments', async ({ req, res, params, body }) => {
    if (projectHiddenFrom(req, params.id)) return sendError(res, 'not_found', `No project '${params.id}'`)
    const who = store.identity(req.headers)
    const idempotencyKey = headerValue(req.headers, 'idempotency-key')
    const logicalCommentId = idempotencyKey
      ? workItemCommentCreationId(who.tenant.id, params.id, params.itemId, idempotencyKey)
      : undefined
    // The embedded comment is the durable acknowledgement. Return the containing
    // item's CURRENT lifecycle/thread before changed input, capacity, or fan-out.
    const represented = logicalCommentId
      ? store.getWorkItemCommentCreation(logicalCommentId, params.id, params.itemId, who.tenant.id)
      : undefined
    if (typeof represented === 'object') return sendJson(res, represented)
    if (represented === 'invalid') {
      return sendError(res, 'bad_request', 'This comment identity is not valid for this work item')
    }
    const input = await body<PostWorkItemCommentRequest>()
    if (typeof input?.body !== 'string' || !input.body.trim()) {
      return sendError(res, 'bad_request', 'a non-empty comment body is required')
    }
    const out = store.commentOnOpenSubGoal(
      params.id,
      params.itemId,
      input.body,
      who.tenant.id,
      userPrincipal(who),
      undefined,
      { logicalId: logicalCommentId },
    )
    if (out === undefined) return sendError(res, 'not_found', `No work item '${params.itemId}'`)
    if (out === 'capped') return sendError(res, 'conflict', 'This item’s discussion is at its cap')
    sendJson(res, out)
  })
  // ── D25 — change proposals against published definitions (the PR analog) ────
  // Propose: the directory's wall (published-only ⇒ the identical 404). Review:
  // the owner sees all, a proposer sees their own. Verdicts are owner-only.
  r.post('/agents/:id/proposals', idempotent(async ({ req, res, params, body }) => {
    const who = store.identity(req.headers)
    const idempotencyKey = headerValue(req.headers, 'idempotency-key')
    const logicalProposalId = idempotencyKey
      ? agentProposalCreationId(who.tenant.id, params.id, idempotencyKey)
      : undefined
    if (logicalProposalId) {
      const represented = store.getAgentProposalCreation(params.id, logicalProposalId, who.tenant.id)
      if (represented && represented !== 'invalid') return sendJson(res, represented)
      if (represented === 'invalid') return sendError(res, 'conflict', 'That proposal key already represents another author')
    }
    const input = await body<ProposeAgentChangeRequest>()
    const f = input?.fields
    const hasField =
      !!f &&
      ((typeof f.label === 'string' && !!f.label.trim()) ||
        (typeof f.systemPrompt === 'string' && !!f.systemPrompt.trim()) ||
        typeof f.instructions === 'string' ||
        Array.isArray(f.tools))
    if (!hasField) return sendError(res, 'bad_request', 'at least one definition field is required')
    const out = store.proposeAgentChange(
      params.id,
      input!,
      who.tenant.id,
      userPrincipal(who),
      { logicalId: logicalProposalId },
    )
    if (out === undefined) return sendError(res, 'not_found', `No agent '${params.id}'`)
    if (out === 'capped') return sendError(res, 'conflict', 'This definition’s review queue is full')
    if (out === 'invalid') return sendError(res, 'bad_request', 'That Agent proposal identity is invalid')
    sendJson(res, out)
  }))
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
  // The PUBLIC forks behind the fork counter (D18) — published forks only (the P8
  // wall lives in the store); same existence-hiding 404 as resolved-work.
  r.get('/agents/:id/forks', ({ req, res, params }) => {
    const out = store.agentPublicForks(params.id, store.identity(req.headers).tenant.id)
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
    const who = store.identity(req.headers)
    const idempotencyKey = headerValue(req.headers, 'idempotency-key')
    const logicalCommentId = idempotencyKey
      ? agentProposalCommentCreationId(who.tenant.id, params.id, params.pid, idempotencyKey)
      : undefined
    const represented = logicalCommentId
      ? store.getAgentProposalCommentCreation(
          params.id,
          params.pid,
          logicalCommentId,
          input.body,
          who.tenant.id,
        )
      : undefined
    if (typeof represented === 'object') return sendJson(res, represented)
    if (represented === 'invalid') {
      return sendError(res, 'bad_request', 'This comment identity is not valid for this account, proposal, and exact body')
    }
    const out = store.commentOnAgentProposal(
      params.id,
      params.pid,
      input.body,
      who.tenant.id,
      userPrincipal(who),
      { logicalId: logicalCommentId },
    )
    if (out === undefined) return sendError(res, 'not_found', `No proposal '${params.pid}'`)
    if (out === 'closed') return sendError(res, 'conflict', 'This proposal was already resolved — the verdict ended the conversation')
    if (out === 'capped') return sendError(res, 'conflict', 'This proposal’s discussion is at its cap')
    if (out === 'invalid') return sendError(res, 'bad_request', 'This comment body or durable identity is invalid')
    sendJson(res, out)
  })
  r.post('/agents/:id/proposals/:pid/merge', ({ req, res, params }) => {
    const who = store.identity(req.headers)
    const idempotencyKey = headerValue(req.headers, 'idempotency-key')
    const logicalVerdictId = idempotencyKey
      ? agentProposalVerdictId(who.tenant.id, params.id, params.pid, idempotencyKey)
      : undefined
    const out = store.resolveAgentProposal(
      params.id,
      params.pid,
      who.tenant.id,
      'merge',
      undefined,
      { logicalId: logicalVerdictId },
    )
    if (out === undefined) return sendError(res, 'not_found', `No proposal '${params.pid}'`)
    if (out === 'forbidden') return sendError(res, 'forbidden', 'Only the definition’s owner may merge a proposal')
    if (out === 'closed') return sendError(res, 'conflict', 'This proposal was already resolved')
    if (out === 'invalid') return sendError(res, 'bad_request', 'This verdict identity is not valid for this account, proposal, and action')
    sendJson(res, out)
  })
  r.post('/agents/:id/proposals/:pid/decline', async ({ req, res, params, body }) => {
    const input = await body<DeclineProposalRequest>()
    if (input?.note !== undefined && typeof input.note !== 'string') {
      return sendError(res, 'bad_request', 'note must be a string')
    }
    const who = store.identity(req.headers)
    const idempotencyKey = headerValue(req.headers, 'idempotency-key')
    const logicalVerdictId = idempotencyKey
      ? agentProposalVerdictId(who.tenant.id, params.id, params.pid, idempotencyKey)
      : undefined
    const out = store.resolveAgentProposal(
      params.id,
      params.pid,
      who.tenant.id,
      'decline',
      input?.note,
      { logicalId: logicalVerdictId },
    )
    if (out === undefined) return sendError(res, 'not_found', `No proposal '${params.pid}'`)
    if (out === 'forbidden') return sendError(res, 'forbidden', 'Only the definition’s owner may decline a proposal')
    if (out === 'closed') return sendError(res, 'conflict', 'This proposal was already resolved')
    if (out === 'invalid') return sendError(res, 'bad_request', 'This verdict identity is not valid for this account, proposal, action, and note')
    sendJson(res, out)
  })

  // ── D24 — watching + the notification inbox ─────────────────────────────────
  // Watch a project you can see (the same wall as reading it); read/mark your inbox.
  r.get('/projects/:id/watch', ({ req, res, params }) => {
    if (projectHiddenFrom(req, params.id)) return sendError(res, 'not_found', `No project '${params.id}'`)
    sendJson(res, store.watchState({ kind: 'project', id: params.id }, store.identity(req.headers).tenant.id))
  })
  r.post('/projects/:id/watch', async ({ req, res, params, body }) => {
    const input = await body<SetWatchRequest>()
    if (typeof input?.watching !== 'boolean') return sendError(res, 'bad_request', 'watching (boolean) is required')
    if (projectHiddenFrom(req, params.id)) return sendError(res, 'not_found', `No project '${params.id}'`)
    sendJson(res, store.setWatch({ kind: 'project', id: params.id }, store.identity(req.headers).tenant.id, input.watching))
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
    const who = store.identity(req.headers)
    const idempotencyKey = headerValue(req.headers, 'idempotency-key')
    const logicalRetractionId = idempotencyKey
      ? workItemRetractionId(who.tenant.id, params.id, params.itemId, idempotencyKey)
      : undefined
    const represented = logicalRetractionId
      ? store.getWorkItemRetraction(logicalRetractionId, params.id, params.itemId, who.tenant.id)
      : undefined
    if (typeof represented === 'object') return sendJson(res, represented)
    if (represented === 'invalid') {
      return sendError(res, 'bad_request', 'This retraction identity is not valid for this account and work item')
    }
    const out = store.retractOpenSubGoal(
      params.id,
      params.itemId,
      who.tenant.id,
      userPrincipal(who),
      { logicalId: logicalRetractionId },
    )
    if (out === undefined) return sendError(res, 'not_found', `No work item '${params.itemId}'`)
    if (out === 'forbidden') return sendError(res, 'forbidden', 'Only the poster or the project owner may retract an item')
    if (out === 'closed') return sendError(res, 'conflict', 'Only an open item can be retracted')
    sendJson(res, out)
  })

  // ── Social-layer grants (S1 — docs/design/social-layer.md) ──────────────────
  // Generic over the social nouns: routes take a SocialEntityRef, never a
  // kind-specific path. The wall is existence-hiding (invisible ≡ nonexistent);
  // creation is the subject owner's act, revocation is either party's.
  r.get('/grants', ({ req, res, url }) => {
    const ref = socialRefFromQuery(url)
    if (!ref) return sendError(res, 'bad_request', 'kind (a social entity kind) and id are required')
    const tenant = store.identity(req.headers).tenant.id
    if (!store.grantSubjectVisible(ref, tenant)) return sendError(res, 'not_found', `No ${ref.kind} '${ref.id}'`)
    sendJson(res, store.listGrants(ref, tenant))
  })
  r.post('/grants', idempotent(async ({ req, res, body }) => {
    const input = await body<CreateGrantRequest>()
    if (!input?.subject?.kind || !input.subject.id || !input.audience?.kind || !input.tier) {
      return sendError(res, 'bad_request', 'subject {kind,id}, audience, and tier are required')
    }
    const tenant = store.identity(req.headers).tenant.id
    const out = store.createGrant(input, tenant)
    if (out === undefined) return sendError(res, 'not_found', `No ${input.subject.kind} '${input.subject.id}'`)
    if (out === 'forbidden') return sendError(res, 'forbidden', 'Only the subject’s owner may share it')
    if (out === 'invalid') return sendError(res, 'bad_request', 'a valid tier and a known principal/org audience are required (link audiences arrive with the public phase; discussion subjects with S2)')
    if (out === 'capped') return sendError(res, 'conflict', 'This resource’s grant roster is at its cap')
    sendJson(res, out)
  }))
  // S6 — redeem a link token: the signed-in caller becomes audience at the
  // grant's tier; unknown/rotated tokens 404 (existence-hiding).
  r.post('/grants/redeem', async ({ req, res, body }) => {
    const input = await body<{ token?: string }>()
    if (typeof input?.token !== 'string' || !input.token) return sendError(res, 'bad_request', 'token is required')
    const out = store.redeemGrant(input.token, store.identity(req.headers).tenant.id)
    if (out === undefined) return sendError(res, 'not_found', 'This link is unknown — or was rotated')
    sendJson(res, out)
  })
  r.delete('/grants/:gid', idempotent(({ req, res, params }) => {
    // A non-party 404s identically to a nonexistent id (existence-hiding —
    // sequential grant ids would otherwise be probeable).
    const out = store.revokeGrant(params.gid, store.identity(req.headers).tenant.id)
    if (out === undefined) return sendError(res, 'not_found', `No grant '${params.gid}'`)
    sendJson(res, { ok: true })
  }))

  // What the CALLER may do on one subject — so the UI can shape its affordances
  // to the wall instead of offering acts the write paths then refuse. Computed
  // from the SAME predicates those paths use, never a parallel rule. Walled like
  // every other social face: an invisible subject 404s exactly as a missing one.
  r.get('/social/capability', ({ req, res, url }) => {
    const ref = socialRefFromQuery(url)
    if (!ref) return sendError(res, 'bad_request', 'kind (a social entity kind) and id are required')
    const tenant = store.identity(req.headers).tenant.id
    if (!store.grantSubjectVisible(ref, tenant)) return sendError(res, 'not_found', `No ${ref.kind} '${ref.id}'`)
    sendJson(res, {
      canComment: store.socialSubjectCommentable(ref, tenant),
      canPropose: store.socialSubjectProposable(ref, tenant),
    } satisfies import('../../contract/index.ts').SocialCapability)
  })

  // ── Social-layer discussions (S2) ───────────────────────────────────────────
  // Generic over the anchor ref; visibility INHERITS the anchor's read wall
  // (existence-hiding — the store enforces on every face). Posting needs
  // comment authority; reacting needs only readability (the thinnest signal).
  r.get('/discussions', ({ req, res, url }) => {
    // Three explicit modes (INV-9 — absence refused, never guessed): `direct=1`
    // is the DM inbox, `mine=1` lists the caller's participating threads, and
    // kind+id lists a subject's. `direct` is its own mode rather than a filter
    // the client applies, because the inbox must be a SERVER projection: the
    // pair wall and the unread mark both live here (UI-12 — never a client
    // guess about a status a registry owns).
    if (url.searchParams.get('direct') === '1') {
      return sendJson(res, store.listDirectMessages(store.identity(req.headers).tenant.id))
    }
    if (url.searchParams.get('mine') === '1') {
      return sendJson(res, store.listMyDiscussions(store.identity(req.headers).tenant.id))
    }
    const ref = socialRefFromQuery(url)
    if (!ref) return sendError(res, 'bad_request', 'kind (a social entity kind) and id are required')
    const tenant = store.identity(req.headers).tenant.id
    if (!store.grantSubjectVisible(ref, tenant)) return sendError(res, 'not_found', `No ${ref.kind} '${ref.id}'`)
    sendJson(res, store.listDiscussions(ref, tenant))
  })
  /** ── S8: say something (the square's compose door) ────────────────────────
   *  A post is a Discussion anchored to the AUTHOR's own principal, so this
   *  could be `POST /discussions` with a self-anchor — but that would make every
   *  composer look its own display name up first and send it back as the thing
   *  it is addressing, which is a client reconstructing its own identity. The
   *  server already knows who is calling. One field, no anchor. */
  r.post('/posts', idempotent(async ({ req, res, body }) => {
    const input = await body<{ body?: string }>()
    if (typeof input?.body !== 'string' || !input.body.trim()) {
      return sendError(res, 'bad_request', 'a non-empty body is required')
    }
    const tenantId = store.identity(req.headers).tenant.id
    const idempotencyKey = headerValue(req.headers, 'idempotency-key')
    const out = store.openWallPost(
      input.body,
      tenantId,
      idempotencyKey ? discussionPostId(tenantId, idempotencyKey) : undefined,
    )
    if (out === 'capped') return sendError(res, 'conflict', 'Your wall is at its post cap')
    if (!out) return sendError(res, 'bad_request', 'a non-empty body is required')
    sendJson(res, out)
  }))
  r.post('/discussions', idempotent(async ({ req, res, body }) => {
    const input = await body<OpenDiscussionRequest>()
    if (!input?.anchor?.ref?.kind || !input.anchor.ref.id || typeof input.firstPost !== 'string' || !input.firstPost.trim()) {
      return sendError(res, 'bad_request', 'anchor {ref} and a non-empty firstPost are required')
    }
    // The LOCUS is refused unless it matches a declared variant exactly (INV-9,
    // strict core). An anchor is persisted and echoed to everyone who can read
    // the subject, so unvalidated shapes would be stored, served, and — since
    // `sameLocus` compares structurally — would each fork a thread nobody's
    // gutter can find again.
    if (input.anchor.locus !== undefined && !isAnchorLocus(input.anchor.locus)) {
      return sendError(res, 'bad_request', 'anchor.locus must be a declared AnchorLocus variant')
    }
    const tenantId = store.identity(req.headers).tenant.id
    const idempotencyKey = headerValue(req.headers, 'idempotency-key')
    const out = store.openDiscussion(
      { ...input, firstPost: input.firstPost.trim() },
      tenantId,
      idempotencyKey ? discussionPostId(tenantId, idempotencyKey) : undefined,
    )
    if (out === undefined) return sendError(res, 'not_found', `No ${input.anchor.ref.kind} '${input.anchor.ref.id}'`)
    if (out === 'forbidden') return sendError(res, 'forbidden', 'Commenting needs the comment tier (a view grant reads silently)')
    if (out === 'capped') return sendError(res, 'conflict', 'This subject’s discussions are at their cap')
    sendJson(res, out)
  }))
  r.get('/discussions/:did', ({ req, res, params }) => {
    const out = store.getDiscussion(params.did, store.identity(req.headers).tenant.id)
    if (out === undefined) return sendError(res, 'not_found', `No discussion '${params.did}'`)
    sendJson(res, out)
  })
  r.post('/discussions/:did/posts', idempotent(async ({ req, res, params, body }) => {
    const input = await body<PostToDiscussionRequest>()
    if (typeof input?.body !== 'string' || !input.body.trim()) return sendError(res, 'bad_request', 'a non-empty body is required')
    // S9 — `replyTo` is optional (absent = a top-level post) but TYPED when
    // present: a non-string is a malformed request, not a shrug to top level.
    if (input.replyTo !== undefined && typeof input.replyTo !== 'string') {
      return sendError(res, 'bad_request', 'replyTo must be the id of a post in this discussion')
    }
    const tenantId = store.identity(req.headers).tenant.id
    const idempotencyKey = headerValue(req.headers, 'idempotency-key')
    const out = store.postToDiscussion(
      params.did,
      input.body.trim(),
      tenantId,
      input.replyTo,
      idempotencyKey ? discussionPostId(tenantId, idempotencyKey) : undefined,
    )
    if (out === undefined) return sendError(res, 'not_found', `No discussion '${params.did}'`)
    if (out === 'forbidden') return sendError(res, 'forbidden', 'Commenting needs the comment tier (a view grant reads silently)')
    if (out === 'capped') return sendError(res, 'conflict', 'This discussion is at its post cap')
    // Refused rather than silently detached: a reply that loses what it answers
    // is worse than one that fails, because the author cannot see it happen.
    if (out === 'no-parent') return sendError(res, 'bad_request', 'replyTo must name a post in this discussion')
    sendJson(res, out)
  }))
  r.post('/discussions/:did/posts/:pid/react', ({ req, res, params }) => {
    const out = store.toggleDiscussionReaction(params.did, params.pid, store.identity(req.headers).tenant.id)
    if (out === undefined) return sendError(res, 'not_found', `No discussion post '${params.pid}'`)
    sendJson(res, out)
  })
  // S5 guardrails: author-retract or anchor-owner moderation; report rings the
  // owner; mutes are the caller's own earmuffs (never a wall).
  r.delete('/discussions/:did/posts/:pid', ({ req, res, params, url }) => {
    // `?cascade=1` takes the whole branch. Absent is the narrow delete (INV-9:
    // an absent field means the fixed, minimal-risk answer), and the authority
    // check runs over every post that would go — see `deleteDiscussionPost`.
    const cascade = url.searchParams.get('cascade') === '1'
    const out = store.deleteDiscussionPost(params.did, params.pid, store.identity(req.headers).tenant.id, cascade)
    if (out === undefined) return sendError(res, 'not_found', `No discussion post '${params.pid}'`)
    if (out === 'forbidden')
      return sendError(
        res,
        'forbidden',
        cascade ?
          'Only the author or the subject’s owner may delete a post — and a cascade needs that standing over every reply underneath it'
        : 'Only the author or the subject’s owner may delete a post',
      )
    sendJson(res, { ok: true, discussion: out })
  })
  r.post('/discussions/:did/posts/:pid/report', ({ req, res, params }) => {
    const out = store.reportDiscussionPost(params.did, params.pid, store.identity(req.headers).tenant.id)
    if (out === undefined) return sendError(res, 'not_found', `No discussion post '${params.pid}'`)
    sendJson(res, { ok: true })
  })
  // S7 — follow: mute's positive twin, and shaped identically (a name-keyed
  // per-viewer list). Explicit state rather than a toggle, like the Commons
  // like: two clients pressing at once must converge on what was asked for.
  r.get('/me/follows', ({ req, res }) => {
    sendJson(res, store.listFollows(store.identity(req.headers).tenant.id))
  })
  r.post('/social/follow', async ({ req, res, body }) => {
    const input = await body<SetFollowRequest>()
    if (typeof input?.name !== 'string' || !input.name.trim() || typeof input.following !== 'boolean') {
      return sendError(res, 'bad_request', 'name and following (boolean) are required')
    }
    const out = store.setFollow(input.name.trim(), input.following, store.identity(req.headers).tenant.id)
    // Existence-hiding: a name the caller cannot see is the same 404 as a name
    // nobody wears — a follow probe must not be an existence oracle.
    if (out === undefined) return sendError(res, 'not_found', `No workspace '${input.name.trim()}'`)
    if (out === 'self') return sendError(res, 'bad_request', 'You cannot follow yourself')
    sendJson(res, out)
  })
  // S7 — mark a thread read (the DM inbox's unread count). A private note to
  // self: it rings nobody and moves no wall, so an unreadable thread is
  // silently ignored rather than refused (a refusal would leak existence).
  r.post('/discussions/:did/read', async ({ req, res, params, body }) => {
    const input = await body<MarkDiscussionReadRequest>()
    if (input?.throughPostId !== undefined && typeof input.throughPostId !== 'string') {
      return sendError(res, 'bad_request', 'throughPostId must be a post id')
    }
    store.markDiscussionRead(params.did, store.identity(req.headers).tenant.id, input?.throughPostId)
    sendJson(res, { ok: true })
  })
  r.formGet('/me/mutes', 'reserved social-guardrail projection; excluded until the UI has a mute-management surface', ({ req, res }) => {
    sendJson(res, store.listMutes(store.identity(req.headers).tenant.id))
  })
  r.formPatch('/me/mutes', 'reserved social-guardrail mutation; excluded until the UI has a mute-management surface', async ({ req, res, body }) => {
    const input = await body<{ name?: string; muted?: boolean }>()
    if (typeof input?.name !== 'string' || !input.name.trim() || typeof input.muted !== 'boolean') {
      return sendError(res, 'bad_request', 'name and muted (boolean) are required')
    }
    sendJson(res, store.setMute(input.name.trim(), input.muted, store.identity(req.headers).tenant.id))
  })

  r.post('/discussions/:did/resolve', async ({ req, res, params, body }) => {
    const input = await body<{ state?: 'open' | 'resolved' }>()
    const state = input?.state ?? 'resolved'
    if (state !== 'open' && state !== 'resolved') return sendError(res, 'bad_request', 'state must be open or resolved')
    const out = store.setDiscussionState(params.did, state, store.identity(req.headers).tenant.id)
    if (out === undefined) return sendError(res, 'not_found', `No discussion '${params.did}'`)
    if (out === 'forbidden') return sendError(res, 'forbidden', 'Only the opener or the subject’s owner may resolve a discussion')
    sendJson(res, out)
  })

  // ── The Commons feed (S4) — a projection over the social primitives ─────────
  r.get('/commons', ({ req, res }) => {
    sendJson(res, store.listCommons(store.identity(req.headers).tenant.id))
  })
  // The lens acts (the rail's Watched / Liked / Posted / Recently viewed).
  // "Posted" needs no act — it IS the actor field — and the other three are the
  // thinnest writes in the system: a like, a watch, a note that you looked.
  r.post('/commons/:itemId/like', async ({ req, res, params, body }) => {
    const input = await body<SetCommonsLikeRequest>()
    if (typeof input?.liked !== 'boolean') return sendError(res, 'bad_request', 'liked (boolean) is required')
    const out = store.setCommonsLike(params.itemId, store.identity(req.headers).tenant.id, input.liked)
    // Existence-hiding, like every subject-walled read: an item whose subject
    // the caller can't see must 404 exactly as an unknown id does.
    if (!out) return sendError(res, 'not_found', `No feed item '${params.itemId}'`)
    sendJson(res, out)
  })
  r.aliasGet('/social/watch', 'POST /social/watch', 'watch-state reading and mutation are two forms of the same visible social-watch capability', ({ req, res, url }) => {
    const ref = socialRefFromQuery(url)
    if (!ref) return sendError(res, 'bad_request', 'kind (a social entity kind) and id are required')
    const tenant = store.identity(req.headers).tenant.id
    if (!store.grantSubjectVisible(ref, tenant)) return sendError(res, 'not_found', `No ${ref.kind} '${ref.id}'`)
    sendJson(res, store.watchState(ref, tenant))
  })
  r.post('/social/watch', async ({ req, res, body }) => {
    const input = await body<SetSocialWatchRequest>()
    const ref = socialRef(input?.subject)
    if (!ref || typeof input?.watching !== 'boolean') {
      return sendError(res, 'bad_request', 'subject (kind + id) and watching (boolean) are required')
    }
    const tenant = store.identity(req.headers).tenant.id
    // Watching needs only VISIBILITY (COMMONS-13) — the same wall as reading it.
    if (!store.grantSubjectVisible(ref, tenant)) return sendError(res, 'not_found', `No ${ref.kind} '${ref.id}'`)
    sendJson(res, store.setWatch(ref, tenant, input.watching))
  })
  r.post('/social/viewed', async ({ req, res, body }) => {
    const input = await body<RecordViewRequest>()
    const ref = socialRef(input?.subject)
    if (!ref) return sendError(res, 'bad_request', 'subject (kind + id) is required')
    // Deliberately no visibility ERROR: the store drops an unreadable subject
    // silently, because a refusal here would answer "does this exist?" for
    // anything a page happened to mount.
    store.recordView(ref, store.identity(req.headers).tenant.id)
    sendJson(res, { ok: true })
  })

  // ── Social-layer proposals (S3) ─────────────────────────────────────────────
  // The landing ledger generalized: walls inherit the SUBJECT's (existence-
  // hiding everywhere); landing/declining is the subject owner's consent.
  r.get('/proposals', ({ req, res, url }) => {
    const ref = socialRefFromQuery(url)
    if (!ref) return sendError(res, 'bad_request', 'kind (a social entity kind) and id are required')
    const tenant = store.identity(req.headers).tenant.id
    if (!store.grantSubjectVisible(ref, tenant)) return sendError(res, 'not_found', `No ${ref.kind} '${ref.id}'`)
    sendJson(res, store.listSocialProposals(ref, tenant))
  })
  // This create owns idempotence in its durable Proposal identity rather than
  // the generic response cache: every Retry must recheck the current subject
  // wall and return the current represented row, not an older HTTP envelope.
  r.post('/proposals', async ({ req, res, body }) => {
    const tenantId = store.identity(req.headers).tenant.id
    const idempotencyKey = headerValue(req.headers, 'idempotency-key')
    const logicalProposalId = idempotencyKey
      ? socialProposalCreationId(tenantId, idempotencyKey)
      : undefined
    const represented = logicalProposalId
      ? store.getSocialProposalCreation(logicalProposalId, tenantId)
      : undefined
    // Durable proposal identity outlives the response cache. Its current
    // subject wall is checked before changed Retry input can be parsed.
    if (represented && represented !== 'invalid') return sendJson(res, represented)
    if (represented === 'invalid') return sendError(res, 'bad_request', 'This change-offer identity is not valid for this account')
    const input = await body<OpenProposalRequest>()
    if (!input?.subject?.kind || !input.subject.id || !input.delta?.kind || typeof input.rationale !== 'string' || !input.rationale.trim()) {
      return sendError(res, 'bad_request', 'subject {kind,id}, a typed delta, and a non-empty rationale are required')
    }
    const out = store.openSocialProposal(
      { ...input, rationale: input.rationale.trim() },
      tenantId,
      { logicalId: logicalProposalId },
    )
    if (out === undefined) return sendError(res, 'not_found', `No ${input.subject.kind} '${input.subject.id}'`)
    if (out === 'forbidden') return sendError(res, 'forbidden', 'Proposing needs the propose tier')
    if (out === 'capped') return sendError(res, 'conflict', 'This subject’s proposals are at their cap')
    if (out === 'invalid') return sendError(res, 'bad_request', 'the delta must be a non-empty suggestion or a well-formed typed change')
    sendJson(res, out)
  })
  r.aliasGet('/proposals/:pid', 'GET /proposals', 'the by-id proposal read is a focused projection of the proposal collection visible in the UI', ({ req, res, params }) => {
    const out = store.getSocialProposal(params.pid, store.identity(req.headers).tenant.id)
    if (out === undefined) return sendError(res, 'not_found', `No proposal '${params.pid}'`)
    sendJson(res, out)
  })
  r.post('/proposals/:pid/land', idempotent(({ req, res, params }) => {
    const out = store.landSocialProposal(params.pid, store.identity(req.headers).tenant.id)
    if (out === undefined) return sendError(res, 'not_found', `No proposal '${params.pid}'`)
    if (out === 'forbidden') return sendError(res, 'forbidden', 'Only the subject’s owner lands a proposal')
    if (out === 'closed') return sendError(res, 'conflict', 'Only an offered proposal can land')
    if (out === 'inapplicable') return sendError(res, 'conflict', 'This proposal cannot be applied safely with the current access. Review it and ask for a new proposal.')
    if (out === 'stale') return sendError(res, 'conflict', 'This proposal is outdated because its target changed after it was offered. Review the current version and ask for a new proposal.')
    sendJson(res, out)
  }))
  r.post('/proposals/:pid/decline', idempotent(({ req, res, params }) => {
    const out = store.declineSocialProposal(params.pid, store.identity(req.headers).tenant.id)
    if (out === undefined) return sendError(res, 'not_found', `No proposal '${params.pid}'`)
    if (out === 'forbidden') return sendError(res, 'forbidden', 'Only the subject’s owner declines a proposal')
    if (out === 'closed') return sendError(res, 'conflict', 'Only an offered proposal can be declined')
    sendJson(res, out)
  }))

  // ── The contribution ledger (agent-contribution workflow Phase A) ───────────
  // Visibility mirrors the Project's exactly (the open-subgoals wall — owner or
  // shared ⇒ readable, else the existence-hiding 404). Opening is any-viewer
  // (the post-an-item analog); landing is contributor-or-owner (the store
  // enforces on raw tenant ids — the Phase-A stand-in for CW5 tiers).
  r.get('/projects/:id/contributions', ({ req, res, params }) => {
    if (projectHiddenFrom(req, params.id)) return sendError(res, 'not_found', `No project '${params.id}'`)
    sendJson(res, store.listContributions(params.id, store.identity(req.headers).tenant.id))
  })
  r.post('/projects/:id/contributions', idempotent(async ({ req, res, params, body }) => {
    if (projectHiddenFrom(req, params.id)) return sendError(res, 'not_found', `No project '${params.id}'`)
    const who = store.identity(req.headers)
    const idempotencyKey = headerValue(req.headers, 'idempotency-key')
    const logicalContributionId = idempotencyKey
      ? contributionCreationId(who.tenant.id, params.id, idempotencyKey)
      : undefined
    const represented = logicalContributionId
      ? store.listContributions(params.id, who.tenant.id)
        .find((contribution) => contribution.id === logicalContributionId)
      : undefined
    // The durable row identity outlives the response cache. A changed Retry
    // cannot duplicate or rewrite work that was already declared.
    if (represented) return sendJson(res, represented)
    const input = await body<OpenContributionRequest>()
    if (!input?.title?.trim()) return sendError(res, 'bad_request', 'a non-empty title is required')
    const out = store.openContribution(
      params.id,
      { ...input, title: input.title.trim(), ...(typeof input.summary === 'string' ? { summary: input.summary.trim() } : {}) },
      who.tenant.id,
      userPrincipal(who),
      { logicalId: logicalContributionId },
    )
    if (out === 'capped') return sendError(res, 'conflict', 'This project’s ledger is at its open-contribution cap')
    if (out === 'invalid') return sendError(res, 'bad_request', 'This Contribution identity is not valid for this Project')
    sendJson(res, out)
  }))
  r.post('/projects/:id/contributions/:cid/comments', async ({ req, res, params, body }) => {
    const input = await body<PostContributionNoteRequest>()
    if (typeof input?.body !== 'string' || !input.body.trim()) {
      return sendError(res, 'bad_request', 'a non-empty comment body is required')
    }
    if (projectHiddenFrom(req, params.id)) return sendError(res, 'not_found', `No project '${params.id}'`)
    const who = store.identity(req.headers)
    const idempotencyKey = headerValue(req.headers, 'idempotency-key')
    const logicalCommentId = idempotencyKey
      ? contributionCommentCreationId(who.tenant.id, params.id, params.cid, idempotencyKey)
      : undefined
    const represented = logicalCommentId
      ? store.getContributionCommentCreation(
          logicalCommentId,
          params.id,
          params.cid,
          input.body,
          who.tenant.id,
        )
      : undefined
    if (typeof represented === 'object') return sendJson(res, represented)
    if (represented === 'invalid') {
      return sendError(res, 'bad_request', 'This comment identity is not valid for this account, Contribution, and exact body')
    }
    const out = store.noteContribution(
      params.id,
      params.cid,
      input.body,
      who.tenant.id,
      userPrincipal(who),
      { logicalId: logicalCommentId },
    )
    if (out === undefined) return sendError(res, 'not_found', `No contribution '${params.cid}'`)
    if (out === 'capped') return sendError(res, 'conflict', 'This contribution’s discussion is at its cap')
    if (out === 'invalid') return sendError(res, 'bad_request', 'This comment body or durable identity is invalid')
    sendJson(res, out)
  })
  // The attention ledger (CW9, Phase G): behind the project wall; counts are
  // public-timeline arithmetic, asks are computed for the CALLER.
  r.get('/projects/:id/attention', ({ req, res, params }) => {
    if (projectHiddenFrom(req, params.id)) return sendError(res, 'not_found', `No project '${params.id}'`)
    sendJson(res, store.attentionLedger(params.id, store.identity(req.headers).tenant.id))
  })
  // ── Delegations (CW8, Phase F) — judgment as delegable work ─────────────────
  // Roster reads for any project viewer (governance is legible; the policy
  // text rides only for the delegator); mint/revoke are the delegator's acts;
  // exercising is SoD-checked in the store (a contributor never triggers the
  // decision on their own work).
  r.get('/projects/:id/delegations', ({ req, res, params }) => {
    if (projectHiddenFrom(req, params.id)) return sendError(res, 'not_found', `No project '${params.id}'`)
    sendJson(res, store.listDelegations(params.id, store.identity(req.headers).tenant.id))
  })
  r.post('/projects/:id/delegations', idempotent(async ({ req, res, params, body }) => {
    if (projectHiddenFrom(req, params.id)) return sendError(res, 'not_found', `No project '${params.id}'`)
    const who = store.identity(req.headers)
    const idempotencyKey = headerValue(req.headers, 'idempotency-key')
    const logicalDelegationId = idempotencyKey
      ? delegationCreationId(who.tenant.id, params.id, idempotencyKey)
      : undefined
    const represented = logicalDelegationId
      ? store.listDelegations(params.id, who.tenant.id)
        .find((delegation) => delegation.id === logicalDelegationId)
      : undefined
    // The durable row identity outlives the response cache. A changed Retry
    // cannot widen an authority grant that was already established.
    if (represented) return sendJson(res, represented)
    const input = await body<CreateDelegationRequest>()
    if (!input?.agentId || !input?.actKind) return sendError(res, 'bad_request', 'agentId and actKind are required')
    const out = store.createDelegation(
      params.id,
      input,
      who.tenant.id,
      { logicalId: logicalDelegationId },
    )
    if (out === undefined) return sendError(res, 'not_found', `No project '${params.id}'`)
    if (out === 'forbidden') return sendError(res, 'forbidden', 'Only the project owner may delegate their judgment')
    if (out === 'capped') return sendError(res, 'conflict', 'This project’s delegation roster is at its cap')
    if (out === 'retired') return sendError(res, 'conflict', 'That Delegation creation was already revoked')
    if (out === 'invalid') return sendError(res, 'bad_request', 'a delegation needs YOUR OWN agent, a valid act kind, a non-empty policy, and known escalation triggers (effectful is always included — the floor is not delegable)')
    sendJson(res, out)
  }))
  r.delete('/projects/:id/delegations/:did', idempotent(async ({ req, res, params, body }) => {
    if (projectHiddenFrom(req, params.id)) return sendError(res, 'not_found', `No project '${params.id}'`)
    const who = store.identity(req.headers)
    let input: DeleteDelegationRequest
    try {
      input = delegationRevocation(await body<unknown>())
    } catch (err) {
      if (err instanceof ValidationError) return sendError(res, err.code, err.message)
      throw err
    }
    const idempotencyKey = headerValue(req.headers, 'idempotency-key')
    const revocationId = idempotencyKey
      ? delegationRevocationId(who.tenant.id, params.id, params.did, idempotencyKey)
      : undefined
    if (revocationId) {
      const represented = store.getDelegationRevocation(
        revocationId,
        params.id,
        params.did,
        input.expectedCreatedAt,
        who.tenant.id,
      )
      if (represented === true) return sendJson(res, { ok: true })
      if (represented === 'invalid') return sendError(res, 'conflict', 'That revocation key already represents a different request')
    }
    try {
      const out = store.deleteDelegation(params.id, params.did, who.tenant.id, {
        expectedCreatedAt: input.expectedCreatedAt,
        revocationId,
      })
      if (out === undefined) return sendError(res, 'not_found', `No delegation '${params.did}'`)
      if (out === 'forbidden') return sendError(res, 'forbidden', 'Only the delegator may revoke their delegation')
      if (out === 'invalid') return sendError(res, 'conflict', 'That revocation key already represents a different request')
      sendJson(res, { ok: true })
    } catch (err) {
      if (err instanceof ConflictError) return sendError(res, err.code, err.message)
      throw err
    }
  }))
  r.post('/projects/:id/contributions/:cid/delegated/:did', ({ req, res, params }) => {
    if (projectHiddenFrom(req, params.id)) return sendError(res, 'not_found', `No project '${params.id}'`)
    const who = store.identity(req.headers)
    const out = store.runDelegation(params.id, params.cid, params.did, who.tenant.id, userPrincipal(who))
    if (out === undefined) return sendError(res, 'not_found', `No contribution or delegation`)
    if (out === 'self') return sendError(res, 'forbidden', 'Separation of duties — the contributor may not trigger the decision on their own work')
    if (out === 'forbidden') return sendError(res, 'forbidden', 'Not permitted')
    if (out === 'inapplicable') return sendError(res, 'conflict', 'Nothing for this delegation to decide here (no pending act, or the contribution landed)')
    sendJson(res, out)
  })
  // The changeset (CW3/CW4, Phase D): crystallize a version — contributor or
  // owner (the work's own act), append-only, behind the same project wall.
  r.post('/projects/:id/contributions/:cid/changeset', idempotent(async ({ req, res, params, body }) => {
    const input = await body<CrystallizeRequest>()
    if (!Array.isArray(input?.entries)) return sendError(res, 'bad_request', 'entries (array) is required')
    if (projectHiddenFrom(req, params.id)) return sendError(res, 'not_found', `No project '${params.id}'`)
    const who = store.identity(req.headers)
    const idempotencyKey = headerValue(req.headers, 'idempotency-key')
    const logicalCrystallizationId = idempotencyKey
      ? contributionCrystallizationId(who.tenant.id, params.id, params.cid, idempotencyKey)
      : undefined
    const represented = logicalCrystallizationId
      ? store.getContributionCrystallization(
          logicalCrystallizationId,
          params.id,
          params.cid,
          input!,
          who.tenant.id,
        )
      : undefined
    if (typeof represented === 'object') return sendJson(res, represented)
    if (represented === 'invalid') {
      return sendError(res, 'bad_request', 'This crystallization identity is not valid for this account, Contribution, and exact changeset')
    }
    const out = store.crystallizeContribution(
      params.id,
      params.cid,
      input!,
      who.tenant.id,
      userPrincipal(who),
      { logicalId: logicalCrystallizationId },
    )
    if (out === undefined) return sendError(res, 'not_found', `No contribution '${params.cid}'`)
    if (out === 'forbidden') return sendError(res, 'forbidden', 'Only the contributor or the project owner may crystallize a changeset')
    if (out === 'closed') return sendError(res, 'conflict', 'A landed contribution’s changeset is immutable history')
    if (out === 'capped') return sendError(res, 'conflict', 'This contribution’s changeset (or timeline) is at its cap')
    if (out === 'invalid') return sendError(res, 'bad_request', 'each entry needs a valid kind, a target, and after-text (before optional); one entry per kind+target')
    sendJson(res, out)
  }))
  // The effect envelope (CW1, Phase C): propose/amend is open to any viewer
  // (deliberation, behind the same wall); approve is owner-only; an act is a
  // MECHANICAL match against the approved envelope (refusals recorded, 409).
  r.post('/projects/:id/contributions/:cid/envelope', async ({ req, res, params, body }) => {
    const input = await body<ProposeEnvelopeRequest>()
    if (!Array.isArray(input?.lines)) return sendError(res, 'bad_request', 'lines (array) is required')
    if (
      input.expectedVersion !== undefined &&
      (!Number.isSafeInteger(input.expectedVersion) || input.expectedVersion < 0)
    ) {
      return sendError(res, 'bad_request', 'expectedVersion must be a non-negative safe integer')
    }
    if (projectHiddenFrom(req, params.id)) return sendError(res, 'not_found', `No project '${params.id}'`)
    const who = store.identity(req.headers)
    const idempotencyKey = headerValue(req.headers, 'idempotency-key')
    const logicalProposalId = idempotencyKey
      ? contributionEnvelopeProposalId(who.tenant.id, params.id, params.cid, idempotencyKey)
      : undefined
    const represented = logicalProposalId
      ? store.getContributionEnvelopeProposal(
          logicalProposalId,
          params.id,
          params.cid,
          input!,
          who.tenant.id,
        )
      : undefined
    if (typeof represented === 'object') return sendJson(res, represented)
    if (represented === 'invalid') {
      return sendError(res, 'bad_request', 'This envelope proposal identity is not valid for this account, Contribution, base version, and exact payload')
    }
    const out = store.proposeEnvelope(
      params.id,
      params.cid,
      input!,
      who.tenant.id,
      userPrincipal(who),
      { logicalId: logicalProposalId },
    )
    if (out === undefined) return sendError(res, 'not_found', `No contribution '${params.cid}'`)
    if (out === 'closed') return sendError(res, 'conflict', 'A landed contribution’s plan is immutable history')
    if (out === 'forbidden') return sendError(res, 'forbidden', 'Only the contributor or the project owner may amend an APPROVED envelope')
    if (out === 'conflict') return sendError(res, 'conflict', 'The effect envelope changed after this draft was opened')
    if (out === 'capped') return sendError(res, 'conflict', 'This contribution’s timeline is at its cap')
    if (out === 'invalid') return sendError(res, 'bad_request', 'each distinct line needs a valid type, target, cardinality 1–20, known harness, and text note')
    sendJson(res, out)
  })
  r.post('/projects/:id/contributions/:cid/envelope/approve', async ({ req, res, params, body }) => {
    if (projectHiddenFrom(req, params.id)) return sendError(res, 'not_found', `No project '${params.id}'`)
    const who = store.identity(req.headers)
    const input = await body<ApproveEnvelopeRequest>()
    const expectedVersion = input?.expectedVersion
    if (
      expectedVersion !== undefined &&
      (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1)
    ) {
      return sendError(res, 'bad_request', 'expectedVersion must be a positive safe integer')
    }
    const idempotencyKey = headerValue(req.headers, 'idempotency-key')
    const logicalApprovalId = idempotencyKey
      ? contributionEnvelopeApprovalId(who.tenant.id, params.id, params.cid, idempotencyKey)
      : undefined
    const represented = logicalApprovalId
      ? store.getContributionEnvelopeApproval(
          logicalApprovalId,
          params.id,
          params.cid,
          who.tenant.id,
          expectedVersion,
        )
      : undefined
    if (typeof represented === 'object') return sendJson(res, represented)
    if (represented === 'invalid') {
      return sendError(res, 'bad_request', 'This approval identity is not valid for this account, Contribution, and reviewed envelope version')
    }
    const out = store.approveEnvelope(
      params.id,
      params.cid,
      who.tenant.id,
      userPrincipal(who),
      undefined,
      { logicalId: logicalApprovalId, expectedVersion },
    )
    if (out === undefined) return sendError(res, 'not_found', `No contribution '${params.cid}'`)
    if (out === 'forbidden') return sendError(res, 'forbidden', 'Only the project owner may approve an effect envelope')
    if (out === 'conflict') return sendError(res, 'conflict', 'The reviewed envelope version is no longer awaiting approval')
    sendJson(res, out)
  })
  r.post('/projects/:id/contributions/:cid/effects', idempotent(async ({ req, res, params, body }) => {
    const input = await body<RunEnvelopeEffectRequest>()
    if (typeof input?.lineId !== 'string' || !input.lineId) return sendError(res, 'bad_request', 'lineId is required')
    if (projectHiddenFrom(req, params.id)) return sendError(res, 'not_found', `No project '${params.id}'`)
    const who = store.identity(req.headers)
    const idempotencyKey = headerValue(req.headers, 'idempotency-key')
    const logicalExecutionId = idempotencyKey
      ? contributionEffectExecutionId(who.tenant.id, params.id, params.cid, idempotencyKey)
      : undefined
    const represented = logicalExecutionId
      ? store.getContributionEffectExecution(
          logicalExecutionId,
          params.id,
          params.cid,
          input.lineId,
          who.tenant.id,
        )
      : undefined
    if (typeof represented === 'object') {
      if (represented.result === 'executed') return sendJson(res, represented.contribution)
      if (represented.result === 'unapproved') {
        return sendError(res, 'conflict', 'No approved envelope covers this act — the refusal is on the timeline')
      }
      return sendError(res, 'conflict', 'Outside the approved envelope — the refusal is on the timeline; amend and re-approve')
    }
    if (represented === 'invalid') {
      return sendError(res, 'bad_request', 'This effect identity is not valid for this account, Contribution, and envelope line')
    }
    const out = store.runEnvelopeEffect(
      params.id,
      params.cid,
      input.lineId,
      who.tenant.id,
      userPrincipal(who),
      { logicalId: logicalExecutionId },
    )
    if (out === undefined) return sendError(res, 'not_found', `No contribution '${params.cid}'`)
    if (out === 'forbidden') return sendError(res, 'forbidden', 'Only the contributor or the project owner may fire an envelope act')
    if (out === 'closed') return sendError(res, 'conflict', 'A landed contribution’s plan is immutable — remaining cardinality does not survive the landing')
    if (out === 'unapproved') return sendError(res, 'conflict', 'No approved envelope covers this act — the refusal is on the timeline')
    if (out === 'refused') return sendError(res, 'conflict', 'Outside the approved envelope — the refusal is on the timeline; amend and re-approve')
    sendJson(res, out)
  }))
  r.post('/projects/:id/contributions/:cid/land', ({ req, res, params }) => {
    if (projectHiddenFrom(req, params.id)) return sendError(res, 'not_found', `No project '${params.id}'`)
    const who = store.identity(req.headers)
    const idempotencyKey = headerValue(req.headers, 'idempotency-key')
    const logicalLandingId = idempotencyKey
      ? contributionLandingId(who.tenant.id, params.id, params.cid, idempotencyKey)
      : undefined
    const represented = logicalLandingId
      ? store.getContributionLanding(logicalLandingId, params.id, params.cid, who.tenant.id)
      : undefined
    if (typeof represented === 'object') return sendJson(res, represented)
    if (represented === 'invalid') {
      return sendError(res, 'bad_request', 'This landing identity is not valid for this account and Contribution')
    }
    const out = store.landContribution(
      params.id,
      params.cid,
      who.tenant.id,
      userPrincipal(who),
      { logicalId: logicalLandingId },
    )
    if (out === undefined) return sendError(res, 'not_found', `No contribution '${params.cid}'`)
    if (out === 'forbidden') return sendError(res, 'forbidden', 'Only the contributor or the project owner may land a contribution')
    if (out === 'closed') return sendError(res, 'conflict', 'This contribution already landed')
    if (out === 'needs-owner') return sendError(res, 'forbidden', 'Tier 2 — irreversible effects land only by the project owner (the floor; no record buys past it)')
    if (out === 'needs-review') return sendError(res, 'conflict', 'Tier 1 — the adversarial review must pass over the latest crystallized version before landing')
    sendJson(res, out)
  })
  // The tier machinery (CW5, Phase E): the owner's tighten-only act, and the
  // mock adversarial review (the declared model-seam — real interface, canned
  // verdict). Both behind the same project wall.
  r.post('/projects/:id/contributions/:cid/require-review', ({ req, res, params }) => {
    if (projectHiddenFrom(req, params.id)) return sendError(res, 'not_found', `No project '${params.id}'`)
    const who = store.identity(req.headers)
    const idempotencyKey = headerValue(req.headers, 'idempotency-key')
    const logicalRequirementId = idempotencyKey
      ? contributionReviewRequirementId(who.tenant.id, params.id, params.cid, idempotencyKey)
      : undefined
    const represented = logicalRequirementId
      ? store.getContributionReviewRequirement(
          logicalRequirementId,
          params.id,
          params.cid,
          who.tenant.id,
        )
      : undefined
    if (typeof represented === 'object') return sendJson(res, represented)
    if (represented === 'invalid') {
      return sendError(res, 'bad_request', 'This review-requirement identity is not valid for this account and Contribution')
    }
    const out = store.requireContributionReview(
      params.id,
      params.cid,
      who.tenant.id,
      userPrincipal(who),
      { logicalId: logicalRequirementId },
    )
    if (out === undefined) return sendError(res, 'not_found', `No contribution '${params.cid}'`)
    if (out === 'forbidden') return sendError(res, 'forbidden', 'Only the project owner may tighten a contribution’s gate')
    if (out === 'conflict') return sendError(res, 'conflict', 'Already required, or the contribution landed')
    if (out === 'invalid') return sendError(res, 'bad_request', 'This review-requirement identity is not valid for this account and Contribution')
    sendJson(res, out)
  })
  r.post('/projects/:id/contributions/:cid/review', async ({ req, res, params, body }) => {
    if (projectHiddenFrom(req, params.id)) return sendError(res, 'not_found', `No project '${params.id}'`)
    const who = store.identity(req.headers)
    const input = await body<ReviewContributionRequest>()
    const expectedVersion = input?.expectedVersion
    if (
      expectedVersion !== undefined &&
      (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1)
    ) {
      return sendError(res, 'bad_request', 'expectedVersion must be a positive safe integer')
    }
    const idempotencyKey = headerValue(req.headers, 'idempotency-key')
    const logicalReviewId = idempotencyKey
      ? contributionReviewId(who.tenant.id, params.id, params.cid, idempotencyKey)
      : undefined
    const represented = logicalReviewId
      ? store.getContributionReview(logicalReviewId, params.id, params.cid, who.tenant.id, expectedVersion)
      : undefined
    if (typeof represented === 'object') return sendJson(res, represented)
    if (represented === 'invalid') {
      return sendError(res, 'bad_request', 'This review identity is not valid for this account, Contribution, and changeset version')
    }
    const out = store.reviewContribution(
      params.id,
      params.cid,
      who.tenant.id,
      userPrincipal(who),
      { logicalId: logicalReviewId, expectedVersion },
    )
    if (out === undefined) return sendError(res, 'not_found', `No contribution '${params.cid}'`)
    if (out === 'nothing') return sendError(res, 'conflict', 'Nothing to review — crystallize a changeset first (or the contribution landed)')
    if (out === 'stale') return sendError(res, 'conflict', 'The changeset changed after this review was started')
    if (out === 'conflict') return sendError(res, 'conflict', 'This contribution’s timeline is at its cap')
    if (out === 'invalid') return sendError(res, 'bad_request', 'This review identity or expected version is invalid')
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
  r.formGet('/a2a/card', 'public Agent-to-Agent protocol card — machine discovery transport', ({ res, url }) => sendJson(res, platformCard(url.origin)))
  // A published Agent's card, built from its DIRECTORY ENTRY — the same redaction
  // function the D17 directory read uses, so a card can never expose a field the
  // directory withholds. Unpublished or unknown ⇒ the identical 404.
  r.formGet('/a2a/agents/:id/card', 'public Agent-to-Agent agent card — machine discovery transport', ({ req, res, params, url }) => {
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
  r.formPost('/a2a/peers', 'A2A peer-credential enrollment is machine authentication ceremony', async ({ res, body }) => {
    const input = await body<CreateA2aPeerRequest>()
    if (typeof input?.name !== 'string' || !input.name.trim()) {
      return sendError(res, 'bad_request', 'name is required')
    }
    sendJson(res, store.createA2aPeer(input.name))
  })
  r.formGet('/a2a/peers', 'A2A peer-credential registry is machine authentication ceremony', ({ res }) => {
    sendJson(res, store.listA2aPeers())
  })
  r.formDelete('/a2a/peers/:id', 'A2A peer-credential revocation is machine authentication ceremony', ({ res, params }) => {
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
  r.formPost('/a2a/projects/:id', 'inbound A2A JSON-RPC transport authenticated as a foreign peer', async (ctx) => {
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
        // FWD-5: a foreign actor gets NO local principal — `verifiedPeer` attributes it (D28).
        const out = store.commentOnOpenSubGoal(params.id, continueTaskId, text, store.identity(req.headers).tenant.id, undefined, peer?.name)
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
      const item = store.postOpenSubGoal(params.id, { subGoal, type, target, note }, store.identity(req.headers).tenant.id, undefined, 'a2a', peer?.name)
      if (item === 'capped') return rpcError(res, id, A2A_ERROR.invalidParams, 'This project’s backlog is at its open-item cap')
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
      const out = typeof taskId === 'string' ? store.retractOpenSubGoal(params.id, taskId, store.identity(req.headers).tenant.id, undefined) : undefined
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
  r.formPost('/a2a/agents/:id', 'inbound A2A JSON-RPC transport authenticated as a foreign peer', async (ctx) => {
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
    const tenantId = store.identity(req.headers).tenant.id
    const idempotencyKey = headerValue(req.headers, 'idempotency-key')
    const logicalAgentId = idempotencyKey
      ? agentImportCreationId(tenantId, idempotencyKey)
      : undefined
    // The imported Agent is the durable acknowledgement. A lost-response Retry
    // returns it before parsing a changed URL or touching the remote host again.
    const represented = logicalAgentId
      ? store.getAgentCreation(logicalAgentId, tenantId)
      : undefined
    if (typeof represented === 'object') return sendJson(res, represented)
    if (represented === 'invalid') return sendError(res, 'bad_request', 'This Agent import identity is not valid for this account')
    if (represented === 'retired') return sendError(res, 'not_found', 'This imported Agent was already removed')

    const input = await body<ImportAgentCardRequest>()
    const cardUrl = typeof input?.url === 'string' ? input.url.trim() : ''
    let parsedUrl: URL
    try {
      parsedUrl = new URL(cardUrl)
    } catch {
      return sendError(res, 'bad_request', 'url must be an http(s) Agent Card URL')
    }
    if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
      return sendError(res, 'bad_request', 'url must be an http(s) Agent Card URL')
    }
    if (parsedUrl.username || parsedUrl.password) {
      return sendError(res, 'bad_request', 'Agent Card URLs must not contain embedded credentials')
    }
    let card: unknown
    try {
      // `redirect: 'error'`: a redirect could hop the vetted URL to another
      // host/port — refuse it rather than widen the recorded SSRF-shaped surface.
      const resp = await fetch(cardUrl, { signal: AbortSignal.timeout(5_000), redirect: 'error' })
      if (!resp.ok) return sendError(res, 'upstream_unavailable', `The Agent Card host returned HTTP ${resp.status}`)
      const text = await readCapped(resp.body, MAX_CARD_BYTES)
      if (text === undefined) return sendError(res, 'upstream_unavailable', 'The Agent Card response was too large')
      card = JSON.parse(text)
    } catch {
      return sendError(res, 'upstream_unavailable', 'Could not fetch a valid Agent Card from that host')
    }
    const name = (card as { name?: unknown } | null)?.name
    if (typeof name !== 'string' || !name.trim()) {
      return sendError(res, 'upstream_unavailable', 'The remote response is not an Agent Card: a string `name` is required')
    }
    const shaped = card as { name: string; description?: string; skills?: { id?: string; name?: string }[] }
    sendJson(res, store.importAgentFromCard(shaped, cardUrl, tenantId, { logicalId: logicalAgentId }))
  })

  // A Contributor fires an externally-effectful action on a shared Project (D11/D12, OQ3+OQ4):
  // the Commission's connector/MCP reach is the wall (D12), and a non-monotonic effect is
  // serialized on its sub-goal reservation at the Guardian (D11) — the slice-4 "forward" effect
  // now on a real path. Order: 400 fields → 404 project → 403 actor (caller-identity + shared-gate)
  // → 403 reach → 403 role → run (409 on a concurrent different principal). A charge has no
  // data-reach target, so it skips the reach check.
  r.formPost('/projects/:id/effects', 'commissioned effect-ingress edge used by machine coordination, not a direct UI act', async ({ req, res, params, body }) => {
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
  // `conflict` (409) when the resource is at capacity / held by another principal.
  // A Project guardian namespace is never reachable through this generic door;
  // its Project-aware routes own visibility, claimant identity, and role policy.
  r.formGet('/resources/:key', 'capability-broker guardian primitive; the UI exposes resource-specific coordination instead', ({ res, params }) => {
    if (store.isProjectGuardianResource(params.key)) {
      return sendError(res, 'not_found', `No generic resource '${params.key}'`)
    }
    sendJson(res, store.guardian.status(params.key))
  })
  r.formPatch('/resources/:key', 'capability-broker capacity primitive; excluded until a direct UI control exists', async ({ res, params, body }) => {
    if (store.isProjectGuardianResource(params.key)) {
      return sendError(res, 'not_found', `No generic resource '${params.key}'`)
    }
    const { capacity } = await body<SetCapacityRequest>()
    if (typeof capacity !== 'number' || capacity < 1) {
      return sendError(res, 'bad_request', 'capacity must be a positive number')
    }
    sendJson(res, store.guardian.setCapacity(params.key, capacity))
  })
  r.formPost('/resources/:key/reserve', 'capability-broker reservation primitive; UI reservations use their resource-specific route', async ({ req, res, params, body }) => {
    if (store.isProjectGuardianResource(params.key)) {
      return sendError(res, 'not_found', `No generic resource '${params.key}'`)
    }
    const input = await body<ReserveRequest>()
    if (!input?.holder) return sendError(res, 'bad_request', 'holder is required')
    try {
      sendJson(res, store.guardian.reserve(params.key, input.holder, {
        ttlMs: input.ttlMs,
        ownerTenant: store.identity(req.headers).tenant.id,
      }))
    } catch (err) {
      if (err instanceof GuardianError) return sendError(res, err.code, err.message)
      throw err
    }
  })
  const reservationActorDenied = (req: IncomingMessage, res: ServerResponse, id: string): boolean => {
    try {
      if (store.guardian.ownedBy(id, store.identity(req.headers).tenant.id)) return false
      sendError(res, 'forbidden', 'Only the reservation holder may change this claim')
      return true
    } catch (err) {
      if (err instanceof GuardianError) {
        sendError(res, err.code, err.message)
        return true
      }
      throw err
    }
  }
  r.formPost('/reservations/:id/commit', 'capability-broker escrow primitive; effects commit it internally rather than through a UI act', idempotent(({ req, res, params }) => {
    if (reservationActorDenied(req, res, params.id)) return
    try {
      sendJson(res, store.guardian.commit(params.id))
    } catch (err) {
      if (err instanceof GuardianError) return sendError(res, err.code, err.message)
      throw err
    }
  }))
  r.post('/reservations/:id/release', idempotent(({ req, res, params }) => {
    if (reservationActorDenied(req, res, params.id)) return
    sendJson(res, store.guardian.release(params.id))
  }))

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
  r.formGet('/fs/pick', 'native picker transport; the UI realizes file choice through its host-specific picker', ({ res, url }) => {
    if (!gate(res, 'osPicker')) return
    sendJson(res, store.fsPick(url.searchParams.get('kind') ?? 'folder'))
  })
  r.formGet('/fs/folders/:id', 'native folder-handle transport; served filesystem reads are the symmetric product surface', ({ res, params }) => {
    if (!gate(res, 'localFs')) return
    const scan = store.scanFolder(params.id)
    if (!scan) return sendError(res, 'not_found', `No folder '${params.id}'`)
    sendJson(res, scan)
  })
  r.formGet('/git/repos/:id/diff', 'native git transport; repository context is the symmetric product surface', ({ res, params }) => {
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
  r.formGet('/events', 'browser ambient SSE stream — synchronization transport, not a workspace capability', ({ req, res, url }) => {
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
    let unsubscribeFault = () => {}
    const close = () => {
      unsubscribe()
      unsubscribeFault()
      channel.close()
    }
    unsubscribeFault = store.subscribePersistenceFault(close)
    req.on('close', close)
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
  r.get('/sessions/:id', ({ req, res, params, url }) => {
    if (denyForeignSession(req, res, params.id)) return
    // A scheduled run *is* a session — a persisted row minted through the same
    // funnel as a human one (`srun-*` ids resolve here like any other).
    const session = store.getSession(params.id)
    if (!session) return sendError(res, 'not_found', `No session '${params.id}'`)
    // Project the live turn (if any) onto the read — transient registry state,
    // never persisted (contract/turns.ts): a client arriving mid-generation sees
    // `activeTurnId` and reattaches instead of finding a silently stuck thread.
    const live = turns.bySession(params.id)
    // Viewer-relative ownership (the `mine` pattern): a social grant widens READS
    // without widening ownership, so a granted visitor opens this conversation
    // but its share configuration is the owner's alone. Computed here, where the
    // reader is in hand — never stored.
    const identity = store.identity(req.headers)
    const own = store.sessionOwnedBy(session, identity.tenant.id)
    const projected = projectSessionHistory(session, url)
    if (projected === 'invalid') {
      return sendError(res, 'bad_request', `messageLimit must be an integer from 1 to ${MAX_PAGE_LIMIT}`)
    }
    sendJson(res, {
      ...projected,
      own,
      viewerPreferences: store.sessionPreferences(identity.user.id, params.id),
      ...(live ? { activeTurnId: live.id } : {}),
    })
  })
  // The recoverable detail behind a compaction marker. This new browser door is
  // bounded from birth (always a Page<Message>, default 40). The legacy full
  // session read remains unchanged for API/MCP compatibility (ADAPT-24).
  r.get('/sessions/:id/compacted-messages', ({ req, res, params, url }) => {
    if (denyForeignSession(req, res, params.id)) return
    const session = store.getSession(params.id)
    if (!session) return sendError(res, 'not_found', `No session '${params.id}'`)
    const pp = pageParams(url)
    if (pp === 'invalid') return sendError(res, 'bad_request', `limit must be an integer 1..${MAX_PAGE_LIMIT}`)
    sendJson(res, paginate(session.compactedMessages ?? [], (message) => message.id, pp ?? { limit: 40 }))
  })
  // CONTINUE a conversation from one of its turns, into the caller's namespace
  // (social S3). Existence-hiding on an unreadable source; `propose` tier to act.
  r.post('/sessions/:id/fork', async ({ req, res, params, body }) => {
    const tenantId = store.identity(req.headers).tenant.id
    const idempotencyKey = headerValue(req.headers, 'idempotency-key')
    const logicalSessionId = idempotencyKey
      ? sessionForkCreationId(tenantId, idempotencyKey)
      : undefined
    // This create owns its durable identity rather than a cached response. A
    // replay returns current creator truth before parsing changed retry input,
    // and deletion retirement prevents a delayed resurrection.
    const represented = logicalSessionId
      ? store.getSessionCreation(logicalSessionId, tenantId)
      : undefined
    if (typeof represented === 'object') return sendJson(res, represented)
    if (represented === 'invalid') return sendError(res, 'bad_request', 'This conversation branch identity is not valid for this account')
    if (represented === 'retired') return sendError(res, 'not_found', 'This conversation branch was already removed')
    const { atMessageId } = await body<Partial<ForkSessionRequest>>()
    if (typeof atMessageId !== 'string' || !atMessageId.trim()) {
      return sendError(res, 'bad_request', 'atMessageId is required (a fork names the turn it continues from)')
    }
    let out: ReturnType<typeof store.forkSession>
    try {
      out = store.forkSession(params.id, atMessageId, tenantId, { logicalId: logicalSessionId })
    } catch (error) {
      if (error instanceof ValidationError) return sendError(res, 'bad_request', error.message)
      throw error
    }
    if (out === undefined) return sendError(res, 'not_found', `No session '${params.id}'`)
    if (out === 'forbidden') return sendError(res, 'forbidden', 'Continuing a conversation needs the propose tier')
    sendJson(res, out)
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
  // Draft creation owns durable identity itself. Bypassing the generic response
  // cache means Retry sees current row truth and can never replay a deleted or
  // since-renamed HTTP envelope.
  r.post('/sessions', async ({ req, res, body }) => {
    const tenantId = store.identity(req.headers).tenant.id
    const idempotencyKey = headerValue(req.headers, 'idempotency-key')
    const logicalSessionId = idempotencyKey
      ? sessionCreationId(tenantId, idempotencyKey)
      : undefined
    const represented = logicalSessionId
      ? store.getSessionCreation(logicalSessionId, tenantId)
      : undefined
    if (typeof represented === 'object') return sendJson(res, represented)
    if (represented === 'invalid') return sendError(res, 'bad_request', 'This conversation creation identity is not valid for this account')
    if (represented === 'retired') return sendError(res, 'not_found', 'This draft was already removed')
    const { firstMessage, persistFirstMessage, providerId, modelId } = await body<import('../../contract/index.ts').CreateSessionRequest>()
    if (persistFirstMessage !== undefined && persistFirstMessage !== true) {
      return sendError(res, 'bad_request', 'persistFirstMessage, when present, must be true')
    }
    if (persistFirstMessage && (typeof firstMessage !== 'string' || !firstMessage.trim())) {
      return sendError(res, 'bad_request', 'persistFirstMessage requires a non-empty firstMessage')
    }
    // Stamp the creating tenant so the scoped list/read above see it (F2/PD9).
    const bad = badSessionProvider(providerId, tenantId)
    if (bad) return sendError(res, 'not_found', bad)
    try {
      sendJson(res, store.createSession(
        firstMessage,
        tenantId,
        providerId,
        modelId,
        { logicalId: logicalSessionId, persistFirstMessage },
      ))
    } catch (err) {
      // A model pick outside the effective provider's catalog — refused, never normalized.
      if (err instanceof ValidationError) return sendError(res, 'bad_request', err.message)
      throw err
    }
  })
  // Edit a session's row fields (rename / pin / archive / model pick) from the
  // sidebar menu and the composer's model selector.
  r.patch('/sessions/:id', idempotent(async ({ req, res, params, body }) => {
    if (denyForeignSession(req, res, params.id)) return
    const input = await body<UpdateSessionRequest>()
    const { expectedRevision, ...patch } = input ?? {}
    if (
      expectedRevision !== undefined &&
      (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0)
    ) {
      return sendError(res, 'bad_request', 'expectedRevision must be a non-negative safe integer')
    }
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
    try {
      const session = store.patchSession(params.id, patch, expectedRevision)
      if (!session) return sendError(res, 'not_found', `No session '${params.id}'`)
      sendJson(res, sessionWithoutHistory(session))
    } catch (err) {
      // A model pick outside the effective provider's catalog — refused, never normalized.
      if (err instanceof ValidationError) return sendError(res, 'bad_request', err.message)
      if (err instanceof ConflictError) return sendError(res, err.code, err.message)
      throw err
    }
  }))
  // Viewer presentation intent is UI form, not a workspace capability: it
  // changes how this browser/person lays out a readable conversation, never the
  // shared conversation or what a model/MCP caller can do within it.
  r.uiFormPatch('/sessions/:id/preferences', 'viewer presentation preference; not a shared workspace capability', async ({ req, res, params, body }) => {
    if (denyForeignSession(req, res, params.id)) return
    const input = await body<Partial<UpdateSessionPreferencesRequest>>()
    if (!input || !Object.prototype.hasOwnProperty.call(input, 'panelFocus')) {
      return sendError(res, 'bad_request', 'panelFocus is required (null closes the panel)')
    }
    if (input.panelFocus !== null && !isPanelFocus(input.panelFocus)) {
      return sendError(res, 'bad_request', 'panelFocus must be null or a valid context focus')
    }
    try {
      sendJson(res, store.setSessionPreferences(store.identity(req.headers).user.id, params.id, input.panelFocus))
    } catch (error) {
      if (error instanceof ValidationError) return sendError(res, 'bad_request', error.message)
      throw error
    }
  })
  // Delete the exact conversation row reviewed by the caller. Legacy clients
  // may omit the precondition; first-party retries retain one idempotency key.
  r.delete('/sessions/:id', idempotent(async ({ req, res, params, body }) => {
    if (denyForeignSession(req, res, params.id)) return
    const { expectedRevision } = await body<DeleteSessionRequest>()
    if (
      expectedRevision !== undefined &&
      (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0)
    ) {
      return sendError(res, 'bad_request', 'expectedRevision must be a non-negative safe integer')
    }
    if (turns.bySession(params.id)) {
      return sendError(res, 'conflict', 'Wait for or cancel the current reply before deleting this conversation.')
    }
    if (activeCompactions.has(params.id)) {
      return sendError(res, 'conflict', 'Wait for the current summary to finish before deleting this conversation.')
    }
    try {
      if (!store.removeSession(params.id, expectedRevision)) {
        return sendError(res, 'not_found', `No session '${params.id}'`)
      }
    } catch (error) {
      if (error instanceof ConflictError) return sendError(res, error.code, error.message)
      throw error
    }
    sendJson(res, { ok: true })
  }))

  // Session ↔ context bindings — the attachment of record (Primitive 1 of
  // docs/shared-resource-coordination.md). Persisted server-side so every effect a
  // session initiates can be mediated by *naming* an attached context (Tiers A–C).
  // Attach/detach broadcast `session.contexts.changed`.
  r.aliasGet('/sessions/:id/contexts', 'GET /sessions/:id', 'session context is already projected as part of the session detail shown in the UI', ({ req, res, params }) => {
    if (denyForeignSession(req, res, params.id)) return
    if (!store.getSession(params.id)) return sendError(res, 'not_found', `No session '${params.id}'`)
    sendJson(res, store.sessionContexts(params.id))
  })
  // One mutation door for both halves of attached context: the authorization
  // bindings every effect is mediated against and the workspace users can see.
  // The old independent POST/DELETE context + PATCH workspace doors allowed a
  // request failure to commit only one half; this complete-state transaction is
  // deliberately idempotent so a lost acknowledgement can be retried safely.
  r.patch('/sessions/:id/context-state', async ({ req, res, params, body }) => {
    if (denyForeignSession(req, res, params.id)) return
    const input = await body<UpdateSessionContextStateRequest>()
    const ws = input?.workspace
    if (!input || !Array.isArray(input.operations)) {
      return sendError(res, 'bad_request', 'operations and workspace are required')
    }
    if (!ws || !Array.isArray(ws.workspaces) || !Array.isArray(ws.repos) || !Array.isArray(ws.connectors) || !Array.isArray(ws.attachments)) {
      return sendError(res, 'bad_request', 'workspaces, repos, connectors, and attachments arrays are required')
    }
    if (!store.getSession(params.id)) return sendError(res, 'not_found', `No session '${params.id}'`)
    for (const operation of input.operations) {
      if (!operation || (operation.action !== 'attach' && operation.action !== 'detach')) {
        return sendError(res, 'bad_request', 'each operation must attach or detach')
      }
      if (operation.action === 'detach') {
        if (typeof operation.contextId !== 'string' || operation.contextId.length === 0) {
          return sendError(res, 'bad_request', 'detach contextId is required')
        }
        continue
      }
      const context = operation.context
      if (
        !context ||
        typeof context.id !== 'string' || context.id.length === 0 ||
        typeof context.label !== 'string' || context.label.length === 0 ||
        !CONTEXT_TYPE_IDS.includes(context.type) ||
        (context.scope !== undefined && typeof context.scope !== 'string')
      ) {
        return sendError(res, 'bad_request', 'attach context requires a valid id, type, label, and optional scope')
      }
    }
    sendJson(res, store.updateSessionContextState(params.id, input.operations, ws))
  })

  // Send a turn → stream the assistant reply as SSE (mirrors the Anthropic
  // Messages API). The body carries typed events, not just text: an assistant
  // turn can escalate the session or propose relation edits mid-stream.
  //
  // The reply text streams from the Anthropic Messages endpoint (the mock model
  // server in dev; api.anthropic.com in prod) via the SDK — see server/generate.
  // We relay the model's text deltas, then append the app-domain relation
  // proposals as `message.relations` before `message.end`.
  r.intrinsicPost('/sessions/:id/messages', 'the in-app session realizes conversation input intrinsically; a recursive send-message tool would create a second conversation inside the turn', async ({ req, res, params, body }) => {
    if (denyForeignSession(req, res, params.id)) return
    // The caller's tenant — usage is metered + budget-gated per tenant (F2/PD9), so one
    // tenant's spend neither 429s nor shows up in another's gauge. Resolved once for the turn.
    const tenantId = store.identity(req.headers).tenant.id
    const { text, ephemeral, retryLastUser } = await body<SendMessageRequest>()

    // Idempotent send (design §5.4, invariant I4): a RETRY of the same logical
    // send — same session + `Idempotency-Key` — must never double-append the user
    // turn or start a second generation. Checked BEFORE the spend gate below:
    // recognizing a retry consumes no new tokens, so it must not be 429able.
    // Retransmission is attach/replay:
    //   • the turn is still live → this response becomes another VIEW of it,
    //     replaying from the top then following the live tail;
    //   • the turn finished and persisted → replay the terminal `message.end`
    //     with the recorded message (the record is the authority);
    //   • the turn finished WITHOUT an assistant record → fall through and
    //     genuinely retry; `retryLastUser` below reuses a persisted orphaned
    //     user row, while an ephemeral turn remains fully ephemeral.
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
    if (known && activeCompactions.has(params.id)) {
      return sendError(res, 'conflict', 'This conversation is being compacted. Retry your turn after the summary appears.')
    }
    const persistedTail = known?.messages?.at(-1)
    // A retry after a server restart or failed generation has no transient turn
    // handle to attach to, but its user row is still the record. Reuse that row
    // only when it is the unresolved tail AND its exact text matches. When the
    // first request was refused before persistence, there is no matching user
    // tail and the retry proceeds as an ordinary first append.
    const reusePersistedUser =
      retryLastUser === true &&
      !ephemeral &&
      persistedTail?.role === 'user' &&
      persistedTail.content === (text ?? '')
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
    const providerFace = store.listProviders(tenantId).find((candidate) => candidate.id === turnProviderId)
    // The session's concrete model pick (`session.modelId`, catalog-validated at
    // write time) overrides the provider's configured model for THIS session's
    // turns — riding the same server-only `model` field a turn already resolves
    // (`config.model ?? env default`), so generation needs no new seam. The
    // resolved id is also the per-turn provenance stamp below; a Session provider's
    // model is whatever session drains its mailbox, so its turns carry none.
    const turnConfig = known?.modelId ? { ...provider, model: known.modelId } : provider
    const turnModelId = provider.kind === 'session' ? undefined : resolvedModelId(turnConfig)
    // Release profiles never silently fall back to the deterministic mock. An
    // endpoint whose server-owned connection is incomplete refuses before the
    // user row, spend, or live-turn slot changes — the same fail-before-write
    // posture as relay liveness and plan limits. UI affordances mirror this
    // status, but this wall also protects MCP and older clients.
    if (provider.kind !== 'session' && providerFace?.execution === 'unconfigured') {
      return sendError(
        res,
        'capability_unavailable',
        `The '${providerFace.label}' model provider is not configured. Choose a connected provider or add one in Models.`,
      )
    }
    // The relay pre-turn gate (docs/delegated-cognition-provider.md §7.2): a turn on a
    // Session provider refuses BEFORE the user turn persists — the spend gate's shape —
    // when no drain loop is bound (offline), when THIS conversation's previous turn is
    // still in flight, or when the relay is at its concurrent-conversation ceiling
    // (v4 multi-session: other sessions' turns run concurrently, each channel one at a
    // time). Nothing half-writes; retry is free; a dead relay never wedges a turn.
    if (provider.kind === 'session') {
      const relayId = turnProviderId
      if (!relayId || !store.relay.online(relayId)) {
        return sendError(res, 'relay_offline', 'Your session isn’t answering — start its drain loop and retry.')
      }
      if (store.relay.busy(relayId, params.id)) {
        return sendError(res, 'relay_busy', 'Your session is still answering this conversation’s previous turn — retry when it finishes.')
      }
      if (store.relay.atCapacity(relayId)) {
        // The ceiling names itself: the NEGOTIATED window (what the binding's own
        // polls advertised, bounded by the server cap) — a serial far side reads
        // "limit 1", so the refusal is never a mystery.
        const window = store.relay.window(relayId)
        return sendError(
          res,
          'relay_busy',
          `Your session is already answering its maximum number of conversations (limit ${window}) — retry when one finishes.`,
        )
      }
    }
    // The relay prompt's self-contained history (v4): the channel's prior turns,
    // snapshotted BEFORE the new user turn persists below (appendMessage swaps the
    // array on this same session object). Dial-out turns don't read this — their
    // endpoint transport is out of scope here.
    const historySource = reusePersistedUser ? (known?.messages ?? []).slice(0, -1) : (known?.messages ?? [])
    const turnHistory = historySource
      .filter((m) => (m.role === 'user' || m.role === 'assistant') && m.content.trim().length > 0)
      .map((m) => ({ role: m.role, text: m.content }))
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
        if (persist && !reusePersistedUser) {
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
      // The live Agent Commons registries, so a confirmed "commission the agent I
      // just made" / "create an agent on <provider>" resolves the names the model
      // proposes against what currently exists (server/model/tools.ts). Tenant-scoped
      // (F2/PD9): the model only resolves against the caller's own + the shared seeds.
      // Shared by BOTH transports — a relayed tool call resolves against the same
      // registries a dial-out one does.
      const graphNow = store.relationGraph(tenantId)
      const commons = {
        // isDefault rides along so create_agent can pre-select the caller's
        // default-else-first binding when the model names none — the same
        // shortcut the New-agent dialog applies (contract `defaultEntry`).
        providers: store.listProviders(tenantId).map((p) => ({ id: p.id, label: p.label, isDefault: p.isDefault })),
        systemPrompts: store.listSystemPrompts(tenantId).map((p) => ({ id: p.id, label: p.label, isDefault: p.isDefault })),
        agents: store.listAgents(tenantId).map((a) => ({ id: a.id, label: a.label })),
        commissions: store.listCommissions(undefined, tenantId).map((c) => ({ id: c.id, agentId: c.agentId, projectId: c.projectId })),
        // The LIVE entity registries the relation tools resolve names against —
        // created entities (the graph extras) first, then the seeds, so "file this
        // under ‹a project Claude created two turns ago›" resolves (a seed-only
        // list once defaulted that to the wrong project — INV-9).
        projects: [...graphNow.extraProjects, ...store.listProjects(tenantId)].map((p) => ({
          id: p.id,
          name: p.name,
          defaultRole: p.defaultRole,
          description: graphNow.projectDescriptions[p.id] ?? p.description,
          instructions: graphNow.projectInstructions[p.id] ?? p.instructions,
        })),
        artifacts: [...graphNow.extraArtifacts, ...store.listArtifacts(tenantId)].map((a) => ({ id: a.id, name: a.name })),
        schedules: store.listSchedules(tenantId).map((s) => ({ id: s.id, name: s.name, cadence: s.cadence })),
        // The Contexts registry (user-saved connectors/MCP servers — custom ones
        // included) merged over the Add-context catalog, deduped by id.
        connectors: (() => {
          const byId = new Map(CONNECTOR_OPTIONS.map((c) => [c.id, { id: c.id, label: c.label, kind: c.kind }]))
          for (const c of store.savedContexts(tenantId).contexts) {
            if (c.kind === 'connector' || c.kind === 'mcp') byId.set(c.id, { id: c.id, label: c.label, kind: c.connectorKind })
          }
          return [...byId.values()]
        })(),
      }
      // P6: the session's attached connector/MCP contexts become callable tools for
      // this turn (server/model/connectorTools.ts derives them; non-connector
      // contexts are ignored). Only what's attached is reachable — on either transport.
      const contexts = store.sessionContexts(params.id)
      // The transport dispatch (docs/delegated-cognition-provider.md §6.5): dial-out
      // Messages (`generateReply`, N providers, zero provider code) vs the rendezvous
      // relay (`relayReply` — the user's own session answers over the framed mailbox,
      // relaying tool calls unexecuted; its own deadline, never `MODEL_TIMEOUT_MS`).
      // One `if` where a loopback shim isn't.
      // The generated API tools' runtime (access-parity INV-11, the in-app leg):
      // reads dispatch through the router NOW with THIS request's headers — the
      // sender's identity, so the model reads exactly what its user can read —
      // and mutations only mint proposals (executed later by the tool-activities
      // route, as the confirmer). Same catalog as the MCP door.
      const apiRuntime = {
        catalog: apiCatalog(),
        dispatch: (method: string, path: string, body?: unknown) => apiDispatch(method, path, req.headers, body),
      }
      const { message, usage, outcome } =
        provider.kind === 'session'
          ? await relayReply(session, agent, text ?? '', replyHandlers, ac.signal, store.relay, turnProviderId!, commons, contexts, turnHistory, apiRuntime)
          : await generateReply(session, agent, text ?? '', replyHandlers, ac.signal, turnConfig, commons, contexts, apiRuntime, {}, turnHistory)
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
      const stamped = { ...message, agentId: agent.id, providerId: turnProviderId, ...(turnModelId ? { modelId: turnModelId } : {}) }
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
        const partial: Message = { id: messageId, role: 'assistant', content: streamedText, agentId: agent.id, providerId: turnProviderId, ...(turnModelId ? { modelId: turnModelId } : {}) }
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
  r.intrinsicPost('/sessions/:id/turns/:turnId/cancel', 'live-turn cancellation is intrinsic host control for the in-app session', ({ req, res, params }) => {
    if (denyForeignSession(req, res, params.id)) return
    const turn = turns.get(params.turnId)
    if (!turn || turn.sessionId !== params.id) {
      return sendError(res, 'not_found', `No live turn '${params.turnId}' on session '${params.id}'`)
    }
    turns.cancel(params.turnId)
    sendJson(res, { ok: true })
  })

  // Decide ONE proposed relation edit (the consent card's resolution) on the
  // message that carried it. A keyed first-party decision executes the immutable
  // stored operation and records its receipt in one durable batch; that receipt,
  // rather than the process-local response cache, owns exact retries across both
  // a lost response and a restart. Legacy unkeyed clients remain record-only.
  r.intrinsicPost('/sessions/:id/messages/:messageId/relations', 'relation proposal consent is intrinsic host control; the model cannot approve its own proposed effect', async ({ req, res, params, body }) => {
    if (denyForeignSession(req, res, params.id)) return
    const who = store.identity(req.headers)
    const session = store.getSession(params.id)
    if (session && !store.sessionOwnedBy(session, who.tenant.id)) {
      return sendError(res, 'forbidden', 'Only the conversation owner may decide its proposed changes')
    }
    const input = await body<unknown>()
    if (
      !input ||
      typeof input !== 'object' ||
      Array.isArray(input) ||
      Object.keys(input).some((field) => field !== 'key' && field !== 'verdict')
    ) {
      return sendError(res, 'bad_request', "body must contain only key and verdict: 'confirmed' or 'skipped'")
    }
    const { key, verdict } = input as Partial<ResolveMessageRelationRequest>
    if (typeof key !== 'string' || !key || (verdict !== 'confirmed' && verdict !== 'skipped')) {
      return sendError(res, 'bad_request', `A verdict needs an op key and 'confirmed' | 'skipped'`)
    }
    const idempotencyKey = headerValue(req.headers, 'idempotency-key')
    if (!idempotencyKey) {
      const resolved = store.resolveMessageRelation(params.id, params.messageId, key, verdict)
      if (resolved === 'invalid') {
        return sendError(res, 'bad_request', 'This proposed change already has a different recorded verdict')
      }
      if (!resolved) {
        return sendError(res, 'not_found', `No proposal '${key}' on message '${params.messageId}' of session '${params.id}'`)
      }
      return sendJson(res, { key, verdict })
    }
    const decisionId = relationActionDecisionId(
      who.tenant.id,
      params.id,
      params.messageId,
      key,
      idempotencyKey,
    )
    const represented = store.getMessageRelationDecision(
      params.id,
      params.messageId,
      key,
      decisionId,
      who.tenant.id,
      verdict,
    )
    if (typeof represented === 'object') return sendJson(res, represented)
    if (represented === 'invalid') {
      return sendError(res, 'bad_request', 'This relation decision identity is not valid for this conversation, proposal, and verdict')
    }
    try {
      const resolved = store.decideMessageRelation(
        params.id,
        params.messageId,
        key,
        verdict,
        decisionId,
        who.tenant.id,
      )
      if (resolved === 'forbidden') {
        return sendError(res, 'forbidden', 'This proposed change is no longer permitted for this conversation owner')
      }
      if (resolved === 'invalid') {
        return sendError(res, 'bad_request', 'This relation decision identity is not valid for this conversation, proposal, and verdict')
      }
      if (resolved) return sendJson(res, resolved)
      return sendError(res, 'not_found', `No proposal '${key}' on message '${params.messageId}' of session '${params.id}'`)
    } catch (error) {
      if (error instanceof ConflictError) return sendError(res, error.code, error.message)
      if (error instanceof LimitError) return sendError(res, error.code, error.message)
      if (error instanceof ValidationError) return sendError(res, error.code, error.message)
      throw error
    }
  })

  // Reattach to a live turn (design §5.2, invariants I1/I3/I4): replay the buffered
  // frames after `?after=<seq>`, then continue with the live tail, ending with the
  // same `message.end` the original stream carries. 404 once the turn is gone —
  // the persisted message is the authority and the client refetches the session.
  r.uiFormGet('/sessions/:id/turns/:turnId/stream', 'live turn SSE replay — synchronization transport, not a workspace capability', ({ req, res, params, url }) => {
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
  // connector/MCP writes). A read is attempted at generation time; an action only takes effect
  // here, on the user's approval, and is audited. Tenant-guarded like the other by-id
  // session routes (a foreign tenant can't confirm another's pending write).
  r.intrinsicPost('/sessions/:id/tool-activities/:activityId', 'consent resolution is intrinsic host control; a model must never confirm its own proposal', async ({ req, res, params, body }) => {
    if (denyForeignSession(req, res, params.id)) return
    const who = store.identity(req.headers)
    const session = store.getSession(params.id)
    if (session && !store.sessionOwnedBy(session, who.tenant.id)) {
      return sendError(res, 'forbidden', 'Only the conversation owner may decide its proposed tool actions')
    }
    const input = await body<unknown>()
    if (
      !input ||
      typeof input !== 'object' ||
      Array.isArray(input) ||
      Object.keys(input).some((field) => field !== 'decision')
    ) {
      return sendError(res, 'bad_request', "body must contain only decision: 'confirm' or 'decline'")
    }
    const decision = (input as Partial<ResolveToolActivityRequest>).decision
    if (decision !== 'confirm' && decision !== 'decline') {
      return sendError(res, 'bad_request', "decision must be 'confirm' or 'decline'")
    }
    const idempotencyKey = headerValue(req.headers, 'idempotency-key')
    const logicalDecisionId = idempotencyKey
      ? toolActivityDecisionId(who.tenant.id, params.id, params.activityId, idempotencyKey)
      : undefined
    const represented = logicalDecisionId
      ? store.getToolActivityDecision(
          params.id,
          params.activityId,
          logicalDecisionId,
          who.tenant.id,
          decision,
        )
      : undefined
    if (typeof represented === 'object') return sendJson(res, represented)
    if (represented === 'invalid') {
      return sendError(res, 'bad_request', 'This tool decision identity is not valid for this conversation, activity, and action')
    }
    // Every pending verdict wins one synchronous claim before any await. API
    // operations re-enter this router as the confirmer; connector/MCP actions
    // cross the shared runtime with the exact persisted model input. A refused
    // effect stays proposed so Retry and Decline both remain available.
    let doneSummary: string | undefined
    let claimed = false
    const pending = store.getToolActivity(params.id, params.activityId)
    try {
      if (pending?.kind === 'action' && pending.status === 'proposed') {
        // A consent record cannot authorize erasing itself. Direct conversation
        // deletion remains available through its dedicated reviewed workflow.
        if (
          decision === 'confirm' &&
          pending.op?.method === 'DELETE' &&
          pending.op.path === `/sessions/${encodeURIComponent(params.id)}`
        ) {
          return sendError(res, 'conflict', 'A conversation cannot delete the consent record it is carrying. Use Delete conversation instead.')
        }
        if (!store.claimToolActivity(params.id, params.activityId)) {
          return sendError(res, 'conflict', `Tool activity '${params.activityId}' is already being processed`)
        }
        claimed = true
        if (decision === 'confirm') {
          if (pending.op) {
            // The derived receipt is the INNER operation's disjoint retry key.
            // Each target route then supplies its declared guarantee: durable
            // identity across restart, or the legacy process-local response cache.
            const out = await apiDispatch(
              pending.op.method,
              pending.op.path,
              req.headers,
              pending.op.body,
              { idempotencyKey: logicalDecisionId },
            )
            if (out.status >= 400) {
              let detail = `HTTP ${out.status}`
              try {
                detail = JSON.parse(out.body.toString('utf8')).error.message ?? detail
              } catch {}
              return sendError(res, 'conflict', `The proposed operation was refused (${out.status}): ${detail}`)
            }
            doneSummary = `${pending.op.method} ${API_BASE_PATH}${pending.op.path} → ${out.status}`
          } else {
            const executed = await executeConnectorActivity(pending)
            if (!executed.ok) {
              store.recordAudit({
                tenantId: who.tenant.id,
                channel: 'proxy',
                capability: 'connector.write',
                target: pending.connector,
                outcome: 'denied',
              })
              return sendError(res, 'conflict', executed.message)
            }
            doneSummary = executed.summary
          }
        }
      }
      const activity = store.resolveToolActivity(
        params.id,
        params.activityId,
        decision,
        doneSummary,
        { logicalId: logicalDecisionId, tenantId: who.tenant.id },
      )
      claimed = false // resolve drops the claim before its durable commit
      if (activity === 'invalid') {
        return sendError(res, 'bad_request', 'This tool decision identity is not valid for this conversation, activity, and action')
      }
      if (!activity) return sendError(res, 'not_found', `No tool activity '${params.activityId}' on session '${params.id}'`)
      sendJson(res, activity)
    } finally {
      // Unexpected dispatch/runtime errors must not wedge Retry until process
      // restart. Ordinary refusals also arrive here with the proposal still open.
      if (claimed) store.releaseToolActivity(params.id, params.activityId)
    }
  })
  // Compact a session's active context through its selected provider. Generation
  // happens against an immutable preparation; only a matching transcript commits.
  r.post('/sessions/:id/compact', async ({ req, res, params }) => {
    if (denyForeignSession(req, res, params.id)) return
    if (activeCompactions.has(params.id)) {
      return sendError(res, 'conflict', 'A summary is already being prepared for this conversation.')
    }
    if (turns.bySession(params.id)) {
      return sendError(res, 'conflict', 'Wait for the current reply to finish before compacting this conversation.')
    }
    const prepared = store.prepareSessionCompaction(params.id)
    if (!prepared) return sendError(res, 'not_found', `No session '${params.id}'`)
    if (prepared.kind === 'noop') {
      return sendJson(res, { ...prepared.session, compactedMessages: undefined })
    }

    const tenantId = store.identity(req.headers).tenant.id
    const session = store.getSession(params.id)!
    const agent = store.getAgent(session.agentId)
    const providerId = session.providerId ?? agent.providerId ?? DEFAULT_PROVIDER_ID
    const provider = store.providerConfig(providerId)
    const providerFace = store.listProviders(tenantId).find((candidate) => candidate.id === providerId)
    const providerConfig = session.modelId ? { ...provider, model: session.modelId } : provider
    const modelId = provider.kind === 'session' ? undefined : resolvedModelId(providerConfig)

    if (provider.kind !== 'session' && providerFace?.execution === 'unconfigured') {
      return sendError(
        res,
        'capability_unavailable',
        `The '${providerFace.label}' model provider is not configured. Choose a connected provider before compacting.`,
      )
    }
    if (provider.kind === 'session') {
      if (!store.relay.online(providerId)) {
        return sendError(res, 'relay_offline', 'Your session isn’t answering — start its drain loop and retry compaction.')
      }
      if (store.relay.busy(providerId, params.id) || store.relay.atCapacity(providerId)) {
        return sendError(res, 'relay_busy', 'Your session is busy answering another request — retry compaction when it finishes.')
      }
    }
    const over = store.overSpendLimit(agent.budget, tenantId)
    if (over) {
      return sendError(res, 'limit_exceeded', `Plan limit reached for '${over.label}' — compaction is refused until the window resets.`)
    }

    activeCompactions.add(params.id)
    try {
      const generated = await summarizeConversation(prepared.sourceMessages, async (prompt) => {
        if (provider.kind !== 'session') return generateCompactionSummaryPart(prompt, providerConfig)
        const summaryAgent = {
          ...agent,
          systemPrompt: COMPACTION_SYSTEM_PROMPT,
          instructions: '',
          tools: [],
        }
        const result = await relayReply(
          { id: session.id, title: session.title },
          summaryAgent,
          prompt,
          { onStart: () => {}, onDelta: () => {} },
          undefined,
          store.relay,
          providerId,
        )
        if (result.outcome !== 'ok') {
          throw new CompactionGenerationError('Your session could not prepare a conversation summary. History was left unchanged.')
        }
        return { text: result.message.content, usage: result.usage }
      })

      // The provider consumed these tokens even if the compare-before-commit below
      // finds that another transcript mutation won the race.
      store.recordUsage(generated.usage.inputTokens, generated.usage.outputTokens, tenantId)
      const compacted = store.applySessionCompaction(prepared, generated.text, {
        agentId: agent.id,
        providerId,
        ...(modelId ? { modelId } : {}),
      })
      if (!compacted) return sendError(res, 'not_found', `No session '${params.id}'`)
      sendJson(res, { ...compacted, compactedMessages: undefined })
    } catch (error) {
      if (error instanceof ConflictError) return sendError(res, error.code, error.message)
      if (error instanceof CompactionGenerationError) {
        return sendError(res, 'capability_unavailable', error.message)
      }
      throw error
    } finally {
      activeCompactions.delete(params.id)
    }
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
      const tenantId = store.identity(req.headers).tenant.id
      const idempotencyKey = headerValue(req.headers, 'idempotency-key')
      sendJson(res, store.addDispatch(
        title.trim(),
        detail,
        tenantId,
        idempotencyKey ? manualDispatchRunId(tenantId, idempotencyKey) : undefined,
      ))
    } catch (err) {
      if (err instanceof LimitError) return sendError(res, err.code, err.message)
      throw err
    }
  }))

  // ── Contexts (set-up) + connector detail ──────────────────────────────────
  r.get('/saved-contexts', ({ req, res }) => {
    sendJson(res, store.savedContexts(store.identity(req.headers).tenant.id))
  })
  // Save a context to the set-up registry (the Contexts page's Add — server-owned,
  // so it survives navigation/reload and reaches every client). Idempotent by id.
  r.post('/saved-contexts', async ({ req, res, body }) => {
    const { context: input } = await body<{ context?: unknown }>()
    const context = savedContextFrom(input)
    if (!context) {
      return sendError(res, 'bad_request', 'a complete, valid saved context is required')
    }
    sendJson(res, store.addSavedContext(context, store.identity(req.headers).tenant.id))
  })
  // Remove the exact reusable setup the caller reviewed. Legacy clients may
  // omit the precondition; first-party retries retain one idempotency key.
  r.delete('/saved-contexts/:id', idempotent(async ({ req, res, params, body }) => {
    const { expectedRevision } = await body<DeleteSavedContextRequest>()
    if (
      expectedRevision !== undefined &&
      (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0)
    ) {
      return sendError(res, 'bad_request', 'expectedRevision must be a non-negative safe integer')
    }
    try {
      if (!store.removeSavedContext(
        params.id,
        store.identity(req.headers).tenant.id,
        expectedRevision,
      )) {
        return sendError(res, 'not_found', `No saved context '${params.id}'`)
      }
    } catch (error) {
      if (error instanceof ConflictError) return sendError(res, error.code, error.message)
      throw error
    }
    sendJson(res, { ok: true })
  }))
  // Set a saved connector / MCP server's auth status (connect / disconnect; the
  // OAuth-callback / token-expiry seam). Broadcasts `connector.status` and returns
  // the updated snapshot so the originating client reconciles immediately.
  r.patch('/saved-contexts/:id', idempotent(async ({ req, res, params, body }) => {
    const { status, expectedRevision } = await body<SetConnectorStatusRequest>()
    if (status !== 'connected' && status !== 'needs-auth') {
      return sendError(res, 'bad_request', "status must be 'connected' or 'needs-auth'")
    }
    if (
      expectedRevision !== undefined &&
      (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0)
    ) {
      return sendError(res, 'bad_request', 'expectedRevision must be a non-negative safe integer')
    }
    try {
      const snapshot = store.setConnectorStatus(
        params.id,
        status,
        store.identity(req.headers).tenant.id,
        expectedRevision,
      )
      if (!snapshot) return sendError(res, 'not_found', `No saved context '${params.id}'`)
      sendJson(res, snapshot)
    } catch (error) {
      if (error instanceof ConflictError) return sendError(res, error.code, error.message)
      throw error
    }
  }))
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
    // global aggregate. The context breakdown is session-scoped — and that session
    // read runs the SAME visibility wall every other by-id session route runs, or
    // `?session=<foreign id>` would be a cross-tenant token/model oracle (sequential
    // ids make it enumerable).
    const session = url.searchParams.get('session') ?? undefined
    if (session && denyForeignSession(req, res, session)) return
    const tenantId = store.identity(req.headers).tenant.id
    sendJson(res, store.usage(session, tenantId))
  })

  // ── Artifact bodies + schedule templates ──────────────────────────────────
  // Tenant-scoped like every other entity read (F2/PD9): the authored library
  // with the CALLER's edited bodies laid over it — their own artifacts' and
  // those a grant opened to them, nobody else's (social S3).
  r.get('/artifact-content', ({ req, res }) => {
    sendJson(res, store.artifactContent(store.identity(req.headers).tenant.id))
  })
  /** Rewrite one addressed prose block of an artifact's body — the OWNER's own
   *  editing door (social S3). Ownership, never mere visibility: a grant widens
   *  the READ, and a `view`-tier reader editing the document would be exactly
   *  the escalation the routine's write routes were retightened against. A
   *  visitor who wants a change offers an `artifact-patch` proposal instead —
   *  which lands through this very mutator, so there is one write path.
   *  Existence-hiding: an artifact the caller can't own 404s like a missing id. */
  r.patch('/artifacts/:id/content', idempotent(async ({ req, res, params, body }) => {
    const tenantId = store.identity(req.headers).tenant.id
    // Resolved across BOTH homes (seeded + graph-created), then walled on
    // OWNERSHIP — `listArtifacts` would silently 404 every created artifact.
    const artifact = store.artifactById(params.id)
    if (!artifact || !store.artifactOwnedBy(artifact, tenantId)) {
      return sendError(res, 'not_found', `No artifact '${params.id}'`)
    }
    const patch = await body<UpdateArtifactContentRequest>()
    if (typeof patch.block !== 'number' || typeof patch.text !== 'string') {
      return sendError(res, 'bad_request', 'block (number) and text (string) are required')
    }
    if (
      patch.expectedRevision !== undefined &&
      (!Number.isSafeInteger(patch.expectedRevision) || patch.expectedRevision < 0)
    ) {
      return sendError(res, 'bad_request', 'expectedRevision must be a non-negative safe integer')
    }
    try {
      const updated = store.updateArtifactBlock(params.id, patch.block, patch.text, patch.expectedRevision)
      // The mutator refuses anything it could not honestly apply (non-doc body,
      // unaddressable block, empty text) — a 400, not a silent no-op.
      if (!updated) return sendError(res, 'bad_request', 'That block cannot be edited')
      sendJson(res, updated)
    } catch (err) {
      if (err instanceof ConflictError) return sendError(res, err.code, err.message)
      throw err
    }
  }))
  r.get('/schedule-templates', ({ res }) => {
    sendJson(res, store.scheduleTemplates())
  })

  // ── Entity graph (Projects / Artifacts / Schedules) + the relationship graph ─
  // All tenant-scoped (F2/PD9): the six demo accounts each seed their own themed
  // slice (docs/demo-accounts.md), so every list answers as the caller's tenant.
  r.get('/projects', ({ req, res }) => {
    sendJson(res, store.listProjects(store.identity(req.headers).tenant.id))
  })
  // Direct form/remote creation mints identity inside the server transaction.
  // The in-app model realizes this capability through its consent-gated
  // create_project proposal instead of receiving a self-authorizing write tool.
  r.intrinsicPost('/projects', 'the in-app session proposes Project creation through the relation consent card; it never executes its own proposal', idempotent(async ({ req, res, body }) => {
    const input = await body<CreateProjectRequest>()
    if (!input || typeof input.name !== 'string') {
      return sendError(res, 'bad_request', 'name (string) is required')
    }
    if (input.description !== undefined && typeof input.description !== 'string') {
      return sendError(res, 'bad_request', 'description must be a string')
    }
    if (
      input.ownerTenantId !== undefined &&
      (typeof input.ownerTenantId !== 'string' || input.ownerTenantId.trim() === '')
    ) {
      return sendError(res, 'bad_request', 'ownerTenantId must be a non-empty string when present')
    }
    const tenantId = store.identity(req.headers).tenant.id
    try {
      const created = store.createProject(input, tenantId)
      if (!created) return sendError(res, 'not_found', 'No such Project owner')
      sendJson(res, created, 201)
    } catch (err) {
      if (err instanceof ValidationError) return sendError(res, err.code, err.message)
      if (err instanceof ConflictError) return sendError(res, err.code, err.message)
      throw err
    }
  }))
  r.get('/artifacts', ({ req, res, url }) => {
    sendList(res, url, store.listArtifacts(store.identity(req.headers).tenant.id), (a) => a.id)
  })
  r.get('/schedules', ({ req, res }) => {
    sendJson(res, store.listSchedules(store.identity(req.headers).tenant.id))
  })
  /** The by-id schedule wall (mirrors denyForeignSession): a foreign tenant's
   *  routine reads/mutates as 404 — indistinguishable from absent. */
  // The routine WRITE wall: ownership, never mere visibility. Every mutating routine route
  // uses this — otherwise widening the read to a granted audience would hand
  // them the edit, the run trigger and the delete along with it. Existence-hiding
  // is preserved: a non-owner who can see it still gets the same 404 as a
  // stranger, so the wall never confirms what it refuses.
  const notMySchedule = (req: IncomingMessage, id: string): boolean => {
    const task = store.listSchedules().find((t) => t.id === id)
    return !!task && !store.scheduleOwnedBy(task, store.identity(req.headers).tenant.id)
  }
  // Run a routine now (server appends + broadcasts the run).
  r.post('/schedules/:id/run', idempotent(({ req, res, params }) => {
    if (notMySchedule(req, params.id)) return sendError(res, 'not_found', `No schedule '${params.id}'`)
    const idempotencyKey = headerValue(req.headers, 'idempotency-key')
    const logicalRunId = idempotencyKey ? manualScheduleRunId(idempotencyKey) : undefined
    const run = store.runSchedule(params.id, logicalRunId
      ? { manualRunId: logicalRunId }
      : undefined)
    if (!run) return sendError(res, 'not_found', `No schedule '${params.id}'`)
    if (logicalRunId && run.id !== logicalRunId) {
      return sendError(res, 'conflict', 'Another run is already in progress. Retry after it finishes.')
    }
    sendJson(res, run)
  }))
  // Patch a routine's own fields — enabled, name, prompt, cadence, model, … (the
  // entity edits behind the detail page). Cross-entity bindings (deliver to an
  // artifact/session, add a tool) go through POST /relations/ops instead.
  r.patch('/schedules/:id', idempotent(async ({ req, res, params, body }) => {
    if (notMySchedule(req, params.id)) return sendError(res, 'not_found', `No schedule '${params.id}'`)
    const input = await body<UpdateScheduleRequest>()
    const { expectedRevision, ...patch } = input ?? {}
    if (
      expectedRevision !== undefined &&
      (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0)
    ) {
      return sendError(res, 'bad_request', 'expectedRevision must be a non-negative safe integer')
    }
    try {
      const task = store.updateSchedule(params.id, patch, expectedRevision)
      if (!task) return sendError(res, 'not_found', `No schedule '${params.id}'`)
      sendJson(res, task)
    } catch (err) {
      if (err instanceof ConflictError) return sendError(res, err.code, err.message)
      if (err instanceof ValidationError) return sendError(res, err.code, err.message)
      throw err
    }
  }))
  // Add a routine from a template's seed (lands paused, stamped with the caller's tenant).
  r.post('/schedules', idempotent(async ({ req, res, body }) => {
    const { seed } = await body<Partial<CreateScheduleRequest>>()
    if (!seed) return sendError(res, 'bad_request', 'seed is required')
    // Refuse a malformed seed with a descriptive 400 (INV-9) — the store trusts
    // these load-bearing fields, so a drifted machine caller (the MCP door's
    // generated tool) must be refused here, not crash inside addSchedule.
    if (typeof seed.name !== 'string' || typeof seed.prompt !== 'string' || !Array.isArray(seed.steps) || !Array.isArray(seed.runs) || typeof seed.delivery !== 'object' || seed.delivery === null) {
      return sendError(res, 'bad_request', 'seed needs string name/prompt, array steps/runs, and a delivery object (see the ScheduledTask contract)')
    }
    try {
      const tenantId = store.identity(req.headers).tenant.id
      const idempotencyKey = headerValue(req.headers, 'idempotency-key')
      sendJson(res, store.addSchedule(
        { ...seed, tenantId },
        idempotencyKey ? scheduleCreationId(tenantId, idempotencyKey) : undefined,
      ))
    } catch (err) {
      if (err instanceof ValidationError) return sendError(res, err.code, err.message)
      throw err
    }
  }))
  // Remove the exact routine definition the caller reviewed. Run progress is
  // orthogonal; deletion deliberately abandons it and cascades its sessions.
  r.delete('/schedules/:id', idempotent(async ({ req, res, params, body }) => {
    if (notMySchedule(req, params.id)) return sendError(res, 'not_found', `No schedule '${params.id}'`)
    const { expectedRevision } = await body<DeleteScheduleRequest>()
    if (
      expectedRevision !== undefined &&
      (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0)
    ) {
      return sendError(res, 'bad_request', 'expectedRevision must be a non-negative safe integer')
    }
    try {
      // Absence is convergent success: an acknowledgement can be lost after
      // the durable cascade and the idempotency cache need not survive restart.
      store.removeSchedule(params.id, expectedRevision)
    } catch (error) {
      if (error instanceof ConflictError) return sendError(res, error.code, error.message)
      throw error
    }
    sendJson(res, { ok: true })
  }))
  // The left rail's recent-runs feed (a single live source, the caller's routines only).
  r.aliasGet('/runs/recent', 'GET /schedules', 'recent routine runs are already represented by the schedules and routine-state projection in the UI', ({ req, res }) => {
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
  r.get('/recents', ({ req, res }) => {
    sendJson(res, store.recents(store.identity(req.headers).tenant.id))
  })
  r.post('/recents/:type', async ({ req, res, params, body }) => {
    const { id } = await body<PushRecentRequest>()
    if (typeof id !== 'string' || !id.trim() || id.length > 512) {
      return sendError(res, 'bad_request', 'id must be a non-empty string of at most 512 characters')
    }
    if (!CONTEXT_TYPE_IDS.includes(params.type as import('../../contract/index.ts').ContextTypeId)) {
      return sendError(res, 'bad_request', `Unknown context type '${params.type}'`)
    }
    sendJson(res, store.pushRecent(
      params.type as import('../../contract/index.ts').ContextTypeId,
      id.trim(),
      store.identity(req.headers).tenant.id,
    ))
  })
  // Apply a confirmed relation edit — the privileged write (a standing op
  // authorizes the schedule daemon). Returns the updated graph + broadcasts it.
  r.intrinsicPost('/relations/ops', 'relation consent is realized by the session\'s purpose-built proposal cards; the model never executes its own proposal', idempotent(async ({ req, res, body }) => {
    const { op } = await body<ApplyOpRequest>()
    if (!op || typeof op.kind !== 'string') return sendError(res, 'bad_request', 'op is required')
    // Project prose carries an optional exact-content precondition. Validate
    // both desired and expected fields before tenant checks or store effects;
    // `undefined` alone has the legacy unconditional-write meaning.
    if (op.kind === 'set-project-description') {
      if (typeof op.description !== 'string') {
        return sendError(res, 'bad_request', 'description (string) is required')
      }
      if (op.expectedDescription !== undefined && typeof op.expectedDescription !== 'string') {
        return sendError(res, 'bad_request', 'expectedDescription must be a string when present')
      }
    }
    if (op.kind === 'set-project-instructions') {
      if (typeof op.instructions !== 'string') {
        return sendError(res, 'bad_request', 'instructions (string) is required')
      }
      if (op.expectedInstructions !== undefined && typeof op.expectedInstructions !== 'string') {
        return sendError(res, 'bad_request', 'expectedInstructions must be a string when present')
      }
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

  // ── The MCP door (access-parity INV-11 — server/mcp.ts) ─────────────────────
  // Registered LAST so the route table its tool catalog derives from is
  // complete. It adds no policy of its own: every tools/call re-enters this
  // router and meets the same wall.
  registerMcp(r)
  // Bind the shared API surface (catalog + dispatch) the OTHER non-HTTP door —
  // the in-app session's generated tools — reaches operations through.
  bindApiSurface(r)

  return r
}
