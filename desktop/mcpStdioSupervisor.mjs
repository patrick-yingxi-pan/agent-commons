/** Internal macOS stdio transport, not a launch permission or a sandbox.
 * Callers must own user-approved configuration and a current native identity.
 * No renderer, HTTP, model or startup path imports this foundation yet. */
import { spawn } from 'node:child_process'
import { snapshotMcpStdioLaunch } from './mcpStdioLaunch.mjs'
import { createMcpStdioDecoder, encodeMcpStdioMessage } from './mcpStdioCodec.mjs'

export const MCP_STDIO_PROCESS_LIMITS = Object.freeze({
  capacity: 4, lifetimeMs: 60_000, requestMs: 30_000,
  shutdownGraceMs: 250, killGraceMs: 250,
  maxRequests: 128, maxWriteBytes: 2_097_152, maxStderrBytes: 1_048_576,
})
const CODES = new Set(['invalid', 'unavailable', 'busy', 'cancelled', 'stale', 'timeout', 'closed', 'protocol', 'limit', 'io'])
export class McpStdioError extends Error {
  constructor(code = 'invalid', mayHaveSubmitted = false) {
    const safe = CODES.has(code) ? code : 'invalid'
    super(`The local MCP transport failed (${safe}).`)
    this.name = 'McpStdioError'
    this.code = safe
    // This describes request bytes only. Launching executable code itself may
    // have effects, even when no MCP request has been submitted.
    this.mayHaveSubmitted = mayHaveSubmitted === true
  }
}
const METHODS = new Set(['server/discover', 'initialize', 'tools/list', 'tools/call'])
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value)
function current(check) {
  try {
    const answer = check()
    if (answer && typeof answer.then === 'function') void Promise.resolve(answer).catch(() => {})
    return answer === true
  } catch { return false }
}
function responseKind(row, expectedId) {
  if (row.jsonrpc !== '2.0') return null
  if (Object.hasOwn(row, 'method')) {
    return typeof row.method === 'string' && row.method.startsWith('notifications/') &&
      row.method.length <= 128 && !Object.hasOwn(row, 'id') &&
      !Object.hasOwn(row, 'result') && !Object.hasOwn(row, 'error') &&
      (!Object.hasOwn(row, 'params') || record(row.params)) ? 'notification' : null
  }
  const hasResult = Object.hasOwn(row, 'result')
  const hasError = Object.hasOwn(row, 'error')
  if (expectedId === undefined || row.id !== expectedId || hasResult === hasError) return null
  if (hasError && (!record(row.error) || !Number.isInteger(row.error.code) || typeof row.error.message !== 'string')) return null
  return 'response'
}

/** Dependency injection is only for deterministic subprocess tests. Cancelled
 * work keeps admission until close, including after SIGKILL. Never respawns or
 * retries; protocol negotiation and effect consent belong above this layer. */
export function createMcpStdioSupervisor({
  spawnProcess = spawn, setTimer = setTimeout, clearTimer = clearTimeout,
  signalProcess = (pid, signal) => process.kill(pid, signal),
  targetPlatform = process.platform,
} = {}) {
  const active = new Set()
  let disposed = false

  function open(rawLaunch, { signal, isCurrent } = {}) {
    const fail = code => { throw new McpStdioError(code) }
    if (disposed || signal?.aborted) fail('cancelled')
    if (targetPlatform !== 'darwin') fail('unavailable')
    if (typeof isCurrent !== 'function') fail('invalid')
    const launch = snapshotMcpStdioLaunch(rawLaunch)
    if (!launch) fail('invalid')
    if (!current(isCurrent)) fail('stale')
    if (active.size >= MCP_STDIO_PROCESS_LIMITS.capacity) fail('busy')
    let child
    try {
      child = spawnProcess(launch.executable, [...launch.args], {
        cwd: launch.cwd, env: { ...launch.env }, shell: false, detached: true,
        stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true,
      })
    } catch { fail('unavailable') }

    const decoder = createMcpStdioDecoder()
    let stopping = false
    let closed = false
    let groupRetired = false
    let stopCode = 'closed'
    let pending
    let nextId = 0
    let writeBytes = 0
    let stderrBytes = 0
    let requestCount = 0
    let lifetimeTimer, termTimer, killTimer
    let resolveClosed
    const closedPromise = new Promise(resolve => { resolveClosed = resolve })

    function settle(error, response) {
      const operation = pending
      if (!operation) return
      pending = undefined
      clearTimer(operation.timer)
      operation.signal?.removeEventListener('abort', operation.onAbort)
      if (error) operation.reject(new McpStdioError(error, operation.submitted))
      else operation.resolve(response)
    }
    function killGroup(signalName) {
      if (closed || groupRetired) return
      // A numeric process-group ID must never be used again after termination
      // or leader exit; an escaped descendant can delay pipe close indefinitely.
      if (signalName === 'SIGKILL') groupRetired = true
      // A fresh POSIX session gives this launch its own process group. This
      // cleans up ordinary descendants, not deliberately escaped processes;
      // it is lifetime management, not containment of arbitrary executable code.
      try {
        if (Number.isSafeInteger(child.pid) && child.pid > 1) signalProcess(-child.pid, signalName)
      } catch { /* close alone releases admission; ESRCH is normal on exit */ }
    }
    function stop(code = 'closed', cancel = false) {
      if (stopping || closed) return
      stopping = true
      stopCode = code
      clearTimer(lifetimeTimer)
      signal?.removeEventListener('abort', onHostAbort)
      // Best-effort cancellation never grants success or remote rollback. The
      // subsequent EOF/TERM/KILL sequence also handles uncooperative children.
      if (cancel && pending?.submitted && pending.id !== undefined) {
        try {
          const bytes = encodeMcpStdioMessage({ jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: pending.id } })
          if (writeBytes + bytes.length <= MCP_STDIO_PROCESS_LIMITS.maxWriteBytes) child.stdin.write(bytes, () => {})
        } catch { /* no raw child diagnostics leave this transport */ }
      }
      settle(code)
      try { child.stdin.end() } catch { /* escalation remains bounded */ }
      if (closed || groupRetired) return
      termTimer = setTimer(() => {
        if (closed || groupRetired) return
        killGroup('SIGTERM')
        if (!closed && !groupRetired) killTimer = setTimer(() => killGroup('SIGKILL'), MCP_STDIO_PROCESS_LIMITS.killGraceMs)
      }, MCP_STDIO_PROCESS_LIMITS.shutdownGraceMs)
    }
    const onHostAbort = () => stop('cancelled', true)
    const job = { stop }
    active.add(job)
    child.once('error', () => stop('io'))
    child.stdin.on('error', () => stop('io'))
    child.stdout.on('error', () => stop('io'))
    child.stderr.on('error', () => stop('io'))
    child.stderr.on('data', chunk => {
      if (stopping) return
      stderrBytes += chunk.length
      // Drain without logging, decoding, retaining, or exposing secret-bearing
      // diagnostics. A cumulative cap also bounds a noisy peer's work.
      if (stderrBytes > MCP_STDIO_PROCESS_LIMITS.maxStderrBytes) stop('limit')
    })
    child.stdout.on('data', chunk => {
      if (stopping) return
      if (!current(isCurrent)) { stop('stale', true); return }
      try {
        const rows = decoder.push(chunk)
        let response
        for (const row of rows) {
          const kind = responseKind(row, pending?.id)
          if (!kind || (kind === 'response' && response !== undefined)) { stop('protocol'); return }
          if (kind === 'response') response = row
          // All notifications are inert, bounded protocol input. No server
          // request, sampling, elicitation, URL, log or resource is dispatched.
        }
        if (response !== undefined) {
          if (!current(isCurrent)) { stop('stale', true); return }
          settle(undefined, response)
        }
      } catch (error) { stop(error?.code === 'limit' ? 'limit' : 'protocol') }
    })
    child.stdout.once('end', () => {
      if (stopping) return
      try { decoder.end(); stop('closed') } catch { stop('protocol') }
    })
    // `close` waits for inherited pipes too. A dead leader must start group
    // cleanup immediately, not spend the whole lifetime waiting on descendants.
    child.once('exit', () => {
      // One immediate group cleanup, then retire its identifier. Never defer
      // signaling a reaped leader's potentially reusable ID until pipe close.
      killGroup('SIGKILL')
      clearTimer(termTimer)
      clearTimer(killTimer)
      stop('closed')
    })
    child.once('close', () => {
      groupRetired = true
      closed = true
      clearTimer(lifetimeTimer)
      clearTimer(termTimer)
      clearTimer(killTimer)
      signal?.removeEventListener('abort', onHostAbort)
      settle(stopping ? stopCode : 'closed')
      active.delete(job)
      resolveClosed({ code: stopping ? stopCode : 'closed' })
    })
    lifetimeTimer = setTimer(() => stop('timeout', true), MCP_STDIO_PROCESS_LIMITS.lifetimeMs)
    signal?.addEventListener('abort', onHostAbort, { once: true })
    if (signal?.aborted || disposed) stop('cancelled', true)

    function send(method, params, options, notification) {
      if (stopping || closed) return Promise.reject(new McpStdioError(stopCode))
      if (options.signal?.aborted) return Promise.reject(new McpStdioError('cancelled'))
      if (!current(isCurrent)) { stop('stale', true); return Promise.reject(new McpStdioError('stale')) }
      if (pending) return Promise.reject(new McpStdioError('busy'))
      let bytes, id
      try {
        if (!record(params) || (!notification && !METHODS.has(method))) throw new McpStdioError()
        id = notification ? undefined : nextId + 1
        bytes = encodeMcpStdioMessage({ jsonrpc: '2.0', ...(notification ? {} : { id }), method, params })
      } catch (error) { return Promise.reject(new McpStdioError(error?.code === 'limit' ? 'limit' : 'invalid')) }
      if (++requestCount > MCP_STDIO_PROCESS_LIMITS.maxRequests || writeBytes + bytes.length > MCP_STDIO_PROCESS_LIMITS.maxWriteBytes) {
        stop('limit'); return Promise.reject(new McpStdioError('limit'))
      }
      if (!notification) nextId = id
      return new Promise((resolve, reject) => {
        const operation = { id, signal: options.signal, resolve, reject, submitted: false, timer: undefined, onAbort: undefined }
        pending = operation
        operation.onAbort = () => stop('cancelled', true)
        operation.timer = setTimer(() => stop('timeout', true), MCP_STDIO_PROCESS_LIMITS.requestMs)
        options.signal?.addEventListener('abort', operation.onAbort, { once: true })
        if (options.signal?.aborted || signal?.aborted || disposed) { stop('cancelled', true); return }
        if (!current(isCurrent)) { stop('stale', true); return }
        writeBytes += bytes.length
        // Mark before write: even a synchronous failure can have partially
        // submitted bytes. No caller may infer that replay is safe.
        operation.submitted = true
        try {
          child.stdin.write(bytes, error => {
            if (error) { stop('io'); return }
            if (pending !== operation || !notification) return
            if (!current(isCurrent)) { stop('stale'); return }
            settle(undefined, undefined)
          })
        } catch { stop('io') }
      })
    }

    return Object.freeze({
      request: (method, params = {}, options = {}) => send(method, params, options, false),
      initialized: () => send('notifications/initialized', {}, {}, true),
      close: () => { stop('closed', true); return closedPromise },
      closed: closedPromise,
    })
  }

  return Object.freeze({
    open,
    dispose() { disposed = true; for (const job of active) job.stop('cancelled', true) },
  })
}
