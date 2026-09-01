import { lstatSync } from 'node:fs'
import { basename, dirname, resolve } from 'node:path'
import { managedBackupName } from './dataProtocol.mjs'
import { ensureRecoveryDirectory } from './startupRecovery.mjs'

export const RESTORE_RESULT = 'agent-commons:restore-result'

/** Native selection is convenience, never authority. The selected file must be
 * one regular, non-symlink direct child of the shell-owned backup directory and
 * belong to an exact managed name family. Only its path-free name leaves here. */
export async function pickManagedBackup({
  owner,
  userDataPath,
  showOpenDialog,
  inspect = lstatSync,
  makeDirectory,
}) {
  if (typeof showOpenDialog !== 'function') throw new Error('A native backup picker is required.')
  const managedDirectory = resolve(ensureRecoveryDirectory({ userDataPath, makeDirectory }))
  const result = await showOpenDialog(owner, {
    title: 'Restore Agent Commons from backup',
    defaultPath: managedDirectory,
    buttonLabel: 'Choose backup',
    properties: ['openFile', 'dontAddToRecent'],
    filters: [{ name: 'Agent Commons backups', extensions: ['json'] }],
  })
  if (result?.canceled || !Array.isArray(result?.filePaths) || result.filePaths.length === 0) {
    return { status: 'cancelled' }
  }
  if (result.filePaths.length !== 1 || typeof result.filePaths[0] !== 'string') {
    throw new Error('Choose exactly one managed Agent Commons backup.')
  }

  const selectedPath = resolve(result.filePaths[0])
  const fileName = basename(selectedPath)
  const snapshotName = managedBackupName(fileName)
  let details
  try {
    details = inspect(selectedPath)
  } catch {
    details = null
  }
  if (
    dirname(selectedPath) !== managedDirectory ||
    !snapshotName ||
    !details?.isFile?.() ||
    details?.isSymbolicLink?.()
  ) {
    throw new Error('Choose a regular backup directly from the Agent Commons backup folder.')
  }
  return { status: 'selected', snapshotName, fileName }
}

export async function confirmManagedRestore({ owner, fileName, showMessageBox, startup = false }) {
  if (typeof showMessageBox !== 'function') throw new Error('A native restore confirmation is required.')
  const { response } = await showMessageBox(owner, {
    type: 'warning',
    title: 'Restore Agent Commons?',
    message: `Restore “${fileName}”?`,
    detail: startup
      ? 'Agent Commons could not open your current data, so it cannot create a fresh safety backup. The selected backup will replace local app data and restart the app. Provider API keys remain in OS-encrypted storage.'
      : 'Agent Commons will first save a fresh safety backup, then replace local app data and restart. Provider API keys remain in OS-encrypted storage.',
    buttons: ['Cancel', 'Restore and restart'],
    defaultId: 0,
    cancelId: 0,
    noLink: true,
  })
  return response === 1
}

/** Wait for the one-shot worker's validated/read-back-proven result. A process
 * exit without that exact acknowledgement is failure, even with exit code 0. */
export function waitForRestoreWorker(child, snapshotName, { timeoutMs = 30_000 } = {}) {
  return new Promise((resolvePromise, rejectPromise) => {
    let settled = false
    const finish = (error) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      child.off?.('message', onMessage)
      error ? rejectPromise(error) : resolvePromise()
    }
    const onMessage = (message) => {
      if (message?.type !== RESTORE_RESULT || message.snapshotName !== snapshotName) return
      finish(message.ok === true ? null : new Error('The selected backup could not be restored.'))
    }
    const timeout = setTimeout(() => {
      child.kill?.()
      finish(new Error('The restore worker did not finish in time.'))
    }, timeoutMs)
    child.on('message', onMessage)
    child.once('exit', () => finish(new Error('The restore worker exited without confirming the restored data.')))
  })
}
