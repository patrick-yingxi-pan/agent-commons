/** Route-owned external MCP connection lifecycle. Catalog inspection does not
 * grant the unfinished tool executor any authority. */
import type { ApiErrorCode } from '../../contract/index.ts'
import { ValidationError } from '../conflict.ts'
import { McpConnectionError } from '../mcpConnections.ts'
import { McpInspectionError } from '../mcpConnectionInspector.ts'
import { createMcpConnectionService } from '../mcpConnectionService.ts'
import { McpDiscoveryError } from '../mcpDiscovery.ts'
import { McpHttpError } from '../mcpHttpTransport.ts'
import { McpCatalogError } from '../mcpCatalog.ts'
import { mcpRuntimeCapabilities, mcpRuntimeConfiguration } from '../mcpRuntime.ts'
import { sendError, sendJson, type Ctx } from '../http/respond.ts'
import type { Router } from '../http/router.ts'
import { store } from '../store/index.ts'
import { parseMcpConnectionCreate, parseMcpConnectionInspection, parseMcpConnectionLifecycle } from './mcpConnectionInput.ts'

export function mcpConnectionRoute(handler: (ctx: Ctx) => void | Promise<void>) {
  return async (ctx: Ctx): Promise<void> => {
    try { await handler(ctx) }
    catch (error) {
      let code: ApiErrorCode
      let message: string
      if (error instanceof ValidationError) {
        code = 'bad_request'; message = 'The MCP connection request is invalid.'
      } else if (error instanceof McpConnectionError) {
        code = error.code === 'missing' ? 'not_found' : error.code === 'invalid' ? 'bad_request' :
          error.code === 'capacity' ? 'limit_exceeded' : 'conflict'
        message = error.code === 'missing' ? 'This MCP connection is unavailable.' :
          error.code === 'invalid' ? 'The MCP connection request is invalid.' :
          error.code === 'capacity' ? 'The MCP connection limit has been reached.' :
          'This MCP connection changed. Refresh its status before continuing.'
      } else if (error instanceof McpInspectionError) {
        code = error.code === 'credentials_unavailable' ? 'capability_unavailable' :
          error.code === 'timeout' ? 'upstream_unavailable' : 'conflict'
        message = error.code === 'credentials_unavailable' ? 'Secure device credentials are unavailable for this connection.' :
          error.code === 'timeout' ? 'The MCP server did not finish inspection in time.' :
          error.code === 'busy' ? 'An MCP inspection is already running. Check its status before retrying.' :
          'MCP inspection was cancelled. Refresh its status before continuing.'
      } else if (error instanceof McpHttpError || error instanceof McpDiscoveryError || error instanceof McpCatalogError) {
        code = 'upstream_unavailable'
        message = error instanceof McpHttpError && error.code === 'authentication' ?
          'The MCP server refused authentication. Review its credential before retrying.' :
          'The MCP server could not provide a supported, valid tool catalog.'
      } else throw error // Preserve the shared durable-storage failure wall.
      sendError(ctx.res, code, message)
    }
  }
}

export function registerMcpConnectionRoutes(router: Router): void {
  const service = createMcpConnectionService({ store })
  const tenant = (ctx: Ctx) => store.identity(ctx.req.headers).tenant.id
  router.get('/mcp-connections', ({ req, res }) => {
    sendJson(res, { connections: store.mcpConnections(store.identity(req.headers).tenant.id), capabilities: mcpRuntimeCapabilities() })
  })
  router.aliasGet('/mcp-connections/:id', 'GET /mcp-connections',
    'one inspected connection is the exact detail projection of the same tenant-owned connection catalog',
    mcpConnectionRoute((ctx) => {
      const connection = store.mcpConnection(ctx.params.id, tenant(ctx))
      if (!connection) throw new McpConnectionError('missing')
      sendJson(ctx.res, connection)
    }))
  router.post('/mcp-connections', mcpConnectionRoute(async (ctx) => {
    const request = parseMcpConnectionCreate(await ctx.body<unknown>(), mcpRuntimeConfiguration().allowLoopback)
    sendJson(ctx.res, service.create(request, tenant(ctx)))
  }))
  router.uiFormGet('/mcp-connections/:id/credential-binding',
    'exact audience lookup for native write-only bearer provisioning is authentication ceremony; ordinary connection reads omit endpoints',
    mcpConnectionRoute((ctx) => {
      const tenantId = tenant(ctx)
      const connection = store.privateMcpConnection(ctx.params.id, tenantId)
      if (!connection) throw new McpConnectionError('missing')
      if (connection.authentication !== 'device-bearer') throw new McpConnectionError('invalid')
      if (!mcpRuntimeCapabilities().deviceBearerCredentials) throw new McpInspectionError('credentials_unavailable')
      ctx.res.setHeader('Cache-Control', 'no-store')
      sendJson(ctx.res, { binding: { tenantId, connectionId: connection.id, endpoint: connection.endpoint } })
    }))
  router.post('/mcp-connections/:id/inspect', mcpConnectionRoute(async (ctx) => {
    const request = parseMcpConnectionInspection(await ctx.body<unknown>())
    sendJson(ctx.res, await service.inspect(ctx.params.id, tenant(ctx), request))
  }))
  router.post('/mcp-connections/:id/disconnect', mcpConnectionRoute(async (ctx) => {
    const request = parseMcpConnectionLifecycle(await ctx.body<unknown>())
    sendJson(ctx.res, await service.disconnect(ctx.params.id, tenant(ctx), request.expectedRevision))
  }))
  router.delete('/mcp-connections/:id', mcpConnectionRoute(async (ctx) => {
    const request = parseMcpConnectionLifecycle(await ctx.body<unknown>())
    sendJson(ctx.res, await service.remove(ctx.params.id, tenant(ctx), request.expectedRevision))
  }))
  router.uiFormPost('/mcp-connections/:id/credential-cleanup',
    'retrying OS credential erasure is device credential ceremony, not a new connection or tool-execution grant',
    mcpConnectionRoute(async (ctx) => {
      const body = await ctx.body<Record<string, unknown>>()
      if (!body || Array.isArray(body) || typeof body !== 'object' || Object.keys(body).length !== 0) {
        throw new ValidationError('Invalid MCP credential cleanup request.')
      }
      sendJson(ctx.res, await service.retryCleanup(ctx.params.id, tenant(ctx)))
    }))
}
