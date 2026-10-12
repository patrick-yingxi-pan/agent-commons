/** Playwright must give the dev launcher time to drain its owned server group. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { get } from 'node:http'
import { createServer } from 'node:net'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  createPlaywrightStackLifecycleFixture,
  createVerifierLifecycleHarness,
  removePlaywrightStackLifecycleFixture,
  startPlaywrightStackLifecycleRunner,
  startVerifierLifecycleRunner,
  waitForRunnerClose,
  waitForStackMarker,
} from './helpers/playwrightStackLifecycleFixture.mjs'

async function portIsFree(port: number) {
  const server = createServer()
  return new Promise<boolean>((resolve) => {
    server.once('error', () => resolve(false))
    server.once('listening', () => server.close(error => resolve(!error)))
    server.listen(port, '127.0.0.1')
  })
}

function assertPidGone(pid: number, message: string) {
  assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' }, message)
}

async function assertDynamicBindings(fixture: { configPath: string }, ui: { port: number }, backend: { port: number }) {
  assert.ok(ui.port > 0 && backend.port > 0, 'each fixture server reports its kernel-assigned nonzero port')
  assert.notEqual(ui.port, backend.port, 'the UI and backend receive distinct kernel-assigned ports')
  const config = await readFile(fixture.configPath, 'utf8')
  assert.match(config, /PORT: '0'/, 'dev UI is asked to bind port 0, without a preflight-selected port')
  assert.match(config, /MOCK_PORT: '0'/, 'dev backend is asked to bind port 0, without a preflight-selected port')
}

async function waitForMarkerWithOutput(
  runner: { output(): string },
  path: string,
  timeoutMs = 8_000,
) {
  try { return await waitForStackMarker(path, timeoutMs) }
  catch (error) {
    throw new Error(`${(error as Error).message}\nRunner output:\n${runner.output()}`)
  }
}

test('Playwright SIGINT drains the real dev launcher and releases its stack before exit', {
  timeout: 30_000,
  skip: process.platform === 'win32',
}, async () => {
  const fixture = await createPlaywrightStackLifecycleFixture()
  const control = fixture.control
  let heldBackendSocket: import('node:net').Socket | undefined
  let runner: ReturnType<typeof startPlaywrightStackLifecycleRunner> | undefined
  try {
    runner = startPlaywrightStackLifecycleRunner(fixture, control.port)
    await waitForMarkerWithOutput(runner, join(fixture.state, 'ready-backend.json'))
    await waitForMarkerWithOutput(runner, join(fixture.state, 'ready-ui.json'))
    await waitForMarkerWithOutput(runner, join(fixture.state, 'spec-ready'))
    await waitForMarkerWithOutput(runner, join(fixture.state, 'control-held'))
    const backend = JSON.parse(await readFile(join(fixture.state, 'ready-backend.json'), 'utf8'))
    const ui = JSON.parse(await readFile(join(fixture.state, 'ready-ui.json'), 'utf8'))
    await assertDynamicBindings(fixture, ui, backend)

    const heldRequest = get(`http://127.0.0.1:${backend.port}/hold`)
    heldBackendSocket = await new Promise((resolve, reject) => {
      heldRequest.once('socket', resolve)
      heldRequest.once('error', reject)
    })
    await waitForMarkerWithOutput(runner, join(fixture.state, 'backend-held'))

    runner.child.kill('SIGINT')
    const backendSignal = await waitForMarkerWithOutput(runner, join(fixture.state, 'signal-backend'), 4_000)
    assert.equal(backendSignal, 'SIGTERM', 'Playwright asks the webServer to shut down gracefully')
    assert.equal(runner.child.exitCode, null, 'Playwright stays alive while its owned backend drains')
    assert.equal(await exists(join(fixture.state, 'drained-backend')), false,
      'the backend has not completed draining while its request is held')
    assert.doesNotThrow(() => process.kill(backend.pid, 0), 'the backend process remains alive while draining')

    heldBackendSocket.destroy()
    heldBackendSocket = undefined
    control.release()

    await waitForMarkerWithOutput(runner, join(fixture.state, 'drained-backend'), 10_000)
    await waitForMarkerWithOutput(runner, join(fixture.state, 'drained-ui'), 10_000)
    const outcome = await waitForRunnerClose(runner, 15_000)
    assert.equal(outcome.signal, null)
    assert.notEqual(outcome.code, 0, 'an interrupted Playwright run is not reported as a pass')
    assert.equal(await portIsFree(backend.port), true, 'backend port is released at runner close')
    assert.equal(await portIsFree(ui.port), true, 'UI port is released at runner close')
    for (const role of ['backend', 'ui']) {
      const owned = JSON.parse(await readFile(join(fixture.state, `ready-${role}.json`), 'utf8'))
      assertPidGone(owned.pid, `${role} PID is gone when Playwright closes`)
    }
    const dev = JSON.parse(await readFile(join(fixture.state, 'dev.json'), 'utf8'))
    await waitForStackMarker(join(fixture.state, 'dev-exited'))
    assertPidGone(dev.pid, 'real dev launcher PID is gone when Playwright closes')
    assertPidGone(dev.wrapperPid, 'webServer node wrapper PID is gone when Playwright closes')
    assertPidGone(runner.child.pid!, 'Playwright runner PID is gone after close')
  } finally {
    heldBackendSocket?.destroy()
    await removePlaywrightStackLifecycleFixture(fixture, runner, control, heldBackendSocket)
  }
})

test('real verifier maps external SIGTERM to Playwright SIGINT and waits for its owned stack', {
  timeout: 35_000,
  skip: process.platform === 'win32',
}, async () => {
  const fixture = await createPlaywrightStackLifecycleFixture()
  const control = fixture.control
  const harness = await createVerifierLifecycleHarness(fixture, {
    mapBrowserSignal: process.env.PLAYWRIGHT_STACK_LIFECYCLE_DISABLE_VERIFY_MAPPING !== '1',
  })
  let heldBackendSocket: import('node:net').Socket | undefined
  let runner: ReturnType<typeof startVerifierLifecycleRunner> | undefined
  try {
    runner = startVerifierLifecycleRunner(fixture, harness)
    await waitForMarkerWithOutput(runner, join(fixture.state, 'ready-backend.json'))
    await waitForMarkerWithOutput(runner, join(fixture.state, 'ready-ui.json'))
    await waitForMarkerWithOutput(runner, join(fixture.state, 'spec-ready'))
    await waitForMarkerWithOutput(runner, join(fixture.state, 'control-held'))
    await waitForMarkerWithOutput(runner, join(fixture.state, 'npx.json'))
    const backend = JSON.parse(await readFile(join(fixture.state, 'ready-backend.json'), 'utf8'))
    const ui = JSON.parse(await readFile(join(fixture.state, 'ready-ui.json'), 'utf8'))
    await assertDynamicBindings(fixture, ui, backend)

    const heldRequest = get(`http://127.0.0.1:${backend.port}/hold`)
    heldBackendSocket = await new Promise((resolve, reject) => {
      heldRequest.once('socket', resolve)
      heldRequest.once('error', reject)
    })
    await waitForMarkerWithOutput(runner, join(fixture.state, 'backend-held'))

    // The external signal targets only the verifier. It must translate the
    // Playwright lane to SIGINT so Playwright can gracefully stop its webServer.
    runner.child.kill('SIGTERM')
    const backendSignal = await waitForMarkerWithOutput(runner, join(fixture.state, 'signal-backend'), 4_000)
    assert.equal(backendSignal, 'SIGTERM', 'mapped Playwright shutdown reaches dev.mjs as SIGTERM')
    assert.equal(runner.child.exitCode, null, 'verifier waits while the owned backend is draining')
    assert.equal(await exists(join(fixture.state, 'drained-backend')), false,
      'the verifier has not outlived a still-held backend request')

    heldBackendSocket.destroy()
    heldBackendSocket = undefined
    control.release()

    await waitForMarkerWithOutput(runner, join(fixture.state, 'drained-backend'), 10_000)
    await waitForMarkerWithOutput(runner, join(fixture.state, 'drained-ui'), 10_000)
    const outcome = await waitForRunnerClose(runner, 15_000)
    assert.equal(outcome.signal, null)
    assert.equal(outcome.code, 143, 'external SIGTERM remains the verifier’s exact exit status')
    assert.match(runner.output(), /verify: interrupted \(SIGTERM\)/)
    assert.match(runner.output(), /verification interrupted — no passing revision/)
    assert.doesNotMatch(runner.output(), /all \d+ lanes green/)
    assert.equal(await exists(join(harness.root, '.data', 'spec-weights.json')), false,
      'an interrupted filtered verifier run does not publish success weights')
    assert.equal(await portIsFree(backend.port), true, 'verifier close means backend port is free')
    assert.equal(await portIsFree(ui.port), true, 'verifier close means UI port is free')

    for (const role of ['backend', 'ui']) {
      const owned = JSON.parse(await readFile(join(fixture.state, `ready-${role}.json`), 'utf8'))
      assertPidGone(owned.pid, `${role} PID is gone at verifier close`)
    }
    const dev = JSON.parse(await readFile(join(fixture.state, 'dev.json'), 'utf8'))
    assertPidGone(dev.pid, 'dev launcher PID is gone at verifier close')
    assertPidGone(dev.wrapperPid, 'webServer wrapper PID is gone at verifier close')
    const npx = JSON.parse(await readFile(join(fixture.state, 'npx.json'), 'utf8'))
    assertPidGone(npx.pid, 'Playwright CLI PID is gone at verifier close')
    assertPidGone(npx.wrapperPid, 'npx shim PID is gone at verifier close')
    assertPidGone(runner.child.pid!, 'verifier PID is gone after close')
  } finally {
    heldBackendSocket?.destroy()
    await removePlaywrightStackLifecycleFixture(fixture, runner, control, heldBackendSocket)
  }
})

async function exists(path: string) {
  try { await readFile(path); return true }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}
