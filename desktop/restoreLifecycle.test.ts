import { test } from 'node:test'
import assert from 'node:assert/strict'
import { runManagedRestoreLifecycle } from './restoreLifecycle.mjs'

function harness(overrides: Record<string, unknown> = {}) {
  const events: string[] = []
  const safetyBackup = { fileName: 'backup-safety.json' }
  return {
    events,
    safetyBackup,
    input: {
      createSafetyBackup: async () => { events.push('safety'); return safetyBackup },
      stopBackend: async () => { events.push('stop') },
      restoreSnapshot: async () => { events.push('restore') },
      reportShutdownFailure: async () => { events.push('report-failure') },
      restart: (code: number) => { events.push(`restart:${code}`) },
      ...overrides,
    },
  }
}

test('healthy restore creates a safety copy before proven stop, restore, and restart', async () => {
  const { events, input } = harness()
  assert.deepEqual(await runManagedRestoreLifecycle(input), { status: 'restarting' })
  assert.deepEqual(events, ['safety', 'stop', 'restore', 'restart:0'])
})

test('startup recovery honestly skips the unavailable fresh safety copy', async () => {
  const { events, input } = harness()
  assert.deepEqual(await runManagedRestoreLifecycle({ ...input, startup: true }), { status: 'restarting' })
  assert.deepEqual(events, ['stop', 'restore', 'restart:0'])
})

test('a safety-copy failure leaves the backend running and does not restore or restart', async () => {
  const { events, input } = harness({
    createSafetyBackup: async () => { events.push('safety'); throw new Error('copy failed') },
  })
  await assert.rejects(runManagedRestoreLifecycle(input), /copy failed/)
  assert.deepEqual(events, ['safety'])
})

test('a stop or restore failure after shutdown begins reports and always restarts', async () => {
  for (const failedStep of ['stop', 'restore'] as const) {
    const { events, input } = harness({
      [failedStep === 'stop' ? 'stopBackend' : 'restoreSnapshot']: async () => {
        events.push(failedStep)
        throw new Error(`${failedStep} failed`)
      },
    })
    assert.deepEqual(await runManagedRestoreLifecycle(input), { status: 'restarting' })
    assert.deepEqual(events, failedStep === 'stop'
      ? ['safety', 'stop', 'report-failure', 'restart:1']
      : ['safety', 'stop', 'restore', 'report-failure', 'restart:1'])
  }
})

test('restart still happens when native failure reporting itself fails', async () => {
  const { events, input } = harness({
    restoreSnapshot: async () => { events.push('restore'); throw new Error('restore failed') },
    reportShutdownFailure: async () => { events.push('report-failure'); throw new Error('dialog failed') },
  })
  await assert.rejects(runManagedRestoreLifecycle(input), /dialog failed/)
  assert.deepEqual(events, ['safety', 'stop', 'restore', 'report-failure', 'restart:1'])
})
