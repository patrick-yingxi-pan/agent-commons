import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { offerStartupRecovery, recoveryDirectory, revealRecoveryDirectory, runStartupRecovery } from './startupRecovery.mjs'

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

test('startup failure offers native restore without exposing a path or pre-arming replacement', async () => {
  const dialogs: any[] = []
  const opened: string[] = []
  const offered = await offerStartupRecovery({
    showMessageBox: async (options: any) => { dialogs.push(options); return { response: 1 } },
    userDataPath: '/device/Agent Commons',
    makeDirectory: () => undefined,
    openPath: async (directory: string) => { opened.push(directory); return '' },
  })
  assert.equal(offered, 'show')
  assert.deepEqual(dialogs[0].buttons, ['Restore from backup…', 'Show backups', 'Quit'])
  assert.equal(dialogs[0].defaultId, 1)
  assert.equal(dialogs[0].cancelId, 2)
  assert.equal(JSON.stringify(dialogs).includes('/device/'), false)
  assert.deepEqual(opened, [join('/device/Agent Commons', 'snapshots')])

  const restore = await offerStartupRecovery({
    showMessageBox: async () => ({ response: 0 }),
    userDataPath: '/device/Agent Commons',
    openPath: async () => { throw new Error('must not open') },
  })
  assert.equal(restore, 'restore')

  const quit = await offerStartupRecovery({
    showMessageBox: async () => ({ response: 2 }),
    userDataPath: '/device/Agent Commons',
    openPath: async () => { throw new Error('must not open') },
  })
  assert.equal(quit, 'quit')
})

test('startup recovery quits for non-restore choices and picker or confirmation cancellation', async () => {
  for (const choice of ['show', 'quit', 'unknown', undefined]) {
    const events: string[] = []
    await runStartupRecovery({
      offerRecovery: async () => { events.push('offer'); return choice },
      restoreBackup: async () => { events.push('restore'); return { status: 'restarting' } },
      reportFailure: () => { events.push('report') },
      quit: () => { events.push('quit') },
    })
    assert.deepEqual(events, ['offer', 'quit'], `choice ${String(choice)} must not start restore`)
  }

  for (const cancelledAt of ['picker', 'confirmation']) {
    const events: string[] = []
    await runStartupRecovery({
      offerRecovery: async () => { events.push('offer'); return 'restore' },
      restoreBackup: async () => { events.push(cancelledAt); return { status: 'cancelled' } },
      reportFailure: () => { events.push('report') },
      quit: () => { events.push('quit') },
    })
    assert.deepEqual(events, ['offer', cancelledAt, 'quit'], `${cancelledAt} cancellation must quit the startup process`)
  }
})

test('a completed startup restore owns the restart and does not also quit', async () => {
  const events: string[] = []
  await runStartupRecovery({
    offerRecovery: async () => { events.push('offer'); return 'restore' },
    restoreBackup: async () => { events.push('restore'); return { status: 'restarting' } },
    reportFailure: () => { events.push('report') },
    quit: () => { events.push('quit') },
  })
  assert.deepEqual(events, ['offer', 'restore'])
})

test('offer and restore failures are reported by phase and always quit once', async () => {
  const offerFailure = new Error('dialog failure')
  const restoreFailure = new Error('restore failure')
  const scenarios = [
    {
      name: 'offer', error: offerFailure,
      offerRecovery: async () => { throw offerFailure },
      restoreBackup: async () => { throw new Error('must not restore') },
      expected: ['report:offer', 'quit'],
    },
    {
      name: 'restore', error: restoreFailure,
      offerRecovery: async () => 'restore',
      restoreBackup: async () => { throw restoreFailure },
      expected: ['report:restore', 'quit'],
    },
  ]
  for (const scenario of scenarios) {
    const events: string[] = []
    await runStartupRecovery({
      offerRecovery: scenario.offerRecovery,
      restoreBackup: scenario.restoreBackup,
      reportFailure: ({ phase, error }: any) => {
        assert.equal(error, scenario.error)
        events.push(`report:${phase}`)
      },
      quit: () => { events.push('quit') },
    })
    assert.deepEqual(events, scenario.expected, scenario.name)
  }
})

test('quit still runs if startup failure reporting throws', async () => {
  for (const choice of ['offer', 'restore']) {
    const events: string[] = []
    const failure = new Error(`${choice} failed`)
    await assert.rejects(() => runStartupRecovery({
        offerRecovery: async () => {
          if (choice === 'offer') throw failure
          return 'restore'
        },
        restoreBackup: async () => {
          if (choice === 'restore') throw failure
          return { status: 'restarting' }
        },
        reportFailure: ({ phase }: any) => { events.push(`report:${phase}`); throw new Error('reporting failed') },
        quit: () => { events.push('quit') },
      }), /reporting failed/)
    assert.deepEqual(events, [`report:${choice}`, 'quit'])
  }
})

test('unexpected restore results are reported and cannot strand the startup process', async () => {
  for (const result of [undefined, null, {}, { status: 'unexpected' }]) {
    const events: string[] = []
    await runStartupRecovery({
      offerRecovery: async () => 'restore',
      restoreBackup: async () => result,
      reportFailure: ({ phase, error }: any) => {
        assert.equal(phase, 'restore')
        assert.ok(error instanceof Error)
        events.push('report')
      },
      quit: () => { events.push('quit') },
    })
    assert.deepEqual(events, ['report', 'quit'], `unexpected result ${String(result)}`)
  }
})
