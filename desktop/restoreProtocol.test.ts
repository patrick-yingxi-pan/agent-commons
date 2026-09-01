import { test } from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { join } from 'node:path'
import {
  RESTORE_RESULT,
  confirmManagedRestore,
  pickManagedBackup,
  waitForRestoreWorker,
} from './restoreProtocol.mjs'

const USER_DATA = '/device/Agent Commons'
const SNAPSHOTS = join(USER_DATA, 'snapshots')
const FILE_NAME = 'backup-2026-08-31T18-25-43-210Z-a1b2c3d4e5f60718.json'

function regularFile({ symlink = false } = {}) {
  return {
    isFile: () => true,
    isSymbolicLink: () => symlink,
  }
}

test('native restore selection returns only an exact managed backup identity', async () => {
  const dialogs: any[] = []
  const selected = await pickManagedBackup({
    owner: { id: 'window' },
    userDataPath: USER_DATA,
    makeDirectory: () => undefined,
    inspect: () => regularFile(),
    showOpenDialog: async (_owner: unknown, options: unknown) => {
      dialogs.push(options)
      return { canceled: false, filePaths: [join(SNAPSHOTS, FILE_NAME)] }
    },
  })
  assert.deepEqual(selected, {
    status: 'selected',
    snapshotName: FILE_NAME.replace(/\.json$/, ''),
    fileName: FILE_NAME,
  })
  assert.equal(JSON.stringify(selected).includes('/device/'), false)
  assert.equal(dialogs[0].defaultPath, SNAPSHOTS)
  assert.deepEqual(dialogs[0].properties, ['openFile', 'dontAddToRecent'])

  const cancelled = await pickManagedBackup({
    userDataPath: USER_DATA,
    makeDirectory: () => undefined,
    showOpenDialog: async () => ({ canceled: true, filePaths: [] }),
  })
  assert.deepEqual(cancelled, { status: 'cancelled' })
})

test('native restore refuses outside, unrecognized, and symlink selections', async () => {
  const attempt = (filePath: string, inspect = () => regularFile()) => pickManagedBackup({
    userDataPath: USER_DATA,
    makeDirectory: () => undefined,
    inspect,
    showOpenDialog: async () => ({ canceled: false, filePaths: [filePath] }),
  })
  await assert.rejects(attempt(join(USER_DATA, FILE_NAME)), /directly from the Agent Commons backup folder/)
  await assert.rejects(attempt(join(SNAPSHOTS, 'backup.json')), /directly from the Agent Commons backup folder/)
  await assert.rejects(
    attempt(join(SNAPSHOTS, FILE_NAME), () => regularFile({ symlink: true })),
    /directly from the Agent Commons backup folder/,
  )
})

test('restore confirmation defaults to Cancel and explains restart, replacement, and credential scope', async () => {
  const dialogs: any[] = []
  const confirmed = await confirmManagedRestore({
    fileName: FILE_NAME,
    showMessageBox: async (_owner: unknown, options: unknown) => {
      dialogs.push(options)
      return { response: 0 }
    },
  })
  assert.equal(confirmed, false)
  assert.deepEqual(dialogs[0].buttons, ['Cancel', 'Restore and restart'])
  assert.equal(dialogs[0].defaultId, 0)
  assert.equal(dialogs[0].cancelId, 0)
  assert.match(dialogs[0].detail, /fresh safety backup/)
  assert.match(dialogs[0].detail, /Provider API keys remain/)

  dialogs.length = 0
  await confirmManagedRestore({
    fileName: FILE_NAME,
    startup: true,
    showMessageBox: async (_owner: unknown, options: unknown) => {
      dialogs.push(options)
      return { response: 1 }
    },
  })
  assert.match(dialogs[0].detail, /cannot create a fresh safety backup/)
})

class FakeWorker extends EventEmitter {
  killed = false
  kill() { this.killed = true }
}

test('restore worker completion requires the exact acknowledgement and times out closed', async () => {
  const worker = new FakeWorker()
  const completed = waitForRestoreWorker(worker, 'backup-one')
  worker.emit('message', { type: RESTORE_RESULT, ok: true, snapshotName: 'backup-other' })
  worker.emit('message', { type: RESTORE_RESULT, ok: true, snapshotName: 'backup-one' })
  await completed

  const exited = new FakeWorker()
  const noAck = waitForRestoreWorker(exited, 'backup-one')
  exited.emit('exit', 0)
  await assert.rejects(noAck, /without confirming/)

  const timedOut = new FakeWorker()
  await assert.rejects(
    waitForRestoreWorker(timedOut, 'backup-one', { timeoutMs: 5 }),
    /did not finish in time/,
  )
  assert.equal(timedOut.killed, true)
})
