/** Route table for the mock backend. Each resource registers its endpoints here;
 *  Phase 1 wires capabilities, the ambient event stream, and sessions. The router
 *  is plain data — adding a resource is adding a `.get(...)` line. */
import type { Capabilities } from '../../contract/index.ts'
import { Router } from '../http/router.ts'
import { sendJson, sendError } from '../http/respond.ts'
import { openSse } from '../http/sse.ts'
import { store } from '../store.ts'

export function buildRouter(): Router {
  const r = new Router()

  // ── Capabilities ────────────────────────────────────────────────────────
  // The mock advertises a *native-like* backend, so the UI renders the full
  // experience (local folders, local repos). A remote web server would report
  // the local-* flags false; the UI adapts off these flags, never off env.
  r.get('/capabilities', ({ res }) => {
    const caps: Capabilities = {
      backend: 'mock',
      epoch: store.epoch,
      features: {
        localFs: true,
        localGit: true,
        osPicker: true,
        clipboard: true,
        scheduledExecution: true,
        streaming: true,
      },
    }
    sendJson(res, caps)
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
    const session = store.getSession(params.id)
    if (!session) return sendError(res, 'not_found', `No session '${params.id}'`)
    sendJson(res, session)
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

  // ── Artifact bodies + schedule templates ──────────────────────────────────
  r.get('/artifact-content', ({ res }) => {
    sendJson(res, store.artifactContent())
  })
  r.get('/schedule-templates', ({ res }) => {
    sendJson(res, store.scheduleTemplates())
  })

  return r
}
