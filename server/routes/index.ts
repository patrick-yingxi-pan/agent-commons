/** Route table for the mock backend. Each resource registers its endpoints here;
 *  Phase 1 wires capabilities, the ambient event stream, and sessions. The router
 *  is plain data — adding a resource is adding a `.get(...)` line. */
import type { ApplyOpRequest, SendMessageRequest } from '../../contract/index.ts'
import { Router } from '../http/router.ts'
import { sendJson, sendError } from '../http/respond.ts'
import { openSse } from '../http/sse.ts'
import { store } from '../store.ts'
import { generateReply } from '../generate.ts'
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

  // Send a turn → stream the assistant reply as SSE (mirrors the Anthropic
  // Messages API). The body carries typed events, not just text: an assistant
  // turn can escalate the session or propose relation edits mid-stream.
  //
  // The reply text streams from the Anthropic Messages endpoint (the mock model
  // server in dev; api.anthropic.com in prod) via the SDK — see server/generate.
  // We relay the model's text deltas, then append the app-domain relation
  // proposals as `message.relations` before `message.end`.
  r.post('/sessions/:id/messages', async ({ req, res, params, body }) => {
    const { text } = await body<SendMessageRequest>()
    // A draft / run session may not be persisted; reply with a generic shell.
    const known = store.getSession(params.id)
    const session = known
      ? { id: known.id, title: known.title, isDemo: known.isDemo }
      : { id: params.id, title: 'New session', isDemo: false }

    const channel = openSse(res)
    const ac = new AbortController()
    req.on('close', () => ac.abort())

    let messageId = ''
    try {
      const message = await generateReply(
        session,
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
      )
      if (message.relationActions?.length) {
        channel.send({
          type: 'message.relations',
          sessionId: session.id,
          messageId: message.id,
          relationActions: message.relationActions,
        })
      }
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

  // ── Contexts (set-up) + connector detail ──────────────────────────────────
  r.get('/saved-contexts', ({ res }) => {
    sendJson(res, store.savedContexts())
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
  r.get('/usage', ({ res }) => {
    sendJson(res, store.usage())
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
  // Set a routine's enabled state (or toggle when `enabled` is omitted).
  r.patch('/schedules/:id', async ({ res, params, body }) => {
    const { enabled } = await body<{ enabled?: boolean }>()
    const task = store.setScheduleEnabled(params.id, enabled)
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
    const { id } = await body<{ id?: string }>()
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
