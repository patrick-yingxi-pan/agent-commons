/** Route-owned external MCP connection lifecycle. Catalog inspection does not
 * grant the separately approved tool executor any authority. */
import type { ApiErrorCode } from '../../contract/index.ts'
import { SESSION_COOKIE, parseCookies } from '../auth.ts'
import { ValidationError } from '../conflict.ts'
import { McpConnectionError } from '../mcpConnections.ts'
import { McpInspectionError } from '../mcpConnectionInspector.ts'
import { createMcpConnectionService } from '../mcpConnectionService.ts'
import { McpDiscoveryError } from '../mcpDiscovery.ts'
import { McpHttpError } from '../mcpHttpTransport.ts'
import { McpCatalogError } from '../mcpCatalog.ts'
import { McpStdioClientError } from '../mcpStdioClient.ts'
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
      } else if (error instanceof McpStdioClientError) {
        code = error.code === 'unavailable' ? 'capability_unavailable' :
          ['busy', 'cancelled', 'stale'].includes(error.code) ? 'conflict' : 'upstream_unavailable'
        message = error.code === 'unavailable' ? 'Local MCP processes are unavailable on this device.' :
          code === 'conflict' ? 'Local MCP inspection changed or was cancelled. Check its status before continuing.' :
          'The local MCP server could not provide a supported, valid tool catalog.'
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

export function registerMcpConnectionRoutes(
  router: Router,
  accountTransitionSourceMatches: (req: Ctx['req'], res: Ctx['res']) => boolean,
): void {
  const service = createMcpConnectionService({ store })
  const identity = (ctx: Ctx) => store.identity(ctx.req.headers)
  router.get('/mcp-connections', ({ req, res }) => {
    const actor = store.identity(req.headers)
    sendJson(res, { connections: store.mcpConnections(actor.tenant.id, actor.user.id), capabilities: mcpRuntimeCapabilities() })
  })
  router.aliasGet('/mcp-connections/:id', 'GET /mcp-connections',
    'one inspected connection is the exact detail projection of the same authorized connection catalog',
    mcpConnectionRoute((ctx) => {
      const actor = identity(ctx)
      const connection = store.mcpConnection(ctx.params.id, actor.tenant.id, actor.user.id)
      if (!connection) throw new McpConnectionError('missing')
      sendJson(ctx.res, connection)
    }))
  router.post('/mcp-connections', mcpConnectionRoute(async (ctx) => {
    if (!accountTransitionSourceMatches(ctx.req, ctx.res)) return
    const request = parseMcpConnectionCreate(await ctx.body<unknown>(), mcpRuntimeConfiguration().allowLoopback)
    const actor = identity(ctx)
    sendJson(ctx.res, await service.create(request, actor.tenant.id, actor.user.id))
  }))
  router.uiFormGet('/mcp-connections/:id/credential-binding',
    'exact audience lookup for native write-only bearer provisioning is authentication ceremony; ordinary connection reads omit endpoints',
    mcpConnectionRoute((ctx) => {
      if (!accountTransitionSourceMatches(ctx.req, ctx.res)) return
      const actor = identity(ctx)
      const tenantId = actor.tenant.id
      const connection = store.privateMcpConnection(ctx.params.id, tenantId, actor.user.id)
      if (!connection) throw new McpConnectionError('missing')
      if (connection.authentication !== 'device-bearer') throw new McpConnectionError('invalid')
      if (!mcpRuntimeCapabilities().deviceBearerCredentials) throw new McpInspectionError('credentials_unavailable')
      ctx.res.setHeader('Cache-Control', 'no-store')
      sendJson(ctx.res, { binding: { tenantId, connectionId: connection.id, endpoint: connection.endpoint } })
    }))
  router.formGet('/mcp-connections/:id/oauth-source',
    'native-host OAuth authorization transport reads the exact owner connection binding; renderer APIs never receive tokens or credential references',
    mcpConnectionRoute((ctx) => {
      // The source fence is intentionally first: a stale browser/account
      // transition must not learn whether a private connection exists.
      if (!accountTransitionSourceMatches(ctx.req, ctx.res)) return
      const cookies = parseCookies(typeof ctx.req.headers.cookie === 'string' ? ctx.req.headers.cookie : undefined)
      const authorization = ctx.req.headers.authorization
      if (!cookies[SESSION_COOKIE] || authorization !== undefined) {
        sendError(ctx.res, 'unauthorized', 'A signed-in browser session is required for OAuth setup.')
        return
      }
      const actor = identity(ctx)
      if (actor.via !== 'session') {
        sendError(ctx.res, 'unauthorized', 'A signed-in browser session is required for OAuth setup.')
        return
      }
      ctx.res.setHeader('Cache-Control', 'no-store')
      const tenantId = actor.tenant.id
      const connection = store.privateMcpConnection(ctx.params.id, tenantId, actor.user.id)
      if (!connection || connection.ownerUserId !== actor.user.id) throw new McpConnectionError('missing')
      if (connection.authentication !== 'device-oauth') throw new McpConnectionError('invalid')
      if (!mcpRuntimeCapabilities().deviceOAuthCredentials) throw new McpInspectionError('credentials_unavailable')
      const view = store.mcpConnection(connection.id, tenantId, actor.user.id)
      if (!view) throw new McpConnectionError('missing')
      sendJson(ctx.res, {
        ownerUserId: actor.user.id,
        binding: { tenantId, connectionId: connection.id, endpoint: connection.endpoint },
        connection: {
          id: view.id,
          authentication: view.authentication,
          revision: view.revision,
          status: view.status,
          ...(view.inspectionOperationId ? { inspectionOperationId: view.inspectionOperationId } : {}),
        },
      })
    }))
  router.formGet('/mcp-connections/:id/stdio-source',
    'native local-process setup reads the cookie-bound person and exact connection revision; launch configuration and grants never enter renderer reads',
    mcpConnectionRoute((ctx) => {
      if (!accountTransitionSourceMatches(ctx.req, ctx.res)) return
      const cookies = parseCookies(typeof ctx.req.headers.cookie === 'string' ? ctx.req.headers.cookie : undefined)
      if (!cookies[SESSION_COOKIE] || ctx.req.headers.authorization !== undefined) {
        sendError(ctx.res, 'unauthorized', 'A signed-in browser session is required for local MCP setup.')
        return
      }
      const actor = identity(ctx)
      if (actor.via !== 'session') {
        sendError(ctx.res, 'unauthorized', 'A signed-in browser session is required for local MCP setup.')
        return
      }
      ctx.res.setHeader('Cache-Control', 'no-store')
      const connection = store.privateMcpConnection(ctx.params.id, actor.tenant.id, actor.user.id)
      if (!connection || connection.ownerUserId !== actor.user.id) throw new McpConnectionError('missing')
      if (connection.transport !== 'stdio') throw new McpConnectionError('invalid')
      if (!mcpRuntimeCapabilities().localProcesses) throw new McpInspectionError('credentials_unavailable')
      const view = store.mcpConnection(connection.id, actor.tenant.id, actor.user.id)
      if (!view) throw new McpConnectionError('missing')
      sendJson(ctx.res, {
        binding: { tenantId: actor.tenant.id, ownerUserId: actor.user.id, connectionId: connection.id, connectionRevision: connection.revision },
        connection: { revision: view.revision, status: view.status, inspectionOperationId: view.inspectionOperationId ?? null },
      })
    }))
  router.post('/mcp-connections/:id/inspect', mcpConnectionRoute(async (ctx) => {
    if (!accountTransitionSourceMatches(ctx.req, ctx.res)) return
    const request = parseMcpConnectionInspection(await ctx.body<unknown>())
    const actor = identity(ctx)
    sendJson(ctx.res, await service.inspect(ctx.params.id, actor.tenant.id, request, actor.user.id))
  }))
  router.post('/mcp-connections/:id/disconnect', mcpConnectionRoute(async (ctx) => {
    if (!accountTransitionSourceMatches(ctx.req, ctx.res)) return
    const request = parseMcpConnectionLifecycle(await ctx.body<unknown>())
    const actor = identity(ctx)
    sendJson(ctx.res, await service.disconnect(ctx.params.id, actor.tenant.id, request.expectedRevision, actor.user.id))
  }))
  router.delete('/mcp-connections/:id', mcpConnectionRoute(async (ctx) => {
    if (!accountTransitionSourceMatches(ctx.req, ctx.res)) return
    const request = parseMcpConnectionLifecycle(await ctx.body<unknown>())
    const actor = identity(ctx)
    sendJson(ctx.res, await service.remove(ctx.params.id, actor.tenant.id, request.expectedRevision, actor.user.id))
  }))
  router.uiFormPost('/mcp-connections/:id/credential-cleanup',
    'retrying OS credential erasure is device credential ceremony, not a new connection or tool-execution grant',
    mcpConnectionRoute(async (ctx) => {
      if (!accountTransitionSourceMatches(ctx.req, ctx.res)) return
      const body = await ctx.body<Record<string, unknown>>()
      if (!body || Array.isArray(body) || typeof body !== 'object' || Object.keys(body).length !== 0) {
        throw new ValidationError('Invalid MCP credential cleanup request.')
      }
      const actor = identity(ctx)
      sendJson(ctx.res, await service.retryCleanup(ctx.params.id, actor.tenant.id, actor.user.id))
    }))
}
