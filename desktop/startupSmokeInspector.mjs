/** Test-only helpers for inspecting a packaged Electron main process before its
 * entry module bootstraps. Never include this inspector/dialog fixture in a
 * shipped runtime or treat its answers as operating-system dialog evidence. */
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const OUTPUT_LIMIT = 32_768
const INSPECTOR_TIMEOUT_MS = 10_000
const STOP_TIMEOUT_MS = 5_000

function appendTail(current, chunk) {
  return `${current}${chunk}`.slice(-OUTPUT_LIMIT)
}

function smokeEnvironment() {
  return {
    ...process.env,
    AGENT_COMMONS_DEV_URL: '',
    ELECTRON_RUN_AS_NODE: undefined,
    NODE_OPTIONS: '',
  }
}

export function createProcess(executable, args) {
  const child = spawn(executable, args, {
    cwd: ROOT,
    env: smokeEnvironment(),
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let output = ''
  child.stdout.setEncoding('utf8')
  child.stderr.setEncoding('utf8')
  child.stdout.on('data', chunk => { output = appendTail(output, chunk) })
  child.stderr.on('data', chunk => { output = appendTail(output, chunk) })
  return { child, output: () => output }
}

export function waitForChildExit(child, timeoutMs, description) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve({ code: child.exitCode, signal: child.signalCode })
  }
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      child.off('exit', onExit)
      reject(new Error(`${description} did not exit within ${timeoutMs} ms.`))
    }, timeoutMs)
    const onExit = (code, signal) => {
      clearTimeout(timeout)
      resolve({ code, signal })
    }
    child.once('exit', onExit)
  })
}

export async function stopChild(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return
  const exited = waitForChildExit(child, STOP_TIMEOUT_MS, 'Packaged app')
    .catch(() => null)
  child.kill('SIGTERM')
  if (await exited) return
  child.kill('SIGKILL')
  await waitForChildExit(child, 1_000, 'Packaged app after SIGKILL').catch(() => {})
}

export async function waitForInspectorUrl(run) {
  const deadline = Date.now() + INSPECTOR_TIMEOUT_MS
  while (Date.now() < deadline) {
    const match = run.output().match(/Debugger listening on (ws:\/\/127\.0\.0\.1:\d+\/[^\s]+)/)
    if (match) return match[1]
    if (run.child.exitCode !== null || run.child.signalCode !== null) {
      throw new Error(`Packaged app exited before exposing its loopback inspector (${run.child.signalCode ?? `code ${run.child.exitCode}`}).\n\n${run.output()}`)
    }
    await new Promise(resolve => setTimeout(resolve, 25))
  }
  throw new Error(`Packaged app did not expose its loopback inspector.\n\n${run.output()}`)
}

class InspectorClient {
  constructor(socket) {
    this.socket = socket
    this.nextId = 0
    this.pending = new Map()
    this.events = []
    this.eventWaiters = []
    socket.addEventListener('message', event => {
      let message
      try { message = JSON.parse(String(event.data)) }
      catch { return }
      if (message.id !== undefined) {
        const pending = this.pending.get(message.id)
        if (!pending) return
        this.pending.delete(message.id)
        clearTimeout(pending.timeout)
        if (message.error) pending.reject(new Error(message.error.message ?? 'Inspector command failed.'))
        else pending.resolve(message.result ?? {})
        return
      }
      let delivered = false
      for (const waiter of [...this.eventWaiters]) {
        if (waiter.method !== message.method || !waiter.predicate(message.params ?? {})) continue
        delivered = true
        this.eventWaiters.splice(this.eventWaiters.indexOf(waiter), 1)
        clearTimeout(waiter.timeout)
        waiter.resolve(message.params ?? {})
      }
      if (!delivered) {
        this.events.push(message)
        if (this.events.length > 256) this.events.shift()
      }
    })
    socket.addEventListener('close', () => {
      for (const pending of this.pending.values()) {
        clearTimeout(pending.timeout)
        pending.reject(new Error('Packaged app inspector disconnected.'))
      }
      this.pending.clear()
      for (const waiter of this.eventWaiters) {
        clearTimeout(waiter.timeout)
        waiter.reject(new Error('Packaged app inspector disconnected.'))
      }
      this.eventWaiters = []
    })
  }

  static async connect(url) {
    if (typeof WebSocket !== 'function') throw new Error('Node WebSocket support is required for packaged startup acceptance.')
    const socket = new WebSocket(url)
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Could not connect to the packaged app inspector.')), 5_000)
      socket.addEventListener('open', () => { clearTimeout(timeout); resolve() }, { once: true })
      socket.addEventListener('error', () => { clearTimeout(timeout); reject(new Error('Could not connect to the packaged app inspector.')) }, { once: true })
    })
    return new InspectorClient(socket)
  }

  command(method, params = {}) {
    const id = ++this.nextId
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`Inspector command ${method} timed out.`))
      }, 5_000)
      this.pending.set(id, { resolve, reject, timeout })
      this.socket.send(JSON.stringify({ id, method, params }))
    })
  }

  waitForEvent(method, predicate = () => true) {
    const index = this.events.findIndex(event => event.method === method && predicate(event.params ?? {}))
    if (index !== -1) return Promise.resolve(this.events.splice(index, 1)[0].params ?? {})
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.eventWaiters = this.eventWaiters.filter(waiter => waiter.resolve !== resolve)
        reject(new Error(`Inspector event ${method} timed out.`))
      }, 5_000)
      this.eventWaiters.push({ method, predicate, resolve, reject, timeout })
    })
  }

  close() {
    try { this.socket.close() } catch {}
  }
}

/** Installs a test-only dialog answer while the exact inspector break-on-start
 * pause is active, before app.whenReady() or the packaged main module runs. */
export async function installStartupFixture(inspectorUrl, expression) {
  const inspector = await InspectorClient.connect(inspectorUrl)
  try {
    await inspector.command('Debugger.enable')
    const paused = inspector.waitForEvent('Debugger.paused')
    paused.catch(() => {})
    await inspector.command('Runtime.runIfWaitingForDebugger')
    const pauseDetails = await paused
    assert.equal(pauseDetails.reason, 'Break on start', 'only the initial pre-bootstrap inspector pause is accepted')
    const result = await inspector.command('Runtime.evaluate', { expression, returnByValue: true })
    if (result.exceptionDetails || result.result?.value !== true) {
      throw new Error(`Could not install the temporary startup fixture: ${JSON.stringify(result.exceptionDetails ?? result)}`)
    }
    await inspector.command('Debugger.resume')
    return inspector
  } catch (error) {
    inspector.close()
    throw error
  }
}
