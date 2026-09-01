import { test } from 'node:test'
import assert from 'node:assert/strict'
import { runNativeRecovery } from './nativeRecovery.mjs'

const OPTIONS = Object.freeze({ buttons: ['Recover', 'Quit'], defaultId: 0, cancelId: 1 })

function lifecycle(overrides: Record<string, unknown> = {}) {
  return {
    dialogOptions: OPTIONS,
    showMessageBox: async () => ({ response: 0 }),
    recover: async () => undefined,
    reportFailure: async () => undefined,
    quit: () => undefined,
    recoveredStatus: 'recovered',
    ...overrides,
  }
}

test('native recovery runs the default recovery operation and returns its domain status', async () => {
  const events: string[] = []
  let offered: unknown
  const result = await runNativeRecovery(lifecycle({
    showMessageBox: async (options: unknown) => {
      events.push('offer')
      offered = options
      return { response: 0 }
    },
    recover: async () => { events.push('recover') },
    reportFailure: async () => { events.push('report') },
    quit: () => { events.push('quit') },
    recoveredStatus: 'restarted',
  }))

  assert.deepEqual(result, { status: 'restarted' })
  assert.equal(offered, OPTIONS)
  assert.deepEqual(events, ['offer', 'recover'])
})

test('native recovery treats cancel and every non-primary response as orderly quit', async () => {
  for (const response of [1, -1, undefined]) {
    const events: string[] = []
    assert.deepEqual(await runNativeRecovery(lifecycle({
      showMessageBox: async () => ({ response }),
      recover: async () => { events.push('recover') },
      reportFailure: async () => { events.push('report') },
      quit: () => { events.push('quit') },
    })), { status: 'quitting' })
    assert.deepEqual(events, ['quit'])
  }
})

test('native recovery reports a failed operation and cannot lose the final quit', async () => {
  const events: string[] = []
  assert.deepEqual(await runNativeRecovery(lifecycle({
    recover: async () => { events.push('recover'); throw new Error('recovery failed') },
    reportFailure: async (error: Error) => {
      events.push('report')
      assert.match(error.message, /recovery failed/)
    },
    quit: () => { events.push('quit') },
  })), { status: 'quitting' })
  assert.deepEqual(events, ['recover', 'report', 'quit'])

  const reporterEvents: string[] = []
  await assert.rejects(() => runNativeRecovery(lifecycle({
    recover: async () => { reporterEvents.push('recover'); throw new Error('recovery failed') },
    reportFailure: async () => { reporterEvents.push('report'); throw new Error('report failed') },
    quit: () => { reporterEvents.push('quit') },
  })), /report failed/)
  assert.deepEqual(reporterEvents, ['recover', 'report', 'quit'])
})

test('native recovery refuses every incomplete lifecycle dependency', async () => {
  for (const key of Object.keys(lifecycle())) {
    const value = key === 'recoveredStatus' ? '' : undefined
    await assert.rejects(() => runNativeRecovery(lifecycle({ [key]: value })), /required/)
  }
})
