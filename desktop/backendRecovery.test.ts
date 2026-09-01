import { test } from 'node:test'
import assert from 'node:assert/strict'
import { BACKEND_RECOVERY_DIALOG, runBackendRecovery } from './backendRecovery.mjs'

test('backend loss defaults to a clean app restart and honestly scopes saved versus unsaved work', async () => {
  const events: string[] = []
  let offered: any
  const result = await runBackendRecovery({
    showMessageBox: async (options: any) => {
      events.push('offer')
      offered = options
      return { response: 0 }
    },
    restart: () => { events.push('restart') },
    reportRestartFailure: () => { events.push('report') },
    quit: () => { events.push('quit') },
  })

  assert.deepEqual(result, { status: 'restarting' })
  assert.equal(offered, BACKEND_RECOVERY_DIALOG)
  assert.deepEqual(offered.buttons, ['Restart Agent Commons', 'Quit'])
  assert.equal(offered.defaultId, 0)
  assert.equal(offered.cancelId, 1)
  assert.match(offered.detail, /Work already saved remains on this device/)
  assert.match(offered.detail, /Unsaved text in the window may be lost/)
  assert.deepEqual(events, ['offer', 'restart'])
})

test('backend loss maps cancel to quit through the shared native lifecycle', async () => {
  const events: string[] = []
  assert.deepEqual(await runBackendRecovery({
    showMessageBox: async () => ({ response: 1 }),
    restart: () => { events.push('restart') },
    reportRestartFailure: () => { events.push('report') },
    quit: () => { events.push('quit') },
  }), { status: 'quitting' })
  assert.deepEqual(events, ['quit'])
})
