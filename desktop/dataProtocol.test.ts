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

  port.emit('message', { data: { type: DATA_REQUEST, requestId: 8, operation: 'restore' } })
  assert.deepEqual(port.sent.at(-1), { type: DATA_RESULT, requestId: 8, ok: false, error: 'invalid_request' })
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

  await assert.rejects(() => client.createBackup(), /did not acknowledge/)
  client.close()
  await assert.rejects(() => client.createBackup(), /not available/)
})
