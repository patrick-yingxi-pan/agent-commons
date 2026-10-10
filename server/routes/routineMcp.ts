import type { RoutineMcpDecisionRequest } from '../../contract/routineMcpApi.ts'
import { RoutineMcpPolicyError } from '../routineMcpPolicy.ts'
import { sendError, sendJson, type Ctx } from '../http/respond.ts'
import type { Router } from '../http/router.ts'
import { store } from '../store/index.ts'

/** Ordinary product capabilities through every authenticated door. A shared
 * Routine grants no access to private tool catalogs, permissions or receipts. */
export function registerRoutineMcpRoutes(
  router: Router,
  sourceMatches: (req: Ctx['req'], res: Ctx['res']) => boolean,
): void {
  router.get('/schedules/:id/mcp-permission', ({ req, res, params }) => {
    const review = store.routineMcpReview(params.id, store.identity(req.headers).tenant.id)
    if (!review) return sendError(res, 'not_found', 'Routine permission is unavailable.')
    sendJson(res, review)
  })
  router.post('/schedules/:id/mcp-permission', async ({ req, res, params, body }) => {
    if (!sourceMatches(req, res)) return
    const tenantId = store.identity(req.headers).tenant.id
    if (!store.routineMcpReview(params.id, tenantId)) return sendError(res, 'not_found', 'Routine permission is unavailable.')
    const request = await body<RoutineMcpDecisionRequest>()
    try {
      // The store rechecks ownership after the body await and validates the
      // closed request before applying its exact durable receipt.
      const response = store.decideRoutineMcp(params.id, tenantId, request)
      if (!response) return sendError(res, 'not_found', 'Routine permission is unavailable.')
      sendJson(res, response)
    } catch (error) {
      if (!(error instanceof RoutineMcpPolicyError)) throw error
      sendError(res, error.code === 'invalid' ? 'bad_request' : error.code === 'limit' ? 'limit_exceeded' : 'conflict',
        error.code === 'invalid' ? 'The Routine MCP permission request is invalid.' :
          error.code === 'limit' ? 'This Routine has reached its bounded permission history limit.' :
            'The reviewed Routine, tool or permission changed. Refresh the review before approving again.')
    }
  })
}
