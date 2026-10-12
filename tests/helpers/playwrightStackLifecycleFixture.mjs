import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { writeFileSync } from 'node:fs'
import { chmod, copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { ROOT } from './source.ts'

const PLAYWRIGHT_CLI = join(ROOT, 'node_modules', '@playwright', 'test', 'cli.js')

async function listen(server, port = 0) {
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, '127.0.0.1', resolve)
  })
  return server.address().port
}

async function close(server) {
  if (server.listening) await new Promise(resolve => server.close(resolve))
}

function fakeNodeSource(realNode, devPath) {
  return `#!${realNode}
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { writeFileSync } from 'node:fs'
import { join, basename } from 'node:path'

const args = process.argv.slice(2)
const state = process.env.PLAYWRIGHT_STACK_LIFECYCLE_STATE
if (args[0] === ${JSON.stringify(devPath)}) {
  const dev = spawn(${JSON.stringify(realNode)}, args, {
    cwd: process.cwd(), env: process.env, stdio: 'inherit',
  })
  writeFileSync(join(state, 'dev.json'), JSON.stringify({ wrapperPid: process.pid, pid: dev.pid }))
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => { try { dev.kill(signal) } catch {} })
  }
  dev.on('error', () => { process.exitCode = 1 })
  dev.on('close', (code, signal) => {
    writeFileSync(join(state, 'dev-exited'), 'exited')
    process.exitCode = code ?? (signal ? 1 : 0)
  })
} else {
  const role = args[0] === 'server/index.ts'
    ? 'backend'
    : basename(args[0] || '') === 'vite.js' ? 'ui' : 'unknown'
  if (role === 'unknown') process.exit(64)
  const requestedPort = Number(process.env.PORT)
  const server = createServer((req, res) => {
    if (role === 'backend' && req.url === '/hold') {
      writeFileSync(join(state, 'backend-held'), 'held')
      return
    }
    res.writeHead(200, { 'content-type': 'text/plain' })
    res.end(role)
  })
  let draining = false
  const drain = signal => {
    if (draining) return
    draining = true
    writeFileSync(join(state, 'signal-' + role), signal)
    server.close(() => {
      writeFileSync(join(state, 'drained-' + role), 'drained')
      process.exitCode = 0
    })
  }
  process.on('SIGTERM', () => drain('SIGTERM'))
  process.on('SIGINT', () => drain('SIGINT'))
  process.on('exit', () => writeFileSync(join(state, 'exited-' + role), 'exited'))
  server.listen(requestedPort, '127.0.0.1', () => {
    const port = server.address().port
    writeFileSync(join(state, 'ready-' + role + '.json'), JSON.stringify({ pid: process.pid, port }))
    if (role === 'ui') console.log('STACK_FIXTURE_UI_READY')
  })
}`
}

function fixtureSpecSource(testModule) {
  return `import { test, expect } from ${JSON.stringify(testModule)}
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const state = process.env.PLAYWRIGHT_STACK_LIFECYCLE_STATE
async function readyRecord(role) {
  const path = join(state, 'ready-' + role + '.json')
  const deadline = Date.now() + 8000
  while (Date.now() < deadline) {
    try { return JSON.parse(readFileSync(path, 'utf8')) }
    catch (error) {
      if (error.code !== 'ENOENT') throw error
      await new Promise(resolve => setTimeout(resolve, 20))
    }
  }
  throw new Error('Timed out waiting for fixture server readiness: ' + role)
}
test('owned dev stack responds locally and remains held for the lifecycle check', async () => {
  const uiPort = (await readyRecord('ui')).port
  const backendPort = (await readyRecord('backend')).port
  const ui = await fetch('http://127.0.0.1:' + uiPort + '/health')
  expect(await ui.text()).toBe('ui')
  const backend = await fetch('http://127.0.0.1:' + backendPort + '/health')
  expect(await backend.text()).toBe('backend')
  writeFileSync(join(state, 'spec-ready'), 'ready')
  const controlPort = process.env.PLAYWRIGHT_STACK_LIFECYCLE_CONTROL_PORT
  const release = await fetch('http://127.0.0.1:' + controlPort + '/hold')
  expect(release.status).toBe(200)
})`
}

export async function createPlaywrightStackLifecycleFixture() {
  const root = await mkdtemp(join(tmpdir(), 'playwright-stack-lifecycle-'))
  const state = join(root, 'state')
  const bin = join(root, 'bin')
  const specs = join(root, 'specs')
  await Promise.all([mkdir(state), mkdir(bin), mkdir(specs)])
  // The dev children bind port 0 directly; the config waits for a stdout
  // readiness token instead of probing and racing another process to bind.
  const control = await startFixtureControlServer(state)
  const devPath = join(ROOT, 'scripts', 'dev.mjs')
  const nodePath = join(bin, 'node')
  await writeFile(nodePath, fakeNodeSource(process.execPath, devPath), { mode: 0o755 })
  await chmod(nodePath, 0o755)
  const testModule = pathToFileURL(join(ROOT, 'node_modules', '@playwright', 'test', 'index.mjs')).href
  await writeFile(join(specs, 'stack.spec.mjs'), fixtureSpecSource(testModule))

  const configPath = join(root, 'playwright.config.mjs')
  const productionConfig = pathToFileURL(join(ROOT, 'playwright.config.ts')).href
  const webServerCommand = `node ${devPath}`
  const config = `import production from ${JSON.stringify(productionConfig)}
export default {
  ...production,
  testDir: ${JSON.stringify(specs)},
  outputDir: ${JSON.stringify(join(root, 'results'))},
  timeout: 15000,
  expect: { timeout: 3000 },
  workers: 1,
  fullyParallel: false,
  reporter: 'list',
  webServer: {
    ...production.webServer,
    command: ${JSON.stringify(webServerCommand)},
    cwd: ${JSON.stringify(ROOT)},
    url: undefined,
    wait: { stdout: /STACK_FIXTURE_UI_READY/ },
    reuseExistingServer: false,
    timeout: 15000,
    env: {
      ...production.webServer.env,
      PORT: '0',
      MOCK_PORT: '0',
      SERVER_WATCH: 'off',
      PATH: ${JSON.stringify(`${bin}:${process.env.PATH ?? ''}`)},
    },
  },
}
`
  await writeFile(configPath, config)
  return { root, state, bin, specs, configPath, devPath, control }
}

export async function startFixtureControlServer(state) {
  let heldResponse
  const server = createServer((req, res) => {
    if (req.url !== '/hold') { res.writeHead(404).end(); return }
    heldResponse = res
    writeFileSync(join(state, 'control-held'), 'held')
  })
  const port = await listen(server)
  return {
    server,
    port,
    release() { heldResponse?.writeHead(200).end(); heldResponse = undefined },
  }
}

export function startPlaywrightStackLifecycleRunner(fixture, controlPort) {
  const child = spawn(process.execPath, [PLAYWRIGHT_CLI, 'test', '--config', fixture.configPath], {
    cwd: fixture.root,
    env: {
      ...process.env,
      PATH: `${fixture.bin}:${process.env.PATH ?? ''}`,
      PLAYWRIGHT_STACK_LIFECYCLE_STATE: fixture.state,
      PLAYWRIGHT_STACK_LIFECYCLE_CONTROL_PORT: String(controlPort),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let output = ''
  child.stdout.setEncoding('utf8')
  child.stderr.setEncoding('utf8')
  child.stdout.on('data', chunk => { output += chunk })
  child.stderr.on('data', chunk => { output += chunk })
  const closed = new Promise(resolve => child.once('close', (code, signal) => resolve({ code, signal })))
  return { child, closed, output: () => output }
}

export async function createVerifierLifecycleHarness(fixture, { mapBrowserSignal = true } = {}) {
  const root = join(fixture.root, 'verifier-repo')
  const scripts = join(root, 'scripts')
  const e2e = join(root, 'e2e')
  const tests = join(root, 'tests')
  const bin = join(root, 'bin')
  await Promise.all([scripts, e2e, tests, bin].map(path => mkdir(path, { recursive: true })))
  for (const file of ['verify.mjs', 'verifyPlan.mjs', 'hostSpeed.mjs', 'childProcessLifecycle.mjs']) {
    await copyFile(join(ROOT, 'scripts', file), join(scripts, file))
  }
  if (!mapBrowserSignal) {
    const verifyPath = join(scripts, 'verify.mjs')
    const source = await readFile(verifyPath, 'utf8')
    const mapped = "signal: browserLane ? 'SIGINT' : signal,"
    if (!source.includes(mapped)) throw new Error('Verifier fixture could not find its Playwright signal mapping seam.')
    await writeFile(verifyPath, source.replace(mapped, 'signal,'))
  }
  await writeFile(join(root, 'package.json'), JSON.stringify({
    type: 'module',
    scripts: { test: 'node --test --test-concurrency=1 "tests/**/*.test.ts"' },
  }, null, 2))
  await writeFile(join(tests, 'placeholder.test.ts'), "import { test } from 'node:test'\ntest('placeholder', () => {})\n")
  await writeFile(join(e2e, 'stack.spec.ts'), "import { test } from '@playwright/test'\ntest('one counted verifier fixture', () => {})\n")

  const shimPath = join(bin, 'npx')
  const specPath = join(fixture.specs, 'stack.spec.mjs')
  await writeFile(shimPath, `#!${process.execPath}
import { spawn } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

const state = process.env.PLAYWRIGHT_STACK_LIFECYCLE_STATE
const args = process.argv.slice(2)
if (args[0] !== 'playwright' || args[1] !== 'test') process.exit(64)
const child = spawn(${JSON.stringify(process.execPath)}, [
  ${JSON.stringify(PLAYWRIGHT_CLI)},
  'test',
  '--config',
  ${JSON.stringify(fixture.configPath)},
  ${JSON.stringify(specPath)},
], { cwd: process.cwd(), env: process.env, stdio: 'inherit' })
writeFileSync(join(state, 'npx.json'), JSON.stringify({ wrapperPid: process.pid, pid: child.pid }))
child.on('error', () => { process.exitCode = 1 })
child.on('close', (code, signal) => { process.exitCode = code ?? (signal ? 1 : 0) })
`, { mode: 0o755 })
  await chmod(shimPath, 0o755)
  return { root, scripts, e2e, tests, bin, verifierPath: join(scripts, 'verify.mjs') }
}

export function startVerifierLifecycleRunner(fixture, harness) {
  const child = spawn(process.execPath, [harness.verifierPath, 'e2e'], {
    cwd: harness.root,
    env: {
      ...process.env,
      PATH: `${harness.bin}:${fixture.bin}:${process.env.PATH ?? ''}`,
      PLAYWRIGHT_STACK_LIFECYCLE_STATE: fixture.state,
      PLAYWRIGHT_STACK_LIFECYCLE_CONTROL_PORT: String(fixture.control.port),
      E2E_SHARDS: '1',
      E2E_HOST_FACTOR: '1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let output = ''
  child.stdout.setEncoding('utf8')
  child.stderr.setEncoding('utf8')
  child.stdout.on('data', chunk => { output += chunk })
  child.stderr.on('data', chunk => { output += chunk })
  const closed = new Promise(resolve => child.once('close', (code, signal) => resolve({ code, signal })))
  return { child, closed, output: () => output }
}

export async function waitForRunnerClose(runner, timeoutMs) {
  let timer
  try {
    return await Promise.race([
      runner.closed,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`Playwright runner did not close within ${timeoutMs}ms`)), timeoutMs)
      }),
    ])
  } finally {
    clearTimeout(timer)
  }
}

export async function waitForStackMarker(path, timeoutMs = 8_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try { return await readFile(path, 'utf8') } catch (error) {
      if (error.code !== 'ENOENT') throw error
    }
    await new Promise(resolve => setTimeout(resolve, 20))
  }
  throw new Error(`Timed out waiting for stack lifecycle marker ${path}`)
}

export async function stopStackFixtureChildren(fixture, socket) {
  socket?.destroy()
  for (const role of ['backend', 'ui']) {
    let ready
    try { ready = JSON.parse(await readFile(join(fixture.state, `ready-${role}.json`), 'utf8')) } catch {}
    if (!ready || await exists(join(fixture.state, `exited-${role}`))) continue
    try { process.kill(-ready.pid, 'SIGTERM') } catch (error) { if (error.code !== 'ESRCH') throw error }
    try { await waitForStackMarker(join(fixture.state, `exited-${role}`), 3_000) } catch {
      try { process.kill(-ready.pid, 'SIGKILL') } catch (error) { if (error.code !== 'ESRCH') throw error }
      await waitForStackMarker(join(fixture.state, `exited-${role}`), 2_000).catch(() => {})
    }
    await terminateExactPid(ready.pid)
  }
}

export async function removePlaywrightStackLifecycleFixture(fixture, runner, control, socket) {
  socket?.destroy()
  control?.release()
  if (runner?.child.exitCode === null && runner.child.signalCode === null) runner.child.kill('SIGINT')
  await stopStackFixtureChildren(fixture, socket)

  let dev
  try { dev = JSON.parse(await readFile(join(fixture.state, 'dev.json'), 'utf8')) } catch {}
  let npx
  try { npx = JSON.parse(await readFile(join(fixture.state, 'npx.json'), 'utf8')) } catch {}
  for (const pid of [npx?.pid, npx?.wrapperPid, dev?.pid, dev?.wrapperPid]) {
    if (Number.isSafeInteger(pid)) await terminateExactPid(pid)
  }
  if (runner) {
    try { await waitForRunnerClose(runner, 3_000) }
    catch {
      if (runner.child.exitCode === null && runner.child.signalCode === null) runner.child.kill('SIGKILL')
      await waitForRunnerClose(runner, 1_000).catch(() => {})
    }
  }
  await waitForStackMarker(join(fixture.state, 'dev-exited'), 3_000).catch(() => {})
  if (control?.server.listening) await close(control.server)
  await rm(fixture.root, { recursive: true, force: true })
}

async function exists(path) {
  try { await readFile(path); return true } catch (error) {
    if (error.code === 'ENOENT') return false
    throw error
  }
}

async function waitForPidGone(pid, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try { process.kill(pid, 0) }
    catch (error) { if (error.code === 'ESRCH') return; throw error }
    await new Promise(resolve => setTimeout(resolve, 20))
  }
  throw new Error(`Owned fixture PID ${pid} did not exit within ${timeoutMs}ms`)
}

async function terminateExactPid(pid) {
  if (!Number.isSafeInteger(pid) || pid < 2 || pid === process.pid) return
  try { process.kill(pid, 'SIGTERM') } catch (error) { if (error.code === 'ESRCH') return; throw error }
  try { await waitForPidGone(pid, 2_000); return } catch {}
  try { process.kill(pid, 'SIGKILL') } catch (error) { if (error.code !== 'ESRCH') throw error }
  await waitForPidGone(pid, 2_000)
}
