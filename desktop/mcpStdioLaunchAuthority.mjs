/** Internal native composition, deliberately not installed in Electron IPC.
 * The trusted host supplies authenticated source checks and a native review
 * ceremony. Saving a launch grant is distinct from approving a tools/call. */
import { snapshotMcpStdioLaunch } from './mcpStdioLaunch.mjs'
import { snapshotMcpStdioGrantBinding, McpStdioGrantError } from './mcpStdioGrantVault.mjs'
import { McpStdioError } from './mcpStdioSupervisor.mjs'

export const MCP_STDIO_AUTHORITY_LIMITS = Object.freeze({ pending: 4, reviewMs: 60_000 })
const fail = code => { throw new McpStdioGrantError(code) }
function current(check) {
  try {
    const value = check()
    if (value === true) return true
    try { void Promise.resolve(value).catch(() => {}) } catch { /* fixed refusal */ }
  } catch { /* fixed refusal */ }
  return false
}

/** confirmLaunch receives immutable native-only data, never server-reported
 * identity. It must explain unsandboxed OS execution and return exactly true
 * only after explicit approval; closing/cancelling must return false.
 * The host does not own custody shutdown, but owns all processes it opens. */
export function createMcpStdioLaunchAuthority({ vault, supervisor, confirmLaunch, setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
  if (!vault || typeof vault.provision !== 'function' || typeof vault.read !== 'function' ||
      !supervisor || typeof supervisor.open !== 'function' || typeof confirmLaunch !== 'function') fail('invalid')
  let closed = false
  const pending = new Set()
  const connections = new Set()
  function optionsSnapshot(options) {
    try {
      if (!options || typeof options !== 'object' ||
          ![Object.prototype, null].includes(Object.getPrototypeOf(options))) fail('invalid')
      const keys = Reflect.ownKeys(options)
      if (!keys.includes('isCurrent') || keys.some(key => !['isCurrent', 'signal'].includes(key) ||
          Object.getOwnPropertyDescriptor(options, key)?.enumerable !== true ||
          !Object.hasOwn(Object.getOwnPropertyDescriptor(options, key), 'value')) ||
          typeof options.isCurrent !== 'function' ||
          (options.signal !== undefined && !(options.signal instanceof AbortSignal))) fail('invalid')
      return { isCurrent: options.isCurrent, signal: options.signal }
    } catch { fail('invalid') }
  }
  function check(options) {
    if (closed || options.signal?.aborted) fail('cancelled')
    if (!current(options.isCurrent)) fail('stale')
    if (closed || options.signal?.aborted) fail('cancelled')
  }
  function admit() { if (pending.size >= MCP_STDIO_AUTHORITY_LIMITS.pending) fail('capacity') }
  const safeError = error => {
    if (error instanceof McpStdioGrantError || error instanceof McpStdioError) throw error
    fail('unavailable')
  }

  return Object.freeze({
    async configure(rawBinding, rawLaunch, rawOptions) {
      const binding = snapshotMcpStdioGrantBinding(rawBinding)
      const launch = snapshotMcpStdioLaunch(rawLaunch)
      const options = optionsSnapshot(rawOptions)
      if (!binding || !launch) fail('invalid')
      check(options)
      admit()
      const controller = new AbortController()
      const signal = options.signal ? AbortSignal.any([controller.signal, options.signal]) : controller.signal
      const job = { abort: () => controller.abort() }
      pending.add(job)
      let timer
      let abortListener
      const interrupted = new Promise((_, reject) => {
        abortListener = () => reject(new McpStdioGrantError('cancelled'))
        signal.addEventListener('abort', abortListener, { once: true })
        timer = setTimer(() => controller.abort(), MCP_STDIO_AUTHORITY_LIMITS.reviewMs)
      })
      const operation = (async () => {
        check({ ...options, signal })
        const accepted = await confirmLaunch(Object.freeze({ binding, launch }), { signal })
        check({ ...options, signal })
        if (accepted !== true) fail('cancelled')
        // After submission to custody, do not race its acknowledgement against
        // cancellation: a committed provisional reference must be retained.
        clearTimer(timer)
        signal.removeEventListener('abort', abortListener)
        return vault.provision(binding, launch, { signal, isCurrent: () => !closed && current(options.isCurrent) })
      })()
      // An ignored native dialog keeps its capacity until its real completion.
      const tracked = operation.finally(() => {
        pending.delete(job)
        clearTimer(timer)
        signal.removeEventListener('abort', abortListener)
      })
      return Promise.race([tracked, interrupted]).catch(safeError)
    },
    async open(reference, rawBinding, rawOptions) {
      const binding = snapshotMcpStdioGrantBinding(rawBinding)
      const options = optionsSnapshot(rawOptions)
      if (!binding) fail('invalid')
      check(options)
      admit()
      const controller = new AbortController()
      const sourceSignal = options.signal ? AbortSignal.any([controller.signal, options.signal]) : controller.signal
      const job = { abort: () => controller.abort() }
      pending.add(job)
      let abortListener, timer
      const interrupted = new Promise((_, reject) => {
        abortListener = () => reject(new McpStdioGrantError('cancelled'))
        sourceSignal.addEventListener('abort', abortListener, { once: true })
        timer = setTimer(() => controller.abort(), MCP_STDIO_AUTHORITY_LIMITS.reviewMs)
      })
      const operation = (async () => {
        // Reading custody never launches anything. The source is fenced again
        // after its disk queue and immediately inside the process supervisor.
        const lease = await vault.read(reference, binding)
        if (!lease) fail('unavailable')
        const signal = AbortSignal.any([sourceSignal, lease.signal])
        const isCurrent = () => !closed && lease.isCurrent() && current(options.isCurrent)
        check({ signal, isCurrent })
        const connection = supervisor.open(lease.launch, { signal, isCurrent })
        const owned = { abort: () => controller.abort() }
        connections.add(owned)
        // The supervisor's close acknowledgement, not abort or a timeout,
        // retires process ownership and its transport capacity.
        void Promise.resolve(connection.closed).then(() => connections.delete(owned), () => {})
        return connection
      })()
      const tracked = operation.finally(() => {
        pending.delete(job)
        clearTimer(timer)
        sourceSignal.removeEventListener('abort', abortListener)
      })
      return Promise.race([tracked, interrupted]).catch(safeError)
    },
    close() {
      closed = true
      for (const job of pending) job.abort()
      for (const connection of connections) connection.abort()
    },
  })
}
