/** Person-bound native setup. Preparing a flow never runs code. Authorization
 * is single-attempt; recovery reads only the durable inspection receipt. */
import { randomUUID } from 'node:crypto'
import { snapshotMcpStdioLaunch } from './mcpStdioLaunch.mjs'
import { McpStdioGrantError } from './mcpStdioGrantVault.mjs'
import { McpStdioDefinitiveInspectionRefusal } from './mcpStdioSource.mjs'

export const mcpStdioChannels = Object.freeze({
  start: 'agent-commons:mcp-stdio:start',
  authorize: 'agent-commons:mcp-stdio:authorize',
  reconcile: 'agent-commons:mcp-stdio:reconcile',
  cancel: 'agent-commons:mcp-stdio:cancel',
})
export class McpStdioSetupError extends Error {
  constructor(code = 'unavailable') {
    const safe = ['invalid', 'unavailable', 'stale', 'busy', 'cancelled', 'expired'].includes(code) ? code : 'unavailable'
    super(`Local MCP setup ${safe}.`)
    this.name = 'McpStdioSetupError'
    this.code = safe
  }
}
const fail = code => { throw new McpStdioSetupError(code) }
const current = check => {
  try {
    const result = check()
    if (result && typeof result.then === 'function') { Promise.resolve(result).catch(() => {}); return false }
    return result === true
  } catch { return false }
}
const record = (raw, keys) => {
  try {
    if (!raw || typeof raw !== 'object' || ![Object.prototype, null].includes(Object.getPrototypeOf(raw)) ||
        Reflect.ownKeys(raw).length !== keys.length) return null
    const descriptors = Object.getOwnPropertyDescriptors(raw)
    const result = Object.create(null)
    for (const key of keys) {
      if (!descriptors[key] || !Object.hasOwn(descriptors[key], 'value')) return null
      result[key] = descriptors[key].value
    }
    return result
  } catch { return null }
}
const sameSource = (left, right) => left?.stamp === right?.stamp &&
  left?.binding?.tenantId === right?.binding?.tenantId && left?.binding?.ownerUserId === right?.binding?.ownerUserId &&
  left?.binding?.connectionId === right?.binding?.connectionId
const binding3 = binding => ({ tenantId: binding.tenantId, ownerUserId: binding.ownerUserId, connectionId: binding.connectionId })

export async function mcpStdioReply(operation) {
  try { return { ok: true, value: await operation() } }
  catch (error) { return { ok: false, error: error instanceof McpStdioSetupError ? error.code : 'unavailable' } }
}

export function createMcpStdioSetup({ source, lifecycle, assertCaller, now = Date.now, uuid = randomUUID }) {
  if (!source || !lifecycle || typeof assertCaller !== 'function' || typeof now !== 'function' || typeof uuid !== 'function') fail('invalid')
  const flows = new Map()
  let preparing = 0
  let closed = false
  const caller = event => {
    if (closed) fail('cancelled')
    try {
      const result = assertCaller(event)
      if (result && typeof result.then === 'function') { Promise.resolve(result).catch(() => {}); fail('stale') }
      if (result === false) fail('stale')
    } catch { fail('stale') }
  }
  const timestamp = () => {
    const value = now()
    if (!Number.isSafeInteger(value) || value < 0) fail('unavailable')
    return value
  }
  const view = entry => Object.freeze({ flowId: entry.id, connectionId: entry.source.binding.connectionId,
    status: entry.status, revision: entry.receipt?.connection.revision ?? entry.source.binding.connectionRevision })
  const isCurrent = entry => !closed && !entry.controller.signal.aborted &&
    timestamp() < entry.expiresAt && current(() => source.isSourceCurrent(entry.source.stamp))
  const remove = entry => {
    clearTimeout(entry.timer)
    if (flows.get(entry.id) === entry) flows.delete(entry.id)
    entry.launch = undefined
  }
  const retirePermit = async entry => {
    if (!entry.permit) return
    const permit = entry.permit
    entry.permit = undefined
    await lifecycle.completeSetup(entry.reference, permit)
  }
  const abandon = async entry => {
    if (entry.submitted || !entry.reference) return
    try { await lifecycle.abandonSetup(entry.reference, entry.source.binding) }
    catch { /* Lifecycle retains exact pending cleanup for the next sync. */ }
  }
  const cancel = entry => {
    entry.controller.abort()
    entry.status = entry.submitted ? 'uncertain' : 'cancelled'
    if (entry.permit) {
      const permit = entry.permit
      entry.permit = undefined
      Promise.resolve(lifecycle.cancelSetup(entry.reference, permit)).catch(() => {})
    }
    entry.launch = undefined
    if (!entry.running) void abandon(entry)
  }
  const prune = () => {
    for (const entry of flows.values()) {
      if (timestamp() < entry.expiresAt) continue
      cancel(entry)
      if (!entry.running) remove(entry)
    }
    // Completed receipts are a bounded cache, not occupied setup capacity.
    for (const entry of flows.values()) {
      if (flows.size < 64) break
      if (!entry.running && ['connected', 'disconnected', 'failed', 'cancelled'].includes(entry.status)) remove(entry)
    }
  }
  const lookup = (event, raw) => {
    caller(event)
    const request = record(raw, ['flowId'])
    if (!request || typeof request.flowId !== 'string' || request.flowId.length > 128) fail('invalid')
    prune()
    const entry = flows.get(request.flowId)
    if (!entry) fail('expired')
    if (!current(() => source.isSourceCurrent(entry.source.stamp))) fail('stale')
    return entry
  }
  const fresh = async entry => {
    if (!isCurrent(entry)) fail('stale')
    const latest = await source.resolveSource(entry.source.binding.connectionId, { signal: entry.controller.signal })
    if (!isCurrent(entry) || !sameSource(latest, entry.source) ||
        latest.binding.connectionRevision !== entry.source.binding.connectionRevision) fail('stale')
    return latest
  }
  const acknowledge = async (entry, receipt) => {
    if (!sameSource(receipt, entry.source) || receipt.connection.inspectionOperationId !== entry.operationId ||
        receipt.binding.connectionRevision <= entry.source.binding.connectionRevision) return false
    entry.receipt = receipt
    await retirePermit(entry)
    entry.status = receipt.connection.status === 'connected' ? 'connected' : 'disconnected'
    return true
  }
  return Object.freeze({
    async start(event, raw) {
      caller(event)
      const request = record(raw, ['connectionId', 'launch', 'expectedRevision', 'source'])
      const expectedSource = request && record(request.source, ['tenantId', 'userId'])
      if (!request || typeof request.connectionId !== 'string' || !/^mcp-connection-[a-f0-9]{32}$/.test(request.connectionId) ||
          !Number.isSafeInteger(request.expectedRevision) || request.expectedRevision < 0 || !expectedSource ||
          ![expectedSource.tenantId, expectedSource.userId].every(value => typeof value === 'string' && /^[a-zA-Z0-9._:-]{1,128}$/.test(value))) fail('invalid')
      let launch
      try { launch = snapshotMcpStdioLaunch(request.launch) } catch { fail('invalid') }
      if (!launch) fail('invalid')
      prune()
      const active = [...flows.values()].filter(entry => entry.running || ['ready', 'working', 'uncertain'].includes(entry.status)).length
      if (preparing + active >= 4 || flows.size >= 64) fail('busy')
      preparing += 1
      try {
        const held = await source.resolveSource(request.connectionId)
        caller(event)
        // Renderer identity is only an exact precondition: the cookie-bound
        // source remains authoritative even while another tab changes account.
        if (!current(() => source.isSourceCurrent(held.stamp)) ||
            held.binding.tenantId !== expectedSource.tenantId || held.binding.ownerUserId !== expectedSource.userId ||
            held.binding.connectionRevision !== request.expectedRevision) fail('stale')
        if ([...flows.values()].some(entry => sameSource(entry.source, held) && !['connected', 'disconnected', 'failed', 'cancelled'].includes(entry.status))) fail('busy')
        const id = uuid()
        if (typeof id !== 'string' || !/^[a-zA-Z0-9-]{1,120}$/.test(id) || flows.has(id)) fail('unavailable')
        const entry = { id, source: held, launch, status: 'ready', controller: new AbortController(),
          expiresAt: timestamp() + 600_000, operationId: `stdio-${id}`, running: false, submitted: false }
        entry.timer = setTimeout(() => { cancel(entry); if (!entry.running) remove(entry) }, 600_000)
        entry.timer.unref?.()
        flows.set(id, entry)
        return view(entry)
      } finally { preparing -= 1 }
    },
    async authorize(event, raw) {
      const entry = lookup(event, raw)
      // This state change precedes every wait. Repeating the IPC message can
      // return progress but cannot redisplay consent or launch a second probe.
      if (entry.status !== 'ready') return view(entry)
      entry.status = 'working'
      entry.running = true
      try {
        await fresh(entry)
        entry.reference = await lifecycle.configure(binding3(entry.source.binding), entry.launch,
          { signal: entry.controller.signal, isCurrent: () => isCurrent(entry) })
        entry.launch = undefined
        await fresh(entry)
        entry.permit = await lifecycle.permitSetup(entry.reference, entry.source.binding,
          { signal: entry.controller.signal, isCurrent: () => isCurrent(entry) })
        const receipt = await source.inspect(entry.source, { operationId: entry.operationId,
          expectedRevision: entry.source.binding.connectionRevision, grantReference: entry.reference }, {
          signal: entry.controller.signal,
          beforeSubmit: () => {
            if (!isCurrent(entry) || entry.submitted || !lifecycle.isCurrent(entry.reference, entry.source.binding, 'inspect')) return false
            entry.submitted = true
            return true
          },
        })
        if (!await acknowledge(entry, receipt)) entry.status = 'uncertain'
      } catch (error) {
        if (error instanceof McpStdioDefinitiveInspectionRefusal) {
          // The trusted local API's exact upstream failure is emitted before
          // the durable inspection commit; only this typed result permits
          // deleting the corresponding provisional grant.
          entry.submitted = false
          entry.status = 'failed'
        } else {
          entry.status = entry.submitted ? 'uncertain' : entry.controller.signal.aborted ||
            (error instanceof McpStdioGrantError && error.code === 'cancelled') ? 'cancelled' : 'failed'
        }
      } finally {
        entry.launch = undefined
        try { await retirePermit(entry) } catch { /* Receipt recovery stays read-only. */ }
        await abandon(entry)
        entry.running = false
      }
      return view(entry)
    },
    async reconcile(event, raw) {
      const entry = lookup(event, raw)
      if (!entry.submitted || entry.running) return view(entry)
      // No POST, reconfiguration, consent or new process from this path.
      const receipt = await source.resolveSource(entry.source.binding.connectionId)
      if (!current(() => source.isSourceCurrent(entry.source.stamp)) || !sameSource(receipt, entry.source)) fail('stale')
      await acknowledge(entry, receipt)
      return view(entry)
    },
    cancel(event, raw) {
      const entry = lookup(event, raw)
      if (!['connected', 'disconnected'].includes(entry.status)) cancel(entry)
      return view(entry)
    },
    resetFlows() {
      for (const entry of flows.values()) { cancel(entry); if (!entry.running) remove(entry) }
    },
    close() {
      if (closed) return
      closed = true
      for (const entry of flows.values()) { cancel(entry); if (!entry.running) remove(entry) }
      source.close()
    },
  })
}
