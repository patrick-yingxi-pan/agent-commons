import { chmodSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

export const RECOVERY_DIRECTORY_NAME = 'snapshots'

export function recoveryDirectory(userDataPath) {
  if (typeof userDataPath !== 'string' || userDataPath.length === 0) {
    throw new Error('A desktop user-data path is required.')
  }
  return join(userDataPath, RECOVERY_DIRECTORY_NAME)
}

export function ensureRecoveryDirectory({
  userDataPath,
  makeDirectory = (directory) => {
    mkdirSync(directory, { recursive: true, mode: 0o700 })
    if (process.platform !== 'win32') chmodSync(directory, 0o700)
  },
}) {
  const directory = recoveryDirectory(userDataPath)
  makeDirectory(directory)
  return directory
}

/** Reveal only the shell-owned recovery directory. No renderer-provided path
 * participates, and the directory is private before it reaches the OS shell. */
export async function revealRecoveryDirectory({
  userDataPath,
  openPath,
  makeDirectory,
}) {
  if (typeof openPath !== 'function') throw new Error('An OS folder opener is required.')
  const directory = ensureRecoveryDirectory({ userDataPath, makeDirectory })
  const error = await openPath(directory)
  if (error) throw new Error('The OS refused to open the recovery directory.')
  return directory
}

/** A failed start offers only shell-owned recovery actions. The caller owns the
 * stopped-server restore workflow; this dialog returns intent and reveals only
 * the managed directory itself. */
export async function offerStartupRecovery({ showMessageBox, userDataPath, openPath, makeDirectory }) {
  if (typeof showMessageBox !== 'function') throw new Error('A native message box is required.')
  const { response } = await showMessageBox({
    type: 'error',
    title: 'Couldn’t open Agent Commons',
    message: 'Agent Commons couldn’t start.',
    detail: 'Your local data was left unchanged. You can restore a managed backup, open the backup folder, or quit.',
    buttons: ['Restore from backup…', 'Show backups', 'Quit'],
    defaultId: 1,
    cancelId: 2,
    noLink: true,
  })
  if (response === 0) return 'restore'
  if (response === 1) {
    await revealRecoveryDirectory({ userDataPath, openPath, makeDirectory })
    return 'show'
  }
  return 'quit'
}

/** A failed start has no usable window to return to. Only a confirmed restore
 * that owns relaunch may keep this process alive; cancellation, refusal and
 * reporting failures must still drain it through the ordinary quit boundary. */
export async function runStartupRecovery({ offerRecovery, restoreBackup, reportFailure, quit }) {
  let phase = 'offer'
  let restarting = false
  try {
    if (await offerRecovery() === 'restore') {
      phase = 'restore'
      const outcome = await restoreBackup()
      if (outcome?.status !== 'cancelled' && outcome?.status !== 'restarting') {
        throw new Error('The startup restore returned an unrecognized outcome.')
      }
      restarting = outcome?.status === 'restarting'
    }
  } catch (error) {
    await reportFailure({ phase, error })
  } finally {
    if (!restarting) quit()
  }
  return { status: restarting ? 'restarting' : 'quitting' }
}
