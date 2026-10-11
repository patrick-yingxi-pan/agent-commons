/** Acceptance-only OAuth/MCP peer. It is never packaged and never contacts a
 * public service. The packaged driver redirects only its copied ASAR sockets
 * to this local listener; production URL/DNS policy remains unchanged. */
import { createServer } from 'node:http'
import { createHash } from 'node:crypto'

export const MCP_OAUTH_FIXTURE_RESOURCE = 'https://mcp.oauth-fixture.example/mcp'
export const MCP_OAUTH_FIXTURE_ISSUER = 'https://login.oauth-fixture.example'
export const MCP_OAUTH_FIXTURE_ACCESS_CANARY = 'fixture-oauth-access-secret-canary-v1'
export const MCP_OAUTH_FIXTURE_REFRESH_CANARY = 'fixture-oauth-refresh-secret-canary-v1'
export const MCP_OAUTH_FIXTURE_REFRESHED_ACCESS_CANARY = 'fixture-oauth-access-secret-canary-v2'
export const MCP_OAUTH_FIXTURE_REFRESHED_REFRESH_CANARY = 'fixture-oauth-refresh-secret-canary-v2'
export const MCP_OAUTH_FIXTURE_SECRET_CANARIES = Object.freeze([
  MCP_OAUTH_FIXTURE_ACCESS_CANARY,
  MCP_OAUTH_FIXTURE_REFRESH_CANARY,
  MCP_OAUTH_FIXTURE_REFRESHED_ACCESS_CANARY,
  MCP_OAUTH_FIXTURE_REFRESHED_REFRESH_CANARY,
])

const RESOURCE_METADATA_PATH = '/.well-known/oauth-protected-resource/mcp'
const SERVER_METADATA_PATH = '/.well-known/oauth-authorization-server'
const AUTH_CHALLENGE = `Bearer resource_metadata="https://mcp.oauth-fixture.example${RESOURCE_METADATA_PATH}", scope="records:read"`
const MAX_BODY_BYTES = 65_536
const MCP_VERSION = '2026-07-28'
const TOOL_NAME = 'records.search'
const INPUT_SCHEMA = Object.freeze({
  type: 'object',
  properties: Object.freeze({ query: Object.freeze({ type: 'string', minLength: 1, maxLength: 256 }) }),
  required: Object.freeze(['query']),
  additionalProperties: false,
})
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const json = (status, value, headers = {}) => ({ status, headers: { 'content-type': 'application/json; charset=utf-8', ...headers }, body: JSON.stringify(value) })
const failure = status => json(status, { error: 'fixture_request_refused' })
const opaque = value => typeof value === 'string' && /^[\x21-\x7e]{1,8192}$/.test(value)

function parseBody(raw) {
  if (typeof raw !== 'string' || Buffer.byteLength(raw) > MAX_BODY_BYTES) return undefined
  try { return JSON.parse(raw) } catch { return undefined }
}

function clone(value) {
  return JSON.parse(JSON.stringify(value))
}

function createFixturePeer({ accessTokenLifetimeSeconds = 60, now = Date.now } = {}) {
  if (!Number.isSafeInteger(accessTokenLifetimeSeconds) || accessTokenLifetimeSeconds < 1 || accessTokenLifetimeSeconds > 3_600 ||
      typeof now !== 'function') throw new TypeError('Invalid local MCP fixture configuration.')
  const requests = []
  const registrations = new Map()
  const codes = new Map()
  const refreshTokens = new Map()
  const accessTokens = new Map()
  let registrationCount = 0
  let codeCount = 0
  let refreshCount = 0
  let forceExpire = false
  let closed = false
  const server = createServer()
  const sockets = new Set()
  server.on('connection', socket => {
    sockets.add(socket)
    socket.once('close', () => sockets.delete(socket))
  })

  const responseHeaders = response => ({ ...response.headers, 'content-length': String(Buffer.byteLength(response.body)),
    connection: 'close', 'cache-control': 'no-store' })
  const metadata = () => ({
    issuer: MCP_OAUTH_FIXTURE_ISSUER,
    authorization_endpoint: `${MCP_OAUTH_FIXTURE_ISSUER}/authorize`,
    token_endpoint: `${MCP_OAUTH_FIXTURE_ISSUER}/token`,
    registration_endpoint: `${MCP_OAUTH_FIXTURE_ISSUER}/register`,
    scopes_supported: ['records:read'],
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    token_endpoint_auth_methods_supported: ['none'],
    code_challenge_methods_supported: ['S256'],
    authorization_response_iss_parameter_supported: true,
  })
  const resourceMetadata = () => ({
    resource: MCP_OAUTH_FIXTURE_RESOURCE,
    authorization_servers: [MCP_OAUTH_FIXTURE_ISSUER],
    scopes_supported: ['records:read'],
  })
  const tokenResponse = (accessToken, refreshToken) => ({
    access_token: accessToken,
    token_type: 'Bearer',
    expires_in: accessTokenLifetimeSeconds,
    refresh_token: refreshToken,
    scope: 'records:read',
  })
  const authorized = (headers) => {
    const authorization = headers?.authorization
    if (typeof authorization !== 'string' || !authorization.startsWith('Bearer ')) return undefined
    const token = authorization.slice('Bearer '.length)
    const expiry = accessTokens.get(token)
    if (!expiry || (forceExpire && token !== MCP_OAUTH_FIXTURE_REFRESHED_ACCESS_CANARY) || expiry <= now()) return undefined
    return token
  }

  async function dispatch({ method, path, headers = {}, body = '' }) {
    if (closed || typeof method !== 'string' || typeof path !== 'string' || typeof body !== 'string' ||
        Buffer.byteLength(body) > MAX_BODY_BYTES) return failure(400)
    const request = Object.freeze({ method, path, headers: Object.freeze({ ...headers }), body })
    requests.push(request)
    const pathname = (() => { try { return new URL(path, 'http://fixture.invalid').pathname } catch { return '' } })()

    if (method === 'GET' && pathname === RESOURCE_METADATA_PATH) return json(200, resourceMetadata())
    if (method === 'GET' && pathname === '/.well-known/oauth-protected-resource') return json(200, resourceMetadata())
    if (method === 'GET' && pathname === SERVER_METADATA_PATH) return json(200, metadata())

    if (method === 'GET' && pathname === '/authorize') {
      let url
      try { url = new URL(path, 'http://fixture.invalid') } catch { return failure(400) }
      const values = url.searchParams
      const queryKeys = [...values.keys()]
      if (queryKeys.length !== 8 || new Set(queryKeys).size !== queryKeys.length ||
          queryKeys.some(key => !['client_id', 'code_challenge', 'code_challenge_method', 'redirect_uri', 'resource', 'response_type', 'scope', 'state'].includes(key))) return failure(400)
      const clientId = values.get('client_id')
      const registration = registrations.get(clientId)
      const redirectUri = values.get('redirect_uri')
      const scope = values.get('scope')
      const state = values.get('state')
      const challenge = values.get('code_challenge')
      if (!registration || redirectUri !== registration.redirectUri || !registration.grants.includes('authorization_code') ||
          values.get('response_type') !== 'code' || values.get('resource') !== MCP_OAUTH_FIXTURE_RESOURCE ||
          scope !== 'records:read' || !opaque(state) || !opaque(challenge) || values.get('code_challenge_method') !== 'S256') return failure(400)
      const code = `fixture-code-${++codeCount}`
      codes.set(code, { clientId, redirectUri, scope, state, challenge, consumed: false })
      const callback = new URL(redirectUri)
      callback.searchParams.set('code', code)
      callback.searchParams.set('state', state)
      callback.searchParams.set('iss', MCP_OAUTH_FIXTURE_ISSUER)
      return { status: 302, headers: { location: callback.href }, body: '' }
    }

    if (method === 'POST' && pathname === '/register') {
      const input = parseBody(body)
      const registrationKeys = ['application_type', 'client_name', 'grant_types', 'redirect_uris', 'response_types', 'scope', 'token_endpoint_auth_method']
      if (!record(input) || input.application_type !== 'native' || input.client_name !== 'Agent Commons' ||
          Object.keys(input).some(key => !registrationKeys.includes(key)) ||
          input.token_endpoint_auth_method !== 'none' || !Array.isArray(input.redirect_uris) || input.redirect_uris.length !== 1 ||
          typeof input.redirect_uris[0] !== 'string' || input.response_types?.length !== 1 || input.response_types[0] !== 'code' ||
          !Array.isArray(input.grant_types) || !input.grant_types.includes('authorization_code') ||
          input.grant_types.length > 2 || new Set(input.grant_types).size !== input.grant_types.length ||
          input.grant_types.some(value => !['authorization_code', 'refresh_token'].includes(value)) ||
          (input.scope !== undefined && input.scope !== 'records:read')) return failure(400)
      const clientId = `fixture-client-${++registrationCount}`
      const saved = Object.freeze({ redirectUri: input.redirect_uris[0], grants: Object.freeze([...input.grant_types]) })
      registrations.set(clientId, saved)
      return json(201, { client_id: clientId, application_type: 'native', token_endpoint_auth_method: 'none',
        redirect_uris: [saved.redirectUri], response_types: ['code'], grant_types: [...saved.grants], scope: 'records:read' })
    }

    if (method === 'POST' && pathname === '/token') {
      const form = new URLSearchParams(body)
      if (form.toString() !== body || [...form.keys()].length !== new Set(form.keys()).size) return failure(400)
      const clientId = form.get('client_id')
      const registration = registrations.get(clientId)
      if (!registration || form.get('resource') !== MCP_OAUTH_FIXTURE_RESOURCE || form.get('scope') !== 'records:read') return failure(400)
      if (form.get('grant_type') === 'authorization_code') {
        if ([...form.keys()].some(key => !['client_id', 'code', 'code_verifier', 'grant_type', 'redirect_uri', 'resource', 'scope'].includes(key)) ||
            [...form.keys()].length !== 7) return failure(400)
        const code = form.get('code')
        const held = codes.get(code)
        const verifier = form.get('code_verifier')
        const derived = typeof verifier === 'string' ? createHash('sha256').update(verifier).digest('base64url') : ''
        if (!held || held.consumed || held.clientId !== clientId || held.redirectUri !== form.get('redirect_uri') ||
            held.challenge !== derived || held.scope !== form.get('scope') || !registration.grants.includes('authorization_code')) return failure(400)
        held.consumed = true
        const access = MCP_OAUTH_FIXTURE_ACCESS_CANARY
        const refresh = MCP_OAUTH_FIXTURE_REFRESH_CANARY
        accessTokens.set(access, now() + accessTokenLifetimeSeconds * 1_000)
        refreshTokens.set(refresh, clientId)
        return json(200, tokenResponse(access, refresh))
      }
      if (form.get('grant_type') === 'refresh_token') {
        if ([...form.keys()].some(key => !['client_id', 'grant_type', 'refresh_token', 'resource', 'scope'].includes(key)) ||
            [...form.keys()].length !== 5) return failure(400)
        const refresh = form.get('refresh_token')
        if (!refreshTokens.has(refresh) || refreshTokens.get(refresh) !== clientId || !registration.grants.includes('refresh_token')) return failure(400)
        refreshTokens.delete(refresh)
        const next = MCP_OAUTH_FIXTURE_REFRESHED_REFRESH_CANARY
        const access = MCP_OAUTH_FIXTURE_REFRESHED_ACCESS_CANARY
        refreshTokens.set(next, clientId)
        accessTokens.set(access, now() + accessTokenLifetimeSeconds * 1_000)
        refreshCount++
        return json(200, tokenResponse(access, next))
      }
      return failure(400)
    }

    if (method === 'POST' && pathname === '/mcp') {
      const token = authorized(headers)
      if (!token) return { status: 401, headers: { 'www-authenticate': AUTH_CHALLENGE }, body: '' }
      const input = parseBody(body)
      if (!record(input) || input.jsonrpc !== '2.0' || typeof input.method !== 'string' ||
          headers['mcp-protocol-version'] !== MCP_VERSION || headers['mcp-method'] !== input.method ||
          input.params?._meta?.['io.modelcontextprotocol/protocolVersion'] !== MCP_VERSION) return failure(400)
      if (input.method === 'server/discover') {
        return json(200, { jsonrpc: '2.0', id: input.id, result: {
          resultType: 'complete',
          supportedVersions: [MCP_VERSION],
          capabilities: { tools: {} },
          _meta: { 'io.modelcontextprotocol/serverInfo': { name: 'OAuth fixture MCP', version: '1.0.0' } },
        } })
      }
      if (input.method === 'tools/list') {
        return json(200, { jsonrpc: '2.0', id: input.id, result: { resultType: 'complete', tools: [{
          name: TOOL_NAME,
          description: 'Read a bounded fixture record by query.',
          inputSchema: clone(INPUT_SCHEMA),
        }] } })
      }
      if (input.method === 'tools/call') {
        const params = input.params
        const query = params?.arguments?.query
        if (params?.name !== TOOL_NAME || typeof query !== 'string' || query.length < 1 || query.length > 256 ||
            headers['mcp-name'] === undefined) return failure(400)
        const resultText = `Fixture record for ${query}`
        return json(200, { jsonrpc: '2.0', id: input.id, result: {
          resultType: 'complete',
          content: [{ type: 'text', text: resultText }],
          structuredContent: { query, record: 'fixture-record-1' },
          isError: false,
        } })
      }
      return failure(404)
    }

    return failure(404)
  }

  server.on('request', async (request, response) => {
    const chunks = []
    let bytes = 0
    let tooLarge = false
    request.on('data', chunk => {
      bytes += chunk.byteLength
      if (bytes > MAX_BODY_BYTES) tooLarge = true
      else chunks.push(Buffer.from(chunk))
    })
    request.on('error', () => { if (!response.headersSent) response.writeHead(400).end() })
    request.on('end', async () => {
      let result
      try {
        result = tooLarge ? failure(413) : await dispatch({ method: request.method, path: request.url,
          headers: request.headers, body: Buffer.concat(chunks, Math.min(bytes, MAX_BODY_BYTES)).toString('utf8') })
      } catch { result = failure(500) }
      if (response.destroyed || response.writableEnded) return
      response.writeHead(result.status, responseHeaders(result))
      response.end(result.body)
    })
  })

  return Object.freeze({
    resource: MCP_OAUTH_FIXTURE_RESOURCE,
    issuer: MCP_OAUTH_FIXTURE_ISSUER,
    accessTokenCanary: MCP_OAUTH_FIXTURE_ACCESS_CANARY,
    refreshTokenCanary: MCP_OAUTH_FIXTURE_REFRESH_CANARY,
    secretCanaries: MCP_OAUTH_FIXTURE_SECRET_CANARIES,
    dispatch,
    async listen() {
      if (closed) throw new Error('The local OAuth fixture is closed.')
      if (server.listening) return this
      await new Promise((resolve, reject) => {
        const onError = error => { server.off('listening', onListening); reject(error) }
        const onListening = () => { server.off('error', onError); resolve() }
        server.once('error', onError)
        server.once('listening', onListening)
        server.listen(0, '127.0.0.1')
      })
      const address = server.address()
      if (!address || typeof address === 'string') throw new Error('The local OAuth fixture did not bind a TCP port.')
      return this
    },
    get origin() {
      const address = server.address()
      return address && typeof address !== 'string' ? `http://127.0.0.1:${address.port}` : undefined
    },
    expireAccess() { forceExpire = true },
    snapshot() {
      return Object.freeze({
        requests: Object.freeze(requests.map(request => Object.freeze({ ...request, headers: Object.freeze({ ...request.headers }) }))),
        counts: Object.freeze({ registrations: registrationCount, codes: codeCount, refreshes: refreshCount,
          resourceMetadata: requests.filter(request => request.path.startsWith(RESOURCE_METADATA_PATH)).length,
          serverMetadata: requests.filter(request => request.path.startsWith(SERVER_METADATA_PATH)).length,
          probes: requests.filter(request => request.path === '/mcp' && !request.headers.authorization).length,
          mcpCalls: requests.filter(request => request.path === '/mcp' && request.headers['mcp-method'] === 'tools/call').length,
        }),
      })
    },
    async close() {
      if (closed) return
      closed = true
      if (server.listening) {
        const closedSocketDrain = new Promise(resolve => server.close(() => resolve()))
        for (const socket of sockets) socket.destroy()
        server.closeAllConnections?.()
        await closedSocketDrain
      }
    },
  })
}

/** Starts the local peer and returns the patch target plus bounded evidence. */
export async function startMcpOAuthSmokeFixture(options) {
  const fixture = createFixturePeer(options)
  try { await fixture.listen(); return fixture }
  catch (error) { await fixture.close().catch(() => {}); throw error }
}

/** Exported for fast unit tests that exercise the exact HTTP route logic without
 * opening sockets; acceptance uses startMcpOAuthSmokeFixture(). */
export { createFixturePeer as createMcpOAuthSmokeFixture }
