/** The shared dev launcher must remain alive until owned stack children exit. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn, type ChildProcess } from 'node:child_process'
import { createServer } from 'node:net'
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ROOT } from './helpers/source.ts'

const DEV = join(ROOT, 'scripts', 'dev.mjs')

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

async function portIsFree(port: number) {
  const probe = createServer()
  return new Promise<boolean>((resolve) => {
    probe.once('error', () => resolve(false))
    probe.once('listening', () => probe.close((error) => resolve(!error)))
    probe.listen(port, '127.0.0.1')
  })
}

async function waitForRecord(path: string, child: ChildProcess, ms = 5_000) {
  const deadline = Date.now() + ms
  while (Date.now() < deadline) {
    try { return JSON.parse(await readFile(path, 'utf8')) as {
      pid: number, port?: number, descendant?: { pid: number, port: number },
    } }
    catch { /* the fixture has not written its readiness record yet */ }
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(`Owned dev launcher exited before the child fixture was ready (${child.signalCode ?? child.exitCode})`)
    }
    await pause(20)
  }
  throw new Error('Timed out waiting for the authored child fixture to become ready')
}

async function waitForClose(closed: Promise<void>, ms: number) {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    await Promise.race([closed, new Promise<void>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`Owned dev launcher did not close within ${ms}ms`)), ms)
    })])
  } finally { clearTimeout(timer) }
}

function killExact(pid: number | undefined) {
  if (!Number.isSafeInteger(pid) || !pid || pid < 2 || pid === process.pid) return
  try { process.kill(pid, 'SIGKILL') }
  catch (error: any) { if (error?.code !== 'ESRCH') throw error }
}

async function createOwnedStack({ ignoreServerTerm = false, survivingDescendant = false } = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'ac-owned-stack-lifecycle-'))
  const bin = join(directory, 'bin')
  const shim = join(bin, 'node')
  const serverFixture = join(directory, 'server-fixture.cjs')
  const descendantFixture = join(directory, 'descendant-fixture.cjs')
  const uiFixture = join(directory, 'ui-fixture.cjs')
  const readyPath = join(directory, 'server-ready.json')
  const descendantReadyPath = join(directory, 'descendant-ready.json')
  const closedPath = join(directory, 'server-closed')
  const uiReadyPath = join(directory, 'ui-ready.json')
  const serverSource = `
const { createServer } = require('node:net')
const { existsSync, writeFileSync } = require('node:fs')
const { spawn } = require('node:child_process')
const server = createServer()
${survivingDescendant ? `
const descendant = spawn(process.execPath, [process.env.DEV_LIFECYCLE_DESCENDANT_FIXTURE], { stdio: 'ignore' })
` : ''}
server.listen(Number(process.env.PORT), '127.0.0.1', () => {
  ${survivingDescendant
    ? `const wait = setInterval(() => {
    if (!existsSync(process.env.DEV_LIFECYCLE_DESCENDANT_READY)) return
    clearInterval(wait)
    const descendantReady = JSON.parse(require('node:fs').readFileSync(process.env.DEV_LIFECYCLE_DESCENDANT_READY, 'utf8'))
    writeFileSync(process.env.DEV_LIFECYCLE_SERVER_READY, JSON.stringify({ pid: process.pid, port: server.address().port, descendant: descendantReady }))
  }, 10)`
    : 'writeFileSync(process.env.DEV_LIFECYCLE_SERVER_READY, JSON.stringify({ pid: process.pid, port: server.address().port }))'}
})
${ignoreServerTerm ? 'process.on("SIGTERM", () => {})' : `process.on('SIGTERM', () => setTimeout(() => server.close(() => {
  writeFileSync(process.env.DEV_LIFECYCLE_SERVER_CLOSED, 'closed')
  process.exit(0)
}), ${survivingDescendant ? '0' : '900'}))`}
`
  const descendantSource = `
const { createServer } = require('node:net')
const { writeFileSync } = require('node:fs')
const server = createServer()
process.on('SIGTERM', () => {})
server.listen(0, '127.0.0.1', () => {
  writeFileSync(process.env.DEV_LIFECYCLE_DESCENDANT_READY, JSON.stringify({
    pid: process.pid,
    port: server.address().port,
  }))
})
`
  const uiSource = `
const { writeFileSync } = require('node:fs')
writeFileSync(process.env.DEV_LIFECYCLE_UI_READY, JSON.stringify({ pid: process.pid }))
process.on('SIGTERM', () => process.exit(0))
setInterval(() => {}, 1000)
`
  const shimSource = `#!/${process.execPath.replace(/^\//, '')}
const { pathToFileURL } = require('node:url')
const args = process.argv.slice(2)
const target = args.includes('server/index.ts')
  ? process.env.DEV_LIFECYCLE_SERVER_FIXTURE
  : process.env.DEV_LIFECYCLE_UI_FIXTURE
process.argv = [process.execPath, target, ...args.slice(1)]
import(pathToFileURL(target).href).catch(error => { console.error(error); process.exitCode = 1 })
`

  await mkdir(bin, { recursive: true })
  await writeFile(serverFixture, serverSource)
  await writeFile(descendantFixture, descendantSource)
  await writeFile(uiFixture, uiSource)
  await writeFile(shim, shimSource)
  await chmod(shim, 0o755)
  let child: ChildProcess | undefined
  let closed: Promise<void> | undefined
  try {
    child = spawn(process.execPath, [DEV], {
      cwd: ROOT,
      stdio: 'ignore',
      env: {
        ...process.env,
        PATH: `${bin}:${process.env.PATH ?? ''}`,
        PORT: '0',
        MOCK_PORT: '0',
        SERVER_WATCH: 'off',
        DEV_LIFECYCLE_SERVER_FIXTURE: serverFixture,
        DEV_LIFECYCLE_DESCENDANT_FIXTURE: descendantFixture,
        DEV_LIFECYCLE_UI_FIXTURE: uiFixture,
        DEV_LIFECYCLE_SERVER_READY: readyPath,
        DEV_LIFECYCLE_DESCENDANT_READY: descendantReadyPath,
        DEV_LIFECYCLE_SERVER_CLOSED: closedPath,
        DEV_LIFECYCLE_UI_READY: uiReadyPath,
      },
    })
    closed = new Promise(resolve => child!.once('close', () => resolve()))
    const server = await waitForRecord(readyPath, child)
    const ui = await waitForRecord(uiReadyPath, child)
    assert.ok(Number.isInteger(server.port) && server.port! > 0,
      'the listening backend, not a preflight probe, publishes its assigned port')
    return {
      directory,
      apiPort: server.port,
      closedPath,
      child,
      closed,
      serverPid: server.pid,
      descendantPid: server.descendant?.pid,
      descendantPort: server.descendant?.port,
      uiPid: ui.pid,
      async cleanup() {
        if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
        killExact(server.pid)
        killExact(server.descendant?.pid)
        killExact(ui.pid)
        await waitForClose(closed!, 1_000)
        await rm(directory, { recursive: true, force: true })
      },
    }
  } catch (error) {
    if (child && child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
    for (const path of [readyPath, descendantReadyPath, uiReadyPath]) {
      try { killExact(JSON.parse(await readFile(path, 'utf8')).pid) }
      catch { /* no fixture PID was published */ }
    }
    if (closed) await waitForClose(closed, 1_000)
    await rm(directory, { recursive: true, force: true })
    throw error
  }
}

test('owned dev launcher waits for a SIGTERM child drain before exiting', { timeout: 10_000, skip: process.platform === 'win32' }, async () => {
  const stack = await createOwnedStack()
  try {
    assert.equal(await portIsFree(stack.apiPort), false, 'the authored backend fixture owns its isolated port')
    stack.child.kill('SIGTERM')
    await waitForClose(stack.closed, 3_000)
    assert.equal(existsSync(stack.closedPath), true,
      'launcher close means the delayed child shutdown completed, not just that SIGTERM was sent')
    assert.equal(await portIsFree(stack.apiPort), true, 'the child port is released when launcher close is observed')
  } finally {
    await stack.cleanup()
  }
})

test('owned dev launcher escalates an unresponsive child without leaving its port held', { timeout: 12_000, skip: process.platform === 'win32' }, async () => {
  const stack = await createOwnedStack({ ignoreServerTerm: true })
  try {
    assert.equal(await portIsFree(stack.apiPort), false, 'the authored backend fixture owns its isolated port')
    stack.child.kill('SIGTERM')
    await waitForClose(stack.closed, 9_000)
    assert.equal(await portIsFree(stack.apiPort), true, 'bounded shutdown escalates before the launcher exits')
    assert.throws(() => process.kill(stack.serverPid, 0), { code: 'ESRCH' },
      'the exact unresponsive fixture PID is gone when launcher close is observed')
  } finally {
    await stack.cleanup()
  }
})

test('owned dev launcher escalates a surviving same-group descendant after its leader closes', { timeout: 12_000, skip: process.platform === 'win32' }, async () => {
  const stack = await createOwnedStack({ survivingDescendant: true })
  try {
    assert.equal(typeof stack.descendantPid, 'number', 'the authored same-group descendant published its exact PID')
    assert.equal(await portIsFree(stack.descendantPort!), false, 'the descendant fixture owns its isolated ephemeral port')
    stack.child.kill('SIGTERM')
    await pause(250)
    assert.equal(stack.child.exitCode, null,
      'the launcher must not return when only the API group leader closed; its TERM-ignoring descendant remains')
    await waitForClose(stack.closed, 9_000)
    assert.equal(await portIsFree(stack.descendantPort!), true,
      'launcher close means the surviving descendant released its port after escalation')
    assert.throws(() => process.kill(stack.descendantPid!, 0), { code: 'ESRCH' },
      'the exact surviving descendant PID is gone when launcher close is observed')
  } finally {
    await stack.cleanup()
  }
})
