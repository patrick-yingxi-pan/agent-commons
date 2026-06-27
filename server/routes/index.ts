/** Route table for the mock backend. Each resource registers its endpoints here;
 *  Phase 1 wires capabilities, the ambient event stream, and sessions. The router
 *  is plain data — adding a resource is adding a `.get(...)` line. */
import type {
  ApplyOpRequest,
  AttachContextRequest,
  CreateCommissionRequest,
  CreateDispatchRequest,
  PushRecentRequest,
  RegisterRunnerRequest,
  SendMessageRequest,
  SetRunnerCapabilitiesRequest,
  SetConnectorStatusRequest,
  UpdateScheduleRequest,
} from '../../contract/index.ts'
import { Router } from '../http/router.ts'
import { sendJson, sendError } from '../http/respond.ts'
import { openSse } from '../http/sse.ts'
import { store } from '../store.ts'
import { generateReply } from '../generate.ts'
import { CapabilityError, runCapability, scopeMatches } from '../agent-runtime.ts'
import { GuardianError } from '../guardian.ts'
import { BudgetError } from '../usage.ts'
import { AuthorityError } from '../authority.ts'
import { isMonotonic } from '../../contract/index.ts'
import type {
  CapabilityRequest,
  ReserveRequest,
  SetCapacityRequest,
  SyncEffectsRequest,
} from '../../contract/index.ts'
import type { ServerResponse } from 'node:http'

/** Gate a native route on a capability: 409 capability_unavailable when this
 *  backend (a remote web server) can't fulfill it. Returns whether to proceed. */
function gate(res: ServerResponse, feature: 'localFs' | 'localGit' | 'osPicker' | 'clipboard'): boolean {
  if (store.can(feature)) return true
  sendError(res, 'capability_unavailable', `'${feature}' needs the native backend; this is a remote web server.`)
  return false
}

export function buildRouter(): Router {
  const r = new Router()

  // ── Capabilities ────────────────────────────────────────────────────────
  // What this backend variant can do. The default mock behaves like a native
  // sidecar (local-* true); `BACKEND=remote` makes it a remote web server
  // (local-* false). The UI adapts off these flags, never off env-sniffing.
  r.get('/capabilities', ({ res }) => {
    sendJson(res, store.capabilities())
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
  r.post('/runners', async ({ res, body }) => {
    const input = await body<RegisterRunnerRequest>()
    if (!input?.label || !input?.host || !Array.isArray(input.capabilities)) {
      return sendError(res, 'bad_request', 'label, host, and capabilities are required')
    }
    sendJson(res, store.registry.register(input))
  })
  r.post('/runners/:id/heartbeat', ({ res, params }) => {
    const runner = store.registry.heartbeat(params.id)
    if (!runner) return sendError(res, 'not_found', `No runner '${params.id}'`)
    sendJson(res, runner)
  })
  r.patch('/runners/:id/capabilities', async ({ res, params, body }) => {
    const { capabilities } = await body<SetRunnerCapabilitiesRequest>()
    if (!Array.isArray(capabilities)) {
      return sendError(res, 'bad_request', 'capabilities is required')
    }
    const runner = store.registry.setCapabilities(params.id, capabilities)
    if (!runner) return sendError(res, 'not_found', `No runner '${params.id}'`)
    sendJson(res, runner)
  })
  r.delete('/runners/:id', ({ res, params }) => {
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
  // and referenceable by id, like a Runner, never attached per-thread. Read-only on
  // the wire for now (one seeded instance; minting is the `store.createProvider`
  // funnel, exercised by tests). The server-only credential/model config never
  // crosses this boundary.
  r.get('/providers', ({ res }) => {
    sendJson(res, store.listProviders())
  })
  r.get('/providers/:id', ({ res, params }) => {
    // `listProviders().find`, not `store.getProvider` — the latter falls back to the
    // default for an unknown id (the resolve-for-a-turn contract), which would mask a
    // 404 here. The wire read must distinguish "no such provider".
    const provider = store.listProviders().find((p) => p.id === params.id)
    if (!provider) return sendError(res, 'not_found', `No provider '${params.id}'`)
    sendJson(res, provider)
  })

  // ── System-prompt library (the cognition half — docs/agent-commons.md, D10) ──
  // The reusable, target-family-tagged prompts a user picks for an Agent. Read-only
  // on the wire; the (prompt × provider) fit warning is computed client-side from the
  // shared pure `promptFitWarning`, surfaced in the picker at selection time.
  r.get('/system-prompts', ({ res }) => {
    sendJson(res, store.listSystemPrompts())
  })
  r.get('/system-prompts/:id', ({ res, params }) => {
    const entry = store.getSystemPrompt(params.id)
    if (!entry) return sendError(res, 'not_found', `No system prompt '${params.id}'`)
    sendJson(res, entry)
  })

  // ── Commissions (the agent→Project assignment — docs/agent-commons.md, D7/D13) ──
  // A Project's Contributors. `GET /commissions?project=<id>` filters to one Project.
  // `POST` mints through the leaf of the D8 cascade (commission ⊆ agent ⊆ provider):
  // an over-grant on either face is a 400 (an impossible grant was named), an unknown
  // agent / project a 404.
  r.get('/commissions', ({ res, url }) => {
    sendJson(res, store.listCommissions(url.searchParams.get('project') ?? undefined))
  })
  r.get('/commissions/:id', ({ res, params }) => {
    const commission = store.getCommission(params.id)
    if (!commission) return sendError(res, 'not_found', `No commission '${params.id}'`)
    sendJson(res, commission)
  })
  r.post('/commissions', async ({ res, body }) => {
    const input = await body<CreateCommissionRequest>()
    if (!input?.agentId || !input?.projectId) {
      return sendError(res, 'bad_request', 'agentId and projectId are required')
    }
    if (!store.listAgents().some((a) => a.id === input.agentId)) {
      return sendError(res, 'not_found', `No agent '${input.agentId}'`)
    }
    if (!store.listProjects().some((p) => p.id === input.projectId)) {
      return sendError(res, 'not_found', `No project '${input.projectId}'`)
    }
    try {
      sendJson(res, store.createCommission(input))
    } catch (err) {
      // An over-grant on either cascade face — the request named an impossible grant.
      if (err instanceof BudgetError || err instanceof AuthorityError) {
        return sendError(res, 'bad_request', err.message)
      }
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

  // ── Native resources (a native sidecar fulfills these; a remote server 409s) ─
  // The same endpoints exist in both backends — only the fulfilment differs. This
  // is what lets ONE UI run as a native desktop app and as a web app unchanged.
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
    const unsubscribe = store.subscribe((e) => channel.send(e))
    req.on('close', () => {
      unsubscribe()
      channel.close()
    })
  })

  // ── Sessions ──────────────────────────────────────────────────────────────
  r.get('/sessions', ({ res }) => {
    sendJson(res, store.listSessions())
  })
  r.get('/sessions/:id', ({ res, params }) => {
    // A scheduled run *is* a session — resolve `srun-*` ids to the synthesized run
    // session (which reflects the current, live runs).
    const session = store.getSession(params.id) ?? store.runSession(params.id)
    if (!session) return sendError(res, 'not_found', `No session '${params.id}'`)
    sendJson(res, session)
  })
  // Materialize a new persisted session — a draft becomes real on its first send
  // (the client posts here, adopts the returned id, then streams the turn to it).
  r.post('/sessions', async ({ res, body }) => {
    const { firstMessage } = await body<import('../../contract/index.ts').CreateSessionRequest>()
    sendJson(res, store.createSession(firstMessage))
  })
  // Edit a session's row fields (rename / pin / archive) from the sidebar menu.
  r.patch('/sessions/:id', async ({ res, params, body }) => {
    const patch = await body<{ title?: string; status?: 'active' | 'archived'; pinned?: boolean }>()
    const session = store.patchSession(params.id, patch)
    if (!session) return sendError(res, 'not_found', `No session '${params.id}'`)
    sendJson(res, session)
  })
  // Delete a session (the row menu's "Delete").
  r.delete('/sessions/:id', ({ res, params }) => {
    if (!store.removeSession(params.id)) return sendError(res, 'not_found', `No session '${params.id}'`)
    sendJson(res, { ok: true })
  })

  // Session ↔ context bindings — the attachment of record (Primitive 1 of
  // docs/shared-resource-coordination.md). Persisted server-side so every effect a
  // session initiates can be mediated by *naming* an attached context (Tiers A–C).
  // Attach/detach broadcast `session.contexts.changed`.
  r.get('/sessions/:id/contexts', ({ res, params }) => {
    sendJson(res, store.sessionContexts(params.id))
  })
  r.post('/sessions/:id/contexts', async ({ res, params, body }) => {
    const input = await body<AttachContextRequest>()
    if (!input?.id || !input?.type || !input?.label) {
      return sendError(res, 'bad_request', 'id, type, and label are required')
    }
    sendJson(res, store.attachContext(params.id, {
      id: input.id,
      type: input.type,
      label: input.label,
      scope: input.scope ?? '*',
    }))
  })
  r.delete('/sessions/:id/contexts/:contextId', ({ res, params }) => {
    const next = store.detachContext(params.id, params.contextId)
    if (!next) return sendError(res, 'not_found', `No context '${params.contextId}' on session '${params.id}'`)
    sendJson(res, next)
  })

  // The session's live workspace — its panels (workspaces / repos / connectors /
  // attachments). Server-owned so a runtime attach survives a reload, the way the
  // conversation does. The client write-throughs the merged panels it assembled
  // from the (server-owned) context catalogs; the server stores them as the system
  // of record and returns the full session. Broadcasts `session.updated`.
  r.patch('/sessions/:id/workspace', async ({ res, params, body }) => {
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
    try {
      const { message, usage } = await generateReply(
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
      )
      // Meter the real tokens this turn consumed (even ephemeral tour turns —
      // they hit the model too), so the composer's plan-usage rings reflect use.
      store.recordUsage(usage.inputTokens, usage.outputTokens)
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
      // The model's reply text is canned (the mock model server) but its
      // *persistence* is real: record the assistant turn so the thread is the
      // system of record, then close the stream. The tour (ephemeral) skips this.
      if (persist) store.appendMessage(params.id, message)
      channel.send({ type: 'message.end', sessionId: session.id, message })
    } catch {
      // Aborted (client closed) or a fatal error — nothing more to send.
    } finally {
      channel.close()
    }
  })

  // ── Dispatch ──────────────────────────────────────────────────────────────
  r.get('/dispatch', ({ res }) => {
    sendJson(res, store.listDispatch())
  })
  // Kick off a one-off dispatch (lands 'running', finishes 'done' a beat later).
  r.post('/dispatch', async ({ res, body }) => {
    const { title, detail } = await body<CreateDispatchRequest>()
    if (!title || !title.trim()) return sendError(res, 'bad_request', 'title is required')
    sendJson(res, store.addDispatch(title.trim(), detail))
  })

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
  r.get('/usage', ({ res, url }) => {
    sendJson(res, store.usage(url.searchParams.get('session') ?? undefined))
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
  r.get('/artifacts', ({ res }) => {
    sendJson(res, store.listArtifacts())
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
  r.post('/schedules', async ({ res, body }) => {
    const { seed } = await body<{ seed?: Omit<import('../../contract/index.ts').ScheduledTask, 'id'> }>()
    if (!seed) return sendError(res, 'bad_request', 'seed is required')
    sendJson(res, store.addSchedule(seed))
  })
  // Remove a routine.
  r.delete('/schedules/:id', ({ res, params }) => {
    store.removeSchedule(params.id)
    sendJson(res, { ok: true })
  })
  // The left rail's recent-runs feed (a single live source).
  r.get('/runs/recent', ({ res }) => {
    sendJson(res, store.recentRuns())
  })
  r.get('/relations', ({ res }) => {
    sendJson(res, store.relationGraph())
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
  r.post('/relations/ops', async ({ res, body }) => {
    const { op } = await body<ApplyOpRequest>()
    if (!op || typeof op.kind !== 'string') return sendError(res, 'bad_request', 'op is required')
    sendJson(res, store.applyRelationOp(op))
  })

  return r
}
