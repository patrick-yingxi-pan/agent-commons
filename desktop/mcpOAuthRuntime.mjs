/** Native composition root. Renderer sign-in lifetimes are independent of
 * already approved backend work; only shutdown closes credential resolution. */
import { createMcpOAuthHttp } from './mcpOAuthHttp.mjs'
import { createMcpOAuthDiscovery } from './mcpOAuthDiscovery.mjs'
import { createMcpOAuthSignIn } from './mcpOAuthSignIn.mjs'
import { createMcpOAuthRefreshManager } from './mcpOAuthRefresh.mjs'
import { createMcpOAuthSource } from './mcpOAuthSource.mjs'
import { createMcpOAuthHost, McpOAuthHostError } from './mcpOAuthHost.mjs'

export const mcpOAuthChannels = Object.freeze({
  start: 'agent-commons:mcp-oauth:start',
  review: 'agent-commons:mcp-oauth:review',
  authorize: 'agent-commons:mcp-oauth:authorize',
  reconcile: 'agent-commons:mcp-oauth:reconcile',
  cancel: 'agent-commons:mcp-oauth:cancel',
})

export async function mcpOAuthReply(operation) {
  try { return { ok: true, value: await operation() } }
  catch (error) {
    return { ok: false, error: error instanceof McpOAuthHostError ? error.code : 'unavailable' }
  }
}

export function createDesktopMcpOAuthRuntime({ vault, readSession, isSessionCurrent, assertCaller, openBrowser,
  configuration = {}, http = createMcpOAuthHttp(), fetch = globalThis.fetch }) {
  const source = createMcpOAuthSource({ readSession, isSessionCurrent, fetch })
  const discovery = createMcpOAuthDiscovery({ http })
  const signIn = createMcpOAuthSignIn({ http, vault, openBrowser, configuration })
  const refresh = createMcpOAuthRefreshManager({ vault, exchange: (request, options) => http.exchange(request, options) })
  const newHost = () => createMcpOAuthHost({
    assertCaller, resolveSource: (id, options) => source.resolveSource(id, options),
    isSourceCurrent: stamp => source.isSourceCurrent(stamp), discovery, signIn,
    inspect: (snapshot, request, options) => source.inspect(snapshot, request, options),
    discard: (reference, binding) => vault.discard(reference, binding),
  })
  let host = newHost()
  let closed = false
  return Object.freeze({
    get host() { return host },
    resolveCredential(reference, binding, options) {
      // The protocol validates all five fields. Vault custody uses the exact
      // audience and owner; backend freshness owns the connection revision.
      return refresh.resolve(reference, { tenantId: binding.tenantId, connectionId: binding.connectionId,
        endpoint: binding.endpoint }, binding.ownerUserId, { ...options, connectionRevision: binding.connectionRevision })
    },
    resetFlows() {
      if (closed) return
      host.close()
      host = newHost()
    },
    close() {
      if (closed) return
      closed = true
      host.close()
      source.close()
      signIn.close()
      refresh.close()
      http.close()
    },
  })
}
