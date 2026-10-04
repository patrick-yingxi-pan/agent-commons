import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createDesktopUpdateController } from './updateController.mjs'

const configuration = Object.freeze({ baseUrl: 'https://updates.example/releases/', architecture: 'arm64', currentVersion: '1.0.0' })
const candidate = Object.freeze({ version: '1.1.0', url: `${configuration.baseUrl}Agent-Commons-1.1.0-macos-arm64.zip`, sha256: 'a'.repeat(64), bytes: 12 })
const tick = () => new Promise<void>((resolve) => setImmediate(resolve))

function makeController(overrides: Record<string, unknown> = {}) {
  const states: unknown[] = []
  const errors: unknown[] = []
  const calls: Array<[string, ...unknown[]]> = []
  const controller = createDesktopUpdateController({
    configuration,
    check: async () => candidate,
    download: async () => ({ dispose: async () => { calls.push(['dispose-archive']) } }),
    confirmDownload: async () => false,
    confirmInstall: async () => false,
    install: async () => { calls.push(['install']) },
    inform: async (...args: unknown[]) => { calls.push(['inform', ...args]) },
    onState: (state: unknown) => states.push(state),
    onError: (error: unknown) => errors.push(error),
    ...overrides,
  })
  return { controller, states, errors, calls }
}

test('a background metadata check asks before downloading and a declined prompt never fetches the archive', async () => {
  let checks = 0
  let prompts = 0
  let downloads = 0
  const { controller } = makeController({
    check: async () => { checks += 1; return candidate },
    confirmDownload: async () => { prompts += 1; return false },
    download: async () => { downloads += 1; return { dispose() {} } },
  })

  await controller.checkForUpdates()
  assert.equal(checks, 1)
  assert.equal(prompts, 1)
  assert.equal(downloads, 0)
  assert.deepEqual(controller.state, { phase: 'available', version: candidate.version })
  await controller.dispose()
})

test('download and install require separate consent; Later retains the archive for the next action', async () => {
  const calls: string[] = []
  const { controller } = makeController({
    check: async () => { calls.push('metadata'); return candidate },
    confirmDownload: async () => { calls.push('confirm-download'); return true },
    download: async () => { calls.push('download'); return { dispose: async () => { calls.push('dispose') } } },
    confirmInstall: async () => { calls.push('confirm-install'); return calls.filter((call) => call === 'confirm-install').length > 1 },
    install: async () => { calls.push('install') },
  })

  await controller.checkForUpdates({ interactive: true })
  assert.deepEqual(calls, ['metadata', 'confirm-download', 'download', 'confirm-install'])
  assert.deepEqual(controller.state, { phase: 'ready', version: candidate.version })
  await controller.action()
  assert.deepEqual(calls, ['metadata', 'confirm-download', 'download', 'confirm-install', 'confirm-install', 'install'])
  assert.deepEqual(controller.state, { phase: 'installing', version: candidate.version })
  await controller.dispose()
  assert.equal(calls.filter((call) => call === 'install').length, 1)
  assert.equal(calls.filter((call) => call === 'dispose').length, 1)
  await controller.dispose()
  assert.equal(calls.filter((call) => call === 'dispose').length, 1)
})

test('concurrent actions coalesce around one in-flight metadata check', async () => {
  let begin!: () => void
  const gate = new Promise<void>((resolve) => { begin = resolve })
  let checks = 0
  const { controller } = makeController({
    check: async () => { checks += 1; await gate; return null },
    inform: async () => {},
  })
  const first = controller.action()
  const second = controller.action()
  await tick()
  assert.equal(checks, 1)
  begin()
  await Promise.all([first, second])
  await controller.dispose()
})

test('background failures stay quiet while a manual check reports the error', async () => {
  let informs = 0
  const { controller, errors } = makeController({
    check: async () => { throw new Error('metadata unavailable') },
    inform: async (kind: string) => { if (kind === 'error') informs += 1 },
  })

  await controller.checkForUpdates()
  assert.equal(informs, 0)
  assert.equal(errors.length, 1)
  await controller.action()
  assert.equal(informs, 1)
  assert.equal(errors.length, 2)
  assert.deepEqual(controller.state, { phase: 'error', version: null })
  await controller.dispose()
})

test('an error-notice rejection during approved download failure is reported without breaking action or disposal', async () => {
  const downloadError = new Error('approved archive download failed')
  const dialogError = new Error('native error notice failed')
  const reported: unknown[] = []
  let controller!: ReturnType<typeof createDesktopUpdateController>
  let disposal: Promise<void> | undefined
  const setup = makeController({
    check: async () => candidate,
    confirmDownload: async () => true,
    download: async () => { throw downloadError },
    inform: async (kind: string) => {
      if (kind === 'error') throw dialogError
    },
    onError: (error: unknown) => {
      reported.push(error)
      if (error === dialogError) disposal = controller.dispose()
    },
  })
  controller = setup.controller

  await assert.doesNotReject(controller.action())
  assert.deepEqual(reported, [downloadError, dialogError])
  assert.ok(disposal, 'disposal was started while the failing action was still being drained')
  await disposal
})

test('a manual action joining a background check still reports its failure', async () => {
  let rejectCheck!: (error: Error) => void
  const checkGate = new Promise<null>((_resolve, reject) => { rejectCheck = reject })
  let informs = 0
  const { controller } = makeController({
    check: async () => checkGate,
    inform: async (kind: string) => { if (kind === 'error') informs += 1 },
  })
  const background = controller.checkForUpdates()
  await tick()
  const manual = controller.action()
  rejectCheck(new Error('background request failed'))
  await Promise.all([background, manual])
  assert.equal(informs, 1)
  await controller.dispose()
})

test('a manual action joining a successful background check announces that the app is current', async () => {
  let resolveCheck!: (value: null) => void
  const checkGate = new Promise<null>((resolve) => { resolveCheck = resolve })
  const notices: string[] = []
  const { controller } = makeController({
    check: async () => checkGate,
    inform: async (kind: string) => { notices.push(kind) },
  })
  const background = controller.checkForUpdates()
  await tick()
  const manual = controller.action()
  resolveCheck(null)
  await Promise.all([background, manual])
  assert.deepEqual(notices, ['current'])
  assert.deepEqual(controller.state, { phase: 'current', version: null })
  await controller.dispose()
})

test('a manual action joining a same-version background check reoffers its declined download', async () => {
  let checks = 0
  let resolveSecondCheck!: (value: typeof candidate) => void
  const secondCheck = new Promise<typeof candidate>((resolve) => { resolveSecondCheck = resolve })
  let prompts = 0
  const { controller } = makeController({
    check: async () => {
      checks += 1
      return checks === 1 ? candidate : secondCheck
    },
    confirmDownload: async () => { prompts += 1; return false },
  })
  await controller.checkForUpdates()
  assert.equal(prompts, 1)

  const background = controller.checkForUpdates()
  await tick()
  const manual = controller.action()
  resolveSecondCheck(candidate)
  await Promise.all([background, manual])
  assert.equal(prompts, 2)
  await controller.dispose()
})

test('start schedules one 30-second check followed by six-hour checks', async () => {
  const timers: Array<{ callback: () => void; delay: number; unrefCount: number }> = []
  const canceled: unknown[] = []
  let checks = 0
  const { controller } = makeController({
    check: async () => { checks += 1; return null },
    schedule: (callback: () => void, delay: number) => {
      const timer = { callback, delay, unrefCount: 0, unref() { this.unrefCount += 1 } }
      timers.push(timer)
      return timer
    },
    cancelSchedule: (timer: unknown) => { canceled.push(timer) },
  })

  controller.start()
  controller.start()
  assert.equal(timers.length, 1)
  assert.equal(timers[0].delay, 30_000)
  assert.equal(timers[0].unrefCount, 1)
  timers[0].callback()
  await tick()
  assert.equal(checks, 1)
  assert.equal(timers.length, 2)
  assert.equal(timers[1].delay, 6 * 60 * 60_000)
  assert.equal(timers[1].unrefCount, 1)
  await controller.dispose()
  assert.deepEqual(canceled, [timers[1]])
})

test('dispose aborts in-flight network work, cancels the owned timer, and never publishes afterward', async () => {
  let timer: unknown
  let canceled: unknown
  let signal!: AbortSignal
  const states: unknown[] = []
  const { controller } = makeController({
    check: ({ signal: received }: { signal: AbortSignal }) => {
      signal = received
      return new Promise((_resolve, reject) => {
        received.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
      })
    },
    schedule: (callback: () => void, delay: number) => { timer = { callback, delay }; return timer },
    cancelSchedule: (owned: unknown) => { canceled = owned },
    onState: (state: unknown) => states.push(state),
  })
  controller.start()
  const work = controller.checkForUpdates()
  await tick()
  assert.equal(signal.aborted, false)
  const beforeDispose = states.length
  const disposal = controller.dispose()
  assert.equal(signal.aborted, true)
  await Promise.all([work, disposal])
  assert.equal(canceled, timer)
  const afterDispose = states.length
  await controller.action()
  assert.equal(states.length, afterDispose)
  assert.equal(afterDispose, beforeDispose)
})

test('an archive produced after disposal is disposed once and cannot install or publish', async () => {
  let allowDownload!: () => void
  const gate = new Promise<void>((resolve) => { allowDownload = resolve })
  let disposed = 0
  let installed = 0
  const states: unknown[] = []
  const { controller } = makeController({
    check: async () => candidate,
    confirmDownload: async () => true,
    download: async () => { await gate; return { dispose: async () => { disposed += 1 } } },
    confirmInstall: async () => true,
    install: async () => { installed += 1 },
    onState: (state: unknown) => states.push(state),
  })

  const work = controller.checkForUpdates({ interactive: true })
  await tick()
  assert.equal(controller.state.phase, 'downloading')
  const beforeDispose = states.length
  const disposal = controller.dispose()
  allowDownload()
  await Promise.all([work, disposal])
  assert.equal(disposed, 1)
  assert.equal(installed, 0)
  assert.equal(states.length, beforeDispose)
})

test('dispose cleans the held archive even when its in-flight action rejects', async () => {
  const actionError = new Error('install path failed')
  const observerError = new Error('error observer failed')
  let confirmations = 0
  let disposed = 0
  let controller!: ReturnType<typeof createDesktopUpdateController>
  let disposal: Promise<void> | undefined
  const setup = makeController({
    check: async () => candidate,
    confirmDownload: async () => true,
    download: async () => ({ dispose: async () => { disposed += 1 } }),
    confirmInstall: async () => { confirmations += 1; return confirmations > 1 },
    install: async () => { throw actionError },
    onError: () => {
      disposal = controller.dispose()
      throw observerError
    },
  })
  controller = setup.controller
  await controller.checkForUpdates({ interactive: true })
  assert.deepEqual(controller.state, { phase: 'ready', version: candidate.version })

  await assert.rejects(controller.action(), observerError)
  assert.ok(disposal)
  await assert.rejects(disposal, observerError)
  assert.equal(disposed, 1)
})

test('repeated dispose calls share one drain and dispose a late archive exactly once', async () => {
  let allowDownload!: () => void
  const gate = new Promise<void>((resolve) => { allowDownload = resolve })
  let disposeCalls = 0
  let settled = false
  const { controller } = makeController({
    check: async () => candidate,
    confirmDownload: async () => true,
    download: async () => {
      await gate
      return { dispose: async () => { disposeCalls += 1 } }
    },
    confirmInstall: async () => true,
  })
  const work = controller.checkForUpdates({ interactive: true })
  await tick()
  const firstDispose = controller.dispose()
  const secondDispose = controller.dispose()
  assert.equal(firstDispose, secondDispose)
  firstDispose.then(() => { settled = true })
  await tick()
  assert.equal(settled, false)
  allowDownload()
  await Promise.all([work, firstDispose, secondDispose])
  assert.equal(settled, true)
  assert.equal(disposeCalls, 1)
  assert.equal(controller.state.phase, 'downloading')
})

test('dispose aborts an open consent dialog and ignores its late affirmative answer', async () => {
  let answer!: (confirmed: boolean) => void
  let downloads = 0
  let installed = 0
  const states: unknown[] = []
  const { controller } = makeController({
    check: async () => candidate,
    confirmDownload: (_update: unknown, signal: AbortSignal) => new Promise<boolean>((resolve) => {
      answer = resolve
      assert.equal(signal.aborted, false)
    }),
    download: async () => { downloads += 1; return { dispose() {} } },
    install: async () => { installed += 1 },
    onState: (state: unknown) => states.push(state),
  })
  const work = controller.checkForUpdates({ interactive: true })
  await tick()
  assert.equal(typeof answer, 'function')
  const beforeDispose = states.length
  const disposal = controller.dispose()
  answer(true)
  await Promise.all([work, disposal])
  assert.equal(downloads, 0)
  assert.equal(installed, 0)
  assert.equal(states.length, beforeDispose)
})

test('unconfigured controllers do not schedule or call the network', async () => {
  let checks = 0
  let schedules = 0
  let notices = 0
  const { controller } = makeController({
    configuration: null,
    check: async () => { checks += 1; return candidate },
    schedule: () => { schedules += 1; return {} },
    inform: async (kind: string) => { if (kind === 'unconfigured') notices += 1 },
  })

  controller.start()
  await controller.checkForUpdates()
  assert.equal(controller.state.phase, 'unconfigured')
  assert.equal(checks, 0)
  assert.equal(schedules, 0)
  await controller.action()
  assert.equal(checks, 0)
  assert.equal(notices, 1)
  await controller.dispose()
})
