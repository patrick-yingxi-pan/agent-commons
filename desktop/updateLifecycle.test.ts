import { EventEmitter } from 'node:events'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { relaunchAfterUpdateCleanup, runManagedUpdateLifecycle, stageNativeUpdate } from './updateLifecycle.mjs'

function lifecycle(overrides: Record<string, unknown> = {}) {
  const events: string[] = []
  const safetyBackup = { fileName: 'update-safety.json' }
  const input = {
    createSafetyBackup: async () => { events.push('backup'); return safetyBackup },
    stopBackend: async () => { events.push('stop') },
    stageUpdate: async () => { events.push('stage') },
    discardDownload: async () => { events.push('discard') },
    installAndRestart: () => { events.push('install-and-restart') },
    reportShutdownFailure: async ({ error, safetyBackup: backup }: { error: Error; safetyBackup: unknown }) => {
      events.push(`report:${error.message}:${backup === safetyBackup}`)
    },
    restart: (code: number) => { events.push(`restart:${code}`) },
    ...overrides,
  }
  return { events, input, safetyBackup }
}

test('managed update backs up, strictly stops, stages, discards the download, then installs and restarts', async () => {
  const { events, input } = lifecycle()
  assert.deepEqual(await runManagedUpdateLifecycle(input), { status: 'restarting' })
  assert.deepEqual(events, ['backup', 'stop', 'stage', 'discard', 'install-and-restart'])
})

test('safety backup failure never stops the backend or attempts installation', async () => {
  const { events, input } = lifecycle({
    createSafetyBackup: async () => { events.push('backup'); throw new Error('backup failed') },
  })
  await assert.rejects(runManagedUpdateLifecycle(input), /backup failed/)
  assert.deepEqual(events, ['backup'])
})

test('stop, native staging, and download cleanup failures report once and restart without installing', async () => {
  for (const failedStep of ['stop', 'stage', 'discard'] as const) {
    const { events, input } = lifecycle({
      [failedStep === 'stop' ? 'stopBackend' : failedStep === 'stage' ? 'stageUpdate' : 'discardDownload']: async () => {
        events.push(failedStep)
        throw new Error(`${failedStep} failed`)
      },
    })
    assert.deepEqual(await runManagedUpdateLifecycle(input), { status: 'restarting' })
    assert.equal(events.filter((event) => event.startsWith('report:')).length, 1)
    assert.equal(events.filter((event) => event === 'restart:1').length, 1)
    assert.equal(events.includes('install-and-restart'), false)
    const failureIndex = events.indexOf(failedStep)
    assert.deepEqual(events.slice(failureIndex + 1), [`report:${failedStep} failed:true`, 'restart:1'])
  }
})

test('an asynchronous install-and-restart failure is reported and recovered by one restart', async () => {
  const { events, input } = lifecycle({
    installAndRestart: async () => { events.push('install-and-restart'); throw new Error('native install failed') },
  })
  assert.deepEqual(await runManagedUpdateLifecycle(input), { status: 'restarting' })
  assert.deepEqual(events, [
    'backup', 'stop', 'stage', 'discard', 'install-and-restart',
    'report:native install failed:true', 'restart:1',
  ])
})

test('relaunch waits for update cleanup before relaunching and exiting with the requested code', async () => {
  const events: string[] = []
  await relaunchAfterUpdateCleanup({
    disposeUpdates: async () => { events.push('dispose-start'); await Promise.resolve(); events.push('dispose-done') },
    onCleanupError: async () => { events.push('cleanup-error') },
    relaunch: () => { events.push('relaunch') },
    exit: (code: number) => { events.push(`exit:${code}`) },
    exitCode: 17,
  })
  assert.deepEqual(events, ['dispose-start', 'dispose-done', 'relaunch', 'exit:17'])
})

test('relaunch reports update cleanup failure but still relaunches and exits', async () => {
  const events: string[] = []
  const cleanupError = new Error('update cleanup failed')
  await relaunchAfterUpdateCleanup({
    disposeUpdates: async () => { events.push('dispose'); throw cleanupError },
    onCleanupError: async (error: Error) => { assert.equal(error, cleanupError); events.push('report') },
    relaunch: () => { events.push('relaunch') },
    exit: (code: number) => { events.push(`exit:${code}`) },
  })
  assert.deepEqual(events, ['dispose', 'report', 'relaunch', 'exit:0'])
})

class FakeUpdater extends EventEmitter {
  feed: unknown
  checks = 0
  setFeedURL(value: unknown) { this.feed = value }
  checkForUpdates() { this.checks += 1 }
}

function bridgeHarness() {
  const updater = new FakeUpdater()
  const closes: string[] = []
  const update = { version: '1.2.0' }
  const input = {
    updater,
    archivePath: '/owned/update.zip',
    update,
    serve: async ({ archivePath, update: approved }: { archivePath: string; update: unknown }) => {
      assert.equal(archivePath, '/owned/update.zip')
      assert.equal(approved, update)
      return { feedUrl: 'http://127.0.0.1:4567/feed/', close: async () => { closes.push('closed') } }
    },
  }
  return { updater, closes, input }
}

test('native staging uses exact loopback feed and default Squirrel server type, then waits for downloaded', async () => {
  const { updater, closes, input } = bridgeHarness()
  let settled = false
  const staged = stageNativeUpdate({ ...input, timeoutMs: 500 }).then(() => { settled = true })
  await new Promise<void>((resolve) => setImmediate(resolve))
  assert.deepEqual(updater.feed, { url: 'http://127.0.0.1:4567/feed/', serverType: 'default' })
  assert.equal(updater.checks, 1)
  assert.equal(settled, false)
  assert.deepEqual(closes, [], 'bridge remains open until the native download finishes')
  assert.equal(updater.listenerCount('error'), 1)
  updater.emit('update-downloaded')
  await staged
  assert.equal(settled, true)
  assert.deepEqual(closes, ['closed'])
  assert.equal(updater.listenerCount('error'), 0)
  assert.equal(updater.listenerCount('update-downloaded'), 0)
  assert.equal(updater.listenerCount('update-not-available'), 0)
})

test('native staging closes the bridge and removes all listeners on updater errors and no-update results', async () => {
  for (const event of ['error', 'update-not-available'] as const) {
    const { updater, closes, input } = bridgeHarness()
    const staged = stageNativeUpdate({ ...input, timeoutMs: 500 })
    await new Promise<void>((resolve) => setImmediate(resolve))
    const expected = event === 'error' ? /native failure/ : /not staged/
    if (event === 'error') updater.emit(event, new Error('native failure'))
    else updater.emit(event)
    await assert.rejects(staged, expected)
    assert.deepEqual(closes, ['closed'])
    assert.equal(updater.listenerCount('error'), 0)
    assert.equal(updater.listenerCount('update-downloaded'), 0)
    assert.equal(updater.listenerCount('update-not-available'), 0)
  }
})

test('native staging timeout closes the bridge and removes listeners', async () => {
  const { updater, closes, input } = bridgeHarness()
  await assert.rejects(stageNativeUpdate({ ...input, timeoutMs: 5 }), /timed out/)
  assert.deepEqual(closes, ['closed'])
  assert.equal(updater.listenerCount('error'), 0)
  assert.equal(updater.listenerCount('update-downloaded'), 0)
  assert.equal(updater.listenerCount('update-not-available'), 0)
})

test('native staging rejects out-of-range deadlines before opening the bridge', async () => {
  let opened = 0
  const { updater, input } = bridgeHarness()
  const serve = async () => {
    opened += 1
    return { feedUrl: 'http://127.0.0.1:4567/feed/', close: async () => {} }
  }
  for (const timeoutMs of [0, -1, 120_001, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    await assert.rejects(stageNativeUpdate({ ...input, updater, serve, timeoutMs }), /deadline is invalid/)
  }
  assert.equal(opened, 0)
})

test('native staging cleanup failure aggregates with and preserves the primary updater error', async () => {
  const { updater, input } = bridgeHarness()
  const nativeError = new Error('signature staging failed')
  const cleanupError = new Error('bridge close failed')
  const serve = async () => ({
    feedUrl: 'http://127.0.0.1:4567/feed/',
    close: async () => { throw cleanupError },
  })
  const staged = stageNativeUpdate({ ...input, updater, serve, timeoutMs: 500 })
  await new Promise<void>((resolve) => setImmediate(resolve))
  updater.emit('error', nativeError)
  await assert.rejects(staged, (error: unknown) => {
    assert.equal(error instanceof AggregateError, true)
    assert.deepEqual((error as AggregateError).errors, [nativeError, cleanupError])
    return true
  })
  assert.equal(updater.listenerCount('error'), 0)
  assert.equal(updater.listenerCount('update-downloaded'), 0)
  assert.equal(updater.listenerCount('update-not-available'), 0)
})

test('synchronous native updater setup failure also closes the bridge and removes listeners', async () => {
  const { updater, closes, input } = bridgeHarness()
  updater.setFeedURL = () => { throw new Error('feed setup failed') }
  await assert.rejects(stageNativeUpdate({ ...input, timeoutMs: 500 }), /feed setup failed/)
  assert.deepEqual(closes, ['closed'])
  assert.equal(updater.listenerCount('error'), 0)
  assert.equal(updater.listenerCount('update-downloaded'), 0)
  assert.equal(updater.listenerCount('update-not-available'), 0)
})
