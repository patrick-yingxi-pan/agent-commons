import { test } from 'node:test'
import assert from 'node:assert/strict'
import { RENDERER_RECOVERY_DIALOG, runRendererRecovery } from './rendererRecovery.mjs'

test('renderer recovery defaults to reopening and distinguishes saved work from unsaved window text', async () => {
  const events: string[] = []
  let offered: any
  const result = await runRendererRecovery({
    showMessageBox: async (options: any) => {
      events.push('offer')
      offered = options
      return { response: 0 }
    },
    reopen: async () => { events.push('reopen') },
    reportReopenFailure: async () => { events.push('report') },
    quit: () => { events.push('quit') },
  })

  assert.deepEqual(result, { status: 'reopened' })
  assert.deepEqual(events, ['offer', 'reopen'])
  assert.equal(offered, RENDERER_RECOVERY_DIALOG)
  assert.deepEqual(offered.buttons, ['Reopen window', 'Quit'])
  assert.equal(offered.defaultId, 0)
  assert.equal(offered.cancelId, 1)
  assert.match(offered.detail, /Work already saved remains on this device/)
  assert.match(offered.detail, /Unsaved text in the window may be lost/)
})

test('renderer recovery quits on cancel or a failed reopen and never hides the failure', async () => {
  const cancelEvents: string[] = []
  assert.deepEqual(await runRendererRecovery({
    showMessageBox: async () => ({ response: 1 }),
    reopen: async () => { cancelEvents.push('reopen') },
    reportReopenFailure: async () => { cancelEvents.push('report') },
    quit: () => { cancelEvents.push('quit') },
  }), { status: 'quitting' })
  assert.deepEqual(cancelEvents, ['quit'])

  const failedEvents: string[] = []
  assert.deepEqual(await runRendererRecovery({
    showMessageBox: async () => ({ response: 0 }),
    reopen: async () => { failedEvents.push('reopen'); throw new Error('Chromium refused') },
    reportReopenFailure: async (error: Error) => {
      failedEvents.push('report')
      assert.match(error.message, /Chromium refused/)
    },
    quit: () => { failedEvents.push('quit') },
  }), { status: 'quitting' })
  assert.deepEqual(failedEvents, ['reopen', 'report', 'quit'])

  const reporterFailureEvents: string[] = []
  await assert.rejects(() => runRendererRecovery({
    showMessageBox: async () => ({ response: 0 }),
    reopen: async () => { reporterFailureEvents.push('reopen'); throw new Error('reopen failed') },
    reportReopenFailure: async () => { reporterFailureEvents.push('report'); throw new Error('report failed') },
    quit: () => { reporterFailureEvents.push('quit') },
  }), /report failed/)
  assert.deepEqual(reporterFailureEvents, ['reopen', 'report', 'quit'])
})

test('renderer recovery refuses an incomplete native lifecycle', async () => {
  const complete = {
    showMessageBox: async () => ({ response: 0 }),
    reopen: async () => undefined,
    reportReopenFailure: async () => undefined,
    quit: () => undefined,
  }
  for (const key of Object.keys(complete)) {
    await assert.rejects(() => runRendererRecovery({ ...complete, [key]: undefined }), /required/)
  }
})
