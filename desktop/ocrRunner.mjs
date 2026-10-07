import { spawn } from 'node:child_process'
import { isAbsolute } from 'node:path'

/** Shared bounded subprocess lifetime for device-local OCR engines. Each
 * engine owns its own capacity and parser; this runner owns stdin/stdout,
 * cancellation, deadlines, and retaining slots until child close. */
export function createBoundedOcrRunner({
  executable,
  targetPlatform = process.platform,
  timeoutMs,
  capacity,
  maxOutputBytes,
  prepareInput,
  parseOutput,
  spawnProcess = spawn,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
} = {}) {
  const active = new Set()
  let disposed = false

  function run(value, { signal } = {}) {
    if (disposed || signal?.aborted) return Promise.resolve({ status: 'cancelled' })
    if (targetPlatform !== 'darwin' || typeof executable !== 'string' || !isAbsolute(executable)) {
      return Promise.resolve({ status: 'unavailable' })
    }
    if (active.size >= capacity) return Promise.resolve({ status: 'busy' })
    const prepared = prepareInput(value)
    if (!Buffer.isBuffer(prepared)) return Promise.resolve(prepared)

    return new Promise((resolve) => {
      let child
      try {
        child = spawnProcess(executable, [], {
          cwd: '/', env: { LC_ALL: 'C' }, stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true,
        })
      } catch {
        resolve({ status: 'unavailable' })
        return
      }
      let settled = false
      let outputBytes = 0
      const chunks = []
      const settle = (result) => {
        if (settled) return
        settled = true
        clearTimer(timer)
        signal?.removeEventListener('abort', onAbort)
        chunks.length = 0
        resolve(result)
      }
      const stop = (status) => {
        if (settled) return
        settle({ status })
        try { child.kill('SIGKILL') } catch { /* close owns capacity release */ }
      }
      const onAbort = () => stop('cancelled')
      const job = { stop }
      active.add(job)
      const timer = setTimer(() => stop('timeout'), timeoutMs)
      child.once('error', () => stop('unavailable'))
      child.stdin.on('error', () => stop('unavailable'))
      child.stdout.on('error', () => stop('unavailable'))
      child.stdout.on('data', (chunk) => {
        if (settled) return
        outputBytes += chunk.length
        if (outputBytes > maxOutputBytes) { stop('unavailable'); return }
        chunks.push(Buffer.from(chunk))
      })
      child.once('close', (code, childSignal) => {
        active.delete(job)
        if (settled) return
        settle(code === 0 && !childSignal ? parseOutput(Buffer.concat(chunks, outputBytes)) : { status: 'unavailable' })
      })
      signal?.addEventListener('abort', onAbort, { once: true })
      if (signal?.aborted || disposed) onAbort()
      if (!settled) {
        try { child.stdin.end(prepared) } catch { stop('unavailable') }
      }
    })
  }

  return {
    run,
    dispose() {
      disposed = true
      for (const job of active) job.stop('cancelled')
    },
  }
}
