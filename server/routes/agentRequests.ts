/** The private two-person request channel. Ordinary reads and creation remain
 * shared capabilities; decisions are human consent, not model self-consent. */
import { headerValue, sendError, sendJson, type Ctx } from '../http/respond.ts'
import type { Router } from '../http/router.ts'
import { AGENT_REQUEST_CREATE_MAX_BYTES, AGENT_REQUEST_DECISION_MAX_BYTES } from '../../contract/agentRequests.ts'
import { store } from '../store/index.ts'
import { ProxyRequestError } from '../proxyRequestRegistry.ts'

function refuse(res: Ctx['res'], error: unknown): void {
  if (!(error instanceof ProxyRequestError)) throw error
  const errors = {
    invalid: ['bad_request', 'Use one exact Agent request with a bounded task and revision.'],
    unavailable: ['not_found', 'This Agent request is unavailable.'],
    conflict: ['conflict', 'This request changed. Read its current status before deciding; no work was repeated.'],
    limit: ['limit_exceeded', 'Agent request history or active-work capacity is full.'],
  } as const
  const [code, message] = errors[error.code]
  sendError(res, code, message)
}

export function registerAgentRequestRoutes(router: Router, sourceMatches: (req: Ctx['req'], res: Ctx['res']) => boolean): void {
  router.get('/agent-request-options', ({ req, res }) => {
    res.setHeader('Cache-Control', 'no-store')
    if (!sourceMatches(req, res)) return
    const actor = store.agentRequestActor(req.headers)
    if (!actor) return refuse(res, new ProxyRequestError('unavailable'))
    sendJson(res, store.agentRequestOptions(actor))
  })
  router.get('/agent-requests', ({ req, res }) => {
    res.setHeader('Cache-Control', 'no-store')
    if (!sourceMatches(req, res)) return
    const actor = store.agentRequestActor(req.headers)
    if (!actor) return refuse(res, new ProxyRequestError('unavailable'))
    sendJson(res, store.agentRequests(actor))
  })
  router.get('/agent-requests/:id', ({ req, res, params }) => {
    res.setHeader('Cache-Control', 'no-store')
    if (!sourceMatches(req, res)) return
    const actor = store.agentRequestActor(req.headers)
    const row = actor && store.agentRequest(params.id, actor)
    if (!row) return refuse(res, new ProxyRequestError('unavailable'))
    sendJson(res, row)
  })
  router.intrinsicGet('/agent-requests/:id/review', 'the owner reviews private connection choices for human Run consent; the model cannot select its own consent', ({ req, res, params }) => {
    res.setHeader('Cache-Control', 'no-store')
    if (!sourceMatches(req, res)) return
    const actor = store.agentRequestActor(req.headers)
    const review = actor && store.agentRequestReview(params.id, actor)
    if (!review) return refuse(res, new ProxyRequestError('unavailable'))
    sendJson(res, review)
  })
  router.post('/agent-requests', async ({ req, res, body }) => {
    res.setHeader('Cache-Control', 'no-store')
    if (!sourceMatches(req, res)) return
    const actor = store.agentRequestActor(req.headers)
    if (!actor) return refuse(res, new ProxyRequestError('unavailable'))
    let input: unknown
    try { input = await body({ maxBytes: AGENT_REQUEST_CREATE_MAX_BYTES }) }
    catch { return refuse(res, new ProxyRequestError('invalid')) }
    // A body wait may outlive the exact credential or account selection. Never
    // reinterpret an old click under a replacement principal.
    const current = store.agentRequestActor(req.headers)
    if (!sourceMatches(req, res)) return
    if (!current || current.userId !== actor.userId || current.tenantId !== actor.tenantId) {
      return refuse(res, new ProxyRequestError('unavailable'))
    }
    try { sendJson(res, store.createAgentRequest(actor, headerValue(req.headers, 'idempotency-key'), input)) }
    catch (error) { refuse(res, error) }
  })
  router.intrinsicPost('/agent-requests/:id/decision', 'the receiving person reviews execution and sharing separately; a model cannot approve its own private-resource request', async ({ req, res, params, body }) => {
    res.setHeader('Cache-Control', 'no-store')
    if (!sourceMatches(req, res)) return
    const actor = store.agentRequestActor(req.headers)
    if (!actor || !store.agentRequest(params.id, actor)) return refuse(res, new ProxyRequestError('unavailable'))
    const via = store.identity(req.headers).via
    let input: unknown
    try { input = await body({ maxBytes: AGENT_REQUEST_DECISION_MAX_BYTES }) }
    catch { return refuse(res, new ProxyRequestError('invalid')) }
    const current = store.agentRequestActor(req.headers)
    if (!sourceMatches(req, res)) return
    if (!current || current.userId !== actor.userId || current.tenantId !== actor.tenantId) {
      return refuse(res, new ProxyRequestError('unavailable'))
    }
    const authenticated = () => {
      const current = store.agentRequestActor(req.headers)
      return !!current && current.userId === actor.userId && current.tenantId === actor.tenantId && store.identity(req.headers).via === via
    }
    try {
      const run = input !== null && typeof input === 'object' && !Array.isArray(input) && 'action' in input && input.action === 'run'
      const view = run ? store.runAgentRequest(params.id, actor, input, authenticated) : store.decideAgentRequest(params.id, actor, input)
      if (!view) return refuse(res, new ProxyRequestError('unavailable'))
      sendJson(res, view)
    }
    catch (error) { refuse(res, error) }
  })
}
