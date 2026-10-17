import type { IncomingMessage, ServerResponse } from 'node:http'
import { providerUsage, providerUsageCacheKey } from '../providerUsage.ts'
import { store } from '../store/index.ts'
import { sendError, sendJson } from '../http/respond.ts'
import type { Router } from '../http/router.ts'

/** These are semantic reads through every access door. Ordinary inspection
 * performs no external I/O; the separately addressed balance read cannot infer
 * another origin or call a model. Account/connection truth is rechecked after I/O. */
export function registerProviderUsageRoutes(
  router: Router,
  accountMatches: (req: IncomingMessage, res: ServerResponse) => boolean,
): void {
  for (const balance of [false, true]) {
    router.get(balance ? '/providers/:id/usage/balance' : '/providers/:id/usage', async ({ req, res, params, url }) => {
      if (!accountMatches(req, res)) return
      const tenantId = store.identity(req.headers).tenant.id
      const provider = store.listProviders(tenantId).find(row => row.id === params.id)
      if (!provider) return sendError(res, 'not_found', 'No such provider.')
      const model = url.searchParams.get('model') ?? undefined
      if ([...url.searchParams.keys()].some(key => key !== 'model') || url.searchParams.getAll('model').length > 1 ||
          model !== undefined && (!model.trim() || model.length > 512 || /[\u0000-\u001f\u007f]/.test(model))) {
        return sendError(res, 'bad_request', 'model must be one non-empty model identifier of at most 512 characters.')
      }
      // Model absence means none, not an invisible mutable default. Shared
      // providers and relays disclose availability only, never private readings.
      const config = { ...store.providerExecutionConfig(provider.id), model }
      const before = providerUsageCacheKey(config)
      const result = balance ? await providerUsage.refreshBalance(config) : providerUsage.snapshot(config)
      if (!accountMatches(req, res)) return
      const current = store.listProviders(tenantId).find(row => row.id === provider.id)
      if (!current) return sendError(res, 'not_found', 'No such provider.')
      if (before !== providerUsageCacheKey({ ...store.providerExecutionConfig(provider.id), model })) {
        return sendError(res, 'conflict', 'This provider connection changed. Read its current usage again.')
      }
      res.setHeader('Cache-Control', 'no-store')
      sendJson(res, { ...result, providerId: provider.id })
    })
  }
}
