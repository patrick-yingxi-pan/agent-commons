import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { RESTORE_RESULT } from './restoreProtocol.mjs'
import { restoreManagedDesktopSnapshot } from './restoreWorker.mjs'

const SNAPSHOT = 'recovery-2026-08-31'

test('the one-shot restore worker validates the managed name and reports no paths or exception detail', async () => {
  const sent: unknown[] = []
  const parentPort = { postMessage: (message: unknown) => sent.push(message) }
  const calls: string[] = []
  assert.equal(await restoreManagedDesktopSnapshot({
    snapshotName: SNAPSHOT,
    parentPort,
    restore: async (name: string) => { calls.push(name) },
  }), true)
  assert.deepEqual(calls, [SNAPSHOT])
  assert.deepEqual(sent, [{ type: RESTORE_RESULT, ok: true, snapshotName: SNAPSHOT }])

  sent.length = 0
  assert.equal(await restoreManagedDesktopSnapshot({
    snapshotName: '../escape',
    parentPort,
    restore: async () => { throw new Error('must not run') },
  }), false)
  assert.deepEqual(sent, [])

  assert.equal(await restoreManagedDesktopSnapshot({
    snapshotName: SNAPSHOT,
    parentPort,
    restore: async () => { throw new Error('/private/device/store.db secret detail') },
  }), false)
  assert.deepEqual(sent, [{ type: RESTORE_RESULT, ok: false, snapshotName: SNAPSHOT }])
  assert.equal(JSON.stringify(sent).includes('/private/'), false)
})

test('the restore module auto-runs only inside an Electron utility process', () => {
  const source = readFileSync(new URL('./restoreWorker.mjs', import.meta.url), 'utf8')
  assert.match(source, /if \(process\.parentPort\)/)
  assert.match(source, /snapshotName: process\.argv\.at\(-1\)/)
  assert.doesNotMatch(source, /process\.argv\[1\].*import\.meta\.url/)
})
