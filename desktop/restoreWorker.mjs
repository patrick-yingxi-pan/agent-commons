import { restoreSnapshot } from '../server/persistence/backup.ts'
import { managedBackupName } from './dataProtocol.mjs'
import { RESTORE_RESULT } from './restoreProtocol.mjs'

export async function restoreManagedDesktopSnapshot({
  snapshotName,
  parentPort = process.parentPort,
  restore = restoreSnapshot,
} = {}) {
  const validName = managedBackupName(`${snapshotName}.json`) === snapshotName
  if (!parentPort || !validName) return false
  try {
    await restore(snapshotName)
    parentPort.postMessage({ type: RESTORE_RESULT, ok: true, snapshotName })
    return true
  } catch {
    parentPort.postMessage({ type: RESTORE_RESULT, ok: false, snapshotName })
    return false
  }
}

// `parentPort` is present only when Electron launched this file as a utility
// process. Tests import the function without activating destructive work. The
// caller's single custom argument is always the final argv entry.
if (process.parentPort) {
  const restored = await restoreManagedDesktopSnapshot({ snapshotName: process.argv.at(-1) })
  if (!restored) process.exitCode = 1
}
