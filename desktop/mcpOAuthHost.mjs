/** Native-only owner/source-bound bridge between OAuth discovery, sign-in and
 * the existing durable MCP inspection route. No IPC or renderer authority. */
const FLOW_TTL_MS = 180_000
const RECOVERY_TTL_MS = 600_000
const MAX_FLOWS = 8
const ERROR_CODES = ['request', 'busy', 'stale', 'expired', 'cancelled', 'conflict', 'unavailable']

export class McpOAuthHostError extends Error {
  constructor(code = 'unavailable') {
    const safe = ERROR_CODES.includes(code) ? code : 'unavailable'
    super(`MCP OAuth could not be completed (${safe}).`)
    this.name = 'McpOAuthHostError'
    this.code = safe
  }
}
const fail = code => { throw new McpOAuthHostError(code) }
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const validText = value => typeof value === 'string' && value.length > 0 && value.length <= 512 && /^[\x20-\x7e]+$/.test(value)
const validEndpoint = value => typeof value === 'string' && value.length > 0 && value.length <= 2_048 && !/[\u0000-\u0020\u007f]/.test(value)
const validRevision = value => Number.isSafeInteger(value) && value >= 0
const validConnectionStatus = value => ['unverified', 'connected', 'disconnected'].includes(value)
const exactKeys = (value, keys) => Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key))
const sameBinding = (a, b) => a?.tenantId === b?.tenantId && a?.connectionId === b?.connectionId && a?.endpoint === b?.endpoint
const sameSource = (a, b) => a?.stamp === b?.stamp && a?.ownerUserId === b?.ownerUserId && sameBinding(a?.binding, b?.binding)
const deepFreeze = value => {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child)
    Object.freeze(value)
  }
  return value
}

export function createMcpOAuthHost({ assertCaller, resolveSource, isSourceCurrent, discovery, signIn, inspect, discard,
  now = Date.now, randomUUID = () => globalThis.crypto.randomUUID() }) {
  if (typeof assertCaller !== 'function' || typeof resolveSource !== 'function' || typeof isSourceCurrent !== 'function' ||
      !discovery || typeof discovery.discoverResource !== 'function' || typeof discovery.discoverServer !== 'function' ||
      !signIn || typeof signIn.authorize !== 'function' || typeof inspect !== 'function' || typeof discard !== 'function' ||
      typeof now !== 'function' || typeof randomUUID !== 'function') fail('request')

  const flows = new Map()
  const connections = new Map()
  let closed = false

  const timestamp = () => {
    const value = now()
    if (!Number.isSafeInteger(value) || value < 0) fail('unavailable')
    return value
  }
  const caller = event => {
    if (closed) fail('cancelled')
    try {
      const result = assertCaller(event)
      if (result === false || result instanceof Promise) {
        if (result instanceof Promise) result.catch(() => {})
        fail('stale')
      }
    } catch (error) {
      if (error instanceof McpOAuthHostError) throw error
      fail('stale')
    }
  }
  const trustedSource = async (connectionId, options = {}) => {
    let source
    try { source = await resolveSource(connectionId, options) } catch { fail('stale') }
    if (!plain(source) || !validText(source.stamp) || !validText(source.ownerUserId) || !plain(source.binding) ||
        source.binding.connectionId !== connectionId || !validText(source.binding.tenantId) || !validEndpoint(source.binding.endpoint) ||
        !plain(source.connection) || source.connection.id !== connectionId || !validRevision(source.connection.revision) ||
        source.connection.authentication !== 'device-oauth' || !validConnectionStatus(source.connection.status)) fail('stale')
    return deepFreeze({ stamp: source.stamp, ownerUserId: source.ownerUserId,
      binding: { tenantId: source.binding.tenantId, connectionId: source.binding.connectionId, endpoint: source.binding.endpoint },
      connection: { id: source.connection.id, authentication: source.connection.authentication,
        revision: source.connection.revision, status: source.connection.status,
        ...(validText(source.connection.inspectionOperationId) ? { inspectionOperationId: source.connection.inspectionOperationId } : {}) } })
  }
  const isCurrent = entry => {
    if (closed || entry.cancelled) return false
    if (!entry.submitted && timestamp() - entry.startedAt >= FLOW_TTL_MS) return false
    try {
      const result = isSourceCurrent(entry.source.stamp)
      if (result instanceof Promise) { result.catch(() => {}); return false }
      if (result !== true) return false
      return true
    } catch { return false }
  }
  const requireCurrent = async (entry, { revision = true } = {}) => {
    if (!isCurrent(entry)) fail(entry.cancelled || closed ? 'cancelled' : 'stale')
    const current = await trustedSource(entry.connectionId, { signal: entry.controller.signal })
    if (!isCurrent(entry) || !sameSource(entry.source, current)) fail(entry.cancelled || closed ? 'cancelled' : 'stale')
    if (revision && current.connection.revision !== entry.source.connection.revision) fail('conflict')
    return current
  }
  const remove = entry => {
    clearTimeout(entry.timer)
    if (flows.get(entry.id) === entry) flows.delete(entry.id)
    if (connections.get(entry.connectionKey) === entry) connections.delete(entry.connectionKey)
  }
  const cleanupCancelled = entry => {
    if (entry.cleanupWork) return entry.cleanupWork
    entry.cleanupWork = (async () => {
      if (entry.provisionalReference && !entry.submitted) {
        const reference = entry.provisionalReference
        entry.provisionalReference = undefined
        try { await discard(reference, entry.source.binding) } catch { /* durable startup reconciliation owns failed cleanup */ }
      }
      remove(entry)
    })()
    return entry.cleanupWork
  }
  const publicFlow = entry => ({ flowId: entry.id, connectionId: entry.connectionId, revision: entry.source.connection.revision })
  const lookup = (event, flowId) => {
    caller(event)
    if (!validText(flowId)) fail('request')
    const entry = flows.get(flowId)
    if (!entry) fail('expired')
    if (entry.cancelled) fail('cancelled')
    if (!entry.submitted && timestamp() - entry.startedAt >= FLOW_TTL_MS) {
      cancelEntry(entry, 'expired')
      fail('expired')
    }
    if (entry.submitted && entry.submittedAt !== undefined && timestamp() - entry.submittedAt >= RECOVERY_TTL_MS) {
      entry.recoveryExpired = true
      if (!entry.running) remove(entry)
      fail('expired')
    }
    return entry
  }
  const cancelEntry = (entry, reason = 'cancelled') => {
    if (entry.cancelled || entry.submitted) return
    entry.cancelled = true
    entry.cancelReason = reason
    entry.controller.abort()
    if (entry.timer) clearTimeout(entry.timer)
    if (!entry.running) void cleanupCancelled(entry)
  }
  const run = async (entry, task) => {
    if (entry.running) fail('busy')
    entry.running = true
    const work = Promise.resolve().then(task)
    entry.work = work
    try { return await work }
    finally {
      if (entry.work === work) {
        entry.running = false
        entry.work = undefined
        if (entry.cancelled && !entry.submitted) await cleanupCancelled(entry)
        if (entry.recoveryExpired) remove(entry)
      }
    }
  }
  const complete = (entry, result) => {
    const connection = result?.connection
    if (!plain(connection) || connection.inspectionOperationId !== entry.operationId || connection.id !== entry.connectionId ||
        connection.authentication !== 'device-oauth' || !validRevision(connection.revision) ||
        connection.revision <= entry.source.connection.revision || !validConnectionStatus(connection.status)) return undefined
    entry.completed = true
    remove(entry)
    const cleanup = result.credentialCleanup
    return Object.freeze({ status: 'complete', connection: Object.freeze({ id: connection.id, revision: connection.revision, status: connection.status }),
      ...(['complete', 'pending'].includes(cleanup) ? { credentialCleanup: cleanup } : {}) })
  }
  const submitInspection = async (entry, source) => {
    if (!entry.submitted) {
      entry.submitted = true
      entry.submittedAt = timestamp()
      clearTimeout(entry.timer)
      entry.timer = setTimeout(() => {
        entry.recoveryExpired = true
        if (!entry.running) remove(entry)
      }, RECOVERY_TTL_MS)
    }
    let result
    try {
      result = await inspect(source, { operationId: entry.operationId, expectedRevision: entry.source.connection.revision,
        credentialReference: entry.provisionalReference }, { signal: entry.controller.signal })
    } catch {
      entry.pending = true
      return Object.freeze({ status: 'inspection-pending', flowId: entry.id })
    }
    let current
    try { current = await requireCurrent(entry, { revision: false }) } catch {
      entry.pending = true
      return Object.freeze({ status: 'inspection-pending', flowId: entry.id })
    }
    const receipt = current.connection.inspectionOperationId === entry.operationId
      ? complete(entry, { ...result, connection: current.connection }) : undefined
    if (receipt) return receipt
    entry.pending = true
    return Object.freeze({ status: 'inspection-pending', flowId: entry.id })
  }

  return Object.freeze({
    async start(event, request) {
      caller(event)
      if (!plain(request) || !exactKeys(request, ['connectionId', 'expectedRevision', 'source']) ||
          !validText(request.connectionId) || !validRevision(request.expectedRevision) || !plain(request.source) ||
          !exactKeys(request.source, ['tenantId', 'userId']) || !validText(request.source.tenantId) || !validText(request.source.userId)) fail('request')
      const connectionKey = request.connectionId
      if (connections.has(connectionKey) || connections.size >= MAX_FLOWS) fail('busy')
      const controller = new AbortController()
      const reservation = { controller }
      connections.set(connectionKey, reservation)
      let entry
      try {
        const source = await trustedSource(request.connectionId, { signal: controller.signal })
        caller(event)
        if (isSourceCurrent(source.stamp) !== true) fail('stale')
        if (source.binding.tenantId !== request.source.tenantId || source.ownerUserId !== request.source.userId) fail('stale')
        if (source.connection.revision !== request.expectedRevision) fail('conflict')
        const id = randomUUID()
        const operationId = randomUUID()
        if (!validText(id) || flows.has(id) || !validText(operationId)) fail('unavailable')
        entry = { id, operationId, connectionKey, connectionId: request.connectionId, source,
          startedAt: timestamp(), controller, stage: 'discovering', running: false,
          submitted: false, provisionalReference: undefined, cancelled: false }
        flows.set(id, entry)
        connections.set(connectionKey, entry)
        entry.timer = setTimeout(() => cancelEntry(entry, 'expired'), FLOW_TTL_MS)
        return await run(entry, async () => {
          await requireCurrent(entry)
          const resource = await discovery.discoverResource(source.binding.endpoint, {
            signal: entry.controller.signal, isCurrent: () => isCurrent(entry),
          })
          await requireCurrent(entry)
          if (!plain(resource) || !Array.isArray(resource.authorizationServers) ||
              (resource.scopesSupported !== undefined && !Array.isArray(resource.scopesSupported))) fail('unavailable')
          entry.resourceScopesPresent = Array.isArray(resource.scopesSupported)
          entry.resource = deepFreeze({ ...structuredClone(resource), scopesSupported: [...(resource.scopesSupported ?? [])] })
          entry.stage = 'resource'
          return Object.freeze({ ...publicFlow(entry), authorizationServers: Object.freeze([...entry.resource.authorizationServers]) })
        })
      } catch (error) {
        if (entry && !entry.submitted) remove(entry)
        else if (!entry && connections.get(connectionKey) === reservation) connections.delete(connectionKey)
        if (error instanceof McpOAuthHostError) throw error
        fail(entry?.cancelled ? (entry.cancelReason ?? 'cancelled') : 'unavailable')
      } finally {
        if (entry?.cancelled && !entry.running && !entry.submitted) remove(entry)
      }
    },

    async review(event, request) {
      caller(event)
      if (!plain(request) || !exactKeys(request, ['flowId', 'issuer']) || !validText(request.flowId) || !validText(request.issuer)) fail('request')
      const entry = lookup(event, request.flowId)
      if (entry.stage !== 'resource') fail('conflict')
      if (!entry.resource.authorizationServers.includes(request.issuer)) fail('request')
      return run(entry, async () => {
        entry.stage = 'reviewing'
        try {
          await requireCurrent(entry)
          const server = await discovery.discoverServer(entry.resource, request.issuer, {
            signal: entry.controller.signal, isCurrent: () => isCurrent(entry),
          })
          await requireCurrent(entry)
          if (!plain(server) || !server.metadata) fail('unavailable')
          entry.server = deepFreeze(structuredClone(server))
          entry.issuer = request.issuer
          const resourceScopes = entry.resourceScopesPresent ? entry.resource.scopesSupported : undefined
          const serverScopes = Array.isArray(entry.server.scopesSupported) ? entry.server.scopesSupported : undefined
          const supported = resourceScopes !== undefined && serverScopes !== undefined
            ? resourceScopes.filter(scope => serverScopes.includes(scope))
            : [...(resourceScopes ?? serverScopes ?? [])]
          entry.reviewedScopes = Object.freeze(supported)
          entry.stage = 'reviewed'
          const suggested = Array.isArray(entry.resource.challengeScopes)
            ? entry.resource.challengeScopes.filter(scope => supported.includes(scope)) : []
          return Object.freeze({ flowId: entry.id, issuer: entry.issuer,
            scopesSupported: Object.freeze([...supported]), suggestedScopes: Object.freeze(suggested) })
        } catch (error) {
          if (entry.stage === 'reviewing') entry.stage = 'resource'
          if (error instanceof McpOAuthHostError) throw error
          fail('unavailable')
        }
      })
    },

    async authorize(event, request) {
      caller(event)
      if (!plain(request) || !exactKeys(request, ['flowId', 'scopes']) || !validText(request.flowId) || !Array.isArray(request.scopes) ||
          request.scopes.length > 32 || request.scopes.some(scope => !validText(scope))) fail('request')
      const entry = lookup(event, request.flowId)
      if (entry.stage !== 'reviewed' || !entry.server || !entry.issuer) fail('conflict')
      const supported = entry.reviewedScopes
      if (supported.length === 0 ? request.scopes.length !== 0 : request.scopes.some(scope => !supported.includes(scope))) fail('request')
      const scopes = Object.freeze([...new Set(request.scopes)])
      if (scopes.length !== request.scopes.length) fail('request')
      return run(entry, async () => {
        entry.stage = 'authorizing'
        try {
          const source = await requireCurrent(entry)
          const signed = await signIn.authorize({ binding: entry.source.binding, ownerId: entry.source.ownerUserId,
            issuer: entry.issuer, metadata: entry.server.metadata, scopes }, {
            signal: entry.controller.signal, isCurrent: () => isCurrent(entry),
          })
          if (!isCurrent(entry)) {
            if (signed?.reference) {
              entry.provisionalReference = signed.reference
              try { await discard(signed.reference, entry.source.binding); entry.provisionalReference = undefined } catch {}
            }
            cancelEntry(entry, 'stale')
            fail(entry.cancelled ? 'cancelled' : 'stale')
          }
          if (!plain(signed) || !validText(signed.reference)) fail('unavailable')
          entry.provisionalReference = signed.reference
          const current = await requireCurrent(entry)
          if (!sameSource(entry.source, current) || current.connection.revision !== entry.source.connection.revision) {
            try { await discard(entry.provisionalReference, entry.source.binding); entry.provisionalReference = undefined } catch {}
            fail('stale')
          }
          return await submitInspection(entry, current)
        } catch (error) {
          if (!entry.submitted && entry.stage === 'authorizing') entry.stage = 'reviewed'
          if (!entry.submitted && entry.provisionalReference) cancelEntry(entry, error instanceof McpOAuthHostError ? error.code : 'stale')
          if (!entry.submitted && error instanceof McpOAuthHostError && ['stale', 'conflict', 'expired'].includes(error.code)) cancelEntry(entry, error.code)
          if (entry.cancelled && !entry.submitted) fail(entry.cancelReason ?? 'cancelled')
          if (error instanceof McpOAuthHostError) throw error
          fail(entry.submitted ? 'unavailable' : 'unavailable')
        }
      })
    },

    async reconcile(event, request) {
      caller(event)
      if (!plain(request) || !exactKeys(request, ['flowId']) || !validText(request.flowId)) fail('request')
      const entry = lookup(event, request.flowId)
      if (!entry.submitted || !entry.provisionalReference) fail('conflict')
      if (entry.running) fail('busy')
      return run(entry, async () => {
        let source
        try { source = await requireCurrent(entry, { revision: false }) } catch { fail('stale') }
        const connection = source.connection
        if (connection.inspectionOperationId === entry.operationId) {
          const result = { connection }
          const receipt = complete(entry, result)
          if (receipt) return receipt
        }
        if (connection.revision !== entry.source.connection.revision) {
          return Object.freeze({ status: 'inspection-pending', flowId: entry.id })
        }
        // Only exact replay of the held inspection is permitted. There is no
        // path back to discovery or sign-in from this recovery state.
        return submitInspection(entry, source)
      })
    },

    async cancel(event, request) {
      caller(event)
      if (!plain(request) || !exactKeys(request, ['flowId']) || !validText(request.flowId)) fail('request')
      const entry = lookup(event, request.flowId)
      if (entry.submitted) {
        entry.pending = true
        return Object.freeze({ status: 'inspection-pending', flowId: entry.id })
      }
      cancelEntry(entry)
      return Object.freeze({ status: 'cancelled' })
    },

    close() {
      if (closed) return
      closed = true
      for (const reservation of connections.values()) reservation.controller?.abort()
      for (const entry of flows.values()) {
        if (entry.submitted) {
          clearTimeout(entry.timer)
          entry.recoveryExpired = true
          if (!entry.running) remove(entry)
        } else cancelEntry(entry)
      }
    },
  })
}
