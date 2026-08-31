import { chmodSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

export const RECOVERY_DIRECTORY_NAME = 'snapshots'

export function recoveryDirectory(userDataPath) {
  if (typeof userDataPath !== 'string' || userDataPath.length === 0) {
    throw new Error('A desktop user-data path is required.')
  }
  return join(userDataPath, RECOVERY_DIRECTORY_NAME)
}

/** Reveal only the shell-owned recovery directory. No renderer-provided path
 * participates, and the directory is private before it reaches the OS shell. */
export async function revealRecoveryDirectory({
  userDataPath,
  openPath,
  makeDirectory = (directory) => {
    mkdirSync(directory, { recursive: true, mode: 0o700 })
    if (process.platform !== 'win32') chmodSync(directory, 0o700)
  },
}) {
  if (typeof openPath !== 'function') throw new Error('An OS folder opener is required.')
  const directory = recoveryDirectory(userDataPath)
  makeDirectory(directory)
  const error = await openPath(directory)
  if (error) throw new Error('The OS refused to open the recovery directory.')
  return directory
}

/** Startup recovery remains deliberately non-destructive: expose the managed
 * copies, or quit. Selecting a backup and replacing live state still belongs to
 * the explicit stopped-server restore workflow. */
export async function offerStartupRecovery({ showMessageBox, userDataPath, openPath, makeDirectory }) {
  if (typeof showMessageBox !== 'function') throw new Error('A native message box is required.')
  const { response } = await showMessageBox({
    type: 'error',
    title: 'Couldn’t open Agent Commons',
    message: 'Agent Commons couldn’t start.',
    detail: 'Your local data was left unchanged. You can open the backup folder to inspect or copy any recovery files.',
    buttons: ['Show backups', 'Quit'],
    defaultId: 0,
    cancelId: 1,
    noLink: true,
  })
  if (response !== 0) return false
  await revealRecoveryDirectory({ userDataPath, openPath, makeDirectory })
  return true
}
