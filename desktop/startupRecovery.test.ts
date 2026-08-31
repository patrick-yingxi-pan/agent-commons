import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { offerStartupRecovery, recoveryDirectory, revealRecoveryDirectory } from './startupRecovery.mjs'

test('recovery access resolves only the shell-owned folder and reports OS refusal generically', async () => {
  const made: string[] = []
  const opened: string[] = []
  const expected = join('/device/Agent Commons', 'snapshots')
  assert.equal(recoveryDirectory('/device/Agent Commons'), expected)
  assert.equal(await revealRecoveryDirectory({
    userDataPath: '/device/Agent Commons',
    makeDirectory: (directory: string) => { made.push(directory) },
    openPath: async (directory: string) => { opened.push(directory); return '' },
  }), expected)
  assert.deepEqual(made, [expected])
  assert.deepEqual(opened, [expected])

  await assert.rejects(() => revealRecoveryDirectory({
    userDataPath: '/device/Agent Commons',
    makeDirectory: () => undefined,
    openPath: async () => '/device/Agent Commons/snapshots: permission denied',
  }), /OS refused/)
})

test('startup failure offers backup access without exposing the underlying error or restore', async () => {
  const dialogs: any[] = []
  const opened: string[] = []
  const offered = await offerStartupRecovery({
    showMessageBox: async (options: any) => { dialogs.push(options); return { response: 0 } },
    userDataPath: '/device/Agent Commons',
    makeDirectory: () => undefined,
    openPath: async (directory: string) => { opened.push(directory); return '' },
  })
  assert.equal(offered, true)
  assert.deepEqual(dialogs[0].buttons, ['Show backups', 'Quit'])
  assert.equal(JSON.stringify(dialogs).includes('restore'), false)
  assert.equal(JSON.stringify(dialogs).includes('/device/'), false)
  assert.deepEqual(opened, [join('/device/Agent Commons', 'snapshots')])

  const quit = await offerStartupRecovery({
    showMessageBox: async () => ({ response: 1 }),
    userDataPath: '/device/Agent Commons',
    openPath: async () => { throw new Error('must not open') },
  })
  assert.equal(quit, false)
})
