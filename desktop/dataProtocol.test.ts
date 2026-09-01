import { test } from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import {
  DATA_REQUEST,
  DATA_RESULT,
  createDataBackendClient,
  desktopBackupName,
  installDataRuntime,
  isBackupMetadata,
  managedBackupName,
} from './dataProtocol.mjs'

class FakeParentPort extends EventEmitter {
  sent: unknown[] = []
  postMessage(message: unknown) { this.sent.push(message) }
}

class FakeChild extends EventEmitter {
  posted: any[] = []
  postMessage(message: any) { this.posted.push(message) }
}

const NOW = new Date('2026-08-31T18:25:43.210Z')
const NAME = 'backup-2026-08-31T18-25-43-210Z-a1b2c3d4e5f60718'

test('desktop backup names are sortable, safe managed-snapshot names', () => {
  assert.equal(desktopBackupName(NOW, 'A1B2C3D4E5F60718'), NAME)
  assert.throws(() => desktopBackupName(NOW, '../x'), /safe backup name/)
  assert.equal(managedBackupName(`${NAME}.json`), NAME)
  assert.equal(managedBackupName('recovery-2026-08-31.json'), 'recovery-2026-08-31')
  for (const invalid of ['backup.json', `..${'/recovery-2026-08-31.json'}`, 'recovery-2026-08-31.txt']) {
    assert.equal(managedBackupName(invalid), null)
  }
})

test('the utility creates a managed backup and returns metadata without a path', () => {
  const port = new FakeParentPort()
  const calls: unknown[][] = []
  installDataRuntime({
    parentPort: port as any,
    save: (name: string) => {
      calls.push([name])
      return { from: '/private/store.db', to: `/private/snapshots/${name}.json` }
    },
    stat: () => ({ size: 4096, mtime: NOW }),
    ensureRecovery: (date: Date) => {
      calls.push(['recovery', date.toISOString()])
      return { created: true, from: '/private/store.db', to: '/private/snapshots/recovery-2026-08-31.json' }
    },
    now: () => NOW,
    nonce: () => 'a1b2c3d4e5f60718',
  })

  port.emit('message', { data: { type: DATA_REQUEST, requestId: 7, operation: 'create-backup' } })
  assert.deepEqual(calls, [[NAME]])
  assert.deepEqual(port.sent, [{
    type: DATA_RESULT,
    requestId: 7,
    ok: true,
    backup: { fileName: `${NAME}.json`, sizeBytes: 4096, createdAt: NOW.toISOString() },
  }])
  assert.equal(JSON.stringify(port.sent).includes('/private/'), false)

  port.emit('message', { data: { type: DATA_REQUEST, requestId: 8, operation: 'ensure-recovery-backup' } })
  assert.deepEqual(calls.at(-1), ['recovery', NOW.toISOString()])
  assert.deepEqual(port.sent.at(-1), {
    type: DATA_RESULT,
    requestId: 8,
    ok: true,
    backup: { fileName: 'recovery-2026-08-31.json', sizeBytes: 4096, createdAt: NOW.toISOString() },
  })

  port.emit('message', { data: { type: DATA_REQUEST, requestId: 9, operation: 'restore' } })
  assert.deepEqual(port.sent.at(-1), { type: DATA_RESULT, requestId: 9, ok: false, error: 'invalid_request' })
})

test('the main client correlates validated metadata, timeout, and close', async () => {
  const child = new FakeChild()
  const client = createDataBackendClient(child as any, { timeoutMs: 20 })
  const creating = client.createBackup()
  const request = child.posted.at(-1)
  const backup = { fileName: `${NAME}.json`, sizeBytes: 4096, createdAt: NOW.toISOString() }
  assert.equal(isBackupMetadata(backup), true)
  child.emit('message', { type: DATA_RESULT, requestId: request.requestId, ok: true, backup })
  assert.deepEqual(await creating, backup)

  const ensuring = client.ensureRecoveryBackup()
  const recoveryRequest = child.posted.at(-1)
  const recovery = { fileName: 'recovery-2026-08-31.json', sizeBytes: 4096, createdAt: NOW.toISOString() }
  assert.equal(isBackupMetadata(recovery, 'recovery'), true)
  assert.equal(isBackupMetadata(recovery, 'manual'), false)
  child.emit('message', { type: DATA_RESULT, requestId: recoveryRequest.requestId, ok: true, backup: recovery })
  assert.deepEqual(await ensuring, recovery)

  await assert.rejects(() => client.createBackup(), /did not acknowledge/)
  client.close()
  await assert.rejects(() => client.createBackup(), /not available/)
})
