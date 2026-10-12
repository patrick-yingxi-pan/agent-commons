/** Route-owned person-private review and decision APIs for Commission MCP. */
import type { CommissionMcpDecisionRequest } from '../../contract/commissionMcpApi.ts'
import { CommissionMcpPolicyError } from '../commissionMcpPolicy.ts'
import { sendError, sendJson, type Ctx } from '../http/respond.ts'
import type { Router } from '../http/router.ts'
import { store } from '../store/index.ts'

const QUERY_FIELDS = ['providerId', 'modelId'] as const
const identity = (value: unknown): value is string => typeof value === 'string' && value.length > 0 &&
  value.length <= 200 && value.trim() === value && !/[\u0000-\u001f\u007f-\u009f]/.test(value)

function reviewSelection(url: URL): { providerId: string; modelId: string } | undefined | null {
  const keys = [...new Set([...url.searchParams.keys()])]
  if (keys.some(key => !QUERY_FIELDS.includes(key as typeof QUERY_FIELDS[number]))) return null
  const providers = url.searchParams.getAll('providerId')
  const models = url.searchParams.getAll('modelId')
  if (providers.length > 1 || models.length > 1) return null
  if (!providers.length && !models.length) return undefined
  if (providers.length !== 1 || models.length !== 1 || !identity(providers[0]) || !identity(models[0])) return null
  return { providerId: providers[0], modelId: models[0] }
}

function sendPolicyError(res: Ctx['res'], error: CommissionMcpPolicyError): void {
  const code = error.code === 'invalid' ? 'bad_request' : error.code === 'limit' ? 'limit_exceeded' :
    error.code === 'unavailable' ? 'not_found' : 'conflict'
  const message = error.code === 'invalid' ? 'The Commission MCP permission request is invalid.' :
    error.code === 'limit' ? 'This Commission has reached its bounded permission history limit.' :
    error.code === 'unavailable' ? 'Commission permission is unavailable.' :
    'The reviewed Commission, model, tool or permission changed. Refresh the review before continuing.'
  sendError(res, code, message)
}

/** Product routes deliberately remain ordinary capabilities through every
 * authenticated access door; private review is enforced by the host store. */
export function registerCommissionMcpRoutes(
  router: Router,
  sourceMatches: (req: Ctx['req'], res: Ctx['res']) => boolean,
): void {
  router.get('/commissions/:id/mcp-permission', ({ req, res, params, url }) => {
    const who = store.identity(req.headers)
    const tenantId = who.tenant.id
    const actorUserId = who.user.id
    // Establish the owner/person wall before interpreting optional model picks.
    const base = store.commissionMcpReview(params.id, tenantId, actorUserId)
    if (!base) return sendError(res, 'not_found', 'Commission permission is unavailable.')
    const selection = reviewSelection(url)
    if (selection === null) return sendError(res, 'bad_request', 'Specify one bounded providerId and modelId together, with no other query parameters.')
    if (!selection) return sendJson(res, base)
    const review = store.commissionMcpReview(params.id, tenantId, actorUserId, selection)
    if (!review) return sendError(res, 'not_found', 'Commission permission is unavailable.')
    sendJson(res, review)
  }, { kind: 'product', session: 'tool', query: {
    providerId: { type: 'string', minLength: 1, maxLength: 200, description: 'Explicit model provider to include in the private Commission MCP review; requires modelId.' },
    modelId: { type: 'string', minLength: 1, maxLength: 200, description: 'Explicit model id to include in the private Commission MCP review; requires providerId.' },
  } })

  router.post('/commissions/:id/mcp-permission', async ({ req, res, params, body }) => {
    if (!sourceMatches(req, res)) return
    const who = store.identity(req.headers)
    const tenantId = who.tenant.id
    const actorUserId = who.user.id
    // This read occurs before body parsing/await; the Store repeats all live
    // authority checks after the await immediately before committing a choice.
    if (!store.commissionMcpReview(params.id, tenantId, actorUserId)) {
      return sendError(res, 'not_found', 'Commission permission is unavailable.')
    }
    const request = await body<CommissionMcpDecisionRequest>()
    try {
      const response = store.decideCommissionMcp(params.id, tenantId, request, actorUserId)
      if (!response) return sendError(res, 'not_found', 'Commission permission is unavailable.')
      sendJson(res, response)
    } catch (error) {
      if (!(error instanceof CommissionMcpPolicyError)) throw error
      sendPolicyError(res, error)
    }
  })
}
