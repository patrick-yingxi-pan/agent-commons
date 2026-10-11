/** Two bounded native preparation stages, separated for issuer selection.
 * The host must retain their snapshots behind opaque flow IDs. Neither stage
 * registers a client, opens a browser, requests a token or grants any scopes. */
import { McpOAuthHttpError } from './mcpOAuthHttp.mjs'
import { authorizationMetadataUrls, resourceMetadataUrls, oauthResourceUrl, oauthScopes,
  parseOAuthResourceMetadata, parseOAuthServerMetadata, snapshotOAuthJson } from './mcpOAuthMetadata.mjs'

export class McpOAuthDiscoveryError extends Error {
  constructor() { super('OAuth discovery could not be completed.'); this.name = 'McpOAuthDiscoveryError' }
}
const fail = () => { throw new McpOAuthDiscoveryError() }
const freezeJson = value => {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freezeJson(child)
    Object.freeze(value)
  }
  return value
}

function stageOptions(raw = {}) {
  const { signal, isCurrent, timeoutMs = 30_000 } = raw
  if (typeof isCurrent !== 'function' || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60_000) fail()
  const started = performance.now()
  const options = () => {
    if (signal?.aborted) throw new McpOAuthHttpError('cancelled')
    const remaining = Math.floor(timeoutMs - (performance.now() - started))
    if (remaining <= 0) throw new McpOAuthHttpError('timeout')
    const current = isCurrent()
    if (current instanceof Promise) current.catch(() => {})
    if (current !== true) throw new McpOAuthHttpError('stale')
    return { signal, isCurrent, timeoutMs: remaining }
  }
  options()
  return options
}

export function createMcpOAuthDiscovery({ http }) {
  if (!http || typeof http.probe !== 'function' || typeof http.getMetadata !== 'function') fail()
  const document = async (candidates, options) => {
    for (const url of candidates) {
      try { return (await http.getMetadata(url, options())).document }
      catch (error) {
        // Only an absent document advances to the next standards-ordered URL.
        // Redirects, TLS/DNS failures and malformed or mismatched documents do
        // not become a downgrade, changed issuer, or fresh network budget.
        if (!(error instanceof McpOAuthHttpError) || error.code !== 'http' || ![404, 410].includes(error.status)) throw error
      }
    }
    fail()
  }
  const protect = async operation => {
    try { return await operation() }
    catch (error) { if (error instanceof McpOAuthHttpError || error instanceof McpOAuthDiscoveryError) throw error; fail() }
  }

  return Object.freeze({
    discoverResource(endpoint, rawOptions) {
      return protect(async () => {
        const options = stageOptions(rawOptions)
        const resource = oauthResourceUrl(endpoint)
        const { challenge } = await http.probe(endpoint, options())
        const candidates = challenge.resourceMetadataUrl ? [challenge.resourceMetadataUrl] : resourceMetadataUrls(endpoint)
        const metadata = parseOAuthResourceMetadata(await document(candidates, options), resource)
        options()
        return Object.freeze({ ...metadata, ...(challenge.scopes ? { challengeScopes: oauthScopes(challenge.scopes) } : {}) })
      })
    },
    discoverServer(rawResource, issuer, rawOptions) {
      return protect(async () => {
        const options = stageOptions(rawOptions)
        const source = snapshotOAuthJson(rawResource)
        const resource = parseOAuthResourceMetadata({ resource: source.resource, authorization_servers: source.authorizationServers,
          ...(source.scopesSupported ? { scopes_supported: source.scopesSupported } : {}) }, source.resource)
        if (!resource.authorizationServers.includes(issuer)) fail()
        const metadata = snapshotOAuthJson(await document(authorizationMetadataUrls(issuer), options))
        const server = parseOAuthServerMetadata(metadata, issuer)
        options()
        // Retain the bounded original behind the native flow, so authorization
        // revalidates the same capability facts instead of reconstructing an
        // invented RFC document from its display projection. Never send this
        // document to the renderer; the host exposes only reviewed fields.
        return Object.freeze({ ...server, metadata: freezeJson(metadata) })
      })
    },
  })
}
