/** Native-only authority for committed and provisional stdio launch grants.
 * Backend snapshots enter only after durable rehydration. Native review grants
 * custody, a bounded setup permit grants inspection, and an exact committed
 * binding grants transport admission; none is tools/call user consent. */
import { snapshotMcpStdioGrantBinding, McpStdioGrantError } from './mcpStdioGrantVault.mjs'
import { snapshotMcpStdioLaunch } from './mcpStdioLaunch.mjs'
import { McpStdioError } from './mcpStdioSupervisor.mjs'

export const MCP_STDIO_LIFECYCLE_LIMITS = Object.freeze({ bindings: 64, pending: 8, inspectionOpens: 2 })
const REFERENCE = /^MCP_STDIO_[A-F0-9]{32}$/
const fail = code => { throw new McpStdioGrantError(code) }
const safeError = error => {
  if (error instanceof McpStdioGrantError || error instanceof McpStdioError) throw error
  fail('unavailable')
}
function record(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(value))) return false
  const own = Reflect.ownKeys(value)
  return own.length === keys.length && own.every(key => keys.includes(key) &&
    Object.getOwnPropertyDescriptor(value, key)?.enumerable === true &&
    Object.hasOwn(Object.getOwnPropertyDescriptor(value, key), 'value'))
}
const identity = binding => JSON.stringify([binding.tenantId, binding.ownerUserId, binding.connectionId])
const same = (left, right) => identity(left) === identity(right) && left.connectionRevision === right.connectionRevision
const nativeBinding = binding => ({ tenantId: binding.tenantId, ownerUserId: binding.ownerUserId, connectionId: binding.connectionId })
function current(check) {
  try {
    const result = check()
    if (result === true) return true
    try { void Promise.resolve(result).catch(() => {}) } catch { /* fixed refusal */ }
  } catch { /* fixed refusal */ }
  return false
}
export function snapshotMcpStdioLifecycleBinding(value) {
  try {
    if (!record(value, ['tenantId', 'ownerUserId', 'connectionId', 'connectionRevision']) ||
        !Number.isSafeInteger(value.connectionRevision) || value.connectionRevision < 0) return null
    const binding = snapshotMcpStdioGrantBinding(nativeBinding(value))
    return binding ? Object.freeze({ ...binding, connectionRevision: value.connectionRevision }) : null
  } catch { return null }
}
function input(reference, rawBinding) {
  const binding = snapshotMcpStdioLifecycleBinding(rawBinding)
  if (typeof reference !== 'string' || !REFERENCE.test(reference) || !binding) fail('invalid')
  return binding
}
function optionsSnapshot(value, purpose = false) {
  try {
    if (!value || typeof value !== 'object') fail('invalid')
    const keys = Reflect.ownKeys(value)
    if (!keys.includes('isCurrent') || !record(value, keys) || keys.some(key =>
      !['isCurrent', 'signal', ...(purpose ? ['purpose'] : [])].includes(key)) ||
      typeof value.isCurrent !== 'function' || (value.signal !== undefined && !(value.signal instanceof AbortSignal)) ||
      (purpose && !['inspect', 'call'].includes(value.purpose))) fail('invalid')
    return { isCurrent: value.isCurrent, signal: value.signal, ...(purpose ? { purpose: value.purpose } : {}) }
  } catch { fail('invalid') }
}
function snapshotBindings(value) {
  try {
    if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype ||
        value.length > MCP_STDIO_LIFECYCLE_LIMITS.bindings || Reflect.ownKeys(value).length !== value.length + 1) return null
    const result = new Map(), references = new Set()
    for (let index = 0; index < value.length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index))
      if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value') || !record(descriptor.value, ['reference', 'binding'])) return null
      const row = descriptor.value, binding = snapshotMcpStdioLifecycleBinding(row.binding)
      if (!binding || (row.reference !== null && (typeof row.reference !== 'string' || !REFERENCE.test(row.reference))) ||
          result.has(identity(binding)) || (row.reference !== null && references.has(row.reference))) return null
      result.set(identity(binding), { reference: row.reference, binding })
      if (row.reference !== null) references.add(row.reference)
    }
    return result
  } catch { return null }
}

export function createMcpStdioLifecycle({ vault, authority } = {}) {
  if (!vault || typeof vault.reconcile !== 'function' || typeof vault.discard !== 'function' || !authority ||
      typeof authority.configure !== 'function' || typeof authority.open !== 'function' || typeof authority.close !== 'function') fail('invalid')
  let initialized = false, usable = false, closed = false, cleanupPending = false, epoch = 0, pendingCount = 0
  let authoritative = new Map(), queue = Promise.resolve()
  const provisionals = new Map(), permits = new Map(), retired = new Set()
  function enqueue(operation) {
    if (pendingCount >= MCP_STDIO_LIFECYCLE_LIMITS.pending) fail('capacity')
    pendingCount += 1
    const pending = queue.then(operation)
    queue = pending.catch(() => {})
    return pending.catch(safeError).finally(() => { pendingCount -= 1 })
  }
  function stopPermit(permit) {
    permit.controller.abort()
    permit.signal?.removeEventListener('abort', permit.onAbort)
    if (permits.get(permit.reference) === permit) permits.delete(permit.reference)
  }
  function invalidate() {
    for (const row of authoritative.values()) row.controller.abort()
    for (const permit of permits.values()) stopPermit(permit)
  }
  function ready() {
    if (closed) fail('cancelled')
    if (!initialized || !usable) fail('unavailable')
  }
  function check(options) {
    ready()
    if (options.signal?.aborted) fail('cancelled')
    if (!current(options.isCurrent)) fail('stale')
    ready()
    if (options.signal?.aborted) fail('cancelled')
  }
  function isCurrent(reference, rawBinding, purpose) {
    const binding = snapshotMcpStdioLifecycleBinding(rawBinding)
    if (closed || !initialized || !usable || !binding || typeof reference !== 'string' || !REFERENCE.test(reference)) return false
    const row = authoritative.get(identity(binding))
    if (!row || !same(row.binding, binding) || row.controller.signal.aborted) return false
    if (purpose === 'call') {
      return row.reference === reference
    }
    if (purpose !== 'inspect') return false
    const permit = permits.get(reference)
    if (!permit || !same(permit.binding, binding) || permit.controller.signal.aborted ||
        permit.signal?.aborted || !current(permit.isCurrent)) return false
    return !closed && usable && permits.get(reference) === permit && !permit.controller.signal.aborted &&
      !permit.signal?.aborted && authoritative.get(identity(binding)) === row && !row.controller.signal.aborted
  }
  function finishSetup(reference, token) {
    const permit = permits.get(reference)
    if (!permit || permit.token !== token) return false
    stopPermit(permit)
    return true
  }
  async function synchronize(rawBindings) {
    if (closed) return false
    const bindings = snapshotBindings(rawBindings)
    const revision = ++epoch
    if (!bindings) { usable = false; cleanupPending = true; invalidate(); return false }
    // Never accept an older revision or resurrect a reference whose removal
    // still awaits physical cleanup. A malformed/old snapshot grants nothing.
    for (const [key, { reference, binding }] of bindings) {
      const previous = authoritative.get(key)
      if ((reference !== null && retired.has(reference)) || (previous && binding.connectionRevision < previous.binding.connectionRevision)) {
        usable = false; cleanupPending = true; invalidate(); return false
      }
    }
    const next = new Map()
    for (const [key, { reference, binding }] of bindings) {
      const prior = authoritative.get(key)
      next.set(key, prior && prior.reference === reference && same(prior.binding, binding) && !prior.controller.signal.aborted
        ? prior : { reference, binding, controller: new AbortController() })
    }
    for (const [key, row] of authoritative) {
      if (next.get(key) !== row) row.controller.abort()
      if (row.reference !== null && next.get(key)?.reference !== row.reference) retired.add(row.reference)
    }
    authoritative = next // revoke before any queued disk write or sync acknowledgement
    for (const permit of permits.values()) {
      const row = bindings.get(identity(permit.binding))
      if (!row || !same(row.binding, permit.binding) ||
          (row.reference !== permit.priorReference && row.reference !== permit.reference)) stopPermit(permit)
    }
    for (const [reference, provisional] of provisionals) {
      const row = bindings.get(identity(provisional.binding))
      if (!row || (provisional.reviewedBinding && !same(row.binding, provisional.reviewedBinding) && row.reference !== reference)) retired.add(reference)
    }
    cleanupPending = true
    try {
      return await enqueue(async () => {
        if (closed || epoch !== revision) return false
        const keep = new Map([...bindings.values()].filter(row => row.reference !== null).map(row => [row.reference, nativeBinding(row.binding)]))
        for (const [reference, provisional] of provisionals) {
          if (!keep.has(reference) && !retired.has(reference)) keep.set(reference, provisional.binding)
        }
        if (keep.size > MCP_STDIO_LIFECYCLE_LIMITS.bindings) fail('capacity')
        const matched = await vault.reconcile([...keep].map(([reference, binding]) => ({ reference, binding })),
          { isCurrent: () => !closed && epoch === revision })
        if (closed || epoch !== revision) return false
        if (matched !== true) { usable = false; invalidate(); return false }
        for (const { reference } of bindings.values()) if (reference !== null) provisionals.delete(reference)
        for (const reference of retired) provisionals.delete(reference)
        retired.clear(); initialized = true; usable = true; cleanupPending = false
        return true
      })
    } catch {
      if (epoch === revision) { usable = false; cleanupPending = true; invalidate() }
      return false
    }
  }
  return Object.freeze({
    get usable() { return initialized && usable && !closed },
    get cleanupPending() { return cleanupPending },
    initialize: synchronize,
    synchronize,
    configure(rawBinding, rawLaunch, rawOptions) {
      const binding = snapshotMcpStdioGrantBinding(rawBinding), launch = snapshotMcpStdioLaunch(rawLaunch), options = optionsSnapshot(rawOptions)
      if (!binding || !launch) return Promise.reject(new McpStdioGrantError('invalid'))
      check(options)
      if (!authoritative.has(identity(binding))) fail('stale')
      if (new Set([...authoritative.values()].map(row => row.reference).filter(Boolean).concat([...provisionals.keys()])).size >= MCP_STDIO_LIFECYCLE_LIMITS.bindings) fail('capacity')
      return enqueue(async () => {
        check(options)
        if (!authoritative.has(identity(binding))) fail('stale')
        if (new Set([...authoritative.values()].map(row => row.reference).filter(Boolean).concat([...provisionals.keys()])).size >= MCP_STDIO_LIFECYCLE_LIMITS.bindings) fail('capacity')
        const reference = await authority.configure(binding, launch, { signal: options.signal,
          isCurrent: () => !closed && initialized && usable && authoritative.has(identity(binding)) && current(options.isCurrent) })
        if (typeof reference !== 'string' || !REFERENCE.test(reference) || [...authoritative.values()].some(row => row.reference === reference) || provisionals.has(reference)) fail('unavailable')
        // A durable custody acknowledgement remains recoverable even when its
        // caller or host cancelled during commit. It does not authorize a spawn.
        provisionals.set(reference, { binding })
        return reference
      })
    },
    permitSetup(reference, rawBinding, rawOptions) {
      const binding = input(reference, rawBinding), options = optionsSnapshot(rawOptions)
      check(options)
      const provisional = provisionals.get(reference), committed = authoritative.get(identity(binding))
      if (!committed || !same(committed.binding, binding) || committed.controller.signal.aborted || retired.has(reference)) fail('stale')
      if (provisional ? identity(provisional.binding) !== identity(binding) ||
          (provisional.reviewedBinding && !same(provisional.reviewedBinding, binding)) :
          committed.reference !== reference) fail('stale')
      if (permits.has(reference)) fail('capacity')
      if (provisional) provisional.reviewedBinding = binding
      const controller = new AbortController(), token = Object.freeze({})
      const permit = { reference, binding, priorReference: committed.reference, token, controller, signal: options.signal, isCurrent: options.isCurrent, opens: 0, active: false }
      permit.onAbort = () => stopPermit(permit)
      permits.set(reference, permit)
      options.signal?.addEventListener('abort', permit.onAbort, { once: true })
      if (options.signal?.aborted) { stopPermit(permit); fail('cancelled') }
      return token
    },
    completeSetup: finishSetup,
    cancelSetup: finishSetup,
    abandonSetup(reference, rawBinding) {
      const binding = input(reference, rawBinding), provisional = provisionals.get(reference)
      if (closed || !provisional || identity(provisional.binding) !== identity(binding) ||
          (provisional.reviewedBinding && !same(provisional.reviewedBinding, binding)) ||
          [...authoritative.values()].some(row => row.reference === reference)) return Promise.resolve(false)
      const permit = permits.get(reference)
      if (permit) stopPermit(permit)
      retired.add(reference); cleanupPending = true
      return enqueue(async () => {
        if (closed) return false
        try {
          await vault.discard(reference, provisional.binding, { isCurrent: () => !closed })
          provisionals.delete(reference); retired.delete(reference)
          cleanupPending = retired.size > 0
          return true
        } catch {
          usable = false; cleanupPending = true; invalidate()
          return false
        }
      })
    },
    isCurrent,
    async open(reference, rawBinding, rawOptions) {
      const binding = input(reference, rawBinding), options = optionsSnapshot(rawOptions, true)
      check(options)
      if (!isCurrent(reference, binding, options.purpose)) fail('stale')
      const grant = options.purpose === 'inspect' ? permits.get(reference) : authoritative.get(identity(binding))
      if (options.purpose === 'inspect') {
        if (grant.active || grant.opens >= MCP_STDIO_LIFECYCLE_LIMITS.inspectionOpens) fail('capacity')
        grant.active = true; grant.opens += 1
      }
      const signal = AbortSignal.any([grant.controller.signal, ...(options.signal ? [options.signal] : [])])
      try {
        const connection = await authority.open(reference, nativeBinding(binding), { signal,
          isCurrent: () => isCurrent(reference, binding, options.purpose) && current(options.isCurrent) })
        if (options.purpose === 'inspect') void Promise.resolve(connection.closed).then(() => { grant.active = false }, () => {})
        return connection
      } catch (error) {
        // Failed open acknowledgement can hide a process already draining in
        // the authority. Retire this transaction rather than spend fallback
        // allowance before a physical close we cannot observe.
        if (options.purpose === 'inspect') stopPermit(grant)
        safeError(error)
      }
    },
    close() {
      if (closed) return
      closed = true; usable = false; epoch += 1; invalidate(); authority.close()
    },
  })
}
