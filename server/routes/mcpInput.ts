import { sendError, sendJson, type Ctx } from '../http/respond.ts'
import type { Router } from '../http/router.ts'
import { store } from '../store/index.ts'
import { parseMcpInputCommand } from '../mcpInputCommand.ts'
import { executeApprovedMcpFormActivity } from '../mcpExecution.ts'

/** Human follow-up consent is intrinsic host control. It must never appear as
 * an in-session model tool that can answer its own untrusted remote forms. */
export function registerMcpInputRoutes(router: Router, sourceMatches: (req: Ctx['req'], res: Ctx['res']) => boolean): void {
  router.intrinsicGet('/sessions/:id/tool-activities/:activityId/input', 'private person review of external tool follow-up consent, realized by the host', ({ req, res, params, url }) => {
    if (!sourceMatches(req, res)) return
    const who = store.identity(req.headers)
    const state = store.mcpInputReview(params.id, params.activityId, who.tenant.id, who.user.id, url.searchParams.get('decisionId') ?? undefined)
    if (!state) return sendError(res, 'not_found', 'This MCP input review is unavailable.')
    sendJson(res, state)
  })
  router.intrinsicGet('/sessions/:id/tool-activities/:activityId/input/receipts/:responseId', 'read-only recovery of exact human follow-up consent; never dispatches a tool', ({ req, res, params, url }) => {
    if (!sourceMatches(req, res)) return
    const who = store.identity(req.headers)
    const receipt = store.mcpInputReceipt(params.id, params.activityId, url.searchParams.get('decisionId') ?? '', params.responseId, who.tenant.id, who.user.id)
    if (!receipt) return sendError(res, 'not_found', 'This MCP response receipt is unavailable. No tool was resubmitted.')
    sendJson(res, receipt)
  })
  router.intrinsicPost('/sessions/:id/tool-activities/:activityId/input', 'explicit person-owned follow-up consent; a model cannot answer or cancel its own request', async ({ req, res, params, body }) => {
    if (!sourceMatches(req, res)) return
    const who = store.identity(req.headers)
    const command = parseMcpInputCommand(await body<unknown>())
    if (!command) return sendError(res, 'bad_request', 'The MCP input response must identify one exact reviewed round and action.')
    const state = store.mcpInputReview(params.id, params.activityId, who.tenant.id, who.user.id, command.decisionId)
    if (!state) return sendError(res, 'not_found', 'This MCP input review is unavailable.')
    const started = store.beginMcpInputResponse(params.id, params.activityId, who.tenant.id, who.user.id, command)
    if (!started) return sendError(res, 'not_found', 'This MCP input review is unavailable to this person.')
    if (started === 'invalid') return sendError(res, 'conflict', 'This response does not match the current form or reviewed round. Read the latest review; nothing was resubmitted.')
    if (started.kind === 'receipt') return sendJson(res, started.receipt)
    let outcome: Awaited<ReturnType<typeof executeApprovedMcpFormActivity>>
    try {
      outcome = await executeApprovedMcpFormActivity(store, params.id, who.tenant.id, started.activity, who.user.id, started.continuation)
    } catch {
      outcome = { status: 'uncertain', summary: 'The MCP call was already submitted, but its final outcome is unknown. It will not be retried automatically.' }
    }
    const settled = store.settleMcpToolActivityExecution(params.id, params.activityId, command.decisionId, who.tenant.id, outcome, who.user.id, command.round)
    if (!settled || settled === 'invalid') return sendError(res, 'conflict', 'This response no longer matches its durable running receipt. Check its status without resubmitting.')
    const receipt = store.mcpInputReceipt(params.id, params.activityId, command.decisionId, command.responseId, who.tenant.id, who.user.id)
    if (!receipt) return sendError(res, 'not_found', 'This MCP response receipt is unavailable to this person.')
    sendJson(res, receipt)
  })
}
